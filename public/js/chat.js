/* ============================================================
   RYLAC CHAT - MAIN CLIENT JAVASCRIPT (FIXED)
   ============================================================ */

let currentUser = null;
let currentChat = null;
let socket = null;
let messagesPage = 1;
let loadingMessages = false;
let allMessagesLoaded = false;
let typingTimer = null;
let isTyping = false;
let contextMenuMsgId = null;
let contextMenuMsgSenderId = null;
let replyToMsg = null;
let unreadCounts = {};
let contacts = [];
let allContacts = [];

// Sound effects
let audioCtx = null;
function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

function playSound(type) {
  if (!currentUser?.notificationSound) return;
  try {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    if (type === 'send') {
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(660, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
      osc.start();
      osc.stop(ctx.currentTime + 0.15);
    } else {
      osc.frequency.setValueAtTime(660, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.08);
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
      osc.start();
      osc.stop(ctx.currentTime + 0.2);
    }
  } catch (e) { /* ignore audio errors */ }
}

// ============================================================
// INIT - FIXED VERSION
// ============================================================
async function init() {
  try {
    console.log('🚀 Initializing chat...');
    
    // Cek apakah user sudah login
    const res = await fetch('/api/auth/me', { 
      method: 'GET',
      headers: { 
        'Accept': 'application/json',
        'Cache-Control': 'no-cache'
      },
      credentials: 'include' // PENTING!
    });

    console.log('📥 Auth response:', res.status);

    if (!res.ok) {
      console.log('❌ Not authenticated, redirecting to login');
      window.location.href = '/login';
      return;
    }

    const data = await res.json();

    if (!data.success) {
      console.log('❌ Auth failed:', data.message);
      window.location.href = '/login';
      return;
    }

    currentUser = data.user;
    console.log('✅ Authenticated as:', currentUser.username);

    // Apply theme
    applyTheme(currentUser.theme);
    
    // Initialize socket
    initSocket();
    
    // Render UI
    renderOwnProfile();
    await loadContacts();
    await loadUnreadCounts();

    // Check URL parameter untuk membuka chat tertentu
    const params = new URLSearchParams(window.location.search);
    const openUserId = params.get('chat');
    if (openUserId) {
      await openChatWith(openUserId);
    }

    // Hide loading screen
    document.getElementById('loading-screen').style.display = 'none';
    document.getElementById('app-container').style.display = 'grid';

    // Setup event listeners
    setupEventListeners();
    setupPopover();
    setupEmojiPicker();
    loadTrendingGifs();
    
    console.log('✅ Chat initialized successfully');
  } catch (err) {
    console.error('Init error:', err);
    window.location.href = '/login';
  }
}

// ============================================================
// SOCKET - FIXED VERSION
// ============================================================
function initSocket() {
  console.log('🔌 Connecting to socket.io...');
  
  // Socket.io dengan konfigurasi yang benar
  socket = io({
    withCredentials: true,
    transports: ['websocket', 'polling'],
    auth: {
      token: null // Token akan diambil dari cookie oleh server
    }
  });

  socket.on('connect', () => {
    console.log('✅ Socket connected:', socket.id);
  });

  socket.on('connect_error', async (err) => {
    console.warn('❌ Socket connect error:', err.message);
    // Coba refresh token
    await refreshToken();
  });

  socket.on('newMessage', (msg) => {
    if (!msg) return;
    
    const isFromCurrentChat = currentChat && 
      (msg.senderId === currentChat.userId || msg.receiverId === currentChat.userId);

    if (isFromCurrentChat) {
      appendMessage(msg);
      socket.emit('markRead', { senderId: msg.senderId });
      if (msg.senderId === currentUser.userId) {
        scrollToBottom();
      }
    } else {
      // Update unread count
      unreadCounts[msg.senderId] = (unreadCounts[msg.senderId] || 0) + 1;
      updateContactUnread(msg.senderId);
      showToast(`💬 New message from ${msg.sender?.displayName || 'Someone'}`, 'info');
    }

    playSound('receive');
    updateContactPreview(msg);
  });

  socket.on('userStatus', ({ userId, isOnline, lastSeen }) => {
    updateContactOnlineStatus(userId, isOnline, lastSeen);
    if (currentChat?.userId === userId) {
      currentChat.isOnline = isOnline;
      if (!isOnline && lastSeen) currentChat.lastSeen = lastSeen;
      updateChatHeader();
    }
  });

  socket.on('typing', ({ senderId, isTyping }) => {
    if (currentChat?.userId === senderId) {
      const statusEl = document.getElementById('chat-status');
      if (statusEl) {
        statusEl.textContent = isTyping ? 'typing...' : getChatStatusText();
        statusEl.className = 'chat-status' + (isTyping ? ' typing' : '');
      }
    }
  });

  socket.on('messagesRead', ({ readBy }) => {
    if (readBy === currentChat?.userId) {
      document.querySelectorAll('.message-row.sent .msg-status').forEach(el => {
        el.textContent = '✓✓';
        el.style.color = '#6366f1';
      });
    }
  });

  socket.on('messageDeleted', ({ messageId }) => {
    const el = document.querySelector(`[data-msg-id="${messageId}"]`);
    if (el) {
      const bubble = el.querySelector('.message-bubble');
      if (bubble) {
        bubble.innerHTML = '<em class="msg-deleted">This message was deleted.</em>';
      }
    }
  });

  socket.on('messageReaction', ({ messageId, reactions }) => {
    const el = document.querySelector(`[data-msg-id="${messageId}"]`);
    if (el) renderReactions(el, reactions, messageId);
  });

  socket.on('accountSuspended', ({ reason }) => {
    alert(`Your account has been suspended${reason ? ': ' + reason : '.'}`);
    logout();
  });

  socket.on('accountDeleted', () => {
    alert('Your account has been deleted by an administrator.');
    logout();
  });
}

// ============================================================
// AUTH FUNCTIONS
// ============================================================
async function refreshToken() {
  try {
    console.log('🔄 Refreshing token...');
    const res = await fetch('/api/auth/refresh', { 
      method: 'POST', 
      credentials: 'include' 
    });
    
    if (res.ok) {
      console.log('✅ Token refreshed');
    }
  } catch (e) {
    console.warn('❌ Token refresh failed:', e);
  }
}

async function logout() {
  try {
    await fetch('/api/auth/logout', { 
      method: 'POST', 
      credentials: 'include' 
    });
  } catch {}
  window.location.href = '/login';
}

// ============================================================
// START THE APP
// ============================================================
// Jalankan init setelah DOM siap
document.addEventListener('DOMContentLoaded', init);
