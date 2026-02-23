// ============================================================
// RYLAC APP - MAIN SERVER (FIXED VERSION)
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
// SOCKET.IO SETUP
// ============================================================
const io = new Server(server, {
  cors: {
    origin: function(origin, callback) {
      // Allow semua origin di development, spesifik di production
      if (config.NODE_ENV !== 'production') {
        return callback(null, true);
      }
      
      // Di production, allow dari domain yang terdaftar
      if (!origin || config.CORS_ORIGINS.includes(origin)) {
        return callback(null, true);
      }
      
      callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    allowedHeaders: ['Cookie', 'Authorization'],
  },
  maxHttpBufferSize: 1e6, // 1MB
  cookie: {
    name: 'io',
    httpOnly: true,
    secure: config.NODE_ENV === 'production',
    sameSite: config.NODE_ENV === 'production' ? 'none' : 'lax',
  },
  transports: ['websocket', 'polling'], // Prioritaskan websocket
});

// Store io instance
app.set('io', io);

// ============================================================
// MIDDLEWARE
// ============================================================

app.set('trust proxy', 1);

// CORS middleware
app.use(cors({
  origin: function(origin, callback) {
    if (!origin || config.NODE_ENV !== 'production') return callback(null, true);
    if (config.CORS_ORIGINS.includes(origin)) return callback(null, true);
    callback(null, false);
  },
  credentials: true,
  optionsSuccessStatus: 200,
}));

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(cookieParser(config.COOKIE_SECRET));

// Request logging middleware
app.use((req, res, next) => {
  console.log(`📨 ${req.method} ${req.url} - Cookies:`, req.cookies ? 'yes' : 'no');
  next();
});

// General rate limiter
app.use('/api/', rateLimit({
  windowMs: config.GENERAL_RATE_LIMIT_WINDOW,
  max: config.GENERAL_RATE_LIMIT_MAX,
  message: { success: false, message: 'Too many requests. Please slow down.' },
  skip: (req) => req.path.startsWith('/api/auth/refresh'),
}));

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

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
    env: config.NODE_ENV,
  });
});

// Sitemap & Robots
app.get('/sitemap.xml', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'sitemap.xml'));
});

app.get('/robots.txt', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'robots.txt'));
});

// Serve HTML pages
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
// SOCKET.IO AUTHENTICATION
// ============================================================

// Online users map
const onlineUsers = new Map();

// Socket.io authentication middleware
io.use(async (socket, next) => {
  try {
    // Coba dapatkan token dari berbagai sumber
    let token = socket.handshake.auth?.token;
    
    // Cek dari cookies
    if (!token && socket.handshake.headers.cookie) {
      const cookies = socket.handshake.headers.cookie.split(';').reduce((acc, cookie) => {
        const [key, value] = cookie.trim().split('=');
        acc[key] = value;
        return acc;
      }, {});
      token = cookies.accessToken;
    }

    if (!token) {
      console.log('❌ Socket auth: No token');
      return next(new Error('Authentication required'));
    }

    // Verify token
    const decoded = jwt.verify(token, config.JWT_ACCESS_SECRET);
    
    const user = await User.findOne({ userId: decoded.userId }).select('-password -refreshTokens');

    if (!user) {
      console.log('❌ Socket auth: User not found');
      return next(new Error('User not found'));
    }

    if (user.isSuspended) {
      console.log('❌ Socket auth: User suspended');
      return next(new Error('Account suspended'));
    }

    // Attach user to socket
    socket.userId = user.userId;
    socket.user = user;
    
    console.log(`✅ Socket authenticated: ${user.userId} (${socket.id})`);
    next();
  } catch (err) {
    console.error('❌ Socket auth error:', err.message);
    next(new Error('Invalid token'));
  }
});

// Socket.io connection handler
io.on('connection', async (socket) => {
  const userId = socket.userId;
  console.log(`🔌 User connected: ${userId} (${socket.id})`);

  // Join personal room
  socket.join(userId);

  // Track online users
  if (!onlineUsers.has(userId)) {
    onlineUsers.set(userId, new Set());
  }
  onlineUsers.get(userId).add(socket.id);

  try {
    // Update user online status
    await User.updateOne({ userId }, { $set: { isOnline: true, lastSeen: new Date() } });
    
    // Broadcast online status
    io.emit('userStatus', { userId, isOnline: true });
    
    console.log(`🟢 ${userId} is now online`);
  } catch (err) {
    console.error('Error updating online status:', err);
  }

  // ============================================================
  // SOCKET EVENT HANDLERS
  // ============================================================

  // Typing indicator
  socket.on('typing', ({ receiverId, isTyping }) => {
    socket.to(receiverId).emit('typing', { senderId: userId, isTyping });
  });

  // Mark messages as read
  socket.on('markRead', async ({ senderId }) => {
    try {
      const conversationId = Message.getConversationId(userId, senderId);
      
      await Message.updateMany(
        { conversationId, receiverId: userId, isRead: false },
        { $set: { isRead: true } }
      );
      
      socket.to(senderId).emit('messagesRead', { readBy: userId });
      console.log(`📖 Messages read: ${senderId} by ${userId}`);
    } catch (err) {
      console.error('Mark read error:', err);
    }
  });

  // Disconnect handler
  socket.on('disconnect', async () => {
    console.log(`🔌 User disconnected: ${userId} (${socket.id})`);

    if (onlineUsers.has(userId)) {
      onlineUsers.get(userId).delete(socket.id);
      
      if (onlineUsers.get(userId).size === 0) {
        onlineUsers.delete(userId);
        
        try {
          // Update offline status
          await User.updateOne({ userId }, { $set: { isOnline: false, lastSeen: new Date() } });
          
          // Broadcast offline status
          io.emit('userStatus', { userId, isOnline: false, lastSeen: new Date() });
          
          console.log(`🔴 ${userId} is now offline`);
        } catch (err) {
          console.error('Error updating offline status:', err);
        }
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

    server.listen(config.PORT, '0.0.0.0', () => {
      console.log(`\n🚀 Rylac App running on port ${config.PORT}`);
      console.log(`📊 Admin panel: http://localhost:${config.PORT}/admin`);
      console.log(`🌍 Environment: ${config.NODE_ENV}`);
      console.log(`🍪 Cookie settings: secure=${config.NODE_ENV === 'production'}, sameSite=${config.NODE_ENV === 'production' ? 'None' : 'Lax'}\n`);
    });
  } catch (err) {
    console.error('❌ Startup error:', err);
    process.exit(1);
  }
}

initializeApp();

module.exports = app;
