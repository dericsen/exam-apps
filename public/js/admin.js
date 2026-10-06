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
    if (ms == null) return '-';
    const t = Math.max(0, Math.floor(ms / 1000));
    return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  }
  function fmtAgo(ms) {
    const s = Math.floor(ms / 1000);
    if (s < 60) return s + 's lalu';
    if (s < 3600) return Math.floor(s / 60) + 'm lalu';
    return Math.floor(s / 3600) + 'j lalu';
  }
  function jam(ts) {
    return new Date(ts).toLocaleTimeString('id-ID');
  }

  // -------------------------------------------------------------------------
  // Login
  // -------------------------------------------------------------------------
  async function fetchOverview(key) {
    const res = await fetch('/api/admin/overview?key=' + encodeURIComponent(key), {
      cache: 'no-store',
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      throw new Error(d.error || 'Gagal masuk');
    }
    return res.json();
  }

  async function enter(key) {
    const data = await fetchOverview(key);
    adminKey = key;
    try {
      sessionStorage.setItem(KEY_STORE, key);
    } catch (_) {}
    $('loginPane').classList.add('hidden');
    $('dash').classList.remove('hidden');
    paint(data);
    clearInterval(timer);
    timer = setInterval(() => {
      if ($('autoRefresh').checked) refresh();
    }, 5000);
  }

  $('loginBtn').onclick = async () => {
    $('loginErr').classList.add('hidden');
    try {
      await enter($('key').value.trim());
    } catch (e) {
      $('loginErr').textContent = e.message;
      $('loginErr').classList.remove('hidden');
    }
  };
  $('key').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('loginBtn').click();
  });

  async function refresh() {
    try {
      paint(await fetchOverview(adminKey));
    } catch (e) {
      console.warn(e.message);
    }
  }

  $('refreshBtn').onclick = refresh;
  $('exportBtn').onclick = () => {
    window.location = '/api/admin/export.csv?key=' + encodeURIComponent(adminKey);
  };
  $('resetAllBtn').onclick = async () => {
    if (
      !confirm(
        'HAPUS SEMUA data peserta dan mulai dari nol?\n\n' +
          'Gunakan hanya SEBELUM ujian dimulai (mis. setelah uji coba).\n' +
          'Jawaban yang sudah masuk akan hilang permanen.'
      )
    )
      return;
    if (!confirm('Konfirmasi sekali lagi: benar-benar hapus semua?')) return;
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
    const missing = (data.missing_languages || []).length
      ? ` PERINGATAN: bahasa diminta config tapi tidak terpasang: ${data.missing_languages.join(', ')}.`
      : '';
    $('dashMeta').textContent =
      `Durasi ${data.duration_min} menit per peserta sejak enroll. ` +
      `${data.cp_problem_count} soal CP diacak dari pool: ${data.cp_pool.join(', ')}. ` +
      `Bahasa aktif: ${data.languages.map((l) => l.label).join(', ') || '(tidak ada!)'}.` +
      missing +
      ` Jam server ${jam(data.server_time)}.`;

    const s = data.summary;
    $('summary').innerHTML =
      `Peserta <b>${s.total}</b> &middot; mengerjakan <b>${s.active}</b> &middot; ` +
      `selesai <b>${s.finished}</b> &middot; kena pelanggaran <b>${s.flagged}</b> &middot; ` +
      `diskualifikasi <b>${s.disqualified}</b>`;

    $('rows').innerHTML =
      data.attempts
        .map((a) => {
          const status =
            a.status === 'active'
              ? 'mengerjakan'
              : a.status === 'disqualified'
              ? '<span class="tag bad">diskualifikasi</span>'
              : 'selesai';

          const cpCell = a.cp_detail
            .map(
              (p) =>
                `<div class="small mono">${esc(p.id)} ${p.passed}/${p.total}` +
                `${p.solved ? ' <span class="tag ok">ok</span>' : ''}` +
                `<span class="dim"> (${p.attempts}x)</span></div>`
            )
            .join('');

          const viol = a.violation_count
            ? `<span class="tag ${a.violation_count >= data.max_violations ? 'bad' : 'warn'}">` +
              `${a.violation_count}/${data.max_violations}</span>` +
              `<div class="small dim">${esc(a.last_violation ? a.last_violation.kind : '')}</div>`
            : '<span class="dim">0</span>';

          const t = a.scores ? a.scores.tpks : null;

          return `<tr>
            <td title="${a.online ? 'online' : 'terakhir terlihat ' + fmtAgo(a.last_seen_ago_ms)}">
              ${a.online ? '&#9679;' : '<span class="dim">&#9675;</span>'}</td>
            <td>${esc(a.participant.nama)}
              <div class="small dim">${esc(a.participant.nim)} / ${esc(a.participant.kelas || '-')}</div></td>
            <td class="small">${status}
              ${a.finish_reason ? `<div class="small dim">${esc(a.finish_reason)}</div>` : ''}</td>
            <td class="num">${a.status === 'active' ? fmtMs(a.remaining_ms) : '-'}</td>
            <td class="num">${esc(a.tpks_progress)}${t ? `<div class="small dim">${t.correct} benar</div>` : ''}</td>
            <td>${cpCell}</td>
            <td>${viol}</td>
            <td class="num"><b>${a.final ? a.final.total : '-'}</b></td>
            <td class="small dim mono">${esc(a.ip)}</td>
            <td class="nowrap">
              <button class="sm" data-act="detail" data-sid="${a.sid}">Detail</button>
              <button class="sm" data-act="extend" data-sid="${a.sid}">+5m</button>
              <button class="sm" data-act="menu" data-sid="${a.sid}">Lain</button>
            </td>
          </tr>`;
        })
        .join('') ||
      '<tr><td colspan="10" class="center dim" style="padding:1.5rem">Belum ada peserta yang enroll.</td></tr>';
  }

  $('rows').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const { sid, act } = btn.dataset;
    if (act === 'detail') return showDetail(sid);
    if (act === 'extend') return action({ action: 'extend', sid, minutes: 5 });
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
      <p class="small dim">${esc(a.participant.nim)} &middot; ${esc(a.ip)} &middot;
        enroll ${jam(a.enrolled_at)} &middot; batas ${jam(a.ends_at)}</p>
      <div style="display:flex;flex-direction:column;gap:.4rem;margin-top:1rem">
        <button data-m="extend15">Tambah waktu 15 menit</button>
        <button data-m="reopen">Buka kembali ujian, beri 10 menit dari sekarang</button>
        <button data-m="clear">Hapus catatan pelanggaran</button>
        <button data-m="force_finish">Hentikan dan kumpulkan paksa</button>
        <button data-m="disqualify">Diskualifikasi peserta</button>
        <button data-m="close">Tutup</button>
      </div>
      <p class="small dim" style="margin-top:.8rem">
        "Buka kembali" dipakai kalau laptop peserta mati atau WiFi-nya putus lama.
      </p>`);

    $('modalHost').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-m]');
      if (!b) return;
      const m = b.dataset.m;
      closeModal();
      if (m === 'extend15') action({ action: 'extend', sid, minutes: 15 });
      else if (m === 'reopen') action({ action: 'reopen', sid, minutes: 10 });
      else if (m === 'clear') action({ action: 'clear_violations', sid });
      else if (m === 'force_finish') {
        if (confirm('Kumpulkan paksa jawaban peserta ini sekarang?')) {
          action({ action: 'force_finish', sid });
        }
      } else if (m === 'disqualify') {
        if (confirm('Diskualifikasi peserta ini? Sesinya tidak bisa dibuka lagi.')) {
          action({ action: 'disqualify', sid });
        }
      }
    });
  }

  async function showDetail(sid) {
    openModal('<p class="dim">Memuat...</p>');
    const res = await fetch(
      `/api/admin/attempt?key=${encodeURIComponent(adminKey)}&sid=${encodeURIComponent(sid)}`,
      { cache: 'no-store' }
    );
    const d = await res.json();
    if (!res.ok) return openModal(`<div class="msg err">${esc(d.error)}</div>`);

    const viol = d.violations.length
      ? '<table><tr><th>Jam</th><th>Jenis</th><th>Keterangan</th></tr>' +
        d.violations
          .map(
            (v) =>
              `<tr><td class="mono">${jam(v.at)}</td><td>${esc(v.kind)}</td>` +
              `<td class="small dim">${esc(v.detail || '')}</td></tr>`
          )
          .join('') +
        '</table>'
      : '<p class="dim small">Tidak ada pelanggaran tercatat.</p>';

    const cp = d.cp
      .map(
        (p) => `<div class="box">
          <div class="row between">
            <b>${esc(p.problem_id)} &mdash; ${esc(p.title)}</b>
            <span class="small dim">${p.submissions.length} submit, ${p.total_tests} test case</span>
          </div>
          ${
            p.submissions.length
              ? p.submissions
                  .map(
                    (s, i) => `<details>
                      <summary class="mono small">#${i + 1}
                        <span class="v-${s.verdict}">${s.verdict}</span>
                        ${s.passed}/${s.total} &middot; ${esc(s.language)} &middot;
                        ${s.max_time_ms}ms &middot; ${jam(s.at)}</summary>
                      <pre class="io">${esc(s.code)}</pre></details>`
                  )
                  .join('')
              : p.draft
              ? `<details><summary class="small dim">draft, belum pernah disubmit</summary>
                   <pre class="io">${esc(p.draft.code || '')}</pre></details>`
              : '<p class="small dim" style="margin:.3rem 0 0">Belum ada kiriman.</p>'
          }
        </div>`
      )
      .join('');

    const tpks =
      '<table><tr><th>No</th><th>ID</th><th>Soal</th><th>Jawab</th><th>Kunci</th><th></th></tr>' +
      d.tpks
        .map(
          (q) => `<tr>
            <td class="num">${q.no}</td>
            <td class="small dim mono">${esc(q.qid)}</td>
            <td class="small">${esc(q.q.slice(0, 80))}${q.q.length > 80 ? '...' : ''}</td>
            <td class="mono">${q.picked || '-'}</td>
            <td class="mono">${q.correct}</td>
            <td class="small">${
              q.picked == null
                ? '<span class="dim">kosong</span>'
                : q.is_correct
                ? '<span class="tag ok">benar</span>'
                : '<span class="tag bad">salah</span>'
            }</td></tr>`
        )
        .join('') +
      '</table>';

    openModal(`
      <div class="row between">
        <div>
          <h2 style="margin:0">${esc(d.participant.nama)}</h2>
          <span class="small dim">${esc(d.participant.nim)} / ${esc(d.participant.kelas || '-')} &middot;
            ${esc(d.ip)} &middot; status ${esc(d.status)} &middot;
            nilai akhir <b>${d.final ? d.final.total : '-'}</b></span>
        </div>
        <button class="sm" onclick="document.getElementById('modalHost').innerHTML=''">Tutup</button>
      </div>
      <p class="small dim" style="margin-top:.4rem">
        Enroll ${jam(d.enrolled_at)} &middot; batas ${jam(d.ends_at)} &middot;
        ${esc(d.user_agent || '')}
      </p>

      <h3 style="margin-top:1rem">Pelanggaran lockdown</h3>
      ${viol}

      <h3 style="margin-top:1rem">Competitive Programming</h3>
      ${cp}

      <h3 style="margin-top:1rem">Rincian TPKS</h3>
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
      await enter(saved);
    } catch (_) {
      /* kunci lama tidak valid, tampilkan form login */
    }
  })();
})();
