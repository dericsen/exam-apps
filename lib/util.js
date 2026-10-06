'use strict';

const crypto = require('crypto');

/** PRNG deterministik (mulberry32) supaya set soal tiap peserta stabil saat reload. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFrom(str) {
  const h = crypto.createHash('sha256').update(String(str)).digest();
  return h.readUInt32BE(0);
}

/** Fisher-Yates dengan RNG yang disuntikkan. */
function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function randomId(bytes = 16) {
  return crypto.randomBytes(bytes).toString('hex');
}

/**
 * Normalisasi teks soal untuk deteksi duplikat.
 * Bank TPKS punya banyak soal yang praktis identik (mis. deret 2,6,12,20,30
 * muncul puluhan kali). Kunci ini dipakai agar satu peserta tidak pernah
 * menerima dua soal yang sama.
 */
function canonicalKey(question) {
  const norm = (s) =>
    String(s)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  return norm(question.q) + '||' + question.opt.map(norm).sort().join('|');
}

/** Bandingkan output program dengan expected: abaikan spasi di akhir baris & baris kosong di akhir. */
function outputMatches(actual, expected) {
  const clean = (s) =>
    String(s)
      .replace(/\r\n/g, '\n')
      .split('\n')
      .map((line) => line.replace(/\s+$/, ''))
      .join('\n')
      .replace(/\n+$/, '');
  return clean(actual) === clean(expected);
}

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function nowMs() {
  return Date.now();
}

function sanitizeText(s, maxLen = 120) {
  return String(s == null ? '' : s)
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, maxLen);
}

module.exports = {
  mulberry32,
  seedFrom,
  shuffle,
  randomId,
  canonicalKey,
  outputMatches,
  clampInt,
  nowMs,
  sanitizeText,
};
