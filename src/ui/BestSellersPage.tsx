import { useState } from "react";
import { jakartaDaysRange } from "../domain/time";
import { Chips, EmptyState, ErrorText, useLoad } from "./common";
import type { PageContext } from "./context";
import { rp, rpSigned } from "./format";
import { useRangeFilter } from "./RangeFilter";

type Kind = "hp" | "aksesoris" | "digital";

interface RankRow {
  readonly name: string;
  readonly quantity: bigint;
  readonly revenueRupiah: bigint;
  readonly profitRupiah: bigint;
}

const UNIT: Readonly<Record<Kind, string>> = { hp: "unit", aksesoris: "pcs", digital: "transaksi" };
const EMPTY: Readonly<Record<Kind, string>> = {
  hp: "Belum ada HP terjual di periode ini.",
  aksesoris: "Belum ada aksesoris terjual di periode ini.",
  digital: "Belum ada pulsa, paket, atau produk digital terjual di periode ini.",
};

/** Peringkat barang paling laku per jenis: HP (per tipe), aksesoris, digital. */
export function BestSellersPage({ ctx }: { readonly ctx: PageContext }) {
  const filter = useRangeFilter("7-hari");
  const [kind, setKind] = useState<Kind>("hp");
  const data = useLoad(async () => {
    const time = jakartaDaysRange(filter.range.from, filter.range.to);
    const phones = await ctx.repo.phoneProfits(time);
    const items = await ctx.repo.itemSales(time);
    const byModel = new Map<string, RankRow>();
    for (const phone of phones) {
      const current = byModel.get(phone.modelName) ?? { name: phone.modelName, quantity: 0n, revenueRupiah: 0n, profitRupiah: 0n };
      byModel.set(phone.modelName, {
        name: phone.modelName,
        quantity: current.quantity + 1n,
        revenueRupiah: current.revenueRupiah + phone.priceRupiah,
        profitRupiah: current.profitRupiah + phone.profitRupiah,
      });
    }
    const sort = (rows: RankRow[]) =>
      rows.sort((a, b) => (b.quantity === a.quantity ? Number(b.revenueRupiah - a.revenueRupiah) : Number(b.quantity - a.quantity)));
    return {
      hp: sort([...byModel.values()]),
      aksesoris: sort(items.filter((item) => item.kind === "aksesoris").map((item) => ({ ...item }))),
      digital: sort(items.filter((item) => item.kind === "digital").map((item) => ({ ...item }))),
    } satisfies Record<Kind, RankRow[]>;
  }, [ctx.repo, ctx.dataVersion, filter.range.from, filter.range.to]);

  const rows = data.data?.[kind] ?? [];
  const top = rows[0];
  const maxQuantity = top?.quantity ?? 1n;
  const totalQuantity = rows.reduce((sum, row) => sum + row.quantity, 0n);

  return (
    <div className="page">
      {filter.element}
      <Chips
        value={kind}
        onChange={setKind}
        label="Jenis barang"
        options={[
          { value: "hp", label: `📱 HP (${data.data?.hp.length ?? 0})` },
          { value: "aksesoris", label: `🎧 Aksesoris (${data.data?.aksesoris.length ?? 0})` },
          { value: "digital", label: `📶 Digital (${data.data?.digital.length ?? 0})` },
        ]}
      />
      <ErrorText error={data.error} />

      {data.data !== null && top === undefined && <EmptyState>{EMPTY[kind]}</EmptyState>}

      {top !== undefined && (
        <section className="champion-card">
          <span className="champion-medal" aria-hidden="true">🏆</span>
          <div>
            <span className="champion-label">Paling laku</span>
            <strong>{top.name}</strong>
            <small>
              {top.quantity.toString()} {UNIT[kind]} terjual · omzet {rp(top.revenueRupiah)} · untung {rpSigned(top.profitRupiah)}
            </small>
          </div>
        </section>
      )}

      {rows.length > 0 && (
        <section className="panel">
          <h2 className="panel-title">
            Peringkat · {totalQuantity.toString()} {UNIT[kind]} terjual
          </h2>
          <ol className="rank-list">
            {rows.map((row, index) => (
              <li key={row.name} className="rank-row">
                <span className={index < 3 ? `rank-badge top${index + 1}` : "rank-badge"}>{index + 1}</span>
                <div className="rank-main">
                  <div className="rank-head">
                    <strong>{row.name}</strong>
                    <span>
                      {row.quantity.toString()} {UNIT[kind]}
                    </span>
                  </div>
                  <span className="rank-bar">
                    <span style={{ width: `${Number((row.quantity * 100n) / maxQuantity)}%` }} />
                  </span>
                  <small className="muted">
                    Omzet {rp(row.revenueRupiah)} ·{" "}
                    <span className={row.profitRupiah < 0n ? "loss-text" : "profit-text"}>untung {rpSigned(row.profitRupiah)}</span>
                  </small>
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}
      {kind === "hp" && rows.length > 0 && <p className="muted small">HP dikelompokkan per tipe dan varian (warna tidak dibedakan).</p>}
    </div>
  );
}
