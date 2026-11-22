/** Printer Bluetooth yang sudah dipasangkan (paired) di pengaturan HP. */
export interface PairedPrinter {
  readonly name: string;
  readonly address: string;
  /** Android mengenali perangkat sebagai printer/pencitraan. */
  readonly looksLikePrinter: boolean;
}

export interface PairedDevicesResult {
  /** HP punya Bluetooth. */
  readonly available: boolean;
  /** Bluetooth sedang menyala. */
  readonly enabled: boolean;
  readonly devices: readonly PairedPrinter[];
}

export interface PrinterPort {
  listPairedDevices(): Promise<PairedDevicesResult>;
  print(address: string, data: Uint8Array): Promise<void>;
  openBluetoothSettings(): Promise<void>;
}

interface NativeBluetoothPrinter {
  listPairedDevices(): Promise<PairedDevicesResult>;
  print(options: { address: string; data: string }): Promise<void>;
  openBluetoothSettings(): Promise<void>;
}

/** Plugin native di android/app/src/main/java/.../BluetoothPrinterPlugin.java */
export async function createCapacitorPrinterPort(): Promise<PrinterPort> {
  const { registerPlugin } = await import("@capacitor/core");
  const plugin = registerPlugin<NativeBluetoothPrinter>("BluetoothPrinter");
  return {
    listPairedDevices: () => plugin.listPairedDevices(),
    print: (address, data) => plugin.print({ address, data: toBase64(data) }),
    openBluetoothSettings: () => plugin.openBluetoothSettings(),
  };
}

/** Mode browser (pengembangan): struk ditulis ke console. */
export function createConsolePrinterPort(): PrinterPort {
  return {
    async listPairedDevices() {
      return {
        available: true,
        enabled: true,
        devices: [{ name: "Printer contoh (browser)", address: "00:11:22:33:44:55", looksLikePrinter: true }],
      };
    },
    async print(_address, data) {
      const text = Array.from(data, (byte) =>
        byte === 0x0a || (byte >= 0x20 && byte <= 0x7e) ? String.fromCharCode(byte) : "",
      ).join("");
      console.info(`[printer]\n${text}`);
    },
    async openBluetoothSettings() {
      console.info("[printer] buka pengaturan Bluetooth");
    },
  };
}

function toBase64(data: Uint8Array): string {
  let binary = "";
  for (const byte of data) binary += String.fromCharCode(byte);
  return btoa(binary);
}
