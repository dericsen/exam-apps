#!/bin/sh
# Launcher ujian untuk macOS / Linux.
# Menjalankan preflight check dulu, lalu server ujian.
#
# Pakai:  ./start.sh      (kalau belum bisa: chmod +x start.sh)

cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js tidak ditemukan."
  echo "Pasang dulu dari https://nodejs.org (pilih versi LTS), lalu jalankan lagi."
  exit 1
fi

node tools/doctor.js
STATUS=$?

echo ""
if [ "$STATUS" -ne 0 ]; then
  echo "Preflight menemukan masalah di atas."
  printf "Tetap jalankan server? (y/N) "
  read -r ANSWER
  case "$ANSWER" in
    y | Y) ;;
    *)
      echo "Dibatalkan."
      exit 1
      ;;
  esac
else
  printf "Tekan Enter untuk menjalankan server ujian, atau Ctrl+C untuk batal... "
  read -r _
fi

echo ""
node server.js
