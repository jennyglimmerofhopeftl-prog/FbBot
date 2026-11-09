export const CHANNELS = {
  facebook: { label: 'Facebook', short: 'FB', color: '#1877f2' },
  instagram: { label: 'Instagram', short: 'IG', color: '#e4405f' },
  whatsapp: { label: 'WhatsApp', short: 'WA', color: '#075e54' },
  telegram: { label: 'Telegram', short: 'TG', color: '#229ED9' },
};

export function channelOf(key) {
  return CHANNELS[key] || { label: key || 'Unknown', short: '?', color: '#888' };
}

export function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return sameDay ? time : d.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

export function formatClock(ts) {
  if (!ts) return '';
  return new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function formatFull(ts) {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleString();
}