import { useState } from "react";
import { formatDayRange, type DayRange } from "../application/reports";
import { jakartaDayKey, jakartaMonthRange, shiftDayKey } from "../domain/time";
import { dayLabel, thisMonthKey, todayKey } from "./format";

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
      />
    ),
  };
}

function RangeFilter({
  preset,
  range,
  month,
  onPreset,
  onMonth,
  onRange,
}: {
  readonly preset: RangePreset;
  readonly range: DayRange;
  readonly month: string;
  readonly onPreset: (preset: RangePreset) => void;
  readonly onMonth: (month: string) => void;
  readonly onRange: (range: DayRange) => void;
}) {
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
      <p className="range-summary">Periode: {range.from === range.to ? dayLabel(range.from) : formatDayRange(range)}</p>
    </section>
  );
}
