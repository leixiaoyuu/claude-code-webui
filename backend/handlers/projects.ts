import { Context } from "hono";
import type { ProjectInfo, ProjectsResponse } from "../../shared/types.ts";
import { getEncodedProjectName } from "../history/pathUtils.ts";
import { logger } from "../utils/logger.ts";
import { readTextFile } from "../utils/fs.ts";
import { getHomeDir } from "../utils/os.ts";
import type { ConfigContext } from "../middleware/config.ts";

/**
 * Handles GET /api/projects requests
 * Retrieves list of available project directories from Claude configuration
 * @param c - Hono context object
 * @returns JSON response with projects array
 */
export async function handleProjectsRequest(c: Context<ConfigContext>) {
  try {
    const filterAutoBA = parseBooleanQueryParam(c.req.query("isAutoBA"));
    const configFromContext = c.get("config");
    const autobaPrefixes = normalizeConfiguredPrefixes(
      configFromContext.autobaCwdPrefixes,
    );

    const homeDir = getHomeDir();
    if (!homeDir) {
      return c.json({ error: "Home directory not found" }, 500);
    }

    const claudeConfigPath = `${homeDir}/.claude.json`;

    try {
      const configContent = await readTextFile(claudeConfigPath);
      const claudeConfig = JSON.parse(configContent);

      if (claudeConfig.projects && typeof claudeConfig.projects === "object") {
        const projectPaths = Object.keys(claudeConfig.projects);
        const pathsToProcess = filterAutoBA
          ? filterPathsByPrefixes(projectPaths, autobaPrefixes)
          : projectPaths;

        // Get encoded names for each project, only include projects with history
        const projects: ProjectInfo[] = [];
        for (const path of pathsToProcess) {
          const encodedName = await getEncodedProjectName(path);
          // Only include projects that have history directories
          if (encodedName) {
            projects.push({
              path,
              encodedName,
            });
          }
        }

        const response: ProjectsResponse = { projects };
        return c.json(response);
      } else {
        const response: ProjectsResponse = { projects: [] };
        return c.json(response);
      }
    } catch (error) {
      // Handle file not found errors in a cross-platform way
      if (error instanceof Error && error.message.includes("No such file")) {
        const response: ProjectsResponse = { projects: [] };
        return c.json(response);
      }
      throw error;
    }
  } catch (error) {
    logger.api.error("Error reading projects: {error}", { error });
    return c.json({ error: "Failed to read projects" }, 500);
  }
}

function parseBooleanQueryParam(value: string | null | undefined): boolean {
  if (!value) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === "true" || normalized === "1";
}

function normalizeConfiguredPrefixes(prefixes?: string[]): string[] {
  if (!prefixes) {
    return [];
  }
  return prefixes
    .map((prefix) => prefix.trim())
    .filter((prefix) => prefix.length > 0);
}

function filterPathsByPrefixes(paths: string[], prefixes: string[]): string[] {
  if (prefixes.length === 0) {
    return [];
  }
  return paths.filter((path) =>
    prefixes.some((prefix) => pathMatchesPrefix(path, prefix))
  );
}

function pathMatchesPrefix(path: string, prefix: string): boolean {
  if (!prefix) {
    return false;
  }
  const normalizedPath = replaceBackslashes(path);
  const normalizedPrefix = replaceBackslashes(prefix);

  if (normalizedPath === normalizedPrefix) {
    return true;
  }

  const trimmedPath = trimTrailingSlash(normalizedPath);
  const trimmedPrefix = trimTrailingSlash(normalizedPrefix);

  if (!trimmedPrefix) {
    return false;
  }

  if (trimmedPath === trimmedPrefix) {
    return true;
  }

  const prefixWithSlash =
    trimmedPrefix === "/" ? "/" : `${trimmedPrefix}/`;
  return normalizedPath.startsWith(prefixWithSlash);
}

function replaceBackslashes(value: string): string {
  return value.replace(/\\/g, "/");
}

function trimTrailingSlash(value: string): string {
  if (value === "/") {
    return value;
  }
  return value.replace(/\/+$/, "");
}
