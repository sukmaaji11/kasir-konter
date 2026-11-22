import type { DataSnapshot, KonterRepository } from "../data/repository";
import type { StoredRow } from "../data/schema";

/**
 * Cadangan & pindah HP.
 *
 * File cadangan = JSON berisi semua tabel + checksum SHA-256, supaya file
 * yang terpotong saat dikirim lewat WhatsApp/Drive ketahuan sebelum data
 * diganti. Lisensi tidak ikut dicadangkan (terikat ke perangkat), dan saat
 * memulihkan, lisensi & printer perangkat ini tidak ikut tertimpa.
 */
export const BACKUP_FORMAT = "kasir-konter-cadangan";
export const BACKUP_FORMAT_VERSION = 1;
const LAST_EXPORT_KEY = "backup.lastExportAt";

const NOT_EXPORTED = (key: string) => key.startsWith("license.");
const KEPT_ON_RESTORE = (key: string) => key.startsWith("license.") || key.startsWith("printer.");

interface BackupPayload {
  readonly app: string;
  readonly exportedAt: string;
  readonly schemaVersion: number;
  readonly tables: Readonly<Record<string, readonly StoredRow[]>>;
}

interface BackupFile {
  readonly format: string;
  readonly formatVersion: number;
  readonly payload: BackupPayload;
  readonly checksum: string;
}

export interface BackupPreview {
  readonly exportedAt: string;
  readonly storeName: string;
  readonly phonesInStock: number;
  readonly sales: number;
  readonly services: number;
  readonly accessories: number;
  readonly digitalProducts: number;
  readonly users: number;
}

/** Hasil pemeriksaan file; diteruskan ke `restore` setelah pengguna setuju. */
export interface PreparedRestore {
  readonly preview: BackupPreview;
  readonly snapshot: DataSnapshot;
}

export interface CreatedBackup {
  readonly fileName: string;
  readonly content: string;
}

export class BackupService {
  constructor(
    private readonly repo: KonterRepository,
    private readonly appName: string,
    /** Salinan data lama sebelum dipulihkan (disimpan di memori aplikasi). */
    private readonly saveSafetyCopy: (content: string) => Promise<void> = async () => undefined,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async createBackup(): Promise<CreatedBackup> {
    const content = await this.serialize();
    const fileName = `kasir-konter-cadangan-${fileStamp(this.now())}.json`;
    return { fileName, content };
  }

  /** Dipanggil setelah file berhasil dibagikan/disimpan. */
  async markExported(): Promise<void> {
    await this.repo.setSetting(LAST_EXPORT_KEY, String(this.now().getTime()));
  }

  async lastExportAtMs(): Promise<number | null> {
    const raw = await this.repo.getSetting(LAST_EXPORT_KEY);
    const value = raw === null ? Number.NaN : Number(raw);
    return Number.isSafeInteger(value) ? value : null;
  }

  async inspect(content: string): Promise<PreparedRestore> {
    const file = await parseBackup(content);
    return { preview: previewOf(file.payload), snapshot: { schemaVersion: file.payload.schemaVersion, tables: file.payload.tables } };
  }

  async restore(prepared: PreparedRestore): Promise<void> {
    await this.saveSafetyCopy(await this.serialize());
    await this.repo.replaceAllTables(prepared.snapshot, KEPT_ON_RESTORE);
  }

  private async serialize(): Promise<string> {
    const snapshot = await this.repo.readAllTables();
    const tables: Record<string, readonly StoredRow[]> = { ...snapshot.tables };
    if (tables.settings !== undefined) {
      tables.settings = tables.settings.filter((row) => typeof row.key !== "string" || !NOT_EXPORTED(row.key));
    }
    const payload: BackupPayload = {
      app: this.appName,
      exportedAt: this.now().toISOString(),
      schemaVersion: snapshot.schemaVersion,
      tables,
    };
    const signed = { format: BACKUP_FORMAT, formatVersion: BACKUP_FORMAT_VERSION, payload };
    const file: BackupFile = { ...signed, checksum: await sha256(canonicalJson(signed)) };
    return JSON.stringify(file);
  }
}

async function parseBackup(content: string): Promise<BackupFile> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("File ini bukan file cadangan Kasir Konter (bukan JSON). Pilih file kasir-konter-cadangan-….json.");
  }
  const file = asObject(parsed, "File ini bukan file cadangan Kasir Konter.");
  if (file.format !== BACKUP_FORMAT) {
    throw new Error("File ini bukan file cadangan Kasir Konter. Pilih file kasir-konter-cadangan-….json.");
  }
  if (file.formatVersion !== BACKUP_FORMAT_VERSION) {
    throw new Error("Versi file cadangan belum didukung. Perbarui aplikasi dulu.");
  }
  const payload = asObject(file.payload, "Isi file cadangan rusak.");
  if (typeof file.checksum !== "string" || !/^[0-9a-f]{64}$/.test(file.checksum)) {
    throw new Error("File cadangan tidak lengkap.");
  }
  const expected = await sha256(canonicalJson({ format: file.format, formatVersion: file.formatVersion, payload }));
  if (expected !== file.checksum) {
    throw new Error("File cadangan rusak atau terpotong (pemeriksaan gagal). Kirim ulang file dari HP lama. Data tidak diubah.");
  }
  if (typeof payload.exportedAt !== "string" || !Number.isFinite(Date.parse(payload.exportedAt))) {
    throw new Error("Waktu pembuatan cadangan tidak valid.");
  }
  if (typeof payload.schemaVersion !== "number" || !Number.isSafeInteger(payload.schemaVersion)) {
    throw new Error("Versi data pada cadangan tidak valid.");
  }
  const rawTables = asObject(payload.tables, "Daftar tabel pada cadangan rusak.");
  const tables: Record<string, readonly StoredRow[]> = {};
  for (const [name, rows] of Object.entries(rawTables)) {
    if (!/^[a-z][a-z0-9_]*$/.test(name) || !Array.isArray(rows)) throw new Error(`Tabel ${name} pada cadangan rusak.`);
    tables[name] = rows.map((row) => readRow(row, name));
  }
  return {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    checksum: file.checksum,
    payload: {
      app: typeof payload.app === "string" ? payload.app : "",
      exportedAt: payload.exportedAt,
      schemaVersion: payload.schemaVersion,
      tables,
    },
  };
}

function previewOf(payload: BackupPayload): BackupPreview {
  const rows = (table: string) => payload.tables[table] ?? [];
  const profile = rows("settings").find((row) => row.key === "store.profile")?.value;
  let storeName = "";
  if (typeof profile === "string") {
    try {
      const parsed = JSON.parse(profile) as { name?: unknown };
      if (typeof parsed.name === "string") storeName = parsed.name.trim();
    } catch {
      storeName = "";
    }
  }
  return {
    exportedAt: payload.exportedAt,
    storeName,
    phonesInStock: rows("phone_units").filter((row) => row.status === "stok").length,
    sales: rows("sales").filter((row) => row.voided_at_ms === null).length,
    services: rows("service_orders").length,
    accessories: rows("accessories").filter((row) => row.archived_at_ms === null || row.archived_at_ms === undefined).length,
    digitalProducts: rows("digital_products").filter((row) => row.archived_at_ms === null || row.archived_at_ms === undefined).length,
    users: rows("users").filter((row) => row.archived_at_ms === null || row.archived_at_ms === undefined).length,
  };
}

function readRow(value: unknown, table: string): StoredRow {
  const row = asObject(value, `Baris tabel ${table} pada cadangan rusak.`);
  const result: StoredRow = {};
  for (const [key, item] of Object.entries(row)) {
    if (item !== null && typeof item !== "string" && !(typeof item === "number" && Number.isSafeInteger(item))) {
      throw new Error(`Baris tabel ${table} pada cadangan rusak.`);
    }
    result[key] = item;
  }
  return result;
}

function asObject(value: unknown, message: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}

/** JSON dengan kunci berurutan, supaya checksum tidak bergantung urutan kolom. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error("Angka pada cadangan harus bilangan bulat.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  throw new Error("Tipe data pada cadangan tidak didukung.");
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** "2026-11-23-0915" dalam WIB, untuk nama file. */
function fileStamp(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}-${get("hour")}${get("minute")}`;
}
