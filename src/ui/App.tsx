import { Capacitor } from "@capacitor/core";
import { useEffect, useState } from "react";
import { AuthApplicationService } from "../application/auth";
import { LicenseApplicationService } from "../application/license";
import { PrintingApplicationService } from "../application/printing";
import type { FileSharer } from "../reports/file-share";
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
import { DigitalPage } from "./DigitalPage";
import { HomePage } from "./HomePage";
import { SalesHistoryPage } from "./SalesHistoryPage";
import { useAndroidBack } from "./useAndroidBack";
import { SettingsPage } from "./SettingsPage";
import "./styles.css";

export interface Runtime {
  readonly repo: KonterRepository;
  readonly auth: AuthApplicationService;
  readonly license: LicenseApplicationService;
  readonly printing: PrintingApplicationService;
  readonly files: FileSharer;
  readonly isBrowserDevelopment: boolean;
}

export type Tab =
  | "beranda"
  | "kasir"
  | "service"
  | "laporan"
  | "hp"
  | "aksesoris"
  | "digital"
  | "nota"
  | "pengaturan";

/** Menu bawah. Halaman lain dibuka dari kotak menu di Beranda. */
function bottomTabs(user: AppUser): readonly { readonly id: Tab; readonly label: string; readonly icon: string }[] {
  return [
    { id: "beranda", label: "Beranda", icon: "🏠" },
    { id: "kasir", label: "Kasir", icon: "🧾" },
    { id: "service", label: "Service", icon: "🔧" },
    can(user, "viewCostAndProfit")
      ? { id: "laporan", label: "Laporan", icon: "📊" }
      : { id: "hp", label: "Stok HP", icon: "📱" },
  ];
}

const PAGE_TITLES: Readonly<Record<Tab, string>> = {
  beranda: "Beranda",
  kasir: "Kasir",
  service: "Service",
  laporan: "Laporan untung",
  hp: "Stok HP",
  aksesoris: "Aksesoris",
  digital: "Produk digital",
  nota: "Riwayat nota",
  pengaturan: "Pengaturan",
};

export function App() {
  const [runtime, setRuntime] = useState<Runtime | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    openRuntime().then(setRuntime, (cause: unknown) => setError(errorMessage(cause)));
  }, []);

  if (error !== null) return <SplashScreen message={error} />;
  // Splash HTML di index.html sudah beranimasi; lanjutkan tanpa animasi ulang.
  if (runtime === null) return <SplashScreen animate={false} />;

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
  initialTab = "beranda",
}: {
  readonly runtime: Runtime;
  readonly user: AppUser;
  readonly lock: () => void;
  readonly initialTab?: Tab;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [dataVersion, setDataVersion] = useState(0);
  const [store, setStore] = useState<StoreProfile | null>(null);
  const tabs = bottomTabs(user);
  const isSubpage = !tabs.some((item) => item.id === tab);

  // Tombol Back Android di halaman dari menu Beranda: kembali ke Beranda.
  useAndroidBack(isSubpage, () => setTab("beranda"));

  useEffect(() => {
    void loadStoreProfile((key) => runtime.repo.getSetting(key)).then(setStore);
  }, [runtime.repo]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [tab]);

  if (store === null) return <SplashScreen animate={false} />;

  const ctx: PageContext = {
    repo: runtime.repo,
    auth: runtime.auth,
    license: runtime.license,
    printing: runtime.printing,
    files: runtime.files,
    user,
    store,
    dataVersion,
    changed: () => setDataVersion((value) => value + 1),
    lock,
    open: setTab,
  };

  return (
    <div className="app-frame">
      <header className="app-bar">
        <div className="app-bar-inner">
          {isSubpage ? (
            <>
              <button type="button" className="back-button" onClick={() => setTab("beranda")} aria-label="Kembali ke Beranda">
                ←
              </button>
              <h1 className="app-bar-heading">{PAGE_TITLES[tab]}</h1>
            </>
          ) : (
            <>
              <BrandLogo size={30} />
              <div className="app-bar-title">
                <div className="brand-name">{store.name.trim() || "Kasir Konter"}</div>
                <div className="brand-caption">
                  {user.name} · {roleLabel(user.role)}
                </div>
              </div>
            </>
          )}
          <button type="button" className="lock-button" onClick={lock} aria-label="Kunci aplikasi">
            🔒
          </button>
        </div>
      </header>
      {runtime.isBrowserDevelopment && (
        <p className="dev-banner">Mode pengembangan: data hanya di memori dan hilang saat halaman dimuat ulang.</p>
      )}
      <main className="app-content">
        {tab === "beranda" && <HomePage ctx={ctx} />}
        {tab === "kasir" && <SalePage ctx={ctx} />}
        {tab === "hp" && <PhonesPage ctx={ctx} />}
        {tab === "service" && <ServicePage ctx={ctx} />}
        {tab === "aksesoris" && <AccessoriesPage ctx={ctx} />}
        {tab === "digital" && <DigitalPage ctx={ctx} />}
        {tab === "nota" && <SalesHistoryPage ctx={ctx} />}
        {tab === "laporan" && can(user, "viewCostAndProfit") && <ReportPage ctx={ctx} />}
        {tab === "pengaturan" && <SettingsPage ctx={ctx} onStoreSaved={setStore} />}
      </main>
      <nav className="bottom-nav" aria-label="Menu utama">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            className={item.id === tab ? "nav-item active" : "nav-item"}
            aria-current={item.id === tab ? "page" : undefined}
            onClick={() => setTab(item.id)}
          >
            <span aria-hidden="true">{item.icon}</span>
            {item.label}
          </button>
        ))}
      </nav>
    </div>
  );
}

async function openRuntime(): Promise<Runtime> {
  if (Capacitor.isNativePlatform()) {
    const { openCapacitorDatabase } = await import("../data/capacitor-sqlite");
    const { Device } = await import("@capacitor/device");
    const { createCapacitorPrinterPort } = await import("../printing/printer-port");
    const { createCapacitorFileSharer } = await import("../reports/file-share");
    const opened = await openCapacitorDatabase();
    return {
      repo: opened.repository,
      ...accessServices(opened.repository, async () => (await Device.getId()).identifier),
      printing: new PrintingApplicationService(opened.repository, await createCapacitorPrinterPort()),
      files: await createCapacitorFileSharer(),
      isBrowserDevelopment: false,
    };
  }
  if (import.meta.env.DEV) {
    const { openBrowserDevRepository } = await import("../data/browser-dev-repository");
    const { createConsolePrinterPort } = await import("../printing/printer-port");
    const { createBrowserFileSharer } = await import("../reports/file-share");
    const opened = await openBrowserDevRepository();
    return {
      repo: opened.repository,
      ...accessServices(opened.repository, async () => browserDeviceId()),
      printing: new PrintingApplicationService(opened.repository, createConsolePrinterPort()),
      files: createBrowserFileSharer(),
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
