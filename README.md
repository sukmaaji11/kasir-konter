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
- `src/application`: login PIN (Owner/karyawan) dan lisensi offline.
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

## Lisensi (Admin)

Kunci rahasia ada di `%USERPROFILE%\Documents\KasirKonterAdmin\license-private-key.json`
(di luar repo; cadangkan di dua tempat aman). Ubah lokasinya dengan
`KKO_LICENSE_KEY_FILE`.

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

Berikutnya:
1. Cadangan/pindah HP (ekspor/impor file) dan pengingat backup.
2. Halaman Admin di browser untuk membuat kode aktivasi.
