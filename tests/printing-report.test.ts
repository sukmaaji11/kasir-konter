import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadReport } from "../src/application/reports";
import { KonterRepository } from "../src/data/repository";
import { encodeEscPos, receiptToText } from "../src/printing/escpos";
import { buildSaleReceipt, buildServiceReceipt } from "../src/printing/receipt";
import { buildReportPdf } from "../src/reports/report-pdf";
import { createSqlJsDriver } from "./support/sqljs-driver";

/** 22 Nov 2026 10:00 WIB. */
const START = Date.UTC(2026, 10, 22, 3, 0);
const DAY = 86_400_000;
const STORE = { name: "Konter Maju", address: "Jl. Pahlawan 12", phone: "0812", footer: "Garansi toko 7 hari" };

let clock = START;
let close: () => void = () => undefined;
let repo: KonterRepository;

beforeEach(async () => {
  clock = START;
  let counter = 0;
  const opened = await createSqlJsDriver();
  close = opened.close;
  repo = new KonterRepository(opened.driver, { now: () => clock, newId: () => `id-${++counter}` });
  await repo.initialize();
});

afterEach(() => close());

async function seed() {
  const phone = await repo.addPhone({ brand: "Samsung", model: "A15", imei1: "352099001761481", condition: "baru", costRupiah: 2_600_000n });
  const glass = await repo.addAccessory({ name: "Tempered glass", costRupiah: 8_000n, priceRupiah: 25_000n, initialStock: 5n });
  const pulsa = await repo.addDigitalProduct({ name: "Pulsa 10rb", category: "pulsa", costRupiah: 10_250n, priceRupiah: 12_000n });
  const sale = await repo.recordSale({
    lines: [
      { kind: "hp", phoneUnitId: phone.id, priceRupiah: 3_000_000n },
      { kind: "aksesoris", accessoryId: glass.id, quantity: 2n },
      { kind: "digital", digitalProductId: pulsa.id, target: "081234567890", unitPriceRupiah: 12_000n },
    ],
    tradeIn: { brand: "Vivo", model: "Y21", imei1: "359881234567897", condition: "bekas", creditRupiah: 700_000n },
    paymentMethod: "tunai",
    customerName: "Budi",
  });
  clock = START + DAY;
  const order = await repo.createServiceOrder({ customerName: "Andi", device: "iPhone XR", complaint: "LCD", depositRupiah: 100_000n });
  await repo.finishService(order.id, { totalChargeRupiah: 600_000n, partsCostRupiah: 380_000n });
  const picked = await repo.pickUpService(order.id, "qris");
  await repo.recordSale({ lines: [{ kind: "aksesoris", accessoryId: glass.id, quantity: 1n }], paymentMethod: "transfer" });
  return { sale, picked };
}

describe("struk thermal", () => {
  it("nota jual memuat barang, nomor tujuan, tukar tambah, total, dan kembalian", async () => {
    const { sale } = await seed();
    const lines = buildSaleReceipt({
      store: STORE,
      paper: 58,
      sale,
      cashierName: "Rudi",
      cash: { receivedRupiah: 2_400_000n, changeRupiah: 38_000n },
    });
    const text = receiptToText(lines, 32);
    expect(text).toContain("KONTER MAJU");
    expect(text).toContain("ke 081234567890");
    expect(text).toContain("-700.000");
    expect(text).toMatch(/TOTAL\s+Rp2\.362\.000/);
    expect(text).toMatch(/Kembali\s+38\.000/);
    expect(text).toContain("Garansi toko 7 hari");
    for (const row of text.split("\n")) expect(row.length).toBeLessThanOrEqual(32);
    const bytes = encodeEscPos(lines);
    expect([...bytes.slice(0, 2)]).toEqual([0x1b, 0x40]);
  });

  it("nota service lunas memuat DP, pelunasan, dan cara bayar", async () => {
    const { picked } = await seed();
    const text = receiptToText(buildServiceReceipt({ store: STORE, paper: 80, order: picked }), 48);
    expect(text).toContain("NOTA SERVICE");
    expect(text).toMatch(/DP\s+100\.000/);
    expect(text).toMatch(/LUNAS\s+Rp500\.000/);
    expect(text).toMatch(/Bayar\s+QRIS/);
  });
});

describe("laporan rentang tanggal", () => {
  it("menggabungkan dua hari, per cara bayar, dan barang terlaris", async () => {
    await seed();
    const report = await loadReport(repo, { from: "2026-11-22", to: "2026-11-23" });
    expect(report.daily?.map((day) => day.day)).toEqual(["2026-11-22", "2026-11-23"]);
    expect(report.saleCount).toBe(2);
    // 400.000 + 34.000 + 1.750 + 220.000 + 17.000
    expect(report.summary.total.profitRupiah).toBe(672_750n);
    const pay = Object.fromEntries(report.payments.map((item) => [item.method, item.amountRupiah]));
    expect(pay).toEqual({ tunai: 2_362_000n, transfer: 25_000n, qris: 600_000n });
    expect(report.items[0]).toMatchObject({ name: "Tempered glass", quantity: 3n, profitRupiah: 51_000n });

    const oneDay = await loadReport(repo, { from: "2026-11-23", to: "2026-11-23" });
    expect(oneDay.daily).toBeNull();
    expect(oneDay.services).toHaveLength(1);
  });

  it("membuat PDF laporan yang valid", async () => {
    await seed();
    const report = await loadReport(repo, { from: "2026-11-01", to: "2026-11-30" });
    const pdf = buildReportPdf(report, { storeName: "Konter Maju", generatedAtMs: START });
    const text = new TextDecoder("latin1").decode(pdf);
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(text).toContain("LAPORAN UNTUNG KONTER");
    expect(text).toContain("Samsung A15");
  });
});
