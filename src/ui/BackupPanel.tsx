import { useRef, useState } from "react";
import type { BackupService, PreparedRestore } from "../application/backup";
import type { FileSharer } from "../reports/file-share";
import { ErrorText, Sheet, useAction, useLoad } from "./common";
import { dateTimeWib } from "./format";

const DAY_MS = 86_400_000;
/** Lewat dari ini, Owner diingatkan membuat cadangan baru. */
export const BACKUP_REMINDER_DAYS = 7;

/** "Belum pernah" / "Hari ini" / "3 hari lalu". */
export function backupAgeText(lastMs: number | null, nowMs = Date.now()): string {
  if (lastMs === null) return "Belum pernah dibuat";
  const days = Math.floor((nowMs - lastMs) / DAY_MS);
  return days <= 0 ? "Terakhir hari ini" : `Terakhir ${days} hari lalu`;
}

export function backupIsDue(lastMs: number | null, nowMs = Date.now()): boolean {
  return lastMs === null || nowMs - lastMs > BACKUP_REMINDER_DAYS * DAY_MS;
}

/** Halaman Pengaturan → Cadangan & pindah HP (Owner). */
export function BackupPanel({
  backup,
  files,
  dataVersion,
  onRestored,
}: {
  readonly backup: BackupService;
  readonly files: FileSharer;
  readonly dataVersion: number;
  readonly onRestored: () => void;
}) {
  const [exportedAt, setExportedAt] = useState(0);
  // Dibungkus objek: null berarti "belum pernah", bukan "masih memuat".
  const last = useLoad(async () => ({ ms: await backup.lastExportAtMs() }), [backup, dataVersion, exportedAt]);
  const action = useAction();
  const lastMs = last.data?.ms ?? null;
  const due = last.data !== null && backupIsDue(lastMs);

  return (
    <>
      <section className="panel backup-panel">
        <div className={due ? "backup-status warn" : "backup-status"}>
          <strong>{last.data === null ? "…" : backupAgeText(lastMs)}</strong>
          <span>
            {lastMs === null
              ? "Data hanya tersimpan di HP/tablet ini. Kalau HP hilang atau rusak, data ikut hilang."
              : `Cadangan terakhir dibuat ${dateTimeWib(lastMs)}.`}
            {due && lastMs !== null && ` Buat cadangan baru minimal seminggu sekali.`}
          </span>
        </div>
        <p className="muted small">
          Cadangan berisi semua data: HP, nota, service, aksesoris, produk digital, foto, karyawan, dan profil konter.
          Simpan filenya ke Google Drive atau kirim ke WhatsApp sendiri, jangan hanya di HP ini.
        </p>
        <ErrorText error={action.error} />
        <button
          type="button"
          className="button button-primary button-block"
          disabled={action.busy}
          onClick={() =>
            void action.run(async () => {
              const created = await backup.createBackup();
              const shared = await files.share(created.fileName, new TextEncoder().encode(created.content), "application/json");
              if (!shared) return; // lembar Bagikan ditutup: belum tersimpan di mana pun
              await backup.markExported();
              setExportedAt(Date.now());
            })
          }
        >
          {action.busy ? "Menyiapkan cadangan…" : "Buat cadangan sekarang"}
        </button>
      </section>

      <section className="panel">
        <h2 className="panel-title">Pulihkan / pindah ke HP baru</h2>
        <ol className="steps">
          <li>Di HP lama: buka menu ini, tekan <strong>Buat cadangan sekarang</strong>, lalu simpan ke Drive atau kirim ke WA.</li>
          <li>Di HP baru: pasang Kasir Konter dan aktivasi (kirim kode perangkat baru ke WA Admin).</li>
          <li>
            Di layar <strong>Buat akun Owner</strong>, pilih <strong>Pulihkan dari cadangan</strong> (atau pakai tombol di
            bawah ini), lalu pilih file cadangannya.
          </li>
          <li>Masuk dengan PIN lama. Semua PIN karyawan ikut pindah.</li>
        </ol>
        <RestoreButton backup={backup} onRestored={onRestored} label="Pulihkan dari file cadangan" quiet />
      </section>
    </>
  );
}

/** Tombol pilih file cadangan → pratinjau → konfirmasi → pulihkan. */
export function RestoreButton({
  backup,
  onRestored,
  label,
  quiet = false,
}: {
  readonly backup: BackupService;
  readonly onRestored: () => void;
  readonly label: string;
  readonly quiet?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [prepared, setPrepared] = useState<PreparedRestore | null>(null);
  const pick = useAction();
  return (
    <>
      <input
        ref={input}
        type="file"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file === undefined) return;
          void pick.run(async () => setPrepared(await backup.inspect(await file.text())));
        }}
      />
      <ErrorText error={pick.error} />
      <button
        type="button"
        className={quiet ? "button button-secondary button-block" : "button button-primary button-block"}
        disabled={pick.busy}
        onClick={() => input.current?.click()}
      >
        {pick.busy ? "Memeriksa file…" : label}
      </button>
      {prepared !== null && (
        <RestoreConfirmSheet
          backup={backup}
          prepared={prepared}
          onClose={() => setPrepared(null)}
          onRestored={() => {
            setPrepared(null);
            onRestored();
          }}
        />
      )}
    </>
  );
}

function RestoreConfirmSheet({
  backup,
  prepared,
  onClose,
  onRestored,
}: {
  readonly backup: BackupService;
  readonly prepared: PreparedRestore;
  readonly onClose: () => void;
  readonly onRestored: () => void;
}) {
  const [agreed, setAgreed] = useState(false);
  const action = useAction();
  const p = prepared.preview;
  return (
    <Sheet title="Pulihkan cadangan ini?" onClose={onClose}>
      <dl className="detail-list">
        <div><dt>Konter</dt><dd>{p.storeName || "(tanpa nama)"}</dd></div>
        <div><dt>Dibuat</dt><dd>{dateTimeWib(Date.parse(p.exportedAt))}</dd></div>
        <div><dt>HP di stok</dt><dd>{p.phonesInStock}</dd></div>
        <div><dt>Nota jual</dt><dd>{p.sales}</dd></div>
        <div><dt>Service</dt><dd>{p.services}</dd></div>
        <div><dt>Aksesoris</dt><dd>{p.accessories}</dd></div>
        <div><dt>Produk digital</dt><dd>{p.digitalProducts}</dd></div>
        <div><dt>Pengguna</dt><dd>{p.users} (masuk dengan PIN lama)</dd></div>
      </dl>
      <div className="restore-warning">
        <strong>Semua data di HP ini akan diganti</strong> dengan isi cadangan. Lisensi dan printer HP ini tetap. Salinan
        data sebelumnya disimpan otomatis di aplikasi.
      </div>
      <label className="check-label">
        <input type="checkbox" checked={agreed} onChange={(event) => setAgreed(event.target.checked)} />
        Saya mengerti, ganti data HP ini
      </label>
      <ErrorText error={action.error} />
      <div className="button-row">
        <button
          type="button"
          className="button button-danger"
          disabled={!agreed || action.busy}
          onClick={() =>
            void action.run(async () => {
              await backup.restore(prepared);
              onRestored();
            })
          }
        >
          {action.busy ? "Memulihkan…" : "Pulihkan sekarang"}
        </button>
        <button type="button" className="button button-quiet" onClick={onClose} disabled={action.busy}>
          Batal
        </button>
      </div>
    </Sheet>
  );
}
