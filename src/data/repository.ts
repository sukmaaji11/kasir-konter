import type { StoredUser, UserRole } from "../domain/auth";
import {
  assertDigitalCategory,
  DIGITAL_CATEGORIES,
  defaultTracksStock,
  type DigitalCategory,
} from "../domain/digital";
import { DomainError } from "../domain/errors";
import {
  assertNonNegativeRupiah,
  assertPositiveQuantity,
  type Rupiah,
} from "../domain/money";
import {
  normalizeImei,
  phoneDisplayName,
  validatePhoneIntake,
  type PhoneCondition,
  type PhoneIntakeInput,
  type PhoneSource,
  type PhoneStatus,
} from "../domain/phones";
import {
  summarizeProfit,
  totalsOf,
  type BusinessLine,
  type ProfitEntry,
  type ProfitSummary,
  type ProfitTotals,
} from "../domain/report";
import {
  assertPaymentMethod,
  summarizeSale,
  validateSaleLine,
  type PaymentMethod,
  type SaleLineKind,
  type SaleLineSnapshot,
  type SaleSummary,
} from "../domain/sales";
import {
  assertServiceTransition,
  assertWarrantyDays,
  serviceBalanceDue,
  serviceProfit,
  validateServiceCharges,
  type ServiceCharges,
  type ServiceStatus,
  type ServiceWarrantyInput,
} from "../domain/service";
import { normalizePhoneNumber, optionalText, requiredText } from "../domain/text";
import {
  daysBetween,
  daysInJakartaMonth,
  documentNumber,
  jakartaDayKey,
  jakartaDayRange,
  jakartaMonthRange,
  shiftDayKey,
  type TimeRange,
} from "../domain/time";
import { readSqlRow, type SqlDatabaseDriver, type SqlRow } from "./driver";
import { DATABASE_MIGRATIONS, inTransaction, migrateDatabase, readSchemaVersion } from "./migrations";
import { SCHEMA_VERSION, type StoredRow, type StoredValue } from "./schema";

// ---------------------------------------------------------------------------
// Tipe data yang dikembalikan repository
// ---------------------------------------------------------------------------

export interface PhoneUnit {
  readonly id: string;
  readonly brand: string;
  readonly model: string;
  readonly variant: string | null;
  readonly color: string | null;
  readonly displayName: string;
  readonly imei1: string;
  readonly imei2: string | null;
  readonly condition: PhoneCondition;
  readonly completeness: string | null;
  readonly note: string | null;
  readonly costRupiah: Rupiah;
  readonly plannedPriceRupiah: Rupiah | null;
  readonly source: PhoneSource;
  readonly sourceParty: string | null;
  readonly acquiredAtMs: number;
  readonly tradeInSaleId: string | null;
  readonly status: PhoneStatus;
  readonly soldSaleId: string | null;
}

export interface Accessory {
  readonly id: string;
  readonly name: string;
  readonly category: string | null;
  readonly costRupiah: Rupiah;
  readonly priceRupiah: Rupiah;
  readonly stockQuantity: bigint;
  readonly createdAtMs: number;
  readonly archivedAtMs: number | null;
}

export interface AccessoryInput {
  readonly name: string;
  readonly category?: string | null;
  readonly costRupiah: Rupiah;
  readonly priceRupiah: Rupiah;
  readonly initialStock?: bigint;
}

export interface DigitalProduct {
  readonly id: string;
  readonly name: string;
  readonly category: DigitalCategory;
  readonly costRupiah: Rupiah;
  readonly priceRupiah: Rupiah;
  /** Kartu perdana/voucher fisik: stok dihitung. Pulsa/top up: tidak. */
  readonly tracksStock: boolean;
  readonly stockQuantity: bigint;
  readonly createdAtMs: number;
  readonly archivedAtMs: number | null;
}

export interface DigitalProductInput {
  readonly name: string;
  readonly category: DigitalCategory;
  readonly costRupiah: Rupiah;
  readonly priceRupiah: Rupiah;
  /** Kosong = ikut kategori (perdana pakai stok). */
  readonly tracksStock?: boolean;
  readonly initialStock?: bigint;
}

export type SaleLineInput =
  | { readonly kind: "hp"; readonly phoneUnitId: string; readonly priceRupiah: Rupiah }
  | {
      readonly kind: "digital";
      /** Kosong = transaksi manual (nama dan modal wajib diisi). */
      readonly digitalProductId?: string | null;
      readonly name?: string | null;
      /** Nomor HP / ID akun / no. meter tujuan. */
      readonly target?: string | null;
      readonly quantity?: bigint;
      readonly unitPriceRupiah: Rupiah;
      /** Kosong = modal produk saat ini. Wajib untuk transaksi manual. */
      readonly unitCostRupiah?: Rupiah | null;
    }
  | {
      readonly kind: "aksesoris";
      readonly accessoryId: string;
      readonly quantity: bigint;
      /** Kosong = pakai harga jual aksesoris saat ini. */
      readonly unitPriceRupiah?: Rupiah;
    };

export interface TradeInInput extends Omit<PhoneIntakeInput, "costRupiah"> {
  /** Potongan harga yang diberikan untuk HP lama; jadi modal HP lama di stok. */
  readonly creditRupiah: Rupiah;
}

export interface SaleInput {
  readonly lines: readonly SaleLineInput[];
  readonly tradeIn?: TradeInInput | null;
  readonly paymentMethod: PaymentMethod;
  readonly customerName?: string | null;
  readonly customerPhone?: string | null;
  readonly note?: string | null;
}

export interface SaleLineRecord extends SaleLineSnapshot {
  readonly id: string;
  readonly position: number;
  readonly phoneUnitId: string | null;
  readonly accessoryId: string | null;
  readonly digitalProductId: string | null;
  readonly target: string | null;
}

export interface SaleRecord {
  readonly id: string;
  readonly number: string;
  readonly soldAtMs: number;
  readonly customerName: string | null;
  readonly customerPhone: string | null;
  readonly paymentMethod: PaymentMethod;
  readonly note: string | null;
  readonly voidedAtMs: number | null;
  readonly voidReason: string | null;
  readonly lines: readonly SaleLineRecord[];
  readonly tradeInPhone: PhoneUnit | null;
  readonly summary: SaleSummary;
}

export interface ServiceOrderInput {
  readonly customerName: string;
  readonly customerPhone?: string | null;
  readonly device: string;
  readonly imei?: string | null;
  readonly complaint: string;
  readonly completeness?: string | null;
  /** PIN/pola layar dari pelanggan untuk pengecekan. */
  readonly unlockCode?: string | null;
  readonly estimateRupiah?: Rupiah | null;
  readonly depositRupiah?: Rupiah;
}

export interface ServiceOrder {
  readonly id: string;
  readonly number: string;
  readonly receivedAtMs: number;
  readonly customerName: string;
  readonly customerPhone: string | null;
  readonly device: string;
  readonly imei: string | null;
  readonly complaint: string;
  readonly completeness: string | null;
  readonly unlockCode: string | null;
  readonly estimateRupiah: Rupiah | null;
  readonly depositRupiah: Rupiah;
  readonly status: ServiceStatus;
  readonly totalChargeRupiah: Rupiah | null;
  readonly partsCostRupiah: Rupiah;
  readonly partsNote: string | null;
  readonly finishedAtMs: number | null;
  readonly pickedUpAtMs: number | null;
  /** Cara pelunasan saat HP diambil (null untuk data lama). */
  readonly paymentMethod: PaymentMethod | null;
  /** Untung jika biaya sudah ditentukan. */
  readonly profitRupiah: Rupiah | null;
  /** Sisa bayar saat diambil (biaya − DP), jika biaya sudah ditentukan. */
  readonly balanceDueRupiah: Rupiah | null;
  /** Masa garansi (hari) sejak HP diambil. 0 = tanpa garansi. */
  readonly warrantyDays: number;
  readonly warrantyNote: string | null;
  /** Tanggal terakhir garansi berlaku (YYYY-MM-DD), setelah HP diambil. */
  readonly warrantyUntil: string | null;
}

export interface PhoneProfitRow {
  readonly saleId: string;
  readonly saleNumber: string;
  readonly soldAtMs: number;
  readonly phoneUnitId: string;
  readonly name: string;
  /** Merek + tipe + varian, tanpa warna (untuk peringkat terlaris). */
  readonly modelName: string;
  readonly imei1: string;
  readonly condition: PhoneCondition;
  readonly source: PhoneSource;
  readonly priceRupiah: Rupiah;
  readonly costRupiah: Rupiah;
  readonly profitRupiah: Rupiah;
}

export interface DailyProfit {
  readonly day: string;
  readonly totals: ProfitTotals;
}

export interface PaymentTotals {
  readonly method: PaymentMethod;
  /** Uang masuk: nota (setelah potongan tukar tambah) + biaya service diambil. */
  readonly amountRupiah: Rupiah;
  readonly count: number;
}

export interface PaymentEntry {
  readonly source: "nota" | "service";
  readonly atMs: number;
  readonly method: PaymentMethod;
  readonly amountRupiah: Rupiah;
}

/** Jumlahkan uang masuk per cara bayar (selalu tunai, transfer, qris). */
export function totalsByMethod(entries: readonly PaymentEntry[]): readonly PaymentTotals[] {
  return (["tunai", "transfer", "qris"] as const).map((method) => {
    const list = entries.filter((entry) => entry.method === method);
    return {
      method,
      amountRupiah: list.reduce((sum, entry) => sum + entry.amountRupiah, 0n),
      count: list.length,
    };
  });
}

export interface ItemSalesRow {
  readonly kind: "aksesoris" | "digital";
  readonly name: string;
  readonly quantity: bigint;
  readonly revenueRupiah: Rupiah;
  readonly profitRupiah: Rupiah;
}

export interface PhotoOwner {
  readonly type: "phone" | "accessory";
  readonly id: string;
}

export interface PhotoInput {
  /** JPEG kecil untuk daftar (data URL). */
  readonly thumbDataUrl: string;
  /** JPEG ukuran tampilan penuh (data URL). */
  readonly fullDataUrl: string;
}

export interface ProductPhoto extends PhotoInput {
  readonly id: string;
}

export const MAX_PHOTOS: Readonly<Record<PhotoOwner["type"], number>> = {
  phone: 5,
  accessory: 1,
};

function isJpegDataUrl(value: string): boolean {
  return value.startsWith("data:image/jpeg;base64,") && value.length < 400_000;
}

/** Isi database mentah untuk cadangan: nama tabel -> baris. */
export interface DataSnapshot {
  readonly schemaVersion: number;
  readonly tables: Readonly<Record<string, readonly StoredRow[]>>;
}

export interface RepositoryOptions {
  readonly now?: () => number;
  readonly newId?: () => string;
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export class KonterRepository {
  private readonly now: () => number;
  private readonly newId: () => string;

  constructor(
    private readonly database: SqlDatabaseDriver,
    options: RepositoryOptions = {},
  ) {
    this.now = options.now ?? (() => Date.now());
    this.newId = options.newId ?? defaultId;
  }

  async initialize(): Promise<void> {
    await this.database.execute("PRAGMA foreign_keys = ON");
    await migrateDatabase(this.database);
  }

  // ----- HP ---------------------------------------------------------------

  /** HP masuk dari supplier atau dibeli dari pelanggan. */
  async addPhone(
    input: PhoneIntakeInput,
    source: Exclude<PhoneSource, "tukar_tambah"> = "supplier",
  ): Promise<PhoneUnit> {
    if (source !== "supplier" && source !== "beli_pelanggan") {
      throw new DomainError("invalid_state", "HP tukar tambah dicatat lewat nota penjualan.");
    }
    const intake = validatePhoneIntake(input);
    return inTransaction(this.database, async () => {
      const id = await this.insertPhone(intake, source, this.now(), null);
      return this.requirePhone(id);
    });
  }

  /** Membatalkan HP masuk yang salah catat. Hanya untuk HP yang masih di stok. */
  async cancelPhoneIntake(phoneUnitId: string): Promise<void> {
    await inTransaction(this.database, async () => {
      const phone = await this.requirePhone(phoneUnitId);
      if (phone.status !== "stok") {
        throw new DomainError("invalid_state", "Hanya HP yang masih di stok yang bisa dibatalkan.");
      }
      if (phone.source === "tukar_tambah") {
        throw new DomainError(
          "invalid_state",
          "HP tukar tambah dibatalkan dengan membatalkan nota penjualannya.",
        );
      }
      await this.database.run("UPDATE phone_units SET status = 'dibatalkan' WHERE id = ?", [
        phoneUnitId,
      ]);
    });
  }

  async getPhone(phoneUnitId: string): Promise<PhoneUnit | null> {
    const rows = await this.database.query("SELECT * FROM phone_units WHERE id = ?", [phoneUnitId]);
    return rows[0] === undefined ? null : readPhone(rows[0]);
  }

  async listPhonesInStock(): Promise<readonly PhoneUnit[]> {
    const rows = await this.database.query(
      "SELECT * FROM phone_units WHERE status = 'stok' ORDER BY acquired_at_ms DESC",
    );
    return rows.map(readPhone);
  }

  /** Riwayat semua unit dengan IMEI ini (IMEI 1 atau 2), terbaru dulu. */
  async findPhonesByImei(imei: string): Promise<readonly PhoneUnit[]> {
    const normalized = normalizeImei(imei);
    const rows = await this.database.query(
      `SELECT * FROM phone_units WHERE imei1 = ? OR imei2 = ?
       ORDER BY acquired_at_ms DESC`,
      [normalized, normalized],
    );
    return rows.map(readPhone);
  }

  // ----- Aksesoris --------------------------------------------------------

  async addAccessory(input: AccessoryInput): Promise<Accessory> {
    const name = requiredText(input.name, "Nama aksesoris", 120);
    const category = optionalText(input.category, "Kategori", 40);
    const cost = assertNonNegativeRupiah(input.costRupiah, "Harga modal");
    const price = assertNonNegativeRupiah(input.priceRupiah, "Harga jual");
    const initialStock = input.initialStock ?? 0n;
    if (initialStock < 0n) {
      throw new DomainError("invalid_quantity", "Stok awal tidak boleh negatif.");
    }
    const id = this.newId();
    const now = this.now();
    await inTransaction(this.database, async () => {
      await this.database.run(
        `INSERT INTO accessories
          (id, name, category, cost_rupiah, price_rupiah, stock_quantity, created_at_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, name, category, toDb(cost), toDb(price), toDb(initialStock), now],
      );
      if (initialStock > 0n) {
        await this.database.run(
          `INSERT INTO accessory_restocks
            (id, accessory_id, restocked_at_ms, quantity, unit_cost_rupiah, supplier)
           VALUES (?, ?, ?, ?, ?, NULL)`,
          [this.newId(), id, now, toDb(initialStock), toDb(cost)],
        );
      }
    });
    return this.requireAccessory(id);
  }

  /**
   * Tambah stok. Harga modal aksesoris ikut diperbarui ke harga kulakan
   * terbaru (cara hitung yang dipakai kebanyakan pemilik konter).
   */
  async restockAccessory(
    accessoryId: string,
    quantity: bigint,
    unitCostRupiah: Rupiah,
    supplier?: string | null,
  ): Promise<Accessory> {
    assertPositiveQuantity(quantity, "Jumlah tambah stok");
    assertNonNegativeRupiah(unitCostRupiah, "Harga modal");
    const supplierName = optionalText(supplier, "Nama supplier", 80);
    await inTransaction(this.database, async () => {
      const accessory = await this.requireAccessory(accessoryId);
      if (accessory.archivedAtMs !== null) {
        throw new DomainError("invalid_state", "Aksesoris ini sudah diarsipkan.");
      }
      await this.database.run(
        `INSERT INTO accessory_restocks
          (id, accessory_id, restocked_at_ms, quantity, unit_cost_rupiah, supplier)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [this.newId(), accessoryId, this.now(), toDb(quantity), toDb(unitCostRupiah), supplierName],
      );
      await this.database.run(
        `UPDATE accessories
         SET stock_quantity = stock_quantity + ?, cost_rupiah = ?
         WHERE id = ?`,
        [toDb(quantity), toDb(unitCostRupiah), accessoryId],
      );
    });
    return this.requireAccessory(accessoryId);
  }

  async updateAccessoryPrice(accessoryId: string, priceRupiah: Rupiah): Promise<Accessory> {
    assertNonNegativeRupiah(priceRupiah, "Harga jual");
    await this.requireAccessory(accessoryId);
    await this.database.run("UPDATE accessories SET price_rupiah = ? WHERE id = ?", [
      toDb(priceRupiah),
      accessoryId,
    ]);
    return this.requireAccessory(accessoryId);
  }

  async listAccessories(): Promise<readonly Accessory[]> {
    const rows = await this.database.query(
      "SELECT * FROM accessories WHERE archived_at_ms IS NULL ORDER BY name COLLATE NOCASE",
    );
    return rows.map(readAccessory);
  }

  // ----- Produk digital ---------------------------------------------------

  async addDigitalProduct(input: DigitalProductInput): Promise<DigitalProduct> {
    const name = requiredText(input.name, "Nama produk", 120);
    const category = assertDigitalCategory(input.category);
    const cost = assertNonNegativeRupiah(input.costRupiah, "Harga modal");
    const price = assertNonNegativeRupiah(input.priceRupiah, "Harga jual");
    const tracksStock = input.tracksStock ?? defaultTracksStock(category);
    const initialStock = tracksStock ? (input.initialStock ?? 0n) : 0n;
    if (initialStock < 0n) {
      throw new DomainError("invalid_quantity", "Stok awal tidak boleh negatif.");
    }
    const id = this.newId();
    const now = this.now();
    await inTransaction(this.database, async () => {
      await this.database.run(
        `INSERT INTO digital_products
          (id, name, category, cost_rupiah, price_rupiah, track_stock, stock_quantity, created_at_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, name, category, toDb(cost), toDb(price), tracksStock ? 1 : 0, toDb(initialStock), now],
      );
      if (initialStock > 0n) {
        await this.database.run(
          `INSERT INTO digital_restocks (id, digital_product_id, restocked_at_ms, quantity, unit_cost_rupiah)
           VALUES (?, ?, ?, ?, ?)`,
          [this.newId(), id, now, toDb(initialStock), toDb(cost)],
        );
      }
    });
    return this.requireDigitalProduct(id);
  }

  /** Ubah nama, modal, dan harga jual (harga server pulsa sering berubah). */
  async updateDigitalProduct(
    productId: string,
    changes: { readonly name: string; readonly costRupiah: Rupiah; readonly priceRupiah: Rupiah },
  ): Promise<DigitalProduct> {
    const name = requiredText(changes.name, "Nama produk", 120);
    const cost = assertNonNegativeRupiah(changes.costRupiah, "Harga modal");
    const price = assertNonNegativeRupiah(changes.priceRupiah, "Harga jual");
    await this.requireDigitalProduct(productId);
    await this.database.run(
      "UPDATE digital_products SET name = ?, cost_rupiah = ?, price_rupiah = ? WHERE id = ?",
      [name, toDb(cost), toDb(price), productId],
    );
    return this.requireDigitalProduct(productId);
  }

  /** Tambah stok kartu perdana/voucher. Modal ikut harga kulakan terbaru. */
  async restockDigitalProduct(
    productId: string,
    quantity: bigint,
    unitCostRupiah: Rupiah,
  ): Promise<DigitalProduct> {
    assertPositiveQuantity(quantity, "Jumlah tambah stok");
    assertNonNegativeRupiah(unitCostRupiah, "Harga modal");
    await inTransaction(this.database, async () => {
      const product = await this.requireDigitalProduct(productId);
      if (!product.tracksStock) {
        throw new DomainError("invalid_state", "Produk ini tidak memakai stok.");
      }
      if (product.archivedAtMs !== null) {
        throw new DomainError("invalid_state", "Produk ini sudah dihapus dari daftar.");
      }
      await this.database.run(
        `INSERT INTO digital_restocks (id, digital_product_id, restocked_at_ms, quantity, unit_cost_rupiah)
         VALUES (?, ?, ?, ?, ?)`,
        [this.newId(), productId, this.now(), toDb(quantity), toDb(unitCostRupiah)],
      );
      await this.database.run(
        `UPDATE digital_products SET stock_quantity = stock_quantity + ?, cost_rupiah = ? WHERE id = ?`,
        [toDb(quantity), toDb(unitCostRupiah), productId],
      );
    });
    return this.requireDigitalProduct(productId);
  }

  /** Sembunyikan dari daftar jual. Riwayat nota tetap utuh. */
  async archiveDigitalProduct(productId: string): Promise<void> {
    await this.requireDigitalProduct(productId);
    await this.database.run("UPDATE digital_products SET archived_at_ms = ? WHERE id = ?", [
      this.now(),
      productId,
    ]);
  }

  async listDigitalProducts(): Promise<readonly DigitalProduct[]> {
    const rows = await this.database.query(
      `SELECT * FROM digital_products WHERE archived_at_ms IS NULL
       ORDER BY price_rupiah, name COLLATE NOCASE`,
    );
    const order = (category: DigitalCategory) => DIGITAL_CATEGORIES.indexOf(category);
    // Urutan kategori mengikuti menu (Pulsa dulu), harga termurah dulu di tiap kategori.
    return rows.map(readDigitalProduct).sort((a, b) => order(a.category) - order(b.category));
  }

  // ----- Penjualan --------------------------------------------------------

  async recordSale(input: SaleInput): Promise<SaleRecord> {
    if (input.lines.length === 0) {
      throw new DomainError("invalid_quantity", "Nota harus berisi minimal 1 barang.");
    }
    const paymentMethod = assertPaymentMethod(input.paymentMethod);
    const customerName = optionalText(input.customerName, "Nama pelanggan", 80);
    const customerPhone = normalizePhoneNumber(input.customerPhone);
    const note = optionalText(input.note, "Catatan", 500);
    const tradeIn =
      input.tradeIn === null || input.tradeIn === undefined
        ? null
        : {
            intake: validatePhoneIntake({
              ...input.tradeIn,
              costRupiah: assertNonNegativeRupiah(input.tradeIn.creditRupiah, "Nilai tukar tambah"),
            }),
          };

    const saleId = this.newId();
    await inTransaction(this.database, async () => {
      const soldAtMs = this.now();
      const snapshots: (SaleLineSnapshot & {
        readonly phoneUnitId: string | null;
        readonly accessoryId: string | null;
        readonly digitalProductId: string | null;
        readonly target: string | null;
      })[] = [];
      const seenPhones = new Set<string>();
      const accessoryDemand = new Map<string, bigint>();
      const digitalDemand = new Map<string, bigint>();

      for (const line of input.lines) {
        if (line.kind === "hp") {
          if (seenPhones.has(line.phoneUnitId)) {
            throw new DomainError("invalid_quantity", "HP yang sama tercatat dua kali di nota.");
          }
          seenPhones.add(line.phoneUnitId);
          const phone = await this.requirePhone(line.phoneUnitId);
          if (phone.status !== "stok") {
            throw new DomainError("invalid_state", `${phone.displayName} tidak ada di stok.`);
          }
          snapshots.push({
            kind: "hp",
            phoneUnitId: phone.id,
            accessoryId: null,
            digitalProductId: null,
            target: null,
            name: `${phone.displayName} (IMEI ${phone.imei1})`,
            quantity: 1n,
            unitPriceRupiah: line.priceRupiah,
            unitCostRupiah: phone.costRupiah,
          });
        } else if (line.kind === "digital") {
          const quantity = line.quantity ?? 1n;
          assertPositiveQuantity(quantity);
          const target = optionalText(line.target, "Nomor tujuan", 60);
          const product =
            line.digitalProductId === null || line.digitalProductId === undefined
              ? null
              : await this.requireDigitalProduct(line.digitalProductId);
          if (product !== null && product.archivedAtMs !== null) {
            throw new DomainError("invalid_state", `${product.name} sudah dihapus dari daftar.`);
          }
          if (product !== null && product.tracksStock) {
            const demand = (digitalDemand.get(product.id) ?? 0n) + quantity;
            if (demand > product.stockQuantity) {
              throw new DomainError(
                "insufficient_stock",
                `Stok ${product.name} tinggal ${product.stockQuantity}.`,
              );
            }
            digitalDemand.set(product.id, demand);
          }
          const name =
            product === null
              ? requiredText(line.name ?? "", "Nama transaksi", 120)
              : (optionalText(line.name, "Nama transaksi", 120) ?? product.name);
          const cost = line.unitCostRupiah ?? product?.costRupiah ?? null;
          if (cost === null) {
            throw new DomainError("invalid_amount", `Isi harga modal untuk ${name}.`);
          }
          snapshots.push({
            kind: "digital",
            phoneUnitId: null,
            accessoryId: null,
            digitalProductId: product?.id ?? null,
            target,
            name,
            quantity,
            unitPriceRupiah: line.unitPriceRupiah,
            unitCostRupiah: cost,
          });
        } else {
          assertPositiveQuantity(line.quantity);
          const accessory = await this.requireAccessory(line.accessoryId);
          if (accessory.archivedAtMs !== null) {
            throw new DomainError("invalid_state", `${accessory.name} sudah diarsipkan.`);
          }
          const demand = (accessoryDemand.get(accessory.id) ?? 0n) + line.quantity;
          if (demand > accessory.stockQuantity) {
            throw new DomainError(
              "insufficient_stock",
              `Stok ${accessory.name} tinggal ${accessory.stockQuantity}.`,
            );
          }
          accessoryDemand.set(accessory.id, demand);
          snapshots.push({
            kind: "aksesoris",
            phoneUnitId: null,
            accessoryId: accessory.id,
            digitalProductId: null,
            target: null,
            name: accessory.name,
            quantity: line.quantity,
            unitPriceRupiah: line.unitPriceRupiah ?? accessory.priceRupiah,
            unitCostRupiah: accessory.costRupiah,
          });
        }
      }
      snapshots.forEach(validateSaleLine);
      const summary = summarizeSale(snapshots, tradeIn?.intake.costRupiah ?? 0n);
      const number = await this.nextNumber("J", "sales", "sold_at_ms", soldAtMs);

      await this.database.run(
        `INSERT INTO sales
          (id, number, sold_at_ms, customer_name, customer_phone, items_total_rupiah,
           trade_in_credit_rupiah, payment_method, note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          saleId,
          number,
          soldAtMs,
          customerName,
          customerPhone,
          toDb(summary.itemsTotalRupiah),
          toDb(summary.tradeInCreditRupiah),
          paymentMethod,
          note,
        ],
      );

      for (const [position, line] of snapshots.entries()) {
        await this.database.run(
          `INSERT INTO sale_lines
            (id, sale_id, position, kind, phone_unit_id, accessory_id, digital_product_id, target,
             name, quantity, unit_price_rupiah, unit_cost_rupiah)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            this.newId(),
            saleId,
            position,
            line.kind,
            line.phoneUnitId,
            line.accessoryId,
            line.digitalProductId,
            line.target,
            line.name,
            toDb(line.quantity),
            toDb(line.unitPriceRupiah),
            toDb(line.unitCostRupiah),
          ],
        );
        if (line.phoneUnitId !== null) {
          await this.database.run(
            "UPDATE phone_units SET status = 'terjual', sold_sale_id = ? WHERE id = ?",
            [saleId, line.phoneUnitId],
          );
        }
      }
      for (const [accessoryId, quantity] of accessoryDemand) {
        await this.database.run(
          "UPDATE accessories SET stock_quantity = stock_quantity - ? WHERE id = ?",
          [toDb(quantity), accessoryId],
        );
      }
      for (const [productId, quantity] of digitalDemand) {
        await this.database.run(
          "UPDATE digital_products SET stock_quantity = stock_quantity - ? WHERE id = ?",
          [toDb(quantity), productId],
        );
      }

      if (tradeIn !== null) {
        await this.insertPhone(
          { ...tradeIn.intake, sourceParty: tradeIn.intake.sourceParty ?? customerName },
          "tukar_tambah",
          soldAtMs,
          saleId,
        );
      }
    });
    return this.requireSale(saleId);
  }

  /**
   * Membatalkan nota: HP kembali ke stok, stok aksesoris dikembalikan,
   * dan HP tukar tambah dikeluarkan dari stok.
   */
  async voidSale(saleId: string, reason: string): Promise<SaleRecord> {
    const voidReason = requiredText(reason, "Alasan pembatalan", 200);
    await inTransaction(this.database, async () => {
      const sale = await this.requireSale(saleId);
      if (sale.voidedAtMs !== null) {
        throw new DomainError("invalid_state", "Nota ini sudah dibatalkan.");
      }
      if (sale.tradeInPhone !== null && sale.tradeInPhone.status !== "stok") {
        throw new DomainError(
          "invalid_state",
          "HP tukar tambah dari nota ini sudah terjual. Batalkan dulu nota penjualan HP tersebut.",
        );
      }
      // HP tukar tambah dikeluarkan dulu supaya tidak bentrok IMEI
      // dengan HP yang dikembalikan ke stok.
      if (sale.tradeInPhone !== null) {
        await this.database.run("UPDATE phone_units SET status = 'dibatalkan' WHERE id = ?", [
          sale.tradeInPhone.id,
        ]);
      }
      for (const line of sale.lines) {
        if (line.phoneUnitId !== null) {
          const phone = await this.requirePhone(line.phoneUnitId);
          await this.assertImeiFreeInStock(phone.imei1, phone.imei2, phone.id);
          await this.database.run(
            "UPDATE phone_units SET status = 'stok', sold_sale_id = NULL WHERE id = ?",
            [line.phoneUnitId],
          );
        }
        if (line.accessoryId !== null) {
          await this.database.run(
            "UPDATE accessories SET stock_quantity = stock_quantity + ? WHERE id = ?",
            [toDb(line.quantity), line.accessoryId],
          );
        }
        if (line.digitalProductId !== null) {
          // Produk tanpa stok tetap 0; hanya kartu perdana/voucher yang dikembalikan.
          await this.database.run(
            `UPDATE digital_products SET stock_quantity = stock_quantity + ?
             WHERE id = ? AND track_stock = 1`,
            [toDb(line.quantity), line.digitalProductId],
          );
        }
      }
      await this.database.run(
        "UPDATE sales SET voided_at_ms = ?, void_reason = ? WHERE id = ?",
        [this.now(), voidReason, saleId],
      );
    });
    return this.requireSale(saleId);
  }

  async getSale(saleId: string): Promise<SaleRecord | null> {
    const rows = await this.database.query("SELECT * FROM sales WHERE id = ?", [saleId]);
    const row = rows[0];
    if (row === undefined) {
      return null;
    }
    const lineRows = await this.database.query(
      "SELECT * FROM sale_lines WHERE sale_id = ? ORDER BY position",
      [saleId],
    );
    const lines = lineRows.map(readSaleLine);
    const tradeInRows = await this.database.query(
      "SELECT * FROM phone_units WHERE trade_in_sale_id = ?",
      [saleId],
    );
    const tradeInCredit = readBigint(row, "trade_in_credit_rupiah");
    return {
      id: readText(row, "id"),
      number: readText(row, "number"),
      soldAtMs: readNumber(row, "sold_at_ms"),
      customerName: readOptionalText(row, "customer_name"),
      customerPhone: readOptionalText(row, "customer_phone"),
      paymentMethod: assertPaymentMethod(readText(row, "payment_method")),
      note: readOptionalText(row, "note"),
      voidedAtMs: readOptionalNumber(row, "voided_at_ms"),
      voidReason: readOptionalText(row, "void_reason"),
      lines,
      tradeInPhone: tradeInRows[0] === undefined ? null : readPhone(tradeInRows[0]),
      summary: summarizeSale(lines, tradeInCredit),
    };
  }

  // ----- Service ----------------------------------------------------------

  async createServiceOrder(input: ServiceOrderInput): Promise<ServiceOrder> {
    const customerName = requiredText(input.customerName, "Nama pelanggan", 80);
    const customerPhone = normalizePhoneNumber(input.customerPhone);
    const device = requiredText(input.device, "HP yang diservice", 120);
    const imeiText = optionalText(input.imei, "IMEI", 40);
    const imei = imeiText === null ? null : normalizeImei(imeiText);
    const complaint = requiredText(input.complaint, "Keluhan", 500);
    const completeness = optionalText(input.completeness, "Kelengkapan", 200);
    const unlockCode = optionalText(input.unlockCode, "PIN/pola", 60);
    const estimate = input.estimateRupiah ?? null;
    if (estimate !== null) {
      assertNonNegativeRupiah(estimate, "Estimasi biaya");
    }
    const deposit = assertNonNegativeRupiah(input.depositRupiah ?? 0n, "DP");

    const id = this.newId();
    await inTransaction(this.database, async () => {
      const receivedAtMs = this.now();
      const number = await this.nextNumber("S", "service_orders", "received_at_ms", receivedAtMs);
      await this.database.run(
        `INSERT INTO service_orders
          (id, number, received_at_ms, customer_name, customer_phone, device, imei, complaint,
           completeness, unlock_code, estimate_rupiah, deposit_rupiah, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'proses')`,
        [
          id,
          number,
          receivedAtMs,
          customerName,
          customerPhone,
          device,
          imei,
          complaint,
          completeness,
          unlockCode,
          estimate === null ? null : toDb(estimate),
          toDb(deposit),
        ],
      );
    });
    return this.requireService(id);
  }

  /** Perbaikan selesai; biaya final dan modal sparepart dicatat. */
  async finishService(
    serviceId: string,
    charges: ServiceCharges,
    partsNote?: string | null,
    warranty: ServiceWarrantyInput = { days: 0 },
  ): Promise<ServiceOrder> {
    return this.closeServiceWork(serviceId, "selesai", charges, partsNote, warranty);
  }

  /** Tidak jadi diperbaiki. Biaya = biaya cek (boleh 0); modal sparepart yang terlanjur dibeli tetap dicatat. */
  async cancelService(
    serviceId: string,
    charges: ServiceCharges,
    partsNote?: string | null,
  ): Promise<ServiceOrder> {
    return this.closeServiceWork(serviceId, "batal", charges, partsNote, { days: 0 });
  }

  async reopenService(serviceId: string): Promise<ServiceOrder> {
    await inTransaction(this.database, async () => {
      const order = await this.requireService(serviceId);
      assertServiceTransition(order.status, "proses");
      await this.database.run(
        `UPDATE service_orders SET status = 'proses', outcome = NULL, finished_at_ms = NULL
         WHERE id = ?`,
        [serviceId],
      );
    });
    return this.requireService(serviceId);
  }

  /** HP diambil pelanggan dan dilunasi. Untung service masuk laporan di tanggal ini. */
  async pickUpService(
    serviceId: string,
    paymentMethod: PaymentMethod = "tunai",
    /** Garansi final saat diserahkan; kosong = pakai yang dicatat saat selesai. */
    warranty?: ServiceWarrantyInput,
  ): Promise<ServiceOrder> {
    const method = assertPaymentMethod(paymentMethod);
    const checked = warranty === undefined ? null : validWarranty(warranty);
    await inTransaction(this.database, async () => {
      const order = await this.requireService(serviceId);
      assertServiceTransition(order.status, "diambil");
      await this.database.run(
        `UPDATE service_orders SET status = 'diambil', picked_up_at_ms = ?, payment_method = ?
         WHERE id = ?`,
        [this.now(), method, serviceId],
      );
      // HP yang batal diperbaiki tidak bergaransi.
      if (checked !== null && order.status === "selesai") {
        await this.database.run(
          `UPDATE service_orders SET warranty_days = ?, warranty_note = ? WHERE id = ?`,
          [checked.days, checked.note, serviceId],
        );
      }
    });
    return this.requireService(serviceId);
  }

  /** Service yang garansinya masih berlaku pada `todayKey`, garansi paling lama habis dulu. */
  async listActiveWarranties(todayKey: string): Promise<readonly ServiceOrder[]> {
    const rows = await this.database.query(
      `SELECT * FROM service_orders
       WHERE status = 'diambil' AND warranty_days > 0 AND picked_up_at_ms IS NOT NULL
       ORDER BY picked_up_at_ms DESC`,
    );
    return rows
      .map(readService)
      .filter((order) => order.warrantyUntil !== null && order.warrantyUntil >= todayKey)
      .sort((left, right) => (left.warrantyUntil! < right.warrantyUntil! ? -1 : 1));
  }

  /** Riwayat service untuk satu IMEI, terbaru dulu. */
  async findServicesByImei(imei: string): Promise<readonly ServiceOrder[]> {
    const cleaned = imei.replace(/[\s-]/g, "");
    if (cleaned.length === 0) return [];
    const rows = await this.database.query(
      `SELECT * FROM service_orders WHERE imei = ? ORDER BY received_at_ms DESC`,
      [cleaned],
    );
    return rows.map(readService);
  }

  async getService(serviceId: string): Promise<ServiceOrder | null> {
    const rows = await this.database.query("SELECT * FROM service_orders WHERE id = ?", [serviceId]);
    return rows[0] === undefined ? null : readService(rows[0]);
  }

  /** Service yang belum diambil (proses, selesai, batal), terlama dulu. */
  async listOpenServices(): Promise<readonly ServiceOrder[]> {
    const rows = await this.database.query(
      `SELECT * FROM service_orders WHERE status <> 'diambil' ORDER BY received_at_ms`,
    );
    return rows.map(readService);
  }

  // ----- Laporan ----------------------------------------------------------

  async profitEntries(range: TimeRange): Promise<readonly ProfitEntry[]> {
    const saleRows = await this.database.query(
      `SELECT l.kind, s.sold_at_ms, l.quantity, l.unit_price_rupiah, l.unit_cost_rupiah
       FROM sale_lines l JOIN sales s ON s.id = l.sale_id
       WHERE s.voided_at_ms IS NULL AND s.sold_at_ms >= ? AND s.sold_at_ms < ?`,
      [range.startMs, range.endMs],
    );
    const serviceRows = await this.database.query(
      `SELECT picked_up_at_ms, total_charge_rupiah, parts_cost_rupiah FROM service_orders
       WHERE status = 'diambil' AND picked_up_at_ms >= ? AND picked_up_at_ms < ?`,
      [range.startMs, range.endMs],
    );
    const entries: ProfitEntry[] = saleRows.map((row) => {
      const quantity = readBigint(row, "quantity");
      return {
        line: readText(row, "kind") as SaleLineKind as BusinessLine,
        atMs: readNumber(row, "sold_at_ms"),
        revenueRupiah: readBigint(row, "unit_price_rupiah") * quantity,
        costRupiah: readBigint(row, "unit_cost_rupiah") * quantity,
        count: quantity,
      };
    });
    for (const row of serviceRows) {
      entries.push({
        line: "service",
        atMs: readNumber(row, "picked_up_at_ms"),
        revenueRupiah: readBigint(row, "total_charge_rupiah"),
        costRupiah: readBigint(row, "parts_cost_rupiah"),
        count: 1n,
      });
    }
    return entries;
  }

  async profitSummary(range: TimeRange): Promise<ProfitSummary> {
    return summarizeProfit(await this.profitEntries(range));
  }

  async dayProfit(dayKey: string): Promise<ProfitSummary> {
    return this.profitSummary(jakartaDayRange(dayKey));
  }

  async monthProfit(monthKey: string): Promise<ProfitSummary> {
    return this.profitSummary(jakartaMonthRange(monthKey));
  }

  /** Untung per hari dalam satu bulan, termasuk hari tanpa transaksi. */
  async dailyProfit(monthKey: string): Promise<readonly DailyProfit[]> {
    const entries = await this.profitEntries(jakartaMonthRange(monthKey));
    const byDay = new Map<string, ProfitEntry[]>();
    for (const entry of entries) {
      const day = jakartaDayKey(entry.atMs);
      const list = byDay.get(day) ?? [];
      list.push(entry);
      byDay.set(day, list);
    }
    return daysInJakartaMonth(monthKey).map((day) => ({
      day,
      totals: totalsOf(byDay.get(day) ?? []),
    }));
  }

  /** Untung per hari untuk rentang tanggal bebas, termasuk hari tanpa transaksi. */
  async dailyProfitBetween(fromDay: string, toDay: string): Promise<readonly DailyProfit[]> {
    const days = daysBetween(fromDay, toDay);
    const entries = await this.profitEntries({
      startMs: jakartaDayRange(days[0]!).startMs,
      endMs: jakartaDayRange(days.at(-1)!).endMs,
    });
    const byDay = new Map<string, ProfitEntry[]>();
    for (const entry of entries) {
      const day = jakartaDayKey(entry.atMs);
      const list = byDay.get(day) ?? [];
      list.push(entry);
      byDay.set(day, list);
    }
    return days.map((day) => ({ day, totals: totalsOf(byDay.get(day) ?? []) }));
  }

  /**
   * Uang masuk per cara bayar. Nota dihitung setelah potongan tukar tambah
   * (nota yang malah membayar pelanggan tidak dihitung); service dihitung
   * sebesar biayanya pada hari diambil (data lama tanpa cara bayar = tunai).
   */
  async paymentTotals(range: TimeRange): Promise<readonly PaymentTotals[]> {
    return totalsByMethod(await this.paymentEntries(range));
  }

  /**
   * Setiap uang masuk dalam periode: nota (setelah potongan tukar tambah; nota
   * yang membayar pelanggan dihitung 0) dan service diambil (data lama tanpa
   * cara bayar = tunai). Urut waktu.
   */
  async paymentEntries(range: TimeRange): Promise<readonly PaymentEntry[]> {
    const rows = await this.database.query(
      `SELECT 'nota' AS source, sold_at_ms AS at, payment_method AS method,
              items_total_rupiah - trade_in_credit_rupiah AS amount
       FROM sales WHERE voided_at_ms IS NULL AND sold_at_ms >= ? AND sold_at_ms < ?
       UNION ALL
       SELECT 'service', picked_up_at_ms, COALESCE(payment_method, 'tunai'), total_charge_rupiah
       FROM service_orders WHERE status = 'diambil' AND picked_up_at_ms >= ? AND picked_up_at_ms < ?
       ORDER BY at`,
      [range.startMs, range.endMs, range.startMs, range.endMs],
    );
    return rows.map((row) => {
      const amount = readBigint(row, "amount");
      return {
        source: readText(row, "source") as "nota" | "service",
        atMs: readNumber(row, "at"),
        method: assertPaymentMethod(readText(row, "method")),
        amountRupiah: amount > 0n ? amount : 0n,
      };
    });
  }

  /** Waktu setiap transaksi (nota tidak batal + service diambil) dalam periode. */
  async transactionTimes(range: TimeRange): Promise<readonly number[]> {
    const rows = await this.database.query(
      `SELECT sold_at_ms AS at FROM sales
       WHERE voided_at_ms IS NULL AND sold_at_ms >= ? AND sold_at_ms < ?
       UNION ALL
       SELECT picked_up_at_ms AS at FROM service_orders
       WHERE status = 'diambil' AND picked_up_at_ms >= ? AND picked_up_at_ms < ?`,
      [range.startMs, range.endMs, range.startMs, range.endMs],
    );
    return rows.map((row) => readNumber(row, "at"));
  }

  /** Aksesoris dan produk digital terjual, dikelompokkan per nama, terbanyak dulu. */
  async itemSales(range: TimeRange): Promise<readonly ItemSalesRow[]> {
    const rows = await this.database.query(
      `SELECT l.kind, l.name, SUM(l.quantity) AS qty,
              SUM(l.quantity * l.unit_price_rupiah) AS revenue,
              SUM(l.quantity * (l.unit_price_rupiah - l.unit_cost_rupiah)) AS profit
       FROM sale_lines l JOIN sales s ON s.id = l.sale_id
       WHERE l.kind IN ('aksesoris', 'digital') AND s.voided_at_ms IS NULL
         AND s.sold_at_ms >= ? AND s.sold_at_ms < ?
       GROUP BY l.kind, l.name
       ORDER BY qty DESC, revenue DESC`,
      [range.startMs, range.endMs],
    );
    return rows.map((row) => ({
      kind: readText(row, "kind") as "aksesoris" | "digital",
      name: readText(row, "name"),
      quantity: readBigint(row, "qty"),
      revenueRupiah: readBigint(row, "revenue"),
      profitRupiah: readBigint(row, "profit"),
    }));
  }

  /** Untung tiap HP yang terjual dalam periode, terbaru dulu. */
  async phoneProfits(range: TimeRange): Promise<readonly PhoneProfitRow[]> {
    const rows = await this.database.query(
      `SELECT s.id AS sale_id, s.number, s.sold_at_ms, l.unit_price_rupiah, l.unit_cost_rupiah,
              p.id AS phone_id, p.brand, p.model, p.variant, p.color, p.imei1, p.condition, p.source
       FROM sale_lines l
       JOIN sales s ON s.id = l.sale_id
       JOIN phone_units p ON p.id = l.phone_unit_id
       WHERE l.kind = 'hp' AND s.voided_at_ms IS NULL
         AND s.sold_at_ms >= ? AND s.sold_at_ms < ?
       ORDER BY s.sold_at_ms DESC, l.position`,
      [range.startMs, range.endMs],
    );
    return rows.map((row) => {
      const price = readBigint(row, "unit_price_rupiah");
      const cost = readBigint(row, "unit_cost_rupiah");
      return {
        saleId: readText(row, "sale_id"),
        saleNumber: readText(row, "number"),
        soldAtMs: readNumber(row, "sold_at_ms"),
        phoneUnitId: readText(row, "phone_id"),
        name: phoneDisplayName({
          brand: readText(row, "brand"),
          model: readText(row, "model"),
          variant: readOptionalText(row, "variant"),
          color: readOptionalText(row, "color"),
        }),
        modelName: phoneDisplayName({
          brand: readText(row, "brand"),
          model: readText(row, "model"),
          variant: readOptionalText(row, "variant"),
          color: null,
        }),
        imei1: readText(row, "imei1"),
        condition: readText(row, "condition") as PhoneCondition,
        source: readText(row, "source") as PhoneSource,
        priceRupiah: price,
        costRupiah: cost,
        profitRupiah: price - cost,
      };
    });
  }

  /** Nota dalam periode, terbaru dulu (termasuk yang dibatalkan). */
  async listSales(range: TimeRange): Promise<readonly SaleRecord[]> {
    const rows = await this.database.query(
      `SELECT id FROM sales WHERE sold_at_ms >= ? AND sold_at_ms < ?
       ORDER BY sold_at_ms DESC`,
      [range.startMs, range.endMs],
    );
    const sales: SaleRecord[] = [];
    for (const row of rows) {
      sales.push(await this.requireSale(readText(row, "id")));
    }
    return sales;
  }

  /** Service yang sudah diambil dalam periode, terbaru dulu. */
  async listPickedUpServices(range: TimeRange): Promise<readonly ServiceOrder[]> {
    const rows = await this.database.query(
      `SELECT * FROM service_orders
       WHERE status = 'diambil' AND picked_up_at_ms >= ? AND picked_up_at_ms < ?
       ORDER BY picked_up_at_ms DESC`,
      [range.startMs, range.endMs],
    );
    return rows.map(readService);
  }

  // ----- Foto produk -----------------------------------------------------

  /** Menambah foto di urutan terakhir. HP maks. 5 foto, aksesoris 1 (foto lama diganti). */
  async addPhoto(owner: PhotoOwner, photo: PhotoInput): Promise<ProductPhoto> {
    if (!isJpegDataUrl(photo.thumbDataUrl) || !isJpegDataUrl(photo.fullDataUrl)) {
      throw new DomainError("invalid_state", "Format foto tidak dikenali.");
    }
    const id = this.newId();
    await inTransaction(this.database, async () => {
      if (owner.type === "phone") {
        await this.requirePhone(owner.id);
      } else {
        await this.requireAccessory(owner.id);
        await this.database.run("DELETE FROM photos WHERE owner_type = 'accessory' AND owner_id = ?", [
          owner.id,
        ]);
      }
      const rows = await this.database.query(
        `SELECT COUNT(*) AS total, COALESCE(MAX(position), -1) AS last FROM photos
         WHERE owner_type = ? AND owner_id = ?`,
        [owner.type, owner.id],
      );
      const total = readNumber(rows[0] ?? {}, "total");
      if (total >= MAX_PHOTOS[owner.type]) {
        throw new DomainError("invalid_quantity", `Maksimal ${MAX_PHOTOS[owner.type]} foto.`);
      }
      await this.database.run(
        `INSERT INTO photos
          (id, owner_type, owner_id, position, thumb_data_url, full_data_url, created_at_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          owner.type,
          owner.id,
          readNumber(rows[0] ?? {}, "last") + 1,
          photo.thumbDataUrl,
          photo.fullDataUrl,
          this.now(),
        ],
      );
    });
    const photos = await this.listPhotos(owner);
    return photos.find((item) => item.id === id)!;
  }

  async deletePhoto(photoId: string): Promise<void> {
    await this.database.run("DELETE FROM photos WHERE id = ?", [photoId]);
  }

  /** Semua foto (ukuran penuh) milik satu produk, urut. */
  async listPhotos(owner: PhotoOwner): Promise<readonly ProductPhoto[]> {
    const rows = await this.database.query(
      `SELECT id, thumb_data_url, full_data_url FROM photos
       WHERE owner_type = ? AND owner_id = ? ORDER BY position`,
      [owner.type, owner.id],
    );
    return rows.map((row) => ({
      id: readText(row, "id"),
      thumbDataUrl: readText(row, "thumb_data_url"),
      fullDataUrl: readText(row, "full_data_url"),
    }));
  }

  /** Thumbnail foto pertama untuk setiap produk yang punya foto. */
  async coverThumbnails(type: PhotoOwner["type"]): Promise<ReadonlyMap<string, string>> {
    const rows = await this.database.query(
      `SELECT p.owner_id, p.thumb_data_url FROM photos p
       JOIN (SELECT owner_id, MIN(position) AS first FROM photos WHERE owner_type = ? GROUP BY owner_id) f
         ON f.owner_id = p.owner_id AND f.first = p.position
       WHERE p.owner_type = ?`,
      [type, type],
    );
    return new Map(rows.map((row) => [readText(row, "owner_id"), readText(row, "thumb_data_url")]));
  }

  // ----- Pengguna & pengaturan -------------------------------------------

  async getSetting(key: string): Promise<string | null> {
    const rows = await this.database.query("SELECT value FROM settings WHERE key = ?", [key]);
    return rows[0] === undefined ? null : readText(rows[0], "value");
  }

  // ----- Cadangan (pindah HP) --------------------------------------------

  /** Semua tabel data apa adanya, untuk file cadangan. */
  async readAllTables(): Promise<DataSnapshot> {
    const tables: Record<string, StoredRow[]> = {};
    for (const name of await this.tableNames()) {
      const rows = await this.database.query(`SELECT * FROM "${name}"`);
      tables[name] = rows.map((row) => readSqlRow(row));
    }
    return { schemaVersion: await readSchemaVersion(this.database), tables };
  }

  /**
   * Ganti seluruh data dengan isi cadangan, lalu naikkan ke skema terbaru.
   * Semuanya satu transaksi: bila ada yang tidak cocok, data lama tetap utuh.
   * Pengaturan yang `keepSetting` kembalikan true (lisensi & printer perangkat
   * ini) tidak ikut tertimpa.
   */
  async replaceAllTables(snapshot: DataSnapshot, keepSetting: (key: string) => boolean): Promise<void> {
    const version = snapshot.schemaVersion;
    if (!Number.isSafeInteger(version) || version < 1 || version > SCHEMA_VERSION) {
      throw new Error(`Cadangan memakai skema ${version}; aplikasi ini mendukung sampai ${SCHEMA_VERSION}. Perbarui aplikasi dulu.`);
    }
    const kept = (await this.database.query("SELECT key, value FROM settings")).filter((row) =>
      keepSetting(readText(row, "key")),
    );
    // Urutan tabel bebas selama memulihkan; kecocokan dicek di akhir.
    await this.database.execute("PRAGMA foreign_keys = OFF");
    try {
      await inTransaction(this.database, async () => {
        for (const name of await this.tableNames()) {
          await this.database.execute(`DROP TABLE "${name}"`);
        }
        for (const migration of DATABASE_MIGRATIONS.filter((item) => item.version <= version)) {
          for (const statement of migration.statements) await this.database.execute(statement);
        }
        const expected = await this.tableNames();
        const given = Object.keys(snapshot.tables).sort();
        if (given.join(",") !== expected.join(",")) {
          throw new Error("Daftar tabel pada cadangan tidak cocok. Data tidak diubah.");
        }
        for (const name of expected) {
          const columns = (await this.database.query(`PRAGMA table_info("${name}")`))
            .map((row) => readText(row, "name"))
            .sort();
          await this.insertRows(name, columns, snapshot.tables[name] ?? []);
        }
        for (const migration of DATABASE_MIGRATIONS.filter((item) => item.version > version)) {
          for (const statement of migration.statements) await this.database.execute(statement);
        }
        for (const row of kept) {
          await this.database.run(
            `INSERT INTO settings (key, value) VALUES (?, ?)
             ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
            [readText(row, "key"), readText(row, "value")],
          );
        }
        const broken = await this.database.query("PRAGMA foreign_key_check");
        if (broken.length > 0) {
          throw new Error("Isi cadangan rusak (ada data yang tidak saling cocok). Data tidak diubah.");
        }
        await this.database.execute(`PRAGMA user_version = ${SCHEMA_VERSION}`);
      });
    } finally {
      await this.database.execute("PRAGMA foreign_keys = ON");
    }
  }

  private async tableNames(): Promise<readonly string[]> {
    const rows = await this.database.query(
      `SELECT name FROM sqlite_master WHERE type = 'table'
       AND name NOT LIKE 'sqlite_%' AND name <> 'sync_table' ORDER BY name`,
    );
    return rows.map((row) => readText(row, "name"));
  }

  /** INSERT beberapa baris sekaligus (batas 999 parameter SQLite lama di Android). */
  private async insertRows(table: string, columns: readonly string[], rows: readonly StoredRow[]): Promise<void> {
    const columnList = columns.map((column) => `"${column}"`).join(", ");
    const placeholders = `(${columns.map(() => "?").join(", ")})`;
    const perStatement = Math.max(1, Math.floor(900 / Math.max(1, columns.length)));
    for (let start = 0; start < rows.length; start += perStatement) {
      const chunk = rows.slice(start, start + perStatement);
      const values: StoredValue[] = [];
      for (const row of chunk) {
        const keys = Object.keys(row).sort();
        if (keys.join(",") !== columns.join(",")) {
          throw new Error(`Kolom tabel ${table} pada cadangan tidak cocok. Data tidak diubah.`);
        }
        for (const column of columns) values.push(row[column] ?? null);
      }
      await this.database.run(
        `INSERT INTO "${table}" (${columnList}) VALUES ${chunk.map(() => placeholders).join(", ")}`,
        values,
      );
    }
  }

  async setSetting(key: string, value: string): Promise<void> {
    await this.database.run(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
      [key, value],
    );
  }

  async listUsers(): Promise<readonly StoredUser[]> {
    const rows = await this.database.query("SELECT * FROM users ORDER BY created_at_ms");
    return rows.map((row) => ({
      id: readText(row, "id"),
      name: readText(row, "name"),
      role: readText(row, "role") as UserRole,
      createdAtMs: readNumber(row, "created_at_ms"),
      archivedAtMs: readOptionalNumber(row, "archived_at_ms"),
      pin: {
        hash: readText(row, "pin_hash"),
        salt: readText(row, "pin_salt"),
        iterations: readNumber(row, "pin_iterations"),
      },
    }));
  }

  async saveUser(user: StoredUser): Promise<void> {
    await this.database.run(
      `INSERT INTO users
        (id, name, role, pin_hash, pin_salt, pin_iterations, created_at_ms, archived_at_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET
         name = excluded.name, role = excluded.role, pin_hash = excluded.pin_hash,
         pin_salt = excluded.pin_salt, pin_iterations = excluded.pin_iterations,
         archived_at_ms = excluded.archived_at_ms`,
      [
        user.id,
        user.name,
        user.role,
        user.pin.hash,
        user.pin.salt,
        user.pin.iterations,
        user.createdAtMs,
        user.archivedAtMs,
      ],
    );
  }

  // ----- Internal ---------------------------------------------------------

  private async insertPhone(
    intake: ReturnType<typeof validatePhoneIntake>,
    source: PhoneSource,
    acquiredAtMs: number,
    tradeInSaleId: string | null,
  ): Promise<string> {
    await this.assertImeiFreeInStock(intake.imei1, intake.imei2, null);
    const id = this.newId();
    await this.database.run(
      `INSERT INTO phone_units
        (id, brand, model, variant, color, imei1, imei2, condition, completeness, note,
         cost_rupiah, planned_price_rupiah, source, source_party, acquired_at_ms,
         trade_in_sale_id, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'stok')`,
      [
        id,
        intake.brand,
        intake.model,
        intake.variant,
        intake.color,
        intake.imei1,
        intake.imei2,
        intake.condition,
        intake.completeness,
        intake.note,
        toDb(intake.costRupiah),
        intake.plannedPriceRupiah === null ? null : toDb(intake.plannedPriceRupiah),
        source,
        intake.sourceParty,
        acquiredAtMs,
        tradeInSaleId,
      ],
    );
    return id;
  }

  private async assertImeiFreeInStock(
    imei1: string,
    imei2: string | null,
    exceptId: string | null,
  ): Promise<void> {
    const imeis = imei2 === null ? [imei1] : [imei1, imei2];
    const placeholders = imeis.map(() => "?").join(", ");
    const rows = await this.database.query(
      `SELECT id FROM phone_units
       WHERE status = 'stok' AND id <> ?
         AND (imei1 IN (${placeholders}) OR imei2 IN (${placeholders}))`,
      [exceptId ?? "", ...imeis, ...imeis],
    );
    if (rows.length > 0) {
      throw new DomainError("duplicate_imei", "IMEI ini sudah ada di stok HP.");
    }
  }

  private async closeServiceWork(
    serviceId: string,
    target: "selesai" | "batal",
    charges: ServiceCharges,
    partsNote: string | null | undefined,
    warranty: ServiceWarrantyInput,
  ): Promise<ServiceOrder> {
    const valid = validateServiceCharges(charges);
    const note = optionalText(partsNote, "Catatan sparepart", 300);
    const checked = target === "batal" ? { days: 0, note: null } : validWarranty(warranty);
    await inTransaction(this.database, async () => {
      const order = await this.requireService(serviceId);
      assertServiceTransition(order.status, target);
      await this.database.run(
        `UPDATE service_orders
         SET status = ?, outcome = ?, total_charge_rupiah = ?, parts_cost_rupiah = ?,
             parts_note = ?, finished_at_ms = ?, warranty_days = ?, warranty_note = ?
         WHERE id = ?`,
        [
          target,
          target,
          toDb(valid.totalChargeRupiah),
          toDb(valid.partsCostRupiah),
          note,
          this.now(),
          checked.days,
          checked.note,
          serviceId,
        ],
      );
    });
    return this.requireService(serviceId);
  }

  private async nextNumber(
    prefix: string,
    table: "sales" | "service_orders",
    timeColumn: "sold_at_ms" | "received_at_ms",
    atMs: number,
  ): Promise<string> {
    const day = jakartaDayRange(jakartaDayKey(atMs));
    const rows = await this.database.query(
      `SELECT COUNT(*) AS total FROM ${table} WHERE ${timeColumn} >= ? AND ${timeColumn} < ?`,
      [day.startMs, day.endMs],
    );
    return documentNumber(prefix, atMs, readNumber(rows[0] ?? {}, "total") + 1);
  }

  private async requirePhone(id: string): Promise<PhoneUnit> {
    const phone = await this.getPhone(id);
    if (phone === null) {
      throw new DomainError("not_found", "Data HP tidak ditemukan.");
    }
    return phone;
  }

  private async requireAccessory(id: string): Promise<Accessory> {
    const rows = await this.database.query("SELECT * FROM accessories WHERE id = ?", [id]);
    if (rows[0] === undefined) {
      throw new DomainError("not_found", "Aksesoris tidak ditemukan.");
    }
    return readAccessory(rows[0]);
  }

  private async requireDigitalProduct(id: string): Promise<DigitalProduct> {
    const rows = await this.database.query("SELECT * FROM digital_products WHERE id = ?", [id]);
    if (rows[0] === undefined) {
      throw new DomainError("not_found", "Produk digital tidak ditemukan.");
    }
    return readDigitalProduct(rows[0]);
  }

  private async requireSale(id: string): Promise<SaleRecord> {
    const sale = await this.getSale(id);
    if (sale === null) {
      throw new DomainError("not_found", "Nota tidak ditemukan.");
    }
    return sale;
  }

  private async requireService(id: string): Promise<ServiceOrder> {
    const order = await this.getService(id);
    if (order === null) {
      throw new DomainError("not_found", "Data service tidak ditemukan.");
    }
    return order;
  }
}

// ---------------------------------------------------------------------------
// Konversi baris SQLite
// ---------------------------------------------------------------------------

function defaultId(): string {
  if (typeof globalThis.crypto?.randomUUID !== "function") {
    throw new Error("Perangkat tidak mendukung pembuatan ID acak.");
  }
  return globalThis.crypto.randomUUID();
}

function toDb(value: bigint): StoredValue {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) {
    throw new DomainError("invalid_amount", "Nominal terlalu besar.");
  }
  return number;
}

function readText(row: SqlRow, column: string): string {
  const value = row[column];
  if (typeof value !== "string") {
    throw new Error(`Kolom ${column} tidak valid.`);
  }
  return value;
}

function readOptionalText(row: SqlRow, column: string): string | null {
  const value = row[column];
  return value === null || value === undefined ? null : readText(row, column);
}

function readNumber(row: SqlRow, column: string): number {
  const value = row[column];
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new Error(`Kolom ${column} tidak valid.`);
  }
  return value;
}

function readOptionalNumber(row: SqlRow, column: string): number | null {
  const value = row[column];
  return value === null || value === undefined ? null : readNumber(row, column);
}

function readBigint(row: SqlRow, column: string): bigint {
  return BigInt(readNumber(row, column));
}

function readOptionalBigint(row: SqlRow, column: string): bigint | null {
  const value = readOptionalNumber(row, column);
  return value === null ? null : BigInt(value);
}

function readPhone(row: SqlRow): PhoneUnit {
  const brand = readText(row, "brand");
  const model = readText(row, "model");
  const variant = readOptionalText(row, "variant");
  const color = readOptionalText(row, "color");
  return {
    id: readText(row, "id"),
    brand,
    model,
    variant,
    color,
    displayName: phoneDisplayName({ brand, model, variant, color }),
    imei1: readText(row, "imei1"),
    imei2: readOptionalText(row, "imei2"),
    condition: readText(row, "condition") as PhoneCondition,
    completeness: readOptionalText(row, "completeness"),
    note: readOptionalText(row, "note"),
    costRupiah: readBigint(row, "cost_rupiah"),
    plannedPriceRupiah: readOptionalBigint(row, "planned_price_rupiah"),
    source: readText(row, "source") as PhoneSource,
    sourceParty: readOptionalText(row, "source_party"),
    acquiredAtMs: readNumber(row, "acquired_at_ms"),
    tradeInSaleId: readOptionalText(row, "trade_in_sale_id"),
    status: readText(row, "status") as PhoneStatus,
    soldSaleId: readOptionalText(row, "sold_sale_id"),
  };
}

function readAccessory(row: SqlRow): Accessory {
  return {
    id: readText(row, "id"),
    name: readText(row, "name"),
    category: readOptionalText(row, "category"),
    costRupiah: readBigint(row, "cost_rupiah"),
    priceRupiah: readBigint(row, "price_rupiah"),
    stockQuantity: readBigint(row, "stock_quantity"),
    createdAtMs: readNumber(row, "created_at_ms"),
    archivedAtMs: readOptionalNumber(row, "archived_at_ms"),
  };
}

function readDigitalProduct(row: SqlRow): DigitalProduct {
  return {
    id: readText(row, "id"),
    name: readText(row, "name"),
    category: assertDigitalCategory(readText(row, "category")),
    costRupiah: readBigint(row, "cost_rupiah"),
    priceRupiah: readBigint(row, "price_rupiah"),
    tracksStock: readNumber(row, "track_stock") === 1,
    stockQuantity: readBigint(row, "stock_quantity"),
    createdAtMs: readNumber(row, "created_at_ms"),
    archivedAtMs: readOptionalNumber(row, "archived_at_ms"),
  };
}

function readSaleLine(row: SqlRow): SaleLineRecord {
  return {
    id: readText(row, "id"),
    position: readNumber(row, "position"),
    kind: readText(row, "kind") as SaleLineKind,
    phoneUnitId: readOptionalText(row, "phone_unit_id"),
    accessoryId: readOptionalText(row, "accessory_id"),
    digitalProductId: readOptionalText(row, "digital_product_id"),
    target: readOptionalText(row, "target"),
    name: readText(row, "name"),
    quantity: readBigint(row, "quantity"),
    unitPriceRupiah: readBigint(row, "unit_price_rupiah"),
    unitCostRupiah: readBigint(row, "unit_cost_rupiah"),
  };
}

function readService(row: SqlRow): ServiceOrder {
  const totalCharge = readOptionalBigint(row, "total_charge_rupiah");
  const partsCost = readBigint(row, "parts_cost_rupiah");
  const deposit = readBigint(row, "deposit_rupiah");
  const warrantyDays = readNumber(row, "warranty_days");
  const pickedUpAtMs = readOptionalNumber(row, "picked_up_at_ms");
  return {
    id: readText(row, "id"),
    number: readText(row, "number"),
    receivedAtMs: readNumber(row, "received_at_ms"),
    customerName: readText(row, "customer_name"),
    customerPhone: readOptionalText(row, "customer_phone"),
    device: readText(row, "device"),
    imei: readOptionalText(row, "imei"),
    complaint: readText(row, "complaint"),
    completeness: readOptionalText(row, "completeness"),
    unlockCode: readOptionalText(row, "unlock_code"),
    estimateRupiah: readOptionalBigint(row, "estimate_rupiah"),
    depositRupiah: deposit,
    status: readText(row, "status") as ServiceStatus,
    totalChargeRupiah: totalCharge,
    partsCostRupiah: partsCost,
    partsNote: readOptionalText(row, "parts_note"),
    finishedAtMs: readOptionalNumber(row, "finished_at_ms"),
    pickedUpAtMs,
    paymentMethod:
      readOptionalText(row, "payment_method") === null
        ? null
        : assertPaymentMethod(readText(row, "payment_method")),
    profitRupiah:
      totalCharge === null
        ? null
        : serviceProfit({ totalChargeRupiah: totalCharge, partsCostRupiah: partsCost }),
    balanceDueRupiah: totalCharge === null ? null : serviceBalanceDue(totalCharge, deposit),
    warrantyDays,
    warrantyNote: readOptionalText(row, "warranty_note"),
    warrantyUntil:
      warrantyDays > 0 && pickedUpAtMs !== null
        ? shiftDayKey(jakartaDayKey(pickedUpAtMs), warrantyDays)
        : null,
  };
}

function validWarranty(warranty: ServiceWarrantyInput): { readonly days: number; readonly note: string | null } {
  const days = assertWarrantyDays(warranty.days);
  // Ketentuan tanpa masa garansi tidak ada artinya.
  return { days, note: days === 0 ? null : optionalText(warranty.note, "Ketentuan garansi", 200) };
}
