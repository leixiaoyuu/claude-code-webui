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
  defaultWorkingDirectory?: string;
  autobaCwdPrefixes?: string[];
  allowedLoadMcpServers?: string[];
}

function parsePositiveInteger(value: string, label: string): number {
  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 0) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  return parsed;
}

function collectAutobaPrefixes(value: string, previous?: string[]): string[] {
  const trimmed = value.trim();
  if (!trimmed) {
    return previous ?? [];
  }
  return previous ? [...previous, trimmed] : [trimmed];
}

function normalizeAutobaPrefixes(prefixes?: string[]): string[] | undefined {
  if (!prefixes || prefixes.length === 0) {
    return undefined;
  }
  const normalized = prefixes
    .map((prefix) => prefix.trim())
    .filter((prefix) => prefix.length > 0);
  return normalized.length > 0 ? normalized : undefined;
}

function parseAutobaPrefixEnv(value?: string): string[] | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      const fromJson = parsed
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
      return fromJson.length > 0 ? fromJson : undefined;
    }
  } catch {
    // Ignore JSON parse errors and fall back to delimiter parsing
  }

  const fallback = trimmed
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return fallback.length > 0 ? fallback : undefined;
}

function collectStringList(value: string, previous?: string[]): string[] {
  const values = value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  if (values.length === 0) {
    return previous ?? [];
  }
  return previous ? [...previous, ...values] : values;
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
    )
    .option(
      "--default-cwd <path>",
      "Default working directory when chat requests omit workingDirectory",
    )
    .option(
      "--autoba-cwd-prefix <path>",
      "AutoBA project working directory prefix (repeatable)",
      collectAutobaPrefixes,
    )
    .option(
      "--allowed-load-mcp-servers <names...>",
      "MCP server names allowed to load (comma or space separated)",
      collectStringList,
    );

  // Parse arguments - Commander.js v14 handles this automatically
  program.parse(getArgs(), { from: "user" });
  const options = program.opts<
    ParsedArgs & {
      maxThinkingTokens?: number;
      defaultCwd?: string;
      autobaCwdPrefix?: string[];
      allowedLoadMcpServers?: string[];
    }
  >();

  // Handle DEBUG environment variable manually
  const debugEnv = getEnv("DEBUG");
  const debugFromEnv = debugEnv?.toLowerCase() === "true" || debugEnv === "1";

  const thinkingEnv = getEnv("MAX_THINKING_TOKENS");
  const envThinkingTokens =
    thinkingEnv !== undefined
      ? parsePositiveInteger(thinkingEnv, "MAX_THINKING_TOKENS")
      : undefined;

  const defaultCwdEnv = getEnv("DEFAULT_CWD");
  const envAutobaPrefixes = parseAutobaPrefixEnv(
    getEnv("AUTOBA_CWD_PREFIXES"),
  );
  const cliAutobaPrefixes = normalizeAutobaPrefixes(options.autobaCwdPrefix);

  return {
    debug: options.debug || debugFromEnv,
    port: options.port,
    host: options.host,
    claudePath: options.claudePath,
    maxThinkingTokens:
      options.maxThinkingTokens !== undefined
        ? options.maxThinkingTokens
        : envThinkingTokens,
    defaultWorkingDirectory:
      options.defaultCwd !== undefined ? options.defaultCwd : defaultCwdEnv,
    autobaCwdPrefixes:
      cliAutobaPrefixes !== undefined
        ? cliAutobaPrefixes
        : envAutobaPrefixes,
    allowedLoadMcpServers:
      options.allowedLoadMcpServers?.length
        ? options.allowedLoadMcpServers
        : undefined,
  };
}
