import { useState } from "react";
import { BUSINESS_LINE_LABELS, BUSINESS_LINES } from "../domain/report";
import { jakartaDayRange, jakartaMonthRange } from "../domain/time";
import { Chips, EmptyState, ErrorText, useLoad } from "./common";
import type { PageContext } from "./context";
import { dayLabel, monthLabel, rp, rpSigned, thisMonthKey, todayKey } from "./format";

type Mode = "hari" | "bulan";
type Detail = "hp" | "service";

export function ReportPage({ ctx }: { readonly ctx: PageContext }) {
  const [mode, setMode] = useState<Mode>("hari");
  const [day, setDay] = useState(todayKey());
  const [month, setMonth] = useState(thisMonthKey());
  const [detail, setDetail] = useState<Detail>("hp");

  const report = useLoad(async () => {
    const range = mode === "hari" ? jakartaDayRange(day) : jakartaMonthRange(month);
    return {
      summary: await ctx.repo.profitSummary(range),
      phones: await ctx.repo.phoneProfits(range),
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
                    {totals.count.toString()} {line === "hp" ? "unit" : line === "service" ? "service" : line === "digital" ? "transaksi" : "barang"} · omzet{" "}
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

    </div>
  );
}
