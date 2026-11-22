/**
 * Struk thermal ESC/POS (diambil dari Kasir Kaki Lima): baris teks dengan
 * rata tengah/tebal/tinggi, lalu dikodekan untuk printer Bluetooth 58/80 mm.
 */

/** Lebar kertas thermal yang umum dijual: 58 mm (32 huruf) dan 80 mm (48 huruf). */
export type PaperWidth = 58 | 80;

export function charsPerLine(paper: PaperWidth): number {
  return paper === 80 ? 48 : 32;
}

export type ReceiptAlign = "left" | "center";

export interface ReceiptLine {
  readonly text: string;
  readonly align?: ReceiptAlign;
  readonly bold?: boolean;
  /** Huruf tinggi dua kali (lebar tetap), untuk nama toko & total. */
  readonly tall?: boolean;
}

export function receiptToText(lines: readonly ReceiptLine[], width: number): string {
  return lines
    .map((line) => {
      const text = toPrinterText(line.text);
      if (line.align !== "center") return text;
      const pad = Math.max(0, Math.floor((width - text.length) / 2));
      return " ".repeat(pad) + text;
    })
    .join("\n");
}

// ---------- ESC/POS ----------

const ESC = 0x1b;
const GS = 0x1d;

/** Ubah baris struk menjadi perintah ESC/POS (printer thermal Bluetooth umum). */
export function encodeEscPos(lines: readonly ReceiptLine[]): Uint8Array {
  const bytes: number[] = [ESC, 0x40]; // reset printer
  for (const line of lines) {
    bytes.push(ESC, 0x61, line.align === "center" ? 1 : 0);
    bytes.push(ESC, 0x45, line.bold === true ? 1 : 0);
    bytes.push(GS, 0x21, line.tall === true ? 0x01 : 0x00);
    for (const char of toPrinterText(line.text)) bytes.push(char.charCodeAt(0));
    bytes.push(0x0a);
  }
  bytes.push(ESC, 0x61, 0, ESC, 0x45, 0, GS, 0x21, 0);
  // Beri jarak supaya struk bisa disobek, lalu potong bila printer punya pemotong.
  bytes.push(ESC, 0x64, 4);
  bytes.push(GS, 0x56, 0x42, 0x00);
  return Uint8Array.from(bytes);
}

const CHAR_REPLACEMENTS: Readonly<Record<string, string>> = {
  "×": "x",
  "·": "-",
  "•": "-",
  "–": "-",
  "—": "-",
  "…": "...",
  "‘": "'",
  "’": "'",
  "“": '"',
  "”": '"',
  " ": " ",
  " ": " ",
};

/** Printer murah hanya andal untuk ASCII; huruf lain diganti yang mirip. */
export function toPrinterText(text: string): string {
  let out = "";
  for (const char of text.normalize("NFD")) {
    const code = char.charCodeAt(0);
    if (code >= 0x0300 && code <= 0x036f) continue; // tanda aksen
    if (code >= 0x20 && code <= 0x7e) {
      out += char;
    } else {
      out += CHAR_REPLACEMENTS[char] ?? "?";
    }
  }
  return out;
}

// ---------- Bantuan tata letak ----------

export function groupThousands(value: bigint): string {
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString();
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return negative ? `-${grouped}` : grouped;
}

export function twoColumns(left: string, right: string, width: number): string {
  const leftText = toPrinterText(left);
  const rightText = toPrinterText(right);
  const room = width - rightText.length - 1;
  if (room <= 0) return rightText.slice(0, width);
  const clipped = leftText.length > room ? leftText.slice(0, room) : leftText;
  return clipped + " ".repeat(width - clipped.length - rightText.length) + rightText;
}

export function fit(text: string, width: number): string {
  const clean = toPrinterText(text);
  return clean.length > width ? clean.slice(0, width) : clean;
}

export function wrap(text: string, width: number): string[] {
  const words = toPrinterText(text).split(/\s+/).filter((word) => word.length > 0);
  const lines: string[] = [];
  let current = "";
  for (let word of words) {
    while (word.length > width) {
      if (current.length > 0) {
        lines.push(current);
        current = "";
      }
      lines.push(word.slice(0, width));
      word = word.slice(width);
    }
    if (word.length === 0) continue;
    if (current.length === 0) current = word;
    else if (current.length + 1 + word.length <= width) current += ` ${word}`;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current.length > 0) lines.push(current);
  return lines;
}

