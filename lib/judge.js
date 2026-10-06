'use strict';
/**
 * Judge lokal untuk soal Competitive Programming.
 *
 * Bahasa yang didukung: Python, C, C++, Java, JavaScript. Bahasa yang tidak
 * terpasang di komputer panitia otomatis disembunyikan dari pilihan peserta,
 * jadi peserta tidak pernah memilih bahasa yang ujungnya gagal dijalankan.
 *
 * CATATAN KEAMANAN (baca README bagian "Keamanan Judge"):
 * kode peserta dijalankan sebagai proses biasa milik user yang menjalankan
 * server. Ada pembatas waktu CPU, jumlah proses, ukuran file, dan ukuran
 * output, tetapi ini BUKAN sandbox sekelas container. Jalankan server ujian
 * di mesin/user khusus, bukan di laptop pribadi yang berisi data penting.
 */

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { randomId, outputMatches } = require('./util');

const WORK_ROOT = path.join(__dirname, '..', 'data', 'runtime', 'judge');
const IS_POSIX = process.platform !== 'win32';

const VERDICT = {
  AC: 'AC',
  WA: 'WA',
  TLE: 'TLE',
  RTE: 'RTE',
  CE: 'CE',
  OLE: 'OLE',
  IE: 'IE',
};

const VERDICT_LABEL = {
  AC: 'Accepted',
  WA: 'Wrong Answer',
  TLE: 'Time Limit Exceeded',
  RTE: 'Runtime Error',
  CE: 'Compile Error',
  OLE: 'Output Limit Exceeded',
  IE: 'Internal Error',
};

let config = {
  max_concurrent: 2,
  compile_timeout_ms: 15000,
  max_output_bytes: 2000000,
};

/**
 * Spesifikasi bahasa.
 *
 * `candidates` dicoba berurutan sampai ada yang jalan. Ini penting untuk
 * portabilitas nyata: di Windows Python sering hanya bisa dipanggil lewat
 * launcher `py`, dan di macOS `gcc` sebenarnya adalah clang. Mencoba beberapa
 * nama perintah membuat C dan Python jalan apa adanya di jauh lebih banyak
 * laptop tanpa panitia harus menyetel PATH.
 *
 * `time_multiplier` memberi kelonggaran waktu untuk bahasa yang punya overhead
 * startup atau lebih lambat secara inheren. Tanpa ini, peserta Java bisa
 * kena TLE bukan karena algoritmanya salah, melainkan karena JVM butuh ~200ms
 * hanya untuk hidup.
 */
const LANG_SPECS = {
  python: {
    label: 'Python 3',
    source: 'main.py',
    interpreted: true,
    time_multiplier: 1.5,
    candidates: [
      { cmd: 'python3', args: [] },
      { cmd: 'python', args: [] },
      { cmd: 'py', args: ['-3'] }, // launcher bawaan Windows
    ],
    version_args: ['--version'],
    version_match: /Python 3/,
  },

  c: {
    label: 'C (C11)',
    source: 'main.c',
    compiled: true,
    time_multiplier: 1,
    candidates: [{ cmd: 'gcc' }, { cmd: 'clang' }, { cmd: 'cc' }],
    version_args: ['--version'],
    // -lm harus di belakang agar linker menemukan simbol math.
    compile_args: (src, bin) => ['-O2', '-std=c11', '-o', bin, src, '-lm'],
  },

  cpp: {
    label: 'C++ 17',
    source: 'main.cpp',
    compiled: true,
    time_multiplier: 1,
    candidates: [{ cmd: 'g++' }, { cmd: 'clang++' }, { cmd: 'c++' }],
    version_args: ['--version'],
    compile_args: (src, bin) => ['-O2', '-std=c++17', '-o', bin, src],
  },

  java: {
    label: 'Java',
    // Nama file WAJIB Main.java: javac menuntut nama file sama dengan nama
    // kelas publiknya. Templat kode awal peserta memakai `public class Main`.
    source: 'Main.java',
    compiled: true,
    needs_runtime: true,
    time_multiplier: 2,
    candidates: [{ cmd: 'javac' }],
    version_args: ['-version'],
    runtime_candidates: [{ cmd: 'java' }],
    compile_args: (src) => [src],
    // -Xss besar agar solusi rekursif tidak langsung StackOverflow.
    // -XX:-UsePerfData mencegah JVM menulis file sampah ke HOME.
    run_args: () => ['-Xss64m', '-Xmx512m', '-XX:-UsePerfData', '-cp', '.', 'Main'],
  },

  javascript: {
    label: 'JavaScript (Node)',
    source: 'main.js',
    interpreted: true,
    time_multiplier: 1.5,
    candidates: [{ cmd: process.execPath, args: [] }],
    version_args: ['--version'],
  },
};

let available = {};
let hasBash = false;

function probe(cmd, args) {
  try {
    const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 8000 });
    if (r.error || r.status !== 0) return null;
    const out = (r.stdout || '') + (r.stderr || '');
    return out.trim().split('\n')[0] || 'terpasang';
  } catch (_) {
    return null;
  }
}

function detect(judgeConfig) {
  if (judgeConfig) config = { ...config, ...judgeConfig };
  fs.mkdirSync(WORK_ROOT, { recursive: true });

  hasBash = IS_POSIX && !!probe('bash', ['--version']);
  available = {};

  for (const [id, spec] of Object.entries(LANG_SPECS)) {
    let found = null;
    for (const cand of spec.candidates) {
      const version = probe(cand.cmd, [...(cand.args || []), ...spec.version_args]);
      if (!version) continue;
      if (spec.version_match && !spec.version_match.test(version)) continue;
      found = { cmd: cand.cmd, args: cand.args || [], version };
      break;
    }
    if (!found) continue;

    // Java butuh dua perintah: javac untuk compile, java untuk menjalankan.
    // Tanpa keduanya bahasa ini tidak boleh diaktifkan.
    if (spec.needs_runtime) {
      let runtime = null;
      for (const cand of spec.runtime_candidates) {
        const version = probe(cand.cmd, ['-version']);
        if (version) {
          runtime = { cmd: cand.cmd, args: cand.args || [] };
          break;
        }
      }
      if (!runtime) continue;
      found.runtime = runtime;
    }

    available[id] = { id, spec, ...found };
  }

  return available;
}

function languageInfo() {
  return Object.values(available).map((l) => ({
    id: l.id,
    label: l.spec.label,
    version: l.version,
    command: l.cmd,
    time_multiplier: l.spec.time_multiplier,
  }));
}

function isAvailable(lang) {
  return Object.prototype.hasOwnProperty.call(available, lang);
}

/** Batas waktu efektif untuk satu bahasa pada satu soal. */
function effectiveTimeLimit(lang, baseMs) {
  const l = available[lang];
  const mult = l ? l.spec.time_multiplier || 1 : 1;
  return Math.round(baseMs * mult);
}

function timeMultipliers() {
  return Object.fromEntries(
    Object.values(available).map((l) => [l.id, l.spec.time_multiplier || 1])
  );
}

// ---------------------------------------------------------------------------
// Antrean eksekusi: batasi berapa submission berjalan bersamaan supaya satu
// laptop panitia tidak kelebihan beban saat 30 peserta submit serentak.
// ---------------------------------------------------------------------------
let running = 0;
const queue = [];

function acquire() {
  if (running < config.max_concurrent) {
    running++;
    return Promise.resolve();
  }
  return new Promise((resolve) => queue.push(resolve));
}

function release() {
  const next = queue.shift();
  if (next) next();
  else running--;
}

// ---------------------------------------------------------------------------
// Eksekusi satu proses
// ---------------------------------------------------------------------------
function runProcess({ cmd, args, cwd, input, timeoutMs, maxOutput }) {
  return new Promise((resolve) => {
    const started = Date.now();
    let child;

    // Di POSIX, bungkus dengan bash agar bisa memasang ulimit:
    //   -t  batas waktu CPU -- jaring pengaman kalau SIGKILL terlambat.
    //       Dibuat longgar karena JVM memakai beberapa thread sekaligus,
    //       sehingga total waktu CPU bisa melebihi waktu dinding.
    //   -u  batas jumlah proses/thread (mencegah fork bomb). JVM sendiri
    //       membuat belasan thread, jadi angkanya tidak boleh terlalu kecil.
    //   -f  batas ukuran file yang boleh dibuat (blok 1 KB).
    if (hasBash) {
      const cpuSec = Math.max(2, Math.ceil(timeoutMs / 1000) * 2 + 2);
      const guard = `ulimit -t ${cpuSec} -u 512 -f 51200 2>/dev/null; exec "$0" "$@"`;
      child = spawn('bash', ['-c', guard, cmd, ...args], {
        cwd,
        detached: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { PATH: process.env.PATH, HOME: cwd, LANG: 'C.UTF-8' },
      });
    } else {
      child = spawn(cmd, args, {
        cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { PATH: process.env.PATH, HOME: cwd },
      });
    }

    let stdout = '';
    let stderr = '';
    let bytes = 0;
    let finished = false;
    let verdictHint = null;

    const kill = () => {
      try {
        if (IS_POSIX && child.pid) process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch (_) {
        try {
          child.kill('SIGKILL');
        } catch (_) {}
      }
    };

    const timer = setTimeout(() => {
      verdictHint = VERDICT.TLE;
      kill();
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > maxOutput) {
        verdictHint = VERDICT.OLE;
        kill();
        return;
      }
      stdout += chunk.toString('utf8');
    });

    child.stderr.on('data', (chunk) => {
      if (stderr.length < 8000) stderr += chunk.toString('utf8');
    });

    child.on('error', (err) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve({
        ok: false,
        verdictHint: VERDICT.IE,
        stdout: '',
        stderr: err.message,
        code: -1,
        timeMs: Date.now() - started,
      });
    });

    child.on('close', (code, signal) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve({
        ok: code === 0 && !verdictHint,
        verdictHint,
        stdout,
        stderr,
        code,
        signal,
        timeMs: Date.now() - started,
      });
    });

    if (input) child.stdin.write(input);
    child.stdin.end();
    child.stdin.on('error', () => {
      /* program peserta bisa saja tidak membaca stdin -- EPIPE wajar */
    });
  });
}

// ---------------------------------------------------------------------------
// Persiapan workspace: tulis source, compile bila perlu
// ---------------------------------------------------------------------------
async function prepare(language, code) {
  const lang = available[language];
  if (!lang) return { error: `Bahasa "${language}" tidak tersedia di server ini.` };

  const spec = lang.spec;
  const dir = path.join(WORK_ROOT, randomId(8));
  fs.mkdirSync(dir, { recursive: true });
  const source = path.join(dir, spec.source);
  fs.writeFileSync(source, code, 'utf8');

  if (spec.interpreted) {
    return { dir, cmd: lang.cmd, args: [...lang.args, source] };
  }

  // --- Bahasa yang perlu compile
  const binary = path.join(dir, 'main.bin');
  const compiled = await runProcess({
    cmd: lang.cmd,
    args: spec.compile_args(source, binary),
    cwd: dir,
    input: '',
    timeoutMs: config.compile_timeout_ms,
    maxOutput: 400000,
  });

  const produced = spec.needs_runtime
    ? fs.existsSync(path.join(dir, 'Main.class'))
    : fs.existsSync(binary);

  if (!compiled.ok || !produced) {
    return {
      dir,
      compileError: (
        compiled.stderr ||
        compiled.stdout ||
        (compiled.verdictHint === VERDICT.TLE
          ? 'Compile melebihi batas waktu.'
          : 'Compile gagal tanpa pesan.')
      ).slice(0, 4000),
    };
  }

  if (spec.needs_runtime) {
    return {
      dir,
      cmd: lang.runtime.cmd,
      args: spec.run_args(),
      compileWarning: compiled.stderr.slice(0, 2000),
    };
  }
  return { dir, cmd: binary, args: [], compileWarning: compiled.stderr.slice(0, 2000) };
}

function cleanup(dir) {
  if (!dir) return;
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (_) {}
}

// ---------------------------------------------------------------------------
// API publik
// ---------------------------------------------------------------------------

/**
 * Jalankan kode terhadap daftar test case.
 * @param {object} opts
 * @param {string} opts.language
 * @param {string} opts.code
 * @param {Array}  opts.tests        [{no, input, output, is_sample}]
 * @param {number} opts.timeLimitMs  batas dasar soal, dikalikan per bahasa
 * @param {boolean} opts.revealIO    true untuk uji contoh (tampilkan expected vs got)
 */
async function evaluate({ language, code, tests, timeLimitMs, revealIO }) {
  await acquire();
  let dir = null;
  const limit = effectiveTimeLimit(language, timeLimitMs);
  try {
    const prepared = await prepare(language, code);
    dir = prepared.dir;

    if (prepared.error) {
      return {
        verdict: VERDICT.IE,
        message: prepared.error,
        results: [],
        passed: 0,
        total: tests.length,
      };
    }
    if (prepared.compileError) {
      return {
        verdict: VERDICT.CE,
        compile_output: prepared.compileError,
        results: [],
        passed: 0,
        total: tests.length,
      };
    }

    const results = [];
    let passed = 0;
    let maxTime = 0;

    for (const test of tests) {
      const run = await runProcess({
        cmd: prepared.cmd,
        args: prepared.args,
        cwd: prepared.dir,
        input: test.input,
        timeoutMs: limit,
        maxOutput: config.max_output_bytes,
      });

      maxTime = Math.max(maxTime, run.timeMs);
      let verdict;
      if (run.verdictHint === VERDICT.TLE) verdict = VERDICT.TLE;
      else if (run.verdictHint === VERDICT.OLE) verdict = VERDICT.OLE;
      else if (run.verdictHint === VERDICT.IE) verdict = VERDICT.IE;
      else if (run.code !== 0) verdict = VERDICT.RTE;
      else verdict = outputMatches(run.stdout, test.output) ? VERDICT.AC : VERDICT.WA;

      if (verdict === VERDICT.AC) passed++;

      const entry = {
        no: test.no,
        is_sample: !!test.is_sample,
        verdict,
        label: VERDICT_LABEL[verdict],
        time_ms: run.timeMs,
      };

      // Detail input/output hanya dibuka untuk test case contoh, agar test case
      // tersembunyi tidak bisa dipanen peserta lewat percobaan berulang.
      if (revealIO || test.is_sample) {
        entry.input = truncate(test.input, 2000);
        entry.expected = truncate(test.output, 2000);
        entry.got = truncate(run.stdout, 2000);
      }
      if (verdict === VERDICT.RTE || verdict === VERDICT.IE) {
        entry.stderr = truncate(run.stderr, 1500);
      }

      results.push(entry);
    }

    const allAc = passed === tests.length && tests.length > 0;
    const firstBad = results.find((r) => r.verdict !== VERDICT.AC);
    return {
      verdict: allAc ? VERDICT.AC : firstBad ? firstBad.verdict : VERDICT.IE,
      results,
      passed,
      total: tests.length,
      max_time_ms: maxTime,
      time_limit_ms: limit,
      compile_output: prepared.compileWarning || '',
    };
  } catch (err) {
    return {
      verdict: VERDICT.IE,
      message: err.message,
      results: [],
      passed: 0,
      total: tests.length,
    };
  } finally {
    cleanup(dir);
    release();
  }
}

/** Jalankan kode dengan input bebas yang ditulis peserta sendiri. */
async function runCustom({ language, code, input, timeLimitMs }) {
  await acquire();
  let dir = null;
  try {
    const prepared = await prepare(language, code);
    dir = prepared.dir;
    if (prepared.error) return { verdict: VERDICT.IE, message: prepared.error };
    if (prepared.compileError) {
      return { verdict: VERDICT.CE, compile_output: prepared.compileError };
    }

    const run = await runProcess({
      cmd: prepared.cmd,
      args: prepared.args,
      cwd: prepared.dir,
      input: input || '',
      timeoutMs: effectiveTimeLimit(language, timeLimitMs),
      maxOutput: config.max_output_bytes,
    });

    let verdict = 'OK';
    if (run.verdictHint) verdict = run.verdictHint;
    else if (run.code !== 0) verdict = VERDICT.RTE;

    return {
      verdict,
      label: VERDICT_LABEL[verdict] || 'Selesai',
      stdout: truncate(run.stdout, 20000),
      stderr: truncate(run.stderr, 4000),
      time_ms: run.timeMs,
      exit_code: run.code,
    };
  } catch (err) {
    return { verdict: VERDICT.IE, message: err.message };
  } finally {
    cleanup(dir);
    release();
  }
}

function truncate(s, n) {
  const str = String(s == null ? '' : s);
  return str.length > n ? str.slice(0, n) + `\n... (dipotong, total ${str.length} karakter)` : str;
}

module.exports = {
  detect,
  languageInfo,
  isAvailable,
  effectiveTimeLimit,
  timeMultipliers,
  evaluate,
  runCustom,
  VERDICT,
  VERDICT_LABEL,
  LANG_SPECS,
  WORK_ROOT,
};
