# Kasir Konter

Aplikasi kasir Android offline-first untuk konter HP: jual beli HP (baru,
bekas, tukar tambah), service, aksesoris, dan layanan digital (pulsa, paket
data, kartu perdana, top up, token listrik). Fokus utamanya: pemilik konter
langsung tahu **untung per HP, per hari, dan per bulan**, dipisah per lini.

Teknologinya sama dengan Kasir Kaki Lima (Capacitor + React + SQLite), tapi
kodenya terpisah. Application ID: `id.co.jadicuan.kasirkonter`.
Model jual: sekali bayar tanpa langganan, jadi aplikasi tidak boleh
bergantung pada server.

```text
npm test
npm run typecheck
npm run build
```

## Aturan hitung untung

- Uang selalu rupiah bulat (`bigint`), disimpan sebagai INTEGER.
- **HP:** stok dicatat per unit (IMEI). Untung = harga jual − harga modal unit itu.
- **Tukar tambah:** HP lama pelanggan masuk stok dengan modal = nilai
  potongannya. Potongan tidak mengurangi untung nota; untung HP lama baru
  dihitung saat HP itu dijual lagi.
- **Aksesoris:** harga modal = harga kulakan terakhir (diperbarui setiap
  tambah stok). Jual melebihi stok ditolak.
- **Service:** untung = biaya yang dibayar pelanggan − modal sparepart
  (termasuk ongkir). Masuk laporan pada **hari HP diambil**, bukan saat
  selesai dikerjakan. Service batal tetap bisa punya biaya cek dan modal
  sparepart yang terlanjur dibeli.
- **Digital:** untung = harga jual − modal (harga server/aplikasi agen).
  Pulsa, paket data, top up, dan token tidak punya stok; modalnya boleh
  disesuaikan saat jual kalau harga server berubah. Kartu perdana punya stok
  (jual melebihi stok ditolak). Transaksi manual (tanpa daftar produk) wajib
  diisi nama dan modal. Nomor tujuan disimpan di baris nota.
- **Pelunasan service** dicatat di Kasir (bagian Service) lengkap dengan
  metode bayar, lalu nota service bisa dikirim ke WA.
- **Garansi service** dicatat per service saat menandai perbaikan selesai
  (tanpa / 7 / 14 hari / 1 / 3 bulan / lainnya, plus ketentuan) dan masih bisa
  diubah saat HP diserahkan. Masa garansi dihitung dari **tanggal HP diambil**
  dan hanya dicetak di nota service itu. Service batal tidak bergaransi.
  "Pesan di bawah semua nota" di Profil konter bukan tempat garansi.
  Halaman Service punya **Cek garansi**, dan form service baru memberi
  peringatan kalau IMEI-nya masih bergaransi.
- Nama, harga jual, dan harga modal dibekukan di baris nota, jadi mengubah
  harga nanti tidak mengubah laporan lama.
- Laporan memakai hari Asia/Jakarta (WIB). Nomor nota per hari:
  `J-YYYYMMDD-001` (jual) dan `S-YYYYMMDD-001` (service).
- Nota bisa dibatalkan: HP kembali ke stok, stok aksesoris dan kartu perdana
  dikembalikan, HP tukar tambah dikeluarkan. Ditolak kalau HP tukar tambahnya sudah terjual.
- IMEI unik hanya di antara HP yang masih di stok, karena HP yang sama bisa
  dijual lalu dibeli kembali. Riwayat per IMEI tetap bisa dicari.

## Struktur

- `src/domain`: aturan bisnis murni (tanpa database/DOM).
- `src/data`: skema SQLite berversi, migrasi, dan `KonterRepository`.
  Tes memakai SQL.js, sedangkan Android memakai `@capacitor-community/sqlite`.
- `src/application`: login PIN (Owner/karyawan), lisensi offline, printer,
  laporan, dan cadangan (`backup.ts`).
- `src/licensing`: format kode aktivasi `KKO1`. Kode Kasir Kaki Lima (`KKL1`)
  tidak berlaku di sini.
- `src/printing`: struk thermal ESC/POS 58/80 mm + port printer Bluetooth
  (plugin native `BluetoothPrinterPlugin.java`, diambil dari Kasir Kaki Lima).
- `src/reports`: penulis PDF kecil tanpa library + laporan untung A4.
- `src/ui`: Beranda (ringkasan hari ini, grafik 7 hari, perlu perhatian),
  Kasir (Barang · Digital · Service), Stok HP, Service, Aksesoris, Produk
  digital, Riwayat nota, Laporan untung, Pengaturan.

## Hak akses

Karyawan boleh jualan, service, dan melihat stok. Harga modal, untung, HP
masuk, tambah stok/harga aksesoris dan produk digital, pembatalan nota, dan pengaturan pengguna
hanya untuk Owner.

## Cadangan & pindah HP

Data hanya ada di perangkat, jadi Owner perlu membuat cadangan
(Pengaturan → **Cadangan & pindah HP**). Beranda mengingatkan kalau belum
pernah atau sudah lebih dari 7 hari.

- File `kasir-konter-cadangan-YYYY-MM-DD-HHMM.json` berisi semua tabel + checksum
  SHA-256, lalu dibagikan lewat lembar Bagikan (Drive, WA, dan lainnya). Lisensi
  tidak ikut.
- **Pulihkan** dari Pengaturan, atau dari layar **Buat akun Owner** di HP baru
  (setelah aktivasi). Pratinjau isi file tampil dulu, lalu Owner mencentang
  persetujuan. Semua tabel diganti dalam **satu transaksi**: kalau file rusak,
  terpotong, atau tidak cocok, data lama tetap utuh.
- Cadangan dari versi aplikasi lama dinaikkan lewat migrasi skema yang sama.
  Lisensi dan printer perangkat tujuan tidak tertimpa. Salinan data sebelum
  dipulihkan disimpan di `files/cadangan/sebelum-pulihkan.json` (memori
  aplikasi). Setelah pulihkan, aplikasi kembali ke layar PIN dan semua
  pengguna masuk dengan PIN lama.

## Lisensi (Admin)

Kunci rahasia ada di `%USERPROFILE%\Documents\KasirKonterAdmin\license-private-key.json`
(di luar repo; cadangkan di dua tempat aman). Ubah lokasinya dengan
`KKO_LICENSE_KEY_FILE`.

Cara termudah: buka **`tools/license/admin.html`** (klik dua kali; berjalan
offline di Chrome/Edge, sama seperti Admin Kasir Kaki Lima):

1. Seret file kunci rahasia ke halaman. Kunci dicek cocok dengan kunci publik
   aplikasi, hanya dibaca di browser, dan hilang saat halaman ditutup.
2. Pilih **Aktivasi** atau **Reset PIN Owner**, lalu isi kode perangkat, nama,
   dan No. WA.
3. **Buat kode** → *Salin kode*, *Salin pesan WA*, atau *Buka WhatsApp*.
4. Riwayat tersimpan di browser itu: bisa dicari, diekspor ke CSV, dan
   dicadangkan/dipulihkan sebagai JSON. Ada peringatan kalau perangkat sudah
   pernah diaktivasi.

`admin.html` dibangun dari `admin.template.html` + `license-core.mjs` dengan
`npm run admin:page` (tes gagal kalau lupa dibangun ulang). Jangan unggah
halaman ini bersama kunci ke internet. Alternatif baris perintah:

```text
node tools/license/admin.mjs aktivasi ABCDE-12345
node tools/license/admin.mjs reset ABCDE-12345
```

## Pratinjau di browser

`npm run dev`, lalu buka `/preview.html?tab=kasir` (opsional `&role=staff`).
Halaman ini berisi data contoh dan langsung masuk tanpa aktivasi. Hanya untuk
pengembangan; tidak ikut build produksi.

## Build Android (uji)

PowerShell, dari root repo:

```powershell
$env:JAVA_HOME = "$env:USERPROFILE\.jdks\jdk-21.0.13+9"
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
npm run build
npm run cap:sync
Set-Location android
.\gradlew.bat assembleDebug "-Dorg.gradle.java.installations.paths=$env:JAVA_HOME"
```

APK uji: `android/app/build/outputs/apk/debug/app-debug.apk`, dengan ID
`id.co.jadicuan.kasirkonter.dev`, terpisah dari versi rilis.

## Ikon & splash

- Ikon launcher dan ikon splash dibuat oleh `tools/icons/launcher_icon.py`
  (navy + logo ponsel bercentang, sama dengan `src/ui/BrandLogo.tsx`):
  `python tools/icons/launcher_icon.py export android/app/src/main/res`.
- Splash sistem Android (navy + logo) ditahan `MainActivity` sampai halaman web
  selesai dimuat (maks. 8 detik), lalu ditutup tanpa animasi. `index.html`
  berisi splash HTML dengan logo di posisi yang sama, jadi tidak ada layar
  kosong/kilatan saat WebView menyala.

## Status

- Tahap 1: domain, database, laporan untung.
- Tahap 2: lisensi + PIN, semua layar utama, platform Android. Sudah jalan
  di tablet SM-T225.
- Revisi Owner 1: tulisan lebih kecil, menu bawah + Beranda, Kasir 2 langkah,
  foto produk (skema v3).
- Revisi Owner 2: Beranda lebih lengkap, Kasir untuk pelunasan service,
  layanan digital (skema v4).
- Revisi Owner 3: Laporan dengan periode (hari ini, kemarin, 7 hari, bulan
  ini/lalu, pilih bulan, rentang tanggal) + export PDF, nota gaya Kasir Kaki
  Lima (uang diterima/kembalian), cetak nota Bluetooth, panduan Kasir Digital
  saat daftar kosong.

- Revisi Owner 4: menu bawah Beranda/Kasir/Service/Pengaturan, Pengaturan
  gaya Kasir Kaki Lima, halaman Barang terlaris & Cara bayar, filter periode
  lengkap di Riwayat nota.
- Revisi Owner 5: cadangan & pindah HP, halaman Admin lisensi
  (`tools/license/admin.html`), garansi per service (skema v5).
