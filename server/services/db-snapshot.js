// Render ka filesystem ephemeral hai — har deploy par SQLite DB reset ho jati
// hai. Is se chats aur (khaas taur par) "kis agent ne reply kiya" ki
// attribution har deploy par gum ho jati thi. Yeh module DB ka consistent
// snapshot Cloudflare R2 par rakhta hai aur boot par wapas restore karta hai,
// taake agent IDs aur chats deploy ke baad bhi zinda rahein.
//
// R2 pehle se uploads ke liye configured hai (R2_ENDPOINT, R2_ACCESS_KEY_ID,
// R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME). Wahi bucket use hota hai.
//
// Env knobs:
//   DB_SNAPSHOT=false            -> poori tarah band
//   DB_SNAPSHOT_MS=10000         -> check interval (sirf tab upload jab DB badli ho)
//   DB_SNAPSHOT_KEY=db/omnichannel.db
//   DB_RESTORE_FROM_R2=false     -> boot par restore band
//   DB_RESTORE_ALWAYS=true       -> local DB ho tab bhi R2 snapshot se overwrite

const fs = require('node:fs');
const path = require('node:path');
const { GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const config = require('../config');
const { isR2Configured, getR2Client } = require('../lib/r2');

const KEY = (process.env.DB_SNAPSHOT_KEY || 'db/omnichannel.db').trim();
const INTERVAL_MS = Math.max(3000, parseInt(process.env.DB_SNAPSHOT_MS || '10000', 10) || 10000);
const SQLITE_MAGIC = 'SQLite format 3\u0000';

const status = {
  key: KEY,
  enabled: false,
  restored_at_startup: false,
  last_ok_at: null,
  last_bytes: null,
  last_error: null,
  uploads: 0,
};

let dbModule = null;
let timer = null;
let pendingTimer = null;
let lastChanges = null;
let running = false;

function enabled() {
  return process.env.DB_SNAPSHOT !== 'false' && isR2Configured;
}

function dbPath() {
  return config.dbFile;
}

function totalChanges() {
  if (!dbModule) return null;
  try {
    const row = dbModule.db.prepare('SELECT total_changes() AS n').get();
    return Number(row.n);
  } catch {
    return null;
  }
}

function looksLikeSqlite(buf) {
  return buf.length > 100 && buf.subarray(0, 16).toString('latin1') === SQLITE_MAGIC;
}

// Boot par (db.js require hone se PEHLE) chalta hai: agar local DB maujood
// nahi hai to R2 se aakhri snapshot utaar kar rakh deta hai.
async function restoreDbIfMissing() {
  if (process.env.DB_RESTORE_FROM_R2 === 'false') {
    return { restored: false, reason: 'DB_RESTORE_FROM_R2=false' };
  }
  if (!isR2Configured) {
    return { restored: false, reason: 'R2 not configured' };
  }

  const dest = dbPath();
  const force = process.env.DB_RESTORE_ALWAYS === 'true';
  if (!force && fs.existsSync(dest) && fs.statSync(dest).size > 0) {
    return { restored: false, reason: 'local DB already exists' };
  }

  const s3 = getR2Client();
  const bucket = process.env.R2_BUCKET_NAME;
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: KEY }));
    const chunks = [];
    for await (const chunk of res.Body) chunks.push(Buffer.from(chunk));
    const buf = Buffer.concat(chunks);
    if (!looksLikeSqlite(buf)) {
      return { restored: false, reason: 'R2 object is not a valid SQLite DB' };
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, buf);
    // Purani WAL/SHM files restored DB ke sath match nahi karti — hata do.
    for (const suffix of ['-wal', '-shm']) {
      try {
        fs.unlinkSync(dest + suffix);
      } catch {}
    }
    status.restored_at_startup = true;
    return { restored: true, bytes: buf.length };
  } catch (e) {
    const missing = e && (e.name === 'NoSuchKey' || e.Code === 'NoSuchKey' || e.$metadata?.httpStatusCode === 404);
    return { restored: false, reason: missing ? 'no snapshot in R2 yet' : e.message || String(e) };
  }
}

async function snapshotNow(reason = 'manual') {
  if (!enabled() || !dbModule || running) return { ok: false, reason: 'disabled or busy' };
  running = true;
  const tmpDir = path.join(config.backupDir, 'r2-snapshot');
  const tmp = path.join(tmpDir, `snap-${process.pid}-${Date.now()}.db`);
  try {
    fs.mkdirSync(tmpDir, { recursive: true });
    // VACUUM INTO WAL-mode mein bhi consistent snapshot deta hai.
    const escaped = tmp.replace(/'/g, "''");
    dbModule.db.exec(`VACUUM INTO '${escaped}'`);
    const buf = fs.readFileSync(tmp);
    const s3 = getR2Client();
    await s3.send(
      new PutObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: KEY,
        Body: buf,
        ContentType: 'application/x-sqlite3',
      })
    );
    lastChanges = totalChanges();
    status.last_ok_at = Date.now();
    status.last_bytes = buf.length;
    status.last_error = null;
    status.uploads += 1;
    return { ok: true, bytes: buf.length, reason };
  } catch (e) {
    status.last_error = e.message || String(e);
    console.warn(`[snapshot] upload fail (${reason}): ${status.last_error}`);
    return { ok: false, error: status.last_error, reason };
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {}
    running = false;
  }
}

// Reply / inbound ke foran baad debounced snapshot — taake deploy se pehle
// agent attribution aur naya message R2 par pahunch jaye.
function requestSnapshot() {
  if (!enabled() || !dbModule) return;
  if (pendingTimer) return;
  pendingTimer = setTimeout(() => {
    pendingTimer = null;
    snapshotNow('debounced').catch(() => {});
  }, 1500);
  if (pendingTimer.unref) pendingTimer.unref();
}

function startAutoSnapshot(mod) {
  dbModule = mod;
  status.enabled = enabled();
  if (!enabled()) {
    console.warn('[snapshot] R2 configured nahi ya DB_SNAPSHOT=false — DB snapshots band');
    return;
  }
  lastChanges = totalChanges();
  // Pehla snapshot foran — taake seed (owner/admin) bhi R2 me chala jaye.
  snapshotNow('startup').catch(() => {});

  timer = setInterval(() => {
    const changes = totalChanges();
    if (changes === null) return;
    if (changes !== lastChanges) snapshotNow('interval').catch(() => {});
  }, INTERVAL_MS);
  if (timer.unref) timer.unref();

  const flush = () => {
    snapshotNow('shutdown')
      .catch(() => {})
      .finally(() => process.exit(0));
  };
  process.on('SIGTERM', flush);
  process.on('SIGINT', flush);

  console.log(`[snapshot] DB auto-snapshot ON -> r2://${process.env.R2_BUCKET_NAME}/${KEY} (har ${INTERVAL_MS}ms check)`);
}

function getStatus() {
  return {
    ...status,
    enabled: enabled(),
    interval_ms: INTERVAL_MS,
    pending_changes: lastChanges === null || totalChanges() === null ? null : totalChanges() !== lastChanges,
  };
}

module.exports = {
  restoreDbIfMissing,
  startAutoSnapshot,
  requestSnapshot,
  snapshotNow,
  getStatus,
  isEnabled: enabled,
};
