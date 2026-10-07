#!/usr/bin/env python3
"""
Generator bank soal Competitive Programming level MUDAH.

Setiap soal didefinisikan bersama *reference solution*-nya. Expected output
TIDAK ditulis manual -- selalu dihitung oleh reference solution, sehingga
mustahil ada kunci jawaban yang salah.

Jalankan:  python3 tools/gen_cp.py
Hasil:     data/cp-problems.json
"""

import json
import os
import random
import textwrap

random.seed(20260101)

PROBLEMS = []


def problem(**meta):
    """Decorator: fungsi yang dihias adalah reference solution (stdin -> stdout).

    `inputs` dipakai begini:
      - dua entri PERTAMA menjadi contoh kasus yang ditampilkan di soal.
        Contoh ini TIDAK dinilai.
      - sisanya menjadi test case tersembunyi yang dinilai, digabung dengan
        HIDDEN_EXTRA di bawah.
    """

    def wrap(solve):
        meta["solve"] = solve
        PROBLEMS.append(meta)
        return solve

    return wrap


def ints(line):
    return [int(x) for x in line.split()]


def rand_list(n, lo, hi):
    return [random.randint(lo, hi) for _ in range(n)]


def case(n, lo, hi):
    """Helper: buat input 'N\\n<n angka>'."""
    return f"{n}\n" + " ".join(str(v) for v in rand_list(n, lo, hi))


# --------------------------------------------------------------------------
# E-001
# --------------------------------------------------------------------------
@problem(
    id="E-001",
    title="Penjumlahan Dua Bilangan",
    topic="Dasar / Input-Output",
    statement=(
        "Panitia seleksi ingin memastikan setiap peserta sudah bisa membaca input "
        "dan menulis output dengan benar.\n\n"
        "Diberikan dua bilangan bulat A dan B. Hitung dan cetak hasil penjumlahan "
        "keduanya."
    ),
    input_format="Satu baris berisi dua bilangan bulat A dan B, dipisahkan oleh spasi.",
    output_format="Satu baris berisi nilai A + B.",
    constraints="-10^9 <= A, B <= 10^9",
    notes=(
        "Soal ini sengaja dibuat sangat mudah sebagai pemanasan. Pastikan output "
        "diakhiri baris baru dan tidak ada tulisan tambahan seperti "
        '"Hasilnya adalah: ".'
    ),
    inputs=[
        "3 5",
        "-10 4",
        "0 0",
        "1000000000 1000000000",
        "-1000000000 -1000000000",
        "7 -7",
        "123456 654321",
    ],
)
def _e001(data):
    a, b = ints(data.strip())
    return str(a + b)


# --------------------------------------------------------------------------
# E-002
# --------------------------------------------------------------------------
@problem(
    id="E-002",
    title="Ganjil atau Genap",
    topic="Dasar / Percabangan",
    statement=(
        "Sebuah mesin absensi memberi nomor urut kepada setiap peserta. Peserta "
        "bernomor genap masuk ruang A, peserta bernomor ganjil masuk ruang B.\n\n"
        "Diberikan sebuah bilangan bulat N, tentukan apakah N ganjil atau genap."
    ),
    input_format="Satu baris berisi satu bilangan bulat N.",
    output_format='Cetak "GENAP" jika N genap, atau "GANJIL" jika N ganjil (tanpa tanda kutip).',
    constraints="-10^18 <= N <= 10^18",
    notes="Perhatikan bahwa N bisa negatif, dan -4 tetap tergolong genap.",
    inputs=[
        "4",
        "7",
        "0",
        "-3",
        "-8",
        "1000000000000000000",
        "999999999999999999",
    ],
)
def _e002(data):
    n = int(data.strip())
    return "GENAP" if n % 2 == 0 else "GANJIL"


# --------------------------------------------------------------------------
# E-003
# --------------------------------------------------------------------------
@problem(
    id="E-003",
    title="Nilai Tertinggi",
    topic="Array / Traversal",
    statement=(
        "Seorang dosen punya daftar nilai ujian dari N mahasiswa. Ia ingin tahu "
        "nilai tertinggi di kelas tersebut.\n\n"
        "Diberikan N bilangan bulat, cetak nilai terbesar di antaranya."
    ),
    input_format=(
        "Baris pertama berisi bilangan bulat N.\n"
        "Baris kedua berisi N bilangan bulat A[1], A[2], ..., A[N] dipisahkan spasi."
    ),
    output_format="Satu baris berisi nilai terbesar.",
    constraints="1 <= N <= 100000\n-10^9 <= A[i] <= 10^9",
    notes=(
        "Cukup satu kali pass dengan kompleksitas O(N). Hati-hati jika kamu "
        "menginisialisasi variabel jawaban dengan 0 -- semua nilai bisa negatif."
    ),
    inputs=[
        "5\n10 50 30 20 40",
        "3\n-7 -2 -9",
        "1\n42",
        case(1000, -10**9, 10**9),
        case(100000, -10**9, 10**9),
        "4\n5 5 5 5",
        "6\n-1000000000 1000000000 0 7 -7 999999999",
    ],
)
def _e003(data):
    lines = data.strip().split("\n")
    arr = ints(lines[1])
    return str(max(arr))


# --------------------------------------------------------------------------
# E-004
# --------------------------------------------------------------------------
@problem(
    id="E-004",
    title="Rata-Rata Kelas",
    topic="Array / Aritmetika",
    statement=(
        "Panitia ingin menghitung rata-rata nilai dari N peserta. Agar hasilnya "
        "pasti berupa bilangan bulat, rata-rata DIBULATKAN KE BAWAH (pembagian "
        "bilangan bulat).\n\n"
        "Contoh: rata-rata dari 70 dan 85 adalah 155 / 2 = 77.5, dibulatkan ke "
        "bawah menjadi 77."
    ),
    input_format=(
        "Baris pertama berisi bilangan bulat N.\n"
        "Baris kedua berisi N bilangan bulat nilai peserta."
    ),
    output_format="Satu baris berisi rata-rata yang sudah dibulatkan ke bawah.",
    constraints="1 <= N <= 100000\n0 <= A[i] <= 100",
    notes=(
        "Gunakan pembagian bilangan bulat: // di Python, / pada tipe int di C/C++ "
        "dan Java. Jangan cetak angka desimal."
    ),
    inputs=[
        "2\n70 85",
        "3\n80 90 100",
        "1\n0",
        "5\n100 100 100 100 100",
        case(1000, 0, 100),
        case(100000, 0, 100),
        "4\n1 2 3 4",
    ],
)
def _e004(data):
    lines = data.strip().split("\n")
    arr = ints(lines[1])
    return str(sum(arr) // len(arr))


# --------------------------------------------------------------------------
# E-005
# --------------------------------------------------------------------------
@problem(
    id="E-005",
    title="Hitung Huruf Vokal",
    topic="String",
    statement=(
        "Sebuah program pengolah teks sederhana perlu menghitung banyaknya huruf "
        "vokal dalam sebuah kalimat.\n\n"
        "Diberikan sebuah string S, hitung berapa banyak karakter pada S yang "
        "termasuk huruf vokal, yaitu a, e, i, o, atau u."
    ),
    input_format=(
        "Satu baris berisi string S. String dapat memuat huruf kecil dan spasi."
    ),
    output_format="Satu baris berisi banyaknya huruf vokal pada S.",
    constraints="1 <= panjang(S) <= 100000\nS hanya terdiri dari huruf kecil 'a'-'z' dan spasi.",
    notes=(
        "Baca seluruh BARIS termasuk spasinya: input() di Python, fgets di C, "
        "br.readLine() di Java. Jangan pakai scanf(\"%s\") atau cin >> yang "
        "berhenti begitu menemukan spasi."
    ),
    inputs=[
        "halo dunia",
        "xyz",
        "aeiou",
        "kompetisi pemrograman",
        "a",
        "bcdfg hjklm npqrs tvwxy z",
        "saya suka sekali menulis kode setiap hari di laboratorium",
    ],
)
def _e005(data):
    s = data.rstrip("\n")
    return str(sum(1 for c in s if c in "aeiou"))


# --------------------------------------------------------------------------
# E-006
# --------------------------------------------------------------------------
@problem(
    id="E-006",
    title="Balik Kata",
    topic="String",
    statement=(
        "Untuk keperluan enkripsi sederhana, sebuah pesan dibalik urutan "
        "karakternya.\n\n"
        "Diberikan sebuah string S, cetak S dengan urutan karakter terbalik."
    ),
    input_format="Satu baris berisi string S tanpa spasi.",
    output_format="Satu baris berisi string S yang sudah dibalik.",
    constraints="1 <= panjang(S) <= 100000\nS hanya terdiri dari huruf kecil 'a'-'z'.",
    notes="Di Python bisa memakai S[::-1]. Di C cukup tukar karakter dari dua ujung. "
        "Di Java ada new StringBuilder(s).reverse().",
    inputs=[
        "kiro",
        "pemrograman",
        "a",
        "racecar",
        "abcdefghij",
        "".join(random.choice("abcdefghijklmnopqrstuvwxyz") for _ in range(5000)),
        "".join(random.choice("abc") for _ in range(100000)),
    ],
)
def _e006(data):
    s = data.strip()
    return s[::-1]


# --------------------------------------------------------------------------
# E-007
# --------------------------------------------------------------------------
@problem(
    id="E-007",
    title="Faktorial",
    topic="Dasar / Perulangan",
    statement=(
        "Faktorial dari bilangan bulat positif N, ditulis N!, adalah hasil kali "
        "semua bilangan bulat dari 1 sampai N.\n\n"
        "Contoh: 5! = 1 x 2 x 3 x 4 x 5 = 120.\n\n"
        "Diberikan N, cetak nilai N!."
    ),
    input_format="Satu baris berisi bilangan bulat N.",
    output_format="Satu baris berisi nilai N!.",
    constraints="1 <= N <= 20",
    notes=(
        "20! = 2432902008176640000, masih muat pada tipe 64-bit: long long di "
        "C/C++, long di Java, int biasa di Python. Memakai int 32-bit akan "
        "overflow sejak 13!."
    ),
    inputs=["5", "1", "3", "10", "20", "15", "19"],
)
def _e007(data):
    n = int(data.strip())
    res = 1
    for i in range(2, n + 1):
        res *= i
    return str(res)


# --------------------------------------------------------------------------
# E-008
# --------------------------------------------------------------------------
@problem(
    id="E-008",
    title="Cek Palindrom",
    topic="String / Two Pointer",
    statement=(
        "Sebuah string disebut palindrom jika dibaca dari depan sama dengan "
        "dibaca dari belakang, misalnya \"katak\" dan \"level\".\n\n"
        "Diberikan sebuah string S, tentukan apakah S merupakan palindrom."
    ),
    input_format="Satu baris berisi string S tanpa spasi.",
    output_format='Cetak "YA" jika S palindrom, atau "BUKAN" jika tidak.',
    constraints="1 <= panjang(S) <= 100000\nS hanya terdiri dari huruf kecil 'a'-'z'.",
    notes="Output harus huruf kapital semua, tepat seperti pada contoh.",
    inputs=[
        "katak",
        "kiro",
        "a",
        "aa",
        "ab",
        "abcdedcba",
        "ab" * 50000,
    ],
)
def _e008(data):
    s = data.strip()
    return "YA" if s == s[::-1] else "BUKAN"


# --------------------------------------------------------------------------
# E-009
# --------------------------------------------------------------------------
@problem(
    id="E-009",
    title="Tiga dan Lima",
    topic="Dasar / Perulangan + Percabangan",
    statement=(
        "Sebuah permainan menghitung angka dimainkan dengan aturan berikut untuk "
        "setiap bilangan dari 1 sampai N:\n\n"
        "- Jika bilangan habis dibagi 3 DAN 5, ucapkan \"TIGALIMA\".\n"
        "- Jika hanya habis dibagi 3, ucapkan \"TIGA\".\n"
        "- Jika hanya habis dibagi 5, ucapkan \"LIMA\".\n"
        "- Selain itu, ucapkan bilangan itu sendiri.\n\n"
        "Cetak hasil permainan tersebut, satu ucapan per baris."
    ),
    input_format="Satu baris berisi bilangan bulat N.",
    output_format="N baris, masing-masing berisi hasil untuk bilangan 1 sampai N sesuai aturan di atas.",
    constraints="1 <= N <= 1000",
    notes="Periksa kondisi habis dibagi 15 LEBIH DULU sebelum memeriksa 3 dan 5 secara terpisah.",
    inputs=["5", "15", "1", "3", "16", "100", "1000"],
)
def _e009(data):
    n = int(data.strip())
    out = []
    for i in range(1, n + 1):
        if i % 15 == 0:
            out.append("TIGALIMA")
        elif i % 3 == 0:
            out.append("TIGA")
        elif i % 5 == 0:
            out.append("LIMA")
        else:
            out.append(str(i))
    return "\n".join(out)


# --------------------------------------------------------------------------
# E-010
# --------------------------------------------------------------------------
@problem(
    id="E-010",
    title="Frekuensi Angka",
    topic="Array / Counting",
    statement=(
        "Panitia mencatat nomor ruangan yang dipilih oleh N peserta. Panitia ingin "
        "tahu berapa peserta yang memilih ruangan tertentu.\n\n"
        "Diberikan N bilangan bulat dan sebuah bilangan X, hitung berapa kali X "
        "muncul di antara N bilangan tersebut."
    ),
    input_format=(
        "Baris pertama berisi dua bilangan bulat N dan X.\n"
        "Baris kedua berisi N bilangan bulat."
    ),
    output_format="Satu baris berisi banyaknya kemunculan X.",
    constraints="1 <= N <= 100000\n-10^9 <= X, A[i] <= 10^9",
    notes="Jika X tidak pernah muncul, cetak 0.",
    inputs=[
        "6 2\n1 2 3 2 2 4",
        "5 9\n1 2 3 4 5",
        "1 7\n7",
        "10 3\n3 3 3 3 3 3 3 3 3 3",
        "7 -5\n-5 5 -5 0 1 -5 2",
        f"1000 50\n" + " ".join(str(v) for v in rand_list(1000, 1, 100)),
        f"100000 1\n" + " ".join(str(v) for v in rand_list(100000, 1, 5)),
    ],
)
def _e010(data):
    lines = data.strip().split("\n")
    _, x = ints(lines[0])
    arr = ints(lines[1])
    return str(arr.count(x))


# --------------------------------------------------------------------------
# E-011
# --------------------------------------------------------------------------
@problem(
    id="E-011",
    title="Urutkan Nilai",
    topic="Sorting",
    statement=(
        "Diberikan daftar nilai N peserta yang masih acak. Urutkan nilai tersebut "
        "dari yang terkecil ke yang terbesar (ascending)."
    ),
    input_format=(
        "Baris pertama berisi bilangan bulat N.\n"
        "Baris kedua berisi N bilangan bulat."
    ),
    output_format="Satu baris berisi N bilangan bulat yang sudah terurut menaik, dipisahkan oleh satu spasi.",
    constraints="1 <= N <= 100000\n-10^9 <= A[i] <= 10^9",
    notes=(
        "Gunakan fungsi sort bawaan bahasamu: sorted() di Python, qsort di C, "
        "Arrays.sort di Java, std::sort di C++. Bubble sort akan terlalu lambat "
        "untuk N = 100000."
    ),
    inputs=[
        "5\n10 50 30 20 40",
        "3\n5 5 5",
        "1\n42",
        "6\n-3 7 0 -10 2 2",
        case(1000, -10**9, 10**9),
        case(100000, -10**9, 10**9),
        case(50, 0, 10),
    ],
)
def _e011(data):
    lines = data.strip().split("\n")
    arr = sorted(ints(lines[1]))
    return " ".join(str(v) for v in arr)


# --------------------------------------------------------------------------
# E-012
# --------------------------------------------------------------------------
@problem(
    id="E-012",
    title="Menghitung Bilangan Prima",
    topic="Matematika / Sieve",
    statement=(
        "Bilangan prima adalah bilangan bulat lebih besar dari 1 yang hanya habis "
        "dibagi oleh 1 dan dirinya sendiri.\n\n"
        "Diberikan sebuah bilangan bulat N, hitung ada berapa bilangan prima yang "
        "nilainya tidak lebih dari N."
    ),
    input_format="Satu baris berisi bilangan bulat N.",
    output_format="Satu baris berisi banyaknya bilangan prima yang <= N.",
    constraints="1 <= N <= 100000",
    notes=(
        "Memeriksa setiap bilangan satu per satu dengan pembagian sampai N masih "
        "cukup, tetapi Sieve of Eratosthenes jauh lebih rapi dan cepat. "
        "Ingat: 1 bukan bilangan prima."
    ),
    inputs=["10", "1", "2", "3", "100", "9973", "100000"],
)
def _e012(data):
    n = int(data.strip())
    if n < 2:
        return "0"
    sieve = bytearray([1]) * (n + 1)
    sieve[0] = sieve[1] = 0
    i = 2
    while i * i <= n:
        if sieve[i]:
            sieve[i * i :: i] = bytearray(len(sieve[i * i :: i]))
        i += 1
    return str(sum(sieve))


# --------------------------------------------------------------------------
# E-013
# --------------------------------------------------------------------------
@problem(
    id="E-013",
    title="Bilangan Fibonacci",
    topic="Dasar / Perulangan",
    statement=(
        "Barisan Fibonacci didefinisikan sebagai berikut:\n\n"
        "F(1) = 1\n"
        "F(2) = 1\n"
        "F(n) = F(n-1) + F(n-2) untuk n >= 3\n\n"
        "Sehingga barisannya adalah 1, 1, 2, 3, 5, 8, 13, ...\n\n"
        "Diberikan N, cetak nilai F(N)."
    ),
    input_format="Satu baris berisi bilangan bulat N.",
    output_format="Satu baris berisi nilai F(N).",
    constraints="1 <= N <= 90",
    notes=(
        "F(90) = 2880067194370816120, masih muat pada 64-bit: long long di C/C++, "
        "long di Java. Hindari rekursi tanpa memoisasi karena akan sangat lambat "
        "untuk N besar; cukup gunakan perulangan dengan dua variabel."
    ),
    inputs=["7", "1", "2", "10", "50", "90", "89"],
)
def _e013(data):
    n = int(data.strip())
    a, b = 1, 1
    for _ in range(n - 1):
        a, b = b, a + b
    return str(a)


# --------------------------------------------------------------------------
# E-014
# --------------------------------------------------------------------------
@problem(
    id="E-014",
    title="Selisih Terbesar",
    topic="Array / Traversal",
    statement=(
        "Manajer gudang mencatat harga N barang. Ia ingin mengetahui rentang "
        "harga, yaitu selisih antara harga termahal dan harga termurah.\n\n"
        "Diberikan N bilangan bulat, cetak selisih antara nilai terbesar dan nilai "
        "terkecil."
    ),
    input_format=(
        "Baris pertama berisi bilangan bulat N.\n"
        "Baris kedua berisi N bilangan bulat."
    ),
    output_format="Satu baris berisi nilai (maksimum - minimum).",
    constraints="1 <= N <= 100000\n-10^9 <= A[i] <= 10^9",
    notes=(
        "Jika N = 1, jawabannya 0. Hasil bisa mencapai 2 x 10^9 sehingga MELEBIHI "
        "batas int 32-bit -- gunakan long long di C/C++ atau long di Java."
    ),
    inputs=[
        "5\n10 2 8 15 3",
        "3\n-5 0 5",
        "1\n7",
        "2\n-1000000000 1000000000",
        "4\n4 4 4 4",
        case(1000, -10**9, 10**9),
        case(100000, -10**9, 10**9),
    ],
)
def _e014(data):
    lines = data.strip().split("\n")
    arr = ints(lines[1])
    return str(max(arr) - min(arr))


# --------------------------------------------------------------------------
# E-015
# --------------------------------------------------------------------------
@problem(
    id="E-015",
    title="Hitung Kata",
    topic="String / Parsing",
    statement=(
        "Sebuah editor teks sederhana perlu menampilkan jumlah kata pada sebuah "
        "kalimat.\n\n"
        "Diberikan sebuah kalimat S, hitung ada berapa kata di dalamnya. Kata "
        "dipisahkan oleh satu atau lebih spasi. Kalimat dapat diawali atau diakhiri "
        "oleh spasi."
    ),
    input_format="Satu baris berisi kalimat S.",
    output_format="Satu baris berisi banyaknya kata pada S.",
    constraints=(
        "1 <= panjang(S) <= 100000\n"
        "S hanya terdiri dari huruf kecil 'a'-'z' dan spasi."
    ),
    notes=(
        "Hati-hati dengan spasi ganda dan spasi di awal/akhir kalimat. Di Python, "
        "S.split() sudah menangani semuanya. Di Java, S.trim().split(\"\\\\s+\") "
        "dengan catatan string kosong harus ditangani terpisah. Di C, hitung "
        "peralihan dari spasi ke non-spasi."
    ),
    inputs=[
        "saya suka pemrograman",
        "satu",
        "  banyak    spasi   di sini  ",
        "a b c d e f g",
        "   ",
        "kompetisi pemrograman kompetitif seleksi tim riset dan proyek ilmu komputer",
        " ".join(["kata"] * 10000),
    ],
)
def _e015(data):
    s = data.rstrip("\n")
    return str(len(s.split()))


# --------------------------------------------------------------------------
# Test case tersembunyi tambahan.
#
# Alasan keberadaannya: contoh kasus di soal TIDAK boleh dinilai, karena
# peserta bisa sekadar menuliskan jawabannya langsung:
#
#     s = input()
#     if s == "kiro": print("orik")
#
# Tanpa pemisahan, kode seperti itu lolos 2 dari 7 test dan mendapat 29/100
# tanpa algoritma apa pun. Karena itu seluruh penilaian memakai test case
# tersembunyi, dan nilainya sengaja dibuat berbeda dari contoh.
#
# Jumlah test tersembunyi juga diperbanyak menjadi ~10 per soal supaya
# partial credit lebih halus (satu test = 10 poin, bukan 20) dan supaya
# menebak-nebak jadi tidak mungkin.
# --------------------------------------------------------------------------
HIDDEN_EXTRA = {
    "E-001": ["1 -1", "-5 3", "999999999 1", "-999999999 -1", "500000000 500000000"],
    "E-002": ["1", "2", "-1", "-2", "123456789012345678"],
    "E-003": [
        "1\n-1000000000",
        "2\n-1 -2",
        "5\n-5 -4 -3 -2 -1",
        "3\n1000000000 999999999 999999998",
        case(50, -100, 100),
    ],
    "E-004": [
        "1\n100",
        "2\n1 2",
        "3\n0 0 1",
        "7\n99 100 98 97 96 95 94",
        case(999, 0, 100),
    ],
    "E-005": ["aaaaa", "e", "zzz zzz", "aeiouaeiou", "i u a e o y w x"],
    "E-006": [
        "zz",
        "qwertyuiop",
        "ab",
        "".join(random.choice("xyz") for _ in range(777)),
        "".join(random.choice("abcdefghij") for _ in range(12345)),
    ],
    "E-007": ["2", "12", "18", "7", "13"],
    "E-008": ["aba", "abba", "abcba", "xy", "a" * 99999],
    "E-009": ["2", "30", "999", "45", "7"],
    "E-010": [
        "1 7\n8",
        "3 1000000000\n1000000000 1 2",
        "2 0\n0 0",
        "4 -1\n1 2 3 4",
        f"500 7\n" + " ".join(str(v) for v in rand_list(500, 1, 20)),
    ],
    "E-011": [
        "2\n2 1",
        "5\n1 2 3 4 5",
        "5\n5 4 3 2 1",
        "3\n-1000000000 0 1000000000",
        case(777, -1000, 1000),
    ],
    "E-012": ["4", "1000", "99991", "50", "7919"],
    "E-013": ["3", "45", "70", "88", "30"],
    "E-014": [
        "2\n0 1",
        "3\n-1 -2 -3",
        "5\n1000000000 1000000000 1000000000 1000000000 1000000000",
        case(50, -5, 5),
        case(333, -(10**9), 10**9),
    ],
    "E-015": ["satu dua", "  awal", "akhir  ", "a", "x y"],
}


# --------------------------------------------------------------------------
# Build JSON
# --------------------------------------------------------------------------
REFERENCE_SOLUTIONS = {
    "E-001": "a, b = map(int, input().split())\nprint(a + b)",
    "E-002": "n = int(input())\nprint('GENAP' if n % 2 == 0 else 'GANJIL')",
    "E-003": "n = int(input())\narr = list(map(int, input().split()))\nprint(max(arr))",
    "E-004": "n = int(input())\narr = list(map(int, input().split()))\nprint(sum(arr) // n)",
    "E-005": "s = input()\nprint(sum(1 for c in s if c in 'aeiou'))",
    "E-006": "print(input()[::-1])",
    "E-007": (
        "n = int(input())\nres = 1\nfor i in range(2, n + 1):\n    res *= i\nprint(res)"
    ),
    "E-008": "s = input()\nprint('YA' if s == s[::-1] else 'BUKAN')",
    "E-009": (
        "n = int(input())\n"
        "for i in range(1, n + 1):\n"
        "    if i % 15 == 0:\n        print('TIGALIMA')\n"
        "    elif i % 3 == 0:\n        print('TIGA')\n"
        "    elif i % 5 == 0:\n        print('LIMA')\n"
        "    else:\n        print(i)"
    ),
    "E-010": (
        "n, x = map(int, input().split())\n"
        "arr = list(map(int, input().split()))\n"
        "print(arr.count(x))"
    ),
    "E-011": (
        "n = int(input())\n"
        "arr = sorted(map(int, input().split()))\n"
        "print(' '.join(map(str, arr)))"
    ),
    "E-012": (
        "n = int(input())\n"
        "if n < 2:\n    print(0)\n"
        "else:\n"
        "    sieve = [True] * (n + 1)\n"
        "    sieve[0] = sieve[1] = False\n"
        "    i = 2\n"
        "    while i * i <= n:\n"
        "        if sieve[i]:\n"
        "            for j in range(i * i, n + 1, i):\n"
        "                sieve[j] = False\n"
        "        i += 1\n"
        "    print(sum(sieve))"
    ),
    "E-013": (
        "n = int(input())\n"
        "a, b = 1, 1\n"
        "for _ in range(n - 1):\n    a, b = b, a + b\n"
        "print(a)"
    ),
    "E-014": (
        "n = int(input())\n"
        "arr = list(map(int, input().split()))\n"
        "print(max(arr) - min(arr))"
    ),
    "E-015": "print(len(input().split()))",
}

STARTER_CODE = {
    "python": (
        "# Baca input dari stdin, cetak jawaban ke stdout.\n"
        "# Contoh: n = int(input())\n\n"
        "# Tulis solusimu di sini\n"
    ),
    "c": (
        "#include <stdio.h>\n"
        "#include <stdlib.h>\n"
        "#include <string.h>\n\n"
        "int main(void) {\n"
        "    // Tulis solusimu di sini\n"
        "    // Baca dengan scanf, cetak dengan printf\n\n"
        "    return 0;\n"
        "}\n"
    ),
    "cpp": (
        "#include <bits/stdc++.h>\nusing namespace std;\n\n"
        "int main() {\n"
        "    ios::sync_with_stdio(false);\n"
        "    cin.tie(nullptr);\n\n"
        "    // Tulis solusimu di sini\n\n"
        "    return 0;\n"
        "}\n"
    ),
    "java": (
        "import java.io.*;\n"
        "import java.util.*;\n\n"
        "// PENTING: nama kelas harus tetap \"Main\", jangan diubah.\n"
        "public class Main {\n"
        "    public static void main(String[] args) throws IOException {\n"
        "        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));\n"
        "        StringBuilder out = new StringBuilder();\n\n"
        "        // Tulis solusimu di sini.\n"
        "        // Contoh baca satu baris berisi beberapa angka:\n"
        "        //   StringTokenizer st = new StringTokenizer(br.readLine());\n"
        "        //   int n = Integer.parseInt(st.nextToken());\n\n"
        "        System.out.print(out);\n"
        "    }\n"
        "}\n"
    ),
    "javascript": (
        "const data = require('fs').readFileSync(0, 'utf8');\n"
        "const lines = data.split('\\n');\n\n"
        "// Tulis solusimu di sini\n"
    ),
}


def main():
    out = {
        "problem_set_id": "CP-EASY-2026",
        "problem_set_name": "CS Selection 2026 - Competitive Programming (Level Mudah)",
        "version": "2.0",
        "generated_by": "tools/gen_cp.py",
        "scoring": (
            "Nilai per soal = 100 * (test case TERSEMBUNYI yang lulus / total test "
            "tersembunyi). Partial credit aktif. Contoh kasus yang ditampilkan di soal "
            "TIDAK ikut dinilai dan nilainya berbeda dari test tersembunyi, supaya "
            "jawaban yang di-hardcode tidak mendapat nilai apa pun."
        ),
        "starter_code": STARTER_CODE,
        "problems": [],
    }

    problems_errors = []

    def normalize(s):
        return s.strip().replace("\r\n", "\n")

    for p in PROBLEMS:
        solve = p["solve"]
        raw_samples = p["inputs"][:2]
        raw_hidden = list(p["inputs"][2:]) + list(HIDDEN_EXTRA.get(p["id"], []))

        def build(raws, start_no):
            items = []
            for idx, raw in enumerate(raws):
                inp = raw if raw.endswith("\n") else raw + "\n"
                items.append(
                    {"no": start_no + idx, "input": inp, "output": solve(inp) + "\n"}
                )
            return items

        samples = build(raw_samples, 1)
        hidden = build(raw_hidden, 1)

        # --- Pemeriksaan keras: contoh dan test tersembunyi harus BEDA.
        sample_keys = {normalize(s["input"]) for s in samples}
        clash = [h["no"] for h in hidden if normalize(h["input"]) in sample_keys]
        if clash:
            problems_errors.append(
                f"{p['id']}: test tersembunyi #{clash} memakai input yang sama dengan "
                f"contoh di soal. Jawaban hardcode akan mendapat nilai."
            )
        if len(samples) < 2:
            problems_errors.append(f"{p['id']}: contoh kasus kurang dari 2.")
        if len(hidden) < 8:
            problems_errors.append(
                f"{p['id']}: hanya {len(hidden)} test tersembunyi, minimal 8 agar "
                f"partial credit cukup halus."
            )

        out["problems"].append(
            {
                "id": p["id"],
                "title": p["title"],
                "difficulty": "easy",
                "topic": p["topic"],
                "time_limit_ms": 3000,
                "memory_limit_mb": 256,
                "points": 100,
                "statement": p["statement"],
                "input_format": p["input_format"],
                "output_format": p["output_format"],
                "constraints": p["constraints"],
                "notes": p["notes"],
                # Ditampilkan ke peserta, tidak dinilai.
                "samples": samples,
                # Tersembunyi, inilah yang dinilai.
                "test_cases": hidden,
                "reference_solution": {
                    "language": "python",
                    "code": REFERENCE_SOLUTIONS[p["id"]],
                },
            }
        )

    if problems_errors:
        print("GAGAL -- bank soal tidak ditulis:")
        for e in problems_errors:
            print("  " + e)
        raise SystemExit(1)

    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    path = os.path.join(here, "data", "cp-problems.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)

    total_hidden = sum(len(p["test_cases"]) for p in out["problems"])
    total_samples = sum(len(p["samples"]) for p in out["problems"])
    print(
        f"OK  {len(out['problems'])} soal, {total_hidden} test tersembunyi (dinilai), "
        f"{total_samples} contoh (tidak dinilai) -> {path}"
    )
    for p in out["problems"]:
        print(
            f"  {p['id']}  {p['title']:<28} "
            f"{len(p['test_cases'])} test dinilai + {len(p['samples'])} contoh  "
            f"[{p['topic']}]"
        )


if __name__ == "__main__":
    main()
