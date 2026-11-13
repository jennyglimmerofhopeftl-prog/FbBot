const TOKEN_KEY = 'omnichannel_token';
const AGENT_KEY = 'omnichannel_agent';

export const getToken = () => localStorage.getItem(TOKEN_KEY) || null;
export const getAgent = () => {
  try {
    return JSON.parse(localStorage.getItem(AGENT_KEY) || 'null');
  } catch {
    return null;
  }
};

export const saveSession = (token, agent) => {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(AGENT_KEY, JSON.stringify(agent));
};

export const clearSession = () => {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(AGENT_KEY);
};

async function request(path, { method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data.error || `Request failed with ${res.status}`);
    error.status = res.status;
    throw error;
  }
  return data;
}

export async function uploadFile(file) {
  const token = getToken();
  const form = new FormData();
  form.append('file', file);
  const res = await fetch('/api/upload', {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data.error || `Upload failed with ${res.status}`);
    error.status = res.status;
    throw error;
  }
  return data;
}

export const api = {
  login: (email, password) => request('/auth/login', { method: 'POST', body: { email, password } }),
  me: () => request('/auth/me'),
  agents: () => request('/auth/agents'),
  createAgent: (name, email, password, role) =>
    request('/auth/agents', { method: 'POST', body: { name, email, password, role } }),
  deleteAgent: (id) => request(`/auth/agents/${id}`, { method: 'DELETE' }),
  updateAgent: (id, payload) => request(`/auth/agents/${id}`, { method: 'PATCH', body: payload }),
  updateAgentPhoto: (id, photo) => request(`/auth/agents/${id}`, { method: 'PATCH', body: { photo } }),

  connections: () => request('/connections'),
  createConnection: (payload) => request('/connections', { method: 'POST', body: payload }),
  updateConnection: (id, payload) => request(`/connections/${id}`, { method: 'PATCH', body: payload }),
  deleteConnection: (id) => request(`/connections/${id}`, { method: 'DELETE' }),
  verifyConnection: (id) => request(`/connections/${id}/verify`, { method: 'POST' }),
  subscribeConnection: (id, callbackUrl) =>
    request(`/connections/${id}/subscribe`, { method: 'POST', body: { callback_url: callbackUrl } }),
  syncConnection: (id) => request(`/connections/${id}/sync`, { method: 'POST' }),

  conversations: (params = {}) => {
    const qs = new URLSearchParams();
    if (params.status && params.status !== 'all') qs.set('status', params.status);
    if (params.channel && params.channel !== 'all') qs.set('channel', params.channel);
    if (params.unread) qs.set('unread', '1');
    if (params.agent && params.agent !== 'all') qs.set('agent', params.agent);
    return request(`/conversations?${qs.toString()}`);
  },
  assignmentCounts: () => request('/conversations/assignment-counts'),
  unreadTotal: () => request('/conversations/unread-total'),
  conversation: (id) => request(`/conversations/${id}`),
  reply: (id, payload) => request(`/conversations/${id}/reply`, { method: 'POST', body: payload }),
  editMessage: (id, messageId, body) =>
    request(`/conversations/${id}/messages/${messageId}/edit`, { method: 'POST', body: { body } }),
  assign: (id, agentId, note, media) => request(`/conversations/${id}/assign`, {
    method: 'POST',
    body: { agent_id: agentId, note: note || '', ...(media || {}) },
  }),
  addNote: (id, payload) => request(`/conversations/${id}/note`, { method: 'POST', body: payload }),
  deleteNote: (id, messageId) => request(`/conversations/${id}/notes/${messageId}`, { method: 'DELETE' }),
  setStatus: (id, status) => request(`/conversations/${id}/status`, { method: 'POST', body: { status } }),
  markRead: (id) => request(`/conversations/${id}/read`, { method: 'POST' }),
};