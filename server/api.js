const express = require('express');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('./config');
const db = require('./db');
const { dispatchSend, graphUrl } = require('./services/send');
const { saveUpload, isAllowedMime, mediaTypeFor } = require('./services/uploads');
const { verifyToken, subscribeWebhook, subscribeAccount } = require('./services/connect');
const { telegramApi } = require('./services/telegram');
const { syncConnection } = require('./services/sync');
const webhooklog = require('./services/webhooklog');
const dbSnapshot = require('./services/db-snapshot');
const { broadcast } = require('./realtime');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadBytes, files: 1 },
});

// ------------------------------------------------------------------ auth
function sign(agent) {
  return jwt.sign({ sub: agent.id, email: agent.email }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  });
}

function requireAuth(req, res, next) {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const decoded = jwt.verify(token, config.jwtSecret);
    const agent = db.findAgentById(decoded.sub);
    if (!agent) return res.status(401).json({ error: 'Agent not found' });
    req.agent = agent;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

const STAFF_ROLES = ['admin', 'owner'];

function isStaff(agent) {
  return !!agent && STAFF_ROLES.includes(agent.role);
}

function requireAdmin(req, res, next) {
  if (!isStaff(req.agent)) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

// Owner admin se upar hai: sirf owner naye admins bana/promote/demote kar sakta hai.
function requireOwner(req, res, next) {
  if (req.agent.role !== 'owner') {
    return res.status(403).json({ error: 'Owner access required' });
  }
  next();
}

// Admin/owner koi bhi note likh sakta hai; assigned agent sirf apne thread par.
function requireNoteAccess(req, res, next) {
  if (isStaff(req.agent)) return next();
  const conversation = db.getConversation(req.params.id);
  if (conversation && conversation.assigned_agent_id === req.agent.id) return next();
  return res.status(403).json({ error: 'Only admin or the assigned agent can add notes' });
}

router.post('/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  const agent = db.findAgentByEmail(String(email).toLowerCase().trim());
  if (!agent || !bcrypt.compareSync(password, agent.password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  res.json({ token: sign(agent), agent: db.findAgentById(agent.id) });
});

router.get('/auth/me', requireAuth, (req, res) => res.json({ agent: req.agent }));

router.get('/auth/agents', requireAuth, (req, res) => res.json({ agents: db.listAgents() }));

// Deploy ke baad diagnostic: DB counts + R2 snapshot status. Is se pata chalta
// hai ke chats/agent attribution persist ho rahi hai ya nahi.
router.get('/db-status', requireAuth, requireAdmin, async (req, res) => {
  let forced = null;
  if (req.query.snapshot === '1') {
    forced = await dbSnapshot.snapshotNow('manual');
  }
  res.json({
    conversations: db.countConversations(),
    snapshot: dbSnapshot.getStatus(),
    forced_snapshot: forced,
  });
});

// ------------------------------------------------------------ conversations
router.get('/conversations', requireAuth, (req, res) => {
  const conversations = db.listConversations({
    status: req.query.status || 'all',
    channel: req.query.channel || 'all',
    unread: req.query.unread === '1' || req.query.unread === 'true',
    limit: req.query.limit,
  });
  res.json({ conversations });
});

router.get('/conversations/:id', requireAuth, (req, res) => {
  const conversation = db.getConversation(req.params.id);
  if (!conversation) return res.status(404).json({ error: 'Conversation not found' });
  const messages = db.listMessages(conversation.id);
  res.json({ conversation, messages });
});

router.post('/conversations/:id/reply', requireAuth, async (req, res) => {
  const conversation = db.getConversation(req.params.id);
  if (!conversation) return res.status(404).json({ error: 'Conversation not found' });

  const body = (req.body && req.body.body || '').trim();
  const mediaType = (req.body && req.body.media_type || '').trim();
  const mediaUrl = (req.body && req.body.media_url || '').trim();
  const replyToId = (req.body && req.body.reply_to_id) ? Number(req.body.reply_to_id) : null;

  if (replyToId) {
    const quoted = db.getMessage(replyToId);
    if (!quoted || quoted.conversation_id !== conversation.id) {
      return res.status(400).json({ error: 'reply_to_id is not part of this conversation' });
    }
  }

  if (mediaUrl && !mediaType) {
    return res.status(400).json({ error: 'media_type is required when sending media' });
  }
  if (!mediaUrl && !body) {
    return res.status(400).json({ error: 'Reply body is required' });
  }

  const attachment = mediaUrl ? { type: mediaType, url: mediaUrl } : null;
  const result = await dispatchSend(conversation, conversation.external_id, body, attachment);

  if (!result.ok) {
    return res.status(502).json({ error: result.error || 'Failed to send message' });
  }

  const record = db.addMessage({
    conversationId: conversation.id,
    direction: 'outbound',
    body,
    type: mediaType || 'text',
    metaId: (result.data && result.data.message_id) || null,
    agentId: req.agent.id,
    mediaType: mediaType || null,
    mediaUrl: mediaUrl || null,
    replyToId: replyToId || null,
  });
  // Realtime broadcast me bhi agent ka naam ho (owner ko "kis ne reply kiya"
  // dikhane ke liye).
  record.agent_name = req.agent.name || null;

  const full = db.getConversation(conversation.id);
  broadcast('message', { conversation: full, message: record });
  res.json({ ok: true, message: record });
});

// Sent message "edit": Meta already-sent message ko badal nahi sakta, is liye
// corrected text naya message ban kar jata hai aur purane par "(edited)" mark
// lag jata hai. Isse customer tak correction pahunchti hai.
router.post('/conversations/:id/messages/:messageId/edit', requireAuth, async (req, res) => {
  const conversation = db.getConversation(req.params.id);
  if (!conversation) return res.status(404).json({ error: 'Conversation not found' });

  const message = db.getMessage(Number(req.params.messageId));
  if (!message || message.conversation_id !== conversation.id) {
    return res.status(404).json({ error: 'Message not found in this conversation' });
  }
  if (message.direction !== 'outbound' || message.sender === 'note') {
    return res.status(400).json({ error: 'Only sent messages can be edited' });
  }
  if (!isStaff(req.agent) && message.agent_id !== req.agent.id) {
    return res.status(403).json({ error: 'Only the author or an admin can edit this message' });
  }

  const body = String((req.body && req.body.body) || '').trim();
  if (!body) return res.status(400).json({ error: 'Edited message body is required' });

  const result = await dispatchSend(conversation, conversation.external_id, body, null);
  if (!result.ok) {
    return res.status(502).json({ error: result.error || 'Failed to send edited message' });
  }

  const record = db.addMessage({
    conversationId: conversation.id,
    direction: 'outbound',
    body,
    type: 'text',
    metaId: (result.data && result.data.message_id) || null,
    agentId: req.agent.id,
  });
  record.agent_name = req.agent.name || null;
  const edited = db.markMessageEdited(message.id, record.id);

  const full = db.getConversation(conversation.id);
  broadcast('message', { conversation: full, message: record });
  broadcast('message-edited', { conversation_id: conversation.id, message: edited });
  res.json({ ok: true, message: record, edited });
});

// Upload media for later use in a reply. Returns a URL that is sendable to FB/IG.
router.post('/upload', requireAuth, (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ error: `Upload failed: ${err.message}` });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided (field "file")' });
    }
    if (!isAllowedMime(req.file.mimetype)) {
      return res.status(400).json({ error: `File type not allowed: ${req.file.mimetype}` });
    }
    try {
      const saved = await saveUpload(req.file.buffer, req.file.originalname, req.file.mimetype);
      res.json({ ok: true, url: saved.url, media_type: mediaTypeFor(req.file.mimetype) });
    } catch (e) {
      console.error('Upload failed:', e.message);
      res.status(500).json({ error: `Upload failed: ${e.message}` });
    }
  });
});

router.post('/conversations/:id/assign', requireAuth, requireAdmin, (req, res) => {
  const conversation = db.getConversation(req.params.id);
  if (!conversation) return res.status(404).json({ error: 'Conversation not found' });
  const agentId = req.body && req.body.agent_id ? Number(req.body.agent_id) : null;
  const updated = db.setConversationAgent(conversation.id, agentId);

  const noteText = String((req.body && (req.body.note ?? req.body.body)) || '').trim();
  const mediaType = ((req.body && req.body.media_type) || '').trim();
  const mediaUrl = ((req.body && req.body.media_url) || '').trim();
  let note = null;
  if (noteText || mediaUrl) {
    note = db.addNoteMessage({
      conversationId: conversation.id,
      body: noteText,
      type: mediaUrl ? (mediaType || 'document') : 'text',
      mediaType: mediaUrl ? mediaType : null,
      mediaUrl: mediaUrl || null,
      agentId: req.agent.id,
    });
    broadcast('message', { conversation: updated, message: note });
  }

  broadcast('conversation', { conversation: updated });
  res.json({ conversation: updated, note });
});

router.post('/conversations/:id/note', requireAuth, requireNoteAccess, (req, res) => {
  const conversation = db.getConversation(req.params.id);
  if (!conversation) return res.status(404).json({ error: 'Conversation not found' });
  const noteText = String((req.body && (req.body.body ?? req.body.note)) || '').trim();
  const mediaType = ((req.body && req.body.media_type) || '').trim();
  const mediaUrl = ((req.body && req.body.media_url) || '').trim();
  if (!noteText && !mediaUrl) return res.status(400).json({ error: 'Note body or media required' });

  const note = db.addNoteMessage({
    conversationId: conversation.id,
    body: noteText,
    type: mediaUrl ? (mediaType || 'document') : 'text',
    mediaType: mediaUrl ? mediaType : null,
    mediaUrl: mediaUrl || null,
    agentId: req.agent.id,
  });

  broadcast('message', { conversation, message: note });
  res.json({ ok: true, note });
});

router.delete('/conversations/:id/notes/:messageId', requireAuth, (req, res) => {
  const conversation = db.getConversation(req.params.id);
  if (!conversation) return res.status(404).json({ error: 'Conversation not found' });
  const note = db.getNoteMessage(req.params.messageId);
  if (!note) return res.status(404).json({ error: 'Note not found' });
  if (!isStaff(req.agent) && note.agent_id !== req.agent.id) {
    return res.status(403).json({ error: 'Only the author or an admin can delete this note' });
  }
  db.deleteNoteMessage(note.id);
  broadcast('message-deleted', { conversation_id: conversation.id, message_id: note.id });
  res.json({ ok: true });
});

router.post('/conversations/:id/status', requireAuth, (req, res) => {
  const conversation = db.getConversation(req.params.id);
  if (!conversation) return res.status(404).json({ error: 'Conversation not found' });
  const status = (req.body && req.body.status) || 'open';
  if (!['open', 'pending', 'resolved'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  const updated = db.setConversationStatus(conversation.id, status);
  broadcast('conversation', { conversation: updated });
  res.json({ conversation: updated });
});

router.post('/conversations/:id/read', requireAuth, (req, res) => {
  const conversation = db.getConversation(req.params.id);
  if (!conversation) return res.status(404).json({ error: 'Conversation not found' });
  db.markConversationRead(conversation.id);
  res.json({ ok: true });
});

// ------------------------------------------------------------ connections
// Facebook / Instagram / WhatsApp / Telegram ki API credentials UI se add hoti
// hain. Tokens DB me encrypted rehte hain (server/services/crypto.js).

const CHANNELS = ['facebook', 'instagram', 'whatsapp', 'telegram'];

function readConnectionInput(body) {
  const channel = String(body.channel || '').toLowerCase();
  if (!CHANNELS.includes(channel)) {
    return { error: 'channel must be one of: facebook, instagram, whatsapp, telegram' };
  }
  const name = String(body.name || '').trim();
  if (!name) return { error: 'name is required' };

  const token = String(body.token || '').trim();
  const input = {
    channel,
    name,
    appId: String(body.app_id || '').trim(),
    accountId: String(body.account_id || '').trim(),
    token,
    verifyToken: String(body.verify_token || '').trim(),
    // Instagram Login tokens (IGAA...) graph.instagram.com par chalte hain;
    // Facebook Login tokens (EAA...) graph.facebook.com par. Galat host se
    // "Cannot parse access token" aata hai, is liye token se detect karte hain.
    apiHost:
      channel === 'telegram'
        ? 'telegram'
        : channel === 'instagram' && token.startsWith('IGAA')
          ? 'instagram'
          : 'facebook',
    extra: {},
  };

  if (body.app_secret) input.appSecret = String(body.app_secret).trim();
  if (body.wa_own_number) {
    input.extra.wa_own_number = String(body.wa_own_number).replace(/\D/g, '');
  }

  // Channel ke hisaab se zaroori fields
  if (channel === 'facebook' && !input.accountId) {
    return { error: 'account_id (Page ID) is required for Facebook' };
  }
  if (channel === 'instagram' && !input.accountId) {
    return { error: 'account_id (IG Account ID) is required for Instagram' };
  }
  if (channel === 'whatsapp' && !input.accountId) {
    return { error: 'account_id (Phone Number ID) is required for WhatsApp' };
  }
  // Telegram bot id getMe se khud aa jati hai - account_id optional hai.
  if (!input.token) {
    return { error: channel === 'telegram' ? 'token (Telegram bot token) is required' : 'token (access token) is required' };
  }

  return { input };
}

router.get('/connections', requireAuth, requireAdmin, (req, res) => {
  res.json({ connections: db.listConnections() });
});

router.post('/connections', requireAuth, requireAdmin, async (req, res) => {
  const { input, error } = readConnectionInput(req.body || {});
  if (error) return res.status(400).json({ error });

  let created = db.createConnection(input);

  // Telegram me bot id/username token se khud mil jate hain. UI me account_id
  // khali chhorne par bhi connection complete dikhe.
  if (created.channel === 'telegram') {
    const verified = await verifyToken('telegram', created);
    if (verified.ok && verified.id) {
      created = db.updateConnection(created.id, { accountId: String(verified.id) }) || created;
    }
  }

  broadcast('connections', {});
  res.status(201).json({ connection: toPublic(created) });
});

router.patch('/connections/:id', requireAuth, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const existing = db.getConnection(id);
  if (!existing) return res.status(404).json({ error: 'Connection not found' });

  const body = req.body || {};
  const patch = {};
  if (body.name !== undefined) patch.name = String(body.name).trim();
  if (body.app_id !== undefined) patch.appId = String(body.app_id).trim();
  if (body.account_id !== undefined) patch.accountId = String(body.account_id).trim();
  if (body.api_host !== undefined) patch.apiHost = body.api_host === 'instagram' ? 'instagram' : 'facebook';
  if (body.enabled !== undefined) patch.enabled = !!body.enabled;
  if (body.verify_token !== undefined) patch.verifyToken = String(body.verify_token).trim();

  // Sirf bheja gaya token replace karta hai; khaali chhorne par purana rehta hai
  if (body.token) {
    patch.token = String(body.token).trim();
    // Naya IG token aaya to API host bhi token ke type se set karo.
    if (existing.channel === 'instagram') {
      patch.apiHost = patch.token.startsWith('IGAA') ? 'instagram' : 'facebook';
    }
  }
  if (body.app_secret) patch.appSecret = String(body.app_secret).trim();

  const extra = { ...existing.extra };
  if (body.wa_own_number !== undefined) {
    extra.wa_own_number = String(body.wa_own_number).replace(/\D/g, '');
  }
  patch.extra = extra;

  const updated = db.updateConnection(id, patch);
  broadcast('connections', {});
  res.json({ connection: toPublic(updated) });
});

router.delete('/connections/:id', requireAuth, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const existing = db.getConnection(id);
  if (!existing) return res.status(404).json({ error: 'Connection not found' });
  db.deleteConnection(id);
  broadcast('connections', {});
  res.json({ ok: true });
});

// Token verify kar ke account ka naam/ID laata hai - UI me "Test" button.
router.post('/connections/:id/verify', requireAuth, requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const conn = db.getConnection(id);
  if (!conn) return res.status(404).json({ error: 'Connection not found' });

  const result = await verifyToken(conn.channel, conn);
  if (!result.ok) return res.status(400).json({ error: result.error });

  res.json({ ok: true, account: result });
});

// Meta sirf public HTTPS callback maangta hai. Localhost/ngrok-free jaise
// URLs par subscribe kaam nahi karta, is liye pehle hi rok dete hain - warna
// Meta ka error message confuse karta hai.
function normalizeCallbackUrl(raw) {
  let url;
  try {
    url = new URL(String(raw).trim());
  } catch {
    return { error: 'callback_url aik valid URL nahi hai' };
  }
  if (url.protocol !== 'https:') {
    return { error: 'callback_url HTTPS hona chahiye (Meta sirf public HTTPS accept karta hai)' };
  }
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' || host === '[::1]') {
    return { error: 'callback_url public hona chahiye - localhost Meta ke paas nahi chalta. ngrok ya hosting use karein.' };
  }
  if (host.endsWith('.local')) {
    return { error: 'callback_url public hona chahiye - .local address Meta ke paas nahi chalta' };
  }
  return { value: url.origin + url.pathname.replace(/\/$/, '') };
}

// Meta app par webhook subscribe karwata hai.
router.post('/connections/:id/subscribe', requireAuth, requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const conn = db.getConnection(id);
  if (!conn) return res.status(404).json({ error: 'Connection not found' });

  const parsed = normalizeCallbackUrl((req.body && req.body.callback_url) || '');
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const callbackUrl = parsed.value;

  // Account-level pehle (page/IG ko app se link karo), phir app-level webhook
  const accountResult = await subscribeAccount(conn.channel, conn);
  const hookResult = await subscribeWebhook(conn.channel, conn, callbackUrl);

  if (!hookResult.ok) {
    return res.status(400).json({
      error: hookResult.error,
      account_linked: accountResult.ok ? accountResult.success : false,
      account_error: accountResult.ok ? null : accountResult.error,
    });
  }

  res.json({
    ok: true,
    account_linked: accountResult.ok ? accountResult.success : false,
    account_error: accountResult.ok ? null : accountResult.error,
    webhook: hookResult.message,
    object: hookResult.object,
  });
});

// Diagnostic: Meta par app-level aur page/IG-level webhook subscription kya hai.
router.get('/connections/:id/webhook-status', requireAuth, requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const conn = db.getConnection(id);
  if (!conn) return res.status(404).json({ error: 'Connection not found' });

  const out = {
    connection: {
      id: conn.id,
      channel: conn.channel,
      account_id: conn.accountId,
      app_id: conn.appId,
      api_host: conn.apiHost,
    },
  };

  try {
    if (conn.channel === 'telegram') {
      const info = await telegramApi(conn.token, 'getWebhookInfo', {});
      out.telegram_webhook = info.ok ? info.data : { error: info.error };
    }
    if (conn.channel === 'facebook' || conn.channel === 'instagram') {
      const host = conn.apiHost === 'instagram' ? 'instagram' : 'facebook';
      const url =
        `${graphUrl(host, `${conn.accountId}/subscribed_apps`)}` +
        `?access_token=${encodeURIComponent(conn.token)}`;
      const r = await fetch(url);
      out.account_subscribed_apps = await r.json().catch(() => ({}));
    }
    if (conn.appId && conn.appSecret) {
      const appToken = `${conn.appId}|${conn.appSecret}`;
      const url =
        `${graphUrl('facebook', `${conn.appId}/subscriptions`)}` +
        `?access_token=${encodeURIComponent(appToken)}`;
      const r = await fetch(url);
      out.app_subscriptions = await r.json().catch(() => ({}));

      // Token kis app ka hai + expire kab hoga (host mismatch / galat app
      // diagnose karne ke liye).
      const dbgUrl =
        `${graphUrl('facebook', 'debug_token')}` +
        `?input_token=${encodeURIComponent(conn.token)}` +
        `&access_token=${encodeURIComponent(appToken)}`;
      const dbg = await fetch(dbgUrl);
      out.token_debug = await dbg.json().catch(() => ({}));
    }
  } catch (e) {
    out.error = e.message;
  }

  res.json(out);
});

// Ek short-lived USER token (Graph API Explorer se) ko long-lived page token
// me convert karta hai, sab Facebook/Instagram connections par apply karta hai,
// phir dono ko webhook par subscribe kar deta hai. User ko sirf ek token paste
// karna hota hai - baqi sab server khud karta hai.
router.post('/connections/refresh-page-token', requireAuth, requireOwner, async (req, res) => {
  const body = req.body || {};
  const userToken = String(body.user_token || '').trim();
  if (!userToken) return res.status(400).json({ error: 'user_token required' });
  if (!config.appId || !config.appSecret) {
    return res.status(400).json({ error: 'APP_ID / APP_SECRET server env me set nahi hai' });
  }

  const callbackUrl =
    String(body.callback_url || '').trim() || `https://${req.get('host')}/webhook`;

  try {
    // 1) short-lived user token -> long-lived user token (60 din)
    const exchangeUrl =
      `${graphUrl('facebook', 'oauth/access_token')}` +
      `?grant_type=fb_exchange_token` +
      `&client_id=${encodeURIComponent(config.appId)}` +
      `&client_secret=${encodeURIComponent(config.appSecret)}` +
      `&fb_exchange_token=${encodeURIComponent(userToken)}`;
    const exchange = await (await fetch(exchangeUrl)).json().catch(() => ({}));
    if (exchange.error || !exchange.access_token) {
      return res.status(400).json({
        step: 'exchange',
        error: (exchange.error && exchange.error.message) || 'Token exchange failed',
      });
    }

    // 2) user ke pages + unke long-lived page tokens
    const pagesUrl =
      `${graphUrl('facebook', 'me/accounts')}` +
      `?fields=id,name,access_token&limit=100` +
      `&access_token=${encodeURIComponent(exchange.access_token)}`;
    const pagesData = await (await fetch(pagesUrl)).json().catch(() => ({}));
    if (pagesData.error) {
      return res.status(400).json({ step: 'accounts', error: pagesData.error.message });
    }
    const pages = Array.isArray(pagesData.data) ? pagesData.data : [];
    if (!pages.length) {
      return res.status(400).json({
        step: 'accounts',
        error: 'Is token me koi Facebook Page nahi mila (pages_show_list permission check karein)',
      });
    }

    const wantedPageId = String(body.page_id || config.pageId || '').trim();
    const page =
      pages.find((p) => p.id === wantedPageId && p.access_token) ||
      pages.find((p) => p.access_token) ||
      pages[0];
    if (!page || !page.access_token) {
      return res.status(400).json({ step: 'accounts', error: 'Page access token nahi mila' });
    }

    // 3) Page se linked Instagram business account id nikaalo (agar hai)
    let igAccountId = null;
    try {
      const igUrl =
        `${graphUrl('facebook', page.id)}` +
        `?fields=instagram_business_account{id,username}` +
        `&access_token=${encodeURIComponent(page.access_token)}`;
      const igData = await (await fetch(igUrl)).json().catch(() => ({}));
      if (igData.instagram_business_account && igData.instagram_business_account.id) {
        igAccountId = igData.instagram_business_account.id;
      }
    } catch {
      /* IG linked nahi hai to skip */
    }

    // 4) Sab FB/IG connections ko naye page token par shift karo
    const applied = [];
    for (const conn of db.listConnections()) {
      if (conn.channel === 'facebook') {
        db.updateConnection(conn.id, { token: page.access_token, apiHost: 'facebook' });
        applied.push(conn.id);
      } else if (conn.channel === 'instagram') {
        const patch = { token: page.access_token, apiHost: 'facebook' };
        if (igAccountId) patch.accountId = igAccountId;
        db.updateConnection(conn.id, patch);
        applied.push(conn.id);
      }
    }
    broadcast('connections', {});

    // 5) Webhook subscribe (account-level + app-level)
    const subscriptions = [];
    for (const id of applied) {
      const conn = db.getConnection(id);
      if (!conn) continue;
      const account = await subscribeAccount(conn.channel, conn);
      const hook = await subscribeWebhook(conn.channel, conn, callbackUrl);
      subscriptions.push({
        id,
        channel: conn.channel,
        account_linked: account.ok ? account.success : false,
        account_error: account.ok ? null : account.error,
        webhook: hook.ok ? hook.message : null,
        webhook_error: hook.ok ? null : hook.error,
      });
    }

    res.json({
      ok: true,
      page: { id: page.id, name: page.name },
      instagram_account_id: igAccountId,
      updated_connections: applied,
      subscriptions,
      // Render env update ke liye (owner-only route). Default response me token
      // nahi jata.
      ...(body.reveal ? { page_token: page.access_token } : {}),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Debug: Meta se aaye last webhook payloads (owner-only). Isse pata chalta hai
// ke Instagram messages server tak pahunch rahe hain ya nahi.
router.get('/webhook/events', requireAuth, requireOwner, (_req, res) => {
  res.json({ events: webhooklog.list() });
});

// Pehli se maujood (old) Facebook/Instagram conversations inbox me import karo.
// Meta poori history nahi deta, lekin conversations list + last message
// (snippet) mil jata hai - isi se old chats chat-column me dikhne lagti hain.
router.post('/connections/:id/sync', requireAuth, requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const conn = db.getConnection(id);
  if (!conn) return res.status(404).json({ error: 'Connection not found' });
  if (conn.channel === 'telegram') {
    return res.status(400).json({
      error: 'Telegram me purani chats import nahi hoti - bot sirf naye messages receive karta hai.',
    });
  }

  const result = await syncConnection(conn);
  const status = result.error ? 400 : 200;
  res.status(status).json({ ok: !result.error, result });
});

// -------------------------------------------------------------- admin: agents
// Admin sirf agents bana sakta hai; admin banane ke liye owner hona zaroori hai.
router.post('/auth/agents', requireAuth, requireAdmin, (req, res) => {
  const { name, email, password, role } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: 'name, email, password required' });

  const requestedRole = role === undefined || role === null || role === '' ? 'agent' : String(role);
  if (!['agent', 'admin'].includes(requestedRole)) {
    return res.status(400).json({ error: "role must be 'agent' or 'admin'" });
  }
  if (requestedRole === 'admin' && req.agent.role !== 'owner') {
    return res.status(403).json({ error: 'Only the owner can create admins' });
  }

  const normalizedEmail = String(email).toLowerCase().trim();
  if (db.findAgentByEmail(normalizedEmail)) {
    return res.status(409).json({ error: 'Email already exists' });
  }
  res.json({ agent: db.createAgent(name, normalizedEmail, password, requestedRole) });
});

// Saved connection ko API se bhejne se pehle token chhupa do.
function toPublic(conn) {
  if (!conn) return null;
  const list = db.listConnections();
  return list.find((c) => c.id === conn.id) || null;
}

router.delete('/auth/agents/:id', requireAuth, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (id === req.agent.id) return res.status(400).json({ error: 'Cannot delete your own account' });

  const target = db.findAgentById(id);
  if (!target) return res.status(404).json({ error: 'Agent not found' });
  if (target.role === 'owner') {
    return res.status(403).json({ error: 'Owner account cannot be deleted' });
  }
  if (target.role === 'admin' && req.agent.role !== 'owner') {
    return res.status(403).json({ error: 'Only the owner can delete admins' });
  }

  db.deleteAgent(id);
  broadcast('agents', {});
  res.json({ ok: true });
});

router.patch('/auth/agents/:id', requireAuth, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const agent = db.findAgentById(id);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });

  const body = req.body || {};

  if (agent.role === 'owner' && req.agent.role !== 'owner') {
    return res.status(403).json({ error: 'Only the owner can modify the owner account' });
  }

  // Role change sirf owner kar sakta hai. Owner khud ka role nahi badal sakta
  // (warna system bina owner ke reh jayega) aur kisi owner ko demote nahi kar sakta.
  if (body.role !== undefined) {
    if (req.agent.role !== 'owner') {
      return res.status(403).json({ error: 'Only the owner can change roles' });
    }
    if (!['agent', 'admin'].includes(body.role)) {
      return res.status(400).json({ error: "role must be 'agent' or 'admin'" });
    }
    if (agent.role === 'owner') {
      return res.status(400).json({ error: 'Owner role cannot be changed' });
    }
    if (agent.id === req.agent.id) {
      return res.status(400).json({ error: 'Cannot change your own role' });
    }
    db.setAgentRole(id, body.role);
  }

  if (body.photo !== undefined) {
    db.setAgentPhoto(id, body.photo || '');
  }

  broadcast('agents', {});
  res.json({ agent: db.findAgentById(id) });
});

module.exports = { router, requireAuth };