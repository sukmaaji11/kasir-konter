// Inti pembuat kode lisensi untuk Admin. Format pesan HARUS sama dengan
// src/licensing/license.ts (diuji di tests/auth-license.test.ts).
// Hanya memakai WebCrypto standar, jadi berjalan di Node 20+ maupun browser:
// file ini juga disisipkan ke tools/license/admin.html oleh build-admin-page.mjs.

const webcrypto = globalThis.crypto;
const subtle = webcrypto.subtle;
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const FORMAT_VERSION = 1;
const TYPE_BYTES = { activation: 1, reset: 2 };
const EPOCH_MS = Date.UTC(2026, 0, 1);

export function normalizeCode(code) {
  return code.toUpperCase().replace(/[\s-]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
}

export function base32Encode(bytes) {
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
  if (bits > 0) output += ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

function encodePayload(type, issuedDay, nonce) {
  const bytes = new Uint8Array(8);
  const view = new DataView(bytes.buffer);
  view.setUint8(0, FORMAT_VERSION);
  view.setUint8(1, TYPE_BYTES[type]);
  view.setUint16(2, issuedDay);
  view.setUint32(4, nonce >>> 0);
  return bytes;
}

function signedMessage(type, deviceCode, issuedDay, nonce) {
  const header = new TextEncoder().encode(`KKO${FORMAT_VERSION}`);
  const device = new TextEncoder().encode(normalizeCode(deviceCode));
  const payload = encodePayload(type, issuedDay, nonce);
  return Uint8Array.from([...header, ...device, ...payload]);
}

export function assertDeviceCode(deviceCode) {
  const normalized = normalizeCode(deviceCode);
  if (!/^[0-9A-HJKMNP-TV-Z]{10}$/.test(normalized)) {
    throw new Error(`Kode perangkat tidak valid: "${deviceCode}" (harus 10 karakter, mis. ABCDE-12345).`);
  }
  return normalized;
}

export async function generateKeyPair() {
  const pair = await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  return {
    privateJwk: await subtle.exportKey("jwk", pair.privateKey),
    publicJwk: await subtle.exportKey("jwk", pair.publicKey),
  };
}

/** Buat kode untuk satu perangkat. type: "activation" | "reset". */
export async function createLicenseCode({ privateJwk, deviceCode, type, now = Date.now(), nonce }) {
  if (!(type in TYPE_BYTES)) throw new Error(`Tipe kode tidak dikenal: ${type}`);
  const device = assertDeviceCode(deviceCode);
  const issuedDay = Math.max(0, Math.floor((now - EPOCH_MS) / 86_400_000));
  const codeNonce = nonce ?? webcrypto.getRandomValues(new Uint32Array(1))[0];
  const key = await subtle.importKey("jwk", privateJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const signature = new Uint8Array(
    await subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, signedMessage(type, device, issuedDay, codeNonce)),
  );
  return base32Encode(Uint8Array.from([...encodePayload(type, issuedDay, codeNonce), ...signature]));
}

export function formatLicenseCode(code) {
  return normalizeCode(code).replace(/(.{4})(?=.)/g, "$1-");
}

export function publicKeyModule(publicJwk) {
  const { kty, crv, x, y } = publicJwk;
  return `// Kunci PUBLIK untuk memeriksa kode lisensi. Aman disimpan di repo.
// Dibuat oleh: node tools/license/admin.mjs init
export const LICENSE_PUBLIC_KEY: JsonWebKey = ${JSON.stringify({ kty, crv, x, y }, null, 2)};
`;
}
