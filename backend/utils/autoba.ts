function replaceBackslashes(value: string): string {
  return value.replace(/\\/g, "/");
}

function trimTrailingSlash(value: string): string {
  if (value === "/") {
    return value;
  }
  return value.replace(/\/+$/, "");
}

export function normalizeConfiguredPrefixes(prefixes?: string[]): string[] {
  if (!prefixes) {
    return [];
  }

  return prefixes
    .map((prefix) => prefix.trim())
    .filter((prefix) => prefix.length > 0);
}

export function filterPathsByPrefixes(
  paths: string[],
  prefixes: string[],
): string[] {
  if (!prefixes.length) {
    return [];
  }

  return paths.filter((path) =>
    prefixes.some((prefix) => pathMatchesPrefix(path, prefix))
  );
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
  const normalizedPrefix = trimTrailingSlash(replaceBackslashes(prefix));
  const safeUid = uid.trim();
  const safeSession = autobaSessionId.trim();

  const base = normalizedPrefix.length ? normalizedPrefix : "/";

  return base === "/"
    ? `/${safeUid}/${safeSession}`
    : `${base}/${safeUid}/${safeSession}`;
}
