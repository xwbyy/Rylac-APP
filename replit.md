# Rylac App

## Overview

Rylac is a production-ready, WhatsApp-like real-time chat application. It provides one-on-one messaging with support for text, images, audio, video, files, and GIFs. The app includes user authentication, profile management, an admin panel, and real-time features like typing indicators, read receipts, and online/offline status. The frontend is built with vanilla HTML/CSS/JavaScript (no framework), and the backend is a Node.js/Express server with MongoDB for persistence and Socket.io for real-time communication.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Backend Architecture

- **Runtime**: Node.js (>=18.0.0) with Express.js
- **Entry point**: `server.js` — sets up Express, creates an HTTP server, attaches Socket.io, connects to MongoDB, and serves static files from `public/`
- **Configuration**: `config.js` — all config values (ports, secrets, API keys, rate limits) are centralized here. Environment variables are used as overrides where available, but the file includes hardcoded defaults so no `.env` is strictly required.
- **Real-time**: Socket.io handles WebSocket connections for live messaging, typing indicators, online/offline presence, and read receipts. The `io` instance is attached to the Express app via `app.set('io', io)` so routes can emit events.
- **Deployment target**: Vercel (via `vercel.json` which routes all traffic to `server.js` using `@vercel/node`). Note: Socket.io on Vercel has limitations since Vercel uses serverless functions; for full WebSocket support, a persistent server host (like Replit) is better.

### API Routes (all under `/api/`)

| Route File | Prefix | Purpose |
|---|---|---|
| `routes/auth.js` | `/api/auth` | Register, login, logout, token refresh, admin login |
| `routes/users.js` | `/api/users` | User search, profile retrieval, profile updates, password changes |
| `routes/messages.js` | `/api/messages` | Fetch conversation messages, send messages (text + file uploads), reactions, replies, deletions |
| `routes/admin.js` | `/api/admin` | Dashboard stats, user CRUD, app config management (all routes require admin auth) |

### Authentication & Authorization

- **JWT-based auth** with access tokens (15min TTL) and refresh tokens (7-day TTL)
- Tokens are stored in **httpOnly cookies** (XSS-safe); fallback to `Authorization: Bearer` header
- **Admin auth** uses a separate `adminToken` cookie verified by the `requireAdmin` middleware
- Middleware lives in `middleware/auth.js` — `authenticateToken` for regular users, `requireAdmin` for admin routes
- Passwords hashed with **bcryptjs** (salt rounds: 12)
- **Rate limiting** on login: 5 attempts per 15 minutes per IP+username combo (via `express-rate-limit`)

### Database (MongoDB via Mongoose)

- **Connection**: MongoDB Atlas (connection string in `config.js`, overridable via `MONGODB_URI` env var)
- **Models** in `models/` directory:
  - `User.js` — userId (unique numeric string), username (unique, lowercase), displayName, password, avatar, bio, status, theme preference, notification settings, online/offline state, refresh tokens array, suspension flags. Indexed on `userId`, `username`, `email`.
  - `Message.js` — messageId (UUID), conversationId (derived from sorted user IDs), senderId, receiverId, type (text/image/audio/video/file/gif/sticker), content, fileData (with base64 storage), giphyData, reactions, reply references, read status, deletion tracking. Indexed on `messageId`, `conversationId`, `senderId`, `receiverId`.
  - `AppConfig.js` — key-value store for runtime app configuration (maintenance mode, registration toggle, max message length, feature flags). Has a static `getDefaults()` method for seeding.

### Frontend Architecture

- **Vanilla HTML/CSS/JavaScript** — no build step, no framework
- Static files served from `public/` directory
- Pages:
  - `index.html` — landing page with SEO meta tags, Open Graph, structured data
  - `login.html` / `register.html` — auth forms
  - `chat.html` — main chat interface (sidebar with contacts, chat area, message input with file/GIF/emoji support)
  - `profile.html` — user profile view/edit
  - `admin.html` — admin dashboard with stats, user management, config management
- CSS files in `public/css/`: `auth.css`, `chat.css`, `admin.css`
- JS files in `public/js/`: `auth.js`, `chat.js` (and likely admin.js)
- **Theming**: Dark/light mode toggled client-side, preference saved to MongoDB per user
- **Sound notifications**: Generated via Web Audio API (oscillator-based), toggleable per user
- **File uploads**: Via multer (memory storage), files stored as base64 in MongoDB, max 1MB
- **Responsive design**: CSS handles mobile and desktop layouts

### Key Design Decisions

1. **No `.env` file required**: All secrets and config are in `config.js` with env var overrides. This simplifies deployment but means secrets are in the codebase (acceptable for this project's scope).
2. **Base64 file storage in MongoDB**: Files up to 1MB are stored directly in the database as base64 strings rather than using external file storage. Simple but limits scalability for media-heavy usage.
3. **Numeric user IDs**: Users get random 6-9 digit numeric IDs (like WhatsApp-style), generated with collision checking.
4. **Conversation IDs**: Derived by sorting two user IDs and joining them, ensuring a consistent ID regardless of who initiates.
5. **No frontend framework**: Pure vanilla JS keeps the build process simple — just serve static files.

## External Dependencies

### NPM Packages

| Package | Purpose |
|---|---|
| `express` | HTTP server and routing |
| `socket.io` | Real-time WebSocket communication |
| `mongoose` | MongoDB ODM |
| `jsonwebtoken` | JWT token creation and verification |
| `bcryptjs` | Password hashing |
| `cookie-parser` | Parse cookies from requests |
| `cors` | Cross-origin resource sharing |
| `express-rate-limit` | Rate limiting for login and general API |
| `multer` | Multipart file upload handling |
| `uuid` | Generate unique message IDs |
| `nodemon` (dev) | Auto-restart server during development |

### External Services

- **MongoDB Atlas**: Cloud-hosted MongoDB database. Connection string is in `config.js` (env var `MONGODB_URI` can override).
- **Giphy API**: Used for GIF search and sending within chat. API key is in `config.js` (`GIPHY_API_KEY`). Base URL: `https://api.giphy.com/v1`. Can be toggled on/off via app config.

### Running the App

- **Start**: `npm start` (runs `node server.js`)
- **Dev**: `npm run dev` (runs `nodemon server.js`)
- Default port: 5000 (overridable via `PORT` env var)
- Requires Node.js >= 18.0.0
- MongoDB connection must be available (Atlas URI is preconfigured)