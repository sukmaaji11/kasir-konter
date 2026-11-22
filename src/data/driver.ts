import type { StoredValue } from "./schema";

export type SqlRow = Readonly<Record<string, unknown>>;

export interface SqlDatabaseDriver {
  query(sql: string, values?: readonly StoredValue[]): Promise<readonly SqlRow[]>;
  run(sql: string, values?: readonly StoredValue[]): Promise<void>;
  execute(sql: string): Promise<void>;
  beginTransaction(): Promise<void>;
  commitTransaction(): Promise<void>;
  rollbackTransaction(): Promise<void>;
}

export function readStoredValue(value: unknown): StoredValue {
  if (value === null || typeof value === "string") {
    return value;
  }
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return value;
  }

  throw new Error("SQLite mengembalikan nilai yang tidak didukung.");
}

export function readSqlRow(value: unknown): Record<string, StoredValue> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("SQLite mengembalikan baris yang tidak valid.");
  }

  const row: Record<string, StoredValue> = {};
  for (const [column, item] of Object.entries(value)) {
    row[column] = readStoredValue(item);
  }
  return row;
}
