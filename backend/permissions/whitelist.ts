import type {
  CanUseTool,
  PermissionResult,
} from "@anthropic-ai/claude-agent-sdk";
import { logger } from "../utils/logger.ts";

/**
 * 白名单工具名称
 * 这些工具将被免授权直接执行
 */
const WHITELISTED_TOOLS = new Set([
  "Read",
  "Edit",
  "Write",
  "Bash",
  "Grep",
  "Glob",
  "SlashCommand",
  "Task",
  "TodoWrite",
]);

/**
 * 检查工具是否在白名单中
 */
export function isWhitelistedTool(toolName: string): boolean {
  return WHITELISTED_TOOLS.has(toolName);
}

/**
 * 创建白名单权限处理器
 * 如果工具在白名单中，直接允许执行
 * 否则调用原始的权限处理器
 */
export function createWhitelistPermissionHandler(
  originalHandler?: CanUseTool,
): CanUseTool {
  return async (toolName, input, options) => {
    // 检查工具是否在白名单中
    if (isWhitelistedTool(toolName)) {
      logger.chat.debug("Tool {toolName} is whitelisted, allowing execution", {
        toolName,
      });
      return { allowed: true }; // 直接允许白名单工具执行
    }

    // 如果工具不在白名单中，使用原始处理器
    if (originalHandler) {
      logger.chat.debug(
        "Tool {toolName} is not whitelisted, delegating to original handler",
        { toolName },
      );
      return await originalHandler(toolName, input, options);
    }

    // 如果没有原始处理器且不在白名单中，默认拒绝
    logger.chat.warn(
      "Tool {toolName} is not whitelisted and no original handler provided, denying execution",
      { toolName },
    );
    return { allowed: false };
  };
}
