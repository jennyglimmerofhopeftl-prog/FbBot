// `.env` fallback tokens se DB connections auto-seed karta hai.
//
// Pehle app sirf .env tokens (PAGE_ACCESS_TOKEN, IG_ACCESS_TOKEN) se chalti
// thi — ab DB-first hai. Purane setups ka data na khoye, is liye server start
// par agar .env mein token/account hain aur us channel+account wali koi
// connection DB mein maujood nahi, to wahan se ek connection bana diya jata
// hai. User phir UI mein dekh/change/delete kar sakta hai.
//
// Idempotent: agar connection already hai (kisi kaam se bani ho) to duplicate
// nahi banati.

const config = require('../config');
const db = require('../db');
const { graphUrl } = require('./send');

// Account ka naam/screen-name nikaalta hai (best-effort — fail ho to fallback).
async function resolveAccountLabel(channel, accountId, token, fallback) {
  try {
    const host = channel === 'instagram' ? 'instagram' : 'facebook';
    const res = await fetch(
      `${graphUrl(host, accountId)}?fields=name,username&access_token=${encodeURIComponent(token)}`
    );
    const data = await res.json().catch(() => ({}));
    return data.name || data.username || fallback;
  } catch {
    return fallback;
  }
}

// Candidate sources (.env se sirf, DB connections wahan nahi ginte).
function envCandidates() {
  const out = [];
  if (config.pageAccessToken && config.pageId) {
    out.push({
      channel: 'facebook',
      accountId: config.pageId,
      token: config.pageAccessToken,
      appId: config.appId,
      appSecret: config.appSecret,
      apiHost: 'facebook',
      fallbackName: 'Facebook Page (.env)',
      extra: {},
    });
  }
  if (config.igAccessToken && config.igAccountId) {
    out.push({
      channel: 'instagram',
      accountId: config.igAccountId,
      token: config.igAccessToken,
      appId: config.appId,
      appSecret: config.appSecret,
      apiHost: config.igAccessToken.startsWith('IGAA') ? 'instagram' : 'facebook',
      fallbackName: 'Instagram Account (.env)',
      extra: {},
    });
  }
  if (config.waAccessToken && config.waPhoneNumberId) {
    out.push({
      channel: 'whatsapp',
      accountId: config.waPhoneNumberId,
      token: config.waAccessToken,
      appId: config.appId,
      appSecret: config.appSecret,
      apiHost: 'facebook',
      fallbackName: 'WhatsApp Business (.env)',
      extra: { wa_own_number: config.waOwnNumber },
    });
  }
  return out;
}

// Banai gayi connections ki list return karta hai (pehle se maujood = nahi).
async function seedFromEnv() {
  const created = [];
  for (const cand of envCandidates()) {
    if (!cand.token || !cand.accountId) continue;
    // Same channel+account wali connection pehle se ho to chhoro.
    const existing = db.db
      .prepare('SELECT id FROM connections WHERE channel = ? AND account_id = ? LIMIT 1')
      .get(cand.channel, String(cand.accountId));
    if (existing) continue;

    const name = await resolveAccountLabel(
      cand.channel,
      cand.accountId,
      cand.token,
      cand.fallbackName
    );

    const conn = db.createConnection({
      channel: cand.channel,
      name,
      accountId: cand.accountId,
      token: cand.token,
      appId: cand.appId,
      appSecret: cand.appSecret,
      apiHost: cand.apiHost,
      extra: cand.extra,
    });
    console.log(`[bootstrap] .env se connection banai: [${cand.channel}] ${name} (id ${conn.id})`);
    created.push(conn);
  }
  return created;
}

module.exports = { seedFromEnv };