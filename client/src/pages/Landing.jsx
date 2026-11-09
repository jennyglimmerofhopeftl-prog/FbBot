import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

const SERVICES = [
  { icon: "💬", title: "Facebook Automation", desc: "Facebook Messenger pe smart replies, orders aur support — 24/7 automatic." },
  { icon: "📸", title: "Instagram Automation", desc: "Instagram DMs pe automated messaging, replies aur workflows, poora control ke sath." },
  { icon: "🟢", title: "WhatsApp Automation", desc: "WhatsApp Business pe automated messaging, replies aur workflow, bharosemand system." },
  { icon: "✈️", title: "Telegram Automation", desc: "Telegram bots se DMs, replies aur support — poora control ek hi jagah." },
  { icon: "🚀", title: "Omnichannel Inbox", desc: "Facebook, Instagram, WhatsApp aur Telegram — sab ek hi dashboard se handle karein." },
  { icon: "🧠", title: "Smart Agent Tools", desc: "Notes, forward, assign aur customer details — team wali cheezein smart tarike se." },
  { icon: "🎯", title: "Reliable & Scalable", desc: "Bharose kaam karte hain — jab aap ka kaam barhe, system sath barhe." },
];

const PERKS = [
  { icon: "⚡", label: "Real-time Replies" },
  { icon: "🚀", label: "Faster Resolution" },
  { icon: "💻", label: "One Dashboard" },
];

export default function Landing() {
  const { user } = useAuth();
  if (user) return <Navigate to={user.role === 'agent' ? '/my-chats' : '/inbox'} replace />;
  return (
    <div className="min-h-full overflow-y-auto bg-cloud">
      {/* Nav */}
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <Link to="/" className="flex items-center gap-3">
            <img src="/wolf-logo.png" alt="ZEUS Bots" className="h-11 w-11 rounded-xl object-contain shadow-md shadow-slate-300" />
            <span className="bg-gradient-to-br from-brand to-lemon bg-clip-text text-lg font-bold text-transparent">
              ZEUS Bots
            </span>
          </Link>
          <Link
            to="/login"
            className="rounded-lg bg-gradient-to-br from-brand to-lemon px-4 py-2 text-sm font-semibold text-white shadow-md shadow-lemon/30 transition hover:brightness-110"
          >
            Login
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="relative mx-auto max-w-4xl overflow-hidden px-4 pb-10 pt-14 text-center">
        <img
          src="/wolf-logo.png"
          alt=""
          aria-hidden="true"
          className="pointer-events-none absolute right-0 top-1/2 w-[420px] max-w-[45%] -translate-y-1/2 select-none opacity-20"
        />
        <div className="relative">
          <p className="mb-4 inline-block rounded-full border border-lemon/40 bg-lemon-soft px-4 py-1 text-sm font-semibold text-brand">
            ⚡ ZEUS IS BACK! 🔥
          </p>
          <h1 className="text-4xl font-extrabold leading-tight sm:text-5xl">
            <span className="bg-gradient-to-br from-brand to-lemon bg-clip-text text-transparent">
              ZEUS Bots is back
            </span>
            <br />
            <span className="text-slate-800">stronger, smarter & more powerful.</span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-slate-600">
            The wait is over. ZEUS Bots runs your{" "}
            <span className="font-semibold text-slate-800">
              Facebook, Instagram, WhatsApp & Telegram support
            </span>{" "}
            from one smart inbox — designed to save time, improve efficiency, and handle
            repetitive tasks with precision. ⚡
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              to="/login"
              className="rounded-xl bg-gradient-to-br from-brand to-lemon px-7 py-3 text-base font-semibold text-white shadow-lg shadow-lemon/30 transition hover:brightness-110"
            >
              Get Started → Login
            </Link>
            <a
              href="#services"
              className="rounded-xl border border-slate-300 bg-white px-7 py-3 text-base font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              Our Services
            </a>
          </div>
        </div>
      </section>

      {/* Services */}
      <section id="services" className="mx-auto max-w-5xl px-4 py-12">
        <h2 className="text-center text-3xl font-bold">
          <span className="bg-gradient-to-br from-brand to-lemon bg-clip-text text-transparent">
            What We Automate
          </span>
        </h2>
        <p className="mx-auto mt-2 max-w-2xl text-center text-slate-500">
          Facebook Messenger, Instagram DMs, WhatsApp Business Cloud API aur Telegram ke saath aik hi
          dashboard mein handle karein — automation aur human support, dono smart tarike se.
        </p>
        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {SERVICES.map((s) => (
            <div
              key={s.title}
              className="rounded-2xl border border-lemon-soft bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
            >
              <div className="text-3xl">{s.icon}</div>
              <h3 className="mt-3 font-semibold text-slate-800">{s.title}</h3>
              <p className="mt-1 text-sm text-slate-500">{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Statement */}
      <section className="mx-auto max-w-3xl px-4 py-10 text-center">
        <p className="text-lg text-slate-600">
          Whether you need a{" "}
          <span className="font-semibold text-slate-800">Facebook Messenger inbox</span>,{" "}
          <span className="font-semibold text-slate-800">Instagram DM support</span>, or a
          complete{" "}
          <span className="font-semibold text-slate-800">omnichannel workflow</span> —{" "}
          <span className="font-semibold text-brand">ZEUS Bots knows how to get the job done.</span> ⚡
        </p>
        <div className="mt-8 rounded-2xl border border-lemon-soft bg-white p-8 shadow-sm">
          <p className="text-slate-500">ZEUS may have been silent…</p>
          <p className="mt-1 text-xl font-bold text-slate-800">but it was never gone.</p>
          <p className="mt-4 text-2xl font-extrabold">
            <span className="bg-gradient-to-br from-brand to-lemon bg-clip-text text-transparent">
              🔥 NOW, ZEUS IS BACK.
            </span>
          </p>
        </div>
      </section>

      {/* Perks */}
      <section className="mx-auto grid max-w-4xl grid-cols-1 gap-4 px-4 py-6 sm:grid-cols-3">
        {PERKS.map((p) => (
          <div
            key={p.label}
            className="rounded-xl border border-slate-200 bg-white p-5 text-center shadow-sm"
          >
            <div className="text-3xl">{p.icon}</div>
            <p className="mt-2 font-semibold text-slate-700">{p.label}</p>
          </div>
        ))}
      </section>

      {/* Big line + CTA */}
      <section className="mx-auto max-w-4xl px-4 py-12 text-center">
        <p className="text-2xl font-bold text-slate-800">⚡ One ZEUS. Endless Possibilities.</p>
        <div className="mt-8 rounded-3xl bg-gradient-to-br from-brand to-lemon p-10 text-white shadow-xl shadow-lemon/30">
          <h2 className="text-2xl font-extrabold sm:text-3xl">
            ZEUS BOTS — AUTOMATE SMART. MOVE FAST.
          </h2>
          <p className="mt-2 text-white/90">
            Facebook · Instagram · WhatsApp · Telegram — ek hi dashboard. Apna support inbox kholo.
          </p>
          <Link
            to="/login"
            className="mt-6 inline-block rounded-xl bg-white px-8 py-3 text-base font-bold text-brand shadow-lg transition hover:bg-slate-50"
          >
            Login to Dashboard
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-3 px-4 py-6 sm:flex-row">
          <div className="flex items-center gap-2">
            <img src="/wolf-logo.png" alt="ZEUS Bots" className="h-8 w-8 rounded-lg object-contain" />
            <span className="text-sm font-semibold text-slate-600">ZEUS Bots</span>
          </div>
          <p className="text-xs text-slate-400">
            ⚡ One ZEUS. Endless Possibilities. · Facebook · Instagram · WhatsApp · Telegram
          </p>
        </div>
      </footer>
    </div>
  );
}