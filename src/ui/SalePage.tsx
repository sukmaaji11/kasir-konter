import { useMemo, useState } from "react";
import type { Accessory, PhoneUnit, SaleLineInput, SaleRecord } from "../data/repository";
import { can } from "../domain/auth";
import type { PhoneCondition } from "../domain/phones";
import type { PaymentMethod } from "../domain/sales";
import { CurrencyInput } from "./CurrencyInput";
import { Chips, EmptyState, ErrorText, Sheet, useAction, useLoad } from "./common";
import type { PageContext } from "./context";
import { digitsToRupiah, rp, rpSigned, rupiahToDigits } from "./format";
import { ProductThumb } from "./PhotoStrip";
import { saleReceiptText } from "./receipts";
import { openWhatsApp, shareText } from "./whatsapp";

/**
 * Kasir dua langkah:
 *  1. Pilih barang: kotak bergambar + satu kolom cari. Ketuk = masuk keranjang.
 *  2. Bayar: lembar berisi harga, tukar tambah, pelanggan, metode bayar.
 */

type CartLine =
  | { readonly key: string; readonly kind: "hp"; readonly phone: PhoneUnit; readonly price: string }
  | {
      readonly key: string;
      readonly kind: "aksesoris";
      readonly accessory: Accessory;
      readonly quantity: number;
      readonly price: string;
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

const PAYMENT_OPTIONS = [
  { value: "tunai", label: "Tunai" },
  { value: "transfer", label: "Transfer" },
  { value: "qris", label: "QRIS" },
] as const;

type Filter = "semua" | "hp" | "aksesoris";

export function SalePage({ ctx }: { readonly ctx: PageContext }) {
  const stock = useLoad(
    async () => ({
      phones: await ctx.repo.listPhonesInStock(),
      accessories: await ctx.repo.listAccessories(),
      phoneThumbs: await ctx.repo.coverThumbnails("phone"),
      accessoryThumbs: await ctx.repo.coverThumbnails("accessory"),
    }),
    [ctx.repo, ctx.dataVersion],
  );
  const [filter, setFilter] = useState<Filter>("semua");
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<readonly CartLine[]>([]);
  const [checkout, setCheckout] = useState(false);
  const [receipt, setReceipt] = useState<SaleRecord | null>(null);

  const query = search.trim().toLowerCase();
  const phones = (stock.data?.phones ?? []).filter(
    (phone) =>
      query === "" ||
      phone.displayName.toLowerCase().includes(query) ||
      phone.imei1.includes(query) ||
      (phone.imei2 ?? "").includes(query),
  );
  const accessories = (stock.data?.accessories ?? []).filter(
    (item) => query === "" || item.name.toLowerCase().includes(query) || (item.category ?? "").toLowerCase().includes(query),
  );

  const cartCount = cart.reduce((sum, line) => sum + (line.kind === "hp" ? 1 : line.quantity), 0);
  const cartTotal = cart.reduce((sum, line) => {
    const price = digitsToRupiah(line.price) ?? 0n;
    return sum + (line.kind === "hp" ? price : price * BigInt(line.quantity));
  }, 0n);

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
  const showPhones = filter !== "aksesoris";
  const showAccessories = filter !== "hp";

  return (
    <div className={cart.length > 0 ? "page sale-page has-cart" : "page sale-page"}>
      <div className="sale-search">
        <input
          className="search-input"
          type="search"
          placeholder="Cari HP, IMEI, atau aksesoris…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
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
      </div>
      <ErrorText error={stock.error} />

      {showPhones && (
        <section>
          {filter === "semua" && <h2 className="section-title">HP</h2>}
          {phones.length === 0 ? (
            <EmptyState>{stock.data?.phones.length === 0 ? "Belum ada HP di stok." : "Tidak ada HP yang cocok."}</EmptyState>
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
                    <ProductThumb src={stock.data?.phoneThumbs.get(phone.id)} kind="hp" size="lg" />
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

      {showAccessories && (
        <section>
          {filter === "semua" && <h2 className="section-title">Aksesoris</h2>}
          {accessories.length === 0 ? (
            <EmptyState>{stock.data?.accessories.length === 0 ? "Belum ada aksesoris." : "Tidak ada aksesoris yang cocok."}</EmptyState>
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
                    <ProductThumb src={stock.data?.accessoryThumbs.get(item.id)} kind="aksesoris" size="lg" />
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

      {cart.length > 0 && (
        <div className="cart-bar">
          <button type="button" className="cart-bar-clear" onClick={() => setCart([])} aria-label="Kosongkan keranjang">
            ✕
          </button>
          <div className="cart-bar-info">
            <span>{cartCount} barang</span>
            <strong>{rp(cartTotal)}</strong>
          </div>
          <button type="button" className="button button-primary cart-bar-pay" onClick={() => setCheckout(true)}>
            Bayar →
          </button>
        </div>
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
  const [tradeIn, setTradeIn] = useState<TradeInForm | null>(null);
  const [showCustomer, setShowCustomer] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [payment, setPayment] = useState<PaymentMethod>("tunai");
  const action = useAction();

  const totals = useMemo(() => {
    let items = 0n;
    let cost = 0n;
    let complete = true;
    for (const line of cart) {
      const price = digitsToRupiah(line.price);
      if (price === null) complete = false;
      const quantity = line.kind === "hp" ? 1n : BigInt(line.quantity);
      items += (price ?? 0n) * quantity;
      cost += (line.kind === "hp" ? line.phone.costRupiah : line.accessory.costRupiah) * quantity;
    }
    const credit = tradeIn === null ? 0n : digitsToRupiah(tradeIn.credit) ?? 0n;
    return { items, credit, due: items - credit, profit: items - cost, complete };
  }, [cart, tradeIn]);

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
      const lines: SaleLineInput[] = cart.map((line) =>
        line.kind === "hp"
          ? { kind: "hp", phoneUnitId: line.phone.id, priceRupiah: digitsToRupiah(line.price) ?? 0n }
          : {
              kind: "aksesoris",
              accessoryId: line.accessory.id,
              quantity: BigInt(line.quantity),
              unitPriceRupiah: digitsToRupiah(line.price) ?? 0n,
            },
      );
      const sale = await ctx.repo.recordSale({
        lines,
        tradeIn:
          tradeIn === null
            ? null
            : {
                brand: tradeIn.brand,
                model: tradeIn.model,
                variant: tradeIn.variant,
                imei1: tradeIn.imei1,
                condition: tradeIn.condition,
                completeness: tradeIn.completeness,
                creditRupiah: digitsToRupiah(tradeIn.credit) ?? 0n,
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
        {cart.map((line) => (
          <li key={line.key} className="checkout-line">
            <ProductThumb
              src={line.kind === "hp" ? thumbs.phone?.get(line.phone.id) : thumbs.accessory?.get(line.accessory.id)}
              kind={line.kind}
              size="sm"
            />
            <div className="checkout-name">
              <strong>{line.kind === "hp" ? line.phone.displayName : line.accessory.name}</strong>
              <span className="muted small">
                {line.kind === "hp" ? `IMEI ${line.phone.imei1}` : `${rp(line.accessory.priceRupiah)} / pcs`}
              </span>
            </div>
            {line.kind === "aksesoris" && (
              <div className="stepper">
                <button type="button" onClick={() => updateLine(line.key, { quantity: line.quantity - 1 })} aria-label="Kurangi">
                  −
                </button>
                <span>{line.quantity}</span>
                <button
                  type="button"
                  onClick={() => updateLine(line.key, { quantity: line.quantity + 1 })}
                  aria-label="Tambah"
                  disabled={BigInt(line.quantity) >= line.accessory.stockQuantity}
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
        ))}
      </ul>

      <div className="option-toggles">
        <button
          type="button"
          className={tradeIn !== null ? "toggle-pill on" : "toggle-pill"}
          onClick={() => setTradeIn(tradeIn === null ? EMPTY_TRADE_IN : null)}
        >
          {tradeIn !== null ? "✓ " : "+ "}Tukar tambah
        </button>
        <button
          type="button"
          className={showCustomer ? "toggle-pill on" : "toggle-pill"}
          onClick={() => setShowCustomer(!showCustomer)}
        >
          {showCustomer ? "✓ " : "+ "}Data pelanggan
        </button>
      </div>

      {tradeIn !== null && (
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
        {tradeIn !== null && (
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
