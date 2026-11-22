#!/usr/bin/env node
// Alat Admin Kasir Konter: membuat kunci lisensi, kode aktivasi, dan kode reset PIN.
//
//   node tools/license/admin.mjs init                     (sekali saja)
//   node tools/license/admin.mjs aktivasi ABCDE-12345
//   node tools/license/admin.mjs reset ABCDE-12345
//
// Kunci RAHASIA disimpan di luar repo (default: Documents\KasirKonterAdmin).
// Ubah lokasinya dengan variabel lingkungan KKO_LICENSE_KEY_FILE.
// JANGAN pernah membagikan, meng-commit, atau mengirim file kunci rahasia lewat chat.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createLicenseCode,
  formatLicenseCode,
  generateKeyPair,
  normalizeCode,
  publicKeyModule,
} from "./license-core.mjs";

const keyFile =
  process.env.KKO_LICENSE_KEY_FILE ??
  join(homedir(), "Documents", "KasirKonterAdmin", "license-private-key.json");
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const publicKeyPath = join(repoRoot, "src", "licensing", "public-key.ts");

async function main() {
  const [command, deviceCode] = process.argv.slice(2);
  if (command === "init") return init();
  if (command === "aktivasi" || command === "activation") return issue("activation", deviceCode);
  if (command === "reset") return issue("reset", deviceCode);
  console.log(`Pemakaian:
  node tools/license/admin.mjs init
  node tools/license/admin.mjs aktivasi <KODE-PERANGKAT>
  node tools/license/admin.mjs reset <KODE-PERANGKAT>`);
  process.exitCode = 1;
}

async function init() {
  if (existsSync(keyFile)) {
    throw new Error(
      `Kunci rahasia sudah ada di ${keyFile}. Membuat kunci baru akan membatalkan semua kode lama, jadi dihentikan.`,
    );
  }
  const { privateJwk, publicJwk } = await generateKeyPair();
  mkdirSync(dirname(keyFile), { recursive: true });
  writeFileSync(keyFile, JSON.stringify({ privateJwk, publicJwk }, null, 2), { mode: 0o600 });
  writeFileSync(publicKeyPath, publicKeyModule(publicJwk));
  console.log(`Kunci rahasia disimpan di: ${keyFile}`);
  console.log(`Kunci publik ditulis ke:  ${publicKeyPath}`);
  console.log("Cadangkan file kunci rahasia di dua tempat aman. Kalau hilang, kode baru tidak bisa dibuat.");
}

async function issue(type, deviceCode) {
  if (deviceCode === undefined) throw new Error("Tuliskan Kode perangkat dari layar aplikasi.");
  if (!existsSync(keyFile)) throw new Error(`Kunci rahasia tidak ditemukan di ${keyFile}. Jalankan "init" dulu.`);
  const { privateJwk } = JSON.parse(readFileSync(keyFile, "utf8"));
  const code = await createLicenseCode({ privateJwk, deviceCode, type });
  const label = type === "activation" ? "KODE AKTIVASI" : "KODE RESET PIN (sekali pakai)";
  console.log(`${label} untuk perangkat ${normalizeCode(deviceCode)}:\n`);
  console.log(formatLicenseCode(code));
  console.log("\nKirim seluruh kode di atas ke pengguna. Pengguna cukup menempelkannya di aplikasi.");
}

main().catch((error) => {
  console.error(`Gagal: ${error.message}`);
  process.exitCode = 1;
});
