import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const agent = await login(email, password);
      navigate(agent.role === 'agent' ? '/my-chats' : '/inbox');
    } catch (err) {
      setError(err.message || 'Login fail hua. Dobara try karo.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-cloud p-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 shadow-xl shadow-slate-300/60">
        <img
          src="/wolf-logo.png"
          alt="ZEUS Bots"
          className="mx-auto mb-5 h-40 w-40 rounded-2xl object-contain shadow-lg shadow-slate-300"
        />
        <h1 className="mb-1 bg-gradient-to-br from-brand to-lemon bg-clip-text text-center text-3xl font-bold text-transparent">
          ZEUS Bots
        </h1>
        <p className="mb-6 text-center text-sm text-slate-400">
          Facebook · Instagram · WhatsApp Support Dashboard
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-slate-800 placeholder-slate-400 outline-none focus:border-lemon"
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <input
            className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-slate-800 placeholder-slate-400 outline-none focus:border-lemon"
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          {error && <p className="text-sm text-brand">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-gradient-to-br from-brand to-lemon py-2.5 font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
          >
            {loading ? 'Login ho raha hai...' : 'Login'}
          </button>
        </form>
      </div>
    </div>
  );
}