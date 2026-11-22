import { useState } from "react";
import { formatDayRange, type DayRange } from "../application/reports";
import { daysBetween, jakartaDayKey, jakartaMonthRange, shiftDayKey } from "../domain/time";
import { thisMonthKey, todayKey } from "./format";

/** "Senin, 23 November 2026". */
function dayLabelLong(dayKey: string): string {
  const [year, month, day] = dayKey.split("-").map(Number);
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(Date.UTC(year!, month! - 1, day!));
}

export type RangePreset = "hari-ini" | "kemarin" | "7-hari" | "bulan-ini" | "bulan-lalu" | "bulan" | "tanggal";

const PRESETS: readonly { readonly id: RangePreset; readonly label: string }[] = [
  { id: "hari-ini", label: "Hari ini" },
  { id: "kemarin", label: "Kemarin" },
  { id: "7-hari", label: "7 hari" },
  { id: "bulan-ini", label: "Bulan ini" },
  { id: "bulan-lalu", label: "Bulan lalu" },
  { id: "bulan", label: "Pilih bulan" },
  { id: "tanggal", label: "Pilih tanggal" },
];

export function monthDays(monthKey: string): DayRange {
  const range = jakartaMonthRange(monthKey);
  const today = todayKey();
  const last = jakartaDayKey(range.endMs - 1);
  return { from: jakartaDayKey(range.startMs), to: last > today ? today : last };
}

export function presetRange(preset: Exclude<RangePreset, "bulan" | "tanggal">): DayRange {
  const today = todayKey();
  switch (preset) {
    case "hari-ini":
      return { from: today, to: today };
    case "kemarin": {
      const day = shiftDayKey(today, -1);
      return { from: day, to: day };
    }
    case "7-hari":
      return { from: shiftDayKey(today, -6), to: today };
    case "bulan-ini":
      return monthDays(thisMonthKey());
    case "bulan-lalu":
      return monthDays(shiftDayKey(`${thisMonthKey()}-01`, -1).slice(0, 7));
  }
}

/** Periode + pilihan cepat, dipakai Laporan, Barang terlaris, dan Cara bayar. */
export function useRangeFilter(initial: Exclude<RangePreset, "bulan" | "tanggal"> = "hari-ini") {
  const [preset, setPreset] = useState<RangePreset>(initial);
  const [range, setRange] = useState<DayRange>(presetRange(initial));
  const [month, setMonth] = useState(thisMonthKey());
  return {
    range,
    /** Lompat ke satu tanggal (mis. dari daftar per hari). */
    showDay(day: string) {
      setPreset("tanggal");
      setRange({ from: day, to: day });
    },
    element: (
      <RangeFilter
        preset={preset}
        range={range}
        month={month}
        onPreset={(next) => {
          setPreset(next);
          if (next === "bulan") setRange(monthDays(month));
          else if (next !== "tanggal") setRange(presetRange(next));
        }}
        onMonth={(next) => {
          setMonth(next);
          setRange(monthDays(next));
        }}
        onRange={setRange}
        onStep={(direction) => {
          const next = stepRange(preset, range, direction);
          if (next === null) return;
          setRange(next.range);
          setPreset(next.preset);
          if (next.month !== null) setMonth(next.month);
        }}
      />
    ),
  };
}

/**
 * Tombol ‹ ›: periode bulan bergeser satu bulan, periode lain bergeser
 * sepanjang periodenya (1 hari, 7 hari, …). Tidak bisa melewati hari ini.
 */
export function stepRange(
  preset: RangePreset,
  range: DayRange,
  direction: -1 | 1,
): { readonly range: DayRange; readonly preset: RangePreset; readonly month: string | null } | null {
  const today = todayKey();
  const currentMonth = thisMonthKey();
  if (preset === "bulan" || preset === "bulan-ini" || preset === "bulan-lalu") {
    const first = `${range.from.slice(0, 7)}-01`;
    const target = (direction < 0 ? shiftDayKey(first, -1) : shiftDayKey(first, 31)).slice(0, 7);
    if (target > currentMonth) return null;
    const lastMonth = shiftDayKey(`${currentMonth}-01`, -1).slice(0, 7);
    const nextPreset: RangePreset = target === currentMonth ? "bulan-ini" : target === lastMonth ? "bulan-lalu" : "bulan";
    return { range: monthDays(target), preset: nextPreset, month: target };
  }
  const length = daysBetween(range.from, range.to).length;
  const from = shiftDayKey(range.from, direction * length);
  if (from > today) return null;
  const toRaw = shiftDayKey(range.to, direction * length);
  const next = { from, to: toRaw > today ? today : toRaw };
  let nextPreset: RangePreset = "tanggal";
  if (next.from === next.to && next.from === today) nextPreset = "hari-ini";
  else if (next.from === next.to && next.from === shiftDayKey(today, -1)) nextPreset = "kemarin";
  else if (next.to === today && length === 7 && next.from === shiftDayKey(today, -6)) nextPreset = "7-hari";
  return { range: next, preset: nextPreset, month: null };
}

function RangeFilter({
  preset,
  range,
  month,
  onPreset,
  onMonth,
  onRange,
  onStep,
}: {
  readonly preset: RangePreset;
  readonly range: DayRange;
  readonly month: string;
  readonly onPreset: (preset: RangePreset) => void;
  readonly onMonth: (month: string) => void;
  readonly onRange: (range: DayRange) => void;
  readonly onStep: (direction: -1 | 1) => void;
}) {
  const canForward = stepRange(preset, range, 1) !== null;
  const today = todayKey();
  function setDate(edge: "from" | "to", value: string) {
    if (value.length === 0) return;
    const next = { ...range, [edge]: value > today ? today : value };
    onRange(next.from > next.to ? { from: next.to, to: next.from } : next);
  }
  return (
    <section className="range-filter">
      <div className="range-presets" role="radiogroup" aria-label="Periode">
        {PRESETS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="radio"
            aria-checked={preset === item.id}
            className={preset === item.id ? "range-chip active" : "range-chip"}
            onClick={() => onPreset(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {preset === "bulan" && (
        <label className="range-month">
          Bulan
          <input type="month" value={month} max={thisMonthKey()} onChange={(event) => event.target.value && onMonth(event.target.value)} />
        </label>
      )}
      {preset === "tanggal" && (
        <div className="range-dates">
          <label>
            Dari
            <input type="date" value={range.from} max={today} onChange={(event) => setDate("from", event.target.value)} />
          </label>
          <label>
            Sampai
            <input type="date" value={range.to} max={today} onChange={(event) => setDate("to", event.target.value)} />
          </label>
        </div>
      )}
      <div className="range-step">
        <button type="button" className="range-step-button" onClick={() => onStep(-1)} aria-label="Periode sebelumnya">
          ‹
        </button>
        <p className="range-summary">
          <small>Periode</small>
          <strong>{range.from === range.to ? dayLabelLong(range.from) : formatDayRange(range)}</strong>
          {range.from !== range.to && <small>{daysBetween(range.from, range.to).length} hari</small>}
        </p>
        <button
          type="button"
          className="range-step-button"
          onClick={() => onStep(1)}
          disabled={!canForward}
          aria-label="Periode berikutnya"
        >
          ›
        </button>
      </div>
    </section>
  );
}
