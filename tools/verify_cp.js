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

  // --- Uji asap setiap bahasa ------------------------------------------
  // Memastikan setiap bahasa yang terdeteksi benar-benar bisa compile,
  // membaca stdin, dan mencetak jawaban yang cocok. Deteksi versi saja tidak
  // cukup: `javac -version` bisa berhasil padahal JDK-nya rusak, dan pola
  // pembacaan input (scanf vs BufferedReader) baru terbukti saat dijalankan.
  console.log('');
  console.log('Uji asap per bahasa (E-001 penjumlahan, E-003 nilai tertinggi):');

  const SMOKE = {
    python: {
      'E-001': 'a, b = map(int, input().split())\nprint(a + b)',
      'E-003': 'input()\nprint(max(map(int, input().split())))',
    },
    c: {
      'E-001':
        '#include <stdio.h>\n' +
        'int main(void) {\n' +
        '    long long a, b;\n' +
        '    if (scanf("%lld %lld", &a, &b) != 2) return 1;\n' +
        '    printf("%lld\\n", a + b);\n' +
        '    return 0;\n}\n',
      'E-003':
        '#include <stdio.h>\n' +
        'int main(void) {\n' +
        '    int n;\n' +
        '    if (scanf("%d", &n) != 1) return 1;\n' +
        '    long long best = 0, x;\n' +
        '    for (int i = 0; i < n; i++) {\n' +
        '        if (scanf("%lld", &x) != 1) return 1;\n' +
        '        if (i == 0 || x > best) best = x;\n' +
        '    }\n' +
        '    printf("%lld\\n", best);\n' +
        '    return 0;\n}\n',
    },
    cpp: {
      'E-001':
        '#include <bits/stdc++.h>\nusing namespace std;\n' +
        'int main(){ long long a,b; cin>>a>>b; cout<<a+b<<"\\n"; }\n',
      'E-003':
        '#include <bits/stdc++.h>\nusing namespace std;\n' +
        'int main(){ int n; cin>>n; long long b=LLONG_MIN,x; while(n--){cin>>x; b=max(b,x);} cout<<b<<"\\n"; }\n',
    },
    java: {
      'E-001':
        'import java.io.*;\nimport java.util.*;\n' +
        'public class Main {\n' +
        '    public static void main(String[] args) throws IOException {\n' +
        '        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));\n' +
        '        StringTokenizer st = new StringTokenizer(br.readLine());\n' +
        '        long a = Long.parseLong(st.nextToken());\n' +
        '        long b = Long.parseLong(st.nextToken());\n' +
        '        System.out.println(a + b);\n' +
        '    }\n}\n',
      'E-003':
        'import java.io.*;\n' +
        'public class Main {\n' +
        '    public static void main(String[] args) throws IOException {\n' +
        '        StreamTokenizer in = new StreamTokenizer(new BufferedInputStream(System.in));\n' +
        '        in.nextToken();\n' +
        '        int n = (int) in.nval;\n' +
        '        long best = Long.MIN_VALUE;\n' +
        '        for (int i = 0; i < n; i++) {\n' +
        '            in.nextToken();\n' +
        '            long v = (long) in.nval;\n' +
        '            if (v > best) best = v;\n' +
        '        }\n' +
        '        System.out.println(best);\n' +
        '    }\n}\n',
    },
    javascript: {
      'E-001':
        "const d = require('fs').readFileSync(0, 'utf8').split(/\\s+/).filter(Boolean);\n" +
        'console.log(String(BigInt(d[0]) + BigInt(d[1])));\n',
      'E-003':
        "const d = require('fs').readFileSync(0, 'utf8').split(/\\s+/).filter(Boolean);\n" +
        'const n = Number(d[0]);\nlet best = -Infinity;\n' +
        'for (let i = 1; i <= n; i++) best = Math.max(best, Number(d[i]));\n' +
        'console.log(String(best));\n',
    },
  };

  for (const langId of Object.keys(langs)) {
    const solutions = SMOKE[langId];
    if (!solutions) {
      console.log(`  SKIP  ${langId.padEnd(11)} belum ada solusi uji asap`);
      continue;
    }
    for (const [pid, code] of Object.entries(solutions)) {
      const p = bank.problems.find((x) => x.id === pid);
      const res = await judge.evaluate({
        language: langId,
        code,
        tests: p.test_cases,
        timeLimitMs: p.time_limit_ms,
        revealIO: true,
      });
      const good = res.verdict === 'AC' && res.passed === res.total;
      if (!good) fail++;
      console.log(
        `  ${good ? 'PASS' : 'FAIL'}  ${langId.padEnd(11)} ${pid}  ` +
          `${res.passed}/${res.total} tc  ${res.max_time_ms}ms ` +
          `(batas ${res.time_limit_ms}ms)  ${good ? '' : '<-- ' + res.verdict}`
      );
      if (!good) {
        if (res.compile_output) console.log('        compile:', res.compile_output.slice(0, 400));
        if (res.message) console.log('        pesan  :', res.message);
        const bad = res.results.find((r) => r.verdict !== 'AC');
        if (bad) {
          console.log('        test', bad.no, bad.verdict);
          console.log('          expected:', JSON.stringify(String(bad.expected).slice(0, 80)));
          console.log('          got     :', JSON.stringify(String(bad.got).slice(0, 80)));
          if (bad.stderr) console.log('          stderr  :', bad.stderr.slice(0, 300));
        }
      }
    }
  }

  console.log('');
  if (fail) {
    console.log(`HASIL: ${fail} masalah ditemukan.`);
    process.exit(1);
  }
  console.log('HASIL: semua pemeriksaan bank soal CP lulus.');
})();
