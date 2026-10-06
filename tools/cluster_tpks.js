#!/usr/bin/env node
'use strict';
/**
 * Pengelompokan soal TPKS yang isinya sama meskipun kalimatnya berbeda.
 *
 * Bank soal menulis ulang soal yang sama dengan redaksi dan pilihan jawaban
 * berbeda, sehingga perbandingan teks mentah tidak mendeteksinya. Tool ini
 * mengelompokkannya dengan TF-IDF + cosine similarity:
 *
 *   - Token = angka, huruf tunggal (deret seperti "A, C, F, J, O"), dan kata isi.
 *   - Bobot IDF membuat kata boilerplate ("perhatikan", "berikut", "tentukan")
 *     nyaris tak berpengaruh, sementara token khas (angka deret, "xor",
 *     "kernel") mendominasi -- tanpa perlu daftar stopword manual.
 *   - Clustering single-link: dua soal segrup kalau ada rantai kemiripan di
 *     atas ambang.
 *
 * Hasilnya DITULIS ke data/tpks.json sebagai field "group" per soal, supaya
 * keputusan pengelompokan tersimpan, bisa diaudit, dan deterministik saat
 * ujian -- bukan heuristik yang dijalankan ulang tiap kali server start.
 *
 * Pakai:
 *   node tools/cluster_tpks.js                 # tampilkan usulan saja
 *   node tools/cluster_tpks.js --threshold 0.5 # coba ambang lain
 *   node tools/cluster_tpks.js --write         # tulis field "group" ke bank
 */

const fs = require('fs');
const path = require('path');

const BANK_PATH = path.join(__dirname, '..', 'data', 'tpks.json');
const args = process.argv.slice(2);
const WRITE = args.includes('--write');
const THRESHOLD = (() => {
  const i = args.indexOf('--threshold');
  return i >= 0 ? Number(args[i + 1]) : 0.45;
})();
const VERBOSE = args.includes('--verbose');

const bank = JSON.parse(fs.readFileSync(BANK_PATH, 'utf8'));
const questions = bank.questions;

// ---------------------------------------------------------------------------
// Tokenisasi
// ---------------------------------------------------------------------------
function tokenize(q) {
  const text = q.q;
  const tokens = [];

  // Angka: inti dari semua soal deret. "2, 6, 12, 20, 30" -> n:2 n:6 ...
  for (const m of text.match(/\d+/g) || []) tokens.push('n:' + m);

  // Huruf tunggal berdiri sendiri: deret alfabet "A, C, F, J, O".
  // Hanya huruf kapital agar tidak menangkap kata biasa.
  for (const m of text.match(/\b[A-Z]\b/g) || []) tokens.push('l:' + m);

  // Kata isi. Boilerplate tidak perlu dibuang manual -- IDF yang mengecilkan
  // bobotnya karena muncul di hampir semua soal.
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((w) => w.length >= 3 && !/^\d+$/.test(w));
  for (const w of words) tokens.push('w:' + w);

  // Pilihan jawaban ikut menyumbang, tapi dibedakan prefiksnya supaya tidak
  // bercampur dengan token soal. Ini membantu memisahkan soal yang teksnya
  // mirip tapi menanyakan hal berbeda.
  for (const opt of q.opt) {
    for (const m of String(opt).match(/\d+/g) || []) tokens.push('on:' + m);
    for (const w of String(opt)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .split(' ')
      .filter((w) => w.length >= 4)) {
      tokens.push('ow:' + w);
    }
  }

  return tokens;
}

// ---------------------------------------------------------------------------
// Vektor TF-IDF
// ---------------------------------------------------------------------------
const docTokens = questions.map(tokenize);
const df = new Map();
for (const toks of docTokens) {
  for (const t of new Set(toks)) df.set(t, (df.get(t) || 0) + 1);
}
const N = questions.length;

const vectors = docTokens.map((toks) => {
  const tf = new Map();
  for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
  const vec = new Map();
  let norm = 0;
  for (const [t, count] of tf) {
    const idf = Math.log(N / (df.get(t) || 1));
    const w = (1 + Math.log(count)) * idf;
    if (w <= 0) continue;
    vec.set(t, w);
    norm += w * w;
  }
  norm = Math.sqrt(norm) || 1;
  for (const [t, w] of vec) vec.set(t, w / norm);
  return vec;
});

function cosine(a, b) {
  // Iterasi vektor yang lebih kecil.
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [t, w] of small) {
    const v = big.get(t);
    if (v) dot += w * v;
  }
  return dot;
}

// ---------------------------------------------------------------------------
// Clustering single-link (union-find)
// ---------------------------------------------------------------------------
const parent = questions.map((_, i) => i);
function find(i) {
  while (parent[i] !== i) {
    parent[i] = parent[parent[i]];
    i = parent[i];
  }
  return i;
}
function union(a, b) {
  const ra = find(a);
  const rb = find(b);
  if (ra !== rb) parent[ra] = rb;
}

// ---------------------------------------------------------------------------
// Pra-penggabungan: deret angka yang awalannya sama = soal yang sama.
//
// TF-IDF saja tidak cukup untuk soal deret, karena bank sering menanyakan
// deret yang SAMA pada titik yang berbeda:
//
//   "1, 1, 2, 3, 5, 8, 13, 21, ..." -> berikutnya 34
//   "1, 1, 2, 3, 5, 8, 13, ..."     -> berikutnya 21
//
// Himpunan angkanya berbeda sehingga cosine-nya turun di bawah ambang, padahal
// bagi peserta itu soal yang sama. Karena itu diambil urutan angka apa adanya,
// lalu dua soal digabung bila awalannya sama minimal SEQ_PREFIX angka.
//
// Hanya angka yang dipakai, bukan huruf: enumerasi seperti "modul A, B, C, D"
// bukan deret, dan menggabungkannya akan menyatukan soal yang benar berbeda.
const SEQ_PREFIX = 4;

const numberSeq = questions.map((q) => (q.q.match(/\d+/g) || []).map(Number));

function commonPrefix(a, b) {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

const forced = [];
for (let i = 0; i < N; i++) {
  if (numberSeq[i].length < SEQ_PREFIX) continue;
  for (let j = i + 1; j < N; j++) {
    if (numberSeq[j].length < SEQ_PREFIX) continue;
    if (commonPrefix(numberSeq[i], numberSeq[j]) >= SEQ_PREFIX) {
      union(i, j);
      forced.push([i, j]);
    }
  }
}

const pairs = [];
for (let i = 0; i < N; i++) {
  for (let j = i + 1; j < N; j++) {
    const s = cosine(vectors[i], vectors[j]);
    if (s >= THRESHOLD) {
      union(i, j);
      pairs.push([i, j, s]);
    }
  }
}

const clusters = new Map();
for (let i = 0; i < N; i++) {
  const root = find(i);
  if (!clusters.has(root)) clusters.set(root, []);
  clusters.get(root).push(i);
}

// ---------------------------------------------------------------------------
// Penamaan grup: stabil, tidak bergantung urutan iterasi.
// ---------------------------------------------------------------------------
const groupList = [...clusters.values()].sort(
  (a, b) => b.length - a.length || questions[a[0]].id.localeCompare(questions[b[0]].id)
);

const groupOf = new Map();
groupList.forEach((members) => {
  // Nama grup = id soal paling kecil di dalamnya. Deterministik & mudah dilacak.
  const name = members
    .map((i) => questions[i].id)
    .sort()[0]
    .replace(/[^A-Z0-9-]/gi, '');
  members.forEach((i) => groupOf.set(i, 'G-' + name));
});

// ---------------------------------------------------------------------------
// Laporan
// ---------------------------------------------------------------------------
console.log('='.repeat(76));
console.log(`  PENGELOMPOKAN SOAL TPKS  (ambang cosine = ${THRESHOLD})`);
console.log('='.repeat(76));
console.log(`Total soal        : ${N}`);
console.log(`Kelompok terbentuk: ${groupList.length}`);
console.log(`Digabung paksa karena awalan deret sama: ${forced.length} pasangan`);
console.log(`Soal yang berkerabat: ${groupList.filter((g) => g.length > 1).reduce((a, g) => a + g.length, 0)}`);

const perTypeGroups = {};
for (const members of groupList) {
  for (const i of members) {
    const t = questions[i].type;
    perTypeGroups[t] = perTypeGroups[t] || new Set();
    perTypeGroups[t].add(groupOf.get(i));
  }
}
console.log('\nKelompok unik yang tersedia per tipe:');
for (const [t, set] of Object.entries(perTypeGroups)) {
  console.log(`  ${t.padEnd(12)} ${set.size} kelompok`);
}

console.log('\nKelompok dengan anggota terbanyak:');
for (const members of groupList.filter((g) => g.length > 1).slice(0, VERBOSE ? 100 : 14)) {
  const q0 = questions[members[0]];
  console.log(`\n  [${members.length} soal]  ${groupOf.get(members[0])}`);
  console.log(`    "${q0.q.slice(0, 68)}${q0.q.length > 68 ? '...' : ''}"`);
  const byType = {};
  members.forEach((i) => {
    byType[questions[i].type] = (byType[questions[i].type] || 0) + 1;
  });
  console.log(
    `    anggota: ${members.map((i) => questions[i].id).join(', ')}`
  );
  console.log(
    `    sebaran tipe: ${Object.entries(byType).map(([t, n]) => `${t}=${n}`).join(' ')}`
  );
}

const singles = groupList.filter((g) => g.length === 1).length;
console.log(`\nKelompok berisi satu soal saja: ${singles}`);

// Pasangan paling lemah yang masih digabung -- berguna untuk menilai ambang.
if (VERBOSE && pairs.length) {
  console.log('\nPasangan dengan kemiripan terendah yang masih digabung:');
  pairs
    .sort((a, b) => a[2] - b[2])
    .slice(0, 10)
    .forEach(([i, j, s]) => {
      console.log(`  ${s.toFixed(3)}  ${questions[i].id} <-> ${questions[j].id}`);
      console.log(`         "${questions[i].q.slice(0, 60)}"`);
      console.log(`         "${questions[j].q.slice(0, 60)}"`);
    });
}

// ---------------------------------------------------------------------------
// Tulis ke bank
// ---------------------------------------------------------------------------
if (WRITE) {
  questions.forEach((q, i) => {
    q.group = groupOf.get(i);
  });
  bank.grouping = {
    method: 'tfidf-cosine-single-link',
    threshold: THRESHOLD,
    generated_by: 'tools/cluster_tpks.js',
    generated_at: new Date().toISOString(),
    group_count: groupList.length,
    note:
      'Field "group" menandai soal yang isinya sama meskipun kalimat dan pilihan ' +
      'jawabannya berbeda. Saat ujian, satu peserta tidak pernah menerima dua soal ' +
      'dari grup yang sama. Jalankan ulang tool ini setelah menambah soal.',
  };
  fs.writeFileSync(BANK_PATH, JSON.stringify(bank, null, 2));
  console.log(`\nField "group" ditulis ke ${path.relative(process.cwd(), BANK_PATH)}`);
} else {
  console.log('\n(Belum ditulis. Tambahkan --write untuk menyimpan ke data/tpks.json.)');
}
console.log('');
