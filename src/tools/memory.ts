import type { Tool } from "../providers/base";

export function createMemoryTool(memory: import("../core/memory").MemoryStore) {
  return {
    definition: {
      name: "remember",
      description:
        "Save, list, or search persistent notes. Use action=save|get|list|search (key optional for list/search).",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["save", "get", "list", "search", "delete"],
            description: "Action to perform on memory notes"
          },
          key: { type: "string", description: 'Note key/name (or "all" for list)' },
          value: { type: "string", description: "Note value (for save)" },
          query: { type: "string", description: "Search terms for notes" },
          limit: { type: "number", minimum: 1, maximum: 20, description: "Max results for search" }
        },
        required: ["action"]
      }
    } satisfies Tool,

    async execute(args: {
      action: "save" | "get" | "list" | "search" | "delete";
      key?: string;
      value?: string;
      query?: string;
      limit?: number;
    }): Promise<string> {
      if (!args || typeof args !== "object") {
        return 'Error: "action" is required';
      }
      switch (args.action) {
        case "save": {
          if (typeof args.key !== "string" || !args.key.trim()) {
            return 'Error: "key" must be a non-empty string for save';
          }
          if (typeof args.value !== "string") {
            return "Error: \"value\" is required for save";
          }
          const normalizedKey = args.key.trim();
          memory.saveNote(normalizedKey, args.value);
          return `Guardé esto en memoria, será útil a futuro. (key: "${normalizedKey}")`;
        }
        case "get": {
          if (typeof args.key !== "string" || !args.key.trim()) {
            return 'Error: "key" must be a non-empty string for get';
          }
          const normalizedKey = args.key.trim();
          const normalizedQuery = normalizedKey.toLowerCase();
          if (normalizedQuery === "all" || normalizedQuery === "*") {
            const notes = memory.listNotes();
            if (!notes.length) return "No notes found";
            const lines = notes.map((note) => `${note.key}=${note.value}`);
            return `Notes:\n${lines.join("\n")}`;
          }
          const val = memory.getNote(normalizedKey);
          return val ? `Note "${normalizedKey}": ${val}` : `No note found for "${normalizedKey}"`;
        }
        case "list": {
          const notes = memory.listNotes();
          if (!notes.length) return "No notes found";
          const lines = notes.map((note) => `${note.key}=${note.value}`);
          return `Notes:\n${lines.join("\n")}`;
        }
        case "search": {
          if (typeof args.query !== "string" || !args.query.trim()) {
            return 'Error: "query" is required for search';
          }
          const limit = Math.min(Math.max(args.limit || 5, 1), 20);
          const results = memory.searchNotes(args.query, limit);
          if (!results.length) return `No notes match "${args.query}"`;
          const lines = results.map((note) => `${note.key}=${note.value}`);
          return `Matches:\n${lines.join("\n")}`;
        }
        case "delete": {
          if (typeof args.key !== "string" || !args.key.trim()) {
            return 'Error: "key" must be a non-empty string for delete';
          }
          const normalizedKey = args.key.trim();
          const deleted = memory.deleteNote(normalizedKey);
          return deleted
            ? `Nota "${normalizedKey}" eliminada.`
            : `No se encontró nota con key "${normalizedKey}".`;
        }
        default:
          return `Error: Unsupported action "${args.action}"`;
      }
    }
  };
}
