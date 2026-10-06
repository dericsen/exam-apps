/* Pembungkus fetch: menyisipkan session id, menangani error, dan memberi
   sinyal saat koneksi ke server ujian terputus (WiFi lab suka ngadat). */
(function () {
  'use strict';

  const SID_KEY = 'exam.sid';

  const listeners = { offline: [], online: [] };
  let offline = false;

  function setOffline(value) {
    if (offline === value) return;
    offline = value;
    (value ? listeners.offline : listeners.online).forEach((fn) => fn());
  }

  async function request(method, url, body) {
    const headers = {};
    const sid = getSid();
    if (sid) headers['X-Sid'] = sid;
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    let res;
    try {
      res = await fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: 'no-store',
      });
    } catch (err) {
      setOffline(true);
      const e = new Error('Tidak bisa menghubungi server ujian. Periksa koneksi WiFi.');
      e.network = true;
      throw e;
    }
    setOffline(false);

    let data = null;
    const text = await res.text();
    if (text) {
      try {
        data = JSON.parse(text);
      } catch (_) {
        data = { error: text };
      }
    }

    if (!res.ok) {
      const e = new Error((data && data.error) || `Error ${res.status}`);
      e.status = res.status;
      e.data = data;
      throw e;
    }
    return data;
  }

  function getSid() {
    try {
      return localStorage.getItem(SID_KEY);
    } catch (_) {
      return null;
    }
  }
  function setSid(sid) {
    try {
      localStorage.setItem(SID_KEY, sid);
    } catch (_) {}
  }
  function clearSid() {
    try {
      localStorage.removeItem(SID_KEY);
    } catch (_) {}
  }

  window.API = {
    get: (url) => request('GET', url),
    post: (url, body) => request('POST', url, body || {}),
    getSid,
    setSid,
    clearSid,
    isOffline: () => offline,
    onOffline: (fn) => listeners.offline.push(fn),
    onOnline: (fn) => listeners.online.push(fn),
  };
})();
