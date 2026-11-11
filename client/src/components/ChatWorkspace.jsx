import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext.jsx';
import { channelOf, formatTime } from '../channels';
import ChatWindow from './ChatWindow.jsx';
import Avatar from './Avatar.jsx';

const MIN_LIST_WIDTH = 200;
const MAX_LIST_WIDTH = 640;
const LIST_WIDTH_KEY = 'inbox-list-width';
const AUTO_REFRESH_MS = 10000;

// Inbox tabs: All aur Unread ke sath status filters. "Unread" backend se
// query hota hai (c.unread > 0); status filters bhi API ke through.
const TABS = [
  { key: 'all', label: 'All', status: 'all', unread: false },
  { key: 'unread', label: 'Unread', status: 'all', unread: true },
  { key: 'open', label: 'Open', status: 'open', unread: false },
  { key: 'pending', label: 'Pending', status: 'pending', unread: false },
  { key: 'resolved', label: 'Resolved', status: 'resolved', unread: false },
];

export default function ChatWorkspace({ agentView = false }) {
  const { user } = useAuth();
  const isStaff = user && (user.role === 'admin' || user.role === 'owner');
  const [activeTab, setActiveTab] = useState('all');
  const [conversations, setConversations] = useState([]);
  const [agents, setAgents] = useState([]);
  const [search, setSearch] = useState('');
  const [agentFilter, setAgentFilter] = useState('all');
  const [agentCounts, setAgentCounts] = useState({ agents: [], unassigned: 0, total: 0 });
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [active, setActive] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [mobileNotes, setMobileNotes] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [listWidth, setListWidth] = useState(() => {
    try {
      const saved = localStorage.getItem(LIST_WIDTH_KEY);
      return saved ? Math.min(MAX_LIST_WIDTH, Math.max(MIN_LIST_WIDTH, parseInt(saved, 10))) : 320;
    } catch {
      return 320;
    }
  });
  const listWidthRef = useRef(listWidth);
  const activeIdRef = useRef(null);
  activeIdRef.current = activeId;

  const activeTabDef = TABS.find((t) => t.key === activeTab) || TABS[0];
  const filterRef = useRef(activeTabDef);
  filterRef.current = activeTabDef;
  const agentFilterRef = useRef(agentFilter);
  agentFilterRef.current = agentFilter;

  // Kya conversation current tab ke filter ko match karti hai?
  // My Chats ke Unread tab mein naye assignment (assign_pending) bhi "unread"
  // count hoti hain — agent ko red chats wahan bhi dikhein.
  function matchesTab(conversation) {
    const f = filterRef.current;
    if (f.unread && !(conversation.unread > 0) && !(agentView && conversation.assign_pending)) return false;
    if (f.status !== 'all' && conversation.status !== f.status) return false;
    // Agent filter (sirf Inbox/admin): 'none' = unassigned, warna agent id.
    const ag = agentFilterRef.current;
    if (!agentView && ag !== 'all') {
      if (ag === 'none') {
        if (conversation.assigned_agent_id != null) return false;
      } else if (String(conversation.assigned_agent_id) !== ag) {
        return false;
      }
    }
    return true;
  }

  function startListResize(e) {
    e.preventDefault();
    const startX = e.clientX;
    const startW = listWidthRef.current;
    const onMove = (ev) => {
      const w = Math.min(MAX_LIST_WIDTH, Math.max(MIN_LIST_WIDTH, startW + ev.clientX - startX));
      listWidthRef.current = w;
      setListWidth(w);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      try {
        localStorage.setItem(LIST_WIDTH_KEY, String(listWidthRef.current));
      } catch {}
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  function upsert(list, conversation) {
    let next;
    const idx = list.findIndex((c) => c.id === conversation.id);
    if (idx === -1) next = [conversation, ...list];
    else {
      next = [...list];
      next[idx] = { ...next[idx], ...conversation };
    }
    if (agentView) next = next.filter((c) => c.assigned_agent_id === user?.id);
    return next
      .filter(matchesTab)
      .sort((a, b) => (b.last_message_at || 0) - (a.last_message_at || 0));
  }

  function mergeMessages(prev, incoming) {
    const seen = new Set(prev.map((m) => m.id));
    const fresh = (incoming || []).filter((m) => m && !seen.has(m.id));
    return fresh.length ? [...prev, ...fresh] : prev;
  }

  const select = useCallback(
    async (id) => {
      try {
        const { conversation, messages: list } = await api.conversation(id);
        setActiveId(id);
        setMessages(list);
        setActive(conversation);
        setConversations((prev) =>
          prev
            .map((c) => (c.id === id ? { ...c, unread: 0, assign_pending: 0 } : c))
            .filter(matchesTab)
        );
        api.markRead(id).catch(() => {});
      } catch (e) {
        console.error(e);
      }
    },
    []
  );

  const refresh = useCallback(
    async (opts = {}) => {
      const { silent = false } = opts;
      if (!silent) setRefreshing(true);
      try {
        const f = filterRef.current;
        // My Chats ka Unread tab client-side filter hota hai (unread ya
        // assign_pending), is liye server ka unread filter sirf Inbox ke liye.
        const { conversations: list } = await api.conversations({
          status: f.status,
          unread: f.unread && !agentView,
          agent: agentFilterRef.current,
        });
        setConversations((prev) => {
          let next = list;
          if (agentView) next = list.filter((c) => c.assigned_agent_id === user?.id);
          return [...next]
            .filter((c) => matchesTab(c))
            .sort((a, b) => (b.last_message_at || 0) - (a.last_message_at || 0));
        });
        if (!agentView) {
          api.assignmentCounts().then(setAgentCounts).catch(() => {});
        }
        if (activeIdRef.current) {
          try {
            const { conversation, messages: msgs } = await api.conversation(activeIdRef.current);
            setActive(conversation);
            setMessages(msgs);
          } catch {
            setActiveId(null);
            setActive(null);
            setMessages([]);
          }
        }
      } catch (e) {
        console.error('refresh fail:', e);
      } finally {
        if (!silent) setRefreshing(false);
      }
    },
    [agentView, user?.id]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setError(null);
        const f = filterRef.current;
        const { conversations: list } = await api.conversations({
          status: f.status,
          unread: f.unread && !agentView,
          agent: agentFilterRef.current,
        });
        let filtered = agentView ? list.filter((c) => c.assigned_agent_id === user?.id) : list;
        if (!agentView) {
          api.assignmentCounts().then((c) => { if (!cancelled) setAgentCounts(c); }).catch(() => {});
        }
        const sorted = [...filtered].sort((a, b) => (b.last_message_at || 0) - (a.last_message_at || 0));
        if (cancelled) return;
        setConversations(sorted.filter((c) => matchesTab(c)));
        // My Chats: koi chat khud nahi khulti — jab tak agent khud click na kare,
        // nayi assigned chat red highlight mein visible rahe. Inbox (admin/owner)
        // mein pehli chat pehle ki tarah khud khul jati hai.
        if (!agentView && sorted.length && !f.unread) {
          const snap = await api.conversation(sorted[0].id);
          if (cancelled) return;
          setActiveId(sorted[0].id);
          setMessages(snap.messages);
          setActive(snap.conversation);
          api.markRead(sorted[0].id).catch(() => {});
        } else if (!agentView) {
          setActiveId(null);
          setActive(null);
          setMessages([]);
        }
      } catch (e) {
        if (!cancelled) setError('Conversations load nahi ho saki.');
        console.error(e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    if (!agentView) {
      api.agents().then(({ agents: list }) => setAgents(list)).catch(() => {});
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, agentView, agentFilter]);

  useEffect(() => {
    const t = setInterval(() => refresh({ silent: true }), AUTO_REFRESH_MS);
    return () => clearInterval(t);
  }, [refresh]);

  // SSE realtime
  useEffect(() => {
    const source = new EventSource('/api/stream');
    source.onopen = () => {};
    source.onerror = () => {};

    const handleMessage = (payload) => {
      const { conversation, message } = payload;
      if (!conversation) return;
      setConversations((prev) => upsert(prev, conversation));
      if (activeIdRef.current === conversation.id) {
        setMessages((prev) => mergeMessages(prev, [message]));
        if (message && message.direction === 'inbound') {
          api.markRead(conversation.id).catch(() => {});
        }
        setActive((t) => (t && t.id === conversation.id ? conversation : t));
      }
    };

    const handleConversation = (payload) => {
      if (!payload.conversation) return;
      setConversations((prev) => upsert(prev, payload.conversation));
      if (activeIdRef.current === payload.conversation.id) {
        setActive(payload.conversation);
        if (agentView && payload.conversation.assigned_agent_id !== user?.id) {
          setActiveId(null);
          setActive(null);
          setMessages([]);
        } else if (agentView && payload.conversation.assign_pending) {
          // Chat pehle se khuli hai — assignment dekhi ja chuki hai, red clear.
          api.markRead(payload.conversation.id).catch(() => {});
        }
      }
    };

    const handleMessageDeleted = (payload) => {
      if (activeIdRef.current === payload.conversation_id) {
        setMessages((prev) => prev.filter((m) => m.id !== payload.message_id));
      }
    };

    const handleMessageEdited = (payload) => {
      if (activeIdRef.current !== payload.conversation_id) return;
      setMessages((prev) =>
        prev.map((m) => (m.id === payload.message.id ? { ...m, ...payload.message } : m))
      );
    };

    source.addEventListener('message', (event) => handleMessage(JSON.parse(event.data)));
    source.addEventListener('conversation', (event) => handleConversation(JSON.parse(event.data)));
    source.addEventListener('message-deleted', (event) => handleMessageDeleted(JSON.parse(event.data)));
    source.addEventListener('message-edited', (event) => handleMessageEdited(JSON.parse(event.data)));

    return () => {
      source.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentView, user?.id]);

  async function send(text, replyToId = null) {
    if (!activeId || !text.trim()) return;
    try {
      const { message } = await api.reply(activeId, { body: text.trim(), ...(replyToId ? { reply_to_id: replyToId } : {}) });
      setMessages((prev) => mergeMessages(prev, [message]));
      setConversations((prev) =>
        upsert(prev, {
          ...prev.find((c) => c.id === activeId),
          last_message: message.body,
          last_message_at: message.created_at,
        })
      );
    } catch (e) {
      setError(e.message);
    }
  }

  async function sendMedia(payload) {
    if (!activeId) return;
    try {
      const { message } = await api.reply(activeId, payload);
      setMessages((prev) => mergeMessages(prev, [message]));
      setConversations((prev) =>
        upsert(prev, {
          ...prev.find((c) => c.id === activeId),
          last_message: message.media_type ? `[${message.media_type}]` : message.body,
          last_message_at: message.created_at,
        })
      );
    } catch (e) {
      setError(e.message);
    }
  }

  // Meta already-sent message edit nahi kar sakta, is liye corrected text naya
  // message ban kar jata hai aur purana "(edited)" mark ho jata hai.
  async function editMessage(messageId, body) {
    if (!activeId) return;
    const { message, edited } = await api.editMessage(activeId, messageId, body);
    setMessages((prev) => prev.map((m) => (m.id === edited.id ? { ...m, ...edited } : m)));
    setMessages((prev) => mergeMessages(prev, [message]));
    setConversations((prev) =>
      upsert(prev, {
        ...prev.find((c) => c.id === activeId),
        last_message: message.body,
        last_message_at: message.created_at,
      })
    );
  }

  async function changeStatus(status) {
    if (!activeId) return;
    try {
      const { conversation } = await api.setStatus(activeId, status);
      setConversations((prev) => upsert(prev, conversation));
      setActive(conversation);
    } catch (e) {
      setError(e.message);
    }
  }

  async function doAssign(agentId, note, media) {
    if (!activeId) return;
    try {
      const { conversation, note: noteRecord } = await api.assign(
        activeId,
        agentId,
        note || '',
        media || {}
      );
      setConversations((prev) => upsert(prev, conversation));
      // Agent-wise counts turant update karo (filter dropdown ke numbers).
      api.assignmentCounts().then(setAgentCounts).catch(() => {});
      setActive((t) => (t && t.id === activeId ? conversation : t));
      if (noteRecord) setMessages((prev) => mergeMessages(prev, [noteRecord]));
    } catch (e) {
      setError(e.message);
      throw e;
    }
  }

  async function addNote(body) {
    if (!activeId) return;
    try {
      const { note } = await api.addNote(activeId, { body });
      setMessages((prev) => mergeMessages(prev, [note]));
    } catch (e) {
      setError(e.message);
    }
  }

  async function deleteNote(messageId) {
    if (!activeId) return;
    try {
      await api.deleteNote(activeId, messageId);
      setMessages((prev) => prev.filter((m) => m.id !== messageId));
    } catch (e) {
      setError(e.message);
    }
  }

  function dismissChat() {
    setMobileNotes(false);
    setActiveId(null);
    setActive(null);
    setMessages([]);
  }

  const sorted = [...conversations].sort((a, b) => (b.last_message_at || 0) - (a.last_message_at || 0));

  const q = search.trim().toLowerCase();
  const visible = q
    ? sorted.filter((c) => {
        const name = String(c.contact_name || c.external_id || '').toLowerCase();
        return name.includes(q);
      })
    : sorted;

  return (
    <div className="relative flex h-full overflow-hidden">
      {/* conversation list */}
      <div
        className={`${activeId ? 'hidden' : 'flex'} md:flex flex-col border-r border-slate-200 bg-white`}
        style={{ width: listWidth }}
      >
        <div className="flex items-center justify-between gap-2 bg-gradient-to-br from-brand to-lemon px-4 py-3">
          <div>
            <h2 className="text-lg font-semibold text-white">{agentView ? 'My Chats' : 'Inbox'}</h2>
            <p className="text-xs text-white/85">
              {sorted.length} active {sorted.length === 1 ? 'conversation' : 'conversations'}
            </p>
          </div>
          <button
            onClick={() => refresh()}
            disabled={refreshing}
            title="Conversation list refresh karo"
            className="rounded-lg bg-white/20 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-white/30 disabled:opacity-60"
          >
            {refreshing ? '🔄...' : '↻ Refresh'}
          </button>
        </div>
        {error && <p className="bg-brand-soft p-2 text-xs text-brand">{error}</p>}
        <div className="border-b border-slate-200 p-2">
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">
              🔍
            </span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Customer name se search karo..."
              className="w-full rounded-lg border border-slate-300 py-2 pl-8 pr-8 text-sm text-slate-800 outline-none focus:border-lemon"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                title="Search clear karo"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:text-brand"
              >
                ✕
              </button>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 overflow-x-auto border-b border-slate-200 px-2 py-1.5">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setActiveTab(t.key)}
              className={`whitespace-nowrap rounded-lg px-3 py-1 text-xs font-semibold transition ${
                activeTab === t.key
                  ? 'bg-brand text-white shadow-sm'
                  : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'
              }`}
            >
              {t.label}
            </button>
          ))}
          {/* Agent tabs (sirf admin/owner): click = us agent ki chats,
              active chip par dobara click = filter hat jata hai.
              Har naam ke saath uske assigned chats ka count hai. */}
          {!agentView && isStaff && agentCounts.agents.length > 0 && (
            <span className="mx-1 h-4 w-px shrink-0 bg-slate-300" />
          )}
          {!agentView && isStaff && (
            <>
              <button
                type="button"
                onClick={() => setAgentFilter(agentFilter === 'none' ? 'all' : 'none')}
                title="Kisi agent ko assign nahi hui chats"
                className={`whitespace-nowrap rounded-lg px-3 py-1 text-xs font-semibold transition ${
                  agentFilter === 'none'
                    ? 'bg-brand text-white shadow-sm'
                    : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'
                }`}
              >
                Unassigned{agentCounts.unassigned > 0 ? ` (${agentCounts.unassigned})` : ''}
              </button>
              {agentCounts.agents.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => setAgentFilter(agentFilter === String(a.id) ? 'all' : String(a.id))}
                  title={`${a.name} ki assigned chats (${a.count}) — click par sirf yahi agent ki chats`}
                  className={`whitespace-nowrap rounded-lg px-3 py-1 text-xs font-semibold transition ${
                    agentFilter === String(a.id)
                      ? 'bg-brand text-white shadow-sm'
                      : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'
                  }`}
                >
                  👤 {a.name} ({a.count})
                </button>
              ))}
            </>
          )}
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading && <p className="p-4 text-sm text-slate-500">Loading...</p>}
          {visible.map((c) => {
            const ch = channelOf(c.channel);
            return (
              <button
                key={c.id}
                onClick={() => select(c.id)}
                className={`block w-full border-b px-4 py-3 text-left transition ${
                  activeId === c.id
                    ? 'bg-brand-soft'
                    : agentView && c.assign_pending
                      ? 'border-red-100 bg-red-50 hover:bg-red-100'
                      : 'border-slate-100 bg-white hover:bg-slate-50'
                }`}
              >
                <div className="flex items-start gap-3">
                  <Avatar name={c.contact_name} photo={c.photo} className="h-10 w-10 text-base" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between">
                      <span className="truncate text-sm font-semibold text-slate-800">
                        {c.contact_name}
                      </span>
                      <div className="ml-2 flex items-center gap-1.5">
                        {agentView && c.assign_pending > 0 && (
                          <span
                            className="rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-bold text-white"
                            title="Nayi assigned chat — abhi open nahi ki"
                          >
                            new
                          </span>
                        )}
                        {(c.unread || 0) > 0 && (
                          <span className="flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-brand px-1 text-[10px] font-bold text-white">
                            {c.unread > 99 ? '99+' : c.unread}
                          </span>
                        )}
                        <span className="whitespace-nowrap text-[10px] text-slate-400">
                          {formatTime(c.last_message_at)}
                        </span>
                      </div>
                    </div>
                    <div className="mt-0.5 flex items-center justify-between gap-2">
                      <span className="truncate text-xs text-slate-500">
                        {c.last_message || (c.status === 'resolved' ? '(resolved)' : 'Koi message nahi')}
                      </span>
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                          c.status === 'resolved'
                            ? 'bg-green-100 text-green-700'
                            : c.status === 'pending'
                              ? 'bg-amber-100 text-amber-700'
                              : 'bg-sky-100 text-sky-600'
                        }`}
                      >
                        {c.status === 'resolved'
                          ? 'resolved'
                          : c.status === 'pending'
                            ? 'pending'
                            : 'open'}
                      </span>
                    </div>
                    {!agentView && (
                      <div className="mt-0.5 flex items-center gap-1">
                        <span
                          className="inline-block h-2 w-2 shrink-0 rounded-full"
                          style={{ background: ch.color }}
                          title={ch.label}
                        />
                        <span className="shrink-0 text-[10px] text-slate-400">{ch.label}</span>
                      </div>
                    )}
                    {!agentView && isStaff && (
                      <div className="mt-1">
                        {c.assigned_agent_name ? (
                          <span
                            className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-full bg-brand-soft px-2 py-0.5 text-[10px] font-semibold text-brand"
                            title={`Chat is agent ke paas hai: ${c.assigned_agent_name}`}
                          >
                            👤 <span className="truncate">{c.assigned_agent_name}</span>
                          </span>
                        ) : (
                          <span
                            className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-600"
                            title="Kisi agent ko assign nahi — chat khol kar Assign karein"
                          >
                            unassigned
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
          {!loading && !visible.length && (
            <p className="p-4 text-sm text-slate-400">
              {q ? `"${search}" se koi conversation nahi mili.` : 'Abhi koi conversation nahi hai.'}
            </p>
          )}
        </div>
      </div>

      {/* resize handle */}
      <div
        onMouseDown={startListResize}
        title="Drag karo: chota/bara"
        className="hidden w-1.5 shrink-0 cursor-col-resize bg-slate-200 transition hover:bg-brand/50 active:bg-brand md:block"
      />

      {/* chat column */}
      <div className={`${activeId ? 'flex' : 'hidden'} md:flex flex-1`}>
        <ChatWindow
          active={active}
          messages={messages}
          onSend={send}
          onSendMedia={sendMedia}
          onEdit={editMessage}
          canAssign={!agentView && isStaff}
          canNote={isStaff || active?.assigned_agent_id === user?.id}
          agents={agents}
          onAssign={doAssign}
          onAddNote={addNote}
          onDeleteNote={deleteNote}
          onChangeStatus={changeStatus}
          onDismiss={dismissChat}
          onToggleNotes={() => setMobileNotes((o) => !o)}
          mobileNotes={mobileNotes}
          onError={setError}
          myId={user?.id}
          isStaff={isStaff}
          showAgent={user?.role === 'owner'}
        />
      </div>
    </div>
  );
}