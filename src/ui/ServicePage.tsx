import { useState } from "react";
import type { ServiceOrder } from "../data/repository";
import { can } from "../domain/auth";
import type { PaymentMethod } from "../domain/sales";
import { SERVICE_STATUS_LABELS, type ServiceStatus } from "../domain/service";
import { CurrencyInput } from "./CurrencyInput";
import { Chips, EmptyState, ErrorText, Sheet, useAction, useLoad } from "./common";
import type { PageContext } from "./context";
import { ageLabel, dateTimeWib, digitsToRupiah, rp, rpSigned, rupiahToDigits } from "./format";
import { serviceReceiptText, serviceStatusMessage } from "./receipts";
import { openWhatsApp, shareText } from "./whatsapp";

type Filter = "semua" | Exclude<ServiceStatus, "diambil">;

export const PAYMENT_OPTIONS = [
  { value: "tunai", label: "Tunai" },
  { value: "transfer", label: "Transfer" },
  { value: "qris", label: "QRIS" },
] as const;

export const STATUS_BADGE: Readonly<Record<ServiceStatus, string>> = {
  proses: "badge badge-amber",
  selesai: "badge badge-green",
  batal: "badge badge-red",
  diambil: "badge badge-muted",
};

export function ServicePage({ ctx }: { readonly ctx: PageContext }) {
  const orders = useLoad(() => ctx.repo.listOpenServices(), [ctx.repo, ctx.dataVersion]);
  const [filter, setFilter] = useState<Filter>("semua");
  const [creating, setCreating] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [paying, setPaying] = useState<ServiceOrder | null>(null);
  const [paid, setPaid] = useState<ServiceOrder | null>(null);

  const all = orders.data ?? [];
  const count = (status: ServiceStatus) => all.filter((order) => order.status === status).length;
  const query = search.trim().toLowerCase();
  const list = all.filter(
    (order) =>
      (filter === "semua" || order.status === filter) &&
      (query === "" ||
        order.customerName.toLowerCase().includes(query) ||
        order.device.toLowerCase().includes(query) ||
        order.number.toLowerCase().includes(query)),
  );
  const selected = all.find((order) => order.id === selectedId) ?? null;

  return (
    <div className="page">
      <div className="toolbar">
        <Chips
          value={filter}
          onChange={setFilter}
          label="Saring status"
          options={[
            { value: "semua", label: `Belum diambil (${all.length})` },
            { value: "proses", label: `Dikerjakan (${count("proses")})` },
            { value: "selesai", label: `Selesai (${count("selesai")})` },
            { value: "batal", label: `Batal (${count("batal")})` },
          ]}
        />
      </div>
      <div className="toolbar">
        <input
          className="search-input"
          type="search"
          placeholder="Cari nama, HP, atau nomor service…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <button type="button" className="button button-primary" onClick={() => setCreating(true)}>
          + Service baru
        </button>
      </div>
      <ErrorText error={orders.error} />
      {list.length === 0 ? (
        <EmptyState>{all.length === 0 ? "Tidak ada HP service yang belum diambil." : "Tidak ada yang cocok."}</EmptyState>
      ) : (
        <ul className="card-list">
          {list.map((order) => (
            <li key={order.id}>
              <button type="button" className="list-card" onClick={() => setSelectedId(order.id)}>
                <span className="list-card-main">
                  <strong>
                    {order.customerName} · {order.device}
                  </strong>
                  <span className="muted">{order.complaint}</span>
                  <span className="badges">
                    <span className={STATUS_BADGE[order.status]}>{SERVICE_STATUS_LABELS[order.status]}</span>
                    <span className="badge badge-muted">{order.number}</span>
                    <span className="badge badge-muted">masuk {ageLabel(order.receivedAtMs)}</span>
                  </span>
                </span>
                <span className="list-card-side">
                  {order.totalChargeRupiah !== null ? (
                    <strong>{rp(order.totalChargeRupiah)}</strong>
                  ) : order.estimateRupiah !== null ? (
                    <span className="muted">± {rp(order.estimateRupiah)}</span>
                  ) : null}
                  {order.depositRupiah > 0n && <span className="muted">DP {rp(order.depositRupiah)}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {creating && (
        <NewServiceSheet
          ctx={ctx}
          onClose={() => setCreating(false)}
          onCreated={(order) => {
            setCreating(false);
            ctx.changed();
            setSelectedId(order.id);
          }}
        />
      )}
      {selected !== null && paying === null && (
        <ServiceDetailSheet ctx={ctx} order={selected} onClose={() => setSelectedId(null)} onPay={() => setPaying(selected)} />
      )}
      {paying !== null && (
        <ServicePaySheet
          ctx={ctx}
          order={paying}
          onClose={() => setPaying(null)}
          onPaid={(order) => {
            setPaying(null);
            setSelectedId(null);
            setPaid(order);
          }}
        />
      )}
      {paid !== null && <ServiceDoneSheet ctx={ctx} order={paid} onClose={() => setPaid(null)} />}
    </div>
  );
}

/** Bayar sisa service dan serahkan HP. Dipakai di halaman Service dan Kasir. */
export function ServicePaySheet({
  ctx,
  order,
  onClose,
  onPaid,
}: {
  readonly ctx: PageContext;
  readonly order: ServiceOrder;
  readonly onClose: () => void;
  readonly onPaid: (order: ServiceOrder) => void;
}) {
  const [payment, setPayment] = useState<PaymentMethod>("tunai");
  const action = useAction();
  const balance = order.balanceDueRupiah ?? 0n;
  return (
    <Sheet title={`Bayar service ${order.number}`} onClose={onClose}>
      <div className="pay-service-head">
        <strong>{order.customerName}</strong>
        <span className="muted">{order.device} · {order.complaint}</span>
        <span className={STATUS_BADGE[order.status]}>{SERVICE_STATUS_LABELS[order.status]}</span>
      </div>
      <dl className="totals">
        <div>
          <dt>{order.status === "batal" ? "Biaya cek" : "Biaya service"}</dt>
          <dd>{rp(order.totalChargeRupiah ?? 0n)}</dd>
        </div>
        {order.depositRupiah > 0n && (
          <div>
            <dt>DP sudah dibayar</dt>
            <dd>−{rp(order.depositRupiah)}</dd>
          </div>
        )}
        <div className="totals-main">
          <dt>{balance >= 0n ? "Sisa bayar" : "DP dikembalikan"}</dt>
          <dd>{rp(balance >= 0n ? balance : -balance)}</dd>
        </div>
        {can(ctx.user, "viewCostAndProfit") && order.profitRupiah !== null && (
          <div className={order.profitRupiah >= 0n ? "profit-row" : "profit-row loss"}>
            <dt>Untung</dt>
            <dd>{rpSigned(order.profitRupiah)}</dd>
          </div>
        )}
      </dl>
      {balance > 0n && (
        <div className="pay-row">
          <span className="field-label">Bayar pakai</span>
          <Chips value={payment} onChange={setPayment} options={PAYMENT_OPTIONS} label="Metode bayar" />
        </div>
      )}
      <ErrorText error={action.error} />
      <button
        type="button"
        className="button button-primary button-block button-large"
        disabled={action.busy}
        onClick={() =>
          void action.run(async () => {
            const done = await ctx.repo.pickUpService(order.id, payment);
            ctx.changed();
            onPaid(done);
          })
        }
      >
        {action.busy ? "Menyimpan…" : balance > 0n ? `Terima ${rp(balance)} & serahkan HP` : "Serahkan HP"}
      </button>
    </Sheet>
  );
}

/** Setelah HP diambil: kirim nota service ke pelanggan. */
export function ServiceDoneSheet({
  ctx,
  order,
  onClose,
}: {
  readonly ctx: PageContext;
  readonly order: ServiceOrder;
  readonly onClose: () => void;
}) {
  const text = serviceReceiptText(order, ctx.store);
  const [error, setError] = useState<string | null>(null);
  return (
    <Sheet title={`Nota service ${order.number}`} onClose={onClose}>
      <pre className="receipt-preview">{text}</pre>
      <ErrorText error={error} />
      <div className="button-row">
        {order.customerPhone !== null && (
          <button type="button" className="button whatsapp-button" onClick={() => openWhatsApp(order.customerPhone!, text)}>
            Kirim ke WA pelanggan
          </button>
        )}
        <button
          type="button"
          className="button button-secondary"
          onClick={() => shareText(`Nota service ${order.number}`, text).catch(() => setError("Tidak bisa membuka menu Bagikan."))}
        >
          Bagikan…
        </button>
        <button type="button" className="button button-primary" onClick={onClose}>
          Selesai
        </button>
      </div>
    </Sheet>
  );
}

export function NewServiceSheet({
  ctx,
  onClose,
  onCreated,
}: {
  readonly ctx: PageContext;
  readonly onClose: () => void;
  readonly onCreated: (order: ServiceOrder) => void;
}) {
  const [form, setForm] = useState({
    customerName: "",
    customerPhone: "",
    device: "",
    imei: "",
    complaint: "",
    completeness: "",
    unlockCode: "",
    estimate: "",
    deposit: "",
  });
  const action = useAction();
  const set = (key: keyof typeof form) => (value: string) => setForm({ ...form, [key]: value });

  return (
    <Sheet title="Service baru" onClose={onClose} wide>
      <div className="form-grid two">
        <label>
          Nama pelanggan *
          <input value={form.customerName} onChange={(e) => set("customerName")(e.target.value)} autoFocus />
        </label>
        <label>
          No. WA pelanggan
          <input inputMode="tel" value={form.customerPhone} onChange={(e) => set("customerPhone")(e.target.value)} placeholder="08…" />
        </label>
        <label>
          HP yang diservice *
          <input value={form.device} onChange={(e) => set("device")(e.target.value)} placeholder="iPhone 11 hitam" />
        </label>
        <label>
          IMEI
          <input inputMode="numeric" value={form.imei} onChange={(e) => set("imei")(e.target.value)} placeholder="Boleh dikosongkan" />
        </label>
      </div>
      <label className="block-label">
        Keluhan *
        <textarea rows={2} value={form.complaint} onChange={(e) => set("complaint")(e.target.value)} placeholder="LCD pecah, touchscreen tidak respon" />
      </label>
      <div className="form-grid two">
        <label>
          Kelengkapan yang ditinggal
          <input value={form.completeness} onChange={(e) => set("completeness")(e.target.value)} placeholder="Unit + SIM, tanpa casing" />
        </label>
        <label>
          PIN/pola layar
          <input value={form.unlockCode} onChange={(e) => set("unlockCode")(e.target.value)} placeholder="Untuk tes setelah perbaikan" />
        </label>
        <label>
          Estimasi biaya
          <CurrencyInput value={form.estimate} onValueChange={set("estimate")} placeholder="Boleh dikosongkan" />
        </label>
        <label>
          DP diterima
          <CurrencyInput value={form.deposit} onValueChange={set("deposit")} placeholder="0" />
        </label>
      </div>
      <ErrorText error={action.error} />
      <button
        type="button"
        className="button button-primary button-block"
        disabled={action.busy}
        onClick={() =>
          void action.run(async () => {
            const order = await ctx.repo.createServiceOrder({
              customerName: form.customerName,
              customerPhone: form.customerPhone,
              device: form.device,
              imei: form.imei,
              complaint: form.complaint,
              completeness: form.completeness,
              unlockCode: form.unlockCode,
              estimateRupiah: digitsToRupiah(form.estimate),
              depositRupiah: digitsToRupiah(form.deposit) ?? 0n,
            });
            onCreated(order);
          })
        }
      >
        {action.busy ? "Menyimpan…" : "Simpan & buat tanda terima"}
      </button>
    </Sheet>
  );
}

type CloseMode = "selesai" | "batal" | null;

export function ServiceDetailSheet({
  ctx,
  order,
  onClose,
  onPay,
}: {
  readonly ctx: PageContext;
  readonly order: ServiceOrder;
  readonly onClose: () => void;
  readonly onPay: () => void;
}) {
  const showProfit = can(ctx.user, "viewCostAndProfit");
  const [closeMode, setCloseMode] = useState<CloseMode>(null);
  const [charge, setCharge] = useState(rupiahToDigits(order.totalChargeRupiah ?? order.estimateRupiah));
  const [partsCost, setPartsCost] = useState(order.partsCostRupiah > 0n ? order.partsCostRupiah.toString() : "");
  const [partsNote, setPartsNote] = useState(order.partsNote ?? "");
  const action = useAction();

  const receipt = serviceReceiptText(order, ctx.store);
  const statusMessage = serviceStatusMessage(order, ctx.store);

  async function closeWork(mode: "selesai" | "batal") {
    await action.run(async () => {
      const total = digitsToRupiah(charge);
      if (total === null) {
        throw new Error(mode === "selesai" ? "Isi biaya service." : "Isi biaya cek (boleh 0).");
      }
      const charges = { totalChargeRupiah: total, partsCostRupiah: digitsToRupiah(partsCost) ?? 0n };
      if (mode === "selesai") await ctx.repo.finishService(order.id, charges, partsNote);
      else await ctx.repo.cancelService(order.id, charges, partsNote);
      setCloseMode(null);
      ctx.changed();
    });
  }

  return (
    <Sheet title={`${order.number} · ${order.customerName}`} onClose={onClose} wide>
      <p>
        <span className={STATUS_BADGE[order.status]}>{SERVICE_STATUS_LABELS[order.status]}</span>
      </p>
      <dl className="detail-list">
        <div><dt>HP</dt><dd>{order.device}</dd></div>
        {order.imei !== null && <div><dt>IMEI</dt><dd>{order.imei}</dd></div>}
        <div><dt>Keluhan</dt><dd>{order.complaint}</dd></div>
        {order.completeness !== null && <div><dt>Kelengkapan</dt><dd>{order.completeness}</dd></div>}
        {order.unlockCode !== null && <div><dt>PIN/pola</dt><dd>{order.unlockCode}</dd></div>}
        <div><dt>Masuk</dt><dd>{dateTimeWib(order.receivedAtMs)} ({ageLabel(order.receivedAtMs)})</dd></div>
        {order.customerPhone !== null && <div><dt>WA</dt><dd>{order.customerPhone}</dd></div>}
        {order.estimateRupiah !== null && <div><dt>Estimasi</dt><dd>{rp(order.estimateRupiah)}</dd></div>}
        {order.depositRupiah > 0n && <div><dt>DP</dt><dd>{rp(order.depositRupiah)}</dd></div>}
        {order.totalChargeRupiah !== null && <div><dt>Biaya</dt><dd>{rp(order.totalChargeRupiah)}</dd></div>}
        {order.balanceDueRupiah !== null && (
          <div className="detail-strong">
            <dt>{order.balanceDueRupiah >= 0n ? "Sisa bayar" : "DP dikembalikan"}</dt>
            <dd>{rp(order.balanceDueRupiah >= 0n ? order.balanceDueRupiah : -order.balanceDueRupiah)}</dd>
          </div>
        )}
        {order.partsNote !== null && <div><dt>Sparepart</dt><dd>{order.partsNote}</dd></div>}
        {showProfit && order.profitRupiah !== null && (
          <div>
            <dt>Untung</dt>
            <dd>{rpSigned(order.profitRupiah)} (modal sparepart {rp(order.partsCostRupiah)})</dd>
          </div>
        )}
      </dl>

      <div className="button-row">
        {order.customerPhone !== null && (
          <button type="button" className="button whatsapp-button" onClick={() => openWhatsApp(order.customerPhone!, statusMessage)}>
            Kabari pelanggan via WA
          </button>
        )}
        <button
          type="button"
          className="button button-secondary"
          onClick={() => {
            if (order.customerPhone !== null) openWhatsApp(order.customerPhone, receipt);
            else void shareText(`Tanda terima ${order.number}`, receipt).catch(() => action.setError("Tidak bisa membuka menu Bagikan."));
          }}
        >
          Kirim tanda terima
        </button>
      </div>

      {order.status === "proses" && closeMode === null && (
        <div className="button-row">
          <button type="button" className="button button-primary" onClick={() => setCloseMode("selesai")}>
            Perbaikan selesai
          </button>
          <button type="button" className="button button-danger-quiet" onClick={() => setCloseMode("batal")}>
            Tidak bisa diperbaiki
          </button>
        </div>
      )}

      {closeMode !== null && (
        <fieldset className="trade-in">
          <legend>{closeMode === "selesai" ? "Biaya perbaikan" : "Service batal"}</legend>
          <div className="form-grid two">
            <label>
              {closeMode === "selesai" ? "Total biaya ke pelanggan *" : "Biaya cek (boleh 0) *"}
              <CurrencyInput value={charge} onValueChange={setCharge} placeholder="0" autoFocus />
            </label>
            <label>
              Modal sparepart + ongkir
              <CurrencyInput value={partsCost} onValueChange={setPartsCost} placeholder="0" />
            </label>
          </div>
          <label className="block-label">
            Catatan sparepart
            <input value={partsNote} onChange={(e) => setPartsNote(e.target.value)} placeholder="LCD OEM dari Shopee" />
          </label>
          {showProfit && digitsToRupiah(charge) !== null && (
            <p className="profit-note">
              Untung: <strong>{rpSigned((digitsToRupiah(charge) ?? 0n) - (digitsToRupiah(partsCost) ?? 0n))}</strong>
            </p>
          )}
          <div className="button-row">
            <button type="button" className="button button-primary" disabled={action.busy} onClick={() => void closeWork(closeMode)}>
              Simpan
            </button>
            <button type="button" className="button button-quiet" onClick={() => setCloseMode(null)}>
              Batal
            </button>
          </div>
        </fieldset>
      )}

      {(order.status === "selesai" || order.status === "batal") && (
        <div className="button-row">
          <button type="button" className="button button-primary" onClick={onPay}>
            Bayar & serahkan HP
          </button>
          <button
            type="button"
            className="button button-quiet"
            disabled={action.busy}
            onClick={() =>
              void action.run(async () => {
                await ctx.repo.reopenService(order.id);
                ctx.changed();
              })
            }
          >
            Kerjakan ulang
          </button>
        </div>
      )}
      <ErrorText error={action.error} />
    </Sheet>
  );
}
