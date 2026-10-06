#!/usr/bin/env node
'use strict';
/**
 * Uji end-to-end seluruh alur ujian lewat HTTP, seperti yang dilakukan browser
 * peserta dan dashboard pengawas.
 *
 * Dijalankan terhadap instance server terpisah (port & folder data sendiri),
 * jadi aman dipakai kapan saja tanpa menyentuh data ujian sungguhan.
 *
 * Jalankan: node tools/selftest.js
 */

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'exam-selftest-'));
const ADMIN_KEY = 'kunci-uji-123';
const ACCESS_CODE = 'UJI2026';

const TIER1 = ['E-001', 'E-002', 'E-005', 'E-006', 'E-007', 'E-013'];
const TIER2 = ['E-003', 'E-004', 'E-008', 'E-009', 'E-010', 'E-011', 'E-012', 'E-014', 'E-015'];

let BASE = '';
let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition, extra) {
  if (condition) {
    passed++;
    console.log(`  ok   ${name}`);
  } else {
    failed++;
    failures.push(name + (extra ? ' -> ' + extra : ''));
    console.log(`  FAIL ${name}${extra ? ' -> ' + extra : ''}`);
  }
}

function section(title) {
  console.log('\n' + title);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Infrastruktur: jalankan server dengan konfigurasi khusus pengujian
// ---------------------------------------------------------------------------
function makeConfig(name, mutate) {
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
  cfg.admin_key = ADMIN_KEY;
  cfg.registration.access_code = ACCESS_CODE;
  cfg.registration.require_access_code = true;
  cfg.lockdown.max_violations = 3;
  cfg.result.show_score_to_participant = true;
  if (mutate) mutate(cfg);
  const file = path.join(TMP, `config-${name}.json`);
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2));
  return file;
}

function startServer(name, port, configFile) {
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_OPTIONS: '',
      PORT: String(port),
      EXAM_CONFIG: configFile,
      EXAM_RUNTIME_DIR: path.join(TMP, 'runtime-' + name),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', () => {});
  child.stderr.on('data', (d) => process.stderr.write('[server] ' + d));
  return child;
}

function stopServer(child) {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null) return resolve();
    child.once('exit', () => resolve());
    child.kill('SIGTERM');
    setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch (_) {}
      resolve();
    }, 3000);
  });
}

async function waitForServer(timeoutMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      if ((await GET('/api/meta')).status === 200) return true;
    } catch (_) {}
    await sleep(200);
  }
  return false;
}

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------
async function call(method, url, { sid, body } = {}) {
  const headers = {};
  if (sid) headers['X-Sid'] = sid;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (_) {
    data = { raw: text };
  }
  return { status: res.status, data, text };
}

const GET = (url, opts) => call('GET', url, opts);
const POST = (url, body, sid) => call('POST', url, { body, sid });

const admin = (url) =>
  GET(url + (url.includes('?') ? '&' : '?') + 'key=' + encodeURIComponent(ADMIN_KEY));
const adminAction = (payload) => POST('/api/admin/action', { ...payload, key: ADMIN_KEY });

async function enroll(nama, nim, kelas) {
  const r = await POST('/api/register', { nama, nim, kelas, access_code: ACCESS_CODE });
  return r.data && r.data.sid ? r.data.sid : null;
}
const stateOf = async (sid) => (await GET('/api/state', { sid })).data.state;

const REF = {
  'E-001': 'a, b = map(int, input().split())\nprint(a + b)',
  'E-002': "n = int(input())\nprint('GENAP' if n % 2 == 0 else 'GANJIL')",
  'E-003': 'n = int(input())\nprint(max(map(int, input().split())))',
  'E-004': 'n = int(input())\nprint(sum(map(int, input().split())) // n)',
  'E-005': "print(sum(1 for c in input() if c in 'aeiou'))",
  'E-006': 'print(input()[::-1])',
  'E-007': 'n = int(input())\nr = 1\nfor i in range(2, n + 1):\n    r *= i\nprint(r)',
  'E-008': "s = input()\nprint('YA' if s == s[::-1] else 'BUKAN')",
  'E-009':
    "n = int(input())\nfor i in range(1, n + 1):\n" +
    "    print('TIGALIMA' if i % 15 == 0 else 'TIGA' if i % 3 == 0 else 'LIMA' if i % 5 == 0 else i)",
  'E-010': 'n, x = map(int, input().split())\nprint(list(map(int, input().split())).count(x))',
  'E-011': "input()\nprint(' '.join(map(str, sorted(map(int, input().split())))))",
  'E-012':
    'n = int(input())\n' +
    'if n < 2:\n    print(0)\nelse:\n' +
    '    s = [True] * (n + 1)\n    s[0] = s[1] = False\n' +
    '    i = 2\n    while i * i <= n:\n        if s[i]:\n' +
    '            for j in range(i * i, n + 1, i):\n                s[j] = False\n        i += 1\n' +
    '    print(sum(s))',
  'E-013': 'n = int(input())\na, b = 1, 1\nfor _ in range(n - 1):\n    a, b = b, a + b\nprint(a)',
  'E-014': 'n = int(input())\narr = list(map(int, input().split()))\nprint(max(arr) - min(arr))',
  'E-015': 'print(len(input().split()))',
};

// ---------------------------------------------------------------------------
async function main() {
  const mainCfg = makeConfig('main', (c) => {
    c.exam.duration_min = 90;
  });
  let server = startServer('main', 3977, mainCfg);
  BASE = 'http://127.0.0.1:3977';

  if (!(await waitForServer())) {
    console.error('Server tidak pernah siap. Batal.');
    process.exit(1);
  }

  // =======================================================================
  section('1. Metadata publik');
  {
    const { status, data } = await GET('/api/meta');
    check('GET /api/meta berhasil', status === 200);
    check('durasi ujian 90 menit', data.duration_min === 90, String(data.duration_min));
    check('dua bagian terdaftar', data.parts.length === 2);
    check('bagian TPKS 30 soal', data.parts[0].count === 30, String(data.parts[0].count));
    check('bagian CP 2 soal', data.parts[1].count === 2, String(data.parts[1].count));
    check('tidak ada durasi per-bagian', !JSON.stringify(data.parts).includes('duration_min'));
    check('bahasa judge tersedia', data.languages.length > 0, JSON.stringify(data.languages));
    check('kunci admin tidak dibocorkan', !JSON.stringify(data).includes(ADMIN_KEY));
    check('kode akses tidak dibocorkan', !JSON.stringify(data).includes(ACCESS_CODE));
    check('pool soal CP tidak dibocorkan ke peserta', !JSON.stringify(data).includes('problem_tiers'));
  }

  // =======================================================================
  section('2. Enroll: timer langsung berjalan');
  let sid;
  {
    let r = await POST('/api/register', { nama: 'Peserta Satu', nim: '101', kelas: 'TI-A' });
    check('enroll tanpa kode akses ditolak', r.status === 403);
    r = await POST('/api/register', { nama: 'X', nim: '1', access_code: 'SALAH' });
    check('enroll dengan kode salah ditolak', r.status === 403);
    r = await POST('/api/register', { nama: '', nim: '', access_code: ACCESS_CODE });
    check('nama & NIM wajib diisi', r.status === 400);

    const before = Date.now();
    r = await POST('/api/register', {
      nama: 'Peserta Satu',
      nim: '101',
      kelas: 'TI-A',
      access_code: ACCESS_CODE,
    });
    check('enroll valid berhasil', r.status === 200 && !!r.data.sid);
    sid = r.data.sid;

    const st = r.data.state;
    check('status langsung active tanpa tombol mulai', st.status === 'active', st.status);
    check(
      'timer langsung berjalan ~90 menit',
      st.remaining_ms > 89 * 60000 && st.remaining_ms <= 90 * 60000,
      String(st.remaining_ms)
    );

    await sleep(1200);
    const st2 = await stateOf(sid);
    check('sisa waktu benar-benar berkurang', st2.remaining_ms < st.remaining_ms - 900,
      `${st.remaining_ms} -> ${st2.remaining_ms}`);

    check('kedua bagian terbuka bersamaan',
      st2.parts.tpks.questions.length === 30 && st2.parts.cp.problems.length === 2,
      `tpks=${st2.parts.tpks.questions.length} cp=${st2.parts.cp.problems.length}`);

    const again = await POST('/api/register', {
      nama: 'Peserta Satu Ganti Nama',
      nim: '101',
      access_code: ACCESS_CODE,
    });
    check('login ulang NIM sama melanjutkan sesi lama', again.data.sid === sid);
    check('login ulang TIDAK me-reset timer',
      again.data.state.remaining_ms < st.remaining_ms,
      `${st.remaining_ms} -> ${again.data.state.remaining_ms}`);

    check('akses tanpa session ditolak', (await GET('/api/state')).status === 401);
    check('session palsu ditolak', (await GET('/api/state', { sid: 'palsu' })).status === 401);
  }

  // =======================================================================
  section('3. Paket TPKS: acak, unik, tanpa kebocoran kunci');
  {
    const st = await stateOf(sid);
    const qs = st.parts.tpks.questions;
    check('30 soal terkirim', qs.length === 30, String(qs.length));

    // Field "group" dipakai server untuk dedup tapi TIDAK boleh ikut terkirim:
    // ia membocorkan soal mana yang setara, sehingga peserta bisa menebak.
    const allowed = ['no', 'qid', 'type', 'q', 'opts'];
    const leaked = qs.filter((q) => Object.keys(q).some((k) => !allowed.includes(k)));
    check('kunci jawaban & pembahasan TIDAK dikirim', leaked.length === 0,
      JSON.stringify(leaked[0] || {}));
    check('respons tidak memuat field "exp"', !JSON.stringify(st).includes('"exp"'));

    // Duplikat diperiksa pakai field "group" di bank soal, bukan kemiripan
    // teks. Bank menulis ulang soal yang sama dengan kalimat DAN pilihan
    // berbeda, jadi perbandingan teks mentah sama sekali tidak menangkapnya
    // -- itu penyebab bug soal muncul 4-5 kali dalam satu paket.
    const rawBank = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'tpks.json'), 'utf8'));
    const groupOfQid = new Map(rawBank.questions.map((q) => [q.id, q.group || q.id]));
    check('bank soal punya field "group"', rawBank.questions.every((q) => !!q.group));

    const groups = qs.map((q) => groupOfQid.get(q.qid));
    const dupCount = groups.length - new Set(groups).size;
    check('tidak ada dua soal dari kelompok yang sama', dupCount === 0, `${dupCount} duplikat`);

    // Periksa lintas banyak peserta, bukan hanya satu paket.
    let worstRepeat = 1;
    let badPackets = 0;
    let badComposition = 0;
    for (let i = 0; i < 12; i++) {
      const s = await enroll('Dedup ' + i, 'dup' + i, '-');
      const packet = (await stateOf(s)).parts.tpks.questions;
      const counts = {};
      const types = {};
      for (const q of packet) {
        const g = groupOfQid.get(q.qid);
        counts[g] = (counts[g] || 0) + 1;
        types[q.type] = (types[q.type] || 0) + 1;
      }
      const m = Math.max(...Object.values(counts));
      worstRepeat = Math.max(worstRepeat, m);
      if (m > 1) badPackets++;
      if (types.A_PATTERN !== 10 || types.B_LOGIC !== 10 || types.C_ANALYTIC !== 10) {
        badComposition++;
      }
    }
    check('12 peserta lain juga bebas soal berulang', badPackets === 0,
      `${badPackets} paket bermasalah, pengulangan maks ${worstRepeat}x`);
    check('komposisi 10/10/10 tetap terpenuhi untuk semua peserta', badComposition === 0,
      `${badComposition} paket salah komposisi`);

    const byType = {};
    qs.forEach((q) => (byType[q.type] = (byType[q.type] || 0) + 1));
    check('komposisi 10/10/10 per tipe', byType.A_PATTERN === 10 && byType.B_LOGIC === 10 && byType.C_ANALYTIC === 10,
      JSON.stringify(byType));

    const banned = ['A_PATTERN-002', 'A_PATTERN-007'];
    check('soal cacat tidak pernah keluar', !qs.some((q) => banned.includes(q.qid)));

    const again = await stateOf(sid);
    check('paket soal stabil saat reload',
      JSON.stringify(again.parts.tpks.questions.map((q) => q.qid)) ===
        JSON.stringify(qs.map((q) => q.qid)));
  }

  // =======================================================================
  section('4. Paket CP: 2 soal acak per peserta, kesulitan seimbang');
  {
    const st = await stateOf(sid);
    const ids = st.parts.cp.problems.map((p) => p.id);
    check('tepat 2 soal CP', ids.length === 2, JSON.stringify(ids));
    check('soal 1 dari tier mudah', TIER1.includes(ids[0]), ids[0]);
    check('soal 2 dari tier menengah', TIER2.includes(ids[1]), ids[1]);
    check('dua soal berbeda', ids[0] !== ids[1]);
    check('hanya contoh kasus dibagikan', st.parts.cp.problems[0].samples.length === 2);
    check('test case tersembunyi tidak dikirim',
      !JSON.stringify(st.parts.cp.problems).includes('is_sample') &&
        st.parts.cp.problems[0].total_tests === 7,
      String(st.parts.cp.problems[0].total_tests));
    check('reference solution tidak dikirim', !JSON.stringify(st).includes('reference_solution'));

    // Keacakan antar peserta: daftarkan 20 peserta, periksa tier & variasi.
    const combos = new Set();
    let tierOk = true;
    for (let i = 0; i < 20; i++) {
      const s = await enroll('Acak ' + i, 'rand' + i, '-');
      const stx = await stateOf(s);
      const pids = stx.parts.cp.problems.map((p) => p.id);
      if (!TIER1.includes(pids[0]) || !TIER2.includes(pids[1])) tierOk = false;
      combos.add(pids.join('+'));
    }
    check('20 peserta semuanya dapat 1 soal per tier', tierOk);
    check('kombinasi soal bervariasi antar peserta', combos.size >= 5, `${combos.size} kombinasi unik`);

    const ov = await admin('/api/admin/overview');
    check('pengawas melihat pool CP', ov.data.cp_pool.length === TIER1.length + TIER2.length);
    check('pengawas melihat soal yang didapat tiap peserta',
      ov.data.attempts.every((a) => a.cp_problem_ids.length === 2));
  }

  // =======================================================================
  section('5. Menjawab TPKS & penilaian');
  let questions;
  {
    const detail = await admin('/api/admin/attempt?sid=' + encodeURIComponent(sid));
    check('endpoint admin attempt berfungsi', detail.status === 200);
    questions = detail.data.tpks;
    check('admin melihat kunci jawaban', questions.length === 30 && !!questions[0].correct);

    for (let i = 0; i < 20; i++) {
      await POST('/api/answer', { qid: questions[i].qid, choice: questions[i].correct }, sid);
    }
    for (let i = 20; i < 25; i++) {
      const wrong = ['A', 'B', 'C', 'D'].find((l) => l !== questions[i].correct);
      await POST('/api/answer', { qid: questions[i].qid, choice: wrong }, sid);
    }

    check('pilihan tidak valid ditolak',
      (await POST('/api/answer', { qid: questions[0].qid, choice: 'Z' }, sid)).status === 400);
    check('soal di luar paket ditolak',
      (await POST('/api/answer', { qid: 'TIDAK-ADA', choice: 'A' }, sid)).status === 400);

    await POST('/api/answer', { qid: questions[0].qid, choice: '' }, sid);
    let st = await stateOf(sid);
    check('jawaban bisa dihapus', !(questions[0].qid in st.parts.tpks.answers));
    await POST('/api/answer', { qid: questions[0].qid, choice: questions[0].correct }, sid);

    st = await stateOf(sid);
    check('25 jawaban tersimpan', Object.keys(st.parts.tpks.answers).length === 25,
      String(Object.keys(st.parts.tpks.answers).length));

    const ov = await admin('/api/admin/overview');
    const row = ov.data.attempts.find((a) => a.sid === sid);
    check('nilai TPKS 20 benar dari 30',
      row.scores.tpks.correct === 20 && row.scores.tpks.total === 30, JSON.stringify(row.scores.tpks));
    check('persen TPKS 66.67', Math.abs(row.scores.tpks.percent - 66.67) < 0.01,
      String(row.scores.tpks.percent));
    check('5 soal tercatat kosong', row.scores.tpks.blank === 5, String(row.scores.tpks.blank));
  }

  // =======================================================================
  section('6. CP: judge, partial credit, batas submit');
  let cpIds;
  {
    const st = await stateOf(sid);
    cpIds = st.parts.cp.problems.map((p) => p.id);
    const p1 = cpIds[0];
    const p2 = cpIds[1];

    await POST('/api/cp/draft', { problem_id: p1, language: 'python', code: '# draft saya' }, sid);
    check('draft kode tersimpan di server',
      (await stateOf(sid)).parts.cp.drafts[p1].code === '# draft saya');
    check('draft untuk soal di luar paket ditolak',
      (await POST('/api/cp/draft', { problem_id: 'E-099', language: 'python', code: 'x' }, sid)).status === 400);

    const run = await POST('/api/cp/run', { problem_id: p1, language: 'python', code: REF[p1] }, sid);
    check('uji contoh berjalan', run.data.result.verdict === 'AC', run.data.result.verdict);
    check('uji contoh hanya 2 test case', run.data.result.total === 2, String(run.data.result.total));
    check('uji contoh menampilkan expected vs got', !!run.data.result.results[0].expected);

    const sub1 = await POST('/api/cp/submit', { problem_id: p1, language: 'python', code: REF[p1] }, sid);
    check('submit solusi benar = AC', sub1.data.submission.verdict === 'AC', sub1.data.submission.verdict);
    check('semua 7 test case lulus',
      sub1.data.submission.passed === 7 && sub1.data.submission.total === 7);
    check('detail test case tersembunyi tidak bocor',
      sub1.data.submission.results.filter((x) => !x.is_sample && x.expected != null).length === 0);

    // Solusi yang pasti salah: cetak token pertama dari input apa pun.
    const broken = 'import sys\nd = sys.stdin.read().split()\nprint(d[0])';
    const sub2 = await POST('/api/cp/submit', { problem_id: p2, language: 'python', code: broken }, sid);
    check('solusi salah tidak AC', sub2.data.submission.verdict !== 'AC', sub2.data.submission.verdict);

    const ce = await POST('/api/cp/submit', { problem_id: p2, language: 'cpp', code: 'int main( {' }, sid);
    check('compile error terdeteksi', ce.data.submission.verdict === 'CE');
    check('pesan compiler dikirim', (ce.data.submission.compile_output || '').length > 0);

    check('bahasa tidak terdaftar ditolak',
      (await POST('/api/cp/submit', { problem_id: p1, language: 'brainfuck', code: '+' }, sid)).status === 400);
    check('kode kosong ditolak',
      (await POST('/api/cp/submit', { problem_id: p1, language: 'python', code: '  ' }, sid)).status === 400);
    check('soal di luar paket ditolak',
      (await POST('/api/cp/submit', { problem_id: 'E-099', language: 'python', code: 'x=1' }, sid)).status === 400);

    // Submit yang benar untuk p2 -> nilai terbaik harus dipakai.
    await POST('/api/cp/submit', { problem_id: p2, language: 'python', code: REF[p2] }, sid);
    const ov = await admin('/api/admin/overview');
    const row = ov.data.attempts.find((a) => a.sid === sid);
    check('skor CP memakai submit TERBAIK bukan terakhir', row.scores.cp.percent === 100,
      JSON.stringify(row.scores.cp.per_problem.map((p) => `${p.problem_id}:${p.percent}`)));
    check('2 soal tercatat solved', row.scores.cp.solved_count === 2);

    const st2 = await stateOf(sid);
    check('progres solved terlihat peserta', st2.parts.cp.progress.every((p) => p.solved),
      JSON.stringify(st2.parts.cp.progress.map((p) => p.solved)));
  }

  // =======================================================================
  section('7. Batas submit per soal');
  {
    const s = await enroll('Pembatas', '900', '-');
    const st = await stateOf(s);
    const pid = st.parts.cp.problems[0].id;
    // Konfigurasi uji memakai batas default 25; turunkan lewat loop singkat
    // dengan memeriksa pesan 429 setelah batas tercapai.
    const limit = st.parts.cp.max_submissions_per_problem;
    let last = null;
    for (let i = 0; i < limit; i++) {
      last = await POST('/api/cp/submit', { problem_id: pid, language: 'python', code: 'print(0)' }, s);
    }
    check(`${limit} submit pertama diterima`, last.status === 200, String(last.status));
    const over = await POST('/api/cp/submit', { problem_id: pid, language: 'python', code: 'print(0)' }, s);
    check('submit melebihi batas ditolak 429', over.status === 429, String(over.status));
  }

  // =======================================================================
  section('8. Kumpulkan & nilai akhir berbobot');
  {
    const fin = await POST('/api/finish', {}, sid);
    check('ujian bisa dikumpulkan', fin.status === 200);
    check('status menjadi finished', fin.data.state.status === 'finished');
    check('alasan tercatat', fin.data.state.finish_reason === 'dikumpulkan peserta',
      fin.data.state.finish_reason);
    check('soal tidak lagi dikirim setelah selesai',
      fin.data.state.parts.tpks.questions.length === 0 && fin.data.state.parts.cp.problems.length === 0);
    check('sisa waktu nol', fin.data.state.remaining_ms === 0);

    check('tidak bisa menjawab setelah selesai',
      (await POST('/api/answer', { qid: questions[0].qid, choice: 'A' }, sid)).status === 409);
    check('tidak bisa submit setelah selesai',
      (await POST('/api/cp/submit', { problem_id: cpIds[0], language: 'python', code: REF[cpIds[0]] }, sid)).status === 409);
    check('tidak bisa menyimpan draft setelah selesai',
      (await POST('/api/cp/draft', { problem_id: cpIds[0], language: 'python', code: 'x' }, sid)).status === 409);

    // 0.4 * 66.67 + 0.6 * 100 = 86.67
    const expected = Math.round((0.4 * 66.67 + 0.6 * 100) * 100) / 100;
    const ov = await admin('/api/admin/overview');
    const row = ov.data.attempts.find((a) => a.sid === sid);
    check(`nilai akhir berbobot ${expected}`, Math.abs(row.final.total - expected) < 0.02,
      String(row.final.total));
    check('peserta melihat nilainya (show_score aktif di config uji)',
      fin.data.state.result.show_score === true && !!fin.data.state.result.final);
  }

  // =======================================================================
  section('9. Lockdown: pencatatan & auto-submit');
  {
    const s = await enroll('Peserta Dua', '202', '-');
    let v = await POST('/api/violation', { kind: 'exit_fullscreen', detail: 'keluar fullscreen' }, s);
    check('pelanggaran pertama tercatat', v.data.violation_count === 1);
    check('belum dipaksa selesai', v.data.forced_finish === false);

    v = await POST('/api/violation', { kind: 'tab_hidden', detail: 'pindah tab' }, s);
    check('pelanggaran kedua tercatat', v.data.violation_count === 2);

    v = await POST('/api/violation', { kind: 'window_blur', detail: 'buka aplikasi lain' }, s);
    check('pelanggaran ke-3 memicu auto-submit', v.data.forced_finish === true, JSON.stringify(v.data));
    check('status menjadi finished', v.data.status === 'finished');

    const st = await stateOf(s);
    check('alasan penutupan menyebut pelanggaran', /pelanggaran/i.test(st.finish_reason || ''),
      st.finish_reason);
    check('kedua bagian tertutup',
      st.parts.tpks.questions.length === 0 && st.parts.cp.problems.length === 0);
    check('tidak bisa menjawab lagi',
      (await POST('/api/answer', { qid: 'x', choice: 'A' }, s)).status === 409);

    const det = await admin('/api/admin/attempt?sid=' + encodeURIComponent(s));
    check('pengawas melihat 3 pelanggaran beserta waktunya',
      det.data.violations.length === 3 && !!det.data.violations[0].at);
    check('jenis pelanggaran terekam', det.data.violations.map((x) => x.kind).includes('window_blur'));
  }

  // =======================================================================
  section('10. Aksi pengawas');
  {
    check('kunci admin salah ditolak', (await GET('/api/admin/overview?key=salah')).status === 403);
    check('tanpa kunci admin ditolak', (await GET('/api/admin/overview')).status === 403);

    const s = await enroll('Peserta Tiga', '303', '-');
    const before = (await stateOf(s)).remaining_ms;

    await adminAction({ action: 'extend', sid: s, minutes: 10 });
    const afterExtend = (await stateOf(s)).remaining_ms;
    check('tambah waktu 10 menit berhasil', afterExtend - before > 9.5 * 60000,
      `${before} -> ${afterExtend}`);

    await POST('/api/violation', { kind: 'tab_hidden' }, s);
    await adminAction({ action: 'clear_violations', sid: s });
    check('catatan pelanggaran bisa dihapus', (await stateOf(s)).violation_count === 0);

    await adminAction({ action: 'force_finish', sid: s });
    let st = await stateOf(s);
    check('hentikan paksa membuat finished', st.status === 'finished');
    check('alasan "dihentikan panitia"', st.finish_reason === 'dihentikan panitia', st.finish_reason);

    await adminAction({ action: 'reopen', sid: s, minutes: 10 });
    st = await stateOf(s);
    check('buka kembali mengaktifkan ujian lagi', st.status === 'active');
    check('buka kembali memberi tepat ~10 menit',
      Math.abs(st.remaining_ms - 10 * 60000) < 5000, String(st.remaining_ms));
    check('soal bisa diakses lagi setelah dibuka', st.parts.tpks.questions.length === 30);

    await adminAction({ action: 'disqualify', sid: s });
    st = await stateOf(s);
    check('diskualifikasi berhasil', st.status === 'disqualified');
    const relog = await POST('/api/register', { nama: 'Peserta Tiga', nim: '303', access_code: ACCESS_CODE });
    check('peserta terdiskualifikasi tidak bisa login ulang', relog.status === 403);

    check('aksi tidak dikenal ditolak',
      (await adminAction({ action: 'terbangkan-peserta', sid: s })).status === 400);
    check('aksi untuk sid tidak ada ditolak',
      (await adminAction({ action: 'extend', sid: 'hantu', minutes: 5 })).status === 404);
  }

  // =======================================================================
  section('11. Export CSV');
  {
    const res = await fetch(BASE + '/api/admin/export.csv?key=' + encodeURIComponent(ADMIN_KEY));
    const bytes = Buffer.from(await res.arrayBuffer());
    const csv = bytes.toString('utf8');
    check('CSV terunduh', res.status === 200);
    const header = csv.split('\n')[0];
    check('kolom per-soal CP generik (cp1/cp2)',
      header.includes('cp1_soal') && header.includes('cp2_persen') && !header.includes('cp_E-001'),
      header);
    check('kolom inti ada',
      ['nama', 'nim', 'tpks_persen', 'cp_persen', 'nilai_akhir', 'alasan_selesai'].every((h) =>
        header.includes(h)
      ), header);
    check('peserta muncul di CSV', csv.includes('Peserta Satu') && csv.includes('Peserta Dua'));
    check('id soal CP tercatat per peserta', /"E-0\d\d"/.test(csv));
    check('BOM UTF-8 ada', bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf,
      bytes.subarray(0, 3).toString('hex'));
  }

  // =======================================================================
  section('12. Ketahanan: restart server');
  {
    await sleep(2000); // beri waktu flush ke disk
    await stopServer(server);
    server = startServer('main', 3977, mainCfg);
    check('server hidup kembali', await waitForServer());

    const st = await stateOf(sid);
    check('sesi peserta selamat', st.participant.nim === '101');
    check('nilai TPKS tetap tersimpan', st.result.scores.tpks.correct === 20,
      JSON.stringify(st.result.scores.tpks));
    check('soal CP yang didapat tidak berubah',
      JSON.stringify((await admin('/api/admin/attempt?sid=' + sid)).data.cp.map((p) => p.problem_id)) ===
        JSON.stringify(cpIds));

    const log = path.join(TMP, 'runtime-main', 'events.log');
    const text = fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '';
    check('audit log mencatat enroll, submit, pelanggaran',
      text.includes('"type":"enroll"') &&
        text.includes('"type":"cp_submit"') &&
        text.includes('"type":"violation"'));
  }

  // =======================================================================
  section('13. Static file & keamanan rute');
  {
    const home = await fetch(BASE + '/');
    check('halaman login tersaji di /', home.status === 200 && (await home.text()).includes('Identitas Peserta'));
    check('halaman ujian tersaji', (await fetch(BASE + '/exam.html')).status === 200);
    check('halaman pengawas tersaji', (await fetch(BASE + '/admin.html')).status === 200);
    check('404 untuk file tidak ada', (await fetch(BASE + '/tidak-ada.html')).status === 404);
    const trav = await fetch(BASE + '/../config.json');
    check('path traversal diblokir', trav.status === 403 || trav.status === 404, String(trav.status));
  }

  await stopServer(server);

  // =======================================================================
  section('14. Timer habis menutup ujian otomatis');
  {
    // Server kedua dengan durasi 3 detik (0.05 menit).
    const shortCfg = makeConfig('short', (c) => {
      c.exam.duration_min = 0.05;
    });
    const short = startServer('short', 3978, shortCfg);
    BASE = 'http://127.0.0.1:3978';
    check('server durasi pendek siap', await waitForServer());

    const s = await enroll('Kehabisan Waktu', '777', '-');
    const st = await stateOf(s);
    check('ujian terbuka di awal', st.status === 'active' && st.parts.tpks.questions.length === 30);

    const qid = st.parts.tpks.questions[0].qid;
    check('masih bisa menjawab sebelum waktu habis',
      (await POST('/api/answer', { qid, choice: 'A' }, s)).status === 200);

    await sleep(3500);

    const after = await stateOf(s);
    check('status otomatis finished setelah waktu habis', after.status === 'finished', after.status);
    check('alasan "waktu habis"', after.finish_reason === 'waktu habis', after.finish_reason);
    check('soal otomatis ditutup', after.parts.tpks.questions.length === 0);
    check('jawaban sebelum waktu habis tetap dihitung',
      Object.keys(after.parts.tpks.answers).length === 1,
      JSON.stringify(after.parts.tpks.answers));
    check('tidak bisa menjawab setelah waktu habis',
      (await POST('/api/answer', { qid, choice: 'B' }, s)).status === 409);
    check('tidak bisa submit kode setelah waktu habis',
      (await POST('/api/cp/submit', { problem_id: 'E-001', language: 'python', code: 'print(1)' }, s)).status === 409);

    const ov = await admin('/api/admin/overview');
    check('pengawas melihat peserta sudah selesai',
      ov.data.attempts.find((a) => a.sid === s).status === 'finished');

    await stopServer(short);
  }

  fs.rmSync(TMP, { recursive: true, force: true });

  console.log('\n' + '='.repeat(60));
  console.log(`  LULUS: ${passed}   GAGAL: ${failed}`);
  console.log('='.repeat(60));
  if (failed) {
    console.log('\nYang gagal:');
    failures.forEach((f) => console.log('  - ' + f));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('\nSelftest error:', err);
  process.exit(1);
});
