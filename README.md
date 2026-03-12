# RippleClaw

Fast, autonomous AI agent optimized for low-power devices (Orange Pi, Raspberry Pi, etc.)

[![GitHub Release](https://img.shields.io/github/v/release/xErik444x/rippleclaw)](https://github.com/xErik444x/rippleclaw/releases)
[![Build](https://github.com/xErik444x/rippleclaw/actions/workflows/release.yml/badge.svg)](https://github.com/xErik444x/rippleclaw/actions)

---

## Tabla de Contenidos

1. [Caracteristicas](#-caracteristicas)
2. [Inicio Rapido](#-inicio-rapido)
3. [Instalacion](#-instalacion)
   - [Desde codigo fuente](#desde-codigo-fuente)
   - [Binario precompilado](#binario-precompilado)
4. [Configuracion](#-configuracion)
5. [Canales](#-canales)
   - [Telegram](#telegram)
   - [Discord](#discord)
   - [CLI](#cli)
6. [Comandos](#-comandos)
7. [Memoria y Contexto](#-memoria-y-contexto)
8. [Build Manual](#-build-manual)
   - [Windows](#windows)
   - [Linux x64](#linux-x64)
   - [Linux ARM64](#linux-arm64-orange-pi-raspberry-pi)
9. [Cron Jobs](#-cron-jobs)
10. [Service Linux](#-service-linux)
11. [Desarrollo](#-desarrollo)
12. [Seguridad](#-seguridad)

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
# Opción 1: En la misma Orange Pi (recomendado)
npm install
npm run build:bin:linux-arm64

# Opción 2: GitHub Actions (automático en release)
# Push a main y se compila automáticamente
```

### GitHub Actions

El workflow `.github/workflows/release.yml` construye automaticamente:

- `rippleclaw-linux-x64`
- `rippleclaw-win-x64.exe`

Para ARM, ver seccion [Linux ARM64](#linux-arm64-orange-pi-raspberry-pi).

Se ejecuta en push a `main` y crea un release con los binarios.

---

## Cron Jobs

En `config.json`:

```json
"cron": {
  "enabled": true,
  "jobs": [
    {
      "id": "resumen-diario",
      "schedule": "0 9 * * *",
      "prompt": "Dame un resumen de lo que trabajaste ayer y sugerí tareas para hoy"
    },
    {
      "id": "recordatorio",
      "schedule": "0 18 * * 1-5",
      "prompt": "Recordá que a las 9am tengo que trabajar"
    }
  ]
}
```

Formatos de schedule (cron):

- `0 9 * * *` - Todos los días a las 9:00
- `0 9 * * 1-5` - Lunes a viernes a las 9:00
- `*/15 * * * *` - Cada 15 minutos

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
