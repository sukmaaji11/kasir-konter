import { useState } from "react";
import { APP_VERSION } from "../app-info";
import { can, roleLabel } from "../domain/auth";
import { PinCreator } from "./AccessScreens";
import { PrinterSettingsPanel } from "./PrinterSettings";
import { EmptyState, ErrorText, Sheet, useAction, useLoad } from "./common";
import type { PageContext } from "./context";
import type { StoreProfile } from "./receipts";

export function SettingsPage({
  ctx,
  onStoreSaved,
}: {
  readonly ctx: PageContext;
  readonly onStoreSaved: (profile: StoreProfile) => void;
}) {
  const isOwner = can(ctx.user, "manageUsers");
  const [changingPin, setChangingPin] = useState(false);
  const [pinSaved, setPinSaved] = useState(false);

  return (
    <div className="page settings-page">
      {isOwner && <StoreProfileForm ctx={ctx} onSaved={onStoreSaved} />}
      {isOwner && <PrinterSettingsPanel ctx={ctx} />}
      {isOwner && <UsersSection ctx={ctx} />}

      <section className="panel">
        <h2 className="panel-title">Akun saya</h2>
        <p>
          {ctx.user.name} · {roleLabel(ctx.user.role)}
        </p>
        {pinSaved && <p className="success-text">PIN baru tersimpan.</p>}
        <div className="button-row">
          <button type="button" className="button button-secondary" onClick={() => setChangingPin(true)}>
            Ganti PIN saya
          </button>
          <button type="button" className="button button-quiet" onClick={ctx.lock}>
            Kunci aplikasi
          </button>
        </div>
      </section>

      <LicenseSection ctx={ctx} />

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
    </div>
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
      <h2 className="panel-title">Profil konter</h2>
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
      <h2 className="panel-title">Pengguna</h2>
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

function LicenseSection({ ctx }: { readonly ctx: PageContext }) {
  const info = useLoad(
    async () => ({ status: await ctx.license.status(), deviceCode: await ctx.license.deviceCode() }),
    [ctx.license],
  );
  return (
    <section className="panel">
      <h2 className="panel-title">Tentang aplikasi</h2>
      <dl className="detail-list">
        <div><dt>Versi</dt><dd>{APP_VERSION}</dd></div>
        <div><dt>Kode perangkat</dt><dd>{info.data?.deviceCode ?? "…"}</dd></div>
        <div>
          <dt>Lisensi</dt>
          <dd>
            {info.data === null
              ? "…"
              : info.data.status.activated
                ? `Aktif sejak ${info.data.status.activatedOn}`
                : "Belum aktif"}
          </dd>
        </div>
      </dl>
    </section>
  );
}
