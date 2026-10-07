/* Aplikasi ujian peserta.
   Satu timer global; bagian TPKS dan CP dibuka bersamaan dan peserta bebas
   berpindah di antara keduanya. */
(function () {
  'use strict';

  let state = null;
  let deadlineAt = null; // timestamp lokal hasil sinkronisasi dengan server
  let tickTimer = null;
  let syncTimer = null;
  let armed = false;
  let currentPart = 'tpks';

  let tpksIndex = 0;
  let cpCurrent = null;
  let draftTimer = null;
  let judging = false;

  const $ = (id) => document.getElementById(id);
  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"]/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])
    );

  /** Escape dulu, lalu izinkan **tebal** dan `kode` dari teks soal. */
  function fmt(text) {
    return esc(text)
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');
  }

  const tpks = () => state.parts.tpks;
  const cp = () => state.parts.cp;

  // =========================================================================
  // Bootstrap
  // =========================================================================
  async function init() {
    if (!API.getSid()) {
      location.replace('index.html');
      return;
    }
    API.onOffline(() => $('offlineTag').classList.remove('hidden'));
    API.onOnline(() => $('offlineTag').classList.add('hidden'));

    try {
      await sync();
    } catch (e) {
      $('gateMsg').textContent = '';
      gateError(e.message + ' Periksa WiFi, lalu muat ulang halaman.');
      return;
    }
    setupGate();
  }

  async function sync() {
    applyState((await API.get('/api/state')).state);
  }

  function applyState(next) {
    state = next;
    deadlineAt = state.status === 'active' ? Date.now() + state.remaining_ms : null;
    $('pName').textContent = state.participant.nama;
    $('pMeta').textContent = [state.participant.nim, state.participant.kelas]
      .filter(Boolean)
      .join(' / ');
    paintViolation();
  }

  function paintViolation() {
    const tag = $('violTag');
    if (!state.violation_count) {
      tag.classList.add('hidden');
      return;
    }
    tag.classList.remove('hidden');
    tag.textContent = `pelanggaran ${state.violation_count}/${state.max_violations}`;
    tag.className = 'tag ' + (state.violation_count >= state.max_violations - 1 ? 'bad' : 'warn');
  }

  function gateError(msg) {
    $('gateError').textContent = msg;
    $('gateError').classList.remove('hidden');
  }

  // =========================================================================
  // Gerbang masuk
  // =========================================================================
  function setupGate() {
    $('gateError').classList.add('hidden');

    if (state.status !== 'active') {
      $('gate').classList.add('hidden');
      renderDone();
      return;
    }

    const mins = Math.floor(state.remaining_ms / 60000);
    const secs = Math.floor((state.remaining_ms % 60000) / 1000);
    $('gateInfo').innerHTML =
      `<dt>Peserta</dt><dd>${esc(state.participant.nama)} (${esc(state.participant.nim)})</dd>` +
      `<dt>Isi ujian</dt><dd>${tpks().question_count} soal ${esc(tpks().name)} + ` +
      `${cp().problem_count} soal ${esc(cp().name)}</dd>` +
      `<dt>Total waktu</dt><dd>${state.duration_min} menit</dd>` +
      `<dt>Sisa waktu</dt><dd><b>${mins} menit ${secs} detik</b></dd>`;

    $('gateMsg').textContent =
      'Timer sudah berjalan sejak kamu enroll. Kedua bagian dibuka bersamaan dan ' +
      'kamu bebas berpindah di antara keduanya.';

    const btn = $('gateBtn');
    btn.disabled = false;
    btn.textContent = 'Masuk layar penuh dan mulai mengerjakan';
    btn.onclick = async () => {
      btn.disabled = true;
      btn.textContent = 'Menyiapkan...';
      $('gateError').classList.add('hidden');

      if (state.lockdown.require_fullscreen) {
        if (!(await Lockdown.enterFullscreen())) {
          gateError('Browser menolak mode layar penuh. Izinkan fullscreen (atau tekan F11), lalu coba lagi.');
          btn.disabled = false;
          btn.textContent = 'Coba lagi';
          return;
        }
      }

      try {
        await sync();
      } catch (e) {
        gateError(e.message);
        btn.disabled = false;
        btn.textContent = 'Coba lagi';
        return;
      }

      armLockdown();
      $('gate').classList.add('hidden');
      $('examRoot').classList.remove('hidden');
      render();
      startTimers();
    };
  }

  function armLockdown() {
    if (armed) return;
    armed = true;
    Lockdown.arm(state.lockdown, {
      onViolation: handleViolation,
      onBlockedPaste: () => note('Menempel kode dari luar diblokir. Tulis kodemu sendiri.', 'warn'),
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
    const text = labels[kind] || 'Aktivitas tidak diizinkan terdeteksi.';

    let res;
    try {
      res = await API.post('/api/violation', { kind, detail });
    } catch (_) {
      // Server tak terjangkau: tetap tutup layar soal.
      Lockdown.showViolationOverlay(text, '?', 0);
      return;
    }

    state.violation_count = res.violation_count;
    paintViolation();

    if (res.forced_finish) {
      Lockdown.disarm();
      await sync();
      renderDone();
      Lockdown.showNotice(
        'Ujian dihentikan',
        'Batas pelanggaran lockdown terlampaui. Jawabanmu sudah dikumpulkan otomatis. Hubungi pengawas.',
        'Tutup',
        () => Lockdown.hideOverlay()
      );
      return;
    }
    Lockdown.showViolationOverlay(text, res.violation_count, res.max_violations);
  }

  // =========================================================================
  // Timer
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
      el.className = '';
      return;
    }
    const left = Math.max(0, deadlineAt - Date.now());
    const total = Math.floor(left / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    el.textContent =
      (h > 0 ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(s).padStart(2, '0');
    el.className = total <= (state.warn_minutes || 10) * 60 ? 'low' : '';

    if (left <= 0) {
      deadlineAt = null;
      backgroundSync();
    }
  }

  async function backgroundSync() {
    const prevStatus = state.status;
    try {
      await sync();
    } catch (_) {
      return; // tag offline sudah menyala
    }
    if (state.status !== prevStatus) render();
  }

  // =========================================================================
  // Router tampilan
  // =========================================================================
  function render() {
    if (state.status !== 'active') {
      renderDone();
      return;
    }

    [...$('partTabs').children].forEach((b) => {
      b.classList.toggle('active', b.dataset.part === currentPart);
    });

    const area = $('mainArea');
    area.innerHTML = '';
    if (currentPart === 'tpks') {
      area.appendChild($('tplTpks').content.cloneNode(true));
      initTpks();
    } else {
      area.appendChild($('tplCp').content.cloneNode(true));
      initCp();
    }
    paintTabLabels();
  }

  function paintTabLabels() {
    const tabs = $('partTabs').children;
    tabs[0].textContent = `${tpks().name} (${Object.keys(tpks().answers).length}/${tpks().question_count})`;
    const solved = (cp().progress || []).filter((p) => p.solved).length;
    tabs[1].textContent = `${cp().name === 'Competitive Programming' ? 'CP' : cp().name} (${solved}/${cp().problem_count})`;
  }

  $('partTabs').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.dataset.part === currentPart) return;
    if (currentPart === 'cp') saveDraft(true);
    currentPart = b.dataset.part;
    render();
  });

  $('finishBtn').addEventListener('click', confirmFinish);

  async function confirmFinish() {
    const blank = tpks().question_count - Object.keys(tpks().answers).length;
    const unsolved = (cp().progress || []).filter((p) => !p.attempts).length;
    let warn = '';
    if (blank > 0) warn += `\n- ${blank} soal TPKS belum dijawab`;
    if (unsolved > 0) warn += `\n- ${unsolved} soal CP belum pernah disubmit`;

    if (
      !confirm(
        'Kumpulkan seluruh jawaban dan akhiri ujian?\n\nTindakan ini tidak bisa dibatalkan.' +
          (warn ? '\n' + warn : '')
      )
    )
      return;

    if (currentPart === 'cp') await saveDraft(true);
    try {
      applyState((await API.post('/api/finish')).state);
      renderDone();
    } catch (e) {
      alert('Gagal mengumpulkan: ' + e.message);
    }
  }

  function renderDone() {
    clearInterval(tickTimer);
    clearInterval(syncTimer);
    Lockdown.disarm();
    armed = false;
    document.onkeydown = null;

    $('gate').classList.add('hidden');
    $('examRoot').classList.remove('hidden');
    $('finishBtn').classList.add('hidden');
    $('partTabs').classList.add('hidden');
    $('timer').textContent = '--:--';

    const area = $('mainArea');
    area.innerHTML = '';
    area.appendChild($('tplDone').content.cloneNode(true));

    const r = state.result || {};
    if (state.status === 'disqualified') {
      $('doneTitle').textContent = 'Ujian dihentikan';
      $('doneMsg').textContent = 'Sesi kamu dihentikan panitia. Hubungi pengawas di ruangan.';
    } else {
      $('doneTitle').textContent = 'Ujian selesai';
      $('doneMsg').textContent = 'Semua jawaban kamu sudah tersimpan di server.';
    }

    let html =
      `<div class="box"><dl class="kv">
        <dt>Nama</dt><dd>${esc(state.participant.nama)}</dd>
        <dt>NIM</dt><dd>${esc(state.participant.nim)}</dd>
        <dt>Alasan selesai</dt><dd>${esc(state.finish_reason || '-')}</dd>
        <dt>Pelanggaran tercatat</dt><dd>${state.violation_count}</dd>
      </dl></div>`;

    if (r.show_score && r.final) {
      html += `<div class="box"><dl class="kv">
        <dt>TPKS</dt><dd>${r.scores.tpks.correct}/${r.scores.tpks.total} (${r.scores.tpks.percent}%)</dd>
        <dt>CP</dt><dd>${r.scores.cp.solved_count}/${r.scores.cp.problem_count} solved (${r.scores.cp.percent}%)</dd>
        <dt>Nilai akhir</dt><dd><b>${r.final.total}</b></dd>
      </dl></div>`;
    }
    $('doneDetail').innerHTML = html;
  }

  // =========================================================================
  // TPKS
  // =========================================================================
  function initTpks() {
    const qs = tpks().questions;
    tpksIndex = Math.min(tpksIndex, Math.max(0, qs.length - 1));

    $('qgrid').innerHTML = qs.map((q) => `<button data-i="${q.no - 1}">${q.no}</button>`).join('');
    $('qgrid').onclick = (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      tpksIndex = Number(b.dataset.i);
      paintTpks();
    };

    $('prevBtn').onclick = () => {
      if (tpksIndex > 0) tpksIndex--;
      paintTpks();
    };
    $('nextBtn').onclick = () => {
      if (tpksIndex < qs.length - 1) tpksIndex++;
      paintTpks();
    };
    $('clearBtn').onclick = () => answer('');

    document.onkeydown = (e) => {
      if (Lockdown.isPaused() || currentPart !== 'tpks') return;
      if (e.target && e.target.tagName === 'INPUT') return;
      const k = (e.key || '').toUpperCase();
      if (['A', 'B', 'C', 'D'].includes(k)) answer(k);
      else if (['1', '2', '3', '4'].includes(k)) answer('ABCD'[Number(k) - 1]);
      else if (e.key === 'ArrowRight') $('nextBtn').click();
      else if (e.key === 'ArrowLeft') $('prevBtn').click();
    };

    paintTpks();
  }

  function paintTpks() {
    const qs = tpks().questions;
    const q = qs[tpksIndex];
    if (!q) return;
    const picked = tpks().answers[q.qid] || null;

    $('qCounter').textContent = `Soal ${q.no} dari ${qs.length}`;
    $('qType').textContent = q.type.replace(/^[A-C]_/, '').replace('_', ' ').toLowerCase();
    $('qText').innerHTML = fmt(q.q);

    $('qOpts').innerHTML = q.opts
      .map((text, i) => {
        const letter = 'ABCD'[i];
        return `<div class="opt${picked === letter ? ' selected' : ''}" data-letter="${letter}">
          <span class="key">${letter}.</span><span>${fmt(text)}</span></div>`;
      })
      .join('');
    $('qOpts').onclick = (e) => {
      const opt = e.target.closest('.opt');
      if (opt) answer(opt.dataset.letter);
    };

    $('prevBtn').disabled = tpksIndex === 0;
    $('nextBtn').disabled = tpksIndex === qs.length - 1;
    $('clearBtn').disabled = !picked;

    const answered = Object.keys(tpks().answers).length;
    $('answeredInfo').textContent = `${answered}/${qs.length} dijawab`;
    [...$('qgrid').children].forEach((btn, i) => {
      btn.className =
        (tpks().answers[qs[i].qid] ? 'answered' : '') + (i === tpksIndex ? ' current' : '');
    });
    paintTabLabels();
  }

  async function answer(letter) {
    const q = tpks().questions[tpksIndex];
    if (!q) return;
    const prev = tpks().answers[q.qid];
    const value = prev === letter ? '' : letter; // klik pilihan sama = batalkan

    if (value) tpks().answers[q.qid] = value;
    else delete tpks().answers[q.qid];
    paintTpks();

    try {
      await API.post('/api/answer', { qid: q.qid, choice: value });
    } catch (e) {
      // Kembalikan tampilan supaya peserta tahu jawabannya belum tersimpan.
      if (prev) tpks().answers[q.qid] = prev;
      else delete tpks().answers[q.qid];
      paintTpks();
      alert('Jawaban gagal tersimpan: ' + e.message);
    }
  }

  // =========================================================================
  // CP
  // =========================================================================
  function initCp() {
    document.onkeydown = null;
    const problems = cp().problems || [];
    if (!problems.length) {
      $('statement').innerHTML = '<div class="msg err">Soal CP tidak tersedia.</div>';
      return;
    }
    if (!cpCurrent || !problems.some((p) => p.id === cpCurrent)) cpCurrent = problems[0].id;

    $('langSelect').innerHTML = (cp().languages || [])
      .map((l) => `<option value="${esc(l.id)}">${esc(l.label)}</option>`)
      .join('');

    $('cpTabs').onclick = (e) => {
      const b = e.target.closest('button');
      if (!b || b.dataset.pid === cpCurrent) return;
      saveDraft(true);
      cpCurrent = b.dataset.pid;
      paintCp();
    };

    const area = $('codeArea');
    area.oninput = () => {
      syncGutter();
      $('draftStatus').textContent = 'belum tersimpan';
      clearTimeout(draftTimer);
      draftTimer = setTimeout(() => saveDraft(false), 1500);
    };
    area.onscroll = () => {
      $('gutter').scrollTop = area.scrollTop;
    };
    area.onkeydown = handleEditorKeys;

    $('langSelect').onchange = () => {
      // Hanya ganti templat kalau peserta belum menulis apa pun.
      const starters = Object.values(cp().starter_code || {}).map((s) => s.trim());
      if (!area.value.trim() || starters.includes(area.value.trim())) {
        area.value = (cp().starter_code || {})[$('langSelect').value] || '';
        syncGutter();
      }
      refreshCpMeta(); // batas waktu efektif berubah ikut bahasa
      saveDraft(false);
    };

    $('runBtn').onclick = () => runCode(false);
    $('submitCodeBtn').onclick = () => runCode(true);
    $('resetCodeBtn').onclick = () => {
      if (!confirm('Kembalikan kode ke templat awal? Kode saat ini hilang.')) return;
      area.value = (cp().starter_code || {})[$('langSelect').value] || '';
      syncGutter();
      saveDraft(true);
    };
    $('customToggle').onchange = renderCustomInput;

    paintCp();
  }

  function paintCp() {
    const problems = cp().problems || [];
    const prog = new Map((cp().progress || []).map((p) => [p.problem_id, p]));

    $('cpTabs').innerHTML = problems
      .map((p, i) => {
        const pr = prog.get(p.id) || {};
        const mark = pr.solved ? ' [selesai]' : pr.attempts ? ` [${pr.best_passed}/${pr.total_tests}]` : '';
        return `<button data-pid="${esc(p.id)}" class="${p.id === cpCurrent ? 'active' : ''}">
          Soal ${i + 1}: ${esc(p.title)}${mark}</button>`;
      })
      .join('');

    const p = problems.find((x) => x.id === cpCurrent);
    const pr = prog.get(p.id) || {};

    $('statement').innerHTML = `
      <h2>${esc(p.title)}</h2>
      <p class="small dim">${cpMetaHtml(p, pr)}</p>
      <section><div class="body">${fmt(p.statement)}</div></section>
      <section><h4>Format input</h4><div class="body">${fmt(p.input_format)}</div></section>
      <section><h4>Format output</h4><div class="body">${fmt(p.output_format)}</div></section>
      <section><h4>Batasan</h4><div class="body mono small">${fmt(p.constraints)}</div></section>
      ${p.notes ? `<section><h4>Catatan</h4><div class="body dim">${fmt(p.notes)}</div></section>` : ''}
      <section><h4>Contoh kasus &mdash; tidak dinilai</h4>
        <p class="small dim" style="margin:0 0 .4rem">
          Contoh di bawah hanya untuk memahami format input/output. Nilaimu
          ditentukan oleh <b>${p.total_tests} test case tersembunyi</b> dengan data
          yang berbeda, jadi menuliskan jawaban contoh secara langsung tidak akan
          mendapat nilai.
        </p>
        ${p.samples
          .map(
            (s, i) => `<div style="margin-bottom:.5rem">
              <div class="small dim">Contoh ${i + 1}</div>
              <div class="io-pair">
                <div><span>Input</span><pre class="io">${esc(s.input)}</pre></div>
                <div><span>Output</span><pre class="io">${esc(s.output)}</pre></div>
              </div></div>`
          )
          .join('')}
      </section>`;

    const draft = (cp().drafts || {})[p.id];
    if (draft) {
      if (draft.language) $('langSelect').value = draft.language;
      $('codeArea').value = draft.code || '';
      $('draftStatus').textContent = 'draft tersimpan';
    } else {
      $('codeArea').value = (cp().starter_code || {})[$('langSelect').value] || '';
      $('draftStatus').textContent = '';
    }
    syncGutter();

    const limitReached = (pr.attempts || 0) >= cp().max_submissions_per_problem;
    $('submitCodeBtn').disabled = limitReached;
    $('submitCodeBtn').title = limitReached ? 'Batas submit soal ini sudah habis' : '';
    renderCustomInput();
    paintTabLabels();
  }

  function renderCustomInput() {
    const body = $('consoleBody');
    if (!$('customToggle').checked) {
      $('consoleTitle').textContent = 'Hasil';
      if (body.dataset.mode === 'custom') {
        body.dataset.mode = '';
        body.innerHTML = '<p class="dim small">Mode input manual dimatikan.</p>';
      }
      return;
    }
    $('consoleTitle').textContent = 'Input manual';
    body.dataset.mode = 'custom';
    body.innerHTML = `
      <p class="dim small" style="margin-top:0">Tulis input sendiri untuk mengetes kodemu. Tidak dinilai.</p>
      <textarea id="customInput" data-allow-editing="true" rows="4" spellcheck="false" class="mono"></textarea>
      <div id="customOut" style="margin-top:.4rem"></div>`;
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
      area.setRangeText('    ', area.selectionStart, area.selectionEnd, 'end');
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
    if (!state || state.status !== 'active' || !cpCurrent || !$('codeArea')) return;
    clearTimeout(draftTimer);
    const code = $('codeArea').value;
    const language = $('langSelect').value;
    cp().drafts = cp().drafts || {};
    cp().drafts[cpCurrent] = { language, code };
    try {
      await API.post('/api/cp/draft', { problem_id: cpCurrent, language, code });
      if ($('draftStatus')) $('draftStatus').textContent = 'draft tersimpan';
    } catch (e) {
      if ($('draftStatus')) $('draftStatus').textContent = 'draft GAGAL tersimpan';
      if (force) console.warn('draft gagal:', e.message);
    }
  }

  function note(text, kind) {
    const body = $('consoleBody');
    if (!body) return;
    const div = document.createElement('div');
    div.className = 'msg ' + (kind || '');
    div.textContent = text;
    body.prepend(div);
    setTimeout(() => div.remove(), 4000);
  }

  async function runCode(isSubmit) {
    if (judging) return;
    const code = $('codeArea').value;
    if (!code.trim()) return note('Kode masih kosong.', 'warn');
    if (isSubmit && !confirm('Submit untuk dinilai? Ini memakai satu kesempatan submit.')) return;

    judging = true;
    $('runBtn').disabled = true;
    $('submitCodeBtn').disabled = true;

    const body = $('consoleBody');
    const customEl = $('customInput');
    const customInput = !isSubmit && $('customToggle').checked && customEl ? customEl.value : '';
    // Di mode input manual jangan hapus isi console -- textarea input peserta
    // ada di dalamnya.
    const usingCustom = !isSubmit && $('customToggle').checked && customEl;

    if (usingCustom) {
      $('customOut').innerHTML = '<p class="dim small">Menjalankan...</p>';
    } else {
      $('consoleTitle').textContent = isSubmit ? 'Hasil submit' : 'Hasil uji contoh';
      body.dataset.mode = '';
      body.innerHTML = '<p class="dim small">Menjalankan kode di server...</p>';
    }

    await saveDraft(true);

    try {
      if (isSubmit) {
        const res = await API.post('/api/cp/submit', {
          problem_id: cpCurrent,
          language: $('langSelect').value,
          code,
        });
        applyState(res.state);
        renderJudge(res.submission, true);
        refreshCpMeta();
      } else {
        const res = await API.post('/api/cp/run', {
          problem_id: cpCurrent,
          language: $('langSelect').value,
          code,
          custom_input: customInput,
        });
        if (res.mode === 'custom') renderCustomResult(res.result);
        else renderJudge(res.result, false);
      }
    } catch (e) {
      (usingCustom ? $('customOut') : body).innerHTML = `<div class="msg err">${esc(e.message)}</div>`;
    } finally {
      judging = false;
      $('runBtn').disabled = false;
      const pr = (cp().progress || []).find((p) => p.problem_id === cpCurrent) || {};
      $('submitCodeBtn').disabled = (pr.attempts || 0) >= cp().max_submissions_per_problem;
    }
  }

  /** Perbarui label tab & baris meta tanpa membongkar seluruh panel. */
  function refreshCpMeta() {
    const prog = new Map((cp().progress || []).map((p) => [p.problem_id, p]));
    [...$('cpTabs').children].forEach((btn, i) => {
      const pr = prog.get(btn.dataset.pid) || {};
      const p = (cp().problems || [])[i];
      const mark = pr.solved ? ' [selesai]' : pr.attempts ? ` [${pr.best_passed}/${pr.total_tests}]` : '';
      btn.textContent = `Soal ${i + 1}: ${p ? p.title : btn.dataset.pid}${mark}`;
    });

    const p = (cp().problems || []).find((x) => x.id === cpCurrent);
    const pr = prog.get(cpCurrent) || {};
    const meta = $('statement').querySelector('p.small');
    if (meta && p) meta.innerHTML = cpMetaHtml(p, pr);
    paintTabLabels();
  }

  /** Kelonggaran waktu bahasa yang sedang dipilih (Java & Python dapat lebih). */
  function langMultiplier() {
    const sel = $('langSelect') ? $('langSelect').value : null;
    const l = (cp().languages || []).find((x) => x.id === sel);
    return (l && l.time_multiplier) || 1;
  }

  function cpMetaHtml(p, pr) {
    const mult = langMultiplier();
    const eff = Math.round(p.time_limit_ms * mult) / 1000;
    // Batas waktu yang ditampilkan harus yang BERLAKU untuk bahasa terpilih,
    // bukan batas dasar soal -- kalau tidak, peserta Java salah memperkirakan.
    const limit =
      mult === 1
        ? `batas waktu ${p.time_limit_ms / 1000}s`
        : `batas waktu ${eff}s <span title="bahasa ini diberi kelonggaran waktu">` +
          `(dasar ${p.time_limit_ms / 1000}s &times;${mult})</span>`;
    return (
      `${esc(p.id)} &middot; ${esc(p.topic)} &middot; ${limit} &middot; ` +
      `${p.total_tests} test dinilai (tersembunyi) &middot; ` +
      `${pr.attempts || 0}/${cp().max_submissions_per_problem} submit terpakai` +
      (pr.solved ? ' &middot; <b>selesai</b>' : '')
    );
  }

  function renderJudge(result, isSubmit) {
    const body = $('consoleBody');
    const total = result.total || (result.results || []).length;
    const passed = result.passed || 0;

    if (result.verdict === 'CE') {
      body.innerHTML =
        '<div class="msg err">Compile Error &mdash; kode tidak bisa dikompilasi.</div>' +
        `<pre class="io">${esc(result.compile_output || '-')}</pre>`;
      return;
    }
    if (result.verdict === 'IE') {
      body.innerHTML = `<div class="msg err">Judge error: ${esc(result.message || 'tidak diketahui')}</div>`;
      return;
    }

    const allOk = passed === total && total > 0;
    const head = isSubmit
      ? `<div class="msg ${allOk ? 'ok' : 'err'}">${allOk ? 'Accepted' : result.verdict} &mdash;
           ${passed} dari ${total} test case lulus. Nilai soal ini
           ${total ? Math.round((passed / total) * 100) : 0}/100.</div>`
      : `<div class="msg ${allOk ? 'ok' : 'warn'}">${passed}/${total} contoh kasus lulus.
           Ini <b>belum</b> nilaimu &mdash; contoh tidak dinilai.
           ${allOk ? 'Tekan <b>Submit &amp; nilai</b> untuk diuji dengan test tersembunyi.' : ''}</div>`;

    const rows = (result.results || [])
      .map((r) => {
        let detail = '';
        if (r.input != null) {
          detail = `<div class="io-pair" style="margin:.3rem 0 .6rem">
              <div><span>Input</span><pre class="io">${esc(r.input)}</pre></div>
              <div><span>Output kamu</span><pre class="io">${esc(r.got || '(kosong)')}</pre></div>
              <div><span>Output seharusnya</span><pre class="io">${esc(r.expected)}</pre></div>
              ${r.stderr ? `<div><span>Stderr</span><pre class="io">${esc(r.stderr)}</pre></div>` : ''}
            </div>`;
        } else if (r.stderr) {
          detail = `<pre class="io" style="margin:.3rem 0 .6rem">${esc(r.stderr)}</pre>`;
        }
        return `<div class="tc"><span class="v v-${r.verdict}">${r.verdict}</span>
            <span>test ${r.no}${r.is_sample ? ' (contoh)' : ''}</span>
            <span class="grow"></span><span class="dim">${r.time_ms} ms</span></div>${detail}`;
      })
      .join('');

    body.innerHTML =
      head +
      (result.compile_output
        ? `<details><summary class="small dim">Peringatan compiler</summary><pre class="io">${esc(
            result.compile_output
          )}</pre></details>`
        : '') +
      rows;
  }

  function renderCustomResult(r) {
    const target = $('customOut') || $('consoleBody');
    target.innerHTML =
      `<div class="msg ${r.verdict === 'OK' ? 'ok' : 'warn'}">${esc(r.label || r.verdict)} &middot;
        ${r.time_ms} ms &middot; exit code ${r.exit_code}</div>
      <div class="small dim">Output</div><pre class="io">${esc(r.stdout || '(kosong)')}</pre>` +
      (r.stderr ? `<div class="small dim">Stderr</div><pre class="io">${esc(r.stderr)}</pre>` : '');
  }

  init();
})();
