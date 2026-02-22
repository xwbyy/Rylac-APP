# Rylac App

## Overview

Rylac is a production-ready, WhatsApp-like real-time chat application. It provides one-on-one messaging with support for text, images, audio, video, files, and GIFs. The app includes user authentication, profile management, message reactions, reply threads, read receipts, typing indicators, online/offline status, dark/light theming, and a full admin panel. It's built as a monolithic Node.js application serving both the API and static frontend files.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Backend (Node.js + Express)

- **Entry point:** `server.js` — sets up Express, HTTP server, Socket.io, MongoDB connection, middleware, and routes.
- **Configuration:** `config.js` — all config values (ports, secrets, API keys, limits) are defined in a single file. Environment variables are used as overrides where available, but defaults are hardcoded so no `.env` file is strictly required.
- **Database:** MongoDB via Mongoose (`mongoose` package). The connection string points to a MongoDB Atlas cluster. All data (users, messages, app config) is stored in MongoDB.
- **Authentication:** JWT-based with access tokens (15min) and refresh tokens (7 days). Tokens are stored in httpOnly cookies for XSS protection. Passwords are hashed with bcryptjs (salt rounds: 12). Rate limiting is applied to login endpoints (5 attempts per 15 min per IP+username).
- **Middleware:** `middleware/auth.js` provides `authenticateToken` (checks access token from cookies or Authorization header) and `requireAdmin` (checks admin token from cookies).
- **Real-time:** Socket.io handles real-time messaging, typing indicators, online/offline status, read receipts, and message reactions. The Socket.io instance is attached to the Express app via `app.set('io', io)` so routes can emit events.
- **File uploads:** Multer with memory storage. Files are base64-encoded and stored directly in MongoDB (max 1MB). Allowed types include common image, audio, video, PDF, and text formats.

### API Routes

All routes are prefixed with `/api/`:

| Route File | Path Prefix | Purpose |
|---|---|---|
| `routes/auth.js` | `/api/auth` | Register, login, logout, token refresh, admin login |
| `routes/users.js` | `/api/users` | User search, profile viewing, profile editing, password change |
| `routes/messages.js` | `/api/messages` | Get conversation messages, send messages, reactions, delete, read receipts |
| `routes/admin.js` | `/api/admin` | Admin dashboard stats, user CRUD, app config management (all routes require admin auth) |

### Data Models (Mongoose)

- **`models/User.js`** — User schema with fields: userId (unique numeric string), username, displayName, password, email, avatar, bio, status, theme preference, notification settings, online status, lastSeen, suspension fields, refresh tokens array. Indexed on userId, username, email.
- **`models/Message.js`** — Message schema with fields: messageId (UUID), conversationId (deterministic from two user IDs), senderId, receiverId, type (text/image/audio/video/file/gif/sticker), content, fileData (with base64 storage), giphyData, reactions, reply references, read status, deletion tracking. Indexed on messageId, conversationId, senderId, receiverId.
- **`models/AppConfig.js`** — Key-value configuration store for runtime settings (maintenance mode, registration toggle, max message length, feature flags). Includes static method for default values.

### Frontend (Vanilla JavaScript + CSS)

- **No framework** — the frontend uses plain HTML, CSS, and vanilla JavaScript.
- **Static files served from `public/` directory** by Express.
- **Pages:**
  - `index.html` — Landing page with SEO meta tags, Open Graph, Twitter Cards, and JSON-LD structured data
  - `login.html` / `register.html` — Auth pages styled with `css/auth.css`
  - `chat.html` — Main chat interface styled with `css/chat.css`, powered by `js/chat.js`
  - `profile.html` — User profile page with inline styles
  - `admin.html` — Admin panel styled with `css/admin.css`
- **Theming:** Dark/light theme support via CSS custom properties and `[data-theme="dark"]` selector. Theme preference is saved per user in MongoDB.
- **Fonts:** Google Fonts (Inter) loaded via CDN.
- **Sound:** Web Audio API for notification sounds (oscillator-based, no audio files).
- **Socket.io client** connects from `chat.js` for real-time features.

### Deployment

- **Target platform:** Vercel (configured via `vercel.json`). All routes are directed to `server.js` using `@vercel/node` builder.
- **Note:** Socket.io on Vercel has limitations (serverless functions don't support persistent WebSocket connections well). For full real-time functionality, a persistent server (like Replit) is more suitable.

### Security Considerations

- JWT secrets, MongoDB URI, admin credentials, and API keys are hardcoded in `config.js`. In production, these should be moved to environment variables.
- The `config.js` file contains a real MongoDB Atlas connection string and Giphy API key — treat these as sensitive.
- Admin credentials default to `admin` / `admin123` — should be changed for any real deployment.

## External Dependencies

### NPM Packages

| Package | Purpose |
|---|---|
| `express` | Web server framework |
| `socket.io` | Real-time WebSocket communication |
| `mongoose` | MongoDB ODM |
| `jsonwebtoken` | JWT token generation and verification |
| `bcryptjs` | Password hashing |
| `cookie-parser` | Parse cookies from requests |
| `cors` | Cross-origin resource sharing |
| `express-rate-limit` | Rate limiting for login and general API endpoints |
| `multer` | File upload handling (memory storage) |
| `uuid` | Generate unique message IDs |
| `nodemon` (dev) | Auto-restart server during development |

### External Services

- **MongoDB Atlas** — Primary database. Connection string is in `config.js`. Uses the `rylac` database.
- **Giphy API** — GIF search functionality. API key is in `config.js`. Base URL: `https://api.giphy.com/v1`.
- **Google Fonts CDN** — Inter font family loaded in all HTML pages.

### Runtime Requirements

- Node.js >= 18.0.0
- MongoDB instance (Atlas or local)
- Default port: 5000 (configurable via `PORT` env var)