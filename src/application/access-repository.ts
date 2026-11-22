import type { StoredUser } from "../domain/auth";

/** Bagian repository yang dibutuhkan lisensi dan login PIN. */
export interface AccessRepository {
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string): Promise<void>;
  listUsers(): Promise<readonly StoredUser[]>;
  saveUser(user: StoredUser): Promise<void>;
}
