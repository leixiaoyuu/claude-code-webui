import { Context } from "hono";
import type { ProjectInfo, ProjectsResponse } from "../../shared/types.ts";
import { getEncodedProjectName } from "../history/pathUtils.ts";
import { getProjectTitle } from "../history/projectTitle.ts";
import { logger } from "../utils/logger.ts";
import { readTextFile, readDir, stat, exists } from "../utils/fs.ts";
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
    const projectsRoot = `${homeDir}/.claude/projects`;

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

          const projectInfo = await buildProjectInfo(
            path,
            encodedName,
            projectsRoot,
          );
          projects.push(projectInfo);
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

            const projectInfo = await buildProjectInfo(
              path,
              encodedName,
              projectsRoot,
            );
            projects.push(projectInfo);
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

async function buildProjectInfo(
  path: string,
  encodedName: string,
  projectsRoot: string,
): Promise<ProjectInfo> {
  const title = await getProjectTitle(
    `${projectsRoot}/${encodedName}`,
  );
  const timeline = await getProjectTimeline(
    `${projectsRoot}/${encodedName}`,
  );
  return {
    path,
    encodedName,
    ...(title ? { title } : {}),
    ...(timeline.createdAt ? { createdAt: timeline.createdAt } : {}),
    ...(timeline.updatedAt ? { updatedAt: timeline.updatedAt } : {}),
  };
}

async function getProjectTimeline(directory: string): Promise<
  { createdAt?: string; updatedAt?: string }
> {
  try {
    if (!await exists(directory)) {
      return {};
    }

    const directoryStats = await stat(directory);
    if (!directoryStats.isDirectory) {
      return {};
    }

    let earliest: Date | null = null;
    let latest: Date | null = null;
    let hasFiles = false;

    try {
      for await (const entry of readDir(directory)) {
        if (!entry.isFile) {
          continue;
        }
        const filePath = `${directory}/${entry.name}`;
        try {
          const fileStats = await stat(filePath);
          const candidateCreated = fileStats.birthtime ?? fileStats.mtime;
          const candidateUpdated = fileStats.mtime ?? fileStats.birthtime;

          if (candidateCreated) {
            if (!earliest || candidateCreated < earliest) {
              earliest = candidateCreated;
            }
          }
          if (candidateUpdated) {
            if (!latest || candidateUpdated > latest) {
              latest = candidateUpdated;
            }
          }
          hasFiles = true;
        } catch (error) {
          logger.api.debug("Failed to stat project file {filePath}", {
            filePath,
            error,
          });
        }
      }
    } catch (error) {
      logger.api.debug("Failed to read project directory {directory}", {
        directory,
        error,
      });
    }

    if (!hasFiles) {
      earliest = directoryStats.birthtime ?? directoryStats.mtime ?? earliest;
      latest = directoryStats.mtime ?? directoryStats.birthtime ?? latest;
    }

    return {
      ...(earliest ? { createdAt: earliest.toISOString() } : {}),
      ...(latest ? { updatedAt: latest.toISOString() } : {}),
    };
  } catch (error) {
    logger.api.debug("Failed to compute project timeline for {directory}", {
      directory,
      error,
    });
    return {};
  }
}
