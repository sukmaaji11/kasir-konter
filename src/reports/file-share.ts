/** Simpan file lalu buka lembar Bagikan Android (WhatsApp, Drive, Simpan ke…). */
export interface FileSharer {
  share(fileName: string, data: Uint8Array, mimeType: string): Promise<void>;
}

export async function createCapacitorFileSharer(): Promise<FileSharer> {
  const { Directory, Filesystem } = await import("@capacitor/filesystem");
  const { Share } = await import("@capacitor/share");
  return {
    async share(fileName, data) {
      const path = `reports/${fileName}`;
      await Filesystem.writeFile({
        path,
        directory: Directory.Cache,
        recursive: true,
        data: toBase64(data),
      });
      const { uri } = await Filesystem.getUri({ path, directory: Directory.Cache });
      try {
        await Share.share({ files: [uri], title: fileName, dialogTitle: "Simpan atau kirim laporan" });
      } catch (error) {
        // Menutup lembar Bagikan bukan kesalahan.
        if (error instanceof Error && /cancel/i.test(error.message)) return;
        throw error;
      }
    },
  };
}

/** Mode browser (pengembangan): unduh file. */
export function createBrowserFileSharer(): FileSharer {
  return {
    async share(fileName, data, mimeType) {
      const copy = new Uint8Array(data);
      const url = URL.createObjectURL(new Blob([copy.buffer], { type: mimeType }));
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    },
  };
}

function toBase64(data: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < data.length; index += chunk) {
    binary += String.fromCharCode(...data.subarray(index, index + chunk));
  }
  return btoa(binary);
}
