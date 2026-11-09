const fs = require('node:fs');
const path = require('node:path');
const config = require('../config');
const db = require('../db');
const { telegramApi, botUrl } = require('./telegram');

// Do credential sources hain:
//  1) UI se add ki hui connection (connections table)  -> priority
//  2) .env fallback (purana setup, abhi bhi supported)
// Conversation se linked connection pehle, warna channel ka pehla enabled
// connection, phir .env.

function resolveCredentials(channel, connectionId) {
  let conn = null;
  if (connectionId) conn = db.getConnection(connectionId);

  // Webhook ke baad is conversation ko attach nahi hua? channel ka default lo.
  if (!conn || !conn.enabled) {
    conn = db.findConnectionForChannel(channel, null) || conn;
  }

  if (conn && conn.enabled) {
    return {
      source: 'connection',
      connectionId: conn.id,
      connectionName: conn.name,
      token: conn.token || '',
      accountId: conn.accountId || '',
      appId: conn.appId || '',
      appSecret: conn.appSecret || '',
      apiHost: conn.apiHost || 'facebook',
      extra: conn.extra || {},
    };
  }

  // ---- .env fallback
  if (channel === 'facebook') {
    return {
      source: 'env',
      connectionId: null,
      token: config.pageAccessToken,
      accountId: config.pageId,
      appSecret: config.appSecret,
      apiHost: 'facebook',
      extra: {},
    };
  }
  if (channel === 'instagram') {
    // Facebook Login (EAA...) IG ke liye Page access token chalta hai.
    const igToken =
      config.igAccessToken && config.igAccessToken.startsWith('IGAA')
        ? config.igAccessToken
        : config.pageAccessToken || config.igAccessToken;
    return {
      source: 'env',
      connectionId: null,
      token: igToken,
      accountId: config.igAccountId,
      appSecret: config.appSecret,
      apiHost: igToken && igToken.startsWith('IGAA') ? 'instagram' : 'facebook',
      extra: {},
    };
  }
  if (channel === 'whatsapp') {
    return {
      source: 'env',
      connectionId: null,
      token: config.waAccessToken,
      accountId: config.waPhoneNumberId,
      appSecret: config.appSecret,
      apiHost: 'facebook',
      extra: { wa_own_number: config.waOwnNumber },
    };
  }
  if (channel === 'telegram') {
    return {
      source: 'env',
      connectionId: null,
      token: config.telegramBotToken,
      accountId: config.telegramAccountId,
      appSecret: '',
      apiHost: 'telegram',
      extra: {},
    };
  }

  return { source: 'none', connectionId: null, token: '', accountId: '', extra: {} };
}

const graphUrl = (host, path) => `https://graph.${host}.com/${config.graphVersion}/${path}`;

async function graphPost(host, path, accessToken, body) {
  const url = `${graphUrl(host, path)}?access_token=${encodeURIComponent(accessToken)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    return { ok: false, error: (data.error && data.error.message) || `HTTP ${res.status}` };
  }
  return { ok: true, data };
}

function buildAttachmentMessage(attachment) {
  if (!attachment || !attachment.url) return null;
  const typeMap = { audio: 'audio', video: 'video', image: 'image', document: 'file' };
  const type = typeMap[attachment.type] || 'file';
  return { attachment: { type, payload: { url: attachment.url } } };
}

// Messenger aur Instagram ka send endpoint bilkul same hai ("me/messages").
// Sirf host aur token alag hote hain.
async function sendMetaMessage(creds, recipientId, text, attachment) {
  if (!creds.token) return { ok: false, error: 'No access token configured for this channel' };
  const host = creds.apiHost === 'instagram' ? 'instagram' : 'facebook';
  return graphPost(host, 'me/messages', creds.token, {
    recipient: { id: recipientId },
    message: buildAttachmentMessage(attachment) || { text },
  });
}

function sendFacebook(creds, psid, text, attachment) {
  return sendMetaMessage(creds, psid, text, attachment);
}

function sendInstagram(creds, igsid, text, attachment) {
  if (!creds.accountId) {
    return { ok: false, error: 'Instagram account id (IG account ID) is required to send' };
  }
  if (!creds.token) return { ok: false, error: 'No Instagram access token configured' };
  const host = creds.apiHost === 'instagram' ? 'instagram' : 'facebook';
  // Instagram Login (graph.instagram.com) me account id node ke aage lagta
  // hai, FB-hosted IG me "me" kaafi hai - dono try karte hain.
  if (host === 'instagram') {
    return graphPost(host, `${creds.accountId}/messages`, creds.token, {
      recipient: { id: igsid },
      message: buildAttachmentMessage(attachment) || { text },
    });
  }
  return sendMetaMessage(creds, igsid, text, attachment);
}

async function sendWhatsApp(creds, to, text, attachment) {
  if (!creds.accountId) {
    return { ok: false, error: 'WhatsApp Phone Number ID is required to send' };
  }
  if (!creds.token) return { ok: false, error: 'No WhatsApp access token configured' };

  const payload = attachment
    ? {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: attachment.type === 'image' ? 'image' : 'document',
        [attachment.type === 'image' ? 'image' : 'document']: { link: attachment.url },
      }
    : {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'text',
        text: { body: text },
      };

  return graphPost('facebook', `${creds.accountId}/messages`, creds.token, payload);
}

const TELEGRAM_MEDIA = {
  image: { method: 'sendPhoto', field: 'photo' },
  video: { method: 'sendVideo', field: 'video' },
  audio: { method: 'sendAudio', field: 'audio' },
  document: { method: 'sendDocument', field: 'document' },
};

// Telegram text ko JSON se bhejta hai. Media ke liye ya to public URL deta hai
// ya local upload ko multipart me file ki tarah bhejta hai (Telegram hamare
// server tak khud pahunch nahi sakta, is liye local file attach karni padti hai).
async function sendTelegram(creds, chatId, text, attachment) {
  if (!creds.token) return { ok: false, error: 'No Telegram bot token configured' };
  const id = String(chatId);

  if (!attachment || !attachment.url) {
    const result = await telegramApi(creds.token, 'sendMessage', {
      chat_id: id,
      text: text || '',
      disable_web_page_preview: true,
    });
    return result.ok ? { ok: true, data: result.data } : { ok: false, error: result.error };
  }

  const media = TELEGRAM_MEDIA[attachment.type] || TELEGRAM_MEDIA.document;
  const form = new FormData();
  form.append('chat_id', id);
  if (text) form.append('caption', text);

  try {
    if (/^https?:\/\//i.test(attachment.url)) {
      form.append(media.field, attachment.url);
    } else if (attachment.url.startsWith('/uploads/')) {
      const filePath = path.join(config.uploadDir, path.basename(attachment.url));
      const buffer = fs.readFileSync(filePath);
      form.append(media.field, new Blob([buffer]), path.basename(filePath));
    } else {
      return { ok: false, error: 'Telegram media URL public nahi hai' };
    }

    const res = await fetch(botUrl(creds.token, media.method), {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(60000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      return { ok: false, error: data.description || `HTTP ${res.status}` };
    }
    return { ok: true, data: data.result };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// channel + optional conversation ka data. Purana call signature
// (channel, externalId, ...) bhi chal raha hai taake koi purana caller na toote.
function dispatchSend(channelOrConversation, externalId, text, attachment) {
  let channel = channelOrConversation;
  let connectionId = null;
  if (channelOrConversation && typeof channelOrConversation === 'object') {
    channel = channelOrConversation.channel;
    connectionId = channelOrConversation.connection_id || null;
  }

  const creds = resolveCredentials(channel, connectionId);

  switch (channel) {
    case 'facebook':
      return sendFacebook(creds, externalId, text, attachment);
    case 'instagram':
      return sendInstagram(creds, externalId, text, attachment);
    case 'whatsapp':
      return sendWhatsApp(creds, externalId, text, attachment);
    case 'telegram':
      return sendTelegram(creds, externalId, text, attachment);
    default:
      return Promise.resolve({ ok: false, error: `Unknown channel: ${channel}` });
  }
}

// Channel ka page/IG account/WABA naam pata karne ke liye (UI me dikhane ke liye).
async function describeAccount(channel, connectionId) {
  const creds = resolveCredentials(channel, connectionId);
  if (!creds.token) return { ok: false, error: 'No token configured' };

  if (channel === 'telegram') {
    const result = await telegramApi(creds.token, 'getMe', {});
    if (!result.ok) return { ok: false, error: result.error };
    const bot = result.data || {};
    return {
      ok: true,
      id: bot.id ? String(bot.id) : creds.accountId || null,
      name: [bot.first_name, bot.last_name].filter(Boolean).join(' ') || bot.username || null,
      username: bot.username || null,
    };
  }

  try {
    const host = creds.apiHost === 'instagram' ? 'instagram' : 'facebook';
    const node = creds.accountId || 'me';
    const res = await fetch(
      `${graphUrl(host, node)}?fields=id,name,username&access_token=${encodeURIComponent(creds.token)}`
    );
    const data = await res.json();
    if (data.error) return { ok: false, error: data.error.message };
    return {
      ok: true,
      id: data.id || creds.accountId || null,
      name: data.name || data.username || null,
      username: data.username || null,
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = {
  dispatchSend,
  resolveCredentials,
  describeAccount,
  graphUrl,
  buildAttachmentMessage,
};
