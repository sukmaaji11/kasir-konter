import { useState } from "react";
import type { DigitalProduct } from "../data/repository";
import { can } from "../domain/auth";
import {
  DIGITAL_CATEGORIES,
  DIGITAL_CATEGORY_ICONS,
  DIGITAL_CATEGORY_LABELS,
  defaultTracksStock,
  type DigitalCategory,
} from "../domain/digital";
import { CurrencyInput } from "./CurrencyInput";
import { Chips, EmptyState, ErrorText, Sheet, useAction, useLoad } from "./common";
import type { PageContext } from "./context";
import { digitsToRupiah, rp } from "./format";
import { ProductThumb } from "./PhotoStrip";

const LOW_STOCK = 2n;

const NAME_EXAMPLES: Readonly<Record<DigitalCategory, string>> = {
  pulsa: "Pulsa Telkomsel 10rb",
  kuota: "Paket data XL 10GB 30 hari",
  perdana: "Perdana Tri 0K",
  topup: "Top up DANA 50rb",
  token: "Token PLN 20rb",
  lainnya: "Transfer bank",
};

type Filter = "semua" | DigitalCategory;

export function DigitalPage({ ctx }: { readonly ctx: PageContext }) {
  const manage = can(ctx.user, "manageAccessories");
  const showCost = can(ctx.user, "viewCostAndProfit");
  const items = useLoad(() => ctx.repo.listDigitalProducts(), [ctx.repo, ctx.dataVersion]);
  const [filter, setFilter] = useState<Filter>("semua");
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<DigitalProduct | null>(null);

  const all = items.data ?? [];
  const query = search.trim().toLowerCase();
  const list = all.filter(
    (item) => (filter === "semua" || item.category === filter) && (query === "" || item.name.toLowerCase().includes(query)),
  );
  const lowCount = all.filter((item) => item.tracksStock && item.stockQuantity <= LOW_STOCK).length;
  const usedCategories = DIGITAL_CATEGORIES.filter((category) => all.some((item) => item.category === category));

  return (
    <div className="page">
      <p className="muted small">
        Daftar harga pulsa, paket data, kartu perdana, top up, dan token. Yang tidak ada di daftar bisa dijual lewat
        "Transaksi manual" di Kasir.
      </p>
      <div className="stat-row">
        <div className="stat">
          <span>Produk digital</span>
          <strong>{items.data?.length ?? "…"}</strong>
        </div>
        <div className={lowCount > 0 ? "stat stat-warn" : "stat"}>
          <span>Perdana menipis (≤ {LOW_STOCK.toString()})</span>
          <strong>{lowCount}</strong>
        </div>
      </div>
      {usedCategories.length > 1 && (
        <Chips
          value={filter}
          onChange={setFilter}
          label="Kategori"
          options={[
            { value: "semua", label: "Semua" },
            ...usedCategories.map((category) => ({ value: category, label: DIGITAL_CATEGORY_LABELS[category] })),
          ]}
        />
      )}
      <div className="toolbar">
        <input
          className="search-input"
          type="search"
          placeholder="Cari produk digital…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        {manage && (
          <button type="button" className="button button-primary" onClick={() => setAdding(true)}>
            + Produk digital
          </button>
        )}
      </div>
      <ErrorText error={items.error} />
      {list.length === 0 ? (
        <EmptyState>
          {all.length === 0 ? "Belum ada produk digital. Tambahkan harga pulsa atau perdana yang sering dijual." : "Tidak ada yang cocok."}
        </EmptyState>
      ) : (
        <ul className="card-list">
          {list.map((item) => (
            <li key={item.id}>
              <button type="button" className="list-card" onClick={() => setSelected(item)} disabled={!manage}>
                <ProductThumb src={undefined} kind="digital" icon={DIGITAL_CATEGORY_ICONS[item.category]} />
                <span className="list-card-main">
                  <strong>{item.name}</strong>
                  <span className={item.tracksStock && item.stockQuantity <= LOW_STOCK ? "warn-text" : "muted"}>
                    {DIGITAL_CATEGORY_LABELS[item.category]}
                    {item.tracksStock ? ` · Stok ${item.stockQuantity.toString()}` : ""}
                  </span>
                </span>
                <span className="list-card-side">
                  <strong>{rp(item.priceRupiah)}</strong>
                  {showCost && <span className="muted">modal {rp(item.costRupiah)}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {adding && (
        <NewDigitalSheet
          ctx={ctx}
          initialCategory={filter === "semua" ? "pulsa" : filter}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            ctx.changed();
          }}
        />
      )}
      {selected !== null && (
        <DigitalSheet
          ctx={ctx}
          item={selected}
          onClose={() => setSelected(null)}
          onSaved={() => {
            setSelected(null);
            ctx.changed();
          }}
        />
      )}
    </div>
  );
}

function NewDigitalSheet({
  ctx,
  initialCategory,
  onClose,
  onSaved,
}: {
  readonly ctx: PageContext;
  readonly initialCategory: DigitalCategory;
  readonly onClose: () => void;
  readonly onSaved: () => void;
}) {
  const [category, setCategory] = useState<DigitalCategory>(initialCategory);
  const [form, setForm] = useState({ name: "", cost: "", price: "", stock: "" });
  const [another, setAnother] = useState(0);
  const action = useAction();
  const set = (key: keyof typeof form) => (value: string) => setForm({ ...form, [key]: value });
  const tracksStock = defaultTracksStock(category);

  async function save(keepOpen: boolean) {
    await action.run(async () => {
      const cost = digitsToRupiah(form.cost);
      const price = digitsToRupiah(form.price);
      if (cost === null || price === null) throw new Error("Isi harga modal dan harga jual.");
      await ctx.repo.addDigitalProduct({
        name: form.name,
        category,
        costRupiah: cost,
        priceRupiah: price,
        initialStock: BigInt(form.stock || "0"),
      });
      if (keepOpen) {
        ctx.changed();
        setForm({ name: "", cost: "", price: "", stock: "" });
        setAnother((count) => count + 1);
      } else {
        onSaved();
      }
    });
  }

  return (
    <Sheet title="Produk digital baru" onClose={onClose}>
      <span className="field-label">Kategori</span>
      <Chips
        value={category}
        onChange={setCategory}
        label="Kategori"
        options={DIGITAL_CATEGORIES.map((value) => ({ value, label: `${DIGITAL_CATEGORY_ICONS[value]} ${DIGITAL_CATEGORY_LABELS[value]}` }))}
      />
      <div className="form-grid two">
        <label className="span-2">
          Nama *
          <input key={another} value={form.name} onChange={(e) => set("name")(e.target.value)} placeholder={NAME_EXAMPLES[category]} autoFocus />
        </label>
        <label>
          Harga modal *
          <CurrencyInput value={form.cost} onValueChange={set("cost")} placeholder="Harga dari server" />
        </label>
        <label>
          Harga jual *
          <CurrencyInput value={form.price} onValueChange={set("price")} />
        </label>
        {tracksStock && (
          <label>
            Stok awal
            <input inputMode="numeric" value={form.stock} onChange={(e) => set("stock")(e.target.value.replace(/\D/g, ""))} placeholder="0" />
          </label>
        )}
      </div>
      {!tracksStock && <p className="muted small">Tanpa stok. Harga modal bisa disesuaikan lagi saat jual kalau harga server berubah.</p>}
      {another > 0 && <p className="success-text small">{another} produk tersimpan. Lanjut isi produk berikutnya.</p>}
      <ErrorText error={action.error} />
      <div className="button-row">
        <button type="button" className="button button-primary" disabled={action.busy} onClick={() => void save(false)}>
          Simpan
        </button>
        <button type="button" className="button button-secondary" disabled={action.busy} onClick={() => void save(true)}>
          Simpan & tambah lagi
        </button>
      </div>
    </Sheet>
  );
}

function DigitalSheet({
  ctx,
  item,
  onClose,
  onSaved,
}: {
  readonly ctx: PageContext;
  readonly item: DigitalProduct;
  readonly onClose: () => void;
  readonly onSaved: () => void;
}) {
  const [name, setName] = useState(item.name);
  const [cost, setCost] = useState(item.costRupiah.toString());
  const [price, setPrice] = useState(item.priceRupiah.toString());
  const [quantity, setQuantity] = useState("");
  const [unitCost, setUnitCost] = useState(item.costRupiah.toString());
  const [confirmArchive, setConfirmArchive] = useState(false);
  const action = useAction();
  const profit = (digitsToRupiah(price) ?? 0n) - (digitsToRupiah(cost) ?? 0n);

  return (
    <Sheet title={item.name} onClose={onClose}>
      <p className="muted">
        {DIGITAL_CATEGORY_ICONS[item.category]} {DIGITAL_CATEGORY_LABELS[item.category]}
        {item.tracksStock ? ` · Stok ${item.stockQuantity.toString()}` : " · tanpa stok"}
      </p>
      <div className="form-grid two">
        <label className="span-2">
          Nama
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          Harga modal
          <CurrencyInput value={cost} onValueChange={setCost} />
        </label>
        <label>
          Harga jual
          <CurrencyInput value={price} onValueChange={setPrice} />
        </label>
      </div>
      <p className="profit-note">
        Untung per transaksi: <strong>{rp(profit)}</strong>
      </p>
      <button
        type="button"
        className="button button-primary"
        disabled={action.busy}
        onClick={() =>
          void action.run(async () => {
            const nextCost = digitsToRupiah(cost);
            const nextPrice = digitsToRupiah(price);
            if (nextCost === null || nextPrice === null) throw new Error("Isi harga modal dan harga jual.");
            await ctx.repo.updateDigitalProduct(item.id, { name, costRupiah: nextCost, priceRupiah: nextPrice });
            onSaved();
          })
        }
      >
        Simpan perubahan
      </button>

      {item.tracksStock && (
        <fieldset className="trade-in">
          <legend>Tambah stok</legend>
          <div className="form-grid two">
            <label>
              Jumlah *
              <input inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value.replace(/\D/g, ""))} />
            </label>
            <label>
              Modal per kartu *
              <CurrencyInput value={unitCost} onValueChange={setUnitCost} />
            </label>
          </div>
          <button
            type="button"
            className="button button-secondary"
            disabled={action.busy || quantity === ""}
            onClick={() =>
              void action.run(async () => {
                await ctx.repo.restockDigitalProduct(item.id, BigInt(quantity), digitsToRupiah(unitCost) ?? 0n);
                onSaved();
              })
            }
          >
            Tambah stok
          </button>
        </fieldset>
      )}

      {!confirmArchive ? (
        <button type="button" className="button button-danger-quiet" onClick={() => setConfirmArchive(true)}>
          Hapus dari daftar
        </button>
      ) : (
        <div className="confirm-box">
          <p>Hapus {item.name} dari daftar jual? Nota lama tetap tersimpan.</p>
          <div className="button-row">
            <button
              type="button"
              className="button button-danger"
              disabled={action.busy}
              onClick={() =>
                void action.run(async () => {
                  await ctx.repo.archiveDigitalProduct(item.id);
                  onSaved();
                })
              }
            >
              Ya, hapus
            </button>
            <button type="button" className="button button-quiet" onClick={() => setConfirmArchive(false)}>
              Batal
            </button>
          </div>
        </div>
      )}
      <ErrorText error={action.error} />
    </Sheet>
  );
}
