#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { loadConfig } from "./config.js";
import { startServer } from "./server.js";

async function main() {
  const { configPath } = parseArgs(process.argv.slice(2));
  const config = await loadConfig(configPath);
  await startServer(config, { logger: console });
}

export function parseArgs(argv) {
  let configPath = "proxy-config.yaml";

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--config" || arg === "-c") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error(`${arg} requires a value`);
      }
      configPath = value;
      index += 1;
      continue;
    }

    throw new Error(`unknown argument: ${arg}`);
  }

  return { configPath };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
