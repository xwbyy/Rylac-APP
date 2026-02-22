/* ============================================================
   RYLAC CHAT - MAIN CLIENT JAVASCRIPT
   ============================================================ */

let currentUser = null;
let currentChat = null; // { userId, username, displayName, avatar, isOnline, lastSeen }
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
let contacts = []; // recent contacts
let allContacts = []; // for display

// Sound effects (Web Audio API)
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
// INIT
// ============================================================
async function init() {
  try {
    const res = await fetch('/api/auth/me', { credentials: 'include' });
    const data = await res.json();

    if (!data.success) {
      window.location.href = '/login';
      return;
    }

    currentUser = data.user;
    applyTheme(currentUser.theme);
    initSocket();
    renderOwnProfile();
    await loadContacts();
    await loadUnreadCounts();

    // Check URL param for opening a specific chat
    const params = new URLSearchParams(window.location.search);
    const openUserId = params.get('chat');
    if (openUserId) {
      await openChatWith(openUserId);
    }

    document.getElementById('loading-screen').style.display = 'none';
    document.getElementById('app-container').style.display = 'grid';

    setupEventListeners();
    setupPopover();
    setupEmojiPicker();
    loadTrendingGifs();
  } catch (err) {
    console.error('Init error:', err);
    window.location.href = '/login';
  }
}

// ============================================================
// SOCKET
// ============================================================
function initSocket() {
  socket = io({ auth: { token: null }, withCredentials: true });

  socket.on('connect', () => {
    console.log('Socket connected:', socket.id);
  });

  socket.on('connect_error', async (err) => {
    console.warn('Socket connect error, refreshing token...');
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

    // Update contacts list
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
      // Update checkmarks on sent messages
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
// AUTH
// ============================================================
async function refreshToken() {
  try {
    await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' });
  } catch (e) {}
}

async function logout() {
  try {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
  } catch {}
  window.location.href = '/login';
}

// ============================================================
// THEME
// ============================================================
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  document.getElementById('theme-btn').textContent = theme === 'dark' ? '☀️' : '🌙';
}

async function toggleTheme() {
  const newTheme = currentUser.theme === 'dark' ? 'light' : 'dark';
  applyTheme(newTheme);
  currentUser.theme = newTheme;
  try {
    await fetch('/api/users/profile/update', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ theme: newTheme }),
    });
  } catch {}
}

// ============================================================
// OWN PROFILE
// ============================================================
function renderOwnProfile() {
  document.getElementById('own-name').textContent = currentUser.displayName;
  document.getElementById('own-id').textContent = currentUser.userId;
  const avatarEl = document.getElementById('own-avatar');
  if (currentUser.avatar) {
    avatarEl.innerHTML = `<img src="${currentUser.avatar}" alt="" onerror="this.parentElement.textContent='${currentUser.displayName[0].toUpperCase()}'">`;
  } else {
    avatarEl.textContent = currentUser.displayName[0].toUpperCase();
  }
}

// ============================================================
// CONTACTS
// ============================================================
async function loadContacts() {
  try {
    const res = await fetch('/api/users/contacts/list', { credentials: 'include' });
    const data = await res.json();
    if (data.success) {
      allContacts = data.contacts;
      renderContacts(allContacts);
    }
  } catch {}
}

async function loadUnreadCounts() {
  try {
    const res = await fetch('/api/messages/unread/count', { credentials: 'include' });
    const data = await res.json();
    if (data.success) {
      unreadCounts = data.counts;
      // Update badges
      Object.keys(unreadCounts).forEach(uid => updateContactUnread(uid));
    }
  } catch {}
}

function renderContacts(list) {
  const container = document.getElementById('contacts-list');
  if (!list || list.length === 0) {
    container.innerHTML = `<div class="empty-contacts"><span class="empty-icon">💬</span><p>No conversations yet.<br>Search for users to start chatting!</p></div>`;
    return;
  }

  container.innerHTML = list.map(c => `
    <div class="contact-item ${currentChat?.userId === c.userId ? 'active' : ''}" 
         data-uid="${c.userId}" onclick="openChatWith('${c.userId}')">
      <div class="avatar-wrap">
        <div class="avatar" id="contact-avatar-${c.userId}">
          ${c.avatar ? `<img src="${c.avatar}" alt="" onerror="this.parentElement.textContent='${c.displayName[0].toUpperCase()}'">` : c.displayName[0].toUpperCase()}
        </div>
        <div class="online-dot ${c.isOnline ? 'online' : ''}" id="dot-${c.userId}"></div>
      </div>
      <div class="contact-info">
        <div class="contact-name">${escHtml(c.displayName)}</div>
        <div class="contact-preview" id="preview-${c.userId}">@${escHtml(c.username)}</div>
      </div>
      <div class="contact-meta">
        <div class="contact-time" id="time-${c.userId}"></div>
        <div class="unread-badge" id="badge-${c.userId}" style="display:${(unreadCounts[c.userId] || 0) > 0 ? 'block' : 'none'}">${unreadCounts[c.userId] || ''}</div>
      </div>
    </div>
  `).join('');
}

function updateContactPreview(msg) {
  // Move contact to top or add if new
  const existingIdx = allContacts.findIndex(c => c.userId === msg.senderId || c.userId === msg.receiverId);
  const otherUserId = msg.senderId === currentUser.userId ? msg.receiverId : msg.senderId;

  if (existingIdx === -1) {
    // Reload contacts
    loadContacts();
    return;
  }

  const previewEl = document.getElementById(`preview-${otherUserId}`);
  if (previewEl) {
    const preview = msg.type === 'text' ? (msg.content || '').substring(0, 30) :
                    msg.type === 'image' ? '📷 Photo' :
                    msg.type === 'audio' ? '🎵 Audio' :
                    msg.type === 'gif' ? '🎭 GIF' :
                    msg.type === 'video' ? '🎬 Video' : '📎 File';
    previewEl.textContent = (msg.senderId === currentUser.userId ? 'You: ' : '') + preview;
  }

  const timeEl = document.getElementById(`time-${otherUserId}`);
  if (timeEl) timeEl.textContent = formatTime(msg.createdAt);
}

function updateContactOnlineStatus(userId, isOnline, lastSeen) {
  const dot = document.getElementById(`dot-${userId}`);
  if (dot) {
    dot.className = `online-dot ${isOnline ? 'online' : ''}`;
  }
}

function updateContactUnread(userId) {
  const badge = document.getElementById(`badge-${userId}`);
  const count = unreadCounts[userId] || 0;
  if (badge) {
    badge.style.display = count > 0 ? 'block' : 'none';
    badge.textContent = count;
  }
}

// ============================================================
// OPEN CHAT
// ============================================================
async function openChatWith(userId) {
  if (currentChat?.userId === userId) return;

  // Reset
  messagesPage = 1;
  allMessagesLoaded = false;
  replyToMsg = null;
  document.getElementById('reply-bar').classList.remove('show');

  try {
    const res = await fetch(`/api/messages/${userId}?page=1&limit=50`, { credentials: 'include' });
    const data = await res.json();

    if (!data.success) {
      showToast('Failed to load messages.', 'error');
      return;
    }

    currentChat = {
      userId: data.otherUser.userId,
      username: data.otherUser.username,
      displayName: data.otherUser.displayName,
      avatar: data.otherUser.avatar,
      isOnline: data.otherUser.isOnline,
      lastSeen: data.otherUser.lastSeen,
      status: data.otherUser.status,
    };

    // Add to contacts if not there
    if (!allContacts.find(c => c.userId === userId)) {
      allContacts.unshift(data.otherUser);
    }

    // Update URL without reload
    history.replaceState(null, '', `/chat?chat=${userId}`);

    // Render UI
    renderChatHeader();
    renderMessages(data.messages);
    scrollToBottom(true);

    // Clear unread
    unreadCounts[userId] = 0;
    updateContactUnread(userId);

    // Update active contact
    document.querySelectorAll('.contact-item').forEach(el => {
      el.classList.toggle('active', el.dataset.uid === userId);
    });

    // Show chat window
    document.getElementById('chat-empty').style.display = 'none';
    const chatWindow = document.getElementById('chat-window');
    chatWindow.style.display = 'flex';

    // Mobile: hide sidebar
    if (window.innerWidth <= 768) {
      document.getElementById('sidebar').classList.add('hidden');
    }

    // Focus input
    document.getElementById('msg-input').focus();

    // Notify socket: mark messages read
    socket.emit('markRead', { senderId: userId });

    // Render contacts if not already rendered
    renderContacts(allContacts);

  } catch (err) {
    console.error('Open chat error:', err);
    showToast('Failed to open chat.', 'error');
  }
}

function renderChatHeader() {
  const avatarEl = document.getElementById('chat-avatar');
  if (currentChat.avatar) {
    avatarEl.innerHTML = `<img src="${currentChat.avatar}" alt="" onerror="this.outerHTML='<div class=\'avatar\'>${currentChat.displayName[0].toUpperCase()}</div>'">`;
  } else {
    avatarEl.textContent = currentChat.displayName[0].toUpperCase();
  }
  document.getElementById('chat-username').textContent = currentChat.displayName;
  updateChatHeader();
}

function updateChatHeader() {
  const statusEl = document.getElementById('chat-status');
  statusEl.textContent = getChatStatusText();
  statusEl.className = 'chat-status';
}

function getChatStatusText() {
  if (!currentChat) return '';
  if (currentChat.isOnline) return '🟢 Online';
  if (currentChat.lastSeen) return `Last seen ${formatRelativeTime(currentChat.lastSeen)}`;
  return `@${currentChat.username}`;
}

// ============================================================
// MESSAGES RENDERING
// ============================================================
function renderMessages(messages) {
  const container = document.getElementById('messages-container');
  container.innerHTML = '';
  let lastDate = '';

  messages.forEach(msg => {
    const msgDate = new Date(msg.createdAt).toDateString();
    if (msgDate !== lastDate) {
      lastDate = msgDate;
      container.appendChild(createDateDivider(msg.createdAt));
    }
    container.appendChild(createMessageEl(msg));
  });
}

function appendMessage(msg) {
  const container = document.getElementById('messages-container');
  const lastChild = container.lastElementChild;
  const lastDate = lastChild ? lastChild.dataset.date : null;
  const msgDate = new Date(msg.createdAt).toDateString();

  if (msgDate !== lastDate) {
    const divider = createDateDivider(msg.createdAt);
    container.appendChild(divider);
  }
  container.appendChild(createMessageEl(msg));
}

function createDateDivider(dateStr) {
  const div = document.createElement('div');
  div.className = 'date-divider';
  div.dataset.date = new Date(dateStr).toDateString();
  const today = new Date().toDateString();
  const yesterday = new Date(Date.now() - 86400000).toDateString();
  const date = new Date(dateStr).toDateString();
  let label = date;
  if (date === today) label = 'Today';
  else if (date === yesterday) label = 'Yesterday';
  div.innerHTML = `<span>${label}</span>`;
  return div;
}

function createMessageEl(msg) {
  const isSent = msg.senderId === currentUser.userId;
  const wrapper = document.createElement('div');
  wrapper.className = 'message-row ' + (isSent ? 'sent' : 'received');
  wrapper.dataset.msgId = msg.messageId;

  let avatarHtml = '';
  if (!isSent) {
    const av = currentChat?.avatar ? `<img src="${currentChat.avatar}" alt="" onerror="this.parentElement.textContent='${(currentChat?.displayName || '?')[0].toUpperCase()}'">` : (currentChat?.displayName || '?')[0].toUpperCase();
    avatarHtml = `<div class="msg-avatar">${av}</div>`;
  }

  let contentHtml = '';
  if (msg.isDeleted) {
    contentHtml = `<em class="msg-deleted">🚫 This message was deleted.</em>`;
  } else {
    contentHtml = renderMessageContent(msg);
  }

  const timeHtml = `<div class="msg-time">${formatTime(msg.createdAt)}${isSent ? `<span class="msg-status" style="${msg.isRead ? 'color:#6366f1' : ''}">${msg.isRead ? '✓✓' : '✓'}</span>` : ''}</div>`;

  const replyHtml = msg.replyTo ? `<div class="reply-preview"><strong>${escHtml(msg.replyTo.senderId === currentUser.userId ? 'You' : currentChat?.displayName || 'User')}</strong><br>${escHtml((msg.replyTo.content || '').substring(0, 60))}</div>` : '';

  wrapper.innerHTML = `
    ${!isSent ? avatarHtml : ''}
    <div>
      <div class="message-bubble" data-msg-id="${msg.messageId}">
        ${replyHtml}
        ${contentHtml}
      </div>
      ${timeHtml}
      <div class="msg-reactions" id="reactions-${msg.messageId}"></div>
    </div>
    ${isSent ? avatarHtml : ''}
  `;

  // Render reactions
  if (msg.reactions && msg.reactions.length > 0) {
    renderReactions(wrapper, msg.reactions, msg.messageId);
  }

  // Context menu on right-click / long press
  wrapper.querySelector('.message-bubble')?.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showContextMenu(e, msg.messageId, msg.senderId, isSent, msg.type, msg.content);
  });

  // Long press for mobile
  let longPressTimer;
  wrapper.querySelector('.message-bubble')?.addEventListener('touchstart', (e) => {
    longPressTimer = setTimeout(() => {
      const touch = e.touches[0];
      showContextMenu({ clientX: touch.clientX, clientY: touch.clientY, preventDefault: () => {} }, msg.messageId, msg.senderId, isSent, msg.type, msg.content);
    }, 600);
  });
  wrapper.querySelector('.message-bubble')?.addEventListener('touchend', () => clearTimeout(longPressTimer));

  return wrapper;
}

function renderMessageContent(msg) {
  switch (msg.type) {
    case 'text':
      return `<span>${escHtml(msg.content || '').replace(/\n/g, '<br>')}</span>`;
    case 'image':
      return `<img class="msg-image" src="${msg.fileData?.base64 || ''}" alt="Image" onclick="openImagePreview('${msg.fileData?.base64 || ''}')">`;
    case 'gif':
    case 'sticker':
      const gifSrc = msg.giphyData?.url || msg.fileData?.base64 || '';
      return `<img class="msg-gif" src="${gifSrc}" alt="${escHtml(msg.giphyData?.title || 'GIF')}">`;
    case 'audio':
      return `<audio class="msg-audio" controls src="${msg.fileData?.base64 || ''}"></audio>`;
    case 'video':
      return `<video class="msg-image" controls style="max-width:250px" src="${msg.fileData?.base64 || ''}"></video>`;
    case 'file':
      const sizeKb = msg.fileData?.size ? Math.round(msg.fileData.size / 1024) : '?';
      return `<div class="msg-file">
        <span class="msg-file-icon">📄</span>
        <div>
          <div class="msg-file-name">${escHtml(msg.fileData?.name || msg.content || 'File')}</div>
          <div class="msg-file-size">${sizeKb} KB</div>
        </div>
        ${msg.fileData?.base64 ? `<a href="${msg.fileData.base64}" download="${msg.fileData?.name || 'file'}" style="color:inherit;font-size:1.2rem;text-decoration:none;">⬇️</a>` : ''}
      </div>`;
    default:
      return `<span>${escHtml(msg.content || '')}</span>`;
  }
}

function renderReactions(wrapper, reactions, messageId) {
  const reactEl = wrapper.querySelector(`#reactions-${messageId}`) || wrapper.querySelector('.msg-reactions');
  if (!reactEl) return;

  if (!reactions || reactions.length === 0) { reactEl.innerHTML = ''; return; }

  const grouped = {};
  reactions.forEach(r => { grouped[r.emoji] = (grouped[r.emoji] || 0) + 1; });

  reactEl.innerHTML = Object.entries(grouped).map(([emoji, count]) => 
    `<span class="reaction-pill" onclick="reactToMessage('${messageId}', '${emoji}')">${emoji} ${count}</span>`
  ).join('');
}

// ============================================================
// SEND MESSAGE
// ============================================================
async function sendTextMessage() {
  const input = document.getElementById('msg-input');
  const content = input.value.trim();

  if (!content || !currentChat) return;

  input.value = '';
  adjustTextareaHeight(input);

  // Stop typing
  socket.emit('typing', { receiverId: currentChat.userId, isTyping: false });

  const body = {
    receiverId: currentChat.userId,
    content,
    type: 'text',
  };
  if (replyToMsg) {
    body.replyTo = { messageId: replyToMsg.messageId, content: replyToMsg.content, senderId: replyToMsg.senderId };
    cancelReply();
  }

  try {
    const res = await fetch('/api/messages/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data.success) {
      appendMessage(data.data);
      scrollToBottom();
      playSound('send');
    } else {
      showToast(data.message || 'Failed to send.', 'error');
    }
  } catch {
    showToast('Network error.', 'error');
  }
}

async function sendFile(file) {
  if (!currentChat) return;
  if (file.size > 1 * 1024 * 1024) {
    showToast('File too large. Max 1MB.', 'error');
    return;
  }

  const formData = new FormData();
  formData.append('file', file);
  formData.append('receiverId', currentChat.userId);
  if (replyToMsg) {
    formData.append('replyTo', JSON.stringify({ messageId: replyToMsg.messageId, content: replyToMsg.content, senderId: replyToMsg.senderId }));
    cancelReply();
  }

  showToast('Uploading file...', 'info');

  try {
    const res = await fetch('/api/messages/upload', {
      method: 'POST',
      credentials: 'include',
      body: formData,
    });
    const data = await res.json();
    if (data.success) {
      appendMessage(data.data);
      scrollToBottom();
      playSound('send');
    } else {
      showToast(data.message || 'Upload failed.', 'error');
    }
  } catch {
    showToast('Upload failed.', 'error');
  }
}

async function sendGif(gifData) {
  if (!currentChat) return;
  try {
    const res = await fetch('/api/messages/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        receiverId: currentChat.userId,
        type: 'gif',
        content: gifData.title,
        giphyData: {
          id: gifData.id,
          url: gifData.images?.fixed_height?.url || gifData.images?.original?.url,
          title: gifData.title,
          preview: gifData.images?.preview_gif?.url,
        },
      }),
    });
    const data = await res.json();
    if (data.success) {
      appendMessage(data.data);
      scrollToBottom();
      playSound('send');
      closeGifPicker();
    }
  } catch {
    showToast('Failed to send GIF.', 'error');
  }
}

async function reactToMessage(messageId, emoji) {
  try {
    await fetch(`/api/messages/${messageId}/react`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ emoji }),
    });
    closeContextMenu();
  } catch {}
}

// ============================================================
// CONTEXT MENU
// ============================================================
function showContextMenu(e, msgId, senderId, isSent, type, content) {
  const menu = document.getElementById('context-menu');
  contextMenuMsgId = msgId;
  contextMenuMsgSenderId = senderId;

  // Copy only for text
  document.getElementById('ctx-copy').style.display = type === 'text' ? 'flex' : 'none';
  document.getElementById('ctx-delete-all').style.display = isSent ? 'flex' : 'none';

  menu.style.left = Math.min(e.clientX, window.innerWidth - 190) + 'px';
  menu.style.top = Math.min(e.clientY, window.innerHeight - 200) + 'px';
  menu.classList.add('show');
}

function closeContextMenu() {
  document.getElementById('context-menu').classList.remove('show');
  document.getElementById('react-menu').classList.remove('show');
  contextMenuMsgId = null;
}

// ============================================================
// GIF PICKER
// ============================================================
async function loadTrendingGifs() {
  try {
    const res = await fetch('/api/messages/giphy/trending?limit=20', { credentials: 'include' });
    const data = await res.json();
    if (data.success) renderGifs(data.gifs);
  } catch {}
}

async function searchGifs(query) {
  const grid = document.getElementById('gif-grid');
  grid.innerHTML = '<div class="gif-loading">Searching... 🎭</div>';
  try {
    const res = await fetch(`/api/messages/giphy/search?q=${encodeURIComponent(query)}&limit=20`, { credentials: 'include' });
    const data = await res.json();
    if (data.success) renderGifs(data.gifs);
  } catch { grid.innerHTML = '<div class="gif-loading">Failed to load GIFs.</div>'; }
}

function renderGifs(gifs) {
  const grid = document.getElementById('gif-grid');
  if (!gifs || gifs.length === 0) {
    grid.innerHTML = '<div class="gif-loading">No GIFs found.</div>';
    return;
  }
  grid.innerHTML = gifs.map(gif => `
    <div class="gif-item" onclick='sendGif(${JSON.stringify(gif).replace(/'/g, "&apos;").replace(/"/g, "&quot;")})'>
      <img src="${gif.images?.preview_gif?.url || gif.images?.fixed_height_small?.url || ''}" alt="${escHtml(gif.title)}" loading="lazy">
    </div>
  `).join('');
}

function closeGifPicker() {
  document.getElementById('gif-picker').classList.remove('show');
}

// ============================================================
// EMOJI PICKER
// ============================================================
function setupEmojiPicker() {
  const emojis = ['😀','😂','😍','🥰','😎','😢','😡','🤔','😮','🤩','👍','👎','❤️','🔥','✨','🎉','🙏','💪','🤣','😇','🥺','😴','🤗','😏','😤','🤦','🙈','💀','👻','🌟','💯','🎊','🎁','🌹','💐','🍕','🍔','☕','🍦','🎵','🎮','⚽','🏆'];
  const grid = document.getElementById('emoji-grid');
  grid.innerHTML = emojis.map(em => `<button class="emoji-btn-item" onclick="insertEmoji('${em}')">${em}</button>`).join('');
}

function insertEmoji(emoji) {
  const input = document.getElementById('msg-input');
  const pos = input.selectionStart;
  input.value = input.value.substring(0, pos) + emoji + input.value.substring(pos);
  input.focus();
  input.selectionStart = input.selectionEnd = pos + emoji.length;
  document.getElementById('emoji-picker').classList.remove('show');
}

// ============================================================
// USER SEARCH
// ============================================================
async function searchUsers(query) {
  const resultsEl = document.getElementById('search-results');
  if (!query) {
    resultsEl.innerHTML = '<p style="text-align:center;color:var(--text-muted);font-size:0.9rem;">Type to search users...</p>';
    return;
  }

  resultsEl.innerHTML = '<p style="text-align:center;color:var(--text-muted)">Searching...</p>';

  try {
    const res = await fetch(`/api/users/search?q=${encodeURIComponent(query)}`, { credentials: 'include' });
    const data = await res.json();

    if (!data.users || data.users.length === 0) {
      resultsEl.innerHTML = '<p style="text-align:center;color:var(--text-muted);font-size:0.9rem;">No users found.</p>';
      return;
    }

    resultsEl.innerHTML = data.users.map(u => `
      <div class="search-result-item" onclick="startChatFromSearch('${u.userId}')">
        <div class="avatar" style="width:40px;height:40px;font-size:1rem;background:var(--gradient);color:white;display:flex;align-items:center;justify-content:center;border-radius:50%;overflow:hidden;">
          ${u.avatar ? `<img src="${u.avatar}" style="width:100%;height:100%;object-fit:cover;" onerror="this.parentElement.textContent='${u.displayName[0]}'">` : u.displayName[0].toUpperCase()}
        </div>
        <div>
          <div style="font-weight:600;font-size:0.9rem;">${escHtml(u.displayName)}</div>
          <div style="font-size:0.8rem;color:var(--text-muted);">@${escHtml(u.username)} · ID: ${u.userId}</div>
        </div>
        <div style="margin-left:auto">
          <div class="online-dot ${u.isOnline ? 'online' : ''}" style="position:relative;"></div>
        </div>
      </div>
    `).join('');
  } catch {
    resultsEl.innerHTML = '<p style="text-align:center;color:var(--text-muted)">Search failed.</p>';
  }
}

async function startChatFromSearch(userId) {
  closeModal('search-modal');
  await openChatWith(userId);
}

// ============================================================
// PROFILE VIEW
// ============================================================
function openUserProfile() {
  if (!currentChat) return;
  const body = document.getElementById('profile-view-body');
  const av = currentChat.avatar ? `<img src="${currentChat.avatar}" style="width:100%;height:100%;object-fit:cover;" onerror="this.parentElement.textContent='${currentChat.displayName[0]}'" alt="">` : currentChat.displayName[0].toUpperCase();

  body.innerHTML = `
    <div class="profile-modal-avatar">${av}</div>
    <h3 style="font-size:1.3rem;font-weight:800;margin-bottom:0.25rem;">${escHtml(currentChat.displayName)}</h3>
    <p style="color:var(--text-muted);font-size:0.9rem;margin-bottom:0.5rem;">@${escHtml(currentChat.username)}</p>
    <p style="color:var(--primary);font-size:0.85rem;margin-bottom:1.5rem;">${currentChat.isOnline ? '🟢 Online' : '⚫ Offline'}</p>
    ${currentChat.status ? `<p style="color:var(--text-muted);font-size:0.9rem;background:var(--hover-bg);padding:0.75rem;border-radius:8px;margin-bottom:1rem;">"${escHtml(currentChat.status)}"</p>` : ''}
    <p style="font-size:0.8rem;color:var(--text-light);">ID: ${currentChat.userId}</p>
    ${currentChat.lastSeen ? `<p style="font-size:0.8rem;color:var(--text-light);margin-top:0.25rem;">Last seen: ${formatRelativeTime(currentChat.lastSeen)}</p>` : ''}
    <br>
    <button onclick="closeModal('profile-view-modal')" style="width:100%;padding:0.8rem;background:var(--gradient);color:white;border:none;border-radius:10px;font-weight:700;cursor:pointer;font-family:inherit;">Close</button>
  `;
  document.getElementById('profile-view-modal').classList.add('show');
}

function openOwnProfile() {
  const user = currentUser;
  document.getElementById('edit-displayName').value = user.displayName || '';
  document.getElementById('edit-avatar').value = user.avatar || '';
  document.getElementById('edit-bio').value = user.bio || '';
  document.getElementById('edit-status').value = user.status || '';

  const notifCheckbox = document.getElementById('edit-notif');
  notifCheckbox.checked = user.notificationSound !== false;
  updateToggle(notifCheckbox.checked);

  // Avatar preview
  const preview = document.getElementById('edit-avatar-preview');
  if (user.avatar) {
    preview.innerHTML = `<img src="${user.avatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" alt="">`;
  } else {
    preview.textContent = user.displayName[0].toUpperCase();
  }

  document.getElementById('own-profile-modal').classList.add('show');
}

function updateToggle(checked) {
  const slider = document.getElementById('toggle-slider');
  const knob = document.getElementById('toggle-knob');
  slider.style.background = checked ? '#6366f1' : '#cbd5e1';
  knob.style.left = checked ? '22px' : '2px';
}

// ============================================================
// REPLY
// ============================================================
function setReply(msg) {
  replyToMsg = msg;
  document.getElementById('reply-name').textContent = msg.senderId === currentUser.userId ? 'You' : (currentChat?.displayName || 'User');
  document.getElementById('reply-preview-text').textContent = (msg.content || '').substring(0, 60) || '[media]';
  document.getElementById('reply-bar').classList.add('show');
  document.getElementById('msg-input').focus();
}

function cancelReply() {
  replyToMsg = null;
  document.getElementById('reply-bar').classList.remove('show');
}

// ============================================================
// IMAGE PREVIEW
// ============================================================
function openImagePreview(src) {
  document.getElementById('preview-img').src = src;
  document.getElementById('image-modal').classList.add('show');
}

// ============================================================
// MODAL HELPERS
// ============================================================
function openModal(id) { document.getElementById(id).classList.add('show'); }
function closeModal(id) { document.getElementById(id).classList.remove('show'); }

// ============================================================
// SCROLL
// ============================================================
function scrollToBottom(instant = false) {
  const container = document.getElementById('messages-container');
  if (instant) {
    container.scrollTop = container.scrollHeight;
  } else {
    container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
  }
}

// ============================================================
// UTILS
// ============================================================
function escHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatTime(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatRelativeTime(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function adjustTextareaHeight(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

function showToast(msg, type = 'info', duration = 3000) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  const icons = { info: 'ℹ️', success: '✅', error: '❌' };
  toast.innerHTML = `<span>${icons[type] || 'ℹ️'}</span><span>${escHtml(msg)}</span>`;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), duration);
}

function setupPopover() {
  const toggleBtn = document.getElementById('menu-toggle-btn');
  const popover = document.getElementById('input-popover');
  const attachBtn = document.getElementById('attach-menu-btn');
  const gifBtn = document.getElementById('gif-menu-btn');
  const emojiBtn = document.getElementById('emoji-menu-btn');

  if (!toggleBtn || !popover) return;

  toggleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    popover.classList.toggle('show');
    toggleBtn.classList.toggle('active');
  });

  document.addEventListener('click', (e) => {
    if (!popover.contains(e.target) && e.target !== toggleBtn) {
      popover.classList.remove('show');
      toggleBtn.classList.remove('active');
    }
  });

  attachBtn.addEventListener('click', () => {
    document.getElementById('file-input').click();
    popover.classList.remove('show');
    toggleBtn.classList.remove('active');
  });

  gifBtn.addEventListener('click', () => {
    document.getElementById('gif-picker').classList.toggle('show');
    popover.classList.remove('show');
    toggleBtn.classList.remove('active');
  });

  emojiBtn.addEventListener('click', () => {
    document.getElementById('emoji-picker').classList.toggle('show');
    popover.classList.remove('show');
    toggleBtn.classList.remove('active');
  });
}

// ============================================================
// EVENT LISTENERS
// ============================================================
function setupEventListeners() {
  // Navigation
  document.getElementById('back-btn').addEventListener('click', () => {
    document.getElementById('sidebar').classList.remove('hidden');
    document.getElementById('chat-window').style.display = 'none';
    document.getElementById('chat-empty').style.display = 'flex';
    currentChat = null;
    history.replaceState(null, '', '/chat');
  });

  // Close pickers on click outside
  document.addEventListener('mousedown', (e) => {
    const gifPicker = document.getElementById('gif-picker');
    const emojiPicker = document.getElementById('emoji-picker');
    // Using closest since IDs might not match exactly with popover logic
    if (gifPicker && !gifPicker.contains(e.target) && !e.target.closest('#gif-menu-btn')) {
      gifPicker.classList.remove('show');
    }
    if (emojiPicker && !emojiPicker.contains(e.target) && !e.target.closest('#emoji-menu-btn')) {
      emojiPicker.classList.remove('show');
    }
  });

  // MSG INPUT
  const msgInput = document.getElementById('msg-input');
  if (msgInput) {
    msgInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        if (window.innerWidth > 768) {
          e.preventDefault();
          sendTextMessage();
        }
      }
    });

    msgInput.addEventListener('input', (e) => {
      adjustTextareaHeight(e.target);
      if (!currentChat) return;
      if (!isTyping) {
        isTyping = true;
        socket.emit('typing', { receiverId: currentChat.userId, isTyping: true });
      }
      clearTimeout(typingTimer);
      typingTimer = setTimeout(() => {
        isTyping = false;
        socket.emit('typing', { receiverId: currentChat.userId, isTyping: false });
      }, 1500);
    });
  }

  // SEND
  const sendBtn = document.getElementById('send-btn');
  if (sendBtn) sendBtn.addEventListener('click', sendTextMessage);

  // File input
  const fileInput = document.getElementById('file-input');
  if (fileInput) {
    fileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        sendFile(e.target.files[0]);
        e.target.value = '';
      }
    });
  }

  // GIF Search
  const gifSearch = document.getElementById('gif-search');
  if (gifSearch) {
    let gifSearchTimer;
    gifSearch.addEventListener('input', (e) => {
      clearTimeout(gifSearchTimer);
      const q = e.target.value.trim();
      gifSearchTimer = setTimeout(() => {
        if (q) searchGifs(q);
        else loadTrendingGifs();
      }, 400);
    });
  }

  // Theme toggle
  const themeBtn = document.getElementById('theme-btn');
  if (themeBtn) themeBtn.addEventListener('click', toggleTheme);

  // Logout
  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) logoutBtn.addEventListener('click', logout);

  // Profile Edit
  const profileBtn = document.getElementById('profile-btn');
  if (profileBtn) profileBtn.addEventListener('click', openOwnProfile);

  const profileForm = document.getElementById('profile-form');
  if (profileForm) {
    profileForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = {
        displayName: document.getElementById('edit-displayName').value.trim(),
        avatar: document.getElementById('edit-avatar').value.trim(),
        bio: document.getElementById('edit-bio').value.trim(),
        status: document.getElementById('edit-status').value.trim(),
        notificationSound: document.getElementById('edit-notif').checked,
      };
      try {
        const res = await fetch('/api/users/profile/update', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (data.success) {
          currentUser = { ...currentUser, ...data.user };
          renderOwnProfile();
          closeModal('own-profile-modal');
          showToast('Profile updated!', 'success');
        } else {
          showToast(data.message, 'error');
        }
      } catch {
        showToast('Failed to update.', 'error');
      }
    });
  }

  // Avatar preview
  const editAvatar = document.getElementById('edit-avatar');
  if (editAvatar) {
    editAvatar.addEventListener('input', (e) => {
      const preview = document.getElementById('edit-avatar-preview');
      if (e.target.value) {
        preview.innerHTML = `<img src="${e.target.value}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" onerror="this.parentElement.textContent='👤'">`;
      } else {
        preview.textContent = currentUser.displayName[0].toUpperCase();
      }
    });
  }

  const editNotif = document.getElementById('edit-notif');
  if (editNotif) editNotif.addEventListener('change', (e) => updateToggle(e.target.checked));

  // Search User
  const searchBtn = document.getElementById('search-btn');
  if (searchBtn) searchBtn.addEventListener('click', () => openModal('search-modal'));
  
  const userSearchInput = document.getElementById('user-search-input');
  if (userSearchInput) {
    let searchTimer;
    userSearchInput.addEventListener('input', (e) => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => searchUsers(e.target.value.trim()), 300);
    });
  }

  // Sidebar contact search
  const contactSearch = document.getElementById('contact-search');
  if (contactSearch) {
    contactSearch.addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase();
      const filtered = q ? allContacts.filter(c => 
        c.displayName.toLowerCase().includes(q) || 
        c.username.toLowerCase().includes(q) ||
        c.userId.includes(q)
      ) : allContacts;
      renderContacts(filtered);
    });
  }

  // REPLY
  const cancelReplyBtn = document.getElementById('cancel-reply');
  if (cancelReplyBtn) cancelReplyBtn.addEventListener('click', cancelReply);

  // CONTEXT MENU
  document.getElementById('ctx-copy').addEventListener('click', () => {
    const el = document.querySelector(`[data-msg-id="${contextMenuMsgId}"] .message-bubble`);
    const text = el?.textContent?.trim() || '';
    navigator.clipboard.writeText(text).then(() => showToast('Copied!', 'success'));
    closeContextMenu();
  });

  document.getElementById('ctx-reply').addEventListener('click', () => {
    if (!contextMenuMsgId) return;
    const el = document.querySelector(`[data-msg-id="${contextMenuMsgId}"]`);
    const content = el?.querySelector('.message-bubble')?.textContent?.trim() || '';
    setReply({ messageId: contextMenuMsgId, content, senderId: contextMenuMsgSenderId });
    closeContextMenu();
  });

  document.getElementById('ctx-react').addEventListener('click', (e) => {
    e.stopPropagation();
    const menu = document.getElementById('context-menu');
    const reactMenu = document.getElementById('react-menu');
    reactMenu.style.left = menu.style.left;
    reactMenu.style.top = (parseInt(menu.style.top) + 30) + 'px';
    reactMenu.classList.add('show');
    menu.classList.remove('show');
  });

  document.getElementById('ctx-delete-me').addEventListener('click', async () => {
    if (!contextMenuMsgId) return;
    const msgId = contextMenuMsgId;
    closeContextMenu();
    try {
      await fetch(`/api/messages/${msgId}?deleteFor=me`, { method: 'DELETE', credentials: 'include' });
      const el = document.querySelector(`[data-msg-id="${msgId}"]`);
      if (el) el.remove();
    } catch {}
  });

  document.getElementById('ctx-delete-all').addEventListener('click', async () => {
    if (!contextMenuMsgId) return;
    const msgId = contextMenuMsgId;
    closeContextMenu();
    try {
      await fetch(`/api/messages/${msgId}?deleteFor=everyone`, { method: 'DELETE', credentials: 'include' });
      const el = document.querySelector(`[data-msg-id="${msgId}"] .message-bubble`);
      if (el) el.innerHTML = '<em class="msg-deleted">🚫 This message was deleted.</em>';
    } catch {}
  });

  // Reactions
  document.querySelectorAll('#react-menu .emoji-btn-item').forEach(btn => {
    btn.addEventListener('click', () => {
      if (contextMenuMsgId) {
        reactToMessage(contextMenuMsgId, btn.dataset.emoji);
        document.getElementById('react-menu').classList.remove('show');
      }
    });
  });

  // Modal overlay close on bg click
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.classList.remove('show');
    });
  });

  // Token auto-refresh every 13 minutes
  setInterval(refreshToken, 13 * 60 * 1000);
}

// Start
init();
