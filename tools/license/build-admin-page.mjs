#!/usr/bin/env node
// Bangun tools/license/admin.html dari admin.template.html:
// - menyisipkan license-core.mjs (tanpa kata "export") supaya halaman bisa
//   dibuka langsung dari file (file://) tanpa server dan tanpa internet;
// - menyisipkan kunci PUBLIK aplikasi (src/licensing/public-key.ts) untuk
//   memastikan kunci rahasia yang dimuat Admin memang pasangannya.
//
//   npm run admin:page
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");

export function buildAdminPage() {
  const template = readFileSync(join(here, "admin.template.html"), "utf8");
  const core = readFileSync(join(here, "license-core.mjs"), "utf8")
    .replace(/^export\s+/gm, "")
    // Fungsi khusus pembuat kunci (init) & modul TS tidak dipakai di halaman.
    .trim();
  const publicKeySource = readFileSync(join(repoRoot, "src", "licensing", "public-key.ts"), "utf8");
  const match = /LICENSE_PUBLIC_KEY[^=]*=\s*(\{[\s\S]*?\});/.exec(publicKeySource);
  if (match === null) throw new Error("Kunci publik tidak ditemukan di src/licensing/public-key.ts");
  const publicKey = JSON.parse(match[1]);

  for (const marker of ["/*@@LICENSE_CORE@@*/", "/*@@APP_PUBLIC_KEY@@*/"]) {
    if (!template.includes(marker)) throw new Error(`Penanda ${marker} tidak ada di template.`);
  }
  return template
    .replace("/*@@LICENSE_CORE@@*/", () => core)
    .replace("/*@@APP_PUBLIC_KEY@@*/", () =>
      JSON.stringify({ kty: publicKey.kty, crv: publicKey.crv, x: publicKey.x, y: publicKey.y }),
    );
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const output = join(here, "admin.html");
  writeFileSync(output, buildAdminPage());
  console.log(`Halaman Admin dibuat: ${output}`);
  console.log("Buka file itu di Chrome/Edge (klik dua kali). Tidak perlu internet.");
}
