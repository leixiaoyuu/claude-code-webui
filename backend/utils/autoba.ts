import {
  copyDirectory,
  exists,
  readDir,
  readTextFile,
  stat,
  writeTextFile,
} from "./fs.ts";

function replaceBackslashes(value: string): string {
  return value.replace(/\\/g, "/");
}

function trimTrailingSlash(value: string): string {
  if (value === "/") {
    return value;
  }
  return value.replace(/\/+$/, "");
}

function normalizePrefixBase(prefix: string): string {
  const normalized = trimTrailingSlash(replaceBackslashes(prefix));
  return normalized.length ? normalized : "/";
}

function getWorkspaceRoot(prefix: string): string {
  const base = normalizePrefixBase(prefix);
  return base === "/" ? "/workspaces" : `${base}/workspaces`;
}

const AUTOBA_PREFIX_PLACEHOLDER = "%%__AUTOBA_CWD_PREFIX__%%";

export function normalizeConfiguredPrefixes(prefixes?: string[]): string[] {
  if (!prefixes) {
    return [];
  }

  return prefixes
    .map((prefix) => prefix.trim())
    .filter((prefix) => prefix.length > 0);
}

export function pathMatchesPrefix(path: string, prefix: string): boolean {
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

export function buildAutobaWorkingDirectory(
  prefix: string,
  uid: string,
  autobaSessionId: string,
): string {
  const root = getWorkspaceRoot(prefix);
  const safeUid = uid.trim();
  const safeSession = autobaSessionId.trim();

  return `${root}/${safeUid}/${safeSession}`;
}

export async function prepareAutobaWorkspaceFromTemplate(
  prefix: string,
  uid: string,
  autobaSessionId: string,
): Promise<string> {
  const base = normalizePrefixBase(prefix);
  const templatePath = base === "/"
    ? "/workspace_template"
    : `${base}/workspace_template`;
  const destinationPath = buildAutobaWorkingDirectory(
    prefix,
    uid,
    autobaSessionId,
  );

  if (!await exists(templatePath)) {
    throw new Error(`AutoBA 工作区模板不存在: ${templatePath}`);
  }

  const templateStats = await stat(templatePath);
  if (!templateStats.isDirectory) {
    throw new Error(`AutoBA 工作区模板不是目录: ${templatePath}`);
  }

  if (await exists(destinationPath)) {
    throw new Error(`AutoBA 工作区已存在: ${destinationPath}`);
  }

  await copyDirectory(templatePath, destinationPath);
  await replaceAutobaPlaceholders(destinationPath, base);
  return destinationPath;
}

function isNotFoundError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT",
  );
}

export async function listAutobaWorkspacePaths(
  prefix: string,
): Promise<string[]> {
  const workspaceRoot = getWorkspaceRoot(prefix);
  const results: string[] = [];

  try {
    for await (const uidEntry of readDir(workspaceRoot)) {
      if (!uidEntry.isDirectory) {
        continue;
      }

      const uidPath = `${workspaceRoot}/${uidEntry.name}`;
      for await (const sessionEntry of readDir(uidPath)) {
        if (!sessionEntry.isDirectory) {
          continue;
        }

        results.push(`${uidPath}/${sessionEntry.name}`);
      }
    }
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error;
    }
  }

  return results;
}

async function replaceAutobaPlaceholders(
  rootPath: string,
  replacementPrefix: string,
): Promise<void> {
  for await (const entry of readDir(rootPath)) {
    const entryPath = `${rootPath}/${entry.name}`;
    if (entry.isDirectory) {
      await replaceAutobaPlaceholders(entryPath, replacementPrefix);
      continue;
    }

    if (!entry.isFile) {
      continue;
    }

    await replacePlaceholderInFile(entryPath, replacementPrefix);
  }
}

async function replacePlaceholderInFile(
  filePath: string,
  replacementPrefix: string,
): Promise<void> {
  let content: string;
  try {
    content = await readTextFile(filePath);
  } catch {
    return;
  }

  if (!content.includes(AUTOBA_PREFIX_PLACEHOLDER)) {
    return;
  }

  const updated = content.split(AUTOBA_PREFIX_PLACEHOLDER).join(
    replacementPrefix,
  );

  if (updated !== content) {
    await writeTextFile(filePath, updated);
  }
}

function encodePathForClaude(path: string): string {
  const normalized = trimTrailingSlash(replaceBackslashes(path));
  return normalized.replace(/[/\\:._]/g, "-");
}

function encodedNameMatchesPrefix(encodedName: string, prefix: string): boolean {
  if (!prefix) {
    return false;
  }

  const normalizedPrefix = trimTrailingSlash(replaceBackslashes(prefix));
  if (!normalizedPrefix) {
    return encodedName === "-";
  }

  const encodedPrefix = encodePathForClaude(normalizedPrefix);
  if (!encodedPrefix) {
    return false;
  }

  if (encodedName === encodedPrefix) {
    return true;
  }

  return encodedName.startsWith(`${encodedPrefix}-`);
}

export function matchesAutobaProject(
  projectPath: string,
  encodedName: string,
  prefixes: string[],
): boolean {
  if (!prefixes.length) {
    return false;
  }

  for (const prefix of prefixes) {
    if (pathMatchesPrefix(projectPath, prefix)) {
      return true;
    }

    if (encodedName && encodedNameMatchesPrefix(encodedName, prefix)) {
      return true;
    }
  }

  return false;
}
