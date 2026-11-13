const crypto = require('node:crypto');
const express = require('express');
const config = require('./config');
const db = require('./db');
const { resolveContact } = require('./services/userinfo');
const { saveUpload } = require('./services/uploads');
const { telegramApi, secretForToken, fileUrl } = require('./services/telegram');
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

// Messenger emoji/sticker messages ke saath kabhi kabhi profile picture ka CDN
// URL attachments me bhej deta hai. Usay media samajh kar store karne se chat
// me lamba "📄 https://scontent...stp=cp0_dst-jpg...&_nc_cat=1" link aa jata
// tha. Aise URL user ki bheji hui file nahi hote.
function looksLikeProfilePicUrl(url) {
  const value = String(url || '');
  if (!value) return false;
  // Note: `_nc_cat` ko akela filter nahi karte - wo asli images me bhi hota
  // hai. Profile pic ki pehchan `stp=cp0_dst-jpg` (crop) / lookaside host hai.
  return (
    /stp=cp0_dst-jpg/i.test(value) ||
    /platform-lookaside\.fbsbx\.com/i.test(value) ||
    /lookaside\.fbsbx\.com/i.test(value)
  );
}

const MEDIA_ATTACHMENT_TYPES = new Set(['image', 'video', 'audio', 'file', 'sticker']);

// Sirf wo attachments jinme waqai koi media file ho. share/template/fallback
// jaise types ke sath sirf link ya metadata aata hai, file nahi.
function realMessagingAttachments(msg) {
  const list = Array.isArray(msg.attachments) ? msg.attachments : [];
  return list.filter((attach) => {
    const type = String((attach && attach.type) || '').toLowerCase();
    const url = (attach && attach.payload && attach.payload.url) || '';
    if (!MEDIA_ATTACHMENT_TYPES.has(type)) return false;
    if (looksLikeProfilePicUrl(url)) return false;
    return Boolean(url);
  });
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

  const rawAttachments = Array.isArray(msg.attachments) ? msg.attachments : [];
  const attachments = realMessagingAttachments(msg);
  const hasMedia = attachments.length > 0;

  // Media workflows
  if (hasMedia) {
    let replyToId = null;
    if (msg.reply_to && msg.reply_to.mid) {
      const quoted = db.findMessageByMetaId(msg.reply_to.mid, conversation.id);
      if (quoted) replyToId = quoted.id;
    }
    attachments.forEach((attach, i) => {
      const attachType = String(attach.type || '').toLowerCase();
      // Stickers images hote hain - inhe image ki tarah render karo, warna
      // client "📄 <url>" ki tarah dikhata hai.
      const mediaType = attachType === 'sticker' ? 'image' : attachType || 'document';
      const record = db.addMessage({
        conversationId: conversation.id,
        direction: 'inbound',
        body: i === 0 && msg.text ? msg.text : '',
        type: attachType && attachType !== 'file' ? attachType : 'document',
        metaId: msg.mid || null,
        mediaType,
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

  // Jo attachments media nahi the (profile pic / share / fallback) unhe body
  // se hata do - warna `[Attachment: image]` jaisa bekaar label aa jata hai.
  let body = messageBodyFromMessagingEvent({ ...msg, attachments });
  if (body === null && rawAttachments.length) {
    const t = String(rawAttachments[0].type || '').toLowerCase();
    body = t === 'share' ? '[shared post]' : t === 'story_mention' ? '[story mention]' : '[attachment]';
  }
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

// --------------------------------------------------------------- Telegram
// Telegram update me message.photo/video/document etc. hote hain. Sab se bara
// photo size last hota hai.
function telegramMediaFromMessage(msg) {
  if (Array.isArray(msg.photo) && msg.photo.length) {
    const photo = msg.photo[msg.photo.length - 1];
    return {
      type: 'image',
      mediaType: 'image',
      fileId: photo.file_id,
      mime: 'image/jpeg',
      placeholder: '[Photo]',
      fileName: `telegram-photo-${msg.message_id}.jpg`,
    };
  }
  if (msg.video) {
    return {
      type: 'video',
      mediaType: 'video',
      fileId: msg.video.file_id,
      mime: msg.video.mime_type || 'video/mp4',
      placeholder: '[Video]',
      fileName: msg.video.file_name || `telegram-video-${msg.message_id}.mp4`,
    };
  }
  if (msg.animation) {
    return {
      type: 'video',
      mediaType: 'video',
      fileId: msg.animation.file_id,
      mime: msg.animation.mime_type || 'video/mp4',
      placeholder: '[Animation]',
      fileName: msg.animation.file_name || `telegram-animation-${msg.message_id}.mp4`,
    };
  }
  if (msg.voice) {
    return {
      type: 'audio',
      mediaType: 'audio',
      fileId: msg.voice.file_id,
      mime: msg.voice.mime_type || 'audio/ogg',
      placeholder: '[Voice message]',
      fileName: `telegram-voice-${msg.message_id}.ogg`,
    };
  }
  if (msg.audio) {
    return {
      type: 'audio',
      mediaType: 'audio',
      fileId: msg.audio.file_id,
      mime: msg.audio.mime_type || 'audio/mpeg',
      placeholder: '[Audio]',
      fileName: msg.audio.file_name || `telegram-audio-${msg.message_id}.mp3`,
    };
  }
  if (msg.sticker) {
    return {
      type: 'sticker',
      mediaType: 'image',
      fileId: msg.sticker.file_id,
      mime: 'image/webp',
      placeholder: '[Sticker]',
      fileName: `telegram-sticker-${msg.message_id}.webp`,
    };
  }
  if (msg.document) {
    return {
      type: 'document',
      mediaType: 'document',
      fileId: msg.document.file_id,
      mime: msg.document.mime_type || 'application/octet-stream',
      placeholder: '[Document]',
      fileName: msg.document.file_name || `telegram-document-${msg.message_id}`,
    };
  }
  return null;
}

// Telegram file server se download karke apne uploads (ya R2) me save karta
// hai. Bot token wala direct file URL browser ko nahi bhejte - token leak ho
// jata. Fail ho to message placeholder ke sath chala jata hai.
async function downloadTelegramMedia(token, media) {
  const info = await telegramApi(token, 'getFile', { file_id: media.fileId });
  if (!info.ok || !info.data || !info.data.file_path) {
    console.warn(`[webhook] telegram getFile fail: ${info.error || 'no file_path'}`);
    return null;
  }
  try {
    const res = await fetch(fileUrl(token, info.data.file_path), {
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    const saved = await saveUpload(buffer, media.fileName, media.mime);
    return saved.url;
  } catch (err) {
    console.warn(`[webhook] telegram media save fail: ${err.message}`);
    return null;
  }
}

async function ingestTelegram(connection, update) {
  const msg = update.message || update.channel_post;
  if (!msg) return; // edited_message, callback_query etc. abhi ignore

  const chat = msg.chat || {};
  if (!chat.id) return;

  const from = msg.from || {};
  const externalId = String(chat.id);
  const fromName = [from.first_name, from.last_name].filter(Boolean).join(' ') || from.username || '';
  // Group me sender ka naam nahi, group ka title dikhna chahiye.
  const contactName =
    chat.type === 'private' ? fromName || externalId : chat.title || fromName || externalId;

  const conversation = db.findOrCreateConversation({
    channel: 'telegram',
    externalId,
    contactName,
    connectionId: connection.id,
  });

  db.incrementUnread(conversation.id, false);
  db.reopenIfResolved(conversation.id);

  const media = telegramMediaFromMessage(msg);
  if (media) {
    const mediaUrl = await downloadTelegramMedia(connection.token, media);
    const body = msg.caption || media.placeholder;
    const record = db.addMessage({
      conversationId: conversation.id,
      direction: 'inbound',
      body,
      type: media.type,
      metaId: msg.message_id ? String(msg.message_id) : null,
      mediaType: media.mediaType,
      mediaUrl,
      sender: 'customer',
    });
    const full = db.getConversation(conversation.id);
    broadcast('message', { conversation: full, message: record });
    console.log(`[webhook] telegram <- from ${contactName}: ${body}`);
    return;
  }

  const body = msg.text || msg.caption;
  if (!body) return;

  const record = db.addMessage({
    conversationId: conversation.id,
    direction: 'inbound',
    body,
    type: 'text',
    metaId: msg.message_id ? String(msg.message_id) : null,
    sender: 'customer',
  });
  const full = db.getConversation(conversation.id);
  broadcast('message', { conversation: full, message: record });
  console.log(`[webhook] telegram <- from ${contactName}: ${body}`);
}

// Telegram webhook URL me bot token ka SHA-256 hash hota hai. DB reset hone
// par connection id badal sakti hai, lekin token/hash same rehta hai - is liye
// URL stable rehta hai. Har webhook par matching connection dhoondte hain.
function findTelegramConnectionBySecret(secret) {
  for (const row of db.listConnections()) {
    if (row.channel !== 'telegram' || !row.enabled || !row.has_token) continue;
    const conn = db.getConnection(row.id);
    if (conn && conn.token && secretForToken(conn.token) === secret) return conn;
  }
  return null;
}

// POST /webhook/telegram/:secret - Telegram bot updates. Secret token header
// se verify hota hai; URL me token hash hone se multi-bot support milta hai.
router.post(
  '/telegram/:secret',
  express.raw({ type: '*/*', limit: '25mb' }),
  async (req, res) => {
    const secret = String(req.params.secret || '');
    const connection = findTelegramConnectionBySecret(secret);
    if (!connection) return res.sendStatus(404);

    const provided = req.get('x-telegram-bot-api-secret-token') || '';
    if (provided !== secret) {
      console.warn('[webhook] telegram secret mismatch');
      return res.sendStatus(403);
    }

    let payload = req.body;
    if (Buffer.isBuffer(payload)) {
      try {
        payload = JSON.parse(payload.toString('utf8'));
      } catch {
        return res.sendStatus(400);
      }
    }
    webhooklog.add(payload, { signatureOk: true });

    // Telegram ko foran 200 chahiye, warna wohi update dobara bhejta rehta hai.
    res.status(200).send('OK');

    try {
      await ingestTelegram(connection, payload || {});
    } catch (err) {
      console.error('[webhook] telegram ingest error:', err);
    }
  }
);

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