const jwt = require('jsonwebtoken');
const config = require('../config');
const User = require('../models/User');

const authenticateToken = async (req, res, next) => {
  try {
    // Cek token dari cookie dulu, lalu Authorization header
    let token = req.cookies?.accessToken;
    
    if (!token && req.headers['authorization']) {
      const authHeader = req.headers['authorization'];
      if (authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7);
      } else {
        token = authHeader;
      }
    }

    if (!token) {
      return res.status(401).json({ success: false, message: 'Authentication required. No token provided.' });
    }

    // Verify token
    let decoded;
    try {
      decoded = jwt.verify(token, config.JWT_ACCESS_SECRET);
    } catch (jwtError) {
      console.error('JWT Verify Error:', jwtError.message);
      return res.status(401).json({ success: false, message: 'Invalid or expired token.' });
    }

    // Cari user
    const user = await User.findOne({ userId: decoded.userId }).select('-password -refreshTokens');

    if (!user) {
      return res.status(401).json({ success: false, message: 'User not found.' });
    }

    if (user.isSuspended) {
      return res.status(403).json({ success: false, message: 'Account suspended.' });
    }

    // Attach user ke request
    req.user = user;
    next();
  } catch (err) {
    console.error('Auth middleware error:', err);
    return res.status(500).json({ success: false, message: 'Server error during authentication.' });
  }
};

const requireAdmin = (req, res, next) => {
  const adminToken = req.cookies?.adminToken;
  
  if (!adminToken) {
    return res.status(403).json({ success: false, message: 'Admin access required. No admin token.' });
  }

  try {
    const decoded = jwt.verify(adminToken, config.JWT_ACCESS_SECRET);
    
    if (decoded && decoded.isAdmin) {
      req.admin = decoded;
      next();
    } else {
      res.status(403).json({ success: false, message: 'Admin access required. Not an admin.' });
    }
  } catch (err) {
    console.error('Admin auth error:', err);
    res.status(403).json({ success: false, message: 'Invalid admin token.' });
  }
};

// Optional auth - untuk route yang bisa diakses dengan atau tanpa token
const optionalAuth = async (req, res, next) => {
  try {
    const token = req.cookies?.accessToken || req.headers['authorization']?.split(' ')[1];
    
    if (token) {
      try {
        const decoded = jwt.verify(token, config.JWT_ACCESS_SECRET);
        const user = await User.findOne({ userId: decoded.userId }).select('-password -refreshTokens');
        if (user && !user.isSuspended) {
          req.user = user;
        }
      } catch (e) {
        // Token invalid, tetap lanjut tanpa user
      }
    }
    next();
  } catch (err) {
    next();
  }
};

module.exports = { authenticateToken, requireAdmin, optionalAuth };
