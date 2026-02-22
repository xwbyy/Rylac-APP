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
const bcrypt = require('bcryptjs');

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

// ============================================================
// CORS FIX (PRODUCTION SAFE)
// ============================================================

// Pastikan CORS_ORIGINS selalu array
let allowedOrigins = [];

if (Array.isArray(config.CORS_ORIGINS)) {
  allowedOrigins = config.CORS_ORIGINS;
} else if (typeof config.CORS_ORIGINS === 'string') {
  allowedOrigins = config.CORS_ORIGINS.split(',').map(o => o.trim());
}

console.log('🌍 Allowed CORS Origins:', allowedOrigins);

// ============================================================
// SOCKET.IO SETUP
// ============================================================

const io = new Server(server, {
  cors: {
    origin: (origin, callback) => {
      if (
        !origin ||
        config.NODE_ENV !== 'production' ||
        allowedOrigins.includes(origin)
      ) {
        callback(null, true);
      } else {
        console.error('❌ Socket CORS Blocked:', origin);
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
  },
  maxHttpBufferSize: 1e6,
});

app.set('io', io);

// ============================================================
// MIDDLEWARE
// ============================================================

app.set('trust proxy', 1);

app.use(cors({
  origin: (origin, callback) => {
    if (
      !origin ||
      config.NODE_ENV !== 'production' ||
      allowedOrigins.includes(origin)
    ) {
      callback(null, true);
    } else {
      console.error('❌ HTTP CORS Blocked:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
}));

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(cookieParser(config.COOKIE_SECRET));

// ============================================================
// RATE LIMITER
// ============================================================

app.use('/api/', rateLimit({
  windowMs: config.GENERAL_RATE_LIMIT_WINDOW,
  max: config.GENERAL_RATE_LIMIT_MAX,
  message: { success: false, message: 'Too many requests. Please slow down.' },
  skip: (req) => req.path.startsWith('/api/auth/refresh'),
}));

// ============================================================
// STATIC FILES
// ============================================================

app.use(express.static(path.join(__dirname, 'public')));
app.use('/css', express.static(path.join(__dirname, 'public/css')));
app.use('/js', express.static(path.join(__dirname, 'public/js')));

// ============================================================
// API ROUTES
// ============================================================

app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/messages', messagesRoutes);
app.use('/api/admin', adminRoutes);

// ============================================================
// HEALTH CHECK
// ============================================================

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    app: config.APP_NAME,
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
  });
});

// ============================================================
// SEO FILES
// ============================================================

app.get('/sitemap.xml', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'sitemap.xml'));
});

app.get('/robots.txt', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'robots.txt'));
});

// ============================================================
// SPA ROUTES
// ============================================================

const pages = ['login', 'register', 'chat', 'profile', 'admin'];

pages.forEach(page => {
  app.get(`/${page}`, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', `${page}.html`));
  });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ============================================================
// SOCKET.IO LOGIC
// ============================================================

const onlineUsers = new Map();

io.use(async (socket, next) => {
  try {
    const token =
      socket.handshake.auth.token ||
      socket.handshake.headers.cookie
        ?.split(';')
        .find(c => c.trim().startsWith('accessToken='))
        ?.split('=')[1];

    if (!token) return next(new Error('Authentication required'));

    const decoded = jwt.verify(token, config.JWT_ACCESS_SECRET);
    const user = await User.findOne({ userId: decoded.userId })
      .select('-password -refreshTokens');

    if (!user || user.isSuspended)
      return next(new Error('Unauthorized'));

    socket.userId = user.userId;
    socket.user = user;
    next();
  } catch (err) {
    next(new Error('Invalid token'));
  }
});

io.on('connection', async (socket) => {
  const userId = socket.userId;
  console.log(`✅ User connected: ${userId}`);

  socket.join(userId);

  if (!onlineUsers.has(userId)) {
    onlineUsers.set(userId, new Set());
  }

  onlineUsers.get(userId).add(socket.id);

  await User.updateOne(
    { userId },
    { $set: { isOnline: true, lastSeen: new Date() } }
  );

  io.emit('userStatus', { userId, isOnline: true });

  socket.on('typing', ({ receiverId, isTyping }) => {
    socket.to(receiverId).emit('typing', {
      senderId: userId,
      isTyping
    });
  });

  socket.on('markRead', async ({ senderId }) => {
    try {
      const conversationId =
        Message.getConversationId(userId, senderId);

      await Message.updateMany(
        { conversationId, receiverId: userId, isRead: false },
        { $set: { isRead: true } }
      );

      socket.to(senderId).emit('messagesRead', {
        readBy: userId
      });
    } catch (err) {
      console.error('Mark read error:', err);
    }
  });

  socket.on('disconnect', async () => {
    if (onlineUsers.has(userId)) {
      onlineUsers.get(userId).delete(socket.id);

      if (onlineUsers.get(userId).size === 0) {
        onlineUsers.delete(userId);

        await User.updateOne(
          { userId },
          { $set: { isOnline: false, lastSeen: new Date() } }
        );

        io.emit('userStatus', {
          userId,
          isOnline: false,
          lastSeen: new Date()
        });
      }
    }
  });
});

// ============================================================
// DATABASE & SERVER START
// ============================================================

async function initializeApp() {
  try {
    console.log('🔌 Connecting to MongoDB...');

    await mongoose.connect(config.MONGODB_URI, {
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
    });

    console.log('✅ MongoDB connected successfully!');

    const defaults = AppConfig.getDefaults();

    for (const def of defaults) {
      await AppConfig.findOneAndUpdate(
        { key: def.key },
        { $setOnInsert: def },
        { upsert: true }
      );
    }

    console.log('✅ App config initialized');

    const adminExists = await User.findOne({
      userId: config.ADMIN_ID
    });

    if (!adminExists) {
      const salt = await bcrypt.genSalt(12);
      const hashedPwd = await bcrypt.hash(
        config.ADMIN_PASSWORD,
        salt
      );

      await User.create({
        userId: config.ADMIN_ID,
        username: config.ADMIN_USERNAME,
        displayName: 'Rylac Admin',
        password: hashedPwd,
        isAdmin: true,
        status: 'Official Rylac Support',
        avatar:
          'https://ui-avatars.com/api/?name=Rylac+Admin&background=6366f1&color=fff&size=200',
      });

      console.log('✅ Admin user created');
    }

    server.listen(config.PORT, () => {
      console.log(`🚀 Rylac App running on port ${config.PORT}`);
      console.log(`🌍 Environment: ${config.NODE_ENV}`);
    });

  } catch (err) {
    console.error('❌ Startup error:', err);
  }
}

initializeApp();

module.exports = app;