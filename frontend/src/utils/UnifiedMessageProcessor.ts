import type {
  AllMessage,
  ChatMessage,
  SubagentMessage,
  ThinkingMessage,
  SDKMessage,
  SDKStreamEventMessage,
  TimestampedSDKMessage,
} from "../types";
import {
  convertSystemMessage,
  convertResultMessage,
  createToolMessage,
  createToolResultMessage,
  createThinkingMessage,
  createTodoMessageFromInput,
} from "./messageConversion";
import { isThinkingContentItem } from "./messageTypes";
import { extractToolInfo, generateToolPatterns } from "./toolUtils";

/**
 * Tool cache interface for tracking tool_use information
 */
interface ToolCache {
  name: string;
  input: Record<string, unknown>;
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

/**
 * Processing context interface for streaming use case
 */
export interface ProcessingContext {
  // Core message handling
  addMessage: (message: AllMessage) => void;
  updateLastMessage?: (content: string, messageType?: AllMessage["type"]) => void;
  updateThinkingMessage?: (
    message: ThinkingMessage,
    content: string,
    timestamp?: number,
  ) => ThinkingMessage;

  // Current assistant message state (for streaming)
  currentAssistantMessage?: ChatMessage | null;
  getCurrentAssistantMessage?: () => ChatMessage | null;
  setCurrentAssistantMessage?: (message: ChatMessage | null) => void;

  // Session handling
  onSessionId?: (sessionId: string) => void;
  hasReceivedInit?: boolean;
  setHasReceivedInit?: (received: boolean) => void;

  // Init message handling
  shouldShowInitMessage?: () => boolean;
  onInitMessageShown?: () => void;

  // Permission/Error handling
  onPermissionError?: (
    toolName: string,
    patterns: string[],
    toolUseId: string,
  ) => void;
  onAbortRequest?: () => void;
}

/**
 * Processing options for different use cases
 */
export interface ProcessingOptions {
  /** Whether this is streaming mode (vs batch history processing) */
  isStreaming?: boolean;
  /** Override timestamp for batch processing */
  timestamp?: number;
}

/**
 * Helper function to detect tool use errors that should be displayed as regular results
 */
function isToolUseError(content: string): boolean {
  return content.includes("tool_use_error");
}

/**
 * Unified Message Processor
 *
 * This class provides consistent message processing logic for both
 * streaming and history loading scenarios, ensuring identical output
 * regardless of the data source.
 */
export class UnifiedMessageProcessor {
  private toolUseCache = new Map<string, ToolCache>();
  private thinkingStreamCache = new Map<number, ThinkingMessage>();
  private thinkingStreamOrder: number[] = [];
  private thinkingStreamOrderSet = new Set<number>();
  private lastThinkingMessage: ThinkingMessage | null = null;

  /**
   * Clear the tool use cache
   */
  public clearCache(): void {
    this.toolUseCache.clear();
    this.resetThinkingStreams();
  }

  private resetThinkingStreams(): void {
    this.thinkingStreamCache.clear();
    this.thinkingStreamOrder = [];
    this.thinkingStreamOrderSet.clear();
    this.lastThinkingMessage = null;
  }

  private trackThinkingIndex(index: number): void {
    if (this.thinkingStreamOrderSet.has(index)) {
      return;
    }

    this.thinkingStreamOrderSet.add(index);
    this.thinkingStreamOrder.push(index);
  }

  private updateThinkingMessageInstance(
    message: ThinkingMessage,
    content: string,
    timestamp: number,
    context: ProcessingContext,
  ): ThinkingMessage {
    let updatedMessage = message;

    if (context.updateThinkingMessage) {
      updatedMessage = context.updateThinkingMessage(
        message,
        content,
        timestamp,
      );
    } else {
      updatedMessage = {
        ...message,
        content,
        timestamp,
      };
    }

    context.updateLastMessage?.(content, "thinking");

    return updatedMessage;
  }

  private handleThinkingDelta(
    index: number,
    deltaText: string,
    context: ProcessingContext,
    options: ProcessingOptions,
  ): void {
    if (!deltaText) {
      return;
    }

    const timestamp = options.timestamp || Date.now();
    const existingMessage = this.thinkingStreamCache.get(index);

    if (!existingMessage) {
      const thinkingMessage = createThinkingMessage(deltaText, timestamp);
      this.thinkingStreamCache.set(index, thinkingMessage);
      this.trackThinkingIndex(index);
      context.addMessage(thinkingMessage);
      this.lastThinkingMessage = thinkingMessage;
      return;
    }

    const updatedContent = `${existingMessage.content}${deltaText}`;
    const updatedMessage = this.updateThinkingMessageInstance(
      existingMessage,
      updatedContent,
      timestamp,
      context,
    );
    this.thinkingStreamCache.set(index, updatedMessage);
    this.lastThinkingMessage = updatedMessage;
  }

  private consumeThinkingStream(
    content: string,
    context: ProcessingContext,
    timestamp: number,
  ): boolean {
    if (this.thinkingStreamOrder.length) {
      const index = this.thinkingStreamOrder.shift();
      if (typeof index === "number") {
        this.thinkingStreamOrderSet.delete(index);
        const existingMessage = this.thinkingStreamCache.get(index);
        if (existingMessage) {
          const updatedMessage = this.updateThinkingMessageInstance(
            existingMessage,
            content,
            timestamp,
            context,
          );
          this.thinkingStreamCache.delete(index);
          this.lastThinkingMessage = updatedMessage;
          return true;
        }
      }
    }

    if (this.lastThinkingMessage) {
      const updatedMessage = this.updateThinkingMessageInstance(
        this.lastThinkingMessage,
        content,
        timestamp,
        context,
      );
      this.lastThinkingMessage = updatedMessage;
      return true;
    }

    return false;
  }

  /**
   * Store tool_use information for later correlation with tool_result
   */
  private cacheToolUse(
    id: string,
    name: string,
    input: Record<string, unknown>,
  ): void {
    this.toolUseCache.set(id, { name, input });
  }

  /**
   * Retrieve cached tool_use information
   */
  private getCachedToolInfo(id: string): ToolCache | undefined {
    return this.toolUseCache.get(id);
  }

  /**
   * Create a dedicated subagent message for Task tool delegations
   */
  private createSubagentTaskMessage(
    content: string,
    parentToolUseId: string | null,
    timestamp: number,
    toolInfo?: ToolCache,
    role?: string,
  ): SubagentMessage | null {
    if (!parentToolUseId || !toolInfo || toolInfo.name !== "Task") {
      return null;
    }

    const description = getString(toolInfo.input["description"]);
    const subagentName = getString(toolInfo.input["subagent_type"]);
    const model = getString(toolInfo.input["model"]);

    return {
      type: "subagent",
      variant: role === "assistant" ? "response" : "request",
      toolUseId: parentToolUseId,
      toolName: toolInfo.name,
      content,
      timestamp,
      taskDescription: description,
      subagentName,
      model,
    } satisfies SubagentMessage;
  }

  /**
   * Handle permission errors during streaming
   */
  private handlePermissionError(
    contentItem: { tool_use_id?: string; content: string },
    context: ProcessingContext,
  ): void {
    // Immediately abort the current request
    if (context.onAbortRequest) {
      context.onAbortRequest();
    }

    // Get cached tool_use information
    const toolUseId = contentItem.tool_use_id || "";
    const cachedToolInfo = this.getCachedToolInfo(toolUseId);

    // Extract tool information for permission handling
    const { toolName, commands } = extractToolInfo(
      cachedToolInfo?.name,
      cachedToolInfo?.input,
    );

    // Compute patterns based on tool type
    const patterns = generateToolPatterns(toolName, commands);

    // Notify parent component about permission error
    if (context.onPermissionError) {
      context.onPermissionError(toolName, patterns, toolUseId);
    }
  }

  /**
   * Process tool_result content item
   */
  private processToolResult(
    contentItem: {
      tool_use_id?: string;
      content: string;
      is_error?: boolean;
    },
    context: ProcessingContext,
    options: ProcessingOptions,
    toolUseResult?: unknown,
  ): void {
    const content =
      typeof contentItem.content === "string"
        ? contentItem.content
        : JSON.stringify(contentItem.content);

    // Check for permission errors - but skip tool use errors which should be displayed as regular results
    if (
      options.isStreaming &&
      contentItem.is_error &&
      !isToolUseError(content)
    ) {
      this.handlePermissionError(contentItem, context);
      return;
    }

    // Get cached tool_use information to determine tool name
    const toolUseId = contentItem.tool_use_id || "";
    const cachedToolInfo = this.getCachedToolInfo(toolUseId);
    const toolName = cachedToolInfo?.name || "Tool";

    // Don't show tool_result for TodoWrite since we already show TodoMessage from tool_use
    if (toolName === "TodoWrite") {
      return;
    }

    // This is a regular tool result - create a ToolResultMessage
    const toolResultMessage = createToolResultMessage(
      toolName,
      content,
      options.timestamp,
      toolUseResult,
    );
    context.addMessage(toolResultMessage);
  }

  /**
   * Handle assistant text content during streaming
   */
  private handleAssistantText(
    contentItem: { text?: string },
    context: ProcessingContext,
    options: ProcessingOptions,
  ): void {
    if (!options.isStreaming) {
      // For history processing, text will be handled at the message level
      return;
    }

    const getAssistantMessage =
      context.getCurrentAssistantMessage ??
      (() => context.currentAssistantMessage ?? null);

    let messageToUpdate = getAssistantMessage?.() ?? null;
    let isNewMessage = false;

    if (!messageToUpdate) {
      messageToUpdate = {
        type: "chat",
        role: "assistant",
        content: "",
        timestamp: options.timestamp || Date.now(),
      };
      isNewMessage = true;
    }

    const updatedContent =
      (messageToUpdate.content || "") + (contentItem.text || "");

    // Update the current assistant message state
    const updatedMessage = {
      ...messageToUpdate,
      content: updatedContent,
    };
    context.setCurrentAssistantMessage?.(updatedMessage);

    if (isNewMessage) {
      context.addMessage(updatedMessage);
    } else {
      context.updateLastMessage?.(updatedContent);
    }
  }

  /**
   * Handle tool_use content item
   */
  private handleToolUse(
    contentItem: {
      id?: string;
      name?: string;
      input?: Record<string, unknown>;
    },
    context: ProcessingContext,
    options: ProcessingOptions,
  ): void {
    // Cache tool_use information for later permission error handling and tool_result correlation
    if (contentItem.id && contentItem.name) {
      this.cacheToolUse(
        contentItem.id,
        contentItem.name,
        contentItem.input || {},
      );
    }

    // Special handling for ExitPlanMode - create plan message instead of tool message
    if (contentItem.name === "ExitPlanMode") {
      const planContent = (contentItem.input?.plan as string) || "";
      const planMessage = {
        type: "plan" as const,
        plan: planContent,
        toolUseId: contentItem.id || "",
        timestamp: options.timestamp || Date.now(),
      };
      context.addMessage(planMessage);
    } else if (contentItem.name === "TodoWrite") {
      // Special handling for TodoWrite - create todo message from input
      const todoMessage = createTodoMessageFromInput(
        contentItem.input || {},
        options.timestamp,
      );
      if (todoMessage) {
        context.addMessage(todoMessage);
      } else {
        // Fallback to regular tool message if todo parsing fails
        const toolMessage = createToolMessage(contentItem, options.timestamp);
        context.addMessage(toolMessage);
      }
    } else {
      const toolMessage = createToolMessage(contentItem, options.timestamp);
      context.addMessage(toolMessage);
    }
  }

  /**
   * Process a system message
   */
  private processSystemMessage(
    message: Extract<SDKMessage | TimestampedSDKMessage, { type: "system" }>,
    context: ProcessingContext,
    options: ProcessingOptions,
  ): void {
    const timestamp = options.timestamp || Date.now();

    // Check if this is an init message and if we should show it (streaming only)
    if (options.isStreaming && message.subtype === "init") {
      // Mark that we've received init
      context.setHasReceivedInit?.(true);

      const shouldShow = context.shouldShowInitMessage?.() ?? true;
      if (shouldShow) {
        const systemMessage = convertSystemMessage(message, timestamp);
        context.addMessage(systemMessage);
        context.onInitMessageShown?.();
      }
    } else {
      // Always show non-init system messages
      const systemMessage = convertSystemMessage(message, timestamp);
      context.addMessage(systemMessage);
    }
  }

  /**
   * Process an assistant message
   */
  private processAssistantMessage(
    message: Extract<SDKMessage | TimestampedSDKMessage, { type: "assistant" }>,
    context: ProcessingContext,
    options: ProcessingOptions,
  ): AllMessage[] {
    const timestamp = options.timestamp || Date.now();
    const messages: AllMessage[] = [];

    // Update sessionId only for the first assistant message after init (streaming only)
    if (
      options.isStreaming &&
      context.hasReceivedInit &&
      message.session_id &&
      context.onSessionId
    ) {
      context.onSessionId(message.session_id);
    }

    // For batch processing, collect messages to return
    // For streaming, messages are added directly via context
    const localContext = options.isStreaming
      ? context
      : {
          ...context,
          addMessage: (msg: AllMessage) => messages.push(msg),
        };

    let assistantContent = "";
    const thinkingMessages: ThinkingMessage[] = [];
    const getAssistantMessage =
      context.getCurrentAssistantMessage ??
      (() => context.currentAssistantMessage ?? null);

    // Check if message.content exists and is an array
    if (message.message?.content && Array.isArray(message.message.content)) {
      for (const item of message.message.content) {
        if (item.type === "text") {
          if (options.isStreaming) {
            const existingAssistant = getAssistantMessage?.();
            if (!existingAssistant) {
              this.handleAssistantText(item, context, options);
            }
          } else {
            assistantContent += (item as { text: string }).text;
          }
        } else if (item.type === "tool_use") {
          this.handleToolUse(item, localContext, options);
        } else if (isThinkingContentItem(item)) {
          if (
            options.isStreaming &&
            this.consumeThinkingStream(item.thinking, context, timestamp)
          ) {
            continue;
          }

          if (options.isStreaming && this.lastThinkingMessage) {
            this.lastThinkingMessage = this.updateThinkingMessageInstance(
              this.lastThinkingMessage,
              item.thinking,
              timestamp,
              context,
            );
            continue;
          }

          const thinkingMessage = createThinkingMessage(
            item.thinking,
            timestamp,
          );
          if (options.isStreaming) {
            context.addMessage(thinkingMessage);
          } else {
            thinkingMessages.push(thinkingMessage);
          }
        }
      }
    }

    // For batch processing, assemble the messages in proper order
    if (!options.isStreaming) {
      const orderedMessages: AllMessage[] = [];

      // Add thinking messages first (reasoning comes before action)
      orderedMessages.push(...thinkingMessages);

      // Add tool messages second (actions)
      orderedMessages.push(...messages);

      // Add assistant text message last if there is text content
      if (assistantContent.trim()) {
        const assistantMessage: ChatMessage = {
          type: "chat",
          role: "assistant",
          content: assistantContent.trim(),
          timestamp,
        };
        orderedMessages.push(assistantMessage);
      }

      return orderedMessages;
    }

    return messages;
  }

  /**
   * Process a result message
   */
  private processResultMessage(
    message: Extract<SDKMessage | TimestampedSDKMessage, { type: "result" }>,
    context: ProcessingContext,
    options: ProcessingOptions,
  ): void {
    const timestamp = options.timestamp || Date.now();
    const resultMessage = convertResultMessage(message, timestamp);
    context.addMessage(resultMessage);

    this.resetThinkingStreams();

    // Clear current assistant message (streaming only)
    if (options.isStreaming) {
      context.setCurrentAssistantMessage?.(null);
    }
  }

  /**
   * Process a user message
   */
  private processUserMessage(
    message: Extract<SDKMessage | TimestampedSDKMessage, { type: "user" }>,
    context: ProcessingContext,
    options: ProcessingOptions,
  ): AllMessage[] {
    const timestamp = options.timestamp || Date.now();
    const messages: AllMessage[] = [];
    const parentToolUseId =
      "parent_tool_use_id" in message ? message.parent_tool_use_id : null;
    const cachedToolInfo = parentToolUseId
      ? this.getCachedToolInfo(parentToolUseId)
      : undefined;
    const messageRole = message.message.role;

    // For batch processing, collect messages to return
    // For streaming, messages are added directly via context
    const localContext = options.isStreaming
      ? context
      : {
          ...context,
          addMessage: (msg: AllMessage) => messages.push(msg),
        };

    const messageContent = message.message.content;

    if (Array.isArray(messageContent)) {
      for (const contentItem of messageContent) {
        if (contentItem.type === "tool_result") {
          // Extract toolUseResult from message if it exists
          const toolUseResult = (message as { toolUseResult?: unknown })
            .toolUseResult;
          this.processToolResult(
            contentItem,
            localContext,
            options,
            toolUseResult,
          );
        } else if (contentItem.type === "text") {
          const textContent = (contentItem as { text: string }).text;
          const delegatedMessage = this.createSubagentTaskMessage(
            textContent,
            parentToolUseId,
            timestamp,
            cachedToolInfo,
            messageRole,
          );

          if (delegatedMessage) {
            localContext.addMessage(delegatedMessage);
          } else {
            const userMessage: ChatMessage = {
              type: "chat",
              role: "user",
              content: textContent,
              timestamp,
            };
            localContext.addMessage(userMessage);
          }
        }
      }
    } else if (typeof messageContent === "string") {
      const delegatedMessage = this.createSubagentTaskMessage(
        messageContent,
        parentToolUseId,
        timestamp,
        cachedToolInfo,
        messageRole,
      );

      if (delegatedMessage) {
        localContext.addMessage(delegatedMessage);
      } else {
        const userMessage: ChatMessage = {
          type: "chat",
          role: "user",
          content: messageContent,
          timestamp,
        };
        localContext.addMessage(userMessage);
      }
    }

    return messages;
  }

  /**
   * Process a single SDK message
   *
   * @param message - The SDK message to process
   * @param context - Processing context for callbacks and state management
   * @param options - Processing options (streaming vs batch, timestamp override)
   * @returns Array of messages for batch processing (empty for streaming)
   */
  public processMessage(
    message: SDKMessage | TimestampedSDKMessage,
    context: ProcessingContext,
    options: ProcessingOptions = {},
  ): AllMessage[] {
    const timestamp =
      options.timestamp ||
      ("timestamp" in message
        ? new Date(message.timestamp).getTime()
        : Date.now());

    const finalOptions = { ...options, timestamp };

    switch (message.type) {
      case "system":
        this.processSystemMessage(message, context, finalOptions);
        return [];

      case "assistant":
        return this.processAssistantMessage(message, context, finalOptions);

      case "result":
        this.processResultMessage(message, context, finalOptions);
        return [];

      case "user":
        return this.processUserMessage(message, context, finalOptions);

      default:
        console.warn(
          "Unknown message type:",
          (message as { type: string }).type,
        );
        return [];
    }
  }

  /**
   * Process streaming partial assistant events
   */
  public processStreamEvent(
    message: SDKStreamEventMessage,
    context: ProcessingContext,
    options: ProcessingOptions = {},
  ): void {
    const timestamp = options.timestamp ?? Date.now();

    if (message.event.type === "content_block_delta") {
      const delta = message.event.delta;
      const contentIndex = message.event.index;

      if (
        delta?.type === "text_delta" &&
        typeof delta.text === "string"
      ) {
        this.handleAssistantText(
          { text: delta.text },
          context,
          { ...options, isStreaming: true, timestamp },
        );
        return;
      }

      if (
        delta?.type === "thinking_delta" &&
        typeof delta.thinking === "string" &&
        typeof contentIndex === "number"
      ) {
        this.handleThinkingDelta(
          contentIndex,
          delta.thinking,
          context,
          { ...options, isStreaming: true, timestamp },
        );
        return;
      }
    } else if (message.event.type === "message_start") {
      this.resetThinkingStreams();
    }
  }

  /**
   * Process multiple messages in batch (for history loading)
   *
   * @param messages - Array of timestamped SDK messages
   * @param context - Processing context
   * @returns Array of processed messages
   */
  public processMessagesBatch(
    messages: TimestampedSDKMessage[],
    context?: Partial<ProcessingContext>,
  ): AllMessage[] {
    const allMessages: AllMessage[] = [];

    // Create a batch context that collects messages
    const batchContext: ProcessingContext = {
      addMessage: (msg: AllMessage) => allMessages.push(msg),
      ...context,
    };

    // Clear cache before processing batch
    this.clearCache();

    for (const message of messages) {
      const processedMessages = this.processMessage(message, batchContext, {
        isStreaming: false,
        timestamp: new Date(message.timestamp).getTime(),
      });
      allMessages.push(...processedMessages);
    }

    return allMessages;
  }
}
