import { Capacitor } from "@capacitor/core";

export function whatsAppUrl(phone: string, text: string): string {
  return `https://wa.me/${phone.replace(/\D/g, "")}?text=${encodeURIComponent(text)}`;
}

/**
 * Buka chat WhatsApp dengan pesan terisi. Di Android, Capacitor meneruskan
 * tautan luar ke aplikasi WhatsApp (atau browser bila WhatsApp tidak ada).
 */
export function openWhatsApp(phone: string, text: string): void {
  const url = whatsAppUrl(phone, text);
  if (Capacitor.isNativePlatform()) {
    window.location.href = url;
  } else {
    window.open(url, "_blank", "noopener");
  }
}

/** Lembar Bagikan Android (WhatsApp Business, Telegram, SMS, …). */
export async function shareText(title: string, text: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    const { Share } = await import("@capacitor/share");
    try {
      await Share.share({ title, text, dialogTitle: title });
    } catch (error) {
      if (error instanceof Error && /cancel/i.test(error.message)) return;
      throw error;
    }
    return;
  }
  if (typeof navigator.share === "function") {
    await navigator.share({ title, text });
    return;
  }
  await navigator.clipboard.writeText(text);
}
