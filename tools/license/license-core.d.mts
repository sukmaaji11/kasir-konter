export type LicenseCodeType = "activation" | "reset";

export function normalizeCode(code: string): string;
export function base32Encode(bytes: Uint8Array): string;
export function assertDeviceCode(deviceCode: string): string;
export function generateKeyPair(): Promise<{
  privateJwk: JsonWebKey;
  publicJwk: JsonWebKey;
}>;
export function createLicenseCode(input: {
  privateJwk: JsonWebKey;
  deviceCode: string;
  type: LicenseCodeType;
  now?: number;
  nonce?: number;
}): Promise<string>;
export function formatLicenseCode(code: string): string;
export function publicKeyModule(publicJwk: JsonWebKey): string;
