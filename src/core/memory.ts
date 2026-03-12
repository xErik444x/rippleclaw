import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import { dirname } from "path";
import type { Config } from "./config";

export interface Memory {
  id: number;
  role: "user" | "assistant" | "system";
  content: string;
  channel: string;
  user_id: string;
  timestamp: number;
}

export interface MemoryStore {
  save(role: Memory["role"], content: string, channel: string, userId: string): void;
  recall(channel: string, userId: string, limit?: number): Memory[];
  search(query: string, limit?: number): Memory[];
  clear(channel: string, userId: string): void;
  saveNote(key: string, value: string): void;
  getNote(key: string): string | null;
}

class SQLiteMemory implements MemoryStore {
  private db: import("better-sqlite3").Database;

  constructor(path: string) {
    const dir = dirname(path);
    if (dir && dir !== "." && dir !== ":") {
      mkdirSync(dir, { recursive: true });
    }
    this.db = new Database(path);
    this.init();
  }

  private init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        channel TEXT NOT NULL,
        user_id TEXT NOT NULL,
        timestamp INTEGER NOT NULL
      )
    `);
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts
      USING fts5(content, content=messages, content_rowid=id)
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS notes (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
    // FTS trigger
    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
        INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
      END
    `);
  }

  save(role: Memory["role"], content: string, channel: string, userId: string) {
    this.db
      .prepare(
        `INSERT INTO messages (role, content, channel, user_id, timestamp) VALUES (?, ?, ?, ?, ?)`
      )
      .run(role, content, channel, userId, Date.now());
  }

  recall(channel: string, userId: string, limit = 20): Memory[] {
    return this.db
      .prepare(
        `SELECT * FROM messages WHERE channel = ? AND user_id = ? ORDER BY timestamp DESC LIMIT ?`
      )
      .all(channel, userId, limit) as Memory[];
  }

  search(query: string, limit = 5): Memory[] {
    return this.db
      .prepare(
        `SELECT messages.* FROM messages_fts 
         JOIN messages ON messages.id = messages_fts.rowid
         WHERE messages_fts MATCH ? ORDER BY rank LIMIT ?`
      )
      .all(query, limit) as Memory[];
  }

  clear(channel: string, userId: string) {
    this.db.prepare(`DELETE FROM messages WHERE channel = ? AND user_id = ?`).run(channel, userId);
  }

  saveNote(key: string, value: string) {
    this.db
      .prepare(`INSERT OR REPLACE INTO notes (key, value, updated_at) VALUES (?, ?, ?)`)
      .run(key, value, Date.now());
  }

  getNote(key: string): string | null {
    const row = this.db.prepare(`SELECT value FROM notes WHERE key = ?`).get(key) as {
      value: string;
    } | null;
    return row?.value ?? null;
  }
}

class NoopMemory implements MemoryStore {
  save() {}
  recall() {
    return [];
  }
  search() {
    return [];
  }
  clear() {}
  saveNote() {}
  getNote() {
    return null;
  }
}

export function createMemory(config: Config): MemoryStore {
  if (config.memory.backend === "sqlite") {
    return new SQLiteMemory(config.memory.path);
  }
  return new NoopMemory();
}
