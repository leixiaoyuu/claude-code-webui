import { Context } from "hono";
import MarkdownIt from "markdown-it";
import { createHash } from "node:crypto";
import { dirname, relative, resolve } from "node:path";
import type { ConfigContext } from "../middleware/config.ts";
import { logger } from "../utils/logger.ts";
import {
  normalizeConfiguredPrefixes,
  buildAutobaWorkingDirectory,
  pathMatchesPrefix,
} from "../utils/autoba.ts";
import {
  ensureDir,
  exists,
  readTextFile,
  stat,
  writeTextFile,
  type FileStats,
} from "../utils/fs.ts";

const markdownRenderer = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
});

interface DocumentRequestFields {
  relativePath: string;
  uid: string;
  autobaSessionId: string;
  sessionId?: string;
  spaceId?: string;
  projectPath?: string;
  project?: string;
  workingDirectory?: string;
}

interface DocumentMetadata {
  docVersion: string;
  wordCount: number;
  updatedAt: string;
  size: number;
}

interface ResolvedDocumentPath {
  workspaceRoot: string;
  absolutePath: string;
  normalizedRelativePath: string;
}

function buildErrorResponse(
  c: Context<ConfigContext>,
  status: number,
  message: string,
) {
  return c.json({ error: message }, status);
}

function normalizeRelativePath(relativePath: string): string {
  const trimmed = relativePath?.trim();
  if (!trimmed) {
    throw new Error("relativePath 不能为空");
  }

  const forwardSlashes = trimmed.replace(/\\/g, "/");
  const withoutPrefix = forwardSlashes.replace(/^\.\/+/, "");

  if (!withoutPrefix.startsWith("output/")) {
    throw new Error("文档路径必须位于 ./output/ 目录");
  }

  if (!withoutPrefix.endsWith(".md")) {
    throw new Error("仅支持 .md 文档");
  }

  if (withoutPrefix.split("/").some((segment) => segment === "..")) {
    throw new Error("文档路径包含非法片段");
  }

  return withoutPrefix;
}

function sanitizeUserInput(value?: string | null): string {
  return (value ?? "").trim();
}

function computeMetadata(content: string, stats: FileStats): DocumentMetadata {
  const docVersion = createHash("sha256").update(content).digest("hex");
  const trimmed = content.trim();
  const wordCount = trimmed.length
    ? trimmed.split(/\s+/).filter((token) => token.length).length
    : 0;
  return {
    docVersion,
    wordCount,
    updatedAt: (stats.mtime ?? new Date()).toISOString(),
    size: stats.size,
  };
}

async function resolveDocumentPath(
  fields: DocumentRequestFields,
  prefixes: string[],
): Promise<ResolvedDocumentPath> {
  if (!prefixes.length) {
    throw new Error("未配置 AutoBA 工作区前缀");
  }

  const normalizedRelativePath = normalizeRelativePath(fields.relativePath);
  const candidates = prefixes.map((prefix) => ({
    prefix,
    workspaceRoot: buildAutobaWorkingDirectory(
      prefix,
      fields.uid,
      fields.autobaSessionId,
    ),
  }));

  const preferredPaths = [fields.workingDirectory, fields.projectPath]
    .map(sanitizeUserInput)
    .filter((value) => value.length);

  let selectedRoot = candidates[0];
  if (preferredPaths.length) {
    for (const candidate of candidates) {
      if (
        preferredPaths.some((input) =>
          pathMatchesPrefix(input, candidate.workspaceRoot)
        )
      ) {
        selectedRoot = candidate;
        break;
      }
    }
  }

  const resolvedRoot = resolve(selectedRoot.workspaceRoot);
  const absolutePath = resolve(resolvedRoot, normalizedRelativePath);
  const relativePath = relative(resolvedRoot, absolutePath);

  if (relativePath.startsWith("..")) {
    throw new Error("文档路径越界");
  }

  return {
    workspaceRoot: resolvedRoot,
    absolutePath,
    normalizedRelativePath,
  };
}

function renderMarkdown(content: string): string {
  try {
    return markdownRenderer.render(content);
  } catch (error) {
    logger.api.warn("markdown 渲染失败，返回原始内容", { error });
    return content;
  }
}

function formatRelativePath(relativePath: string): string {
  return `./${relativePath}`;
}

export async function handleGetAutobaDocumentRequest(
  c: Context<ConfigContext>,
) {
  try {
    const fields: DocumentRequestFields = {
      relativePath: sanitizeUserInput(c.req.query("relativePath")),
      uid: sanitizeUserInput(c.req.query("uid")),
      autobaSessionId: sanitizeUserInput(c.req.query("autobaSessionId")),
      sessionId: sanitizeUserInput(c.req.query("sessionId")),
      spaceId: sanitizeUserInput(c.req.query("spaceId")),
      projectPath: sanitizeUserInput(c.req.query("projectPath")),
      project: sanitizeUserInput(c.req.query("project")),
      workingDirectory: sanitizeUserInput(c.req.query("workingDirectory")),
    };

    if (!fields.relativePath) {
      return buildErrorResponse(c, 400, "relativePath 为必填项");
    }
    if (!fields.uid || !fields.autobaSessionId) {
      return buildErrorResponse(c, 400, "uid 与 autobaSessionId 为必填项");
    }

    const config = c.get("config");
    const prefixes = normalizeConfiguredPrefixes(config.autobaCwdPrefixes);
    const resolved = await resolveDocumentPath(fields, prefixes);

    if (!await exists(resolved.absolutePath)) {
      return buildErrorResponse(c, 404, "文档不存在或尚未生成");
    }

    const markdown = await readTextFile(resolved.absolutePath);
    const stats = await stat(resolved.absolutePath);
    const metadata = computeMetadata(markdown, stats);
    const html = renderMarkdown(markdown);

    logger.api.debug("autoBA 文档已加载", {
      relativePath: fields.relativePath,
      uid: fields.uid,
      autobaSessionId: fields.autobaSessionId,
    });

    return c.json({
      relativePath: formatRelativePath(resolved.normalizedRelativePath),
      rawMarkdown: markdown,
      html,
      metadata,
    });
  } catch (error) {
    logger.api.error("autoBA 文档读取失败: {error}", { error });
    const message = error instanceof Error ? error.message : "文档读取失败";
    return buildErrorResponse(c, selectStatusFromMessage(message), message);
  }
}

export async function handlePutAutobaDocumentRequest(
  c: Context<ConfigContext>,
) {
  try {
    const body = await c.req.json() as Record<string, unknown>;
    const fields: DocumentRequestFields = {
      relativePath: sanitizeUserInput(body.relativePath as string),
      uid: sanitizeUserInput(body.uid as string),
      autobaSessionId: sanitizeUserInput(body.autobaSessionId as string),
      sessionId: sanitizeUserInput(body.sessionId as string),
      spaceId: sanitizeUserInput(body.spaceId as string),
      projectPath: sanitizeUserInput(body.projectPath as string),
      project: sanitizeUserInput(body.project as string),
      workingDirectory: sanitizeUserInput(body.workingDirectory as string),
    };

    if (typeof body.rawMarkdown !== "string") {
      return buildErrorResponse(c, 400, "rawMarkdown 不能为空");
    }
    const rawMarkdown = body.rawMarkdown;
    const incomingDocVersion = typeof body.docVersion === "string"
      ? body.docVersion.trim()
      : "";

    if (!fields.relativePath) {
      return buildErrorResponse(c, 400, "relativePath 为必填项");
    }
    if (!fields.uid || !fields.autobaSessionId) {
      return buildErrorResponse(c, 400, "uid 与 autobaSessionId 为必填项");
    }
    const config = c.get("config");
    const prefixes = normalizeConfiguredPrefixes(config.autobaCwdPrefixes);
    const resolved = await resolveDocumentPath(fields, prefixes);

    if (!await exists(resolved.absolutePath)) {
      await ensureDir(dirname(resolved.absolutePath));
    } else if (incomingDocVersion) {
      const currentMarkdown = await readTextFile(resolved.absolutePath);
      const stats = await stat(resolved.absolutePath);
      const existingVersion = computeMetadata(currentMarkdown, stats).docVersion;
      if (incomingDocVersion !== existingVersion) {
        return buildErrorResponse(c, 409, "文档版本冲突，请重新加载");
      }
    }

    await writeTextFile(resolved.absolutePath, rawMarkdown);
    const stats = await stat(resolved.absolutePath);
    const metadata = computeMetadata(rawMarkdown, stats);
    const html = renderMarkdown(rawMarkdown);

    logger.api.info("autoBA 文档已写入", {
      relativePath: fields.relativePath,
      uid: fields.uid,
      autobaSessionId: fields.autobaSessionId,
    });

    return c.json({
      relativePath: formatRelativePath(resolved.normalizedRelativePath),
      rawMarkdown,
      html,
      metadata,
    });
  } catch (error) {
    logger.api.error("autoBA 文档写入失败: {error}", { error });
    const message = error instanceof Error ? error.message : "文档写入失败";
    return buildErrorResponse(c, selectStatusFromMessage(message), message);
  }
}

function selectStatusFromMessage(message: string): number {
  if (message.includes("越界")) {
    return 403;
  }

  if (
    message.includes("必填") ||
    message.includes("不能为空") ||
    message.includes("必须") ||
    message.includes("非法") ||
    message.includes("仅支持")
  ) {
    return 400;
  }

  if (message.includes("不存在")) {
    return 404;
  }

  return 500;
}
