import { useState } from "react";
import type { SaleRecord } from "../data/repository";
import { can } from "../domain/auth";
import { jakartaDayRange } from "../domain/time";
import { EmptyState, ErrorText, Sheet, useAction, useLoad } from "./common";
import type { PageContext } from "./context";
import { dateTimeWib, dayLabel, rp, rpSigned, todayKey } from "./format";
import { ReceiptSheet } from "./SalePage";

/** Daftar nota per hari: buka/kirim ulang nota, Owner bisa membatalkan. */
export function SalesHistoryPage({ ctx }: { readonly ctx: PageContext }) {
  const showProfit = can(ctx.user, "viewCostAndProfit");
  const [day, setDay] = useState(todayKey());
  const [open, setOpen] = useState<SaleRecord | null>(null);
  const [voiding, setVoiding] = useState<SaleRecord | null>(null);
  const sales = useLoad(() => ctx.repo.listSales(jakartaDayRange(day)), [ctx.repo, ctx.dataVersion, day]);
  const active = (sales.data ?? []).filter((sale) => sale.voidedAtMs === null);

  return (
    <div className="page">
      <div className="toolbar">
        <input type="date" value={day} max={todayKey()} onChange={(e) => e.target.value && setDay(e.target.value)} />
        <span className="muted">
          {dayLabel(day)} · {active.length} nota · {rp(active.reduce((sum, sale) => sum + sale.summary.itemsTotalRupiah, 0n))}
        </span>
      </div>
      <ErrorText error={sales.error} />
      {sales.data !== null && sales.data.length === 0 ? (
        <EmptyState>Belum ada nota di tanggal ini.</EmptyState>
      ) : (
        <ul className="card-list">
          {(sales.data ?? []).map((sale) => (
            <li key={sale.id}>
              <div className={sale.voidedAtMs !== null ? "list-card static voided" : "list-card static"}>
                <button type="button" className="list-card-main link-like" onClick={() => setOpen(sale)}>
                  <strong>
                    {sale.number}
                    {sale.customerName ? ` · ${sale.customerName}` : ""}
                  </strong>
                  <span className="muted">
                    {dateTimeWib(sale.soldAtMs)} · {sale.lines.map((line) => line.name.replace(/ \(IMEI.*\)$/, "")).join(", ")}
                  </span>
                  {sale.voidedAtMs !== null && <span className="badge badge-red">Dibatalkan: {sale.voidReason}</span>}
                </button>
                <span className="list-card-side">
                  <strong>{rp(sale.summary.itemsTotalRupiah)}</strong>
                  {showProfit && <span className="muted">untung {rpSigned(sale.summary.profitRupiah)}</span>}
                  {sale.voidedAtMs === null && can(ctx.user, "voidSale") && (
                    <button type="button" className="text-button danger" onClick={() => setVoiding(sale)}>
                      Batalkan
                    </button>
                  )}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
      {open !== null && <ReceiptSheet ctx={ctx} sale={open} onClose={() => setOpen(null)} />}
      {voiding !== null && (
        <VoidSaleSheet ctx={ctx} sale={voiding} onClose={() => setVoiding(null)} />
      )}
    </div>
  );
}

export function VoidSaleSheet({
  ctx,
  sale,
  onClose,
}: {
  readonly ctx: PageContext;
  readonly sale: SaleRecord;
  readonly onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const action = useAction();
  return (
    <Sheet title={`Batalkan ${sale.number}?`} onClose={onClose}>
      <p>
        HP di nota ini kembali ke stok dan stok aksesoris dikembalikan.
        {sale.tradeInPhone !== null && " HP tukar tambahnya dikeluarkan dari stok."} Untung nota ini hilang dari laporan.
      </p>
      <label className="block-label">
        Alasan *
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Salah input harga / pelanggan batal" autoFocus />
      </label>
      <ErrorText error={action.error} />
      <div className="button-row">
        <button
          type="button"
          className="button button-danger"
          disabled={action.busy}
          onClick={() =>
            void action.run(async () => {
              await ctx.repo.voidSale(sale.id, reason);
              ctx.changed();
              onClose();
            })
          }
        >
          Ya, batalkan nota
        </button>
        <button type="button" className="button button-quiet" onClick={onClose}>
          Tidak
        </button>
      </div>
    </Sheet>
  );
}
