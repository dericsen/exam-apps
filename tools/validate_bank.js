#!/usr/bin/env node
'use strict';
/**
 * Pemeriksa kualitas bank soal TPKS.
 *
 * Tool ini TIDAK mengubah apa pun -- hanya melaporkan temuan supaya panitia
 * bisa memutuskan sendiri. Yang diperiksa:
 *
 *   [E] pilihan jawaban kembar dalam satu soal  (soal jadi tidak bisa dijawab)
 *   [E] kunci jawaban di luar A-D
 *   [W] kunci tidak cocok dengan pembahasan      (salah satu pasti salah)
 *   [I] soal duplikat antar entri                (otomatis di-dedup saat ujian)
 *
 * Jalankan: node tools/validate_bank.js
 */

const fs = require('fs');
const path = require('path');
const { canonicalKey } = require('../lib/util');

const bank = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'data', 'tpks.json'), 'utf8')
);

const config = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8')
);
const mcqSection = config.sections.find((s) => s.type === 'mcq');
const excluded = new Set(mcqSection.exclude_question_ids || []);

const LETTERS = ['A', 'B', 'C', 'D'];
const errors = [];
const warnings = [];
// Masalah pada soal yang sudah di-blacklist: tetap dilaporkan, tapi tidak
// menggagalkan pemeriksaan karena soal itu tidak akan keluar saat ujian.
const neutralized = [];

// ---------------------------------------------------------------------------
// 1. Masalah per soal
// ---------------------------------------------------------------------------
for (const q of bank.questions) {
  // Soal yang dikeluarkan lewat config dialihkan ke daftar "dinetralkan".
  const report = excluded.has(q.id) ? neutralized : errors;

  if (!LETTERS.includes(q.ans)) {
    report.push(`${q.id}: kunci jawaban "${q.ans}" bukan A-D.`);
  }
  if (q.opt.length !== 4) {
    report.push(`${q.id}: jumlah pilihan ${q.opt.length}, seharusnya 4.`);
  }

  // Pilihan kembar: peserta tidak mungkin memilih dengan benar.
  const norm = (s) => String(s).toLowerCase().replace(/\s+/g, ' ').trim();
  const seen = new Map();
  for (let i = 0; i < q.opt.length; i++) {
    const key = norm(q.opt[i]);
    if (seen.has(key)) {
      report.push(
        `${q.id}: pilihan ${LETTERS[seen.get(key)]} dan ${LETTERS[i]} isinya sama ("${q.opt[i]}").`
      );
    } else {
      seen.set(key, i);
    }
  }

  // Heuristik: pembahasan menyebut satu pilihan secara utuh, tapi bukan kuncinya.
  const exp = String(q.exp || '');
  const mentioned = [];
  for (let i = 0; i < q.opt.length; i++) {
    const text = String(q.opt[i]).trim();
    if (text.length >= 3 && exp.includes(text)) mentioned.push(LETTERS[i]);
  }
  if (mentioned.length === 1 && mentioned[0] !== q.ans) {
    (excluded.has(q.id) ? neutralized : warnings).push(
      `${q.id}: kunci = ${q.ans} ("${q.opt[LETTERS.indexOf(q.ans)]}") ` +
        `tapi pembahasan menyebut pilihan ${mentioned[0]} ("${q.opt[LETTERS.indexOf(mentioned[0])]}").`
    );
  }
}

// ---------------------------------------------------------------------------
// 2. Duplikat antar soal
// ---------------------------------------------------------------------------
const groups = new Map();
for (const q of bank.questions) {
  const key = canonicalKey(q);
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(q);
}
const dupGroups = [...groups.values()].filter((g) => g.length > 1);

// Duplikat yang kuncinya berbeda = jelas ada yang salah.
for (const g of dupGroups) {
  const live = g.filter((q) => !excluded.has(q.id));
  const keys = new Set(live.map((q) => q.ans));
  if (keys.size > 1) {
    errors.push(
      `Soal identik tapi kuncinya beda: ${live.map((q) => `${q.id}=${q.ans}`).join(', ')}.`
    );
  }
}

// ---------------------------------------------------------------------------
// Laporan
// ---------------------------------------------------------------------------
const perType = {};
for (const q of bank.questions) perType[q.type] = (perType[q.type] || 0) + 1;

// Hitung soal unik yang BENAR-BENAR bisa keluar: kelompok yang seluruh
// anggotanya di-blacklist tidak dihitung.
const uniquePerType = {};
let usableUnique = 0;
for (const g of groups.values()) {
  const live = g.filter((q) => !excluded.has(q.id));
  if (!live.length) continue;
  usableUnique++;
  const t = live[0].type;
  uniquePerType[t] = (uniquePerType[t] || 0) + 1;
}

console.log('='.repeat(72));
console.log('  LAPORAN BANK SOAL TPKS');
console.log('='.repeat(72));
console.log(`Total entri soal : ${bank.questions.length}`);
console.log(`Soal unik        : ${groups.size}`);
console.log(`Siap dipakai     : ${usableUnique}  (setelah ${excluded.size} soal dikeluarkan)`);
console.log('');
console.log('Per tipe (entri -> unik siap pakai):');
for (const t of Object.keys(perType)) {
  console.log(`  ${t.padEnd(12)} ${String(perType[t]).padStart(3)} -> ${uniquePerType[t]}`);
}

console.log('');
console.log(`Kelompok duplikat: ${dupGroups.length}`);
const worst = dupGroups.sort((a, b) => b.length - a.length).slice(0, 5);
for (const g of worst) {
  console.log(`  ${String(g.length).padStart(2)}x  "${g[0].q.slice(0, 58)}..."`);
  console.log(`       ${g.map((q) => q.id).join(', ')}`);
}

console.log('');
console.log(`ERROR (${errors.length}) -- perlu diperbaiki sebelum ujian:`);
if (!errors.length) console.log('  (tidak ada)');
errors.forEach((e) => console.log('  [E] ' + e));

console.log('');
console.log(
  `DINETRALKAN (${neutralized.length}) -- soal cacat yang sudah dikeluarkan lewat ` +
    `exclude_question_ids, tidak akan keluar saat ujian:`
);
if (!neutralized.length) console.log('  (tidak ada)');
neutralized.forEach((n) => console.log('  [x] ' + n));

console.log('');
console.log(`PERINGATAN (${warnings.length}) -- sebaiknya diperiksa manual:`);
if (!warnings.length) console.log('  (tidak ada)');
warnings.forEach((w) => console.log('  [W] ' + w));

console.log('');
console.log('Catatan: soal duplikat TIDAK perlu dihapus. Saat ujian, server');
console.log('mengambil satu wakil per kelompok duplikat, jadi peserta tidak');
console.log('pernah menerima soal yang sama dua kali.');
console.log('');

// Kapasitas: apakah soal unik cukup untuk komposisi yang diminta config?
console.log('Kapasitas vs config.json:');
let shortage = false;
for (const [type, want] of Object.entries(mcqSection.composition || {})) {
  const have = uniquePerType[type] || 0;
  const ok = have >= want;
  if (!ok) shortage = true;
  console.log(`  ${type.padEnd(12)} diminta ${want}, tersedia unik ${have}  ${ok ? 'OK' : '<-- KURANG'}`);
}
if (shortage) {
  console.log('\n  Tambah soal unik, atau turunkan angka composition di config.json.');
}

process.exit(errors.length ? 1 : 0);
