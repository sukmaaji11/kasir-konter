import { useEffect, useState } from "react";
import { loadReport, reportFileName } from "../application/reports";
import { BUSINESS_LINE_LABELS, BUSINESS_LINES } from "../domain/report";
import { PAYMENT_LABELS } from "../printing/receipt";
import { buildReportPdf } from "../reports/report-pdf";
import { Chips, EmptyState, ErrorText, useAction, useLoad } from "./common";
import type { PageContext } from "./context";
import { dayLabel, rp, rpSigned } from "./format";
import { useRangeFilter } from "./RangeFilter";

type Detail = "hp" | "service" | "barang";
export function ReportPage({ ctx }: { readonly ctx: PageContext }) {
  const filter = useRangeFilter();
  const range = filter.range;
  const [detail, setDetail] = useState<Detail>("hp");
  const exporting = useAction();
  const [exported, setExported] = useState<string | null>(null);
  useEffect(() => setExported(null), [range.from, range.to]);

  const report = useLoad(() => loadReport(ctx.repo, range), [ctx.repo, ctx.dataVersion, range.from, range.to]);
  const data = report.data;

  async function exportPdf() {
    if (data === null) return;
    await exporting.run(async () => {
      const bytes = buildReportPdf(data, { storeName: ctx.store.name.trim() || "Konter HP", generatedAtMs: Date.now() });
      const name = reportFileName(data.range);
      await ctx.files.share(name, bytes, "application/pdf");
      setExported(name);
    });
  }

  const maxDaily =
    data?.daily?.reduce((max, item) => (item.totals.revenueRupiah > max ? item.totals.revenueRupiah : max), 0n) ?? 0n;

  return (
    <div className="page">
      {filter.element}

      <ErrorText error={report.error} />
      {data === null ? (
        <EmptyState>Memuat laporan…</EmptyState>
      ) : (
        <>
          <section className={data.summary.total.profitRupiah >= 0n ? "hero-stat" : "hero-stat loss"}>
            <span>Untung bersih</span>
            <strong>{rpSigned(data.summary.total.profitRupiah)}</strong>
            <span className="hero-sub">
              Omzet {rp(data.summary.total.revenueRupiah)} · Modal {rp(data.summary.total.costRupiah)}
            </span>
            <span className="hero-sub">
              {data.saleCount} nota · {data.services.length} service diambil
              {data.voidedCount > 0 ? ` · ${data.voidedCount} nota dibatalkan` : ""}
            </span>
          </section>

          <div className="export-row">
            <button type="button" className="button button-secondary" disabled={exporting.busy} onClick={() => void exportPdf()}>
              <PdfIcon /> {exporting.busy ? "Membuat PDF…" : "Export laporan PDF"}
            </button>
            {exported !== null && <span className="success-text small">{exported} siap disimpan / dikirim.</span>}
          </div>
          <ErrorText error={exporting.error} />

          <div className="line-cards">
            {BUSINESS_LINES.map((line) => {
              const totals = data.summary.byLine[line];
              return (
                <section key={line} className="line-card">
                  <h3>{BUSINESS_LINE_LABELS[line]}</h3>
                  <strong className={totals.profitRupiah < 0n ? "loss-text" : undefined}>{rpSigned(totals.profitRupiah)}</strong>
                  <span className="muted">
                    {totals.count.toString()} {line === "hp" ? "unit" : line === "service" ? "service" : line === "digital" ? "transaksi" : "barang"} · omzet{" "}
                    {rp(totals.revenueRupiah)}
                  </span>
                </section>
              );
            })}
          </div>

          <section className="panel">
            <h2 className="panel-title">Uang masuk per cara bayar</h2>
            <div className="pay-totals">
              {data.payments.map((payment) => (
                <div key={payment.method} className="pay-total">
                  <span>
                    {PAYMENT_LABELS[payment.method]} · {payment.count}×
                  </span>
                  <strong>{rp(payment.amountRupiah)}</strong>
                </div>
              ))}
            </div>
            <p className="muted small">Nota dihitung setelah potongan tukar tambah; service dihitung saat HP diambil.</p>
          </section>

          {data.daily !== null && (
            <section className="panel">
              <h2 className="panel-title">Per hari</h2>
              <ul className="bar-list">
                {data.daily
                  .filter((item) => item.totals.count > 0n)
                  .map((item) => (
                    <li key={item.day}>
                      <button
                        type="button"
                        className="bar-row"
                        onClick={() => filter.showDay(item.day)}
                      >
                        <span className="bar-label">{dayLabel(item.day)}</span>
                        <span className="bar-track">
                          <span
                            className="bar-fill"
                            style={{ width: `${maxDaily > 0n ? Number((item.totals.revenueRupiah * 100n) / maxDaily) : 0}%` }}
                          />
                        </span>
                        <span className="bar-value">
                          {rp(item.totals.revenueRupiah)}
                          <small className={item.totals.profitRupiah < 0n ? "loss-text" : "profit-text"}>{rpSigned(item.totals.profitRupiah)}</small>
                        </span>
                      </button>
                    </li>
                  ))}
              </ul>
              {data.daily.every((item) => item.totals.count === 0n) && <EmptyState>Belum ada transaksi di periode ini.</EmptyState>}
            </section>
          )}

          <section className="panel">
            <Chips
              value={detail}
              onChange={setDetail}
              label="Rincian"
              options={[
                { value: "hp", label: `Per HP (${data.phones.length})` },
                { value: "service", label: `Service (${data.services.length})` },
                { value: "barang", label: `Aksesoris & digital (${data.items.length})` },
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
            {detail === "barang" &&
              (data.items.length === 0 ? (
                <EmptyState>Belum ada aksesoris atau produk digital terjual di periode ini.</EmptyState>
              ) : (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Barang</th>
                      <th className="num">Jumlah</th>
                      <th className="num">Omzet</th>
                      <th className="num">Untung</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((item) => (
                      <tr key={`${item.kind}-${item.name}`}>
                        <td>
                          <strong>{item.name}</strong>
                          <span className="muted small block">{item.kind === "digital" ? "Digital" : "Aksesoris"}</span>
                        </td>
                        <td className="num">{item.quantity.toString()}</td>
                        <td className="num">{rp(item.revenueRupiah)}</td>
                        <td className={item.profitRupiah < 0n ? "num loss-text" : "num profit-text"}>{rpSigned(item.profitRupiah)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ))}
          </section>
        </>
      )}
    </div>
  );
}

function PdfIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
      <path d="M14 3v6h6" />
      <path d="M12 12v6m-3-3 3 3 3-3" />
    </svg>
  );
}
