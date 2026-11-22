import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { PIN_LENGTH } from "../domain/auth";
import { BrandLogo } from "./BrandLogo";
import { ADMIN_WHATSAPP, APP_NAME, BRAND_NAME, formatPhoneDisplay } from "../app-info";
import { openWhatsApp, shareText } from "./whatsapp";

/** Splash pembuka: sama dengan splash Android agar peralihannya mulus. */
/**
 * Splash aplikasi. `animate={false}` dipakai saat splash tampil lagi sesaat
 * (mis. memeriksa lisensi) agar animasi masuk tidak terulang.
 */
export function SplashScreen({
  message,
  animate = true,
}: {
  readonly message?: string;
  readonly animate?: boolean;
}) {
  return (
    <div className={animate ? "splash" : "splash splash-static"} role="status" aria-live="polite">
      <div className="splash-logo">
        <BrandLogo size={112} />
      </div>
      <div className="splash-name">{APP_NAME}</div>
      <div className="splash-tagline">Kasir &amp; catatan konter HP</div>
      <div className="splash-dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      {message !== undefined && <p className="splash-message">{message}</p>}
      <p className="splash-powered">
        Powered by <strong>{BRAND_NAME}</strong>
      </p>
    </div>
  );
}

/** Kerangka layar sebelum masuk aplikasi (aktivasi, buat PIN, login). */
export function GateLayout({
  title,
  subtitle,
  children,
}: {
  readonly title: string;
  readonly subtitle?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <div className="gate">
      <header className="gate-hero">
        <BrandLogo size={64} />
        <div className="gate-brand">{APP_NAME}</div>
      </header>
      <main className="gate-card">
        <h1>{title}</h1>
        {subtitle !== undefined && <p className="muted gate-subtitle">{subtitle}</p>}
        {children}
      </main>
      <p className="powered-by gate-powered">
        Powered by <strong>{BRAND_NAME}</strong>
      </p>
    </div>
  );
}

export function PinPad({
  onComplete,
  busy = false,
  error,
  resetSignal = 0,
}: {
  readonly onComplete: (pin: string) => void;
  readonly busy?: boolean;
  readonly error?: string | null;
  /** Ubah nilainya untuk mengosongkan isian (mis. setelah PIN salah). */
  readonly resetSignal?: number;
}) {
  const [pin, setPin] = useState("");

  useEffect(() => setPin(""), [resetSignal]);

  function press(digit: string) {
    if (busy || pin.length >= PIN_LENGTH) return;
    const next = pin + digit;
    setPin(next);
    if (next.length === PIN_LENGTH) onComplete(next);
  }

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (/^\d$/.test(event.key)) press(event.key);
      else if (event.key === "Backspace") setPin((current) => current.slice(0, -1));
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  });

  return (
    <div className="pin-pad">
      <div
        className={error ? "pin-dots shake" : "pin-dots"}
        aria-label={`${pin.length} dari ${PIN_LENGTH} angka terisi`}
      >
        {Array.from({ length: PIN_LENGTH }, (_, index) => (
          <span key={index} className={index < pin.length ? "filled" : ""} />
        ))}
      </div>
      <p className={error ? "pin-error" : "pin-error empty"} role="alert">
        {busy ? "Memeriksa…" : error ?? " "}
      </p>
      <div className="pin-keys">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((digit) => (
          <button key={digit} type="button" onClick={() => press(digit)} disabled={busy}>
            {digit}
          </button>
        ))}
        <span />
        <button type="button" onClick={() => press("0")} disabled={busy}>
          0
        </button>
        <button
          type="button"
          className="pin-backspace"
          aria-label="Hapus satu angka"
          onClick={() => setPin((current) => current.slice(0, -1))}
          disabled={busy || pin.length === 0}
        >
          ⌫
        </button>
      </div>
    </div>
  );
}

/** Buat PIN baru: isi lalu ulangi. `onCreate` boleh melempar Error (mis. PIN dipakai). */
export function PinCreator({
  onCreate,
  enterLabel = "Buat PIN 6 angka",
  confirmLabel = "Ulangi PIN yang sama",
}: {
  readonly onCreate: (pin: string) => Promise<void>;
  readonly enterLabel?: string;
  readonly confirmLabel?: string;
}) {
  const [firstPin, setFirstPin] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resetSignal, setResetSignal] = useState(0);

  async function handleComplete(pin: string) {
    if (firstPin === null) {
      setFirstPin(pin);
      setError(null);
      setResetSignal((value) => value + 1);
      return;
    }
    if (pin !== firstPin) {
      setFirstPin(null);
      setError("PIN tidak sama. Ulangi dari awal.");
      setResetSignal((value) => value + 1);
      return;
    }
    setBusy(true);
    try {
      await onCreate(pin);
    } catch (cause) {
      setFirstPin(null);
      setError(cause instanceof Error ? cause.message : "PIN belum bisa disimpan.");
      setResetSignal((value) => value + 1);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pin-creator">
      <p className="pin-step">{firstPin === null ? enterLabel : confirmLabel}</p>
      <PinPad
        onComplete={(pin) => void handleComplete(pin)}
        busy={busy}
        error={error}
        resetSignal={resetSignal}
      />
      <p className="muted pin-hint">
        Hindari angka sama semua atau berurutan (mis. 111111, 123456).
      </p>
    </div>
  );
}

export type DeviceCodePurpose = "activation" | "reset";

export function adminRequestMessage(deviceCode: string, purpose: DeviceCodePurpose): string {
  return purpose === "activation"
    ? `Halo Admin ${APP_NAME}, saya mau aktivasi aplikasi.

Kode perangkat: ${deviceCode}
Nama usaha: 

Terima kasih.`
    : `Halo Admin ${APP_NAME}, saya lupa PIN Owner dan butuh kode reset.

Kode perangkat: ${deviceCode}

Terima kasih.`;
}

export function DeviceCodeCard({
  deviceCode,
  purpose,
}: {
  readonly deviceCode: string;
  readonly purpose: DeviceCodePurpose;
}) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const message = adminRequestMessage(deviceCode, purpose);

  async function copy() {
    try {
      await navigator.clipboard.writeText(deviceCode);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  async function share() {
    setError(null);
    try {
      await shareText("Kirim kode perangkat ke Admin", message);
    } catch {
      setError("Tidak bisa membuka menu Bagikan. Salin kode lalu kirim manual.");
    }
  }

  return (
    <div className="device-code-block">
      <div className="device-code">
        <span>Kode perangkat</span>
        <strong>{deviceCode}</strong>
        <button type="button" className="button button-secondary compact-button" onClick={() => void copy()}>
          {copied ? "Tersalin ✓" : "Salin"}
        </button>
      </div>
      <button
        type="button"
        className="button whatsapp-button"
        onClick={() => openWhatsApp(ADMIN_WHATSAPP, message)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 2.5a9.5 9.5 0 0 0-8.2 14.3L2.5 21.5l4.8-1.3A9.5 9.5 0 1 0 12 2.5Z" />
          <path d="M8.6 7.6c.2-.4.5-.4.8-.4h.6c.2 0 .4.1.5.4l.8 1.9c.1.2 0 .5-.1.7l-.6.7c-.1.1-.2.3 0 .5.7 1.2 1.7 2.1 2.9 2.7.2.1.4.1.5-.1l.7-.8c.2-.2.4-.2.6-.1l1.9.9c.2.1.4.3.3.5 0 .7-.4 1.6-1.2 1.9-.8.4-1.8.4-3.5-.4a10 10 0 0 1-4.3-4.3c-.7-1.5-.4-2.6-.4-2.6Z" />
        </svg>
        Kirim ke Admin via WhatsApp
      </button>
      <div className="device-code-alt">
        <span className="muted">Admin: {formatPhoneDisplay(ADMIN_WHATSAPP)}</span>
        <button type="button" className="text-button" onClick={() => void share()}>
          Bagikan lewat aplikasi lain…
        </button>
      </div>
      {error !== null && <p className="error-message" role="alert">{error}</p>}
    </div>
  );
}

export function LicenseCodeInput({
  value,
  onChange,
  placeholder,
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly placeholder: string;
}) {
  return (
    <textarea
      className="license-input"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      rows={4}
      autoCapitalize="characters"
      autoComplete="off"
      autoCorrect="off"
      spellCheck={false}
    />
  );
}
