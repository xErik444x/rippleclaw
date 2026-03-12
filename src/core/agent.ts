import type { Config } from "./config";
import type { MemoryStore } from "./memory";
import { SessionStore } from "./session";
import { chat, parseToolCalls, type Message, type Tool } from "../providers/base";
import { logToolEvent } from "./logger";
import { Semaphore } from "./semaphore";
import {
  createShellTool,
  createFileTool,
  createMemoryTool,
  createCronTool,
  createModelTool,
  createEnvTool,
  createWebTool,
  createWeatherTool,
  createSummarizeTool
} from "../tools/index";

const SYSTEM_PROMPT = `You are RippleClaw, a fast and autonomous AI agent running on a low-power ARM device (Orange Pi Lite).
You have access to tools: shell execution, file read/write, web search, weather lookup, summarize, and persistent memory notes.
Be concise. When asked to do something, do it — don't just explain how.
Always use tools when they would help accomplish the task. Use web_search for up-to-date or external info. Use weather for weather requests. Use summarize for URL/file/video summaries or transcripts.
You remember previous conversations via your session context and memory notes.
Do not call env/shell/file unless the user explicitly asks about OS, cwd, workspace, or files. If you call env, include all returned fields in the reply.`;

export interface AgentContext {
  channel: string;
  userId: string;
  userName?: string;
}

export class Agent {
  private static toolSemaphore: Semaphore | null = null;
  private config: Config;
  private memory: MemoryStore;
  private tools: {
    definition: Tool;
    execute: (args: Record<string, unknown>) => Promise<string>;
  }[];

  constructor(config: Config, memory: MemoryStore) {
    this.config = config;
    this.memory = memory;
    if (!Agent.toolSemaphore) {
      const max = config.runtime?.max_tool_concurrency ?? 1;
      Agent.toolSemaphore = new Semaphore(Math.max(1, max));
    }

    const shellTool = createShellTool(config);
    const fileTool = createFileTool(config);
    const memoryTool = createMemoryTool(memory);
    const cronTool = createCronTool(memory);
    const modelTool = createModelTool(config);
    const envTool = createEnvTool(config);
    const webTool = createWebTool(config);
    const weatherTool = createWeatherTool(config);
    const summarizeTool = createSummarizeTool(config);

    this.tools = [
      {
        definition: shellTool.definition,
        execute: (args) => shellTool.execute(args as { command: string; cwd?: string })
      },
      {
        definition: fileTool.definition,
        execute: (args) =>
          fileTool.execute(
            args as { action: "read" | "write" | "list"; path: string; content?: string }
          )
      },
      {
        definition: memoryTool.definition,
        execute: (args) =>
          memoryTool.execute(
            args as {
              action: "save" | "get" | "list" | "search" | "delete";
              key?: string;
              value?: string;
              query?: string;
              limit?: number;
            }
          )
      },
      {
        definition: cronTool.definition,
        execute: (args) =>
          cronTool.execute(
            args as {
              action: "list" | "add" | "delete" | "toggle" | "run";
              id?: string;
              schedule?: string;
              prompt?: string;
              enabled?: boolean;
            }
          )
      },
      {
        definition: modelTool.definition,
        execute: (args) => modelTool.execute(args as { provider?: string; model: string })
      },
      {
        definition: envTool.definition,
        execute: (args) => envTool.execute(args as { include?: ("os" | "cwd" | "workspace")[] })
      },
      {
        definition: webTool.definition,
        execute: (args) => webTool.execute(args as { query: string; max_results?: number })
      },
      {
        definition: weatherTool.definition,
        execute: (args) => weatherTool.execute(args as { location: string })
      },
      {
        definition: summarizeTool.definition,
        execute: (args) =>
          summarizeTool.execute(
            args as {
              target: string;
              model?: string;
              length?: "short" | "medium" | "long" | "xl" | "xxl";
              extract_only?: boolean;
              youtube?: string;
              json?: boolean;
            }
          )
      }
    ];
  }

  /** Clear the session for a given context (used by /newsession command) */
  clearSession(ctx: AgentContext): void {
    const session = new SessionStore(this.config, ctx.channel, ctx.userId);
    session.clear();
  }

  async run(input: string, ctx: AgentContext): Promise<string> {
    const lower = input.toLowerCase();

    // Load session FIRST to ensure all messages are saved
    const session = new SessionStore(this.config, ctx.channel, ctx.userId);
    session.addMessage("user", input);

    // Handle /newsession command
    const isNewSessionCommand =
      /^\/?(newsession|nuevasesion|nuevasesión|nueva\s*sesi[oó]n|reset[eo]|reinici[oa]r?|empezar\s+nuevo|empezar\s+nueva)\b/i.test(
        input.trim()
      );
    if (isNewSessionCommand) {
      session.clear();
      return "Listo, inicié una sesión nueva. El contexto anterior fue limpiado.";
    }

    // Detect session-related questions
    const asksAboutSession =
      /reiniciar?|reset|empezar\s+nuevo|empezar\s+nueva|nueva\s*sesi|cambiar\s*de\s*chat|olvidar?\s*contexto/i.test(
        lower
      );

    const sanitizeCapturedName = (value: string) => {
      return value
        .split(/[,;:]/)[0]
        .replace(
          /\b(?:guardad[oa]|guardalo|guardala|recordad[oa]|recordalo|recordala|recuerda|recorda)\b.*$/i,
          ""
        )
        .trim()
        .replace(/[.!?]+$/, "");
    };

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
      input.match(/(?:quiero|quisiera)\s+que\s+me\s+llames?\s+(.+)/i) ||
      input.match(/(?:mi\s+nombre\s+es|soy)\s+(.+)/i);
    const nickChangeMatch =
      input.match(/(?:cambia(?:me)?|cambiame|quiero que te llames?)\s+(.+)/i) ||
      input.match(/(?:quiero|quisiera)\s+que\s+te\s+llames?\s+(.+)/i) ||
      input.match(/(?:tu\s+nombre\s+es|te\s+llamas)\s+(.+)/i) ||
      input.match(/quiero que cambies tu nombre a\s+(.+)/i);
    if (nameChangeMatch && nameChangeMatch[1]) {
      const newName = sanitizeCapturedName(nameChangeMatch[1]);
      if (newName) {
        this.memory.saveNote("name", newName);
        const response = `Guardé esto en memoria, será útil a futuro. (key: "name")\nTu nombre es ${newName}.`;
        session.addMessage("assistant", response);
        return response;
      }
    }
    if (nickChangeMatch && nickChangeMatch[1]) {
      const newNick = sanitizeCapturedName(nickChangeMatch[1]);
      if (newNick) {
        this.memory.saveNote("nickname", newNick);
        const response = `Listo. Me llamo ${newNick}.`;
        session.addMessage("assistant", response);
        return response;
      }
    }

    if (asksUserName) {
      const fromNotes =
        this.memory.getNote("name") ||
        this.memory.getNote("user_name") ||
        this.memory.getNote("username");
      const userName = fromNotes || ctx.userName || ctx.userId;
      const response = userName ? `Tu nombre es ${userName}.` : "No tengo tu nombre guardado.";
      session.addMessage("assistant", response);
      return response;
    }

    if (asksAgentName) {
      const nick = this.memory.getNote("nickname");
      const response = nick ? `Me llamo ${nick}.` : "Me llamo RippleClaw.";
      session.addMessage("assistant", response);
      return response;
    }

    if (asksAboutSession) {
      const sessionCount = session.getMessageCount();
      const response =
        sessionCount > 0
          ? `Sí, puedo reiniciar la sesión. ¿Quieres que lo haga ahora? (El contexto actual tiene ${sessionCount} mensajes)`
          : "La sesión ya está limpia. ¿Algo más en lo que te pueda ayudar?";
      session.addMessage("assistant", response);
      return response;
    }

    const isCompressOnly = wantsCompress && (isCompressCommand || input.trim().length <= 40);

    const contextCfg = this.config.context || { max_tokens: 16000, compress_threshold: 0.85 };
    const threshold = Math.floor(contextCfg.max_tokens * (contextCfg.compress_threshold || 0.85));
    let summary = session.getSummary();

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

    // Build history from session file
    const sessionRecent = session.getMessages(15);
    const historyMessages: Message[] = sessionRecent.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content
    }));

    let messages = buildMessages(historyMessages, true);
    const estimated = estimateMessages(messages);
    const estimatedWithoutInput = estimateMessages(buildMessages(historyMessages, false));

    if (isStatusCommand) {
      const response = [
        `Modelo actual: ${this.config.default_provider} / ${this.config.default_model}`,
        `Contexto estimado: ~${estimatedWithoutInput} tokens`,
        `Max contexto: ${contextCfg.max_tokens} (threshold ~${threshold})`,
        `Mensajes en sesión: ${session.getMessageCount()}`
      ].join("\n");
      session.addMessage("assistant", response);
      return response;
    }

    // Compression: when tokens exceed threshold or user explicitly requests
    const shouldCompress = wantsCompress || estimated >= threshold;
    if (shouldCompress && session.getMessageCount() > 0) {
      try {
        const allMessages = session.getAllMessages();
        const convo = allMessages.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join("\n");
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
        if (summary) {
          session.setSummary(summary);
          session.trimMessages(6);
        }
      } catch {
        // Keep previous summary if summarization fails
      }

      // Rebuild messages with compressed context
      const tail = session.getMessages(6).map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content
      }));
      messages = buildMessages(tail, true);

      if (isCompressOnly) {
        const msgCount = session.getMessageCount();
        const response =
          msgCount > 6
            ? `Listo, resumí ${msgCount - 6} mensajes en un resumen y dejé los últimos 6.`
            : "Listo, comprimí el contexto.";
        session.addMessage("assistant", response);
        return response;
      }
    }

    // Agentic loop: up to 5 tool call iterations
    let finalResponse = "";
    const loopMessages = [...messages];
    let lastResponseContent = "";
    let hadToolCalls = false;
    let lastToolResults: string[] = [];

    for (let i = 0; i < 5; i++) {
      const allowTools =
        this.config.tools.shell.enabled ||
        this.config.tools.file.enabled ||
        this.config.tools.web?.enabled ||
        this.config.tools.weather?.enabled ||
        this.config.tools.summarize?.enabled;
      const enabledToolNames = new Set<string>([
        ...(this.config.tools.shell.enabled ? ["shell"] : []),
        ...(this.config.tools.file.enabled ? ["file"] : []),
        ...(this.config.tools.web?.enabled ? ["web_search"] : []),
        ...(this.config.tools.weather?.enabled ? ["weather"] : []),
        ...(this.config.tools.summarize?.enabled ? ["summarize"] : []),
        "remember",
        "cron",
        "model",
        "env"
      ]);
      const baseDefs = allowTools
        ? this.tools.filter((t) => enabledToolNames.has(t.definition.name)).map((t) => t.definition)
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
          const release = await Agent.toolSemaphore!.acquire();
          let result = "";
          try {
            result = await tool.execute(call.arguments as Record<string, unknown>);
          } finally {
            release();
          }
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

    const toolFallback = lastToolResults.length
      ? `Tool results:\n${lastToolResults.join("\n")}`
      : "";

    if (!finalResponse)
      finalResponse = lastResponseContent || toolFallback || "I completed the requested actions.";

    if (
      toolFallback &&
      (finalResponse.startsWith("Calling tools:") ||
        finalResponse === "I completed the requested actions.")
    ) {
      finalResponse = toolFallback;
    }

    // Always save assistant response to session
    session.addMessage("assistant", finalResponse);

    return finalResponse;
  }
}
