const express = require('express');
const router = express.Router();
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const config = require('../config');
const Message = require('../models/Message');
const User = require('../models/User');
const { authenticateToken } = require('../middleware/auth');

// Multer setup - store in memory (base64 encode for MongoDB)
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: config.MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg','image/png','image/gif','image/webp','audio/mpeg','audio/wav','audio/ogg','video/mp4','video/webm','application/pdf','text/plain'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('File type not allowed.'), false);
    }
  },
});

// GET /api/messages/:userId - Get conversation messages
router.get('/:userId', authenticateToken, async (req, res) => {
  try {
    const { userId } = req.params;
    const { page = 1, limit = 50 } = req.query;

    // Verify other user exists
    const otherUser = await User.findOne({ userId }).select('userId username displayName avatar isOnline lastSeen status');
    if (!otherUser) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    const conversationId = Message.getConversationId(req.user.userId, userId);
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const messages = await Message.find({
      conversationId,
      $nor: [{ deletedBy: req.user.userId }],
    })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(parseInt(limit));

    // Mark messages as read
    await Message.updateMany(
      { conversationId, receiverId: req.user.userId, isRead: false },
      { $set: { isRead: true } }
    );

    const total = await Message.countDocuments({ conversationId });

    res.json({
      success: true,
      messages: messages.reverse(),
      otherUser,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        hasMore: skip + messages.length < total,
      },
    });
  } catch (err) {
    console.error('Get messages error:', err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// POST /api/messages/send - Send text/gif message
router.post('/send', authenticateToken, async (req, res) => {
  try {
    const { receiverId, content, type = 'text', giphyData, replyTo } = req.body;

    if (!receiverId) {
      return res.status(400).json({ success: false, message: 'Receiver ID required.' });
    }

    const receiver = await User.findOne({ userId: receiverId });
    if (!receiver) {
      return res.status(404).json({ success: false, message: 'Receiver not found.' });
    }

    if (type === 'text' && (!content || !content.trim())) {
      return res.status(400).json({ success: false, message: 'Message content required.' });
    }

    const AppConfig = require('../models/AppConfig');
    if (type === 'gif') {
      const giphyEnabled = await AppConfig.findOne({ key: 'giphy_enabled' });
      if (giphyEnabled && !giphyEnabled.value) {
        return res.status(403).json({ success: false, message: 'GIF feature is disabled.' });
      }
    }

    const maxLength = await AppConfig.findOne({ key: 'max_message_length' });
    const maxLen = maxLength ? maxLength.value : 2000;
    if (content && content.length > maxLen) {
      return res.status(400).json({ success: false, message: `Message too long. Max ${maxLen} characters.` });
    }

    const message = new Message({
      messageId: uuidv4(),
      conversationId: Message.getConversationId(req.user.userId, receiverId),
      senderId: req.user.userId,
      receiverId,
      type,
      content: content ? content.trim() : '',
      giphyData: giphyData || undefined,
      replyTo: replyTo || undefined,
    });

    await message.save();

    // Emit via socket (handled in server.js)
    req.app.get('io')?.to(receiverId).emit('newMessage', {
      ...message.toObject(),
      sender: {
        userId: req.user.userId,
        username: req.user.username,
        displayName: req.user.displayName,
        avatar: req.user.avatar,
      },
    });

    res.status(201).json({ success: true, message: 'Message sent!', data: message });
  } catch (err) {
    console.error('Send message error:', err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// POST /api/messages/upload - Upload file/media message
router.post('/upload', authenticateToken, upload.single('file'), async (req, res) => {
  try {
    const { receiverId, replyTo } = req.body;

    if (!receiverId) {
      return res.status(400).json({ success: false, message: 'Receiver ID required.' });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded.' });
    }

    const AppConfig = require('../models/AppConfig');
    const uploadEnabled = await AppConfig.findOne({ key: 'file_upload_enabled' });
    if (uploadEnabled && !uploadEnabled.value) {
      return res.status(403).json({ success: false, message: 'File uploads are disabled.' });
    }

    const receiver = await User.findOne({ userId: receiverId });
    if (!receiver) {
      return res.status(404).json({ success: false, message: 'Receiver not found.' });
    }

    const mime = req.file.mimetype;
    let type = 'file';
    if (mime.startsWith('image/')) type = mime === 'image/gif' ? 'gif' : 'image';
    else if (mime.startsWith('audio/')) type = 'audio';
    else if (mime.startsWith('video/')) type = 'video';

    const base64Data = req.file.buffer.toString('base64');
    const dataUrl = `data:${mime};base64,${base64Data}`;

    const message = new Message({
      messageId: uuidv4(),
      conversationId: Message.getConversationId(req.user.userId, receiverId),
      senderId: req.user.userId,
      receiverId,
      type,
      content: req.file.originalname,
      fileData: {
        name: req.file.originalname,
        size: req.file.size,
        mimeType: mime,
        base64: dataUrl,
      },
      replyTo: replyTo ? JSON.parse(replyTo) : undefined,
    });

    await message.save();

    req.app.get('io')?.to(receiverId).emit('newMessage', {
      ...message.toObject(),
      sender: {
        userId: req.user.userId,
        username: req.user.username,
        displayName: req.user.displayName,
        avatar: req.user.avatar,
      },
    });

    res.status(201).json({ success: true, message: 'File sent!', data: message });
  } catch (err) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ success: false, message: 'File too large. Max 1MB.' });
    }
    console.error('Upload error:', err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// DELETE /api/messages/:messageId - Delete message
router.delete('/:messageId', authenticateToken, async (req, res) => {
  try {
    const { messageId } = req.params;
    const { deleteFor = 'me' } = req.query;

    const message = await Message.findOne({ messageId });
    if (!message) {
      return res.status(404).json({ success: false, message: 'Message not found.' });
    }

    // Only sender can delete for everyone
    if (deleteFor === 'everyone') {
      if (message.senderId !== req.user.userId) {
        return res.status(403).json({ success: false, message: 'You can only delete your own messages.' });
      }
      message.isDeleted = true;
      message.content = 'This message was deleted.';
      message.fileData = undefined;
      message.giphyData = undefined;
    } else {
      // Delete for me only
      if (!message.deletedBy.includes(req.user.userId)) {
        message.deletedBy.push(req.user.userId);
      }
    }

    await message.save();

    // Notify via socket
    if (deleteFor === 'everyone') {
      req.app.get('io')?.to(message.receiverId).emit('messageDeleted', { messageId });
      req.app.get('io')?.to(message.senderId).emit('messageDeleted', { messageId });
    }

    res.json({ success: true, message: 'Message deleted.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// POST /api/messages/:messageId/react - Add reaction
router.post('/:messageId/react', authenticateToken, async (req, res) => {
  try {
    const { emoji } = req.body;
    const { messageId } = req.params;

    const message = await Message.findOne({ messageId });
    if (!message) return res.status(404).json({ success: false, message: 'Message not found.' });

    const existingIdx = message.reactions.findIndex(r => r.userId === req.user.userId);
    if (existingIdx !== -1) {
      if (message.reactions[existingIdx].emoji === emoji) {
        message.reactions.splice(existingIdx, 1); // Toggle off
      } else {
        message.reactions[existingIdx].emoji = emoji; // Change reaction
      }
    } else {
      message.reactions.push({ userId: req.user.userId, emoji });
    }

    await message.save();

    const conversationId = message.conversationId;
    req.app.get('io')?.to(message.senderId).emit('messageReaction', { messageId, reactions: message.reactions });
    req.app.get('io')?.to(message.receiverId).emit('messageReaction', { messageId, reactions: message.reactions });

    res.json({ success: true, reactions: message.reactions });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// GET /api/messages/unread/count - Get unread messages count per contact
router.get('/unread/count', authenticateToken, async (req, res) => {
  try {
    const unread = await Message.aggregate([
      { $match: { receiverId: req.user.userId, isRead: false, isDeleted: false } },
      { $group: { _id: '$senderId', count: { $sum: 1 } } },
    ]);

    const counts = {};
    unread.forEach(u => { counts[u._id] = u.count; });

    res.json({ success: true, counts });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// GET /api/messages/giphy/search?q=query - Search Giphy
router.get('/giphy/search', authenticateToken, async (req, res) => {
  try {
    const { q, limit = 20, offset = 0 } = req.query;
    const https = require('https');

    const url = `https://api.giphy.com/v1/gifs/search?api_key=${config.GIPHY_API_KEY}&q=${encodeURIComponent(q || 'funny')}&limit=${limit}&offset=${offset}&rating=g&lang=en`;

    https.get(url, (response) => {
      let data = '';
      response.on('data', chunk => { data += chunk; });
      response.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          res.json({ success: true, gifs: parsed.data, pagination: parsed.pagination });
        } catch {
          res.status(500).json({ success: false, message: 'Failed to parse Giphy response.' });
        }
      });
    }).on('error', () => {
      res.status(500).json({ success: false, message: 'Failed to fetch GIFs.' });
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// GET /api/messages/giphy/trending - Trending GIFs
router.get('/giphy/trending', authenticateToken, async (req, res) => {
  try {
    const { limit = 20 } = req.query;
    const https = require('https');

    const url = `https://api.giphy.com/v1/gifs/trending?api_key=${config.GIPHY_API_KEY}&limit=${limit}&rating=g`;

    https.get(url, (response) => {
      let data = '';
      response.on('data', chunk => { data += chunk; });
      response.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          res.json({ success: true, gifs: parsed.data });
        } catch {
          res.status(500).json({ success: false, message: 'Failed to parse Giphy response.' });
        }
      });
    }).on('error', () => {
      res.status(500).json({ success: false, message: 'Failed to fetch trending GIFs.' });
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

module.exports = router;
