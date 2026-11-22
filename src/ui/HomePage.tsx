import { can } from "../domain/auth";
import { jakartaDayRange, jakartaMonthRange } from "../domain/time";
import { ErrorText, useLoad } from "./common";
import type { PageContext } from "./context";
import type { Tab } from "./App";
import { dateWib, rp, rpSigned, thisMonthKey, todayKey } from "./format";

interface MenuItem {
  readonly page: Tab;
  readonly icon: string;
  readonly label: string;
  readonly hint?: string;
}

export function HomePage({ ctx }: { readonly ctx: PageContext }) {
  const owner = can(ctx.user, "viewCostAndProfit");
  const data = useLoad(async () => {
    const today = jakartaDayRange(todayKey());
    const sales = (await ctx.repo.listSales(today)).filter((sale) => sale.voidedAtMs === null);
    const services = await ctx.repo.listOpenServices();
    const phones = await ctx.repo.listPhonesInStock();
    const accessories = await ctx.repo.listAccessories();
    return {
      salesCount: sales.length,
      salesTotal: sales.reduce((sum, sale) => sum + sale.summary.itemsTotalRupiah, 0n),
      today: owner ? await ctx.repo.profitSummary(today) : null,
      month: owner ? await ctx.repo.profitSummary(jakartaMonthRange(thisMonthKey())) : null,
      serviceOpen: services.length,
      serviceReady: services.filter((order) => order.status !== "proses").length,
      phoneCount: phones.length,
      lowStock: accessories.filter((item) => item.stockQuantity <= 2n).length,
    };
  }, [ctx.repo, ctx.dataVersion, owner]);

  const d = data.data;
  const menu: MenuItem[] = [
    { page: "kasir", icon: "🧾", label: "Kasir" },
    { page: "service", icon: "🔧", label: "Service", hint: d ? `${d.serviceOpen} belum diambil` : undefined },
    { page: "hp", icon: "📱", label: "Stok HP", hint: d ? `${d.phoneCount} unit` : undefined },
    { page: "aksesoris", icon: "🎧", label: "Aksesoris", hint: d && d.lowStock > 0 ? `${d.lowStock} stok menipis` : undefined },
    { page: "nota", icon: "🗂️", label: "Riwayat nota" },
    ...(owner ? [{ page: "laporan" as const, icon: "📊", label: "Laporan untung" }] : []),
    { page: "pengaturan", icon: "⚙️", label: "Pengaturan" },
  ];

  return (
    <div className="page">
      <div className="home-greeting">
        <strong>Halo, {ctx.user.name}</strong>
        <span className="muted">{dateWib(Date.now())}</span>
      </div>
      <ErrorText error={data.error} />

      <button type="button" className="summary-card" onClick={() => ctx.open(owner ? "laporan" : "nota")}>
        <span className="summary-label">Penjualan hari ini</span>
        <strong className="summary-value">{d ? rp(d.salesTotal) : "…"}</strong>
        <span className="summary-sub">
          {d ? `${d.salesCount} nota` : ""}
          {d?.today ? ` · untung ${rpSigned(d.today.total.profitRupiah)}` : ""}
        </span>
        {d?.month && (
          <span className="summary-foot">Untung bulan ini: {rpSigned(d.month.total.profitRupiah)}</span>
        )}
      </button>

      <div className="mini-stats">
        <button type="button" className="mini-stat" onClick={() => ctx.open("service")}>
          <strong>{d?.serviceReady ?? "…"}</strong>
          <span>Service siap diambil</span>
        </button>
        <button type="button" className="mini-stat" onClick={() => ctx.open("service")}>
          <strong>{d ? d.serviceOpen - d.serviceReady : "…"}</strong>
          <span>Sedang dikerjakan</span>
        </button>
        <button type="button" className="mini-stat" onClick={() => ctx.open("hp")}>
          <strong>{d?.phoneCount ?? "…"}</strong>
          <span>HP di stok</span>
        </button>
      </div>

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
