const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const { authenticateToken } = require('../middleware/auth');

// GET /api/users/search?q=query - Search users by username or display name
router.get('/search', authenticateToken, async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.trim().length < 1) {
      return res.json({ success: true, users: [] });
    }

    const regex = new RegExp(q.trim(), 'i');
    const users = await User.find({
      $or: [
        { username: regex },
        { displayName: regex },
        { userId: q.trim() },
      ],
      userId: { $ne: req.user.userId }, // Exclude self
      isSuspended: false,
    })
    .select('userId username displayName avatar status isOnline lastSeen bio')
    .limit(20);

    res.json({ success: true, users });
  } catch (err) {
    console.error('Search error:', err);
    res.status(500).json({ success: false, message: 'Search failed.' });
  }
});

// GET /api/users/:userId - Get user profile
router.get('/:userId', authenticateToken, async (req, res) => {
  try {
    const user = await User.findOne({ userId: req.params.userId })
      .select('userId username displayName avatar bio status isOnline lastSeen createdAt');

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// PUT /api/users/profile/update - Update own profile
router.put('/profile/update', authenticateToken, async (req, res) => {
  try {
    const { displayName, bio, status, avatar, theme, notificationSound } = req.body;
    const updateData = { updatedAt: new Date() };

    if (displayName !== undefined) {
      if (displayName.length < 1 || displayName.length > 50) {
        return res.status(400).json({ success: false, message: 'Display name must be 1-50 characters.' });
      }
      updateData.displayName = displayName.trim();
    }

    if (bio !== undefined) {
      if (bio.length > 200) {
        return res.status(400).json({ success: false, message: 'Bio max 200 characters.' });
      }
      updateData.bio = bio.trim();
    }

    if (status !== undefined) {
      if (status.length > 100) {
        return res.status(400).json({ success: false, message: 'Status max 100 characters.' });
      }
      updateData.status = status.trim();
    }

    if (avatar !== undefined) {
      // Validate URL format
      if (avatar && !/^https?:\/\/.+/.test(avatar)) {
        return res.status(400).json({ success: false, message: 'Avatar must be a valid URL.' });
      }
      updateData.avatar = avatar;
    }

    if (theme !== undefined && ['light', 'dark'].includes(theme)) {
      updateData.theme = theme;
    }

    if (notificationSound !== undefined) {
      updateData.notificationSound = Boolean(notificationSound);
    }

    const user = await User.findOneAndUpdate(
      { userId: req.user.userId },
      { $set: updateData },
      { new: true }
    ).select('-password -refreshTokens');

    res.json({ success: true, message: 'Profile updated successfully!', user: user.toSafeObject() });
  } catch (err) {
    console.error('Profile update error:', err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// PUT /api/users/password/change - Change password
router.put('/password/change', authenticateToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, message: 'Current and new passwords required.' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, message: 'New password must be at least 6 characters.' });
    }

    const user = await User.findOne({ userId: req.user.userId });
    const isValid = await bcrypt.compare(currentPassword, user.password);

    if (!isValid) {
      return res.status(401).json({ success: false, message: 'Current password is incorrect.' });
    }

    const salt = await bcrypt.genSalt(12);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    await User.updateOne(
      { userId: req.user.userId },
      { $set: { password: hashedPassword, refreshTokens: [] } }
    );

    res.json({ success: true, message: 'Password changed. Please login again.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// GET /api/users/profile/me - Get full own profile
router.get('/profile/me', authenticateToken, async (req, res) => {
  try {
    const user = await User.findOne({ userId: req.user.userId }).select('-password -refreshTokens');
    res.json({ success: true, user: user.toSafeObject() });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// GET /api/users/contacts/list - Get user's recent contacts
router.get('/contacts/list', authenticateToken, async (req, res) => {
  try {
    const currentUser = await User.findOne({ userId: req.user.userId });
    const Message = require('../models/Message');

    // Get all unique conversation partners
    const sent = await Message.distinct('receiverId', { senderId: req.user.userId, isDeleted: false });
    const received = await Message.distinct('senderId', { receiverId: req.user.userId, isDeleted: false });
    const allContactIds = [...new Set([...sent, ...received])];

    const contacts = await User.find({ userId: { $in: allContactIds } })
      .select('userId username displayName avatar status isOnline lastSeen');

    res.json({ success: true, contacts });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

module.exports = router;
