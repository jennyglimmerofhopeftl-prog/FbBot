const path = require('node:path');

function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  try {
    if (typeof process.loadEnvFile === 'function') {
      process.loadEnvFile(envPath);
    }
  } catch {
    // .env does not exist - fall back to process.env only
  }
}
loadEnv();

const config = {
  port: parseInt(process.env.PORT || '4000', 10),
  verifyToken: process.env.VERIFY_TOKEN || 'omnichannel_verify_token',
  appId: process.env.APP_ID || process.env.META_APP_ID || '',
  appSecret: process.env.APP_SECRET || '',

  pageAccessToken: process.env.PAGE_ACCESS_TOKEN || '',
  pageId: process.env.PAGE_ID || '',
  igAccessToken: process.env.IG_ACCESS_TOKEN || '',
  igAccountId: process.env.IG_ACCOUNT_ID || '',
  waAccessToken: process.env.WA_ACCESS_TOKEN || '',
  waPhoneNumberId: process.env.WA_PHONE_NUMBER_ID || '',
  waOwnNumber: (process.env.WA_OWN_NUMBER || '').replace(/[^0-9]/g, ''),

  graphVersion: process.env.GRAPH_VERSION || 'v21.0',

  uploadDir: process.env.UPLOAD_DIR
    ? (path.isAbsolute(process.env.UPLOAD_DIR)
        ? process.env.UPLOAD_DIR
        : path.resolve(__dirname, '..', process.env.UPLOAD_DIR))
    : path.join(__dirname, '..', 'data', 'uploads'),
  maxUploadBytes: parseInt(process.env.MAX_UPLOAD_BYTES || '26214400', 10),

  jwtSecret: process.env.JWT_SECRET || 'please_change_in_production',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',

  adminEmail: process.env.ADMIN_EMAIL || 'admin@omnichannel.local',
  adminPassword: process.env.ADMIN_PASSWORD || 'admin123',
  adminName: process.env.ADMIN_NAME || 'Admin Agent',

  // Owner sab se upar hai - sirf owner naye admins bana/promote/demote kar sakta hai.
  ownerEmail: process.env.OWNER_EMAIL || 'owner@omnichannel.local',
  ownerPassword: process.env.OWNER_PASSWORD || 'owner123',
  ownerName: process.env.OWNER_NAME || 'Owner',

  dbFile: process.env.DB_FILE
    ? (path.isAbsolute(process.env.DB_FILE)
        ? process.env.DB_FILE
        : path.resolve(__dirname, '..', process.env.DB_FILE))
    : path.join(__dirname, '..', 'data', 'omnichannel.db'),

  backupDir: process.env.BACKUP_DIR
    ? (path.isAbsolute(process.env.BACKUP_DIR)
        ? process.env.BACKUP_DIR
        : path.resolve(__dirname, '..', process.env.BACKUP_DIR))
    : path.join(__dirname, '..', 'data', 'backups'),
  backupKeep: parseInt(process.env.BACKUP_KEEP || '10', 10),
};

module.exports = config;