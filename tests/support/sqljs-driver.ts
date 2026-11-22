import { join } from "node:path";
import { createSqlJsDatabaseDriver } from "../../src/data/sqljs-driver";

export function createSqlJsDriver() {
  return createSqlJsDatabaseDriver((fileName) =>
    join(process.cwd(), "node_modules", "sql.js", "dist", fileName),
  );
}
