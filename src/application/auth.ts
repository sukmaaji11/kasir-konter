import type { AccessRepository } from "./access-repository";
import {
  cleanUserName,
  validatePin,
  type AppUser,
  type StoredUser,
  type UserRole,
} from "../domain/auth";
import { hashPin, verifyPin } from "../security/pin";

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 30_000;

/**
 * Login dengan PIN saja: PIN setiap pengguna aktif harus berbeda, karena PIN
 * yang menentukan siapa yang masuk (Owner atau karyawan tertentu).
 */
export class AuthApplicationService {
  private failedAttempts = 0;
  private lockedUntilMs = 0;

  constructor(
    private readonly repository: AccessRepository,
    private readonly now: () => number = Date.now,
    private readonly createId: () => string = createRandomId,
  ) {}

  async listActiveUsers(): Promise<readonly AppUser[]> {
    return (await this.activeUsers()).map(toAppUser);
  }

  /** Nama semua pengguna (termasuk nonaktif) untuk label "dilayani oleh". */
  async userNames(): Promise<ReadonlyMap<string, string>> {
    return new Map((await this.repository.listUsers()).map((user) => [user.id, user.name]));
  }

  async hasOwner(): Promise<boolean> {
    return (await this.activeUsers()).some((user) => user.role === "owner");
  }

  async createInitialOwner(name: string, pin: string): Promise<AppUser> {
    if (await this.hasOwner()) {
      throw new Error("Owner sudah dibuat. Masuk dengan PIN Owner.");
    }
    return this.createUser("owner", name, pin);
  }

  async login(pin: string): Promise<AppUser> {
    const remainingMs = this.lockedUntilMs - this.now();
    if (remainingMs > 0) {
      throw new Error(
        `Terlalu banyak PIN salah. Coba lagi dalam ${Math.ceil(remainingMs / 1000)} detik.`,
      );
    }
    const user = await this.findByPin(pin);
    if (user === undefined) {
      this.failedAttempts += 1;
      if (this.failedAttempts >= MAX_FAILED_ATTEMPTS) {
        this.failedAttempts = 0;
        this.lockedUntilMs = this.now() + LOCKOUT_MS;
        throw new Error("PIN salah 5 kali. Tunggu 30 detik sebelum mencoba lagi.");
      }
      throw new Error("PIN salah. Coba lagi.");
    }
    this.failedAttempts = 0;
    return toAppUser(user);
  }

  /** Untuk tindakan khusus Owner (mis. batalkan transaksi) saat karyawan login. */
  async verifyOwnerPin(pin: string): Promise<AppUser> {
    const user = await this.findByPin(pin);
    if (user === undefined || user.role !== "owner") {
      throw new Error("PIN Owner salah.");
    }
    return toAppUser(user);
  }

  async addStaff(actor: AppUser, name: string, pin: string): Promise<AppUser> {
    assertOwner(actor);
    return this.createUser("staff", name, pin);
  }

  async changePin(actor: AppUser, userId: string, newPin: string): Promise<void> {
    if (actor.role !== "owner" && actor.id !== userId) {
      throw new Error("Hanya Owner yang bisa mengubah PIN pengguna lain.");
    }
    const users = await this.activeUsers();
    const target = users.find((user) => user.id === userId);
    if (target === undefined) throw new Error("Pengguna tidak ditemukan.");
    await this.assertPinUnused(validatePin(newPin), userId);
    await this.repository.saveUser({ ...target, pin: await hashPin(newPin) });
  }

  async renameUser(actor: AppUser, userId: string, name: string): Promise<void> {
    assertOwner(actor);
    const target = (await this.activeUsers()).find((user) => user.id === userId);
    if (target === undefined) throw new Error("Pengguna tidak ditemukan.");
    await this.repository.saveUser({ ...target, name: cleanUserName(name) });
  }

  async archiveStaff(actor: AppUser, userId: string): Promise<void> {
    assertOwner(actor);
    const target = (await this.activeUsers()).find((user) => user.id === userId);
    if (target === undefined) throw new Error("Pengguna tidak ditemukan.");
    if (target.role === "owner") throw new Error("Akun Owner tidak bisa dinonaktifkan.");
    await this.repository.saveUser({
      ...target,
      archivedAtMs: this.now(),
    });
  }

  /** Dipakai setelah kode reset dari Admin terverifikasi. */
  async resetOwnerPin(newPin: string): Promise<AppUser> {
    const owner = (await this.activeUsers()).find((user) => user.role === "owner");
    if (owner === undefined) throw new Error("Akun Owner tidak ditemukan.");
    await this.assertPinUnused(validatePin(newPin), owner.id);
    await this.repository.saveUser({ ...owner, pin: await hashPin(newPin) });
    this.failedAttempts = 0;
    this.lockedUntilMs = 0;
    return toAppUser(owner);
  }

  private async createUser(role: UserRole, name: string, pin: string): Promise<AppUser> {
    const cleanedName = cleanUserName(name);
    await this.assertPinUnused(validatePin(pin), null);
    const timestamp = this.now();
    const user: StoredUser = {
      id: this.createId(),
      name: cleanedName,
      role,
      createdAtMs: timestamp,
      archivedAtMs: null,
      pin: await hashPin(pin),
    };
    await this.repository.saveUser(user);
    return toAppUser(user);
  }

  private async assertPinUnused(pin: string, exceptUserId: string | null): Promise<void> {
    const holder = await this.findByPin(pin);
    if (holder !== undefined && holder.id !== exceptUserId) {
      throw new Error("PIN ini sudah dipakai pengguna lain. Pilih PIN yang berbeda.");
    }
  }

  private async findByPin(pin: string): Promise<StoredUser | undefined> {
    for (const user of await this.activeUsers()) {
      if (await verifyPin(pin, user.pin)) return user;
    }
    return undefined;
  }

  private async activeUsers(): Promise<readonly StoredUser[]> {
    return (await this.repository.listUsers()).filter((user) => user.archivedAtMs === null);
  }
}

function assertOwner(actor: AppUser): void {
  if (actor.role !== "owner") throw new Error("Hanya Owner yang bisa mengatur pengguna.");
}

function toAppUser(user: StoredUser): AppUser {
  return {
    id: user.id,
    name: user.name,
    role: user.role,
    createdAtMs: user.createdAtMs,
    archivedAtMs: user.archivedAtMs,
  };
}

function createRandomId(): string {
  if (typeof globalThis.crypto?.randomUUID !== "function") {
    throw new Error("Fitur pembuat ID aman tidak tersedia di perangkat ini.");
  }
  return globalThis.crypto.randomUUID();
}
