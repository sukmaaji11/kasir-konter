import type { AuthApplicationService } from "../application/auth";
import type { BackupService } from "../application/backup";
import type { LicenseApplicationService } from "../application/license";
import type { PrintingApplicationService } from "../application/printing";
import type { FileSharer } from "../reports/file-share";
import type { KonterRepository } from "../data/repository";
import type { AppUser } from "../domain/auth";
import type { Tab } from "./App";
import type { StoreProfile } from "./receipts";

/** Semua yang dibutuhkan halaman. `changed()` memicu muat ulang data di semua halaman. */
export interface PageContext {
  readonly repo: KonterRepository;
  readonly auth: AuthApplicationService;
  readonly license: LicenseApplicationService;
  /** Printer nota Bluetooth. */
  readonly printing: PrintingApplicationService;
  /** Simpan/kirim file (PDF laporan). */
  readonly files: FileSharer;
  /** Cadangan & pindah HP. */
  readonly backup: BackupService;
  readonly user: AppUser;
  readonly store: StoreProfile;
  readonly dataVersion: number;
  readonly changed: () => void;
  readonly lock: () => void;
  /** Pindah halaman (dipakai kotak menu Beranda). */
  readonly open: (page: Tab) => void;
}
