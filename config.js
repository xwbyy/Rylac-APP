// ============================================================
// RYLAC APP - CONFIGURATION FILE
// All configuration values are defined here (no .env needed)
// ============================================================

const config = {
  // Server
  PORT: process.env.PORT || 5000,
  NODE_ENV: process.env.NODE_ENV || 'development',

  // MongoDB
  MONGODB_URI: process.env.MONGODB_URI || 'mongodb+srv://Vercel-Admin-rylac:0jKpyRiBlKdYfVed@rylac.iiqlafl.mongodb.net/rylac?retryWrites=true&w=majority',

  // JWT Secrets
  JWT_ACCESS_SECRET: 'rylac_access_secret_key_2024_xK9mP3qL8nR5vT2w',
  JWT_REFRESH_SECRET: 'rylac_refresh_secret_key_2024_yH7jN4sM6uQ1xZ9c',
  JWT_ACCESS_EXPIRES: '15m',
  JWT_REFRESH_EXPIRES: '7d',

  // Cookie
  COOKIE_SECRET: 'rylac_cookie_secret_2024_aB3dE6fG9hI2jK5l',

  // Admin credentials
  ADMIN_USERNAME: 'admin',
  ADMIN_PASSWORD: 'admin123',
  ADMIN_ID: '268268',

  // Giphy API
  GIPHY_API_KEY: 'GlVGYHkr3WSBnllca54iNt0yFbjz7L65',
  GIPHY_BASE_URL: 'https://api.giphy.com/v1',

  // File Upload
  MAX_FILE_SIZE: 1 * 1024 * 1024, // 1MB

  // Rate Limiting
  LOGIN_RATE_LIMIT_WINDOW: 15 * 60 * 1000, // 15 minutes
  LOGIN_RATE_LIMIT_MAX: 5,
  GENERAL_RATE_LIMIT_WINDOW: 15 * 60 * 1000,
  GENERAL_RATE_LIMIT_MAX: 100,

  // App Info
  APP_NAME: 'Rylac App',
  APP_URL: 'https://rylac-app.vercel.app',
  APP_DESCRIPTION: 'Rylac - Modern Real-time Chat Application. Connect, share, and communicate seamlessly.',
  SUPPORT_ADMIN_ID: '268268',

  // CORS
  CORS_ORIGINS: ['https://rylac-app.vercel.app', 'http://localhost:3000'],
};

module.exports = config;
