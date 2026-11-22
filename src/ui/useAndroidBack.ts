import { useEffect, useRef } from "react";

/**
 * Tumpukan penanganan tombol Back Android. MainActivity meneruskan Back ke
 * riwayat WebView; setiap layar yang aktif (halaman, editor, panel) menambah
 * satu entri history. Satu kali Back hanya menutup entri paling atas.
 *
 * Kalau satu lembar ditutup dan lembar lain dibuka dalam render yang sama
 * (mis. Bayar → Nota), entri history yang dilepas dipakai ulang. Tanpa ini
 * `history.back()` yang masih tertunda ikut membuang entri baru, sehingga
 * Back berikutnya keluar dari aplikasi.
 */
interface BackEntry {
  readonly onBack: () => void;
}

const stack: BackEntry[] = [];
let ignoredPops = 0;
let listening = false;
/** Entri yang dilepas kode tapi belum di-`back()`: bisa dipakai ulang. */
let releasedEntries = 0;
let flushScheduled = false;

function ensureListener() {
  if (listening) return;
  listening = true;
  window.addEventListener("popstate", () => {
    if (ignoredPops > 0) {
      // Entri yang dilepas oleh kode (bukan oleh tombol Back).
      ignoredPops -= 1;
      return;
    }
    stack.pop()?.onBack();
  });
}

function scheduleFlush() {
  if (flushScheduled) return;
  flushScheduled = true;
  setTimeout(() => {
    flushScheduled = false;
    const count = releasedEntries;
    releasedEntries = 0;
    if (count > 0) {
      ignoredPops += 1;
      window.history.go(-count);
    }
  }, 0);
}

export function useAndroidBack(active: boolean, onBack: () => void): void {
  const callback = useRef(onBack);
  callback.current = onBack;

  useEffect(() => {
    if (!active) return;
    ensureListener();
    let poppedByBack = false;
    const entry: BackEntry = {
      onBack: () => {
        poppedByBack = true;
        callback.current();
      },
    };
    stack.push(entry);
    if (releasedEntries > 0) {
      releasedEntries -= 1;
      window.history.replaceState({ kasirKonterBack: stack.length }, "");
    } else {
      window.history.pushState({ kasirKonterBack: stack.length }, "");
    }
    return () => {
      if (poppedByBack) return;
      const index = stack.indexOf(entry);
      if (index >= 0) stack.splice(index, 1);
      releasedEntries += 1;
      scheduleFlush();
    };
  }, [active]);
}
