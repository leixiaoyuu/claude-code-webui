import { useState, useCallback } from "react";
import type {
  PermissionMode,
  PermissionRequestEvent,
  PermissionDecisionRequest,
  PermissionUpdate,
} from "../../types";
import { getPermissionDecisionUrl } from "../../config/api";
import { extractToolInfo, generateToolPatterns } from "../../utils/toolUtils";

interface InteractivePermissionRequest {
  permissionRequestId: string;
  requestId: string;
  sessionId?: string;
  input: Record<string, unknown>;
  suggestions?: PermissionUpdate[];
}

interface PermissionRequest {
  isOpen: boolean;
  toolName: string;
  patterns: string[];
  toolUseId?: string;
  interactive?: InteractivePermissionRequest;
  isProcessing?: boolean;
  error?: string;
}

interface PlanModeRequest {
  isOpen: boolean;
  planContent: string;
}

interface UsePermissionsOptions {
  onPermissionModeChange?: (mode: PermissionMode) => void;
}

export function usePermissions(options: UsePermissionsOptions = {}) {
  const { onPermissionModeChange } = options;
  const [allowedTools, setAllowedTools] = useState<string[]>([]);
  const [permissionRequest, setPermissionRequest] =
    useState<PermissionRequest | null>(null);
  const [planModeRequest, setPlanModeRequest] =
    useState<PlanModeRequest | null>(null);

  // New state for inline permission system
  const [isPermissionMode, setIsPermissionMode] = useState(false);

  const showPermissionRequest = useCallback(
    (toolName: string, patterns: string[], toolUseId: string) => {
      setPermissionRequest({
        isOpen: true,
        toolName,
        patterns,
        toolUseId,
        isProcessing: false,
        error: undefined,
      });
      // Enable inline permission mode
      setIsPermissionMode(true);
    },
    [],
  );

  const showInteractivePermissionRequest = useCallback(
    (event: PermissionRequestEvent) => {
      const { toolName, commands } = extractToolInfo(
        event.toolName,
        event.input,
      );
      const patterns = generateToolPatterns(toolName, commands);

      setPermissionRequest({
        isOpen: true,
        toolName,
        patterns,
        toolUseId: undefined,
        interactive: {
          permissionRequestId: event.permissionRequestId,
          requestId: event.requestId,
          sessionId: event.sessionId,
          input: event.input,
          suggestions: event.suggestions,
        },
        isProcessing: false,
        error: undefined,
      });
      setIsPermissionMode(true);
    },
    [],
  );

  const closePermissionRequest = useCallback(() => {
    setPermissionRequest(null);
    // Disable inline permission mode
    setIsPermissionMode(false);
  }, []);

  const showPlanModeRequest = useCallback((planContent: string) => {
    setPlanModeRequest({
      isOpen: true,
      planContent,
    });
    setIsPermissionMode(true);
  }, []);

  const closePlanModeRequest = useCallback(() => {
    setPlanModeRequest(null);
    setIsPermissionMode(false);
  }, []);

  const allowToolTemporary = useCallback(
    (pattern: string, baseTools?: string[]) => {
      const currentAllowedTools = baseTools || allowedTools;
      return [...currentAllowedTools, pattern];
    },
    [allowedTools],
  );

  const allowToolPermanent = useCallback(
    (pattern: string, baseTools?: string[]) => {
      const currentAllowedTools = baseTools || allowedTools;
      const updatedAllowedTools = [...currentAllowedTools, pattern];
      setAllowedTools(updatedAllowedTools);
      return updatedAllowedTools;
    },
    [allowedTools],
  );

  const resetPermissions = useCallback(() => {
    setAllowedTools([]);
  }, []);

  // Helper function to update permission mode based on user action
  const updatePermissionMode = useCallback(
    (mode: PermissionMode) => {
      onPermissionModeChange?.(mode);
    },
    [onPermissionModeChange],
  );

  const respondToInteractivePermissionRequest = useCallback(
    async ({
      behavior,
      permanent = false,
      message,
      interrupt,
    }: {
      behavior: "allow" | "deny";
      permanent?: boolean;
      message?: string;
      interrupt?: boolean;
    }) => {
      const activeRequest = permissionRequest;
      if (!activeRequest?.interactive) {
        return;
      }

      setPermissionRequest((prev) =>
        prev
          ? {
              ...prev,
              isProcessing: true,
              error: undefined,
            }
          : prev,
      );

      try {
        const body: PermissionDecisionRequest = {
          behavior,
        };

        if (behavior === "allow") {
          body.updatedInput = activeRequest.interactive.input;
          if (
            permanent &&
            activeRequest.interactive.suggestions &&
            activeRequest.interactive.suggestions.length > 0
          ) {
            body.updatedPermissions = activeRequest.interactive.suggestions;
          }
        } else {
          body.message = message || "User denied permission";
          body.interrupt = interrupt ?? true;
        }

        const response = await fetch(
          getPermissionDecisionUrl(
            activeRequest.interactive.permissionRequestId,
          ),
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          },
        );

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        closePermissionRequest();
      } catch (error) {
        console.error("Failed to resolve permission request:", error);
        setPermissionRequest((prev) =>
          prev
            ? {
                ...prev,
                isProcessing: false,
                error: "Failed to submit decision. Please try again.",
              }
            : prev,
        );
      }
    },
    [permissionRequest, closePermissionRequest],
  );

  return {
    allowedTools,
    permissionRequest,
    showPermissionRequest,
    showInteractivePermissionRequest,
    closePermissionRequest,
    allowToolTemporary,
    allowToolPermanent,
    resetPermissions,
    isPermissionMode,
    setIsPermissionMode,
    planModeRequest,
    showPlanModeRequest,
    closePlanModeRequest,
    updatePermissionMode,
    respondToInteractivePermissionRequest,
  };
}
