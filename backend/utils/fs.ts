/**
 * Shared file system utilities using Node.js fs module
 *
 * Provides cross-platform file system operations that work in both
 * Deno and Node.js environments using the standard Node.js fs API.
 */

import { promises as fs } from "node:fs";
import { constants as fsConstants } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * File system information
 */
export interface FileStats {
  isFile: boolean;
  isDirectory: boolean;
  isSymlink: boolean;
  size: number;
  mtime: Date | null;
  birthtime: Date | null;
}

/**
 * Directory entry information
 */
export interface DirectoryEntry {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
  isSymlink: boolean;
}

/**
 * Read text file content
 */
export async function readTextFile(path: string): Promise<string> {
  return await fs.readFile(path, "utf8");
}

/**
 * Read binary file content
 */
export async function readBinaryFile(path: string): Promise<Uint8Array> {
  const buffer = await fs.readFile(path);
  return new Uint8Array(buffer);
}

/**
 * Write text content to file
 */
export async function writeTextFile(
  path: string,
  content: string,
  options?: { mode?: number },
): Promise<void> {
  await fs.writeFile(path, content, "utf8");
  if (options?.mode !== undefined) {
    await fs.chmod(path, options.mode);
  }
}

/**
 * Check if file or directory exists
 */
export async function exists(path: string): Promise<boolean> {
  try {
    await fs.access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get file/directory statistics
 */
export async function stat(path: string): Promise<FileStats> {
  const stats = await fs.stat(path);
  return {
    isFile: stats.isFile(),
    isDirectory: stats.isDirectory(),
    isSymlink: stats.isSymbolicLink(),
    size: stats.size,
    mtime: stats.mtime,
    birthtime: stats.birthtime,
  };
}

/**
 * Read directory entries
 */
export async function* readDir(path: string): AsyncIterable<DirectoryEntry> {
  const entries = await fs.readdir(path, { withFileTypes: true });
  for (const entry of entries) {
    yield {
      name: entry.name,
      isFile: entry.isFile(),
      isDirectory: entry.isDirectory(),
      isSymlink: entry.isSymbolicLink(),
    };
  }
}

/**
 * Execute callback with a temporary directory that gets cleaned up
 */
export async function withTempDir<T>(
  callback: (tempDir: string) => Promise<T>,
): Promise<T> {
  const tempDir = await fs.mkdtemp(join(tmpdir(), "claude-code-webui-temp-"));
  try {
    return await callback(tempDir);
  } finally {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Silently ignore cleanup errors - temp dir will be cleaned up by OS eventually
    }
  }
}

/**
 * Ensure directory exists (creates recursively if needed)
 */
export async function ensureDir(path: string): Promise<void> {
  await fs.mkdir(path, { recursive: true });
}

/**
 * Recursively copy directory contents
 */
export async function copyDirectory(
  source: string,
  destination: string,
): Promise<void> {
  const sourceStats = await fs.stat(source);
  if (!sourceStats.isDirectory()) {
    throw new Error(`Source path is not a directory: ${source}`);
  }

  await ensureDir(destination);
  const entries = await fs.readdir(source, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = join(source, entry.name);
    const destPath = join(destination, entry.name);

    if (entry.isDirectory()) {
      await copyDirectory(srcPath, destPath);
    } else if (entry.isSymbolicLink()) {
      const linkTarget = await fs.readlink(srcPath);
      await fs.symlink(linkTarget, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}
