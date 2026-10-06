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
const PORT = 3977;
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'exam-selftest-'));
const CONFIG_FILE = path.join(TMP, 'config.json');
const ADMIN_KEY = 'kunci-uji-123';
const ACCESS_CODE = 'UJI2026';

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

// ---------------------------------------------------------------------------
// Konfigurasi khusus pengujian
// ---------------------------------------------------------------------------
function writeConfig() {
  const base = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
  base.port = PORT;
  base.admin_key = ADMIN_KEY;
  base.registration.access_code = ACCESS_CODE;
  base.registration.require_access_code = true;
  base.lockdown.max_violations = 3;
  base.result.show_score_to_participant = true;
  // Dua soal CP saja supaya pengujian cepat.
  base.sections[1].problem_ids = ['E-001', 'E-004'];
  base.sections[1].max_submissions_per_problem = 3;
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(base, null, 2));
  return base;
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

function admin(url) {
  return GET(url + (url.includes('?') ? '&' : '?') + 'key=' + encodeURIComponent(ADMIN_KEY));
}
function adminAction(payload) {
  return POST('/api/admin/action', { ...payload, key: ADMIN_KEY });
}

async function waitForServer(timeoutMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const r = await GET('/api/meta');
      if (r.status === 200) return true;
    } catch (_) {}
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

function startServer() {
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_OPTIONS: '',
      PORT: String(PORT),
      EXAM_CONFIG: CONFIG_FILE,
      EXAM_RUNTIME_DIR: path.join(TMP, 'runtime'),
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

const REF = {
  'E-001': 'a, b = map(int, input().split())\nprint(a + b)',
  'E-004': 'n = int(input())\narr = list(map(int, input().split()))\nprint(sum(arr) // n)',
};

// ---------------------------------------------------------------------------
// Skenario
// ---------------------------------------------------------------------------
async function main() {
  writeConfig();
  let server = startServer();

  if (!(await waitForServer())) {
    console.error('Server tidak pernah siap. Batal.');
    process.exit(1);
  }

  // =======================================================================
  section('1. Metadata publik');
  {
    const { status, data } = await GET('/api/meta');
    check('GET /api/meta berhasil', status === 200);
    check('dua bagian ujian terdaftar', data.sections.length === 2, JSON.stringify(data.sections.map((s) => s.id)));
    check('bagian TPKS berisi 30 soal', data.sections[0].question_count === 30, String(data.sections[0].question_count));
    check('bagian CP berisi 2 soal (konfig uji)', data.sections[1].question_count === 2);
    check('bahasa judge tersedia', Array.isArray(data.languages) && data.languages.length > 0, JSON.stringify(data.languages));
    check('kunci admin tidak dibocorkan di /api/meta', !JSON.stringify(data).includes(ADMIN_KEY));
    check('kode akses tidak dibocorkan di /api/meta', !JSON.stringify(data).includes(ACCESS_CODE));
  }

  // =======================================================================
  section('2. Registrasi & kontrol akses');
  let sid;
  {
    let r = await POST('/api/register', { nama: 'Peserta Satu', nim: '101', kelas: 'TI-A' });
    check('registrasi tanpa kode akses ditolak', r.status === 403, String(r.status));

    r = await POST('/api/register', {
      nama: 'Peserta Satu',
      nim: '101',
      kelas: 'TI-A',
      access_code: 'SALAH',
    });
    check('registrasi dengan kode salah ditolak', r.status === 403);

    r = await POST('/api/register', { nama: '', nim: '', access_code: ACCESS_CODE });
    check('nama & NIM wajib diisi', r.status === 400);

    r = await POST('/api/register', {
      nama: 'Peserta Satu',
      nim: '101',
      kelas: 'TI-A',
      access_code: ACCESS_CODE,
    });
    check('registrasi valid berhasil', r.status === 200 && !!r.data.sid);
    sid = r.data.sid;

    const again = await POST('/api/register', {
      nama: 'Peserta Satu Ganti Nama',
      nim: '101',
      access_code: ACCESS_CODE,
    });
    check('login ulang NIM yang sama melanjutkan sesi lama', again.data.sid === sid);

    const noSid = await GET('/api/state');
    check('akses tanpa session ditolak', noSid.status === 401);
    const badSid = await GET('/api/state', { sid: 'tidak-ada' });
    check('session palsu ditolak', badSid.status === 401);
  }

  // =======================================================================
  section('3. Urutan bagian & kebocoran kunci jawaban');
  {
    let r = await POST('/api/section/start', { section: 'cp' }, sid);
    check('tidak bisa membuka bagian CP sebelum TPKS', r.status === 409, String(r.status));

    r = await POST('/api/answer', { qid: 'A_PATTERN-001', choice: 'A' }, sid);
    check('tidak bisa menjawab sebelum bagian dimulai', r.status === 409);

    r = await POST('/api/section/start', { section: 'tpks' }, sid);
    check('bagian TPKS bisa dimulai', r.status === 200);

    const tpks = r.data.state.sections.find((s) => s.id === 'tpks');
    check('status bagian menjadi active', tpks.status === 'active');
    check('30 soal terkirim', tpks.questions.length === 30, String(tpks.questions.length));
    check('timer berjalan', tpks.remaining_ms > 0 && tpks.remaining_ms <= 45 * 60000);

    const leaked = tpks.questions.filter(
      (q) => 'ans' in q || 'exp' in q || Object.keys(q).some((k) => !['no', 'qid', 'type', 'q', 'opts'].includes(k))
    );
    check('kunci jawaban & pembahasan TIDAK dikirim ke peserta', leaked.length === 0, JSON.stringify(leaked[0] || {}));

    const payload = JSON.stringify(r.data);
    check('respons state tidak memuat field "exp"', !payload.includes('"exp"'));

    // Dedup: tidak boleh ada dua soal dengan teks yang praktis sama.
    const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const keys = tpks.questions.map((q) => norm(q.q) + '|' + q.opts.map(norm).sort().join('|'));
    check('tidak ada soal duplikat dalam satu paket', new Set(keys).size === keys.length,
      `${keys.length - new Set(keys).size} duplikat`);

    const byType = {};
    tpks.questions.forEach((q) => (byType[q.type] = (byType[q.type] || 0) + 1));
    check('komposisi 10/10/10 per tipe sesuai config',
      byType.A_PATTERN === 10 && byType.B_LOGIC === 10 && byType.C_ANALYTIC === 10,
      JSON.stringify(byType));
  }

  // =======================================================================
  section('4. Menjawab TPKS & penilaian');
  {
    // Ambil kunci lewat endpoint admin, lalu jawab 20 benar + 5 salah + 5 kosong.
    const detail = await admin('/api/admin/attempt?sid=' + encodeURIComponent(sid));
    check('endpoint admin attempt berfungsi', detail.status === 200);
    const questions = detail.data.tpks;
    check('admin melihat kunci jawaban', questions.length === 30 && !!questions[0].correct);

    for (let i = 0; i < 20; i++) {
      await POST('/api/answer', { qid: questions[i].qid, choice: questions[i].correct }, sid);
    }
    for (let i = 20; i < 25; i++) {
      const wrong = ['A', 'B', 'C', 'D'].find((l) => l !== questions[i].correct);
      await POST('/api/answer', { qid: questions[i].qid, choice: wrong }, sid);
    }

    const bad = await POST('/api/answer', { qid: questions[0].qid, choice: 'Z' }, sid);
    check('pilihan jawaban tidak valid ditolak', bad.status === 400);
    const ghost = await POST('/api/answer', { qid: 'TIDAK-ADA', choice: 'A' }, sid);
    check('soal yang tidak ada di paket ditolak', ghost.status === 400);

    // Hapus jawaban lalu pasang lagi.
    await POST('/api/answer', { qid: questions[0].qid, choice: '' }, sid);
    let st = (await GET('/api/state', { sid })).data.state;
    let tpks = st.sections.find((s) => s.id === 'tpks');
    check('jawaban bisa dihapus', !(questions[0].qid in tpks.answers));
    await POST('/api/answer', { qid: questions[0].qid, choice: questions[0].correct }, sid);

    st = (await GET('/api/state', { sid })).data.state;
    tpks = st.sections.find((s) => s.id === 'tpks');
    check('25 jawaban tersimpan', Object.keys(tpks.answers).length === 25, String(Object.keys(tpks.answers).length));

    const fin = await POST('/api/section/finish', { section: 'tpks' }, sid);
    check('bagian TPKS bisa dikumpulkan', fin.status === 200);
    const after = fin.data.state.sections.find((s) => s.id === 'tpks');
    check('status menjadi finished', after.status === 'finished');
    check('soal tidak lagi dikirim setelah ditutup', after.questions.length === 0);

    const locked = await POST('/api/answer', { qid: questions[0].qid, choice: 'A' }, sid);
    check('tidak bisa menjawab setelah bagian ditutup', locked.status === 409);

    const ov = await admin('/api/admin/overview');
    const row = ov.data.attempts.find((a) => a.sid === sid);
    check('nilai TPKS = 20 benar dari 30', row.scores.tpks.correct === 20 && row.scores.tpks.total === 30,
      JSON.stringify(row.scores.tpks));
    check('persentase TPKS = 66.67', Math.abs(row.scores.tpks.percent - 66.67) < 0.01, String(row.scores.tpks.percent));
    check('5 soal tercatat kosong', row.scores.tpks.blank === 5, String(row.scores.tpks.blank));
  }

  // =======================================================================
  section('5. Bagian CP: judge, partial credit, batas submit');
  {
    let r = await POST('/api/section/start', { section: 'cp' }, sid);
    check('bagian CP bisa dimulai setelah TPKS selesai', r.status === 200);
    const cp = r.data.state.sections.find((s) => s.id === 'cp');
    check('2 soal CP terkirim', cp.problems.length === 2);
    check('hanya contoh kasus yang dibagikan', cp.problems[0].samples.length === 2);
    check('test case tersembunyi tidak dikirim',
      !JSON.stringify(cp.problems).includes('is_sample') && cp.problems[0].total_tests === 7,
      String(cp.problems[0].total_tests));
    check('reference solution tidak dikirim ke peserta', !JSON.stringify(r.data).includes('reference_solution'));
    check('templat kode awal tersedia', !!cp.starter_code && !!cp.starter_code.python);

    // Draft autosave
    await POST('/api/cp/draft', { problem_id: 'E-001', language: 'python', code: '# draft saya' }, sid);
    let st = (await GET('/api/state', { sid })).data.state;
    let cpState = st.sections.find((s) => s.id === 'cp');
    check('draft kode tersimpan di server', cpState.drafts['E-001'].code === '# draft saya');

    // Uji sample (tidak dinilai)
    const run = await POST('/api/cp/run', { problem_id: 'E-001', language: 'python', code: REF['E-001'] }, sid);
    check('uji sample berjalan', run.status === 200 && run.data.result.verdict === 'AC',
      JSON.stringify(run.data.result && run.data.result.verdict));
    check('uji sample hanya menjalankan 2 contoh', run.data.result.total === 2, String(run.data.result.total));
    check('uji sample menampilkan expected vs got', !!run.data.result.results[0].expected);

    // Input manual
    const custom = await POST('/api/cp/run', {
      problem_id: 'E-001',
      language: 'python',
      code: REF['E-001'],
      custom_input: '7 8\n',
    }, sid);
    check('input manual menghasilkan output benar', custom.data.result.stdout.trim() === '15',
      JSON.stringify(custom.data.result.stdout));

    // Submit benar -> AC penuh
    const sub1 = await POST('/api/cp/submit', { problem_id: 'E-001', language: 'python', code: REF['E-001'] }, sid);
    check('submit solusi benar = AC', sub1.data.submission.verdict === 'AC');
    check('semua 7 test case lulus', sub1.data.submission.passed === 7 && sub1.data.submission.total === 7);
    const hidden = sub1.data.submission.results.filter((x) => !x.is_sample && x.expected != null);
    check('detail test case tersembunyi tidak dibocorkan saat submit', hidden.length === 0);

    // Submit sebagian benar -> partial credit
    const partial = 'n = int(input())\narr = list(map(int, input().split()))\nprint(sum(arr) // n if n > 1 else 999)';
    const sub2 = await POST('/api/cp/submit', { problem_id: 'E-004', language: 'python', code: partial }, sid);
    check('solusi sebagian benar tidak AC', sub2.data.submission.verdict !== 'AC', sub2.data.submission.verdict);
    check('partial credit tercatat', sub2.data.submission.passed > 0 && sub2.data.submission.passed < 7,
      `${sub2.data.submission.passed}/${sub2.data.submission.total}`);

    // Compile error
    const ce = await POST('/api/cp/submit', { problem_id: 'E-004', language: 'cpp', code: 'int main( {' }, sid);
    check('compile error terdeteksi', ce.data.submission.verdict === 'CE');
    check('pesan compiler dikirim ke peserta', (ce.data.submission.compile_output || '').length > 0);

    // Bahasa tidak terdaftar & kode kosong
    const badLang = await POST('/api/cp/submit', { problem_id: 'E-001', language: 'brainfuck', code: '+' }, sid);
    check('bahasa tidak terdaftar ditolak', badLang.status === 400);
    const empty = await POST('/api/cp/submit', { problem_id: 'E-001', language: 'python', code: '   ' }, sid);
    check('kode kosong ditolak', empty.status === 400);

    // Batas submit per soal = 3 (E-004 sudah 2x)
    await POST('/api/cp/submit', { problem_id: 'E-004', language: 'python', code: REF['E-004'] }, sid);
    const over = await POST('/api/cp/submit', { problem_id: 'E-004', language: 'python', code: REF['E-004'] }, sid);
    check('batas submit per soal ditegakkan', over.status === 429, String(over.status));

    // Nilai akhir: E-001 100, E-004 100 (submit terbaik dipakai)
    st = (await GET('/api/state', { sid })).data.state;
    cpState = st.sections.find((s) => s.id === 'cp');
    check('progres solved terlihat peserta', cpState.progress.every((p) => p.solved), JSON.stringify(cpState.progress));

    const ov = await admin('/api/admin/overview');
    const row = ov.data.attempts.find((a) => a.sid === sid);
    check('skor CP memakai submit TERBAIK, bukan terakhir', row.scores.cp.percent === 100,
      JSON.stringify(row.scores.cp.per_problem.map((p) => p.percent)));
    check('2 soal tercatat solved', row.scores.cp.solved_count === 2);

    const fin = await POST('/api/section/finish', { section: 'cp' }, sid);
    check('bagian CP bisa dikumpulkan', fin.status === 200);
    check('attempt selesai setelah bagian terakhir', fin.data.state.status === 'finished');

    // Bobot 0.4 * 66.67 + 0.6 * 100 = 86.67
    const expected = Math.round((0.4 * 66.67 + 0.6 * 100) * 100) / 100;
    const ov2 = await admin('/api/admin/overview');
    const row2 = ov2.data.attempts.find((a) => a.sid === sid);
    check(`nilai akhir berbobot = ${expected}`, Math.abs(row2.final.total - expected) < 0.02, String(row2.final.total));

    const closed = await POST('/api/cp/submit', { problem_id: 'E-001', language: 'python', code: REF['E-001'] }, sid);
    check('tidak bisa submit setelah ujian selesai', closed.status === 409);
  }

  // =======================================================================
  section('6. Lockdown: pencatatan & auto-submit');
  let sid2;
  {
    const reg = await POST('/api/register', { nama: 'Peserta Dua', nim: '202', access_code: ACCESS_CODE });
    sid2 = reg.data.sid;
    await POST('/api/section/start', { section: 'tpks' }, sid2);

    let v = await POST('/api/violation', { kind: 'exit_fullscreen', detail: 'keluar fullscreen' }, sid2);
    check('pelanggaran pertama tercatat', v.data.violation_count === 1);
    check('belum dipaksa selesai', v.data.forced_finish === false);

    v = await POST('/api/violation', { kind: 'tab_hidden', detail: 'pindah tab' }, sid2);
    check('pelanggaran kedua tercatat', v.data.violation_count === 2);

    v = await POST('/api/violation', { kind: 'window_blur', detail: 'buka aplikasi lain' }, sid2);
    check('pelanggaran ke-3 memicu auto-submit', v.data.forced_finish === true, JSON.stringify(v.data));
    check('status attempt menjadi finished', v.data.status === 'finished');

    const st = (await GET('/api/state', { sid: sid2 })).data.state;
    const tpks = st.sections.find((s) => s.id === 'tpks');
    check('alasan penutupan tercatat', /pelanggaran/i.test(tpks.finish_reason || ''), tpks.finish_reason);
    const cp = st.sections.find((s) => s.id === 'cp');
    check('bagian CP juga dibatalkan', cp.status === 'finished');

    const after = await POST('/api/section/start', { section: 'cp' }, sid2);
    check('tidak bisa membuka bagian apa pun setelah dihentikan', after.status === 409);

    const det = await admin('/api/admin/attempt?sid=' + encodeURIComponent(sid2));
    check('pengawas melihat 3 pelanggaran beserta waktunya',
      det.data.violations.length === 3 && !!det.data.violations[0].at);
    check('jenis pelanggaran terekam', det.data.violations.map((x) => x.kind).includes('window_blur'));
  }

  // =======================================================================
  section('7. Aksi pengawas');
  {
    const bad = await GET('/api/admin/overview?key=salah');
    check('kunci admin salah ditolak', bad.status === 403);
    const none = await GET('/api/admin/overview');
    check('tanpa kunci admin ditolak', none.status === 403);

    const reg = await POST('/api/register', { nama: 'Peserta Tiga', nim: '303', access_code: ACCESS_CODE });
    const sid3 = reg.data.sid;
    await POST('/api/section/start', { section: 'tpks' }, sid3);

    let st = (await GET('/api/state', { sid: sid3 })).data.state;
    const before = st.sections.find((s) => s.id === 'tpks').remaining_ms;

    await adminAction({ action: 'extend', sid: sid3, minutes: 10 });
    st = (await GET('/api/state', { sid: sid3 })).data.state;
    const afterExtend = st.sections.find((s) => s.id === 'tpks').remaining_ms;
    check('tambah waktu 10 menit berhasil', afterExtend - before > 9.5 * 60000, `${before} -> ${afterExtend}`);

    await POST('/api/violation', { kind: 'tab_hidden' }, sid3);
    await adminAction({ action: 'clear_violations', sid: sid3 });
    st = (await GET('/api/state', { sid: sid3 })).data.state;
    check('pengawas bisa menghapus catatan pelanggaran', st.violation_count === 0);

    await adminAction({ action: 'force_finish', sid: sid3 });
    st = (await GET('/api/state', { sid: sid3 })).data.state;
    check('hentikan paksa membuat attempt finished', st.status === 'finished');
    check('alasan "dihentikan panitia" tercatat',
      st.sections.every((s) => /dihentikan panitia/.test(s.finish_reason || '')));

    await adminAction({ action: 'reopen', sid: sid3, minutes: 10 });
    st = (await GET('/api/state', { sid: sid3 })).data.state;
    const reopened = st.sections.find((s) => s.id === 'cp');
    check('buka kembali bagian terakhir berhasil', reopened.status === 'active' && reopened.remaining_ms > 0);

    await adminAction({ action: 'disqualify', sid: sid3 });
    st = (await GET('/api/state', { sid: sid3 })).data.state;
    check('diskualifikasi berhasil', st.status === 'disqualified');
    const relog = await POST('/api/register', { nama: 'Peserta Tiga', nim: '303', access_code: ACCESS_CODE });
    check('peserta terdiskualifikasi tidak bisa login ulang', relog.status === 403);

    const unknown = await adminAction({ action: 'terbangkan-peserta', sid: sid3 });
    check('aksi tidak dikenal ditolak', unknown.status === 400);
  }

  // =======================================================================
  section('8. Export CSV');
  {
    const res = await fetch(BASE + '/api/admin/export.csv?key=' + encodeURIComponent(ADMIN_KEY));
    // Ambil byte mentah: res.text() membuang BOM sesuai spesifikasi fetch,
    // jadi BOM harus diperiksa langsung dari buffer.
    const bytes = Buffer.from(await res.arrayBuffer());
    const csv = bytes.toString('utf8');
    check('CSV terunduh', res.status === 200);
    check('header CSV lengkap', csv.includes('nama') && csv.includes('nilai_akhir') && csv.includes('cp_E-001_persen'),
      csv.split('\n')[0]);
    check('semua peserta ada di CSV', csv.includes('Peserta Satu') && csv.includes('Peserta Dua') && csv.includes('Peserta Tiga'));
    check(
      'CSV memakai BOM agar Excel benar membaca UTF-8',
      bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf,
      bytes.subarray(0, 3).toString('hex')
    );
    const lines = csv.trim().split('\n');
    check('jumlah baris = 1 header + 3 peserta', lines.length === 4, String(lines.length));
  }

  // =======================================================================
  section('9. Ketahanan: restart server, data harus utuh');
  {
    await new Promise((r) => setTimeout(r, 2000)); // beri waktu flush ke disk
    await stopServer(server);
    server = startServer();
    const up = await waitForServer();
    check('server hidup kembali', up);

    const st = await GET('/api/state', { sid });
    check('sesi peserta selamat setelah restart', st.status === 200 && st.data.state.participant.nim === '101');
    check('nilai TPKS tetap tersimpan', st.data.state.result.scores.tpks.correct === 20,
      JSON.stringify(st.data.state.result && st.data.state.result.scores && st.data.state.result.scores.tpks));

    const ov = await admin('/api/admin/overview');
    check('ketiga peserta masih terdaftar', ov.data.attempts.length === 3, String(ov.data.attempts.length));

    const logPath = path.join(TMP, 'runtime', 'events.log');
    const log = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '';
    check('jejak audit events.log tertulis', log.includes('"type":"violation"') && log.includes('"type":"cp_submit"'));
  }

  // =======================================================================
  section('10. Static file & rute tidak dikenal');
  {
    const home = await fetch(BASE + '/');
    check('halaman login tersaji di /', home.status === 200 && (await home.text()).includes('Identitas Peserta'));
    const exam = await fetch(BASE + '/exam.html');
    check('halaman ujian tersaji', exam.status === 200);
    const adminPage = await fetch(BASE + '/admin.html');
    check('halaman pengawas tersaji', adminPage.status === 200);
    const missing = await fetch(BASE + '/tidak-ada.html');
    check('404 untuk file tidak ada', missing.status === 404);
    const traversal = await fetch(BASE + '/../config.json');
    check('path traversal diblokir', traversal.status === 403 || traversal.status === 404, String(traversal.status));
  }

  // =======================================================================
  await stopServer(server);
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

main().catch(async (err) => {
  console.error('\nSelftest error:', err);
  process.exit(1);
});
