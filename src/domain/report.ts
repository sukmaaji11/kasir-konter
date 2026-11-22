import { sumRupiah, type Rupiah } from "./money";

export type BusinessLine = "hp" | "aksesoris" | "digital" | "service";

export const BUSINESS_LINES: readonly BusinessLine[] = ["hp", "aksesoris", "digital", "service"];

export const BUSINESS_LINE_LABELS: Readonly<Record<BusinessLine, string>> = {
  hp: "Jual HP",
  aksesoris: "Aksesoris",
  digital: "Digital",
  service: "Service",
};

/** Satu kejadian yang menghasilkan untung: baris nota atau service yang diambil. */
export interface ProfitEntry {
  readonly line: BusinessLine;
  readonly atMs: number;
  readonly revenueRupiah: Rupiah;
  readonly costRupiah: Rupiah;
  /** Jumlah barang/unit/service. */
  readonly count: bigint;
}

export interface ProfitTotals {
  readonly revenueRupiah: Rupiah;
  readonly costRupiah: Rupiah;
  readonly profitRupiah: Rupiah;
  readonly count: bigint;
}

export interface ProfitSummary {
  readonly byLine: Readonly<Record<BusinessLine, ProfitTotals>>;
  readonly total: ProfitTotals;
}

export function totalsOf(entries: readonly ProfitEntry[]): ProfitTotals {
  const revenueRupiah = sumRupiah(entries.map((entry) => entry.revenueRupiah));
  const costRupiah = sumRupiah(entries.map((entry) => entry.costRupiah));
  let count = 0n;
  for (const entry of entries) {
    count += entry.count;
  }
  return { revenueRupiah, costRupiah, profitRupiah: revenueRupiah - costRupiah, count };
}

export function summarizeProfit(entries: readonly ProfitEntry[]): ProfitSummary {
  const byLine = {} as Record<BusinessLine, ProfitTotals>;
  for (const line of BUSINESS_LINES) {
    byLine[line] = totalsOf(entries.filter((entry) => entry.line === line));
  }
  return { byLine, total: totalsOf(entries) };
}
