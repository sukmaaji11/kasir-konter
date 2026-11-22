import { useEffect, useState } from "react";
import { printErrorMessage, type PrinterSettings } from "../application/printing";
import type { PairedDevicesResult } from "../printing/printer-port";
import { Chips } from "./common";
import type { PageContext } from "./context";
import { PrinterIcon } from "./NotaSheets";

/** Owner memilih printer Bluetooth, lebar kertas, dan cetak otomatis. */
export function PrinterSettingsPanel({ ctx }: { readonly ctx: PageContext }) {
  const printing = ctx.printing;
  const [draft, setDraft] = useState<PrinterSettings | null>(null);
  const [devices, setDevices] = useState<PairedDevicesResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState<"save" | "test" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void printing.getSettings().then(setDraft, (cause: unknown) => setError(printErrorMessage(cause)));
  }, [printing]);

  function update(patch: Partial<PrinterSettings>) {
    setDraft((current) => (current === null ? current : { ...current, ...patch }));
    setNotice(null);
    setError(null);
  }

  async function searchPrinters() {
    setSearching(true);
    setError(null);
    setNotice(null);
    try {
      setDevices(await printing.listPairedDevices());
    } catch (cause) {
      setError(printErrorMessage(cause));
    } finally {
      setSearching(false);
    }
  }

  async function save() {
    if (draft === null) return;
    setBusy("save");
    setError(null);
    try {
      setDraft(await printing.saveSettings(draft));
      setNotice("Pengaturan printer tersimpan.");
    } catch (cause) {
      setError(printErrorMessage(cause));
    } finally {
      setBusy(null);
    }
  }

  async function testPrint() {
    if (draft === null) return;
    setBusy("test");
    setError(null);
    setNotice(null);
    try {
      await printing.printTest(draft, ctx.store);
      setNotice("Struk tes terkirim. Kalau hasilnya rapi, tekan Simpan.");
    } catch (cause) {
      setError(printErrorMessage(cause));
    } finally {
      setBusy(null);
    }
  }

  if (draft === null) {
    return (
      <section className="panel">
        <h2 className="panel-title">Printer nota</h2>
        <p className="muted">{error ?? "Memuat pengaturan printer…"}</p>
      </section>
    );
  }

  return (
    <section className="panel printer-settings" id="printer-settings">
      <h2 className="panel-title">Printer nota (Bluetooth)</h2>
      <div className={draft.printerAddress === null ? "printer-status empty" : "printer-status"}>
        <span className="printer-status-icon">
          <PrinterIcon />
        </span>
        <div>
          <strong>{draft.printerName ?? "Belum ada printer"}</strong>
          <small>{draft.printerAddress ?? "Pilih printer agar nota bisa dicetak."}</small>
        </div>
      </div>

      <ol className="printer-steps muted small">
        <li>Nyalakan printer thermal, lalu pasangkan (pair) di pengaturan Bluetooth HP/tablet. PIN biasanya 0000 atau 1234.</li>
        <li>Kembali ke sini, tekan <strong>Cari printer</strong>, lalu pilih printernya.</li>
      </ol>

      <div className="button-row">
        <button type="button" className="button button-secondary" onClick={() => void searchPrinters()} disabled={searching}>
          {searching ? "Mencari…" : "Cari printer"}
        </button>
        <button
          type="button"
          className="button button-quiet"
          onClick={() => void printing.openBluetoothSettings().catch((cause: unknown) => setError(printErrorMessage(cause)))}
        >
          Buka pengaturan Bluetooth
        </button>
      </div>

      {devices !== null && !devices.available && <p className="inline-note">Perangkat ini tidak punya Bluetooth.</p>}
      {devices !== null && devices.available && !devices.enabled && (
        <p className="inline-note">Bluetooth mati. Nyalakan dulu, lalu tekan Cari printer lagi.</p>
      )}
      {devices !== null && devices.enabled && devices.devices.length === 0 && (
        <p className="inline-note">Belum ada perangkat yang dipasangkan. Pasangkan printer di pengaturan Bluetooth.</p>
      )}
      {devices !== null && devices.devices.length > 0 && (
        <div className="printer-list" role="radiogroup" aria-label="Printer yang dipasangkan">
          {devices.devices.map((device) => {
            const selected = device.address === draft.printerAddress;
            return (
              <button
                key={device.address}
                type="button"
                role="radio"
                aria-checked={selected}
                className={selected ? "printer-option selected" : "printer-option"}
                onClick={() => update({ printerAddress: device.address, printerName: device.name })}
              >
                <span>
                  <strong>{device.name}</strong>
                  <small>{device.address}</small>
                </span>
                {device.looksLikePrinter && <span className="badge badge-blue">Printer</span>}
              </button>
            );
          })}
        </div>
      )}

      <span className="field-label">Lebar kertas</span>
      <Chips
        value={String(draft.paper) as "58" | "80"}
        onChange={(value) => update({ paper: value === "80" ? 80 : 58 })}
        label="Lebar kertas"
        options={[
          { value: "58", label: "58 mm (kecil)" },
          { value: "80", label: "80 mm (besar)" },
        ]}
      />

      <label className="toggle-row">
        <input type="checkbox" checked={draft.autoPrint} onChange={(event) => update({ autoPrint: event.target.checked })} />
        <span>
          <strong>Cetak otomatis setelah bayar</strong>
          <small className="muted">Nota jual dan nota service langsung tercetak. Kalau mati, cetak lewat tombol Cetak nota.</small>
        </span>
      </label>
      <p className="muted small">Kepala nota memakai nama, alamat, dan WA di Profil konter; catatan garansi tampil di bawah nota.</p>

      {error !== null && <p className="error-message" role="alert">{error}</p>}
      {notice !== null && <p className="inline-note success" role="status">{notice}</p>}

      <div className="button-row">
        <button type="button" className="button button-secondary" onClick={() => void testPrint()} disabled={busy !== null || draft.printerAddress === null}>
          {busy === "test" ? "Mencetak…" : "Cetak tes"}
        </button>
        <button type="button" className="button button-primary" onClick={() => void save()} disabled={busy !== null}>
          {busy === "save" ? "Menyimpan…" : "Simpan pengaturan printer"}
        </button>
      </div>
    </section>
  );
}
