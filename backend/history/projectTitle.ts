import { readDir, readTextFile } from "../utils/fs.ts";

const JSONL_EXTENSION = ".jsonl";
const AGENT_PREFIX = "agent-";
const TITLE_LENGTH = 12;

export async function getProjectTitle(
  projectDir: string,
): Promise<string | undefined> {
  try {
    const firstSessionFile = await findFirstSessionFile(projectDir);
    if (!firstSessionFile) {
      return undefined;
    }

    return await extractTitleFromFile(firstSessionFile);
  } catch {
    return undefined;
  }
}

async function findFirstSessionFile(
  projectDir: string,
): Promise<string | undefined> {
  const sessionFiles: string[] = [];

  for await (const entry of readDir(projectDir)) {
    if (!entry.isFile || !entry.name.endsWith(JSONL_EXTENSION)) {
      continue;
    }

    if (entry.name.startsWith(AGENT_PREFIX)) {
      continue;
    }

    sessionFiles.push(`${projectDir}/${entry.name}`);
  }

  sessionFiles.sort();
  return sessionFiles[0];
}

async function extractTitleFromFile(
  filePath: string,
): Promise<string | undefined> {
  const content = await readTextFile(filePath);
  const firstLine = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  if (!firstLine) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(firstLine) as {
      content?: Array<{ type?: string; text?: string }>;
    };

    const firstTextItem = parsed.content?.find((item) =>
      item?.type === "text" && typeof item.text === "string"
    );

    const text = firstTextItem?.text;
    if (!text) {
      return undefined;
    }

    return text.length > TITLE_LENGTH
      ? text.slice(0, TITLE_LENGTH)
      : text;
  } catch {
    return undefined;
  }
}
