'use strict';
/**
 * Helper HTTP minimalis: routing, body parsing, static file, dan JSON response.
 * Sengaja tanpa dependency agar aplikasi bisa dijalankan di lab offline
 * cukup dengan `node server.js`.
 */

const fs = require('fs');
const path = require('path');
const url = require('url');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
};

const MAX_BODY = 512 * 1024; // 512 KB, cukup untuk kiriman kode peserta

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function sendText(res, status, text, contentType) {
  res.writeHead(status, {
    'Content-Type': contentType || 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('Body terlalu besar'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (_) {
        reject(new Error('Body bukan JSON yang valid'));
      }
    });
    req.on('error', reject);
  });
}

function serveStatic(root, pathname, res) {
  // Cegah path traversal: resolve lalu pastikan masih di dalam root.
  const rel = decodeURIComponent(pathname).replace(/^\/+/, '');
  const target = path.resolve(root, rel === '' ? 'index.html' : rel);
  if (!target.startsWith(path.resolve(root))) {
    sendText(res, 403, 'Forbidden');
    return true;
  }
  let stat;
  try {
    stat = fs.statSync(target);
  } catch (_) {
    return false;
  }
  const file = stat.isDirectory() ? path.join(target, 'index.html') : target;
  if (!fs.existsSync(file)) return false;

  const ext = path.extname(file).toLowerCase();
  const data = fs.readFileSync(file);
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': data.length,
    // Halaman ujian tidak boleh di-cache agar peserta selalu dapat versi terbaru.
    'Cache-Control': 'no-store',
  });
  res.end(data);
  return true;
}

/** Router sederhana: daftarkan handler per "METHOD /path". */
function createRouter() {
  const routes = new Map();
  return {
    on(method, pathname, handler) {
      routes.set(`${method} ${pathname}`, handler);
      return this;
    },
    async handle(req, res) {
      const parsed = url.parse(req.url, true);
      const key = `${req.method} ${parsed.pathname}`;
      const handler = routes.get(key);
      if (!handler) return false;
      let body = {};
      if (req.method === 'POST' || req.method === 'PUT') {
        body = await readBody(req);
      }
      await handler({ req, res, query: parsed.query, body, pathname: parsed.pathname });
      return true;
    },
  };
}

module.exports = { sendJson, sendText, readBody, serveStatic, createRouter, MIME };
