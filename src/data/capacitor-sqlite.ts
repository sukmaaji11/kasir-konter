import { CapacitorSQLite, SQLiteConnection, type SQLiteDBConnection } from "@capacitor-community/sqlite";
import type { SqlDatabaseDriver, SqlRow } from "./driver";
import { readSqlRow } from "./driver";
import { DATABASE_NAME } from "./schema";
import { KonterRepository } from "./repository";

const sqlite = new SQLiteConnection(CapacitorSQLite);
let openDatabasePromise: Promise<OpenDatabase> | null = null;

export class CapacitorSqliteDriver implements SqlDatabaseDriver {
  constructor(private readonly connection: SQLiteDBConnection) {}

  async query(
    sql: string,
    values: readonly (string | number | null)[] = [],
  ): Promise<readonly SqlRow[]> {
    const result = await this.connection.query(sql, [...values]);
    return (result.values ?? []).map(readSqlRow);
  }

  async run(
    sql: string,
    values: readonly (string | number | null)[] = [],
  ): Promise<void> {
    await this.connection.run(sql, [...values], false);
  }

  async execute(sql: string): Promise<void> {
    await this.connection.execute(sql, false);
  }

  async beginTransaction(): Promise<void> {
    await this.connection.beginTransaction();
  }

  async commitTransaction(): Promise<void> {
    await this.connection.commitTransaction();
  }

  async rollbackTransaction(): Promise<void> {
    await this.connection.rollbackTransaction();
  }
}

export interface OpenDatabase {
  readonly repository: KonterRepository;
  close(): Promise<void>;
}

export function openCapacitorDatabase(): Promise<OpenDatabase> {
  if (openDatabasePromise !== null) {
    return openDatabasePromise;
  }

  const pending = initializeDatabase().catch((error: unknown) => {
    openDatabasePromise = null;
    throw error;
  });
  openDatabasePromise = pending;
  return openDatabasePromise;
}

async function initializeDatabase(): Promise<OpenDatabase> {
  const connectionStatus = await sqlite.isConnection(DATABASE_NAME, false);
  const connection = connectionStatus.result
    ? await sqlite.retrieveConnection(DATABASE_NAME, false)
    : await sqlite.createConnection(
        DATABASE_NAME,
        false,
        "no-encryption",
        1,
        false,
      );

  try {
    await connection.open();
    const repository = new KonterRepository(
      new CapacitorSqliteDriver(connection),
    );
    await repository.initialize();
    return {
      repository,
      close: async () => {
        await sqlite.closeConnection(DATABASE_NAME, false);
        openDatabasePromise = null;
      },
    };
  } catch (error) {
    try {
      await sqlite.closeConnection(DATABASE_NAME, false);
    } catch (closeError) {
      throw new AggregateError(
        [error, closeError],
        "Database gagal dibuka dan koneksi yang gagal juga tidak bisa ditutup.",
      );
    }
    throw error;
  }
}
