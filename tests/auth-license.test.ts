import { describe, expect, it } from "vitest";
import { AuthApplicationService } from "../src/application/auth";
import { LicenseApplicationService } from "../src/application/license";
import { KonterRepository } from "../src/data/repository";
import { can, validatePin } from "../src/domain/auth";
import {
  base32Encode,
  encodePayload,
  formatLicenseCode,
  normalizeCode,
} from "../src/licensing/license";
import { createLicenseCode, generateKeyPair } from "../tools/license/license-core.mjs";
import { createSqlJsDriver } from "./support/sqljs-driver";

async function setup(deviceId = "android-id-123") {
  const { driver, close } = await createSqlJsDriver();
  const repository = new KonterRepository(driver);
  await repository.initialize();
  const keys = await generateKeyPair();
  let clock = 1_800_000_000_000;
  let nextId = 0;
  return {
    close,
    keys,
    auth: new AuthApplicationService(repository, () => (clock += 1_000), () => `id-${++nextId}`),
    license: new LicenseApplicationService(repository, async () => deviceId, keys.publicJwk),
  };
}

/** Kode bertanda tangan sah tapi memakai header Kasir Kaki Lima ("KKL1"). */
async function kasirKakiLimaStyleCode(privateJwk: JsonWebKey, deviceCode: string): Promise<string> {
  const payload = encodePayload("activation", 300, 42);
  const header = new TextEncoder().encode("KKL1");
  const device = new TextEncoder().encode(normalizeCode(deviceCode));
  const message = Uint8Array.from([...header, ...device, ...payload]);
  const key = await crypto.subtle.importKey(
    "jwk",
    privateJwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, message),
  );
  return base32Encode(Uint8Array.from([...payload, ...signature]));
}

describe("lisensi offline", () => {
  it("menerima kode aktivasi untuk perangkat yang sama", async () => {
    const { license, keys, close } = await setup();
    try {
      expect((await license.status()).activated).toBe(false);
      const code = await createLicenseCode({
        privateJwk: keys.privateJwk,
        deviceCode: await license.deviceCode(),
        type: "activation",
      });
      await license.activate(` ${formatLicenseCode(code).toLowerCase()} `);
      expect((await license.status()).activated).toBe(true);
    } finally {
      close();
    }
  });

  it("menolak kode HP lain, kode reset, dan kode berformat Kasir Kaki Lima", async () => {
    const { license, keys, close } = await setup();
    try {
      const deviceCode = await license.deviceCode();
      const otherDevice = await createLicenseCode({
        privateJwk: keys.privateJwk,
        deviceCode: "ABCDE12345",
        type: "activation",
      });
      await expect(license.activate(otherDevice)).rejects.toThrow("tidak cocok untuk HP ini");

      const reset = await createLicenseCode({
        privateJwk: keys.privateJwk,
        deviceCode,
        type: "reset",
      });
      await expect(license.activate(reset)).rejects.toThrow("bukan kode aktivasi");

      const kkl = await kasirKakiLimaStyleCode(keys.privateJwk, deviceCode);
      await expect(license.activate(kkl)).rejects.toThrow("tidak cocok untuk HP ini");
      expect((await license.status()).activated).toBe(false);
    } finally {
      close();
    }
  });

  it("kode reset hanya bisa dipakai sekali", async () => {
    const { license, keys, close } = await setup();
    try {
      const reset = await createLicenseCode({
        privateJwk: keys.privateJwk,
        deviceCode: await license.deviceCode(),
        type: "reset",
      });
      await license.consumeResetCode(reset);
      await expect(license.consumeResetCode(reset)).rejects.toThrow("sudah pernah dipakai");
    } finally {
      close();
    }
  });
});

describe("login PIN", () => {
  it("membuat Owner, login, dan menambah karyawan dengan PIN berbeda", async () => {
    const { auth, close } = await setup();
    try {
      expect(await auth.hasOwner()).toBe(false);
      const owner = await auth.createInitialOwner("Pak Joko", "246810");
      expect(owner.role).toBe("owner");
      await expect(auth.createInitialOwner("Lagi", "135791")).rejects.toThrow("sudah dibuat");

      const staff = await auth.addStaff(owner, "Rudi", "135791");
      await expect(auth.addStaff(owner, "Dua", "135791")).rejects.toThrow("sudah dipakai");
      expect((await auth.login("135791")).id).toBe(staff.id);
      expect((await auth.login("246810")).role).toBe("owner");
      await expect(auth.addStaff(staff, "X", "975319")).rejects.toThrow("Hanya Owner");

      await auth.archiveStaff(owner, staff.id);
      await expect(auth.login("135791")).rejects.toThrow("PIN salah");
    } finally {
      close();
    }
  });

  it("mengganti PIN Owner setelah kode reset", async () => {
    const { auth, close } = await setup();
    try {
      await auth.createInitialOwner("Bu Sari", "246810");
      await auth.resetOwnerPin("864202");
      await expect(auth.login("246810")).rejects.toThrow("PIN salah");
      expect((await auth.login("864202")).name).toBe("Bu Sari");
    } finally {
      close();
    }
  });

  it("menolak PIN lemah", () => {
    expect(() => validatePin("111111")).toThrow("sama semua");
    expect(() => validatePin("123456")).toThrow("berurutan");
    expect(() => validatePin("12345")).toThrow("6 angka");
    expect(validatePin("246810")).toBe("246810");
  });
});

describe("hak akses", () => {
  it("karyawan bisa jual dan service, tapi tidak melihat modal/untung", () => {
    const staff = { role: "staff" as const };
    expect(can(staff, "sell")).toBe(true);
    expect(can(staff, "service")).toBe(true);
    expect(can(staff, "viewCostAndProfit")).toBe(false);
    expect(can(staff, "addPhone")).toBe(false);
    expect(can(staff, "voidSale")).toBe(false);
    expect(can({ role: "owner" }, "viewCostAndProfit")).toBe(true);
  });
});
