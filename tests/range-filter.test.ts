import { describe, expect, it } from "vitest";
import { shiftDayKey } from "../src/domain/time";
import { thisMonthKey, todayKey } from "../src/ui/format";
import { monthDays, presetRange, stepRange } from "../src/ui/RangeFilter";

describe("stepRange", () => {
  it("geser satu hari dan kembali ke Hari ini / Kemarin", () => {
    const today = todayKey();
    const back = stepRange("hari-ini", presetRange("hari-ini"), -1);
    expect(back?.preset).toBe("kemarin");
    expect(back?.range).toEqual({ from: shiftDayKey(today, -1), to: shiftDayKey(today, -1) });
    const twice = stepRange("kemarin", back!.range, -1);
    expect(twice?.preset).toBe("tanggal");
    expect(stepRange("kemarin", back!.range, 1)?.preset).toBe("hari-ini");
  });

  it("tidak bisa melewati hari ini", () => {
    expect(stepRange("hari-ini", presetRange("hari-ini"), 1)).toBeNull();
    expect(stepRange("bulan-ini", monthDays(thisMonthKey()), 1)).toBeNull();
  });

  it("7 hari bergeser 7 hari", () => {
    const today = todayKey();
    const back = stepRange("7-hari", presetRange("7-hari"), -1);
    expect(back?.range).toEqual({ from: shiftDayKey(today, -13), to: shiftDayKey(today, -7) });
    expect(stepRange("tanggal", back!.range, 1)?.preset).toBe("7-hari");
  });

  it("bulan bergeser per bulan", () => {
    const back = stepRange("bulan-ini", monthDays(thisMonthKey()), -1);
    expect(back?.preset).toBe("bulan-lalu");
    const lastMonth = shiftDayKey(`${thisMonthKey()}-01`, -1).slice(0, 7);
    expect(back?.month).toBe(lastMonth);
    expect(back?.range.from).toBe(`${lastMonth}-01`);
    expect(stepRange("bulan", { from: "2026-01-01", to: "2026-01-31" }, -1)?.range).toEqual({
      from: "2025-12-01",
      to: "2025-12-31",
    });
  });
});
