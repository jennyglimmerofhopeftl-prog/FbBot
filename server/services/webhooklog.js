// Recent webhook payloads ka chhota in-memory ring buffer.
//
// Meta se messages aa rahe hain ya nahi - yeh debug karne ke liye. Render ke
// logs tak har waqt pahunch nahi hoti, is liye owner-only API se last events
// dekhe ja sakte hain. Server restart par khali ho jata hai (kaafi hai).

const MAX_EVENTS = 50;
const events = [];

function add(payload, extra = {}) {
  try {
    const p = payload || {};

    // Telegram update ka shape Meta se bilkul alag hai.
    if (p.update_id !== undefined) {
      const m = p.message || p.edited_message || p.channel_post || {};
      events.unshift({
        at: new Date().toISOString(),
        object: 'telegram',
        entry_id: (m.chat && m.chat.id) || null,
        events: m.message_id ? 1 : 0,
        changes: 0,
        sender: (m.from && m.from.id) || null,
        recipient: (m.chat && m.chat.id) || null,
        text: m.text || m.caption || null,
        signature_ok: extra.signatureOk === undefined ? null : !!extra.signatureOk,
        raw: JSON.stringify(p).slice(0, 2000),
      });
      if (events.length > MAX_EVENTS) events.length = MAX_EVENTS;
      return;
    }

    const entry = (p.entry || [])[0] || {};
    const messaging = entry.messaging || [];
    const changes = entry.changes || [];
    const first = messaging[0] || {};
    const firstChange = (changes[0] && changes[0].value) || {};

    events.unshift({
      at: new Date().toISOString(),
      object: p.object || null,
      entry_id: entry.id || null,
      events: messaging.length,
      changes: changes.length,
      sender: (first.sender && first.sender.id) || null,
      recipient: (first.recipient && first.recipient.id) || null,
      text:
        (first.message && first.message.text) ||
        (first.postback && first.postback.title) ||
        (firstChange.messages && firstChange.messages[0] && firstChange.messages[0].text && firstChange.messages[0].text.body) ||
        null,
      signature_ok: extra.signatureOk === undefined ? null : !!extra.signatureOk,
      raw: JSON.stringify(p).slice(0, 2000),
    });
    if (events.length > MAX_EVENTS) events.length = MAX_EVENTS;
  } catch {
    /* logging kabhi fail na ho */
  }
}

function list() {
  return events;
}

module.exports = { add, list };
