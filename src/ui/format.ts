import { formatRupiah } from "../domain/money";
import { jakartaDayKey, jakartaMonthKey } from "../domain/time";

export function rp(value: bigint): string {
  return formatRupiah(value).replace(/ /g, " ");
}

/** Untung dengan tanda: "+Rp 150.000" / "-Rp 20.000". */
export function rpSigned(value: bigint): string {
  return value > 0n ? `+${rp(value)}` : rp(value);
}

/** Isi CurrencyInput (hanya angka) → bigint. Kosong = null. */
export function digitsToRupiah(digits: string): bigint | null {
  const cleaned = digits.replace(/\D/g, "");
  return cleaned.length === 0 ? null : BigInt(cleaned);
}

export function rupiahToDigits(value: bigint | null): string {
  return value === null ? "" : value.toString();
}

const WIB = "Asia/Jakarta";

export function dateTimeWib(ms: number): string {
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: WIB,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(ms);
}

/** Jam saja, mis. "14.05". */
export function timeWib(ms: number): string {
  return new Intl.DateTimeFormat("id-ID", { timeZone: WIB, hour: "2-digit", minute: "2-digit" }).format(ms);
}

export function dateWib(ms: number): string {
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: WIB,
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(ms);
}

export function dayLabel(dayKey: string): string {
  const [year, month, day] = dayKey.split("-").map(Number);
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(Date.UTC(year!, month! - 1, day!));
}

export function monthLabel(monthKey: string): string {
  const [year, month] = monthKey.split("-").map(Number);
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  }).format(Date.UTC(year!, month! - 1, 1));
}

export function todayKey(): string {
  return jakartaDayKey(Date.now());
}

export function thisMonthKey(): string {
  return jakartaMonthKey(Date.now());
}

/** "hari ini", "kemarin", "5 hari". */
export function ageLabel(sinceMs: number, nowMs = Date.now()): string {
  const days = Math.floor(
    (Date.parse(`${jakartaDayKey(nowMs)}T00:00:00Z`) -
      Date.parse(`${jakartaDayKey(sinceMs)}T00:00:00Z`)) /
      86_400_000,
  );
  if (days <= 0) return "hari ini";
  if (days === 1) return "kemarin";
  return `${days} hari`;
}

export function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Terjadi kendala. Coba lagi.";
}
