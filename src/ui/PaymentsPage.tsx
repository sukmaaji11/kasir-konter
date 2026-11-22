import { totalsByMethod, type PaymentEntry } from "../data/repository";
import type { PaymentMethod } from "../domain/sales";
import { daysBetween, jakartaDayKey, jakartaDaysRange } from "../domain/time";
import { PAYMENT_LABELS } from "../printing/receipt";
import { EmptyState, ErrorText, useLoad } from "./common";
import type { PageContext } from "./context";
import { dayLabel, rp } from "./format";
import { useRangeFilter } from "./RangeFilter";

const METHODS: readonly PaymentMethod[] = ["tunai", "transfer", "qris"];

function percent(part: bigint, total: bigint): number {
  return total === 0n ? 0 : Math.round((Number(part) / Number(total)) * 100);
}

/** Uang masuk per cara bayar: Tunai, Transfer, QRIS. */
export function PaymentsPage({ ctx }: { readonly ctx: PageContext }) {
  const filter = useRangeFilter("7-hari");
  const data = useLoad(
    () => ctx.repo.paymentEntries(jakartaDaysRange(filter.range.from, filter.range.to)),
    [ctx.repo, ctx.dataVersion, filter.range.from, filter.range.to],
  );
  const entries = data.data ?? [];
  const totals = totalsByMethod(entries);
  const grand = totals.reduce((sum, item) => sum + item.amountRupiah, 0n);
  const bySource = (source: PaymentEntry["source"]) => totalsByMethod(entries.filter((entry) => entry.source === source));
  const nota = bySource("nota");
  const service = bySource("service");

  const days =
    filter.range.from === filter.range.to
      ? []
      : daysBetween(filter.range.from, filter.range.to)
          .map((day) => ({ day, totals: totalsByMethod(entries.filter((entry) => jakartaDayKey(entry.atMs) === day)) }))
          .filter((item) => item.totals.some((total) => total.count > 0))
          .reverse();

  return (
    <div className="page">
      {filter.element}
      <ErrorText error={data.error} />

      <section className="pay-hero">
        <span>Total uang masuk</span>
        <strong>{rp(grand)}</strong>
        <small>{entries.length} transaksi (nota + service diambil)</small>
        <div className="pay-split" aria-hidden="true">
          {totals.map((item) =>
            item.amountRupiah > 0n ? (
              <span key={item.method} className={`pay-split-${item.method}`} style={{ width: `${percent(item.amountRupiah, grand)}%` }} />
            ) : null,
          )}
        </div>
      </section>

      <div className="pay-method-cards">
        {totals.map((item) => (
          <section key={item.method} className={`pay-method pay-method-${item.method}`}>
            <span className="pay-method-name">
              <span className={`pay-dot pay-split-${item.method}`} /> {PAYMENT_LABELS[item.method]}
            </span>
            <strong>{rp(item.amountRupiah)}</strong>
            <small>
              {percent(item.amountRupiah, grand)}% · {item.count} transaksi
            </small>
          </section>
        ))}
      </div>

      {data.data !== null && entries.length === 0 ? (
        <EmptyState>Belum ada uang masuk di periode ini.</EmptyState>
      ) : (
        <>
          <section className="panel">
            <h2 className="panel-title">Dari mana uangnya</h2>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Cara bayar</th>
                  <th className="num">Nota jual</th>
                  <th className="num">Service</th>
                  <th className="num">Total</th>
                </tr>
              </thead>
              <tbody>
                {METHODS.map((method, index) => (
                  <tr key={method}>
                    <td>
                      <strong>{PAYMENT_LABELS[method]}</strong>
                    </td>
                    <td className="num">{rp(nota[index]!.amountRupiah)}</td>
                    <td className="num">{rp(service[index]!.amountRupiah)}</td>
                    <td className="num">
                      <strong>{rp(totals[index]!.amountRupiah)}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {days.length > 0 && (
            <section className="panel">
              <h2 className="panel-title">Per hari</h2>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Tanggal</th>
                    {METHODS.map((method) => (
                      <th key={method} className="num">
                        {PAYMENT_LABELS[method]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {days.map((item) => (
                    <tr key={item.day} className="clickable" onClick={() => filter.showDay(item.day)}>
                      <td>{dayLabel(item.day)}</td>
                      {item.totals.map((total) => (
                        <td key={total.method} className="num">
                          {total.amountRupiah === 0n ? <span className="muted">-</span> : rp(total.amountRupiah)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </>
      )}
      <p className="muted small">
        Nota dihitung setelah potongan tukar tambah. Service dihitung sebesar biayanya pada hari HP diambil (DP ikut cara
        bayar pelunasan).
      </p>
    </div>
  );
}
