import { useState } from "react";
import type { PhoneUnit } from "../data/repository";
import { can } from "../domain/auth";
import { isImeiChecksumValid, type PhoneCondition, type PhoneSource } from "../domain/phones";
import { CurrencyInput } from "./CurrencyInput";
import { Chips, EmptyState, ErrorText, Sheet, useAction, useLoad } from "./common";
import type { PageContext } from "./context";
import { ageLabel, dateTimeWib, digitsToRupiah, rp } from "./format";

const SOURCE_LABELS: Readonly<Record<PhoneSource, string>> = {
  supplier: "Kulakan",
  beli_pelanggan: "Beli dari pelanggan",
  tukar_tambah: "Tukar tambah",
};

const STATUS_LABELS = { stok: "Di stok", terjual: "Terjual", dibatalkan: "Dibatalkan" } as const;

export function PhonesPage({ ctx }: { readonly ctx: PageContext }) {
  const showCost = can(ctx.user, "viewCostAndProfit");
  const phones = useLoad(() => ctx.repo.listPhonesInStock(), [ctx.repo, ctx.dataVersion]);
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<PhoneUnit | null>(null);
  const [imeiCheck, setImeiCheck] = useState(false);

  const query = search.trim().toLowerCase();
  const list = (phones.data ?? []).filter(
    (phone) =>
      query === "" ||
      phone.displayName.toLowerCase().includes(query) ||
      phone.imei1.includes(query) ||
      (phone.imei2 ?? "").includes(query),
  );
  const totalCost = (phones.data ?? []).reduce((sum, phone) => sum + phone.costRupiah, 0n);

  return (
    <div className="page">
      <div className="stat-row">
        <div className="stat">
          <span>HP di stok</span>
          <strong>{phones.data?.length ?? "…"} unit</strong>
        </div>
        {showCost && (
          <div className="stat">
            <span>Total modal di stok</span>
            <strong>{rp(totalCost)}</strong>
          </div>
        )}
      </div>
      <div className="toolbar">
        <input
          className="search-input"
          type="search"
          placeholder="Cari tipe atau IMEI…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <button type="button" className="button button-secondary" onClick={() => setImeiCheck(true)}>
          Cek riwayat IMEI
        </button>
        {can(ctx.user, "addPhone") && (
          <button type="button" className="button button-primary" onClick={() => setAdding(true)}>
            + HP masuk
          </button>
        )}
      </div>
      <ErrorText error={phones.error} />
      {list.length === 0 ? (
        <EmptyState>
          {phones.data?.length === 0 ? "Stok HP masih kosong." : "Tidak ada HP yang cocok."}
        </EmptyState>
      ) : (
        <ul className="card-list">
          {list.map((phone) => (
            <li key={phone.id}>
              <button type="button" className="list-card" onClick={() => setSelected(phone)}>
                <span className="list-card-main">
                  <strong>{phone.displayName}</strong>
                  <span className="muted">IMEI {phone.imei1}</span>
                  <span className="badges">
                    <span className={phone.condition === "baru" ? "badge badge-blue" : "badge"}>
                      {phone.condition === "baru" ? "Baru" : "Bekas"}
                    </span>
                    <span className="badge">{SOURCE_LABELS[phone.source]}</span>
                    <span className="badge badge-muted">{ageLabel(phone.acquiredAtMs)}</span>
                  </span>
                </span>
                <span className="list-card-side">
                  {phone.plannedPriceRupiah !== null && <strong>{rp(phone.plannedPriceRupiah)}</strong>}
                  {showCost && <span className="muted">modal {rp(phone.costRupiah)}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {adding && (
        <PhoneIntakeSheet
          ctx={ctx}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            ctx.changed();
          }}
        />
      )}
      {selected !== null && (
        <PhoneDetailSheet
          ctx={ctx}
          phone={selected}
          onClose={() => setSelected(null)}
        />
      )}
      {imeiCheck && <ImeiHistorySheet ctx={ctx} onClose={() => setImeiCheck(false)} />}
    </div>
  );
}

function PhoneIntakeSheet({
  ctx,
  onClose,
  onSaved,
}: {
  readonly ctx: PageContext;
  readonly onClose: () => void;
  readonly onSaved: () => void;
}) {
  const [source, setSource] = useState<"supplier" | "beli_pelanggan">("supplier");
  const [condition, setCondition] = useState<PhoneCondition>("baru");
  const [form, setForm] = useState({
    brand: "",
    model: "",
    variant: "",
    color: "",
    imei1: "",
    imei2: "",
    completeness: "",
    cost: "",
    planned: "",
    party: "",
    note: "",
  });
  const action = useAction();
  const set = (key: keyof typeof form) => (value: string) => setForm({ ...form, [key]: value });
  const imeiDigits = form.imei1.replace(/[\s-]/g, "");
  const imeiWarning =
    imeiDigits.length === 15 && !isImeiChecksumValid(imeiDigits)
      ? "Cek lagi IMEI-nya, sepertinya ada angka yang salah ketik."
      : null;

  async function save() {
    await action.run(async () => {
      const cost = digitsToRupiah(form.cost);
      if (cost === null) throw new Error("Harga modal wajib diisi.");
      await ctx.repo.addPhone(
        {
          brand: form.brand,
          model: form.model,
          variant: form.variant,
          color: form.color,
          imei1: form.imei1,
          imei2: form.imei2,
          condition,
          completeness: form.completeness,
          costRupiah: cost,
          plannedPriceRupiah: digitsToRupiah(form.planned),
          sourceParty: form.party,
          note: form.note,
        },
        source,
      );
      onSaved();
    });
  }

  return (
    <Sheet title="HP masuk" onClose={onClose} wide>
      <Chips
        value={source}
        onChange={(value) => {
          setSource(value);
          if (value === "beli_pelanggan") setCondition("bekas");
        }}
        label="Asal HP"
        options={[
          { value: "supplier", label: "Kulakan (sales/marketplace)" },
          { value: "beli_pelanggan", label: "Beli dari pelanggan" },
        ]}
      />
      <div className="form-grid two">
        <label>
          Merek *
          <input value={form.brand} onChange={(e) => set("brand")(e.target.value)} placeholder="Samsung" autoFocus />
        </label>
        <label>
          Tipe *
          <input value={form.model} onChange={(e) => set("model")(e.target.value)} placeholder="Galaxy A15" />
        </label>
        <label>
          Varian (RAM/memori)
          <input value={form.variant} onChange={(e) => set("variant")(e.target.value)} placeholder="8/256" />
        </label>
        <label>
          Warna
          <input value={form.color} onChange={(e) => set("color")(e.target.value)} placeholder="Hitam" />
        </label>
        <label>
          IMEI 1 *
          <input inputMode="numeric" value={form.imei1} onChange={(e) => set("imei1")(e.target.value)} placeholder="15 digit (*#06#)" />
          {imeiWarning !== null && <span className="warn-text small">{imeiWarning}</span>}
        </label>
        <label>
          IMEI 2
          <input inputMode="numeric" value={form.imei2} onChange={(e) => set("imei2")(e.target.value)} placeholder="Kalau dual SIM" />
        </label>
        <label>
          Harga modal *
          <CurrencyInput value={form.cost} onValueChange={set("cost")} placeholder="Yang dibayar konter" />
        </label>
        <label>
          Rencana harga jual
          <CurrencyInput value={form.planned} onValueChange={set("planned")} placeholder="Boleh dikosongkan" />
        </label>
        <label>
          {source === "supplier" ? "Nama supplier/toko" : "Nama penjual"}
          <input value={form.party} onChange={(e) => set("party")(e.target.value)} />
        </label>
        <label>
          Kelengkapan
          <input value={form.completeness} onChange={(e) => set("completeness")(e.target.value)} placeholder="Fullset / unit + charger" />
        </label>
      </div>
      <Chips
        value={condition}
        onChange={setCondition}
        label="Kondisi"
        options={[
          { value: "baru", label: "Baru" },
          { value: "bekas", label: "Bekas" },
        ]}
      />
      <label className="block-label">
        Catatan kondisi
        <textarea rows={2} value={form.note} onChange={(e) => set("note")(e.target.value)} placeholder="Lecet pemakaian, baterai 85%, …" />
      </label>
      {digitsToRupiah(form.cost) !== null && digitsToRupiah(form.planned) !== null && (
        <p className="profit-note">
          Perkiraan untung: <strong>{rp((digitsToRupiah(form.planned) ?? 0n) - (digitsToRupiah(form.cost) ?? 0n))}</strong>
        </p>
      )}
      <ErrorText error={action.error} />
      <button type="button" className="button button-primary button-block" disabled={action.busy} onClick={() => void save()}>
        {action.busy ? "Menyimpan…" : "Simpan ke stok"}
      </button>
    </Sheet>
  );
}

function PhoneDetailSheet({
  ctx,
  phone,
  onClose,
}: {
  readonly ctx: PageContext;
  readonly phone: PhoneUnit;
  readonly onClose: () => void;
}) {
  const showCost = can(ctx.user, "viewCostAndProfit");
  const [confirming, setConfirming] = useState(false);
  const action = useAction();
  const cancellable = can(ctx.user, "addPhone") && phone.status === "stok" && phone.source !== "tukar_tambah";

  return (
    <Sheet title={phone.displayName} onClose={onClose}>
      <dl className="detail-list">
        <div><dt>IMEI 1</dt><dd>{phone.imei1}</dd></div>
        {phone.imei2 !== null && <div><dt>IMEI 2</dt><dd>{phone.imei2}</dd></div>}
        <div><dt>Kondisi</dt><dd>{phone.condition === "baru" ? "Baru" : "Bekas"}</dd></div>
        <div><dt>Asal</dt><dd>{SOURCE_LABELS[phone.source]}{phone.sourceParty ? ` · ${phone.sourceParty}` : ""}</dd></div>
        <div><dt>Masuk</dt><dd>{dateTimeWib(phone.acquiredAtMs)} ({ageLabel(phone.acquiredAtMs)})</dd></div>
        {phone.completeness !== null && <div><dt>Kelengkapan</dt><dd>{phone.completeness}</dd></div>}
        {phone.note !== null && <div><dt>Catatan</dt><dd>{phone.note}</dd></div>}
        {showCost && <div><dt>Harga modal</dt><dd>{rp(phone.costRupiah)}</dd></div>}
        {phone.plannedPriceRupiah !== null && <div><dt>Rencana jual</dt><dd>{rp(phone.plannedPriceRupiah)}</dd></div>}
      </dl>
      <ErrorText error={action.error} />
      {cancellable && !confirming && (
        <button type="button" className="button button-danger-quiet" onClick={() => setConfirming(true)}>
          Batalkan HP masuk (salah catat)
        </button>
      )}
      {confirming && (
        <div className="confirm-box">
          <p>HP ini akan dikeluarkan dari stok. Lanjutkan?</p>
          <div className="button-row">
            <button
              type="button"
              className="button button-danger"
              disabled={action.busy}
              onClick={() =>
                void action.run(async () => {
                  await ctx.repo.cancelPhoneIntake(phone.id);
                  ctx.changed();
                  onClose();
                })
              }
            >
              Ya, batalkan
            </button>
            <button type="button" className="button button-quiet" onClick={() => setConfirming(false)}>
              Tidak
            </button>
          </div>
        </div>
      )}
    </Sheet>
  );
}

function ImeiHistorySheet({ ctx, onClose }: { readonly ctx: PageContext; readonly onClose: () => void }) {
  const [imei, setImei] = useState("");
  const [results, setResults] = useState<readonly PhoneUnit[] | null>(null);
  const action = useAction();
  const showCost = can(ctx.user, "viewCostAndProfit");

  return (
    <Sheet title="Cek riwayat IMEI" onClose={onClose}>
      <form
        className="inline-form"
        onSubmit={(event) => {
          event.preventDefault();
          void action.run(async () => setResults(await ctx.repo.findPhonesByImei(imei)));
        }}
      >
        <input inputMode="numeric" value={imei} onChange={(e) => setImei(e.target.value)} placeholder="Ketik 15 digit IMEI" autoFocus />
        <button className="button button-primary" disabled={action.busy}>Cari</button>
      </form>
      <ErrorText error={action.error} />
      {results !== null &&
        (results.length === 0 ? (
          <EmptyState>IMEI ini belum pernah tercatat di konter.</EmptyState>
        ) : (
          <ul className="card-list">
            {results.map((phone) => (
              <li key={phone.id} className="list-card static">
                <span className="list-card-main">
                  <strong>{phone.displayName}</strong>
                  <span className="muted">
                    {SOURCE_LABELS[phone.source]} · masuk {dateTimeWib(phone.acquiredAtMs)}
                  </span>
                </span>
                <span className="list-card-side">
                  <span className="badge">{STATUS_LABELS[phone.status]}</span>
                  {showCost && <span className="muted">modal {rp(phone.costRupiah)}</span>}
                </span>
              </li>
            ))}
          </ul>
        ))}
    </Sheet>
  );
}
