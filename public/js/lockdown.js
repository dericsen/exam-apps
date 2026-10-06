/* ==========================================================================
   Lockdown mode ujian.

   BATASAN YANG HARUS DIPAHAMI PANITIA:
   Sebuah halaman web TIDAK diizinkan browser untuk memblokir Alt+Tab, menutup
   aplikasi lain, atau mematikan tombol Windows. Itu wewenang sistem operasi.
   Yang bisa dilakukan lapisan ini:

     1. Memaksa ujian berjalan dalam mode fullscreen.
     2. MENDETEKSI setiap kali peserta keluar fullscreen, memindah tab, atau
        memindah fokus ke aplikasi lain -- lalu mencatatnya ke server.
     3. Menutupi layar ujian dengan overlay sampai peserta kembali, sehingga
        soal tidak bisa dibaca sambil membuka aplikasi lain.
     4. Memblokir klik kanan, copy-paste, dan shortcut devtools.
     5. Membubarkan ujian otomatis setelah pelanggaran melebihi batas.

   Untuk kunci yang benar-benar keras, jalankan browser dalam kiosk mode
   (lihat README) atau gunakan Safe Exam Browser. Kombinasi kiosk + lapisan ini
   sudah sangat memadai untuk seleksi internal.
   ========================================================================== */
(function () {
  'use strict';

  const DEBOUNCE_MS = 1500;

  let cfg = {};
  let handlers = {};
  let armed = false;
  let paused = false; // true saat overlay pelanggaran sedang tampil
  let lastViolation = { kind: null, at: 0 };
  let overlayEl = null;
  let countdownTimer = null;

  function isFullscreen() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement);
  }

  async function goFullscreen() {
    const el = document.documentElement;
    try {
      if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
      else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
      return true;
    } catch (err) {
      return false;
    }
  }

  function report(kind, detail) {
    const now = Date.now();
    // Satu aksi fisik peserta sering memicu beberapa event sekaligus
    // (blur + visibilitychange + fullscreenchange). Hitung sebagai satu.
    if (now - lastViolation.at < DEBOUNCE_MS) return;
    lastViolation = { kind, at: now };
    if (handlers.onViolation) handlers.onViolation(kind, detail);
  }

  // -------------------------------------------------------------------------
  // Overlay
  // -------------------------------------------------------------------------
  function buildOverlay() {
    if (overlayEl) return overlayEl;
    overlayEl = document.createElement('div');
    overlayEl.className = 'overlay hidden';
    overlayEl.innerHTML = `
      <div class="overlay-box">
        <h2 id="ldTitle">Kamu keluar dari mode ujian</h2>
        <p id="ldMsg"></p>
        <div class="msg warn" id="ldCount"></div>
        <button id="ldResume" class="primary block">Kembali ke ujian</button>
        <p class="small dim" style="margin:.7rem 0 0">
          Waktu ujian tetap berjalan selama layar ini tampil.
        </p>
      </div>`;
    document.body.appendChild(overlayEl);
    overlayEl.querySelector('#ldResume').addEventListener('click', resume);
    return overlayEl;
  }

  function showViolationOverlay(message, count, max) {
    paused = true;
    const el = buildOverlay();
    el.querySelector('#ldMsg').textContent = message;
    el.querySelector('#ldCount').textContent =
      max > 0
        ? `Pelanggaran tercatat: ${count} dari ${max}. Ujian otomatis dikumpulkan jika melewati batas.`
        : `Pelanggaran tercatat: ${count}.`;
    el.classList.remove('hidden');

    const btn = el.querySelector('#ldResume');
    const grace = Number(cfg.grace_seconds_per_violation || 0);
    if (grace > 0) {
      let left = grace;
      btn.disabled = true;
      btn.textContent = `Kembali ke ujian (${left})`;
      clearInterval(countdownTimer);
      countdownTimer = setInterval(() => {
        left -= 1;
        if (left <= 0) {
          clearInterval(countdownTimer);
          btn.disabled = false;
          btn.textContent = 'Kembali ke ujian';
        } else {
          btn.textContent = `Kembali ke ujian (${left})`;
        }
      }, 1000);
    } else {
      btn.disabled = false;
      btn.textContent = 'Kembali ke ujian';
    }
  }

  async function resume() {
    if (cfg.require_fullscreen && !isFullscreen()) {
      const ok = await goFullscreen();
      if (!ok) {
        const msg = buildOverlay().querySelector('#ldMsg');
        msg.textContent =
          'Browser menolak masuk fullscreen. Tekan F11 atau izinkan fullscreen, lalu klik tombol ini lagi.';
        return;
      }
    }
    hideOverlay();
  }

  function hideOverlay() {
    clearInterval(countdownTimer);
    paused = false;
    if (overlayEl) overlayEl.classList.add('hidden');
  }

  /** Overlay informasi (bukan pelanggaran) -- dipakai saat ujian selesai/dihentikan. */
  function showNotice(title, message, actionLabel, action) {
    paused = true;
    const el = buildOverlay();
    el.querySelector('#ldTitle').textContent = title;
    el.querySelector('#ldMsg').textContent = message;
    el.querySelector('#ldCount').classList.add('hidden');
    const btn = el.querySelector('#ldResume');
    btn.disabled = false;
    btn.textContent = actionLabel || 'Tutup';
    btn.onclick = action || hideOverlay;
    el.classList.remove('hidden');
  }

  // -------------------------------------------------------------------------
  // Event listeners
  // -------------------------------------------------------------------------
  function onFullscreenChange() {
    if (!armed || !cfg.require_fullscreen) return;
    if (!isFullscreen()) {
      report('exit_fullscreen', 'keluar dari mode fullscreen');
    }
  }

  function onVisibility() {
    if (!armed) return;
    if (document.visibilityState === 'hidden') {
      report('tab_hidden', 'tab ujian disembunyikan / pindah tab');
    }
  }

  function onBlur() {
    if (!armed || !cfg.warn_on_blur) return;
    report('window_blur', 'fokus pindah ke aplikasi atau jendela lain');
  }

  function onContextMenu(e) {
    if (!armed || !cfg.block_context_menu) return;
    e.preventDefault();
  }

  function isCodeField(el) {
    return el && el.dataset && el.dataset.allowEditing === 'true';
  }

  function onCopyCut(e) {
    if (!armed) return;
    if (isCodeField(e.target)) return; // peserta boleh copy di editornya sendiri
    if (cfg.block_copy_paste_mcq) e.preventDefault();
  }

  function onPaste(e) {
    if (!armed) return;
    if (isCodeField(e.target)) {
      if (cfg.block_paste_code) {
        e.preventDefault();
        if (handlers.onBlockedPaste) handlers.onBlockedPaste();
        report('paste_code', 'mencoba menempel kode dari luar');
      }
      return;
    }
    if (cfg.block_copy_paste_mcq) e.preventDefault();
  }

  function onKeyDown(e) {
    if (!armed) return;
    const k = (e.key || '').toLowerCase();

    if (cfg.block_devtools_keys) {
      const devtools =
        e.key === 'F12' ||
        ((e.ctrlKey || e.metaKey) && e.shiftKey && ['i', 'j', 'c'].includes(k));
      if (devtools) {
        e.preventDefault();
        report('devtools_key', 'mencoba membuka developer tools');
        return;
      }
      // Lihat source / print / simpan halaman.
      if ((e.ctrlKey || e.metaKey) && ['u', 'p', 's'].includes(k) && !isCodeField(e.target)) {
        e.preventDefault();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && k === 's' && isCodeField(e.target)) {
        e.preventDefault(); // Ctrl+S di editor: jangan simpan halaman
        if (handlers.onSaveShortcut) handlers.onSaveShortcut();
        return;
      }
    }

    // F5 / Ctrl+R: reload diizinkan (penting saat WiFi putus) tapi dicatat,
    // karena reload berulang bisa jadi upaya mengakali timer.
    if (e.key === 'F5' || ((e.ctrlKey || e.metaKey) && k === 'r')) {
      // tidak di-preventDefault: state ujian disimpan di server, reload aman.
    }
  }

  function onBeforeUnload(e) {
    if (!armed) return;
    e.preventDefault();
    e.returnValue = 'Ujian masih berlangsung. Yakin ingin keluar?';
    return e.returnValue;
  }

  // -------------------------------------------------------------------------
  // API publik
  // -------------------------------------------------------------------------
  const Lockdown = {
    /** Pasang semua listener. Belum fullscreen -- fullscreen butuh gesture user. */
    arm(lockdownConfig, hooks) {
      cfg = lockdownConfig || {};
      handlers = hooks || {};
      if (armed) return;
      armed = true;

      document.addEventListener('fullscreenchange', onFullscreenChange);
      document.addEventListener('webkitfullscreenchange', onFullscreenChange);
      document.addEventListener('visibilitychange', onVisibility);
      window.addEventListener('blur', onBlur);
      document.addEventListener('contextmenu', onContextMenu);
      document.addEventListener('copy', onCopyCut);
      document.addEventListener('cut', onCopyCut);
      document.addEventListener('paste', onPaste);
      document.addEventListener('keydown', onKeyDown, true);
      window.addEventListener('beforeunload', onBeforeUnload);
      document.addEventListener('dragstart', (e) => {
        if (!isCodeField(e.target)) e.preventDefault();
      });
    },

    disarm() {
      armed = false;
      hideOverlay();
      window.removeEventListener('beforeunload', onBeforeUnload);
    },

    enterFullscreen: goFullscreen,
    isFullscreen,
    isArmed: () => armed,
    isPaused: () => paused,
    showViolationOverlay,
    showNotice,
    hideOverlay,
  };

  window.Lockdown = Lockdown;
})();
