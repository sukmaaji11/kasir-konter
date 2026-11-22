import { useState } from "react";
import type { SaleRecord } from "../data/repository";
import { can } from "../domain/auth";
import { BUSINESS_LINE_LABELS, BUSINESS_LINES } from "../domain/report";
import { jakartaDayRange, jakartaMonthRange } from "../domain/time";
import { Chips, EmptyState, ErrorText, Sheet, useAction, useLoad } from "./common";
import type { PageContext } from "./context";
import { dateTimeWib, dayLabel, monthLabel, rp, rpSigned, thisMonthKey, todayKey } from "./format";
import { ReceiptSheet } from "./SalePage";

type Mode = "hari" | "bulan";
type Detail = "hp" | "nota" | "service";

export function ReportPage({ ctx }: { readonly ctx: PageContext }) {
  const [mode, setMode] = useState<Mode>("hari");
  const [day, setDay] = useState(todayKey());
  const [month, setMonth] = useState(thisMonthKey());
  const [detail, setDetail] = useState<Detail>("hp");
  const [openSale, setOpenSale] = useState<SaleRecord | null>(null);
  const [voiding, setVoiding] = useState<SaleRecord | null>(null);

  const report = useLoad(async () => {
    const range = mode === "hari" ? jakartaDayRange(day) : jakartaMonthRange(month);
    return {
      summary: await ctx.repo.profitSummary(range),
      phones: await ctx.repo.phoneProfits(range),
      sales: await ctx.repo.listSales(range),
      services: await ctx.repo.listPickedUpServices(range),
      daily: mode === "bulan" ? await ctx.repo.dailyProfit(month) : null,
    };
  }, [ctx.repo, ctx.dataVersion, mode, day, month]);

  const data = report.data;
  const maxDaily = data?.daily?.reduce(
    (max, item) => (item.totals.profitRupiah > max ? item.totals.profitRupiah : max),
    0n,
  ) ?? 0n;

  return (
    <div className="page">
      <div className="toolbar">
        <Chips
          value={mode}
          onChange={setMode}
          label="Periode"
          options={[
            { value: "hari", label: "Harian" },
            { value: "bulan", label: "Bulanan" },
          ]}
        />
        {mode === "hari" ? (
          <input type="date" value={day} max={todayKey()} onChange={(e) => e.target.value && setDay(e.target.value)} />
        ) : (
          <input type="month" value={month} max={thisMonthKey()} onChange={(e) => e.target.value && setMonth(e.target.value)} />
        )}
      </div>
      <ErrorText error={report.error} />
      {data === null ? (
        <EmptyState>Memuat laporan…</EmptyState>
      ) : (
        <>
          <section className={data.summary.total.profitRupiah >= 0n ? "hero-stat" : "hero-stat loss"}>
            <span>Untung {mode === "hari" ? dayLabel(day) : monthLabel(month)}</span>
            <strong>{rpSigned(data.summary.total.profitRupiah)}</strong>
            <span className="hero-sub">
              Omzet {rp(data.summary.total.revenueRupiah)} · Modal {rp(data.summary.total.costRupiah)}
            </span>
          </section>

          <div className="line-cards">
            {BUSINESS_LINES.map((line) => {
              const totals = data.summary.byLine[line];
              return (
                <section key={line} className="line-card">
                  <h3>{BUSINESS_LINE_LABELS[line]}</h3>
                  <strong className={totals.profitRupiah < 0n ? "loss-text" : undefined}>
                    {rpSigned(totals.profitRupiah)}
                  </strong>
                  <span className="muted">
                    {totals.count.toString()} {line === "hp" ? "unit" : line === "service" ? "service" : "barang"} · omzet{" "}
                    {rp(totals.revenueRupiah)}
                  </span>
                </section>
              );
            })}
          </div>

          {data.daily !== null && (
            <section className="panel">
              <h2 className="panel-title">Untung per hari</h2>
              <ul className="bar-list">
                {data.daily
                  .filter((item) => item.totals.count > 0n)
                  .map((item) => (
                    <li key={item.day}>
                      <button type="button" className="bar-row" onClick={() => { setMode("hari"); setDay(item.day); }}>
                        <span className="bar-label">{dayLabel(item.day)}</span>
                        <span className="bar-track">
                          <span
                            className="bar-fill"
                            style={{
                              width: `${maxDaily > 0n && item.totals.profitRupiah > 0n ? Number((item.totals.profitRupiah * 100n) / maxDaily) : 0}%`,
                            }}
                          />
                        </span>
                        <span className="bar-value">{rpSigned(item.totals.profitRupiah)}</span>
                      </button>
                    </li>
                  ))}
              </ul>
              {data.daily.every((item) => item.totals.count === 0n) && <EmptyState>Belum ada transaksi bulan ini.</EmptyState>}
            </section>
          )}

          <section className="panel">
            <Chips
              value={detail}
              onChange={setDetail}
              label="Rincian"
              options={[
                { value: "hp", label: `Untung per HP (${data.phones.length})` },
                { value: "nota", label: `Nota (${data.sales.length})` },
                { value: "service", label: `Service diambil (${data.services.length})` },
              ]}
            />
            {detail === "hp" &&
              (data.phones.length === 0 ? (
                <EmptyState>Belum ada HP terjual di periode ini.</EmptyState>
              ) : (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>HP</th>
                      <th className="num">Jual</th>
                      <th className="num">Modal</th>
                      <th className="num">Untung</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.phones.map((row) => (
                      <tr key={`${row.saleId}-${row.phoneUnitId}`}>
                        <td>
                          <strong>{row.name}</strong>
                          <span className="muted small block">
                            {row.saleNumber} · {row.condition === "baru" ? "Baru" : "Bekas"}
                            {row.source === "tukar_tambah" ? " · eks tukar tambah" : ""}
                          </span>
                        </td>
                        <td className="num">{rp(row.priceRupiah)}</td>
                        <td className="num">{rp(row.costRupiah)}</td>
                        <td className={row.profitRupiah < 0n ? "num loss-text" : "num profit-text"}>{rpSigned(row.profitRupiah)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ))}
            {detail === "nota" &&
              (data.sales.length === 0 ? (
                <EmptyState>Belum ada nota di periode ini.</EmptyState>
              ) : (
                <ul className="card-list">
                  {data.sales.map((sale) => (
                    <li key={sale.id}>
                      <div className={sale.voidedAtMs !== null ? "list-card static voided" : "list-card static"}>
                        <button type="button" className="list-card-main link-like" onClick={() => setOpenSale(sale)}>
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
                          <span className="muted">untung {rpSigned(sale.summary.profitRupiah)}</span>
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
              ))}
            {detail === "service" &&
              (data.services.length === 0 ? (
                <EmptyState>Belum ada service yang diambil di periode ini.</EmptyState>
              ) : (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Service</th>
                      <th className="num">Biaya</th>
                      <th className="num">Sparepart</th>
                      <th className="num">Untung</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.services.map((order) => (
                      <tr key={order.id}>
                        <td>
                          <strong>{order.device}</strong>
                          <span className="muted small block">
                            {order.number} · {order.customerName}
                          </span>
                        </td>
                        <td className="num">{rp(order.totalChargeRupiah ?? 0n)}</td>
                        <td className="num">{rp(order.partsCostRupiah)}</td>
                        <td className={(order.profitRupiah ?? 0n) < 0n ? "num loss-text" : "num profit-text"}>
                          {rpSigned(order.profitRupiah ?? 0n)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ))}
          </section>
        </>
      )}

      {openSale !== null && <ReceiptSheet ctx={ctx} sale={openSale} onClose={() => setOpenSale(null)} />}
      {voiding !== null && (
        <VoidSaleSheet
          ctx={ctx}
          sale={voiding}
          onClose={() => setVoiding(null)}
          onDone={() => {
            setVoiding(null);
            ctx.changed();
          }}
        />
      )}
    </div>
  );
}

function VoidSaleSheet({
  ctx,
  sale,
  onClose,
  onDone,
}: {
  readonly ctx: PageContext;
  readonly sale: SaleRecord;
  readonly onClose: () => void;
  readonly onDone: () => void;
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
              onDone();
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
