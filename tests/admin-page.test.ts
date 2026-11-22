import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildAdminPage } from "../tools/license/build-admin-page.mjs";
import { LICENSE_PUBLIC_KEY } from "../src/licensing/public-key";

describe("halaman Admin lisensi", () => {
  const page = buildAdminPage();

  it("admin.html sesuai dengan sumbernya (jalankan `npm run admin:page` bila gagal)", () => {
    const committed = readFileSync(new URL("../tools/license/admin.html", import.meta.url), "utf8");
    expect(committed).toBe(page);
  });

  it("berdiri sendiri: tanpa import/export, tanpa modul Node, tanpa sumber dari internet", () => {
    const script = page.slice(page.indexOf('<script type="module">'));
    expect(script).not.toMatch(/^\s*(import|export)\s/m);
    expect(script).not.toContain("node:");
    expect(page).not.toMatch(/<script[^>]+src=|<link[^>]+href=["']https?:/);
  });

  it("memuat kunci PUBLIK aplikasi, bukan kunci rahasia", () => {
    expect(page).toContain(`"x":"${LICENSE_PUBLIC_KEY.x}"`);
    expect(page).toContain(`"y":"${LICENSE_PUBLIC_KEY.y}"`);
    expect(page).not.toMatch(/"d"\s*:/);
  });
});
