import { useState } from "react";
import type { SaleRecord } from "../data/repository";
import { can } from "../domain/auth";
import type { PaymentMethod } from "../domain/sales";
import { jakartaDayKey, jakartaDaysRange } from "../domain/time";
import { PAYMENT_LABELS } from "../printing/receipt";
import { EmptyState, ErrorText, Sheet, useAction, useLoad } from "./common";
import type { PageContext } from "./context";
import { dayLabel, rp, rpSigned, timeWib } from "./format";
import { SaleReceiptSheet } from "./NotaSheets";
import { useRangeFilter } from "./RangeFilter";

type StatusFilter = "semua" | "aktif" | "batal";
type PayFilter = "semua" | PaymentMethod;

/** Riwayat nota: periode, cari, status & cara bayar; dikelompokkan per tanggal. */
export function SalesHistoryPage({ ctx }: { readonly ctx: PageContext }) {
  const showProfit = can(ctx.user, "viewCostAndProfit");
  const filter = useRangeFilter("hari-ini");
  const { from, to } = filter.range;
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("semua");
  const [pay, setPay] = useState<PayFilter>("semua");
  const [open, setOpen] = useState<SaleRecord | null>(null);
  const [voiding, setVoiding] = useState<SaleRecord | null>(null);
  const sales = useLoad(() => ctx.repo.listSales(jakartaDaysRange(from, to)), [ctx.repo, ctx.dataVersion, from, to]);

  const all = sales.data ?? [];
  const needle = query.trim().toLowerCase();
  const searched = needle.length === 0 ? all : all.filter((sale) => saleText(sale).includes(needle));
  const byPay = pay === "semua" ? searched : searched.filter((sale) => sale.paymentMethod === pay);
  const voidedCount = byPay.filter((sale) => sale.voidedAtMs !== null).length;
  const shown = byPay.filter((sale) =>
    status === "semua" ? true : status === "aktif" ? sale.voidedAtMs === null : sale.voidedAtMs !== null,
  );
  const active = shown.filter((sale) => sale.voidedAtMs === null);
  const omzet = active.reduce((sum, sale) => sum + sale.summary.itemsTotalRupiah, 0n);
  const profit = active.reduce((sum, sale) => sum + sale.summary.profitRupiah, 0n);
  const groups = groupByDay(shown);
  const filtered = needle.length > 0 || status !== "semua" || pay !== "semua";

  function clearFilters() {
    setQuery("");
    setStatus("semua");
    setPay("semua");
  }

  return (
    <div className="page history-page">
      {filter.element}

      <div className={showProfit ? "history-summary" : "history-summary two"}>
        <div>
          <small>Nota berhasil</small>
          <strong>{active.length}</strong>
        </div>
        <div>
          <small>Omzet</small>
          <strong>{rp(omzet)}</strong>
        </div>
        {showProfit && (
          <div>
            <small>Untung</small>
            <strong className={profit < 0n ? "negative" : "positive"}>{rpSigned(profit)}</strong>
          </div>
        )}
      </div>

      <input
        type="search"
        className="search-input"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Cari no. nota, pelanggan, barang, IMEI, no. tujuan…"
      />
      <div className="history-filters">
        <div className="chips" role="radiogroup" aria-label="Status nota">
          {(
            [
              ["semua", `Semua (${byPay.length})`],
              ["aktif", `Berhasil (${byPay.length - voidedCount})`],
              ["batal", `Dibatalkan (${voidedCount})`],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={status === id}
              className={status === id ? "chip chip-active" : "chip"}
              onClick={() => setStatus(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="chips" role="radiogroup" aria-label="Cara bayar">
          {(["semua", "tunai", "transfer", "qris"] as const).map((id) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={pay === id}
              className={pay === id ? "chip chip-active" : "chip"}
              onClick={() => setPay(id)}
            >
              {id === "semua" ? "Semua cara bayar" : PAYMENT_LABELS[id]}
            </button>
          ))}
        </div>
      </div>

      <ErrorText error={sales.error} />
      {sales.data !== null && shown.length === 0 ? (
        <EmptyState>
          {all.length === 0 ? (
            <>
              Belum ada nota di periode ini.
              <br />
              Pilih periode lain di atas, misalnya <strong>7 hari</strong> atau <strong>Bulan ini</strong>, atau geser
              tanggal dengan tombol ‹ ›.
            </>
          ) : (
            <>
              Tidak ada nota yang cocok dengan pencarian atau filter.{" "}
              <button type="button" className="text-button" onClick={clearFilters}>
                Hapus filter
              </button>
            </>
          )}
        </EmptyState>
      ) : (
        groups.map((group) => (
          <section className="history-day" key={group.day}>
            <header className="history-day-head">
              <strong>{dayLabel(group.day)}</strong>
              <span>
                {group.activeCount} nota · {rp(group.total)}
              </span>
            </header>
            <ul className="card-list">
              {group.sales.map((sale) => (
                <li key={sale.id}>
                  <div className={sale.voidedAtMs !== null ? "list-card static voided" : "list-card static"}>
                    <button type="button" className="list-card-main link-like" onClick={() => setOpen(sale)}>
                      <strong>
                        {sale.number}
                        {sale.customerName ? ` · ${sale.customerName}` : ""}
                      </strong>
                      <span className="muted">
                        {timeWib(sale.soldAtMs)} · {PAYMENT_LABELS[sale.paymentMethod]} ·{" "}
                        {sale.lines.map((line) => line.name.replace(/ \(IMEI.*\)$/, "")).join(", ")}
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
          </section>
        ))
      )}
      {filtered && shown.length > 0 && (
        <p className="muted small">
          Ringkasan di atas hanya menghitung nota yang tampil, tanpa yang dibatalkan.{" "}
          <button type="button" className="text-button" onClick={clearFilters}>
            Hapus filter
          </button>
        </p>
      )}
      {open !== null && <SaleReceiptSheet ctx={ctx} sale={open} fresh={false} onClose={() => setOpen(null)} />}
      {voiding !== null && <VoidSaleSheet ctx={ctx} sale={voiding} onClose={() => setVoiding(null)} />}
    </div>
  );
}

function saleText(sale: SaleRecord): string {
  return [
    sale.number,
    sale.customerName ?? "",
    sale.customerPhone ?? "",
    sale.note ?? "",
    ...sale.lines.map((line) => `${line.name} ${line.target ?? ""}`),
    sale.tradeInPhone === null ? "" : `${sale.tradeInPhone.imei1} ${sale.tradeInPhone.imei2 ?? ""}`,
  ]
    .join(" ")
    .toLowerCase();
}

interface DayGroup {
  readonly day: string;
  readonly sales: SaleRecord[];
  activeCount: number;
  total: bigint;
}

/** Nota sudah urut terbaru dulu, jadi cukup potong saat tanggal berganti. */
function groupByDay(sales: readonly SaleRecord[]): readonly DayGroup[] {
  const groups: DayGroup[] = [];
  for (const sale of sales) {
    const day = jakartaDayKey(sale.soldAtMs);
    let group = groups[groups.length - 1];
    if (group === undefined || group.day !== day) {
      group = { day, sales: [], activeCount: 0, total: 0n };
      groups.push(group);
    }
    group.sales.push(sale);
    if (sale.voidedAtMs === null) {
      group.activeCount += 1;
      group.total += sale.summary.itemsTotalRupiah;
    }
  }
  return groups;
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
