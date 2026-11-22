import { toPrinterText } from "../printing/escpos";

/**
 * Penulis PDF kecil tanpa library: halaman A4, huruf Helvetica bawaan PDF,
 * teks, garis, dan kotak berwarna. Cukup untuk laporan tabel, berjalan
 * offline, dan hasilnya bisa dibuka di semua penampil PDF.
 */

export const A4 = { width: 595.28, height: 841.89 } as const;

export type Rgb = readonly [number, number, number];

export interface TextStyle {
  readonly size?: number;
  readonly bold?: boolean;
  readonly color?: Rgb;
  readonly align?: "left" | "right" | "center";
}

// Lebar huruf Helvetica (AFM standar, per 1000 unit) untuk ASCII 32–126.
const HELVETICA_WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

// Helvetica-Bold (AFM standar) untuk ASCII 32–126.
const HELVETICA_BOLD_WIDTHS = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];

export function textWidth(text: string, size: number, bold = false): number {
  const widths = bold ? HELVETICA_BOLD_WIDTHS : HELVETICA_WIDTHS;
  let units = 0;
  for (const char of toPrinterText(text)) {
    units += widths[char.charCodeAt(0) - 32] ?? 556;
  }
  return (units * size) / 1000;
}

/** Potong teks supaya muat di lebar tertentu (ditambah "..."). */
export function fitText(text: string, maxWidth: number, size: number, bold = false): string {
  const clean = toPrinterText(text);
  if (textWidth(clean, size, bold) <= maxWidth) return clean;
  let cut = clean;
  while (cut.length > 0 && textWidth(`${cut}...`, size, bold) > maxWidth) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}...`;
}

function num(value: number): string {
  return (Math.round(value * 100) / 100).toString();
}

function color(rgb: Rgb): string {
  return rgb.map((part) => num(part / 255)).join(" ");
}

function escapePdfText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

export class PdfDocument {
  private readonly pages: string[][] = [];
  private current: string[] = [];

  constructor() {
    this.addPage();
  }

  get pageCount(): number {
    return this.pages.length;
  }

  addPage(): void {
    this.current = [];
    this.pages.push(this.current);
  }

  /** Pilih halaman (0-based), misalnya untuk menulis nomor halaman di akhir. */
  usePage(index: number): void {
    const page = this.pages[index];
    if (page === undefined) throw new Error("Halaman tidak ada.");
    this.current = page;
  }

  /** `top` diukur dari atas halaman (baseline teks). */
  text(x: number, top: number, value: string, style: TextStyle = {}): void {
    const size = style.size ?? 10;
    const bold = style.bold ?? false;
    const clean = toPrinterText(value);
    const width = textWidth(clean, size, bold);
    const left =
      style.align === "right" ? x - width : style.align === "center" ? x - width / 2 : x;
    this.current.push(
      `BT ${color(style.color ?? [33, 41, 35])} rg /${bold ? "F2" : "F1"} ${num(size)} Tf ` +
        `1 0 0 1 ${num(left)} ${num(A4.height - top)} Tm (${escapePdfText(clean)}) Tj ET`,
    );
  }

  line(x1: number, top1: number, x2: number, top2: number, rgb: Rgb = [222, 223, 214], width = 0.75): void {
    this.current.push(
      `${color(rgb)} RG ${num(width)} w ${num(x1)} ${num(A4.height - top1)} m ` +
        `${num(x2)} ${num(A4.height - top2)} l S`,
    );
  }

  rect(x: number, top: number, width: number, height: number, fill: Rgb): void {
    this.current.push(
      `${color(fill)} rg ${num(x)} ${num(A4.height - top - height)} ${num(width)} ${num(height)} re f`,
    );
  }

  build(title: string): Uint8Array {
    const objects: string[] = [];
    const add = (body: string) => {
      objects.push(body);
      return objects.length;
    };
    const catalog = add("");
    const pagesObject = add("");
    const fontRegular = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
    const fontBold = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
    const info = add(`<< /Title (${escapePdfText(toPrinterText(title))}) /Producer (Kasir Konter) >>`);
    const pageIds: number[] = [];
    for (const page of this.pages) {
      const stream = page.join("\n");
      const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
      pageIds.push(
        add(
          `<< /Type /Page /Parent ${pagesObject} 0 R /MediaBox [0 0 ${A4.width} ${A4.height}] ` +
            `/Resources << /Font << /F1 ${fontRegular} 0 R /F2 ${fontBold} 0 R >> >> /Contents ${content} 0 R >>`,
        ),
      );
    }
    objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObject} 0 R >>`;
    objects[pagesObject - 1] =
      `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;

    // Semua isi ASCII, jadi panjang string = jumlah byte (offset xref tepat).
    let output = "%PDF-1.4\n";
    const offsets: number[] = [];
    objects.forEach((body, index) => {
      offsets.push(output.length);
      output += `${index + 1} 0 obj\n${body}\nendobj\n`;
    });
    const xref = output.length;
    output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const offset of offsets) output += `${String(offset).padStart(10, "0")} 00000 n \n`;
    output += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

    const bytes = new Uint8Array(output.length);
    for (let index = 0; index < output.length; index += 1) bytes[index] = output.charCodeAt(index) & 0xff;
    return bytes;
  }
}
