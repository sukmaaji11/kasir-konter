import { DomainError } from "./errors";
import { assertNonNegativeRupiah, assertPositiveQuantity, sumRupiah, type Rupiah } from "./money";

export type PaymentMethod = "tunai" | "transfer" | "qris";
export type SaleLineKind = "hp" | "aksesoris" | "digital";

export const PAYMENT_METHODS: readonly PaymentMethod[] = ["tunai", "transfer", "qris"];

/**
 * Baris nota yang sudah dibekukan saat transaksi: nama, harga jual, dan
 * harga modal disalin supaya laporan lama tidak berubah kalau harga diubah.
 */
export interface SaleLineSnapshot {
  readonly kind: SaleLineKind;
  readonly name: string;
  readonly quantity: bigint;
  readonly unitPriceRupiah: Rupiah;
  readonly unitCostRupiah: Rupiah;
}

export interface SaleSummary {
  /** Total harga barang di nota. */
  readonly itemsTotalRupiah: Rupiah;
  /** Potongan dari HP tukar tambah. */
  readonly tradeInCreditRupiah: Rupiah;
  /**
   * Yang dibayar pelanggan. Negatif berarti konter yang membayar
   * pelanggan (HP lama dihargai lebih mahal dari barang yang dibeli).
   */
  readonly amountDueRupiah: Rupiah;
  readonly costRupiah: Rupiah;
  /**
   * Untung = harga barang − modal barang. Potongan tukar tambah tidak
   * mengurangi untung karena HP lama masuk stok dengan modal sebesar
   * potongan itu; untungnya baru dihitung saat HP lama dijual lagi.
   */
  readonly profitRupiah: Rupiah;
}

export function lineRevenue(line: SaleLineSnapshot): Rupiah {
  return line.unitPriceRupiah * line.quantity;
}

export function lineCost(line: SaleLineSnapshot): Rupiah {
  return line.unitCostRupiah * line.quantity;
}

export function lineProfit(line: SaleLineSnapshot): Rupiah {
  return lineRevenue(line) - lineCost(line);
}

export function validateSaleLine(line: SaleLineSnapshot): SaleLineSnapshot {
  assertPositiveQuantity(line.quantity);
  if (line.kind === "hp" && line.quantity !== 1n) {
    throw new DomainError("invalid_quantity", "Satu baris HP hanya untuk 1 unit.");
  }
  assertNonNegativeRupiah(line.unitPriceRupiah, "Harga jual");
  assertNonNegativeRupiah(line.unitCostRupiah, "Harga modal");
  return line;
}

export function summarizeSale(
  lines: readonly SaleLineSnapshot[],
  tradeInCreditRupiah: Rupiah = 0n,
): SaleSummary {
  assertNonNegativeRupiah(tradeInCreditRupiah, "Nilai tukar tambah");
  const itemsTotalRupiah = sumRupiah(lines.map(lineRevenue));
  const costRupiah = sumRupiah(lines.map(lineCost));
  return {
    itemsTotalRupiah,
    tradeInCreditRupiah,
    amountDueRupiah: itemsTotalRupiah - tradeInCreditRupiah,
    costRupiah,
    profitRupiah: itemsTotalRupiah - costRupiah,
  };
}

export function assertPaymentMethod(value: string): PaymentMethod {
  if (!(PAYMENT_METHODS as readonly string[]).includes(value)) {
    throw new DomainError("invalid_text", "Metode bayar tidak dikenal.");
  }
  return value as PaymentMethod;
}
