import { Context } from "hono";
import type { ProjectInfo, ProjectsResponse } from "../../shared/types.ts";
import { getEncodedProjectName } from "../history/pathUtils.ts";
import { logger } from "../utils/logger.ts";
import { readTextFile } from "../utils/fs.ts";
import { getHomeDir } from "../utils/os.ts";
import type { ConfigContext } from "../middleware/config.ts";
import { parseBooleanQueryParam } from "../utils/query.ts";
import {
  matchesAutobaProject,
  normalizeConfiguredPrefixes,
  listAutobaWorkspacePaths,
} from "../utils/autoba.ts";

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

        // Get encoded names for each project, only include projects with history
        const projects: ProjectInfo[] = [];
        const seenPaths = new Set<string>();
        for (const path of projectPaths) {
          const encodedName = await getEncodedProjectName(path);
          // Only include projects that have history directories
          if (!encodedName) {
            continue;
          }

          if (
            filterAutoBA &&
            !matchesAutobaProject(path, encodedName, autobaPrefixes)
          ) {
            continue;
          }

          projects.push({
            path,
            encodedName,
          });
          seenPaths.add(path);
        }

        if (filterAutoBA) {
          const discoveredPaths = await collectAutobaWorkspacePaths(
            autobaPrefixes,
          );

          for (const path of discoveredPaths) {
            if (seenPaths.has(path)) {
              continue;
            }

            const encodedName = await getEncodedProjectName(path);
            if (!encodedName) {
              continue;
            }

            projects.push({
              path,
              encodedName,
            });
            seenPaths.add(path);
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

async function collectAutobaWorkspacePaths(
  prefixes: string[],
): Promise<string[]> {
  const results: string[] = [];
  for (const prefix of prefixes) {
    const paths = await listAutobaWorkspacePaths(prefix);
    results.push(...paths);
  }
  return results;
}
