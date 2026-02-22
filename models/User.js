const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
    minlength: 3,
    maxlength: 30,
    index: true,
  },
  displayName: {
    type: String,
    required: true,
    trim: true,
    maxlength: 50,
  },
  password: {
    type: String,
    required: true,
    minlength: 6,
  },
  email: {
    type: String,
    trim: true,
    lowercase: true,
    sparse: true,
    index: true,
  },
  avatar: {
    type: String,
    default: '',
  },
  bio: {
    type: String,
    default: '',
    maxlength: 200,
  },
  status: {
    type: String,
    default: 'Hey there! I am using Rylac.',
    maxlength: 100,
  },
  isOnline: {
    type: Boolean,
    default: false,
  },
  lastSeen: {
    type: Date,
    default: Date.now,
  },
  theme: {
    type: String,
    enum: ['light', 'dark'],
    default: 'light',
  },
  isAdmin: {
    type: Boolean,
    default: false,
  },
  isSuspended: {
    type: Boolean,
    default: false,
  },
  suspendReason: {
    type: String,
    default: '',
  },
  refreshTokens: [{
    token: String,
    createdAt: { type: Date, default: Date.now },
  }],
  contacts: [{
    type: String, // userId references
  }],
  notificationSound: {
    type: Boolean,
    default: true,
  },
  blockedUsers: [{
    type: String, // userId
  }],
  pinnedChats: [{
    type: String, // userId
  }],
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
}, {
  timestamps: true,
});

// Indexes for fast search
userSchema.index({ username: 'text', displayName: 'text' });

// Remove sensitive data when converting to JSON
userSchema.methods.toSafeObject = function () {
  const obj = this.toObject();
  delete obj.password;
  delete obj.refreshTokens;
  delete obj.__v;
  return obj;
};

module.exports = mongoose.model('User', userSchema);
