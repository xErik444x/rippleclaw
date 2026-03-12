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
  search(
    query: string,
    options?: { channel?: string; userId?: string; limit?: number }
  ): Memory[];
  clear(channel: string, userId: string): void;
  saveNote(key: string, value: string): void;
  getNote(key: string): string | null;
  deleteNote(key: string): boolean;
  listNotes(): { key: string; value: string; updated_at: number }[];
  searchNotes(query: string, limit?: number): { key: string; value: string; updated_at: number }[];
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
      CREATE INDEX IF NOT EXISTS idx_messages_channel_user_timestamp
      ON messages(channel, user_id, timestamp DESC)
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS notes (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts
      USING fts5(key, value)
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

  search(
    query: string,
    options: { channel?: string; userId?: string; limit?: number } = {}
  ): Memory[] {
    const clauses: string[] = [];
    const params: (string | number)[] = [query];
    if (options.channel) {
      clauses.push("AND messages.channel = ?");
      params.push(options.channel);
    }
    if (options.userId) {
      clauses.push("AND messages.user_id = ?");
      params.push(options.userId);
    }
    const limit = options.limit ?? 5;
    const stmt = this.db.prepare(`
      SELECT messages.* FROM messages_fts
      JOIN messages ON messages.id = messages_fts.rowid
      WHERE messages_fts MATCH ?
      ${clauses.join("\n")}
      ORDER BY messages.timestamp DESC
      LIMIT ?
    `);
    return stmt.all(...params, limit) as Memory[];
  }

  clear(channel: string, userId: string) {
    this.db.prepare(`DELETE FROM messages WHERE channel = ? AND user_id = ?`).run(channel, userId);
  }

  saveNote(key: string, value: string) {
    const now = Date.now();
    const insert = this.db.prepare(
      `INSERT OR REPLACE INTO notes (key, value, updated_at) VALUES (?, ?, ?)`
    );
    const deleteFts = this.db.prepare(`DELETE FROM notes_fts WHERE key = ?`);
    const insertFts = this.db.prepare(`INSERT INTO notes_fts (key, value) VALUES (?, ?)`);
    const trx = this.db.transaction(() => {
      insert.run(key, value, now);
      deleteFts.run(key);
      insertFts.run(key, value);
    });
    trx();
  }

  getNote(key: string): string | null {
    const row = this.db.prepare(`SELECT value FROM notes WHERE key = ?`).get(key) as {
      value: string;
    } | null;
    return row?.value ?? null;
  }

  deleteNote(key: string): boolean {
    const existing = this.getNote(key);
    if (!existing) return false;
    const deleteFts = this.db.prepare(`DELETE FROM notes_fts WHERE key = ?`);
    const deleteMain = this.db.prepare(`DELETE FROM notes WHERE key = ?`);
    const trx = this.db.transaction(() => {
      deleteFts.run(key);
      deleteMain.run(key);
    });
    trx();
    return true;
  }

  listNotes(): { key: string; value: string; updated_at: number }[] {
    return this.db
      .prepare(`SELECT key, value, updated_at FROM notes ORDER BY updated_at DESC`)
      .all() as { key: string; value: string; updated_at: number }[];
  }

  searchNotes(query: string, limit = 5): { key: string; value: string; updated_at: number }[] {
    return this.db
      .prepare(
        `SELECT notes.key, notes.value, notes.updated_at
         FROM notes
         JOIN notes_fts ON notes.key = notes_fts.key
         WHERE notes_fts MATCH ?
         ORDER BY notes.updated_at DESC
         LIMIT ?`
      )
      .all(query, limit) as { key: string; value: string; updated_at: number }[];
  }
}

class NoopMemory implements MemoryStore {
  save() {}
  recall(): Memory[] {
    return [];
  }
  search(_query: string, _options?: { channel?: string; userId?: string; limit?: number }): Memory[] {
    return [];
  }
  clear() {}
  saveNote() {}
  getNote() {
    return null;
  }
  deleteNote(): boolean {
    return false;
  }
  listNotes(): { key: string; value: string; updated_at: number }[] {
    return [];
  }
  searchNotes(_query: string, _limit?: number): { key: string; value: string; updated_at: number }[] {
    return [];
  }
}

export function createMemory(config: Config): MemoryStore {
  if (config.memory.backend === "sqlite") {
    return new SQLiteMemory(config.memory.path);
  }
  return new NoopMemory();
}
