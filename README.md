# Kasir Konter

Aplikasi kasir Android offline-first untuk konter HP: jual beli HP (baru,
bekas, tukar tambah), service, dan aksesoris. Fokus utamanya: pemilik konter
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
- Nama, harga jual, dan harga modal dibekukan di baris nota, jadi mengubah
  harga nanti tidak mengubah laporan lama.
- Laporan memakai hari Asia/Jakarta (WIB). Nomor nota per hari:
  `J-YYYYMMDD-001` (jual) dan `S-YYYYMMDD-001` (service).
- Nota bisa dibatalkan: HP kembali ke stok, stok aksesoris dikembalikan, HP
  tukar tambah dikeluarkan. Ditolak kalau HP tukar tambahnya sudah terjual.
- IMEI unik hanya di antara HP yang masih di stok, karena HP yang sama bisa
  dijual lalu dibeli kembali. Riwayat per IMEI tetap bisa dicari.

## Struktur

- `src/domain`: aturan bisnis murni (tanpa database/DOM).
- `src/data`: skema SQLite berversi, migrasi, dan `KonterRepository`.
  Tes memakai SQL.js, sedangkan Android memakai `@capacitor-community/sqlite`.

## Status

Tahap 1 (selesai): domain + database + laporan untung, dengan tes.

Berikutnya:
1. Lisensi/aktivasi kode (dari Kasir Kaki Lima, dengan kunci terpisah) dan
   login PIN Owner/karyawan (sembunyikan untung dan PIN pelanggan dari karyawan).
2. Layar: stok HP, kasir, service, laporan (tablet landscape + HP).
3. Cadangan/pindah HP, cetak nota thermal dan bagikan ke WA.
4. Platform Android (`npx cap add android`) dan uji di tablet.
