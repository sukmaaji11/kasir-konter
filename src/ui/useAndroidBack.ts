import { useEffect, useRef } from "react";

/**
 * Tumpukan penanganan tombol Back Android. MainActivity meneruskan Back ke
 * riwayat WebView; setiap layar yang aktif (halaman, editor, panel) menambah
 * satu entri history. Satu kali Back hanya menutup entri paling atas.
 */
interface BackEntry {
  readonly onBack: () => void;
}

const stack: BackEntry[] = [];
let ignoredPops = 0;
let listening = false;

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
    window.history.pushState({ kasirKonterBack: stack.length }, "");
    return () => {
      if (poppedByBack) return;
      const index = stack.indexOf(entry);
      if (index >= 0) stack.splice(index, 1);
      ignoredPops += 1;
      window.history.back();
    };
  }, [active]);
}
