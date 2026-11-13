const config = require('../config');
const { resolveCredentials, graphUrl } = require('./send');

// Har inbound message par Graph API call karna slow tha (aur rate limits bhi).
// Contact ka naam/photo cache karo: successful 30 min, fallback 5 min.
const contactCache = new Map();
const CONTACT_TTL_MS = 30 * 60 * 1000;
const FALLBACK_TTL_MS = 5 * 60 * 1000;

// Best-effort contact identity lookup. Kisi bhi failure par id hi naam ban jata hai.
async function resolveContact(channel, externalId, connectionId) {
  const key = `${channel}:${connectionId || 'env'}:${externalId}`;
  const cached = contactCache.get(key);
  if (cached && Date.now() - cached.at < cached.ttl) return cached.info;

  const info = await fetchContact(channel, externalId, connectionId);
  if (contactCache.size > 5000) contactCache.clear();
  contactCache.set(key, {
    at: Date.now(),
    info,
    ttl: info && info.name && info.name !== externalId ? CONTACT_TTL_MS : FALLBACK_TTL_MS,
  });
  return info;
}

async function fetchContact(channel, externalId, connectionId) {
  const creds = resolveCredentials(channel, connectionId);
  if (!creds.token) return { name: externalId, photo: null };

  try {
    if (channel === 'facebook') {
      const res = await fetch(
        `${graphUrl('facebook', externalId)}?fields=name,profile_pic&access_token=${encodeURIComponent(creds.token)}`
      );
      const data = await res.json();
      if (data && (data.name || data.profile_pic)) {
        return { name: data.name || externalId, photo: data.profile_pic || null };
      }
      // Direct PSID lookup fail ho sakta hai (dev-mode app / expired PSID).
      // Messenger page-conversations edge se participant name de deta hai.
      const viaConv = await facebookNameFromConversations(creds, externalId);
      if (viaConv) return { name: viaConv, photo: null };
    }

    if (channel === 'instagram') {
      const host = creds.apiHost === 'instagram' ? 'instagram' : 'facebook';
      // Instagram Login wale accounts graph.instagram.com par scoped user node
      // se resolve hote hain; FB-hosted IG par direct scoped-user lookup chalta hai.
      const node = host === 'instagram' && creds.accountId ? `${creds.accountId}` : externalId;
      const res = await fetch(
        `${graphUrl(host, node)}?fields=username,name,profile_pic&access_token=${encodeURIComponent(creds.token)}`
      );
      const data = await res.json();
      if (data && (data.username || data.name)) {
        return {
          name: data.username || data.name || externalId,
          photo: data.profile_pic || null,
        };
      }
      if (data && data.error) {
        console.warn(`[userinfo] IG resolve fail for ${externalId}: ${data.error.message}`);
      }
    }
  } catch {
    // network error - fallback name chalega
  }
  return { name: externalId, photo: null };
}

// Multiple Facebook pages ho sakti hain, is liye cache per-page key hoti hai
// warna ek page ka data doosre pe leak ho jayega.
const fbCache = new Map();

async function facebookNameFromConversations(creds, externalId) {
  if (!creds.accountId || !creds.token) return null;
  const key = `${creds.connectionId || 'env'}:${creds.accountId}`;

  const cached = fbCache.get(key);
  if (!cached || Date.now() - cached.at > 5 * 60 * 1000) {
    const fetched = await loadParticipants(creds);
    if (!fetched) return null;
    fbCache.set(key, { at: Date.now(), ...fetched });
  }

  const map = fbCache.get(key);
  return map.byId[externalId] || map.byEmail[`${externalId}@facebook.com`] || null;
}

async function loadParticipants(creds) {
  try {
    let next = `${graphUrl('facebook', `${creds.accountId}/conversations`)}?fields=participants{name,id,email}&limit=100&access_token=${encodeURIComponent(creds.token)}`;
    const map = { byId: {}, byEmail: {} };
    const seen = new Set();
    while (next && seen.size < 500) {
      const res = await fetch(next);
      const data = await res.json();
      if (data.error) break;
      for (const c of data.data || []) {
        for (const p of (c.participants && c.participants.data) || []) {
          if (!p || p.id === creds.accountId) continue;
          map.byId[p.id] = p.name;
          if (p.email) map.byEmail[p.email] = p.name;
        }
      }
      next = data.paging && data.paging.next ? data.paging.next : null;
    }
    return map;
  } catch {
    return null;
  }
}

async function resolveContactName(channel, externalId, connectionId) {
  const info = await resolveContact(channel, externalId, connectionId);
  return info.name;
}

module.exports = { resolveContactName, resolveContact };
