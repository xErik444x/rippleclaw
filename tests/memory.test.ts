import { describe, expect, it, beforeEach } from "vitest";
import { createMemory } from "../src/core/memory";
import type { Config } from "../src/core/config";
import { join } from "path";
import { rmSync, mkdirSync } from "fs";

const testDir = join(__dirname, "..", ".test-data");

function makeConfig(name: string): Config {
  return {
    name: "RippleClaw",
    version: "0.1.0",
    workspace: ".",
    default_provider: "openai",
    default_model: "gpt-4o",
    autonomy: "full",
    providers: [
      { name: "openai", api_base: "https://api.openai.com/v1", api_key: "x", models: ["gpt-4o"] }
    ],
    channels: {
      telegram: { enabled: false, token: "", allowed_users: [] },
      discord: { enabled: false, token: "", allowed_users: [] },
      cli: { enabled: false }
    },
    memory: { backend: "json", path: join(testDir, `${name}.json`), auto_save: false },
    tools: {
      shell: { enabled: false, allowed_commands: [], workspace_only: true },
      file: { enabled: false, workspace_only: true },
      web: { enabled: false },
      weather: { enabled: false },
      summarize: { enabled: false }
    },
    cron: { enabled: false, jobs: [] }
  };
}

describe("JSONMemory", () => {
  beforeEach(() => {
    rmSync(testDir, { recursive: true, force: true });
    mkdirSync(testDir, { recursive: true });
  });

  it("saves and retrieves notes", () => {
    const memory = createMemory(makeConfig("notes"));
    memory.saveNote("key", "value");
    expect(memory.getNote("key")).toBe("value");
  });

  it("stores and recalls messages", () => {
    const memory = createMemory(makeConfig("messages"));
    memory.save("user", "hello", "cli", "u1");
    const items = memory.recall("cli", "u1", 5);
    expect(items.length).toBe(1);
    expect(items[0].content).toBe("hello");
  });
});
