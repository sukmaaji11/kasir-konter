import { createRoot } from "react-dom/client";
import { App } from "./ui/App";

const rootElement = document.getElementById("root");
if (rootElement === null) {
  throw new Error("Elemen aplikasi tidak ditemukan.");
}

createRoot(rootElement).render(<App />);
