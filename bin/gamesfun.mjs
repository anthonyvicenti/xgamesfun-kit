#!/usr/bin/env node
// The `gamesfun` command. Each subcommand is a module in ../commands/<name>.mjs that exports
// `default { name, summary, usage, run(args) }`; see docs/ARCHITECTURE.md ("Seams").
import { readdir } from "node:fs/promises";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";

const COMMANDS_DIR = fileURLToPath(new URL("../commands/", import.meta.url));

async function loadCommands() {
  const files = (await readdir(COMMANDS_DIR)).filter((f) => f.endsWith(".mjs")).sort();
  const commands = new Map();
  for (const file of files) {
    const mod = await import(pathToFileURL(path.join(COMMANDS_DIR, file)).href);
    if (mod.default?.name) commands.set(mod.default.name, mod.default);
  }
  return commands;
}

function help(commands) {
  const lines = ["Usage: gamesfun <command> [options]", "", "Commands:"];
  for (const c of commands.values()) lines.push(`  ${c.name.padEnd(10)} ${c.summary}`);
  lines.push("", "Run `gamesfun <command> --help` for a command's options.");
  return lines.join("\n");
}

const commands = await loadCommands();
const [name, ...args] = process.argv.slice(2);
if (!name || name === "--help" || name === "-h" || name === "help") {
  console.log(help(commands));
  process.exit(name ? 0 : 1);
}
const command = commands.get(name);
if (!command) {
  console.error(`Unknown command "${name}".\n\n${help(commands)}`);
  process.exit(1);
}
if (args.includes("--help") || args.includes("-h")) {
  console.log(command.usage ?? command.summary);
  process.exit(0);
}
process.exitCode = (await command.run(args)) ?? 0;
