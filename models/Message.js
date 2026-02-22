const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  messageId: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  conversationId: {
    type: String,
    required: true,
    index: true,
  },
  senderId: {
    type: String,
    required: true,
    index: true,
  },
  receiverId: {
    type: String,
    required: true,
    index: true,
  },
  type: {
    type: String,
    enum: ['text', 'image', 'audio', 'video', 'file', 'gif', 'sticker'],
    default: 'text',
  },
  content: {
    type: String,
    default: '',
  },
  fileData: {
    url: String,
    name: String,
    size: Number,
    mimeType: String,
    // For base64 stored files
    base64: String,
  },
  giphyData: {
    id: String,
    url: String,
    title: String,
    preview: String,
    width: Number,
    height: Number,
  },
  isRead: {
    type: Boolean,
    default: false,
  },
  isDeleted: {
    type: Boolean,
    default: false,
  },
  deletedBy: [{
    type: String, // userId
  }],
  editedAt: {
    type: Date,
  },
  replyTo: {
    messageId: String,
    content: String,
    senderId: String,
  },
  reactions: [{
    userId: String,
    emoji: String,
  }],
  createdAt: {
    type: Date,
    default: Date.now,
    index: true,
  },
}, {
  timestamps: true,
});

// Compound indexes for fast message retrieval
messageSchema.index({ conversationId: 1, createdAt: -1 });
messageSchema.index({ senderId: 1, receiverId: 1, createdAt: -1 });

// Generate conversation ID (sorted userId pair for consistency)
messageSchema.statics.getConversationId = function (userId1, userId2) {
  return [userId1, userId2].sort().join('_');
};

module.exports = mongoose.model('Message', messageSchema);
