import { useEffect, useRef, useState, type ReactNode } from "react";
import { printErrorMessage, type PrinterSettings } from "../application/printing";
import type { SaleRecord, ServiceOrder } from "../data/repository";
import { can } from "../domain/auth";
import { PAYMENT_LABELS, type CashDetail } from "../printing/receipt";
import { ErrorText, Sheet } from "./common";
import type { PageContext } from "./context";
import { warrantyLabel } from "../domain/service";
import { dateTimeWib, dayLabel, rp, rpSigned } from "./format";
import { saleReceiptText, serviceReceiptText } from "./receipts";
import { openWhatsApp, shareText } from "./whatsapp";

type PrintState =
  | { readonly kind: "idle" }
  | { readonly kind: "printing" }
  | { readonly kind: "done" }
  | { readonly kind: "error"; readonly message: string };

/** Status cetak + cetak otomatis sekali saat nota baru dibuka (bila diaktifkan). */
function usePrinter(ctx: PageContext, print: () => Promise<void>, autoPrint: boolean) {
  const [settings, setSettings] = useState<PrinterSettings | null>(null);
  const [state, setState] = useState<PrintState>({ kind: "idle" });
  const started = useRef(false);

  async function run() {
    setState({ kind: "printing" });
    try {
      await print();
      setState({ kind: "done" });
    } catch (cause) {
      setState({ kind: "error", message: printErrorMessage(cause) });
    }
  }

  useEffect(() => {
    void ctx.printing.getSettings().then((value) => {
      setSettings(value);
      if (autoPrint && value.autoPrint && value.printerAddress !== null && !started.current) {
        started.current = true;
        void run();
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.printing]);

  return { settings, state, run };
}

function PrintControls({
  ctx,
  printer,
  onClose,
}: {
  readonly ctx: PageContext;
  readonly printer: ReturnType<typeof usePrinter>;
  readonly onClose: () => void;
}) {
  const { settings, state, run } = printer;
  if (settings === null) return null;
  if (settings.printerAddress === null) {
    return can(ctx.user, "manageUsers") ? (
      <button
        type="button"
        className="button button-secondary print-button"
        onClick={() => {
          onClose();
          ctx.open("pengaturan");
        }}
      >
        <PrinterIcon /> Atur printer untuk cetak nota
      </button>
    ) : (
      <p className="inline-note">Printer nota belum diatur. Minta Owner mengaturnya di Pengaturan.</p>
    );
  }
  return (
    <>
      {state.kind === "printing" && <p className="inline-note" role="status">Mencetak ke {settings.printerName ?? "printer"}…</p>}
      {state.kind === "done" && <p className="inline-note success" role="status">Nota sudah dicetak.</p>}
      {state.kind === "error" && <p className="error-message" role="alert">{state.message}</p>}
      <button type="button" className="button button-secondary print-button" onClick={() => void run()} disabled={state.kind === "printing"}>
        <PrinterIcon />
        {state.kind === "printing" ? "Mencetak…" : state.kind === "error" ? "Coba cetak lagi" : state.kind === "done" ? "Cetak lagi" : "Cetak nota"}
      </button>
    </>
  );
}

function SuccessHead({ title, meta }: { readonly title: string; readonly meta: string }) {
  return (
    <div className="receipt-success">
      <span className="receipt-check" aria-hidden="true">
        <svg viewBox="0 0 24 24">
          <path d="m5 12.5 4.5 4.5L19 7.5" />
        </svg>
      </span>
      <h2>{title}</h2>
      <p className="muted">{meta}</p>
    </div>
  );
}

function StoreHead({ ctx }: { readonly ctx: PageContext }) {
  return (
    <div className="receipt-store">
      <strong>{ctx.store.name.trim() || "Konter HP"}</strong>
      {ctx.store.address.trim() && <span>{ctx.store.address}</span>}
      {ctx.store.phone.trim() && <span>WA {ctx.store.phone}</span>}
    </div>
  );
}

function ShareButtons({
  phone,
  text,
  title,
  onError,
}: {
  readonly phone: string | null;
  readonly text: string;
  readonly title: string;
  readonly onError: (message: string) => void;
}) {
  return (
    <div className="button-row receipt-share">
      {phone !== null && (
        <button type="button" className="button whatsapp-button" onClick={() => openWhatsApp(phone, text)}>
          Kirim ke WA
        </button>
      )}
      <button type="button" className="button button-quiet" onClick={() => shareText(title, text).catch(() => onError("Tidak bisa membuka menu Bagikan."))}>
        Bagikan…
      </button>
    </div>
  );
}

/** Nota penjualan: setelah bayar (fresh) atau dibuka lagi dari Riwayat nota. */
export function SaleReceiptSheet({
  ctx,
  sale,
  fresh,
  cash = null,
  onClose,
  footer,
}: {
  readonly ctx: PageContext;
  readonly sale: SaleRecord;
  readonly fresh: boolean;
  readonly cash?: CashDetail | null;
  readonly onClose: () => void;
  readonly footer?: ReactNode;
}) {
  const [error, setError] = useState<string | null>(null);
  const voided = sale.voidedAtMs !== null;
  const printer = usePrinter(
    ctx,
    () => ctx.printing.printSale({ sale, store: ctx.store, cashierName: ctx.user.name, cash, reprint: !fresh }),
    fresh,
  );
  const due = sale.summary.amountDueRupiah;
  const meta = `${dateTimeWib(sale.soldAtMs)} · ${sale.number}${fresh ? ` · ${ctx.user.name}` : ""}`;

  return (
    <Sheet title={`Nota ${sale.number}`} onClose={onClose}>
      {fresh ? <SuccessHead title="Pembayaran berhasil" meta={meta} /> : <p className="muted receipt-meta">{meta}</p>}
      {voided && <p className="badge badge-red">Dibatalkan: {sale.voidReason}</p>}

      {due < 0n ? (
        <div className="receipt-change refund">
          <span>Dibayar ke pelanggan</span>
          <strong>{rp(-due)}</strong>
        </div>
      ) : cash !== null && sale.paymentMethod === "tunai" ? (
        <div className="receipt-change">
          <span>Kembalian</span>
          <strong>{rp(cash.changeRupiah)}</strong>
          <small>
            Diterima {rp(cash.receivedRupiah)} · Total {rp(due)}
          </small>
        </div>
      ) : (
        <div className={fresh ? "receipt-change" : "receipt-change quiet"}>
          <span>Total dibayar · {PAYMENT_LABELS[sale.paymentMethod]}</span>
          <strong>{rp(due)}</strong>
        </div>
      )}

      <div className="receipt-paper">
        <StoreHead ctx={ctx} />
        {sale.customerName && <p className="receipt-customer">Pelanggan: {sale.customerName}</p>}
        {sale.lines.map((line) => (
          <div className="receipt-line" key={line.id}>
            <span>
              <strong>{line.name}</strong>
              <small>
                {line.target !== null ? `ke ${line.target} · ` : ""}
                {line.quantity.toString()} × {rp(line.unitPriceRupiah)}
              </small>
            </span>
            <strong>{rp(line.unitPriceRupiah * line.quantity)}</strong>
          </div>
        ))}
        {sale.tradeInPhone !== null && (
          <>
            <div className="receipt-line minor">
              <span>Total barang</span>
              <strong>{rp(sale.summary.itemsTotalRupiah)}</strong>
            </div>
            <div className="receipt-line minor">
              <span>
                Tukar tambah
                <small>{sale.tradeInPhone.displayName}</small>
              </span>
              <strong>−{rp(sale.summary.tradeInCreditRupiah)}</strong>
            </div>
          </>
        )}
        <div className="receipt-line receipt-total">
          <span>{due >= 0n ? "Total" : "Dibayar ke pelanggan"}</span>
          <strong>{rp(due >= 0n ? due : -due)}</strong>
        </div>
        {ctx.store.footer.trim() && <p className="receipt-footer">{ctx.store.footer}</p>}
      </div>

      {can(ctx.user, "viewCostAndProfit") && (
        <p className="profit-note">
          Untung nota ini: <strong>{rpSigned(sale.summary.profitRupiah)}</strong>
        </p>
      )}
      <ErrorText error={error} />
      {!voided && <PrintControls ctx={ctx} printer={printer} onClose={onClose} />}
      <ShareButtons phone={sale.customerPhone} text={saleReceiptText(sale, ctx.store)} title={`Nota ${sale.number}`} onError={setError} />
      {footer}
      <button type="button" className="button button-primary button-block" onClick={onClose}>
        {fresh ? "Transaksi baru" : "Tutup"}
      </button>
    </Sheet>
  );
}

/** Nota service setelah HP diambil dan dilunasi. */
export function ServiceReceiptSheet({
  ctx,
  order,
  onClose,
}: {
  readonly ctx: PageContext;
  readonly order: ServiceOrder;
  readonly onClose: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const printer = usePrinter(ctx, () => ctx.printing.printService(order, ctx.store), true);
  const balance = order.balanceDueRupiah ?? 0n;
  return (
    <Sheet title={`Nota service ${order.number}`} onClose={onClose}>
      <SuccessHead
        title="HP sudah diambil"
        meta={`${dateTimeWib(order.pickedUpAtMs ?? order.receivedAtMs)} · ${order.number} · ${ctx.user.name}`}
      />
      <div className={balance < 0n ? "receipt-change refund" : "receipt-change"}>
        <span>
          {balance >= 0n ? `Pelunasan${order.paymentMethod !== null && balance > 0n ? ` · ${PAYMENT_LABELS[order.paymentMethod]}` : ""}` : "DP dikembalikan"}
        </span>
        <strong>{rp(balance >= 0n ? balance : -balance)}</strong>
      </div>
      <div className="receipt-paper">
        <StoreHead ctx={ctx} />
        <p className="receipt-customer">
          {order.customerName} · {order.device}
        </p>
        <div className="receipt-line">
          <span>
            <strong>Service</strong>
            <small>{order.complaint}</small>
          </span>
          <strong>{rp(order.totalChargeRupiah ?? 0n)}</strong>
        </div>
        {order.depositRupiah > 0n && (
          <div className="receipt-line minor">
            <span>DP</span>
            <strong>−{rp(order.depositRupiah)}</strong>
          </div>
        )}
        <div className="receipt-line receipt-total">
          <span>{balance >= 0n ? "Dibayar sekarang" : "DP dikembalikan"}</span>
          <strong>{rp(balance >= 0n ? balance : -balance)}</strong>
        </div>
        {order.warrantyUntil !== null && (
          <div className="receipt-warranty">
            <strong>Garansi {warrantyLabel(order.warrantyDays)}</strong>
            <span>Berlaku s/d {dayLabel(order.warrantyUntil)}</span>
            {order.warrantyNote !== null && <small>{order.warrantyNote}</small>}
          </div>
        )}
        {ctx.store.footer.trim() && <p className="receipt-footer">{ctx.store.footer}</p>}
      </div>
      <ErrorText error={error} />
      <PrintControls ctx={ctx} printer={printer} onClose={onClose} />
      <ShareButtons phone={order.customerPhone} text={serviceReceiptText(order, ctx.store)} title={`Nota service ${order.number}`} onError={setError} />
      <button type="button" className="button button-primary button-block" onClick={onClose}>
        Selesai
      </button>
    </Sheet>
  );
}

/** Tombol cetak tanda terima service (saat HP diterima). */
export function PrintServiceButton({ ctx, order }: { readonly ctx: PageContext; readonly order: ServiceOrder }) {
  const printer = usePrinter(ctx, () => ctx.printing.printService(order, ctx.store), false);
  if (printer.settings === null || printer.settings.printerAddress === null) return null;
  return (
    <>
      <button type="button" className="button button-secondary print-button" onClick={() => void printer.run()} disabled={printer.state.kind === "printing"}>
        <PrinterIcon />
        {printer.state.kind === "printing" ? "Mencetak…" : "Cetak tanda terima"}
      </button>
      {printer.state.kind === "error" && <p className="error-message">{printer.state.message}</p>}
      {printer.state.kind === "done" && <p className="inline-note success">Tanda terima sudah dicetak.</p>}
    </>
  );
}

export function PrinterIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 9V3h12v6" />
      <rect x="3" y="9" width="18" height="8" rx="2" />
      <path d="M7 14h10v7H7z" />
    </svg>
  );
}
