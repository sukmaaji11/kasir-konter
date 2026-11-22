import { useMemo, useState } from "react";
import type { Accessory, PhoneUnit, SaleLineInput, SaleRecord } from "../data/repository";
import { can } from "../domain/auth";
import type { PhoneCondition } from "../domain/phones";
import type { PaymentMethod } from "../domain/sales";
import { CurrencyInput } from "./CurrencyInput";
import { Chips, EmptyState, ErrorText, Sheet, useAction, useLoad } from "./common";
import type { PageContext } from "./context";
import { digitsToRupiah, rp, rpSigned, rupiahToDigits } from "./format";
import { saleReceiptText } from "./receipts";
import { openWhatsApp, shareText } from "./whatsapp";

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

export function SalePage({ ctx }: { readonly ctx: PageContext }) {
  const showCost = can(ctx.user, "viewCostAndProfit");
  const stock = useLoad(
    async () => ({
      phones: await ctx.repo.listPhonesInStock(),
      accessories: await ctx.repo.listAccessories(),
    }),
    [ctx.repo, ctx.dataVersion],
  );
  const [pickerTab, setPickerTab] = useState<"hp" | "aksesoris">("hp");
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<readonly CartLine[]>([]);
  const [tradeIn, setTradeIn] = useState<TradeInForm | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [payment, setPayment] = useState<PaymentMethod>("tunai");
  const [receipt, setReceipt] = useState<SaleRecord | null>(null);
  const action = useAction();

  const query = search.trim().toLowerCase();
  const inCartPhones = new Set(cart.flatMap((line) => (line.kind === "hp" ? [line.phone.id] : [])));
  const phones = (stock.data?.phones ?? []).filter(
    (phone) =>
      !inCartPhones.has(phone.id) &&
      (query === "" ||
        phone.displayName.toLowerCase().includes(query) ||
        phone.imei1.includes(query) ||
        (phone.imei2 ?? "").includes(query)),
  );
  const accessories = (stock.data?.accessories ?? []).filter(
    (item) => query === "" || item.name.toLowerCase().includes(query),
  );

  const totals = useMemo(() => {
    let items = 0n;
    let cost = 0n;
    let complete = true;
    for (const line of cart) {
      const price = digitsToRupiah(line.price);
      if (price === null) complete = false;
      if (line.kind === "hp") {
        items += price ?? 0n;
        cost += line.phone.costRupiah;
      } else {
        items += (price ?? 0n) * BigInt(line.quantity);
        cost += line.accessory.costRupiah * BigInt(line.quantity);
      }
    }
    const credit = tradeIn === null ? 0n : digitsToRupiah(tradeIn.credit) ?? 0n;
    return { items, cost, credit, due: items - credit, profit: items - cost, complete };
  }, [cart, tradeIn]);

  function addPhone(phone: PhoneUnit) {
    setCart((current) => [
      ...current,
      { key: `hp-${phone.id}`, kind: "hp", phone, price: rupiahToDigits(phone.plannedPriceRupiah) },
    ]);
  }

  function addAccessory(accessory: Accessory) {
    setCart((current) => {
      const existing = current.find(
        (line) => line.kind === "aksesoris" && line.accessory.id === accessory.id,
      );
      if (existing === undefined) {
        return [
          ...current,
          {
            key: `aks-${accessory.id}`,
            kind: "aksesoris",
            accessory,
            quantity: 1,
            price: accessory.priceRupiah.toString(),
          },
        ];
      }
      return current.map((line) =>
        line === existing && line.kind === "aksesoris"
          ? { ...line, quantity: line.quantity + 1 }
          : line,
      );
    });
  }

  function updateLine(key: string, patch: Partial<{ price: string; quantity: number }>) {
    setCart((current) =>
      current
        .map((line) => (line.key === key ? ({ ...line, ...patch } as CartLine) : line))
        .filter((line) => line.kind === "hp" || line.quantity > 0),
    );
  }

  function reset() {
    setCart([]);
    setTradeIn(null);
    setCustomerName("");
    setCustomerPhone("");
    setPayment("tunai");
    setSearch("");
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
      reset();
      setReceipt(sale);
      ctx.changed();
    });
  }

  return (
    <div className="split-layout">
      <section className="panel">
        <div className="panel-head">
          <Chips
            value={pickerTab}
            onChange={setPickerTab}
            label="Pilih jenis barang"
            options={[
              { value: "hp", label: `HP (${stock.data?.phones.length ?? 0})` },
              { value: "aksesoris", label: "Aksesoris" },
            ]}
          />
          <input
            className="search-input"
            type="search"
            placeholder={pickerTab === "hp" ? "Cari tipe atau IMEI…" : "Cari aksesoris…"}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <ErrorText error={stock.error} />
        {pickerTab === "hp" ? (
          phones.length === 0 ? (
            <EmptyState>
              {stock.data?.phones.length === 0
                ? "Belum ada HP di stok. Catat HP masuk di menu Stok HP."
                : "Tidak ada HP yang cocok."}
            </EmptyState>
          ) : (
            <ul className="pick-list">
              {phones.map((phone) => (
                <li key={phone.id}>
                  <button type="button" className="pick-item" onClick={() => addPhone(phone)}>
                    <span className="pick-main">
                      <strong>{phone.displayName}</strong>
                      <span className="muted">
                        IMEI {phone.imei1} · {phone.condition === "baru" ? "Baru" : "Bekas"}
                      </span>
                    </span>
                    <span className="pick-side">
                      {phone.plannedPriceRupiah !== null && <strong>{rp(phone.plannedPriceRupiah)}</strong>}
                      {showCost && <span className="muted">modal {rp(phone.costRupiah)}</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : accessories.length === 0 ? (
          <EmptyState>
            {stock.data?.accessories.length === 0
              ? "Belum ada aksesoris. Tambahkan di menu Aksesoris."
              : "Tidak ada aksesoris yang cocok."}
          </EmptyState>
        ) : (
          <ul className="pick-list">
            {accessories.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className="pick-item"
                  onClick={() => addAccessory(item)}
                  disabled={item.stockQuantity === 0n}
                >
                  <span className="pick-main">
                    <strong>{item.name}</strong>
                    <span className={item.stockQuantity <= 2n ? "warn-text" : "muted"}>
                      Stok {item.stockQuantity.toString()}
                      {item.category ? ` · ${item.category}` : ""}
                    </span>
                  </span>
                  <span className="pick-side">
                    <strong>{rp(item.priceRupiah)}</strong>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {cart.length > 0 && (
        <button
          type="button"
          className="cart-jump"
          onClick={() => document.getElementById("cart-panel")?.scrollIntoView({ behavior: "smooth" })}
        >
          <span>Lihat nota ({cart.length})</span>
          <strong>{rp(totals.due >= 0n ? totals.due : -totals.due)}</strong>
        </button>
      )}

      <section className="panel cart-panel" id="cart-panel">
        <h2 className="panel-title">Nota</h2>
        {cart.length === 0 ? (
          <EmptyState>Pilih HP atau aksesoris di sebelah kiri.</EmptyState>
        ) : (
          <ul className="cart-list">
            {cart.map((line) => (
              <li key={line.key} className="cart-line">
                <div className="cart-line-name">
                  <strong>{line.kind === "hp" ? line.phone.displayName : line.accessory.name}</strong>
                  {line.kind === "hp" ? (
                    <span className="muted">IMEI {line.phone.imei1}</span>
                  ) : null}
                </div>
                <div className="cart-line-controls">
                  {line.kind === "aksesoris" && (
                    <div className="stepper">
                      <button
                        type="button"
                        onClick={() => updateLine(line.key, { quantity: line.quantity - 1 })}
                        aria-label="Kurangi"
                      >
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
                    placeholder="Harga jual"
                    value={line.price}
                    onValueChange={(price) => updateLine(line.key, { price })}
                  />
                  {line.kind === "hp" && (
                    <button
                      type="button"
                      className="icon-button"
                      aria-label="Hapus dari nota"
                      onClick={() => setCart((current) => current.filter((item) => item.key !== line.key))}
                    >
                      ✕
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        {tradeIn === null ? (
          <button type="button" className="button button-secondary" onClick={() => setTradeIn(EMPTY_TRADE_IN)}>
            + Tukar tambah HP lama
          </button>
        ) : (
          <fieldset className="trade-in">
            <legend>Tukar tambah: HP lama pelanggan</legend>
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
                Varian
                <input value={tradeIn.variant} onChange={(e) => setTradeIn({ ...tradeIn, variant: e.target.value })} placeholder="6/128" />
              </label>
              <label>
                IMEI 1
                <input
                  inputMode="numeric"
                  value={tradeIn.imei1}
                  onChange={(e) => setTradeIn({ ...tradeIn, imei1: e.target.value })}
                  placeholder="15 digit (*#06#)"
                />
              </label>
              <label>
                Kelengkapan
                <input
                  value={tradeIn.completeness}
                  onChange={(e) => setTradeIn({ ...tradeIn, completeness: e.target.value })}
                  placeholder="Unit + dus"
                />
              </label>
              <label>
                Nilai potongan
                <CurrencyInput value={tradeIn.credit} onValueChange={(credit) => setTradeIn({ ...tradeIn, credit })} placeholder="0" />
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
            <p className="muted small">HP lama masuk stok dengan modal sebesar nilai potongan.</p>
            <button type="button" className="text-button" onClick={() => setTradeIn(null)}>
              Batalkan tukar tambah
            </button>
          </fieldset>
        )}

        <div className="form-grid two">
          <label>
            Nama pelanggan (opsional)
            <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
          </label>
          <label>
            No. WA pelanggan (opsional)
            <input inputMode="tel" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} placeholder="08…" />
          </label>
        </div>
        <Chips value={payment} onChange={setPayment} options={PAYMENT_OPTIONS} label="Metode bayar" />

        <dl className="totals">
          <div>
            <dt>Total barang</dt>
            <dd>{rp(totals.items)}</dd>
          </div>
          {tradeIn !== null && (
            <div>
              <dt>Potongan tukar tambah</dt>
              <dd>−{rp(totals.credit)}</dd>
            </div>
          )}
          <div className="totals-main">
            <dt>{totals.due >= 0n ? "Dibayar pelanggan" : "Dibayar ke pelanggan"}</dt>
            <dd>{rp(totals.due >= 0n ? totals.due : -totals.due)}</dd>
          </div>
          {showCost && cart.length > 0 && (
            <div className={totals.profit >= 0n ? "profit-row" : "profit-row loss"}>
              <dt>Untung nota ini</dt>
              <dd>{totals.complete ? rpSigned(totals.profit) : "isi semua harga"}</dd>
            </div>
          )}
        </dl>
        <ErrorText error={action.error} />
        <button
          type="button"
          className="button button-primary button-block"
          disabled={cart.length === 0 || action.busy}
          onClick={() => void save()}
        >
          {action.busy ? "Menyimpan…" : "Simpan nota"}
        </button>
      </section>

      {receipt !== null && (
        <ReceiptSheet ctx={ctx} sale={receipt} onClose={() => setReceipt(null)} />
      )}
    </div>
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
