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
 * Kelompokkan soal yang isinya sama meskipun kalimatnya berbeda.
 *
 * Bank soal menulis ulang soal yang sama dengan redaksi DAN pilihan jawaban
 * yang berbeda, sehingga perbandingan teks mentah tidak mendeteksinya. Field
 * "group" dihasilkan oleh tools/cluster_tpks.js dan disimpan di bank agar
 * keputusannya bisa diaudit serta deterministik saat ujian.
 *
 * Kalau ada soal tanpa field "group" (mis. baru ditambahkan dan tool belum
 * dijalankan ulang), dipakai canonicalKey sebagai cadangan supaya duplikat
 * persis tetap tertangkap.
 */
function groupIdOf(q) {
  return q.group || 'K-' + canonicalKey(q);
}

/**
 * Pilih soal TPKS untuk satu peserta.
 *
 * Tiga jaminan:
 *
 * 1. TIDAK ADA DUA SOAL DARI KELOMPOK YANG SAMA. Ini syarat keras, bukan
 *    usaha terbaik. Bank soal memuat 30 varian dari satu soal deret yang
 *    sama, jadi tanpa ini peserta bisa menerimanya 4-5 kali dalam satu paket.
 *
 * 2. KOMPOSISI PER TIPE TETAP TERPENUHI. Satu kelompok sering punya anggota
 *    di beberapa tipe sekaligus (soal swap variabel muncul sebagai B_LOGIC
 *    maupun C_ANALYTIC), sehingga memilih per tipe secara serakah bisa
 *    menghabiskan kelompok yang dibutuhkan tipe lain lalu gagal memenuhi
 *    kuota. Karena itu pemilihan diselesaikan sebagai bipartite matching
 *    (algoritma Kuhn): slot soal di satu sisi, kelompok di sisi lain.
 *
 * 3. DETERMINISTIK PER PESERTA. Seed diturunkan dari id attempt, sehingga
 *    reload halaman, ganti laptop, atau restart server tidak mengubah paket.
 *
 * Kalau `composition` dikosongkan, dipakai `question_count` dan soal diambil
 * dari seluruh bank tanpa memperhatikan tipe.
 */
function buildTpksQuestions(section, seedSource) {
  const { tpksBank } = banks();
  const rng = mulberry32(seedFrom(seedSource));
  const excluded = new Set(section.exclude_question_ids || []);
  const warnings = [];

  // ---- Kelompokkan soal: groupId -> (tipe -> daftar soal)
  const groups = new Map();
  for (const q of tpksBank.questions) {
    if (excluded.has(q.id)) continue;
    const gid = groupIdOf(q);
    if (!groups.has(gid)) groups.set(gid, new Map());
    const byType = groups.get(gid);
    if (!byType.has(q.type)) byType.set(q.type, []);
    byType.get(q.type).push(q);
  }

  // ---- Bangun slot yang harus diisi
  const composition = section.composition || {};
  const slotTypes = [];
  if (Object.keys(composition).length) {
    for (const [type, want] of Object.entries(composition)) {
      for (let i = 0; i < want; i++) slotTypes.push(type);
    }
  } else {
    const want = section.question_count || 30;
    for (let i = 0; i < want; i++) slotTypes.push(null); // null = tipe apa pun
  }

  // ---- Kandidat kelompok per slot, diacak per peserta
  const allGroupIds = [...groups.keys()];
  const candidates = slotTypes.map((type) =>
    shuffle(
      type === null ? allGroupIds : allGroupIds.filter((g) => groups.get(g).has(type)),
      rng
    )
  );

  // ---- Bipartite matching (Kuhn). matchGroup: groupId -> indeks slot.
  const matchGroup = new Map();
  function tryAssign(slot, visited) {
    for (const gid of candidates[slot]) {
      if (visited.has(gid)) continue;
      visited.add(gid);
      const holder = matchGroup.get(gid);
      // Kelompok masih bebas, atau pemiliknya bisa dipindah ke kelompok lain.
      if (holder === undefined || tryAssign(holder, visited)) {
        matchGroup.set(gid, slot);
        return true;
      }
    }
    return false;
  }

  let filled = 0;
  for (const slot of shuffle(slotTypes.map((_, i) => i), rng)) {
    if (tryAssign(slot, new Set())) filled++;
  }

  if (filled < slotTypes.length) {
    warnings.push(
      `Hanya ${filled} dari ${slotTypes.length} soal bisa dipenuhi tanpa mengulang ` +
        `kelompok soal. Bank punya ${groups.size} kelompok unik. Turunkan ` +
        `"composition" di config.json, atau tambah soal baru ke bank.`
    );
  }

  // ---- Ambil satu soal nyata dari tiap kelompok yang terpilih
  const picked = [];
  for (const [gid, slot] of matchGroup) {
    const type = slotTypes[slot];
    const byType = groups.get(gid);
    const pool = type === null ? [...byType.values()].flat() : byType.get(type);
    picked.push(shuffle(pool, rng)[0]);
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
      group: groupIdOf(q),
      type: q.type,
      q: q.q,
      opts: texts,
      ans: LETTERS[answerIndex],
      exp: q.exp,
    };
  });

  return { questions, warnings };
}

/** Statistik kelompok soal -- dipakai validator, doctor, dan dashboard. */
function tpksGroupStats(section) {
  const { tpksBank } = banks();
  const excluded = new Set((section && section.exclude_question_ids) || []);
  const perType = {};
  const groups = new Set();
  const groupTypes = new Map();

  for (const q of tpksBank.questions) {
    if (excluded.has(q.id)) continue;
    const gid = groupIdOf(q);
    groups.add(gid);
    (perType[q.type] = perType[q.type] || new Set()).add(gid);
    (groupTypes.get(gid) || groupTypes.set(gid, new Set()).get(gid)).add(q.type);
  }

  return {
    total_questions: tpksBank.questions.length - excluded.size,
    total_groups: groups.size,
    groups_per_type: Object.fromEntries(
      Object.entries(perType).map(([t, s]) => [t, s.size])
    ),
    has_group_field: tpksBank.questions.some((q) => !!q.group),
  };
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
    // Jumlah test yang DINILAI, semuanya tersembunyi.
    total_tests: p.test_cases.length,
    // Contoh kasus: ditampilkan di soal dan bisa dijalankan peserta, tapi
    // TIDAK ikut dinilai. Datanya terpisah dari test_cases supaya jawaban
    // yang di-hardcode dari contoh tidak mendapat nilai sama sekali.
    samples: (p.samples || []).map((t) => ({
      no: t.no,
      input: t.input,
      output: t.output,
    })),
  };
}

function starterCode() {
  return banks().cpBank.starter_code || {};
}

module.exports = {
  load,
  banks,
  buildTpksQuestions,
  tpksGroupStats,
  groupIdOf,
  getCpProblems,
  pickCpProblems,
  publicProblem,
  starterCode,
  LETTERS,
};
