@echo off
REM Launcher ujian untuk Windows.
REM Menjalankan preflight check dulu, lalu server ujian.
REM Cukup klik dua kali file ini.

cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js tidak ditemukan.
  echo.
  echo Pasang dulu dari https://nodejs.org ^(pilih versi LTS^), lalu jalankan lagi file ini.
  echo Jangan lupa tutup dan buka ulang jendela ini setelah instalasi.
  echo.
  pause
  exit /b 1
)

node tools\doctor.js
set STATUS=%errorlevel%

echo.
if not "%STATUS%"=="0" (
  echo Preflight menemukan masalah di atas.
  set /p ANSWER="Tetap jalankan server? (y/N) "
  if /i not "%ANSWER%"=="y" (
    echo Dibatalkan.
    pause
    exit /b 1
  )
) else (
  echo Tekan tombol apa saja untuk menjalankan server ujian, atau tutup jendela ini untuk batal.
  pause >nul
)

echo.
node server.js

echo.
echo Server berhenti.
pause
