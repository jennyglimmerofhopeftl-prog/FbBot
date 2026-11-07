const config = require('../config');
const db = require('../db');
const { graphUrl } = require('./send');

// Meta Graph se token verify karna - agar token valid hai to account ka
// naam/ID bhi mil jata hai, jo UI me dikhane ke liye best hai.
async function verifyToken(channel, creds) {
  if (!creds || !creds.token) {
    return { ok: false, error: 'Access token missing' };
  }
  const host = creds.apiHost === 'instagram' ? 'instagram' : 'facebook';
  const node = creds.accountId || 'me';
  try {
    const res = await fetch(
      `${graphUrl(host, node)}?fields=id,name,username&access_token=${encodeURIComponent(creds.token)}`
    );
    const data = await res.json();
    if (data.error) return { ok: false, error: data.error.message };
    if (data.id) {
      return {
        ok: true,
        id: data.id,
        name: data.name || data.username || null,
        username: data.username || null,
      };
    }
    return { ok: false, error: 'Token valid hai lekin account nahi mila' };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// Webhook ko Meta app par subscribe karwa deta hai (page/instagram/whatsapp).
// Do step: app-level subscription + page/IG-level subscribe.
async function subscribeWebhook(channel, creds, callbackUrl) {
  if (!creds || !creds.token) return { ok: false, error: 'Access token missing' };
  if (!creds.appId) return { ok: false, error: 'App ID missing hai - subscription ke liye chahiye' };
  if (!callbackUrl) return { ok: false, error: 'Public callback URL chahiye (server ke public host par)' };

  const objectMap = {
    facebook: 'page',
    instagram: 'instagram',
    whatsapp: 'whatsapp_business_account',
  };
  const object = objectMap[channel];
  if (!object) return { ok: false, error: `Channel ${channel} supported nahi` };

  const verifyToken = creds.verifyToken || config.verifyToken;
  if (!verifyToken) return { ok: false, error: 'Verify token missing' };

  // App-level /subscriptions endpoint sirf APP access token leta hai
  // ({app-id}|{app-secret}); page token se Meta "(#15) app access_token" error
  // deta hai. App secret sirf tab available hota hai jab connection me save ho.
  const appAccessToken = creds.appSecret ? `${creds.appId}|${creds.appSecret}` : creds.token;

  try {
    // Step 1: app-level webhook subscription
    const url =
      `${graphUrl('facebook', `${creds.appId}/subscriptions`)}` +
      `?object=${encodeURIComponent(object)}` +
      `&callback_url=${encodeURIComponent(callbackUrl)}` +
      `&verify_token=${encodeURIComponent(verifyToken)}` +
      `&fields=${encodeURIComponent('messages')}` +
      `&access_token=${encodeURIComponent(appAccessToken)}`;

    const res = await fetch(url, { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (data.error) {
      return { ok: false, error: data.error.message || 'Subscription failed' };
    }

    return {
      ok: true,
      success: data.success !== false,
      object,
      message: data.success === false ? 'Subscribe nahi hua' : 'Webhook subscribed',
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// Page/IG ko app se linked karta hai (page-level subscribe).
async function subscribeAccount(channel, creds) {
  if (!creds || !creds.token) return { ok: false, error: 'Access token missing' };
  if (!creds.accountId) return { ok: false, error: 'Account ID missing hai' };

  // Instagram ke liye account_id = IG account id, page ke liye page id.
  const node = channel === 'whatsapp' ? creds.accountId : creds.accountId;
  const host = creds.apiHost === 'instagram' ? 'instagram' : 'facebook';

  try {
    const url =
      `${graphUrl(host, `${node}/subscribed_apps`)}` +
      `?access_token=${encodeURIComponent(creds.token)}`;
    const res = await fetch(url, { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (data.error) return { ok: false, error: data.error.message };
    return { ok: true, success: data.success !== false };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = { verifyToken, subscribeWebhook, subscribeAccount };
