const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const config = require('../config');
const User = require('../models/User');
const { authenticateToken } = require('../middleware/auth');

// Rate limiter for login/register
const loginLimiter = rateLimit({
  windowMs: config.LOGIN_RATE_LIMIT_WINDOW,
  max: config.LOGIN_RATE_LIMIT_MAX,
  message: { success: false, message: 'Too many login attempts. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip + ':' + (req.body?.username || ''),
});

// Generate unique numeric user ID (8-12 digits)
async function generateUniqueUserId() {
  let userId;
  let exists = true;
  while (exists) {
    const min = 100000;
    const max = 999999999;
    userId = String(Math.floor(Math.random() * (max - min + 1)) + min);
    exists = await User.findOne({ userId });
  }
  return userId;
}

// Generate tokens
function generateTokens(user) {
  const accessToken = jwt.sign(
    { userId: user.userId, username: user.username, isAdmin: user.isAdmin },
    config.JWT_ACCESS_SECRET,
    { expiresIn: config.JWT_ACCESS_EXPIRES }
  );
  const refreshToken = jwt.sign(
    { userId: user.userId },
    config.JWT_REFRESH_SECRET,
    { expiresIn: config.JWT_REFRESH_EXPIRES }
  );
  return { accessToken, refreshToken };
}

// Set auth cookies
function setAuthCookies(res, accessToken, refreshToken) {
  const isProduction = config.NODE_ENV === 'production';
  const cookieOptions = {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'None' : 'Lax',
    path: '/',
  };

  res.cookie('accessToken', accessToken, {
    ...cookieOptions,
    maxAge: 15 * 60 * 1000, // 15 minutes
  });

  res.cookie('refreshToken', refreshToken, {
    ...cookieOptions,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    path: '/api/auth/refresh',
  });
}

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { username, displayName, password, email } = req.body;

    // Validation
    if (!username || !password || !displayName) {
      return res.status(400).json({ success: false, message: 'Username, display name, and password are required.' });
    }

    if (username.length < 3 || username.length > 30) {
      return res.status(400).json({ success: false, message: 'Username must be between 3 and 30 characters.' });
    }

    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      return res.status(400).json({ success: false, message: 'Username can only contain letters, numbers, and underscores.' });
    }

    if (password.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters.' });
    }

    if (displayName.length < 1 || displayName.length > 50) {
      return res.status(400).json({ success: false, message: 'Display name must be between 1 and 50 characters.' });
    }

    // Check if registration is allowed
    const AppConfig = require('../models/AppConfig');
    const allowReg = await AppConfig.findOne({ key: 'allow_registration' });
    if (allowReg && allowReg.value === false) {
      return res.status(403).json({ success: false, message: 'Registration is currently disabled.' });
    }

    // Check username uniqueness
    const existingUser = await User.findOne({ username: username.toLowerCase() });
    if (existingUser) {
      return res.status(409).json({ success: false, message: 'Username already taken.' });
    }

    // Check email uniqueness
    if (email) {
      const existingEmail = await User.findOne({ email: email.toLowerCase() });
      if (existingEmail) {
        return res.status(409).json({ success: false, message: 'Email already registered.' });
      }
    }

    // Hash password
    const salt = await bcrypt.genSalt(12);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Generate unique ID
    const userId = await generateUniqueUserId();

    // Create user
    const user = new User({
      userId,
      username: username.toLowerCase(),
      displayName,
      password: hashedPassword,
      email: email ? email.toLowerCase() : undefined,
    });

    await user.save();

    // Generate tokens
    const { accessToken, refreshToken } = generateTokens(user);

    // Save refresh token to DB
    user.refreshTokens.push({ token: refreshToken });
    await user.save();

    // Set cookies
    setAuthCookies(res, accessToken, refreshToken);

    res.status(201).json({
      success: true,
      message: 'Account created successfully!',
      user: user.toSafeObject(),
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ success: false, message: 'Server error. Please try again.' });
  }
});

// POST /api/auth/login
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'Username and password are required.' });
    }

    // Find user
    const user = await User.findOne({ username: username.toLowerCase() });
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid username or password.' });
    }

    if (user.isSuspended) {
      return res.status(403).json({ 
        success: false, 
        message: `Account suspended${user.suspendReason ? ': ' + user.suspendReason : '.'}` 
      });
    }

    // Verify password
    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      return res.status(401).json({ success: false, message: 'Invalid username or password.' });
    }

    // Generate tokens
    const { accessToken, refreshToken } = generateTokens(user);

    // Clean old refresh tokens (keep last 5)
    user.refreshTokens = user.refreshTokens.slice(-4);
    user.refreshTokens.push({ token: refreshToken });
    await user.save();

    // Set cookies
    setAuthCookies(res, accessToken, refreshToken);

    res.json({
      success: true,
      message: 'Login successful!',
      user: user.toSafeObject(),
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, message: 'Server error. Please try again.' });
  }
});

// POST /api/auth/refresh - Refresh access token
router.post('/refresh', async (req, res) => {
  try {
    const refreshToken = req.cookies?.refreshToken;

    if (!refreshToken) {
      return res.status(401).json({ success: false, message: 'No refresh token.' });
    }

    const decoded = jwt.verify(refreshToken, config.JWT_REFRESH_SECRET);
    const user = await User.findOne({ userId: decoded.userId });

    if (!user) {
      return res.status(401).json({ success: false, message: 'User not found.' });
    }

    // Check if refresh token exists in DB
    const tokenExists = user.refreshTokens.some(t => t.token === refreshToken);
    if (!tokenExists) {
      return res.status(401).json({ success: false, message: 'Invalid refresh token.' });
    }

    if (user.isSuspended) {
      return res.status(403).json({ success: false, message: 'Account suspended.' });
    }

    // Generate new access token
    const newAccessToken = jwt.sign(
      { userId: user.userId, username: user.username, isAdmin: user.isAdmin },
      config.JWT_ACCESS_SECRET,
      { expiresIn: config.JWT_ACCESS_EXPIRES }
    );

    const isProduction = config.NODE_ENV === 'production';
    res.cookie('accessToken', newAccessToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'None' : 'Lax',
      path: '/',
      maxAge: 15 * 60 * 1000,
    });

    res.json({ success: true, message: 'Token refreshed.' });
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid or expired refresh token.' });
  }
});

// POST /api/auth/logout
router.post('/logout', authenticateToken, async (req, res) => {
  try {
    const refreshToken = req.cookies?.refreshToken;
    
    if (refreshToken) {
      await User.updateOne(
        { userId: req.user.userId },
        { $pull: { refreshTokens: { token: refreshToken } } }
      );
    }

    res.clearCookie('accessToken');
    res.clearCookie('refreshToken', { path: '/api/auth/refresh' });

    res.json({ success: true, message: 'Logged out successfully.' });
  } catch (err) {
    console.error('Logout error:', err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// GET /api/auth/me - Get current user
router.get('/me', authenticateToken, (req, res) => {
  res.json({ success: true, user: req.user.toSafeObject() });
});

// POST /api/auth/check-username - Check username availability
router.post('/check-username', async (req, res) => {
  try {
    const { username } = req.body;
    if (!username || username.length < 3) {
      return res.json({ available: false, message: 'Username too short.' });
    }
    const exists = await User.findOne({ username: username.toLowerCase() });
    res.json({ available: !exists, message: exists ? 'Username taken.' : 'Username available.' });
  } catch (err) {
    res.status(500).json({ available: false, message: 'Server error.' });
  }
});

// POST /api/auth/admin-login
router.post('/admin-login', loginLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;

    if (username !== config.ADMIN_USERNAME || password !== config.ADMIN_PASSWORD) {
      return res.status(401).json({ success: false, message: 'Invalid admin credentials.' });
    }

    const adminToken = jwt.sign(
      { userId: 'admin', username: 'admin', isAdmin: true },
      config.JWT_ACCESS_SECRET,
      { expiresIn: '8h' }
    );

    const isProduction = config.NODE_ENV === 'production';
    res.cookie('adminToken', adminToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'None' : 'Lax',
      path: '/',
      maxAge: 8 * 60 * 60 * 1000,
    });

    res.json({ success: true, message: 'Admin login successful.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// POST /api/auth/admin-logout
router.post('/admin-logout', (req, res) => {
  res.clearCookie('adminToken');
  res.json({ success: true, message: 'Admin logged out.' });
});

module.exports = router;
