/**
 * CLI argument parsing using runtime abstraction
 *
 * Handles command-line argument parsing in a runtime-agnostic way.
 */

import { program } from "commander";
import { VERSION } from "./version.ts";
import { getEnv, getArgs } from "../utils/os.ts";

export interface ParsedArgs {
  debug: boolean;
  port: number;
  host: string;
  claudePath?: string;
  maxThinkingTokens?: number;
}

function parsePositiveInteger(value: string, label: string): number {
  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 0) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  return parsed;
}

export function parseCliArgs(): ParsedArgs {
  // Use version from auto-generated version.ts file
  const version = VERSION;

  // Get default port from environment
  const defaultPort = parseInt(getEnv("PORT") || "22080", 10);

  // Configure program
  program
    .name("claude-code-webui")
    .version(version, "-v, --version", "display version number")
    .description("Claude Code Web UI Backend Server")
    .option(
      "-p, --port <port>",
      "Port to listen on",
      (value) => {
        const parsed = parseInt(value, 10);
        if (isNaN(parsed)) {
          throw new Error(`Invalid port number: ${value}`);
        }
        return parsed;
      },
      defaultPort,
    )
    .option(
      "--host <host>",
      "Host address to bind to (use 0.0.0.0 for all interfaces)",
      "127.0.0.1",
    )
    .option(
      "--claude-path <path>",
      "Path to claude executable (overrides automatic detection)",
    )
    .option("-d, --debug", "Enable debug mode", false)
    .option(
      "--max-thinking-tokens <number>",
      "Maximum tokens Claude can spend on thinking (enables reasoning deltas)",
      (value) => parsePositiveInteger(value, "max thinking tokens"),
    );

  // Parse arguments - Commander.js v14 handles this automatically
  program.parse(getArgs(), { from: "user" });
  const options = program.opts<
    ParsedArgs & { maxThinkingTokens?: number }
  >();

  // Handle DEBUG environment variable manually
  const debugEnv = getEnv("DEBUG");
  const debugFromEnv = debugEnv?.toLowerCase() === "true" || debugEnv === "1";

  const thinkingEnv = getEnv("MAX_THINKING_TOKENS");
  const envThinkingTokens =
    thinkingEnv !== undefined
      ? parsePositiveInteger(thinkingEnv, "MAX_THINKING_TOKENS")
      : undefined;

  return {
    debug: options.debug || debugFromEnv,
    port: options.port,
    host: options.host,
    claudePath: options.claudePath,
    maxThinkingTokens:
      options.maxThinkingTokens !== undefined
        ? options.maxThinkingTokens
        : envThinkingTokens,
  };
}
