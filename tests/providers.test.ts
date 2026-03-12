import { describe, expect, it } from "vitest";
import { parseToolCalls } from "../src/providers/base";

describe("parseToolCalls", () => {
  it("parses tool calls when prefix is present", () => {
    const payload = [
      { name: "shell", arguments: { command: "echo hi" } },
      { name: "file", arguments: { action: "read", path: "README.md" } }
    ];
    const content = `__tool_call__:${JSON.stringify(payload)}`;
    expect(parseToolCalls(content)).toEqual(payload);
  });

  it("returns null when no tool call prefix", () => {
    expect(parseToolCalls("hello")).toBeNull();
  });
});
