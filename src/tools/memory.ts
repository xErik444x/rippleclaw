import type { Tool } from "../providers/base";

export function createMemoryTool(memory: import("../core/memory").MemoryStore) {
  return {
    definition: {
      name: "remember",
      description: "Save or retrieve a note from persistent memory",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["save", "get"], description: "save or get a note" },
          key: { type: "string", description: "Note key/name" },
          value: { type: "string", description: "Note value (only for save)" }
        },
        required: ["action", "key"]
      }
    } satisfies Tool,

    async execute(args: { action: "save" | "get"; key: string; value?: string }): Promise<string> {
      if (!args || typeof args !== "object") {
        return 'Error: "action" and "key" are required';
      }
      if (typeof args.key !== "string" || !args.key.trim()) {
        return 'Error: "key" must be a non-empty string';
      }
      if (args.action === "save") {
        if (args.value === undefined) return "Error: value required for save";
        memory.saveNote(args.key, args.value);
        return `Guardé esto en memoria, será útil a futuro. (key: "${args.key}")`;
      }
      const val = memory.getNote(args.key);
      return val ? `Note "${args.key}": ${val}` : `No note found for "${args.key}"`;
    }
  };
}
