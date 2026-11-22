import {
  SCHEMA_VERSION,
  SCHEMA_VERSION_1_STATEMENTS,
  SCHEMA_VERSION_2_STATEMENTS,
  SCHEMA_VERSION_3_STATEMENTS,
  SCHEMA_VERSION_4_STATEMENTS,
} from "./schema";
import type { SqlDatabaseDriver } from "./driver";

interface Migration {
  readonly version: number;
  readonly statements: readonly string[];
}

export const DATABASE_MIGRATIONS: readonly Migration[] = [
  { version: 1, statements: SCHEMA_VERSION_1_STATEMENTS },
  { version: 2, statements: SCHEMA_VERSION_2_STATEMENTS },
  { version: 3, statements: SCHEMA_VERSION_3_STATEMENTS },
  { version: 4, statements: SCHEMA_VERSION_4_STATEMENTS },
];

export async function migrateDatabase(database: SqlDatabaseDriver): Promise<void> {
  let version = await readSchemaVersion(database);
  if (version > SCHEMA_VERSION) {
    throw new Error(
      `Database memakai skema ${version}; versi aplikasi ini hanya mendukung sampai ${SCHEMA_VERSION}.`,
    );
  }

  while (version < SCHEMA_VERSION) {
    const migration = DATABASE_MIGRATIONS.find(
      (candidate) => candidate.version === version + 1,
    );
    if (migration === undefined) {
      throw new Error(`Migrasi skema ${version + 1} belum tersedia.`);
    }

    await inTransaction(database, async () => {
      for (const statement of migration.statements) {
        await database.execute(statement);
      }
      await database.execute(`PRAGMA user_version = ${migration.version}`);
    });
    version = migration.version;
  }
}

export async function readSchemaVersion(database: SqlDatabaseDriver): Promise<number> {
  const rows = await database.query("PRAGMA user_version");
  const version = rows[0]?.user_version;
  if (typeof version !== "number" || !Number.isSafeInteger(version) || version < 0) {
    throw new Error("Versi skema SQLite tidak dapat dibaca.");
  }
  return version;
}

export async function inTransaction<T>(
  database: SqlDatabaseDriver,
  operation: () => Promise<T>,
): Promise<T> {
  await database.beginTransaction();
  try {
    const result = await operation();
    await database.commitTransaction();
    return result;
  } catch (error) {
    try {
      await database.rollbackTransaction();
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        "Transaksi gagal dan pembatalan transaksi juga gagal.",
      );
    }
    throw error;
  }
}
