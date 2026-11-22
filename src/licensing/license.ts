/**
 * Lisensi offline Kasir Konter.
 *
 * - Kode perangkat: 10 karakter Crockford base32 dari SHA-256 ID perangkat.
 * - Kode aktivasi / reset: muatan kecil + tanda tangan ECDSA P-256 (r||s) yang
 *   dibuat Admin dengan kunci rahasia (tools/license). Aplikasi hanya memegang
 *   kunci publik, jadi kode tidak bisa dipalsukan dari isi aplikasi.
 *
 * Format pesan yang ditandatangani harus sama dengan tools/license/license-core.mjs.
 */

export const LICENSE_FORMAT_VERSION = 1;
export type LicenseCodeType = "activation" | "reset";

const TYPE_BYTES: Record<LicenseCodeType, number> = { activation: 1, reset: 2 };
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const PAYLOAD_BYTES = 8;
const SIGNATURE_BYTES = 64;
const DEVICE_CODE_LENGTH = 10;
/** Hari ke-0 = 1 Januari 2026 (UTC). */
const EPOCH_MS = Date.UTC(2026, 0, 1);

export interface VerifiedLicenseCode {
  readonly type: LicenseCodeType;
  readonly issuedAtMs: number;
  /** Untuk kode reset: nonce unik agar kode hanya bisa dipakai sekali. */
  readonly nonce: number;
  /** Kode yang sudah dinormalisasi (tanpa spasi/tanda hubung). */
  readonly normalizedCode: string;
}

export async function deriveDeviceCode(rawDeviceId: string): Promise<string> {
  const digest = await sha256(`kasir-konter:device:${rawDeviceId}`);
  return base32Encode(digest).slice(0, DEVICE_CODE_LENGTH);
}

export function formatDeviceCode(code: string): string {
  const normalized = normalizeCode(code);
  return `${normalized.slice(0, 5)}-${normalized.slice(5)}`;
}

/** Tampilkan kode panjang dalam kelompok 4 karakter agar mudah dicek. */
export function formatLicenseCode(code: string): string {
  return normalizeCode(code).replace(/(.{4})(?=.)/g, "$1-");
}

export function normalizeCode(code: string): string {
  return code
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
}

/** Pesan yang ditandatangani: "KKO" + versi + tipe + kode perangkat + muatan. */
export function signedMessage(
  type: LicenseCodeType,
  deviceCode: string,
  issuedDay: number,
  nonce: number,
): Uint8Array {
  const header = new TextEncoder().encode(`KKO${LICENSE_FORMAT_VERSION}`);
  const device = new TextEncoder().encode(normalizeCode(deviceCode));
  const payload = encodePayload(type, issuedDay, nonce);
  const message = new Uint8Array(header.length + device.length + payload.length);
  message.set(header, 0);
  message.set(device, header.length);
  message.set(payload, header.length + device.length);
  return message;
}

export function encodePayload(
  type: LicenseCodeType,
  issuedDay: number,
  nonce: number,
): Uint8Array {
  const bytes = new Uint8Array(PAYLOAD_BYTES);
  const view = new DataView(bytes.buffer);
  view.setUint8(0, LICENSE_FORMAT_VERSION);
  view.setUint8(1, TYPE_BYTES[type]);
  view.setUint16(2, issuedDay);
  view.setUint32(4, nonce >>> 0);
  return bytes;
}

/**
 * Periksa kode dari Admin untuk perangkat ini. Melempar Error berbahasa
 * Indonesia bila kode salah ketik, untuk HP lain, atau palsu.
 */
export async function verifyLicenseCode(
  code: string,
  deviceCode: string,
  expectedType: LicenseCodeType,
  publicKeyJwk: JsonWebKey,
): Promise<VerifiedLicenseCode> {
  const normalizedCode = normalizeCode(code);
  if (!/^[0-9A-HJKMNP-TV-Z]+$/.test(normalizedCode)) {
    throw new Error("Kode berisi huruf yang tidak dikenal. Periksa lagi kodenya.");
  }
  let bytes: Uint8Array;
  try {
    bytes = base32Decode(normalizedCode);
  } catch {
    throw new Error("Kode tidak lengkap. Salin ulang seluruh kode dari Admin.");
  }
  if (bytes.length !== PAYLOAD_BYTES + SIGNATURE_BYTES) {
    throw new Error("Panjang kode tidak sesuai. Salin ulang seluruh kode dari Admin.");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint8(0);
  const typeByte = view.getUint8(1);
  if (version !== LICENSE_FORMAT_VERSION) {
    throw new Error("Versi kode tidak didukung aplikasi ini.");
  }
  const type = (Object.keys(TYPE_BYTES) as LicenseCodeType[]).find(
    (candidate) => TYPE_BYTES[candidate] === typeByte,
  );
  if (type !== expectedType) {
    throw new Error(
      expectedType === "activation"
        ? "Ini bukan kode aktivasi. Minta kode aktivasi ke Admin."
        : "Ini bukan kode reset PIN. Minta kode reset ke Admin.",
    );
  }
  const issuedDay = view.getUint16(2);
  const nonce = view.getUint32(4);
  const key = await crypto.subtle.importKey(
    "jwk",
    publicKeyJwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
  const valid = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    toArrayBuffer(bytes.slice(PAYLOAD_BYTES)),
    toArrayBuffer(signedMessage(type, deviceCode, issuedDay, nonce)),
  );
  if (!valid) {
    throw new Error(
      "Kode tidak cocok untuk HP ini. Pastikan Admin memakai Kode perangkat yang tampil di layar.",
    );
  }
  return {
    type,
    issuedAtMs: EPOCH_MS + issuedDay * 86_400_000,
    nonce,
    normalizedCode,
  };
}

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) {
    output += ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

export function base32Decode(text: string): Uint8Array {
  let bits = 0;
  let value = 0;
  const output: number[] = [];
  for (const character of text) {
    const index = ALPHABET.indexOf(character);
    if (index < 0) throw new Error("Karakter base32 tidak valid.");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
    value &= (1 << bits) - 1;
  }
  return Uint8Array.from(output);
}

async function sha256(text: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    toArrayBuffer(new TextEncoder().encode(text)),
  );
  return new Uint8Array(digest);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
