import { describe, expect, it } from "vitest";
import { createMemory } from "../src/core/memory";
import type { Config } from "../src/core/config";

function makeConfig(): Config {
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
    memory: { backend: "sqlite", path: ":memory:", auto_save: false },
    tools: {
      shell: { enabled: false, allowed_commands: [], workspace_only: true },
      file: { enabled: false, workspace_only: true }
    },
    cron: { enabled: false, jobs: [] }
  };
}

describe("SQLiteMemory", () => {
  it("saves and retrieves notes", () => {
    const memory = createMemory(makeConfig());
    memory.saveNote("key", "value");
    expect(memory.getNote("key")).toBe("value");
  });

  it("stores and recalls messages", () => {
    const memory = createMemory(makeConfig());
    memory.save("user", "hello", "cli", "u1");
    const items = memory.recall("cli", "u1", 5);
    expect(items.length).toBe(1);
    expect(items[0].content).toBe("hello");
  });
});
