export const DATABASE_NAME = "kasir_konter";
export const SCHEMA_VERSION = 3;

export type StoredValue = string | number | null;
export type StoredRow = Record<string, StoredValue>;

/**
 * Skema versi 1. Uang disimpan sebagai INTEGER rupiah bulat.
 * Waktu disimpan sebagai epoch milidetik (UTC); laporan dikelompokkan
 * per hari Asia/Jakarta di lapisan domain.
 */
export const SCHEMA_VERSION_1_STATEMENTS: readonly string[] = [
  `CREATE TABLE sales (
    id TEXT PRIMARY KEY,
    number TEXT NOT NULL UNIQUE,
    sold_at_ms INTEGER NOT NULL,
    customer_name TEXT,
    customer_phone TEXT,
    items_total_rupiah INTEGER NOT NULL CHECK (items_total_rupiah >= 0),
    trade_in_credit_rupiah INTEGER NOT NULL DEFAULT 0 CHECK (trade_in_credit_rupiah >= 0),
    payment_method TEXT NOT NULL CHECK (payment_method IN ('tunai', 'transfer', 'qris')),
    note TEXT,
    voided_at_ms INTEGER,
    void_reason TEXT
  )`,
  `CREATE INDEX sales_sold_at ON sales (sold_at_ms)`,

  `CREATE TABLE phone_units (
    id TEXT PRIMARY KEY,
    brand TEXT NOT NULL,
    model TEXT NOT NULL,
    variant TEXT,
    color TEXT,
    imei1 TEXT NOT NULL,
    imei2 TEXT,
    condition TEXT NOT NULL CHECK (condition IN ('baru', 'bekas')),
    completeness TEXT,
    note TEXT,
    cost_rupiah INTEGER NOT NULL CHECK (cost_rupiah >= 0),
    planned_price_rupiah INTEGER CHECK (planned_price_rupiah IS NULL OR planned_price_rupiah >= 0),
    source TEXT NOT NULL CHECK (source IN ('supplier', 'beli_pelanggan', 'tukar_tambah')),
    source_party TEXT,
    acquired_at_ms INTEGER NOT NULL,
    trade_in_sale_id TEXT REFERENCES sales (id),
    status TEXT NOT NULL CHECK (status IN ('stok', 'terjual', 'dibatalkan')),
    sold_sale_id TEXT REFERENCES sales (id),
    CHECK ((source = 'tukar_tambah') = (trade_in_sale_id IS NOT NULL)),
    CHECK ((status = 'terjual') = (sold_sale_id IS NOT NULL))
  )`,
  // IMEI yang sama boleh muncul lagi (HP dijual lalu dibeli kembali),
  // tapi tidak boleh ada dua unit stok dengan IMEI yang sama.
  `CREATE UNIQUE INDEX phone_units_imei1_in_stock ON phone_units (imei1) WHERE status = 'stok'`,
  `CREATE INDEX phone_units_imei1 ON phone_units (imei1)`,
  `CREATE INDEX phone_units_imei2 ON phone_units (imei2)`,
  `CREATE INDEX phone_units_status ON phone_units (status, acquired_at_ms)`,

  `CREATE TABLE accessories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT,
    cost_rupiah INTEGER NOT NULL CHECK (cost_rupiah >= 0),
    price_rupiah INTEGER NOT NULL CHECK (price_rupiah >= 0),
    stock_quantity INTEGER NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
    created_at_ms INTEGER NOT NULL,
    archived_at_ms INTEGER
  )`,
  `CREATE TABLE accessory_restocks (
    id TEXT PRIMARY KEY,
    accessory_id TEXT NOT NULL REFERENCES accessories (id),
    restocked_at_ms INTEGER NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_cost_rupiah INTEGER NOT NULL CHECK (unit_cost_rupiah >= 0),
    supplier TEXT
  )`,

  `CREATE TABLE sale_lines (
    id TEXT PRIMARY KEY,
    sale_id TEXT NOT NULL REFERENCES sales (id),
    position INTEGER NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('hp', 'aksesoris')),
    phone_unit_id TEXT REFERENCES phone_units (id),
    accessory_id TEXT REFERENCES accessories (id),
    name TEXT NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_price_rupiah INTEGER NOT NULL CHECK (unit_price_rupiah >= 0),
    unit_cost_rupiah INTEGER NOT NULL CHECK (unit_cost_rupiah >= 0),
    CHECK (
      (kind = 'hp' AND phone_unit_id IS NOT NULL AND accessory_id IS NULL AND quantity = 1)
      OR (kind = 'aksesoris' AND accessory_id IS NOT NULL AND phone_unit_id IS NULL)
    ),
    UNIQUE (sale_id, position)
  )`,
  `CREATE INDEX sale_lines_phone ON sale_lines (phone_unit_id)`,

  `CREATE TABLE service_orders (
    id TEXT PRIMARY KEY,
    number TEXT NOT NULL UNIQUE,
    received_at_ms INTEGER NOT NULL,
    customer_name TEXT NOT NULL,
    customer_phone TEXT,
    device TEXT NOT NULL,
    imei TEXT,
    complaint TEXT NOT NULL,
    completeness TEXT,
    unlock_code TEXT,
    estimate_rupiah INTEGER CHECK (estimate_rupiah IS NULL OR estimate_rupiah >= 0),
    deposit_rupiah INTEGER NOT NULL DEFAULT 0 CHECK (deposit_rupiah >= 0),
    status TEXT NOT NULL CHECK (status IN ('proses', 'selesai', 'batal', 'diambil')),
    total_charge_rupiah INTEGER CHECK (total_charge_rupiah IS NULL OR total_charge_rupiah >= 0),
    parts_cost_rupiah INTEGER NOT NULL DEFAULT 0 CHECK (parts_cost_rupiah >= 0),
    parts_note TEXT,
    outcome TEXT CHECK (outcome IS NULL OR outcome IN ('selesai', 'batal')),
    finished_at_ms INTEGER,
    picked_up_at_ms INTEGER,
    CHECK ((status = 'diambil') = (picked_up_at_ms IS NOT NULL)),
    CHECK (status = 'proses' OR (total_charge_rupiah IS NOT NULL AND outcome IS NOT NULL))
  )`,
  `CREATE INDEX service_orders_status ON service_orders (status, received_at_ms)`,
  `CREATE INDEX service_orders_picked_up ON service_orders (picked_up_at_ms)`,
  `CREATE INDEX service_orders_imei ON service_orders (imei)`,
];

/** Skema versi 2: pengguna (Owner/karyawan) dan pengaturan (lisensi, profil toko). */
export const SCHEMA_VERSION_2_STATEMENTS: readonly string[] = [
  `CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
  `CREATE TABLE users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('owner', 'staff')),
    pin_hash TEXT NOT NULL,
    pin_salt TEXT NOT NULL,
    pin_iterations INTEGER NOT NULL CHECK (pin_iterations > 0),
    created_at_ms INTEGER NOT NULL,
    archived_at_ms INTEGER
  )`,
];

/**
 * Skema versi 3: foto produk. Disimpan terpisah dari tabel produk supaya
 * daftar stok cukup memuat thumbnail kecil, bukan foto penuh.
 * HP boleh beberapa foto (urut `position`), aksesoris satu foto.
 */
export const SCHEMA_VERSION_3_STATEMENTS: readonly string[] = [
  `CREATE TABLE photos (
    id TEXT PRIMARY KEY,
    owner_type TEXT NOT NULL CHECK (owner_type IN ('phone', 'accessory')),
    owner_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    thumb_data_url TEXT NOT NULL,
    full_data_url TEXT NOT NULL,
    created_at_ms INTEGER NOT NULL
  )`,
  `CREATE INDEX photos_owner ON photos (owner_type, owner_id, position)`,
];
