import { useState } from "react";
import type { Accessory } from "../data/repository";
import { PhotoStrip, ProductThumb, type StripPhoto } from "./PhotoStrip";
import { can } from "../domain/auth";
import { CurrencyInput } from "./CurrencyInput";
import { EmptyState, ErrorText, Sheet, useAction, useLoad } from "./common";
import type { PageContext } from "./context";
import { digitsToRupiah, rp } from "./format";

const LOW_STOCK = 2n;

export function AccessoriesPage({ ctx }: { readonly ctx: PageContext }) {
  const manage = can(ctx.user, "manageAccessories");
  const showCost = can(ctx.user, "viewCostAndProfit");
  const items = useLoad(() => ctx.repo.listAccessories(), [ctx.repo, ctx.dataVersion]);
  const thumbs = useLoad(() => ctx.repo.coverThumbnails("accessory"), [ctx.repo, ctx.dataVersion]);
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<Accessory | null>(null);

  const query = search.trim().toLowerCase();
  const list = (items.data ?? []).filter(
    (item) =>
      query === "" ||
      item.name.toLowerCase().includes(query) ||
      (item.category ?? "").toLowerCase().includes(query),
  );
  const lowCount = (items.data ?? []).filter((item) => item.stockQuantity <= LOW_STOCK).length;

  return (
    <div className="page">
      <div className="stat-row">
        <div className="stat">
          <span>Jenis aksesoris</span>
          <strong>{items.data?.length ?? "…"}</strong>
        </div>
        <div className={lowCount > 0 ? "stat stat-warn" : "stat"}>
          <span>Stok menipis (≤ {LOW_STOCK.toString()})</span>
          <strong>{lowCount}</strong>
        </div>
      </div>
      <div className="toolbar">
        <input
          className="search-input"
          type="search"
          placeholder="Cari aksesoris atau kategori…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        {manage && (
          <button type="button" className="button button-primary" onClick={() => setAdding(true)}>
            + Aksesoris baru
          </button>
        )}
      </div>
      <ErrorText error={items.error} />
      {list.length === 0 ? (
        <EmptyState>{items.data?.length === 0 ? "Belum ada aksesoris." : "Tidak ada yang cocok."}</EmptyState>
      ) : (
        <ul className="card-list">
          {list.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className="list-card"
                onClick={() => setSelected(item)}
                disabled={!manage}
              >
                <ProductThumb src={thumbs.data?.get(item.id)} kind="aksesoris" />
                <span className="list-card-main">
                  <strong>{item.name}</strong>
                  <span className={item.stockQuantity <= LOW_STOCK ? "warn-text" : "muted"}>
                    Stok {item.stockQuantity.toString()}
                    {item.category ? ` · ${item.category}` : ""}
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
        <NewAccessorySheet
          ctx={ctx}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            ctx.changed();
          }}
        />
      )}
      {selected !== null && (
        <AccessorySheet
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

function NewAccessorySheet({
  ctx,
  onClose,
  onSaved,
}: {
  readonly ctx: PageContext;
  readonly onClose: () => void;
  readonly onSaved: () => void;
}) {
  const [form, setForm] = useState({ name: "", category: "", cost: "", price: "", stock: "" });
  const [photos, setPhotos] = useState<readonly StripPhoto[]>([]);
  const action = useAction();
  const set = (key: keyof typeof form) => (value: string) => setForm({ ...form, [key]: value });

  return (
    <Sheet title="Aksesoris baru" onClose={onClose}>
      <PhotoStrip
        photos={photos}
        max={1}
        onAdd={async (photo) => setPhotos([{ ...photo, key: `new-${Date.now()}` }])}
        onRemove={async () => setPhotos([])}
      />
      <div className="form-grid two">
        <label className="span-2">
          Nama *
          <input value={form.name} onChange={(e) => set("name")(e.target.value)} placeholder="Tempered glass Samsung A15" autoFocus />
        </label>
        <label>
          Kategori
          <input value={form.category} onChange={(e) => set("category")(e.target.value)} placeholder="Tempered glass" list="accessory-categories" />
          <datalist id="accessory-categories">
            <option value="Casing" />
            <option value="Tempered glass" />
            <option value="Charger" />
            <option value="Kabel data" />
            <option value="Earphone" />
            <option value="Memori" />
            <option value="Powerbank" />
          </datalist>
        </label>
        <label>
          Stok awal
          <input inputMode="numeric" value={form.stock} onChange={(e) => set("stock")(e.target.value.replace(/\D/g, ""))} placeholder="0" />
        </label>
        <label>
          Harga modal *
          <CurrencyInput value={form.cost} onValueChange={set("cost")} placeholder="Harga kulakan" />
        </label>
        <label>
          Harga jual *
          <CurrencyInput value={form.price} onValueChange={set("price")} />
        </label>
      </div>
      <ErrorText error={action.error} />
      <button
        type="button"
        className="button button-primary button-block"
        disabled={action.busy}
        onClick={() =>
          void action.run(async () => {
            const cost = digitsToRupiah(form.cost);
            const price = digitsToRupiah(form.price);
            if (cost === null || price === null) throw new Error("Isi harga modal dan harga jual.");
            const created = await ctx.repo.addAccessory({
              name: form.name,
              category: form.category,
              costRupiah: cost,
              priceRupiah: price,
              initialStock: BigInt(form.stock || "0"),
            });
            for (const photo of photos) {
              await ctx.repo.addPhoto({ type: "accessory", id: created.id }, photo);
            }
            onSaved();
          })
        }
      >
        Simpan
      </button>
    </Sheet>
  );
}

function AccessorySheet({
  ctx,
  item,
  onClose,
  onSaved,
}: {
  readonly ctx: PageContext;
  readonly item: Accessory;
  readonly onClose: () => void;
  readonly onSaved: () => void;
}) {
  const [quantity, setQuantity] = useState("");
  const [unitCost, setUnitCost] = useState(item.costRupiah.toString());
  const [supplier, setSupplier] = useState("");
  const [price, setPrice] = useState(item.priceRupiah.toString());
  const action = useAction();
  const owner = { type: "accessory" as const, id: item.id };
  const photos = useLoad(() => ctx.repo.listPhotos(owner), [ctx.repo, item.id]);

  return (
    <Sheet title={item.name} onClose={onClose}>
      <PhotoStrip
        photos={(photos.data ?? []).map((photo) => ({ ...photo, key: photo.id }))}
        max={1}
        onAdd={async (photo) => {
          await ctx.repo.addPhoto(owner, photo);
          photos.reload();
          ctx.changed();
        }}
        onRemove={async (id) => {
          await ctx.repo.deletePhoto(id);
          photos.reload();
          ctx.changed();
        }}
      />
      <dl className="detail-list">
        <div><dt>Stok</dt><dd>{item.stockQuantity.toString()}</dd></div>
        <div><dt>Harga modal</dt><dd>{rp(item.costRupiah)}</dd></div>
        <div><dt>Harga jual</dt><dd>{rp(item.priceRupiah)}</dd></div>
        <div><dt>Untung per barang</dt><dd>{rp(item.priceRupiah - item.costRupiah)}</dd></div>
      </dl>

      <fieldset className="trade-in">
        <legend>Tambah stok</legend>
        <div className="form-grid two">
          <label>
            Jumlah *
            <input inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value.replace(/\D/g, ""))} />
          </label>
          <label>
            Modal per barang *
            <CurrencyInput value={unitCost} onValueChange={setUnitCost} />
          </label>
          <label className="span-2">
            Supplier
            <input value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="Sales / Shopee / Tokopedia" />
          </label>
        </div>
        <p className="muted small">Harga modal aksesoris ikut berubah ke harga kulakan terbaru.</p>
        <button
          type="button"
          className="button button-primary"
          disabled={action.busy || quantity === ""}
          onClick={() =>
            void action.run(async () => {
              await ctx.repo.restockAccessory(item.id, BigInt(quantity), digitsToRupiah(unitCost) ?? 0n, supplier);
              onSaved();
            })
          }
        >
          Tambah stok
        </button>
      </fieldset>

      <fieldset className="trade-in">
        <legend>Ubah harga jual</legend>
        <div className="inline-form">
          <CurrencyInput value={price} onValueChange={setPrice} aria-label="Harga jual baru" />
          <button
            type="button"
            className="button button-secondary"
            disabled={action.busy}
            onClick={() =>
              void action.run(async () => {
                const next = digitsToRupiah(price);
                if (next === null) throw new Error("Isi harga jual.");
                await ctx.repo.updateAccessoryPrice(item.id, next);
                onSaved();
              })
            }
          >
            Simpan harga
          </button>
        </div>
      </fieldset>
      <ErrorText error={action.error} />
    </Sheet>
  );
}
