import type { ReactNode } from "react";
import { can } from "../domain/auth";
import {
  BUSINESS_LINE_LABELS,
  BUSINESS_LINES,
  summarizeProfit,
  totalsOf,
  type BusinessLine,
  type ProfitEntry,
  type ProfitTotals,
} from "../domain/report";
import { jakartaDayKey, jakartaDayRange, jakartaMonthRange } from "../domain/time";
import { ErrorText, useLoad } from "./common";
import type { PageContext } from "./context";
import { dayLabel, rp, rpSigned, thisMonthKey, todayKey } from "./format";

/**
 * Beranda: salam, kartu "Siap melayani pelanggan", analisa toko hari ini
 * (per lini, grafik omzet & untung 7 hari, perlu perhatian), lalu menu
 * berbentuk daftar dengan keterangan/peringatan singkat.
 */

const DAY_MS = 86_400_000;
const LOW_STOCK = 2n;
const OLD_STOCK_DAYS = 30;

const LINE_ICONS: Readonly<Record<BusinessLine, string>> = {
  hp: "📱",
  aksesoris: "🎧",
  digital: "📶",
  service: "🔧",
};

const LONG_DATE = new Intl.DateTimeFormat("id-ID", {
  timeZone: "Asia/Jakarta",
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});
const HOUR = new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", hour: "numeric", hourCycle: "h23" });

interface DayStat {
  readonly day: string;
  readonly totals: ProfitTotals;
  readonly transactions: number;
}

function shortRupiah(value: bigint): string {
  const n = Number(value);
  if (n >= 1_000_000) return `${(n / 1_000_000).toLocaleString("id-ID", { maximumFractionDigits: 1 })} jt`;
  if (n >= 1_000) return `${Math.round(n / 1_000)} rb`;
  return n.toString();
}

export function HomePage({ ctx }: { readonly ctx: PageContext }) {
  const owner = can(ctx.user, "viewCostAndProfit");
  const data = useLoad(async () => {
    const today = jakartaDayRange(todayKey());
    // 14 hari: minggu ini + minggu lalu untuk perbandingan.
    const start = today.startMs - 13 * DAY_MS;
    const range = { startMs: start, endMs: today.endMs };
    const entries = await ctx.repo.profitEntries(range);
    const times = await ctx.repo.transactionTimes(range);
    const byDay = new Map<string, ProfitEntry[]>();
    for (const entry of entries) {
      const key = jakartaDayKey(entry.atMs);
      byDay.set(key, [...(byDay.get(key) ?? []), entry]);
    }
    const counts = new Map<string, number>();
    for (const at of times) counts.set(jakartaDayKey(at), (counts.get(jakartaDayKey(at)) ?? 0) + 1);
    const days: DayStat[] = Array.from({ length: 14 }, (_, index) => {
      const day = jakartaDayKey(start + index * DAY_MS);
      return { day, totals: totalsOf(byDay.get(day) ?? []), transactions: counts.get(day) ?? 0 };
    });
    const weekRange = { startMs: today.startMs - 6 * DAY_MS, endMs: today.endMs };
    const todayEntries = byDay.get(jakartaDayKey(today.startMs)) ?? [];

    const services = await ctx.repo.listOpenServices();
    const phones = await ctx.repo.listPhonesInStock();
    const accessories = await ctx.repo.listAccessories();
    const digital = await ctx.repo.listDigitalProducts();
    const lowStock = [
      ...accessories
        .filter((item) => item.stockQuantity <= LOW_STOCK)
        .map((item) => ({ name: item.name, stock: item.stockQuantity, page: "aksesoris" as const })),
      ...digital
        .filter((item) => item.tracksStock && item.stockQuantity <= LOW_STOCK)
        .map((item) => ({ name: item.name, stock: item.stockQuantity, page: "digital" as const })),
    ];
    const servicesToday = todayEntries.filter((entry) => entry.line === "service").length;
    const todayStat = days.at(-1)!;
    return {
      days,
      week: days.slice(7),
      today: summarizeProfit(todayEntries),
      month: owner ? await ctx.repo.profitSummary(jakartaMonthRange(thisMonthKey())) : null,
      transactionsToday: todayStat.transactions,
      salesCount: todayStat.transactions - servicesToday,
      pickedUpCount: servicesToday,
      readyOrders: services.filter((order) => order.status !== "proses"),
      lowStock,
      ready: services.filter((order) => order.status !== "proses").length,
      working: services.filter((order) => order.status === "proses").length,
      phoneCount: phones.length,
      phoneValue: phones.reduce((sum, phone) => sum + phone.costRupiah, 0n),
      oldPhones: phones.filter((phone) => today.startMs - phone.acquiredAtMs > OLD_STOCK_DAYS * DAY_MS).length,
      accessoryCount: accessories.length,
      lowAccessories: accessories.filter((item) => item.stockQuantity <= LOW_STOCK).length,
      digitalCount: digital.length,
      lowPerdana: digital.filter((item) => item.tracksStock && item.stockQuantity <= LOW_STOCK).length,
      payments: owner ? await ctx.repo.paymentTotals(weekRange) : [],
      topItem: owner ? ((await ctx.repo.itemSales(weekRange))[0] ?? null) : null,
    };
  }, [ctx.repo, ctx.dataVersion, owner]);

  const d = data.data;
  const hour = Number(HOUR.format(new Date()));
  const greeting = hour < 11 ? "Selamat pagi" : hour < 15 ? "Selamat siang" : hour < 18 ? "Selamat sore" : "Selamat malam";
  const weekMax = d ? d.week.reduce((max, item) => (item.totals.revenueRupiah > max ? item.totals.revenueRupiah : max), 1n) : 1n;
  const attention = d ? d.readyOrders.length + d.lowStock.length + (owner && d.oldPhones > 0 ? 1 : 0) : 0;
  const empty = d !== null && d.phoneCount === 0 && d.accessoryCount === 0 && d.digitalCount === 0;

  const paymentTotal = d?.payments.reduce((sum, item) => sum + item.amountRupiah, 0n) ?? 0n;
  const paymentDetail =
    d === null || paymentTotal === 0n
      ? "Perbandingan Tunai, Transfer & QRIS"
      : d.payments
          .filter((item) => item.amountRupiah > 0n)
          .map((item) => `${item.method === "qris" ? "QRIS" : item.method === "tunai" ? "Tunai" : "Transfer"} ${Math.round((Number(item.amountRupiah) / Number(paymentTotal)) * 100)}%`)
          .join(" · ") + " minggu ini";


  return (
    <div className="dashboard">
      <header className="dashboard-greeting">
        <p className="muted">{LONG_DATE.format(new Date())}</p>
        <h1>
          {greeting}, {ctx.user.name}
        </h1>
      </header>

      <section className={d !== null && d.ready > 0 ? "action-card alert" : "action-card"}>
        <div>
          <span className="action-card-status">
            <span className="status-dot" aria-hidden="true" />
            {d === null ? "Memuat…" : d.ready > 0 ? "Service menunggu diambil" : `${d.transactionsToday} transaksi hari ini`}
          </span>
          <strong>
            {d === null ? "" : d.ready > 0 ? `${d.ready} HP service siap diambil & dibayar` : "Siap melayani pelanggan?"}
          </strong>
        </div>
        <button type="button" className="button action-card-button" onClick={() => ctx.open("kasir")}>
          Ke Kasir
        </button>
      </section>

      <ErrorText error={data.error} />
      {d === null && data.error === null && <p className="muted">Menghitung ringkasan…</p>}

      {empty && (
        <section className="panel dashboard-empty">
          <strong>Belum ada barang</strong>
          <span className="muted">
            Catat HP yang ada di etalase, aksesoris, dan daftar harga pulsa dulu. Ringkasan di Beranda terisi setelah ada
            penjualan.
          </span>
          <div className="button-row">
            {can(ctx.user, "addPhone") && (
              <button type="button" className="button button-primary" onClick={() => ctx.open("hp")}>
                + HP masuk
              </button>
            )}
            {can(ctx.user, "manageAccessories") && (
              <button type="button" className="button button-secondary" onClick={() => ctx.open("aksesoris")}>
                + Aksesoris
              </button>
            )}
          </div>
        </section>
      )}

      <button type="button" className="summary-card" onClick={() => ctx.open(owner ? "laporan" : "nota")}>
        <span className="summary-label">Pemasukan hari ini</span>
        <strong className="summary-value">{d ? rp(d.today.total.revenueRupiah) : "…"}</strong>
        <span className="summary-sub">
          {d ? `${d.salesCount} nota · ${d.pickedUpCount} service diambil` : ""}
          {owner && d ? ` · untung ${rpSigned(d.today.total.profitRupiah)}` : ""}
        </span>
        {d?.month && (
          <span className="summary-foot">
            Bulan ini: omzet {rp(d.month.total.revenueRupiah)} · untung {rpSigned(d.month.total.profitRupiah)}
          </span>
        )}
      </button>

      <div className="line-strip">
        {BUSINESS_LINES.map((line) => {
          const totals = d?.today.byLine[line];
          return (
            <button key={line} type="button" className="line-chip" onClick={() => ctx.open(line === "service" ? "service" : "kasir")}>
              <span className="line-chip-head">
                <span aria-hidden="true">{LINE_ICONS[line]}</span> {BUSINESS_LINE_LABELS[line]}
              </span>
              <strong>{totals ? rp(totals.revenueRupiah) : "…"}</strong>
              {owner && totals && totals.count > 0n && (
                <span className={totals.profitRupiah < 0n ? "loss-text" : "profit-text"}>{rpSigned(totals.profitRupiah)}</span>
              )}
              {(!owner || !totals || totals.count === 0n) && (
                <span className="muted">{totals ? `${totals.count.toString()}×` : ""}</span>
              )}
            </button>
          );
        })}
      </div>

      {d && (
        <section className="panel">
          <h2 className="panel-title">{owner ? "Omzet & untung 7 hari" : "Omzet 7 hari"}</h2>
          <div className="week-chart" role="img" aria-label="Grafik omzet 7 hari terakhir">
            {d.week.map((item) => {
              const height = Number((item.totals.revenueRupiah * 100n) / weekMax);
              const profitHeight =
                owner && item.totals.profitRupiah > 0n ? Number((item.totals.profitRupiah * 100n) / weekMax) : 0;
              const isToday = item.day === todayKey();
              return (
                <div key={item.day} className={isToday ? "week-col today" : "week-col"} title={`${dayLabel(item.day)}: ${rp(item.totals.revenueRupiah)}`}>
                  <span className="week-value">{shortRupiah(item.totals.revenueRupiah)}</span>
                  <div className="week-bar-track">
                    <div className="week-bar" style={{ height: `${Math.max(height, item.totals.revenueRupiah > 0n ? 4 : 0)}%` }}>
                      {profitHeight > 0 && <div className="week-bar-profit" style={{ height: `${(profitHeight / Math.max(height, 1)) * 100}%` }} />}
                    </div>
                  </div>
                  <span className="week-day">{isToday ? "Hari ini" : dayLabel(item.day).split(",")[0]}</span>
                </div>
              );
            })}
          </div>
          {owner && (
            <p className="week-legend muted small">
              <span className="legend-dot omzet" /> Omzet <span className="legend-dot untung" /> Untung
            </p>
          )}
        </section>
      )}

      <div className="mini-stats four">
        <button type="button" className="mini-stat" onClick={() => ctx.open("kasir")}>
          <strong>{d?.readyOrders.length ?? "…"}</strong>
          <span>Service siap diambil</span>
        </button>
        <button type="button" className="mini-stat" onClick={() => ctx.open("service")}>
          <strong>{d?.working ?? "…"}</strong>
          <span>Service dikerjakan</span>
        </button>
        <button type="button" className="mini-stat" onClick={() => ctx.open("hp")}>
          <strong>{d?.phoneCount ?? "…"}</strong>
          <span>{owner && d ? `HP stok · ${shortRupiah(d.phoneValue)}` : "HP di stok"}</span>
        </button>
        <button type="button" className={d && d.lowStock.length > 0 ? "mini-stat warn" : "mini-stat"} onClick={() => ctx.open("aksesoris")}>
          <strong>{d?.lowStock.length ?? "…"}</strong>
          <span>Stok menipis</span>
        </button>
      </div>

      {d && attention > 0 && (
        <section className="panel">
          <h2 className="panel-title">Perlu perhatian</h2>
          <ul className="attention-list">
            {d.readyOrders.slice(0, 3).map((order) => (
              <li key={order.id}>
                <button type="button" className="attention-row" onClick={() => ctx.open("kasir")}>
                  <span aria-hidden="true">🔔</span>
                  <span className="attention-main">
                    <strong>{order.customerName} · {order.device}</strong>
                    <span className="muted small">{order.status === "selesai" ? "Selesai, tunggu diambil" : "Batal, tunggu diambil"} · {order.number}</span>
                  </span>
                  <strong className="attention-side">{rp((order.balanceDueRupiah ?? 0n) > 0n ? order.balanceDueRupiah! : 0n)}</strong>
                </button>
              </li>
            ))}
            {d.readyOrders.length > 3 && (
              <li className="muted small attention-more">+{d.readyOrders.length - 3} service lain siap diambil</li>
            )}
            {d.lowStock.slice(0, 3).map((item) => (
              <li key={`${item.page}-${item.name}`}>
                <button type="button" className="attention-row" onClick={() => ctx.open(item.page)}>
                  <span aria-hidden="true">📦</span>
                  <span className="attention-main">
                    <strong>{item.name}</strong>
                    <span className="muted small">{item.stock === 0n ? "Stok habis" : `Sisa ${item.stock.toString()}`} · tambah stok</span>
                  </span>
                </button>
              </li>
            ))}
            {d.lowStock.length > 3 && <li className="muted small attention-more">+{d.lowStock.length - 3} barang lain menipis</li>}
            {owner && d.oldPhones > 0 && (
              <li>
                <button type="button" className="attention-row" onClick={() => ctx.open("hp")}>
                  <span aria-hidden="true">⏳</span>
                  <span className="attention-main">
                    <strong>{d.oldPhones} HP lebih dari {OLD_STOCK_DAYS} hari di stok</strong>
                    <span className="muted small">Pertimbangkan turunkan harga supaya modal berputar</span>
                  </span>
                </button>
              </li>
            )}
          </ul>
        </section>
      )}

      <section className="dashboard-section">
        <h2 className="dashboard-heading">Toko &amp; stok</h2>
        <nav className="owner-menu" aria-label="Menu toko">
          <MenuRow
            title="Service"
            detail={d === null ? "Menghitung…" : d.ready > 0 ? `${d.ready} siap diambil · ${d.working} dikerjakan` : d.working > 0 ? `${d.working} sedang dikerjakan` : "Tidak ada service berjalan"}
            alert={(d?.ready ?? 0) > 0}
            tone="service"
            onClick={() => ctx.open("service")}
            icon={<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3.5 17.5a1.8 1.8 0 0 0 2.5 2.5l5.8-5.8a4 4 0 0 0 5.4-5.4l-2.4 2.4-2.1-.4-.4-2.1z" />}
          />
          <MenuRow
            title="Stok HP"
            detail={
              d === null
                ? "Menghitung…"
                : owner && d.oldPhones > 0
                  ? `${d.phoneCount} unit · ${d.oldPhones} HP lebih dari ${OLD_STOCK_DAYS} hari`
                  : `${d.phoneCount} unit${owner ? ` · modal ${shortRupiah(d.phoneValue)}` : ""}`
            }
            alert={owner && (d?.oldPhones ?? 0) > 0}
            tone="hp"
            onClick={() => ctx.open("hp")}
            icon={
              <>
                <rect x="6.5" y="2.5" width="11" height="19" rx="2.5" />
                <path d="M10.5 18.5h3" />
              </>
            }
          />
          <MenuRow
            title="Aksesoris"
            detail={d === null ? "Menghitung…" : d.lowAccessories > 0 ? `${d.lowAccessories} stok menipis` : `${d.accessoryCount} jenis barang`}
            alert={(d?.lowAccessories ?? 0) > 0}
            tone="aksesoris"
            onClick={() => ctx.open("aksesoris")}
            icon={
              <>
                <path d="M4 14v-2a8 8 0 0 1 16 0v2" />
                <rect x="3" y="14" width="4.5" height="6.5" rx="1.5" />
                <rect x="16.5" y="14" width="4.5" height="6.5" rx="1.5" />
              </>
            }
          />
          <MenuRow
            title="Produk digital"
            detail={
              d === null
                ? "Menghitung…"
                : d.digitalCount === 0
                  ? "Belum ada daftar harga pulsa & paket"
                  : d.lowPerdana > 0
                    ? `${d.lowPerdana} kartu perdana menipis`
                    : `${d.digitalCount} produk`
            }
            alert={(d?.lowPerdana ?? 0) > 0}
            tone="digital"
            onClick={() => ctx.open("digital")}
            icon={<path d="M5 20v-4M10 20v-8M15 20V8M20 20V4" />}
          />
        </nav>
      </section>

      <section className="dashboard-section">
        <h2 className="dashboard-heading">{owner ? "Analisa & laporan" : "Catatan"}</h2>
        <nav className="owner-menu" aria-label="Menu laporan">
          {owner && (
            <>
              <MenuRow
                title="Laporan untung"
                detail="Rekap per tanggal · Export PDF"
                tone="laporan"
                onClick={() => ctx.open("laporan")}
                icon={
                  <>
                    <path d="M14 3H6.5A1.5 1.5 0 0 0 5 4.5v15A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V8z" />
                    <path d="M14 3v5h5M9 13h6M9 17h6" />
                  </>
                }
              />
              <MenuRow
                title="Barang terlaris"
                detail={d?.topItem ? `${d.topItem.name} · ${d.topItem.quantity.toString()} terjual minggu ini` : "HP, aksesoris & digital paling laku"}
                tone="terlaris"
                onClick={() => ctx.open("terlaris")}
                icon={
                  <>
                    <path d="M8 21h8M12 17v4" />
                    <path d="M7 4h10v5a5 5 0 0 1-10 0z" />
                    <path d="M7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4" />
                  </>
                }
              />
              <MenuRow
                title="Cara bayar"
                detail={paymentDetail}
                tone="bayar"
                onClick={() => ctx.open("bayar")}
                icon={
                  <>
                    <rect x="2.5" y="5.5" width="19" height="13" rx="2.5" />
                    <path d="M2.5 10h19M6.5 15h4" />
                  </>
                }
              />
            </>
          )}
          <MenuRow
            title="Riwayat nota"
            detail="Buka, kirim ulang, atau cetak ulang nota"
            tone="nota"
            onClick={() => ctx.open("nota")}
            icon={
              <>
                <path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" />
                <path d="M9 8h6M9 12h6" />
              </>
            }
          />
        </nav>
      </section>
    </div>
  );
}

function MenuRow({
  title,
  detail,
  alert = false,
  tone,
  icon,
  onClick,
}: {
  readonly title: string;
  readonly detail: string;
  readonly alert?: boolean;
  readonly tone: string;
  readonly icon: ReactNode;
  readonly onClick: () => void;
}) {
  return (
    <button type="button" className={`owner-menu-row ${tone}`} onClick={onClick}>
      <span className="owner-menu-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24">{icon}</svg>
      </span>
      <span className="owner-menu-text">
        <strong>{title}</strong>
        <small className={alert ? "alert" : undefined}>{detail}</small>
      </span>
      <svg className="owner-menu-chevron" viewBox="0 0 24 24" aria-hidden="true">
        <path d="m9 6 6 6-6 6" />
      </svg>
    </button>
  );
}
