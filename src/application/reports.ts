import type {
  DailyProfit,
  ItemSalesRow,
  KonterRepository,
  PaymentTotals,
  PhoneProfitRow,
  ServiceOrder,
} from "../data/repository";
import type { ProfitSummary } from "../domain/report";
import { jakartaDaysRange } from "../domain/time";

/** Rentang tanggal laporan (YYYY-MM-DD, WIB, inklusif). */
export interface DayRange {
  readonly from: string;
  readonly to: string;
}

/** Semua isi laporan untuk satu rentang tanggal: dipakai layar dan PDF. */
export interface KonterReport {
  readonly range: DayRange;
  readonly summary: ProfitSummary;
  readonly payments: readonly PaymentTotals[];
  /** Per hari; hanya untuk rentang lebih dari 1 hari. */
  readonly daily: readonly DailyProfit[] | null;
  readonly phones: readonly PhoneProfitRow[];
  readonly services: readonly ServiceOrder[];
  readonly items: readonly ItemSalesRow[];
  readonly saleCount: number;
  readonly voidedCount: number;
}

export async function loadReport(repo: KonterRepository, range: DayRange): Promise<KonterReport> {
  const time = jakartaDaysRange(range.from, range.to);
  const sales = await repo.listSales(time);
  return {
    range,
    summary: await repo.profitSummary(time),
    payments: await repo.paymentTotals(time),
    daily: range.from === range.to ? null : await repo.dailyProfitBetween(range.from, range.to),
    phones: await repo.phoneProfits(time),
    services: await repo.listPickedUpServices(time),
    items: await repo.itemSales(time),
    saleCount: sales.filter((sale) => sale.voidedAtMs === null).length,
    voidedCount: sales.filter((sale) => sale.voidedAtMs !== null).length,
  };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

function shortDate(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  return `${date} ${MONTHS[month! - 1]} ${year}`;
}

/** "22 Nov 2026" atau "1 Nov 2026 - 22 Nov 2026" (ASCII, aman untuk PDF). */
export function formatDayRange(range: DayRange): string {
  return range.from === range.to ? shortDate(range.from) : `${shortDate(range.from)} - ${shortDate(range.to)}`;
}

export function reportFileName(range: DayRange): string {
  const period = range.from === range.to ? range.from : `${range.from}_sd_${range.to}`;
  return `laporan-konter-${period}.pdf`;
}
