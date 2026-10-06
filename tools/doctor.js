#!/usr/bin/env node
'use strict';
/**
 * Preflight check: periksa apakah laptop ini siap dipakai ujian.
 *
 * Jalankan di laptop yang AKAN DIPAKAI ujian, idealnya sehari sebelumnya:
 *
 *     node tools/doctor.js
 *
 * Yang diperiksa: versi Node, konfigurasi yang belum diganti, bahasa judge
 * yang terpasang, kecukupan bank soal, port yang bisa dipakai, IP jaringan,
 * izin tulis folder data, dan sisa data dari sesi sebelumnya.
 *
 * Exit code 0 = siap (mungkin ada peringatan), 1 = ada yang harus dibereskan.
 */

const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const CONFIG_PATH = process.env.EXAM_CONFIG || path.join(ROOT, 'config.json');
const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';

let fails = 0;
let warns = 0;

function ok(label, detail) {
  console.log(`  OK    ${label}${detail ? '  (' + detail + ')' : ''}`);
}
function warn(label, detail, fix) {
  warns++;
  console.log(`  WARN  ${label}${detail ? '  (' + detail + ')' : ''}`);
  if (fix) console.log(`        -> ${fix}`);
}
function fail(label, detail, fix) {
  fails++;
  console.log(`  GAGAL ${label}${detail ? '  (' + detail + ')' : ''}`);
  if (fix) console.log(`        -> ${fix}`);
}
function head(title) {
  console.log('\n' + title);
}

function probe(cmd, args) {
  try {
    const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 8000 });
    if (r.error || r.status !== 0) return null;
    return (r.stdout || r.stderr || '').trim().split('\n')[0];
  } catch (_) {
    return null;
  }
}

function checkPort(port, host) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', (err) => resolve(err.code || 'ERROR'));
    srv.once('listening', () => srv.close(() => resolve(null)));
    srv.listen(port, host);
  });
}

function lanIps() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const nic of list || []) {
      if (nic.family === 'IPv4' && !nic.internal) {
        out.push({ name, address: nic.address, linkLocal: nic.address.startsWith('169.254.') });
      }
    }
  }
  return out;
}

(async function main() {
  console.log('='.repeat(70));
  console.log('  PREFLIGHT CHECK -- Exam Apps');
  console.log('='.repeat(70));
  console.log(`  Sistem : ${os.platform()} ${os.release()} (${os.arch()})`);
  console.log(`  Folder : ${ROOT}`);

  // ---------------------------------------------------------------- Node
  head('1. Runtime');
  const major = Number(process.versions.node.split('.')[0]);
  if (major >= 18) ok('Node.js', process.version);
  else
    fail(
      'Node.js terlalu tua',
      process.version,
      'Butuh Node.js 18 atau lebih baru. Unduh dari https://nodejs.org (pilih LTS).'
    );

  // -------------------------------------------------------------- Config
  head('2. Konfigurasi');
  let config = null;
  try {
    config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    ok('config.json terbaca', path.basename(CONFIG_PATH));
  } catch (err) {
    fail('config.json tidak bisa dibaca', err.message, 'Perbaiki sintaks JSON-nya.');
    console.log('\nTidak bisa lanjut tanpa config.json yang valid.');
    process.exit(1);
  }

  if (String(config.admin_key).startsWith('GANTI') || String(config.admin_key).length < 8) {
    fail(
      'admin_key masih bawaan / terlalu pendek',
      String(config.admin_key),
      'Ganti "admin_key" di config.json. Siapa pun yang tahu kunci ini bisa melihat ' +
        'semua kunci jawaban dan mengubah nilai.'
    );
  } else {
    ok('admin_key sudah diganti');
  }

  const reg = config.registration || {};
  if (reg.require_access_code) {
    if (reg.access_code === 'CS2026') {
      warn(
        'access_code masih contoh bawaan',
        reg.access_code,
        'Ganti agar orang luar tidak bisa ikut enroll. Bagikan kode ini hanya saat ujian dimulai.'
      );
    } else if (!reg.access_code) {
      fail('require_access_code aktif tapi access_code kosong', '', 'Isi "access_code" di config.json.');
    } else {
      ok('access_code sudah diganti');
    }
  } else {
    warn(
      'kode akses dimatikan',
      'require_access_code = false',
      'Siapa pun di WiFi ini bisa enroll. Aktifkan kalau ujian bersifat tertutup.'
    );
  }

  const exam = config.exam || {};
  if (exam.duration_min > 0) ok('durasi ujian', exam.duration_min + ' menit sejak enroll');
  else fail('exam.duration_min tidak valid', String(exam.duration_min));

  const tpksSec = (config.sections || []).find((s) => s.type === 'mcq');
  const cpSec = (config.sections || []).find((s) => s.type === 'code');
  const tpksCount = Object.values((tpksSec && tpksSec.composition) || {}).reduce((a, b) => a + b, 0);
  ok('komposisi soal', `${tpksCount} TPKS + ${cpSec ? cpSec.problem_count : 0} CP`);

  const totalWeight = (config.sections || []).reduce((a, s) => a + (s.weight || 0), 0);
  if (totalWeight > 0) ok('bobot nilai', (config.sections || []).map((s) => `${s.id}=${s.weight}`).join(' '));
  else fail('total bobot nol', '', 'Isi "weight" minimal pada salah satu bagian.');

  // --------------------------------------------------------------- Judge
  head('3. Bahasa pemrograman untuk judge');
  const wanted = (cpSec && cpSec.languages) || [];
  const available = [];

  let pythonCmd = null;
  let pythonVer = null;
  for (const cmd of ['python3', 'python']) {
    const v = probe(cmd, ['--version']);
    if (v && /Python 3/.test(v)) {
      pythonCmd = cmd;
      pythonVer = v;
      break;
    }
    if (v) pythonVer = v; // mungkin Python 2
  }
  if (pythonCmd) {
    available.push('python');
    ok('Python 3', `${pythonCmd} -- ${pythonVer}`);
  } else if (wanted.includes('python')) {
    fail(
      'Python 3 tidak ditemukan',
      pythonVer || 'tidak terpasang',
      IS_WIN
        ? 'Pasang dari https://python.org dan CENTANG "Add python.exe to PATH" saat instalasi. ' +
          'Verifikasi dengan: python --version'
        : IS_MAC
        ? 'brew install python3  (atau pasang Xcode Command Line Tools)'
        : 'sudo dnf install python3   /   sudo apt install python3'
    );
  }

  const gpp = probe('g++', ['--version']);
  if (gpp) {
    available.push('cpp');
    ok('C++ (g++)', gpp);
  } else if (wanted.includes('cpp')) {
    fail(
      'g++ tidak ditemukan',
      'tidak terpasang',
      IS_WIN
        ? 'Pasang MinGW-w64 lewat MSYS2 (https://www.msys2.org) lalu tambahkan folder ' +
          'bin-nya ke PATH. Kalau tidak ada waktu, hapus "cpp" dari sections[].languages ' +
          'di config.json agar peserta tidak memilih bahasa yang tidak bisa dijalankan.'
        : IS_MAC
        ? 'xcode-select --install   (g++ akan tersedia sebagai alias clang++)'
        : 'sudo dnf install gcc-c++   /   sudo apt install g++'
    );
  }

  available.push('javascript');
  ok('JavaScript (Node)', 'Node ' + process.version);

  const missing = wanted.filter((l) => !available.includes(l));
  if (!missing.length && wanted.length) {
    ok('semua bahasa di config tersedia', wanted.join(', '));
  } else if (missing.length) {
    fail(
      'bahasa di config tidak tersedia di mesin ini',
      missing.join(', '),
      'Pasang yang kurang, ATAU hapus dari sections[].languages. Bahasa yang tidak ' +
        'terpasang otomatis disembunyikan dari peserta, tapi lebih baik config-nya jujur.'
    );
  }
  if (!available.some((l) => wanted.includes(l))) {
    fail('tidak ada bahasa aktif untuk bagian CP', '', 'Peserta tidak akan bisa submit kode apa pun.');
  }

  // ----------------------------------------------------------- Bank soal
  head('4. Bank soal');
  try {
    const bank = require('../lib/bank');
    bank.load();
    const { tpksBank, cpBank } = bank.banks();
    ok('bank TPKS terbaca', tpksBank.questions.length + ' entri soal');
    ok('bank CP terbaca', cpBank.problems.length + ' soal');

    // Cukup tidak soal uniknya untuk komposisi yang diminta?
    const built = bank.buildTpksQuestions(tpksSec, 'doctor-check');
    if (built.warnings.length) {
      built.warnings.forEach((w) =>
        fail('bank TPKS kurang', w, 'Tambah soal, atau turunkan angka "composition" di config.json.')
      );
    } else {
      ok('paket TPKS bisa dibentuk', built.questions.length + ' soal unik terpilih');
    }

    const picked = bank.pickCpProblems(cpSec, 'doctor-check');
    if (picked.warnings.length) {
      picked.warnings.forEach((w) => fail('pemilihan soal CP bermasalah', w));
    } else {
      ok('paket CP bisa dibentuk', picked.problemIds.join(', '));
    }

    // Test case lengkap?
    const empty = cpBank.problems.filter((p) => !p.test_cases || p.test_cases.length < 2);
    if (empty.length) fail('soal CP tanpa test case cukup', empty.map((p) => p.id).join(', '));
    else ok('semua soal CP punya test case');
  } catch (err) {
    fail('bank soal gagal dimuat', err.message);
  }

  // ---------------------------------------------------------- Penyimpanan
  head('5. Penyimpanan data');
  const runtimeDir = path.join(ROOT, 'data', 'runtime');
  try {
    fs.mkdirSync(runtimeDir, { recursive: true });
    const probeFile = path.join(runtimeDir, '.write-test');
    fs.writeFileSync(probeFile, 'ok');
    fs.unlinkSync(probeFile);
    ok('folder data/runtime bisa ditulis');
  } catch (err) {
    fail(
      'folder data/runtime tidak bisa ditulis',
      err.message,
      'Jawaban peserta TIDAK akan tersimpan. Pindahkan proyek ke folder milikmu ' +
        '(mis. Documents), jangan di Program Files atau folder read-only.'
    );
  }

  const stateFile = path.join(runtimeDir, 'attempts.json');
  if (fs.existsSync(stateFile)) {
    try {
      const prev = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      const n = Object.keys(prev.attempts || {}).length;
      if (n > 0) {
        warn(
          'ada data peserta dari sesi sebelumnya',
          n + ' attempt',
          'Kalau itu sisa uji coba, buka dashboard pengawas lalu tekan "Reset semua" ' +
            'SEBELUM ujian dimulai. Kalau itu data ujian sungguhan, backup dulu folder data/runtime.'
        );
      } else {
        ok('belum ada data peserta');
      }
    } catch (_) {
      warn('attempts.json ada tapi tidak terbaca', '', 'Server akan mencadangkannya dan mulai bersih.');
    }
  } else {
    ok('belum ada data peserta');
  }

  // -------------------------------------------------------------- Jaringan
  head('6. Jaringan');
  const port = config.port || 3000;
  const portErr = await checkPort(port, config.host || '0.0.0.0');
  if (!portErr) {
    ok(`port ${port} bisa dipakai`);
  } else if (portErr === 'EADDRINUSE') {
    fail(
      `port ${port} sudah dipakai program lain`,
      portErr,
      'Matikan program yang memakainya, atau ubah "port" di config.json. ' +
        'Mungkin juga server ujian sudah berjalan di jendela terminal lain.'
    );
  } else {
    fail(`port ${port} tidak bisa dibuka`, portErr);
  }

  const ips = lanIps();
  const real = ips.filter((i) => !i.linkLocal);
  if (!ips.length) {
    fail(
      'tidak ada alamat IP jaringan',
      'hanya loopback',
      'Laptop ini belum tersambung ke WiFi/LAN apa pun. Sambungkan dulu ke WiFi ' +
        'yang akan dipakai peserta.'
    );
  } else if (!real.length) {
    fail(
      'hanya ada IP link-local',
      ips.map((i) => i.address).join(', '),
      'Laptop tersambung ke adapter tapi tidak mendapat IP dari router. Periksa WiFi/DHCP.'
    );
  } else {
    real.forEach((i) => ok('alamat jaringan', `${i.name} -> ${i.address}`));
  }

  warn(
    'firewall belum bisa diperiksa otomatis',
    'wajib dicek manual',
    IS_WIN
      ? `Jalankan PowerShell sebagai Administrator:\n` +
        `           New-NetFirewallRule -DisplayName "Exam App" -Direction Inbound ` +
        `-LocalPort ${port} -Protocol TCP -Action Allow`
      : IS_MAC
      ? 'Saat server pertama kali jalan, macOS akan menampilkan dialog. Tekan "Allow".'
      : `sudo firewall-cmd --add-port=${port}/tcp    (firewalld)\n` +
        `           sudo ufw allow ${port}/tcp                  (ufw)`
  );

  // ------------------------------------------------------------- Ringkasan
  console.log('\n' + '='.repeat(70));
  if (fails) {
    console.log(`  BELUM SIAP -- ${fails} masalah harus dibereskan, ${warns} peringatan.`);
  } else if (warns) {
    console.log(`  SIAP, dengan ${warns} peringatan yang sebaiknya dibaca.`);
  } else {
    console.log('  SIAP. Semua pemeriksaan lulus.');
  }
  console.log('='.repeat(70));

  if (real.length) {
    const ip = real[0].address;
    console.log('\nAlamat yang dibagikan ke peserta (tulis di papan tulis):');
    real.forEach((i) => console.log(`    http://${i.address}:${port}`));
    console.log('\nHalaman pengawas (jangan dibagikan ke peserta):');
    console.log(`    http://${ip}:${port}/admin.html`);

    console.log('\nPerintah kiosk mode untuk laptop peserta:');
    if (IS_WIN) {
      console.log(
        `    chrome.exe --kiosk --app=http://${ip}:${port} --user-data-dir=%TEMP%\\exam-profile`
      );
    } else if (IS_MAC) {
      console.log(
        `    open -na "Google Chrome" --args --kiosk --app=http://${ip}:${port} ` +
          `--user-data-dir=/tmp/exam-profile`
      );
    } else {
      console.log(
        `    google-chrome --kiosk --app=http://${ip}:${port} --user-data-dir=/tmp/exam-profile`
      );
    }
  }

  console.log('\nLangkah berikutnya:');
  console.log('    node tools/verify_cp.js     # pastikan judge menilai dengan benar');
  console.log('    node server.js              # jalankan server ujian');
  console.log('');

  process.exit(fails ? 1 : 0);
})();
