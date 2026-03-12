import inquirer from "inquirer";

export type StartupChoice =
  | "daemon"
  | "cli"
  | "telegram"
  | "discord"
  | "exit";

export async function promptStartupMenu(): Promise<StartupChoice> {
  const { choice } = await inquirer.prompt([
    {
      type: "list",
      name: "choice",
      message: "Startup mode",
      choices: [
        { name: "Logs (daemon: Telegram/Discord/Cron)", value: "daemon" },
        { name: "CLI chat", value: "cli" },
        { name: "Telegram only", value: "telegram" },
        { name: "Discord only", value: "discord" },
        { name: "Exit", value: "exit" }
      ]
    }
  ]);
  return choice as StartupChoice;
}
