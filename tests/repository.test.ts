import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DomainError } from "../src/domain/errors";
import type { PhoneIntakeInput } from "../src/domain/phones";
import { readSchemaVersion } from "../src/data/migrations";
import { KonterRepository } from "../src/data/repository";
import {
  SCHEMA_VERSION,
  SCHEMA_VERSION_1_STATEMENTS,
  SCHEMA_VERSION_2_STATEMENTS,
  SCHEMA_VERSION_3_STATEMENTS,
} from "../src/data/schema";
import { createSqlJsDriver } from "./support/sqljs-driver";

/** 22 Nov 2026 10:00 WIB. */
const START = Date.UTC(2026, 10, 22, 3, 0);
const HOUR = 3_600_000;

let clock = START;
let close: () => void = () => undefined;
let repo: KonterRepository;

beforeEach(async () => {
  clock = START;
  let counter = 0;
  const opened = await createSqlJsDriver();
  close = opened.close;
  repo = new KonterRepository(opened.driver, {
    now: () => clock,
    newId: () => `id-${++counter}`,
  });
  await repo.initialize();
});

afterEach(() => close());

function phone(overrides: Partial<PhoneIntakeInput> = {}): PhoneIntakeInput {
  return {
    brand: "Samsung",
    model: "Galaxy A15",
    variant: "8/256",
    imei1: "352099001761481",
    condition: "baru",
    costRupiah: 2_600_000n,
    ...overrides,
  };
}

describe("database", () => {
  it("menjalankan migrasi sampai versi terbaru", async () => {
    const opened = await createSqlJsDriver();
    const fresh = new KonterRepository(opened.driver);
    await fresh.initialize();
    await fresh.initialize(); // aman dijalankan dua kali
    expect(await readSchemaVersion(opened.driver)).toBe(SCHEMA_VERSION);
    opened.close();
  });
});

describe("stok HP", () => {
  it("mencatat HP masuk dan menolak IMEI ganda di stok", async () => {
    const unit = await repo.addPhone(phone({ sourceParty: "Sales Erafone" }));
    expect(unit.status).toBe("stok");
    expect(unit.source).toBe("supplier");
    expect(unit.displayName).toBe("Samsung Galaxy A15 8/256");

    await expect(repo.addPhone(phone())).rejects.toThrow("sudah ada di stok");
    // IMEI 2 yang bentrok dengan IMEI 1 unit lain juga ditolak
    await expect(
      repo.addPhone(phone({ imei1: "490154203237518", imei2: "352099001761481" })),
    ).rejects.toThrow("sudah ada di stok");
  });

  it("membatalkan HP masuk yang salah catat", async () => {
    const unit = await repo.addPhone(phone(), "beli_pelanggan");
    await repo.cancelPhoneIntake(unit.id);
    expect(await repo.listPhonesInStock()).toHaveLength(0);
    // IMEI yang sama boleh dicatat ulang dengan benar
    await repo.addPhone(phone({ costRupiah: 2_500_000n }), "beli_pelanggan");
    expect(await repo.listPhonesInStock()).toHaveLength(1);
  });
});

describe("penjualan", () => {
  it("menjual HP + aksesoris dan menghitung untung per baris", async () => {
    const unit = await repo.addPhone(phone());
    const glass = await repo.addAccessory({
      name: "Tempered glass A15",
      costRupiah: 8_000n,
      priceRupiah: 25_000n,
      initialStock: 10n,
    });

    const sale = await repo.recordSale({
      lines: [
        { kind: "hp", phoneUnitId: unit.id, priceRupiah: 3_000_000n },
        { kind: "aksesoris", accessoryId: glass.id, quantity: 2n },
      ],
      paymentMethod: "tunai",
      customerName: "Budi",
      customerPhone: "0812 3456 7890",
    });

    expect(sale.number).toBe("J-20261122-001");
    expect(sale.customerPhone).toBe("6281234567890");
    expect(sale.summary.itemsTotalRupiah).toBe(3_050_000n);
    expect(sale.summary.profitRupiah).toBe(434_000n);
    expect((await repo.getPhone(unit.id))?.status).toBe("terjual");
    expect((await repo.listAccessories())[0]?.stockQuantity).toBe(8n);
  });

  it("membekukan harga modal: ubah harga setelah jual tidak mengubah laporan", async () => {
    const glass = await repo.addAccessory({
      name: "Casing",
      costRupiah: 10_000n,
      priceRupiah: 35_000n,
      initialStock: 5n,
    });
    await repo.recordSale({
      lines: [{ kind: "aksesoris", accessoryId: glass.id, quantity: 1n }],
      paymentMethod: "qris",
    });
    await repo.restockAccessory(glass.id, 10n, 15_000n, "Shopee");
    await repo.updateAccessoryPrice(glass.id, 40_000n);

    const today = await repo.dayProfit("2026-11-22");
    expect(today.byLine.aksesoris.profitRupiah).toBe(25_000n);
    const updated = (await repo.listAccessories())[0];
    expect(updated?.costRupiah).toBe(15_000n);
    expect(updated?.stockQuantity).toBe(14n);
  });

  it("menolak jual melebihi stok aksesoris dan HP yang sudah terjual", async () => {
    const charger = await repo.addAccessory({
      name: "Charger",
      costRupiah: 30_000n,
      priceRupiah: 60_000n,
      initialStock: 1n,
    });
    await expect(
      repo.recordSale({
        lines: [
          { kind: "aksesoris", accessoryId: charger.id, quantity: 1n },
          { kind: "aksesoris", accessoryId: charger.id, quantity: 1n },
        ],
        paymentMethod: "tunai",
      }),
    ).rejects.toThrow("Stok Charger tinggal 1");

    const unit = await repo.addPhone(phone());
    await repo.recordSale({
      lines: [{ kind: "hp", phoneUnitId: unit.id, priceRupiah: 3_000_000n }],
      paymentMethod: "tunai",
    });
    await expect(
      repo.recordSale({
        lines: [{ kind: "hp", phoneUnitId: unit.id, priceRupiah: 3_000_000n }],
        paymentMethod: "tunai",
      }),
    ).rejects.toThrow("tidak ada di stok");
  });

  it("tukar tambah: HP lama masuk stok, untungnya dihitung saat dijual lagi", async () => {
    const newPhone = await repo.addPhone(phone());
    const sale = await repo.recordSale({
      lines: [{ kind: "hp", phoneUnitId: newPhone.id, priceRupiah: 3_000_000n }],
      tradeIn: {
        brand: "Xiaomi",
        model: "Redmi Note 10",
        imei1: "490154203237518",
        condition: "bekas",
        completeness: "Unit + charger",
        creditRupiah: 1_000_000n,
      },
      paymentMethod: "transfer",
      customerName: "Sari",
    });

    expect(sale.summary.amountDueRupiah).toBe(2_000_000n);
    expect(sale.summary.profitRupiah).toBe(400_000n);
    const tradeIn = sale.tradeInPhone;
    expect(tradeIn?.source).toBe("tukar_tambah");
    expect(tradeIn?.costRupiah).toBe(1_000_000n);
    expect(tradeIn?.sourceParty).toBe("Sari");
    expect(tradeIn?.status).toBe("stok");

    clock += 24 * HOUR;
    await repo.recordSale({
      lines: [{ kind: "hp", phoneUnitId: tradeIn!.id, priceRupiah: 1_350_000n }],
      paymentMethod: "tunai",
    });
    const profits = await repo.phoneProfits({ startMs: START - HOUR, endMs: clock + HOUR });
    expect(profits.map((row) => row.profitRupiah)).toEqual([350_000n, 400_000n]);
    expect(profits[0]?.source).toBe("tukar_tambah");
  });

  it("membatalkan nota: stok kembali dan untung hilang dari laporan", async () => {
    const unit = await repo.addPhone(phone());
    const casing = await repo.addAccessory({
      name: "Casing",
      costRupiah: 10_000n,
      priceRupiah: 35_000n,
      initialStock: 3n,
    });
    const sale = await repo.recordSale({
      lines: [
        { kind: "hp", phoneUnitId: unit.id, priceRupiah: 3_000_000n },
        { kind: "aksesoris", accessoryId: casing.id, quantity: 1n },
      ],
      tradeIn: {
        brand: "Oppo",
        model: "A57",
        imei1: "490154203237518",
        condition: "bekas",
        creditRupiah: 800_000n,
      },
      paymentMethod: "tunai",
    });

    const voided = await repo.voidSale(sale.id, "Salah input harga");
    expect(voided.voidedAtMs).toBe(clock);
    expect((await repo.getPhone(unit.id))?.status).toBe("stok");
    expect((await repo.getPhone(sale.tradeInPhone!.id))?.status).toBe("dibatalkan");
    expect((await repo.listAccessories())[0]?.stockQuantity).toBe(3n);
    expect((await repo.dayProfit("2026-11-22")).total.profitRupiah).toBe(0n);
    await expect(repo.voidSale(sale.id, "lagi")).rejects.toThrow("sudah dibatalkan");
  });

  it("tidak bisa membatalkan nota kalau HP tukar tambahnya sudah terjual", async () => {
    const unit = await repo.addPhone(phone());
    const sale = await repo.recordSale({
      lines: [{ kind: "hp", phoneUnitId: unit.id, priceRupiah: 3_000_000n }],
      tradeIn: {
        brand: "Oppo",
        model: "A57",
        imei1: "490154203237518",
        condition: "bekas",
        creditRupiah: 800_000n,
      },
      paymentMethod: "tunai",
    });
    await repo.recordSale({
      lines: [{ kind: "hp", phoneUnitId: sale.tradeInPhone!.id, priceRupiah: 1_000_000n }],
      paymentMethod: "tunai",
    });
    await expect(repo.voidSale(sale.id, "batal")).rejects.toThrow("sudah terjual");
  });

  it("menomori nota per hari WIB", async () => {
    const charger = await repo.addAccessory({
      name: "Charger",
      costRupiah: 30_000n,
      priceRupiah: 60_000n,
      initialStock: 5n,
    });
    const sell = () =>
      repo.recordSale({
        lines: [{ kind: "aksesoris", accessoryId: charger.id, quantity: 1n }],
        paymentMethod: "tunai",
      });
    expect((await sell()).number).toBe("J-20261122-001");
    expect((await sell()).number).toBe("J-20261122-002");
    clock = Date.UTC(2026, 10, 22, 17, 5); // 23 Nov 00:05 WIB
    expect((await sell()).number).toBe("J-20261123-001");
  });

  it("mencari riwayat HP lewat IMEI", async () => {
    const unit = await repo.addPhone(phone({ imei2: "490154203237518" }));
    await repo.recordSale({
      lines: [{ kind: "hp", phoneUnitId: unit.id, priceRupiah: 3_000_000n }],
      paymentMethod: "tunai",
    });
    clock += HOUR;
    await repo.addPhone(phone({ condition: "bekas", costRupiah: 2_000_000n }), "beli_pelanggan");
    const history = await repo.findPhonesByImei("3520 9900 1761 481");
    expect(history.map((item) => item.status)).toEqual(["stok", "terjual"]);
    expect(await repo.findPhonesByImei("490154203237518")).toHaveLength(1);
  });
});

describe("service", () => {
  it("alur service lengkap sampai diambil, untung masuk di hari diambil", async () => {
    const order = await repo.createServiceOrder({
      customerName: "Andi",
      customerPhone: "081234567890",
      device: "iPhone 11",
      complaint: "LCD pecah",
      completeness: "Unit saja",
      unlockCode: "123456",
      estimateRupiah: 500_000n,
      depositRupiah: 100_000n,
    });
    expect(order.number).toBe("S-20261122-001");
    expect(order.status).toBe("proses");
    expect(order.profitRupiah).toBeNull();

    await expect(repo.pickUpService(order.id)).rejects.toThrow(DomainError);

    const finished = await repo.finishService(
      order.id,
      { totalChargeRupiah: 450_000n, partsCostRupiah: 280_000n },
      "LCD OEM + ongkir Shopee",
    );
    expect(finished.status).toBe("selesai");
    expect(finished.profitRupiah).toBe(170_000n);
    expect(finished.balanceDueRupiah).toBe(350_000n);
    expect(await repo.listOpenServices()).toHaveLength(1);

    // Belum diambil = belum masuk laporan
    expect((await repo.dayProfit("2026-11-22")).byLine.service.count).toBe(0n);

    clock += 24 * HOUR;
    const pickedUp = await repo.pickUpService(order.id);
    expect(pickedUp.status).toBe("diambil");
    expect(await repo.listOpenServices()).toHaveLength(0);
    const report = await repo.dayProfit("2026-11-23");
    expect(report.byLine.service.revenueRupiah).toBe(450_000n);
    expect(report.byLine.service.profitRupiah).toBe(170_000n);
  });

  it("service batal: biaya cek masuk, sparepart yang terlanjur dibeli jadi rugi", async () => {
    const order = await repo.createServiceOrder({
      customerName: "Rina",
      device: "Vivo Y21",
      complaint: "Mati total",
    });
    await repo.cancelService(order.id, { totalChargeRupiah: 25_000n, partsCostRupiah: 60_000n });
    const reopened = await repo.reopenService(order.id);
    expect(reopened.status).toBe("proses");
    await repo.cancelService(order.id, { totalChargeRupiah: 25_000n, partsCostRupiah: 60_000n });
    await repo.pickUpService(order.id);
    const report = await repo.dayProfit("2026-11-22");
    expect(report.byLine.service.profitRupiah).toBe(-35_000n);
  });
});

describe("laporan", () => {
  it("menggabungkan untung harian dalam sebulan per lini", async () => {
    const unit = await repo.addPhone(phone());
    const glass = await repo.addAccessory({
      name: "Tempered glass",
      costRupiah: 8_000n,
      priceRupiah: 25_000n,
      initialStock: 10n,
    });
    await repo.recordSale({
      lines: [{ kind: "hp", phoneUnitId: unit.id, priceRupiah: 2_900_000n }],
      paymentMethod: "tunai",
    });
    clock += 2 * 24 * HOUR; // 24 Nov
    await repo.recordSale({
      lines: [{ kind: "aksesoris", accessoryId: glass.id, quantity: 3n }],
      paymentMethod: "tunai",
    });
    const service = await repo.createServiceOrder({
      customerName: "Dodi",
      device: "Oppo A5",
      complaint: "Ganti baterai",
    });
    await repo.finishService(service.id, { totalChargeRupiah: 200_000n, partsCostRupiah: 110_000n });
    await repo.pickUpService(service.id);

    const days = await repo.dailyProfit("2026-11");
    expect(days).toHaveLength(30);
    expect(days.find((day) => day.day === "2026-11-22")?.totals.profitRupiah).toBe(300_000n);
    expect(days.find((day) => day.day === "2026-11-23")?.totals.count).toBe(0n);
    expect(days.find((day) => day.day === "2026-11-24")?.totals.profitRupiah).toBe(141_000n);

    const month = await repo.monthProfit("2026-11");
    expect(month.byLine.hp.profitRupiah).toBe(300_000n);
    expect(month.byLine.aksesoris.profitRupiah).toBe(51_000n);
    expect(month.byLine.service.profitRupiah).toBe(90_000n);
    expect(month.total.profitRupiah).toBe(441_000n);
    expect((await repo.monthProfit("2026-12")).total.count).toBe(0n);
  });
});

describe("foto produk", () => {
  const jpeg = (tag: string) => ({
    thumbDataUrl: `data:image/jpeg;base64,thumb-${tag}`,
    fullDataUrl: `data:image/jpeg;base64,full-${tag}`,
  });

  it("HP boleh sampai 5 foto berurutan; thumbnail sampul = foto pertama", async () => {
    const unit = await repo.addPhone(phone());
    const owner = { type: "phone" as const, id: unit.id };
    for (const tag of ["a", "b", "c", "d", "e"]) {
      await repo.addPhoto(owner, jpeg(tag));
    }
    await expect(repo.addPhoto(owner, jpeg("f"))).rejects.toThrow("Maksimal 5 foto");
    const photos = await repo.listPhotos(owner);
    expect(photos.map((photo) => photo.fullDataUrl.slice(-1))).toEqual(["a", "b", "c", "d", "e"]);

    await repo.deletePhoto(photos[0]!.id);
    expect((await repo.coverThumbnails("phone")).get(unit.id)).toBe("data:image/jpeg;base64,thumb-b");
    await repo.addPhoto(owner, jpeg("f"));
    expect((await repo.listPhotos(owner)).at(-1)?.fullDataUrl).toBe("data:image/jpeg;base64,full-f");
  });

  it("aksesoris satu foto: foto baru menggantikan yang lama", async () => {
    const item = await repo.addAccessory({ name: "Casing", costRupiah: 10_000n, priceRupiah: 35_000n });
    const owner = { type: "accessory" as const, id: item.id };
    await repo.addPhoto(owner, jpeg("lama"));
    await repo.addPhoto(owner, jpeg("baru"));
    const photos = await repo.listPhotos(owner);
    expect(photos).toHaveLength(1);
    expect(photos[0]?.thumbDataUrl).toBe("data:image/jpeg;base64,thumb-baru");
  });

  it("menolak format selain JPEG", async () => {
    const unit = await repo.addPhone(phone());
    await expect(
      repo.addPhoto({ type: "phone", id: unit.id }, { thumbDataUrl: "data:image/png;base64,x", fullDataUrl: "data:image/png;base64,x" }),
    ).rejects.toThrow("Format foto");
  });
});

describe("layanan digital", () => {
  it("jual pulsa, perdana, dan transaksi manual dalam satu nota; untung masuk lini Digital", async () => {
    const pulsa = await repo.addDigitalProduct({ name: "Pulsa Telkomsel 10rb", category: "pulsa", costRupiah: 10_250n, priceRupiah: 12_000n });
    const perdana = await repo.addDigitalProduct({ name: "Perdana XL 0K", category: "perdana", costRupiah: 5_000n, priceRupiah: 10_000n, initialStock: 3n });
    expect(pulsa.tracksStock).toBe(false);
    expect(perdana.tracksStock).toBe(true);

    const sale = await repo.recordSale({
      lines: [
        { kind: "digital", digitalProductId: pulsa.id, target: "081234567890", unitPriceRupiah: 12_000n },
        // modal pulsa hari ini naik: boleh diisi saat jual
        { kind: "digital", digitalProductId: pulsa.id, target: "085600001111", unitPriceRupiah: 12_000n, unitCostRupiah: 10_400n },
        { kind: "digital", digitalProductId: perdana.id, quantity: 2n, unitPriceRupiah: 10_000n },
        { kind: "digital", name: "Top up DANA 50rb", target: "081299990000", unitPriceRupiah: 52_000n, unitCostRupiah: 50_500n },
      ],
      paymentMethod: "qris",
    });
    expect(sale.lines.map((line) => line.target)).toEqual(["081234567890", "085600001111", null, "081299990000"]);
    expect(sale.lines[3]?.digitalProductId).toBeNull();
    expect(sale.summary.itemsTotalRupiah).toBe(96_000n);
    // 1.750 + 1.600 + 10.000 + 1.500
    expect(sale.summary.profitRupiah).toBe(14_850n);

    const products = await repo.listDigitalProducts();
    expect(products.find((item) => item.id === perdana.id)?.stockQuantity).toBe(1n);
    expect(products.find((item) => item.id === pulsa.id)?.stockQuantity).toBe(0n);

    const today = await repo.dayProfit("2026-11-22");
    expect(today.byLine.digital.profitRupiah).toBe(14_850n);
    expect(today.byLine.digital.count).toBe(5n);

    await repo.voidSale(sale.id, "Salah input");
    expect((await repo.listDigitalProducts()).find((item) => item.id === perdana.id)?.stockQuantity).toBe(3n);
    expect((await repo.listDigitalProducts()).find((item) => item.id === pulsa.id)?.stockQuantity).toBe(0n);
  });

  it("menolak perdana melebihi stok dan transaksi manual tanpa modal", async () => {
    const perdana = await repo.addDigitalProduct({ name: "Perdana Tri", category: "perdana", costRupiah: 5_000n, priceRupiah: 10_000n, initialStock: 1n });
    await expect(
      repo.recordSale({
        lines: [{ kind: "digital", digitalProductId: perdana.id, quantity: 2n, unitPriceRupiah: 10_000n }],
        paymentMethod: "tunai",
      }),
    ).rejects.toThrow("tinggal 1");
    await expect(
      repo.recordSale({
        lines: [{ kind: "digital", name: "Token PLN 20rb", unitPriceRupiah: 22_500n }],
        paymentMethod: "tunai",
      }),
    ).rejects.toThrow("harga modal");
  });

  it("tambah stok perdana, ubah harga, dan hapus dari daftar", async () => {
    const perdana = await repo.addDigitalProduct({ name: "Perdana IM3", category: "perdana", costRupiah: 5_000n, priceRupiah: 10_000n });
    const restocked = await repo.restockDigitalProduct(perdana.id, 10n, 4_500n);
    expect(restocked.stockQuantity).toBe(10n);
    expect(restocked.costRupiah).toBe(4_500n);
    const updated = await repo.updateDigitalProduct(perdana.id, { name: "Perdana IM3 Freedom", costRupiah: 4_500n, priceRupiah: 12_000n });
    expect(updated.priceRupiah).toBe(12_000n);
    const pulsa = await repo.addDigitalProduct({ name: "Pulsa 5rb", category: "pulsa", costRupiah: 5_200n, priceRupiah: 7_000n });
    await expect(repo.restockDigitalProduct(pulsa.id, 1n, 5_200n)).rejects.toThrow("tidak memakai stok");
    await repo.archiveDigitalProduct(pulsa.id);
    expect((await repo.listDigitalProducts()).map((item) => item.name)).toEqual(["Perdana IM3 Freedom"]);
  });
});

describe("pelunasan service", () => {
  it("mencatat metode bayar saat HP diambil", async () => {
    const order = await repo.createServiceOrder({ customerName: "Andi", device: "iPhone XR", complaint: "LCD", depositRupiah: 100_000n });
    expect(order.paymentMethod).toBeNull();
    await repo.finishService(order.id, { totalChargeRupiah: 600_000n, partsCostRupiah: 380_000n });
    const picked = await repo.pickUpService(order.id, "transfer");
    expect(picked.status).toBe("diambil");
    expect(picked.paymentMethod).toBe("transfer");
  });
});

describe("migrasi v3 ke v4", () => {
  it("menyalin baris nota lama saat tabel sale_lines dibangun ulang", async () => {
    const opened = await createSqlJsDriver();
    const driver = opened.driver;
    const statements = [...SCHEMA_VERSION_1_STATEMENTS, ...SCHEMA_VERSION_2_STATEMENTS, ...SCHEMA_VERSION_3_STATEMENTS];
    for (const statement of statements) await driver.execute(statement);
    await driver.execute("PRAGMA user_version = 3");
    await driver.run(
      `INSERT INTO accessories (id, name, cost_rupiah, price_rupiah, stock_quantity, created_at_ms)
       VALUES ('a1', 'Casing', 10000, 35000, 4, 1)`,
    );
    await driver.run(
      `INSERT INTO sales (id, number, sold_at_ms, items_total_rupiah, payment_method)
       VALUES ('s1', 'J-20261121-001', ${START - 24 * HOUR}, 70000, 'tunai')`,
    );
    await driver.run(
      `INSERT INTO sale_lines (id, sale_id, position, kind, accessory_id, name, quantity, unit_price_rupiah, unit_cost_rupiah)
       VALUES ('l1', 's1', 0, 'aksesoris', 'a1', 'Casing', 2, 35000, 10000)`,
    );
    await driver.run(
      `INSERT INTO service_orders (id, number, received_at_ms, customer_name, device, complaint, status)
       VALUES ('o1', 'S-20261121-001', 1, 'Rina', 'Oppo', 'Baterai', 'proses')`,
    );

    const migrated = new KonterRepository(driver, { now: () => START });
    await migrated.initialize();
    expect(await readSchemaVersion(driver)).toBe(SCHEMA_VERSION);
    const sale = await migrated.getSale("s1");
    expect(sale?.lines).toHaveLength(1);
    expect(sale?.lines[0]?.target).toBeNull();
    expect(sale?.summary.profitRupiah).toBe(50_000n);
    expect((await migrated.getService("o1"))?.paymentMethod).toBeNull();
    // void nota lama tetap mengembalikan stok
    await migrated.voidSale("s1", "uji");
    expect((await migrated.listAccessories())[0]?.stockQuantity).toBe(6n);
    opened.close();
  });
});
