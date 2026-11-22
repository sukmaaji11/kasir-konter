import sqlWasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import { createSqlJsDatabaseDriver } from "./sqljs-driver";
import { KonterRepository, type RepositoryOptions } from "./repository";

/** Mode pengembangan di browser: database di memori, hilang saat dimuat ulang. */
export async function openBrowserDevRepository(options: RepositoryOptions = {}): Promise<{
  readonly repository: KonterRepository;
  close(): void;
}> {
  const { driver, close } = await createSqlJsDatabaseDriver(() => sqlWasmUrl);
  const repository = new KonterRepository(driver, options);
  try {
    await repository.initialize();
    return { repository, close };
  } catch (error) {
    close();
    throw error;
  }
}
