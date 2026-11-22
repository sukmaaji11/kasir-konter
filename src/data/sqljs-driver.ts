import initSqlJs from "sql.js";
import type { Database as SqlJsDatabase } from "sql.js";
import type { SqlDatabaseDriver, SqlRow } from "./driver";
import type { StoredValue } from "./schema";

export async function createSqlJsDatabaseDriver(
  locateFile: (fileName: string) => string,
): Promise<{
  readonly driver: SqlDatabaseDriver;
  close(): void;
}> {
  const SQL = await initSqlJs({ locateFile });
  const database = new SQL.Database();
  return {
    driver: new SqlJsDriver(database),
    close: () => database.close(),
  };
}

class SqlJsDriver implements SqlDatabaseDriver {
  constructor(private readonly database: SqlJsDatabase) {}

  async query(
    sql: string,
    values: readonly StoredValue[] = [],
  ): Promise<readonly SqlRow[]> {
    const statement = this.database.prepare(sql, [...values]);
    try {
      const rows: SqlRow[] = [];
      while (statement.step()) {
        rows.push(statement.getAsObject());
      }
      return rows;
    } finally {
      statement.free();
    }
  }

  async run(sql: string, values: readonly StoredValue[] = []): Promise<void> {
    this.database.run(sql, [...values]);
  }

  async execute(sql: string): Promise<void> {
    this.database.exec(sql);
  }

  async beginTransaction(): Promise<void> {
    this.database.run("BEGIN IMMEDIATE");
  }

  async commitTransaction(): Promise<void> {
    this.database.run("COMMIT");
  }

  async rollbackTransaction(): Promise<void> {
    this.database.run("ROLLBACK");
  }
}
