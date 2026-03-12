# SKILL: RippleClaw - AI Agent Infrastructure

## Identidad del proyecto

RippleClaw es un agente de IA autonomo, rapido y ligero, construido con TypeScript + Node.js, disenado para correr 24/7 en dispositivos de bajo consumo (Orange Pi Lite, Raspberry Pi, SBC ARM). Es el sucesor espiritual de PicoClaw y ZeroClaw, pero completamente propio, extensible y sin dependencias de runtime pesadas.

Version actual: 0.1.0
Hardware objetivo: Orange Pi Lite (Allwinner H3, 512MB-1GB RAM, ARM Cortex-A7)
Runtime: Node.js (SQLite local con better-sqlite3)
Lenguaje: TypeScript estricto
Repositorio local (dev): C:\Users\erik\_\Documents\programacion\RippleClaw
Config activa (orden de carga): ./config.json -> $RIPPLECLAW_CONFIG -> ~/.rippleclaw/config.json

---

## Stack tecnico

| Capa      | Tecnologia                                                | Justificacion                                 |
| --------- | --------------------------------------------------------- | --------------------------------------------- |
| Runtime   | Node.js                                                   | Compatible y estable                          |
| Lenguaje  | TypeScript                                                | Tipado estricto, mantenible                   |
| Memoria   | better-sqlite3 (SQLite + FTS5)                            | Sin dependencias externas, busqueda full-text |
| Channels  | Long polling (Telegram), WebSocket (Discord), stdin (CLI) | Compatible con hardware sin IP publica        |
| Scheduler | node-cron                                                 | Cron jobs autonomos                           |
| Servicio  | systemd                                                   | Daemon persistente en Linux                   |
| Providers | OpenAI-compatible API + Gemini nativo                     | Agnostico de proveedor                        |

---

## Arquitectura de archivos

```
RippleClaw/
├── src/
│   ├── core/
│   │   ├── agent.ts        # Loop agentico principal (tool calling, hasta 5 iteraciones)
│   │   ├── memory.ts       # SQLite: mensajes + FTS5 + notas
│   │   ├── scheduler.ts    # Cron jobs con node-cron
│   │   ├── config.ts       # Carga y tipado de config.json
│   │   └── log-tail.ts     # Tail de logs (tool.log) para modo daemon
│   ├── providers/
│   │   └── base.ts         # Abstraccion LLM: OpenAI-compat + Gemini nativo
│   ├── channels/
│   │   ├── cli.ts          # Terminal interactiva con readline
│   │   ├── cli-setup.ts    # TUI setup (providers/models/workspace/sandbox)
│   │   ├── startup-menu.ts # Menu de inicio (logs/CLI/daemon)
│   │   ├── telegram.ts     # Bot via long polling + allowlist
│   │   └── discord.ts      # Bot via WebSocket + allowlist
│   ├── tools/
│   │   └── index.ts        # shell, file, remember, model
│   └── daemon.ts           # Entry point: flags --channel, --version, --help
├── config.json             # Config principal (providers, channels, tools, cron)
├── package.json            # Dependencias: node-telegram-bot-api, discord.js, node-cron, better-sqlite3
├── rippleclaw.service      # Systemd unit para Orange Pi
└── README.md
```

---

## Modulos implementados

### src/core/agent.ts - Loop agentico

- Clase Agent con metodo run(input, ctx) -> string
- Contexto por canal: { channel, userId, userName? }
- Historial de conversacion: recupera ultimos 15 mensajes del usuario desde SQLite
- Loop de tool calling: hasta 5 iteraciones por request
  - Llama al LLM con tools disponibles
  - Si responde con **tool_call**:..., ejecuta las tools y realimenta el loop
  - Si responde texto plano, devuelve la respuesta final
- Auto-guarda mensajes de usuario y respuestas del asistente en memoria
- System prompt: identidad de RippleClaw + instrucciones de comportamiento
- Nota: las tools solo se inyectan si shell o file estan habilitadas en config (memory tool se incluye junto a ellas)

### src/core/memory.ts - Memoria persistente

Interfaz MemoryStore con dos implementaciones:

SQLiteMemory (backend por defecto):

- Tabla messages: historial por (channel, user_id)
- Tabla virtual messages_fts con FTS5: busqueda full-text
- Trigger automatico para indexar mensajes nuevos en FTS5
- Tabla notes: clave-valor persistente (saveNote / getNote)
- Metodos: save, recall(limit=20), search(query, limit=5), clear, saveNote, getNote

NoopMemory: implementacion vacia para cuando backend = "none"

### src/core/config.ts - Configuracion

- Tipado completo con interfaces Config y ProviderConfig
- Carga desde: config.json local -> RIPPLECLAW_CONFIG -> ~/.rippleclaw/config.json
- Expande ~ en paths automaticamente
- Singleton cacheado: loadConfig() idempotente
- Helper getProvider(config, name?) para obtener provider por nombre

### src/providers/base.ts - Abstraccion LLM

Soporta dos tipos de APIs:

OpenAI-compatible (chatOpenAICompat):

- Cualquier API con /chat/completions (OpenAI, Groq, OpenRouter, etc.)
- Soporte de tool calling (function calling)
- Detecta tool_calls en la respuesta y serializa como **tool_call**:JSON
- Devuelve tokens de uso cuando el provider los reporta

Gemini nativo (chatGemini):

- Convierte mensajes al formato contents de Gemini
- Mapea system -> system_instruction
- Mapea assistant -> rol model de Gemini
- URL con ?key= en query param

Providers configurados actualmente (config.json):

- openai -> https://api.openai.com/v1 (gpt-4o, gpt-4o-mini)
- gemini -> https://generativelanguage.googleapis.com/v1beta (gemini-2.0-flash)
- groq -> https://api.groq.com/openai/v1 (llama-3.3-70b-versatile)
- openrouter -> https://openrouter.ai/api/v1 (openrouter/auto)

### src/tools/index.ts - Herramientas del agente

shell - Ejecuta comandos con deteccion de OS:

- Parametros: command, cwd (opcional)
- Sandbox: verifica que el directorio este dentro del workspace si workspace_only=true
- Blacklist de comandos peligrosos: rm -rf /, fork bombs, sudo, su
- Timeout: 30 segundos
- Buffer maximo: 1MB de output
- Nota: allowed_commands se valida si no esta vacio
- Windows: normaliza comandos comunes (pwd -> cd, ls -> dir /a)

file - Operaciones de archivos:

- Acciones: read, write, list
- Sandbox: verifica paths dentro del workspace si workspace_only=true
- read: trunca a 8000 chars si el archivo es muy grande
- write: crea directorios intermedios automaticamente
- list: lista entradas con iconos

remember - Notas persistentes:

- Acciones: save, get
- Usa la tabla notes de SQLite (clave-valor persistente entre sesiones)

model - Cambio de modelo en runtime:

- Parametros: provider (opcional), model
- Cambia default_provider/default_model en memoria (solo sesion)
- Persistir via /setup

### src/channels/cli.ts - Terminal

- Interface readline interactiva
- Prompt: "You:" con estilo
- Comandos: /exit, /quit, /clear, /help, /setup
- Indicador "thinking..." mientras espera respuesta
- Usuario: process.env.USER o "local"

### src/channels/startup-menu.ts - Menu de inicio

- Menu interactivo (inquirer) cuando se ejecuta sin --channel
- Opciones: logs/daemon, CLI, Telegram only, Discord only, exit

### src/channels/cli-setup.ts - Setup TUI

- Menu interactivo para API keys, modelos, workspace y sandbox
- Listado de modelos con busqueda y paginado
- Seleccion multiple de modelos por provider
- Configura workspace y acceso OS (workspace_only)

### src/channels/telegram.ts - Telegram Bot

- Long polling via node-telegram-bot-api
- Allowlist por user_id (numerico) o username
- Soporte de "\*" para permitir todos
- Indicador de typing mientras procesa
- Respuesta con parse_mode: Markdown
- Log de mensajes entrantes en consola
- Mensaje de error con comando sugerido (channel allow-telegram)

### src/channels/discord.ts - Discord Bot

- WebSocket via discord.js v14
- Intents: Guilds, GuildMessages, MessageContent, DirectMessages
- Activa solo cuando es mencionado (@bot) o en DM
- Strip de menciones del texto antes de procesar
- Chunking automatico de respuestas largas (>1900 chars)
- Allowlist por user ID o username

### src/core/scheduler.ts - Cron scheduler

- Usa node-cron para jobs programados
- Cada job: id, schedule (expresion cron), prompt (texto enviado al agente)
- Valida expresiones cron antes de registrar
- Contexto: channel = "cron", userId = "cron:<id>"
- Log de inicio y resultado de cada job

### src/core/log-tail.ts - Tail de logs

- Tail de `.rippleclaw/logs/tool.log` en modo daemon
- Muestra las ultimas N lineas y sigue cambios nuevos

### src/daemon.ts - Entry point

- Flags: --channel cli|telegram|discord, --version, --help
- Sin --channel (TTY): muestra menu de inicio
- Sin --channel (no TTY): modo daemon (todos los canales habilitados en config)
- Valida que al menos un provider tenga API key antes de arrancar
- Manejo de SIGINT y SIGTERM para shutdown limpio

---

## Configuracion (config.json)

```json
{
  "name": "RippleClaw",
  "version": "0.1.0",
  "workspace": "/home/erik/programacion/",
  "default_provider": "openai",
  "default_model": "gpt-4o",
  "context": {
    "max_tokens": 16000,
    "compress_threshold": 0.85
  },
  "autonomy": "full",
  "providers": [...],
  "channels": {
    "telegram": { "enabled": false, "token": "...", "allowed_users": ["username_o_id"] },
    "discord":  { "enabled": false, "token": "...", "allowed_users": ["*"] },
    "cli":      { "enabled": true }
  },
  "memory": {
    "backend": "sqlite",
    "path": "~/.rippleclaw/memory.db",
    "auto_save": true
  },
  "tools": {
    "shell": { "enabled": true, "allowed_commands": ["git", "npm", "node"], "workspace_only": true },
    "file":  { "enabled": true, "workspace_only": true }
  },
  "cron": {
    "enabled": true,
    "jobs": [
      { "id": "nombre", "schedule": "0 9 * * *", "prompt": "Tarea a ejecutar" }
    ]
  }
}
```

---

## Comandos de desarrollo

```bash
npm run build              # Build TS a dist/
npm start                  # Daemon (canales configurados)
npm start -- --menu        # Menu de inicio
npm run dev                # Modo dev con hot reload
npm run cli                # CLI interactiva
npm run lint               # Lint
npm run format             # Format
npm run test               # Tests
npm run debug:chat -- --input scripts/debug-smoke.txt  # Debug smoke (tools + prompts)
```

```bash
# Instalar como servicio systemd
sudo cp rippleclaw.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable rippleclaw
sudo systemctl start rippleclaw
sudo journalctl -u rippleclaw -f
```

---

## Extensibilidad - Como agregar nuevas funcionalidades

### Agregar un nuevo provider

En src/providers/base.ts, agregar un nuevo if (provider.name === "nuevo") que llame a su funcion especifica, o simplemente configurarlo en config.json si es OpenAI-compatible.

### Agregar una nueva tool

En src/tools/index.ts, exportar una funcion createXxxTool(config) que devuelva { definition: Tool, execute(args) }. Registrarla en el constructor de Agent en src/core/agent.ts.

Estructura minima de una tool:

```typescript
export function createMiTool(config: Config) {
  return {
    definition: {
      name: "mi_tool",
      description: "Descripcion para el LLM",
      parameters: {
        type: "object",
        properties: { arg1: { type: "string", description: "..." } },
        required: ["arg1"]
      }
    } satisfies Tool,
    async execute(args: { arg1: string }): Promise<string> {
      return "resultado";
    }
  };
}
```

### Agregar un nuevo canal

Crear src/channels/nuevo.ts con una funcion startNuevo(agent, config). Importarla y arrancarla en src/daemon.ts. Agregar su config en Config y en config.json.

### Cambiar el backend de memoria

Implementar MemoryStore y exportar desde src/core/memory.ts. Agregar la condicion en createMemory(). Posibles backends futuros: PostgreSQL, Redis, archivo Markdown.

---

## Roadmap / Features planificadas

- [ ] HTTP Gateway - endpoint REST para integrar con otras apps o webhooks externos
- [ ] Embeddings + busqueda vectorial - columna vector en SQLite para memoria semantica
- [ ] Identidad configurable - archivos IDENTITY.md, SOUL.md en workspace para personalidad
- [ ] CLI de administracion - rippleclaw status, rippleclaw cron list, rippleclaw channel allow <id>
- [ ] Soporte de imagenes - input de imagenes en Telegram/Discord hacia modelos vision
- [ ] Plugin system - tools cargadas dinamicamente desde archivos .ts en el workspace
- [x] Enforce allowed_commands en shell tool

---

## Convenciones de codigo

- TypeScript estricto: no any salvo en Record<string, unknown>
- Imports con type para interfaces: import type { Config } from "./config"
- Funciones factory (createXxx) para tools y channels, no clases donde sea posible
- Errores: retornar string descriptivo desde tools (nunca throw al agente)
- Logs: prefijo [NombreModulo] en console.log/error
- Archivos nuevos: siempre en la carpeta correspondiente (core/, channels/, tools/, providers/)

---

## Contexto de hardware

- Device: Orange Pi Lite - Allwinner H3, ARM Cortex-A7 quad-core 1.2GHz, 512MB-1GB DDR3
- OS: Armbian / Ubuntu para Orange Pi
- Limites: evitar operaciones >128MB RAM; SQLite corre en proceso
- Red: solo saliente (polling), no requiere IP publica
- Servicio: systemd con MemoryMax=128M y CPUQuota=80%

---

## Instrucciones para el asistente

Cuando el usuario pida modificar, extender o depurar RippleClaw:

1. Siempre respetar la arquitectura existente - no romper interfaces ni cambiar nombres de exports sin actualizar usos.
2. TypeScript estricto - no introducir any sin justificacion; usar satisfies para validar objetos contra interfaces.
3. Node-first - preferir APIs del stdlib y dependencias ligeras.
4. Backward compatible - cambios en config.json deben mantener compatibilidad con config existente.
5. Seguridad primero - toda tool nueva debe verificar que opera dentro del workspace; nunca exponer paths o comandos sin validar.
6. Lightweight - cualquier nueva dependencia debe justificarse por tamano y consumo de memoria.
7. Cuando agregues una feature, actualizar este SKILL.md con la nueva funcionalidad en su seccion.
