const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const bcrypt = require('bcryptjs');
const config = require('./config');
const { encrypt, decrypt, mask } = require('./services/crypto');

fs.mkdirSync(path.dirname(config.dbFile), { recursive: true });
const db = new DatabaseSync(config.dbFile);

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS agents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel TEXT NOT NULL,
  external_id TEXT NOT NULL,
  contact_name TEXT NOT NULL DEFAULT 'Unknown',
  status TEXT NOT NULL DEFAULT 'open',
  assigned_agent_id INTEGER REFERENCES agents(id),
  unread INTEGER NOT NULL DEFAULT 0,
  last_message_at INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT 0,
  UNIQUE(channel, external_id)
);

CREATE INDEX IF NOT EXISTS idx_conv_channel ON conversations(channel);
CREATE INDEX IF NOT EXISTS idx_conv_status ON conversations(status);
CREATE INDEX IF NOT EXISTS idx_conv_last_msg ON conversations(last_message_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  direction TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT 'text',
  meta_id TEXT,
  agent_id INTEGER REFERENCES agents(id),
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id, created_at);

CREATE TABLE IF NOT EXISTS connections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel TEXT NOT NULL,
  name TEXT NOT NULL,
  app_id TEXT,
  app_secret_enc TEXT,
  account_id TEXT,
  token_enc TEXT,
  verify_token_enc TEXT,
  api_host TEXT NOT NULL DEFAULT 'facebook',
  extra TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_conn_channel ON connections(channel, enabled);
`);

// -------------------------------------------------- additive migrations
const agentCols = db.prepare('PRAGMA table_info(agents)').all().map((c) => c.name);
if (!agentCols.includes('role')) {
  db.exec(`ALTER TABLE agents ADD COLUMN role TEXT NOT NULL DEFAULT 'agent'`);
}
if (!agentCols.includes('photo')) {
  db.exec(`ALTER TABLE agents ADD COLUMN photo TEXT`);
}
const convCols = db.prepare('PRAGMA table_info(conversations)').all().map((c) => c.name);
if (!convCols.includes('note')) {
  db.exec(`ALTER TABLE conversations ADD COLUMN note TEXT`);
}
if (!convCols.includes('photo')) {
  db.exec(`ALTER TABLE conversations ADD COLUMN photo TEXT`);
}
const msgCols = db.prepare('PRAGMA table_info(messages)').all().map((c) => c.name);
if (!msgCols.includes('media_type')) {
  db.exec(`ALTER TABLE messages ADD COLUMN media_type TEXT`);
}
if (!msgCols.includes('media_url')) {
  db.exec(`ALTER TABLE messages ADD COLUMN media_url TEXT`);
}
if (!msgCols.includes('sender')) {
  db.exec(`ALTER TABLE messages ADD COLUMN sender TEXT DEFAULT 'customer'`);
}
if (!msgCols.includes('reply_to_id')) {
  db.exec(`ALTER TABLE messages ADD COLUMN reply_to_id INTEGER`);
}
// "Edit" feature: Meta already-sent message ko badal nahi sakta, is liye
// corrected text naya message ban kar jata hai aur purana message yahan mark
// ho jata hai (UI par "(edited)" dikhta hai).
if (!msgCols.includes('edited_at')) {
  db.exec(`ALTER TABLE messages ADD COLUMN edited_at INTEGER`);
}
if (!msgCols.includes('superseded_by')) {
  db.exec(`ALTER TABLE messages ADD COLUMN superseded_by INTEGER`);
}
if (!convCols.includes('connection_id')) {
  db.exec(`ALTER TABLE conversations ADD COLUMN connection_id INTEGER REFERENCES connections(id)`);
}
db.prepare(`UPDATE agents SET role = 'admin' WHERE email = ? AND role != 'owner'`).run(config.adminEmail);

// Purani Instagram connections jinme Facebook Login token (EAA...) hai lekin
// api_host 'instagram' set hai - unhe graph.facebook.com par shift karo.
try {
  const igRows = db
    .prepare("SELECT id, token_enc FROM connections WHERE channel = 'instagram' AND api_host = 'instagram'")
    .all();
  for (const row of igRows) {
    const token = decrypt(row.token_enc);
    if (token && !token.startsWith('IGAA')) {
      db.prepare("UPDATE connections SET api_host = 'facebook' WHERE id = ?").run(row.id);
      console.log(`[db] Instagram connection ${row.id} ko facebook host par shift kiya`);
    }
  }
} catch (e) {
  console.warn(`[db] instagram api_host migration fail: ${e.message}`);
}

const now = () => Math.floor(Date.now() / 1000);

// ---------------------------------------------------------------- agents
function seedAdmin() {
  const existing = db.prepare('SELECT id FROM agents LIMIT 1').get();
  if (existing) return;
  const hash = bcrypt.hashSync(config.adminPassword, 10);
  db.prepare("INSERT INTO agents (email, name, role, password_hash) VALUES (?, ?, 'admin', ?)")
    .run(config.adminEmail, config.adminName, hash);
  console.log(`[db] Seeded admin agent: ${config.adminEmail} (password: ${config.adminPassword})`);
}

// Owner alag account hota hai. Agar OWNER_EMAIL wala agent pehle se hai to usko
// owner bana dete hain, warna naya bana dete hain. Koi owner maujood ho to
// dobara nahi banate (taake role badalne par duplicate na bane).
function seedOwner() {
  const existingOwner = db.prepare("SELECT id FROM agents WHERE role = 'owner' LIMIT 1").get();
  if (existingOwner) return;

  const byEmail = findAgentByEmail(config.ownerEmail);
  if (byEmail) {
    db.prepare("UPDATE agents SET role = 'owner' WHERE id = ?").run(byEmail.id);
    console.log(`[db] Promoted ${config.ownerEmail} to owner`);
    return;
  }

  const hash = bcrypt.hashSync(config.ownerPassword, 10);
  db.prepare("INSERT INTO agents (email, name, role, password_hash) VALUES (?, ?, 'owner', ?)")
    .run(config.ownerEmail, config.ownerName, hash);
  console.log(`[db] Seeded owner agent: ${config.ownerEmail} (password: ${config.ownerPassword})`);
}

function findAgentByEmail(email) {
  return db.prepare('SELECT * FROM agents WHERE email = ?').get(email);
}

function findAgentById(id) {
  return db.prepare('SELECT id, email, name, role, photo, created_at FROM agents WHERE id = ?').get(id);
}

function listAgents() {
  return db.prepare('SELECT id, email, name, role, photo, created_at FROM agents ORDER BY name').all();
}

function setAgentPhoto(id, photo) {
  db.prepare('UPDATE agents SET photo = ? WHERE id = ?').run(photo && photo.trim() ? photo.trim() : null, id);
  return findAgentById(id);
}

function createAgent(name, email, password, role = 'agent') {
  const safeRole = role === 'admin' ? 'admin' : 'agent';
  const hash = bcrypt.hashSync(password, 10);
  const r = db.prepare('INSERT INTO agents (email, name, role, password_hash) VALUES (?, ?, ?, ?)')
    .run(email, name, safeRole, hash);
  return findAgentById(Number(r.lastInsertRowid));
}

// Role change sirf owner karta hai (api.js mein enforce hota hai).
function setAgentRole(id, role) {
  const safeRole = role === 'admin' ? 'admin' : 'agent';
  db.prepare('UPDATE agents SET role = ? WHERE id = ?').run(safeRole, id);
  return findAgentById(id);
}

function countOwners() {
  return db.prepare("SELECT count(*) AS n FROM agents WHERE role = 'owner'").get().n;
}

function deleteAgent(id) {
  db.prepare('UPDATE conversations SET assigned_agent_id = NULL WHERE assigned_agent_id = ?').run(id);
  db.prepare('UPDATE messages SET agent_id = NULL WHERE agent_id = ?').run(id);
  return db.prepare('DELETE FROM agents WHERE id = ?').run(id);
}

// ------------------------------------------------------- connections
// Connection = aik channel ka aik live account (page / IG account / WA number).
// Tokens encrypt karke rakhe jate hain; UI ko sirf masked copy jata hai.

const CONNECTION_FIELDS =
  'id, channel, name, app_id, account_id, api_host, extra, enabled, created_at, updated_at';

// UI ke liye: secrets decrypt karke masked bhejte hain (koi token leak na ho).
function publicConnection(row) {
  if (!row) return null;
  const token = decrypt(row.token_enc);
  const appSecret = decrypt(row.app_secret_enc);
  const verifyToken = decrypt(row.verify_token_enc);
  let extra = {};
  try {
    extra = JSON.parse(row.extra || '{}');
  } catch {
    extra = {};
  }
  return {
    id: row.id,
    channel: row.channel,
    name: row.name,
    app_id: row.app_id || null,
    account_id: row.account_id || null,
    api_host: row.api_host,
    enabled: !!row.enabled,
    extra,
    created_at: row.created_at,
    updated_at: row.updated_at,
    has_token: !!token,
    token_masked: mask(token),
    has_app_secret: !!appSecret,
    app_secret_masked: mask(appSecret, { head: 4, tail: 2 }),
    has_verify_token: !!verifyToken,
    verify_token_masked: verifyToken || null, // yeh user khud banata hai, secret nahi
    missing: ['token'].filter((k) => !token),
  };
}

// Server ke andar use: asli (decrypted) values.
function resolvedConnection(row) {
  if (!row) return null;
  let extra = {};
  try {
    extra = JSON.parse(row.extra || '{}');
  } catch {
    extra = {};
  }
  return {
    id: row.id,
    channel: row.channel,
    name: row.name,
    appId: row.app_id || '',
    appSecret: decrypt(row.app_secret_enc) || '',
    accountId: row.account_id || '',
    token: decrypt(row.token_enc) || '',
    verifyToken: decrypt(row.verify_token_enc) || '',
    apiHost: row.api_host || 'facebook',
    enabled: !!row.enabled,
    extra,
  };
}

function countConversations() {
  return db.prepare('SELECT count(*) AS n FROM conversations').get().n;
}

function listConnections() {
  return db
    .prepare(`SELECT * FROM connections ORDER BY channel, created_at`)
    .all()
    .map(publicConnection);
}

function getConnection(id) {
  return resolvedConnection(db.prepare('SELECT * FROM connections WHERE id = ?').get(id));
}

function getConnectionRow(id) {
  return db.prepare('SELECT * FROM connections WHERE id = ?').get(id);
}

function createConnection(input) {
  const t = now();
  const r = db
    .prepare(
      `INSERT INTO connections
        (channel, name, app_id, app_secret_enc, account_id, token_enc, verify_token_enc, api_host, extra, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.channel,
      input.name,
      input.appId || null,
      encrypt(input.appSecret),
      input.accountId || null,
      encrypt(input.token),
      encrypt(input.verifyToken),
      input.apiHost || 'facebook',
      JSON.stringify(input.extra || {}),
      input.enabled === false ? 0 : 1,
      t,
      t
    );
  return getConnection(Number(r.lastInsertRowid));
}

// PATCH: sirf bheji hui fields update hoti hain. Token bheja gaya to replace,
// warna purana encrypted value waise hi rehta hai (UI se masked value aata hai).
function updateConnection(id, patch) {
  const current = getConnectionRow(id);
  if (!current) return null;

  const fields = [];
  const params = [];
  const put = (col, value) => {
    fields.push(`${col} = ?`);
    params.push(value);
  };

  if (patch.name !== undefined) put('name', patch.name);
  if (patch.appId !== undefined) put('app_id', patch.appId || null);
  if (patch.appSecret) put('app_secret_enc', encrypt(patch.appSecret));
  if (patch.accountId !== undefined) put('account_id', patch.accountId || null);
  if (patch.token) put('token_enc', encrypt(patch.token));
  if (patch.verifyToken !== undefined) {
    put('verify_token_enc', patch.verifyToken ? encrypt(patch.verifyToken) : null);
  }
  if (patch.apiHost !== undefined) put('api_host', patch.apiHost || 'facebook');
  if (patch.extra !== undefined) put('extra', JSON.stringify(patch.extra || {}));
  if (patch.enabled !== undefined) put('enabled', patch.enabled ? 1 : 0);

  fields.push('updated_at = ?');
  params.push(now());
  params.push(id);

  db.prepare(`UPDATE connections SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  return getConnection(id);
}

function deleteConnection(id) {
  db.prepare('UPDATE conversations SET connection_id = NULL WHERE connection_id = ?').run(id);
  return db.prepare('DELETE FROM connections WHERE id = ?').run(id);
}

// Channel ka wo account jiska webhook payload is conversation se aaya.
// Pehle account_id exact match, warna channel ka pehla enabled connection.
function findConnectionForChannel(channel, accountId) {
  if (accountId) {
    const byAccount = db
      .prepare('SELECT * FROM connections WHERE channel = ? AND account_id = ? AND enabled = 1 LIMIT 1')
      .get(channel, String(accountId));
    if (byAccount) return resolvedConnection(byAccount);
  }
  const first = db
    .prepare('SELECT * FROM connections WHERE channel = ? AND enabled = 1 ORDER BY id LIMIT 1')
    .get(channel);
  return first ? resolvedConnection(first) : null;
}

// Ye list webhook.js ko chahiye: har app secret signature verify karne ke liye,
// aur har verify token GET handshake accept karne ke liye.
function listAllVerifyTokens() {
  const tokens = db
    .prepare('SELECT verify_token_enc FROM connections WHERE enabled = 1 AND verify_token_enc IS NOT NULL')
    .all()
    .map((r) => decrypt(r.verify_token_enc))
    .filter(Boolean);
  return [...new Set(tokens)];
}

function listAllAppSecrets() {
  const secrets = db
    .prepare('SELECT app_secret_enc FROM connections WHERE enabled = 1 AND app_secret_enc IS NOT NULL')
    .all()
    .map((r) => decrypt(r.app_secret_enc))
    .filter(Boolean);
  return [...new Set(secrets)];
}

// ------------------------------------------------------- conversations
function findOrCreateConversation({ channel, externalId, contactName, photo, connectionId }) {
  const existing = db.prepare(
    'SELECT * FROM conversations WHERE channel = ? AND external_id = ?'
  ).get(channel, externalId);

  if (existing) {
    if (contactName && contactName !== existing.contact_name) {
      db.prepare('UPDATE conversations SET contact_name = ? WHERE id = ?')
        .run(contactName, existing.id);
    }
    if (photo && photo !== existing.photo) {
      db.prepare('UPDATE conversations SET photo = ? WHERE id = ?')
        .run(photo, existing.id);
    }
    // Purani conversations (jo .env se bani) ab UI-added connection se attach ho jati hain
    if (connectionId && !existing.connection_id) {
      db.prepare('UPDATE conversations SET connection_id = ? WHERE id = ?')
        .run(connectionId, existing.id);
    }
    return db.prepare('SELECT * FROM conversations WHERE id = ?').get(existing.id);
  }

  const t = now();
  db.prepare(
    `INSERT INTO conversations (channel, external_id, contact_name, photo, connection_id, created_at, last_message_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(channel, externalId, contactName || 'Unknown', photo || null, connectionId || null, t, t);

  return db.prepare('SELECT * FROM conversations WHERE channel = ? AND external_id = ?')
    .get(channel, externalId);
}

const CONVERSATION_FIELDS = `c.id, c.channel, c.external_id, c.contact_name, c.status, c.note, c.photo,
  c.unread, c.last_message_at, c.created_at, c.connection_id,
  cn.name AS connection_name,
  a.id AS assigned_agent_id, a.name AS assigned_agent_name,
  (SELECT body FROM messages m WHERE m.conversation_id = c.id AND m.sender != 'note' ORDER BY m.id DESC LIMIT 1) AS last_message`;

function listConversations({ status, channel, unread, limit = 200 } = {}) {
  const conditions = [];
  const params = [];
  if (status && status !== 'all') {
    conditions.push('c.status = ?');
    params.push(status);
  }
  if (channel && channel !== 'all') {
    conditions.push('c.channel = ?');
    params.push(channel);
  }
  if (unread) {
    conditions.push('c.unread > 0');
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(Math.min(Number(limit) || 200, 500));

  return db.prepare(
    `SELECT ${CONVERSATION_FIELDS}
     FROM conversations c
     LEFT JOIN agents a ON a.id = c.assigned_agent_id
     LEFT JOIN connections cn ON cn.id = c.connection_id
     ${where}
     ORDER BY c.last_message_at DESC
     LIMIT ?`
  ).all(...params);
}

function getConversation(id) {
  return db.prepare(
    `SELECT ${CONVERSATION_FIELDS}
     FROM conversations c
     LEFT JOIN agents a ON a.id = c.assigned_agent_id
     LEFT JOIN connections cn ON cn.id = c.connection_id
     WHERE c.id = ?`
  ).get(id);
}

function setConversationStatus(id, status) {
  db.prepare('UPDATE conversations SET status = ? WHERE id = ?').run(status, id);
  return getConversation(id);
}

function setConversationAgent(id, agentId) {
  db.prepare('UPDATE conversations SET assigned_agent_id = ? WHERE id = ?').run(agentId, id);
  return getConversation(id);
}

function setConversationNote(id, note) {
  db.prepare('UPDATE conversations SET note = ? WHERE id = ?').run(note && note.trim() ? note.trim() : null, id);
  return getConversation(id);
}

function markConversationRead(id) {
  db.prepare('UPDATE conversations SET unread = 0 WHERE id = ?').run(id);
}

function reopenIfResolved(id) {
  db.prepare(
    "UPDATE conversations SET status = 'open' WHERE id = ? AND status IN ('resolved','pending')"
  ).run(id);
}

function incrementUnread(id, skip) {
  if (skip) return;
  db.prepare('UPDATE conversations SET unread = unread + 1 WHERE id = ?').run(id);
}

// ------------------------------------------------------------ messages
function addMessage({ conversationId, direction, body, type = 'text', metaId = null, agentId = null, mediaType = null, mediaUrl = null, sender = null, replyToId = null, touchConversation = true, createdAt = null }) {
  const t = createdAt || now();
  const r = db.prepare(
    `INSERT INTO messages (conversation_id, direction, body, type, meta_id, agent_id, media_type, media_url, sender, reply_to_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(conversationId, direction, body, type, metaId, agentId, mediaType, mediaUrl, sender || (direction === 'outbound' ? 'agent' : 'customer'), replyToId, t);

  if (touchConversation) {
    db.prepare('UPDATE conversations SET last_message_at = ? WHERE id = ?').run(t, conversationId);
  }
  const row = db.prepare('SELECT * FROM messages WHERE id = ?').get(Number(r.lastInsertRowid));
  if (row.reply_to_id) {
    const quoted = db.prepare('SELECT id, body, sender, media_type, media_url FROM messages WHERE id = ?').get(row.reply_to_id);
    row.reply_to = quoted
      ? { id: quoted.id, sender: quoted.sender, body: quoted.body || '', media_type: quoted.media_type || null, media_url: quoted.media_url || null }
      : { id: row.reply_to_id, sender: null, body: '', media_type: null, media_url: null };
  }
  return row;
}

// Private note: lives inside the conversation's message thread but is never
// rendered to the customer (sender = 'note'). Notes must NOT bump last_message_at.
function addNoteMessage({ conversationId, body = '', type = 'text', mediaType = null, mediaUrl = null, agentId = null }) {
  const t = now();
  const r = db.prepare(
    `INSERT INTO messages (conversation_id, direction, body, type, media_type, media_url, sender, agent_id, created_at)
     VALUES (?, 'note', ?, ?, ?, ?, 'note', ?, ?)`
  ).run(conversationId, body, type, mediaType, mediaUrl, agentId, t);
  return db.prepare('SELECT * FROM messages WHERE id = ?').get(Number(r.lastInsertRowid));
}

function getNoteMessage(messageId) {
  return db.prepare(`SELECT * FROM messages WHERE id = ? AND sender = 'note'`).get(messageId);
}

function deleteNoteMessage(messageId) {
  return db.prepare(`DELETE FROM messages WHERE id = ? AND sender = 'note'`).run(messageId);
}

function listMessages(conversationId) {
  const rows = db.prepare(
    `SELECT m.*, a.name AS agent_name,
            r.id AS r_id, r.body AS r_body, r.sender AS r_sender,
            r.media_type AS r_media_type, r.media_url AS r_media_url
     FROM messages m
     LEFT JOIN agents a ON a.id = m.agent_id
     LEFT JOIN messages r ON r.id = m.reply_to_id
     WHERE m.conversation_id = ?
     ORDER BY m.id ASC`
  ).all(conversationId);

  return rows.map((row) => {
    const message = { ...row };
    delete message.r_id;
    delete message.r_body;
    delete message.r_sender;
    delete message.r_media_type;
    delete message.r_media_url;
    if (row.reply_to_id) {
      if (row.r_id) {
        message.reply_to = {
          id: row.r_id,
          sender: row.r_sender,
          body: row.r_body || '',
          media_type: row.r_media_type || null,
          media_url: row.r_media_url || null,
        };
      } else {
        message.reply_to = { id: row.reply_to_id, sender: null, body: '', media_type: null, media_url: null };
      }
    }
    return message;
  });
}

function getMessage(id) {
  return db.prepare('SELECT * FROM messages WHERE id = ?').get(id);
}

// Purane message ko "edited" mark karo. Naya (corrected) message alag row hota
// hai; superseded_by us naye message ki id rakhta hai.
function markMessageEdited(id, supersededBy = null) {
  db.prepare('UPDATE messages SET edited_at = ?, superseded_by = ? WHERE id = ?')
    .run(now(), supersededBy, id);
  return db.prepare('SELECT * FROM messages WHERE id = ?').get(id);
}

function findMessageByMetaId(metaId, conversationId) {
  if (!metaId) return null;
  return db
    .prepare('SELECT * FROM messages WHERE meta_id = ? AND conversation_id = ? LIMIT 1')
    .get(metaId, conversationId);
}

function hasMessages(conversationId) {
  return db
    .prepare("SELECT count(*) AS n FROM messages WHERE conversation_id = ? AND sender != 'note'")
    .get(conversationId).n > 0;
}

function setConversationTimestamps(id, { lastMessageAt, createdAt } = {}) {
  if (lastMessageAt) {
    db.prepare('UPDATE conversations SET last_message_at = ? WHERE id = ? AND ? > last_message_at')
      .run(lastMessageAt, id, lastMessageAt);
  }
  if (createdAt) {
    db.prepare('UPDATE conversations SET created_at = ? WHERE id = ? AND created_at = 0')
      .run(createdAt, id);
  }
}

module.exports = {
  db,
  seedAdmin,
  seedOwner,
  findAgentByEmail,
  findAgentById,
  listAgents,
  createAgent,
  setAgentRole,
  countOwners,
  deleteAgent,
  setAgentPhoto,
  listConnections,
  countConversations,
  getConnection,
  createConnection,
  updateConnection,
  deleteConnection,
  findConnectionForChannel,
  listAllVerifyTokens,
  listAllAppSecrets,
  findOrCreateConversation,
  listConversations,
  getConversation,
  setConversationStatus,
  setConversationAgent,
  setConversationNote,
  markConversationRead,
  reopenIfResolved,
  incrementUnread,
  addMessage,
  addNoteMessage,
  getNoteMessage,
  deleteNoteMessage,
  listMessages,
  getMessage,
  markMessageEdited,
  findMessageByMetaId,
  hasMessages,
  setConversationTimestamps,
  now,
};