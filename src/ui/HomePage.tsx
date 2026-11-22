import { useState, type ReactNode } from "react";
import { can } from "../domain/auth";
import { totalsOf, type ProfitEntry, type ProfitTotals } from "../domain/report";
import { jakartaDayKey, jakartaDayRange } from "../domain/time";
import { ErrorText, useLoad } from "./common";
import type { PageContext } from "./context";
import { rp, todayKey } from "./format";

/**
 * Beranda bergaya Dashboard Kasir Kaki Lima: salam, kartu aksi utama,
 * angka hari ini (dibanding kemarin), grafik 7 hari yang bisa diketuk,
 * dan menu berbentuk daftar dengan keterangan/peringatan singkat.
 */

const DAY_MS = 86_400_000;
const LOW_STOCK = 2n;
const OLD_STOCK_DAYS = 30;

const LONG_DATE = new Intl.DateTimeFormat("id-ID", {
  timeZone: "Asia/Jakarta",
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});
const HOUR = new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", hour: "numeric", hourCycle: "h23" });
const WEEKDAY = new Intl.DateTimeFormat("id-ID", { timeZone: "UTC", weekday: "short" });
const WEEKDAY_LONG = new Intl.DateTimeFormat("id-ID", { timeZone: "UTC", weekday: "long" });
const DAY_MONTH = new Intl.DateTimeFormat("id-ID", { timeZone: "UTC", day: "numeric", month: "short" });

interface DayStat {
  readonly day: string;
  readonly totals: ProfitTotals;
  readonly transactions: number;
}

function dayDate(day: string): Date {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, date!));
}

function percentChange(before: bigint, after: bigint): number | null {
  if (before === 0n) return null;
  return ((Number(after) - Number(before)) / Number(before)) * 100;
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
    return {
      days,
      phonesSoldToday: todayEntries.filter((entry) => entry.line === "hp").reduce((sum, entry) => sum + entry.count, 0n),
      servicesToday: todayEntries.filter((entry) => entry.line === "service").length,
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
  const today = d?.days.at(-1);
  const yesterday = d?.days.at(-2);
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
            {d === null ? "Memuat…" : d.ready > 0 ? "Service menunggu diambil" : `${today?.transactions ?? 0} transaksi hari ini`}
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

      {d !== null && today !== undefined && yesterday !== undefined && (
        <>
          <TodayTiles today={today} yesterday={yesterday} owner={owner} phonesSold={d.phonesSoldToday} services={d.servicesToday} />
          <WeekChart days={d.days.slice(7)} previous={d.days.slice(0, 7)} owner={owner} onOpenHistory={() => ctx.open("nota")} />
        </>
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
                detail={d?.topItem ? `${d.topItem.name} · ${d.topItem.quantity.toString()} terjual minggu ini` : "Aksesoris & digital paling laku"}
                tone="terlaris"
                onClick={() => ctx.open("laporan")}
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
                onClick={() => ctx.open("laporan")}
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
          <MenuRow
            title="Pengaturan"
            detail={owner ? "Profil konter · Printer · Karyawan" : "Ganti PIN · Kunci aplikasi"}
            tone="pengaturan"
            onClick={() => ctx.open("pengaturan")}
            icon={
              <>
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
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

function Delta({ change }: { readonly change: number }) {
  return (
    <span className={change >= 0 ? "delta up" : "delta down"}>
      {change >= 0 ? "▲" : "▼"} {Math.abs(change) > 999 ? ">999" : Math.abs(Math.round(change))}%
    </span>
  );
}

function TodayTiles({
  today,
  yesterday,
  owner,
  phonesSold,
  services,
}: {
  readonly today: DayStat;
  readonly yesterday: DayStat;
  readonly owner: boolean;
  readonly phonesSold: bigint;
  readonly services: number;
}) {
  const change = percentChange(yesterday.totals.revenueRupiah, today.totals.revenueRupiah);
  return (
    <section className="dashboard-section">
      <h2 className="dashboard-heading">Hari ini</h2>
      <div className="kpi-grid">
        <div className="kpi-tile kpi-hero">
          <span>Pemasukan</span>
          <strong>{rp(today.totals.revenueRupiah)}</strong>
          <small>
            {change === null ? (
              `Kemarin ${rp(yesterday.totals.revenueRupiah)}`
            ) : (
              <>
                <Delta change={change} /> dari kemarin
              </>
            )}
          </small>
        </div>
        {owner ? (
          <div className="kpi-tile">
            <span>Untung</span>
            <strong className={today.totals.profitRupiah < 0n ? "loss-text" : undefined}>{rp(today.totals.profitRupiah)}</strong>
          </div>
        ) : (
          <div className="kpi-tile">
            <span>Service diambil</span>
            <strong>{services}</strong>
          </div>
        )}
        <div className="kpi-tile">
          <span>Transaksi</span>
          <strong>{today.transactions}</strong>
        </div>
        <div className="kpi-tile">
          <span>HP terjual</span>
          <strong>{phonesSold.toString()}</strong>
        </div>
      </div>
    </section>
  );
}

function WeekChart({
  days,
  previous,
  owner,
  onOpenHistory,
}: {
  readonly days: readonly DayStat[];
  readonly previous: readonly DayStat[];
  readonly owner: boolean;
  readonly onOpenHistory: () => void;
}) {
  const [selected, setSelected] = useState(days.length - 1);
  const sum = (list: readonly DayStat[]) => list.reduce((total, day) => total + day.totals.revenueRupiah, 0n);
  const total = sum(days);
  const change = percentChange(sum(previous), total);
  const max = days.reduce((top, day) => (day.totals.revenueRupiah > top ? day.totals.revenueRupiah : top), 0n);
  const focus = days[selected] ?? days[days.length - 1]!;

  return (
    <section className="panel dashboard-card">
      <div className="dashboard-card-head">
        <div>
          <h2>Pemasukan 7 hari</h2>
          <p className="muted">
            Total {rp(total)}
            {change !== null && (
              <>
                {" · "}
                <Delta change={change} /> dari minggu lalu
              </>
            )}
          </p>
        </div>
        <button type="button" className="text-button" onClick={onOpenHistory}>
          Riwayat
        </button>
      </div>

      <div className="week-focus" aria-live="polite">
        <span>
          {WEEKDAY_LONG.format(dayDate(focus.day))}, {DAY_MONTH.format(dayDate(focus.day))}
        </span>
        <strong>{rp(focus.totals.revenueRupiah)}</strong>
        <small>
          {focus.transactions} transaksi
          {owner ? ` · untung ${rp(focus.totals.profitRupiah)}` : ""}
        </small>
      </div>

      <div className="dash-chart" role="list" aria-label="Pemasukan per hari">
        {days.map((day, index) => {
          const height = max === 0n ? 0 : Math.max(3, Math.round((Number(day.totals.revenueRupiah) / Number(max)) * 100));
          const isToday = index === days.length - 1;
          return (
            <button
              key={day.day}
              type="button"
              role="listitem"
              className={["dash-bar", index === selected ? "selected" : "", isToday ? "today" : ""].join(" ")}
              onClick={() => setSelected(index)}
              aria-label={`${day.day}: ${rp(day.totals.revenueRupiah)}`}
            >
              <span className="dash-bar-track">
                <span className="dash-bar-fill" style={{ height: `${height}%` }} />
              </span>
              <span className="dash-bar-label">{isToday ? "Hari ini" : WEEKDAY.format(dayDate(day.day))}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
