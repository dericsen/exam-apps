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

// Antarmuka yang hampir pasti BUKAN jalur ke peserta. Laptop dengan Docker,
// VirtualBox, atau VPN akan memunculkan IP tambahan yang kelihatan sah; kalau
// panitia menuliskannya di papan tulis, tidak ada peserta yang bisa terhubung.
const VIRTUAL_HINTS = [
  'docker', 'br-', 'veth', 'virbr', 'vboxnet', 'vmnet', 'utun', 'tun', 'tap',
  'tailscale', 'zt', 'wg', 'hyper-v', 'vethernet', 'loopback',
];

function classify(name, address) {
  const lower = name.toLowerCase();
  const virtual = VIRTUAL_HINTS.some((h) => lower.includes(h));
  const linkLocal = address.startsWith('169.254.');
  let scope = 'publik/tidak dikenal';
  if (address.startsWith('10.')) scope = '10.x (private, lazim di kampus & kantor)';
  else if (/^172\.(1[6-9]|2\d|3[01])\./.test(address)) scope = '172.16-31.x (private)';
  else if (address.startsWith('192.168.')) scope = '192.168.x (private, lazim di router rumah)';
  else if (linkLocal) scope = 'link-local (belum dapat IP dari router)';

  // Nama antarmuka yang biasanya wireless.
  const wireless = /wl|wi-?fi|airport|en0/i.test(name);
  return { virtual, linkLocal, scope, wireless };
}

function lanIps() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const nic of list || []) {
      if (nic.family === 'IPv4' && !nic.internal) {
        out.push({ name, address: nic.address, ...classify(name, nic.address) });
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
  // Deteksi dipinjam dari judge yang sebenarnya, bukan diulang di sini.
  // Kalau doctor punya logika deteksi sendiri, laporannya bisa berbeda dari
  // kenyataan yang dialami peserta -- justru membahayakan.
  const judge = require('../lib/judge');
  const detected = judge.detect(config.judge);
  const wanted = (cpSec && cpSec.languages) || [];

  // Cara pasang per bahasa, disesuaikan dengan sistem operasi laptop ini.
  const HOWTO = {
    python: IS_WIN
      ? 'Pasang dari https://python.org dan CENTANG "Add python.exe to PATH". Verifikasi: python --version'
      : IS_MAC
      ? 'brew install python3  (atau pasang Xcode Command Line Tools)'
      : 'sudo dnf install python3   /   sudo apt install python3',
    c: IS_WIN
      ? 'Pasang MinGW-w64 lewat MSYS2 (https://www.msys2.org), lalu tambahkan folder bin-nya ke PATH. ' +
        'Alternatif lebih ringan: pasang LLVM/clang dari https://releases.llvm.org -- judge juga menerima clang.'
      : IS_MAC
      ? 'xcode-select --install   (menyediakan clang, dikenali judge sebagai C)'
      : 'sudo dnf install gcc   /   sudo apt install gcc',
    cpp: IS_WIN
      ? 'Pasang MinGW-w64 lewat MSYS2 (https://www.msys2.org) lalu tambahkan folder bin-nya ke PATH.'
      : IS_MAC
      ? 'xcode-select --install   (menyediakan clang++)'
      : 'sudo dnf install gcc-c++   /   sudo apt install g++',
    java: IS_WIN
      ? 'Pasang JDK (bukan hanya JRE) dari https://adoptium.net, lalu pastikan javac dan java ada di PATH. ' +
        'Verifikasi: javac -version'
      : IS_MAC
      ? 'brew install openjdk   lalu ikuti petunjuk symlink yang ditampilkan brew'
      : 'sudo dnf install java-latest-openjdk-devel   /   sudo apt install default-jdk',
    javascript: 'Sudah tersedia otomatis bersama Node.js.',
  };

  for (const id of wanted) {
    const spec = judge.LANG_SPECS[id];
    if (!spec) {
      fail(
        `bahasa "${id}" tidak dikenal judge`,
        '',
        'Pilihan yang valid: ' + Object.keys(judge.LANG_SPECS).join(', ')
      );
      continue;
    }
    const got = detected[id];
    if (got) {
      const mult = spec.time_multiplier > 1 ? `, batas waktu x${spec.time_multiplier}` : '';
      ok(spec.label, `${got.cmd} -- ${got.version}${mult}`);
    } else {
      fail(
        `${spec.label} tidak terpasang`,
        'diminta config tapi tidak ditemukan',
        (HOWTO[id] || '') +
          '\n        -> Atau hapus "' +
          id +
          '" dari sections[].languages di config.json, supaya peserta tidak ' +
          'memilih bahasa yang tidak bisa dijalankan.'
      );
    }
  }

  const enabled = wanted.filter((l) => detected[l]);
  if (!wanted.length) {
    fail('tidak ada bahasa di config', '', 'Isi sections[].languages di config.json.');
  } else if (!enabled.length) {
    fail(
      'tidak ada bahasa aktif untuk bagian CP',
      '',
      'Peserta TIDAK AKAN BISA submit kode apa pun. Pasang minimal satu toolchain, ' +
        'atau tambahkan "javascript" ke config -- itu selalu tersedia bersama Node.js.'
    );
  } else {
    ok('bahasa aktif untuk peserta', enabled.join(', '));
  }

  // Bahasa lain yang terpasang tapi tidak dipakai: informasi berguna kalau
  // panitia ingin menambah pilihan.
  const extra = Object.keys(detected).filter((l) => !wanted.includes(l));
  if (extra.length) {
    console.log(
      `  INFO  terpasang tapi tidak diaktifkan di config: ${extra.join(', ')}`
    );
  }

  // ----------------------------------------------------------- Bank soal
  head('4. Bank soal');
  try {
    const bank = require('../lib/bank');
    bank.load();
    const { tpksBank, cpBank } = bank.banks();
    ok('bank TPKS terbaca', tpksBank.questions.length + ' entri soal');
    ok('bank CP terbaca', cpBank.problems.length + ' soal');

    const stats = bank.tpksGroupStats(tpksSec);
    if (!stats.has_group_field) {
      warn(
        'bank TPKS belum dikelompokkan',
        'field "group" tidak ada',
        'Jalankan: node tools/cluster_tpks.js --write  -- tanpa ini, soal yang ' +
          'isinya sama tapi kalimatnya beda bisa muncul berkali-kali pada satu peserta.'
      );
    } else {
      ok(
        'kelompok soal TPKS',
        `${stats.total_groups} kelompok unik dari ${stats.total_questions} soal`
      );
    }

    // Uji kapasitas sungguhan: jalankan pemilih soal berkali-kali. Membandingkan
    // jumlah per tipe tidak cukup, karena satu kelompok bisa dibutuhkan oleh
    // beberapa tipe sekaligus.
    let shortfall = 0;
    let repeated = 0;
    let firstWarning = '';
    const TRIALS = 60;
    for (let i = 0; i < TRIALS; i++) {
      const built = bank.buildTpksQuestions(tpksSec, 'doctor-' + i);
      if (built.warnings.length) {
        shortfall++;
        if (!firstWarning) firstWarning = built.warnings[0];
      }
      const seen = new Set();
      for (const q of built.questions) {
        if (seen.has(q.group)) repeated++;
        seen.add(q.group);
      }
    }
    if (shortfall) {
      fail(
        'komposisi soal TPKS tidak selalu bisa dipenuhi',
        `gagal ${shortfall}/${TRIALS} percobaan`,
        firstWarning || 'Turunkan "composition" di config.json, atau tambah soal baru.'
      );
    } else {
      ok('paket TPKS bisa dibentuk', `${TRIALS}/${TRIALS} percobaan, ${tpksCount} soal`);
    }
    if (repeated) {
      fail(
        'masih ada soal yang berulang dalam satu paket',
        repeated + ' kejadian',
        'Jalankan: node tools/cluster_tpks.js --write'
      );
    } else {
      ok('tidak ada soal berulang dalam satu paket');
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
  const real = ips.filter((i) => !i.linkLocal && !i.virtual);
  const virtuals = ips.filter((i) => i.virtual);

  if (!ips.length) {
    fail(
      'tidak ada alamat IP jaringan',
      'hanya loopback',
      'Laptop ini belum tersambung ke WiFi/LAN apa pun. Sambungkan dulu ke WiFi ' +
        'yang akan dipakai peserta.'
    );
  } else if (!real.length) {
    fail(
      'tidak ada alamat jaringan yang bisa dipakai',
      ips.map((i) => `${i.name}=${i.address}`).join(', '),
      'Laptop tersambung ke adapter tapi belum mendapat IP dari router, atau yang ' +
        'terdeteksi hanya antarmuka virtual. Periksa koneksi WiFi/DHCP.'
    );
  } else {
    real.forEach((i) => ok('alamat jaringan', `${i.name} -> ${i.address}  [${i.scope}]`));

    if (real.length > 1) {
      warn(
        'ada lebih dari satu alamat jaringan',
        real.map((i) => i.address).join(', '),
        'Pakai alamat pada antarmuka yang benar-benar tersambung ke WiFi peserta. ' +
          'Kalau salah pilih, peserta tidak akan bisa membuka halaman ujian. ' +
          'Uji dulu dari satu perangkat lain sebelum ujian.'
      );
    }

    // Jaringan kampus/kantor sering mengaktifkan client isolation, sehingga
    // perangkat di SSID yang sama tetap tidak bisa saling menghubungi.
    // Firewall yang sudah dibuka pun tidak akan menolong.
    const campus = real.find((i) => i.address.startsWith('10.') || /^172\./.test(i.address));
    if (campus) {
      warn(
        'jaringan tampak jaringan kampus/kantor',
        campus.address,
        'Jaringan seperti ini sering mengaktifkan "client isolation" sehingga\n' +
          '           perangkat di SSID yang sama TIDAK bisa saling menghubungi, dan\n' +
          '           membuka firewall tidak menolong. WAJIB diuji dari satu laptop\n' +
          '           peserta sebelum hari-H. Kalau gagal, pakai hotspot HP atau router\n' +
          '           sendiri -- keduanya memberi 192.168.x tanpa isolasi.'
      );
    }
  }

  if (virtuals.length) {
    warn(
      'ada antarmuka virtual yang diabaikan',
      virtuals.map((i) => `${i.name}=${i.address}`).join(', '),
      'Ini biasanya dari Docker, VirtualBox, atau VPN. JANGAN tulis alamat ini di ' +
        'papan tulis -- peserta tidak akan bisa mengaksesnya.'
    );
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
    // Utamakan antarmuka yang tampak wireless: itu yang satu jaringan dengan peserta.
    const primary = real.find((i) => i.wireless) || real[0];
    const ip = primary.address;

    console.log('\nAlamat yang dibagikan ke peserta (tulis di papan tulis):');
    console.log(`    http://${ip}:${port}`);
    if (real.length > 1) {
      console.log('  Alternatif kalau yang di atas tidak bisa dibuka peserta:');
      real
        .filter((i) => i.address !== ip)
        .forEach((i) => console.log(`    http://${i.address}:${port}   (${i.name})`));
    }

    console.log('\nHalaman pengawas (jangan dibagikan ke peserta):');
    console.log(`    http://${ip}:${port}/admin.html`);

    console.log('\nUJI DARI PERANGKAT LAIN sebelum ujian -- ini satu-satunya cara');
    console.log('memastikan firewall dan jaringan benar. Dari HP/laptop peserta:');
    console.log(`    buka  http://${ip}:${port}`);
    console.log(`    atau  curl http://${ip}:${port}/api/meta`);

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
