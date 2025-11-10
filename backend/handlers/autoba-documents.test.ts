import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import {
  handleGetAutobaDocumentRequest,
  handlePutAutobaDocumentRequest,
} from "./autoba-documents.ts";
import { buildAutobaWorkingDirectory } from "../utils/autoba.ts";
import {
  ensureDir,
  readTextFile,
  writeTextFile,
  withTempDir,
} from "../utils/fs.ts";
import type { ConfigContext } from "../middleware/config.ts";

function createTestApp(prefix: string): Hono<ConfigContext> {
  const app = new Hono<ConfigContext>();
  app.use("*", async (c, next) => {
    c.set(
      "config",
      {
        autobaCwdPrefixes: [prefix],
      } as any,
    );
    await next();
  });

  app.get("/api/autoba/documents", handleGetAutobaDocumentRequest);
  app.put("/api/autoba/documents", handlePutAutobaDocumentRequest);
  return app;
}

function buildQuery(params: Record<string, string>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    search.append(key, value);
  }
  return search.toString();
}

describe("autoba documents handler", () => {
  it("GET 返回 Markdown 与 metadata", async () => {
    await withTempDir(async (tempDir) => {
      const prefix = `${tempDir}/autoba`;
      const uid = "user-a";
      const sessionId = "session-1";
      const workspaceRoot = buildAutobaWorkingDirectory(prefix, uid, sessionId);
      await ensureDir(`${workspaceRoot}/output`);
      await writeTextFile(
        `${workspaceRoot}/output/demo.md`,
        "# Title\n\n内容",
      );

      const app = createTestApp(prefix);
      const query = buildQuery({
        relativePath: "./output/demo.md",
        uid,
        autobaSessionId: sessionId,
      });
      const response = await app.request(`/api/autoba/documents?${query}`);
      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload.rawMarkdown).toContain("# Title");
      expect(typeof payload.metadata?.docVersion).toBe("string");
      expect(typeof payload.html).toBe("string");
    });
  });

  it("PUT 写入 Markdown 并返回新版本", async () => {
    await withTempDir(async (tempDir) => {
      const prefix = `${tempDir}/autoba`;
      const uid = "user-b";
      const sessionId = "session-2";
      const workspaceRoot = buildAutobaWorkingDirectory(prefix, uid, sessionId);
      await ensureDir(`${workspaceRoot}/output`);

      const app = createTestApp(prefix);
      const body = {
        relativePath: "./output/spec.md",
        uid,
        autobaSessionId: sessionId,
        rawMarkdown: "# Draft\n- item",
      };
      const response = await app.request("/api/autoba/documents", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload.rawMarkdown).toBe(body.rawMarkdown);
      const written = await readTextFile(
        `${workspaceRoot}/output/spec.md`,
      );
      expect(written).toBe(body.rawMarkdown);
      expect(typeof payload.metadata?.docVersion).toBe("string");
    });
  });

  it("PUT 检测版本冲突", async () => {
    await withTempDir(async (tempDir) => {
      const prefix = `${tempDir}/autoba`;
      const uid = "user-c";
      const sessionId = "session-3";
      const workspaceRoot = buildAutobaWorkingDirectory(prefix, uid, sessionId);
      await ensureDir(`${workspaceRoot}/output`);
      await writeTextFile(
        `${workspaceRoot}/output/conflict.md`,
        "# v1",
      );

      const app = createTestApp(prefix);
      const query = buildQuery({
        relativePath: "./output/conflict.md",
        uid,
        autobaSessionId: sessionId,
      });
      const initial = await app.request(`/api/autoba/documents?${query}`);
      const firstPayload = await initial.json();
      await writeTextFile(
        `${workspaceRoot}/output/conflict.md`,
        "# v2",
      );

      const response = await app.request("/api/autoba/documents", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          relativePath: "./output/conflict.md",
          uid,
          autobaSessionId: sessionId,
          rawMarkdown: "# v3",
          docVersion: firstPayload.metadata.docVersion,
        }),
      });

      expect(response.status).toBe(409);
      const payload = await response.json();
      expect(payload.error).toContain("版本冲突");
    });
  });

  it("非法相对路径被拒绝", async () => {
    await withTempDir(async (tempDir) => {
      const prefix = `${tempDir}/autoba`;
      const uid = "user-d";
      const sessionId = "session-4";
      const app = createTestApp(prefix);
      const query = buildQuery({
        relativePath: "./output/../secret.md",
        uid,
        autobaSessionId: sessionId,
      });

      const response = await app.request(`/api/autoba/documents?${query}`);
      expect(response.status).toBe(400);
      const payload = await response.json();
      expect(payload.error).toContain("非法");
    });
  });
});
