const jwt = require('jsonwebtoken');
const config = require('../config');
const User = require('../models/User');

// Verify JWT access token from cookie or Authorization header
const authenticateToken = async (req, res, next) => {
  try {
    let token = req.cookies?.accessToken;

    // Fallback: check Authorization header
    if (!token && req.headers.authorization) {
      const parts = req.headers.authorization.split(' ');
      if (parts.length === 2 && parts[0] === 'Bearer') {
        token = parts[1];
      }
    }

    if (!token) {
      return res.status(401).json({ success: false, message: 'Access denied. No token provided.' });
    }

    const decoded = jwt.verify(token, config.JWT_ACCESS_SECRET);
    const user = await User.findOne({ userId: decoded.userId }).select('-password -refreshTokens');

    if (!user) {
      return res.status(401).json({ success: false, message: 'User not found.' });
    }

    if (user.isSuspended) {
      return res.status(403).json({ 
        success: false, 
        message: `Account suspended${user.suspendReason ? ': ' + user.suspendReason : '.'}` 
      });
    }

    req.user = user;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: 'Token expired.', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ success: false, message: 'Invalid token.' });
  }
};

// Admin-only middleware
const requireAdmin = async (req, res, next) => {
  try {
    let token = req.cookies?.adminToken;

    if (!token) {
      return res.status(401).json({ success: false, message: 'Admin access required.' });
    }

    const decoded = jwt.verify(token, config.JWT_ACCESS_SECRET);

    if (!decoded.isAdmin) {
      return res.status(403).json({ success: false, message: 'Admin privileges required.' });
    }

    req.admin = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid admin token.' });
  }
};

// Optional auth - doesn't fail if no token
const optionalAuth = async (req, res, next) => {
  try {
    const token = req.cookies?.accessToken;
    if (token) {
      const decoded = jwt.verify(token, config.JWT_ACCESS_SECRET);
      const user = await User.findOne({ userId: decoded.userId }).select('-password -refreshTokens');
      if (user && !user.isSuspended) {
        req.user = user;
      }
    }
  } catch (err) {
    // Ignore errors for optional auth
  }
  next();
};

module.exports = { authenticateToken, requireAdmin, optionalAuth };
