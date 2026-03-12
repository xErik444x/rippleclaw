const path = require("path");

const { loadConfig } = require(path.join(__dirname, "..", "dist", "core", "config.js"));
const { createMemory } = require(path.join(__dirname, "..", "dist", "core", "memory.js"));
const {
  createShellTool,
  createFileTool,
  createMemoryTool,
  createModelTool,
  createEnvTool
} = require(path.join(__dirname, "..", "dist", "tools", "index.js"));

function header(title) {
  console.log(`\n=== ${title} ===`);
}

function printResult(label, result) {
  console.log(`- ${label}:`);
  console.log(result);
}

async function main() {
  const config = loadConfig();
  // Override memory path to stay within workspace for sandboxed writes.
  config.memory.path = path.join(process.cwd(), ".rippleclaw", "memory-test.db");
  const memory = createMemory(config);
  const shell = createShellTool(config);
  const file = createFileTool(config);
  const remember = createMemoryTool(memory);
  const model = createModelTool(config);
  const env = createEnvTool(config);

  const safe = async (label, fn) => {
    try {
      const res = await fn();
      printResult(label, res);
    } catch (err) {
      printResult(label, `Error: ${String(err && err.message ? err.message : err)}`);
    }
  };

  header("env tool");
  await safe("env include os,cwd,workspace", () => env.execute({ include: ["os", "cwd", "workspace"] }));

  header("remember tool");
  await safe("save note", () => remember.execute({ action: "save", key: "tool_test_note", value: "ok" }));
  await safe("get note", () => remember.execute({ action: "get", key: "tool_test_note" }));

  header("file tool");
  await safe("list root", () => file.execute({ action: "list", path: "." }));
  await safe("read README.md", () => file.execute({ action: "read", path: "README.md" }));
  await safe("write test file", () =>
    file.execute({
      action: "write",
      path: ".rippleclaw/tmp/tool_test.txt",
      content: "hola"
    })
  );
  await safe("read test file", () => file.execute({ action: "read", path: ".rippleclaw/tmp/tool_test.txt" }));

  header("shell tool");
  await safe("npm --version", () => shell.execute({ command: "npm --version" }));
  await safe("echo", () => shell.execute({ command: "echo tool_smoke_ok" }));
  await safe("cwd outside workspace", () =>
    shell.execute({ command: "npm --version", cwd: path.parse(process.cwd()).root })
  );
  await safe("pwd (normalized)", () => shell.execute({ command: "pwd" }));
  await safe("ls (normalized)", () => shell.execute({ command: "ls" }));

  header("model tool");
  await safe("set openrouter/auto", () =>
    model.execute({ provider: "openrouter", model: "openrouter/auto" })
  );

  header("done");
  console.log("ok");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
