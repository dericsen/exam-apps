# Exam Apps — Ujian LAN dengan Lockdown

Aplikasi ujian yang dijalankan dari satu laptop dan diakses peserta lewat WiFi lokal.

- **30 soal TPKS** (pilihan ganda) + **2 soal Competitive Programming** (dinilai otomatis)
- **Satu timer 90 menit**, mulai berjalan saat peserta enroll
- Soal **diacak per peserta** dari bank soal
- Lockdown: wajib fullscreen, deteksi pindah aplikasi, auto-submit

Tanpa dependency. Tanpa `npm install`. Tanpa internet. Cukup **Node.js 18+**.

```bash
node server.js
```

---

## Daftar Isi

- [Mulai Cepat](#mulai-cepat)
- [Cara Kerja Waktu dan Soal](#cara-kerja-waktu-dan-soal)
- [Menyebarkan ke WiFi](#menyebarkan-ke-wifi)
- [Soal lockdown — baca ini](#soal-lockdown--baca-ini)
- [Mode Kiosk](#mode-kiosk)
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
git clone https://github.com/dericsen/exam-apps.git
cd exam-apps

# 1. Ganti "admin_key" dan "registration.access_code" di config.json

# 2. Periksa kesiapan laptop ini (Node, toolchain bahasa, port, IP, firewall, bank soal)
node tools/doctor.js

# 3. Pastikan judge menilai dengan benar di mesin ini
node tools/verify_cp.js

# 4. Jalankan
node server.js
```

Atau klik dua kali **`start.bat`** (Windows) / jalankan **`./start.sh`**
(macOS/Linux) — keduanya menjalankan preflight dulu, lalu server.

**Panduan deploy lengkap langkah demi langkah ada di [DEPLOY.md](DEPLOY.md)**,
termasuk cara memasang Python/GCC/JDK, membuka firewall, menyiapkan kiosk mode di
laptop peserta, dan alur hari-H.

Server langsung mencetak alamat yang dibagikan ke peserta:

```
------------------------------------------------------------------
Seleksi Tim Riset & Proyek Ilmu Komputer 2026
------------------------------------------------------------------
Peserta  : http://192.168.1.10:3000
Pengawas : http://192.168.1.10:3000/admin.html
Kode akses : CS2026
Kunci admin: ...
------------------------------------------------------------------
Durasi   : 90 menit, mulai saat peserta enroll
Soal     : 30 TPKS + 2 CP (acak per peserta)
Pool CP  : E-001, E-002, ... E-015
Bobot    : TPKS 0.4 / CP 0.6
Bahasa   : Python 3 x1.5 waktu, C (C11), Java x2 waktu
------------------------------------------------------------------
```

---

## Cara Kerja Waktu dan Soal

### Satu timer, mulai saat enroll

Timer **90 menit** mulai berjalan pada detik peserta menekan tombol *Masuk* di
halaman login — bukan saat ia mulai membaca soal. Halaman login memberi peringatan
jelas dan meminta konfirmasi sebelum menekan tombol itu.

Konsekuensinya penting untuk dipahami panitia:

- Peserta yang enroll lalu menunda mengerjakan **kehilangan waktu**. Beri instruksi
  jelas: "jangan tekan Masuk sebelum saya bilang mulai".
- Durasi bersifat **per peserta**, bukan jam dinding. Peserta yang datang terlambat
  tetap mendapat 90 menit penuh.
- Login ulang **tidak** me-reset timer. Laptop mati atau WiFi putus tidak memberi
  waktu tambahan — gunakan tombol *+5m* atau *Buka kembali* di dashboard untuk itu.
- Timer dihitung di **server**. Mengubah jam sistem, reload, atau menutup browser
  tidak menghentikannya.

### Navigasi bebas antara TPKS dan CP

Karena timernya satu, **kedua bagian dibuka bersamaan** dan peserta bebas berpindah
lewat tab di pojok kiri atas. Ia sendiri yang mengatur pembagian waktunya.

Ini keputusan desain yang sengaja: dengan satu timer, memaksa urutan (TPKS dulu,
baru CP) justru berbahaya — peserta yang keburu menekan "kumpulkan TPKS" akan
kehilangan akses permanen padahal waktunya masih banyak. Satu tombol *Selesai &
kumpulkan* mengakhiri seluruh ujian.

### Soal diacak per peserta

**TPKS** — 30 soal: 10 A_PATTERN, 10 B_LOGIC, 10 C_ANALYTIC. Urutan soal dan urutan
pilihan jawaban juga diacak. **Dijamin tidak ada dua soal yang isinya sama** dalam
satu paket — lihat [Masalah duplikat](#masalah-duplikat-dan-ukuran-bank-sebenarnya).

**CP** — 2 soal diambil dari pool 15 soal, **satu soal dari setiap tier**:

| Tier | Isi | Karakter |
|---|---|---|
| 1 | E-001, E-002, E-005, E-006, E-007, E-013 | I/O dasar + satu operasi |
| 2 | E-003, E-004, E-008, E-009, E-010, E-011, E-012, E-014, E-015 | perlu array, loop, atau sedikit algoritma |

Kenapa pakai tier, bukan acak bebas? Dengan acak bebas dari 15 soal, ada peserta
yang kebetulan dapat dua soal termudah (`a+b` dan `cek ganjil/genap`) sementara yang
lain dapat dua tersulit (sieve prima dan sorting N=100.000). Itu tidak adil untuk
seleksi. Dengan tier, soalnya tetap berbeda-beda tapi **tingkat kesulitannya setara**
— ada 54 kombinasi yang mungkin.

Mau acak bebas? Hapus saja `problem_tiers` dari `config.json`.

### Pengacakan bersifat tetap per peserta

Paket soal dibekukan saat enroll dan disimpan di attempt peserta. Reload halaman,
ganti laptop, atau restart server **tidak** mengubah soal yang ia terima. Diverifikasi
otomatis oleh `tools/selftest.js`.

---

## Menyebarkan ke WiFi

1. **Laptop panitia dan semua peserta harus di WiFi/SSID yang sama.** Hotspot HP bisa,
   tapi router lebih stabil untuk >15 peserta.

2. **Cari IP laptop panitia** (dicetak otomatis oleh server, atau cek manual):

   | OS | Perintah |
   |---|---|
   | Windows | `ipconfig` → lihat *IPv4 Address* |
   | macOS | `ipconfig getifaddr en0` |
   | Linux | `hostname -I` |

3. **Izinkan port di firewall.** Ini penyebab #1 "kok nggak bisa dibuka":

   ```powershell
   # Windows (PowerShell sebagai Administrator)
   New-NetFirewallRule -DisplayName "Exam App" -Direction Inbound -LocalPort 3000 -Protocol TCP -Action Allow
   ```

   ```bash
   sudo firewall-cmd --add-port=3000/tcp   # firewalld
   sudo ufw allow 3000/tcp                 # ufw
   ```

   macOS biasanya cukup menekan **Allow** pada dialog yang muncul.

4. **Tulis alamatnya di papan tulis**, misalnya `http://192.168.1.10:3000`.

5. **Uji dari satu perangkat peserta** sebelum ujian resmi.

> **Kalau IP-mu `10.x.x.x`** (lazim di WiFi kampus/kantor): alamatnya sah dan
> terdeteksi otomatis, tapi jaringan terkelola sering mengaktifkan **client
> isolation** sehingga perangkat di SSID yang sama tidak bisa saling menghubungi —
> dan membuka firewall tidak menolong. Semuanya terlihat normal dari laptop panitia,
> jadi **wajib diuji dari perangkat lain**. Panduan lengkap beserta solusinya ada di
> [DEPLOY.md → Kalau IP-mu 10.x.x.x](DEPLOY.md#kalau-ip-mu-10xxx-wifi-kampuskantor).
>
> `node tools/doctor.js` mengenali kondisi ini otomatis, dan juga mengabaikan
> antarmuka virtual dari Docker/VPN yang sering tertukar saat memilih alamat.

---

## Soal lockdown — baca ini

**Sebuah halaman web tidak bisa mengunci sistem operasi.** Browser sengaja tidak
mengizinkan halaman mana pun memblokir Alt+Tab, menutup aplikasi lain, atau mematikan
tombol Windows. Siapa pun yang menjanjikan sebaliknya dari web app murni sedang keliru.

Yang **benar-benar dilakukan** aplikasi ini:

| Mekanisme | Efek |
|---|---|
| Wajib fullscreen | Ujian tidak bisa dimulai tanpa masuk mode layar penuh |
| Deteksi keluar fullscreen | Tercatat sebagai pelanggaran + layar soal ditutup overlay |
| Deteksi pindah tab / minimize | `visibilitychange` → pelanggaran |
| Deteksi pindah aplikasi | `window.blur` → pelanggaran (ini yang menangkap Alt+Tab) |
| Overlay penghalang | Begitu peserta berpaling, soal **langsung tertutup** |
| Blokir klik kanan, copy, paste | Soal tidak bisa disalin keluar, kode tidak bisa ditempel masuk |
| Blokir F12 / Ctrl+Shift+I / Ctrl+U | Devtools dan view-source dihalangi |
| Timer di server | Reload, tutup browser, atau cabut WiFi tidak menghentikan waktu |
| Auto-submit | Setelah `max_violations` pelanggaran, ujian dikumpulkan paksa |
| Log audit | Semua pelanggaran tercatat beserta jam dan jenisnya, terlihat pengawas real-time |

Jadi kecurangan tidak dicegah secara fisik, tapi **selalu tertangkap dan tercatat**,
dan soalnya tertutup saat peserta berpaling. Untuk seleksi internal, kombinasi ini
plus mode kiosk sudah sangat memadai.

**Yang tidak bisa dideteksi:** HP kedua, teman di sebelah, atau laptop kedua.
Pengawasan fisik di ruangan tetap diperlukan.

---

## Mode Kiosk

Jalankan browser peserta dalam kiosk mode: tidak ada address bar, tab, atau tombol close.

**Windows** (buat `ujian.bat` di desktop tiap PC, ganti IP-nya):

```bat
@echo off
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" ^
  --kiosk --app=http://192.168.1.10:3000 ^
  --disable-extensions --no-first-run ^
  --user-data-dir="%TEMP%\exam-profile"
```

**macOS:**

```bash
open -na "Google Chrome" --args --kiosk --app=http://192.168.1.10:3000 \
  --user-data-dir=/tmp/exam-profile
```

**Linux:**

```bash
google-chrome --kiosk --app=http://192.168.1.10:3000 --user-data-dir=/tmp/exam-profile
```

`--user-data-dir` terpisah penting: peserta tidak membawa cookie, history, atau akun
Google pribadinya ke sesi ujian.

**Kalau butuh kunci total:**

- **Windows Assigned Access** — Settings → Accounts → *Other users* → *Set up a kiosk*.
  Peserta hanya bisa menjalankan satu aplikasi, Alt+Tab mati total.
- **[Safe Exam Browser](https://safeexambrowser.org/)** — gratis, open source, dibuat
  khusus untuk ujian. Arahkan ke `http://IP:3000`.

---

## Bank Soal

### TPKS — `data/tpks.json`

150 entri soal: A_PATTERN (pola & deret), B_LOGIC (logika), C_ANALYTIC (analitis).

<a name="masalah-duplikat-dan-ukuran-bank-sebenarnya"></a>
#### Masalah duplikat dan ukuran bank sebenarnya

**Dari 150 entri, hanya 40 yang benar-benar soal berbeda.** Bank menulis ulang soal
yang sama dengan kalimat *dan* pilihan jawaban yang berbeda, sehingga sekilas tampak
seperti soal baru:

| ID | Teks | Pilihan |
|---|---|---|
| `A_PATTERN-001` | "Perhatikan deret berikut: 2, 6, 12, 20, 30..." | 38/40/42/44 |
| `A_PATTERN-026` | "**Tentukan angka selanjutnya dari** deret berikut: 2, 6, 12, 20, 30..." | 40/42/44/46 |
| `B_LOGIC-032` | "Tentukan angka selanjutnya dari deret berikut: 2, 6, 12, 20, 30..." | 36/40/42/44 |

Soal deret `2, 6, 12, 20, 30` saja punya **30 varian** — 10 di setiap tipe. Soal swap
variabel punya 16 varian, soal dependency graph 14.

Karena itu setiap soal diberi field `group` oleh `tools/cluster_tpks.js`, dan server
menjamin **satu peserta tidak pernah menerima dua soal dari grup yang sama**.
Pengelompokan memakai dua mekanisme:

1. **TF-IDF + cosine similarity** — menangkap soal yang redaksinya diubah. Kata
   boilerplate ("perhatikan", "berikut") otomatis berbobot kecil karena muncul di
   hampir semua soal, sementara token khas ("xor", "kernel", angka deret) mendominasi.
2. **Awalan deret angka** — menangkap soal yang menanyakan deret yang sama pada titik
   berbeda, yang luput dari cara pertama:
   `"1, 1, 2, 3, 5, 8, 13, 21 → ?"` dan `"1, 1, 2, 3, 5, 8, 13 → ?"` adalah soal yang
   sama bagi peserta meskipun jawabannya berbeda.

Duplikatnya **tidak perlu dihapus** dari bank. Cukup jalankan ulang
`node tools/cluster_tpks.js --write` setelah menambah soal.

#### Konsekuensi yang perlu kamu tahu

Dengan 40 kelompok dan 30 soal per peserta, **dua peserta berbagi sekitar 78% soal
yang sama**. Itu batasan banknya, bukan kodenya. Pilihanmu:

| Komposisi | Soal | Irisan antar peserta |
|---|---|---|
| 10/10/10 (sekarang) | 30 | ~78% |
| 7/7/7 | 21 | ~56% |
| 6/6/6 | 18 | ~49% |

Kalau variasi antar peserta penting, turunkan `composition` di `config.json` atau
tambah soal baru ke bank. Kalau yang penting cakupan materi, 30 soal tetap wajar —
semua peserta mengerjakan soal dari pool yang sama dan tidak ada yang menerima soal
berulang.

Catatan lain: **label tipe di bank ini tidak konsisten**. Soal swap variabel yang
sama muncul sebagai `B_LOGIC` di beberapa entri dan `C_ANALYTIC` di entri lain, jadi
"10 per tipe" tidak benar-benar berarti tiga ranah kemampuan yang terpisah. Kalau
kamu tidak peduli pembagian tipe, hapus `composition` dan pakai
`"question_count": 30` — soal akan diambil dari seluruh bank.

#### Soal cacat yang dikeluarkan

Dua soal dikeluarkan karena cacat (`exclude_question_ids` di config):

| ID | Masalah |
|---|---|
| `A_PATTERN-002` | Pilihan A, B, dan D identik (`TJTUFN`). Peserta yang memilih A dinilai salah padahal teksnya sama dengan kunci |
| `A_PATTERN-007` | `ALGORITMA` digeser +1 = `BMHPSJUNB`, dan jawaban itu **tidak ada** di pilihan mana pun. Kunci (D) dan pembahasan (A) juga bertentangan |

Jalankan `node tools/validate_bank.js` untuk laporan lengkap, termasuk soal lain
yang kuncinya patut diperiksa manual.

#### Menambah soal TPKS

```bash
# 1. Tambahkan entri baru ke data/tpks.json dengan format:
#    { "id": "...", "type": "A_PATTERN", "q": "...", "opt": [4 pilihan], "ans": "C", "exp": "..." }

# 2. Kelompokkan ulang supaya duplikat terdeteksi
node tools/cluster_tpks.js            # lihat usulan kelompok dulu
node tools/cluster_tpks.js --write    # simpan field "group" ke bank

# 3. Pastikan komposisi di config masih bisa dipenuhi
node tools/validate_bank.js
```

### Competitive Programming — `data/cp-problems.json`

15 soal **level mudah**, statement Bahasa Indonesia, 7 test case per soal
(2 contoh terbuka + 5 tersembunyi) = 105 test case.

| ID | Judul | Topik | Tier |
|---|---|---|---|
| E-001 | Penjumlahan Dua Bilangan | Dasar / Input-Output | 1 |
| E-002 | Ganjil atau Genap | Dasar / Percabangan | 1 |
| E-003 | Nilai Tertinggi | Array / Traversal | 2 |
| E-004 | Rata-Rata Kelas | Array / Aritmetika | 2 |
| E-005 | Hitung Huruf Vokal | String | 1 |
| E-006 | Balik Kata | String | 1 |
| E-007 | Faktorial | Dasar / Perulangan | 1 |
| E-008 | Cek Palindrom | String / Two Pointer | 2 |
| E-009 | Tiga dan Lima | Perulangan + Percabangan | 2 |
| E-010 | Frekuensi Angka | Array / Counting | 2 |
| E-011 | Urutkan Nilai | Sorting | 2 |
| E-012 | Menghitung Bilangan Prima | Matematika / Sieve | 2 |
| E-013 | Bilangan Fibonacci | Dasar / Perulangan | 1 |
| E-014 | Selisih Terbesar | Array / Traversal | 2 |
| E-015 | Hitung Kata | String / Parsing | 2 |

Setiap soal menyertakan *reference solution*. **Expected output tidak pernah ditulis
manual** — semuanya dihitung oleh reference solution lewat `tools/gen_cp.py`, jadi
mustahil ada kunci yang salah.

Setiap soal menyimpan *trap* yang relevan untuk seleksi: batasan yang memaksa
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
| `exam.duration_min` | Total waktu ujian, mulai saat enroll (default 90) |
| `exam.warn_minutes` | Timer berubah merah saat sisa waktu di bawah ini |
| `sections[0].composition` | Jumlah soal TPKS per tipe (default 10/10/10 = 30) |
| `sections[0].exclude_question_ids` | Soal TPKS yang tidak boleh keluar |
| `sections[1].problem_count` | Jumlah soal CP per peserta (default 2) |
| `sections[1].problem_tiers` | Tier soal CP. Hapus untuk acak bebas |
| `sections[].weight` | Bobot nilai akhir (TPKS 0.4, CP 0.6) |
| `sections[1].languages` | Bahasa peserta. Didukung: `python`, `c`, `cpp`, `java`, `javascript` |
| `sections[1].max_submissions_per_problem` | Batas submit per soal |
| `lockdown.max_violations` | Jumlah pelanggaran sebelum auto-submit |
| `lockdown.block_paste_code` | `true` = peserta tidak bisa menempel kode dari luar |
| `result.show_score_to_participant` | `false` = peserta tidak melihat nilainya |

---

## Dashboard Pengawas

`http://IP:3000/admin.html` → masukkan `admin_key`. Refresh otomatis 5 detik.

Per peserta terlihat: status online, **sisa waktu**, progres TPKS (`18/30` + jumlah
benar), **soal CP mana yang ia dapat** beserta test case yang lulus, jumlah
pelanggaran, dan nilai akhir yang terus diperbarui.

| Aksi | Kapan dipakai |
|---|---|
| **Detail** | Jawaban per soal + kunci, seluruh kode yang disubmit, daftar pelanggaran berikut jamnya |
| **+5m** / **+15m** | Peserta terlambat atau laptopnya bermasalah |
| **Hapus catatan pelanggaran** | Pelanggaran palsu, mis. notifikasi Windows memicu blur |
| **Buka kembali** | Laptop mati / WiFi putus lama — aktifkan lagi dan beri 10 menit dari sekarang |
| **Hentikan dan kumpulkan paksa** | Kumpulkan jawaban peserta sekarang |
| **Diskualifikasi** | Peserta kedapatan curang; sesinya tidak bisa dibuka lagi |
| **Export CSV** | Rekap nilai, siap dibuka Excel (ber-BOM UTF-8) |

CSV memuat kolom `cp1_soal`, `cp1_lulus`, `cp1_persen`, `cp2_...` sehingga kamu tahu
soal mana yang didapat tiap peserta — penting karena soalnya berbeda-beda.

> **Reset semua** menghapus seluruh data peserta. Pakai hanya **sebelum** ujian
> dimulai, misalnya setelah uji coba.

---

## Penilaian

**TPKS** — `benar / 30 × 100`. Tidak ada nilai minus.

**CP** — per soal `test case lulus / 7 × 100` (**partial credit**). Dari beberapa
submit, yang dipakai adalah **submit terbaik**, bukan yang terakhir, jadi peserta
tidak dirugikan karena mencoba optimasi di akhir.

**Bahasa yang tersedia** diatur di `config.json` (bawaan: Python, C, Java; judge juga
mendukung C++ dan JavaScript). Java dan Python mendapat **kelonggaran batas waktu**
×2 dan ×1,5 dari batas dasar soal, karena JVM butuh waktu untuk hidup dan Python
lebih lambat secara inheren — tanpa itu peserta bisa kena TLE bukan karena
algoritmanya salah. Batas yang berlaku ditampilkan ke peserta sesuai bahasa yang ia
pilih, jadi tidak ada keunggulan tersembunyi.

`node tools/verify_cp.js` menjalankan program nyata di **setiap** bahasa aktif dan
memeriksa outputnya, jadi kamu tahu compiler dan JDK di laptop ujian benar-benar
bekerja — bukan hanya terpasang.

**Nilai akhir** — rata-rata berbobot:

```
akhir = (0.4 x persen_TPKS + 0.6 x persen_CP) / (0.4 + 0.6)
```

Dengan 2 soal CP berbobot 0.6, **satu soal CP bernilai 30% dari nilai akhir** —
jauh lebih besar dari satu soal TPKS (1,33%). Pertimbangkan ini saat menimbang:
kalau terasa terlalu berat, turunkan bobot CP atau naikkan `problem_count`.

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
# Preflight: periksa laptop ini siap dipakai ujian
# (Node, config, toolchain bahasa, bank soal, port, IP, izin tulis, sisa data lama)
node tools/doctor.js

# Verifikasi bank CP: reference solution harus AC 100%,
# dan judge harus menolak solusi salah (uji negatif WA/TLE/RTE/CE)
node tools/verify_cp.js

# Laporan kualitas bank TPKS: kelompok duplikat, pilihan kembar,
# kunci vs pembahasan, dan uji kapasitas komposisi
node tools/validate_bank.js

# Kelompokkan ulang soal TPKS yang isinya sama (wajib setelah menambah soal)
node tools/cluster_tpks.js --write

# Uji end-to-end seluruh alur ujian (127 pemeriksaan, port & data terpisah)
node tools/selftest.js

# Regenerasi bank soal CP setelah mengubah/menambah soal
python3 tools/gen_cp.py
```

Jalankan `verify_cp.js` dan `selftest.js` **di laptop yang akan dipakai ujian**,
sehari sebelumnya. `verify_cp.js` menjalankan uji asap untuk SETIAP bahasa yang aktif,
jadi sekaligus membuktikan compiler dan JDK di mesin itu benar-benar bekerja.

---

## Saat Ujian Berlangsung

**Checklist sebelum mulai**

- [ ] `admin_key` dan `access_code` sudah diganti
- [ ] `node tools/verify_cp.js` lulus di laptop ujian
- [ ] Port 3000 terbuka di firewall, sudah diuji dari perangkat lain
- [ ] Laptop panitia **tercolok charger** dan sleep dimatikan
- [ ] Uji coba singkat dengan 2–3 orang, lalu **Reset semua**
- [ ] Alamat ujian ditulis di papan tulis
- [ ] Browser peserta disiapkan dalam kiosk mode
- [ ] **Peserta diberi tahu: jangan tekan Masuk sebelum diinstruksikan** — timer
      langsung berjalan

**Kalau ada masalah**

| Gejala | Penyebab & solusi |
|---|---|
| Peserta tidak bisa membuka alamat | Firewall belum dibuka, beda SSID, atau AP isolation aktif |
| Peserta tidak sengaja enroll kelewat awal | Dashboard → *+15m* atau *Buka kembali* untuk mengembalikan waktunya |
| Laptop peserta mati / WiFi putus | Jawaban tersimpan di server. Login ulang dengan **NIM yang sama** → sesi lanjut dengan sisa waktu apa adanya. Tambah waktu lewat dashboard |
| Timer habis padahal laptopnya rusak | Dashboard → *Lain* → **Buka kembali** |
| Pelanggaran muncul tanpa peserta curang | Biasanya notifikasi/popup OS memicu `blur`. Hapus catatannya, dan naikkan `max_violations` |
| CP tidak bisa submit | Toolchain bahasa belum terpasang di laptop panitia. Cek baris "Bahasa" saat server start, atau jalankan `node tools/doctor.js` |
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
│  ├─ bank.js                # Pemilihan soal: dedup, exclusion, tier, pengacakan
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
├─ tools/
│  ├─ doctor.js              # Preflight check kesiapan laptop ujian
│  ├─ cluster_tpks.js        # Kelompokkan soal TPKS yang isinya sama
│  ├─ gen_cp.py              # Generator bank CP (expected output dihitung, bukan ditulis)
│  ├─ verify_cp.js           # Verifikasi bank CP + uji negatif judge
│  ├─ validate_bank.js       # Laporan kualitas bank TPKS + uji kapasitas
│  └─ selftest.js            # 130 pemeriksaan end-to-end
├─ start.bat                 # Launcher Windows (preflight + server)
├─ start.sh                  # Launcher macOS/Linux
└─ DEPLOY.md                 # Panduan deploy langkah demi langkah
```

### Catatan desain

**Kenapa tanpa dependency?** Lab komputer sering tidak punya internet, dan
`npm install` yang gagal lima menit sebelum ujian adalah mimpi buruk.

**Kenapa timer di server?** Timer di sisi klien bisa dimanipulasi dengan mengubah
jam sistem atau devtools. Deadline disimpan di server; klien hanya menampilkannya.

**Kenapa paket soal dibekukan saat enroll?** Soal dan kunci jawaban peserta disimpan
utuh di attempt-nya. Reload, ganti laptop, atau restart server tidak mengubah soal
yang ia terima.

**Kenapa pemilihan soal pakai bipartite matching, bukan ambil-acak biasa?** Satu
kelompok soal sering punya anggota di beberapa tipe sekaligus — soal swap variabel
muncul sebagai `B_LOGIC` maupun `C_ANALYTIC`. Kalau tiap tipe memilih serakah satu
per satu, tipe yang diproses lebih dulu bisa menghabiskan kelompok yang dibutuhkan
tipe berikutnya, lalu kuota tidak terpenuhi. Pool B_LOGIC dan C_ANALYTIC hanya punya
25 kelompok gabungan untuk kuota 20, jadi marginnya tipis dan greedy benar-benar bisa
gagal. Algoritma Kuhn menjamin komposisi selalu terpenuhi kalau secara matematis
memang mungkin — diuji 200x oleh `validate_bank.js` dan 1000x saat pengembangan.

**Kenapa pengelompokan disimpan di data, bukan dihitung saat server start?** Supaya
keputusan "soal mana yang dianggap sama" bisa diaudit manusia sebelum ujian, dan
supaya hasilnya tidak berubah diam-diam kalau heuristiknya nanti disetel ulang.

**Kenapa kunci jawaban tidak pernah dikirim ke browser?** Peserta hanya menerima
`no`, `qid`, `type`, `q`, dan `opts`. Field `ans` dan `exp` tidak ikut — dicek
otomatis oleh `selftest.js`. Penilaian 100% di server.

**Kenapa nilai dihitung ulang setiap kali dashboard dibuka?** Dengan timer global
tidak ada lagi event "kumpulkan bagian" yang memicu perhitungan, jadi nilai yang
di-cache akan basi dan pengawas melihat angka 0 selama ujian berjalan.

**Kenapa UI-nya plain?** Supaya ringan dibuka 30 laptop sekaligus di WiFi lab, dan
supaya tidak ada animasi atau warna yang mengalihkan perhatian peserta saat ujian.
