#!/usr/bin/env node
'use strict';
/**
 * Server ujian LAN -- TPKS + Competitive Programming.
 *
 * Jalankan:  node server.js
 * Peserta:   http://<IP-laptop-panitia>:3000
 * Pengawas:  http://<IP-laptop-panitia>:3000/admin.html
 *
 * Model waktu: SATU timer untuk seluruh ujian, mulai berjalan pada saat
 * peserta melakukan enroll (menekan Masuk di halaman login). Kedua bagian
 * dibuka bersamaan dan peserta bebas berpindah-pindah; ia sendiri yang
 * mengatur pembagian waktunya.
 *
 * Tanpa dependency eksternal: cukup Node.js 18+.
 */

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { sendJson, sendText, serveStatic, createRouter } = require('./lib/http');
const store = require('./lib/store');
const bank = require('./lib/bank');
const judge = require('./lib/judge');
const scoring = require('./lib/scoring');
const { randomId, sanitizeText, clampInt, nowMs } = require('./lib/util');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
// EXAM_CONFIG / PORT bisa dioverride lewat environment -- dipakai oleh
// tools/selftest.js agar pengujian tidak mengotori konfigurasi & data asli.
const CONFIG_PATH = process.env.EXAM_CONFIG || path.join(ROOT, 'config.json');

const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
if (process.env.PORT) config.port = Number(process.env.PORT);

const EXAM = config.exam;
const TPKS_SECTION = config.sections.find((s) => s.type === 'mcq');
const CP_SECTION = config.sections.find((s) => s.type === 'code');
const DURATION_MS = EXAM.duration_min * 60000;

const MAX_CODE_BYTES = 100 * 1024;

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------
bank.load();
store.init();
judge.detect(config.judge);

const enabledLanguages = (CP_SECTION ? CP_SECTION.languages : []).filter((l) =>
  judge.isAvailable(l)
);

// Seluruh pool soal CP yang mungkin keluar -- dipakai dashboard pengawas.
const CP_POOL = (() => {
  const tiers = CP_SECTION.problem_tiers;
  if (Array.isArray(tiers) && tiers.length) return tiers.flat();
  return bank.banks().cpBank.problems.map((p) => p.id);
})();

// ---------------------------------------------------------------------------
// Attempt
// ---------------------------------------------------------------------------
function createAttempt(participant, identityKey, meta) {
  const sid = randomId(18);
  const seed = sid + '|' + identityKey;

  const tpks = bank.buildTpksQuestions(TPKS_SECTION, seed);
  if (tpks.warnings.length) console.warn('[bank] ' + tpks.warnings.join(' '));

  const cp = bank.pickCpProblems(CP_SECTION, seed);
  if (cp.warnings.length) console.warn('[bank] ' + cp.warnings.join(' '));

  const attempt = {
    sid,
    identity_key: identityKey,
    participant,
    created_at: new Date().toISOString(),
    // Timer mulai di sini: detik peserta menekan Masuk.
    enrolled_at: nowMs(),
    extra_ms: 0,
    last_seen: nowMs(),
    ip: meta.ip,
    user_agent: meta.userAgent,
    status: 'active',
    finished_at: null,
    finish_reason: null,
    tpks: { questions: tpks.questions, answers: {} },
    cp: { problem_ids: cp.problemIds, submissions: {}, drafts: {} },
    violations: [],
    violation_count: 0,
    scores: null,
    final: null,
  };

  store.putAttempt(attempt);
  store.logEvent('enroll', {
    sid,
    participant,
    ip: meta.ip,
    cp_problems: cp.problemIds,
    ends_at: new Date(deadline(attempt)).toISOString(),
  });
  return attempt;
}

function deadline(attempt) {
  return attempt.enrolled_at + DURATION_MS + (attempt.extra_ms || 0);
}

function remainingMs(attempt) {
  if (attempt.status !== 'active') return 0;
  return Math.max(0, deadline(attempt) - nowMs());
}

function cpProblems(attempt) {
  return bank.getCpProblems(attempt.cp.problem_ids);
}

function finishExam(attempt, reason) {
  if (attempt.status === 'finished' || attempt.status === 'disqualified') return;
  attempt.status = 'finished';
  attempt.finished_at = nowMs();
  attempt.finish_reason = reason;
  recomputeScores(attempt);
  store.logEvent('finish', { sid: attempt.sid, reason, final: attempt.final });
  store.markDirty();
}

function recomputeScores(attempt) {
  const scores = {
    tpks: scoring.gradeTpks(attempt.tpks),
    cp: scoring.gradeCp(attempt.cp, cpProblems(attempt)),
  };
  attempt.scores = scores;
  attempt.final = scoring.finalScore(scores, config.sections);
  store.markDirty();
}

/** Dipanggil di setiap request: tegakkan batas waktu di sisi server. */
function tick(attempt) {
  if (attempt.status === 'active' && remainingMs(attempt) <= 0) {
    finishExam(attempt, 'waktu habis');
  }
}

function isOpen(attempt) {
  return attempt.status === 'active';
}

// ---------------------------------------------------------------------------
// Serialisasi state untuk peserta (tanpa kunci jawaban!)
// ---------------------------------------------------------------------------
function publicState(attempt) {
  tick(attempt);
  attempt.last_seen = nowMs();
  store.markDirty();

  const open = isOpen(attempt);
  const problems = cpProblems(attempt);

  const progress = problems.map((p) => {
    const list = attempt.cp.submissions[p.id] || [];
    let bestPassed = 0;
    for (const s of list) bestPassed = Math.max(bestPassed, s.passed);
    return {
      problem_id: p.id,
      attempts: list.length,
      best_passed: bestPassed,
      total_tests: p.test_cases.length,
      solved: list.some((s) => s.total > 0 && s.passed === s.total),
      last_verdict: list.length ? list[list.length - 1].verdict : null,
    };
  });

  return {
    sid: attempt.sid,
    participant: attempt.participant,
    status: attempt.status,
    finish_reason: attempt.finish_reason,
    remaining_ms: remainingMs(attempt),
    duration_min: EXAM.duration_min,
    warn_minutes: EXAM.warn_minutes || 10,
    violation_count: attempt.violation_count,
    max_violations: config.lockdown.max_violations,
    lockdown: config.lockdown,
    parts: {
      tpks: {
        name: TPKS_SECTION.name,
        full_name: TPKS_SECTION.full_name,
        weight: TPKS_SECTION.weight,
        question_count: attempt.tpks.questions.length,
        // Kunci jawaban (ans) dan pembahasan (exp) sengaja TIDAK dikirim.
        questions: open
          ? attempt.tpks.questions.map((q) => ({
              no: q.no,
              qid: q.qid,
              type: q.type,
              q: q.q,
              opts: q.opts,
            }))
          : [],
        answers: attempt.tpks.answers,
        answered_count: Object.keys(attempt.tpks.answers).length,
      },
      cp: {
        name: CP_SECTION.name,
        full_name: CP_SECTION.full_name,
        weight: CP_SECTION.weight,
        problem_count: problems.length,
        languages: enabledLanguages.map((id) => {
          const info = judge.languageInfo().find((l) => l.id === id);
          return { id, label: info ? info.label : id };
        }),
        max_submissions_per_problem: CP_SECTION.max_submissions_per_problem,
        problems: open ? problems.map((p, i) => bank.publicProblem(p, i)) : [],
        drafts: attempt.cp.drafts,
        starter_code: bank.starterCode(),
        progress,
      },
    },
    result: open ? null : buildResult(attempt),
  };
}

function buildResult(attempt) {
  const out = {
    status: attempt.status,
    finish_reason: attempt.finish_reason,
    violation_count: attempt.violation_count,
    show_score: !!config.result.show_score_to_participant,
  };
  if (config.result.show_score_to_participant) {
    out.scores = attempt.scores;
    out.final = attempt.final;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Auth helper
// ---------------------------------------------------------------------------
function auth(ctx) {
  const sid = ctx.req.headers['x-sid'] || ctx.query.sid;
  if (!sid) {
    sendJson(ctx.res, 401, { error: 'Sesi tidak ditemukan. Silakan login ulang.' });
    return null;
  }
  const attempt = store.getAttempt(String(sid));
  if (!attempt) {
    sendJson(ctx.res, 401, { error: 'Sesi tidak valid atau sudah direset panitia.' });
    return null;
  }
  return attempt;
}

/** Pastikan ujian masih terbuka sebelum menerima perubahan apa pun. */
function requireOpen(ctx, attempt) {
  tick(attempt);
  if (!isOpen(attempt)) {
    sendJson(ctx.res, 409, {
      error:
        attempt.status === 'disqualified'
          ? 'Sesi kamu dihentikan panitia.'
          : 'Ujian sudah berakhir.',
      status: attempt.status,
    });
    return false;
  }
  return true;
}

function requireAdmin(ctx) {
  const key = ctx.query.key || ctx.body.key || ctx.req.headers['x-admin-key'];
  if (!key || String(key) !== config.admin_key) {
    sendJson(ctx.res, 403, { error: 'Kunci admin salah.' });
    return false;
  }
  return true;
}

function clientIp(req) {
  return (
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.socket.remoteAddress ||
    '-'
  );
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
const router = createRouter();

router.on('GET', '/api/meta', (ctx) => {
  sendJson(ctx.res, 200, {
    exam_title: config.exam_title,
    exam_subtitle: config.exam_subtitle,
    duration_min: EXAM.duration_min,
    registration: {
      fields: config.registration.fields,
      require_access_code: !!config.registration.require_access_code,
    },
    parts: [
      {
        id: 'tpks',
        name: TPKS_SECTION.name,
        full_name: TPKS_SECTION.full_name,
        kind: 'Pilihan ganda',
        count: Object.values(TPKS_SECTION.composition || {}).reduce((a, b) => a + b, 0),
        weight: TPKS_SECTION.weight,
      },
      {
        id: 'cp',
        name: CP_SECTION.name,
        full_name: CP_SECTION.full_name,
        kind: 'Menulis program',
        count: CP_SECTION.problem_count,
        weight: CP_SECTION.weight,
      },
    ],
    lockdown: config.lockdown,
    languages: enabledLanguages,
  });
});

router.on('POST', '/api/register', (ctx) => {
  const b = ctx.body || {};
  const nama = sanitizeText(b.nama, 80);
  const nim = sanitizeText(b.nim, 40);
  const kelas = sanitizeText(b.kelas, 40);

  if (!nama || !nim) {
    return sendJson(ctx.res, 400, { error: 'Nama dan NIM wajib diisi.' });
  }
  if (
    config.registration.require_access_code &&
    sanitizeText(b.access_code, 60) !== config.registration.access_code
  ) {
    return sendJson(ctx.res, 403, { error: 'Kode akses salah. Tanyakan ke pengawas.' });
  }

  const identityKey = ('nim:' + nim).toLowerCase();
  const existing = store.findByIdentity(identityKey);

  if (existing) {
    if (existing.status === 'disqualified') {
      return sendJson(ctx.res, 403, {
        error: 'Sesi kamu dihentikan panitia. Hubungi pengawas.',
      });
    }
    if (!config.registration.allow_relogin) {
      return sendJson(ctx.res, 403, {
        error: 'NIM ini sudah terdaftar. Hubungi pengawas.',
      });
    }
    // Login ulang (laptop restart / WiFi putus): lanjutkan attempt yang sama,
    // termasuk sisa waktunya. Timer TIDAK di-reset.
    store.logEvent('relogin', { sid: existing.sid, ip: clientIp(ctx.req) });
    return sendJson(ctx.res, 200, { sid: existing.sid, state: publicState(existing) });
  }

  const attempt = createAttempt({ nama, nim, kelas }, identityKey, {
    ip: clientIp(ctx.req),
    userAgent: String(ctx.req.headers['user-agent'] || '').slice(0, 200),
  });
  sendJson(ctx.res, 200, { sid: attempt.sid, state: publicState(attempt) });
});

router.on('GET', '/api/state', (ctx) => {
  const attempt = auth(ctx);
  if (!attempt) return;
  sendJson(ctx.res, 200, { state: publicState(attempt) });
});

router.on('POST', '/api/answer', (ctx) => {
  const attempt = auth(ctx);
  if (!attempt) return;
  if (!requireOpen(ctx, attempt)) return;

  const qid = sanitizeText(ctx.body.qid, 40);
  const choice = sanitizeText(ctx.body.choice, 2).toUpperCase();
  const question = attempt.tpks.questions.find((q) => q.qid === qid);
  if (!question) return sendJson(ctx.res, 400, { error: 'Soal tidak ditemukan.' });

  if (choice === '') {
    delete attempt.tpks.answers[qid];
  } else if (bank.LETTERS.slice(0, question.opts.length).includes(choice)) {
    attempt.tpks.answers[qid] = choice;
  } else {
    return sendJson(ctx.res, 400, { error: 'Pilihan jawaban tidak valid.' });
  }

  store.markDirty();
  sendJson(ctx.res, 200, {
    ok: true,
    answered_count: Object.keys(attempt.tpks.answers).length,
    remaining_ms: remainingMs(attempt),
  });
});

router.on('POST', '/api/cp/draft', (ctx) => {
  const attempt = auth(ctx);
  if (!attempt) return;
  if (!requireOpen(ctx, attempt)) return;

  const pid = sanitizeText(ctx.body.problem_id, 20);
  if (!attempt.cp.problem_ids.includes(pid)) {
    return sendJson(ctx.res, 400, { error: 'Soal tidak ada dalam paketmu.' });
  }
  attempt.cp.drafts[pid] = {
    language: sanitizeText(ctx.body.language, 20),
    code: String(ctx.body.code || '').slice(0, MAX_CODE_BYTES),
    saved_at: nowMs(),
  };
  store.markDirty();
  sendJson(ctx.res, 200, { ok: true, saved_at: attempt.cp.drafts[pid].saved_at });
});

function validateCodeRequest(ctx, attempt) {
  const pid = sanitizeText(ctx.body.problem_id, 20);
  if (!attempt.cp.problem_ids.includes(pid)) {
    sendJson(ctx.res, 400, { error: 'Soal tidak ada dalam paketmu.' });
    return null;
  }
  const problem = cpProblems(attempt).find((p) => p.id === pid);

  const language = sanitizeText(ctx.body.language, 20);
  if (!enabledLanguages.includes(language)) {
    sendJson(ctx.res, 400, { error: `Bahasa "${language}" tidak tersedia.` });
    return null;
  }
  const code = String(ctx.body.code || '');
  if (!code.trim()) {
    sendJson(ctx.res, 400, { error: 'Kode masih kosong.' });
    return null;
  }
  if (Buffer.byteLength(code) > MAX_CODE_BYTES) {
    sendJson(ctx.res, 413, { error: 'Kode terlalu panjang (maksimal 100 KB).' });
    return null;
  }
  return { problem, language, code };
}

/** Uji coba: hanya test case contoh, atau input bebas milik peserta. Tidak dinilai. */
router.on('POST', '/api/cp/run', async (ctx) => {
  const attempt = auth(ctx);
  if (!attempt) return;
  if (!requireOpen(ctx, attempt)) return;
  const v = validateCodeRequest(ctx, attempt);
  if (!v) return;

  const customInput = ctx.body.custom_input;
  if (typeof customInput === 'string' && customInput.length) {
    const result = await judge.runCustom({
      language: v.language,
      code: v.code,
      input: customInput.slice(0, 64 * 1024),
      timeLimitMs: v.problem.time_limit_ms,
    });
    return sendJson(ctx.res, 200, { mode: 'custom', result });
  }

  const result = await judge.evaluate({
    language: v.language,
    code: v.code,
    tests: v.problem.test_cases.filter((t) => t.is_sample),
    timeLimitMs: v.problem.time_limit_ms,
    revealIO: true,
  });
  store.logEvent('cp_run', {
    sid: attempt.sid,
    problem: v.problem.id,
    language: v.language,
    verdict: result.verdict,
  });
  sendJson(ctx.res, 200, { mode: 'sample', result });
});

/** Submit resmi: dijalankan terhadap SELURUH test case dan dinilai. */
router.on('POST', '/api/cp/submit', async (ctx) => {
  const attempt = auth(ctx);
  if (!attempt) return;
  if (!requireOpen(ctx, attempt)) return;
  const v = validateCodeRequest(ctx, attempt);
  if (!v) return;

  const list = (attempt.cp.submissions[v.problem.id] =
    attempt.cp.submissions[v.problem.id] || []);
  const limit = CP_SECTION.max_submissions_per_problem || 25;
  if (list.length >= limit) {
    return sendJson(ctx.res, 429, {
      error: `Batas ${limit} submit untuk soal ini sudah tercapai.`,
    });
  }

  const result = await judge.evaluate({
    language: v.language,
    code: v.code,
    tests: v.problem.test_cases,
    timeLimitMs: v.problem.time_limit_ms,
    revealIO: false,
  });

  list.push({
    at: nowMs(),
    language: v.language,
    code: v.code,
    verdict: result.verdict,
    passed: result.passed,
    total: result.total,
    max_time_ms: result.max_time_ms || 0,
    compile_output: result.compile_output || '',
  });
  recomputeScores(attempt);
  store.logEvent('cp_submit', {
    sid: attempt.sid,
    problem: v.problem.id,
    language: v.language,
    verdict: result.verdict,
    passed: result.passed,
    total: result.total,
  });

  // Peserta melihat ringkasan + detail test case contoh saja.
  const visible = CP_SECTION.show_hidden_test_detail
    ? result.results
    : result.results.map((r) =>
        r.is_sample ? r : { no: r.no, verdict: r.verdict, label: r.label, time_ms: r.time_ms }
      );

  sendJson(ctx.res, 200, {
    submission: {
      verdict: result.verdict,
      passed: result.passed,
      total: result.total,
      max_time_ms: result.max_time_ms,
      compile_output: result.compile_output,
      message: result.message,
      results: visible,
    },
    state: publicState(attempt),
  });
});

router.on('POST', '/api/finish', (ctx) => {
  const attempt = auth(ctx);
  if (!attempt) return;
  tick(attempt);
  finishExam(attempt, 'dikumpulkan peserta');
  sendJson(ctx.res, 200, { state: publicState(attempt) });
});

router.on('POST', '/api/violation', (ctx) => {
  const attempt = auth(ctx);
  if (!attempt) return;
  tick(attempt);
  if (!isOpen(attempt)) {
    return sendJson(ctx.res, 200, { ok: true, violation_count: attempt.violation_count });
  }

  const kind = sanitizeText(ctx.body.kind, 40) || 'unknown';
  const detail = sanitizeText(ctx.body.detail, 200);
  attempt.violations.push({ at: nowMs(), kind, detail });
  attempt.violation_count = attempt.violations.length;
  store.logEvent('violation', { sid: attempt.sid, kind, detail, count: attempt.violation_count });

  const max = config.lockdown.max_violations;
  let forced = false;
  if (config.lockdown.auto_submit_on_max_violations && max > 0 && attempt.violation_count >= max) {
    finishExam(attempt, 'melebihi batas pelanggaran lockdown');
    forced = true;
  }

  store.markDirty();
  sendJson(ctx.res, 200, {
    ok: true,
    violation_count: attempt.violation_count,
    max_violations: max,
    forced_finish: forced,
    status: attempt.status,
  });
});

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------
router.on('GET', '/api/admin/overview', (ctx) => {
  if (!requireAdmin(ctx)) return;
  const now = nowMs();

  const rows = store.allAttempts().map((a) => {
    tick(a);
    // Selalu hitung ulang: dengan timer global tidak ada lagi event "kumpulkan
    // bagian" yang memicu perhitungan, sehingga nilai yang di-cache akan
    // tertinggal dan pengawas melihat angka basi selama ujian berjalan.
    recomputeScores(a);
    const problems = cpProblems(a);
    return {
      sid: a.sid,
      participant: a.participant,
      status: a.status,
      finish_reason: a.finish_reason,
      ip: a.ip,
      created_at: a.created_at,
      enrolled_at: a.enrolled_at,
      ends_at: deadline(a),
      remaining_ms: remainingMs(a),
      online: now - (a.last_seen || 0) < 25000,
      last_seen_ago_ms: now - (a.last_seen || 0),
      violation_count: a.violation_count,
      last_violation: a.violations.length ? a.violations[a.violations.length - 1] : null,
      tpks_progress: `${Object.keys(a.tpks.answers).length}/${a.tpks.questions.length}`,
      cp_problem_ids: a.cp.problem_ids,
      cp_detail: problems.map((p) => {
        const best = (a.scores.cp.per_problem || []).find((x) => x.problem_id === p.id) || {};
        return {
          id: p.id,
          passed: best.passed || 0,
          total: p.test_cases.length,
          attempts: best.attempts || 0,
          solved: !!best.solved,
        };
      }),
      scores: a.scores,
      final: a.final,
    };
  });

  rows.sort((x, y) => (x.participant.nama || '').localeCompare(y.participant.nama || ''));

  sendJson(ctx.res, 200, {
    exam_title: config.exam_title,
    server_time: now,
    duration_min: EXAM.duration_min,
    parts: [
      { id: 'tpks', name: TPKS_SECTION.name, weight: TPKS_SECTION.weight },
      { id: 'cp', name: CP_SECTION.name, weight: CP_SECTION.weight },
    ],
    cp_pool: CP_POOL,
    cp_problem_count: CP_SECTION.problem_count,
    languages: judge.languageInfo(),
    max_violations: config.lockdown.max_violations,
    attempts: rows,
    summary: {
      total: rows.length,
      active: rows.filter((r) => r.status === 'active').length,
      finished: rows.filter((r) => r.status === 'finished').length,
      disqualified: rows.filter((r) => r.status === 'disqualified').length,
      flagged: rows.filter((r) => r.violation_count > 0).length,
    },
  });
});

router.on('GET', '/api/admin/attempt', (ctx) => {
  if (!requireAdmin(ctx)) return;
  const a = store.getAttempt(String(ctx.query.sid || ''));
  if (!a) return sendJson(ctx.res, 404, { error: 'Attempt tidak ditemukan.' });
  tick(a);
  recomputeScores(a);

  sendJson(ctx.res, 200, {
    sid: a.sid,
    participant: a.participant,
    status: a.status,
    finish_reason: a.finish_reason,
    ip: a.ip,
    user_agent: a.user_agent,
    created_at: a.created_at,
    enrolled_at: a.enrolled_at,
    ends_at: deadline(a),
    remaining_ms: remainingMs(a),
    violations: a.violations,
    scores: a.scores,
    final: a.final,
    tpks: a.tpks.questions.map((q) => ({
      no: q.no,
      qid: q.qid,
      type: q.type,
      q: q.q,
      opts: q.opts,
      correct: q.ans,
      picked: a.tpks.answers[q.qid] || null,
      is_correct: a.tpks.answers[q.qid] === q.ans,
      exp: q.exp,
    })),
    cp: cpProblems(a).map((p) => ({
      problem_id: p.id,
      title: p.title,
      total_tests: p.test_cases.length,
      submissions: (a.cp.submissions[p.id] || []).map((s) => ({
        at: s.at,
        language: s.language,
        verdict: s.verdict,
        passed: s.passed,
        total: s.total,
        max_time_ms: s.max_time_ms,
        code: s.code,
      })),
      draft: a.cp.drafts[p.id] || null,
    })),
  });
});

router.on('POST', '/api/admin/action', (ctx) => {
  if (!requireAdmin(ctx)) return;
  const action = sanitizeText(ctx.body.action, 30);
  const sid = sanitizeText(ctx.body.sid, 60);

  if (action === 'reset_all') {
    store.resetAll();
    store.logEvent('admin_reset_all', {});
    return sendJson(ctx.res, 200, { ok: true });
  }

  const a = store.getAttempt(sid);
  if (!a) return sendJson(ctx.res, 404, { error: 'Attempt tidak ditemukan.' });

  switch (action) {
    case 'extend': {
      const minutes = clampInt(ctx.body.minutes, 1, 240, 5);
      a.extra_ms = (a.extra_ms || 0) + minutes * 60000;
      store.logEvent('admin_extend', { sid, minutes });
      break;
    }
    case 'clear_violations':
      a.violations = [];
      a.violation_count = 0;
      store.logEvent('admin_clear_violations', { sid });
      break;
    case 'force_finish':
      finishExam(a, 'dihentikan panitia');
      break;
    case 'disqualify':
      finishExam(a, 'didiskualifikasi');
      a.status = 'disqualified';
      store.logEvent('admin_disqualify', { sid });
      break;
    case 'reopen': {
      // Buka kembali ujian (mis. laptop peserta mati atau WiFi putus lama).
      const minutes = clampInt(ctx.body.minutes, 1, 240, 10);
      a.status = 'active';
      a.finished_at = null;
      a.finish_reason = null;
      // Beri sisa waktu persis `minutes` dari sekarang, apa pun kondisi
      // deadline lamanya.
      a.extra_ms = nowMs() + minutes * 60000 - a.enrolled_at - DURATION_MS;
      store.logEvent('admin_reopen', { sid, minutes });
      break;
    }
    default:
      return sendJson(ctx.res, 400, { error: 'Aksi tidak dikenal.' });
  }

  recomputeScores(a);
  store.markDirty();
  sendJson(ctx.res, 200, { ok: true });
});

router.on('GET', '/api/admin/export.csv', (ctx) => {
  if (!requireAdmin(ctx)) return;
  const count = CP_SECTION.problem_count;

  const header = ['nama', 'nim', 'kelas', 'status', 'pelanggaran', 'tpks_benar', 'tpks_total', 'tpks_persen'];
  for (let i = 1; i <= count; i++) {
    header.push(`cp${i}_soal`, `cp${i}_lulus`, `cp${i}_persen`);
  }
  header.push('cp_solved', 'cp_persen', 'nilai_akhir', 'ip', 'enroll', 'alasan_selesai');

  const rows = store.allAttempts().map((a) => {
    tick(a);
    recomputeScores(a);
    const t = a.scores.tpks;
    const c = a.scores.cp;
    const row = [
      a.participant.nama,
      a.participant.nim,
      a.participant.kelas,
      a.status,
      a.violation_count,
      t.correct,
      t.total,
      t.percent,
    ];
    for (let i = 0; i < count; i++) {
      const p = (c.per_problem || [])[i];
      row.push(p ? p.problem_id : '', p ? `${p.passed}/${p.total}` : '', p ? p.percent : '');
    }
    row.push(
      c.solved_count,
      c.percent,
      a.final ? a.final.total : 0,
      a.ip,
      new Date(a.enrolled_at).toISOString(),
      a.finish_reason || ''
    );
    return row;
  });

  // Urutkan dari nilai akhir tertinggi.
  const finalIdx = header.indexOf('nilai_akhir');
  rows.sort((x, y) => Number(y[finalIdx]) - Number(x[finalIdx]));

  const csv = [header, ...rows]
    .map((r) => r.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n');

  ctx.res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="hasil-ujian-${Date.now()}.csv"`,
    'Cache-Control': 'no-store',
  });
  ctx.res.end('\ufeff' + csv); // BOM supaya Excel membaca UTF-8 dengan benar
});

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  try {
    const handled = await router.handle(req, res);
    if (handled) return;

    if (req.method === 'GET' || req.method === 'HEAD') {
      const pathname = req.url.split('?')[0];
      if (serveStatic(PUBLIC_DIR, pathname, res)) return;
    }
    sendText(res, 404, 'Not found');
  } catch (err) {
    console.error('[server]', err);
    if (!res.headersSent) sendJson(res, 500, { error: err.message || 'Kesalahan server' });
  }
});

function localIps() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const nic of list || []) {
      if (nic.family === 'IPv4' && !nic.internal) out.push(nic.address);
    }
  }
  return out;
}

server.listen(config.port, config.host, () => {
  const ips = localIps();
  const bar = '-'.repeat(66);
  const tpksCount = Object.values(TPKS_SECTION.composition || {}).reduce((a, b) => a + b, 0);

  console.log(bar);
  console.log(config.exam_title);
  console.log(bar);
  console.log(
    'Peserta  : ' +
      (ips.map((ip) => `http://${ip}:${config.port}`).join('  ') ||
        `http://localhost:${config.port}`)
  );
  console.log(`Pengawas : http://${ips[0] || 'localhost'}:${config.port}/admin.html`);
  console.log(
    'Kode akses : ' +
      (config.registration.require_access_code ? config.registration.access_code : '(tidak dipakai)')
  );
  console.log('Kunci admin: ' + config.admin_key);
  console.log(bar);
  console.log(`Durasi   : ${EXAM.duration_min} menit, mulai saat peserta enroll`);
  console.log(`Soal     : ${tpksCount} TPKS + ${CP_SECTION.problem_count} CP (acak per peserta)`);
  console.log(`Pool CP  : ${CP_POOL.join(', ')}`);
  console.log(`Bobot    : TPKS ${TPKS_SECTION.weight} / CP ${CP_SECTION.weight}`);
  console.log(`Bahasa   : ${judge.languageInfo().map((l) => l.label).join(', ')}`);
  if (!enabledLanguages.length) {
    console.log('PERINGATAN: tidak ada bahasa pemrograman aktif untuk bagian CP!');
  }
  if (config.admin_key.startsWith('GANTI')) {
    console.log(bar);
    console.log('PERINGATAN: ganti "admin_key" di config.json sebelum ujian.');
  }
  console.log(bar);
});
