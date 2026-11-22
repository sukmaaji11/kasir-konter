import type { SaleRecord, ServiceOrder } from "../data/repository";
import { encodeEscPos, type PaperWidth } from "../printing/escpos";
import type { PairedDevicesResult, PrinterPort } from "../printing/printer-port";
import {
  buildSaleReceipt,
  buildServiceReceipt,
  buildTestReceipt,
  type CashDetail,
  type ReceiptStore,
} from "../printing/receipt";

/** Pengaturan printer. Kepala/penutup struk memakai Profil konter. */
export interface PrinterSettings {
  /** Alamat MAC printer terpilih; null = belum diatur. */
  readonly printerAddress: string | null;
  readonly printerName: string | null;
  readonly paper: PaperWidth;
  /** Cetak otomatis setiap nota tersimpan / service diambil. */
  readonly autoPrint: boolean;
}

export const DEFAULT_PRINTER_SETTINGS: PrinterSettings = {
  printerAddress: null,
  printerName: null,
  paper: 58,
  autoPrint: false,
};

const SETTINGS_KEY = "printer.settings";

interface SettingsStore {
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string): Promise<void>;
}

export class PrintingApplicationService {
  constructor(
    private readonly settings: SettingsStore,
    private readonly port: PrinterPort,
  ) {}

  async getSettings(): Promise<PrinterSettings> {
    const raw = await this.settings.getSetting(SETTINGS_KEY);
    if (raw === null) return DEFAULT_PRINTER_SETTINGS;
    try {
      return normalizeSettings(JSON.parse(raw) as Partial<PrinterSettings>);
    } catch {
      return DEFAULT_PRINTER_SETTINGS;
    }
  }

  async saveSettings(next: PrinterSettings): Promise<PrinterSettings> {
    const normalized = normalizeSettings(next);
    await this.settings.setSetting(SETTINGS_KEY, JSON.stringify(normalized));
    return normalized;
  }

  listPairedDevices(): Promise<PairedDevicesResult> {
    return this.port.listPairedDevices();
  }

  openBluetoothSettings(): Promise<void> {
    return this.port.openBluetoothSettings();
  }

  /** Cetak tes memakai pengaturan yang sedang diisi (belum tentu tersimpan). */
  async printTest(settings: PrinterSettings, store: ReceiptStore): Promise<void> {
    await this.port.print(requireAddress(settings), encodeEscPos(buildTestReceipt(store, settings.paper)));
  }

  async printSale(input: {
    readonly sale: SaleRecord;
    readonly store: ReceiptStore;
    readonly cashierName: string | null;
    readonly cash?: CashDetail | null;
    readonly reprint?: boolean;
  }): Promise<void> {
    const settings = await this.getSettings();
    const lines = buildSaleReceipt({ ...input, paper: settings.paper });
    await this.port.print(requireAddress(settings), encodeEscPos(lines));
  }

  async printService(order: ServiceOrder, store: ReceiptStore): Promise<void> {
    const settings = await this.getSettings();
    const lines = buildServiceReceipt({ order, store, paper: settings.paper });
    await this.port.print(requireAddress(settings), encodeEscPos(lines));
  }
}

function requireAddress(settings: PrinterSettings): string {
  if (settings.printerAddress === null) {
    throw new Error("Printer belum dipilih. Atur printer di Pengaturan → Printer nota.");
  }
  return settings.printerAddress;
}

function normalizeSettings(value: Partial<PrinterSettings>): PrinterSettings {
  return {
    printerAddress:
      typeof value.printerAddress === "string" && value.printerAddress.length > 0 ? value.printerAddress : null,
    printerName: typeof value.printerName === "string" ? value.printerName : null,
    paper: value.paper === 80 ? 80 : 58,
    autoPrint: value.autoPrint === true,
  };
}

/** Pesan yang mudah dipahami untuk kegagalan cetak dari plugin native. */
export function printErrorMessage(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : "";
  if (message.length > 0) return message;
  return "Nota gagal dicetak. Pastikan printer menyala, kertas ada, dan Bluetooth aktif.";
}
