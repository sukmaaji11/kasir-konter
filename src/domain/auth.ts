import { DomainError } from "./errors";

export type UserRole = "owner" | "staff";

export interface AppUser {
  readonly id: string;
  readonly name: string;
  readonly role: UserRole;
  readonly createdAtMs: number;
  readonly archivedAtMs: number | null;
}

/** Data PIN tersimpan; PIN asli tidak pernah disimpan. */
export interface PinCredential {
  readonly hash: string;
  readonly salt: string;
  readonly iterations: number;
}

export interface StoredUser extends AppUser {
  readonly pin: PinCredential;
}

export type Permission =
  | "sell"
  | "service"
  | "viewStock"
  | "addPhone"
  | "manageAccessories"
  | "voidSale"
  | "viewCostAndProfit"
  | "manageUsers";

/**
 * Karyawan boleh melayani jualan dan service serta melihat stok.
 * Semua yang menyangkut harga modal dan untung hanya untuk Owner,
 * termasuk mencatat HP masuk dan tambah stok (keduanya mengisi modal).
 */
const STAFF_PERMISSIONS: ReadonlySet<Permission> = new Set<Permission>([
  "sell",
  "service",
  "viewStock",
]);

export function can(user: Pick<AppUser, "role">, permission: Permission): boolean {
  return user.role === "owner" || STAFF_PERMISSIONS.has(permission);
}

export const PIN_LENGTH = 6;

/** PIN 6 angka; tolak pola yang terlalu mudah ditebak. */
export function validatePin(pin: string): string {
  if (!new RegExp(`^\\d{${PIN_LENGTH}}$`).test(pin)) {
    throw new DomainError("invalid_pin", `PIN harus ${PIN_LENGTH} angka.`);
  }
  if (/^(\d)\1+$/.test(pin)) {
    throw new DomainError("weak_pin", "PIN tidak boleh angka yang sama semua.");
  }
  if ("01234567890".includes(pin) || "09876543210".includes(pin)) {
    throw new DomainError("weak_pin", "PIN tidak boleh angka berurutan.");
  }
  return pin;
}

export function cleanUserName(name: string): string {
  const cleaned = name.trim().replace(/\s+/g, " ");
  if (cleaned.length === 0 || cleaned.length > 40) {
    throw new DomainError("invalid_name", "Nama pengguna perlu diisi (maksimal 40 karakter).");
  }
  return cleaned;
}

export function roleLabel(role: UserRole): string {
  return role === "owner" ? "Owner" : "Karyawan";
}
