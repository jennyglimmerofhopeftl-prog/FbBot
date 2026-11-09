const crypto = require('node:crypto');

// Telegram Bot API helpers. Bot token URL me jata hai, is liye ise kabhi
// client/browser ko nahi bhejte. Webhook secret token bhi token se derive
// hota hai taake DB me alag secret store karne ki zaroorat na pade.

const API_BASE = 'https://api.telegram.org';

function botUrl(token, method) {
  return `${API_BASE}/bot${token}/${method}`;
}

async function telegramApi(token, method, payload = {}) {
  if (!token) return { ok: false, error: 'Telegram bot token missing' };
  try {
    const res = await fetch(botUrl(token, method), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      return { ok: false, error: data.description || `HTTP ${res.status}` };
    }
    return { ok: true, data: data.result, raw: data };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// setWebhook ka secret_token sirf A-Z a-z 0-9 _ - allow karta hai. SHA-256
// hex dono kaam karta hai aur token badalne par khud badal jata hai.
function secretForToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function fileUrl(token, filePath) {
  return `${API_BASE}/file/bot${token}/${filePath}`;
}

module.exports = { botUrl, telegramApi, secretForToken, fileUrl };
