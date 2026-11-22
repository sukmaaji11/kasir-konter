/** Samakan dengan versionName di android/app/build.gradle setiap rilis. */
export const APP_VERSION = "0.1";
export const APP_NAME = "Kasir Konter";
export const BRAND_NAME = "Jadicuan";

/**
 * WhatsApp Admin untuk aktivasi & reset PIN (format internasional tanpa "+").
 * Sama dengan Admin Kasir Kaki Lima. Mengubah nomor ini perlu build ulang.
 */
export const ADMIN_WHATSAPP = "628213301250";

/** "+62 821-3301-250" */
export function formatPhoneDisplay(international: string): string {
  const local = international.replace(/^62/, "");
  const groups = local.match(/^(\d{3})(\d{4})(\d+)$/);
  return groups === null ? `+${international}` : `+62 ${groups[1]}-${groups[2]}-${groups[3]}`;
}
