# RippleClaw

Fast, autonomous AI agent optimized for low-power devices (Orange Pi, Raspberry Pi, etc.)

[![GitHub Release](https://img.shields.io/github/v/release/xErik444x/rippleclaw)](https://github.com/xErik444x/rippleclaw/releases)
[![Build](https://github.com/xErik444x/rippleclaw/actions/workflows/release.yml/badge.svg)](https://github.com/xErik444x/rippleclaw/actions)

---

## Tabla de Contenidos

- [RippleClaw](#rippleclaw)
  - [Tabla de Contenidos](#tabla-de-contenidos)
  - [Caracteristicas](#caracteristicas)
  - [Inicio Rapido](#inicio-rapido)
    - [Opción 1: Binario (más rápido)](#opción-1-binario-más-rápido)
    - [Opción 2: Desde código fuente](#opción-2-desde-código-fuente)
  - [Instalacion](#instalacion)
    - [Desde código fuente](#desde-código-fuente)
    - [Binario precompilado](#binario-precompilado)
  - [Configuracion](#configuracion)
    - [Ejemplo completo](#ejemplo-completo)
    - [Notas](#notas)
  - [Canales](#canales)
    - [Telegram](#telegram)
    - [Discord](#discord)
    - [CLI](#cli)
  - [Comandos](#comandos)
  - [Memoria y Contexto](#memoria-y-contexto)
    - [Comandos de memoria (desde el chat)](#comandos-de-memoria-desde-el-chat)
    - [Compresión automática](#compresión-automática)
  - [Build Manual](#build-manual)
    - [Windows](#windows)
    - [Linux x64](#linux-x64)
    - [Linux ARM64 (Orange Pi, Raspberry Pi)](#linux-arm64-orange-pi-raspberry-pi)
    - [GitHub Actions](#github-actions)
  - [Cron Jobs](#cron-jobs)
    - [Comandos desde el chat](#comandos-desde-el-chat)
    - [Formato de schedule (cron)](#formato-de-schedule-cron)
    - [Configuracion estatica (alternativo)](#configuracion-estatica-alternativo)
  - [Service Linux](#service-linux)
  - [Desarrollo](#desarrollo)
    - [Estructura del proyecto](#estructura-del-proyecto)
  - [Seguridad](#seguridad)
    - [`.gitignore` recomendado](#gitignore-recomendado)
  - [📄 Licencia](#-licencia)

---

## Caracteristicas

- Ligero - Optimizado para dispositivos de bajo consumo
- Memoria persistente - JSON storage con busqueda
- Herramientas - Shell, archivos, memoria, clima, web
- Multi-provider - OpenAI, Gemini, Groq, OpenRouter
- Multi-canal - Telegram, Discord, CLI
- Scheduler - Tareas autonomous con cron
- Sandbox seguro - Workspace isolation
- Binarios - Sin Node.js instalado

---

## Inicio Rapido

### Opción 1: Binario (más rápido)

```bash
# Descargar de Releases:
# https://github.com/xErik444x/rippleclaw/releases

# Windows
rippleclaw.exe

# Linux
chmod +x rippleclaw
./rippleclaw
```

### Opción 2: Desde código fuente

```bash
git clone https://github.com/xErik444x/rippleclaw.git
cd rippleclaw
npm install
npm run build
npm start
```

---

## Instalacion

### Desde código fuente

```bash
# Clonar el repo
git clone https://github.com/xErik444x/rippleclaw.git
cd rippleclaw

# Instalar dependencias
npm install

# Build de desarrollo
npm run build

# Iniciar (requiere config.json)
npm start
```

### Binario precompilado

1. Ir a [Releases](https://github.com/xErik444x/rippleclaw/releases)
2. Descargar el binario para tu plataforma:
   - `rippleclaw-win-x64.exe` - Windows
   - `rippleclaw-linux-x64` - Linux x64
3. Para ARM (Raspberry Pi / Orange Pi), ver [Build Manual](#linux-arm64-orange-pi-raspberry-pi)
4. Copiar `config.json` junto al binario
5. Ejecutar

---

## Configuracion

El archivo `config.json` se busca en:

1. `./config.json` (local)
2. `$RIPPLECLAW_CONFIG`
3. `~/.rippleclaw/config.json`

### Ejemplo completo

```json
{
  "name": "RippleClaw",
  "version": "0.1.0",
  "workspace": "~/.rippleclaw/workspace",
  "default_provider": "openai",
  "default_model": "gpt-4o-mini",
  "context": {
    "max_tokens": 16000,
    "compress_threshold": 0.85
  },
  "autonomy": "full",
  "providers": [
    {
      "name": "openai",
      "api_base": "https://api.openai.com/v1",
      "api_key": "sk-tu-api-key-aqui",
      "models": ["gpt-4o", "gpt-4o-mini"]
    },
    {
      "name": "openrouter",
      "api_base": "https://openrouter.ai/api/v1",
      "api_key": "tu-key-aqui",
      "models": ["openrouter/auto"]
    }
  ],
  "channels": {
    "telegram": {
      "enabled": true,
      "token": "TU_BOT_TOKEN",
      "allowed_users": ["tu_user_id"]
    },
    "discord": {
      "enabled": false,
      "token": "",
      "allowed_users": []
    },
    "cli": {
      "enabled": true
    }
  },
  "memory": {
    "backend": "json",
    "path": "~/.rippleclaw/memory.json",
    "auto_save": true
  },
  "tools": {
    "shell": {
      "enabled": true,
      "allowed_commands": ["git", "npm", "node", "ls", "cat"],
      "workspace_only": true
    },
    "file": {
      "enabled": true,
      "workspace_only": true
    },
    "web": {
      "enabled": true,
      "provider": "duckduckgo"
    }
  },
  "runtime": {
    "max_tool_concurrency": 1
  },
  "cron": {
    "enabled": true,
    "jobs": []
  }
}
```

### Notas

- **`allowed_users`**: Soporta user ID, username, o `"*"` para permitir todos
- **`memory.backend`**: `"json"` (recomendado) o `"none"`
- **`workspace_only`**: Limita herramientas al directorio del workspace

---

## Canales

### Telegram

1. Crear bot con [@BotFather](https://t.me/BotFather)
2. Obtener el token
3. Obtener tu user ID (enviá `/start` a @userinfobot)
4. Configurar en `config.json`:

```json
"telegram": {
  "enabled": true,
  "token": "TU_TOKEN",
  "allowed_users": ["TU_USER_ID"]
}
```

5. Comandos disponibles (autocompletado):
   - `/start` - Iniciar el bot
   - `/help` - Mostrar ayuda
   - `/newsession` - Reiniciar sesión
   - `/status` - Ver estado
   - `/compress` - Comprimir contexto

### Discord

1. Crear app en [Discord Developer Portal](https://discord.com/developers/applications)
2. Crear bot y obtener token
3. Habilitar Message Content Intent
4. Invitar bot con permisos:
   - Send Messages
   - Read Message History
5. Configurar:

```json
"discord": {
  "enabled": true,
  "token": "TU_TOKEN",
  "allowed_users": []
}
```

### CLI

```bash
npm run cli
# o con binario
./rippleclaw --channel cli
```

---

## Comandos

| Comando       | Descripción                                  |
| ------------- | -------------------------------------------- |
| `/start`      | Iniciar bot (Telegram)                       |
| `/help`       | Mostrar ayuda                                |
| `/newsession` | Reiniciar sesión / olvidar contexto          |
| `/status`     | Ver estado actual (modelo, tokens, mensajes) |
| `/compress`   | Comprimir contexto manualmente               |
| `/exit`       | Salir (CLI)                                  |
| `/clear`      | Limpiar pantalla (CLI)                       |

---

## Memoria y Contexto

RippleClaw maneja la memoria en dos niveles:

1. **Sesión** - Historial de mensajes (archivos JSON en `~/.rippleclaw/sessions/`)
2. **Notas** - Datos persistentes (keywords guardados)

### Comandos de memoria (desde el chat)

```bash
# Guardar algo en memoria
"Recordá que mi nombre es Erik"

# Ver valor
"Cómo me llamo?"

# Cambiar nombre del bot
"Te voy a llamar Clown"
```

### Compresión automática

Cuando el contexto supera el 85% del límite, automáticamente:

1. Resume la conversación
2. Guarda el resumen
3. Elimina mensajes antiguos

Forzar compresión: `/compress`

---

## Build Manual

### Windows

```bash
npm install
npm run build:bin:win
# Output: bin/rippleclaw.exe
```

### Linux x64

```bash
npm install
npm run build:bin:linux-x64
# Output: bin/rippleclaw
```

### Linux ARM64 (Orange Pi, Raspberry Pi)

```bash
npm install
npm run build:bin:linux-arm64

```

### GitHub Actions

El workflow `.github/workflows/release.yml` construye automaticamente:

- `rippleclaw-linux-x64`
- `rippleclaw-win-x64.exe`

Para ARM, ver seccion [Linux ARM64](#linux-arm64-orange-pi-raspberry-pi).

Se ejecuta en push a `main` y crea un release con los binarios.

---

## Cron Jobs

Los cron jobs se gestionan desde el chat usando la herramienta `cron`. Los jobs se guardan en memoria y persisten entre sesiones.

### Comandos desde el chat

```
# Listar todos los cron jobs
"列出 mis cron jobs" o usa la tool cron action=list

# Crear un cron job
"Agrega un cron job llamado resumen-diario a las 9am que diga Dame un resumen de lo que trabajaste ayer"

# Eliminar un cron job
"Borra el cron job resumen-diario"

# Habilitar/deshabilitar
"Habilita el cron job resumen-diario"
"Deshabilita el cron job resumen-diario"

# Ver un job especifico
"Muestra el cron job recordatorio"
```

### Formato de schedule (cron)

| Expresion      | Descripcion                |
| -------------- | -------------------------- |
| `0 9 * * *`    | Todos los dias a las 9:00  |
| `0 9 * * 1-5`  | Lunes a viernes a las 9:00 |
| `*/15 * * * *` | Cada 15 minutos            |
| `0 * * * *`    | Cada hora                  |

Formatos: `minuto hora dia mes dia_semana`

### Configuracion estatica (alternativo)

Tambien puedes definir jobs estaticos en `config.json`:

```json
"cron": {
  "enabled": true,
  "jobs": [
    {
      "id": "resumen-diario",
      "schedule": "0 9 * * *",
      "prompt": "Dame un resumen de lo que trabajaste ayer"
    }
  ]
}
```

---

## Service Linux

```bash
# Instalar servicio systemd
sudo npm run service:install

# Ver logs
sudo journalctl -u rippleclaw -f

# Reiniciar
sudo systemctl restart rippleclaw

# Estado
systemctl status rippleclaw

# Desinstalar
sudo npm run service:uninstall
```

Comandos del wrapper:

```bash
rippleclaw cli      # Modo interactivo
rippleclaw logs    # Ver logs
rippleclaw status  # Estado del servicio
rippleclaw restart # Reiniciar
```

---

## Desarrollo

```bash
# Dev mode con hot-reload
npm run dev

# TypeScript check
npm run typecheck

# Tests
npm run test

# Lint
npm run lint

# Build
npm run build
```

### Estructura del proyecto

```
src/
├── core/           # Agente, memoria, scheduler, config
├── providers/      # Adaptadores LLM
├── channels/      # CLI, Telegram, Discord
├── tools/         # shell, file, remember, model, env
└── daemon.ts      # Entry point
```

---

## Seguridad

- **Workspace sandbox** - Archivos/shell limitados al workspace
- **Allowed commands** - Lista blanca de comandos permitidos
- **Secrets** - No commitear `config.json` con API keys

### `.gitignore` recomendado

```
config.json
.rippleclaw/
node_modules/
dist/
bin/
*.log
```

---

## 📄 Licencia

MIT
