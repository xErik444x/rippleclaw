import type { Config } from "./config";
import type { MemoryStore } from "./memory";
import { SessionStore } from "./session";
import { chat, parseToolCalls, type Message, type Tool } from "../providers/base";
import { logToolEvent } from "./logger";
import { Semaphore } from "./semaphore";
import { existsSync, readdirSync, readFileSync } from "fs";
import { dirname, join } from "path";
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
import { createEmailTool } from "../tools/email";
import type { EmailSender } from "./email";

const SYSTEM_PROMPT = `You are RippleClaw, a fast and autonomous AI agent running on a low-power ARM device (Orange Pi Lite).
You have access to tools: shell execution, file read/write, web search, weather lookup, summarize, persistent memory notes, and environment/config management.
Be concise. When asked to do something, do it — don't just explain how.
Always use tools when they would help accomplish the task. Use web_search for up-to-date or external info. Use weather for weather requests. Use summarize for URL/file/video summaries or transcripts.
You remember previous conversations via your session context and memory notes.
Do not call env/shell/file unless the user explicitly asks about OS, cwd, workspace, config, or files.
When asked about configuration, settings, or what can be modified, ALWAYS use action="get" with include=["config"] in the env tool to see the real state before answering.
If you call env, use action="get" to read or action="set" to update configuration. Use dot-notation for config paths (e.g., tools.web.provider) or process.env.KEY for env vars.

You can create and use **project-specific skills and runtime tools**:
- **Skills index:** A short index of project skills is included below. If the user asks for a workflow or feature, check that index first; when a skill matches, use the file tool with action="read" and the skill path from the index to load the full instructions before acting. Do not invent the workflow if a skill already covers it.
- **Runtime tools (binario/producción):** The folder where you can create and run your own scripts is the same as the memory backend: get it with env action="get" include=["config"] and read config.memory.path; the runtime dir is its parent (e.g. if path is /home/user/.rippleclaw/memory.json, runtime dir is /home/user/.rippleclaw). Create scripts there under a "tools" subfolder (e.g. .rippleclaw/tools/mi-check.cjs) with the file tool, then run them with shell (e.g. node /path/to/.rippleclaw/tools/mi-check.cjs). Before creating a new script, use file action="list" on that tools folder to see what already exists.
- **Scheduling:** Use the cron tool to schedule recurring runs; in the prompt describe the exact shell command (including the full path to the .cjs script) so that when the job runs, it executes that command.

**TASK LIST RULE (mandatory for any non-trivial request):** Before doing any task requested by the user, you MUST first output a numbered task list, then execute the tasks one by one. Do NOT send any final reply or summary to the user until ALL tasks in the list are completed. Use this format for the task list:
TASK_LIST
1. First step
2. Second step
3. etc
END_TASK_LIST
Then execute each task in order (using tools as needed). Only when every task is done, write your final reply to the user.`;

let cachedSkillDocs: string | null = null;
let cachedSkillKey: string = "";

function loadProjectSkills(config: Config): string {
  const runtimeDir = config.memory?.path ? dirname(config.memory.path) : "";
  const cacheKey = runtimeDir;
  if (cachedSkillDocs !== null && cachedSkillKey === cacheKey) return cachedSkillDocs;

  type SkillIndexItem = { name: string; path: string; summary: string };
  const items: SkillIndexItem[] = [];

  const tryLoadDir = (base: string) => {
    if (!base || !existsSync(base)) return;
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
          try {
            const content = readFileSync(full, "utf-8").trim();
            if (!content) continue;
            const lines = content.split(/\r?\n/).map((l) => l.trim());
            const titleLine =
              lines.find((l) => l.startsWith("#")) || lines.find((l) => l.length > 0) || "";
            const summaryLine =
              lines.find(
                (l) =>
                  l.length > 0 &&
                  !l.startsWith("---") &&
                  !l.toLowerCase().startsWith("name:") &&
                  !l.toLowerCase().startsWith("description:")
              ) || "";
            const relName = full.replace(/^[A-Z]:/i, "").replace(/\\/g, "/");
            const name = relName.split("/").slice(-2).join("/");
            const summary =
              (titleLine ? `${titleLine.replace(/^#+\s*/, "")}. ` : "") +
              summaryLine.replace(/^[-*]\s*/, "");

            items.push({
              name,
              path: full,
              summary: summary.slice(0, 200)
            });
          } catch {
            // ignore read errors for individual files
          }
        }
      }
    };
    walk(base);
  };

  // 1) Runtime/config folder (e.g. .rippleclaw/skills) — skills added by user or agent in production
  if (runtimeDir) {
    tryLoadDir(join(runtimeDir, "skills"));
  }

  // 2) Bundled assets: from dist/ or pkg snapshot, assets are at ../src/skills (package.json "assets": "src/skills/**/*.md")
  const bundledSkills = join(__dirname, "../src/skills");
  tryLoadDir(bundledSkills);

  // 3) Dev fallback: run from repo root (tsx/node dist/daemon.js)
  tryLoadDir(join(process.cwd(), "src/skills"));

  if (!items.length) {
    cachedSkillDocs = "";
    cachedSkillKey = cacheKey;
    return "";
  }

  const indexLines = items.map(
    (it) => `- ${it.name}: ${it.summary} (file: ${it.path})`
  );

  cachedSkillDocs =
    "\n\n# Project Skills Index\n\n" +
    "These are project-defined skills. When relevant, use the file tool to open the corresponding markdown for full instructions instead of reinventing the workflow.\n\n" +
    indexLines.join("\n");
  cachedSkillKey = cacheKey;

  return cachedSkillDocs;
}

export interface AgentContext {
  channel: string;
  userId: string;
  userName?: string;
}

export interface AgentResponse {
  content: string;
  metadata?: {
    telegram?: {
      reply_markup?: unknown;
    };
  };
}

export class Agent {
  private static toolSemaphore: Semaphore | null = null;
  private config: Config;
  private memory: MemoryStore;
  private tools: {
    definition: Tool;
    execute: (args: Record<string, unknown>) => Promise<string>;
  }[];

  constructor(config: Config, memory: MemoryStore, emailSender: EmailSender) {
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
    const emailTool = createEmailTool(emailSender);

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
        execute: (args) =>
          envTool.execute(
            args as {
              action: "get" | "set";
              include?: ("os" | "cwd" | "workspace" | "config")[];
              path?: string;
              value?: unknown;
            }
          )
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
      },
      {
        definition: emailTool.definition,
        execute: (args) => emailTool.execute(args as Record<string, unknown>)
      }
    ];
  }

  /** Clear the session for a given context (used by /newsession command) */
  clearSession(ctx: AgentContext): void {
    const session = new SessionStore(this.config, ctx.channel, ctx.userId);
    session.clear();
  }

  async run(input: string, ctx: AgentContext): Promise<AgentResponse> {
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
      return { content: "Listo, inicié una sesión nueva. El contexto anterior fue limpiado." };
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
      /(sistema operativo|os\b|windows|linux|mac|cwd|workspace|carpeta|directorio|config|configuraci[oó]n|ajustes|settings|variable|env\b)/i.test(
        input
      );
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
        return { content: response };
      }
    }
    if (nickChangeMatch && nickChangeMatch[1]) {
      const newNick = sanitizeCapturedName(nickChangeMatch[1]);
      if (newNick) {
        this.memory.saveNote("nickname", newNick);
        const response = `Listo. Me llamo ${newNick}.`;
        session.addMessage("assistant", response);
        return { content: response };
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
      return { content: response };
    }

    if (asksAgentName) {
      const nick = this.memory.getNote("nickname");
      const response = nick ? `Me llamo ${nick}.` : "Me llamo RippleClaw.";
      session.addMessage("assistant", response);
      return { content: response };
    }

    if (asksAboutSession) {
      const sessionCount = session.getMessageCount();
      const response =
        sessionCount > 0
          ? `Sí, puedo reiniciar la sesión. ¿Quieres que lo haga ahora? (El contexto actual tiene ${sessionCount} mensajes)`
          : "La sesión ya está limpia. ¿Algo más en lo que te pueda ayudar?";
      session.addMessage("assistant", response);
      return {
        content: response,
        metadata: {
          telegram: {
            reply_markup: {
              inline_keyboard: [[{ text: "🗑️ Reiniciar Sesión", callback_data: "newsession" }]]
            }
          }
        }
      };
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
- Use env tool with action="get" to read full config or runtime info.
- Use env tool with action="set" to change config or environment variables.
- Never guess OS/cwd/workspace/config. Use env tool or runtime info above.
- On OS/cwd/workspace/config questions, answer from env/shell or runtime info.
- Do not invoke env/shell/file on greetings or generic chat.
- Task list: Do not send any reply to the user until ALL tasks are completed. If there are tasks left, call tools for the next task instead of replying with text.`;

    const estimateTokens = (text: string) => Math.ceil(text.length / 4);
    const estimateMessages = (msgs: Message[]) =>
      msgs.reduce((sum, m) => sum + estimateTokens(m.content), 0);

    const buildMessages = (history: Message[], includeInput: boolean) => {
      const summaryBlock = summary ? `Resumen previo:\n${summary}\n` : "";
      const skillsBlock = loadProjectSkills(this.config);
      const systemContent = `${SYSTEM_PROMPT}\n\n${runtimeInfo}${skillsBlock ? `\n\n${skillsBlock}` : ""}\n\n${summaryBlock}`.trim();
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
      return {
        content: response,
        metadata: {
          telegram: {
            reply_markup: {
              inline_keyboard: [
                [
                  { text: "🧹 Comprimir", callback_data: "compress" },
                  { text: "🔄 Reset", callback_data: "newsession" }
                ]
              ]
            }
          }
        }
      };
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
        return { content: response };
      }
    }

    // Agentic loop: run until the model returns a final reply (no tool calls). Do not return to user until then.
    const maxLoopIterations = 20;
    const maxContextMessages = 25; // system + last N messages to avoid token overflow
    let finalResponse = "";
    const loopMessages = [...messages];
    let lastResponseContent = "";
    let hadToolCalls = false;
    let hadEnvToolCall = false;
    let lastToolResults: string[] = [];

    const trimLoopMessages = (msgs: Message[]): Message[] => {
      if (msgs.length <= maxContextMessages) return msgs;
      const system = msgs[0];
      const rest = msgs.slice(1);
      const tail = rest.slice(-(maxContextMessages - 1));
      return [system, ...tail];
    };

    const toolsConfig = this.config.tools;
    const allowTools =
      toolsConfig?.shell?.enabled ||
      toolsConfig?.file?.enabled ||
      toolsConfig?.web?.enabled ||
      toolsConfig?.weather?.enabled ||
      toolsConfig?.summarize?.enabled;
    const enabledToolNames = new Set<string>([
      ...(toolsConfig?.shell?.enabled ? ["shell"] : []),
      ...(toolsConfig?.file?.enabled ? ["file"] : []),
      ...(toolsConfig?.web?.enabled ? ["web_search"] : []),
      ...(toolsConfig?.weather?.enabled ? ["weather"] : []),
      ...(toolsConfig?.summarize?.enabled ? ["summarize"] : []),
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

    for (let i = 0; i < maxLoopIterations; i++) {
      const toolDefs = wantsEnv ? baseDefs : baseDefs.filter((d) => d.name !== "env");
      const toSend = trimLoopMessages(loopMessages);

      let response: Awaited<ReturnType<typeof chat>>;
      try {
        response = await chat(this.config, toSend, {
          tools: toolDefs.length ? toolDefs : undefined
        });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        finalResponse = `Error al llamar al modelo: ${errMsg}. Intenta de nuevo.`;
        break;
      }

      lastResponseContent = response.content;
      const toolCalls = parseToolCalls(response.content);

      if (!toolCalls || toolCalls.length === 0) {
        // Final text response (empty array from parseToolCalls counts as "no tools")
        finalResponse = response.content?.trim() || lastResponseContent;
        break;
      }
      hadToolCalls = true;

      // Execute tool calls
      const toolResults: string[] = [];
      for (const call of toolCalls) {
        if (call.name === "env") hadEnvToolCall = true;
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
      try {
        const toSend = trimLoopMessages(loopMessages);
        const final = await chat(this.config, toSend);
        finalResponse = final.content?.trim() || "";
        lastResponseContent = final.content || lastResponseContent;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        finalResponse = `Error al obtener respuesta final: ${errMsg}. Resultados de las últimas herramientas:\n${lastToolResults.join("\n")}`;
      }
    }

    const toolFallback = lastToolResults.length
      ? `Tool results:\n${lastToolResults.join("\n")}`
      : "";

    if (!finalResponse)
      finalResponse = lastResponseContent || toolFallback || "Completé las acciones solicitadas.";

    // Only replace with raw tool results when the model returned a placeholder, not a real reply
    const isPlaceholderReply =
      finalResponse.startsWith("Calling tools:") ||
      finalResponse === "I completed the requested actions." ||
      finalResponse === "Completé las acciones solicitadas.";
    if (toolFallback && isPlaceholderReply) {
      finalResponse = toolFallback;
    }

    // Special metadata for certain tool results
    let metadata: AgentResponse["metadata"] = undefined;
    if (hadEnvToolCall || finalResponse.includes("[env]: config=")) {
      metadata = {
        telegram: {
          reply_markup: {
            inline_keyboard: [[{ text: "⚙️ Editar Configuración", callback_data: "edit_config" }]]
          }
        }
      };
    }

    // Always save assistant response to session
    session.addMessage("assistant", finalResponse);

    return { content: finalResponse, metadata };
  }
}
