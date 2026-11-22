import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useAndroidBack } from "./useAndroidBack";
import { errorMessage } from "./format";

/** Lembar dialog (bottom sheet di HP, kotak tengah di tablet). Tombol Back menutupnya. */
export function Sheet({
  title,
  onClose,
  children,
  wide = false,
}: {
  readonly title: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
  readonly wide?: boolean;
}) {
  useAndroidBack(true, onClose);
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <section
        className={wide ? "sheet sheet-wide" : "sheet"}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="sheet-header">
          <h2>{title}</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Tutup">
            ✕
          </button>
        </header>
        <div className="sheet-body">{children}</div>
      </section>
    </div>
  );
}

export function Chips<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  readonly value: T;
  readonly options: readonly { readonly value: T; readonly label: string }[];
  readonly onChange: (value: T) => void;
  readonly label?: string;
}) {
  return (
    <div className="chips" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          className={option.value === value ? "chip chip-active" : "chip"}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function ErrorText({ error }: { readonly error: string | null }) {
  return error === null ? null : (
    <p className="error-message" role="alert">
      {error}
    </p>
  );
}

export function EmptyState({ children }: { readonly children: ReactNode }) {
  return <div className="empty-state">{children}</div>;
}

/** Memuat data async dan memuat ulang saat `deps` berubah. */
export function useLoad<T>(
  load: () => Promise<T>,
  deps: readonly unknown[],
): { readonly data: T | null; readonly error: string | null; readonly reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(load, deps);

  useEffect(() => {
    let active = true;
    run().then(
      (value) => {
        if (active) {
          setData(value);
          setError(null);
        }
      },
      (cause: unknown) => {
        if (active) setError(errorMessage(cause));
      },
    );
    return () => {
      active = false;
    };
  }, [run, tick]);

  return { data, error, reload: () => setTick((value) => value + 1) };
}

/** Menjalankan aksi tombol: status sibuk + pesan galat. */
export function useAction(): {
  readonly busy: boolean;
  readonly error: string | null;
  readonly setError: (error: string | null) => void;
  readonly run: (action: () => Promise<void>) => Promise<void>;
} {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, setError, run };
}
