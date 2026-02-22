const jwt = require('jsonwebtoken');
const config = require('../config');
const User = require('../models/User');

const authenticateToken = async (req, res, next) => {
  try {
    const token = req.cookies?.accessToken || req.headers['authorization']?.split(' ')[1];

    if (!token) {
      return res.status(401).json({ success: false, message: 'Authentication required.' });
    }

    const decoded = jwt.verify(token, config.JWT_ACCESS_SECRET);
    const user = await User.findOne({ userId: decoded.userId }).select('-password -refreshTokens');

    if (!user) {
      return res.status(401).json({ success: false, message: 'User not found.' });
    }

    if (user.isSuspended) {
      return res.status(403).json({ success: false, message: 'Account suspended.' });
    }

    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid or expired token.' });
  }
};

const requireAdmin = (req, res, next) => {
  const adminToken = req.cookies?.adminToken;
  if (!adminToken) {
    return res.status(403).json({ success: false, message: 'Admin access required.' });
  }

  try {
    const decoded = jwt.verify(adminToken, config.JWT_ACCESS_SECRET);
    if (decoded.isAdmin) {
      req.admin = decoded;
      next();
    } else {
      res.status(403).json({ success: false, message: 'Admin access required.' });
    }
  } catch (err) {
    res.status(403).json({ success: false, message: 'Invalid admin token.' });
  }
};

module.exports = { authenticateToken, requireAdmin };
