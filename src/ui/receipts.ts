import type { SaleRecord, ServiceOrder } from "../data/repository";
import { SERVICE_STATUS_LABELS } from "../domain/service";
import { dateTimeWib, rp } from "./format";

export interface StoreProfile {
  readonly name: string;
  readonly address: string;
  readonly phone: string;
  /** Catatan garansi di bawah nota, mis. "Garansi toko 7 hari". */
  readonly footer: string;
}

export const EMPTY_STORE_PROFILE: StoreProfile = {
  name: "",
  address: "",
  phone: "",
  footer: "",
};

const PAYMENT_LABELS = { tunai: "Tunai", transfer: "Transfer", qris: "QRIS" } as const;

function header(store: StoreProfile): string[] {
  const lines = [`*${store.name.trim() || "Konter HP"}*`];
  if (store.address.trim()) lines.push(store.address.trim());
  if (store.phone.trim()) lines.push(`WA ${store.phone.trim()}`);
  return lines;
}

/** Nota penjualan untuk WhatsApp (tanpa harga modal). */
export function saleReceiptText(sale: SaleRecord, store: StoreProfile): string {
  const lines = [...header(store), "", `Nota ${sale.number}`, dateTimeWib(sale.soldAtMs)];
  if (sale.customerName) lines.push(`Pelanggan: ${sale.customerName}`);
  lines.push("");
  for (const line of sale.lines) {
    const total = line.unitPriceRupiah * line.quantity;
    const name = line.target === null ? line.name : `${line.name} ke ${line.target}`;
    lines.push(
      line.quantity === 1n
        ? `${name}\n  ${rp(total)}`
        : `${name}\n  ${line.quantity} x ${rp(line.unitPriceRupiah)} = ${rp(total)}`,
    );
  }
  lines.push("", `Total: ${rp(sale.summary.itemsTotalRupiah)}`);
  if (sale.tradeInPhone !== null) {
    lines.push(
      `Tukar tambah (${sale.tradeInPhone.displayName}): -${rp(sale.summary.tradeInCreditRupiah)}`,
    );
  }
  const due = sale.summary.amountDueRupiah;
  lines.push(
    due >= 0n ? `*Bayar: ${rp(due)}* (${PAYMENT_LABELS[sale.paymentMethod]})` : `*Dibayar ke pelanggan: ${rp(-due)}*`,
  );
  if (sale.voidedAtMs !== null) lines.push("", "NOTA DIBATALKAN");
  if (store.footer.trim()) lines.push("", store.footer.trim());
  lines.push("", "Terima kasih 🙏");
  return lines.join("\n");
}

/** Tanda terima service (tanpa PIN/pola dan tanpa modal sparepart). */
export function serviceReceiptText(order: ServiceOrder, store: StoreProfile): string {
  const lines = [
    ...header(store),
    "",
    `${order.status === "diambil" ? "Nota service" : "Tanda terima service"} ${order.number}`,
    dateTimeWib(order.receivedAtMs),
    "",
    `Pelanggan: ${order.customerName}`,
    `HP: ${order.device}`,
  ];
  if (order.imei) lines.push(`IMEI: ${order.imei}`);
  lines.push(`Keluhan: ${order.complaint}`);
  if (order.completeness) lines.push(`Kelengkapan: ${order.completeness}`);
  if (order.estimateRupiah !== null) lines.push(`Estimasi biaya: ${rp(order.estimateRupiah)}`);
  if (order.depositRupiah > 0n) lines.push(`DP: ${rp(order.depositRupiah)}`);
  lines.push("", `Status: ${SERVICE_STATUS_LABELS[order.status]}`);
  if (order.totalChargeRupiah !== null) {
    lines.push(`Biaya: ${rp(order.totalChargeRupiah)}`);
    const balance = order.balanceDueRupiah ?? 0n;
    if (order.status !== "diambil") {
      lines.push(balance >= 0n ? `Sisa bayar: ${rp(balance)}` : `DP dikembalikan: ${rp(-balance)}`);
    } else {
      const method = order.paymentMethod === null ? "" : ` (${PAYMENT_LABELS[order.paymentMethod]})`;
      lines.push(
        balance >= 0n ? `*Pelunasan: ${rp(balance)}*${method}` : `DP dikembalikan: ${rp(-balance)}`,
        `Diambil: ${dateTimeWib(order.pickedUpAtMs ?? Date.now())}`,
      );
    }
  }
  if (order.status === "diambil") {
    if (store.footer.trim()) lines.push("", store.footer.trim());
    lines.push("", "Terima kasih 🙏");
  } else {
    lines.push("", "Simpan pesan ini untuk mengambil HP.");
    if (store.footer.trim()) lines.push(store.footer.trim());
  }
  return lines.join("\n");
}

/** Pesan singkat kabar status service ke pelanggan. */
export function serviceStatusMessage(order: ServiceOrder, store: StoreProfile): string {
  const shop = store.name.trim() || "konter kami";
  const greeting = `Halo Kak ${order.customerName}, ini dari ${shop}.`;
  switch (order.status) {
    case "proses":
      return `${greeting}\n\nHP ${order.device} (${order.number}) sedang kami kerjakan. Kami kabari lagi kalau sudah selesai ya 🙏`;
    case "selesai": {
      const balance = order.balanceDueRupiah ?? 0n;
      return `${greeting}\n\nHP ${order.device} (${order.number}) *sudah selesai* dan bisa diambil.\nBiaya: ${rp(order.totalChargeRupiah ?? 0n)}${order.depositRupiah > 0n ? `\nDP: ${rp(order.depositRupiah)}\nSisa bayar: ${rp(balance)}` : ""}\n\nTerima kasih 🙏`;
    }
    case "batal":
      return `${greeting}\n\nMohon maaf, HP ${order.device} (${order.number}) tidak bisa kami perbaiki. HP bisa diambil kembali.${(order.totalChargeRupiah ?? 0n) > 0n ? `\nBiaya pengecekan: ${rp(order.totalChargeRupiah ?? 0n)}` : ""}\n\nTerima kasih 🙏`;
    case "diambil":
      return `${greeting}\n\nTerima kasih sudah service di ${shop}. Kalau ada kendala dengan HP ${order.device}, kabari kami ya 🙏`;
  }
}

export async function loadStoreProfile(
  getSetting: (key: string) => Promise<string | null>,
): Promise<StoreProfile> {
  const raw = await getSetting("store.profile");
  if (raw === null) return EMPTY_STORE_PROFILE;
  try {
    const parsed = JSON.parse(raw) as Partial<StoreProfile>;
    return {
      name: typeof parsed.name === "string" ? parsed.name : "",
      address: typeof parsed.address === "string" ? parsed.address : "",
      phone: typeof parsed.phone === "string" ? parsed.phone : "",
      footer: typeof parsed.footer === "string" ? parsed.footer : "",
    };
  } catch {
    return EMPTY_STORE_PROFILE;
  }
}
