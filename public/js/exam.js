/* Aplikasi ujian peserta: TPKS (pilihan ganda) + CP (editor kode + judge). */
(function () {
  'use strict';

  let state = null;
  let deadlineAt = null;      // timestamp lokal hasil sinkronisasi dengan server
  let tickTimer = null;
  let syncTimer = null;
  let armed = false;

  // --- state TPKS
  let tpksIndex = 0;

  // --- state CP
  let cpCurrent = null;
  let draftTimer = null;
  let judging = false;

  const $ = (id) => document.getElementById(id);
  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"]/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])
    );

  /** Format teks soal: escape dulu, lalu izinkan **tebal** dan `kode`. */
  function fmt(text) {
    return esc(text)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code class="mono">$1</code>');
  }

  function section(id) {
    return state.sections.find((s) => s.id === id);
  }
  function currentSection() {
    return state.current_section ? section(state.current_section) : null;
  }

  // =========================================================================
  // Bootstrap
  // =========================================================================
  async function init() {
    if (!API.getSid()) {
      location.replace('index.html');
      return;
    }

    API.onOffline(() => $('offlineBadge').classList.remove('hidden'));
    API.onOnline(() => $('offlineBadge').classList.add('hidden'));

    try {
      await sync();
    } catch (e) {
      $('gateMsg').textContent = '';
      showGateError(e.message + ' Pastikan WiFi tersambung, lalu muat ulang halaman.');
      return;
    }
    setupGate();
  }

  async function sync() {
    const res = await API.get('/api/state');
    applyState(res.state);
  }

  function applyState(next) {
    state = next;
    const sec = currentSection();
    if (sec && sec.status === 'active' && sec.remaining_ms != null) {
      deadlineAt = Date.now() + sec.remaining_ms;
    } else {
      deadlineAt = null;
    }
    $('pName').textContent = state.participant.nama;
    $('pMeta').textContent = [state.participant.nim, state.participant.kelas]
      .filter(Boolean)
      .join(' · ');
    updateViolationBadge();
  }

  function updateViolationBadge() {
    const badge = $('violBadge');
    if (!state.violation_count) {
      badge.classList.add('hidden');
      return;
    }
    badge.classList.remove('hidden');
    badge.textContent = `Pelanggaran ${state.violation_count}/${state.max_violations}`;
    badge.className =
      'badge ' + (state.violation_count >= state.max_violations - 1 ? 'red' : 'yellow');
  }

  function showGateError(msg) {
    const el = $('gateError');
    el.textContent = msg;
    el.classList.remove('hidden');
  }

  // =========================================================================
  // Gerbang masuk / antar bagian
  // =========================================================================
  function setupGate() {
    const gate = $('gate');
    const btn = $('gateBtn');
    $('gateError').classList.add('hidden');

    if (state.status === 'finished' || state.status === 'disqualified') {
      gate.classList.add('hidden');
      enterShell();
      renderDone();
      return;
    }

    const sec = currentSection();
    if (!sec) {
      gate.classList.add('hidden');
      enterShell();
      renderDone();
      return;
    }

    $('gateSection').classList.remove('hidden');
    $('gateSectionName').textContent = sec.full_name || sec.name;
    $('gateSectionTime').textContent = sec.duration_min + ' menit';
    $('gateSectionDesc').textContent =
      sec.type === 'mcq'
        ? `${sec.question_count} soal pilihan ganda. Bobot ${Math.round((sec.weight || 0) * 100)}% dari nilai akhir.`
        : `${(sec.problems && sec.problems.length) || '5'} soal pemrograman, dinilai otomatis per test case. ` +
          `Bobot ${Math.round((sec.weight || 0) * 100)}% dari nilai akhir.`;

    if (sec.status === 'active') {
      $('gateTitle').textContent = 'Lanjutkan ujian';
      $('gateMsg').textContent =
        'Sesi kamu masih berjalan. Waktu terus berjalan di server, jadi segera lanjutkan.';
      btn.textContent = 'Masuk Kembali ke Ujian';
    } else {
      $('gateTitle').textContent = 'Siap memulai?';
      $('gateMsg').textContent =
        'Timer mulai berjalan begitu kamu menekan tombol di bawah dan tidak bisa dihentikan.';
      btn.textContent = 'Mulai ' + sec.name;
    }

    btn.disabled = false;
    btn.onclick = async () => {
      btn.disabled = true;
      btn.textContent = 'Menyiapkan…';
      $('gateError').classList.add('hidden');

      if (state.lockdown.require_fullscreen) {
        const ok = await Lockdown.enterFullscreen();
        if (!ok) {
          showGateError(
            'Browser menolak mode layar penuh. Izinkan fullscreen (atau tekan F11) lalu coba lagi.'
          );
          btn.disabled = false;
          btn.textContent = 'Coba Lagi';
          return;
        }
      }

      try {
        const res = await API.post('/api/section/start', { section: sec.id });
        applyState(res.state);
      } catch (e) {
        showGateError(e.message);
        btn.disabled = false;
        btn.textContent = 'Coba Lagi';
        return;
      }

      armLockdown();
      gate.classList.add('hidden');
      enterShell();
      render();
      startTimers();
    };
  }

  function enterShell() {
    $('examRoot').classList.remove('hidden');
  }

  function armLockdown() {
    if (armed) return;
    armed = true;
    Lockdown.arm(state.lockdown, {
      onViolation: handleViolation,
      onBlockedPaste: () =>
        flashConsole('Menempel kode dari luar diblokir. Tulis kodemu sendiri.', 'warn'),
      onSaveShortcut: () => saveDraft(true),
    });
  }

  async function handleViolation(kind, detail) {
    const labels = {
      exit_fullscreen: 'Kamu keluar dari mode layar penuh.',
      tab_hidden: 'Kamu berpindah tab atau meminimalkan jendela ujian.',
      window_blur: 'Fokus berpindah ke aplikasi atau jendela lain.',
      devtools_key: 'Kamu mencoba membuka developer tools.',
      paste_code: 'Kamu mencoba menempel kode dari luar editor.',
    };

    let res;
    try {
      res = await API.post('/api/violation', { kind, detail });
    } catch (_) {
      // Server tak terjangkau: tetap tampilkan peringatan supaya soal tertutup.
      Lockdown.showViolationOverlay(labels[kind] || 'Aktivitas tidak diizinkan terdeteksi.', '?', 0);
      return;
    }

    state.violation_count = res.violation_count;
    updateViolationBadge();

    if (res.forced_finish) {
      Lockdown.disarm();
      await sync();
      render();
      Lockdown.showNotice(
        'Ujian dihentikan',
        'Batas pelanggaran lockdown terlampaui. Jawabanmu sudah dikumpulkan otomatis. Hubungi pengawas.',
        'Mengerti',
        () => Lockdown.hideOverlay()
      );
      return;
    }

    Lockdown.showViolationOverlay(
      labels[kind] || 'Aktivitas tidak diizinkan terdeteksi.',
      res.violation_count,
      res.max_violations
    );
  }

  // =========================================================================
  // Timer + sinkronisasi
  // =========================================================================
  function startTimers() {
    clearInterval(tickTimer);
    clearInterval(syncTimer);
    tickTimer = setInterval(tickClock, 250);
    syncTimer = setInterval(backgroundSync, 10000);
    tickClock();
  }

  function tickClock() {
    const el = $('timer');
    if (!deadlineAt) {
      el.textContent = '--:--';
      el.className = 'timer';
      return;
    }
    const left = Math.max(0, deadlineAt - Date.now());
    const totalSec = Math.floor(left / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    el.textContent =
      (h > 0 ? String(h).padStart(2, '0') + ':' : '') +
      String(m).padStart(2, '0') +
      ':' +
      String(s).padStart(2, '0');
    el.className = 'timer' + (totalSec <= 60 ? ' critical' : totalSec <= 300 ? ' warn' : '');

    if (left <= 0) {
      deadlineAt = null;
      backgroundSync();
    }
  }

  async function backgroundSync() {
    try {
      const prevSection = state.current_section;
      const prevStatus = state.status;
      await sync();
      updateViolationBadge();
      if (state.status !== prevStatus || state.current_section !== prevSection) {
        render();
      }
    } catch (_) {
      /* badge offline sudah menyala; coba lagi di interval berikutnya */
    }
  }

  // =========================================================================
  // Router tampilan
  // =========================================================================
  function render() {
    const sec = currentSection();
    const area = $('mainArea');

    if (!sec || state.status === 'finished' || state.status === 'disqualified') {
      renderDone();
      return;
    }

    if (sec.status === 'ready') {
      // Bagian berikutnya belum dimulai -> tampilkan gerbang lagi.
      $('examRoot').classList.add('hidden');
      $('gate').classList.remove('hidden');
      clearInterval(tickTimer);
      setupGate();
      return;
    }

    $('sectionBadge').textContent = sec.name;
    $('finishBtn').classList.remove('hidden');
    $('finishBtn').onclick = () => confirmFinish(sec);

    area.innerHTML = '';
    if (sec.type === 'mcq') {
      area.appendChild($('tplTpks').content.cloneNode(true));
      initTpks(sec);
    } else {
      area.appendChild($('tplCp').content.cloneNode(true));
      initCp(sec);
    }
  }

  function renderDone() {
    clearInterval(tickTimer);
    clearInterval(syncTimer);
    Lockdown.disarm();
    armed = false;
    $('gate').classList.add('hidden');
    $('examRoot').classList.remove('hidden');
    $('finishBtn').classList.add('hidden');
    $('timer').textContent = '--:--';
    $('sectionBadge').textContent = 'Selesai';

    const area = $('mainArea');
    area.innerHTML = '';
    area.appendChild($('tplDone').content.cloneNode(true));

    const r = state.result || {};
    if (state.status === 'disqualified') {
      $('doneTitle').textContent = 'Ujian Dihentikan';
      $('doneMsg').textContent =
        'Sesi kamu dihentikan oleh panitia. Silakan hubungi pengawas di ruangan.';
    } else {
      $('doneTitle').textContent = 'Ujian Selesai';
      $('doneMsg').textContent =
        'Semua jawaban kamu sudah tersimpan di server. Terima kasih sudah mengikuti seleksi.';
    }

    const parts = [];
    parts.push(`<div class="card tight"><dl class="kv">
      <dt>Nama</dt><dd>${esc(state.participant.nama)}</dd>
      <dt>NIM</dt><dd>${esc(state.participant.nim)}</dd>
      <dt>Pelanggaran tercatat</dt><dd>${state.violation_count}</dd>
    </dl></div>`);

    for (const sec of state.sections) {
      parts.push(`<div class="card tight row between">
        <div><strong>${esc(sec.name)}</strong>
          <div class="faint">${esc(sec.finish_reason || 'selesai')}</div></div>
        <span class="badge ${sec.status === 'finished' ? 'green' : 'gray'}">${esc(sec.status)}</span>
      </div>`);
    }

    if (r.show_score && r.final) {
      parts.push(`<div class="card tight center">
        <div class="faint">NILAI AKHIR</div>
        <div style="font-size:2.2rem;font-weight:700" class="mono">${r.final.total}</div>
      </div>`);
    }
    $('doneDetail').innerHTML = parts.join('');
  }

  async function confirmFinish(sec) {
    const isLast = state.sections[state.sections.length - 1].id === sec.id;
    let extra = '';
    if (sec.type === 'mcq') {
      const blank = sec.question_count - Object.keys(sec.answers || {}).length;
      if (blank > 0) extra = `\n\nMasih ada ${blank} soal yang belum dijawab!`;
    }
    const msg =
      `Kumpulkan bagian "${sec.name}"?\n\nBagian yang sudah dikumpulkan TIDAK bisa dibuka kembali.` +
      extra +
      (isLast ? '\n\nIni bagian terakhir — ujian akan berakhir.' : '');
    if (!confirm(msg)) return;

    if (sec.type === 'code') await saveDraft(true);
    try {
      const res = await API.post('/api/section/finish', { section: sec.id });
      applyState(res.state);
      render();
    } catch (e) {
      alert('Gagal mengumpulkan: ' + e.message);
    }
  }

  // =========================================================================
  // Bagian TPKS
  // =========================================================================
  function initTpks(sec) {
    tpksIndex = Math.min(tpksIndex, Math.max(0, sec.questions.length - 1));

    $('qgrid').innerHTML = sec.questions
      .map((q) => `<button data-i="${q.no - 1}">${q.no}</button>`)
      .join('');
    $('qgrid').onclick = (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      tpksIndex = Number(b.dataset.i);
      paintTpks(sec);
    };

    $('prevBtn').onclick = () => {
      if (tpksIndex > 0) tpksIndex--;
      paintTpks(sec);
    };
    $('nextBtn').onclick = () => {
      if (tpksIndex < sec.questions.length - 1) tpksIndex++;
      paintTpks(sec);
    };
    $('clearBtn').onclick = () => answer(sec, '');

    document.onkeydown = (e) => {
      if (Lockdown.isPaused()) return;
      const k = (e.key || '').toUpperCase();
      if (['A', 'B', 'C', 'D'].includes(k)) {
        answer(sec, k);
      } else if (['1', '2', '3', '4'].includes(k)) {
        answer(sec, 'ABCD'[Number(k) - 1]);
      } else if (e.key === 'ArrowRight') {
        $('nextBtn').click();
      } else if (e.key === 'ArrowLeft') {
        $('prevBtn').click();
      }
    };

    paintTpks(sec);
  }

  function paintTpks(sec) {
    const q = sec.questions[tpksIndex];
    if (!q) return;
    const picked = sec.answers[q.qid] || null;

    $('qCounter').textContent = `Soal ${q.no} dari ${sec.questions.length}`;
    $('qType').textContent = q.type.replace(/^[A-C]_/, '').replace('_', ' ');
    $('qText').innerHTML = fmt(q.q);

    $('qOpts').innerHTML = q.opts
      .map((text, i) => {
        const letter = 'ABCD'[i];
        return `<div class="opt ${picked === letter ? 'selected' : ''}" data-letter="${letter}">
          <span class="key">${letter}</span><span>${fmt(text)}</span>
        </div>`;
      })
      .join('');
    $('qOpts').onclick = (e) => {
      const opt = e.target.closest('.opt');
      if (opt) answer(sec, opt.dataset.letter);
    };

    $('prevBtn').disabled = tpksIndex === 0;
    $('nextBtn').disabled = tpksIndex === sec.questions.length - 1;
    $('clearBtn').disabled = !picked;

    // Navigasi samping
    const answered = Object.keys(sec.answers).length;
    $('answeredInfo').textContent = `${answered}/${sec.questions.length}`;
    $('tpksProgress').style.width = (answered / sec.questions.length) * 100 + '%';
    [...$('qgrid').children].forEach((btn, i) => {
      const qq = sec.questions[i];
      btn.className = (sec.answers[qq.qid] ? 'answered' : '') + (i === tpksIndex ? ' current' : '');
    });
  }

  async function answer(sec, letter) {
    const q = sec.questions[tpksIndex];
    if (!q) return;
    const prev = sec.answers[q.qid];
    // Klik pilihan yang sama = batalkan pilihan.
    const value = prev === letter ? '' : letter;
    if (value) sec.answers[q.qid] = value;
    else delete sec.answers[q.qid];
    paintTpks(sec);

    try {
      await API.post('/api/answer', { qid: q.qid, choice: value });
    } catch (e) {
      // Kembalikan tampilan agar peserta tahu jawabannya belum tersimpan.
      if (prev) sec.answers[q.qid] = prev;
      else delete sec.answers[q.qid];
      paintTpks(sec);
      alert('Jawaban gagal tersimpan: ' + e.message);
    }
  }

  // =========================================================================
  // Bagian CP
  // =========================================================================
  function initCp(sec) {
    document.onkeydown = null;

    const problems = sec.problems || [];
    if (!problems.length) {
      $('statement').innerHTML = '<div class="alert err">Soal CP tidak tersedia.</div>';
      return;
    }
    if (!cpCurrent || !problems.some((p) => p.id === cpCurrent)) cpCurrent = problems[0].id;

    $('langSelect').innerHTML = (sec.languages || [])
      .map((l) => `<option value="${esc(l.id)}">${esc(l.label)}</option>`)
      .join('');

    $('cpTabs').onclick = (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      saveDraft(true);
      cpCurrent = b.dataset.pid;
      paintCp(sec);
    };

    const area = $('codeArea');
    area.oninput = () => {
      syncGutter();
      $('draftStatus').textContent = 'belum tersimpan…';
      clearTimeout(draftTimer);
      draftTimer = setTimeout(() => saveDraft(false), 1500);
    };
    area.onscroll = () => {
      $('gutter').scrollTop = area.scrollTop;
    };
    area.onkeydown = handleEditorKeys;

    $('langSelect').onchange = () => {
      const p = problems.find((x) => x.id === cpCurrent);
      const draft = (sec.drafts || {})[cpCurrent];
      const isPristine =
        !area.value.trim() ||
        Object.values(sec.starter_code || {}).some((s) => s.trim() === area.value.trim());
      if (isPristine) {
        area.value = (sec.starter_code || {})[$('langSelect').value] || '';
        syncGutter();
      }
      saveDraft(false);
    };

    $('runBtn').onclick = () => runCode(sec, false);
    $('submitCodeBtn').onclick = () => runCode(sec, true);
    $('resetCodeBtn').onclick = () => {
      if (!confirm('Kembalikan kode ke templat awal? Kode saat ini akan hilang.')) return;
      area.value = (sec.starter_code || {})[$('langSelect').value] || '';
      syncGutter();
      saveDraft(true);
    };
    $('customToggle').onchange = () => renderCustomInput(sec);

    paintCp(sec);
  }

  function paintCp(sec) {
    const problems = sec.problems || [];
    const progress = new Map((sec.progress || []).map((p) => [p.problem_id, p]));

    $('cpTabs').innerHTML = problems
      .map((p) => {
        const pr = progress.get(p.id) || {};
        const dot = pr.solved ? '🟢' : pr.attempts ? '🟡' : '⚪';
        return `<button data-pid="${esc(p.id)}" class="${p.id === cpCurrent ? 'active' : ''}">
          <span class="dot">${dot}</span>${esc(p.id)} · ${esc(p.title)}
        </button>`;
      })
      .join('');

    const p = problems.find((x) => x.id === cpCurrent);
    const pr = progress.get(p.id) || {};

    $('statement').innerHTML = `
      <h2>${esc(p.id)}. ${esc(p.title)}</h2>
      <div class="meta">
        ${esc(p.topic)} &middot; batas waktu ${p.time_limit_ms / 1000}s &middot;
        ${p.total_tests} test case &middot;
        ${pr.attempts || 0}/${sec.max_submissions_per_problem} submit terpakai
        ${pr.solved ? '<span class="badge green" style="margin-left:.4rem">SOLVED</span>' : ''}
      </div>
      <section><div class="body">${fmt(p.statement)}</div></section>
      <section><h4>Format Input</h4><div class="body">${fmt(p.input_format)}</div></section>
      <section><h4>Format Output</h4><div class="body">${fmt(p.output_format)}</div></section>
      <section><h4>Batasan</h4><div class="body mono" style="font-size:.85rem">${fmt(p.constraints)}</div></section>
      ${p.notes ? `<section><h4>Catatan</h4><div class="body dim">${fmt(p.notes)}</div></section>` : ''}
      <section><h4>Contoh Kasus</h4>
        ${p.samples
          .map(
            (s, i) => `<div style="margin-bottom:.6rem">
              <div class="faint" style="margin-bottom:.25rem">Contoh ${i + 1}</div>
              <div class="sample-grid">
                <div><span>Input</span><pre class="io">${esc(s.input)}</pre></div>
                <div><span>Output</span><pre class="io">${esc(s.output)}</pre></div>
              </div>
            </div>`
          )
          .join('')}
      </section>`;

    // Muat draft tersimpan, atau templat awal bahasa terpilih.
    const draft = (sec.drafts || {})[p.id];
    if (draft) {
      if (draft.language) $('langSelect').value = draft.language;
      $('codeArea').value = draft.code || '';
      $('draftStatus').textContent = 'draft tersimpan';
    } else {
      $('codeArea').value = (sec.starter_code || {})[$('langSelect').value] || '';
      $('draftStatus').textContent = '';
    }
    syncGutter();

    const limitReached = (pr.attempts || 0) >= sec.max_submissions_per_problem;
    $('submitCodeBtn').disabled = limitReached;
    $('submitCodeBtn').title = limitReached ? 'Batas submit soal ini sudah habis' : '';
    renderCustomInput(sec);
  }

  function renderCustomInput(sec) {
    if (!$('customToggle').checked) {
      $('consoleTitle').textContent = 'Hasil';
      const body = $('consoleBody');
      if (body.dataset.mode === 'custom') {
        body.dataset.mode = '';
        body.innerHTML = '<p class="faint">Mode input manual dimatikan.</p>';
      }
      return;
    }
    $('consoleTitle').textContent = 'Input manual';
    const body = $('consoleBody');
    body.dataset.mode = 'custom';
    body.innerHTML = `
      <p class="faint" style="margin-top:0">Tulis input sendiri untuk mengetes kodemu. Tidak dinilai.</p>
      <textarea id="customInput" data-allow-editing="true" rows="4" spellcheck="false"
        class="mono" placeholder="contoh:\n5\n1 2 3 4 5"></textarea>
      <div id="customOut" style="margin-top:.5rem"></div>`;
  }

  function syncGutter() {
    const area = $('codeArea');
    const lines = area.value.split('\n').length;
    const g = $('gutter');
    g.textContent = Array.from({ length: Math.max(lines, 1) }, (_, i) => i + 1).join('\n');
    g.scrollTop = area.scrollTop;
  }

  /** Tab = 4 spasi, Enter mempertahankan indentasi baris sebelumnya. */
  function handleEditorKeys(e) {
    const area = e.target;
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = area.selectionStart;
      const end = area.selectionEnd;
      area.setRangeText('    ', start, end, 'end');
      area.dispatchEvent(new Event('input'));
      return;
    }
    if (e.key === 'Enter') {
      const pos = area.selectionStart;
      const lineStart = area.value.lastIndexOf('\n', pos - 1) + 1;
      const line = area.value.slice(lineStart, pos);
      const indent = (line.match(/^[ \t]*/) || [''])[0];
      const extra = /[:{([]\s*$/.test(line) ? '    ' : '';
      if (indent || extra) {
        e.preventDefault();
        area.setRangeText('\n' + indent + extra, pos, area.selectionEnd, 'end');
        area.dispatchEvent(new Event('input'));
      }
    }
  }

  async function saveDraft(force) {
    const sec = section('cp');
    if (!sec || sec.status !== 'active' || !cpCurrent) return;
    clearTimeout(draftTimer);
    const code = $('codeArea') ? $('codeArea').value : null;
    if (code == null) return;
    sec.drafts = sec.drafts || {};
    sec.drafts[cpCurrent] = { language: $('langSelect').value, code };
    try {
      await API.post('/api/cp/draft', {
        problem_id: cpCurrent,
        language: $('langSelect').value,
        code,
      });
      if ($('draftStatus')) $('draftStatus').textContent = 'draft tersimpan';
    } catch (e) {
      if ($('draftStatus')) $('draftStatus').textContent = 'draft GAGAL tersimpan';
      if (force) console.warn('draft gagal:', e.message);
    }
  }

  function flashConsole(text, kind) {
    const body = $('consoleBody');
    if (!body) return;
    const div = document.createElement('div');
    div.className = 'alert ' + (kind || 'info');
    div.textContent = text;
    body.prepend(div);
    setTimeout(() => div.remove(), 4000);
  }

  async function runCode(sec, isSubmit) {
    if (judging) return;
    const code = $('codeArea').value;
    if (!code.trim()) {
      flashConsole('Kode masih kosong.', 'warn');
      return;
    }
    if (isSubmit && !confirm('Submit untuk dinilai? Ini akan menggunakan satu kesempatan submit.')) {
      return;
    }

    judging = true;
    $('runBtn').disabled = true;
    $('submitCodeBtn').disabled = true;
    const body = $('consoleBody');
    const customEl = $('customInput');
    const customInput = $('customToggle').checked && customEl ? customEl.value : '';

    // Dalam mode input manual, jangan hapus isi console -- textarea input
    // peserta ada di dalamnya. Tulis status ke kotak output khusus.
    const usingCustom = !isSubmit && $('customToggle').checked && customEl;
    if (usingCustom) {
      $('customOut').innerHTML = '<p class="dim">Menjalankan kode di server…</p>';
    } else {
      $('consoleTitle').textContent = isSubmit ? 'Hasil Submit' : 'Hasil Uji';
      body.dataset.mode = '';
      body.innerHTML = '<p class="dim">Menjalankan kode di server… mohon tunggu.</p>';
    }

    await saveDraft(true);

    try {
      let res;
      if (isSubmit) {
        res = await API.post('/api/cp/submit', {
          problem_id: cpCurrent,
          language: $('langSelect').value,
          code,
        });
        applyState(res.state);
        renderJudge(res.submission, true);
        // Perbarui tab + hitungan submit.
        paintCpAfterSubmit(res.submission);
      } else {
        res = await API.post('/api/cp/run', {
          problem_id: cpCurrent,
          language: $('langSelect').value,
          code,
          custom_input: customInput,
        });
        if (res.mode === 'custom') renderCustomResult(res.result);
        else renderJudge(res.result, false);
      }
    } catch (e) {
      const target = usingCustom ? $('customOut') : body;
      target.innerHTML = `<div class="alert err">${esc(e.message)}</div>`;
    } finally {
      judging = false;
      $('runBtn').disabled = false;
      const pr = (section('cp').progress || []).find((p) => p.problem_id === cpCurrent) || {};
      $('submitCodeBtn').disabled =
        (pr.attempts || 0) >= section('cp').max_submissions_per_problem;
    }
  }

  function paintCpAfterSubmit(sub) {
    const sec = section('cp');
    const progress = new Map((sec.progress || []).map((p) => [p.problem_id, p]));
    [...$('cpTabs').children].forEach((btn) => {
      const pr = progress.get(btn.dataset.pid) || {};
      const dot = btn.querySelector('.dot');
      if (dot) dot.textContent = pr.solved ? '🟢' : pr.attempts ? '🟡' : '⚪';
    });
    const p = (sec.problems || []).find((x) => x.id === cpCurrent);
    const pr = progress.get(cpCurrent) || {};
    const meta = $('statement').querySelector('.meta');
    if (meta && p) {
      meta.innerHTML =
        `${esc(p.topic)} &middot; batas waktu ${p.time_limit_ms / 1000}s &middot; ` +
        `${p.total_tests} test case &middot; ${pr.attempts || 0}/${sec.max_submissions_per_problem} submit terpakai` +
        (pr.solved ? ' <span class="badge green" style="margin-left:.4rem">SOLVED</span>' : '');
    }
  }

  function renderJudge(result, isSubmit) {
    const body = $('consoleBody');
    const total = result.total || (result.results || []).length;
    const passed = result.passed || 0;

    if (result.verdict === 'CE') {
      body.innerHTML = `
        <div class="alert err">Compile Error — kode tidak bisa dikompilasi.</div>
        <pre class="io">${esc(result.compile_output || '-')}</pre>`;
      return;
    }
    if (result.verdict === 'IE') {
      body.innerHTML = `<div class="alert err">Judge error: ${esc(result.message || 'tidak diketahui')}</div>`;
      return;
    }

    const allOk = passed === total && total > 0;
    const head = isSubmit
      ? `<div class="alert ${allOk ? 'ok' : 'err'}">
           <strong>${allOk ? 'ACCEPTED' : result.verdict}</strong> —
           ${passed} dari ${total} test case lulus
           (nilai soal ini: ${total ? Math.round((passed / total) * 100) : 0}/100)
         </div>`
      : `<div class="alert ${allOk ? 'ok' : 'warn'}">
           ${allOk ? 'Semua contoh kasus lulus.' : `${passed}/${total} contoh kasus lulus.`}
           ${allOk ? ' Jangan lupa tekan <strong>Submit &amp; Nilai</strong>.' : ''}
         </div>`;

    const rows = (result.results || [])
      .map((r) => {
        let detail = '';
        if (r.input != null) {
          detail = `<div class="sample-grid" style="margin:.35rem 0 .75rem">
              <div><span>Input</span><pre class="io">${esc(r.input)}</pre></div>
              <div><span>Output kamu</span><pre class="io">${esc(r.got || '(kosong)')}</pre></div>
              <div><span>Output seharusnya</span><pre class="io">${esc(r.expected)}</pre></div>
              ${r.stderr ? `<div><span>Stderr</span><pre class="io">${esc(r.stderr)}</pre></div>` : ''}
            </div>`;
        } else if (r.stderr) {
          detail = `<pre class="io" style="margin:.35rem 0 .75rem">${esc(r.stderr)}</pre>`;
        }
        return `<div class="verdict-row">
            <span class="v v-${r.verdict}">${r.verdict}</span>
            <span class="dim">Test ${r.no}${r.is_sample ? ' (contoh)' : ''}</span>
            <div class="grow"></div>
            <span class="faint">${r.time_ms} ms</span>
          </div>${detail}`;
      })
      .join('');

    body.innerHTML =
      head +
      (result.compile_output
        ? `<details style="margin-bottom:.5rem"><summary class="faint">Peringatan compiler</summary>
             <pre class="io">${esc(result.compile_output)}</pre></details>`
        : '') +
      rows;
  }

  function renderCustomResult(r) {
    const target = $('customOut') || $('consoleBody');
    target.innerHTML = `
      <div class="alert ${r.verdict === 'OK' ? 'ok' : 'warn'}">
        ${esc(r.label || r.verdict)} &middot; ${r.time_ms} ms &middot; exit code ${r.exit_code}
      </div>
      <div class="faint">Output</div>
      <pre class="io">${esc(r.stdout || '(kosong)')}</pre>
      ${r.stderr ? `<div class="faint">Stderr</div><pre class="io">${esc(r.stderr)}</pre>` : ''}
      ${r.compile_output ? `<div class="faint">Compile</div><pre class="io">${esc(r.compile_output)}</pre>` : ''}`;
  }

  init();
})();
