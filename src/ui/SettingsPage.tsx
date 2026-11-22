import { useState, type ReactNode } from "react";
import { ADMIN_WHATSAPP, APP_NAME, APP_VERSION, BRAND_NAME, formatPhoneDisplay } from "../app-info";
import { can, roleLabel } from "../domain/auth";
import { PinCreator } from "./AccessScreens";
import { BrandLogo } from "./BrandLogo";
import { PrinterSettingsPanel } from "./PrinterSettings";
import { EmptyState, ErrorText, Sheet, useAction, useLoad } from "./common";
import type { PageContext } from "./context";
import type { StoreProfile } from "./receipts";
import { useAndroidBack } from "./useAndroidBack";

type SettingsSubpage = "profil" | "pengguna" | "printer" | "akun" | "lisensi" | "tentang";

const TITLES: Readonly<Record<SettingsSubpage, string>> = {
  profil: "Profil konter",
  pengguna: "Owner & karyawan",
  printer: "Printer nota",
  akun: "Akun & PIN saya",
  lisensi: "Lisensi",
  tentang: "Tentang aplikasi",
};

const ICONS: Readonly<Record<SettingsSubpage, ReactNode>> = {
  profil: (
    <>
      <path d="M4 9.5 5.5 4h13L20 9.5" />
      <path d="M4 9.5a2.67 2.67 0 0 0 5.33 0 2.67 2.67 0 0 0 5.34 0 2.67 2.67 0 0 0 5.33 0" />
      <path d="M5.5 12.5V20h13v-7.5" />
    </>
  ),
  pengguna: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5" />
      <path d="M16 4.8a3.3 3.3 0 0 1 0 6.4M18.5 14.8c1.7.7 2.7 2.4 3 5.2" />
    </>
  ),
  printer: (
    <>
      <path d="M6 9V3h12v6" />
      <rect x="3" y="9" width="18" height="8" rx="2" />
      <path d="M7 14h10v7H7z" />
    </>
  ),
  akun: (
    <>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
      <path d="M12 14.5v2.5" />
    </>
  ),
  lisensi: (
    <>
      <path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.9 7.5-9.5V6z" />
      <path d="m8.8 12 2.2 2.2 4.4-4.4" />
    </>
  ),
  tentang: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6M12 7.5v.01" />
    </>
  ),
};

/** Pengaturan bergaya Kasir Kaki Lima: menu berkelompok, tiap bagian di halaman sendiri. */
export function SettingsPage({
  ctx,
  onStoreSaved,
}: {
  readonly ctx: PageContext;
  readonly onStoreSaved: (profile: StoreProfile) => void;
}) {
  const isOwner = can(ctx.user, "manageUsers");
  const [page, setPage] = useState<SettingsSubpage | null>(null);
  useAndroidBack(page !== null, () => setPage(null));

  const summary = useLoad(async () => {
    const users = await ctx.auth.listActiveUsers();
    const printer = await ctx.printing.getSettings();
    const license = await ctx.license.status();
    return { users, printer, license };
  }, [ctx.auth, ctx.printing, ctx.license, ctx.dataVersion, page]);

  if (page !== null) {
    return (
      <div className="page settings-page">
        <SettingsBackBar title={TITLES[page]} onBack={() => setPage(null)} />
        {page === "profil" && <StoreProfileForm ctx={ctx} onSaved={onStoreSaved} />}
        {page === "pengguna" && <UsersSection ctx={ctx} />}
        {page === "printer" && <PrinterSettingsPanel ctx={ctx} />}
        {page === "akun" && <AccountSection ctx={ctx} />}
        {page === "lisensi" && <LicenseSection ctx={ctx} />}
        {page === "tentang" && <AboutPanel />}
      </div>
    );
  }

  const s = summary.data;
  const staffCount = s?.users.filter((user) => user.role === "staff").length ?? 0;
  const storeName = ctx.store.name.trim();
  const phone = ctx.store.phone.trim();
  const details: Readonly<Record<SettingsSubpage, { readonly text: string; readonly warn?: boolean }>> = {
    profil: storeName ? { text: phone ? `${storeName} · WA ${phone}` : storeName } : { text: "Belum diisi", warn: true },
    pengguna: { text: s === null ? "…" : staffCount === 0 ? "Belum ada karyawan" : `${staffCount} karyawan` },
    printer:
      s === null
        ? { text: "…" }
        : s.printer.printerAddress === null
          ? { text: "Belum diatur", warn: true }
          : { text: `${s.printer.printerName ?? "Printer"} · ${s.printer.paper} mm${s.printer.autoPrint ? " · cetak otomatis" : ""}` },
    akun: { text: `${ctx.user.name} · ${roleLabel(ctx.user.role)} · ganti PIN` },
    lisensi: s === null ? { text: "…" } : s.license.activated ? { text: `Aktif sejak ${s.license.activatedOn}` } : { text: "Belum aktif", warn: true },
    tentang: { text: `Versi ${APP_VERSION}` },
  };

  const groups: readonly { readonly label: string; readonly items: readonly SettingsSubpage[] }[] = [
    ...(isOwner ? [{ label: "Konter", items: ["profil", "pengguna", "printer"] as const }] : []),
    { label: "Akun", items: ["akun"] },
    { label: "Data & aplikasi", items: ["lisensi", "tentang"] },
  ];

  return (
    <section className="page settings-menu">
      <ErrorText error={summary.error} />
      {groups.map((group) => (
        <div className="settings-group" key={group.label}>
          <p className="settings-group-label">{group.label}</p>
          <div className="settings-list">
            {group.items.map((key) => {
              const detail = details[key];
              return (
                <button key={key} type="button" className="settings-item" onClick={() => setPage(key)}>
                  <span className="settings-item-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24">{ICONS[key]}</svg>
                  </span>
                  <span className="settings-item-text">
                    <strong>{TITLES[key]}</strong>
                    <small className={detail.warn ? "warn" : undefined}>{detail.text}</small>
                  </span>
                  <span className="settings-item-chevron" aria-hidden="true">
                    <svg viewBox="0 0 24 24">
                      <path d="m9 6 6 6-6 6" />
                    </svg>
                  </span>
                </button>
              );
            })}
            {group.label === "Akun" && (
              <button type="button" className="settings-item" onClick={ctx.lock}>
                <span className="settings-item-icon danger" aria-hidden="true">
                  <svg viewBox="0 0 24 24">
                    <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" />
                    <path d="M10 17l-5-5 5-5M5 12h11" />
                  </svg>
                </span>
                <span className="settings-item-text">
                  <strong>Kunci aplikasi</strong>
                  <small>Kembali ke layar PIN (ganti pengguna)</small>
                </span>
              </button>
            )}
          </div>
        </div>
      ))}
      <p className="powered-by settings-powered">
        {APP_NAME} v{APP_VERSION} · Powered by <strong>{BRAND_NAME}</strong>
      </p>
    </section>
  );
}

/** Baris "‹ Pengaturan" di atas setiap sub-halaman. */
function SettingsBackBar({ title, onBack }: { readonly title: string; readonly onBack: () => void }) {
  return (
    <div className="settings-backbar">
      <button type="button" className="settings-back" onClick={onBack} aria-label="Kembali ke Pengaturan">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="m15 6-6 6 6 6" />
        </svg>
      </button>
      <div>
        <small>Pengaturan</small>
        <strong>{title}</strong>
      </div>
    </div>
  );
}

function AccountSection({ ctx }: { readonly ctx: PageContext }) {
  const [changingPin, setChangingPin] = useState(false);
  const [pinSaved, setPinSaved] = useState(false);
  return (
    <section className="panel">
      <dl className="detail-list">
        <div><dt>Nama</dt><dd>{ctx.user.name}</dd></div>
        <div><dt>Peran</dt><dd>{roleLabel(ctx.user.role)}</dd></div>
      </dl>
      <p className="muted small">PIN dipakai setiap membuka aplikasi. Jangan berikan PIN ke orang lain.</p>
      {pinSaved && <p className="inline-note success">PIN baru tersimpan.</p>}
      <div className="button-row">
        <button type="button" className="button button-primary" onClick={() => setChangingPin(true)}>
          Ganti PIN saya
        </button>
        <button type="button" className="button button-quiet" onClick={ctx.lock}>
          Kunci aplikasi
        </button>
      </div>
      {changingPin && (
        <Sheet title="PIN baru" onClose={() => setChangingPin(false)}>
          <PinCreator
            onCreate={async (pin) => {
              await ctx.auth.changePin(ctx.user, ctx.user.id, pin);
              setChangingPin(false);
              setPinSaved(true);
            }}
          />
        </Sheet>
      )}
    </section>
  );
}

function AboutPanel() {
  return (
    <section className="panel about-panel">
      <BrandLogo size={88} />
      <div className="about-name">
        <h2>{APP_NAME}</h2>
        <span className="muted">Versi {APP_VERSION}</span>
      </div>
      <p className="muted">
        Kasir dan catatan konter HP: jual beli HP per IMEI, tukar tambah, service, aksesoris, dan layanan digital.
        Untung per HP, per hari, dan per bulan langsung terlihat, semuanya tanpa internet.
      </p>
      <div className="about-brand">
        <span>Powered by</span>
        <strong>{BRAND_NAME}</strong>
      </div>
      <p className="muted small">Bantuan &amp; aktivasi: WA Admin {formatPhoneDisplay(ADMIN_WHATSAPP)}</p>
      <p className="muted about-copy">
        © {new Date().getFullYear()} {BRAND_NAME}. Semua hak dilindungi.
      </p>
    </section>
  );
}

function LicenseSection({ ctx }: { readonly ctx: PageContext }) {
  const info = useLoad(
    async () => ({ status: await ctx.license.status(), deviceCode: await ctx.license.deviceCode() }),
    [ctx.license],
  );
  return (
    <section className="panel">
      <dl className="detail-list">
        <div>
          <dt>Status</dt>
          <dd>
            {info.data === null
              ? "…"
              : info.data.status.activated
                ? `Aktif sejak ${info.data.status.activatedOn}`
                : "Belum aktif"}
          </dd>
        </div>
        <div><dt>Kode perangkat</dt><dd>{info.data?.deviceCode ?? "…"}</dd></div>
      </dl>
      <p className="muted small">
        Lisensi berlaku untuk perangkat ini. Kalau ganti HP/tablet, kirim kode perangkat baru ke WA Admin{" "}
        {formatPhoneDisplay(ADMIN_WHATSAPP)} untuk aktivasi ulang.
      </p>
    </section>
  );
}

function StoreProfileForm({
  ctx,
  onSaved,
}: {
  readonly ctx: PageContext;
  readonly onSaved: (profile: StoreProfile) => void;
}) {
  const [form, setForm] = useState<StoreProfile>(ctx.store);
  const [saved, setSaved] = useState(false);
  const action = useAction();
  const set = (key: keyof StoreProfile) => (value: string) => {
    setForm({ ...form, [key]: value });
    setSaved(false);
  };

  return (
    <section className="panel">
      <p className="muted small">Tampil di nota dan tanda terima service yang dikirim ke pelanggan.</p>
      <div className="form-grid two">
        <label>
          Nama konter
          <input value={form.name} onChange={(e) => set("name")(e.target.value)} placeholder="Konter Maju Jaya" maxLength={60} />
        </label>
        <label>
          No. WA konter
          <input inputMode="tel" value={form.phone} onChange={(e) => set("phone")(e.target.value)} placeholder="0812…" maxLength={20} />
        </label>
        <label className="span-2">
          Alamat
          <input value={form.address} onChange={(e) => set("address")(e.target.value)} maxLength={120} />
        </label>
        <label className="span-2">
          Catatan di bawah nota
          <input value={form.footer} onChange={(e) => set("footer")(e.target.value)} placeholder="Garansi toko 7 hari (segel tidak rusak)" maxLength={160} />
        </label>
      </div>
      <ErrorText error={action.error} />
      {saved && <p className="success-text">Tersimpan.</p>}
      <button
        type="button"
        className="button button-primary"
        disabled={action.busy}
        onClick={() =>
          void action.run(async () => {
            await ctx.repo.setSetting("store.profile", JSON.stringify(form));
            onSaved(form);
            setSaved(true);
          })
        }
      >
        Simpan profil
      </button>
    </section>
  );
}

function UsersSection({ ctx }: { readonly ctx: PageContext }) {
  const users = useLoad(() => ctx.auth.listActiveUsers(), [ctx.auth, ctx.dataVersion]);
  const [adding, setAdding] = useState(false);
  const [staffName, setStaffName] = useState("");
  const [nameConfirmed, setNameConfirmed] = useState(false);
  const [renaming, setRenaming] = useState<{ readonly id: string; readonly name: string } | null>(null);
  const action = useAction();

  function closeAdd() {
    setAdding(false);
    setStaffName("");
    setNameConfirmed(false);
  }

  return (
    <section className="panel">
      <p className="muted small">
        Karyawan bisa jualan, service, dan melihat stok. Harga modal, untung, HP masuk, dan pembatalan nota hanya untuk Owner.
      </p>
      <ErrorText error={users.error ?? action.error} />
      {users.data === null ? (
        <EmptyState>Memuat…</EmptyState>
      ) : (
        <ul className="card-list">
          {users.data.map((user) => (
            <li key={user.id} className="list-card static">
              <span className="list-card-main">
                <strong>{user.name}</strong>
                <span className="muted">{roleLabel(user.role)}</span>
              </span>
              <span className="button-row">
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setRenaming({ id: user.id, name: user.name })}
                >
                  Ubah nama
                </button>
                {user.role === "staff" && (
                  <button
                    type="button"
                    className="text-button danger"
                    disabled={action.busy}
                    onClick={() =>
                      void action.run(async () => {
                        await ctx.auth.archiveStaff(ctx.user, user.id);
                        ctx.changed();
                      })
                    }
                  >
                    Nonaktifkan
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="button button-secondary" onClick={() => setAdding(true)}>
        + Tambah karyawan
      </button>

      {renaming !== null && (
        <Sheet title="Ubah nama pengguna" onClose={() => setRenaming(null)}>
          <form
            className="form-grid"
            onSubmit={(event) => {
              event.preventDefault();
              void action.run(async () => {
                await ctx.auth.renameUser(ctx.user, renaming.id, renaming.name);
                setRenaming(null);
                ctx.changed();
              });
            }}
          >
            <label>
              Nama
              <input
                value={renaming.name}
                onChange={(e) => setRenaming({ ...renaming, name: e.target.value })}
                maxLength={40}
                autoFocus
              />
            </label>
            <ErrorText error={action.error} />
            <button className="button button-primary" disabled={action.busy}>
              Simpan nama
            </button>
          </form>
        </Sheet>
      )}

      {adding && (
        <Sheet title={nameConfirmed ? `PIN untuk ${staffName.trim()}` : "Tambah karyawan"} onClose={closeAdd}>
          {!nameConfirmed ? (
            <form
              className="form-grid"
              onSubmit={(event) => {
                event.preventDefault();
                if (staffName.trim()) setNameConfirmed(true);
              }}
            >
              <label>
                Nama karyawan
                <input value={staffName} onChange={(e) => setStaffName(e.target.value)} maxLength={40} autoFocus />
              </label>
              <button className="button button-primary">Lanjut buat PIN</button>
            </form>
          ) : (
            <PinCreator
              enterLabel="Buat PIN 6 angka untuk karyawan"
              onCreate={async (pin) => {
                await ctx.auth.addStaff(ctx.user, staffName, pin);
                closeAdd();
                ctx.changed();
              }}
            />
          )}
        </Sheet>
      )}
    </section>
  );
}

