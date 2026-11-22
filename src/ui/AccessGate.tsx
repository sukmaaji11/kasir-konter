import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { AuthApplicationService } from "../application/auth";
import type { BackupService } from "../application/backup";
import { RestoreButton } from "./BackupPanel";
import type { LicenseApplicationService } from "../application/license";
import type { AppUser } from "../domain/auth";
import {
  DeviceCodeCard,
  GateLayout,
  LicenseCodeInput,
  PinCreator,
  PinPad,
  SplashScreen,
} from "./AccessScreens";

type GateState =
  | { readonly kind: "checking" }
  | { readonly kind: "activation" }
  | { readonly kind: "owner-setup" }
  | { readonly kind: "login" }
  | { readonly kind: "reset" }
  | { readonly kind: "ready"; readonly user: AppUser };

const MIN_SPLASH_MS = 1200;

/**
 * Alur masuk: splash → aktivasi (sekali per HP) → buat PIN Owner (sekali)
 * → login PIN. Anak komponen baru tampil setelah pengguna masuk.
 */
export function AccessGate({
  auth,
  license,
  backup,
  children,
}: {
  readonly auth: AuthApplicationService;
  readonly license: LicenseApplicationService;
  readonly backup: BackupService;
  readonly children: (user: AppUser, lock: () => void) => ReactNode;
}) {
  const [state, setState] = useState<GateState>({ kind: "checking" });
  const [bootError, setBootError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const started = Date.now();
    void (async () => {
      try {
        const next = await nextState();
        const wait = Math.max(0, MIN_SPLASH_MS - (Date.now() - started));
        window.setTimeout(() => {
          if (active) setState(next);
        }, wait);
      } catch (cause) {
        if (active) setBootError(errorMessage(cause));
      }
    })();
    return () => {
      active = false;
    };
  }, [auth, license]);

  async function nextState(): Promise<GateState> {
    const status = await license.status();
    if (!status.activated) return { kind: "activation" };
    if (!(await auth.hasOwner())) return { kind: "owner-setup" };
    return { kind: "login" };
  }

  async function advance() {
    setState(await nextState());
  }

  if (bootError !== null) {
    return <SplashScreen message={bootError} />;
  }

  switch (state.kind) {
    case "checking":
      return <SplashScreen animate={false} />;
    case "activation":
      return <ActivationScreen license={license} onActivated={() => void advance()} />;
    case "owner-setup":
      return (
        <OwnerSetupScreen
          auth={auth}
          backup={backup}
          onRestored={() => void advance()}
          onCreated={(user) => setState({ kind: "ready", user })}
        />
      );
    case "login":
      return (
        <LoginScreen
          auth={auth}
          onLogin={(user) => setState({ kind: "ready", user })}
          onForgot={() => setState({ kind: "reset" })}
        />
      );
    case "reset":
      return (
        <ResetPinScreen
          auth={auth}
          license={license}
          onDone={(user) => setState({ kind: "ready", user })}
          onCancel={() => setState({ kind: "login" })}
        />
      );
    case "ready":
      // Mengunci = periksa ulang lisensi & Owner (mis. setelah pulihkan cadangan).
      return <>{children(state.user, () => void advance())}</>;
  }
}

function ActivationScreen({
  license,
  onActivated,
}: {
  readonly license: LicenseApplicationService;
  readonly onActivated: () => void;
}) {
  const [deviceCode, setDeviceCode] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void license.deviceCode().then(setDeviceCode, (cause: unknown) => setError(errorMessage(cause)));
  }, [license]);

  async function activate() {
    setBusy(true);
    setError(null);
    try {
      await license.activate(code);
      onActivated();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <GateLayout
      title="Aktivasi aplikasi"
      subtitle="Cukup sekali di HP ini. Setelah aktif, aplikasi bisa dipakai tanpa internet."
    >
      <ol className="gate-steps">
        <li>
          <strong>Kirim Kode perangkat ke Admin</strong>
          {deviceCode === null ? (
            <span className="muted">Membaca kode perangkat…</span>
          ) : (
            <DeviceCodeCard deviceCode={deviceCode} purpose="activation" />
          )}
        </li>
        <li>
          <strong>Tempel Kode aktivasi dari Admin</strong>
          <LicenseCodeInput
            value={code}
            onChange={(value) => {
              setCode(value);
              setError(null);
            }}
            placeholder="Tempel kode aktivasi di sini"
          />
        </li>
      </ol>
      {error !== null && <p className="error-message" role="alert">{error}</p>}
      <button
        className="button button-primary"
        onClick={() => void activate()}
        disabled={busy || code.trim().length === 0}
      >
        {busy ? "Memeriksa kode…" : "Aktifkan"}
      </button>
    </GateLayout>
  );
}

function OwnerSetupScreen({
  auth,
  backup,
  onRestored,
  onCreated,
}: {
  readonly auth: AuthApplicationService;
  readonly backup: BackupService;
  readonly onRestored: () => void;
  readonly onCreated: (user: AppUser) => void;
}) {
  const [name, setName] = useState("");
  const [nameConfirmed, setNameConfirmed] = useState(false);

  if (!nameConfirmed) {
    return (
      <GateLayout
        title="Buat akun Owner"
        subtitle="Owner bisa mencatat HP masuk, mengatur harga, karyawan, dan melihat untung."
      >
        <form
          className="form-grid gate-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim().length > 0) setNameConfirmed(true);
          }}
        >
          <label>
            Nama Owner
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Contoh: Pak Joko"
              maxLength={40}
              required
              autoFocus
            />
          </label>
          <button className="button button-primary">Lanjut buat PIN</button>
        </form>
        <div className="gate-restore">
          <p className="muted small">Pindah dari HP lama? Pakai file cadangan dari HP lama, semua data dan PIN ikut pindah.</p>
          <RestoreButton backup={backup} onRestored={onRestored} label="Pulihkan dari cadangan" quiet />
        </div>
      </GateLayout>
    );
  }

  return (
    <GateLayout title={`PIN untuk ${name.trim()}`} subtitle="PIN dipakai setiap kali membuka aplikasi.">
      <PinCreator
        onCreate={async (pin) => {
          onCreated(await auth.createInitialOwner(name, pin));
        }}
      />
      <button className="button button-quiet" onClick={() => setNameConfirmed(false)}>
        Ubah nama
      </button>
    </GateLayout>
  );
}

function LoginScreen({
  auth,
  onLogin,
  onForgot,
}: {
  readonly auth: AuthApplicationService;
  readonly onLogin: (user: AppUser) => void;
  readonly onForgot: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resetSignal, setResetSignal] = useState(0);

  async function login(pin: string) {
    setBusy(true);
    try {
      onLogin(await auth.login(pin));
    } catch (cause) {
      setError(errorMessage(cause));
      setResetSignal((value) => value + 1);
    } finally {
      setBusy(false);
    }
  }

  return (
    <GateLayout title="Masukkan PIN" subtitle="Owner dan karyawan masuk dengan PIN masing-masing.">
      <PinPad
        onComplete={(pin) => void login(pin)}
        busy={busy}
        error={error}
        resetSignal={resetSignal}
      />
      <button className="button button-quiet" onClick={onForgot}>
        Lupa PIN Owner?
      </button>
    </GateLayout>
  );
}

function ResetPinScreen({
  auth,
  license,
  onDone,
  onCancel,
}: {
  readonly auth: AuthApplicationService;
  readonly license: LicenseApplicationService;
  readonly onDone: (user: AppUser) => void;
  readonly onCancel: () => void;
}) {
  const [deviceCode, setDeviceCode] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [verified, setVerified] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void license.deviceCode().then(setDeviceCode, (cause: unknown) => setError(errorMessage(cause)));
  }, [license]);

  async function verify() {
    setBusy(true);
    setError(null);
    try {
      await license.consumeResetCode(code);
      setVerified(true);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  if (verified) {
    return (
      <GateLayout title="Buat PIN Owner baru" subtitle="Data jualan dan service tidak berubah.">
        <PinCreator
          onCreate={async (pin) => {
            onDone(await auth.resetOwnerPin(pin));
          }}
        />
      </GateLayout>
    );
  }

  return (
    <GateLayout
      title="Lupa PIN Owner"
      subtitle="Minta kode reset ke Admin. Karyawan tidak bisa memakai cara ini."
    >
      <ol className="gate-steps">
        <li>
          <strong>Kirim Kode perangkat ke Admin</strong>
          {deviceCode !== null && <DeviceCodeCard deviceCode={deviceCode} purpose="reset" />}
        </li>
        <li>
          <strong>Tempel Kode reset dari Admin</strong>
          <LicenseCodeInput
            value={code}
            onChange={(value) => {
              setCode(value);
              setError(null);
            }}
            placeholder="Tempel kode reset di sini"
          />
        </li>
      </ol>
      {error !== null && <p className="error-message" role="alert">{error}</p>}
      <button
        className="button button-primary"
        onClick={() => void verify()}
        disabled={busy || code.trim().length === 0}
      >
        {busy ? "Memeriksa kode…" : "Lanjut"}
      </button>
      <button className="button button-quiet" onClick={onCancel}>
        Kembali ke login
      </button>
    </GateLayout>
  );
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Terjadi kendala. Coba lagi.";
}
