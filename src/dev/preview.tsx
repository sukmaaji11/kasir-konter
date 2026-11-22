/**
 * Pratinjau khusus pengembangan (npm run dev → /preview.html?tab=kasir&role=owner).
 * Database di memori berisi data contoh dan langsung masuk tanpa aktivasi.
 * Tidak ikut build produksi: Vite hanya membangun index.html.
 */
import { createRoot } from "react-dom/client";
import { AuthApplicationService } from "../application/auth";
import { LicenseApplicationService } from "../application/license";
import { openBrowserDevRepository } from "../data/browser-dev-repository";
import type { KonterRepository } from "../data/repository";
import { LICENSE_PUBLIC_KEY } from "../licensing/public-key";
import { MainApp, type Tab } from "../ui/App";

const HOUR = 3_600_000;

async function seed(repo: KonterRepository, setClock: (ms: number) => void): Promise<void> {
  const now = Date.now();
  setClock(now - 6 * 24 * HOUR);
  await repo.setSetting(
    "store.profile",
    JSON.stringify({
      name: "Konter Maju Jaya",
      address: "Jl. Pahlawan No. 12",
      phone: "081234567890",
      footer: "Garansi toko 7 hari (segel tidak rusak)",
    }),
  );
  const a15 = await repo.addPhone({ brand: "Samsung", model: "Galaxy A15", variant: "8/256", color: "Hitam", imei1: "352099001761481", condition: "baru", costRupiah: 2_600_000n, plannedPriceRupiah: 2_999_000n, sourceParty: "Sales Erafone" });
  await repo.addPhone({ brand: "Xiaomi", model: "Redmi 13", variant: "6/128", color: "Biru", imei1: "490154203237518", condition: "baru", costRupiah: 1_650_000n, plannedPriceRupiah: 1_899_000n });
  setClock(now - 3 * 24 * HOUR);
  await repo.addPhone({ brand: "iPhone", model: "11", variant: "64GB", color: "Putih", imei1: "356938035643809", condition: "bekas", costRupiah: 3_200_000n, plannedPriceRupiah: 3_750_000n, completeness: "Unit + charger", note: "BH 82%, lecet tipis" }, "beli_pelanggan");
  await repo.addPhone({ brand: "Oppo", model: "A18", variant: "4/128", imei1: "861536030196001", condition: "baru", costRupiah: 1_350_000n, plannedPriceRupiah: 1_599_000n });
  const glass = await repo.addAccessory({ name: "Tempered glass Samsung A15", category: "Tempered glass", costRupiah: 8_000n, priceRupiah: 25_000n, initialStock: 12n });
  const casing = await repo.addAccessory({ name: "Casing bening A15", category: "Casing", costRupiah: 10_000n, priceRupiah: 35_000n, initialStock: 2n });
  await repo.addAccessory({ name: "Charger 33W Type-C", category: "Charger", costRupiah: 45_000n, priceRupiah: 85_000n, initialStock: 6n });
  await repo.addAccessory({ name: "Kabel data Type-C 1m", category: "Kabel data", costRupiah: 12_000n, priceRupiah: 30_000n, initialStock: 15n });

  setClock(now - 2 * HOUR);
  await repo.recordSale({
    lines: [
      { kind: "hp", phoneUnitId: a15.id, priceRupiah: 2_950_000n },
      { kind: "aksesoris", accessoryId: glass.id, quantity: 1n },
      { kind: "aksesoris", accessoryId: casing.id, quantity: 1n },
    ],
    tradeIn: { brand: "Vivo", model: "Y21", variant: "4/64", imei1: "359881234567897", condition: "bekas", completeness: "Unit saja", creditRupiah: 700_000n },
    paymentMethod: "tunai",
    customerName: "Budi",
    customerPhone: "081298765432",
  });
  const lcd = await repo.createServiceOrder({ customerName: "Andi", customerPhone: "081311112222", device: "iPhone XR merah", complaint: "LCD pecah, touchscreen tidak respon", completeness: "Unit + SIM", unlockCode: "1379", estimateRupiah: 650_000n, depositRupiah: 100_000n });
  await repo.finishService(lcd.id, { totalChargeRupiah: 600_000n, partsCostRupiah: 380_000n }, "LCD OEM Shopee + ongkir");
  const battery = await repo.createServiceOrder({ customerName: "Rina", device: "Oppo A5 2020", complaint: "Baterai cepat habis", estimateRupiah: 200_000n });
  await repo.finishService(battery.id, { totalChargeRupiah: 200_000n, partsCostRupiah: 95_000n });
  await repo.pickUpService(battery.id);
  setClock(now - HOUR);
  await repo.createServiceOrder({ customerName: "Dodi", customerPhone: "085712345678", device: "Redmi Note 9", complaint: "Mati total setelah jatuh ke air" });
  setClock(now);

  // Foto contoh (digambar di canvas) supaya tampilan kotak produk terlihat nyata.
  const phones = await repo.listPhonesInStock();
  const colors = ["#2f6db5", "#c0392b", "#16a085", "#8e44ad", "#d68910"];
  for (const [index, unit] of phones.entries()) {
    if (index === 1) continue; // satu HP tanpa foto: menampilkan ikon pengganti
    for (let shot = 0; shot < (index === 0 ? 3 : 1); shot += 1) {
      await repo.addPhoto({ type: "phone", id: unit.id }, samplePhoto(colors[(index + shot) % colors.length]!, unit.model));
    }
  }
  const accessories = await repo.listAccessories();
  for (const [index, item] of accessories.entries()) {
    if (index % 2 === 0) await repo.addPhoto({ type: "accessory", id: item.id }, samplePhoto("#5d6d7e", item.category ?? "Aksesoris"));
  }
}

function samplePhoto(color: string, label: string) {
  const draw = (size: number) => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const c = canvas.getContext("2d")!;
    c.fillStyle = "#f1f3f6";
    c.fillRect(0, 0, size, size);
    c.fillStyle = color;
    c.beginPath();
    c.roundRect(size * 0.3, size * 0.12, size * 0.4, size * 0.76, size * 0.06);
    c.fill();
    c.fillStyle = "rgba(255,255,255,0.85)";
    c.font = `bold ${Math.round(size * 0.07)}px sans-serif`;
    c.textAlign = "center";
    c.fillText(label.slice(0, 12), size / 2, size * 0.52);
    return canvas.toDataURL("image/jpeg", 0.8);
  };
  return { thumbDataUrl: draw(200), fullDataUrl: draw(600) };
}

async function start() {
  const params = new URLSearchParams(location.search);
  const tab = (params.get("tab") ?? "beranda") as Tab;
  // Jam bisa dimundurkan saat mengisi data contoh, lalu kembali ke jam asli.
  let fakeClock: number | null = null;
  const opened = await openBrowserDevRepository({ now: () => fakeClock ?? Date.now() });
  const repo = opened.repository;
  await seed(repo, (ms) => {
    fakeClock = ms;
  });
  fakeClock = null;
  const auth = new AuthApplicationService(repo);
  const owner = await auth.createInitialOwner("Pak Joko", "246810");
  const staff = await auth.addStaff(owner, "Rudi", "135791");
  const user = params.get("role") === "staff" ? staff : owner;
  const runtime = {
    repo,
    auth,
    license: new LicenseApplicationService(repo, async () => "preview", LICENSE_PUBLIC_KEY),
    isBrowserDevelopment: false,
  };
  createRoot(document.getElementById("root")!).render(
    <MainApp runtime={runtime} user={user} lock={() => location.reload()} initialTab={tab} />,
  );
}

void start();
