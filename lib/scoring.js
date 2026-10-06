'use strict';
/** Perhitungan nilai. Dipisah agar mudah diubah panitia tanpa menyentuh server. */

function gradeTpks(sectionState) {
  const questions = sectionState.questions || [];
  const answers = sectionState.answers || {};
  let correct = 0;
  let answered = 0;
  const perType = {};

  for (const q of questions) {
    const picked = answers[q.qid];
    if (picked) answered++;
    const bucket = (perType[q.type] = perType[q.type] || { correct: 0, total: 0 });
    bucket.total++;
    if (picked && picked === q.ans) {
      correct++;
      bucket.correct++;
    }
  }

  const total = questions.length;
  return {
    correct,
    wrong: answered - correct,
    blank: total - answered,
    total,
    percent: total ? round2((correct / total) * 100) : 0,
    per_type: perType,
  };
}

function gradeCp(sectionState, problems) {
  const subs = sectionState.submissions || {};
  const perProblem = [];
  let sum = 0;

  for (const p of problems) {
    const list = subs[p.id] || [];
    let best = { passed: 0, total: p.test_cases.length, percent: 0, verdict: '-', attempts: list.length };
    for (const s of list) {
      const percent = s.total ? (s.passed / s.total) * 100 : 0;
      if (percent > best.percent) {
        best = {
          passed: s.passed,
          total: s.total,
          percent,
          verdict: s.verdict,
          language: s.language,
          at: s.at,
          attempts: list.length,
        };
      }
    }
    best.percent = round2(best.percent);
    best.problem_id = p.id;
    best.title = p.title;
    best.solved = best.total > 0 && best.passed === best.total;
    perProblem.push(best);
    sum += best.percent;
  }

  return {
    per_problem: perProblem,
    solved_count: perProblem.filter((p) => p.solved).length,
    problem_count: problems.length,
    percent: problems.length ? round2(sum / problems.length) : 0,
  };
}

function finalScore(scores, sections) {
  let total = 0;
  let weightSum = 0;
  const parts = {};
  for (const section of sections) {
    const s = scores[section.id];
    const weight = typeof section.weight === 'number' ? section.weight : 1;
    const percent = s ? s.percent : 0;
    parts[section.id] = { percent, weight };
    total += percent * weight;
    weightSum += weight;
  }
  return {
    parts,
    total: weightSum ? round2(total / weightSum) : 0,
  };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

module.exports = { gradeTpks, gradeCp, finalScore, round2 };
