# Cara Deploy

Aplikasi ini **tidak di-deploy ke internet**. Ia dijalankan di satu laptop panitia,
dan peserta mengaksesnya lewat WiFi lokal. Tidak ada hosting, domain, atau akun cloud.

```
                    WiFi lokal (router / hotspot)
                                |
        +-----------------------+-----------------------+
        |                       |                       |
   Laptop panitia          Laptop peserta         Laptop peserta
   node server.js       http://192.168.1.10:3000       ...
   (server + judge)
```

Satu laptop biasa cukup untuk 30–40 peserta. Yang memberatkan hanya saat banyak
peserta submit kode serentak, dan itu sudah dibatasi 2 proses bersamaan.

---

## Langkah 1 — Pilih laptop server

| Syarat | Alasan |
|---|---|
| Tersambung ke WiFi yang sama dengan peserta | Peserta mengakses via IP lokal |
| **Tercolok charger** | Kalau mati, ujian semua peserta berhenti |
| Sleep / hibernate **dimatikan** | Laptop tidur = server mati = peserta kehilangan koneksi |
| Bukan laptop berisi data pribadi penting | Judge menjalankan kode peserta (lihat [Keamanan Judge](README.md#keamanan-judge)) |

Windows: *Settings → System → Power* → set **Screen and sleep** ke *Never* saat dicolok.
macOS: *System Settings → Lock Screen* → *Turn display off* → *Never*.

---

## Langkah 2 — Pasang Node.js

Unduh versi **LTS** dari <https://nodejs.org> dan pasang.

Verifikasi (butuh 18 atau lebih baru):

```bash
node -v
```

Di Windows, **tutup dan buka ulang** Command Prompt setelah instalasi, kalau tidak
`node` belum terdeteksi.

---

## Langkah 3 — Pasang toolchain bahasa pemrograman

Config bawaan mengizinkan **Python, C, dan Java**. Ketiganya harus terpasang di
laptop panitia, karena judge berjalan di sana — **bukan** di laptop peserta.

> **Ini langkah yang paling sering terlewat.** Node.js saja tidak cukup: ia hanya
> menyediakan JavaScript. Bahasa yang toolchain-nya tidak ada akan **hilang dari
> pilihan peserta**, dan server mencetak peringatan saat start.

**Windows**

| Bahasa | Cara pasang | Verifikasi |
|---|---|---|
| Python | <https://python.org> → saat instalasi **CENTANG "Add python.exe to PATH"** | `python --version` |
| Java | JDK (**bukan** hanya JRE) dari <https://adoptium.net> | `javac -version` |
| C | MinGW-w64 lewat [MSYS2](https://www.msys2.org), lalu tambahkan folder `bin`-nya ke PATH | `gcc --version` |

C adalah yang paling merepotkan di Windows. Dua jalan pintas:

- Pasang **LLVM/clang** dari <https://releases.llvm.org> — installer-nya jauh lebih
  sederhana dari MSYS2, dan judge menerima `clang` sebagai C.
- Atau **hapus `"c"`** dari `sections[].languages` di `config.json`. Lebih baik
  peserta tahu sejak awal bahasa itu tidak tersedia daripada memilihnya lalu gagal.

Judge juga mencoba launcher `py -3` kalau `python` tidak ada di PATH, jadi Python
biasanya tetap terdeteksi walau centang PATH terlupa.

**macOS**

```bash
xcode-select --install       # menyediakan clang -> dipakai judge sebagai C
brew install python3         # kalau python3 belum ada
brew install openjdk         # ikuti petunjuk symlink yang ditampilkan brew
```

**Linux**

```bash
sudo dnf install python3 gcc java-latest-openjdk-devel   # Fedora/RHEL
sudo apt install python3 gcc default-jdk                 # Debian/Ubuntu
```

**Memastikan ketiganya benar-benar bekerja**, bukan hanya terpasang:

```bash
node tools/verify_cp.js
```

Perintah ini menjalankan program nyata di **setiap** bahasa yang aktif dan
memeriksa outputnya. Deteksi versi saja tidak cukup — `javac -version` bisa
berhasil padahal JDK-nya tidak lengkap.

### Menambah atau mengurangi bahasa

Judge mendukung `python`, `c`, `cpp`, `java`, `javascript`. Ubah daftarnya di
`config.json`:

```json
"languages": ["python", "c", "java"]
```

**Java dan Python diberi kelonggaran waktu** (×2 dan ×1,5 dari batas dasar soal),
karena JVM butuh waktu untuk hidup dan Python lebih lambat secara inheren. Tanpa
itu, peserta bisa kena TLE bukan karena algoritmanya salah. Batas yang berlaku
ditampilkan ke peserta sesuai bahasa yang ia pilih.

**Catatan untuk Java:** nama kelas wajib `Main` (file disimpan sebagai `Main.java`).
Templat kode awal sudah memakai `public class Main` dan peserta diberi peringatan
di komentarnya.

---

## Langkah 4 — Ambil kodenya

```bash
git clone https://github.com/dericsen/exam-apps.git
cd exam-apps
```

Tanpa git? Buka halaman repo → **Code → Download ZIP** → ekstrak.

**Jangan ekstrak ke Program Files** atau folder read-only lain — jawaban peserta
ditulis ke `data/runtime/`. Taruh di Documents atau Desktop.

Tidak perlu `npm install`. Proyek ini nol dependency.

---

## Langkah 5 — Ubah konfigurasi

Buka `config.json`, ubah **dua** hal ini:

```json
"admin_key": "kunci-rahasia-panitia-2026",
"registration": { "access_code": "SELEKSI-X9" }
```

- `admin_key` — siapa pun yang tahu ini bisa melihat **semua kunci jawaban** dan
  mengubah nilai. Jangan dibagikan ke peserta.
- `access_code` — dibagikan ke peserta saat ujian dimulai, supaya orang luar yang
  kebetulan ada di WiFi yang sama tidak bisa ikut enroll.

Yang mungkin juga ingin kamu sesuaikan:

```json
"exam": { "duration_min": 90 },
"sections": [
  { "composition": { "A_PATTERN": 10, "B_LOGIC": 10, "C_ANALYTIC": 10 } },
  { "problem_count": 2 }
]
```

Daftar lengkap ada di [README → Konfigurasi](README.md#konfigurasi).

---

## Langkah 6 — Preflight check

```bash
node tools/doctor.js
```

Ini memeriksa versi Node, config yang belum diganti, toolchain bahasa terpasang,
kecukupan bank soal, port 3000 bebas, IP jaringan, izin tulis folder data, dan
sisa data dari sesi sebelumnya.

Perbaiki semua baris **GAGAL** sebelum lanjut. Baris **WARN** sebaiknya dibaca
tapi tidak memblokir.

Kalau lulus, doctor langsung mencetak alamat peserta, alamat pengawas, dan perintah
kiosk mode dengan IP yang sudah terisi — tinggal disalin.

Lalu pastikan judge menilai dengan benar di mesin ini:

```bash
node tools/verify_cp.js
```

Semua 15 soal harus `PASS`. Kalau Python tidak terpasang, langkah inilah yang
akan memberitahu kamu — bukan peserta saat ujian.

---

## Langkah 7 — Buka firewall

**Penyebab nomor satu "kok nggak bisa dibuka".** Server berjalan normal, tapi OS
memblokir koneksi masuk.

**Windows** — PowerShell sebagai **Administrator**:

```powershell
New-NetFirewallRule -DisplayName "Exam App" -Direction Inbound -LocalPort 3000 -Protocol TCP -Action Allow
```

**macOS** — saat server pertama kali jalan akan muncul dialog. Tekan **Allow**.

**Linux**

```bash
sudo firewall-cmd --add-port=3000/tcp    # firewalld
sudo ufw allow 3000/tcp                  # ufw
```

---

## Langkah 8 — Jalankan server

```bash
node server.js
```

Atau klik dua kali **`start.bat`** (Windows) / jalankan **`./start.sh`**
(macOS/Linux) — keduanya menjalankan preflight dulu lalu server.

```
------------------------------------------------------------------
Seleksi Tim Riset & Proyek Ilmu Komputer 2026
------------------------------------------------------------------
Peserta  : http://192.168.1.10:3000
Pengawas : http://192.168.1.10:3000/admin.html
Kode akses : SELEKSI-X9
Kunci admin: kunci-rahasia-panitia-2026
------------------------------------------------------------------
Durasi   : 90 menit, mulai saat peserta enroll
Soal     : 30 TPKS + 2 CP (acak per peserta)
Bahasa   : Python 3 x1.5 waktu, C (C11), Java x2 waktu
------------------------------------------------------------------
```

**Biarkan jendela terminal ini terbuka selama ujian.** Menutupnya mematikan server.
(Jawaban tetap aman di disk, tapi peserta akan kehilangan koneksi.)

---

## Langkah 9 — Uji dari perangkat lain

Jangan uji hanya dari laptop panitia sendiri. Ambil satu HP atau laptop lain yang
tersambung ke WiFi yang sama, buka `http://192.168.1.10:3000`, lalu:

1. Enroll dengan NIM palsu, misalnya `TEST01`
2. Pastikan 30 soal TPKS dan 2 soal CP muncul
3. Jawab 1–2 soal TPKS
4. Di bagian CP, tekan **Uji contoh** lalu **Submit & nilai** — pastikan judge jalan
5. Buka dashboard pengawas, pastikan peserta uji terlihat
6. **Tekan "Reset semua" di dashboard** untuk menghapus data uji coba

Kalau tidak bisa dibuka dari perangkat lain padahal bisa dari laptop panitia,
masalahnya hampir pasti firewall (Langkah 7) atau beda WiFi.

---

## Langkah 10 — Siapkan laptop peserta

Alamat ujian **ditulis di papan tulis**.

Untuk lockdown yang lebih keras, jalankan browser peserta dalam kiosk mode. Buat
file `ujian.bat` di desktop tiap PC (ganti IP-nya):

```bat
@echo off
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" ^
  --kiosk --app=http://192.168.1.10:3000 ^
  --disable-extensions --no-first-run ^
  --user-data-dir="%TEMP%\exam-profile"
```

Opsi lain ada di [README → Mode Kiosk](README.md#mode-kiosk), termasuk Windows
Assigned Access dan Safe Exam Browser untuk kunci total.

---

## Hari-H

**Sebelum peserta masuk**

1. `node tools/doctor.js` → semua lulus
2. `node server.js` jalan, jendela dibiarkan terbuka
3. Dashboard pengawas terbuka di laptop panitia
4. **Reset semua** kalau masih ada data uji coba
5. Alamat ujian tertulis di papan tulis

**Saat peserta masuk**

6. Peserta membuka alamat, mengisi identitas, **tapi BELUM menekan Masuk**
7. Umumkan dengan jelas:

   > "Jangan tekan tombol Masuk sebelum saya bilang mulai. Timer 90 menit langsung
   > berjalan begitu kamu menekannya."

8. Bagikan kode akses
9. Beri instruksi mulai bersamaan

**Selama ujian**

10. Pantau dashboard. Perhatikan kolom **Pelanggaran** dan titik **online/offline**
11. Peserta bermasalah: tombol **+5m**, atau **Lain → Buka kembali**

**Setelah ujian**

12. **Export CSV** dari dashboard
13. Backup folder `data/runtime/` — berisi semua jawaban, kode peserta, dan audit log
14. Baru boleh matikan server

---

## Kalau mau diakses dari internet

Bisa, tapi pikirkan ulang dulu:

- Judge **menjalankan kode yang dikirim orang** di mesinmu. Di LAN tertutup dengan
  peserta yang identitasnya diketahui, risikonya rendah. Dibuka ke internet, siapa
  pun bisa mengirim kode apa pun. Minimal jalankan di VPS khusus di dalam Docker,
  jangan di komputer yang kamu pakai sehari-hari.
- Lockdown tidak ada artinya kalau peserta mengerjakan dari rumah tanpa pengawas.
- Latensi WiFi lokal ~1ms; lewat internet, autosave jawaban jadi jauh lebih lambat.

Kalau tetap perlu (misalnya peserta di gedung berbeda), opsi tercepat tanpa mengubah
kode: jalankan server seperti biasa lalu buat tunnel, misalnya
`cloudflared tunnel --url http://localhost:3000`. Pastikan `access_code` diaktifkan
dan `admin_key` kuat, karena alamatnya kini publik.

Untuk seleksi internal dengan peserta berkumpul di satu ruangan, **LAN tetap pilihan
yang benar** — lebih cepat, lebih aman, dan tidak bergantung internet kampus.

---

## Masalah yang sering muncul

| Gejala | Penyebab & solusi |
|---|---|
| `node: command not found` | Node.js belum terpasang, atau terminal belum dibuka ulang setelah instalasi |
| Peserta tidak bisa membuka alamat | Firewall (Langkah 7), beda SSID, atau *AP isolation* aktif di router |
| Bisa dibuka dari laptop panitia, tidak dari yang lain | Hampir pasti firewall |
| `EADDRINUSE` saat start | Port 3000 dipakai program lain, atau server ujian sudah jalan di jendela lain. Ubah `port` di config.json |
| Doctor bilang "hanya ada IP link-local" | Laptop belum dapat IP dari router. Sambungkan ulang WiFi |
| Bahasa yang diharapkan tidak muncul di pilihan peserta | Toolchain-nya belum terpasang. Server mencetak peringatan saat start; jalankan `node tools/doctor.js` |
| Jawaban peserta tidak tersimpan | Folder read-only. Pindahkan proyek keluar dari Program Files |
| Peserta tidak sengaja enroll kelewat awal | Dashboard → **+15m** atau **Lain → Buka kembali** |
| Server perlu di-restart di tengah ujian | Aman. State ada di `data/runtime/attempts.json`. Jalankan lagi, peserta cukup reload |
| Pelanggaran muncul padahal peserta tidak curang | Notifikasi OS memicu `blur`. Hapus catatannya di dashboard, naikkan `max_violations` |

---

## Ringkasan perintah

```bash
git clone https://github.com/dericsen/exam-apps.git
cd exam-apps

# edit config.json: admin_key + access_code

node tools/doctor.js        # preflight: wajib lulus
node tools/verify_cp.js     # pastikan judge benar
node server.js              # jalankan ujian

# opsional
node tools/selftest.js      # 127 pemeriksaan end-to-end
node tools/validate_bank.js # laporan kualitas bank soal
```
