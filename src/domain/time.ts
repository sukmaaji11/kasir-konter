import { DomainError } from "./errors";

/** Asia/Jakarta selalu UTC+7 (tidak ada pergantian musim). */
const JAKARTA_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface TimeRange {
  /** Inklusif. */
  readonly startMs: number;
  /** Eksklusif. */
  readonly endMs: number;
}

function jakartaDate(ms: number): Date {
  return new Date(ms + JAKARTA_OFFSET_MS);
}

function pad(value: number, length = 2): string {
  return value.toString().padStart(length, "0");
}

export function jakartaDayKey(ms: number): string {
  const date = jakartaDate(ms);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export function jakartaMonthKey(ms: number): string {
  return jakartaDayKey(ms).slice(0, 7);
}

export function jakartaDayRange(dayKey: string): TimeRange {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey);
  if (match === null) {
    throw new DomainError("invalid_period", "Format tanggal harus YYYY-MM-DD.");
  }
  const [, year, month, day] = match;
  const startMs =
    Date.UTC(Number(year), Number(month) - 1, Number(day)) - JAKARTA_OFFSET_MS;
  if (jakartaDayKey(startMs) !== dayKey) {
    throw new DomainError("invalid_period", "Tanggal tidak valid.");
  }
  return { startMs, endMs: startMs + DAY_MS };
}

export function jakartaMonthRange(monthKey: string): TimeRange {
  const match = /^(\d{4})-(\d{2})$/.exec(monthKey);
  const month = match === null ? NaN : Number(match[2]);
  if (match === null || month < 1 || month > 12) {
    throw new DomainError("invalid_period", "Format bulan harus YYYY-MM.");
  }
  const year = Number(match[1]);
  return {
    startMs: Date.UTC(year, month - 1, 1) - JAKARTA_OFFSET_MS,
    endMs: Date.UTC(year, month, 1) - JAKARTA_OFFSET_MS,
  };
}

/** Kunci tanggal YYYY-MM-DD untuk setiap hari dalam bulan. */
export function daysInJakartaMonth(monthKey: string): readonly string[] {
  const { startMs, endMs } = jakartaMonthRange(monthKey);
  const days: string[] = [];
  for (let ms = startMs; ms < endMs; ms += DAY_MS) {
    days.push(jakartaDayKey(ms));
  }
  return days;
}

/** Nomor nota harian: J-20261122-001. */
export function documentNumber(prefix: string, ms: number, sequence: number): string {
  return `${prefix}-${jakartaDayKey(ms).replaceAll("-", "")}-${pad(sequence, 3)}`;
}
