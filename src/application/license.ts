import type { AccessRepository } from "./access-repository";
import {
  deriveDeviceCode,
  formatDeviceCode,
  verifyLicenseCode,
} from "../licensing/license";

const ACTIVATION_KEY = "license.activationCode";
const USED_RESETS_KEY = "license.usedResetCodes";

export type LicenseStatus =
  | { readonly activated: true; readonly activatedOn: string }
  | { readonly activated: false };

/**
 * Aktivasi sekali per HP. Kode aktivasi disimpan di database; bila data
 * dipulihkan di HP lain, kodenya tidak cocok sehingga perlu aktivasi ulang.
 */
export class LicenseApplicationService {
  private deviceCodePromise: Promise<string> | null = null;

  constructor(
    private readonly repository: AccessRepository,
    private readonly readDeviceId: () => Promise<string>,
    private readonly publicKey: JsonWebKey,
  ) {}

  async deviceCode(): Promise<string> {
    this.deviceCodePromise ??= this.readDeviceId().then(deriveDeviceCode);
    return formatDeviceCode(await this.deviceCodePromise);
  }

  async status(): Promise<LicenseStatus> {
    const stored = await this.repository.getSetting(ACTIVATION_KEY);
    if (stored === null) return { activated: false };
    try {
      const verified = await verifyLicenseCode(
        stored,
        await this.deviceCode(),
        "activation",
        this.publicKey,
      );
      return {
        activated: true,
        activatedOn: new Intl.DateTimeFormat("id-ID", { dateStyle: "long" }).format(
          verified.issuedAtMs,
        ),
      };
    } catch {
      return { activated: false };
    }
  }

  async activate(code: string): Promise<void> {
    const verified = await verifyLicenseCode(
      code,
      await this.deviceCode(),
      "activation",
      this.publicKey,
    );
    await this.repository.setSetting(ACTIVATION_KEY, verified.normalizedCode);
  }

  /** Periksa kode reset PIN dan tandai terpakai agar tidak bisa dipakai lagi. */
  async consumeResetCode(code: string): Promise<void> {
    const verified = await verifyLicenseCode(
      code,
      await this.deviceCode(),
      "reset",
      this.publicKey,
    );
    const used = parseUsedCodes(await this.repository.getSetting(USED_RESETS_KEY));
    if (used.includes(verified.normalizedCode)) {
      throw new Error("Kode reset ini sudah pernah dipakai. Minta kode baru ke Admin.");
    }
    await this.repository.setSetting(
      USED_RESETS_KEY,
      JSON.stringify([...used, verified.normalizedCode].slice(-50)),
    );
  }
}

function parseUsedCodes(value: string | null): string[] {
  if (value === null) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}
