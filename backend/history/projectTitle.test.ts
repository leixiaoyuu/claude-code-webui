import { describe, it, expect } from "vitest";
import { getProjectTitle } from "./projectTitle.ts";
import {
  ensureDir,
  writeTextFile,
  withTempDir,
} from "../utils/fs.ts";

describe("getProjectTitle", () => {
  it("returns first session text truncated to 12 chars", async () => {
    await withTempDir(async (tempDir) => {
      const projectDir = `${tempDir}/project`;
      await ensureDir(projectDir);

      await writeTextFile(
        `${projectDir}/agent-helper.jsonl`,
        '{"content":[{"type":"text","text":"should be ignored"}]}',
      );

      await writeTextFile(
        `${projectDir}/2024-session.jsonl`,
        [
          JSON.stringify({
            content: [
              {
                type: "text",
                text: "今天上海天气怎么样以及需要准备什么衣服",
              },
            ],
          }),
          "",
        ].join("\n"),
      );

      await writeTextFile(
        `${projectDir}/2025-session.jsonl`,
        '{"content":[{"type":"text","text":"later session"}]}'
      );

      const fullText = "今天上海天气怎么样以及需要准备什么衣服";
      const title = await getProjectTitle(projectDir);

      expect(title).toBe(fullText.slice(0, 12));
    });
  });

  it("returns undefined when no valid session files exist", async () => {
    await withTempDir(async (tempDir) => {
      const projectDir = `${tempDir}/empty`;
      await ensureDir(projectDir);

      await writeTextFile(
        `${projectDir}/agent-only.jsonl`,
        '{"content":[{"type":"text","text":"ignored"}]}'
      );

      const title = await getProjectTitle(projectDir);
      expect(title).toBeUndefined();
    });
  });
});
