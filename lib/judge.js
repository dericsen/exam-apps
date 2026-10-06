'use strict';
/**
 * Judge lokal untuk soal Competitive Programming.
 *
 * Mendukung Python, C++ (g++), dan JavaScript (Node). Bahasa yang tidak
 * terpasang di komputer panitia otomatis disembunyikan dari pilihan peserta.
 *
 * CATATAN KEAMANAN (penting, baca README bagian "Keamanan Judge"):
 * kode peserta dijalankan sebagai proses biasa milik user yang menjalankan
 * server. Ada pembatas waktu CPU, jumlah proses, ukuran file, dan ukuran
 * output, tetapi ini BUKAN sandbox sekelas container. Jalankan server ujian
 * di mesin/user khusus, bukan di laptop pribadi yang berisi data penting.
 */

const fs = require('fs');
const os = require('os');
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
  compile_timeout_ms: 10000,
  max_output_bytes: 2000000,
};

const LANG_META = {
  python: { label: 'Python 3', ext: '.py', needsCompile: false },
  cpp: { label: 'C++ 17', ext: '.cpp', needsCompile: true },
  javascript: { label: 'JavaScript (Node)', ext: '.js', needsCompile: false },
};

let available = {};
let hasBash = false;

function probe(cmd, args) {
  try {
    const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 5000 });
    if (r.error || r.status !== 0) return null;
    return (r.stdout || r.stderr || '').trim().split('\n')[0];
  } catch (_) {
    return null;
  }
}

function detect(judgeConfig) {
  if (judgeConfig) config = { ...config, ...judgeConfig };
  fs.mkdirSync(WORK_ROOT, { recursive: true });

  hasBash = IS_POSIX && !!probe('bash', ['--version']);
  available = {};

  // Python: coba python3 lalu python.
  for (const cmd of ['python3', 'python']) {
    const v = probe(cmd, ['--version']);
    if (v) {
      available.python = { cmd, version: v, ...LANG_META.python };
      break;
    }
  }

  const gpp = probe('g++', ['--version']);
  if (gpp) available.cpp = { cmd: 'g++', version: gpp, ...LANG_META.cpp };

  // Node pasti ada -- server ini berjalan di atasnya.
  available.javascript = {
    cmd: process.execPath,
    version: 'Node ' + process.version,
    ...LANG_META.javascript,
  };

  return available;
}

function languageInfo() {
  return Object.entries(available).map(([id, v]) => ({
    id,
    label: v.label,
    version: v.version,
  }));
}

function isAvailable(lang) {
  return Object.prototype.hasOwnProperty.call(available, lang);
}

// ---------------------------------------------------------------------------
// Antrean eksekusi: batasi berapa submission yang dijalankan bersamaan supaya
// satu laptop panitia tidak kelebihan beban saat 30 peserta submit serentak.
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
    //   -t  batas waktu CPU (jaring pengaman kalau SIGKILL terlambat)
    //   -u  batas jumlah proses (mencegah fork bomb)
    //   -f  batas ukuran file yang boleh dibuat (blok 1 KB)
    if (hasBash) {
      const cpuSec = Math.max(1, Math.ceil(timeoutMs / 1000) + 1);
      const guard = `ulimit -t ${cpuSec} -u 128 -f 20480 2>/dev/null; exec "$0" "$@"`;
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
  if (!lang) {
    return { error: `Bahasa "${language}" tidak tersedia di server ini.` };
  }

  const dir = path.join(WORK_ROOT, randomId(8));
  fs.mkdirSync(dir, { recursive: true });
  const source = path.join(dir, 'main' + lang.ext);
  fs.writeFileSync(source, code, 'utf8');

  if (!lang.needsCompile) {
    return { dir, cmd: lang.cmd, args: [source] };
  }

  const binary = path.join(dir, 'main.bin');
  const compiled = await runProcess({
    cmd: lang.cmd,
    args: ['-O2', '-std=c++17', '-static-libstdc++', '-o', binary, source],
    cwd: dir,
    input: '',
    timeoutMs: config.compile_timeout_ms,
    maxOutput: 200000,
  });

  if (!compiled.ok || !fs.existsSync(binary)) {
    return {
      dir,
      compileError:
        (compiled.stderr || compiled.stdout || 'Compile gagal tanpa pesan.').slice(0, 4000),
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
 * @param {Array}  opts.tests     [{no, input, output, is_sample}]
 * @param {number} opts.timeLimitMs
 * @param {boolean} opts.revealIO  true untuk sample run (tampilkan expected vs got)
 */
async function evaluate({ language, code, tests, timeLimitMs, revealIO }) {
  await acquire();
  let dir = null;
  try {
    const prepared = await prepare(language, code);
    dir = prepared.dir;

    if (prepared.error) {
      return { verdict: VERDICT.IE, message: prepared.error, results: [], passed: 0, total: tests.length };
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
        timeoutMs: timeLimitMs,
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
      timeoutMs: timeLimitMs,
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
  evaluate,
  runCustom,
  VERDICT,
  VERDICT_LABEL,
  WORK_ROOT,
};
