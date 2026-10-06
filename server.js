#!/usr/bin/env node
'use strict';
/**
 * Server ujian LAN -- TPKS + Competitive Programming.
 *
 * Jalankan:  node server.js
 * Peserta:   http://<IP-laptop-panitia>:3000
 * Pengawas:  http://<IP-laptop-panitia>:3000/admin.html
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
const SECTIONS = config.sections;
const SECTION_BY_ID = new Map(SECTIONS.map((s) => [s.id, s]));

const MAX_CODE_BYTES = 100 * 1024;

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------
bank.load();
store.init();
const languages = judge.detect(config.judge);

// Problem CP dimuat sekali -- sama untuk semua peserta agar adil dan agar
// nilai bisa dibandingkan langsung antar peserta.
const cpSection = SECTIONS.find((s) => s.type === 'code');
const CP_PROBLEMS = cpSection ? bank.getCpProblems(cpSection) : [];
const CP_BY_ID = new Map(CP_PROBLEMS.map((p) => [p.id, p]));

const enabledLanguages = (cpSection ? cpSection.languages : []).filter((l) =>
  judge.isAvailable(l)
);

// ---------------------------------------------------------------------------
// Util attempt
// ---------------------------------------------------------------------------
function emptySectionState(section) {
  const base = {
    id: section.id,
    status: 'ready',
    started_at: null,
    ends_at: null,
    extra_ms: 0,
    finished_at: null,
    finish_reason: null,
  };
  if (section.type === 'mcq') return { ...base, questions: [], answers: {} };
  return { ...base, submissions: {}, drafts: {} };
}

function createAttempt(participant, identityKey, meta) {
  const sid = randomId(18);
  const attempt = {
    sid,
    identity_key: identityKey,
    participant,
    created_at: new Date().toISOString(),
    last_seen: nowMs(),
    ip: meta.ip,
    user_agent: meta.userAgent,
    status: 'ready',
    sections: {},
    violations: [],
    violation_count: 0,
    scores: null,
    final: null,
  };

  for (const section of SECTIONS) {
    attempt.sections[section.id] = emptySectionState(section);
  }

  // Paket soal TPKS dibuat sekali saat registrasi dan disimpan apa adanya,
  // sehingga reload/ganti perangkat tidak mengubah soal maupun kunci.
  const mcq = SECTIONS.find((s) => s.type === 'mcq');
  if (mcq) {
    const built = bank.buildTpksQuestions(mcq, sid + '|' + identityKey);
    attempt.sections[mcq.id].questions = built.questions;
    if (built.warnings.length) {
      console.warn('[bank] ' + built.warnings.join(' '));
    }
  }

  store.putAttempt(attempt);
  store.logEvent('register', { sid, participant, ip: meta.ip });
  return attempt;
}

function sectionDeadline(sectionState, section) {
  if (!sectionState.started_at) return null;
  return sectionState.started_at + section.duration_min * 60000 + (sectionState.extra_ms || 0);
}

function remainingMs(sectionState, section) {
  const deadline = sectionDeadline(sectionState, section);
  if (!deadline) return section.duration_min * 60000;
  return Math.max(0, deadline - nowMs());
}

function finishSection(attempt, section, reason) {
  const st = attempt.sections[section.id];
  if (st.status === 'finished') return;
  st.status = 'finished';
  st.finished_at = nowMs();
  st.finish_reason = reason;
  store.logEvent('section_finish', {
    sid: attempt.sid,
    section: section.id,
    reason,
  });
  recomputeScores(attempt);
  maybeFinishAttempt(attempt);
  store.markDirty();
}

function maybeFinishAttempt(attempt) {
  const allDone = SECTIONS.every((s) => attempt.sections[s.id].status === 'finished');
  if (allDone && attempt.status !== 'finished' && attempt.status !== 'disqualified') {
    attempt.status = 'finished';
    attempt.finished_at = nowMs();
    recomputeScores(attempt);
    store.logEvent('attempt_finish', { sid: attempt.sid, final: attempt.final });
  }
}

function recomputeScores(attempt) {
  const scores = {};
  for (const section of SECTIONS) {
    const st = attempt.sections[section.id];
    if (section.type === 'mcq') scores[section.id] = scoring.gradeTpks(st);
    else scores[section.id] = scoring.gradeCp(st, CP_PROBLEMS);
  }
  attempt.scores = scores;
  attempt.final = scoring.finalScore(scores, SECTIONS);
  store.markDirty();
}

/** Dipanggil di setiap request: tegakkan batas waktu di sisi server. */
function tick(attempt) {
  for (const section of SECTIONS) {
    const st = attempt.sections[section.id];
    if (st.status === 'active' && remainingMs(st, section) <= 0) {
      finishSection(attempt, section, 'waktu habis');
    }
  }
  maybeFinishAttempt(attempt);
}

function currentSectionId(attempt) {
  for (const section of SECTIONS) {
    if (attempt.sections[section.id].status !== 'finished') return section.id;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Serialisasi state untuk peserta (tanpa kunci jawaban!)
// ---------------------------------------------------------------------------
function publicState(attempt) {
  tick(attempt);
  attempt.last_seen = nowMs();
  store.markDirty();

  const sections = SECTIONS.map((section) => {
    const st = attempt.sections[section.id];
    const out = {
      id: section.id,
      name: section.name,
      full_name: section.full_name,
      type: section.type,
      duration_min: section.duration_min,
      status: st.status,
      remaining_ms: st.status === 'active' ? remainingMs(st, section) : null,
      started_at: st.started_at,
      finished_at: st.finished_at,
      finish_reason: st.finish_reason,
      weight: section.weight,
    };

    if (section.type === 'mcq') {
      out.allow_back = section.allow_back !== false;
      out.question_count = st.questions.length;
      // Kunci jawaban (ans) dan pembahasan (exp) sengaja TIDAK dikirim.
      out.questions =
        st.status === 'active'
          ? st.questions.map((q) => ({ no: q.no, qid: q.qid, type: q.type, q: q.q, opts: q.opts }))
          : [];
      out.answers = st.answers;
      out.answered_count = Object.keys(st.answers).length;
    } else {
      out.languages = enabledLanguages.map((id) => {
        const info = judge.languageInfo().find((l) => l.id === id);
        return { id, label: info ? info.label : id, version: info ? info.version : '' };
      });
      out.max_submissions_per_problem = section.max_submissions_per_problem;
      out.problems =
        st.status === 'active' ? CP_PROBLEMS.map((p, i) => bank.publicProblem(p, i)) : [];
      out.drafts = st.drafts;
      out.starter_code = bank.starterCode();
      out.progress = CP_PROBLEMS.map((p) => {
        const list = st.submissions[p.id] || [];
        const best = list.reduce(
          (acc, s) => (s.passed / (s.total || 1) > acc.ratio ? { ratio: s.passed / (s.total || 1), s } : acc),
          { ratio: -1, s: null }
        );
        return {
          problem_id: p.id,
          attempts: list.length,
          best_passed: best.s ? best.s.passed : 0,
          total_tests: p.test_cases.length,
          solved: best.s ? best.s.passed === best.s.total : false,
          last_verdict: list.length ? list[list.length - 1].verdict : null,
        };
      });
      out.submissions = Object.fromEntries(
        Object.entries(st.submissions).map(([pid, list]) => [
          pid,
          list.map((s) => ({
            at: s.at,
            language: s.language,
            verdict: s.verdict,
            passed: s.passed,
            total: s.total,
            max_time_ms: s.max_time_ms,
          })),
        ])
      );
    }
    return out;
  });

  return {
    sid: attempt.sid,
    participant: attempt.participant,
    status: attempt.status,
    current_section: currentSectionId(attempt),
    sections,
    violation_count: attempt.violation_count,
    max_violations: config.lockdown.max_violations,
    lockdown: config.lockdown,
    result:
      attempt.status === 'finished' || attempt.status === 'disqualified'
        ? buildResult(attempt)
        : null,
  };
}

function buildResult(attempt) {
  const out = {
    status: attempt.status,
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
    registration: {
      fields: config.registration.fields,
      require_access_code: !!config.registration.require_access_code,
    },
    sections: SECTIONS.map((s) => ({
      id: s.id,
      name: s.name,
      full_name: s.full_name,
      type: s.type,
      duration_min: s.duration_min,
      weight: s.weight,
      question_count:
        s.type === 'mcq'
          ? Object.values(s.composition || {}).reduce((a, b) => a + b, 0)
          : (s.problem_ids || []).length,
    })),
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
    if (!config.registration.allow_relogin && existing.status !== 'ready') {
      return sendJson(ctx.res, 403, {
        error: 'NIM ini sudah memulai ujian. Hubungi pengawas.',
      });
    }
    // Login ulang (laptop restart / WiFi putus): lanjutkan attempt yang sama.
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

router.on('POST', '/api/section/start', (ctx) => {
  const attempt = auth(ctx);
  if (!attempt) return;
  tick(attempt);

  if (attempt.status === 'disqualified') {
    return sendJson(ctx.res, 403, { error: 'Sesi kamu dihentikan panitia.' });
  }

  const section = SECTION_BY_ID.get(String(ctx.body.section));
  if (!section) return sendJson(ctx.res, 400, { error: 'Sesi ujian tidak dikenal.' });

  // Bagian harus dikerjakan berurutan.
  if (currentSectionId(attempt) !== section.id) {
    return sendJson(ctx.res, 409, {
      error: 'Belum waktunya membuka bagian ini. Selesaikan bagian sebelumnya dulu.',
    });
  }

  const st = attempt.sections[section.id];
  if (st.status === 'ready') {
    st.status = 'active';
    st.started_at = nowMs();
    st.ends_at = sectionDeadline(st, section);
    attempt.status = 'active';
    store.logEvent('section_start', { sid: attempt.sid, section: section.id });
    store.markDirty();
  }
  sendJson(ctx.res, 200, { state: publicState(attempt) });
});

router.on('POST', '/api/section/finish', (ctx) => {
  const attempt = auth(ctx);
  if (!attempt) return;
  tick(attempt);
  const section = SECTION_BY_ID.get(String(ctx.body.section));
  if (!section) return sendJson(ctx.res, 400, { error: 'Sesi ujian tidak dikenal.' });
  finishSection(attempt, section, 'dikumpulkan peserta');
  sendJson(ctx.res, 200, { state: publicState(attempt) });
});

router.on('POST', '/api/answer', (ctx) => {
  const attempt = auth(ctx);
  if (!attempt) return;
  tick(attempt);

  const section = SECTIONS.find((s) => s.type === 'mcq');
  const st = attempt.sections[section.id];
  if (st.status !== 'active') {
    return sendJson(ctx.res, 409, { error: 'Bagian TPKS sudah ditutup.' });
  }

  const qid = sanitizeText(ctx.body.qid, 40);
  const choice = sanitizeText(ctx.body.choice, 2).toUpperCase();
  const question = st.questions.find((q) => q.qid === qid);
  if (!question) return sendJson(ctx.res, 400, { error: 'Soal tidak ditemukan.' });

  if (choice === '') {
    delete st.answers[qid];
  } else if (bank.LETTERS.slice(0, question.opts.length).includes(choice)) {
    st.answers[qid] = choice;
  } else {
    return sendJson(ctx.res, 400, { error: 'Pilihan jawaban tidak valid.' });
  }

  store.markDirty();
  sendJson(ctx.res, 200, {
    ok: true,
    answered_count: Object.keys(st.answers).length,
    remaining_ms: remainingMs(st, section),
  });
});

router.on('POST', '/api/cp/draft', (ctx) => {
  const attempt = auth(ctx);
  if (!attempt) return;
  tick(attempt);
  const st = attempt.sections[cpSection.id];
  if (st.status !== 'active') {
    return sendJson(ctx.res, 409, { error: 'Bagian CP sudah ditutup.' });
  }
  const pid = sanitizeText(ctx.body.problem_id, 20);
  if (!CP_BY_ID.has(pid)) return sendJson(ctx.res, 400, { error: 'Soal tidak ditemukan.' });
  const code = String(ctx.body.code || '').slice(0, MAX_CODE_BYTES);
  st.drafts[pid] = {
    language: sanitizeText(ctx.body.language, 20),
    code,
    saved_at: nowMs(),
  };
  store.markDirty();
  sendJson(ctx.res, 200, { ok: true, saved_at: st.drafts[pid].saved_at });
});

function validateCodeRequest(ctx, attempt) {
  const st = attempt.sections[cpSection.id];
  if (st.status !== 'active') {
    sendJson(ctx.res, 409, { error: 'Bagian CP sudah ditutup.' });
    return null;
  }
  const pid = sanitizeText(ctx.body.problem_id, 20);
  const problem = CP_BY_ID.get(pid);
  if (!problem) {
    sendJson(ctx.res, 400, { error: 'Soal tidak ditemukan.' });
    return null;
  }
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
  return { st, problem, language, code };
}

/** Uji coba: hanya test case contoh, atau input bebas milik peserta. Tidak dinilai. */
router.on('POST', '/api/cp/run', async (ctx) => {
  const attempt = auth(ctx);
  if (!attempt) return;
  tick(attempt);
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

  const samples = v.problem.test_cases.filter((t) => t.is_sample);
  const result = await judge.evaluate({
    language: v.language,
    code: v.code,
    tests: samples,
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
  tick(attempt);
  const v = validateCodeRequest(ctx, attempt);
  if (!v) return;

  const list = (v.st.submissions[v.problem.id] = v.st.submissions[v.problem.id] || []);
  const limit = cpSection.max_submissions_per_problem || 25;
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

  const record = {
    at: nowMs(),
    language: v.language,
    code: v.code,
    verdict: result.verdict,
    passed: result.passed,
    total: result.total,
    max_time_ms: result.max_time_ms || 0,
    compile_output: result.compile_output || '',
  };
  list.push(record);
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
  const visible = cpSection.show_hidden_test_detail
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

router.on('POST', '/api/violation', (ctx) => {
  const attempt = auth(ctx);
  if (!attempt) return;
  tick(attempt);
  if (attempt.status === 'finished' || attempt.status === 'disqualified') {
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
    for (const section of SECTIONS) {
      if (attempt.sections[section.id].status === 'active') {
        finishSection(attempt, section, 'melebihi batas pelanggaran lockdown');
      }
    }
    for (const section of SECTIONS) {
      const st = attempt.sections[section.id];
      if (st.status === 'ready') {
        st.status = 'finished';
        st.finished_at = nowMs();
        st.finish_reason = 'dibatalkan: batas pelanggaran terlampaui';
      }
    }
    maybeFinishAttempt(attempt);
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
    const sections = {};
    for (const section of SECTIONS) {
      const st = a.sections[section.id];
      sections[section.id] = {
        status: st.status,
        remaining_ms: st.status === 'active' ? remainingMs(st, section) : null,
        finish_reason: st.finish_reason,
        progress:
          section.type === 'mcq'
            ? `${Object.keys(st.answers || {}).length}/${(st.questions || []).length}`
            : `${(a.scores && a.scores[section.id] ? a.scores[section.id].solved_count : 0)}/${CP_PROBLEMS.length} solved`,
      };
    }
    return {
      sid: a.sid,
      participant: a.participant,
      status: a.status,
      ip: a.ip,
      created_at: a.created_at,
      online: now - (a.last_seen || 0) < 25000,
      last_seen_ago_ms: now - (a.last_seen || 0),
      violation_count: a.violation_count,
      last_violation: a.violations.length ? a.violations[a.violations.length - 1] : null,
      sections,
      scores: a.scores,
      final: a.final,
    };
  });

  rows.sort((x, y) => (x.participant.nama || '').localeCompare(y.participant.nama || ''));

  sendJson(ctx.res, 200, {
    exam_title: config.exam_title,
    server_time: now,
    sections: SECTIONS.map((s) => ({ id: s.id, name: s.name, type: s.type, duration_min: s.duration_min })),
    problems: CP_PROBLEMS.map((p) => ({ id: p.id, title: p.title, tests: p.test_cases.length })),
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

  const mcq = SECTIONS.find((s) => s.type === 'mcq');
  const detail = {
    sid: a.sid,
    participant: a.participant,
    status: a.status,
    ip: a.ip,
    user_agent: a.user_agent,
    created_at: a.created_at,
    violations: a.violations,
    scores: a.scores,
    final: a.final,
    tpks: mcq
      ? a.sections[mcq.id].questions.map((q) => ({
          no: q.no,
          qid: q.qid,
          type: q.type,
          q: q.q,
          opts: q.opts,
          correct: q.ans,
          picked: a.sections[mcq.id].answers[q.qid] || null,
          is_correct: a.sections[mcq.id].answers[q.qid] === q.ans,
          exp: q.exp,
        }))
      : [],
    cp: CP_PROBLEMS.map((p) => ({
      problem_id: p.id,
      title: p.title,
      submissions: (a.sections[cpSection.id].submissions[p.id] || []).map((s) => ({
        at: s.at,
        language: s.language,
        verdict: s.verdict,
        passed: s.passed,
        total: s.total,
        max_time_ms: s.max_time_ms,
        code: s.code,
      })),
      draft: a.sections[cpSection.id].drafts[p.id] || null,
    })),
  };
  sendJson(ctx.res, 200, detail);
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
      const minutes = clampInt(ctx.body.minutes, 1, 180, 5);
      const target = currentSectionId(a);
      if (!target) return sendJson(ctx.res, 409, { error: 'Semua bagian sudah selesai.' });
      a.sections[target].extra_ms = (a.sections[target].extra_ms || 0) + minutes * 60000;
      a.sections[target].ends_at = sectionDeadline(a.sections[target], SECTION_BY_ID.get(target));
      store.logEvent('admin_extend', { sid, section: target, minutes });
      break;
    }
    case 'clear_violations':
      a.violations = [];
      a.violation_count = 0;
      store.logEvent('admin_clear_violations', { sid });
      break;
    case 'force_finish':
      for (const section of SECTIONS) {
        if (a.sections[section.id].status !== 'finished') {
          finishSection(a, section, 'dihentikan panitia');
        }
      }
      break;
    case 'disqualify':
      for (const section of SECTIONS) {
        if (a.sections[section.id].status !== 'finished') {
          finishSection(a, section, 'didiskualifikasi');
        }
      }
      a.status = 'disqualified';
      store.logEvent('admin_disqualify', { sid });
      break;
    case 'reopen': {
      // Buka kembali bagian terakhir (mis. laptop peserta mati karena listrik).
      const minutes = clampInt(ctx.body.minutes, 1, 180, 10);
      const section = SECTIONS.slice().reverse().find((s) => a.sections[s.id].status === 'finished');
      if (!section) return sendJson(ctx.res, 409, { error: 'Tidak ada bagian untuk dibuka.' });
      const st = a.sections[section.id];
      st.status = 'active';
      st.finished_at = null;
      st.finish_reason = null;
      st.extra_ms = (st.extra_ms || 0) + minutes * 60000;
      st.ends_at = sectionDeadline(st, section);
      a.status = 'active';
      store.logEvent('admin_reopen', { sid, section: section.id, minutes });
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
  const mcq = SECTIONS.find((s) => s.type === 'mcq');

  const header = [
    'nama',
    'nim',
    'kelas',
    'status',
    'pelanggaran',
    'tpks_benar',
    'tpks_total',
    'tpks_persen',
    ...CP_PROBLEMS.map((p) => `cp_${p.id}_persen`),
    'cp_solved',
    'cp_persen',
    'nilai_akhir',
    'ip',
    'mulai',
  ];

  const rows = store.allAttempts().map((a) => {
    tick(a);
    recomputeScores(a);
    const t = a.scores[mcq.id] || {};
    const c = a.scores[cpSection.id] || {};
    const perProblem = new Map((c.per_problem || []).map((p) => [p.problem_id, p.percent]));
    return [
      a.participant.nama,
      a.participant.nim,
      a.participant.kelas,
      a.status,
      a.violation_count,
      t.correct ?? '',
      t.total ?? '',
      t.percent ?? '',
      ...CP_PROBLEMS.map((p) => perProblem.get(p.id) ?? 0),
      c.solved_count ?? 0,
      c.percent ?? 0,
      a.final ? a.final.total : 0,
      a.ip,
      a.created_at,
    ];
  });

  rows.sort((x, y) => Number(y[y.length - 3]) - Number(x[x.length - 3]));

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
  const line = '='.repeat(66);
  console.log(line);
  console.log('  ' + config.exam_title);
  console.log(line);
  console.log(`  Peserta  : ${ips.map((ip) => `http://${ip}:${config.port}`).join('  |  ') || `http://localhost:${config.port}`}`);
  console.log(`  Pengawas : ${(ips[0] ? `http://${ips[0]}` : 'http://localhost')}:${config.port}/admin.html`);
  console.log(`  Kode akses peserta : ${config.registration.require_access_code ? config.registration.access_code : '(tidak dipakai)'}`);
  console.log(`  Kunci admin        : ${config.admin_key}`);
  console.log(line);
  console.log(`  Bagian   : ${SECTIONS.map((s) => `${s.name} (${s.duration_min} menit)`).join(' -> ')}`);
  console.log(`  Soal CP  : ${CP_PROBLEMS.map((p) => p.id).join(', ')}`);
  console.log(`  Bahasa   : ${judge.languageInfo().map((l) => `${l.label} [${l.version}]`).join(', ')}`);
  if (!enabledLanguages.length) {
    console.log('  PERINGATAN: tidak ada bahasa pemrograman aktif untuk bagian CP!');
  }
  console.log(line);
  if (config.admin_key.startsWith('GANTI')) {
    console.log('  !! Ganti "admin_key" di config.json sebelum ujian berlangsung !!');
    console.log(line);
  }
});
