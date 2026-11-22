import { useState } from "react";
import type { KonterRepository, ServiceOrder } from "../data/repository";
import {
  MAX_WARRANTY_DAYS,
  WARRANTY_PRESETS,
  warrantyLabel,
  type ServiceWarrantyInput,
} from "../domain/service";
import { daysBetween } from "../domain/time";
import { EmptyState, ErrorText, Sheet, useLoad } from "./common";
import { dayLabel, todayKey } from "./format";

/** Garansi terakhir yang dipakai, jadi pilihan awal service berikutnya. */
const LAST_WARRANTY_KEY = "service.warranty.last";

export interface WarrantyDraft {
  readonly choice: number | "lain";
  readonly customDays: string;
  readonly note: string;
}

export const NO_WARRANTY: WarrantyDraft = { choice: 0, customDays: "", note: "" };

export function warrantyDraft(days: number, note: string | null): WarrantyDraft {
  const preset = WARRANTY_PRESETS.includes(days);
  return { choice: preset ? days : "lain", customDays: preset ? "" : String(days), note: note ?? "" };
}

export function warrantyInput(draft: WarrantyDraft): ServiceWarrantyInput {
  if (draft.choice !== "lain") return { days: draft.choice, note: draft.note };
  const days = Number(draft.customDays);
  if (draft.customDays.trim() === "" || !Number.isSafeInteger(days) || days < 1 || days > MAX_WARRANTY_DAYS) {
    throw new Error(`Isi lama garansi 1 sampai ${MAX_WARRANTY_DAYS} hari.`);
  }
  return { days, note: draft.note };
}

export async function loadLastWarranty(repo: KonterRepository): Promise<WarrantyDraft> {
  try {
    const raw = await repo.getSetting(LAST_WARRANTY_KEY);
    if (raw === null) return NO_WARRANTY;
    const parsed = JSON.parse(raw) as { days?: unknown; note?: unknown };
    const days = typeof parsed.days === "number" && Number.isSafeInteger(parsed.days) ? parsed.days : 0;
    return warrantyDraft(days, typeof parsed.note === "string" ? parsed.note : null);
  } catch {
    return NO_WARRANTY;
  }
}

export async function rememberWarranty(repo: KonterRepository, input: ServiceWarrantyInput): Promise<void> {
  await repo.setSetting(LAST_WARRANTY_KEY, JSON.stringify({ days: input.days, note: input.note ?? "" }));
}

/** Pilihan garansi saat perbaikan selesai / HP diserahkan. */
export function WarrantyFields({
  value,
  onChange,
}: {
  readonly value: WarrantyDraft;
  readonly onChange: (value: WarrantyDraft) => void;
}) {
  const choices: readonly (number | "lain")[] = [...WARRANTY_PRESETS, "lain"];
  return (
    <div className="warranty-fields">
      <span className="field-label">Garansi service ini</span>
      <div className="chips" role="radiogroup" aria-label="Masa garansi">
        {choices.map((choice) => (
          <button
            key={String(choice)}
            type="button"
            role="radio"
            aria-checked={value.choice === choice}
            className={value.choice === choice ? "chip chip-active" : "chip"}
            onClick={() => onChange({ ...value, choice })}
          >
            {choice === "lain" ? "Lainnya" : warrantyLabel(choice)}
          </button>
        ))}
      </div>
      {value.choice === "lain" && (
        <label className="block-label">
          Lama garansi (hari)
          <input
            inputMode="numeric"
            value={value.customDays}
            onChange={(event) => onChange({ ...value, customDays: event.target.value.replace(/\D/g, "").slice(0, 3) })}
            placeholder="mis. 60"
          />
        </label>
      )}
      {value.choice !== 0 && (
        <label className="block-label">
          Ketentuan garansi
          <input
            value={value.note}
            maxLength={200}
            onChange={(event) => onChange({ ...value, note: event.target.value })}
            placeholder="Garansi LCD; tidak berlaku jika jatuh, kena air, atau segel rusak"
          />
        </label>
      )}
      <p className="muted small">
        {value.choice === 0
          ? "Nota service ini tidak mencantumkan garansi."
          : "Garansi dihitung sejak HP diambil dan hanya dicetak di nota service ini."}
      </p>
    </div>
  );
}

/** "s/d Sen, 30 Nov · sisa 7 hari" atau "habis Sen, 30 Nov". */
export function warrantyStatusText(order: ServiceOrder, today = todayKey()): string | null {
  if (order.warrantyDays === 0) return null;
  if (order.warrantyUntil === null) return `${warrantyLabel(order.warrantyDays)} sejak HP diambil`;
  if (order.warrantyUntil < today) return `${warrantyLabel(order.warrantyDays)} · habis ${dayLabel(order.warrantyUntil)}`;
  const left = daysBetween(today, order.warrantyUntil).length - 1;
  return `${warrantyLabel(order.warrantyDays)} · s/d ${dayLabel(order.warrantyUntil)} · ${left === 0 ? "hari terakhir" : `sisa ${left} hari`}`;
}

export function isWarrantyActive(order: ServiceOrder, today = todayKey()): boolean {
  return order.warrantyUntil !== null && order.warrantyUntil >= today;
}

/** Peringatan di form service baru: IMEI ini masih bergaransi dari service sebelumnya. */
export function ImeiWarrantyNotice({ repo, imei }: { readonly repo: KonterRepository; readonly imei: string }) {
  const cleaned = imei.replace(/[\s-]/g, "");
  const history = useLoad(
    async () => (/^\d{15}$/.test(cleaned) ? repo.findServicesByImei(cleaned) : []),
    [repo, cleaned],
  );
  const today = todayKey();
  const active = (history.data ?? []).filter((order) => isWarrantyActive(order, today));
  const past = (history.data ?? []).filter((order) => order.status === "diambil" && !isWarrantyActive(order, today));
  if (active.length === 0 && past.length === 0) return null;
  return (
    <div className={active.length > 0 ? "warranty-notice active" : "warranty-notice"}>
      {active.map((order) => (
        <p key={order.id}>
          <strong>Masih garansi:</strong> {order.number} · {order.complaint} · {warrantyStatusText(order, today)}
          {order.warrantyNote !== null && <span className="muted"> ({order.warrantyNote})</span>}
        </p>
      ))}
      {active.length === 0 && (
        <p>
          HP ini pernah diservice di sini ({past.length}×), terakhir {past[0]!.number}: {past[0]!.complaint}. Garansinya sudah
          habis atau tanpa garansi.
        </p>
      )}
    </div>
  );
}

/** Daftar HP yang garansinya masih berlaku, untuk cek klaim garansi. */
export function ActiveWarrantySheet({
  repo,
  dataVersion,
  onClose,
  onOpen,
}: {
  readonly repo: KonterRepository;
  readonly dataVersion: number;
  readonly onClose: () => void;
  readonly onOpen: (order: ServiceOrder) => void;
}) {
  const [query, setQuery] = useState("");
  const today = todayKey();
  const list = useLoad(() => repo.listActiveWarranties(today), [repo, dataVersion, today]);
  const needle = query.trim().toLowerCase();
  const shown = (list.data ?? []).filter(
    (order) =>
      needle === "" ||
      [order.number, order.customerName, order.customerPhone ?? "", order.device, order.imei ?? "", order.complaint]
        .join(" ")
        .toLowerCase()
        .includes(needle),
  );
  return (
    <Sheet title="Cek garansi service" onClose={onClose} wide>
      <input
        type="search"
        className="search-input"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Cari nama, no. WA, HP, IMEI, atau no. service…"
        autoFocus
      />
      <ErrorText error={list.error} />
      {list.data !== null && shown.length === 0 ? (
        <EmptyState>
          {list.data.length === 0
            ? "Belum ada service yang masih bergaransi. Garansi diisi saat menandai perbaikan selesai."
            : "Tidak ada garansi aktif yang cocok. Kalau tidak ketemu, garansinya sudah habis atau service tanpa garansi."}
        </EmptyState>
      ) : (
        <ul className="card-list">
          {shown.map((order) => (
            <li key={order.id}>
              <button type="button" className="list-card" onClick={() => onOpen(order)}>
                <span className="list-card-main">
                  <strong>
                    {order.customerName} · {order.device}
                  </strong>
                  <span className="muted">
                    {order.number} · {order.complaint}
                    {order.warrantyNote !== null ? ` · ${order.warrantyNote}` : ""}
                  </span>
                </span>
                <span className="list-card-side">
                  <span className="badge badge-green">s/d {dayLabel(order.warrantyUntil!)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}
