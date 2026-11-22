import { DomainError } from "./errors";
import { assertNonNegativeRupiah, type Rupiah } from "./money";
import { optionalText, requiredText } from "./text";

export type PhoneCondition = "baru" | "bekas";

/**
 * Asal HP masuk stok:
 * - supplier: kulakan dari sales/distributor/marketplace
 * - beli_pelanggan: pelanggan menjual HP-nya ke konter
 * - tukar_tambah: HP lama pelanggan yang dipakai memotong harga HP baru
 */
export type PhoneSource = "supplier" | "beli_pelanggan" | "tukar_tambah";

export type PhoneStatus = "stok" | "terjual" | "dibatalkan";

export interface PhoneIntakeInput {
  readonly brand: string;
  readonly model: string;
  readonly variant?: string | null;
  readonly color?: string | null;
  readonly imei1: string;
  readonly imei2?: string | null;
  readonly condition: PhoneCondition;
  readonly completeness?: string | null;
  /** Harga modal: yang dibayar konter untuk HP ini. */
  readonly costRupiah: Rupiah;
  /** Rencana harga jual, boleh kosong. */
  readonly plannedPriceRupiah?: Rupiah | null;
  /** Nama supplier atau pelanggan penjual. */
  readonly sourceParty?: string | null;
  readonly note?: string | null;
}

export interface PhoneIntake {
  readonly brand: string;
  readonly model: string;
  readonly variant: string | null;
  readonly color: string | null;
  readonly imei1: string;
  readonly imei2: string | null;
  readonly condition: PhoneCondition;
  readonly completeness: string | null;
  readonly costRupiah: Rupiah;
  readonly plannedPriceRupiah: Rupiah | null;
  readonly sourceParty: string | null;
  readonly note: string | null;
}

/** Menghapus spasi/tanda hubung dan memastikan IMEI 15 digit. */
export function normalizeImei(value: string, label = "IMEI"): string {
  const digits = value.replace(/[\s-]/g, "");
  if (!/^\d{15}$/.test(digits)) {
    throw new DomainError("invalid_imei", `${label} harus 15 digit angka.`);
  }
  return digits;
}

/**
 * Cek digit terakhir IMEI (algoritma Luhn). Dipakai sebagai peringatan
 * salah ketik di layar, bukan penolakan, karena ada HP murah dengan IMEI tidak standar.
 */
export function isImeiChecksumValid(imei: string): boolean {
  if (!/^\d{15}$/.test(imei)) {
    return false;
  }
  let sum = 0;
  for (let index = 0; index < 15; index += 1) {
    let digit = Number(imei[index]);
    if (index % 2 === 1) {
      digit *= 2;
      if (digit > 9) {
        digit -= 9;
      }
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

export function validatePhoneIntake(input: PhoneIntakeInput): PhoneIntake {
  if (input.condition !== "baru" && input.condition !== "bekas") {
    throw new DomainError("invalid_text", "Kondisi HP harus baru atau bekas.");
  }
  const imei1 = normalizeImei(input.imei1, "IMEI 1");
  const imei2Text = optionalText(input.imei2, "IMEI 2", 40);
  const imei2 = imei2Text === null ? null : normalizeImei(imei2Text, "IMEI 2");
  if (imei2 === imei1) {
    throw new DomainError("invalid_imei", "IMEI 2 tidak boleh sama dengan IMEI 1.");
  }
  const plannedPrice = input.plannedPriceRupiah ?? null;

  return {
    brand: requiredText(input.brand, "Merek", 40),
    model: requiredText(input.model, "Tipe HP", 80),
    variant: optionalText(input.variant, "Varian", 40),
    color: optionalText(input.color, "Warna", 40),
    imei1,
    imei2,
    condition: input.condition,
    completeness: optionalText(input.completeness, "Kelengkapan", 200),
    costRupiah: assertNonNegativeRupiah(input.costRupiah, "Harga modal"),
    plannedPriceRupiah:
      plannedPrice === null
        ? null
        : assertNonNegativeRupiah(plannedPrice, "Rencana harga jual"),
    sourceParty: optionalText(input.sourceParty, "Nama supplier/penjual", 80),
    note: optionalText(input.note, "Catatan", 500),
  };
}

export function phoneDisplayName(phone: {
  readonly brand: string;
  readonly model: string;
  readonly variant: string | null;
  readonly color: string | null;
}): string {
  return [phone.brand, phone.model, phone.variant, phone.color]
    .filter((part): part is string => part !== null && part.length > 0)
    .join(" ");
}
