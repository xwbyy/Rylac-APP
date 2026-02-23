const config = {
  PORT: parseInt(process.env.PORT || '5000', 10),
  // UBAH KE DEVELOPMENT: Agar cookie bisa disimpan di HTTP localhost/Replit
  NODE_ENV: process.env.NODE_ENV || 'development',

  MONGODB_URI: process.env.MONGODB_URI || "mongodb+srv://Vercel-Admin-rylackuh:soXGqsV2iN0mIyT0@rylackuh.n9pmimy.mongodb.net/?appName=rylackuh",

  JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET || 'rylac_access_secret_key_2024_xK9mP3qL8nR5vT2w',
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET || 'rylac_refresh_secret_key_2024_yH7jN4sM6uQ1xZ9c',
  JWT_ACCESS_EXPIRES: '15m',
  JWT_REFRESH_EXPIRES: '7d',

  COOKIE_SECRET: process.env.COOKIE_SECRET || 'rylac_cookie_secret_2024_aB3dE6fG9hI2jK5l',

  ADMIN_USERNAME: process.env.ADMIN_USERNAME || 'admin',
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || 'admin123',
  ADMIN_ID: process.env.ADMIN_ID || '268268',

  GIPHY_API_KEY: process.env.GIPHY_API_KEY || 'GlVGYHkr3WSBnllca54iNt0yFbjz7L65',
  GIPHY_BASE_URL: 'https://api.giphy.com/v1',

  MAX_FILE_SIZE: 1 * 1024 * 1024,

  LOGIN_RATE_LIMIT_WINDOW: 15 * 60 * 1000,
  LOGIN_RATE_LIMIT_MAX: 5,
  GENERAL_RATE_LIMIT_WINDOW: 15 * 60 * 1000,
  GENERAL_RATE_LIMIT_MAX: 100,

  APP_NAME: 'Rylac App',
  APP_URL: process.env.APP_URL || 'https://rylac.my.id',
  APP_DESCRIPTION: 'Rylac - Modern Real-time Chat Application.',
  SUPPORT_ADMIN_ID: '268268',

  CORS_ORIGINS: [
    'https://rylac.my.id',
    'https://www.rylac.my.id',
    'https://rylac-app.vercel.app',
    'http://localhost:3000',
    'http://localhost:5000',
    'http://0.0.0.0:5000',
  ],
};

module.exports = config;
