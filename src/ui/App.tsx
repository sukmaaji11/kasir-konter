import { Capacitor } from "@capacitor/core";
import { useEffect, useState } from "react";
import { AuthApplicationService } from "../application/auth";
import { LicenseApplicationService } from "../application/license";
import type { KonterRepository } from "../data/repository";
import { can, roleLabel, type AppUser } from "../domain/auth";
import { LICENSE_PUBLIC_KEY } from "../licensing/public-key";
import { AccessGate } from "./AccessGate";
import { SplashScreen } from "./AccessScreens";
import { AccessoriesPage } from "./AccessoriesPage";
import { BrandLogo } from "./BrandLogo";
import type { PageContext } from "./context";
import { errorMessage } from "./format";
import { PhonesPage } from "./PhonesPage";
import { loadStoreProfile, type StoreProfile } from "./receipts";
import { ReportPage } from "./ReportPage";
import { SalePage } from "./SalePage";
import { ServicePage } from "./ServicePage";
import { SettingsPage } from "./SettingsPage";
import "./styles.css";

export interface Runtime {
  readonly repo: KonterRepository;
  readonly auth: AuthApplicationService;
  readonly license: LicenseApplicationService;
  readonly isBrowserDevelopment: boolean;
}

export type Tab ="kasir" | "hp" | "service" | "aksesoris" | "laporan" | "pengaturan";

const TABS: readonly { readonly id: Tab; readonly label: string; readonly icon: string }[] = [
  { id: "kasir", label: "Kasir", icon: "🧾" },
  { id: "hp", label: "Stok HP", icon: "📱" },
  { id: "service", label: "Service", icon: "🔧" },
  { id: "aksesoris", label: "Aksesoris", icon: "🎧" },
  { id: "laporan", label: "Untung", icon: "📊" },
  { id: "pengaturan", label: "Pengaturan", icon: "⚙️" },
];

export function App() {
  const [runtime, setRuntime] = useState<Runtime | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    openRuntime().then(setRuntime, (cause: unknown) => setError(errorMessage(cause)));
  }, []);

  if (error !== null) return <SplashScreen message={error} />;
  if (runtime === null) return <SplashScreen />;

  return (
    <AccessGate auth={runtime.auth} license={runtime.license}>
      {(user, lock) => <MainApp runtime={runtime} user={user} lock={lock} />}
    </AccessGate>
  );
}

export function MainApp({
  runtime,
  user,
  lock,
  initialTab = "kasir",
}: {
  readonly runtime: Runtime;
  readonly user: AppUser;
  readonly lock: () => void;
  readonly initialTab?: Tab;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [dataVersion, setDataVersion] = useState(0);
  const [store, setStore] = useState<StoreProfile | null>(null);

  useEffect(() => {
    void loadStoreProfile((key) => runtime.repo.getSetting(key)).then(setStore);
  }, [runtime.repo]);

  if (store === null) return <SplashScreen animate={false} />;

  const ctx: PageContext = {
    repo: runtime.repo,
    auth: runtime.auth,
    license: runtime.license,
    user,
    store,
    dataVersion,
    changed: () => setDataVersion((value) => value + 1),
    lock,
  };
  const tabs = TABS.filter((item) => item.id !== "laporan" || can(user, "viewCostAndProfit"));

  return (
    <div className="app-frame">
      <header className="app-bar">
        <div className="app-bar-inner">
          <BrandLogo size={40} />
          <div className="app-bar-title">
            <div className="brand-name">{store.name.trim() || "Kasir Konter"}</div>
            <div className="brand-caption">
              {user.name} · {roleLabel(user.role)}
            </div>
          </div>
          <button type="button" className="lock-button" onClick={lock} aria-label="Kunci aplikasi">
            🔒
          </button>
        </div>
        <nav className="tab-bar" aria-label="Menu utama">
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              className={item.id === tab ? "tab tab-active" : "tab"}
              aria-current={item.id === tab ? "page" : undefined}
              onClick={() => setTab(item.id)}
            >
              <span aria-hidden="true">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>
      </header>
      {runtime.isBrowserDevelopment && (
        <p className="dev-banner">Mode pengembangan: data hanya di memori dan hilang saat halaman dimuat ulang.</p>
      )}
      <main className="app-content">
        {tab === "kasir" && <SalePage ctx={ctx} />}
        {tab === "hp" && <PhonesPage ctx={ctx} />}
        {tab === "service" && <ServicePage ctx={ctx} />}
        {tab === "aksesoris" && <AccessoriesPage ctx={ctx} />}
        {tab === "laporan" && can(user, "viewCostAndProfit") && <ReportPage ctx={ctx} />}
        {tab === "pengaturan" && <SettingsPage ctx={ctx} onStoreSaved={setStore} />}
      </main>
    </div>
  );
}

async function openRuntime(): Promise<Runtime> {
  if (Capacitor.isNativePlatform()) {
    const { openCapacitorDatabase } = await import("../data/capacitor-sqlite");
    const { Device } = await import("@capacitor/device");
    const opened = await openCapacitorDatabase();
    return {
      repo: opened.repository,
      ...accessServices(opened.repository, async () => (await Device.getId()).identifier),
      isBrowserDevelopment: false,
    };
  }
  if (import.meta.env.DEV) {
    const { openBrowserDevRepository } = await import("../data/browser-dev-repository");
    const opened = await openBrowserDevRepository();
    return {
      repo: opened.repository,
      ...accessServices(opened.repository, async () => browserDeviceId()),
      isBrowserDevelopment: true,
    };
  }
  throw new Error("Aplikasi perlu dijalankan di perangkat Android.");
}

function accessServices(repository: KonterRepository, readDeviceId: () => Promise<string>) {
  return {
    auth: new AuthApplicationService(repository),
    license: new LicenseApplicationService(repository, readDeviceId, LICENSE_PUBLIC_KEY),
  };
}

/** Mode browser (pengembangan): ID acak yang disimpan di localStorage. */
function browserDeviceId(): string {
  const key = "kasir-konter.dev-device-id";
  try {
    const existing = localStorage.getItem(key);
    if (existing !== null) return existing;
    const created = crypto.randomUUID();
    localStorage.setItem(key, created);
    return created;
  } catch {
    return "browser-dev";
  }
}
