import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { KonterRepository } from "../src/data/repository";
import { buildServiceReceipt } from "../src/printing/receipt";
import { receiptToText } from "../src/printing/escpos";
import { serviceReceiptText } from "../src/ui/receipts";
import { createSqlJsDriver } from "./support/sqljs-driver";

/** 22 Nov 2026 10:00 WIB. */
const START = Date.UTC(2026, 10, 22, 3, 0);
const DAY = 86_400_000;
const IMEI = "356789012345674";

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

const store = { name: "Konter Uji", address: "", phone: "", footer: "Buka 09.00-21.00" };

async function newOrder() {
  return repo.createServiceOrder({ customerName: "Andi", device: "iPhone 11", imei: IMEI, complaint: "LCD pecah" });
}

describe("garansi service", () => {
  it("garansi dicatat saat selesai dan dihitung sejak HP diambil", async () => {
    const order = await newOrder();
    const finished = await repo.finishService(
      order.id,
      { totalChargeRupiah: 450_000n, partsCostRupiah: 280_000n },
      "LCD OEM",
      { days: 30, note: "Garansi LCD, tidak termasuk jatuh/kena air" },
    );
    expect(finished.warrantyDays).toBe(30);
    expect(finished.warrantyUntil).toBeNull();

    clock = START + 2 * DAY; // diambil 24 Nov
    const picked = await repo.pickUpService(order.id, "tunai");
    expect(picked.warrantyUntil).toBe("2026-12-24");
    expect(picked.warrantyNote).toBe("Garansi LCD, tidak termasuk jatuh/kena air");

    const printed = receiptToText(buildServiceReceipt({ store, paper: 58, order: picked }), 32);
    expect(printed).toContain("GARANSI 1 BULAN");
    expect(printed).toContain("Berlaku s/d 24 Des 2026");
    expect(serviceReceiptText(picked, store)).toContain("*Garansi 1 bulan* s/d Kamis, 24 Desember 2026");

    expect((await repo.listActiveWarranties("2026-12-24")).map((o) => o.id)).toEqual([order.id]);
    expect(await repo.listActiveWarranties("2026-12-25")).toEqual([]);
    expect((await repo.findServicesByImei(IMEI))[0]?.warrantyUntil).toBe("2026-12-24");
  });

  it("garansi bisa diubah saat diserahkan; batal tidak bergaransi", async () => {
    const order = await newOrder();
    await repo.finishService(order.id, { totalChargeRupiah: 100_000n, partsCostRupiah: 0n }, null, { days: 7 });
    const picked = await repo.pickUpService(order.id, "qris", { days: 14, note: "Ganti konektor" });
    expect(picked.warrantyDays).toBe(14);
    expect(picked.warrantyUntil).toBe("2026-12-06");

    const other = await newOrder();
    await repo.cancelService(other.id, { totalChargeRupiah: 0n, partsCostRupiah: 0n });
    const returned = await repo.pickUpService(other.id, "tunai", { days: 30 });
    expect(returned.warrantyDays).toBe(0);
    expect(returned.warrantyUntil).toBeNull();
  });

  it("tanpa garansi tidak mencetak garansi; pesan toko tetap ada", async () => {
    const order = await newOrder();
    await repo.finishService(order.id, { totalChargeRupiah: 50_000n, partsCostRupiah: 0n }, null, { days: 0, note: "abaikan" });
    const picked = await repo.pickUpService(order.id);
    expect(picked.warrantyNote).toBeNull();
    const printed = receiptToText(buildServiceReceipt({ store, paper: 58, order: picked }), 32);
    expect(printed).not.toContain("GARANSI");
    expect(printed).toContain("Buka 09.00-21.00");
  });

  it("menolak masa garansi di luar 0-365 hari", async () => {
    const order = await newOrder();
    await expect(
      repo.finishService(order.id, { totalChargeRupiah: 1n, partsCostRupiah: 0n }, null, { days: 400 }),
    ).rejects.toThrow("Masa garansi");
  });
});
