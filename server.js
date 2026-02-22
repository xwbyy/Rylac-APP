// ============================================================
// RYLAC APP - MAIN SERVER
// Express + Socket.io + MongoDB
// ============================================================

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');

const config = require('./config');
const User = require('./models/User');
const Message = require('./models/Message');
const AppConfig = require('./models/AppConfig');

const authRoutes = require('./routes/auth');
const usersRoutes = require('./routes/users');
const messagesRoutes = require('./routes/messages');
const adminRoutes = require('./routes/admin');

const app = express();
const server = http.createServer(app);

// Socket.io setup
const io = new Server(server, {
  cors: {
    origin: true,
    credentials: true,
  },
  maxHttpBufferSize: 1e6,
});

// Store io instance for use in routes
app.set('io', io);

// ============================================================
// MIDDLEWARE
// ============================================================

app.set('trust proxy', 1);

app.use(cors({
  origin: true,
  credentials: true,
}));

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(cookieParser(config.COOKIE_SECRET));

// General rate limiter
app.use('/api/', rateLimit({
  windowMs: config.GENERAL_RATE_LIMIT_WINDOW,
  max: config.GENERAL_RATE_LIMIT_MAX,
  message: { success: false, message: 'Too many requests. Please slow down.' },
  skip: (req) => req.path.startsWith('/api/auth/refresh'),
}));

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Fallback for CSS/JS if not found in public
app.use('/css', express.static(path.join(__dirname, 'public/css')));
app.use('/js', express.static(path.join(__dirname, 'public/js')));

// Set up for Replit
app.set('trust proxy', 1);

// ============================================================
// API ROUTES
// ============================================================

app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/messages', messagesRoutes);
app.use('/api/admin', adminRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    app: config.APP_NAME,
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
  });
});

// Sitemap
app.get('/sitemap.xml', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'sitemap.xml'));
});

// Robots
app.get('/robots.txt', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'robots.txt'));
});

// Serve SPA pages
const pages = ['login', 'register', 'chat', 'profile', 'admin'];
pages.forEach(page => {
  app.get(`/${page}`, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', `${page}.html`));
  });
});

// Catch-all -> index
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ============================================================
// SOCKET.IO - REAL-TIME COMMUNICATION
// ============================================================

// Online users map: userId -> Set of socketIds
const onlineUsers = new Map();

// Authenticate socket connections
io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth.token || socket.handshake.headers.cookie
      ?.split(';').find(c => c.trim().startsWith('accessToken='))
      ?.split('=')[1];

    if (!token) return next(new Error('Authentication required'));

    const decoded = jwt.verify(token, config.JWT_ACCESS_SECRET);
    const user = await User.findOne({ userId: decoded.userId }).select('-password -refreshTokens');

    if (!user || user.isSuspended) return next(new Error('Unauthorized'));

    socket.userId = user.userId;
    socket.user = user;
    next();
  } catch (err) {
    next(new Error('Invalid token'));
  }
});

io.on('connection', async (socket) => {
  const userId = socket.userId;
  console.log(`✅ User connected: ${userId} (${socket.id})`);

  // Join personal room for direct messages
  socket.join(userId);

  // Track online users
  if (!onlineUsers.has(userId)) {
    onlineUsers.set(userId, new Set());
  }
  onlineUsers.get(userId).add(socket.id);

  // Update user online status
  await User.updateOne({ userId }, { $set: { isOnline: true, lastSeen: new Date() } });
  io.emit('userStatus', { userId, isOnline: true });

  // Handle typing indicator
  socket.on('typing', ({ receiverId, isTyping }) => {
    socket.to(receiverId).emit('typing', { senderId: userId, isTyping });
  });

  // Handle message read receipt
  socket.on('markRead', async ({ senderId }) => {
    try {
      const conversationId = Message.getConversationId(userId, senderId);
      await Message.updateMany(
        { conversationId, receiverId: userId, isRead: false },
        { $set: { isRead: true } }
      );
      socket.to(senderId).emit('messagesRead', { readBy: userId });
    } catch (err) {
      console.error('Mark read error:', err);
    }
  });

  // Handle disconnect
  socket.on('disconnect', async () => {
    console.log(`❌ User disconnected: ${userId} (${socket.id})`);

    if (onlineUsers.has(userId)) {
      onlineUsers.get(userId).delete(socket.id);
      if (onlineUsers.get(userId).size === 0) {
        onlineUsers.delete(userId);
        // Update offline status
        await User.updateOne({ userId }, { $set: { isOnline: false, lastSeen: new Date() } });
        io.emit('userStatus', { userId, isOnline: false, lastSeen: new Date() });
      }
    }
  });
});

// ============================================================
// DATABASE CONNECTION & SERVER START
// ============================================================

async function initializeApp() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(config.MONGODB_URI, {
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
    });
    console.log('✅ MongoDB connected successfully!');

    // Initialize default configs
    const defaults = AppConfig.getDefaults();
    for (const def of defaults) {
      await AppConfig.findOneAndUpdate(
        { key: def.key },
        { $setOnInsert: def },
        { upsert: true }
      );
    }
    console.log('✅ App config initialized');

    // Create admin user if not exists
    const adminExists = await User.findOne({ userId: config.ADMIN_ID });
    if (!adminExists) {
      const salt = await bcrypt.genSalt(12);
      const hashedPwd = await bcrypt.hash(config.ADMIN_PASSWORD, salt);
      await User.create({
        userId: config.ADMIN_ID,
        username: config.ADMIN_USERNAME,
        displayName: 'Rylac Admin',
        password: hashedPwd,
        isAdmin: true,
        status: 'Official Rylac Support',
        avatar: 'https://ui-avatars.com/api/?name=Rylac+Admin&background=6366f1&color=fff&size=200',
      });
      console.log('✅ Admin user created (ID: 268268)');
    }

    server.listen(config.PORT, config.HOST, () => {
      console.log(`🚀 Rylac App running on http://localhost:${config.PORT}`);
      console.log(`📊 Admin panel: http://localhost:${config.PORT}/admin`);
      console.log(`🌍 Environment: ${config.NODE_ENV}`);
    });
  } catch (err) {
    console.error('❌ Startup error:', err);
  }
}

// Need bcrypt for admin user creation
const bcrypt = require('bcryptjs');

initializeApp();

module.exports = app;
