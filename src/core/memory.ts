import { mkdirSync, readFileSync, writeFileSync, existsSync } from "fs";
import { dirname, join } from "path";
import type { Config } from "./config";

export interface Memory {
  id: number;
  role: "user" | "assistant" | "system";
  content: string;
  channel: string;
  user_id: string;
  timestamp: number;
}

export interface CronJob {
  id: string;
  schedule: string;
  prompt: string;
  enabled: boolean;
  lastRun?: number;
}

export interface MemoryStore {
  save(role: Memory["role"], content: string, channel: string, userId: string): void;
  recall(channel: string, userId: string, limit?: number): Memory[];
  search(query: string, options?: { channel?: string; userId?: string; limit?: number }): Memory[];
  clear(channel: string, userId: string): void;
  saveNote(key: string, value: string): void;
  getNote(key: string): string | null;
  deleteNote(key: string): boolean;
  listNotes(): { key: string; value: string; updated_at: number }[];
  searchNotes(query: string, limit?: number): { key: string; value: string; updated_at: number }[];
  saveCronJob(job: CronJob): void;
  getCronJob(id: string): CronJob | null;
  deleteCronJob(id: string): boolean;
  listCronJobs(): CronJob[];
  toggleCronJob(id: string, enabled: boolean): boolean;
}

interface NotesData {
  [key: string]: { value: string; updated_at: number };
}

interface MessagesData {
  messages: Memory[];
  nextId: number;
}

interface CronJobsData {
  [id: string]: CronJob;
}

class JSONMemory implements MemoryStore {
  private messagesPath: string;
  private notesPath: string;
  private cronPath: string;
  private messagesData: MessagesData;
  private notesData: NotesData;
  private cronData: CronJobsData;

  constructor(basePath: string) {
    const dir = dirname(basePath);
    if (dir && dir !== "." && dir !== ":") {
      mkdirSync(dir, { recursive: true });
    }

    this.messagesPath = join(dir, "messages.json");
    this.notesPath = join(dir, "notes.json");
    this.cronPath = join(dir, "cron.json");

    this.messagesData = this.loadJson(this.messagesPath, { messages: [], nextId: 1 });
    this.notesData = this.loadJson(this.notesPath, {});
    this.cronData = this.loadJson(this.cronPath, {});
  }

  private loadJson<T>(path: string, defaults: T): T {
    try {
      if (existsSync(path)) {
        return JSON.parse(readFileSync(path, "utf-8")) as T;
      }
    } catch {}
    return defaults;
  }

  private saveMessages() {
    try {
      writeFileSync(this.messagesPath, JSON.stringify(this.messagesData, null, 2), "utf-8");
    } catch (err) {
      console.error("[Memory] Failed to save messages:", err);
    }
  }

  private saveNotes() {
    try {
      writeFileSync(this.notesPath, JSON.stringify(this.notesData, null, 2), "utf-8");
    } catch (err) {
      console.error("[Memory] Failed to save notes:", err);
    }
  }

  save(role: Memory["role"], content: string, channel: string, userId: string) {
    this.messagesData.messages.push({
      id: this.messagesData.nextId++,
      role,
      content,
      channel,
      user_id: userId,
      timestamp: Date.now()
    });
    this.saveMessages();
  }

  recall(channel: string, userId: string, limit = 20): Memory[] {
    return this.messagesData.messages
      .filter((m) => m.channel === channel && m.user_id === userId)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  search(
    query: string,
    options: { channel?: string; userId?: string; limit?: number } = {}
  ): Memory[] {
    const q = query.toLowerCase();
    let results = this.messagesData.messages.filter(
      (m) => m.content.toLowerCase().includes(q) || m.role.toLowerCase().includes(q)
    );

    if (options.channel) {
      results = results.filter((m) => m.channel === options.channel);
    }
    if (options.userId) {
      results = results.filter((m) => m.user_id === options.userId);
    }

    return results.sort((a, b) => b.timestamp - a.timestamp).slice(0, options.limit ?? 5);
  }

  clear(channel: string, userId: string) {
    this.messagesData.messages = this.messagesData.messages.filter(
      (m) => !(m.channel === channel && m.user_id === userId)
    );
    this.saveMessages();
  }

  saveNote(key: string, value: string) {
    this.notesData[key] = { value, updated_at: Date.now() };
    this.saveNotes();
  }

  getNote(key: string): string | null {
    return this.notesData[key]?.value ?? null;
  }

  deleteNote(key: string): boolean {
    if (key in this.notesData) {
      delete this.notesData[key];
      this.saveNotes();
      return true;
    }
    return false;
  }

  listNotes(): { key: string; value: string; updated_at: number }[] {
    return Object.entries(this.notesData)
      .map(([key, data]) => ({ key, ...data }))
      .sort((a, b) => b.updated_at - a.updated_at);
  }

  searchNotes(query: string, limit = 5): { key: string; value: string; updated_at: number }[] {
    const q = query.toLowerCase();
    return Object.entries(this.notesData)
      .filter(
        ([key, data]) => key.toLowerCase().includes(q) || data.value.toLowerCase().includes(q)
      )
      .map(([key, data]) => ({ key, ...data }))
      .sort((a, b) => b.updated_at - a.updated_at)
      .slice(0, limit);
  }

  saveCronJob(job: CronJob): void {
    this.cronData[job.id] = { ...job, enabled: job.enabled ?? true };
    this.saveCron();
  }

  getCronJob(id: string): CronJob | null {
    return this.cronData[id] || null;
  }

  deleteCronJob(id: string): boolean {
    if (this.cronData[id]) {
      delete this.cronData[id];
      this.saveCron();
      return true;
    }
    return false;
  }

  listCronJobs(): CronJob[] {
    return Object.values(this.cronData);
  }

  toggleCronJob(id: string, enabled: boolean): boolean {
    if (this.cronData[id]) {
      this.cronData[id].enabled = enabled;
      this.saveCron();
      return true;
    }
    return false;
  }

  private saveCron() {
    try {
      writeFileSync(this.cronPath, JSON.stringify(this.cronData, null, 2), "utf-8");
    } catch (err) {
      console.error("[Memory] Failed to save cron:", err);
    }
  }
}

class NoopMemory implements MemoryStore {
  save() {}
  recall(): Memory[] {
    return [];
  }
  search(
    _query: string,
    _options?: { channel?: string; userId?: string; limit?: number }
  ): Memory[] {
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
  searchNotes(
    _query: string,
    _limit?: number
  ): { key: string; value: string; updated_at: number }[] {
    return [];
  }
  saveCronJob(_job: CronJob): void {}
  getCronJob(_id: string): CronJob | null {
    return null;
  }
  deleteCronJob(_id: string): boolean {
    return false;
  }
  listCronJobs(): CronJob[] {
    return [];
  }
  toggleCronJob(_id: string, _enabled: boolean): boolean {
    return false;
  }
}

export function createMemory(config: Config): MemoryStore {
  if (config.memory.backend === "sqlite" || config.memory.backend === "json") {
    return new JSONMemory(config.memory.path);
  }
  return new NoopMemory();
}
