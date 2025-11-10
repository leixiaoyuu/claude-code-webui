/**
 * TRP Sync API 处理程序
 * 提供 TRP 文档同步功能的 REST API 接口
 */

import type { Context } from "hono";
import { logger } from "../utils/logger.ts";
// @ts-expect-error - TRP Sync 模块没有 TypeScript 声明文件
import TrpSyncManager from "../trp-sync/trp-sync.js";

// 同步任务状态管理
interface SyncTask {
  id: string;
  status: "pending" | "running" | "completed" | "failed";
  progress?: {
    total: number;
    success: number;
    errors: number;
    skipped: number;
  };
  error?: string;
  startTime: string;
  endTime?: string;
  config: TrpSyncConfig;
}

interface TrpSyncConfig {
  baseUrl: string;
  workspaceSn: string;
  versionIid: string;
  token?: string;
  targetFolder: string;
  concurrency?: number;
  useOrderPrefix?: boolean;
  incremental?: boolean;
  fromTime?: string;
  overwrite?: boolean;
}

// 内存中的同步任务存储（生产环境应该使用数据库）
const syncTasks = new Map<string, SyncTask>();

/**
 * 创建同步任务
 */
export async function handleCreateSyncTask(c: Context) {
  try {
    const body = await c.req.json<TrpSyncConfig>();

    // 验证必需参数
    if (!body.baseUrl || !body.workspaceSn || !body.versionIid || !body.targetFolder) {
      return c.json(
        {
          error: "缺少必需参数",
          details: "必需参数: baseUrl, workspaceSn, versionIid, targetFolder"
        },
        400
      );
    }

    // 生成任务ID
    const taskId = `sync_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;

    // 创建任务记录
    const task: SyncTask = {
      id: taskId,
      status: "pending",
      startTime: new Date().toISOString(),
      config: body
    };

    syncTasks.set(taskId, task);

    // 异步执行同步任务
    executeSyncTask(taskId, body);

    logger.app.info(`创建同步任务: ${taskId}`, { taskId, config: body });

    return c.json({
      taskId,
      status: "pending",
      message: "同步任务已创建并开始执行"
    });

  } catch (error) {
    logger.app.error("创建同步任务失败", { error });
    return c.json(
      {
        error: "创建同步任务失败",
        details: error instanceof Error ? error.message : String(error)
      },
      500
    );
  }
}

/**
 * 获取同步任务状态
 */
export async function handleGetSyncTaskStatus(c: Context) {
  try {
    const taskId = c.req.param("taskId");

    const task = syncTasks.get(taskId);
    if (!task) {
      return c.json({ error: "任务不存在" }, 404);
    }

    return c.json({
      taskId: task.id,
      status: task.status,
      progress: task.progress,
      error: task.error,
      startTime: task.startTime,
      endTime: task.endTime,
      config: {
        baseUrl: task.config.baseUrl,
        workspaceSn: task.config.workspaceSn,
        versionIid: task.config.versionIid,
        targetFolder: task.config.targetFolder,
        incremental: task.config.incremental
      }
    });

  } catch (error) {
    logger.app.error("获取任务状态失败", { error });
    return c.json(
      {
        error: "获取任务状态失败",
        details: error instanceof Error ? error.message : String(error)
      },
      500
    );
  }
}

/**
 * 获取所有同步任务
 */
export async function handleGetAllSyncTasks(c: Context) {
  try {
    const tasks = Array.from(syncTasks.values()).map(task => ({
      taskId: task.id,
      status: task.status,
      progress: task.progress,
      error: task.error,
      startTime: task.startTime,
      endTime: task.endTime,
      config: {
        baseUrl: task.config.baseUrl,
        workspaceSn: task.config.workspaceSn,
        versionIid: task.config.versionIid,
        targetFolder: task.config.targetFolder,
        incremental: task.config.incremental
      }
    }));

    return c.json({ tasks });

  } catch (error) {
    logger.app.error("获取任务列表失败", { error });
    return c.json(
      {
        error: "获取任务列表失败",
        details: error instanceof Error ? error.message : String(error)
      },
      500
    );
  }
}

/**
 * 执行同步任务（内部方法）
 */
async function executeSyncTask(taskId: string, config: TrpSyncConfig) {
  const task = syncTasks.get(taskId);
  if (!task) return;

  try {
    task.status = "running";
    task.progress = {
      total: 0,
      success: 0,
      errors: 0,
      skipped: 0
    };

    // 创建同步管理器
    const manager = new TrpSyncManager(
      config.baseUrl,
      config.workspaceSn,
      config.versionIid,
      {
        token: config.token,
        concurrency: config.concurrency || 10,
        use_order_prefix: config.useOrderPrefix || false,
        incremental: config.incremental !== false,
        from_time: config.fromTime,
        verbose: true // API 模式下启用详细日志
      }
    );

    await manager.init();

    // 执行同步
    const success = await manager.syncDocuments(config.targetFolder, config.overwrite || false);

    // 更新任务状态
    task.status = success ? "completed" : "failed";
    task.endTime = new Date().toISOString();

    if (!success) {
      task.error = "同步过程中出现错误";
    }

    logger.app.info(`同步任务完成: ${taskId}`, { taskId, success });

  } catch (error) {
    task.status = "failed";
    task.error = error instanceof Error ? error.message : String(error);
    task.endTime = new Date().toISOString();

    logger.app.error(`同步任务失败: ${taskId}`, { taskId, error });
  }
}