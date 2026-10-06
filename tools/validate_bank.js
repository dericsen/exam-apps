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
const { groupIdOf } = require('../lib/bank');

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
// Kelompok berasal dari field "group" hasil tools/cluster_tpks.js: soal yang
// isinya sama meskipun kalimat dan pilihan jawabannya berbeda.
const groups = new Map();
for (const q of bank.questions) {
  const key = groupIdOf(q);
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(q);
}
const dupGroups = [...groups.values()].filter((g) => g.length > 1);

if (!bank.questions.some((q) => q.group)) {
  warnings.push(
    'Bank belum punya field "group". Deteksi duplikat jatuh ke perbandingan teks ' +
      'mentah yang jauh lebih lemah. Jalankan: node tools/cluster_tpks.js --write'
  );
}

// Duplikat yang kuncinya berbeda = jelas ada yang salah.
// Soal yang teks DAN pilihannya benar-benar identik tapi kuncinya berbeda:
// itu pasti salah satu salah. Soal segrup yang hanya "sekonsep" tidak dicek
// begini karena jawabannya memang boleh berbeda.
const exactKey = (q) =>
  (q.q + '|' + q.opt.join('|')).toLowerCase().replace(/\s+/g, ' ').trim();
const exact = new Map();
for (const q of bank.questions) {
  if (excluded.has(q.id)) continue;
  const k = exactKey(q);
  if (!exact.has(k)) exact.set(k, []);
  exact.get(k).push(q);
}
for (const g of exact.values()) {
  if (g.length > 1 && new Set(g.map((q) => q.ans)).size > 1) {
    errors.push(
      `Soal identik persis tapi kuncinya beda: ${g.map((q) => `${q.id}=${q.ans}`).join(', ')}.`
    );
  }
}

// ---------------------------------------------------------------------------
// Laporan
// ---------------------------------------------------------------------------
const perType = {};
for (const q of bank.questions) perType[q.type] = (perType[q.type] || 0) + 1;

// Hitung kelompok yang BENAR-BENAR bisa keluar. Satu kelompok sering punya
// anggota di beberapa tipe sekaligus, dan kelompok seperti itu tersedia untuk
// SEMUA tipe tersebut -- jadi ia harus dihitung di tiap tipe, bukan hanya di
// tipe anggota pertamanya.
const uniquePerType = {};
let usableUnique = 0;
for (const g of groups.values()) {
  const live = g.filter((q) => !excluded.has(q.id));
  if (!live.length) continue;
  usableUnique++;
  for (const t of new Set(live.map((q) => q.type))) {
    uniquePerType[t] = (uniquePerType[t] || 0) + 1;
  }
}

console.log('='.repeat(72));
console.log('  LAPORAN BANK SOAL TPKS');
console.log('='.repeat(72));
console.log(`Total entri soal : ${bank.questions.length}`);
console.log(`Soal unik        : ${groups.size}`);
console.log(`Siap dipakai     : ${usableUnique}  (setelah ${excluded.size} soal dikeluarkan)`);
console.log('');
console.log('Per tipe (entri soal -> kelompok yang tersedia untuk tipe itu):');
for (const t of Object.keys(perType)) {
  console.log(`  ${t.padEnd(12)} ${String(perType[t]).padStart(3)} -> ${uniquePerType[t]}`);
}
console.log('  (jumlahnya bisa melebihi total kelompok karena kelompok lintas-tipe');
console.log('   dihitung di setiap tipe yang dimilikinya)');

console.log('');
console.log(`Kelompok berisi lebih dari satu soal: ${dupGroups.length}`);
console.log('(soal segrup = isinya sama walau kalimatnya beda; peserta hanya menerima satu)');
const worst = dupGroups.sort((a, b) => b.length - a.length).slice(0, 8);
for (const g of worst) {
  const byType = {};
  g.forEach((q) => (byType[q.type] = (byType[q.type] || 0) + 1));
  console.log(
    `  ${String(g.length).padStart(2)}x  "${g[0].q.slice(0, 56)}..."  [${Object.entries(byType)
      .map(([t, n]) => `${t.replace(/_.*/, '')}=${n}`)
      .join(' ')}]`
  );
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

// ---------------------------------------------------------------------------
// Kapasitas: apakah komposisi yang diminta config benar-benar bisa dipenuhi?
//
// Membandingkan jumlah per tipe saja TIDAK cukup. Satu kelompok bisa punya
// anggota di beberapa tipe sekaligus, sehingga tiap tipe bisa tampak cukup
// padahal gabungannya tidak. Karena itu kapasitas diuji dengan menjalankan
// pemilih soal yang sebenarnya (bipartite matching) pada banyak seed.
// ---------------------------------------------------------------------------
console.log('Kapasitas vs config.json:');
for (const [type, want] of Object.entries(mcqSection.composition || {})) {
  const have = uniquePerType[type] || 0;
  console.log(
    `  ${type.padEnd(12)} diminta ${want}, kelompok tersedia ${have}  ${
      have >= want ? 'OK' : '<-- KURANG'
    }`
  );
}

const bankLib = require('../lib/bank');
bankLib.load();
let capacityFail = 0;
let dupFail = 0;
let sampleWarning = '';
const TRIALS = 200;
for (let i = 0; i < TRIALS; i++) {
  const { questions, warnings } = bankLib.buildTpksQuestions(mcqSection, 'validate-' + i);
  const want = Object.values(mcqSection.composition || {}).reduce((a, b) => a + b, 0) ||
    mcqSection.question_count || 0;
  if (questions.length < want) {
    capacityFail++;
    if (!sampleWarning && warnings.length) sampleWarning = warnings[0];
  }
  const seen = new Set();
  for (const q of questions) {
    if (seen.has(q.group)) dupFail++;
    seen.add(q.group);
  }
}

console.log('');
if (capacityFail) {
  errors.push(
    `Komposisi tidak selalu bisa dipenuhi: gagal pada ${capacityFail}/${TRIALS} percobaan. ` +
      (sampleWarning || '')
  );
  console.log(`  GAGAL  komposisi tidak terpenuhi pada ${capacityFail}/${TRIALS} percobaan`);
  console.log('         Turunkan "composition" di config.json, atau tambah soal baru.');
} else {
  console.log(`  OK     komposisi terpenuhi pada ${TRIALS}/${TRIALS} percobaan`);
}
if (dupFail) {
  errors.push(`Masih ada soal segrup yang muncul dua kali: ${dupFail} kejadian.`);
  console.log(`  GAGAL  soal segrup terulang dalam satu paket: ${dupFail} kejadian`);
} else {
  console.log(`  OK     tidak ada soal segrup yang terulang dalam satu paket`);
}

console.log('');
console.log(`Ringkasan: ${errors.length} error, ${warnings.length} peringatan.`);
process.exit(errors.length ? 1 : 0);
