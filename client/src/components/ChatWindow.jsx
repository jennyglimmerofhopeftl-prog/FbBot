import { useEffect, useRef, useState } from 'react';
import { channelOf, formatClock, formatFull } from '../channels';
import { uploadFile } from '../api';
import Avatar from './Avatar.jsx';

function BrokenImage({ type = 'image' }) {
  return (
    <div className="mb-1 flex items-center justify-center rounded-lg border border-brand/20 bg-brand-soft px-3 py-4 text-xs text-brand">
      {type === 'image'
        ? '🖼 Image load nahi hui'
        : type === 'video'
          ? '🎬 Video load nahi hua'
          : '📄 File load nahi hui'}
    </div>
  );
}

function MediaImage({ src, className }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <BrokenImage type="image" />;
  return <img src={src} alt="image" onError={() => setFailed(true)} className={className} />;
}

function MediaVideo({ src, className }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <BrokenImage type="video" />;
  return (
    <video src={src} controls preload="metadata" onError={() => setFailed(true)} className={className} />
  );
}

function Media({ m, className = '', mine = false }) {
  if (!m.media_url) return null;
  if (m.media_type === 'video') return <MediaVideo src={m.media_url} className={className} />;
  if (m.media_type === 'image') return <MediaImage src={m.media_url} className={className} />;
  return (
    <a
      href={m.media_url}
      target="_blank"
      rel="noreferrer"
      className={`mb-1 flex items-center gap-1 text-xs underline ${mine ? 'text-white/85' : 'text-slate-500'}`}
    >
      📄 {decodeURIComponent(m.media_url.split('/').pop() || 'file')}
    </a>
  );
}

function DetailRow({ label, value }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-2">
      <dt className="text-xs font-medium text-slate-400">{label}</dt>
      <dd className="text-right text-xs font-semibold text-slate-700">{value || '—'}</dd>
    </div>
  );
}

function kindOf(file) {
  const t = (file.type || '').split('/')[0];
  return t === 'image' || t === 'video' ? t : 'document';
}

function makePreview(file) {
  return { id: crypto.randomUUID(), file, kind: kindOf(file), preview: kindOf(file) === 'document' ? null : URL.createObjectURL(file) };
}

function Previews({ items, onRemove }) {
  return (
    <div className="mb-2 flex gap-2 overflow-x-auto pb-1">
      {items.map((p) => (
        <div key={p.id} className="relative shrink-0">
          {p.kind === 'video' ? (
            <video src={p.preview} muted className={`${p.small ? 'h-12 w-12' : 'h-16 w-16'} rounded-lg border border-slate-200 bg-black object-cover`} />
          ) : p.kind === 'image' ? (
            <img src={p.preview} alt="preview" className={`${p.small ? 'h-12 w-12' : 'h-16 w-16'} rounded-lg border border-slate-200 object-cover`} />
          ) : (
            <div className={`${p.small ? 'h-12 max-w-24' : 'h-16 max-w-32'} flex items-center justify-center rounded-lg border border-slate-200 bg-slate-50 px-2 text-xl`} title={p.file.name}>
              📄
            </div>
          )}
          <button
            type="button"
            onClick={() => onRemove(p.id)}
            title="Hatana"
            className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-brand text-xs font-bold text-white shadow hover:brightness-110"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

function QuoteBar({ quote, mine = false }) {
  if (!quote) return null;
  const sender =
    quote.sender === 'agent'
      ? 'Agent'
      : quote.sender === 'note'
        ? 'Note'
        : quote.sender === 'customer'
          ? 'Customer'
          : 'Myself';
  const mediaText = quote.media_url
    ? quote.media_type === 'image'
      ? '[image]'
      : quote.media_type === 'video'
        ? '[video]'
        : '[file]'
    : '';
  const label = (quote.body || mediaText || '');
  return (
    <div
      className={`mb-1 flex items-center gap-1.5 overflow-hidden rounded-lg border-l-2 px-2 py-1 text-xs ${
        mine
          ? 'border-white/60 bg-white/15 text-white/85'
          : 'border-brand/30 bg-brand-soft text-slate-500'
      }`}
    >
      <span className="shrink-0 font-semibold">↩ {sender}</span>
      {quote.media_url && quote.media_type === 'image' && (
        <img
          src={quote.media_url}
          alt="quoted"
          className="h-8 w-8 shrink-0 rounded object-cover"
        />
      )}
      {quote.media_url && quote.media_type === 'video' && (
        <span className="shrink-0">🎬</span>
      )}
      <span className="truncate">{label}</span>
    </div>
  );
}

function ReplyButton({ onClick, after = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Is message par reply karo (quote)"
      className={`${after ? 'order-2' : 'order-1'} ml-1.5 mt-2 shrink-0 self-start rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs text-brand opacity-100 shadow-sm transition hover:bg-brand-soft group-hover/mbubble:opacity-100 md:opacity-0`}
    >
      ↩
    </button>
  );
}

function MessageBubble({ m, onReply, replying, onDelete, canDelete, onEdit, showAgent }) {
  if (m.sender === 'note') {
    return (
      <div className="flex justify-center">
        <div className="max-w-[85%] rounded-xl border border-lemon/30 bg-lemon-soft px-4 py-2 text-sm text-slate-700 shadow-sm">
          <p className="mb-0.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-lemon">
            📝 Note — sirf team ko
          </p>
          <Media m={m} className="mb-1 max-h-64 max-w-full rounded-lg" />
          {m.body ? <p className="whitespace-pre-wrap break-words">{m.body}</p> : null}
          <div className="mt-1 flex items-center justify-end gap-2">
            {canDelete && (
              <button onClick={onDelete} title="Note delete karo" className="text-slate-400 hover:text-brand">
                🗑
              </button>
            )}
            <p className="text-[10px] text-slate-400">{formatClock(m.created_at)}</p>
          </div>
        </div>
      </div>
    );
  }

  const mine = m.direction === 'outbound';
  return (
    <div className={`group/mbubble flex ${mine ? 'justify-end' : 'justify-start'}`}>
      {mine ? (
        <ReplyButton after onClick={onReply} />
      ) : (
        <ReplyButton onClick={onReply} />
      )}
      <div className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
        <div
          className={`rounded-2xl px-4 py-2 text-sm shadow-sm ${
            mine
              ? 'bg-gradient-to-br from-brand to-lemon text-white shadow-lemon/30'
              : 'bg-white text-slate-800'
          } ${replying ? 'ring-2 ring-lemon' : ''}`}
        >
          <QuoteBar quote={m.reply_to} mine={mine} />
          <Media m={m} className="mb-1 max-h-64 max-w-full rounded-lg" mine={mine} />
          {m.body ? <p className="whitespace-pre-wrap break-words">{m.body}</p> : null}
          <div className={`mt-1 flex items-center justify-end gap-2 text-[10px] ${mine ? 'text-white/60' : 'text-slate-400'}`}>
            {m.edited_at ? <span className="italic">(edited)</span> : null}
            {mine && m.body && !m.media_url ? (
              <button
                type="button"
                onClick={onEdit}
                title="Edit karo — corrected text naya message ban kar jayega"
                className={mine ? 'text-white/70 transition hover:text-white' : 'text-slate-400 transition hover:text-brand'}
              >
                ✏️
              </button>
            ) : null}
            <span>{formatClock(m.created_at)}</span>
          </div>
        </div>
        {showAgent && mine && m.agent_id ? (
          <p className="mt-1 px-1 text-[10px] text-slate-400">
            {`Agent #${m.agent_id}`}
            {m.agent_name ? ` · ${m.agent_name}` : ''}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export default function ChatWindow({
  active,
  messages,
  onSend,
  canAssign,
  canNote,
  agents,
  onAssign,
  onAddNote,
  onDeleteNote,
  onChangeStatus,
  onDismiss,
  onToggleNotes,
  mobileNotes,
  onSendMedia,
  onEdit,
  onError,
  myId,
  isStaff,
  showAgent,
}) {
  const [text, setText] = useState('');
  const [pending, setPending] = useState([]);
  const [sending, setSending] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [forwardAgent, setForwardAgent] = useState('');
  const [forwardNote, setForwardNote] = useState('');
  const [forwardFiles, setForwardFiles] = useState([]);
  const [forwardBusy, setForwardBusy] = useState(false);
  const [quickNote, setQuickNote] = useState('');
  const [quickBusy, setQuickBusy] = useState(false);
  const [notesWidth, setNotesWidth] = useState(320);
  const [showInfo, setShowInfo] = useState(false);
  const [replyingTo, setReplyingTo] = useState(null);
  const [editing, setEditing] = useState(null);
  const fileRef = useRef(null);
  const textRef = useRef(null);
  const forwardFileRef = useRef(null);
  const scrollRef = useRef(null);
  const msgListRef = useRef(null);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  const forwardRef = useRef(forwardFiles);
  forwardRef.current = forwardFiles;

  useEffect(() => {
    setPending([]);
    setText('');
    setForwardFiles([]);
    setForwardAgent('');
    setForwardNote('');
    setQuickNote('');
    setShowInfo(false);
    setReplyingTo(null);
    setEditing(null);
  }, [active?.id]);

  useEffect(() => {
    return () => {
      pendingRef.current.forEach((p) => p.preview && URL.revokeObjectURL(p.preview));
      forwardRef.current.forEach((p) => p.preview && URL.revokeObjectURL(p.preview));
    };
  }, []);

  // scroll to bottom on thread open
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      scrollRef.current?.scrollIntoView({ block: 'end' });
    });
    return () => cancelAnimationFrame(raf);
  }, [active?.id]);

  // smart follow near bottom
  useEffect(() => {
    const el = msgListRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  if (!active) {
    return (
      <div className="flex flex-1 items-center justify-center bg-sky-50">
        <p className="text-slate-400">Koi conversation select karo</p>
      </div>
    );
  }

  const channel = channelOf(active.channel);
  const notes = messages.filter((m) => m.sender === 'note');

  function addFiles(files) {
    if (editing) return;
    setPending((prev) => [...prev, ...[...files].map(makePreview)]);
  }

  function removePending(id) {
    setPending((prev) => {
      const found = prev.find((p) => p.id === id);
      if (found?.preview) URL.revokeObjectURL(found.preview);
      return prev.filter((p) => p.id !== id);
    });
  }

  function addForwardFiles(files) {
    setForwardFiles((prev) => [...prev, ...[...files].map((f) => ({ ...makePreview(f), small: true }))]);
  }

  function removeForwardFile(id) {
    setForwardFiles((prev) => {
      const found = prev.find((p) => p.id === id);
      if (found?.preview) URL.revokeObjectURL(found.preview);
      return prev.filter((p) => p.id !== id);
    });
  }

  function onPaste(e) {
    const items = e.clipboardData?.items || [];
    const files = [];
    for (const it of items) {
      const f = it.getAsFile();
      if (f) files.push(f);
    }
    if (files.length) {
      e.preventDefault();
      addFiles(files);
    }
  }

  function onDrop(e) {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
  }

  function onPasteForward(e) {
    const items = e.clipboardData?.items || [];
    const files = [];
    for (const it of items) {
      const f = it.getAsFile();
      if (f) files.push(f);
    }
    if (files.length) {
      e.preventDefault();
      addForwardFiles(files);
    }
  }

  function onDropForward(e) {
    e.preventDefault();
    if (e.dataTransfer?.files?.length) addForwardFiles(e.dataTransfer.files);
  }

  async function uploadQueue(list) {
    const out = [];
    for (const p of list) {
      const up = await uploadFile(p.file);
      out.push({ media_type: up.media_type, media_url: up.url });
      if (p.preview) URL.revokeObjectURL(p.preview);
    }
    return out;
  }

  function startEdit(m) {
    setEditing(m);
    setReplyingTo(null);
    setPending([]);
    setText(m.body || '');
    requestAnimationFrame(() => textRef.current?.focus());
  }

  async function submit(e) {
    e.preventDefault();
    if (sending) return;

    // Edit mode: corrected text naya message ban kar jayega.
    if (editing) {
      if (!text.trim()) return;
      setSending(true);
      try {
        await onEdit(editing.id, text.trim());
        setText('');
        setEditing(null);
      } catch (err) {
        onError(err.message);
      } finally {
        setSending(false);
      }
      return;
    }

    if (!pending.length && !text.trim()) return;
    setSending(true);
    try {
      const replyToId = replyingTo?.id || null;
      if (pending.length) {
        const caption = text.trim();
        const uploaded = await uploadQueue(pending);
        let i = 0;
        for (const item of uploaded) {
          await onSendMedia({ body: i === 0 && caption ? caption : '', reply_to_id: replyToId, ...item });
          i++;
        }
        setPending([]);
        setText('');
      } else {
        await onSend(text.trim(), replyToId);
        setText('');
      }
      setReplyingTo(null);
    } catch (err) {
      onError(err.message);
    } finally {
      setSending(false);
    }
  }

  async function submitForward(e) {
    e.preventDefault();
    if (!forwardAgent || forwardBusy) return;
    setForwardBusy(true);
    try {
      let media;
      if (forwardFiles.length) {
        const uploaded = await uploadQueue(forwardFiles);
        media = uploaded[0];
      }
      await onAssign(Number(forwardAgent), forwardNote, media);
      setForwardAgent('');
      setForwardNote('');
      setForwardFiles([]);
    } catch (err) {
      onError(err.message);
    } finally {
      setForwardBusy(false);
    }
  }

  async function submitQuickNote(e) {
    e.preventDefault();
    if (quickBusy) return;
    if (!quickNote.trim()) return;
    setQuickBusy(true);
    try {
      await onAddNote(quickNote.trim());
      setQuickNote('');
    } catch (err) {
      onError(err.message);
    } finally {
      setQuickBusy(false);
    }
  }

  function handleStatusAction(e) {
    const action = e.target.value;
    e.target.value = '';
    if (action === 'pending') onChangeStatus('pending');
    else if (action === 'resolved') onChangeStatus('resolved');
    else if (action === 'open') onChangeStatus('open');
  }

  function canDeleteNote(note) {
    return isStaff || note.agent_id === myId;
  }

  return (
    <div className="flex flex-1">
      {/* main column */}
      <div className="flex flex-1 flex-col bg-sky-50">
        <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
          <div className="flex items-center gap-3">
            <Avatar name={active.contact_name} photo={active.photo} className="h-10 w-10 text-base" />
            <div>
              <button
                type="button"
                onClick={() => setShowInfo(true)}
                title="Customer details dekho"
                className="text-left font-semibold text-slate-800 transition hover:text-brand hover:underline"
              >
                {active.contact_name}
              </button>
              <p className="text-xs text-slate-500">
                <span style={{ color: channel.color }}>{channel.label}</span>
                {active.assigned_agent_name ? ` · Agent: ${active.assigned_agent_name}` : ''}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`hidden rounded px-2 py-0.5 text-[10px] font-semibold capitalize sm:inline-block ${
              active.status === 'resolved'
                ? 'bg-green-100 text-green-700'
                : active.status === 'pending'
                  ? 'bg-amber-100 text-amber-700'
                  : 'bg-sky-100 text-sky-600'
            }`}>
              {active.status}
            </span>
            <button
              onClick={() => setShowInfo(true)}
              title="Customer details"
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
            >
              ℹ️
            </button>
            <button
              onClick={onToggleNotes}
              title="Notes kholo/band karo"
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 md:hidden"
            >
              📝
            </button>
            {isStaff ? (
              <select
                onChange={handleStatusAction}
                defaultValue=""
                title="Status badlo"
                className="rounded-lg border border-slate-300 bg-white px-1 py-0.5 text-[11px] text-slate-600 hover:bg-slate-100 focus:outline-none hidden sm:block"
              >
                <option value="" disabled>⋯</option>
                <option value="open">Mark Open</option>
                <option value="pending">Mark Pending</option>
                <option value="resolved">Resolve Chat</option>
              </select>
            ) : (
              <button
                onClick={onDismiss}
                title="Chat panel band karo (conversation close nahi hogi)"
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        <div ref={msgListRef} className="flex-1 space-y-3 overflow-y-auto p-4">
          {messages
            .filter((m) => m.sender !== 'note')
            .map((m) => (
              <MessageBubble
                key={m.id}
                m={m}
                showAgent={showAgent}
                onReply={() => { setEditing(null); setReplyingTo(m); }}
                onEdit={() => startEdit(m)}
                replying={replyingTo?.id === m.id}
              />
            ))}
          {messages.filter((m) => m.sender !== 'note').length === 0 && (
            <div className="flex h-full items-center justify-center">
              <p className="text-sm text-slate-400">Is conversation ka koi message nahi. Pehla reply bhejein.</p>
            </div>
          )}
          <div ref={scrollRef} />
        </div>

        <form
          onSubmit={submit}
          onPaste={onPaste}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false); }}
          onDrop={onDrop}
          className="relative border-t border-slate-200 bg-white p-3"
        >
          {dragging && (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-lemon bg-lemon-soft/90">
              <p className="text-sm font-semibold text-brand">📷 Images/Videos/Files yahan drop karo</p>
            </div>
          )}

          {pending.length > 0 && <Previews items={pending} onRemove={removePending} />}

          {editing && (
            <div className="mb-2 flex items-start gap-2 rounded-lg border border-lemon/40 bg-lemon-soft px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-lemon">
                  ✏️ Editing message
                </p>
                <p className="truncate text-xs text-slate-600">
                  Send karne par corrected text naya message ban kar jayega; purana "(edited)" mark ho jayega.
                </p>
              </div>
              <button
                type="button"
                onClick={() => { setEditing(null); setText(''); }}
                className="rounded p-0.5 text-slate-400 hover:text-brand"
                title="Edit cancel karo"
              >
                ✕
              </button>
            </div>
          )}

          {replyingTo && (
            <div className="mb-2 flex items-start gap-2 rounded-lg border border-lemon/30 bg-lemon-soft px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-lemon">
                  ↩ Reply to{' '}
                  {replyingTo.direction === 'outbound'
                    ? 'myself'
                    : replyingTo.sender === 'agent'
                      ? 'agent'
                      : 'customer'}
                </p>
                <p className="truncate text-xs text-slate-600">
                  {replyingTo.media_url
                    ? (replyingTo.media_type === 'image'
                        ? '[image]'
                        : replyingTo.media_type === 'video'
                          ? '[video]'
                          : '[file]')
                    : replyingTo.body || ''}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setReplyingTo(null)}
                className="rounded p-0.5 text-slate-400 hover:text-brand"
                title="Reply cancel karo"
              >
                ✕
              </button>
            </div>
          )}

          <div className="flex gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/*,video/*,.pdf,.txt"
              multiple
              hidden
              onChange={(e) => {
                addFiles(e.target.files || []);
                if (fileRef.current) fileRef.current.value = '';
              }}
            />
            {!editing && (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                title="Attach karo (drag-drop ya paste Ctrl+V)"
                className="rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-600 hover:bg-slate-100"
              >
                🖼
              </button>
            )}
            <textarea
              ref={textRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
              rows={1}
              placeholder={
                editing
                  ? 'Corrected text likhein...'
                  : pending.length
                    ? 'Media ke liye caption likho (optional)...'
                    : replyingTo
                      ? 'Is message par reply likhein...'
                      : `${channel.label} par reply likhein...`
              }
              className="max-h-48 min-h-[42px] flex-1 resize-y rounded-lg border border-slate-300 px-4 py-2.5 text-sm text-slate-800 outline-none focus:border-lemon"
            />
            <button
              type="submit"
              disabled={sending || (!text.trim() && !pending.length)}
              className="rounded-lg bg-gradient-to-br from-brand to-lemon px-5 py-2.5 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-40"
            >
              {sending ? 'Sending...' : editing ? 'Update' : pending.length ? `Send ${pending.length}` : 'Send'}
            </button>
          </div>
        </form>
      </div>

      {/* notes resize handle */}
      <div
        onMouseDown={(e) => {
          e.preventDefault();
          const startX = e.clientX;
          const startW = notesWidth;
          const onMove = (ev) => {
            setNotesWidth(Math.min(640, Math.max(200, startW - (ev.clientX - startX))));
          };
          const onUp = () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
          };
          window.addEventListener('mousemove', onMove);
          window.addEventListener('mouseup', onUp);
        }}
        title="Drag karo: chota/bara"
        className="hidden w-1.5 shrink-0 cursor-col-resize bg-slate-200 transition hover:bg-brand/50 active:bg-brand md:block"
      />

      {mobileNotes && (
        <div className="fixed inset-0 z-40 bg-black/40 md:hidden" onClick={onToggleNotes} />
      )}

      {/* notes panel */}
      <aside
        className={`flex-col border-l border-slate-200 bg-white ${
          mobileNotes
            ? 'fixed inset-y-0 right-0 z-50 flex w-80 shadow-xl'
            : 'hidden'
        } md:static md:z-auto md:flex md:shadow-none`}
        style={{ width: mobileNotes ? undefined : notesWidth }}
      >
        <div className="border-b border-slate-200 px-4 py-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-800">📝 Agent Notes</h3>
            <button onClick={onToggleNotes} className="rounded-lg border border-slate-200 p-1 text-xs text-slate-500 hover:bg-slate-100 md:hidden">
              ✕
            </button>
          </div>
          <p className="text-[11px] text-slate-400">Sirf team ko dikhte hain (customer ko nahi)</p>
        </div>

        <div className="flex-1 space-y-2 overflow-y-auto p-3">
          {notes.map((m) => (
            <div key={m.id} className="rounded-lg border border-lemon/30 bg-lemon-soft p-3">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[10px] font-semibold text-lemon">{m.agent_name || 'Agent'}</span>
                {canDeleteNote(m) && (
                  <button
                    onClick={() => onDeleteNote(m.id)}
                    title="Note delete karo"
                    className="text-slate-400 hover:text-brand"
                  >
                    🗑
                  </button>
                )}
              </div>
              <Media m={m} className="mb-2 max-h-52 w-full rounded-lg object-cover" />
              {m.body ? <p className="whitespace-pre-wrap break-words text-sm text-slate-700">{m.body}</p> : null}
              <p className="mt-1 text-right text-[10px] text-slate-400">{formatClock(m.created_at)}</p>
            </div>
          ))}
          {!notes.length && <p className="p-2 text-xs text-slate-400">Abhi koi note nahi.</p>}
        </div>

        {canAssign && (
          <form
            onSubmit={submitForward}
            onPaste={onPasteForward}
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDropForward}
            className="border-t border-slate-200 p-3"
          >
            <p className="mb-2 text-xs font-semibold text-slate-500">⇢ Forward + Note</p>
            <select
              value={forwardAgent}
              onChange={(e) => setForwardAgent(e.target.value)}
              className="mb-2 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm text-slate-700 outline-none focus:border-lemon"
            >
              <option value="">Agent assign karo...</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
            {forwardFiles.length > 0 && <Previews items={forwardFiles} onRemove={removeForwardFile} />}
            <textarea
              value={forwardNote}
              onChange={(e) => setForwardNote(e.target.value)}
              rows={2}
              placeholder="Note (optional)..."
              className="mb-2 w-full resize-none rounded-lg border border-slate-300 px-2 py-1.5 text-sm text-slate-700 outline-none focus:border-lemon"
            />
            <div className="flex items-center gap-2">
              <input
                ref={forwardFileRef}
                type="file"
                accept="image/*,video/*,.pdf,.txt"
                multiple
                hidden
                onChange={(e) => {
                  addForwardFiles(e.target.files || []);
                  if (forwardFileRef.current) forwardFileRef.current.value = '';
                }}
              />
              <button
                type="button"
                onClick={() => forwardFileRef.current?.click()}
                title="Note ke sath media attach (drag-drop ya Ctrl+V paste)"
                className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
              >
                🖼
              </button>
              <button
                type="submit"
                disabled={!forwardAgent || forwardBusy}
                className="flex-1 rounded-lg bg-gradient-to-br from-brand to-lemon px-3 py-1.5 text-sm font-medium text-white hover:brightness-110 disabled:opacity-40"
              >
                {forwardBusy ? 'Forwarding...' : `Forward${forwardFiles.length ? ` ${forwardFiles.length}` : ''}`}
              </button>
            </div>
          </form>
        )}

        {canNote && !canAssign && (
          <form onSubmit={submitQuickNote} className="border-t border-slate-200 p-3">
            <p className="mb-2 text-xs font-semibold text-slate-500">📝 Quick note</p>
            <textarea
              value={quickNote}
              onChange={(e) => setQuickNote(e.target.value)}
              rows={2}
              placeholder="Internal note..."
              className="mb-2 w-full resize-none rounded-lg border border-slate-300 px-2 py-1.5 text-sm text-slate-700 outline-none focus:border-lemon"
            />
            <button
              type="submit"
              disabled={quickBusy || !quickNote.trim()}
              className="w-full rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-200 disabled:opacity-40"
            >
              {quickBusy ? 'Adding...' : 'Add Note'}
            </button>
          </form>
        )}
      </aside>

      {/* info modal */}
      {showInfo && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={() => setShowInfo(false)}>
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between">
              <h3 className="text-sm font-bold text-slate-800">📋 Customer Details</h3>
              <button
                onClick={() => setShowInfo(false)}
                title="Band karo"
                className="rounded-lg border border-slate-200 px-2 py-0.5 text-sm text-slate-500 hover:bg-slate-100"
              >
                ✕
              </button>
            </div>

            <div className="mt-4 flex items-center gap-3">
              <Avatar name={active.contact_name} photo={active.photo} className="h-16 w-16 text-xl" />
              <div className="min-w-0">
                <p className="truncate font-semibold text-slate-800">{active.contact_name}</p>
                <p className="text-sm text-slate-500">{active.external_id}</p>
              </div>
            </div>

            <dl className="mt-4 space-y-2 text-sm">
              <DetailRow label="Channel" value={channel.label} />
              <DetailRow label="Status" value={active.status} />
              <DetailRow label="Assigned to" value={active.assigned_agent_name || 'Unassigned'} />
              <DetailRow label="Unread" value={`${active.unread || 0}`} />
              <DetailRow label="Last message" value={formatFull(active.last_message_at)} />
              <DetailRow label="Created" value={formatFull(active.created_at)} />
            </dl>
          </div>
        </div>
      )}
    </div>
  );
}