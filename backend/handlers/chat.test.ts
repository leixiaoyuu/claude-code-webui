import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Context } from "hono";
import { handleChatRequest } from "./chat";
import type { ChatRequest } from "../../shared/types";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { globalPermissionRequestManager } from "../permissions/manager";
import * as autobaUtils from "../utils/autoba";

vi.mock("@anthropic-ai/claude-agent-sdk", () => {
  class MockAbortError extends Error {
    constructor(message?: string) {
      super(message);
      this.name = "AbortError";
    }
  }

  return {
    query: vi.fn(),
    AbortError: MockAbortError,
  } as Record<string, unknown>;
});

// Mock logger
vi.mock("../utils/logger", () => ({
  logger: {
    chat: {
      debug: vi.fn(),
      error: vi.fn(),
    },
  },
}));

vi.mock("../utils/autoba.ts", async () => {
  const actual = await vi.importActual<typeof import("../utils/autoba.ts")>(
    "../utils/autoba.ts",
  );
  return {
    ...actual,
    prepareAutobaWorkspaceFromTemplate: vi.fn(),
  };
});

const prepareAutobaWorkspaceFromTemplateMock = vi.mocked(
  autobaUtils.prepareAutobaWorkspaceFromTemplate,
);

const mockQuery = vi.mocked(query);

type QueryCallArgs = {
  prompt: AsyncIterable<any>;
  options?: Record<string, any>;
};

function getLatestQueryCall(): Required<QueryCallArgs> {
  const call = mockQuery.mock.calls.at(-1)?.[0] as QueryCallArgs | undefined;

  if (!call) {
    throw new Error("Claude SDK query was not invoked");
  }

  if (!call.options) {
    throw new Error("Claude SDK query options are missing");
  }

  expect(call.options.includePartialMessages).toBe(true);

  return {
    prompt: call.prompt,
    options: call.options,
  };
}

async function readPromptContent(
  prompt: AsyncIterable<any>,
): Promise<string | undefined> {
  const iterator = prompt[Symbol.asyncIterator]();
  const { value } = await iterator.next();

  if (iterator.return) {
    await iterator.return();
  }

  const content = value?.message?.content;

  if (!content) {
    return undefined;
  }

  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    const textBlock = content.find(
      (item) =>
        item && typeof item === "object" &&
        "type" in item &&
        item.type === "text" &&
        typeof (item as { text?: unknown }).text === "string",
    ) as { text?: string } | undefined;

    return textBlock?.text;
  }

  return undefined;
}

describe("Chat Handler - Permission Mode Tests", () => {
  let mockContext: Context;
  let requestAbortControllers: Map<string, AbortController>;

  beforeEach(() => {
    requestAbortControllers = new Map();

    // Create mock context
    mockContext = {
      req: {
        json: vi.fn(),
        query: vi.fn().mockReturnValue(null),
      },
      json: vi
        .fn()
        .mockImplementation((data: unknown, status = 200) =>
          new Response(JSON.stringify(data), {
            status,
            headers: { "Content-Type": "application/json" },
          })
        ),
      var: {
        config: {
          cliPath: "/path/to/claude-cli",
          defaultWorkingDirectory: undefined,
          autobaCwdPrefixes: [],
        },
      },
    } as any;

    vi.clearAllMocks();
    prepareAutobaWorkspaceFromTemplateMock.mockReset();
    prepareAutobaWorkspaceFromTemplateMock.mockResolvedValue(
      "/autoba/root/workspaces/user-1/session-9",
    );
  });

  afterEach(() => {
    requestAbortControllers.clear();
    globalPermissionRequestManager.clearAll();
  });

  describe("Permission Mode Parameter Handling", () => {
    it("should pass permissionMode 'plan' to Claude SDK", async () => {
      const chatRequest: ChatRequest = {
        message: "Test message",
        requestId: "test-123",
        permissionMode: "plan",
      };

      mockContext.req.json = vi.fn().mockResolvedValue(chatRequest);

      // Mock SDK to return simple message and complete
      mockQuery.mockReturnValue({
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: "assistant",
            message: { content: [{ type: "text", text: "Response" }] },
            session_id: "test-session",
            parent_tool_use_id: null,
          } as any;
        },
        interrupt: vi.fn(),
        next: vi.fn(),
        return: vi.fn(),
        throw: vi.fn(),
      } as any);

      const response = await handleChatRequest(
        mockContext,
        requestAbortControllers,
      );

      const queryCall = getLatestQueryCall();
      expect(await readPromptContent(queryCall.prompt)).toBe("Test message");
      expect(queryCall.options).toMatchObject({
        permissionMode: "plan",
        executable: "node",
        executableArgs: [],
        pathToClaudeCodeExecutable: "/path/to/claude-cli",
      });
      expect(queryCall.options.abortController).toBeInstanceOf(AbortController);

      expect(response).toBeInstanceOf(Response);
      expect(response.headers.get("Content-Type")).toBe("application/x-ndjson");
    });

    it("should always include project/user settingSources", async () => {
      const chatRequest: ChatRequest = {
        message: "With MCP",
        requestId: "test-setting-sources",
      };

      mockContext.req.json = vi.fn().mockResolvedValue(chatRequest);

      mockQuery.mockReturnValue({
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: "assistant",
            message: { content: [{ type: "text", text: "Response" }] },
            session_id: "test-session",
            parent_tool_use_id: null,
          } as any;
        },
        interrupt: vi.fn(),
        next: vi.fn(),
        return: vi.fn(),
        throw: vi.fn(),
      } as any);

      await handleChatRequest(mockContext, requestAbortControllers);

      const queryCall = getLatestQueryCall();
      expect(queryCall.options.settingSources).toEqual(["project", "user"]);
    });

    it("should pass permissionMode 'acceptEdits' to Claude SDK", async () => {
      const chatRequest: ChatRequest = {
        message: "Test message",
        requestId: "test-456",
        permissionMode: "acceptEdits",
      };

      mockContext.req.json = vi.fn().mockResolvedValue(chatRequest);

      mockQuery.mockReturnValue({
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: "assistant",
            message: { content: [{ type: "text", text: "Response" }] },
            session_id: "test-session",
            parent_tool_use_id: null,
          } as any;
        },
        interrupt: vi.fn(),
        next: vi.fn(),
        return: vi.fn(),
        throw: vi.fn(),
      } as any);

      await handleChatRequest(mockContext, requestAbortControllers);

      const queryCall = getLatestQueryCall();
      expect(await readPromptContent(queryCall.prompt)).toBe("Test message");
      expect(queryCall.options.permissionMode).toBe("acceptEdits");
    });

    it("should pass permissionMode 'default' to Claude SDK", async () => {
      const chatRequest: ChatRequest = {
        message: "Test message",
        requestId: "test-789",
        permissionMode: "default",
      };

      mockContext.req.json = vi.fn().mockResolvedValue(chatRequest);

      mockQuery.mockReturnValue({
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: "assistant",
            message: { content: [{ type: "text", text: "Response" }] },
            session_id: "test-session",
            parent_tool_use_id: null,
          } as any;
        },
        interrupt: vi.fn(),
        next: vi.fn(),
        return: vi.fn(),
        throw: vi.fn(),
      } as any);

      await handleChatRequest(mockContext, requestAbortControllers);

      const queryCall = getLatestQueryCall();
      expect(await readPromptContent(queryCall.prompt)).toBe("Test message");
      expect(queryCall.options.permissionMode).toBe("default");
    });

    it("should default permissionMode to 'bypassPermissions' when undefined", async () => {
      const chatRequest: ChatRequest = {
        message: "Test message",
        requestId: "test-undefined",
        // permissionMode is undefined
      };

      mockContext.req.json = vi.fn().mockResolvedValue(chatRequest);

      mockQuery.mockReturnValue({
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: "assistant",
            message: { content: [{ type: "text", text: "Response" }] },
            session_id: "test-session",
            parent_tool_use_id: null,
          } as any;
        },
        interrupt: vi.fn(),
        next: vi.fn(),
        return: vi.fn(),
        throw: vi.fn(),
      } as any);

      await handleChatRequest(mockContext, requestAbortControllers);

      const queryCall = getLatestQueryCall();
      expect(queryCall.options.permissionMode).toBe("bypassPermissions");
    });

    it("should handle permissionMode alongside other parameters", async () => {
      const chatRequest: ChatRequest = {
        message: "Test message with all params",
        requestId: "test-all-params",
        sessionId: "session-123",
        allowedTools: ["Bash", "Edit"],
        workingDirectory: "/project/path",
        permissionMode: "plan",
      };

      mockContext.req.json = vi.fn().mockResolvedValue(chatRequest);

      mockQuery.mockReturnValue({
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: "assistant",
            message: { content: [{ type: "text", text: "Response" }] },
            session_id: "test-session",
            parent_tool_use_id: null,
          } as any;
        },
        interrupt: vi.fn(),
        next: vi.fn(),
        return: vi.fn(),
        throw: vi.fn(),
      } as any);

      await handleChatRequest(mockContext, requestAbortControllers);

      const queryCall = getLatestQueryCall();
      expect(await readPromptContent(queryCall.prompt)).toBe(
        "Test message with all params",
      );
      expect(queryCall.options).toMatchObject({
        permissionMode: "plan",
        resume: "session-123",
        allowedTools: ["Bash", "Edit"],
        cwd: "/project/path",
        executable: "node",
        executableArgs: [],
        pathToClaudeCodeExecutable: "/path/to/claude-cli",
      });
      expect(queryCall.options.abortController).toBeInstanceOf(AbortController);
    });
  });

  describe("Working directory handling", () => {
    beforeEach(() => {
      mockContext.var.config.defaultWorkingDirectory = undefined;
    });

    it("should use request workingDirectory even if default exists", async () => {
      mockContext.var.config.defaultWorkingDirectory = "/server/default";

      const chatRequest: ChatRequest = {
        message: "Use request cwd",
        requestId: "cwd-request",
        workingDirectory: "/request/path",
      };

      mockContext.req.json = vi.fn().mockResolvedValue(chatRequest);

      mockQuery.mockReturnValue({
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: "assistant",
            message: { content: [{ type: "text", text: "Response" }] },
            session_id: "test-session",
            parent_tool_use_id: null,
          } as any;
        },
        interrupt: vi.fn(),
        next: vi.fn(),
        return: vi.fn(),
        throw: vi.fn(),
      } as any);

      await handleChatRequest(mockContext, requestAbortControllers);

      const queryCall = getLatestQueryCall();
      expect(queryCall.options.cwd).toBe("/request/path");
    });

    it("should fall back to default workingDirectory when request omits it", async () => {
      mockContext.var.config.defaultWorkingDirectory = "/server/default";

      const chatRequest: ChatRequest = {
        message: "Use default cwd",
        requestId: "cwd-default",
      };

      mockContext.req.json = vi.fn().mockResolvedValue(chatRequest);

      mockQuery.mockReturnValue({
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: "assistant",
            message: { content: [{ type: "text", text: "Response" }] },
            session_id: "test-session",
            parent_tool_use_id: null,
          } as any;
        },
        interrupt: vi.fn(),
        next: vi.fn(),
        return: vi.fn(),
        throw: vi.fn(),
      } as any);

      await handleChatRequest(mockContext, requestAbortControllers);

      const queryCall = getLatestQueryCall();
      expect(queryCall.options.cwd).toBe("/server/default");
    });

    it("should omit cwd when neither request nor default is provided", async () => {
      const chatRequest: ChatRequest = {
        message: "No cwd",
        requestId: "cwd-none",
      };

      mockContext.req.json = vi.fn().mockResolvedValue(chatRequest);

      mockQuery.mockReturnValue({
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: "assistant",
            message: { content: [{ type: "text", text: "Response" }] },
            session_id: "test-session",
            parent_tool_use_id: null,
          } as any;
        },
        interrupt: vi.fn(),
        next: vi.fn(),
        return: vi.fn(),
        throw: vi.fn(),
      } as any);

      await handleChatRequest(mockContext, requestAbortControllers);

      const queryCall = getLatestQueryCall();
      expect(queryCall.options).not.toHaveProperty("cwd");
    });
  });

  describe("AutoBA working directory handling", () => {
    beforeEach(() => {
      mockContext.var.config.autobaCwdPrefixes = ["/autoba/root"];
    });

    function enableAutoBAQuery() {
      mockContext.req.query = vi
        .fn()
        .mockImplementation((key: string) =>
          key === "isAutoBA" ? "true" : null
        );
    }

    it("should override cwd using AutoBA uid and session", async () => {
      enableAutoBAQuery();

      const chatRequest: ChatRequest = {
        message: "AutoBA session",
        requestId: "autoba-1",
        uid: "user-1",
        autobaSessionId: "session-9",
      };

      mockContext.req.json = vi.fn().mockResolvedValue(chatRequest);

      mockQuery.mockReturnValue({
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: "assistant",
            message: { content: [{ type: "text", text: "Response" }] },
            session_id: "test-session",
            parent_tool_use_id: null,
          } as any;
        },
        interrupt: vi.fn(),
        next: vi.fn(),
        return: vi.fn(),
        throw: vi.fn(),
      } as any);

      await handleChatRequest(mockContext, requestAbortControllers);

      const queryCall = getLatestQueryCall();
      expect(queryCall.options.cwd).toBe(
        "/autoba/root/workspaces/user-1/session-9",
      );
      expect(prepareAutobaWorkspaceFromTemplateMock).toHaveBeenCalledWith(
        "/autoba/root",
        "user-1",
        "session-9",
      );
    });

    it("should reject AutoBA requests missing identifiers", async () => {
      enableAutoBAQuery();

      const chatRequest: ChatRequest = {
        message: "missing ids",
        requestId: "autoba-2",
        uid: "user-1",
      };

      mockContext.req.json = vi.fn().mockResolvedValue(chatRequest);

      const response = await handleChatRequest(
        mockContext,
        requestAbortControllers,
      );

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body).toEqual({
        error: "AutoBA 请求需要提供 uid 与 autobaSessionId",
      });
    });

    it("should reject AutoBA requests when prefixes are missing", async () => {
      enableAutoBAQuery();
      mockContext.var.config.autobaCwdPrefixes = [];

      const chatRequest: ChatRequest = {
        message: "no prefix",
        requestId: "autoba-3",
        uid: "user-1",
        autobaSessionId: "session-x",
      };

      mockContext.req.json = vi.fn().mockResolvedValue(chatRequest);

      const response = await handleChatRequest(
        mockContext,
        requestAbortControllers,
      );

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body).toEqual({
        error: "AutoBA 前缀未配置",
      });
    });

    it("should reuse AutoBA workspace when sessionId is provided", async () => {
      enableAutoBAQuery();

      const chatRequest: ChatRequest = {
        message: "resume session",
        requestId: "autoba-resume",
        sessionId: "claude-1",
        uid: "user-1",
        autobaSessionId: "session-z",
      };

      mockContext.req.json = vi.fn().mockResolvedValue(chatRequest);

      mockQuery.mockReturnValue({
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: "assistant",
            message: { content: [{ type: "text", text: "Response" }] },
            session_id: "test-session",
            parent_tool_use_id: null,
          } as any;
        },
        interrupt: vi.fn(),
        next: vi.fn(),
        return: vi.fn(),
        throw: vi.fn(),
      } as any);

      await handleChatRequest(mockContext, requestAbortControllers);

      const queryCall = getLatestQueryCall();
      expect(queryCall.options.cwd).toBe(
        "/autoba/root/workspaces/user-1/session-z",
      );
      expect(prepareAutobaWorkspaceFromTemplateMock).not.toHaveBeenCalled();
    });

    it("should return error when workspace template fails to copy", async () => {
      enableAutoBAQuery();

      prepareAutobaWorkspaceFromTemplateMock.mockRejectedValueOnce(
        new Error("template missing"),
      );

      const chatRequest: ChatRequest = {
        message: "copy fail",
        requestId: "autoba-5",
        uid: "user-1",
        autobaSessionId: "session-y",
      };

      mockContext.req.json = vi.fn().mockResolvedValue(chatRequest);

      const response = await handleChatRequest(
        mockContext,
        requestAbortControllers,
      );

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body).toEqual({
        error: "AutoBA 工作区初始化失败: template missing",
      });
    });
  });

  describe("Message Processing with Permission Mode", () => {
    it("should process slash commands with permissionMode", async () => {
      const chatRequest: ChatRequest = {
        message: "/help",
        requestId: "test-slash",
        permissionMode: "plan",
      };

      mockContext.req.json = vi.fn().mockResolvedValue(chatRequest);

      mockQuery.mockReturnValue({
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: "assistant",
            message: { content: [{ type: "text", text: "Help response" }] },
            session_id: "test-session",
            parent_tool_use_id: null,
          } as any;
        },
        interrupt: vi.fn(),
        next: vi.fn(),
        return: vi.fn(),
        throw: vi.fn(),
      } as any);

      await handleChatRequest(mockContext, requestAbortControllers);

      const queryCall = getLatestQueryCall();
      expect(await readPromptContent(queryCall.prompt)).toBe("help");
      expect(queryCall.options.permissionMode).toBe("plan");
    });

    it("should handle regular messages with permissionMode", async () => {
      const chatRequest: ChatRequest = {
        message: "Regular message",
        requestId: "test-regular",
        permissionMode: "acceptEdits",
      };

      mockContext.req.json = vi.fn().mockResolvedValue(chatRequest);

      mockQuery.mockReturnValue({
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: "assistant",
            message: { content: [{ type: "text", text: "Regular response" }] },
            session_id: "test-session",
            parent_tool_use_id: null,
          } as any;
        },
        interrupt: vi.fn(),
        next: vi.fn(),
        return: vi.fn(),
        throw: vi.fn(),
      } as any);

      await handleChatRequest(mockContext, requestAbortControllers);

      const queryCall = getLatestQueryCall();
      expect(await readPromptContent(queryCall.prompt)).toBe(
        "Regular message",
      );
      expect(queryCall.options.permissionMode).toBe("acceptEdits");
    });
  });

  describe("Stream Response Generation", () => {
    it("should yield SDK messages with permissionMode context", async () => {
      const chatRequest: ChatRequest = {
        message: "Test streaming",
        requestId: "test-stream",
        permissionMode: "plan",
      };

      mockContext.req.json = vi.fn().mockResolvedValue(chatRequest);

      const mockMessages = [
        {
          type: "system",
          subtype: "init",
          cwd: "/test",
          tools: [],
          session_id: "test",
          apiKeySource: "env",
          mcp_servers: {},
          model: "test",
          is_resuming: false,
        } as any,
        {
          type: "assistant",
          message: { content: [{ type: "text", text: "Streaming response" }] },
          session_id: "test",
          parent_tool_use_id: null,
        } as any,
        {
          type: "result",
          subtype: "success",
          usage: { input_tokens: 10, output_tokens: 5 },
          session_id: "test",
        } as any,
      ];

      mockQuery.mockReturnValue({
        [Symbol.asyncIterator]: async function* () {
          for (const message of mockMessages) {
            yield message;
          }
        },
        interrupt: vi.fn(),
        next: vi.fn(),
        return: vi.fn(),
        throw: vi.fn(),
      } as any);

      const response = await handleChatRequest(
        mockContext,
        requestAbortControllers,
      );
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();

      let allChunks = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        allChunks += decoder.decode(value);
      }

      const lines = allChunks.trim().split("\n");
      expect(lines).toHaveLength(4); // 3 SDK messages + 1 done message

      // Parse each line to verify structure
      const parsedLines = lines.map((line) => JSON.parse(line));

      expect(parsedLines[0]).toEqual({
        type: "claude_json",
        data: mockMessages[0],
      });

      expect(parsedLines[1]).toEqual({
        type: "claude_json",
        data: mockMessages[1],
      });

      expect(parsedLines[2]).toEqual({
        type: "claude_json",
        data: mockMessages[2],
      });

      expect(parsedLines[3]).toEqual({
        type: "done",
      });
    });
  });

  describe("Error Handling with Permission Mode", () => {
    it("should handle SDK errors when using permissionMode", async () => {
      const chatRequest: ChatRequest = {
        message: "Error test",
        requestId: "test-error",
        permissionMode: "plan",
      };

      mockContext.req.json = vi.fn().mockResolvedValue(chatRequest);

      mockQuery.mockReturnValue({
        [Symbol.asyncIterator]: async function* () {
          throw new Error("SDK execution failed");
        },
        interrupt: vi.fn(),
        next: vi.fn(),
        return: vi.fn(),
        throw: vi.fn(),
      } as any);

      const response = await handleChatRequest(
        mockContext,
        requestAbortControllers,
      );
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();

      let allChunks = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        allChunks += decoder.decode(value);
      }

      const lines = allChunks.trim().split("\n");
      expect(lines).toHaveLength(1);

      const errorResponse = JSON.parse(lines[0]);
      expect(errorResponse).toEqual({
        type: "error",
        error: "SDK execution failed",
      });
    });

    // TODO: Re-enable when AbortError is properly exported from Claude SDK
    it.skip("should handle abort errors when using permissionMode", async () => {
      // Test currently skipped because AbortError is not exported from Claude SDK
      // When AbortError becomes available, update this test accordingly
      const chatRequest: ChatRequest = {
        message: "Abort test",
        requestId: "test-abort",
        permissionMode: "acceptEdits",
      };

      mockContext.req.json = vi.fn().mockResolvedValue(chatRequest);

      mockQuery.mockReturnValue({
        [Symbol.asyncIterator]: async function* () {
          throw new Error("Operation aborted");
        },
        interrupt: vi.fn(),
        next: vi.fn(),
        return: vi.fn(),
        throw: vi.fn(),
      } as any);

      const response = await handleChatRequest(
        mockContext,
        requestAbortControllers,
      );
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();

      let allChunks = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        allChunks += decoder.decode(value);
      }

      const lines = allChunks.trim().split("\n");
      expect(lines).toHaveLength(1);

      const errorResponse = JSON.parse(lines[0]);
      expect(errorResponse).toEqual({
        type: "error",
        error: "Operation aborted",
      });
    });
  });

  describe("Abort Controller Management with Permission Mode", () => {
    it("should manage abort controller correctly with permissionMode", async () => {
      const chatRequest: ChatRequest = {
        message: "Controller test",
        requestId: "test-controller",
        permissionMode: "plan",
      };

      mockContext.req.json = vi.fn().mockResolvedValue(chatRequest);

      mockQuery.mockReturnValue({
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: "assistant",
            message: { content: [{ type: "text", text: "Response" }] },
            session_id: "test-session",
            parent_tool_use_id: null,
          } as any;
        },
        interrupt: vi.fn(),
        next: vi.fn(),
        return: vi.fn(),
        throw: vi.fn(),
      } as any);

      expect(requestAbortControllers.size).toBe(0);

      const response = await handleChatRequest(
        mockContext,
        requestAbortControllers,
      );

      // Read the response to ensure the generator completes
      const reader = response.body!.getReader();
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }

      // Controller should be cleaned up after completion
      expect(requestAbortControllers.size).toBe(0);
    });

    it("should store and retrieve abort controller during execution", async () => {
      const chatRequest: ChatRequest = {
        message: "Controller tracking",
        requestId: "test-tracking",
        permissionMode: "acceptEdits",
      };

      mockContext.req.json = vi.fn().mockResolvedValue(chatRequest);

      let capturedController: AbortController | null = null;

      mockQuery.mockImplementation(
        (args: any) =>
          ({
            [Symbol.asyncIterator]: async function* () {
              capturedController = args.options.abortController;
              expect(requestAbortControllers.has("test-tracking")).toBe(true);
              yield {
                type: "assistant",
                message: { content: [{ type: "text", text: "Response" }] },
                session_id: "test-session",
                parent_tool_use_id: null,
              } as any;
            },
            interrupt: vi.fn(),
            next: vi.fn(),
            return: vi.fn(),
            throw: vi.fn(),
          }) as any,
      );

      await handleChatRequest(mockContext, requestAbortControllers);

      expect(capturedController).toBeInstanceOf(AbortController);
    });
  });

  it("should attach canUseTool handler for permission bridging", async () => {
    const chatRequest: ChatRequest = {
      message: "Test",
      requestId: "permission-check",
    };

    mockContext.req.json = vi.fn().mockResolvedValue(chatRequest);

    mockQuery.mockReturnValue({
      [Symbol.asyncIterator]: async function* () {
        yield {
          type: "assistant",
          message: { content: [{ type: "text", text: "Response" }] },
          session_id: "session",
          parent_tool_use_id: null,
        } as any;
      },
      interrupt: vi.fn(),
      next: vi.fn(),
      return: vi.fn(),
      throw: vi.fn(),
    } as any);

    await handleChatRequest(mockContext, requestAbortControllers);

    const queryCall = getLatestQueryCall();
    expect(typeof queryCall.options.canUseTool).toBe("function");
  });
});
