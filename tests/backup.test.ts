import { describe, expect, it } from "vitest";
import { BackupService } from "../src/application/backup";
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

async function openRepo(prefix: string) {
  let counter = 0;
  const opened = await createSqlJsDriver();
  const repo = new KonterRepository(opened.driver, { now: () => START, newId: () => `${prefix}-${++counter}` });
  await repo.initialize();
  return { repo, driver: opened.driver, close: opened.close };
}

async function fillOldPhone(repo: KonterRepository) {
  await repo.setSetting("store.profile", JSON.stringify({ name: "Konter Lama", address: "", phone: "", footer: "" }));
  await repo.setSetting("license.activationCode", "KODE-HP-LAMA");
  await repo.setSetting("printer.settings", JSON.stringify({ printerAddress: "AA:BB" }));
  const phone = await repo.addPhone({
    brand: "Samsung",
    model: "Galaxy A15",
    variant: "8/256",
    imei1: "356789012345674",
    condition: "baru",
    costRupiah: 2_500_000n,
  });
  const accessory = await repo.addAccessory({ name: "Casing", costRupiah: 10_000n, priceRupiah: 35_000n, initialStock: 5n });
  await repo.recordSale({
    lines: [
      { kind: "hp", phoneUnitId: phone.id, priceRupiah: 2_900_000n },
      { kind: "aksesoris", accessoryId: accessory.id, quantity: 1n, unitPriceRupiah: 35_000n },
    ],
    paymentMethod: "tunai",
  });
  const order = await repo.createServiceOrder({ customerName: "Andi", device: "iPhone 11", complaint: "LCD" });
  await repo.finishService(order.id, { totalChargeRupiah: 450_000n, partsCostRupiah: 280_000n }, null, { days: 30 });
  await repo.pickUpService(order.id, "transfer");
}

describe("cadangan & pindah HP", () => {
  it("memindahkan semua data ke HP baru tanpa menimpa lisensi & printer HP baru", async () => {
    const oldPhone = await openRepo("lama");
    await fillOldPhone(oldPhone.repo);
    const created = await new BackupService(oldPhone.repo, "Kasir Konter", undefined, () => new Date(START)).createBackup();
    expect(created.fileName).toMatch(/^kasir-konter-cadangan-2026-11-22-1000\.json$/);
    expect(created.content).not.toContain("KODE-HP-LAMA");

    const newPhone = await openRepo("baru");
    await newPhone.repo.setSetting("license.activationCode", "KODE-HP-BARU");
    await newPhone.repo.setSetting("printer.settings", JSON.stringify({ printerAddress: "CC:DD" }));
    const safety: string[] = [];
    const service = new BackupService(newPhone.repo, "Kasir Konter", async (content) => void safety.push(content));
    const prepared = await service.inspect(created.content);
    expect(prepared.preview).toMatchObject({
      storeName: "Konter Lama",
      phonesInStock: 0,
      sales: 1,
      services: 1,
      accessories: 1,
    });
    await service.restore(prepared);

    expect(safety).toHaveLength(1);
    expect(await newPhone.repo.getSetting("license.activationCode")).toBe("KODE-HP-BARU");
    expect(await newPhone.repo.getSetting("printer.settings")).toContain("CC:DD");
    expect(await newPhone.repo.getSetting("store.profile")).toContain("Konter Lama");
    const sales = await newPhone.repo.listSales({ startMs: START - 1, endMs: START + 1 });
    expect(sales).toHaveLength(1);
    expect(sales[0]?.summary.profitRupiah).toBe(425_000n);
    const services = await newPhone.repo.listActiveWarranties("2026-11-22");
    expect(services[0]?.warrantyUntil).toBe("2026-12-22");
    // Data hasil pulihkan tetap bisa dipakai (stok & relasi utuh).
    expect((await newPhone.repo.listAccessories())[0]?.stockQuantity).toBe(4n);
    await newPhone.repo.voidSale(sales[0]!.id, "uji");
    expect((await newPhone.repo.listPhonesInStock())).toHaveLength(1);
    oldPhone.close();
    newPhone.close();
  });

  it("menolak file yang diubah atau terpotong; data tidak berubah", async () => {
    const oldPhone = await openRepo("lama");
    await fillOldPhone(oldPhone.repo);
    const { content } = await new BackupService(oldPhone.repo, "Kasir Konter").createBackup();
    const target = await openRepo("baru");
    const service = new BackupService(target.repo, "Kasir Konter");
    await expect(service.inspect(content.replace("Konter Lama", "Konter Palsu"))).rejects.toThrow("rusak atau terpotong");
    await expect(service.inspect(content.slice(0, content.length / 2))).rejects.toThrow("bukan JSON");
    await expect(service.inspect(JSON.stringify({ hello: 1 }))).rejects.toThrow("bukan file cadangan");
    expect(await target.repo.getSetting("store.profile")).toBeNull();
    oldPhone.close();
    target.close();
  });

  it("tabel yang tidak cocok dibatalkan seluruhnya (transaksi)", async () => {
    const target = await openRepo("baru");
    await target.repo.setSetting("store.profile", "tetap");
    const snapshot = await target.repo.readAllTables();
    const broken = { ...snapshot, tables: { ...snapshot.tables, settings: [{ key: "x", value: "y", extra: 1 }] } };
    await expect(target.repo.replaceAllTables(broken, () => false)).rejects.toThrow("tidak cocok");
    expect(await target.repo.getSetting("store.profile")).toBe("tetap");
    expect(await readSchemaVersion(target.driver)).toBe(SCHEMA_VERSION);
    target.close();
  });

  it("cadangan dari versi aplikasi lama (skema 3) dinaikkan ke skema terbaru", async () => {
    const opened = await createSqlJsDriver();
    for (const statement of [...SCHEMA_VERSION_1_STATEMENTS, ...SCHEMA_VERSION_2_STATEMENTS, ...SCHEMA_VERSION_3_STATEMENTS]) {
      await opened.driver.execute(statement);
    }
    await opened.driver.execute("PRAGMA user_version = 3");
    await opened.driver.run(
      `INSERT INTO service_orders (id, number, received_at_ms, customer_name, device, complaint, status)
       VALUES ('o1', 'S-20261121-001', 1, 'Rina', 'Oppo', 'Baterai', 'proses')`,
    );
    const oldApp = new KonterRepository(opened.driver, { now: () => START });
    const { content } = await new BackupService(oldApp, "Kasir Konter").createBackup();

    const target = await openRepo("baru");
    const service = new BackupService(target.repo, "Kasir Konter");
    await service.restore(await service.inspect(content));
    expect(await readSchemaVersion(target.driver)).toBe(SCHEMA_VERSION);
    const order = await target.repo.getService("o1");
    expect(order?.customerName).toBe("Rina");
    expect(order?.warrantyDays).toBe(0);
    opened.close();
    target.close();
  });
});
