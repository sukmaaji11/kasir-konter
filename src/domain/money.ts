import { DomainError } from "./errors";

/**
 * Semua uang di Kasir Konter adalah rupiah bulat (`bigint`).
 * Harga HP, aksesoris, dan service tidak pernah memakai pecahan rupiah,
 * jadi tidak perlu representasi rasio seperti HPP resep di Kasir Kaki Lima.
 */
export type Rupiah = bigint;

export function assertNonNegativeRupiah(value: bigint, label = "Harga"): Rupiah {
  if (value < 0n) {
    throw new DomainError("invalid_amount", `${label} tidak boleh negatif.`);
  }
  return value;
}

export function assertPositiveQuantity(value: bigint, label = "Jumlah"): bigint {
  if (value <= 0n) {
    throw new DomainError("invalid_quantity", `${label} harus lebih dari 0.`);
  }
  return value;
}

export function sumRupiah(values: Iterable<Rupiah>): Rupiah {
  let total = 0n;
  for (const value of values) {
    total += value;
  }
  return total;
}

export function formatRupiah(value: Rupiah): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(value);
}

/** Membaca ketikan seperti "1.500.000", "Rp 1.500.000", atau "1500000". */
export function parseRupiahInput(text: string): Rupiah {
  const cleaned = text.trim().replace(/^rp\.?\s*/i, "").replace(/[.\s]/g, "");
  if (!/^\d+$/.test(cleaned)) {
    throw new DomainError("invalid_amount", "Nominal hanya boleh berisi angka.");
  }
  return BigInt(cleaned);
}
