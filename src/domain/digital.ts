/**
 * Layanan digital konter: pulsa, paket data, kartu perdana, top up
 * e-wallet/game, token listrik, dan transaksi lain (mis. transfer).
 *
 * Untung = harga jual − modal (harga dari server/aplikasi agen).
 * Kartu perdana dan voucher fisik punya stok; yang lain tidak.
 */
export type DigitalCategory = "pulsa" | "kuota" | "perdana" | "topup" | "token" | "lainnya";

export const DIGITAL_CATEGORIES: readonly DigitalCategory[] = [
  "pulsa",
  "kuota",
  "perdana",
  "topup",
  "token",
  "lainnya",
];

export const DIGITAL_CATEGORY_LABELS: Readonly<Record<DigitalCategory, string>> = {
  pulsa: "Pulsa",
  kuota: "Paket data",
  perdana: "Kartu perdana",
  topup: "Top up",
  token: "Token listrik",
  lainnya: "Lainnya",
};

export const DIGITAL_CATEGORY_ICONS: Readonly<Record<DigitalCategory, string>> = {
  pulsa: "📶",
  kuota: "🌐",
  perdana: "💳",
  topup: "👛",
  token: "⚡",
  lainnya: "🔁",
};

/** Label kolom nomor tujuan saat menjual. Null = tidak perlu nomor tujuan. */
export function targetLabel(category: DigitalCategory): string | null {
  switch (category) {
    case "pulsa":
    case "kuota":
      return "Nomor HP tujuan";
    case "topup":
      return "Nomor / ID akun tujuan";
    case "token":
      return "No. meter / ID pelanggan PLN";
    case "lainnya":
      return "Nomor tujuan / keterangan";
    case "perdana":
      return null;
  }
}

/** Kartu perdana defaultnya pakai stok. */
export function defaultTracksStock(category: DigitalCategory): boolean {
  return category === "perdana";
}

export function assertDigitalCategory(value: string): DigitalCategory {
  if (!(DIGITAL_CATEGORIES as readonly string[]).includes(value)) {
    throw new Error("Kategori produk digital tidak dikenal.");
  }
  return value as DigitalCategory;
}
