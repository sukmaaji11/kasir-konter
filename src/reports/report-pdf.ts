import { APP_NAME, BRAND_NAME } from "../app-info";
import { formatDayRange, type KonterReport } from "../application/reports";
import { BUSINESS_LINE_LABELS, BUSINESS_LINES } from "../domain/report";
import { groupThousands } from "../printing/escpos";
import { PAYMENT_LABELS } from "../printing/receipt";
import { A4, PdfDocument, fitText, type Rgb } from "./pdf";

const NAVY: Rgb = [31, 58, 95];
const AMBER: Rgb = [242, 181, 68];
const INK: Rgb = [29, 39, 51];
const MUTED: Rgb = [99, 112, 131];
const GREEN: Rgb = [29, 122, 70];
const RED: Rgb = [179, 53, 43];
const LIGHT: Rgb = [240, 244, 249];
const SHADE: Rgb = [247, 249, 252];
const WHITE: Rgb = [255, 255, 255];
const MARGIN = 40;
const RIGHT = A4.width - MARGIN;
const BOTTOM_LIMIT = A4.height - 60;
const JAKARTA_OFFSET_MS = 7 * 3_600_000;

function rupiah(value: bigint): string {
  return `${value < 0n ? "-" : ""}Rp${groupThousands(value < 0n ? -value : value)}`;
}

function signed(value: bigint): string {
  return value > 0n ? `+${rupiah(value)}` : rupiah(value);
}

function dateTime(ms: number): string {
  const local = new Date(ms + JAKARTA_OFFSET_MS);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(local.getUTCDate())}/${pad(local.getUTCMonth() + 1)}/${local.getUTCFullYear()} ${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`;
}

function dayShort(day: string): string {
  const [year, month, date] = day.split("-");
  return `${date}/${month}/${year}`;
}

interface Column {
  readonly label: string;
  readonly x: number;
  readonly width: number;
  readonly align: "left" | "right";
}

interface Cell {
  readonly text: string;
  readonly color?: Rgb;
  readonly bold?: boolean;
}

/** Laporan untung konter dalam PDF A4 (hanya Owner yang bisa membuatnya). */
export function buildReportPdf(
  report: KonterReport,
  options: { readonly storeName: string; readonly generatedAtMs: number },
): Uint8Array {
  const pdf = new PdfDocument();
  const total = report.summary.total;

  // Kepala
  pdf.rect(0, 0, A4.width, 96, NAVY);
  pdf.text(MARGIN, 38, "LAPORAN UNTUNG KONTER", { size: 10, bold: true, color: AMBER });
  pdf.text(MARGIN, 62, fitText(options.storeName || "Konter HP", RIGHT - MARGIN - 170, 20, true), { size: 20, bold: true, color: WHITE });
  pdf.text(MARGIN, 82, `Periode ${formatDayRange(report.range)}`, { size: 10, color: [214, 224, 238] });
  pdf.text(RIGHT, 82, `Dibuat ${dateTime(options.generatedAtMs)}`, { size: 9, color: [214, 224, 238], align: "right" });
  let top = 120;

  // Ringkasan besar
  pdf.rect(MARGIN, top, RIGHT - MARGIN, 62, LIGHT);
  pdf.text(MARGIN + 14, top + 20, "Untung bersih (omzet - modal)", { size: 9, color: MUTED });
  pdf.text(MARGIN + 14, top + 46, signed(total.profitRupiah), { size: 22, bold: true, color: total.profitRupiah < 0n ? RED : GREEN });
  pdf.text(RIGHT - 14, top + 24, `Omzet ${rupiah(total.revenueRupiah)}`, { size: 10.5, bold: true, color: INK, align: "right" });
  pdf.text(RIGHT - 14, top + 42, `Modal ${rupiah(total.costRupiah)}`, { size: 9.5, color: MUTED, align: "right" });
  pdf.text(
    RIGHT - 14,
    top + 56,
    `${report.saleCount} nota - ${report.services.length} service diambil` + (report.voidedCount > 0 ? ` - ${report.voidedCount} nota batal` : ""),
    { size: 8.5, color: MUTED, align: "right" },
  );
  top += 76;

  // Per lini usaha (4 kotak)
  const boxWidth = (RIGHT - MARGIN - 3 * 8) / 4;
  BUSINESS_LINES.forEach((line, index) => {
    const totals = report.summary.byLine[line];
    const x = MARGIN + index * (boxWidth + 8);
    pdf.rect(x, top, boxWidth, 64, SHADE);
    pdf.rect(x, top, 3, 64, NAVY);
    pdf.text(x + 12, top + 16, BUSINESS_LINE_LABELS[line].toUpperCase(), { size: 8, bold: true, color: NAVY });
    pdf.text(x + 12, top + 34, signed(totals.profitRupiah), { size: 12, bold: true, color: totals.profitRupiah < 0n ? RED : INK });
    pdf.text(x + 12, top + 48, `Omzet ${rupiah(totals.revenueRupiah)}`, { size: 8, color: MUTED });
    pdf.text(x + 12, top + 59, `${totals.count.toString()} ${line === "hp" ? "unit" : line === "service" ? "service" : line === "digital" ? "transaksi" : "barang"}`, { size: 8, color: MUTED });
  });
  top += 76;

  // Cara bayar
  const payWidth = (RIGHT - MARGIN - 2 * 8) / 3;
  report.payments.forEach((payment, index) => {
    const x = MARGIN + index * (payWidth + 8);
    pdf.rect(x, top, payWidth, 40, SHADE);
    pdf.text(x + 12, top + 15, `${PAYMENT_LABELS[payment.method]} (${payment.count})`, { size: 8.5, color: MUTED });
    pdf.text(x + 12, top + 32, rupiah(payment.amountRupiah), { size: 11, bold: true, color: INK });
  });
  top += 48;
  pdf.text(MARGIN, top, "Uang masuk per cara bayar: nota setelah potongan tukar tambah + biaya service yang diambil.", { size: 7.5, color: MUTED });

  function ensureSpace(height: number, onNewPage?: () => void) {
    if (top + height <= BOTTOM_LIMIT) return;
    pdf.addPage();
    top = 50;
    onNewPage?.();
  }

  function section(title: string) {
    ensureSpace(80);
    top += 30;
    pdf.text(MARGIN, top, title, { size: 13, bold: true, color: NAVY });
    top += 8;
  }

  function header(columns: readonly Column[]) {
    pdf.rect(MARGIN, top, RIGHT - MARGIN, 20, NAVY);
    for (const column of columns) {
      pdf.text(column.align === "right" ? column.x + column.width : column.x, top + 13.5, column.label, {
        size: 8.5,
        bold: true,
        color: WHITE,
        align: column.align,
      });
    }
    top += 20;
  }

  function row(columns: readonly Column[], values: readonly Cell[], shaded: boolean) {
    ensureSpace(20, () => header(columns));
    if (shaded) pdf.rect(MARGIN, top, RIGHT - MARGIN, 19, SHADE);
    columns.forEach((column, index) => {
      const value = values[index]!;
      const bold = value.bold ?? false;
      pdf.text(column.align === "right" ? column.x + column.width : column.x, top + 13, fitText(value.text, column.width, 9, bold), {
        size: 9,
        bold,
        align: column.align,
        ...(value.color === undefined ? {} : { color: value.color }),
      });
    });
    top += 19;
    pdf.line(MARGIN, top, RIGHT, top, [228, 233, 240], 0.5);
  }

  function table(title: string, columns: readonly Column[], rows: readonly (readonly Cell[])[], empty: string) {
    section(title);
    if (rows.length === 0) {
      top += 14;
      pdf.text(MARGIN, top, empty, { size: 10, color: MUTED });
      return;
    }
    top += 6;
    header(columns);
    rows.forEach((cells, index) => row(columns, cells, index % 2 === 1));
  }

  const profitCell = (value: bigint): Cell => ({ text: signed(value), color: value < 0n ? RED : GREEN, bold: true });

  if (report.daily !== null) {
    table(
      "Per hari",
      [
        { label: "Tanggal", x: MARGIN + 8, width: 110, align: "left" },
        { label: "Item", x: MARGIN + 130, width: 70, align: "right" },
        { label: "Omzet", x: MARGIN + 210, width: 95, align: "right" },
        { label: "Modal", x: MARGIN + 312, width: 95, align: "right" },
        { label: "Untung", x: MARGIN + 412, width: 95, align: "right" },
      ],
      report.daily
        .filter((day) => day.totals.count > 0n)
        .map((day) => [
          { text: dayShort(day.day) },
          { text: day.totals.count.toString() },
          { text: rupiah(day.totals.revenueRupiah) },
          { text: rupiah(day.totals.costRupiah) },
          profitCell(day.totals.profitRupiah),
        ]),
      "Tidak ada transaksi pada periode ini.",
    );
  }

  table(
    "Untung per HP terjual",
    [
      { label: "HP", x: MARGIN + 8, width: 190, align: "left" },
      { label: "Nota", x: MARGIN + 202, width: 100, align: "left" },
      { label: "Jual", x: MARGIN + 305, width: 65, align: "right" },
      { label: "Modal", x: MARGIN + 375, width: 65, align: "right" },
      { label: "Untung", x: MARGIN + 442, width: 65, align: "right" },
    ],
    report.phones.map((phone) => [
      { text: `${phone.name}${phone.source === "tukar_tambah" ? " (eks TT)" : ""}` },
      { text: phone.saleNumber },
      { text: groupThousands(phone.priceRupiah) },
      { text: groupThousands(phone.costRupiah) },
      { ...profitCell(phone.profitRupiah), text: groupThousands(phone.profitRupiah) },
    ]),
    "Belum ada HP terjual pada periode ini.",
  );

  table(
    "Service diambil",
    [
      { label: "HP / pelanggan", x: MARGIN + 8, width: 200, align: "left" },
      { label: "No", x: MARGIN + 212, width: 90, align: "left" },
      { label: "Biaya", x: MARGIN + 305, width: 65, align: "right" },
      { label: "Sparepart", x: MARGIN + 375, width: 65, align: "right" },
      { label: "Untung", x: MARGIN + 442, width: 65, align: "right" },
    ],
    report.services.map((order) => [
      { text: `${order.device} - ${order.customerName}` },
      { text: order.number },
      { text: groupThousands(order.totalChargeRupiah ?? 0n) },
      { text: groupThousands(order.partsCostRupiah) },
      { ...profitCell(order.profitRupiah ?? 0n), text: groupThousands(order.profitRupiah ?? 0n) },
    ]),
    "Belum ada service yang diambil pada periode ini.",
  );

  table(
    "Aksesoris & digital terjual",
    [
      { label: "#", x: MARGIN + 8, width: 20, align: "left" },
      { label: "Barang", x: MARGIN + 30, width: 220, align: "left" },
      { label: "Jenis", x: MARGIN + 255, width: 60, align: "left" },
      { label: "Jumlah", x: MARGIN + 318, width: 40, align: "right" },
      { label: "Omzet", x: MARGIN + 365, width: 70, align: "right" },
      { label: "Untung", x: MARGIN + 440, width: 67, align: "right" },
    ],
    report.items.map((item, index) => [
      { text: String(index + 1) },
      { text: item.name, bold: index < 3 },
      { text: item.kind === "digital" ? "Digital" : "Aksesoris" },
      { text: item.quantity.toString() },
      { text: groupThousands(item.revenueRupiah) },
      { ...profitCell(item.profitRupiah), text: groupThousands(item.profitRupiah) },
    ]),
    "Belum ada aksesoris atau produk digital terjual.",
  );

  // Kaki halaman
  const pages = pdf.pageCount;
  for (let index = 0; index < pages; index += 1) {
    pdf.usePage(index);
    pdf.line(MARGIN, A4.height - 36, RIGHT, A4.height - 36);
    pdf.text(MARGIN, A4.height - 22, `${APP_NAME} - Powered by ${BRAND_NAME}`, { size: 8, color: MUTED });
    pdf.text(RIGHT, A4.height - 22, `Halaman ${index + 1} dari ${pages}`, { size: 8, color: MUTED, align: "right" });
  }
  return pdf.build(`Laporan ${options.storeName} ${formatDayRange(report.range)}`);
}
