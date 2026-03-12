import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import type { Config } from "./config";

export interface SessionMessage {
  role: "user" | "assistant";
  content: string;
  ts: number;
}

export interface SessionData {
  channel: string;
  userId: string;
  createdAt: number;
  updatedAt: number;
  summary: string;
  messages: SessionMessage[];
}

export class SessionStore {
  private data: SessionData;
  private filePath: string;

  constructor(config: Config, channel: string, userId: string) {
    const sessionsDir = join(dirname(config.memory.path), "sessions");
    mkdirSync(sessionsDir, { recursive: true });

    const safeChannel = channel.replace(/[^a-zA-Z0-9_-]/g, "_");
    const safeUserId = userId.replace(/[^a-zA-Z0-9_-]/g, "_");
    this.filePath = join(sessionsDir, `${safeChannel}_${safeUserId}.json`);

    if (existsSync(this.filePath)) {
      try {
        const raw = readFileSync(this.filePath, "utf-8");
        this.data = JSON.parse(raw) as SessionData;
      } catch {
        this.data = this.createEmpty(channel, userId);
      }
    } else {
      this.data = this.createEmpty(channel, userId);
    }
  }

  private createEmpty(channel: string, userId: string): SessionData {
    return {
      channel,
      userId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      summary: "",
      messages: []
    };
  }

  addMessage(role: "user" | "assistant", content: string): void {
    this.data.messages.push({ role, content, ts: Date.now() });
    this.data.updatedAt = Date.now();
    this.save();
  }

  getMessages(limit = 15): SessionMessage[] {
    return this.data.messages.slice(-limit);
  }

  getAllMessages(): SessionMessage[] {
    return [...this.data.messages];
  }

  getSummary(): string {
    return this.data.summary;
  }

  setSummary(text: string): void {
    this.data.summary = text;
    this.data.updatedAt = Date.now();
    this.save();
  }

  /**
   * Remove old messages from the session, keeping only the last `keepLast`.
   * Call this after updating the summary via LLM compression.
   */
  trimMessages(keepLast: number): void {
    if (this.data.messages.length > keepLast) {
      this.data.messages = this.data.messages.slice(-keepLast);
    }
    this.data.updatedAt = Date.now();
    this.save();
  }

  /** Reset the session to start fresh */
  clear(): void {
    this.data = this.createEmpty(this.data.channel, this.data.userId);
    this.save();
  }

  getMessageCount(): number {
    return this.data.messages.length;
  }

  getUpdatedAt(): number {
    return this.data.updatedAt;
  }

  save(): void {
    try {
      writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), "utf-8");
    } catch (err) {
      console.error(`[Session] Failed to save session: ${err}`);
    }
  }
}
