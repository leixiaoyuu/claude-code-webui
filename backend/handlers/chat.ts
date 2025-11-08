import { Context } from "hono";
import {
  AbortError,
  query,
  type PermissionMode,
  type CanUseTool,
} from "@anthropic-ai/claude-agent-sdk";
import type { ChatRequest, StreamResponse } from "../../shared/types.ts";
import { logger } from "../utils/logger.ts";
import {
  PermissionRequestManager,
  globalPermissionRequestManager,
} from "../permissions/manager.ts";

/**
 * Executes a Claude command and yields streaming responses
 * @param message - User message or command
 * @param requestId - Unique request identifier for abort functionality
 * @param requestAbortControllers - Shared map of abort controllers
 * @param cliPath - Path to actual CLI script (detected by validateClaudeCli)
 * @param sessionId - Optional session ID for conversation continuity
 * @param allowedTools - Optional array of allowed tool names
 * @param workingDirectory - Optional working directory for Claude execution
 * @param permissionMode - Optional permission mode for Claude execution
 * @returns AsyncGenerator yielding StreamResponse objects
 */
async function* executeClaudeCommand(
  message: string,
  requestId: string,
  requestAbortControllers: Map<string, AbortController>,
  cliPath: string,
  sessionId?: string,
  allowedTools?: string[],
  workingDirectory?: string,
  permissionMode?: PermissionMode,
  permissionManager?: PermissionRequestManager,
  sendStreamResponse?: (chunk: StreamResponse) => void,
): AsyncGenerator<StreamResponse> {
  let abortController: AbortController;
  const emitStreamResponse =
    sendStreamResponse ?? (() => {
      /* noop */
    });

  const buildPermissionHandler = (): CanUseTool | undefined => {
    if (!permissionManager) {
      return undefined;
    }

    return async (toolName, input, options) => {
      const { payload, resultPromise, permissionRequestId } =
        permissionManager.createRequest({
          requestId,
          sessionId,
          toolName,
          input,
          suggestions: options.suggestions,
        });

      logger.chat.debug("Permission requested for tool {toolName}", {
        toolName,
        permissionRequestId,
      });

      emitStreamResponse({
        type: "permission_request",
        data: payload,
      });

      const onAbort = () => {
        permissionManager.rejectRequest(
          permissionRequestId,
          new AbortError("Permission request aborted"),
        );
      };

      options.signal.addEventListener("abort", onAbort, { once: true });

      try {
        return await resultPromise;
      } finally {
        options.signal.removeEventListener("abort", onAbort);
      }
    };
  };

  const canUseTool = buildPermissionHandler();

  try {
    // Process commands that start with '/'
    let processedMessage = message;
    if (message.startsWith("/")) {
      // Remove the '/' and send just the command
      processedMessage = message.substring(1);
    }

    // Create and store AbortController for this request
    abortController = new AbortController();
    requestAbortControllers.set(requestId, abortController);

    for await (const sdkMessage of query({
      prompt: processedMessage,
      options: {
        abortController,
        executable: "node" as const,
        executableArgs: [],
        pathToClaudeCodeExecutable: cliPath,
        ...(sessionId ? { resume: sessionId } : {}),
        ...(allowedTools ? { allowedTools } : {}),
        ...(workingDirectory ? { cwd: workingDirectory } : {}),
        ...(permissionMode ? { permissionMode } : {}),
        ...(canUseTool ? { canUseTool } : {}),
      },
    })) {
      // Debug logging of raw SDK messages with detailed content
      logger.chat.debug("Claude SDK Message: {sdkMessage}", { sdkMessage });

      yield {
        type: "claude_json",
        data: sdkMessage,
      };
    }

    yield { type: "done" };
  } catch (error) {
    if (error instanceof AbortError) {
      logger.chat.debug("Claude Code request aborted by user");
      yield { type: "aborted" };
    } else {
      logger.chat.error("Claude Code execution failed: {error}", { error });
      yield {
        type: "error",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  } finally {
    // Clean up AbortController from map
    if (requestAbortControllers.has(requestId)) {
      requestAbortControllers.delete(requestId);
    }

    if (permissionManager) {
      permissionManager.rejectRequestsForChatRequest(
        requestId,
        new AbortError("Chat request ended before permission resolution"),
      );
    }
  }
}

/**
 * Handles POST /api/chat requests with streaming responses
 * @param c - Hono context object with config variables
 * @param requestAbortControllers - Shared map of abort controllers
 * @returns Response with streaming NDJSON
 */
export async function handleChatRequest(
  c: Context,
  requestAbortControllers: Map<string, AbortController>,
  permissionRequestManager: PermissionRequestManager =
    globalPermissionRequestManager,
) {
  const chatRequest: ChatRequest = await c.req.json();
  const { cliPath } = c.var.config;

  logger.chat.debug(
    "Received chat request {*}",
    chatRequest as unknown as Record<string, unknown>,
  );

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const sendChunk = (chunk: StreamResponse) => {
        const data = JSON.stringify(chunk) + "\n";
        controller.enqueue(encoder.encode(data));
      };

      try {
        for await (const chunk of executeClaudeCommand(
          chatRequest.message,
          chatRequest.requestId,
          requestAbortControllers,
          cliPath, // Use detected CLI path from validateClaudeCli
          chatRequest.sessionId,
          chatRequest.allowedTools,
          chatRequest.workingDirectory,
          chatRequest.permissionMode,
          permissionRequestManager,
          sendChunk,
        )) {
          sendChunk(chunk);
        }
        controller.close();
      } catch (error) {
        const errorResponse: StreamResponse = {
          type: "error",
          error: error instanceof Error ? error.message : String(error),
        };
        sendChunk(errorResponse);
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
