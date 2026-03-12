declare module "better-sqlite3" {
  export interface Statement<T = unknown> {
    run(...params: unknown[]): void;
    all(...params: unknown[]): T[];
    get(...params: unknown[]): T | undefined;
  }

  export interface Database {
    prepare<T = unknown>(sql: string): Statement<T>;
    exec(sql: string): void;
  }

  interface DatabaseConstructor {
    new (path: string): Database;
  }

  const Database: DatabaseConstructor;
  export default Database;
}
