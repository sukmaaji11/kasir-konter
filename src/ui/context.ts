import type { AuthApplicationService } from "../application/auth";
import type { LicenseApplicationService } from "../application/license";
import type { KonterRepository } from "../data/repository";
import type { AppUser } from "../domain/auth";
import type { StoreProfile } from "./receipts";

/** Semua yang dibutuhkan halaman. `changed()` memicu muat ulang data di semua halaman. */
export interface PageContext {
  readonly repo: KonterRepository;
  readonly auth: AuthApplicationService;
  readonly license: LicenseApplicationService;
  readonly user: AppUser;
  readonly store: StoreProfile;
  readonly dataVersion: number;
  readonly changed: () => void;
  readonly lock: () => void;
}
