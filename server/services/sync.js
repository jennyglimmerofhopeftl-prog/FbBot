const db = require('../db');
const { graphUrl } = require('./send');

// Meta ki "conversations" edge se account ke PEHLI SE maujood chats import
// karta hai. Meta poori history API se nahi deta, lekin:
//   - thread ki LIST to milti hai (paginated)
//   - har thread ke latest messages (20 tak) ka CONTENT milta hai
//   - 20 se purane messages ka content Meta "message has been deleted" error
//     karke door kar deta hai (platform policy — is ka koi workaround nahi)
// Endpoints:
//   Facebook  -> GET /{page_id}/conversations
//   Instagram -> GET /{ig_id}/conversations?platform=instagram
// (WhatsApp par history API hai hi nahi - sirf naye webhook messages aate hain.)
//
// Import unmatcha hua data hi add karta hai; dobara sync par koi duplicate
// nahi banta (meta_id se dedupe).

const FIELD_SETS = {
  facebook:
    'participants{name,id,email},snippet,updated_time,unread_count,message_count,messages{id,message,created_time,from{id,name,email},attachments{type,media_type}}',
  instagram:
    'participants{name,id,username},snippet,updated_time,unread_count,message_count,messages{id,message,created_time,from{id,username},attachments{type,media_type}}',
};

async function syncConnection(conn) {
  const result = {
    channel: conn.channel,
    total: 0,
    created: 0,
    with_snippet: 0,
    messages_imported: 0,
    failed: 0,
    error: null,
  };

  const fields = FIELD_SETS[conn.channel];
  if (!fields) {
    result.error =
      "WhatsApp ki purani messages na koi history API hai na webhook ke alawa - sirf naye messages aate hain. (Facebook/Instagram par yeh kaam karta hai.)";
    return result;
  }
  if (!conn.token) {
    result.error = 'Access token missing';
    return result;
  }
  if (!conn.accountId) {
    result.error = 'Account ID/Page ID missing';
    return result;
  }

  // Apna account participants/messages se kaise pehchana jaye.
  // Instagram par conversations ke andar account ka scoped ID (
  // "ig_id") accountId se alag format ka hota hai, is liye username se
  // match karna safe hai. Facebook par page ID hi accountId hai.
  const selfUsername = await resolveSelfUsername(conn);

  const host = conn.apiHost === 'instagram' ? 'instagram' : 'facebook';
  // Instagram wale URL par platform param pehle se hai; us case mein next
  // params `&` se jude hain (double ? = URL bug).
  const base = `${graphUrl(host, conn.accountId)}/conversations`;
  const sep = conn.channel === 'instagram' ? '?platform=instagram&' : '?';

  let url =
    `${base}${sep}fields=${encodeURIComponent(fields)}&limit=100&access_token=${encodeURIComponent(conn.token)}`;
  let pages = 0;

  try {
    while (url && pages < 20) {
      pages += 1;
      const res = await fetch(url);
      const data = await res.json().catch(() => ({}));
      if (data.error) {
        // Jab Meta rate-limit ya temporary block kare (jaisa is feature ne
        // recently trigger kiya) to foran ruk jao — aage hammer karke block
        // aur lamba mat karo. Error message UI ko asaan Roman-Urdu mein do.
        if (isMetaBlocked(data.error)) {
          result.error =
            'Meta ne temporarily block kar diya hai (bahut zayada requests ki wajah se). Kuch ghanton baad dobara try karein — data mehfooz hai, kuch delete nahi hua.';
          result.rate_limited = true;
          break;
        }
        result.error = data.error.message;
        if (data.error.code === 190) result.error += ' (token expire ho gaya hai?)';
        break;
      }

      for (const conv of data.data || []) {
        result.total += 1;
        importOne(conn, conv, result, selfUsername);
      }
      url = data.paging && data.paging.next ? data.paging.next : null;

      // Meta ko breathing room do — har page ke beech ~800ms ka gap, warna
      // 800+ threads aik saath padhne par account block ho jata hai (yahi
      // pichli baar hua tha).
      if (url) await sleep(800);
    }
  } catch (err) {
    result.error = err.message;
  }

  return result;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Meta ke rate-limit / temporary block errors ko pehchanta hai.
function isMetaBlocked(err) {
  if (!err) return false;
  const code = Number(err.code);
  const msg = String(err.message || '').toLowerCase();
  if ([613, 4, 17, 368, 80004, 100].includes(code)) return true;
  return (
    msg.includes('temporarily blocked') ||
    msg.includes('blocked from taking this action') ||
    msg.includes('rate limit') ||
    msg.includes('too many requests') ||
    msg.includes('throttled')
  );
}

// Account ka username nikaalne ki koshish (IG ke liye zaroori — wahan
// message/participant IDs scoped format mein hoti hain jo accountId se
// match nahi karti). Fail ho to null — phir sender detection sirf ID se
// chalegi (FB ke liye kaafi hai).
async function resolveSelfUsername(conn) {
  try {
    const host = conn.apiHost === 'instagram' ? 'instagram' : 'facebook';
    const url = `${graphUrl(host, conn.accountId)}?fields=id,username&access_token=${encodeURIComponent(conn.token)}`;
    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));
    return data.username || null;
  } catch {
    return null;
  }
}

// Kya ye participant/message hamaara apna account hai?
// - Facebook: page id == accountId
// - Instagram: username match (scoped ID alag format ka hota hai)
function isSelf(conn, selfUsername, who) {
  if (!who) return false;
  if (who.username && selfUsername && String(who.username) === String(selfUsername)) {
    return true;
  }
  if (who.id && String(who.id) === String(conn.accountId)) return true;
  // Meta FB messages mein "from" kabhi kabhi id ke bajaye email deta hai
  // ({psid}@facebook.com). Email ka prefix hi PSID hota hai.
  if (who.email) {
    const prefix = String(who.email).split('@')[0];
    if (prefix && String(prefix) === String(conn.accountId)) return true;
  }
  return false;
}

function importOne(conn, apiConversation, result, selfUsername) {
  // "participant" = customer jo page/account par message karta hai.
  // Apna account khud exclude karo; group chats ke liye conversation id key.
  const participants = (apiConversation.participants && apiConversation.participants.data) || [];
  const others = participants.filter((p) => !isSelf(conn, selfUsername, p));

  let externalId;
  let contactName = null;
  let photo = null;

  if (others.length === 1) {
    externalId = String(others[0].id);
    contactName = others[0].name || others[0].username || null;
  } else if (others.length > 1) {
    // group/thread - conversation id hi identity hai
    externalId = String(apiConversation.id);
    contactName = others
      .map((p) => p.name || p.username || p.id)
      .slice(0, 3)
      .join(', ');
  } else {
    // koi participant info nahi mili - conversation id se hi chala lo
    externalId = String(apiConversation.id);
    contactName = null;
  }

  const apiMessages = (apiConversation.messages && apiConversation.messages.data) || [];

  let conversation;
  try {
    conversation = db.findOrCreateConversation({
      channel: conn.channel,
      externalId,
      contactName,
      photo,
      connectionId: conn.id,
    });
  } catch {
    result.failed += 1;
    return;
  }

  const updatedTime = apiConversation.updated_time
    ? Math.floor(new Date(apiConversation.updated_time).getTime() / 1000)
    : null;
  if (updatedTime) db.setConversationTimestamps(conversation.id, { lastMessageAt: updatedTime });

  // Asli thread messages import karo. Meta har thread ke ZIYADA TAR messages
  // ka content nahi deta - sirf latest (20 tak) deta hai; purane ke liye
  // "message has been deleted" error aata hai. Jo content mile wo import karo.
  let importedMessages = 0;
  let lastCreated = 0;
  for (const msg of apiMessages) {
    const metaId = `msg:${conn.id}:${msg.id}`;
    const existing = db.findMessageByMetaId(metaId, conversation.id);
    if (existing) continue; // pehle se import ho chuka - dedupe

    // Apna page/account bhej raha hai to outbound, warna customer ka inbound.
    const direction = isSelf(conn, selfUsername, msg.from) ? 'outbound' : 'inbound';

    let body = (msg.message || '').trim();
    let type = 'text';
    if (!body && Array.isArray(msg.attachments) && msg.attachments.length) {
      const a = msg.attachments[0];
      type = a.type && a.type !== 'file' ? a.type : 'document';
      body = `[${type}]`;
    }

    if (!body) continue; // koi content nahi (sirf echo/deleted) - chhodo

    const createdAt = msg.created_time
      ? Math.floor(new Date(msg.created_time).getTime() / 1000)
      : null;

    try {
      db.addMessage({
        conversationId: conversation.id,
        direction,
        body,
        type,
        metaId,
        sender: direction === 'outbound' ? 'agent' : 'customer',
        touchConversation: false,
        createdAt,
      });
      importedMessages += 1;
      if (createdAt && createdAt > lastCreated) lastCreated = createdAt;
    } catch {
      result.failed += 1;
      continue;
    }
  }
  result.messages_imported += importedMessages;

  // Meta thread ke purane messages ka content nahi deta — sirf aakhri snippet
  // deta hai. Agar koi message content na mila ho (e.g. poori thread 20 se
  // purani) to snippet import karo, taake conversation khali na dikhe.
  if (!importedMessages) {
    const snippet = (apiConversation.snippet || '').trim();
    if (snippet && !db.hasMessages(conversation.id)) {
      const metaId = `snip:${conn.id}:${externalId}`;
      if (!db.findMessageByMetaId(metaId, conversation.id)) {
        try {
          db.addMessage({
            conversationId: conversation.id,
            direction: 'inbound',
            body: snippet,
            type: 'text',
            metaId,
            sender: 'customer',
            touchConversation: false,
            createdAt: updatedTime,
          });
          result.with_snippet += 1;
        } catch {
          result.failed += 1;
        }
      }
    }
  }

  // Aakhri imported message ka timestamp bhi conversation par laga do,
  // taake inbox ordering sahi rahe. (Webhook ke naye messages khud unread
  // banate hain; import walon ka unread neeche 0 kar diya jata hai.)
  if (lastCreated) {
    db.db
      .prepare('UPDATE conversations SET last_message_at = ? WHERE id = ? AND ? > last_message_at')
      .run(lastCreated, conversation.id, lastCreated);
  }

  // Import ke bad unread nahi chahiye - ye purane chats hain jo abhi dekhe
  // ja rahe hain. (Naye webhook messages ab bhi normal unread rakhte hain.)
  db.db.prepare('UPDATE conversations SET unread = 0 WHERE id = ?').run(conversation.id);

  result.created += 1;
}

module.exports = { syncConnection };