import type { PhotoInput } from "../data/repository";

/**
 * Foto dari kamera/galeri diperkecil di HP sebelum disimpan:
 * - foto tampilan: sisi terpanjang ≤ 720 px, maks. ±110 KB
 * - thumbnail daftar: ≤ 200 px, maks. ±18 KB
 * Diadaptasi dari pengolah foto menu Kasir Kaki Lima.
 */
const MAX_SOURCE_BYTES = 15 * 1024 * 1024;
const MAX_SOURCE_PIXELS = 50_000_000;
const SUPPORTED = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "image/avif"]);

const FULL = { sizes: [720, 600, 480], qualities: [0.75, 0.66, 0.58], maxBytes: 110 * 1024 };
const THUMB = { sizes: [200, 160], qualities: [0.7, 0.6], maxBytes: 18 * 1024 };

export async function processProductPhoto(file: File): Promise<PhotoInput> {
  if (file.type !== "" && !SUPPORTED.has(file.type)) {
    throw new Error("Pilih foto JPG, PNG, WebP, atau HEIC.");
  }
  if (file.size === 0 || file.size > MAX_SOURCE_BYTES) {
    throw new Error("Ukuran foto harus di bawah 15 MB.");
  }
  const url = URL.createObjectURL(file);
  try {
    const image = await loadImage(url);
    if (
      image.naturalWidth <= 0 ||
      image.naturalHeight <= 0 ||
      image.naturalWidth * image.naturalHeight > MAX_SOURCE_PIXELS
    ) {
      throw new Error("Resolusi foto terlalu besar atau file tidak valid.");
    }
    return {
      fullDataUrl: await encode(image, FULL),
      thumbDataUrl: await encode(image, THUMB, true),
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function encode(
  image: HTMLImageElement,
  spec: { readonly sizes: readonly number[]; readonly qualities: readonly number[]; readonly maxBytes: number },
  square = false,
): Promise<string> {
  for (let index = 0; index < spec.sizes.length; index += 1) {
    const size = spec.sizes[index]!;
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("Foto belum bisa diproses di perangkat ini.");
    if (square) {
      // Thumbnail persegi: potong bagian tengah agar rapi di kotak daftar.
      const side = Math.min(image.naturalWidth, image.naturalHeight);
      canvas.width = canvas.height = Math.min(size, side);
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(
        image,
        (image.naturalWidth - side) / 2,
        (image.naturalHeight - side) / 2,
        side,
        side,
        0,
        0,
        canvas.width,
        canvas.height,
      );
    } else {
      const scale = Math.min(1, size / Math.max(image.naturalWidth, image.naturalHeight));
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
    }
    const blob = await toJpeg(canvas, spec.qualities[index]!);
    if (blob.size <= spec.maxBytes || index === spec.sizes.length - 1) {
      return blobToDataUrl(blob);
    }
  }
  throw new Error("Foto belum bisa diproses.");
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Foto tidak dapat dibuka."));
    image.src = source;
  });
}

function toJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob === null ? reject(new Error("Foto belum bisa diproses.")) : resolve(blob)),
      "image/jpeg",
      quality,
    );
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Foto tidak dapat disimpan."));
    reader.onerror = () => reject(new Error("Foto tidak dapat dibaca."));
    reader.readAsDataURL(blob);
  });
}
