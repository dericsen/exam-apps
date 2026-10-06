#!/usr/bin/env node
'use strict';
/**
 * Verifikasi bank soal CP:
 *  1. Jalankan reference solution tiap soal lewat judge yang sama dengan yang
 *     dipakai peserta -> harus AC 100%.
 *  2. Jalankan solusi yang sengaja salah -> harus TIDAK AC (memastikan judge
 *     benar-benar membandingkan output, bukan selalu meloloskan).
 *
 * Jalankan: node tools/verify_cp.js
 */

const fs = require('fs');
const path = require('path');
const judge = require('../lib/judge');

const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8'));
const bankPath = path.join(__dirname, '..', 'data', 'cp-problems.json');
const bank = JSON.parse(fs.readFileSync(bankPath, 'utf8'));

(async function main() {
  const langs = judge.detect(config.judge);
  console.log('Bahasa terdeteksi:', Object.keys(langs).join(', '));
  console.log('');

  let fail = 0;
  let totalTests = 0;

  for (const p of bank.problems) {
    const ref = p.reference_solution;
    const res = await judge.evaluate({
      language: ref.language,
      code: ref.code,
      tests: p.test_cases,
      timeLimitMs: p.time_limit_ms,
      revealIO: true,
    });
    totalTests += res.total;

    const ok = res.verdict === 'AC' && res.passed === res.total;
    if (!ok) fail++;
    const slowest = Math.max(0, res.max_time_ms || 0);
    console.log(
      `${ok ? 'PASS' : 'FAIL'}  ${p.id}  ${p.title.padEnd(28)} ` +
        `${res.passed}/${res.total} tc  ${slowest}ms  ${ok ? '' : '<-- ' + res.verdict}`
    );

    if (!ok) {
      if (res.compile_output) console.log('   compile:', res.compile_output.slice(0, 300));
      for (const r of res.results.filter((x) => x.verdict !== 'AC').slice(0, 2)) {
        console.log(`   test ${r.no} ${r.verdict}`);
        console.log('     input    :', JSON.stringify(String(r.input).slice(0, 120)));
        console.log('     expected :', JSON.stringify(String(r.expected).slice(0, 120)));
        console.log('     got      :', JSON.stringify(String(r.got).slice(0, 120)));
        if (r.stderr) console.log('     stderr   :', r.stderr.slice(0, 200));
      }
    }
  }

  console.log('');
  console.log(`Reference solution: ${bank.problems.length - fail}/${bank.problems.length} soal AC`);
  console.log(`Total test case dieksekusi: ${totalTests}`);

  // --- Uji negatif: judge harus bisa menolak jawaban salah --------------
  console.log('');
  console.log('Uji negatif (judge harus MENOLAK solusi yang salah):');
  const negatives = [
    { id: 'E-001', label: 'selalu cetak 0', code: 'input()\nprint(0)' },
    { id: 'E-002', label: 'selalu GENAP', code: 'input()\nprint("GENAP")' },
    { id: 'E-007', label: 'TLE: loop tak berujung', code: 'while True:\n    pass' },
    { id: 'E-008', label: 'RTE: crash', code: 'raise SystemExit(1)' },
    { id: 'E-012', label: 'CE: sintaks rusak', language: 'cpp', code: 'int main( {' },
  ];

  for (const neg of negatives) {
    const p = bank.problems.find((x) => x.id === neg.id);
    const res = await judge.evaluate({
      language: neg.language || 'python',
      code: neg.code,
      tests: p.test_cases,
      timeLimitMs: p.time_limit_ms,
      revealIO: false,
    });
    const rejected = res.verdict !== 'AC';
    if (!rejected) fail++;
    console.log(
      `  ${rejected ? 'PASS' : 'FAIL'}  ${neg.id} ${neg.label.padEnd(24)} -> ${res.verdict} (${res.passed}/${res.total})`
    );
  }

  console.log('');
  if (fail) {
    console.log(`HASIL: ${fail} masalah ditemukan.`);
    process.exit(1);
  }
  console.log('HASIL: semua pemeriksaan bank soal CP lulus.');
})();
