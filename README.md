# 💬 Rylac App — Real-time Chat Application

A production-ready WhatsApp-like chat application built with Node.js, Express, MongoDB, Socket.io, and modern vanilla JavaScript.

---

## 🚀 Features

- ✅ **Real-time messaging** via Socket.io
- ✅ **JWT auth** — access + refresh tokens in httpOnly cookies (XSS-safe)
- ✅ **bcrypt** password hashing (salt rounds: 12)
- ✅ **Rate limiter** on login (5 attempts / 15 min per IP+username)
- ✅ **Unique numeric user IDs** (random, collision-free)
- ✅ **Username validation** (min 3 chars, letters/numbers/underscore only)
- ✅ **Password validation** (min 6 chars)
- ✅ **Send text, images, audio, video, files** (max 1MB, stored as base64)
- ✅ **GIF search & send** via Giphy API (configurable)
- ✅ **Message reactions** (emoji react/unreact)
- ✅ **Reply to messages**
- ✅ **Delete messages** (for me / for everyone)
- ✅ **Online/offline status** with real-time updates
- ✅ **Typing indicators**
- ✅ **Dark/Light theme** — saved per user in MongoDB
- ✅ **Edit profile** — display name, avatar (URL), bio, status
- ✅ **Change password** with current password verification
- ✅ **User search** by username, display name, or user ID
- ✅ **Sound notifications** (Web Audio API) — toggleable per user
- ✅ **Message read receipts** (✓ / ✓✓)
- ✅ **Admin panel** — full CRUD, stats, config management
- ✅ **MongoDB indexed** for fast queries
- ✅ **SEO optimized** — meta tags, OG, structured data, sitemap, robots.txt
- ✅ **Responsive design** — works on mobile and desktop
- ✅ **Production-ready** — deployable to Vercel

---

## 📁 Project Structure

```
rylac-app/
├── server.js              # Main Express + Socket.io server
├── config.js              # All configuration (no .env needed)
├── package.json
├── vercel.json
├── models/
│   ├── User.js            # User model with indexes
│   ├── Message.js         # Message model with indexes
│   └── AppConfig.js       # App configuration model
├── routes/
│   ├── auth.js            # Register, login, logout, refresh, admin-login
│   ├── users.js           # Profile, search, contacts, password change
│   ├── messages.js        # Send, get, upload, delete, react, Giphy
│   └── admin.js           # Admin CRUD, stats, config
├── middleware/
│   └── auth.js            # JWT auth, admin auth, optional auth middleware
└── public/
    ├── index.html         # Landing page with pricing
    ├── login.html
    ├── register.html
    ├── chat.html          # Main chat interface
    ├── profile.html       # Profile management
    ├── admin.html         # Admin panel
    ├── sitemap.xml
    ├── robots.txt
    ├── css/
    │   ├── auth.css       # Login/register styles
    │   ├── chat.css       # Chat app styles (dark/light)
    │   └── admin.css      # Admin panel styles
    └── js/
        └── chat.js        # Full chat client JavaScript
```

---

## ⚙️ Installation & Running Locally

```bash
# 1. Install dependencies
npm install

# 2. Start server
npm start

# 3. Open browser
http://localhost:3000
```

---

## 🌐 Deploy to Vercel

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel --prod
```

> **Note:** Socket.io has limited support on Vercel serverless. For full real-time functionality, consider deploying to:
> - **Railway** (`railway up`)  
> - **Render** (free tier available)
> - **DigitalOcean App Platform**
> - **VPS** (Ubuntu + PM2)

For Socket.io on Vercel, add the `MONGODB_URI` as an environment variable in Vercel dashboard or keep using `config.js`.

---

## 🔑 Admin Panel

- URL: `/admin`
- Username: `admin`
- Password: `admin123`

Features:
- 📊 Real-time stats dashboard
- 👥 User management (suspend, activate, reset password, delete)
- 💬 Message management (view, delete)
- ⚙️ App configuration (registration toggle, GIF toggle, etc.)

---

## 💬 Support Admin

To contact the admin user inside the app, search by ID: **268268**

---

## 🗃️ Database

**MongoDB Atlas** — Pre-configured connection.  
Collections: `users`, `messages`, `appconfigs`

MongoDB indexes:
- `users.userId` — unique, indexed
- `users.username` — unique, indexed
- `users.username + displayName` — text index for search
- `messages.conversationId + createdAt` — compound index
- `messages.senderId + receiverId + createdAt` — compound index
- `messages.messageId` — unique, indexed

---

## 📡 API Endpoints (Postman-ready)

### Auth
- `POST /api/auth/register` — Register new user
- `POST /api/auth/login` — Login (rate-limited)
- `POST /api/auth/logout` — Logout (clears cookies)
- `POST /api/auth/refresh` — Refresh access token
- `GET /api/auth/me` — Get current user
- `POST /api/auth/check-username` — Check username availability
- `POST /api/auth/admin-login` — Admin login
- `POST /api/auth/admin-logout` — Admin logout

### Users (requires auth)
- `GET /api/users/search?q=query` — Search users
- `GET /api/users/:userId` — Get user profile
- `PUT /api/users/profile/update` — Update own profile
- `PUT /api/users/password/change` — Change password
- `GET /api/users/contacts/list` — Get recent contacts

### Messages (requires auth)
- `GET /api/messages/:userId?page=1&limit=50` — Get conversation
- `POST /api/messages/send` — Send text/GIF message
- `POST /api/messages/upload` — Upload file message (multipart/form-data)
- `DELETE /api/messages/:messageId?deleteFor=me|everyone` — Delete message
- `POST /api/messages/:messageId/react` — React to message
- `GET /api/messages/unread/count` — Get unread counts
- `GET /api/messages/giphy/search?q=query` — Search Giphy
- `GET /api/messages/giphy/trending` — Trending GIFs

### Admin (requires admin token)
- `GET /api/admin/stats` — Dashboard statistics
- `GET /api/admin/users` — List users
- `PUT /api/admin/users/:userId/suspend` — Suspend user
- `PUT /api/admin/users/:userId/activate` — Activate user
- `PUT /api/admin/users/:userId/reset-password` — Reset password
- `DELETE /api/admin/users/:userId` — Delete user
- `GET /api/admin/messages` — List messages
- `DELETE /api/admin/messages/:messageId` — Delete message
- `GET /api/admin/config` — Get all config
- `PUT /api/admin/config/:key` — Update config
- `GET /api/admin/verify` — Verify admin session

---

## 🔒 Security Features

- JWT access tokens (15 min expiry) + refresh tokens (7 days) in httpOnly cookies
- bcrypt password hashing with salt rounds = 12
- Rate limiting on login: 5 attempts per 15 minutes per IP+username
- General API rate limiting: 100 requests per 15 minutes
- Token rotation: refresh tokens stored and validated in DB
- Account suspension: suspended users are force-disconnected via Socket.io
- Admin tokens stored separately with 8-hour expiry

---

Built with ❤️ by Rylac App Team
