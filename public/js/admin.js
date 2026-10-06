/* Dashboard pengawas: pantau peserta, pelanggaran, nilai, dan jalankan aksi. */
(function () {
  'use strict';

  const KEY_STORE = 'exam.adminKey';
  let adminKey = null;
  let timer = null;
  let lastData = null;

  const $ = (id) => document.getElementById(id);
  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"]/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])
    );

  function fmtMs(ms) {
    if (ms == null) return '—';
    const t = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(t / 60);
    const s = t % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function fmtAgo(ms) {
    const s = Math.floor(ms / 1000);
    if (s < 60) return s + 's lalu';
    if (s < 3600) return Math.floor(s / 60) + 'm lalu';
    return Math.floor(s / 3600) + 'j lalu';
  }

  // -------------------------------------------------------------------------
  // Login
  // -------------------------------------------------------------------------
  async function tryLogin(key) {
    const res = await fetch('/api/admin/overview?key=' + encodeURIComponent(key), {
      cache: 'no-store',
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      throw new Error(d.error || 'Gagal masuk');
    }
    return res.json();
  }

  $('loginBtn').onclick = async () => {
    const key = $('key').value.trim();
    $('loginErr').classList.add('hidden');
    try {
      const data = await tryLogin(key);
      adminKey = key;
      try {
        sessionStorage.setItem(KEY_STORE, key);
      } catch (_) {}
      $('loginPane').classList.add('hidden');
      $('dash').classList.remove('hidden');
      paint(data);
      startAuto();
    } catch (e) {
      $('loginErr').textContent = e.message;
      $('loginErr').classList.remove('hidden');
    }
  };
  $('key').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('loginBtn').click();
  });

  // -------------------------------------------------------------------------
  // Refresh loop
  // -------------------------------------------------------------------------
  async function refresh() {
    try {
      paint(await tryLogin(adminKey));
    } catch (e) {
      console.warn(e.message);
    }
  }

  function startAuto() {
    clearInterval(timer);
    timer = setInterval(() => {
      if ($('autoRefresh').checked) refresh();
    }, 5000);
  }

  $('refreshBtn').onclick = refresh;
  $('exportBtn').onclick = () => {
    window.location = '/api/admin/export.csv?key=' + encodeURIComponent(adminKey);
  };
  $('resetAllBtn').onclick = async () => {
    if (
      !confirm(
        'HAPUS SEMUA data peserta dan mulai dari nol?\n\n' +
          'Gunakan ini hanya SEBELUM ujian dimulai (mis. setelah uji coba).\n' +
          'Data jawaban yang sudah masuk akan hilang permanen.'
      )
    )
      return;
    if (!confirm('Konfirmasi sekali lagi: benar-benar hapus semua attempt?')) return;
    await action({ action: 'reset_all' });
  };

  async function action(payload) {
    const res = await fetch('/api/admin/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Key': adminKey },
      body: JSON.stringify({ ...payload, key: adminKey }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) alert(d.error || 'Aksi gagal');
    refresh();
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  function paint(data) {
    lastData = data;
    $('dashTitle').textContent = data.exam_title;
    $('dashMeta').textContent =
      `Bahasa judge: ${data.languages.map((l) => l.label).join(', ')} · ` +
      `Soal CP: ${data.problems.map((p) => p.id).join(', ')} · ` +
      `Server: ${new Date(data.server_time).toLocaleTimeString('id-ID')}`;

    if (data.sections[0]) $('thSec1').textContent = data.sections[0].name;
    if (data.sections[1]) $('thSec2').textContent = data.sections[1].name;

    const s = data.summary;
    $('stats').innerHTML = [
      ['Peserta', s.total, ''],
      ['Mengerjakan', s.active, ''],
      ['Selesai', s.finished, ''],
      ['Kena pelanggaran', s.flagged, s.flagged ? 'color:#f0c674' : ''],
      ['Didiskualifikasi', s.disqualified, s.disqualified ? 'color:#ffb3ad' : ''],
    ]
      .map(
        ([l, n, style]) =>
          `<div class="stat"><div class="n" style="${style}">${n}</div><div class="l">${l}</div></div>`
      )
      .join('');

    const secIds = data.sections.map((x) => x.id);

    $('rows').innerHTML = data.attempts
      .map((a) => {
        const statusBadge =
          a.status === 'active'
            ? '<span class="badge blue">mengerjakan</span>'
            : a.status === 'finished'
            ? '<span class="badge green">selesai</span>'
            : a.status === 'disqualified'
            ? '<span class="badge red">diskualifikasi</span>'
            : '<span class="badge gray">siap</span>';

        const cell = (sid) => {
          const sec = a.sections[sid];
          if (!sec) return '—';
          const label =
            sec.status === 'active'
              ? `<span class="mono">${fmtMs(sec.remaining_ms)}</span>`
              : sec.status === 'finished'
              ? `<span class="badge green">selesai</span>`
              : `<span class="badge gray">belum</span>`;
          return `${label}<div class="faint">${esc(sec.progress)}</div>`;
        };

        const violCell = a.violation_count
          ? `<span class="badge ${
              a.violation_count >= data.max_violations ? 'red' : 'yellow'
            }">${a.violation_count}/${data.max_violations}</span>
             <div class="faint">${esc(a.last_violation ? a.last_violation.kind : '')}</div>`
          : '<span class="faint">0</span>';

        const t = a.scores && a.scores[secIds[0]] ? a.scores[secIds[0]] : null;
        const c = a.scores && a.scores[secIds[1]] ? a.scores[secIds[1]] : null;

        return `<tr>
          <td><span class="${a.online ? 'dot-online' : 'dot-offline'}"
                 title="${a.online ? 'online' : 'terakhir terlihat ' + fmtAgo(a.last_seen_ago_ms)}"></span></td>
          <td><strong>${esc(a.participant.nama)}</strong>
              <div class="faint">${esc(a.participant.nim)} · ${esc(a.participant.kelas || '-')}</div></td>
          <td>${statusBadge}</td>
          <td>${cell(secIds[0])}</td>
          <td>${cell(secIds[1])}</td>
          <td>${violCell}</td>
          <td class="num">${t ? t.correct + '/' + t.total : '—'}</td>
          <td class="num">${c ? c.solved_count + '/' + c.problem_count : '—'}</td>
          <td class="num"><strong>${a.final ? a.final.total : '—'}</strong></td>
          <td class="faint mono">${esc(a.ip)}</td>
          <td>
            <button class="ghost sm" data-act="detail" data-sid="${a.sid}">Detail</button>
            <button class="ghost sm" data-act="extend" data-sid="${a.sid}">+5m</button>
            <button class="ghost sm" data-act="clear_violations" data-sid="${a.sid}">Maafkan</button>
            <button class="ghost sm" data-act="menu" data-sid="${a.sid}">⋯</button>
          </td>
        </tr>`;
      })
      .join('');

    if (!data.attempts.length) {
      $('rows').innerHTML =
        '<tr><td colspan="11" class="center faint" style="padding:2rem">Belum ada peserta yang login.</td></tr>';
    }
  }

  $('rows').addEventListener('click', async (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const sid = btn.dataset.sid;
    const act = btn.dataset.act;

    if (act === 'detail') return showDetail(sid);
    if (act === 'extend') return action({ action: 'extend', sid, minutes: 5 });
    if (act === 'clear_violations') {
      if (confirm('Hapus catatan pelanggaran peserta ini?')) action({ action: 'clear_violations', sid });
      return;
    }
    if (act === 'menu') return showMenu(sid);
  });

  function closeModal() {
    $('modalHost').innerHTML = '';
  }

  function openModal(html) {
    $('modalHost').innerHTML = `<div class="modal-back"><div class="modal">${html}</div></div>`;
    $('modalHost').querySelector('.modal-back').addEventListener('click', (e) => {
      if (e.target.classList.contains('modal-back')) closeModal();
    });
  }

  function showMenu(sid) {
    const a = lastData.attempts.find((x) => x.sid === sid);
    openModal(`
      <h2>${esc(a.participant.nama)}</h2>
      <p class="faint">${esc(a.participant.nim)} · ${esc(a.ip)}</p>
      <div class="row" style="flex-direction:column;align-items:stretch;gap:.5rem;margin-top:1rem">
        <button class="ghost" data-m="extend15">Tambah waktu 15 menit</button>
        <button class="ghost" data-m="reopen">Buka kembali bagian terakhir (+10 menit)</button>
        <button class="ghost" data-m="force_finish">Hentikan &amp; kumpulkan paksa</button>
        <button class="danger" data-m="disqualify">Diskualifikasi peserta</button>
        <button class="ghost" data-m="close">Tutup</button>
      </div>
      <p class="faint" style="margin-top:1rem">
        "Buka kembali" berguna kalau laptop peserta mati atau WiFi-nya putus lama.
      </p>`);

    $('modalHost').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-m]');
      if (!b) return;
      const m = b.dataset.m;
      closeModal();
      if (m === 'extend15') action({ action: 'extend', sid, minutes: 15 });
      else if (m === 'reopen') action({ action: 'reopen', sid, minutes: 10 });
      else if (m === 'force_finish') {
        if (confirm('Kumpulkan paksa semua bagian peserta ini?')) action({ action: 'force_finish', sid });
      } else if (m === 'disqualify') {
        if (confirm('Diskualifikasi peserta ini? Sesinya tidak bisa dibuka lagi.'))
          action({ action: 'disqualify', sid });
      }
    });
  }

  async function showDetail(sid) {
    openModal('<p class="dim">Memuat…</p>');
    const res = await fetch(
      `/api/admin/attempt?key=${encodeURIComponent(adminKey)}&sid=${encodeURIComponent(sid)}`,
      { cache: 'no-store' }
    );
    const d = await res.json();
    if (!res.ok) return openModal(`<div class="alert err">${esc(d.error)}</div>`);

    const viol = d.violations.length
      ? d.violations
          .map(
            (v) =>
              `<div class="verdict-row"><span class="v v-WA">${esc(v.kind)}</span>
                 <span class="dim">${esc(v.detail || '')}</span><div class="grow"></div>
                 <span class="faint">${new Date(v.at).toLocaleTimeString('id-ID')}</span></div>`
          )
          .join('')
      : '<p class="faint">Tidak ada pelanggaran tercatat.</p>';

    const tpks = d.tpks.length
      ? `<table><thead><tr><th>No</th><th>ID</th><th>Soal</th><th>Jawab</th><th>Kunci</th><th></th></tr></thead>
         <tbody>${d.tpks
           .map(
             (q) => `<tr>
               <td>${q.no}</td>
               <td class="faint mono">${esc(q.qid)}</td>
               <td>${esc(q.q.slice(0, 90))}${q.q.length > 90 ? '…' : ''}</td>
               <td class="mono">${q.picked || '—'}</td>
               <td class="mono">${q.correct}</td>
               <td>${
                 q.picked == null
                   ? '<span class="badge gray">kosong</span>'
                   : q.is_correct
                   ? '<span class="badge green">benar</span>'
                   : '<span class="badge red">salah</span>'
               }</td></tr>`
           )
           .join('')}</tbody></table>`
      : '<p class="faint">Belum ada paket soal TPKS.</p>';

    const cp = d.cp
      .map(
        (p) => `<div class="card tight">
          <div class="row between">
            <strong>${esc(p.problem_id)} — ${esc(p.title)}</strong>
            <span class="faint">${p.submissions.length} submit</span>
          </div>
          ${
            p.submissions.length
              ? p.submissions
                  .map(
                    (s, i) => `<details style="margin-top:.4rem">
                      <summary class="mono" style="cursor:pointer">
                        #${i + 1} <span class="v-${s.verdict}">${s.verdict}</span>
                        ${s.passed}/${s.total} · ${esc(s.language)} · ${s.max_time_ms}ms ·
                        ${new Date(s.at).toLocaleTimeString('id-ID')}
                      </summary>
                      <pre class="io">${esc(s.code)}</pre>
                    </details>`
                  )
                  .join('')
              : p.draft
              ? `<details style="margin-top:.4rem"><summary class="faint">draft belum disubmit</summary>
                   <pre class="io">${esc(p.draft.code || '')}</pre></details>`
              : '<p class="faint" style="margin:.3rem 0 0">Belum ada kiriman.</p>'
          }
        </div>`
      )
      .join('');

    openModal(`
      <div class="row between">
        <div>
          <h2 style="margin:0">${esc(d.participant.nama)}</h2>
          <span class="faint">${esc(d.participant.nim)} · ${esc(d.participant.kelas || '-')} ·
            ${esc(d.ip)} · nilai akhir <strong>${d.final ? d.final.total : '—'}</strong></span>
        </div>
        <button class="ghost sm" onclick="document.getElementById('modalHost').innerHTML=''">Tutup</button>
      </div>
      <p class="faint mono" style="margin-top:.5rem">${esc(d.user_agent || '')}</p>

      <h3 style="margin-top:1.25rem">Pelanggaran Lockdown</h3>
      ${viol}

      <h3 style="margin-top:1.25rem">Competitive Programming</h3>
      ${cp}

      <h3 style="margin-top:1.25rem">Rincian TPKS</h3>
      <div style="max-height:300px;overflow:auto">${tpks}</div>
    `);
  }

  // Coba pakai kunci yang tersimpan di tab ini.
  (async function auto() {
    let saved = null;
    try {
      saved = sessionStorage.getItem(KEY_STORE);
    } catch (_) {}
    if (!saved) return;
    try {
      const data = await tryLogin(saved);
      adminKey = saved;
      $('loginPane').classList.add('hidden');
      $('dash').classList.remove('hidden');
      paint(data);
      startAuto();
    } catch (_) {
      /* kunci lama tidak valid, tampilkan form login */
    }
  })();
})();
