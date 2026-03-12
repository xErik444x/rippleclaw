import type { Config } from "./config";
import type { MemoryStore } from "./memory";
import { chat, parseToolCalls, type Message, type Tool } from "../providers/base";
import { logToolEvent } from "./logger";
import {
  createShellTool,
  createFileTool,
  createMemoryTool,
  createModelTool,
  createEnvTool
} from "../tools/index";

const SYSTEM_PROMPT = `You are RippleClaw, a fast and autonomous AI agent running on a low-power ARM device (Orange Pi Lite).
You have access to tools: shell execution, file read/write, and persistent memory notes.
Be concise. When asked to do something, do it — don't just explain how.
Always use tools when they would help accomplish the task.
You remember previous conversations via your memory system.
Do not call env/shell/file unless the user explicitly asks about OS, cwd, workspace, or files. If you call env, include all returned fields in the reply.`;

export interface AgentContext {
  channel: string;
  userId: string;
  userName?: string;
}

export class Agent {
  private config: Config;
  private memory: MemoryStore;
  private tools: {
    definition: Tool;
    execute: (args: Record<string, unknown>) => Promise<string>;
  }[];

  constructor(config: Config, memory: MemoryStore) {
    this.config = config;
    this.memory = memory;

    const shellTool = createShellTool(config);
    const fileTool = createFileTool(config);
    const memoryTool = createMemoryTool(memory);
    const modelTool = createModelTool(config);
    const envTool = createEnvTool(config);

    this.tools = [
      {
        definition: shellTool.definition,
        execute: (args) => shellTool.execute(args as { command: string; cwd?: string })
      },
      {
        definition: fileTool.definition,
        execute: (args) =>
          fileTool.execute(args as { action: "read" | "write" | "list"; path: string; content?: string })
      },
      {
        definition: memoryTool.definition,
        execute: (args) => memoryTool.execute(args as { action: "save" | "get"; key: string; value?: string })
      },
      {
        definition: modelTool.definition,
        execute: (args) => modelTool.execute(args as { provider?: string; model: string })
      },
      {
        definition: envTool.definition,
        execute: (args) =>
          envTool.execute(args as { include?: ("os" | "cwd" | "workspace")[] })
      }
    ];
  }

  async run(input: string, ctx: AgentContext): Promise<string> {
    const lower = input.toLowerCase();
    const asksUserName = /como me llamo|mi nombre|cómo me llamo/.test(lower);
    const asksAgentName = /como te llamas|cómo te llamas|tu nombre/.test(lower);
    const isStatusCommand = /^\/?status\b/i.test(input.trim());
    const isCompressCommand = /^\/?compress\b/i.test(input.trim());
    const wantsCompress =
      /(comprime|compacta|resume|resum[ií]r|resumen|sintetiza|sintetiz[aá]|summary|summarize)/i.test(
        input
      ) || isCompressCommand;
    const wantsEnv =
      /(sistema operativo|os\b|windows|linux|mac|cwd|workspace|carpeta|directorio)/i.test(input);
    const nameChangeMatch =
      input.match(/(?:cambia(?:me)?|cambiame|quiero que cambies?)\s+mi\s+nombre\s+a\s+(.+)/i) ||
      input.match(/(?:mi\s+nombre\s+es|soy)\s+(.+)/i);
    const nickChangeMatch =
      input.match(/(?:cambia(?:me)?|cambiame|quiero que te llames?)\s+(.+)/i) ||
      input.match(/(?:tu\s+nombre\s+es|te\s+llamas)\s+(.+)/i);
    if (nameChangeMatch && nameChangeMatch[1]) {
      const newName = nameChangeMatch[1].trim().replace(/[.!?]+$/, "");
      if (newName) {
        this.memory.saveNote("name", newName);
        return `Guardé esto en memoria, será útil a futuro. (key: "name")\nTu nombre es ${newName}.`;
      }
    }
    if (nickChangeMatch && nickChangeMatch[1]) {
      const newNick = nickChangeMatch[1].trim().replace(/[.!?]+$/, "");
      if (newNick) {
        this.memory.saveNote("nickname", newNick);
        return `Listo. Me llamo ${newNick}.`;
      }
    }

    if (asksUserName) {
      const fromNotes =
        this.memory.getNote("name") || this.memory.getNote("user_name") || this.memory.getNote("username");
      const userName = fromNotes || ctx.userName || ctx.userId;
      return userName ? `Tu nombre es ${userName}.` : "No tengo tu nombre guardado.";
    }

    if (asksAgentName) {
      const nick = this.memory.getNote("nickname");
      return nick ? `Me llamo ${nick}.` : "Me llamo RippleClaw.";
    }

    const isCompressOnly = wantsCompress && (isCompressCommand || input.trim().length <= 40);

    const contextCfg = this.config.context || { max_tokens: 16000, compress_threshold: 0.85 };
    const threshold = Math.floor(contextCfg.max_tokens * (contextCfg.compress_threshold || 0.85));
    const summaryKey = `context_summary:${ctx.channel}:${ctx.userId}`;
    let summary = this.memory.getNote(summaryKey);

    const recallAll = this.memory.recall(ctx.channel, ctx.userId, 50).reverse();
    const recallRecent = this.memory.recall(ctx.channel, ctx.userId, 15).reverse();

    const runtimeInfo = `Runtime:
os=${process.platform === "win32" ? "Windows" : process.platform === "darwin" ? "macOS" : "Linux"}
cwd=${process.cwd()}
workspace=${this.config.workspace}
Rules:
- Never guess OS/cwd/workspace. Use env tool or runtime info above.
- On OS/cwd/workspace questions, answer from env/shell or runtime info.
- Do not invoke env/shell/file on greetings or generic chat.`;

    const estimateTokens = (text: string) => Math.ceil(text.length / 4);
    const estimateMessages = (msgs: Message[]) =>
      msgs.reduce((sum, m) => sum + estimateTokens(m.content), 0);

    const buildMessages = (history: Message[], includeInput: boolean) => {
      const summaryBlock = summary ? `Resumen previo:\n${summary}\n` : "";
      const systemContent = `${SYSTEM_PROMPT}\n\n${runtimeInfo}\n\n${summaryBlock}`.trim();
      const base: Message[] = [{ role: "system", content: systemContent }, ...history];
      if (includeInput) base.push({ role: "user", content: input });
      return base;
    };

    const historyMessages = recallRecent.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content
    }));

    let messages = buildMessages(historyMessages, true);
    const estimated = estimateMessages(messages);
    const estimatedWithoutInput = estimateMessages(buildMessages(historyMessages, false));

    if (isStatusCommand) {
      return [
        `Modelo actual: ${this.config.default_provider} / ${this.config.default_model}`,
        `Contexto estimado: ~${estimatedWithoutInput} tokens`,
        `Max contexto: ${contextCfg.max_tokens} (threshold ~${threshold})`
      ].join("\n");
    }

    const shouldCompress = wantsCompress || estimated >= threshold;
    if (shouldCompress && recallAll.length > 0) {
      try {
        const convo = recallAll
          .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
          .join("\n");
        const summarizePrompt = [
          summary ? `Resumen anterior:\n${summary}` : "",
          "Resume la conversación en español, conservando hechos, preferencias, tareas y decisiones.",
          "Máximo 400 palabras.",
          "Conversación:",
          convo
        ]
          .filter(Boolean)
          .join("\n\n");

        const summaryResp = await chat(
          this.config,
          [
            {
              role: "system",
              content: "Eres un asistente que resume conversaciones de forma concisa."
            },
            { role: "user", content: summarizePrompt }
          ],
          { tools: undefined }
        );
        summary = summaryResp.content.trim() || summary || "";
        if (summary) this.memory.saveNote(summaryKey, summary);
      } catch {
        // Keep previous summary if summarization fails
      }

      const tail = recallRecent.slice(-6).map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content
      }));
      messages = buildMessages(tail, true);

      if (isCompressOnly) {
        return "Listo, comprimí el contexto.";
      }
    }
    const memoryIntent = /(?:recorda|recuerda|guarda|guardar|memoriz|anota|nota|remember|save|note)/i.test(
      input
    );
    const shouldAutoSave = this.config.memory.auto_save && memoryIntent;

    // Save user message
    if (shouldAutoSave) {
      this.memory.save("user", input, ctx.channel, ctx.userId);
      console.log("Guardé esto en memoria, será útil a futuro.");
    }

    // Build conversation history
    // Agentic loop: up to 5 tool call iterations
    let finalResponse = "";
    const loopMessages = [...messages];
    let lastResponseContent = "";
    let hadToolCalls = false;
    let lastToolResults: string[] = [];

    for (let i = 0; i < 5; i++) {
      const allowTools = this.config.tools.shell.enabled || this.config.tools.file.enabled;
      const baseDefs = allowTools
        ? this.tools.map((t) => t.definition)
        : this.tools
            .filter((t) => t.definition.name === "model" || t.definition.name === "env")
            .map((t) => t.definition);
      const toolDefs = wantsEnv ? baseDefs : baseDefs.filter((d) => d.name !== "env");

      const response = await chat(this.config, loopMessages, {
        tools: toolDefs.length ? toolDefs : undefined
      });

      lastResponseContent = response.content;
      const toolCalls = parseToolCalls(response.content);

      if (!toolCalls) {
        // Final text response
        finalResponse = response.content;
        break;
      }
      hadToolCalls = true;

      // Execute tool calls
      const toolResults: string[] = [];
      for (const call of toolCalls) {
        const tool = this.tools.find((t) => t.definition.name === call.name);
        if (!tool) {
          toolResults.push(`Unknown tool: ${call.name}`);
          continue;
        }
        try {
          console.log(`[RippleClaw] 🔧 Tool: ${call.name}`, call.arguments);
          const result = await tool.execute(call.arguments as Record<string, unknown>);
          toolResults.push(`[${call.name}]: ${result}`);
          logToolEvent(this.config, ctx, {
            tool: call.name,
            args: call.arguments as Record<string, unknown>,
            result,
            ok: true
          });
        } catch (err) {
          const msg = String(err);
          toolResults.push(`[${call.name}] Error: ${msg}`);
          logToolEvent(this.config, ctx, {
            tool: call.name,
            args: call.arguments as Record<string, unknown>,
            result: msg,
            ok: false
          });
        }
      }
      lastToolResults = toolResults;

      // Feed tool results back into the loop
      loopMessages.push(
        { role: "assistant", content: `Calling tools: ${toolCalls.map((t) => t.name).join(", ")}` },
        { role: "user", content: `Tool results:\n${toolResults.join("\n")}` }
      );
    }

    if (!finalResponse && hadToolCalls) {
      const final = await chat(this.config, loopMessages);
      finalResponse = final.content;
      lastResponseContent = final.content || lastResponseContent;
    }

    const toolFallback = lastToolResults.length ? `Tool results:\n${lastToolResults.join("\n")}` : "";

    if (!finalResponse) finalResponse = lastResponseContent || toolFallback || "I completed the requested actions.";

    if (
      toolFallback &&
      (finalResponse.startsWith("Calling tools:") || finalResponse === "I completed the requested actions.")
    ) {
      finalResponse = toolFallback;
    }

    // Save assistant response
    if (shouldAutoSave) {
      this.memory.save("assistant", finalResponse, ctx.channel, ctx.userId);
      console.log("Guardé esto en memoria, será útil a futuro.");
    }

    return finalResponse;
  }
}
