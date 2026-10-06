'use strict';
/**
 * Penyimpanan sederhana berbasis file JSON.
 *
 * Skala yang dituju: satu ruang ujian (puluhan peserta), jadi seluruh state
 * disimpan di memori dan di-flush ke disk secara debounce + atomic rename.
 * Tidak perlu database, tidak perlu npm install, dan file hasilnya bisa
 * langsung dibaca manusia kalau panitia perlu audit manual.
 *
 * Semua kejadian penting juga ditulis append-only ke events.log sebagai jejak
 * audit yang tidak bisa tertimpa oleh flush berikutnya.
 */

const fs = require('fs');
const path = require('path');

const RUNTIME_DIR =
  process.env.EXAM_RUNTIME_DIR || path.join(__dirname, '..', 'data', 'runtime');
const STATE_FILE = path.join(RUNTIME_DIR, 'attempts.json');
const EVENT_LOG = path.join(RUNTIME_DIR, 'events.log');

let state = { version: 1, attempts: {}, created_at: new Date().toISOString() };
let dirty = false;
let flushTimer = null;

function ensureDir() {
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
}

function init() {
  ensureDir();
  if (fs.existsSync(STATE_FILE)) {
    try {
      const loaded = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      if (loaded && loaded.attempts) state = loaded;
      const n = Object.keys(state.attempts).length;
      if (n) console.log(`[store] memuat ${n} attempt dari sesi sebelumnya`);
    } catch (err) {
      const backup = STATE_FILE + '.corrupt-' + Date.now();
      fs.copyFileSync(STATE_FILE, backup);
      console.error(
        `[store] attempts.json rusak, dicadangkan ke ${backup} dan mulai dari kosong`
      );
    }
  }
}

function flushNow() {
  if (!dirty) return;
  ensureDir();
  const tmp = STATE_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, STATE_FILE); // atomic: tidak ada state setengah tertulis
  dirty = false;
}

function markDirty() {
  dirty = true;
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    try {
      flushNow();
    } catch (err) {
      console.error('[store] gagal menulis state:', err.message);
    }
  }, 1500);
}

function logEvent(type, payload) {
  ensureDir();
  const line = JSON.stringify({ ts: new Date().toISOString(), type, ...payload });
  fs.appendFile(EVENT_LOG, line + '\n', (err) => {
    if (err) console.error('[store] gagal menulis event log:', err.message);
  });
}

function getAttempt(sid) {
  return state.attempts[sid] || null;
}

function putAttempt(attempt) {
  state.attempts[attempt.sid] = attempt;
  markDirty();
  return attempt;
}

function allAttempts() {
  return Object.values(state.attempts);
}

function findByIdentity(identity) {
  return allAttempts().find((a) => a.identity_key === identity) || null;
}

function resetAll() {
  state.attempts = {};
  markDirty();
  flushNow();
}

process.on('exit', () => {
  try {
    flushNow();
  } catch (_) {
    /* proses sedang mati, abaikan */
  }
});
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    try {
      flushNow();
    } catch (_) {}
    process.exit(0);
  });
}

module.exports = {
  init,
  getAttempt,
  putAttempt,
  allAttempts,
  findByIdentity,
  markDirty,
  flushNow,
  logEvent,
  resetAll,
  STATE_FILE,
  EVENT_LOG,
  RUNTIME_DIR,
};
