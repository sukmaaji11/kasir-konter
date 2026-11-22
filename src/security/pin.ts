import type { PinCredential } from "../domain/auth";

/**
 * Hash PIN dengan PBKDF2-SHA256 + salt acak per pengguna. Iterasi dijaga agar
 * pemeriksaan beberapa pengguna saat login tetap cepat di HP kelas bawah.
 */
export const PIN_HASH_ITERATIONS = 60_000;

export async function hashPin(
  pin: string,
  salt: string = randomSalt(),
  iterations = PIN_HASH_ITERATIONS,
): Promise<PinCredential> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pin),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: base64ToBytes(salt) as BufferSource,
      iterations,
    },
    key,
    256,
  );
  return { hash: bytesToBase64(new Uint8Array(bits)), salt, iterations };
}

export async function verifyPin(pin: string, credential: PinCredential): Promise<boolean> {
  const candidate = await hashPin(pin, credential.salt, credential.iterations);
  return constantTimeEqual(candidate.hash, credential.hash);
}

function randomSalt(): string {
  return bytesToBase64(crypto.getRandomValues(new Uint8Array(16)));
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
