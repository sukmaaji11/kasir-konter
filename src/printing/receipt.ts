import type { SaleRecord, ServiceOrder } from "../data/repository";
import type { PaymentMethod } from "../domain/sales";
import { warrantyLabel } from "../domain/service";
import {
  charsPerLine,
  fit,
  groupThousands,
  twoColumns,
  wrap,
  type PaperWidth,
  type ReceiptLine,
} from "./escpos";

/** Kepala dan penutup struk (diambil dari Profil konter). */
export interface ReceiptStore {
  readonly name: string;
  readonly address: string;
  readonly phone: string;
  /** Pesan umum di bawah semua nota, mis. jam buka. Garansi service dicatat per service. */
  readonly footer: string;
}

export const PAYMENT_LABELS: Readonly<Record<PaymentMethod, string>> = {
  tunai: "Tunai",
  transfer: "Transfer",
  qris: "QRIS",
};

export interface CashDetail {
  readonly receivedRupiah: bigint;
  readonly changeRupiah: bigint;
}

const JAKARTA_OFFSET_MS = 7 * 3_600_000;

export function formatReceiptDate(ms: number): string {
  const date = new Date(ms + JAKARTA_OFFSET_MS);
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `${pad(date.getUTCDate())}/${pad(date.getUTCMonth() + 1)}/${date.getUTCFullYear()} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`
  );
}

function rp(value: bigint): string {
  return `${value < 0n ? "-" : ""}Rp${groupThousands(value < 0n ? -value : value)}`;
}

function storeHeader(store: ReceiptStore, width: number): ReceiptLine[] {
  const lines: ReceiptLine[] = [];
  const name = store.name.trim() || "Konter HP";
  for (const part of wrap(name.toLocaleUpperCase("id-ID"), width)) {
    lines.push({ text: part, align: "center", bold: true, tall: true });
  }
  for (const info of [store.address, store.phone ? `WA ${store.phone}` : ""]) {
    for (const row of info.split("\n")) {
      if (row.trim().length === 0) continue;
      for (const part of wrap(row.trim(), width)) lines.push({ text: part, align: "center" });
    }
  }
  return lines;
}

function footer(store: ReceiptStore, width: number, closing: string): ReceiptLine[] {
  const lines: ReceiptLine[] = [];
  for (const row of [...store.footer.split("\n"), closing]) {
    if (row.trim().length === 0) continue;
    for (const part of wrap(row.trim(), width)) lines.push({ text: part, align: "center" });
  }
  return lines;
}

/** Struk penjualan (HP, aksesoris, digital, tukar tambah). Murni, mudah dites. */
export function buildSaleReceipt(input: {
  readonly store: ReceiptStore;
  readonly paper: PaperWidth;
  readonly sale: SaleRecord;
  readonly cashierName: string | null;
  readonly cash?: CashDetail | null;
  readonly reprint?: boolean;
}): readonly ReceiptLine[] {
  const width = charsPerLine(input.paper);
  const { sale } = input;
  if (sale.voidedAtMs !== null) {
    throw new Error("Nota yang dibatalkan tidak bisa dicetak.");
  }
  const divider: ReceiptLine = { text: "-".repeat(width) };
  const lines: ReceiptLine[] = [...storeHeader(input.store, width), divider];
  lines.push({ text: twoColumns(formatReceiptDate(sale.soldAtMs), sale.number, width) });
  if (input.cashierName) lines.push({ text: fit(`Kasir: ${input.cashierName}`, width) });
  if (sale.customerName) lines.push({ text: fit(`Pelanggan: ${sale.customerName}`, width) });
  if (input.reprint === true) lines.push({ text: "** CETAK ULANG **", align: "center", bold: true });
  lines.push(divider);

  for (const line of sale.lines) {
    for (const part of wrap(line.name, width)) lines.push({ text: part });
    if (line.target !== null) lines.push({ text: fit(`  ke ${line.target}`, width) });
    const subtotal = line.unitPriceRupiah * line.quantity;
    lines.push({
      text: twoColumns(`  ${line.quantity} x ${groupThousands(line.unitPriceRupiah)}`, groupThousands(subtotal), width),
    });
  }

  lines.push(divider);
  const due = sale.summary.amountDueRupiah;
  if (sale.tradeInPhone !== null) {
    lines.push({ text: twoColumns("Total barang", groupThousands(sale.summary.itemsTotalRupiah), width) });
    lines.push({ text: fit(`Tukar tambah: ${sale.tradeInPhone.displayName}`, width) });
    lines.push({ text: twoColumns("  Potongan", `-${groupThousands(sale.summary.tradeInCreditRupiah)}`, width) });
  }
  if (due >= 0n) {
    lines.push({ text: twoColumns("TOTAL", rp(due), width), bold: true, tall: true });
    if (sale.paymentMethod === "tunai" && input.cash) {
      lines.push({ text: twoColumns("Tunai", groupThousands(input.cash.receivedRupiah), width) });
      lines.push({ text: twoColumns("Kembali", groupThousands(input.cash.changeRupiah), width) });
    } else {
      lines.push({ text: twoColumns("Bayar", PAYMENT_LABELS[sale.paymentMethod], width) });
    }
  } else {
    lines.push({ text: twoColumns("DIBAYAR KE PEL.", rp(-due), width), bold: true });
  }
  lines.push(divider);
  lines.push(...footer(input.store, width, "Terima kasih!"));
  return lines;
}

/** Struk service: tanda terima (belum diambil) atau nota pelunasan (sudah diambil). */
export function buildServiceReceipt(input: {
  readonly store: ReceiptStore;
  readonly paper: PaperWidth;
  readonly order: ServiceOrder;
}): readonly ReceiptLine[] {
  const width = charsPerLine(input.paper);
  const { order } = input;
  const done = order.status === "diambil";
  const divider: ReceiptLine = { text: "-".repeat(width) };
  const lines: ReceiptLine[] = [...storeHeader(input.store, width), divider];
  lines.push({ text: done ? "NOTA SERVICE" : "TANDA TERIMA SERVICE", align: "center", bold: true });
  lines.push({ text: twoColumns(formatReceiptDate(done ? (order.pickedUpAtMs ?? order.receivedAtMs) : order.receivedAtMs), order.number, width) });
  lines.push(divider);
  lines.push({ text: fit(`Pelanggan: ${order.customerName}`, width) });
  for (const part of wrap(`HP: ${order.device}`, width)) lines.push({ text: part });
  if (order.imei) lines.push({ text: fit(`IMEI: ${order.imei}`, width) });
  for (const part of wrap(`Keluhan: ${order.complaint}`, width)) lines.push({ text: part });
  if (order.completeness) for (const part of wrap(`Kelengkapan: ${order.completeness}`, width)) lines.push({ text: part });
  lines.push(divider);
  if (order.totalChargeRupiah !== null) {
    lines.push({ text: twoColumns(order.status === "batal" ? "Biaya cek" : "Biaya service", groupThousands(order.totalChargeRupiah), width) });
  } else if (order.estimateRupiah !== null) {
    lines.push({ text: twoColumns("Estimasi biaya", groupThousands(order.estimateRupiah), width) });
  }
  if (order.depositRupiah > 0n) lines.push({ text: twoColumns("DP", groupThousands(order.depositRupiah), width) });
  const balance = order.balanceDueRupiah;
  if (balance !== null) {
    if (done) {
      lines.push({ text: twoColumns(balance >= 0n ? "LUNAS" : "DP KEMBALI", rp(balance >= 0n ? balance : -balance), width), bold: true, tall: true });
      if (order.paymentMethod !== null && balance > 0n) {
        lines.push({ text: twoColumns("Bayar", PAYMENT_LABELS[order.paymentMethod], width) });
      }
    } else {
      lines.push({ text: twoColumns(balance >= 0n ? "Sisa bayar" : "DP kembali", rp(balance >= 0n ? balance : -balance), width), bold: true });
    }
  }
  lines.push(divider);
  if (done && order.warrantyDays > 0 && order.warrantyUntil !== null) {
    lines.push({ text: `GARANSI ${warrantyLabel(order.warrantyDays).toUpperCase()}`, align: "center", bold: true });
    lines.push({ text: `Berlaku s/d ${shortDay(order.warrantyUntil)}`, align: "center" });
    if (order.warrantyNote) for (const part of wrap(order.warrantyNote, width)) lines.push({ text: part, align: "center" });
    lines.push({ text: "Bawa nota ini saat klaim garansi.", align: "center" });
    lines.push(divider);
  }
  lines.push(...footer(input.store, width, done ? "Terima kasih!" : "Bawa struk ini saat mengambil HP."));
  return lines;
}

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

/** "2026-11-30" -> "30 Nov 2026" (ASCII, aman untuk printer). */
function shortDay(dayKey: string): string {
  const [year, month, day] = dayKey.split("-").map(Number);
  return `${day} ${SHORT_MONTHS[month! - 1]} ${year}`;
}

export function buildTestReceipt(store: ReceiptStore, paper: PaperWidth): readonly ReceiptLine[] {
  const width = charsPerLine(paper);
  return [
    ...storeHeader(store, width),
    { text: "-".repeat(width) },
    { text: "TES PRINTER BERHASIL", align: "center", bold: true },
    { text: `Kertas ${paper} mm - ${width} huruf/baris`, align: "center" },
    { text: "1234567890".repeat(Math.ceil(width / 10)).slice(0, width) },
    { text: "-".repeat(width) },
  ];
}
