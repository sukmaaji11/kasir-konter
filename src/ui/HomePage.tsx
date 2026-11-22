import { can } from "../domain/auth";
import { BUSINESS_LINE_LABELS, BUSINESS_LINES, summarizeProfit, totalsOf, type BusinessLine } from "../domain/report";
import { jakartaDayKey, jakartaDayRange, jakartaMonthRange } from "../domain/time";
import { ErrorText, useLoad } from "./common";
import type { PageContext } from "./context";
import type { Tab } from "./App";
import { dayLabel, dateWib, rp, rpSigned, thisMonthKey, todayKey } from "./format";

interface MenuItem {
  readonly page: Tab;
  readonly icon: string;
  readonly label: string;
  readonly hint?: string;
}

const DAY_MS = 86_400_000;
const LOW_STOCK = 2n;
const OLD_STOCK_DAYS = 30;

const LINE_ICONS: Readonly<Record<BusinessLine, string>> = {
  hp: "📱",
  aksesoris: "🎧",
  digital: "📶",
  service: "🔧",
};

export function HomePage({ ctx }: { readonly ctx: PageContext }) {
  const owner = can(ctx.user, "viewCostAndProfit");
  const data = useLoad(async () => {
    const todayRange = jakartaDayRange(todayKey());
    const weekStart = todayRange.startMs - 6 * DAY_MS;
    const weekEntries = await ctx.repo.profitEntries({ startMs: weekStart, endMs: todayRange.endMs });
    const todayEntries = weekEntries.filter((entry) => entry.atMs >= todayRange.startMs);
    const week = Array.from({ length: 7 }, (_, index) => {
      const day = jakartaDayKey(weekStart + index * DAY_MS);
      return { day, totals: totalsOf(weekEntries.filter((entry) => jakartaDayKey(entry.atMs) === day)) };
    });

    const sales = (await ctx.repo.listSales(todayRange)).filter((sale) => sale.voidedAtMs === null);
    const pickedUp = await ctx.repo.listPickedUpServices(todayRange);
    const services = await ctx.repo.listOpenServices();
    const phones = await ctx.repo.listPhonesInStock();
    const accessories = await ctx.repo.listAccessories();
    const digital = await ctx.repo.listDigitalProducts();

    const lowStock = [
      ...accessories.filter((item) => item.stockQuantity <= LOW_STOCK).map((item) => ({ name: item.name, stock: item.stockQuantity, page: "aksesoris" as const })),
      ...digital
        .filter((item) => item.tracksStock && item.stockQuantity <= LOW_STOCK)
        .map((item) => ({ name: item.name, stock: item.stockQuantity, page: "digital" as const })),
    ];
    const oldPhones = phones.filter((phone) => todayRange.startMs - phone.acquiredAtMs > OLD_STOCK_DAYS * DAY_MS);

    return {
      today: summarizeProfit(todayEntries),
      month: owner ? await ctx.repo.profitSummary(jakartaMonthRange(thisMonthKey())) : null,
      week,
      salesCount: sales.length,
      pickedUpCount: pickedUp.length,
      ready: services.filter((order) => order.status !== "proses"),
      working: services.filter((order) => order.status === "proses").length,
      phoneCount: phones.length,
      phoneValue: phones.reduce((sum, phone) => sum + phone.costRupiah, 0n),
      oldPhones: oldPhones.length,
      lowStock,
      digitalCount: digital.length,
    };
  }, [ctx.repo, ctx.dataVersion, owner]);

  const d = data.data;
  const menu: MenuItem[] = [
    { page: "kasir", icon: "🧾", label: "Kasir" },
    { page: "service", icon: "🔧", label: "Service", hint: d ? `${d.ready.length + d.working} belum diambil` : undefined },
    { page: "hp", icon: "📱", label: "Stok HP", hint: d ? `${d.phoneCount} unit` : undefined },
    { page: "aksesoris", icon: "🎧", label: "Aksesoris" },
    { page: "digital", icon: "📶", label: "Produk digital", hint: d ? `${d.digitalCount} produk` : undefined },
    { page: "nota", icon: "🗂️", label: "Riwayat nota" },
    ...(owner ? [{ page: "laporan" as const, icon: "📊", label: "Laporan untung" }] : []),
    { page: "pengaturan", icon: "⚙️", label: "Pengaturan" },
  ];
  const weekMax = d ? d.week.reduce((max, item) => (item.totals.revenueRupiah > max ? item.totals.revenueRupiah : max), 1n) : 1n;
  const attention = d ? d.ready.length + d.lowStock.length + (owner && d.oldPhones > 0 ? 1 : 0) : 0;

  return (
    <div className="page">
      <div className="home-greeting">
        <strong>Halo, {ctx.user.name}</strong>
        <span className="muted">{dateWib(Date.now())}</span>
      </div>
      <ErrorText error={data.error} />

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
          <strong>{d?.ready.length ?? "…"}</strong>
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
            {d.ready.slice(0, 3).map((order) => (
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
            {d.ready.length > 3 && (
              <li className="muted small attention-more">+{d.ready.length - 3} service lain siap diambil</li>
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

      <section>
        <h2 className="section-title">Menu</h2>
        <div className="menu-grid">
          {menu.map((item) => (
            <button key={item.page} type="button" className="menu-tile" onClick={() => ctx.open(item.page)}>
              <span className="menu-icon" aria-hidden="true">{item.icon}</span>
              <span className="menu-label">{item.label}</span>
              {item.hint !== undefined && <span className="menu-hint">{item.hint}</span>}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

/** "1,2 jt", "350 rb", "0". */
function shortRupiah(value: bigint): string {
  const n = Number(value);
  if (n >= 1_000_000) return `${(n / 1_000_000).toLocaleString("id-ID", { maximumFractionDigits: 1 })} jt`;
  if (n >= 1_000) return `${Math.round(n / 1_000)} rb`;
  return n === 0 ? "0" : n.toString();
}
