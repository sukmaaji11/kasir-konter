import { useState } from "react";
import type { PhotoInput } from "../data/repository";
import { ErrorText, Sheet } from "./common";
import { errorMessage } from "./format";
import { processProductPhoto } from "./photo";

export interface StripPhoto extends PhotoInput {
  /** Kunci unik: id database, atau kunci sementara sebelum disimpan. */
  readonly key: string;
}

/**
 * Deretan foto + tombol tambah. Satu kontrol file agar Android menawarkan
 * kamera atau galeri. Bisa pilih beberapa foto sekaligus dari galeri.
 */
export function PhotoStrip({
  photos,
  max,
  onAdd,
  onRemove,
  label = "Foto",
  readOnly = false,
}: {
  readonly photos: readonly StripPhoto[];
  readonly max: number;
  readonly onAdd: (photo: PhotoInput) => Promise<void>;
  readonly onRemove?: (key: string) => Promise<void>;
  readonly label?: string;
  /** Hanya lihat (mis. karyawan): tanpa tambah/hapus. */
  readonly readOnly?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<StripPhoto | null>(null);
  const remaining = max - photos.length;

  async function handleFiles(files: FileList | null) {
    if (files === null || files.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      for (const file of Array.from(files).slice(0, Math.max(0, remaining))) {
        await onAdd(await processProductPhoto(file));
      }
      if (files.length > remaining) setError(`Maksimal ${max} foto. Sebagian foto tidak ditambahkan.`);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="photo-field">
      <span className="field-label">
        {label} {!readOnly && <span className="muted">({photos.length}/{max})</span>}
      </span>
      <div className="photo-strip">
        {photos.map((photo, index) => (
          <button
            key={photo.key}
            type="button"
            className="photo-thumb"
            onClick={() => setViewing(photo)}
            aria-label={`Lihat foto ${index + 1}`}
          >
            <img src={photo.thumbDataUrl} alt="" />
            {index === 0 && max > 1 && <span className="photo-cover">Sampul</span>}
          </button>
        ))}
        {remaining > 0 && !readOnly && (
          <label className={busy ? "photo-add busy" : "photo-add"}>
            <input
              type="file"
              accept="image/*"
              multiple={max > 1}
              disabled={busy}
              onChange={(event) => {
                void handleFiles(event.target.files);
                event.target.value = "";
              }}
            />
            <span aria-hidden="true">{busy ? "…" : "＋"}</span>
            <span>{busy ? "Memproses" : photos.length === 0 ? "Tambah foto" : "Tambah"}</span>
          </label>
        )}
      </div>
      <ErrorText error={error} />
      {viewing !== null && (
        <Sheet title="Foto" onClose={() => setViewing(null)}>
          <img className="photo-full" src={viewing.fullDataUrl} alt="" />
          {onRemove !== undefined && !readOnly && (
            <button
              type="button"
              className="button button-danger-quiet"
              onClick={() =>
                void onRemove(viewing.key).then(
                  () => setViewing(null),
                  (cause: unknown) => setError(errorMessage(cause)),
                )
              }
            >
              Hapus foto ini
            </button>
          )}
        </Sheet>
      )}
    </div>
  );
}

/** Gambar kecil produk di daftar; ikon pengganti bila belum ada foto. */
export function ProductThumb({
  src,
  kind,
  size = "md",
}: {
  readonly src: string | undefined;
  readonly kind: "hp" | "aksesoris";
  readonly size?: "sm" | "md" | "lg";
}) {
  return src !== undefined ? (
    <img className={`product-thumb thumb-${size}`} src={src} alt="" />
  ) : (
    <span className={`product-thumb thumb-${size} placeholder`} aria-hidden="true">
      {kind === "hp" ? "📱" : "🎧"}
    </span>
  );
}
