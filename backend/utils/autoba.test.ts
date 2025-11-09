import { describe, it, expect } from "vitest";
import {
  prepareAutobaWorkspaceFromTemplate,
  buildAutobaWorkingDirectory,
} from "./autoba.ts";
import {
  ensureDir,
  writeTextFile,
  readTextFile,
  withTempDir,
} from "./fs.ts";

describe("AutoBA workspace preparation", () => {
  it("copies template and replaces placeholder tokens", async () => {
    await withTempDir(async (tempDir) => {
      const prefix = `${tempDir}/autoba`; // no trailing slash to simplify expectation
      await ensureDir(`${prefix}/workspace_template/docs`);
      await writeTextFile(
        `${prefix}/workspace_template/docs/info.md`,
        "Path: @%%__AUTOBA_CWD_PREFIX__%%/knowledge-base/doc.md",
      );
      await writeTextFile(
        `${prefix}/workspace_template/plain.txt`,
        "no placeholder",
      );

      const destination = await prepareAutobaWorkspaceFromTemplate(
        prefix,
        "user-a",
        "session-1",
      );

      expect(destination).toBe(
        buildAutobaWorkingDirectory(prefix, "user-a", "session-1"),
      );

      const replaced = await readTextFile(
        `${destination}/docs/info.md`,
      );
      expect(replaced).toContain(
        `@${prefix}/knowledge-base/doc.md`,
      );

      const unchanged = await readTextFile(
        `${destination}/plain.txt`,
      );
      expect(unchanged).toBe("no placeholder");
    });
  });
});
