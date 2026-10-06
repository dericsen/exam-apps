'use strict';

const fs = require('fs');
const path = require('path');
const { mulberry32, seedFrom, shuffle, canonicalKey } = require('./util');

const DATA_DIR = path.join(__dirname, '..', 'data');
const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

function loadJson(name) {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, name), 'utf8'));
}

let tpksBank = null;
let cpBank = null;

function load() {
  tpksBank = loadJson('tpks.json');
  cpBank = loadJson('cp-problems.json');
  return { tpksBank, cpBank };
}

function banks() {
  if (!tpksBank) load();
  return { tpksBank, cpBank };
}

/**
 * Pilih soal TPKS untuk satu peserta.
 *
 * Dua hal penting:
 * 1. Dedup -- bank aslinya memuat banyak soal yang isinya identik, jadi soal
 *    dikelompokkan berdasarkan canonicalKey dan hanya satu wakil per kelompok
 *    yang boleh terpilih. Tanpa ini peserta bisa dapat soal "2, 6, 12, 20, 30"
 *    sampai lima kali dalam satu paket.
 * 2. Deterministik per peserta -- seed diturunkan dari id attempt, sehingga
 *    reload halaman atau sambungan WiFi yang putus tidak mengubah paket soal.
 */
function buildTpksQuestions(section, seedSource) {
  const { tpksBank } = banks();
  const rng = mulberry32(seedFrom(seedSource));

  // Soal yang di-blacklist panitia (mis. pilihan jawaban kembar) dibuang dulu.
  const excluded = new Set(section.exclude_question_ids || []);

  // Kelompokkan per tipe, lalu dedup di dalam tipe.
  const buckets = new Map();
  const seen = new Set();
  for (const q of tpksBank.questions) {
    if (excluded.has(q.id)) continue;
    const key = canonicalKey(q);
    if (seen.has(key)) continue;
    seen.add(key);
    if (!buckets.has(q.type)) buckets.set(q.type, []);
    buckets.get(q.type).push(q);
  }

  const composition = section.composition || {};
  const picked = [];
  const warnings = [];

  for (const [type, want] of Object.entries(composition)) {
    const pool = buckets.get(type) || [];
    const order = shuffle(pool, rng);
    if (order.length < want) {
      warnings.push(
        `Tipe ${type}: hanya tersedia ${order.length} soal unik, diminta ${want}.`
      );
    }
    picked.push(...order.slice(0, want));
  }

  const ordered = section.shuffle_questions ? shuffle(picked, rng) : picked;

  const questions = ordered.map((q, idx) => {
    let texts = q.opt.slice();
    let answerIndex = LETTERS.indexOf(q.ans);
    if (answerIndex < 0) answerIndex = 0;

    if (section.shuffle_options) {
      const indices = shuffle(
        q.opt.map((_, i) => i),
        rng
      );
      texts = indices.map((i) => q.opt[i]);
      answerIndex = indices.indexOf(answerIndex);
    }

    return {
      no: idx + 1,
      qid: q.id,
      type: q.type,
      q: q.q,
      opts: texts,
      ans: LETTERS[answerIndex],
      exp: q.exp,
    };
  });

  return { questions, warnings };
}

/** Ambil objek problem CP lengkap (termasuk test case tersembunyi) dari daftar id. */
function getCpProblems(ids) {
  const { cpBank } = banks();
  const byId = new Map(cpBank.problems.map((p) => [p.id, p]));
  return ids.map((id) => {
    const p = byId.get(id);
    if (!p) throw new Error(`Problem CP "${id}" tidak ada di bank soal.`);
    return p;
  });
}

/**
 * Pilih soal CP secara acak untuk satu peserta.
 *
 * Kalau `problem_tiers` diisi, diambil satu soal dari SETIAP tier secara
 * berurutan. Ini penting untuk keadilan: peserta tetap mendapat soal yang
 * berbeda, tapi tingkat kesulitannya setara -- tanpa tier, ada peserta yang
 * kebetulan dapat dua soal tersulit sementara yang lain dapat dua termudah.
 *
 * Seperti TPKS, pemilihan deterministik terhadap seed peserta sehingga reload
 * halaman atau restart server tidak mengganti soalnya.
 */
function pickCpProblems(section, seedSource) {
  const { cpBank } = banks();
  const rng = mulberry32(seedFrom('cp|' + seedSource));
  const count = section.problem_count || 2;
  const tiers = section.problem_tiers;
  const valid = new Set(cpBank.problems.map((p) => p.id));
  const picked = [];
  const warnings = [];

  if (Array.isArray(tiers) && tiers.length) {
    for (const tier of tiers) {
      const pool = tier.filter((id) => valid.has(id) && !picked.includes(id));
      const unknown = tier.filter((id) => !valid.has(id));
      if (unknown.length) warnings.push(`Tier memuat id tak dikenal: ${unknown.join(', ')}.`);
      if (!pool.length) continue;
      picked.push(shuffle(pool, rng)[0]);
      if (picked.length >= count) break;
    }
  }

  // Kurang dari target (tier lebih sedikit dari problem_count, atau tanpa
  // tier sama sekali): lengkapi dengan acak dari seluruh pool.
  if (picked.length < count) {
    const rest = shuffle(
      cpBank.problems.map((p) => p.id).filter((id) => !picked.includes(id)),
      rng
    );
    picked.push(...rest.slice(0, count - picked.length));
  }

  if (picked.length < count) {
    warnings.push(`Hanya ${picked.length} soal CP tersedia, diminta ${count}.`);
  }
  return { problemIds: picked.slice(0, count), warnings };
}

/** Versi aman untuk dikirim ke peserta: test case tersembunyi & solusi dibuang. */
function publicProblem(p, index) {
  return {
    no: index + 1,
    id: p.id,
    title: p.title,
    difficulty: p.difficulty,
    topic: p.topic,
    time_limit_ms: p.time_limit_ms,
    memory_limit_mb: p.memory_limit_mb,
    points: p.points,
    statement: p.statement,
    input_format: p.input_format,
    output_format: p.output_format,
    constraints: p.constraints,
    notes: p.notes,
    total_tests: p.test_cases.length,
    samples: p.test_cases
      .filter((t) => t.is_sample)
      .map((t) => ({ no: t.no, input: t.input, output: t.output })),
  };
}

function starterCode() {
  return banks().cpBank.starter_code || {};
}

module.exports = {
  load,
  banks,
  buildTpksQuestions,
  getCpProblems,
  pickCpProblems,
  publicProblem,
  starterCode,
  LETTERS,
};
