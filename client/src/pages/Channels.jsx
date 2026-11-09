import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { CHANNELS } from '../channels';

// Har channel ke fields alag hain, is liye form schema bhi per-channel hai.
const FIELDS = {
  facebook: [
    { key: 'account_id', label: 'Page ID', required: true, placeholder: '123456789012345' },
    { key: 'token', label: 'Page Access Token', required: true, secret: true, placeholder: 'EAAG...' },
  ],
  instagram: [
    { key: 'account_id', label: 'IG Account ID', required: true, placeholder: '17841400000000000' },
    { key: 'token', label: 'Instagram Access Token', required: true, secret: true, placeholder: 'IGAA...' },
  ],
  whatsapp: [
    { key: 'account_id', label: 'Phone Number ID', required: true, placeholder: '123456789012345' },
    { key: 'token', label: 'WhatsApp Token', required: true, secret: true, placeholder: 'EAAG...' },
    { key: 'wa_own_number', label: 'Apna number (optional)', placeholder: '15551234567', hint: 'Apne message ka echo filter karne ke liye' },
  ],
  telegram: [
    { key: 'token', label: 'Bot Token', required: true, secret: true, placeholder: '123456789:AA...', hint: 'BotFather se milta hai (@BotFather → /newbot)' },
    { key: 'account_id', label: 'Bot ID (optional)', placeholder: 'auto-detect', hint: 'Khali chhorein to token se khud pata chal jayega' },
  ],
};

const EMPTY = { facebook: {}, instagram: {}, whatsapp: {}, telegram: {} };

function Field({ label, value, onChange, type = 'text', required, placeholder, hint, secret }) {
  const [reveal, setReveal] = useState(false);
  const inputType = secret && !reveal ? 'password' : type;
  return (
    <label className="block">
      <span className="mb-1 flex items-center gap-2 text-xs font-semibold text-slate-600">
        {label}
        {required && <span className="text-brand">*</span>}
        {secret && (
          <button
            type="button"
            onClick={() => setReveal((r) => !r)}
            className="text-[10px] font-medium normal-case text-slate-400 hover:text-brand"
          >
            {reveal ? 'hide' : 'show'}
          </button>
        )}
      </span>
      <input
        type={inputType}
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        autoComplete="off"
        spellCheck={false}
        className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm outline-none transition focus:border-lemon"
      />
      {hint && <span className="mt-1 block text-[10px] text-slate-400">{hint}</span>}
    </label>
  );
}

function ConnectionCard({ conn, onChanged, onToast }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState('');
  const [callbackUrl, setCallbackUrl] = useState(
    typeof window !== 'undefined' ? `${window.location.origin}/webhook` : ''
  );

  const meta = CHANNELS[conn.channel] || { label: conn.channel, color: '#888' };
  const fields = FIELDS[conn.channel] || [];

  function startEdit() {
    setForm({
      name: conn.name,
      account_id: conn.account_id || '',
      wa_own_number: conn.extra?.wa_own_number || '',
    });
    setEditing(true);
  }

  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));

  async function save() {
    setBusy('save');
    try {
      // Khali token mat bhejein - warna purana token wipe ho jayega
      const payload = { name: form.name, account_id: form.account_id };
      if (form.token) payload.token = form.token;
      if (form.app_secret) payload.app_secret = form.app_secret;
      if (form.wa_own_number !== undefined) payload.wa_own_number = form.wa_own_number;
      await api.updateConnection(conn.id, payload);
      onToast('Connection update ho gaya');
      setEditing(false);
      onChanged();
    } catch (e) {
      onToast(e.message, true);
    } finally {
      setBusy('');
    }
  }

  async function verify() {
    setBusy('verify');
    try {
      const { account } = await api.verifyConnection(conn.id);
      onToast(`Token valid — ${account.name || account.id}`);
    } catch (e) {
      onToast(e.message, true);
    } finally {
      setBusy('');
    }
  }

  async function subscribe() {
    setBusy('subscribe');
    try {
      const res = await api.subscribeConnection(conn.id, callbackUrl);
      const extra = res.account_linked ? '' : ' (account link nahi hua)';
      onToast(`${res.webhook} → ${res.object}${extra}`);
    } catch (e) {
      onToast(e.message, true);
    } finally {
      setBusy('');
    }
  }

  async function toggle() {
    setBusy('toggle');
    try {
      await api.updateConnection(conn.id, { enabled: !conn.enabled });
      onChanged();
    } catch (e) {
      onToast(e.message, true);
    } finally {
      setBusy('');
    }
  }

  async function syncOld() {
    if (!window.confirm(`${conn.name} ki purani conversations import karein? Facebook/Instagram har thread ki list + latest messages (20 tak) import karta hai - Meta 20 se purani history nahi deta.`)) return;
    setBusy('sync');
    try {
      const res = await api.syncConnection(conn.id);
      const r = res.result || {};
      if (r.error) throw new Error(r.error);
      let msg = `${r.total} conversations milein — ${r.created} inbox me aa gayi`;
      if (r.messages_imported) msg += `, ${r.messages_imported} messages import hue`;
      if (r.with_snippet) msg += ` (${r.with_snippet} threads sirf aakhri message ke saath)`;
      onToast(msg);
      onChanged();
    } catch (e) {
      onToast(e.message, true);
    } finally {
      setBusy('');
    }
  }

  async function remove() {
    if (!window.confirm(`"${conn.name}" delete karein? Purani conversations rahengi.`)) return;
    setBusy('delete');
    try {
      await api.deleteConnection(conn.id);
      onToast('Connection delete ho gaya');
      onChanged();
    } catch (e) {
      onToast(e.message, true);
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span
            className="flex h-9 w-9 items-center justify-center rounded-lg text-xs font-bold text-white"
            style={{ background: meta.color }}
          >
            {meta.short}
          </span>
          <div>
            <p className="text-sm font-semibold text-slate-800">{conn.name}</p>
            <p className="font-mono text-[11px] text-slate-500">
              {meta.label} · {conn.account_id || 'no id'}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
              conn.enabled
                ? conn.has_token
                  ? 'bg-green-100 text-green-700'
                  : 'bg-amber-100 text-amber-700'
                : 'bg-slate-100 text-slate-500'
            }`}
          >
            {conn.enabled ? (conn.has_token ? 'Active' : 'Token missing') : 'Disabled'}
          </span>
          <button
            onClick={verify}
            disabled={busy === 'verify'}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
          >
            {busy === 'verify' ? 'Checking…' : 'Test token'}
          </button>
          {conn.channel !== 'whatsapp' && conn.channel !== 'telegram' && (
            <button
              onClick={syncOld}
              disabled={busy === 'sync'}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
            >
              {busy === 'sync' ? 'Syncing…' : 'Old chats sync'}
            </button>
          )}
          <button
            onClick={toggle}
            disabled={busy === 'toggle'}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
          >
            {conn.enabled ? 'Disable' : 'Enable'}
          </button>
          <button
            onClick={editing ? () => setEditing(false) : startEdit}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
          >
            {editing ? 'Cancel' : 'Edit'}
          </button>
          <button
            onClick={remove}
            disabled={busy === 'delete'}
            className="rounded-lg px-3 py-1.5 text-xs font-medium text-brand transition hover:bg-brand-soft disabled:opacity-50"
          >
            Delete
          </button>
        </div>
      </div>

      {conn.has_token && (
        <p className="mt-2 font-mono text-[11px] text-slate-400">
          Token: {conn.token_masked}
          {conn.app_id ? ` · App: ${conn.app_id}` : ''}
        </p>
      )}

      {editing && (
        <div className="mt-4 space-y-3 border-t border-slate-100 pt-4">
          <Field label="Naam" value={form.name} onChange={set('name')} required />
          {fields.map((f) => (
            <Field
              key={f.key}
              label={f.label}
              required={f.required}
              secret={f.secret}
              placeholder={
                f.key === 'token' && conn.has_token ? conn.token_masked : f.placeholder
              }
              hint={f.hint}
              value={form[f.key]}
              onChange={set(f.key)}
            />
          ))}
          {conn.channel !== 'telegram' && (
            <>
              <Field
                label="Naya token (khali chhorein to purana rahega)"
                value={form.token}
                onChange={set('token')}
                secret
                placeholder={conn.has_token ? conn.token_masked : 'EAAG...'}
              />
              <Field
                label="App Secret (optional - signature verify ke liye)"
                value={form.app_secret}
                onChange={set('app_secret')}
                secret
                placeholder={conn.has_app_secret ? conn.app_secret_masked : 'app secret'}
              />
            </>
          )}
          <button
            onClick={save}
            disabled={busy === 'save'}
            className="rounded-lg bg-gradient-to-br from-brand to-lemon px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
          >
            {busy === 'save' ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3">
        <div className="min-w-[16rem] flex-1">
          <Field
            label="Webhook callback URL (public HTTPS)"
            value={callbackUrl}
            onChange={setCallbackUrl}
            placeholder="https://your-domain.com/webhook"
            hint={
              conn.channel === 'telegram'
                ? 'Telegram bot ka webhook is public HTTPS URL par set hoga'
                : 'ngrok / Render URL use karein — Meta sirf public HTTPS maangta hai'
            }
          />
        </div>
        <button
          onClick={subscribe}
          disabled={busy === 'subscribe'}
          className="mb-0.5 rounded-lg border border-brand px-3 py-2 text-xs font-semibold text-brand transition hover:bg-brand-soft disabled:opacity-50"
        >
          {busy === 'subscribe'
            ? 'Subscribing…'
            : conn.channel === 'telegram'
              ? 'Set Telegram webhook'
              : 'Subscribe on Meta'}
        </button>
      </div>
    </div>
  );
}

function AddForm({ onAdded, onToast }) {
  const [channel, setChannel] = useState('facebook');
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setForm({});
  }, [channel]);

  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.createConnection({
        channel,
        name: form.name,
        app_id: form.app_id || '',
        app_secret: form.app_secret || '',
        account_id: form.account_id || '',
        token: form.token || '',
        wa_own_number: form.wa_own_number || '',
        api_host:
          channel === 'telegram'
            ? 'telegram'
            : channel === 'instagram'
              ? 'instagram'
              : 'facebook',
      });
      onToast('Connection add ho gaya');
      setForm({});
      onAdded();
    } catch (err) {
      onToast(err.message, true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="rounded-xl border border-lemon-soft bg-white p-4 shadow"
    >
      <div className="flex flex-wrap gap-2">
        {Object.entries(CHANNELS).map(([key, c]) => (
          <button
            key={key}
            type="button"
            onClick={() => setChannel(key)}
            className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
              channel === key
                ? 'text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
            style={channel === key ? { background: c.color } : undefined}
          >
            {c.label}
          </button>
        ))}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label="Naam" value={form.name} onChange={set('name')} required placeholder="Mera Store (Main Page)" />
        {(FIELDS[channel] || []).map((f) => (
          <Field
            key={f.key}
            label={f.label}
            required={f.required}
            secret={f.secret}
            placeholder={f.placeholder}
            hint={f.hint}
            value={form[f.key]}
            onChange={set(f.key)}
          />
        ))}
        {channel !== 'telegram' && (
          <>
            <Field label="App ID (subscribe ke liye)" value={form.app_id} onChange={set('app_id')} placeholder="1234567890" />
            <Field label="App Secret (signature verify)" value={form.app_secret} onChange={set('app_secret')} secret placeholder="app secret" />
          </>
        )}
      </div>

      <button
        disabled={busy}
        className="mt-4 rounded-lg bg-gradient-to-br from-brand to-lemon px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
      >
        {busy ? 'Adding…' : 'Add connection'}
      </button>
    </form>
  );
}

export default function Channels() {
  const [connections, setConnections] = useState([]);
  const [toast, setToast] = useState(null);

  const load = useCallback(async () => {
    try {
      const { connections: list } = await api.connections();
      setConnections(list);
    } catch (e) {
      setToast({ text: e.message, bad: true });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function notify(text, bad = false) {
    setToast({ text, bad });
    if (!bad) setTimeout(() => setToast(null), 4000);
  }

  const grouped = Object.keys(CHANNELS).map((key) => ({
    key,
    items: connections.filter((c) => c.channel === key),
  }));

  return (
    <div className="h-full overflow-y-auto bg-cloud p-6">
      <h1 className="bg-gradient-to-br from-brand to-lemon bg-clip-text text-2xl font-bold text-transparent">
        Channels
      </h1>
      <p className="mt-1 text-sm text-slate-500">
        Facebook, Instagram, WhatsApp aur Telegram ki API credentials yahan add karein. Tokens
        encrypt hoke database me save hote hain, aur har channel ke messages neeche Inbox me aate
        hain.
      </p>

      {toast && (
        <div
          className={`mt-3 rounded-lg px-3 py-2 text-sm ${
            toast.bad ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'
          }`}
        >
          {toast.text}
        </div>
      )}

      <div className="mt-5">
        <AddForm onAdded={load} onToast={notify} />
      </div>

      {grouped.map(({ key, items }) => {
        const meta = CHANNELS[key];
        return (
          <div key={key} className="mt-6">
            <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: meta.color }} />
              {meta.label}
              <span className="text-xs font-normal text-slate-400">({items.length})</span>
            </h2>
            <div className="space-y-3">
              {items.map((c) => (
                <ConnectionCard key={c.id} conn={c} onChanged={load} onToast={notify} />
              ))}
              {!items.length && (
                <p className="rounded-xl border border-dashed border-slate-300 bg-white/60 p-4 text-sm text-slate-400">
                  Abhi koi {meta.label} connection nahi. Upar se add karein.
                </p>
              )}
            </div>
          </div>
        );
      })}

      <div className="mt-8 rounded-xl border border-slate-200 bg-white p-4 text-xs leading-relaxed text-slate-500">
        <p className="mb-1 font-semibold text-slate-700">Setup ke bare me</p>
        <ul className="list-disc space-y-1 pl-4">
          <li>
            Token: Graph API Explorer me <code>Get Token &gt; Page Access Token</code> se nikalein
            (short-lived ko long-lived bana lein, warna 60 din baad expire).
          </li>
          <li>
            Subscribe karne ke liye ek <strong>public HTTPS URL</strong> chahiye — local host par
            nahi chalta. ngrok ya hosting use karein.
          </li>
          <li>
            Callback URL aur Verify Token Meta ke dashboard se exactly wahi daalein jo yahan likha
            hai.
          </li>
          <li>
            <strong>Telegram:</strong> BotFather se bot banayein, bot token yahan paste karein,
            phir <em>Set Telegram webhook</em> dabayein. Bot ko pehle /start message bhejein taake
            woh aap ko message kar sake.
          </li>
          <li>Har channel ke liye alag connection ban sakta hai — aik page, aik IG, aik number, aik bot.</li>
        </ul>
      </div>
    </div>
  );
}
