const crypto = require('node:crypto');
const express = require('express');
const config = require('./config');
const db = require('./db');
const { resolveContact } = require('./services/userinfo');
const webhooklog = require('./services/webhooklog');
const { broadcast } = require('./realtime');

const router = express.Router();

// Secrets .env se bhi aa sakte hain aur UI-added connections se bhi. Har app
// ki apni signature hoti hai, is liye sab accept karni padti hain.
const relaxSig = process.env.WEBHOOK_SIG_RELAX === 'true';

function allSecrets() {
  const fromEnv = (config.appSecret || '').split(',').map((s) => s.trim()).filter(Boolean);
  const fromDb = db.listAllAppSecrets();
  return [...new Set([...fromEnv, ...fromDb])];
}

function allVerifyTokens() {
  return [...new Set([config.verifyToken, ...db.listAllVerifyTokens()].filter(Boolean))];
}

function verifyHubSignature(req) {
  const sig = req.get('x-hub-signature-256');
  const secrets = allSecrets();
  if (!secrets.length || !sig) return true;
  const raw = req.rawBody || JSON.stringify(req.body);
  for (const secret of secrets) {
    const expected = crypto
      .createHmac('sha256', secret)
      .update(raw)
      .digest('hex');
    if (`sha256=${expected}` === sig) return true;
  }
  if (relaxSig) {
    console.warn('[webhook] WEBHOOK_SIG_RELAX=true -> accepting without valid signature');
    return true;
  }
  return false;
}

// GET /webhook - Meta handshake when subscribing
router.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && allVerifyTokens().includes(token)) {
    console.log('[webhook] Subscription verified');
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

function messageBodyFromMessagingEvent(msg) {
  if (msg.text) return msg.text;
  if (msg.quick_reply && msg.quick_reply.payload) return msg.quick_reply.payload;
  if (msg.postback && msg.postback.payload) return msg.postback.payload;
  if (Array.isArray(msg.attachments) && msg.attachments.length) {
    return `[Attachment: ${msg.attachments[0].type || 'media'}]`;
  }
  return null;
}

// messenger-style payload (object: 'page' | 'instagram')
async function ingestMessaging(object, event, accountId) {
  const msg = event.message || event.postback || {};
  if (msg.is_echo) return; // outbound copy - ignore

  const channel = object === 'instagram' ? 'instagram' : 'facebook';

  // sender lives on the EVENT, not on event.message
  const extId = (event.sender && event.sender.id) || null;
  if (!extId) return;

  // Is page/IG account ki connection dhoondo taake reply usi token se jaye.
  // (Aik page ka token doosre page ki conversation me use nahi hoga.)
  const connection = db.findConnectionForChannel(channel, accountId);

  let info = { name: extId, photo: null };
  try {
    info = await resolveContact(channel, extId, connection && connection.id);
  } catch {
    /* keep fallback */
  }

  // Store the photo only on facebook/webhook-first contact; for instagram the
  // scoped-user node usually has no profile_pic, so photo stays null there.
  const conversation = db.findOrCreateConversation({
    channel,
    externalId: extId,
    contactName: info.name,
    photo: info.photo,
    connectionId: connection && connection.id,
  });

  db.incrementUnread(conversation.id, false);
  db.reopenIfResolved(conversation.id);

  const attachments = Array.isArray(msg.attachments) ? msg.attachments : [];
  const hasMedia = attachments.length > 0;

  // Media workflows
  if (hasMedia) {
    let replyToId = null;
    if (msg.reply_to && msg.reply_to.mid) {
      const quoted = db.findMessageByMetaId(msg.reply_to.mid, conversation.id);
      if (quoted) replyToId = quoted.id;
    }
    attachments.forEach((attach, i) => {
      const record = db.addMessage({
        conversationId: conversation.id,
        direction: 'inbound',
        body: i === 0 && msg.text ? msg.text : '',
        type: attach.type && attach.type !== 'file' ? attach.type : 'document',
        metaId: msg.mid || null,
        mediaType: attach.type || 'document',
        mediaUrl: (attach.payload && attach.payload.url) || null,
        sender: 'customer',
        replyToId,
      });
      const full = db.getConversation(conversation.id);
      broadcast('message', { conversation: full, message: record });
      console.log(`[webhook] ${channel} <- from ${info.name}: [${attach.type || 'media'}] ${record.media_url || ''}`);
    });
    return;
  }

  const body = messageBodyFromMessagingEvent(msg);
  if (body === null) return;

  // Customer replies carry a reply_to.mid — link it to the original message so
  // the quoted media/text shows in the thread.
  let replyToId = null;
  if (msg.reply_to && msg.reply_to.mid) {
    const quoted = db.findMessageByMetaId(msg.reply_to.mid, conversation.id);
    if (quoted) replyToId = quoted.id;
  }

  const record = db.addMessage({
    conversationId: conversation.id,
    direction: 'inbound',
    body,
    type: msg.sticker ? 'sticker' : 'text',
    metaId: msg.mid || null,
    sender: 'customer',
    replyToId,
  });

  const full = db.getConversation(conversation.id);
  broadcast('message', { conversation: full, message: record });
  console.log(`[webhook] ${channel} <- from ${info.name}: ${body}`);
}

function ingestWhatsApp(entry) {
  // entry.id WABA ID hota hai, hamari connection me phone number ID stored hai.
  // Is liye WABA id se match karne ki koshish karte hain, warna default.
  const accountId = entry.id;
  const connection = db.findConnectionForChannel('whatsapp', accountId);
  const ownNumber = String(
    (connection && connection.extra && connection.extra.wa_own_number) || config.waOwnNumber || ''
  ).replace(/\D/g, '');

  for (const change of entry.changes || []) {
    const value = change.value || {};
    const messages = Array.isArray(value.messages) ? value.messages : [];
    if (!messages.length) continue; // statuses / unknown

    const contacts = Array.isArray(value.contacts) ? value.contacts : [];

    for (const msg of messages) {
      const from = msg.from;
      if (!from || (ownNumber && from.replace(/\D/g, '') === ownNumber)) {
        continue; // echo of our own outbound message
      }

      const contact = contacts.find((c) => String(c.wa_id) === String(from));
      const name = (contact && contact.profile && contact.profile.name) || from;

      const conversation = db.findOrCreateConversation({
        channel: 'whatsapp',
        externalId: from,
        contactName: name,
        connectionId: connection && connection.id,
      });

      db.incrementUnread(conversation.id, false);
      db.reopenIfResolved(conversation.id);

      const body = msg.type === 'text' && msg.text
        ? msg.text.body
        : `[${msg.type || 'unknown'} attachment]`;

      const record = db.addMessage({
        conversationId: conversation.id,
        direction: 'inbound',
        body,
        type: msg.type || 'text',
        metaId: msg.id || null,
      });

      const full = db.getConversation(conversation.id);
      broadcast('message', { conversation: full, message: record });
      console.log(`[webhook] whatsapp <- from ${name} (${from}): ${body}`);
    }
  }
}

// POST /webhook - receives events from all connected Meta apps
router.post('/', express.raw({ type: ['application/json', 'application/*+json'] }), async (req, res) => {
  req.rawBody = Buffer.isBuffer(req.body) ? req.body : (req.rawBody || null);
  if (Buffer.isBuffer(req.body)) {
    try { req.body = JSON.parse(req.body.toString('utf8')); } catch (err) { return res.sendStatus(400); }
  } else if (typeof req.body === 'string') {
    try { req.body = JSON.parse(req.body); } catch (err) { return res.sendStatus(400); }
  }
  console.log(`[webhook] POST received | bytes: ${req.rawBody ? req.rawBody.length : 'n/a'} | object: ${(req.body || {}).object}`);
  const signatureOk = verifyHubSignature(req);
  webhooklog.add(req.body, { signatureOk });
  if (!signatureOk) {
    console.warn('[webhook] Bad signature');
    return res.sendStatus(403);
  }

  // Always ack immediately; Meta retries on non-2xx
  res.status(200).send('EVENT_RECEIVED');

  const payload = req.body || {};
  const object = payload.object;

  try {
    if (object === 'whatsapp_business_account') {
      for (const entry of payload.entry || []) ingestWhatsApp(entry);
    } else if (object === 'page' || object === 'instagram') {
      for (const entry of payload.entry || []) {
        // entry.id = page ID ya IG account ID: is se sahi connection milti hai
        const accountId = entry.id;
        entry.messaging = entry.messaging || [];
        for (const event of entry.messaging) {
          await ingestMessaging(object, event, accountId);
        }
      }
    } else {
      console.log(`[webhook] Unhandled object: ${object}`);
    }
  } catch (err) {
    console.error('[webhook] ingest error:', err);
  }
});

module.exports = router;