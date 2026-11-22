import { DomainError } from "./errors";

export function requiredText(value: string, label: string, maxLength = 120): string {
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (trimmed.length === 0) {
    throw new DomainError("invalid_text", `${label} wajib diisi.`);
  }
  if (trimmed.length > maxLength) {
    throw new DomainError("invalid_text", `${label} maksimal ${maxLength} karakter.`);
  }
  return trimmed;
}

export function optionalText(
  value: string | null | undefined,
  label: string,
  maxLength = 500,
): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (trimmed.length > maxLength) {
    throw new DomainError("invalid_text", `${label} maksimal ${maxLength} karakter.`);
  }
  return trimmed;
}

/** Nomor WA disimpan hanya angka; awalan 0 diubah ke 62. */
export function normalizePhoneNumber(value: string | null | undefined): string | null {
  const text = optionalText(value, "Nomor HP", 30);
  if (text === null) {
    return null;
  }
  let digits = text.replace(/[^\d]/g, "");
  if (digits.startsWith("0")) {
    digits = `62${digits.slice(1)}`;
  }
  if (digits.length < 9 || digits.length > 15) {
    throw new DomainError("invalid_text", "Nomor HP pelanggan tidak valid.");
  }
  return digits;
}
