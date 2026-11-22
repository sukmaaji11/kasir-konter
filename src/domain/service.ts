import { DomainError } from "./errors";
import { assertNonNegativeRupiah, type Rupiah } from "./money";

/**
 * Alur service:
 *   proses → selesai → diambil
 *   proses → batal   → diambil   (HP dikembalikan tanpa diperbaiki)
 *   selesai/batal → proses        (dikerjakan ulang)
 * Untung service dihitung saat HP diambil, karena saat itulah pelanggan
 * melunasi biaya.
 */
export type ServiceStatus = "proses" | "selesai" | "batal" | "diambil";

const ALLOWED_TRANSITIONS: Readonly<Record<ServiceStatus, readonly ServiceStatus[]>> = {
  proses: ["selesai", "batal"],
  selesai: ["diambil", "proses"],
  batal: ["diambil", "proses"],
  diambil: [],
};

export const SERVICE_STATUS_LABELS: Readonly<Record<ServiceStatus, string>> = {
  proses: "Sedang dikerjakan",
  selesai: "Selesai, belum diambil",
  batal: "Batal, belum diambil",
  diambil: "Sudah diambil",
};

export function assertServiceTransition(from: ServiceStatus, to: ServiceStatus): void {
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new DomainError(
      "invalid_state",
      `Status service tidak bisa diubah dari "${SERVICE_STATUS_LABELS[from]}" ke "${SERVICE_STATUS_LABELS[to]}".`,
    );
  }
}

export interface ServiceCharges {
  /** Total yang dibayar pelanggan (jasa + sparepart). Untuk batal: biaya cek, boleh 0. */
  readonly totalChargeRupiah: Rupiah;
  /** Modal sparepart termasuk ongkir marketplace. */
  readonly partsCostRupiah: Rupiah;
}

export function validateServiceCharges(charges: ServiceCharges): ServiceCharges {
  return {
    totalChargeRupiah: assertNonNegativeRupiah(charges.totalChargeRupiah, "Biaya service"),
    partsCostRupiah: assertNonNegativeRupiah(charges.partsCostRupiah, "Modal sparepart"),
  };
}

export function serviceProfit(charges: ServiceCharges): Rupiah {
  return charges.totalChargeRupiah - charges.partsCostRupiah;
}

/** Sisa yang harus dibayar saat diambil. Negatif = DP perlu dikembalikan. */
export function serviceBalanceDue(totalChargeRupiah: Rupiah, depositRupiah: Rupiah): Rupiah {
  return totalChargeRupiah - depositRupiah;
}
