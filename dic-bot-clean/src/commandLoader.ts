// src/commandLoader.ts
import fs from "fs";
import path from "path";

export type LoadedCommand = {
  data: { name: string };
  execute: (...args: any[]) => Promise<any> | any;
};

export function loadCommandsFromDist(): Map<string, LoadedCommand> {
  // When running compiled code, __dirname points to dist/.
  // Commands are in dist/commands as .js files.
  const commandsDir = path.join(__dirname, "commands");
  const commands = new Map<string, LoadedCommand>();

  if (!fs.existsSync(commandsDir)) {
    console.warn(`[commands] directory not found: ${commandsDir}`);
    return commands;
  }

  const files = fs.readdirSync(commandsDir).filter(f => f.endsWith(".js"));
  for (const file of files) {
    const full = path.join(commandsDir, file);
    try {
      // CJS require for compiled output
      const mod = require(full);

      // Support either: export const command = {...}  or  export default { command: {...} }
      const candidate = mod?.command ?? mod?.default?.command ?? mod?.default;

      if (candidate?.data?.name && typeof candidate?.execute === "function") {
        commands.set(candidate.data.name, candidate);
      } else {
        console.warn(
          `[commands] Skipping ${file} — missing export { command } with data/execute. Got keys: ${Object.keys(mod || {})}`
        );
      }
    } catch (e) {
      console.error(`[commands] Failed to load ${file}:`, e);
    }
  }

  console.log(`[commands] Loaded ${commands.size}/${files.length} command files`);
  return commands;
}
