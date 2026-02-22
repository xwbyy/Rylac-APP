const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Message = require('../models/Message');
const AppConfig = require('../models/AppConfig');
const { requireAdmin } = require('../middleware/auth');

// All admin routes require admin auth
router.use(requireAdmin);

// GET /api/admin/stats - Dashboard statistics
router.get('/stats', async (req, res) => {
  try {
    const totalUsers = await User.countDocuments({ isAdmin: false });
    const activeUsers = await User.countDocuments({ isAdmin: false, isSuspended: false });
    const suspendedUsers = await User.countDocuments({ isSuspended: true });
    const onlineUsers = await User.countDocuments({ isOnline: true, isAdmin: false });
    const totalMessages = await Message.countDocuments({ isDeleted: false });

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const newUsersToday = await User.countDocuments({ createdAt: { $gte: today } });
    const messagesToday = await Message.countDocuments({ createdAt: { $gte: today } });

    const last7Days = new Date();
    last7Days.setDate(last7Days.getDate() - 7);
    const activeThisWeek = await User.countDocuments({ lastSeen: { $gte: last7Days }, isAdmin: false });

    res.json({
      success: true,
      stats: {
        totalUsers,
        activeUsers,
        suspendedUsers,
        onlineUsers,
        totalMessages,
        newUsersToday,
        messagesToday,
        activeThisWeek,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// GET /api/admin/users - Get all users with pagination
router.get('/users', async (req, res) => {
  try {
    const { page = 1, limit = 20, search = '', filter = 'all' } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    let query = { isAdmin: false };
    if (search) {
      const regex = new RegExp(search, 'i');
      query.$or = [{ username: regex }, { displayName: regex }, { userId: search }];
    }
    if (filter === 'suspended') query.isSuspended = true;
    if (filter === 'active') query.isSuspended = false;
    if (filter === 'online') query.isOnline = true;

    const users = await User.find(query)
      .select('-password -refreshTokens')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await User.countDocuments(query);

    res.json({
      success: true,
      users,
      pagination: { page: parseInt(page), limit: parseInt(limit), total },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// PUT /api/admin/users/:userId/suspend - Suspend user
router.put('/users/:userId/suspend', async (req, res) => {
  try {
    const { reason = '' } = req.body;
    const user = await User.findOneAndUpdate(
      { userId: req.params.userId },
      { $set: { isSuspended: true, suspendReason: reason, refreshTokens: [] } },
      { new: true }
    ).select('-password -refreshTokens');

    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

    // Force disconnect via socket
    req.app.get('io')?.to(req.params.userId).emit('accountSuspended', { reason });

    res.json({ success: true, message: 'User suspended.', user });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// PUT /api/admin/users/:userId/activate - Activate user
router.put('/users/:userId/activate', async (req, res) => {
  try {
    const user = await User.findOneAndUpdate(
      { userId: req.params.userId },
      { $set: { isSuspended: false, suspendReason: '' } },
      { new: true }
    ).select('-password -refreshTokens');

    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

    res.json({ success: true, message: 'User activated.', user });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// PUT /api/admin/users/:userId/reset-password - Reset user password
router.put('/users/:userId/reset-password', async (req, res) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters.' });
    }

    const salt = await bcrypt.genSalt(12);
    const hashed = await bcrypt.hash(newPassword, salt);

    await User.updateOne(
      { userId: req.params.userId },
      { $set: { password: hashed, refreshTokens: [] } }
    );

    res.json({ success: true, message: 'Password reset successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// DELETE /api/admin/users/:userId - Delete user
router.delete('/users/:userId', async (req, res) => {
  try {
    const user = await User.findOneAndDelete({ userId: req.params.userId });
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

    // Delete their messages
    await Message.deleteMany({
      $or: [{ senderId: req.params.userId }, { receiverId: req.params.userId }],
    });

    req.app.get('io')?.to(req.params.userId).emit('accountDeleted');

    res.json({ success: true, message: 'User and all messages deleted.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// GET /api/admin/messages - Get all messages with filters
router.get('/messages', async (req, res) => {
  try {
    const { page = 1, limit = 30, userId } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    let query = {};
    if (userId) query.$or = [{ senderId: userId }, { receiverId: userId }];

    const messages = await Message.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Message.countDocuments(query);

    res.json({ success: true, messages, pagination: { page: parseInt(page), total } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// DELETE /api/admin/messages/:messageId - Admin delete message
router.delete('/messages/:messageId', async (req, res) => {
  try {
    const message = await Message.findOne({ messageId: req.params.messageId });
    if (!message) return res.status(404).json({ success: false, message: 'Message not found.' });

    message.isDeleted = true;
    message.content = '[Deleted by admin]';
    message.fileData = undefined;
    message.giphyData = undefined;
    await message.save();

    req.app.get('io')?.to(message.senderId).emit('messageDeleted', { messageId: req.params.messageId });
    req.app.get('io')?.to(message.receiverId).emit('messageDeleted', { messageId: req.params.messageId });

    res.json({ success: true, message: 'Message deleted.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// GET /api/admin/config - Get all app config
router.get('/config', async (req, res) => {
  try {
    const configs = await AppConfig.find().sort({ key: 1 });
    res.json({ success: true, configs });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// PUT /api/admin/config/:key - Update app config
router.put('/config/:key', async (req, res) => {
  try {
    const { value } = req.body;
    const config = await AppConfig.findOneAndUpdate(
      { key: req.params.key },
      { $set: { value, updatedAt: new Date() } },
      { upsert: true, new: true }
    );
    res.json({ success: true, config });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// GET /api/admin/verify - Verify admin token
router.get('/verify', (req, res) => {
  res.json({ success: true, admin: req.admin });
});

module.exports = router;
