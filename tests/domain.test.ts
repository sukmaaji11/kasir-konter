import { describe, expect, it } from "vitest";
import { DomainError } from "../src/domain/errors";
import { formatRupiah, parseRupiahInput } from "../src/domain/money";
import {
  isImeiChecksumValid,
  normalizeImei,
  phoneDisplayName,
  validatePhoneIntake,
} from "../src/domain/phones";
import { summarizeProfit } from "../src/domain/report";
import { summarizeSale } from "../src/domain/sales";
import { assertServiceTransition, serviceBalanceDue, serviceProfit } from "../src/domain/service";
import { normalizePhoneNumber } from "../src/domain/text";
import {
  daysInJakartaMonth,
  documentNumber,
  jakartaDayKey,
  jakartaDayRange,
  jakartaMonthRange,
} from "../src/domain/time";

describe("uang", () => {
  it("membaca ketikan nominal Indonesia", () => {
    expect(parseRupiahInput("1.500.000")).toBe(1_500_000n);
    expect(parseRupiahInput("Rp 250.000")).toBe(250_000n);
    expect(parseRupiahInput(" 75000 ")).toBe(75_000n);
    expect(() => parseRupiahInput("1,5jt")).toThrow(DomainError);
  });

  it("memformat rupiah tanpa desimal", () => {
    expect(formatRupiah(1_500_000n).replace(/\s/g, " ")).toBe("Rp 1.500.000");
  });
});

describe("waktu Jakarta", () => {
  it("memakai hari WIB, bukan UTC", () => {
    // 22 Nov 2026 23:30 WIB = 22 Nov 16:30 UTC
    expect(jakartaDayKey(Date.UTC(2026, 10, 22, 16, 30))).toBe("2026-11-22");
    // 23 Nov 2026 00:30 WIB = 22 Nov 17:30 UTC
    expect(jakartaDayKey(Date.UTC(2026, 10, 22, 17, 30))).toBe("2026-11-23");
  });

  it("menghitung rentang hari dan bulan", () => {
    const day = jakartaDayRange("2026-11-22");
    expect(day.startMs).toBe(Date.UTC(2026, 10, 21, 17));
    expect(day.endMs - day.startMs).toBe(86_400_000);
    const month = jakartaMonthRange("2026-12");
    expect(month.startMs).toBe(Date.UTC(2026, 10, 30, 17));
    expect(month.endMs).toBe(Date.UTC(2026, 11, 31, 17));
    expect(daysInJakartaMonth("2026-02")).toHaveLength(28);
    expect(() => jakartaDayRange("2026-02-30")).toThrow(DomainError);
    expect(() => jakartaMonthRange("2026-13")).toThrow(DomainError);
  });

  it("membuat nomor nota harian", () => {
    expect(documentNumber("J", Date.UTC(2026, 10, 22, 3), 7)).toBe("J-20261122-007");
  });
});

describe("HP", () => {
  it("merapikan dan memvalidasi IMEI", () => {
    expect(normalizeImei("35 209900 176148 1")).toBe("352099001761481");
    expect(() => normalizeImei("12345")).toThrow(DomainError);
    expect(isImeiChecksumValid("352099001761481")).toBe(true);
    expect(isImeiChecksumValid("352099001761482")).toBe(false);
  });

  it("memvalidasi data HP masuk", () => {
    const intake = validatePhoneIntake({
      brand: " Samsung ",
      model: "Galaxy  A15",
      variant: "8/256",
      color: "",
      imei1: "352099001761481",
      imei2: null,
      condition: "bekas",
      costRupiah: 1_800_000n,
    });
    expect(intake.brand).toBe("Samsung");
    expect(intake.model).toBe("Galaxy A15");
    expect(intake.color).toBeNull();
    expect(phoneDisplayName(intake)).toBe("Samsung Galaxy A15 8/256");

    expect(() =>
      validatePhoneIntake({ ...intake, imei2: intake.imei1 }),
    ).toThrow("IMEI 2 tidak boleh sama");
    expect(() => validatePhoneIntake({ ...intake, costRupiah: -1n })).toThrow(DomainError);
    expect(() => validatePhoneIntake({ ...intake, brand: "  " })).toThrow("Merek wajib diisi");
  });
});

describe("penjualan", () => {
  it("menghitung untung tanpa terpengaruh potongan tukar tambah", () => {
    const summary = summarizeSale(
      [
        { kind: "hp", name: "HP baru", quantity: 1n, unitPriceRupiah: 3_000_000n, unitCostRupiah: 2_600_000n },
        { kind: "aksesoris", name: "Tempered glass", quantity: 2n, unitPriceRupiah: 25_000n, unitCostRupiah: 8_000n },
      ],
      1_000_000n,
    );
    expect(summary.itemsTotalRupiah).toBe(3_050_000n);
    expect(summary.amountDueRupiah).toBe(2_050_000n);
    expect(summary.costRupiah).toBe(2_616_000n);
    expect(summary.profitRupiah).toBe(434_000n);
  });

  it("mengizinkan konter membayar selisih tukar tambah", () => {
    const summary = summarizeSale(
      [{ kind: "hp", name: "HP", quantity: 1n, unitPriceRupiah: 1_000_000n, unitCostRupiah: 900_000n }],
      1_200_000n,
    );
    expect(summary.amountDueRupiah).toBe(-200_000n);
  });
});

describe("service", () => {
  it("membatasi perubahan status", () => {
    expect(() => assertServiceTransition("proses", "selesai")).not.toThrow();
    expect(() => assertServiceTransition("selesai", "diambil")).not.toThrow();
    expect(() => assertServiceTransition("batal", "proses")).not.toThrow();
    expect(() => assertServiceTransition("proses", "diambil")).toThrow(DomainError);
    expect(() => assertServiceTransition("diambil", "proses")).toThrow(DomainError);
  });

  it("menghitung untung dan sisa bayar", () => {
    expect(serviceProfit({ totalChargeRupiah: 450_000n, partsCostRupiah: 280_000n })).toBe(170_000n);
    expect(serviceBalanceDue(450_000n, 100_000n)).toBe(350_000n);
  });
});

describe("laporan", () => {
  it("memisahkan untung per lini", () => {
    const summary = summarizeProfit([
      { line: "hp", atMs: 0, revenueRupiah: 3_000_000n, costRupiah: 2_600_000n, count: 1n },
      { line: "aksesoris", atMs: 0, revenueRupiah: 50_000n, costRupiah: 16_000n, count: 2n },
      { line: "service", atMs: 0, revenueRupiah: 450_000n, costRupiah: 280_000n, count: 1n },
    ]);
    expect(summary.byLine.hp.profitRupiah).toBe(400_000n);
    expect(summary.byLine.aksesoris.count).toBe(2n);
    expect(summary.byLine.service.profitRupiah).toBe(170_000n);
    expect(summary.total.profitRupiah).toBe(604_000n);
  });
});

describe("teks", () => {
  it("merapikan nomor WA pelanggan", () => {
    expect(normalizePhoneNumber("0812-3456-7890")).toBe("6281234567890");
    expect(normalizePhoneNumber("+62 812 3456 7890")).toBe("6281234567890");
    expect(normalizePhoneNumber("")).toBeNull();
    expect(() => normalizePhoneNumber("123")).toThrow(DomainError);
  });
});
