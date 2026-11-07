const path = require('node:path');
const fs = require('node:fs');
const express = require('express');
const config = require('./config');
const db = require('./db');
const { router: apiRouter } = require('./api');
const webhookRouter = require('./webhook');
const { stream } = require('./realtime');
const backup = require('./services/backup');
const bootstrap = require('./services/bootstrap');

db.seedAdmin();
db.seedOwner();

// Har server-start par DB ki consistent backup banti hai (WAL-safe).
// Fail hone par sirf warning — server start honey se nahi rukta.
try {
  const backedUp = backup.createBackup();
  console.log(`[backup] DB backup bana: ${path.basename(backedUp)}`);
} catch (e) {
  console.warn(`[backup] backup nahi ban saki: ${e.message}`);
}

// `.env` fallback tokens hain lekin DB connections nahi? To unse seed karo
// taake Channels page par dikhein (ye sirf naam resolve karta hai, koi bulk
// API call nahi). Old-chats sync ab auto NAHI chalta — bhari sync ne Meta ka
// rate-limit block trigger kiya tha, is liye import sirf manual "Old chats
// sync" button se hota hai (pacing + block-detection ke saath).
(async () => {
  try {
    await bootstrap.seedFromEnv();
  } catch (e) {
    console.warn(`[bootstrap] .env seed fail hua: ${e.message}`);
  }
})();

const app = express();
app.disable('x-powered-by');
// Meta webhooks land here for all three channels.
// Mounted BEFORE express.json so we can capture the raw body for HMAC verification.
app.use('/webhook', webhookRouter);

app.use(express.json());

// Public media files (Meta fetches attachment URLs server-side on our behalf).
app.use('/uploads', express.static(config.uploadDir));

// Agent API
app.use('/api', apiRouter);

// Realtime push to the inbox (Server-Sent Events)
app.get('/api/stream', stream);

// Live privacy policy page (used for Meta App verification)
app.get('/privacy-policy', (_req, res) => {
  res.send(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Privacy Policy</title>
<style>
  body{font-family:'Segoe UI',system-ui,sans-serif;max-width:720px;margin:40px auto;padding:0 20px;color:#111827;line-height:1.6}
  h1{color:#4f46e5;margin-bottom:4px}
  h2{font-size:1.05rem;margin-top:28px}
  p{font-size:0.95rem;color:#374151}
  .muted{color:#6b7280;font-size:0.9rem}
</style>
</head>
<body>
  <h1>Privacy Policy</h1>
  <p class="muted">Effective date: ${new Date().toISOString().slice(0, 10)}</p>

  <p>This Privacy Policy explains how our customer support service collects and uses information when
  you contact us through Meta Messenger, Instagram or WhatsApp.</p>

  <h2>Information we collect</h2>
  <p>When you message our page, we receive the content of your message, your display name, and a unique
  user identifier assigned to you by the messaging platform. We use this only to reply and provide
  support.</p>

  <h2>How we use it</h2>
  <p>We use your messages solely to respond to your enquiries and manage customer support
  conversations. We do not sell or share your personal data with third parties.</p>

  <h2>Data retention</h2>
  <p>Conversation records are kept for internal support purposes and deleted upon request or after they
  are no longer needed.</p>

  <h2>Your rights</h2>
  <p>You may ask us to show, correct or delete the data we hold about you at any time by messaging our
  page or contacting our support team.</p>

  <h2>Contact</h2>
  <p>For any privacy questions, message our page directly and we will assist you.</p>
</body>
</html>`);
});

// Serve the built React app, if present
const clientDist = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/webhook')) return next();
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

function printStatus() {
  const conns = db.listConnections();
  console.log('[server] UI connections:');
  if (!conns.length) {
    console.log('  (koi nahi - Channels page se add karein)');
  } else {
    for (const c of conns) {
      const state = c.enabled ? (c.has_token ? 'active' : 'MISSING TOKEN') : 'disabled';
      console.log(`  - [${c.channel}] ${c.name} (id ${c.id}) -> ${state}`);
    }
  }
  console.log('[server] .env fallback tokens:');
  console.log(`  - Facebook: ${config.pageAccessToken ? 'configured' : 'not set'}`);
  console.log(`  - Instagram: ${config.igAccessToken ? 'configured' : 'not set'}`);
  console.log(`  - WhatsApp: ${config.waAccessToken ? 'configured' : 'not set'}`);
}

app.listen(config.port, () => {
  console.log(`[server] Omnichannel inbox running on http://localhost:${config.port}`);
  console.log(`[server] Webhook URL:   http://<your-public-host>/webhook`);
  printStatus();
});

// .env ke bina bhi chal sake (deploy par), config load hone ke baad
process.on('SIGHUP', printStatus);