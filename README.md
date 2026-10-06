# Exam Apps — Ujian LAN dengan Lockdown

Aplikasi ujian yang dijalankan dari satu laptop dan diakses peserta lewat WiFi lokal.
Dua bagian ujian: **TPKS** (pilihan ganda) dan **Competitive Programming** (auto-judge).

Tanpa dependency. Tanpa `npm install`. Tanpa internet. Cukup **Node.js 18+**.

```bash
node server.js
```

---

## Daftar Isi

- [Mulai Cepat](#mulai-cepat)
- [Menyebarkan ke WiFi](#menyebarkan-ke-wifi)
- [Soal lockdown — baca ini](#soal-lockdown--baca-ini)
- [Mode Kiosk (lockdown keras)](#mode-kiosk-lockdown-keras)
- [Bank Soal](#bank-soal)
- [Konfigurasi](#konfigurasi)
- [Dashboard Pengawas](#dashboard-pengawas)
- [Penilaian](#penilaian)
- [Keamanan Judge](#keamanan-judge)
- [Tools](#tools)
- [Saat Ujian Berlangsung](#saat-ujian-berlangsung)
- [Struktur Proyek](#struktur-proyek)

---

## Mulai Cepat

```bash
# 1. Periksa Node.js (butuh 18 atau lebih baru)
node -v

# 2. Ganti kunci admin + kode akses
#    Edit config.json -> "admin_key" dan "registration.access_code"

# 3. Pastikan bank soal CP sehat (reference solution harus AC semua)
node tools/verify_cp.js

# 4. Jalankan
node server.js
```

Output saat server hidup akan langsung memberi tahu alamat yang dibagikan ke peserta:

```
==================================================================
  Seleksi Tim Riset & Proyek Ilmu Komputer 2026
==================================================================
  Peserta  : http://192.168.1.10:3000
  Pengawas : http://192.168.1.10:3000/admin.html
  Kode akses peserta : CS2026
  Kunci admin        : ...
==================================================================
  Bagian   : TPKS (45 menit) -> Competitive Programming (90 menit)
  Soal CP  : E-001, E-004, E-008, E-011, E-012
  Bahasa   : Python 3 [Python 3.11.9], C++ 17 [g++ ...], JavaScript (Node)
==================================================================
```

---

## Menyebarkan ke WiFi

1. **Laptop panitia dan semua peserta harus berada di WiFi/SSID yang sama.**
   Hotspot HP juga bisa, tapi WiFi router lebih stabil untuk >15 peserta.

2. **Cari IP laptop panitia** (server mencetaknya otomatis, atau cek manual):

   | OS | Perintah |
   |---|---|
   | Windows | `ipconfig` → lihat *IPv4 Address* |
   | macOS | `ipconfig getifaddr en0` |
   | Linux | `hostname -I` |

3. **Izinkan port di firewall.** Ini penyebab #1 "kok nggak bisa dibuka":

   ```powershell
   # Windows (jalankan PowerShell sebagai Administrator)
   New-NetFirewallRule -DisplayName "Exam App" -Direction Inbound -LocalPort 3000 -Protocol TCP -Action Allow
   ```

   ```bash
   # Linux (firewalld)
   sudo firewall-cmd --add-port=3000/tcp
   # Linux (ufw)
   sudo ufw allow 3000/tcp
   ```

   macOS biasanya cukup menekan **Allow** pada dialog yang muncul.

4. **Tulis alamatnya di papan tulis**, misalnya `http://192.168.1.10:3000`.

5. **Uji dari satu HP/laptop peserta dulu** sebelum ujian resmi dimulai.

> **Isolasi klien / AP Isolation:** beberapa router hotel atau kampus memblokir
> komunikasi antar perangkat. Kalau peserta tidak bisa membuka alamat sama sekali
> padahal firewall sudah dibuka, matikan "AP isolation" di router atau pakai
> hotspot HP panitia.

---

## Soal lockdown — baca ini

**Sebuah halaman web tidak bisa mengunci sistem operasi.** Browser sengaja tidak
mengizinkan halaman mana pun memblokir Alt+Tab, menutup aplikasi lain, atau
mematikan tombol Windows. Siapa pun yang menjanjikan sebaliknya dari web app murni
sedang keliru.

Yang **benar-benar dilakukan** aplikasi ini:

| Mekanisme | Efek |
|---|---|
| Wajib fullscreen | Ujian tidak bisa dimulai tanpa masuk mode layar penuh |
| Deteksi keluar fullscreen | Tercatat sebagai pelanggaran + layar soal ditutup overlay |
| Deteksi pindah tab / minimize | `visibilitychange` → pelanggaran |
| Deteksi pindah aplikasi | `window.blur` → pelanggaran (ini yang menangkap Alt+Tab) |
| Overlay penghalang | Begitu peserta keluar, soal **langsung tertutup**. Mau nyontek pun soalnya tidak kelihatan |
| Blokir klik kanan, copy, paste | Soal tidak bisa disalin keluar, kode tidak bisa ditempel masuk |
| Blokir F12 / Ctrl+Shift+I / Ctrl+U | Devtools dan view-source dihalangi |
| Timer di sisi server | Reload, tutup browser, atau cabut WiFi **tidak** menghentikan waktu |
| Auto-submit | Setelah `max_violations` pelanggaran, ujian dikumpulkan paksa dan ditutup |
| Log audit | Semua pelanggaran tercatat beserta jam, jenis, dan terlihat pengawas real-time |

Jadi kecurangan tidak dicegah secara fisik, tapi **selalu tertangkap dan tercatat**,
dan soalnya tertutup saat peserta berpaling. Untuk seleksi internal, kombinasi ini
plus mode kiosk di bawah sudah sangat memadai.

**Yang tidak bisa dideteksi:** HP kedua, teman di sebelah, atau laptop kedua.
Pengawasan fisik di ruangan tetap diperlukan.

---

## Mode Kiosk (lockdown keras)

Jalankan browser peserta dalam kiosk mode. Tidak ada address bar, tidak ada tab,
tidak ada tombol close — peserta hanya melihat halaman ujian.

**Windows** (buat file `ujian.bat` di desktop tiap PC, ganti IP-nya):

```bat
@echo off
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" ^
  --kiosk --app=http://192.168.1.10:3000 ^
  --disable-features=TranslateUI ^
  --disable-extensions ^
  --no-first-run ^
  --user-data-dir="%TEMP%\exam-profile"
```

**macOS:**

```bash
open -na "Google Chrome" --args --kiosk --app=http://192.168.1.10:3000 \
  --user-data-dir=/tmp/exam-profile
```

**Linux:**

```bash
google-chrome --kiosk --app=http://192.168.1.10:3000 \
  --user-data-dir=/tmp/exam-profile
```

`--user-data-dir` yang terpisah penting: peserta tidak membawa cookie, history,
atau akun Google pribadinya ke sesi ujian.

**Kalau butuh kunci total** (lab terkontrol, peserta tidak boleh keluar sama sekali):

- **Windows Assigned Access / Kiosk Mode** — Settings → Accounts → *Other users* →
  *Set up a kiosk*. Peserta hanya bisa menjalankan satu aplikasi, Alt+Tab mati total.
- **[Safe Exam Browser](https://safeexambrowser.org/)** — gratis, open source, dibuat
  khusus untuk ujian. Arahkan ke `http://IP:3000`. Ini yang dipakai universitas.

---

## Bank Soal

### TPKS — `data/tpks.json`

150 entri, 140 unik: 50 A_PATTERN (pola & deret), 50 B_LOGIC (logika), 50 C_ANALYTIC (analitis).
Setiap peserta menerima **30 soal** (10 per tipe), diacak dan unik per peserta.

Bank aslinya memuat banyak soal yang isinya identik — soal deret `2, 6, 12, 20, 30`
saja muncul belasan kali. Server mengelompokkan soal yang teksnya praktis sama dan
hanya mengambil **satu wakil per kelompok**, sehingga peserta tidak pernah menerima
soal yang sama dua kali. Kamu tidak perlu menghapus duplikatnya.

Dua soal dikeluarkan dari ujian karena cacat (lihat `exclude_question_ids` di config):

| ID | Masalah |
|---|---|
| `A_PATTERN-002` | Pilihan A, B, dan D isinya identik (`TJTUFN`). Peserta yang memilih A dinilai salah padahal teksnya sama dengan kunci |
| `A_PATTERN-007` | `ALGORITMA` digeser +1 = `BMHPSJUNB`, dan jawaban itu **tidak ada** di pilihan mana pun. Kunci (D) dan pembahasan (A) juga saling bertentangan |

Jalankan `node tools/validate_bank.js` untuk laporan lengkap, termasuk 3 soal lain
yang kuncinya patut diperiksa manual.

### Competitive Programming — `data/cp-problems.json`

15 soal **level mudah**, statement Bahasa Indonesia, 7 test case per soal
(2 contoh terbuka + 5 tersembunyi) = 105 test case.

| ID | Judul | Topik |
|---|---|---|
| E-001 | Penjumlahan Dua Bilangan | Dasar / Input-Output |
| E-002 | Ganjil atau Genap | Dasar / Percabangan |
| E-003 | Nilai Tertinggi | Array / Traversal |
| E-004 | Rata-Rata Kelas | Array / Aritmetika |
| E-005 | Hitung Huruf Vokal | String |
| E-006 | Balik Kata | String |
| E-007 | Faktorial | Dasar / Perulangan |
| E-008 | Cek Palindrom | String / Two Pointer |
| E-009 | Tiga dan Lima | Perulangan + Percabangan |
| E-010 | Frekuensi Angka | Array / Counting |
| E-011 | Urutkan Nilai | Sorting |
| E-012 | Menghitung Bilangan Prima | Matematika / Sieve |
| E-013 | Bilangan Fibonacci | Dasar / Perulangan |
| E-014 | Selisih Terbesar | Array / Traversal |
| E-015 | Hitung Kata | String / Parsing |

Setiap soal punya *reference solution* yang disertakan. **Expected output tidak
pernah ditulis manual** — semuanya dihitung oleh reference solution lewat
`tools/gen_cp.py`, jadi mustahil ada kunci yang salah.

Soal yang dipakai saat ujian diatur lewat `problem_ids` di config (default 5 soal).
Ingin ganti? Cukup ubah daftarnya:

```json
"problem_ids": ["E-002", "E-005", "E-009", "E-013", "E-014"]
```

Setiap soal menyertakan *trap* yang relevan untuk seleksi: batasan yang memaksa
long long (E-007, E-013, E-014), N besar yang menolak bubble sort (E-011), dan
nilai negatif yang menjatuhkan `max = 0` (E-003).

---

## Konfigurasi

Semua di `config.json`. Yang **wajib** diubah sebelum ujian:

```json
"admin_key": "GANTI-KUNCI-INI-SEBELUM-UJIAN",
"registration": { "access_code": "CS2026" }
```

Pengaturan yang sering disesuaikan:

| Kunci | Arti |
|---|---|
| `port` | Port server (default 3000) |
| `sections[].duration_min` | Durasi tiap bagian, dihitung per peserta sejak ia menekan "Mulai" |
| `sections[].composition` | Jumlah soal TPKS per tipe |
| `sections[].problem_ids` | Soal CP yang dipakai |
| `sections[].weight` | Bobot nilai akhir (TPKS 0.4, CP 0.6) |
| `sections[].languages` | Bahasa yang boleh dipakai peserta |
| `sections[].max_submissions_per_problem` | Batas submit per soal |
| `lockdown.max_violations` | Jumlah pelanggaran sebelum auto-submit |
| `lockdown.grace_seconds_per_violation` | Jeda paksa sebelum peserta boleh lanjut |
| `lockdown.block_paste_code` | `true` = peserta tidak bisa menempel kode dari luar |
| `result.show_score_to_participant` | `false` = peserta tidak melihat nilainya |

Durasi bersifat **per peserta**, bukan jam dinding. Peserta yang datang terlambat
tetap mendapat waktu penuh.

---

## Dashboard Pengawas

`http://IP:3000/admin.html` → masukkan `admin_key`.

Refresh otomatis 5 detik. Yang terlihat per peserta:

- Titik **hijau/abu** = online / tidak terdeteksi >25 detik
- Sisa waktu tiap bagian dan progres (`18/30` soal, `3/5 solved`)
- **Jumlah pelanggaran** + jenis pelanggaran terakhir
- Nilai TPKS, CP, dan nilai akhir yang terus diperbarui

Aksi yang tersedia:

| Aksi | Kapan dipakai |
|---|---|
| **Detail** | Lihat jawaban per soal + kunci, seluruh kode yang disubmit, dan daftar pelanggaran berikut jamnya |
| **+5m / +15m** | Peserta terlambat atau laptopnya bermasalah |
| **Maafkan** | Hapus catatan pelanggaran (mis. notifikasi Windows memicu blur) |
| **Buka kembali** | Laptop peserta mati / WiFi putus lama — buka lagi bagian terakhir + 10 menit |
| **Hentikan paksa** | Kumpulkan semua jawaban peserta sekarang |
| **Diskualifikasi** | Peserta kedapatan curang; sesinya tidak bisa dibuka lagi |
| **Export CSV** | Rekap nilai, langsung bisa dibuka Excel (sudah ber-BOM UTF-8) |

> **Reset Semua** menghapus seluruh data peserta. Pakai hanya **sebelum** ujian
> dimulai, misalnya setelah uji coba.

---

## Penilaian

**TPKS** — `benar / total × 100`. Tidak ada nilai minus.

**CP** — per soal: `test case lulus / total test case × 100` (**partial credit**).
Dari beberapa submit, yang dipakai adalah **submit terbaik**, bukan yang terakhir,
jadi peserta tidak dirugikan karena mencoba optimasi di akhir.

**Nilai akhir** — rata-rata berbobot:

```
akhir = (0.4 × persen_TPKS + 0.6 × persen_CP) / (0.4 + 0.6)
```

Verdict judge: `AC` Accepted · `WA` Wrong Answer · `TLE` Time Limit Exceeded ·
`RTE` Runtime Error · `CE` Compile Error · `OLE` Output Limit Exceeded.

Perbandingan output memaafkan spasi di akhir baris dan baris kosong di akhir file,
jadi peserta tidak gagal hanya karena `print` menambah newline.

---

## Keamanan Judge

Kode peserta dijalankan sebagai **proses biasa** milik user yang menjalankan server.
Ada pembatas: timeout per test case, batas waktu CPU (`ulimit -t`), batas jumlah
proses (`ulimit -u`, anti fork-bomb), batas ukuran file, batas ukuran output, dan
antrean agar maksimal 2 submission berjalan bersamaan.

**Tapi ini bukan container.** Kode peserta secara teknis masih bisa membaca file
yang bisa dibaca user tersebut.

Rekomendasi untuk ujian sungguhan:

- Jalankan server di **laptop/user khusus**, bukan laptop pribadi berisi data penting
- Atau buat user terbatas: `sudo -u exam-runner node server.js`
- Atau jalankan dalam Docker/VM

Untuk seleksi internal dengan peserta yang identitasnya diketahui dan semua kodenya
tersimpan untuk audit, risikonya rendah — tapi kamu sebaiknya tahu posisinya.

---

## Tools

```bash
# Verifikasi bank CP: reference solution harus AC 100%,
# dan judge harus menolak solusi salah (uji negatif WA/TLE/RTE/CE)
node tools/verify_cp.js

# Laporan kualitas bank TPKS: duplikat, pilihan kembar, kunci vs pembahasan
node tools/validate_bank.js

# Uji end-to-end seluruh alur ujian (100 pemeriksaan, pakai port & data terpisah)
node tools/selftest.js

# Regenerasi bank soal CP setelah mengubah/menambah soal
python3 tools/gen_cp.py
```

Jalankan `verify_cp.js` dan `selftest.js` **di laptop yang akan dipakai ujian**,
sehari sebelumnya. Itu sekaligus memastikan Python/g++ terpasang benar di mesin itu.

---

## Saat Ujian Berlangsung

**Checklist sebelum mulai**

- [ ] `admin_key` dan `access_code` sudah diganti
- [ ] `node tools/verify_cp.js` lulus di laptop ujian
- [ ] Port 3000 terbuka di firewall, sudah diuji dari perangkat lain
- [ ] Laptop panitia **tercolok charger** dan sleep dimatikan
- [ ] Uji coba singkat dengan 2–3 orang, lalu **Reset Semua**
- [ ] Alamat ujian ditulis di papan tulis
- [ ] Browser peserta disiapkan dalam kiosk mode

**Kalau ada masalah**

| Gejala | Penyebab & solusi |
|---|---|
| Peserta tidak bisa membuka alamat | Firewall belum dibuka, atau beda SSID, atau AP isolation aktif |
| Laptop peserta mati / WiFi putus | Jawaban tersimpan di server. Login ulang dengan **NIM yang sama** → sesi lanjut. Beri tambahan waktu lewat dashboard |
| Timer peserta habis padahal laptopnya rusak | Dashboard → ⋯ → **Buka kembali** |
| Pelanggaran muncul tanpa peserta curang | Biasanya notifikasi/popup OS memicu `blur`. Gunakan **Maafkan**, dan naikkan `max_violations` |
| CP tidak bisa submit | Python/g++ tidak terpasang di laptop panitia. Cek baris "Bahasa" saat server start |
| Server perlu di-restart | Aman. Semua state ada di `data/runtime/attempts.json`, peserta cukup reload |

**Setelah ujian**

1. **Export CSV** dari dashboard
2. Backup `data/runtime/` — berisi semua jawaban, kode, dan log audit
3. Gunakan **Detail** untuk meninjau kode peserta dan pelanggaran saat rapat seleksi

---

## Struktur Proyek

```
exam-apps/
├─ server.js                 # Server HTTP + semua endpoint API
├─ config.json               # Satu-satunya file yang perlu diedit panitia
├─ lib/
│  ├─ http.js                # Router, body parser, static file (anti path traversal)
│  ├─ bank.js                # Pemilihan soal: dedup, exclusion, pengacakan
│  ├─ store.js               # Persistensi JSON (atomic write) + audit log
│  ├─ judge.js               # Eksekusi kode peserta + verdict
│  ├─ scoring.js             # Perhitungan nilai
│  └─ util.js                # PRNG per peserta, perbandingan output, sanitasi
├─ data/
│  ├─ tpks.json              # 150 soal pilihan ganda
│  ├─ cp-problems.json       # 15 soal CP + 105 test case + reference solution
│  └─ runtime/               # Dibuat otomatis: attempts.json, events.log (jangan di-commit)
├─ public/
│  ├─ index.html             # Login peserta
│  ├─ exam.html              # Halaman ujian
│  ├─ admin.html             # Dashboard pengawas
│  ├─ css/app.css
│  └─ js/
│     ├─ api.js              # Pembungkus fetch + deteksi koneksi putus
│     ├─ lockdown.js         # Seluruh logika lockdown
│     ├─ exam.js             # TPKS + editor kode + judge UI
│     └─ admin.js            # Dashboard
└─ tools/
   ├─ gen_cp.py              # Generator bank CP (expected output dihitung, bukan ditulis)
   ├─ verify_cp.js           # Verifikasi bank CP + uji negatif judge
   ├─ validate_bank.js       # Laporan kualitas bank TPKS
   └─ selftest.js            # 100 pemeriksaan end-to-end
```

### Catatan desain

**Kenapa tanpa dependency?** Lab komputer sering tidak punya internet, dan
`npm install` yang gagal lima menit sebelum ujian adalah mimpi buruk. Satu
`node server.js` dan semua jalan.

**Kenapa timer di server?** Timer di sisi klien bisa dimanipulasi dengan mengubah
jam sistem atau devtools. Deadline disimpan di server; klien hanya menampilkannya.

**Kenapa paket soal dibekukan saat registrasi?** Soal dan kunci jawaban peserta
disimpan utuh di attempt-nya. Reload halaman, ganti laptop, atau restart server
tidak mengubah soal yang ia terima.

**Kenapa kunci jawaban tidak pernah dikirim ke browser?** Peserta hanya menerima
`no`, `qid`, `type`, `q`, dan `opts`. Field `ans` dan `exp` tidak ikut — dicek
otomatis oleh `selftest.js`. Penilaian 100% di server.
