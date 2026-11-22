import { useMemo, useState } from "react";
import type { Accessory, DigitalProduct, PhoneUnit, SaleLineInput, SaleRecord, ServiceOrder } from "../data/repository";
import { can } from "../domain/auth";
import {
  DIGITAL_CATEGORIES,
  DIGITAL_CATEGORY_ICONS,
  DIGITAL_CATEGORY_LABELS,
  targetLabel,
  type DigitalCategory,
} from "../domain/digital";
import type { PhoneCondition } from "../domain/phones";
import type { PaymentMethod } from "../domain/sales";
import { SERVICE_STATUS_LABELS } from "../domain/service";
import { CurrencyInput } from "./CurrencyInput";
import { Chips, EmptyState, ErrorText, Sheet, useAction, useLoad } from "./common";
import type { PageContext } from "./context";
import { ageLabel, digitsToRupiah, rp, rpSigned, rupiahToDigits } from "./format";
import { ProductThumb } from "./PhotoStrip";
import { saleReceiptText } from "./receipts";
import {
  NewServiceSheet,
  PAYMENT_OPTIONS,
  STATUS_BADGE,
  ServiceDetailSheet,
  ServiceDoneSheet,
  ServicePaySheet,
} from "./ServicePage";
import { openWhatsApp, shareText } from "./whatsapp";

/**
 * Kasir punya tiga bagian:
 *  - Barang: HP + aksesoris (kotak bergambar, ketuk = masuk keranjang).
 *  - Digital: pulsa, paket data, perdana, top up, token, transaksi manual.
 *    Masuk keranjang yang sama, jadi satu nota bisa berisi casing + pulsa.
 *  - Service: terima service baru dan pelunasan HP yang siap diambil.
 */

type CartLine =
  | { readonly key: string; readonly kind: "hp"; readonly phone: PhoneUnit; readonly price: string }
  | {
      readonly key: string;
      readonly kind: "aksesoris";
      readonly accessory: Accessory;
      readonly quantity: number;
      readonly price: string;
    }
  | {
      readonly key: string;
      readonly kind: "digital";
      /** Null = transaksi manual. */
      readonly product: DigitalProduct | null;
      readonly category: DigitalCategory;
      readonly name: string;
      readonly target: string;
      readonly quantity: number;
      readonly price: string;
      readonly cost: string;
    };

interface TradeInForm {
  readonly brand: string;
  readonly model: string;
  readonly variant: string;
  readonly imei1: string;
  readonly condition: PhoneCondition;
  readonly completeness: string;
  readonly credit: string;
}

const EMPTY_TRADE_IN: TradeInForm = {
  brand: "",
  model: "",
  variant: "",
  imei1: "",
  condition: "bekas",
  completeness: "",
  credit: "",
};

type Mode = "barang" | "digital" | "service";
type Filter = "semua" | "hp" | "aksesoris";
type DigitalFilter = "semua" | DigitalCategory;

/** Lembar isian digital: produk dari daftar, atau transaksi manual. */
type DigitalDraft = { readonly product: DigitalProduct | null };

let keySeed = 0;
const nextKey = (prefix: string) => `${prefix}-${Date.now()}-${++keySeed}`;

export function SalePage({ ctx }: { readonly ctx: PageContext }) {
  const stock = useLoad(
    async () => ({
      phones: await ctx.repo.listPhonesInStock(),
      accessories: await ctx.repo.listAccessories(),
      digital: await ctx.repo.listDigitalProducts(),
      services: await ctx.repo.listOpenServices(),
      phoneThumbs: await ctx.repo.coverThumbnails("phone"),
      accessoryThumbs: await ctx.repo.coverThumbnails("accessory"),
    }),
    [ctx.repo, ctx.dataVersion],
  );
  const [mode, setMode] = useState<Mode>("barang");
  const [filter, setFilter] = useState<Filter>("semua");
  const [digitalFilter, setDigitalFilter] = useState<DigitalFilter>("semua");
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<readonly CartLine[]>([]);
  const [checkout, setCheckout] = useState(false);
  const [receipt, setReceipt] = useState<SaleRecord | null>(null);
  const [digitalDraft, setDigitalDraft] = useState<DigitalDraft | null>(null);

  const cartCount = cart.reduce((sum, line) => sum + (line.kind === "hp" ? 1 : line.quantity), 0);
  const cartTotal = cart.reduce((sum, line) => {
    const price = digitsToRupiah(line.price) ?? 0n;
    return sum + (line.kind === "hp" ? price : price * BigInt(line.quantity));
  }, 0n);
  const readyServices = (stock.data?.services ?? []).filter((order) => order.status !== "proses").length;

  function addDigitalFromStock(product: DigitalProduct) {
    setCart((current) => {
      const existing = current.find((line) => line.kind === "digital" && line.product?.id === product.id);
      if (existing === undefined) {
        return [
          ...current,
          {
            key: nextKey("dig"),
            kind: "digital",
            product,
            category: product.category,
            name: product.name,
            target: "",
            quantity: 1,
            price: product.priceRupiah.toString(),
            cost: product.costRupiah.toString(),
          },
        ];
      }
      return current.map((line) =>
        line === existing && line.kind === "digital" && BigInt(line.quantity) < product.stockQuantity
          ? { ...line, quantity: line.quantity + 1 }
          : line,
      );
    });
  }

  return (
    <div className={cart.length > 0 && mode !== "service" ? "page sale-page has-cart" : "page sale-page"}>
      <div className="sale-search">
        <div className="segmented" role="tablist" aria-label="Bagian kasir">
          {(
            [
              { id: "barang", label: "📱 Barang" },
              { id: "digital", label: "📶 Digital" },
              { id: "service", label: "🔧 Service", badge: readyServices },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={mode === item.id}
              className={mode === item.id ? "segment active" : "segment"}
              onClick={() => {
                setMode(item.id);
                setSearch("");
              }}
            >
              {item.label}
              {"badge" in item && item.badge > 0 && <span className="segment-badge">{item.badge}</span>}
            </button>
          ))}
        </div>
        {mode !== "service" && (
          <input
            className="search-input"
            type="search"
            placeholder={mode === "barang" ? "Cari HP, IMEI, atau aksesoris…" : "Cari pulsa, paket, perdana…"}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        )}
        {mode === "barang" && (
          <Chips
            value={filter}
            onChange={setFilter}
            label="Jenis barang"
            options={[
              { value: "semua", label: "Semua" },
              { value: "hp", label: `HP (${stock.data?.phones.length ?? 0})` },
              { value: "aksesoris", label: "Aksesoris" },
            ]}
          />
        )}
        {mode === "digital" && (stock.data?.digital.length ?? 0) > 0 && (
          <Chips
            value={digitalFilter}
            onChange={setDigitalFilter}
            label="Kategori digital"
            options={[
              { value: "semua", label: "Semua" },
              ...DIGITAL_CATEGORIES.filter((category) => (stock.data?.digital ?? []).some((item) => item.category === category)).map(
                (category) => ({ value: category, label: DIGITAL_CATEGORY_LABELS[category] }),
              ),
            ]}
          />
        )}
      </div>
      <ErrorText error={stock.error} />

      {mode === "barang" && stock.data !== null && (
        <GoodsGrid
          phones={stock.data.phones}
          accessories={stock.data.accessories}
          phoneThumbs={stock.data.phoneThumbs}
          accessoryThumbs={stock.data.accessoryThumbs}
          filter={filter}
          search={search}
          cart={cart}
          setCart={setCart}
        />
      )}

      {mode === "digital" && stock.data !== null && (
        <DigitalGrid
          ctx={ctx}
          products={stock.data.digital}
          filter={digitalFilter}
          search={search}
          cart={cart}
          onPick={(product) => {
            if (product !== null && product.tracksStock) addDigitalFromStock(product);
            else setDigitalDraft({ product });
          }}
        />
      )}

      {mode === "service" && <ServiceCashier ctx={ctx} orders={stock.data?.services ?? []} />}

      {cart.length > 0 && mode !== "service" && (
        <div className="cart-bar">
          <button type="button" className="cart-bar-clear" onClick={() => setCart([])} aria-label="Kosongkan keranjang">
            ✕
          </button>
          <div className="cart-bar-info">
            <span>{cartCount} item</span>
            <strong>{rp(cartTotal)}</strong>
          </div>
          <button type="button" className="button button-primary cart-bar-pay" onClick={() => setCheckout(true)}>
            Bayar →
          </button>
        </div>
      )}

      {digitalDraft !== null && (
        <DigitalLineSheet
          ctx={ctx}
          product={digitalDraft.product}
          onClose={() => setDigitalDraft(null)}
          onAdd={(line) => {
            setCart((current) => [...current, line]);
            setDigitalDraft(null);
          }}
        />
      )}
      {checkout && (
        <CheckoutSheet
          ctx={ctx}
          cart={cart}
          setCart={setCart}
          thumbs={{ phone: stock.data?.phoneThumbs, accessory: stock.data?.accessoryThumbs }}
          onClose={() => setCheckout(false)}
          onSaved={(sale) => {
            setCheckout(false);
            setCart([]);
            setSearch("");
            setReceipt(sale);
            ctx.changed();
          }}
        />
      )}
      {receipt !== null && <ReceiptSheet ctx={ctx} sale={receipt} onClose={() => setReceipt(null)} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bagian Barang
// ---------------------------------------------------------------------------

function GoodsGrid({
  phones: allPhones,
  accessories: allAccessories,
  phoneThumbs,
  accessoryThumbs,
  filter,
  search,
  cart,
  setCart,
}: {
  readonly phones: readonly PhoneUnit[];
  readonly accessories: readonly Accessory[];
  readonly phoneThumbs: ReadonlyMap<string, string>;
  readonly accessoryThumbs: ReadonlyMap<string, string>;
  readonly filter: Filter;
  readonly search: string;
  readonly cart: readonly CartLine[];
  readonly setCart: (update: (current: readonly CartLine[]) => readonly CartLine[]) => void;
}) {
  const query = search.trim().toLowerCase();
  const phones = allPhones.filter(
    (phone) =>
      query === "" ||
      phone.displayName.toLowerCase().includes(query) ||
      phone.imei1.includes(query) ||
      (phone.imei2 ?? "").includes(query),
  );
  const accessories = allAccessories.filter(
    (item) => query === "" || item.name.toLowerCase().includes(query) || (item.category ?? "").toLowerCase().includes(query),
  );

  function togglePhone(phone: PhoneUnit) {
    setCart((current) =>
      current.some((line) => line.kind === "hp" && line.phone.id === phone.id)
        ? current.filter((line) => !(line.kind === "hp" && line.phone.id === phone.id))
        : [...current, { key: `hp-${phone.id}`, kind: "hp", phone, price: rupiahToDigits(phone.plannedPriceRupiah) }],
    );
  }

  function addAccessory(accessory: Accessory) {
    setCart((current) => {
      const existing = current.find((line) => line.kind === "aksesoris" && line.accessory.id === accessory.id);
      if (existing === undefined) {
        return [
          ...current,
          { key: `aks-${accessory.id}`, kind: "aksesoris", accessory, quantity: 1, price: accessory.priceRupiah.toString() },
        ];
      }
      return current.map((line) =>
        line === existing && line.kind === "aksesoris" && BigInt(line.quantity) < accessory.stockQuantity
          ? { ...line, quantity: line.quantity + 1 }
          : line,
      );
    });
  }

  const quantityOf = (accessoryId: string) => {
    const line = cart.find((item) => item.kind === "aksesoris" && item.accessory.id === accessoryId);
    return line?.kind === "aksesoris" ? line.quantity : 0;
  };
  const phoneInCart = (phoneId: string) => cart.some((line) => line.kind === "hp" && line.phone.id === phoneId);

  return (
    <>
      {filter !== "aksesoris" && (
        <section>
          {filter === "semua" && <h2 className="section-title">HP</h2>}
          {phones.length === 0 ? (
            <EmptyState>{allPhones.length === 0 ? "Belum ada HP di stok." : "Tidak ada HP yang cocok."}</EmptyState>
          ) : (
            <div className="product-grid">
              {phones.map((phone) => {
                const selected = phoneInCart(phone.id);
                return (
                  <button
                    key={phone.id}
                    type="button"
                    className={selected ? "product-card selected" : "product-card"}
                    onClick={() => togglePhone(phone)}
                    aria-pressed={selected}
                  >
                    <ProductThumb src={phoneThumbs.get(phone.id)} kind="hp" size="lg" />
                    {selected && <span className="product-check">✓</span>}
                    <span className="product-name">{phone.displayName}</span>
                    <span className="product-meta">
                      {phone.condition === "baru" ? "Baru" : "Bekas"} · …{phone.imei1.slice(-4)}
                    </span>
                    {phone.plannedPriceRupiah !== null ? (
                      <span className="product-price">{rp(phone.plannedPriceRupiah)}</span>
                    ) : (
                      <span className="product-meta">Harga diisi saat bayar</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </section>
      )}

      {filter !== "hp" && (
        <section>
          {filter === "semua" && <h2 className="section-title">Aksesoris</h2>}
          {accessories.length === 0 ? (
            <EmptyState>{allAccessories.length === 0 ? "Belum ada aksesoris." : "Tidak ada aksesoris yang cocok."}</EmptyState>
          ) : (
            <div className="product-grid">
              {accessories.map((item) => {
                const quantity = quantityOf(item.id);
                const soldOut = item.stockQuantity === 0n;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={quantity > 0 ? "product-card selected" : "product-card"}
                    onClick={() => addAccessory(item)}
                    disabled={soldOut}
                  >
                    <ProductThumb src={accessoryThumbs.get(item.id)} kind="aksesoris" size="lg" />
                    {quantity > 0 && <span className="product-check">{quantity}</span>}
                    <span className="product-name">{item.name}</span>
                    <span className={item.stockQuantity <= 2n ? "product-meta warn-text" : "product-meta"}>
                      {soldOut ? "Stok habis" : `Stok ${item.stockQuantity.toString()}`}
                    </span>
                    <span className="product-price">{rp(item.priceRupiah)}</span>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Bagian Digital
// ---------------------------------------------------------------------------

function DigitalGrid({
  ctx,
  products,
  filter,
  search,
  cart,
  onPick,
}: {
  readonly ctx: PageContext;
  readonly products: readonly DigitalProduct[];
  readonly filter: DigitalFilter;
  readonly search: string;
  readonly cart: readonly CartLine[];
  readonly onPick: (product: DigitalProduct | null) => void;
}) {
  const query = search.trim().toLowerCase();
  const list = products.filter(
    (item) => (filter === "semua" || item.category === filter) && (query === "" || item.name.toLowerCase().includes(query)),
  );
  const inCart = (productId: string) =>
    cart.reduce((sum, line) => sum + (line.kind === "digital" && line.product?.id === productId ? line.quantity : 0), 0);

  return (
    <section>
      <div className="product-grid compact">
        <button type="button" className="product-card manual-card" onClick={() => onPick(null)}>
          <span className="product-thumb thumb-md placeholder" aria-hidden="true">✍️</span>
          <span className="product-name">Transaksi manual</span>
          <span className="product-meta">Isi nama, nomor, modal &amp; harga sendiri</span>
        </button>
        {list.map((item) => {
          const count = inCart(item.id);
          const soldOut = item.tracksStock && item.stockQuantity === 0n;
          return (
            <button
              key={item.id}
              type="button"
              className={count > 0 ? "product-card selected" : "product-card"}
              onClick={() => onPick(item)}
              disabled={soldOut}
            >
              <ProductThumb src={undefined} kind="digital" icon={DIGITAL_CATEGORY_ICONS[item.category]} size="md" />
              {count > 0 && <span className="product-check">{count}</span>}
              <span className="product-name">{item.name}</span>
              <span className={item.tracksStock && item.stockQuantity <= 2n ? "product-meta warn-text" : "product-meta"}>
                {item.tracksStock
                  ? soldOut
                    ? "Stok habis"
                    : `Stok ${item.stockQuantity.toString()}`
                  : DIGITAL_CATEGORY_LABELS[item.category]}
              </span>
              <span className="product-price">{rp(item.priceRupiah)}</span>
            </button>
          );
        })}
      </div>
      {products.length === 0 && (
        <p className="muted small digital-hint">
          Belum ada daftar harga digital.{" "}
          {can(ctx.user, "manageAccessories") ? (
            <button type="button" className="link-like" onClick={() => ctx.open("digital")}>
              Isi daftar Produk digital
            </button>
          ) : (
            "Minta Owner mengisi daftar Produk digital."
          )}{" "}
          supaya tinggal ketuk, atau pakai Transaksi manual.
        </p>
      )}
    </section>
  );
}

/** Isi nomor tujuan (dan harga) sebelum pulsa/top up masuk keranjang. */
function DigitalLineSheet({
  ctx,
  product,
  onClose,
  onAdd,
}: {
  readonly ctx: PageContext;
  readonly product: DigitalProduct | null;
  readonly onClose: () => void;
  readonly onAdd: (line: CartLine) => void;
}) {
  const showCost = can(ctx.user, "viewCostAndProfit");
  const manual = product === null;
  const [category, setCategory] = useState<DigitalCategory>(product?.category ?? "pulsa");
  const [name, setName] = useState(product?.name ?? "");
  const [target, setTarget] = useState("");
  const [price, setPrice] = useState(product?.priceRupiah.toString() ?? "");
  const [cost, setCost] = useState(product?.costRupiah.toString() ?? "");
  const [error, setError] = useState<string | null>(null);
  const label = targetLabel(category);
  const profit = (digitsToRupiah(price) ?? 0n) - (digitsToRupiah(cost) ?? 0n);

  function add() {
    if (manual && name.trim() === "") return setError("Isi nama transaksi, mis. Top up DANA 50rb.");
    if (label !== null && target.trim() === "" && category !== "lainnya") return setError(`Isi ${label.toLowerCase()}.`);
    if (digitsToRupiah(price) === null) return setError("Isi harga jual.");
    if (digitsToRupiah(cost) === null) return setError("Isi harga modal.");
    onAdd({
      key: nextKey("dig"),
      kind: "digital",
      product,
      category,
      name: name.trim(),
      target: target.trim(),
      quantity: 1,
      price,
      cost,
    });
  }

  return (
    <Sheet title={manual ? "Transaksi manual" : product.name} onClose={onClose}>
      {manual && (
        <>
          <Chips
            value={category}
            onChange={setCategory}
            label="Jenis"
            options={DIGITAL_CATEGORIES.filter((value) => value !== "perdana").map((value) => ({
              value,
              label: `${DIGITAL_CATEGORY_ICONS[value]} ${DIGITAL_CATEGORY_LABELS[value]}`,
            }))}
          />
          <label className="block-label">
            Nama transaksi *
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Top up DANA 50rb" autoFocus />
          </label>
        </>
      )}
      {label !== null && (
        <label className="block-label">
          {label}
          {category !== "lainnya" ? " *" : ""}
          <input
            inputMode={category === "topup" || category === "lainnya" ? "text" : "numeric"}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder={category === "token" ? "No. meter 11–12 digit" : "08…"}
            autoFocus={!manual}
          />
        </label>
      )}
      <div className="form-grid two">
        <label>
          Harga jual *
          <CurrencyInput value={price} onValueChange={setPrice} />
        </label>
        {(manual || showCost) && (
          <label>
            Harga modal *
            <CurrencyInput value={cost} onValueChange={setCost} placeholder="Harga dari server" />
          </label>
        )}
      </div>
      {showCost && digitsToRupiah(price) !== null && digitsToRupiah(cost) !== null && (
        <p className="profit-note">
          Untung: <strong>{rpSigned(profit)}</strong>
        </p>
      )}
      <ErrorText error={error} />
      <button type="button" className="button button-primary button-block" onClick={add}>
        Masukkan ke keranjang
      </button>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Bagian Service
// ---------------------------------------------------------------------------

function ServiceCashier({ ctx, orders }: { readonly ctx: PageContext; readonly orders: readonly ServiceOrder[] }) {
  const [creating, setCreating] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [paying, setPaying] = useState<ServiceOrder | null>(null);
  const [paid, setPaid] = useState<ServiceOrder | null>(null);
  const [search, setSearch] = useState("");

  const query = search.trim().toLowerCase();
  const match = (order: ServiceOrder) =>
    query === "" ||
    order.customerName.toLowerCase().includes(query) ||
    order.device.toLowerCase().includes(query) ||
    order.number.toLowerCase().includes(query);
  const ready = orders.filter((order) => order.status !== "proses" && match(order));
  const working = orders.filter((order) => order.status === "proses" && match(order));
  const detail = orders.find((order) => order.id === detailId) ?? null;

  return (
    <>
      <div className="toolbar">
        <input
          className="search-input"
          type="search"
          placeholder="Cari nama, HP, atau nomor service…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <button type="button" className="button button-primary" onClick={() => setCreating(true)}>
          + Terima service
        </button>
      </div>

      <section>
        <h2 className="section-title">Siap diambil & dibayar ({ready.length})</h2>
        {ready.length === 0 ? (
          <EmptyState>Belum ada HP service yang siap diambil.</EmptyState>
        ) : (
          <ul className="card-list">
            {ready.map((order) => {
              const balance = order.balanceDueRupiah ?? 0n;
              return (
                <li key={order.id}>
                  <div className="list-card pay-card">
                    <button type="button" className="list-card-main plain" onClick={() => setDetailId(order.id)}>
                      <strong>
                        {order.customerName} · {order.device}
                      </strong>
                      <span className="muted">{order.complaint}</span>
                      <span className="badges">
                        <span className={STATUS_BADGE[order.status]}>{SERVICE_STATUS_LABELS[order.status]}</span>
                        <span className="badge badge-muted">{order.number}</span>
                      </span>
                    </button>
                    <div className="pay-card-side">
                      <span className="muted small">{balance >= 0n ? "Sisa bayar" : "Kembalikan DP"}</span>
                      <strong>{rp(balance >= 0n ? balance : -balance)}</strong>
                      <button type="button" className="button button-primary" onClick={() => setPaying(order)}>
                        Bayar
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <h2 className="section-title">Sedang dikerjakan ({working.length})</h2>
        {working.length === 0 ? (
          <EmptyState>Tidak ada service yang sedang dikerjakan.</EmptyState>
        ) : (
          <ul className="card-list">
            {working.map((order) => (
              <li key={order.id}>
                <button type="button" className="list-card" onClick={() => setDetailId(order.id)}>
                  <span className="list-card-main">
                    <strong>
                      {order.customerName} · {order.device}
                    </strong>
                    <span className="muted">{order.complaint}</span>
                    <span className="badges">
                      <span className="badge badge-muted">{order.number}</span>
                      <span className="badge badge-muted">masuk {ageLabel(order.receivedAtMs)}</span>
                    </span>
                  </span>
                  <span className="list-card-side">
                    {order.estimateRupiah !== null && <span className="muted">± {rp(order.estimateRupiah)}</span>}
                    {order.depositRupiah > 0n && <span className="muted">DP {rp(order.depositRupiah)}</span>}
                    <span className="link-like">Selesaikan →</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {creating && (
        <NewServiceSheet
          ctx={ctx}
          onClose={() => setCreating(false)}
          onCreated={(order) => {
            setCreating(false);
            ctx.changed();
            setDetailId(order.id);
          }}
        />
      )}
      {detail !== null && paying === null && (
        <ServiceDetailSheet ctx={ctx} order={detail} onClose={() => setDetailId(null)} onPay={() => setPaying(detail)} />
      )}
      {paying !== null && (
        <ServicePaySheet
          ctx={ctx}
          order={paying}
          onClose={() => setPaying(null)}
          onPaid={(order) => {
            setPaying(null);
            setDetailId(null);
            setPaid(order);
          }}
        />
      )}
      {paid !== null && <ServiceDoneSheet ctx={ctx} order={paid} onClose={() => setPaid(null)} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// Bayar
// ---------------------------------------------------------------------------

function lineQuantity(line: CartLine): bigint {
  return line.kind === "hp" ? 1n : BigInt(line.quantity);
}

function lineCost(line: CartLine): bigint {
  switch (line.kind) {
    case "hp":
      return line.phone.costRupiah;
    case "aksesoris":
      return line.accessory.costRupiah;
    case "digital":
      return digitsToRupiah(line.cost) ?? 0n;
  }
}

function CheckoutSheet({
  ctx,
  cart,
  setCart,
  thumbs,
  onClose,
  onSaved,
}: {
  readonly ctx: PageContext;
  readonly cart: readonly CartLine[];
  readonly setCart: (update: (current: readonly CartLine[]) => readonly CartLine[]) => void;
  readonly thumbs: {
    readonly phone: ReadonlyMap<string, string> | undefined;
    readonly accessory: ReadonlyMap<string, string> | undefined;
  };
  readonly onClose: () => void;
  readonly onSaved: (sale: SaleRecord) => void;
}) {
  const showCost = can(ctx.user, "viewCostAndProfit");
  const hasPhone = cart.some((line) => line.kind === "hp");
  const [tradeIn, setTradeIn] = useState<TradeInForm | null>(null);
  const [showCustomer, setShowCustomer] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [payment, setPayment] = useState<PaymentMethod>("tunai");
  const action = useAction();
  const activeTradeIn = hasPhone ? tradeIn : null;

  const totals = useMemo(() => {
    let items = 0n;
    let cost = 0n;
    let complete = true;
    for (const line of cart) {
      const price = digitsToRupiah(line.price);
      if (price === null) complete = false;
      const quantity = lineQuantity(line);
      items += (price ?? 0n) * quantity;
      cost += lineCost(line) * quantity;
    }
    const credit = activeTradeIn === null ? 0n : digitsToRupiah(activeTradeIn.credit) ?? 0n;
    return { items, credit, due: items - credit, profit: items - cost, complete };
  }, [cart, activeTradeIn]);

  function updateLine(key: string, patch: Partial<{ price: string; quantity: number }>) {
    setCart((current) =>
      current
        .map((line) => (line.key === key ? ({ ...line, ...patch } as CartLine) : line))
        .filter((line) => line.kind === "hp" || line.quantity > 0),
    );
  }

  async function save() {
    await action.run(async () => {
      if (!totals.complete) throw new Error("Isi harga jual semua barang dulu.");
      const lines: SaleLineInput[] = cart.map((line): SaleLineInput => {
        const price = digitsToRupiah(line.price) ?? 0n;
        switch (line.kind) {
          case "hp":
            return { kind: "hp", phoneUnitId: line.phone.id, priceRupiah: price };
          case "aksesoris":
            return { kind: "aksesoris", accessoryId: line.accessory.id, quantity: BigInt(line.quantity), unitPriceRupiah: price };
          case "digital":
            return {
              kind: "digital",
              digitalProductId: line.product?.id ?? null,
              name: line.product === null ? line.name : null,
              target: line.target,
              quantity: BigInt(line.quantity),
              unitPriceRupiah: price,
              unitCostRupiah: digitsToRupiah(line.cost),
            };
        }
      });
      const sale = await ctx.repo.recordSale({
        lines,
        tradeIn:
          activeTradeIn === null
            ? null
            : {
                brand: activeTradeIn.brand,
                model: activeTradeIn.model,
                variant: activeTradeIn.variant,
                imei1: activeTradeIn.imei1,
                condition: activeTradeIn.condition,
                completeness: activeTradeIn.completeness,
                creditRupiah: digitsToRupiah(activeTradeIn.credit) ?? 0n,
              },
        paymentMethod: payment,
        customerName,
        customerPhone,
      });
      onSaved(sale);
    });
  }

  if (cart.length === 0) {
    return (
      <Sheet title="Bayar" onClose={onClose}>
        <EmptyState>Keranjang kosong.</EmptyState>
      </Sheet>
    );
  }

  return (
    <Sheet title="Bayar" onClose={onClose} wide>
      <ul className="checkout-list">
        {cart.map((line) => {
          const stepperMax =
            line.kind === "aksesoris"
              ? line.accessory.stockQuantity
              : line.kind === "digital" && line.product?.tracksStock
                ? line.product.stockQuantity
                : null;
          return (
            <li key={line.key} className="checkout-line">
              {line.kind === "digital" ? (
                <ProductThumb src={undefined} kind="digital" icon={DIGITAL_CATEGORY_ICONS[line.category]} size="sm" />
              ) : (
                <ProductThumb
                  src={line.kind === "hp" ? thumbs.phone?.get(line.phone.id) : thumbs.accessory?.get(line.accessory.id)}
                  kind={line.kind}
                  size="sm"
                />
              )}
              <div className="checkout-name">
                <strong>{line.kind === "hp" ? line.phone.displayName : line.kind === "aksesoris" ? line.accessory.name : line.name}</strong>
                <span className="muted small">
                  {line.kind === "hp"
                    ? `IMEI ${line.phone.imei1}`
                    : line.kind === "aksesoris"
                      ? `${rp(line.accessory.priceRupiah)} / pcs`
                      : line.target !== ""
                        ? `ke ${line.target}`
                        : DIGITAL_CATEGORY_LABELS[line.category]}
                </span>
              </div>
              {stepperMax !== null && line.kind !== "hp" && (
                <div className="stepper">
                  <button type="button" onClick={() => updateLine(line.key, { quantity: line.quantity - 1 })} aria-label="Kurangi">
                    −
                  </button>
                  <span>{line.quantity}</span>
                  <button
                    type="button"
                    onClick={() => updateLine(line.key, { quantity: line.quantity + 1 })}
                    aria-label="Tambah"
                    disabled={BigInt(line.quantity) >= stepperMax}
                  >
                    +
                  </button>
                </div>
              )}
              <CurrencyInput
                className="price-input"
                aria-label="Harga jual"
                placeholder="Harga"
                value={line.price}
                onValueChange={(price) => updateLine(line.key, { price })}
              />
              <button
                type="button"
                className="icon-button"
                aria-label="Hapus"
                onClick={() => setCart((current) => current.filter((item) => item.key !== line.key))}
              >
                ✕
              </button>
            </li>
          );
        })}
      </ul>

      <div className="option-toggles">
        {hasPhone && (
          <button
            type="button"
            className={tradeIn !== null ? "toggle-pill on" : "toggle-pill"}
            onClick={() => setTradeIn(tradeIn === null ? EMPTY_TRADE_IN : null)}
          >
            {tradeIn !== null ? "✓ " : "+ "}Tukar tambah
          </button>
        )}
        <button
          type="button"
          className={showCustomer ? "toggle-pill on" : "toggle-pill"}
          onClick={() => setShowCustomer(!showCustomer)}
        >
          {showCustomer ? "✓ " : "+ "}Data pelanggan
        </button>
      </div>

      {activeTradeIn !== null && tradeIn !== null && (
        <fieldset className="trade-in">
          <legend>HP lama pelanggan</legend>
          <div className="form-grid two">
            <label>
              Merek
              <input value={tradeIn.brand} onChange={(e) => setTradeIn({ ...tradeIn, brand: e.target.value })} placeholder="Xiaomi" />
            </label>
            <label>
              Tipe
              <input value={tradeIn.model} onChange={(e) => setTradeIn({ ...tradeIn, model: e.target.value })} placeholder="Redmi Note 10" />
            </label>
            <label>
              IMEI 1
              <input inputMode="numeric" value={tradeIn.imei1} onChange={(e) => setTradeIn({ ...tradeIn, imei1: e.target.value })} placeholder="15 digit (*#06#)" />
            </label>
            <label>
              Nilai potongan
              <CurrencyInput value={tradeIn.credit} onValueChange={(credit) => setTradeIn({ ...tradeIn, credit })} placeholder="0" />
            </label>
            <label>
              Varian
              <input value={tradeIn.variant} onChange={(e) => setTradeIn({ ...tradeIn, variant: e.target.value })} placeholder="6/128" />
            </label>
            <label>
              Kelengkapan
              <input value={tradeIn.completeness} onChange={(e) => setTradeIn({ ...tradeIn, completeness: e.target.value })} placeholder="Unit + dus" />
            </label>
          </div>
          <Chips
            value={tradeIn.condition}
            onChange={(condition) => setTradeIn({ ...tradeIn, condition })}
            label="Kondisi HP lama"
            options={[
              { value: "bekas", label: "Bekas" },
              { value: "baru", label: "Baru" },
            ]}
          />
          <p className="muted small">HP lama masuk stok dengan modal sebesar nilai potongan. Foto bisa ditambah nanti di Stok HP.</p>
        </fieldset>
      )}

      {showCustomer && (
        <div className="form-grid two">
          <label>
            Nama pelanggan
            <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
          </label>
          <label>
            No. WA (untuk kirim nota)
            <input inputMode="tel" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} placeholder="08…" />
          </label>
        </div>
      )}

      <div className="pay-row">
        <span className="field-label">Bayar pakai</span>
        <Chips value={payment} onChange={setPayment} options={PAYMENT_OPTIONS} label="Metode bayar" />
      </div>

      <dl className="totals">
        {activeTradeIn !== null && (
          <>
            <div>
              <dt>Total barang</dt>
              <dd>{rp(totals.items)}</dd>
            </div>
            <div>
              <dt>Potongan tukar tambah</dt>
              <dd>−{rp(totals.credit)}</dd>
            </div>
          </>
        )}
        <div className="totals-main">
          <dt>{totals.due >= 0n ? "Total bayar" : "Dibayar ke pelanggan"}</dt>
          <dd>{rp(totals.due >= 0n ? totals.due : -totals.due)}</dd>
        </div>
        {showCost && (
          <div className={totals.profit >= 0n ? "profit-row" : "profit-row loss"}>
            <dt>Untung</dt>
            <dd>{totals.complete ? rpSigned(totals.profit) : "isi semua harga"}</dd>
          </div>
        )}
      </dl>
      <ErrorText error={action.error} />
      <button type="button" className="button button-primary button-block button-large" disabled={action.busy} onClick={() => void save()}>
        {action.busy ? "Menyimpan…" : "Simpan nota"}
      </button>
    </Sheet>
  );
}

export function ReceiptSheet({
  ctx,
  sale,
  onClose,
}: {
  readonly ctx: PageContext;
  readonly sale: SaleRecord;
  readonly onClose: () => void;
}) {
  const text = saleReceiptText(sale, ctx.store);
  const [error, setError] = useState<string | null>(null);
  return (
    <Sheet title={`Nota ${sale.number}`} onClose={onClose}>
      <pre className="receipt-preview">{text}</pre>
      {can(ctx.user, "viewCostAndProfit") && (
        <p className="profit-note">
          Untung nota ini: <strong>{rpSigned(sale.summary.profitRupiah)}</strong>
        </p>
      )}
      <ErrorText error={error} />
      <div className="button-row">
        {sale.customerPhone !== null && (
          <button type="button" className="button whatsapp-button" onClick={() => openWhatsApp(sale.customerPhone!, text)}>
            Kirim ke WA pelanggan
          </button>
        )}
        <button
          type="button"
          className="button button-secondary"
          onClick={() => shareText(`Nota ${sale.number}`, text).catch(() => setError("Tidak bisa membuka menu Bagikan."))}
        >
          Bagikan…
        </button>
        <button type="button" className="button button-primary" onClick={onClose}>
          Selesai
        </button>
      </div>
    </Sheet>
  );
}
