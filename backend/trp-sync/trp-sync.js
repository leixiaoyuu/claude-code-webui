#!/usr/bin/env node

/**
 * TRP 文档同步工具
 * 用于从远程 TRP 服务器同步文档到本地
 * 基于 Python 版本的 trp_sync.py 重写，保持功能一致性
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import axios from 'axios';
import PQueue from 'p-queue';
import { Command } from 'commander';
import winston from 'winston';
import cron from 'node-cron';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

// 数据类定义
class DocumentInfo {
    constructor(id, name, path, type, content = null, children = null, order = null) {
        this.id = id;
        this.name = name;
        this.path = path;
        this.type = type;
        this.content = content;
        this.children = children;
        this.order = order;
    }
}

class ModifyDoc {
    constructor(docIId, iid, id, modifyTime, name, docName) {
        this.docIId = docIId;
        this.iid = iid;
        this.id = id;
        this.modifyTime = modifyTime;
        this.name = name;
        this.docName = docName;
    }
}

class LocalFileMetadata {
    constructor(filePath, docId, modifyTime, fileSize, lastSyncTime) {
        this.filePath = filePath;
        this.docId = docId;
        this.modifyTime = modifyTime;
        this.fileSize = fileSize;
        this.lastSyncTime = lastSyncTime;
    }
}

class WorkspaceMetadata {
    constructor(workspace, version, syncTime, totalDocuments, successCount, errorCount) {
        this.workspace = workspace;
        this.version = version;
        this.syncTime = syncTime;
        this.totalDocuments = totalDocuments;
        this.successCount = successCount;
        this.errorCount = errorCount;
    }
}

class TrpSyncManager {
    constructor(base_url, workspace_sn, version_iid, options = {}) {
        this.base_url = base_url.replace(/\/$/, '');
        this.workspace_sn = workspace_sn;
        this.version_iid = version_iid;
        this.token = options.token;
        this.concurrency = options.concurrency || 10;
        this.use_order_prefix = options.use_order_prefix || false;
        this.incremental = options.incremental || false;
        this.from_time = options.from_time || null;

        // 创建并发队列
        this.queue = new PQueue({ concurrency: this.concurrency });

        // 文件名替换映射表（与 Python 版本保持一致）
        this.NAME_REPLACEMENTS = [
            { pattern: /\//g, replacement: '__' },
            { pattern: /:/g, replacement: '_' },
            { pattern: /：/g, replacement: '_' },
            { pattern: /\\/g, replacement: '_' },
            { pattern: /\*/g, replacement: '_' },
            { pattern: /\?/g, replacement: '_' },
            { pattern: /"/g, replacement: '_' },
            { pattern: /</g, replacement: '_' },
            { pattern: />/g, replacement: '_' },
            { pattern: /\|/g, replacement: '_' }
        ];

        // 设置日志
        this.logger = winston.createLogger({
            level: options.verbose ? 'debug' : 'info',
            format: winston.format.combine(
                winston.format.timestamp(),
                winston.format.printf(({ timestamp, level, message }) => {
                    return `${timestamp} - ${level} - ${message}`;
                })
            ),
            transports: [new winston.transports.Console()]
        });

        // 统计信息
        this.stats = {
            total: 0,
            success: 0,
            errors: 0,
            skipped: 0
        };

        // 最大元素ID（用于XML处理）
        this.max_element_id = 0;

        // HTTP 客户端
        this.client = axios.create({
            timeout: 300000,
            headers: {
                'X-Mone-Apikey': this.token,
                'Content-Type': 'application/json',
                'User-Agent': 'TRP-Sync-Tool/1.0.0'
            }
        });
    }

    async init() {
        // 初始化方法，保持与 Python 版本的一致性
    }

    getApiUrl(endpoint) {
        return new URL(endpoint, this.base_url).href;
    }

    async makeRequest(method, endpoint, data = null) {
        const url = this.getApiUrl(endpoint);
        const maxRetries = 3;
        let retryCount = 0;

        while (retryCount < maxRetries) {
            try {
                const response = await this.client({
                    method,
                    url,
                    data,
                    responseType: 'json'
                });

                if (response.status === 200) {
                    return response.data;
                } else if (response.status === 401) {
                    throw new Error('认证失败，请检查 token');
                } else if (response.status === 404) {
                    throw new Error(`API 端点不存在: ${endpoint}`);
                } else {
                    throw new Error(`HTTP ${response.status}: ${JSON.stringify(response.data)}`);
                }
            } catch (error) {
                if (error.code === 'ECONNABORTED') {
                    retryCount++;
                    this.logger.warn(`请求超时，重试 ${retryCount}/${maxRetries}: ${url}`);
                    if (retryCount >= maxRetries) {
                        throw new Error(`请求超时，已达最大重试次数: ${url}`);
                    }
                    await this.sleep(2 ** retryCount * 1000);
                } else if (error.response) {
                    // Axios 错误响应
                    throw new Error(`HTTP ${error.response.status}: ${JSON.stringify(error.response.data)}`);
                } else {
                    retryCount++;
                    this.logger.warn(`请求失败，重试 ${retryCount}/${maxRetries}: ${url}, 错误: ${error.message}`);
                    if (retryCount >= maxRetries) {
                        throw error;
                    }
                    await this.sleep(2 ** retryCount * 1000);
                }
            }
        }
    }

    async getWorkspaceInfo() {
        try {
            const workspaceData = await this.makeRequest(
                'GET',
                `/api/trp/workspace/${this.workspace_sn}/doc?paginate=0&vid=${this.version_iid}&from=autoba`
            );

            return {
                workspace: {
                    name: `Workspace ${this.workspace_sn}`,
                    sn: this.workspace_sn
                },
                version: {
                    name: `Version ${this.version_iid}`,
                    iid: this.version_iid,
                    latestVer: ''
                }
            };
        } catch (error) {
            this.logger.error(`获取工作空间信息失败: ${error.message}`);
            return {
                workspace: {
                    name: `Workspace ${this.workspace_sn}`,
                    sn: this.workspace_sn
                },
                version: {
                    name: `Version ${this.version_iid}`,
                    iid: this.version_iid,
                    latestVer: ''
                }
            };
        }
    }

    async getDocumentsTree() {
        try {
            const docListData = await this.makeRequest(
                'GET',
                `/api/trp/workspace/${this.workspace_sn}/doc?paginate=0&vid=${this.version_iid}&from=autoba`
            );
            return docListData.data || [];
        } catch (error) {
            this.logger.error(`获取文档列表失败: ${error.message}`);
            throw error;
        }
    }

    async getDocumentPages(docId) {
        try {
            const pagesData = await this.makeRequest(
                'GET',
                `/api/trp/workspace/${this.workspace_sn}/page?docId=${docId}&wtree=1&vid=${this.version_iid}&from=autoba`
            );
            return pagesData.data || [];
        } catch (error) {
            this.logger.error(`获取文档页面失败 ${docId}: ${error.message}`);
            throw error;
        }
    }

    async getPageContent(pageId) {
        try {
            const contentData = await this.makeRequest(
                'GET',
                `/api/trp/workspace/${this.workspace_sn}/page/${pageId}?edit=1&vid=${this.version_iid}&from=autoba`
            );
            return contentData.data?.content || '';
        } catch (error) {
            this.logger.error(`获取页面内容失败 ${pageId}: ${error.message}`);
            return null;
        }
    }

    async getPagesByModifyTime(modifyTime = null) {
        try {
            let url = `/api/trp/workspace/${this.workspace_sn}/page?vid=${this.version_iid}&paginate=0&from=autoba`;

            if (modifyTime !== null) {
                url += `&modifyTime=${modifyTime}`;
            }

            this.logger.info(`获取增量页面列表，modifyTime参数: ${modifyTime || 'all'}`);
            const data = await this.makeRequest('GET', url);
            const pages = data.data || [];

            this.logger.info(`✅ 获取到 ${pages.length} 个有改动的文档`);
            return pages;
        } catch (error) {
            this.logger.error(`获取增量页面列表失败: ${error.message}`);
            return [];
        }
    }

    async scanLocalFiles(targetPath) {
        this.logger.info(`🖨️ 正在扫描现有的 .trp 文件...`);

        try {
            const { glob } = await import('glob');
            const existingFiles = await glob(`${targetPath}/**/*.trp`, {
                cwd: targetPath,
                absolute: true
            });

            this.logger.info(`✅ 当前工作空间版本共有【${existingFiles.length}】个 .trp 文件`);

            const existingFileMap = new Map();
            let filesWithMetadata = 0;
            let duplicateIds = 0;

            for (const filePath of existingFiles) {
                try {
                    const content = await fs.readFile(filePath, 'utf-8');

                    // 使用正则表达式提取metadata中的id
                    const metadataPattern = /<docx-metadata[^>]*?\s+id=['"]([^'"]+)['"][^>]*>/;
                    const match = content.match(metadataPattern);

                    if (match && match[1]) {
                        filesWithMetadata++;
                        const pageId = match[1];

                        if (existingFileMap.has(pageId)) {
                            duplicateIds++;
                            this.logger.warn(`⚠️ 发现重复的id: ${pageId}：\n\t- 原文件: 【${existingFileMap.get(pageId).filePath}】\n\t- 新文件: 【${filePath}】`);
                        }

                        const fileStat = await fs.stat(filePath);
                        existingFileMap.set(pageId, new LocalFileMetadata(
                            filePath,
                            pageId,
                            this.extractModifyTimeFromMetadata(content),
                            fileStat.size,
                            this.extractSyncTimeFromMetadata(content)
                        ));
                    } else {
                        this.logger.info(`=== 文件没有id元数据: ${filePath}`);
                    }
                } catch (error) {
                    this.logger.error(`❌ 读取文件 ${filePath} 元数据失败: ${error.message}`);
                }
            }

            this.logger.info(`📈文件统计: 总文件数【${existingFiles.length}】, 有元数据【${filesWithMetadata}】, 重复id数【${duplicateIds}】, 唯一映射【${existingFileMap.size}】`);
            return existingFileMap;

        } catch (error) {
            this.logger.error(`扫描本地文件失败: ${error.message}`);
            return new Map();
        }
    }

    extractModifyTimeFromMetadata(content) {
        try {
            const pattern = /modifyTime=['"]([^'"]+)['"]/;
            const match = content.match(pattern);
            return match ? match[1] : '';
        } catch {
            return '';
        }
    }

    extractSyncTimeFromMetadata(content) {
        try {
            const pattern = /lastSyncTime=['"]([^'"]+)['"]/;
            const match = content.match(pattern);
            return match ? match[1] : '';
        } catch {
            return '';
        }
    }

    extractMetadataFromFile(filePath) {
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const metadataPattern = /<docx-metadata([^>]*)>/;
            const match = content.match(metadataPattern);

            if (match) {
                const metadataStr = match[1];
                const metadata = {};
                const attrPattern = /(\w+)=['"](.*?)['"]/g;
                let attrMatch;

                while ((attrMatch = attrPattern.exec(metadataStr)) !== null) {
                    metadata[attrMatch[1]] = attrMatch[2];
                }

                return metadata;
            }

            return null;
        } catch (error) {
            this.logger.error(`提取文件元数据失败 ${filePath}: ${error.message}`);
            return null;
        }
    }

    async processIncrementalSync(modifiedDocs, basePath, overwrite = false) {
        try {
            // 首先获取所有现有的 .trp 文件
            const localFileMap = await this.scanLocalFiles(basePath);

            // 获取服务端所有当前存在的页面ID
            let serverPageIds = new Set();
            try {
                serverPageIds = await this.getAllExistingPageIds();
            } catch (error) {
                this.logger.error('❌ 获取服务端页面ID失败，跳过删除文件处理:', error.message);
                serverPageIds = new Set();
            }

            // 处理服务端已删除的文件
            try {
                await this.processDeletedFiles(localFileMap, serverPageIds, basePath);
            } catch (error) {
                this.logger.error('❌ 处理删除文件时发生异常:', error.message);
            }

            // 处理服务端已删除的文档目录
            try {
                await this.processDeletedDocumentDirs(basePath);
            } catch (error) {
                this.logger.error('❌ 处理删除文档目录时发生异常:', error.message);
            }

            // 如果没有修改的文档，只执行删除逻辑后返回
            if (modifiedDocs.length === 0) {
                this.logger.info("没有找到修改过的文档，删除检查完成");
                return;
            }

            // 处理修改和新增的文档
            this.logger.info(`💼 开始处理 ${modifiedDocs.length} 个修改/新增的文档...`);
            const promises = modifiedDocs.map(doc =>
                this.queue.add(() => this.processIncrementalDoc(doc, basePath, localFileMap, overwrite))
            );

            this.logger.info(`⌛️ 等待所有 ${promises.length} 个文档处理完成...`);
            await Promise.allSettled(promises);
            this.logger.info(`✅ 自动更新文档处理完成`);

        } catch (error) {
            this.logger.error('❌ 处理自动更新时出错:', error.message);
        }
    }

    async processIncrementalDoc(doc, basePath, localFileMap, overwrite = false) {
        try {
            const docId = doc.id;
            const docName = doc.name;

            // 检查本地是否存在该文件
            const localFile = localFileMap.get(docId);

            if (localFile) {
                // 处理已存在的文件（更新）
                await this.updateExistingFile(doc, localFile, overwrite);
            } else {
                // 处理新增文件（创建）
                this.logger.info(`➕➕文件不存在，创建新文件: 【${doc.docName}/${doc.name}】, iid: ${doc.iid}`);
                await this.createNewPageFile(doc, basePath);
            }

            this.logger.info(`增量更新完成: ${docName}`);

        } catch (error) {
            this.stats.errors++;
            this.logger.error(`处理增量文档失败 ${doc.name}: ${error.message}`);
        }
    }

    async updateExistingFile(doc, localFile, overwrite = false) {
        try {
            if (overwrite) {
                const docData = {
                    id: doc.id,
                    name: doc.name,
                    docIId: doc.docIId,
                    iid: doc.iid,
                    modifyTime: doc.modifyTime
                };

                await this.downloadAndProcessPage(docData, localFile.filePath);
                this.logger.info(`🔁 已更新文件: 【${localFile.filePath}】, iid: ${doc.iid}`);
            } else {
                this.logger.info(`⌛️ 覆盖模式为false，跳过更新文件: ${localFile.filePath}`);
            }
        } catch (error) {
            this.logger.error(`更新现有文件失败 ${localFile.filePath}: ${error.message}`);
        }
    }

    async createNewPageFile(doc, basePath) {
        try {
            // 查找页面的层级路径
            const pagePathInfo = await this.findPagePath(doc.id);
            if (!pagePathInfo) {
                this.logger.error(`❕无法找到页面 ${doc.name} 的层级路径`);
                return;
            }

            // 获取所有文档以确定文档顺序
            const documents = await this.getDocumentsTree();
            const docIndex = documents.findIndex(d => d.name === pagePathInfo.doc_name);
            if (docIndex === -1) {
                this.logger.error(`❕无法找到文档 ${pagePathInfo.doc_name} 的索引`);
                return;
            }

            // 构建目录路径
            let currentPath = basePath;

            // 创建文档目录
            const docDirName = this.getOrderedName(pagePathInfo.doc_name, docIndex + 1, documents.length);
            currentPath = path.join(currentPath, docDirName);
            await fs.mkdir(currentPath, { recursive: true });

            // 获取该文档的页面层级结构
            const docPages = await this.getDocumentPages(documents[docIndex].id);

            // 创建层级目录（跳过最后一个，那是文件名）
            let currentPageLevel = docPages;
            for (let i = 0; i < pagePathInfo.path.length - 1; i++) {
                const pageName = pagePathInfo.path[i];

                // 在当前层级中找到对应的页面以获取正确的顺序
                const pageIndex = currentPageLevel.findIndex(p => p.name === pageName);

                if (pageIndex >= 0) {
                    const dirName = this.getOrderedName(pageName, pageIndex + 1, currentPageLevel.length);
                    // 更新当前页面层级到下一级
                    if (currentPageLevel[pageIndex].children) {
                        currentPageLevel = currentPageLevel[pageIndex].children;
                    }
                } else {
                    const dirName = pageName;
                }

                currentPath = path.join(currentPath, dirName);
                await fs.mkdir(currentPath, { recursive: true });
            }

            // 创建文件
            const fileName = this.getSafeName(pagePathInfo.path[pagePathInfo.path.length - 1]);
            const filePath = path.join(currentPath, `${fileName}.trp`);

            // 获取页面内容并写入
            const docData = {
                id: doc.id,
                name: doc.name,
                docIId: doc.docIId,
                iid: doc.iid,
                modifyTime: doc.modifyTime
            };

            await this.downloadAndProcessPage(docData, filePath);
            this.logger.info(`✅ 已创建新文件: 【${filePath}】`);

        } catch (error) {
            this.logger.error(`创建新页面文件失败: ${doc.name}: ${error.message}`);
        }
    }

    async findPagePath(pageId) {
        try {
            // 获取所有文档
            const documents = await this.getDocumentsTree();

            // 在每个文档中查找页面
            for (const document of documents) {
                const pages = await this.getDocumentPages(document.id);
                const foundPath = this.findPageInTree(pages, pageId, []);
                if (foundPath) {
                    return {
                        doc_name: document.name,
                        path: foundPath
                    };
                }
            }

            return null;
        } catch (error) {
            this.logger.error(`查找页面路径失败: ${pageId}: ${error.message}`);
            return null;
        }
    }

    findPageInTree(pages, targetPageId, currentPath) {
        for (const page of pages) {
            const newPath = [...currentPath, page.name];

            if (page.id === targetPageId) {
                return newPath;
            }

            const children = page.children || [];
            if (children.length > 0) {
                const foundPath = this.findPageInTree(children, targetPageId, newPath);
                if (foundPath) {
                    return foundPath;
                }
            }
        }

        return null;
    }

    async processDeletedFiles(localFileMap, serverPageIds, basePath) {
        this.logger.info(`开始处理删除文件，本地文件数量: ${localFileMap.size}, 服务端页面数量: ${serverPageIds.size}`);

        const deleteTasks = [];
        let toDeleteCount = 0;

        for (const [docId, localFile] of localFileMap) {
            deleteTasks.push(
                this.queue.add(() => this.processSingleFileDeletion(docId, localFile, serverPageIds))
            );
        }

        this.logger.info(`🟡 准备并发处理【${deleteTasks.length}】个文件的删除检查...`);

        try {
            // 并发处理所有删除检查任务
            const results = await Promise.allSettled(deleteTasks);

            // 统计实际删除的文件数量
            for (const result of results) {
                if (result.status === 'fulfilled' && result.value) {
                    toDeleteCount++;
                } else if (result.status === 'rejected') {
                    this.logger.error(`❌ 删除文件过程中发生异常: ${result.reason}`);
                }
            }

            this.logger.info(`✅ 删除文件处理完成，实际删除了【${toDeleteCount}】个文件`);
        } catch (error) {
            this.logger.error(`❌ 删除文件过程中发生异常: ${error.message}`);
            throw error;
        }
    }

    async processSingleFileDeletion(docId, localFile, serverPageIds) {
        try {
            const filePath = localFile.filePath;

            // 检查文件是否存在
            try {
                await fs.access(filePath);
            } catch {
                this.logger.info(`文件不存在，跳过: ${filePath}`);
                return false;
            }

            // 使用doc_id作为删除判断的依据
            if (!serverPageIds.has(docId)) {
                this.logger.info(`🗑️ 确认删除: 服务端已删除页面，删除本地文件: ${filePath}, pageId: ${docId}`);
                await this.deleteLocalFile(filePath);
                return true;
            } else {
                // 服务端仍存在该页面，跳过删除
                return false;
            }

        } catch (error) {
            this.logger.error(`❌ 处理删除文件时出错: ${localFile.filePath}, docId: ${docId}`);
            // 不重新抛出异常，避免影响其他文件的处理
            return false;
        }
    }

    async deleteLocalFile(filePath) {
        try {
            // 删除文件
            try {
                await fs.unlink(filePath);
                this.logger.info(`✅ 已成功删除文件: ${filePath}`);
            } catch {
                // 文件可能已经不存在
                this.logger.debug(`文件已不存在: ${filePath}`);
            }

            // 尝试删除空目录（从文件所在目录开始向上）
            let currentDir = path.dirname(filePath);
            const basePath = path.dirname(filePath).split('/').slice(0, -2).join('/');

            while (currentDir && currentDir !== basePath && currentDir !== path.dirname(currentDir)) {
                try {
                    const files = await fs.readdir(currentDir);
                    // 如果目录为空，删除它
                    if (files.length === 0) {
                        await fs.rmdir(currentDir);
                        this.logger.info(`✅ 已删除空目录: ${currentDir}`);
                        currentDir = path.dirname(currentDir);
                    } else {
                        // 目录不为空，停止删除
                        this.logger.debug(`❕目录不为空，停止删除: ${currentDir} (包含 ${files.length} 个文件)`);
                        break;
                    }
                } catch {
                    // 删除目录失败，停止向上删除
                    this.logger.debug(`❌删除目录失败，停止向上删除: ${currentDir}`);
                    break;
                }
            }

        } catch (error) {
            this.logger.error(`❌ 删除文件失败: ${filePath}`);
        }
    }

    async processDeletedDocumentDirs(basePath) {
        try {
            // 获取服务端所有文档
            const serverDocuments = await this.getDocumentsTree();

            // 为服务端文档添加序号
            serverDocuments.forEach((doc, index) => {
                doc.order = index + 1;
            });

            // 构建服务端文档名称集合
            const serverDocNames = new Set();
            const serverDocSafeNames = new Set();

            for (const doc of serverDocuments) {
                const docName = doc.name || '';
                if (docName) {
                    // 添加原始名称
                    serverDocNames.add(docName);
                    // 添加安全名称（处理特殊字符）
                    const safeName = this.getSafeName(docName);
                    serverDocSafeNames.add(safeName);
                    // 如果有序号前缀，也添加带序号前缀的名称
                    if (this.use_order_prefix) {
                        const order = doc.order || 1;
                        const orderedName = this.getOrderedName(docName, order, serverDocuments.length);
                        serverDocNames.add(orderedName);
                        serverDocSafeNames.add(orderedName);
                    }
                }
            }

            this.logger.info(`🔍 服务端共有 ${serverDocuments.length} 个文档`);

            // 扫描本地所有文档目录
            let localDocDirs = [];
            try {
                const items = await fs.readdir(basePath);
                for (const item of items) {
                    const itemPath = path.join(basePath, item);
                    const stat = await fs.stat(itemPath);
                    if (stat.isDirectory() && !item.startsWith('.') && item !== '.trp_metadata') {
                        localDocDirs.push({ path: itemPath, name: item });
                    }
                }
            } catch {
                // 目录可能不存在
                this.logger.info('本地目录不存在，跳过删除文档目录检查');
                return;
            }

            this.logger.info(`🔍 本地共有 ${localDocDirs.length} 个文档目录`);

            // 检查每个本地文档目录是否在服务端存在
            let deletedCount = 0;
            for (const localDir of localDocDirs) {
                const dirName = localDir.name;
                let matched = false;

                // 方法1: 直接匹配完整目录名称
                if (serverDocNames.has(dirName) || serverDocSafeNames.has(dirName)) {
                    matched = true;
                    this.logger.debug(`✅ 匹配到文档目录: ${dirName} (直接匹配)`);
                } else {
                    // 方法2: 去除序号前缀后匹配
                    const match = dirName.match(/^\d+_(.+)$/);
                    if (match) {
                        const nameWithoutPrefix = match[1];
                        // 检查去除前缀后的名称是否匹配
                        if (serverDocNames.has(nameWithoutPrefix) || serverDocSafeNames.has(nameWithoutPrefix)) {
                            matched = true;
                            this.logger.debug(`✅ 匹配到文档目录: ${dirName} -> ${nameWithoutPrefix} (去除序号前缀后匹配)`);
                        } else {
                            // 方法3: 遍历服务端文档，进行精确匹配
                            for (const doc of serverDocuments) {
                                const docName = doc.name || '';
                                if (docName) {
                                    const safeName = this.getSafeName(docName);
                                    // 直接比较安全名称
                                    if (nameWithoutPrefix === safeName) {
                                        matched = true;
                                        this.logger.debug(`✅ 匹配到文档目录: ${dirName} -> ${nameWithoutPrefix} == ${safeName} (安全名称匹配)`);
                                        break;
                                    }
                                    // 如果使用序号前缀，也检查带序号的安全名称
                                    if (this.use_order_prefix) {
                                        const order = doc.order || 1;
                                        const orderedSafeName = this.getOrderedName(docName, order, serverDocuments.length);
                                        if (nameWithoutPrefix === orderedSafeName) {
                                            matched = true;
                                            this.logger.debug(`✅ 匹配到文档目录: ${dirName} -> ${nameWithoutPrefix} == ${orderedSafeName} (带序号安全名称匹配)`);
                                            break;
                                        }
                                    }
                                }
                            }
                        }
                    } else {
                        // 方法4: 没有序号前缀的情况，直接与服务端文档的安全名称比较
                        for (const doc of serverDocuments) {
                            const docName = doc.name || '';
                            if (docName) {
                                const safeName = this.getSafeName(docName);
                                if (dirName === safeName) {
                                    matched = true;
                                    this.logger.debug(`✅ 匹配到文档目录: ${dirName} == ${safeName} (无前缀安全名称匹配)`);
                                    break;
                                }
                                // 如果使用序号前缀，也检查带序号的安全名称
                                if (this.use_order_prefix) {
                                    const order = doc.order || 1;
                                    const orderedSafeName = this.getOrderedName(docName, order, serverDocuments.length);
                                    if (dirName === orderedSafeName) {
                                        matched = true;
                                        this.logger.debug(`✅ 匹配到文档目录: ${dirName} == ${orderedSafeName} (无前缀带序号安全名称匹配)`);
                                        break;
                                    }
                                }
                            }
                        }
                    }
                }

                // 如果本地目录在服务端不存在，删除它
                if (!matched) {
                    this.logger.info(`🗑️ 确认删除文档目录: 服务端已删除文档，删除本地目录: ${localDir.path}`);
                    await this.deleteDocumentDir(localDir.path);
                    deletedCount++;
                } else {
                    this.logger.debug(`保留文档目录: ${localDir.path} (在服务端存在)`);
                }
            }

            if (deletedCount > 0) {
                this.logger.info(`✅ 已删除 ${deletedCount} 个文档目录`);
            } else {
                this.logger.info(`✅ 没有需要删除的文档目录`);
            }

        } catch (error) {
            this.logger.error(`❌ 处理删除文档目录时出错: ${error.message}`);
            throw error;
        }
    }

    async deleteDocumentDir(dirPath) {
        try {
            const { rimraf } = await import('rimraf');

            try {
                await fs.access(dirPath);
            } catch {
                this.logger.warn(`⚠️ 文档目录不存在: ${dirPath}`);
                return;
            }

            // 删除整个目录及其内容
            await rimraf(dirPath);
            this.logger.info(`✅ 已成功删除文档目录: ${dirPath}`);

        } catch (error) {
            this.logger.error(`❌ 删除文档目录失败 ${dirPath}: ${error.message}`);
            throw error;
        }
    }

    cleanupEmptyDirectories(dirPath, basePath) {
        // 保持向后兼容的方法
        // 这个方法在当前的实现中没有被调用，但为了与 Python 版本保持一致性而保留
    }

    async handleConflict(doc, localFilePath) {
        // 处理文件冲突的方法
        // 在当前实现中未被使用，但为了与 Python 版本保持一致性而保留
    }

    async markFileAsConflict(filePath) {
        // 标记文件为冲突状态的方法
        // 在当前实现中未被使用，但为了与 Python 版本保持一致性而保留
    }

    async getAllExistingPageIds() {
        const pageIds = new Set();

        try {
            // 获取所有文档
            const documents = await this.getDocumentsTree();

            // 遍历每个文档，收集所有页面ID
            for (const document of documents) {
                const pages = await this.getDocumentPages(document.id);
                this.collectPageIds(pages, pageIds);
            }

            this.logger.info(`✅ 成功获取到【${pageIds.size}】个服务端页面ID`);
            return pageIds;
        } catch (error) {
            this.logger.error(`获取服务端页面ID列表失败: ${error.message}`);
            return pageIds;
        }
    }

    collectPageIds(pages, pageIds) {
        for (const page of pages) {
            const pageId = page.id || '';
            if (pageId) {
                pageIds.add(pageId);
            }

            // 递归处理子页面
            const children = page.children || [];
            if (children.length > 0) {
                this.collectPageIds(children, pageIds);
            }
        }
    }

    async getLastSyncTime(targetPath) {
        const metadataDir = path.join(targetPath, '.trp_metadata');
        const syncLogFile = path.join(metadataDir, 'sync_log.json');

        try {
            await fs.access(syncLogFile);
            const syncLogContent = await fs.readFile(syncLogFile, 'utf-8');
            const syncLog = JSON.parse(syncLogContent);
            return syncLog.sync_time;
        } catch {
            this.logger.warn('读取上次同步时间失败');
            return null;
        }
    }

    async downloadPage(page, targetPath) {
        return this.queue.add(async () => {
            try {
                const pageId = page.id || '';
                const pageName = page.name || 'untitled';

                if (!pageId) {
                    return true;
                }

                // 检查文件是否已存在且内容相同
                try {
                    await fs.access(targetPath);
                    const existingContent = await fs.readFile(targetPath, 'utf-8');
                    const newContent = await this.getPageContent(pageId);
                    if (existingContent === newContent) {
                        this.logger.debug(`页面未变更，跳过: ${targetPath}`);
                        this.stats.skipped++;
                        return true;
                    }
                } catch {
                    // 如果读取现有文件失败，继续下载
                }

                // 获取页面内容
                const content = await this.getPageContent(pageId);

                // 确保目录存在
                await fs.mkdir(path.dirname(targetPath), { recursive: true });

                // 写入文件
                await fs.writeFile(targetPath, content || '', 'utf-8');

                this.stats.success++;
                this.logger.debug(`下载成功: ${targetPath}`);
                return true;

            } catch (error) {
                this.stats.errors++;
                this.logger.error(`下载失败 ${page.name || 'unknown'}: ${error.message}`);
                return false;
            }
        });
    }

    async processDoc(doc, basePath, siblingsCount = 1, overwrite = false) {
        try {
            // 创建文档目录
            const orderedName = this.getOrderedName(doc.name, doc.order || 1, siblingsCount);
            const docDirPath = path.join(basePath, orderedName);
            await fs.mkdir(docDirPath, { recursive: true });

            // 获取文档的页面树结构
            const pages = await this.getDocumentPages(doc.id);

            // 递归处理页面树
            if (pages && pages.length > 0) {
                await this.processPageTree(pages, docDirPath, overwrite);
            } else {
                // 如果没有页面树，则创建文档主文件
                const filePath = path.join(docDirPath, `${orderedName}.trp`);
                const exists = await this.fileExists(filePath);
                if (!exists || overwrite) {
                    await this.downloadAndProcessPage(doc, filePath);
                }
            }

        } catch (error) {
            this.logger.error(`处理文档 ${doc.name || 'unknown'} 时出错: ${error.message}`);
        }
    }

    async processPageTree(pages, basePath, overwrite = false) {
        const tasks = [];

        for (const page of pages) {
            // 创建安全的页面名称作为目录
            const pageName = this.getSafeName(page.name);
            const pagePath = path.join(basePath, pageName);

            // 创建目录
            await fs.mkdir(pagePath, { recursive: true });

            // 创建页面文件
            const filePath = path.join(pagePath, `${pageName}.trp`);
            const exists = await this.fileExists(filePath);
            if (!exists || overwrite) {
                tasks.push(this.queue.add(() => this.downloadAndProcessPage(page, filePath)));
            }

            // 递归处理子页面
            const children = page.children || [];
            if (children.length > 0) {
                tasks.push(this.processPageTree(children, pagePath, overwrite));
            }
        }

        // 等待所有任务完成
        if (tasks.length > 0) {
            await Promise.allSettled(tasks);
        }
    }

    async downloadAndProcessPage(doc, filePath) {
        try {
            const pageData = await this.getPageContent(doc.id);

            // 即使没有内容也创建文件，保持与 Python 版本一致
            if (pageData === null) {
                pageData = "";
            }

            const processedContent = this.processXmlContent(pageData);

            // 构建元数据
            const metadata = {
                id: doc.id,
                name: doc.name,
                modifyTime: doc.modifyTime || '',
                maxElementId: this.max_element_id
            };

            const finalContent = this.processMetadataTag(processedContent, metadata);

            await fs.writeFile(filePath, finalContent, 'utf-8');

            this.stats.success++;
            this.logger.debug(`下载成功: ${filePath}`);

        } catch (error) {
            this.stats.errors++;
            this.logger.error(`下载页面 ${doc.name || 'unknown'} 失败: ${error.message}`);
        }
    }

    async processDocuments(docs, basePath, overwrite = false) {
        // 为文档添加序号
        docs.forEach((doc, index) => {
            doc.order = index + 1;
        });

        // 并发处理所有文档
        const tasks = docs.map(doc =>
            this.processDoc(doc, basePath, docs.length, overwrite)
        );

        // 等待所有文档处理完成
        if (tasks.length > 0) {
            await Promise.allSettled(tasks);
        }
    }

    formatOrder(order, totalItems) {
        const width = totalItems.toString().length;
        return order.toString().padStart(width, '0');
    }

    getOrderedName(name, order, totalItems) {
        const safeName = this.getSafeName(name);
        if (this.use_order_prefix) {
            return `${order}_${safeName}`;
        } else {
            return safeName;
        }
    }

    getSafeName(name) {
        let safeName = name;
        for (const replacement of this.NAME_REPLACEMENTS) {
            safeName = safeName.replace(replacement.pattern, replacement.replacement);
        }
        return safeName;
    }

    getSafeFilename(name) {
        // 保持向后兼容的方法
        return this.getSafeName(name);
    }

    processXmlContent(content) {
        this.max_element_id = 0;
        let idCounter = 1;

        try {
            // 处理图片src路径
            content = content.replace(
                /<img([^>]*?)\s+src="static\/([^"]*)"([^>]*?)>/g,
                `<img$1 src="${this.base_url}/static/$2"$3>`
            );

            // 简化的HTML处理，主要用于添加缺少的ID
            content = content.replace(/<(\w+)([^>]*)>/g, (match, tag, attrs) => {
                // 检查是否已经有id属性
                if (!attrs.includes('id=')) {
                    const id = `trp-${idCounter}`;
                    this.max_element_id = Math.max(this.max_element_id, idCounter);
                    idCounter++;
                    return `<${tag}${attrs} id="${id}">`;
                }
                return match;
            });

            return content;
        } catch (error) {
            this.logger.error(`处理XML内容时出错: ${error.message}`);
            return content;
        }
    }

    processMetadataTag(content, newMetadata) {
        try {
            // 创建新的metadata属性字符串
            const attributesParts = [];
            for (const [key, value] of Object.entries(newMetadata)) {
                if (typeof value === 'object' && value !== null) {
                    // 扁平化对象
                    const flattenObject = (obj, prefix = '') => {
                        const parts = [];
                        for (const [k, v] of Object.entries(obj)) {
                            const newKey = prefix ? `${prefix}.${k}` : k;
                            if (typeof v === 'object' && v !== null) {
                                parts.push(...flattenObject(v, newKey));
                            } else {
                                parts.push(`${newKey}='${String(v).replace(/'/g, '&apos;')}'`);
                            }
                        }
                        return parts;
                    };
                    attributesParts.push(...flattenObject(value, key));
                } else {
                    attributesParts.push(`${key}='${String(value).replace(/'/g, '&apos;')}'`);
                }
            }

            const attributesStr = attributesParts.join(' ');
            const metadataTag = `<docx-metadata ${attributesStr}></docx-metadata>\n`;

            // 使用正则表达式查找现有的metadata标签
            const metadataRegex = /<docx-metadata[^>]*>.*?<\/docx-metadata>\n?/s;
            if (metadataRegex.test(content)) {
                // 替换现有的metadata标签
                return content.replace(metadataRegex, metadataTag);
            } else {
                // 在开头添加新的metadata标签
                return metadataTag + content;
            }

        } catch (error) {
            this.logger.error(`处理元数据标签时出错: ${error.message}`);
            // 如果处理失败，返回带新metadata标签的内容
            const attributesStr = Object.entries(newMetadata)
                .map(([k, v]) => `${k}='${v}'`)
                .join(' ');
            return `<docx-metadata ${attributesStr}></docx-metadata>\n${content}`;
        }
    }

    async saveMetadata(targetFolder, workspaceInfo) {
        const metadataDir = path.join(targetFolder, '.trp_metadata');
        await fs.mkdir(metadataDir, { recursive: true });

        // 保存工作空间元数据
        const metadata = new WorkspaceMetadata(
            workspaceInfo.workspace,
            workspaceInfo.version,
            new Date().toISOString(),
            this.stats.total,
            this.stats.success,
            this.stats.errors
        );

        const workspaceFile = path.join(metadataDir, 'workspace.json');
        await fs.writeFile(workspaceFile, JSON.stringify(metadata, null, 2), 'utf-8');

        // 保存同步日志
        const syncLog = {
            sync_time: metadata.syncTime,
            stats: this.stats,
            parameters: {
                workspace_sn: this.workspace_sn,
                version_iid: this.version_iid,
                base_url: this.base_url,
                concurrency: this.concurrency
            }
        };

        const logFile = path.join(metadataDir, 'sync_log.json');
        await fs.writeFile(logFile, JSON.stringify(syncLog, null, 2), 'utf-8');

        this.logger.info(`元数据已保存到: ${metadataDir}`);
    }

    async crawl(outputPath, overwrite = false) {
        const startTime = Date.now();
        const targetPath = path.resolve(outputPath);

        this.logger.info(`开始同步 TRP 文档...`);
        this.logger.info(`目标文件夹: ${targetPath}`);
        this.logger.info(`工作空间: ${this.workspace_sn}`);
        this.logger.info(`版本: ${this.version_iid}`);
        this.logger.info(`同步模式: ${this.incremental ? '增量同步' : '全量同步'}`);

        try {
            // 创建.trp_metadata目录
            const metadataDir = path.join(targetPath, '.trp_metadata');
            await fs.mkdir(metadataDir, { recursive: true });

            // 并发获取工作空间信息和版本信息
            const [workspaceResponse, versionResponse] = await Promise.allSettled([
                this.makeRequest('GET', `/api/manage/workspace?paginate=0&vid=${this.version_iid}&from=autoba`),
                this.makeRequest('GET', `/api/trp/workspace/${this.workspace_sn}/version?paginate=0&type=branch&from=autoba`)
            ]);

            // 处理工作空间信息
            let workspaceInfo = null;
            if (workspaceResponse.status === 'fulfilled' && workspaceResponse.value?.data) {
                const workspaceData = workspaceResponse.value.data;
                workspaceInfo = workspaceData.find(ws => ws.sn === this.workspace_sn);
            }

            // 处理版本信息
            let versionInfo = null;
            if (versionResponse.status === 'fulfilled' && versionResponse.value?.data) {
                const versionData = versionResponse.value.data;
                versionInfo = versionData.find(v => v.iid === this.version_iid);
            }

            // 保存工作空间信息
            const workspaceMetadata = {
                workspace: {
                    sn: this.workspace_sn,
                    id: workspaceInfo?.id || null,
                    name: workspaceInfo?.name || `Workspace ${this.workspace_sn}`,
                    description: workspaceInfo?.description || '',
                    baAnalysisMode: workspaceInfo?.baAnalysisMode || null,
                    platforms: workspaceInfo?.platforms || null,
                    isPublic: workspaceInfo?.isPublic || null,
                    createTime: workspaceInfo?.createTime || null,
                    managers: workspaceInfo?.managers || null
                },
                version: {
                    id: this.version_iid,
                    iid: versionInfo?.iid || this.version_iid,
                    name: versionInfo?.name || `Version ${this.version_iid}`,
                    description: versionInfo?.description || '',
                    latestVer: versionInfo?.latestVer || '',
                    createTime: versionInfo?.createTime || null
                },
                baseUrl: this.base_url,
                downloadTime: new Date().toISOString()
            };

            const workspaceFile = path.join(metadataDir, 'workspace.json');
            await fs.writeFile(workspaceFile, JSON.stringify(workspaceMetadata, null, 2), 'utf-8');

            // 根据同步模式选择处理方式
            if (this.incremental) {
                // 增量同步模式
                await this.performIncrementalSync(targetPath, overwrite);
            } else {
                // 全量同步模式
                await this.performFullSync(targetPath, overwrite);
            }

            // 输出统计信息
            const elapsedTime = (Date.now() - startTime) / 1000;
            this.logger.info("=".repeat(50));
            this.logger.info("同步完成!");
            this.logger.info(`总页面数: ${this.stats.total}`);
            this.logger.info(`成功下载: ${this.stats.success}`);
            this.logger.info(`跳过未变更: ${this.stats.skipped}`);
            this.logger.info(`下载失败: ${this.stats.errors}`);
            this.logger.info(`耗时: ${elapsedTime.toFixed(2)} 秒`);
            this.logger.info("=".repeat(50));

        } catch (error) {
            this.logger.error(`同步过程中发生错误: ${error.message}`);
            throw error;
        }
    }

    async performIncrementalSync(targetPath, overwrite = false) {
        try {
            // 获取增量同步的起始时间
            let syncFromTime;
            if (this.from_time) {
                syncFromTime = this.from_time;
                this.logger.info(`使用指定起始时间: ${syncFromTime}`);
            } else {
                syncFromTime = await this.getLastSyncTime(targetPath);
                if (syncFromTime) {
                    this.logger.info(`使用上次同步时间: ${syncFromTime}`);
                } else {
                    this.logger.info("未找到上次同步时间，执行首次全量同步");
                    await this.performFullSync(targetPath, overwrite);
                    return;
                }
            }

            // 获取修改过的页面列表
            this.logger.info(`🔍 开始获取修改的文档列表，modifyTime参数: ${syncFromTime}`);
            const modifiedPagesData = await this.getPagesByModifyTime(syncFromTime);

            // 转换为 ModifyDoc 对象列表
            const modifiedDocs = modifiedPagesData.map(page => new ModifyDoc(
                page.docIId || '',
                page.iid || '',
                page.id || '',
                String(page.modifyTime || ''),
                page.name || '',
                page.docName || ''
            ));

            // 处理自动更新
            this.logger.info(`💼 开始处理自动更新：操作目录【${targetPath}】, 覆盖模式【${overwrite}】`);
            await this.processIncrementalSync(modifiedDocs, targetPath, overwrite);
            this.logger.info(`✅ 自动更新处理完成`);

        } catch (error) {
            this.logger.error(`增量同步过程中发生错误: ${error.message}`);
            throw error;
        }
    }

    async performFullSync(targetPath, overwrite = false) {
        try {
            // 获取文档列表
            this.logger.info("获取文档列表...");
            const documents = await this.getDocumentsTree();

            if (!documents || documents.length === 0) {
                this.logger.warn("未找到任何文档");
                // 即使服务端没有文档，也需要删除本地已存在的文档目录
                try {
                    await this.processDeletedDocumentDirs(targetPath);
                } catch (error) {
                    this.logger.error('❌ 处理删除文档目录时发生异常:', error.message);
                }
                return;
            }

            this.logger.info(`找到 ${documents.length} 个文档`);

            // 全量同步前，先扫描本地文件并删除服务端已不存在的文件和文档目录
            try {
                // 扫描本地所有 .trp 文件
                this.logger.info("扫描本地文件...");
                const localFileMap = await this.scanLocalFiles(targetPath);

                // 获取服务端所有当前存在的页面ID
                this.logger.info("获取服务端所有页面ID...");
                let serverPageIds = new Set();
                try {
                    serverPageIds = await this.getAllExistingPageIds();
                } catch (error) {
                    this.logger.error('❌ 获取服务端页面ID失败，跳过删除文件处理:', error.message);
                    serverPageIds = new Set();
                }

                // 处理服务端已删除的文件
                this.logger.info("检查并删除服务端已删除的文件...");
                try {
                    await this.processDeletedFiles(localFileMap, serverPageIds, targetPath);
                } catch (error) {
                    this.logger.error('❌ 处理删除文件时发生异常:', error.message);
                }

                // 处理服务端已删除的文档目录
                this.logger.info("检查并删除服务端已不存在的文档目录...");
                try {
                    await this.processDeletedDocumentDirs(targetPath);
                } catch (error) {
                    this.logger.error('❌ 处理删除文档目录时发生异常:', error.message);
                }
            } catch (error) {
                // 继续执行后续步骤，不因删除操作失败而中断整个流程
                this.logger.error('❌ 处理删除操作时发生异常:', error.message);
            }

            // 处理文档
            this.logger.info("开始下载文档...");
            await this.processDocuments(documents, targetPath, overwrite);

        } catch (error) {
            this.logger.error(`全量同步过程中发生错误: ${error.message}`);
            throw error;
        }
    }

    async syncDocuments(targetFolder, overwrite = false) {
        try {
            await this.crawl(targetFolder, overwrite);
            return this.stats.errors === 0;
        } catch (error) {
            this.logger.error(`同步过程中发生错误: ${error.message}`);
            return false;
        }
    }

    // 工具方法
    async fileExists(filePath) {
        try {
            await fs.access(filePath);
            return true;
        } catch {
            return false;
        }
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

export default TrpSyncManager;

// 定时轮询任务类
class TrpScheduler {
    constructor(config) {
        this.config = config;
        this.logger = winston.createLogger({
            level: 'info',
            format: winston.format.combine(
                winston.format.timestamp(),
                winston.format.printf(({ timestamp, level, message }) => {
                    return `${timestamp} - ${level} - ${message}`;
                })
            ),
            transports: [new winston.transports.Console()]
        });
        this.isRunning = false;
        this.task = null;
    }

    start() {
        if (this.isRunning) {
            this.logger.warn('定时任务已在运行中');
            return;
        }

        if (!this.config.cronPattern && !this.config.intervalMinutes) {
            this.logger.error('必须配置 cronPattern 或 intervalMinutes');
            return;
        }

        this.isRunning = true;
        this.logger.info('启动 TRP 定时同步任务');

        const syncTask = async () => {
            try {
                this.logger.info('开始执行定时同步任务');
                const manager = new TrpSyncManager(
                    this.config.baseUrl,
                    this.config.workspaceSn,
                    this.config.versionIid,
                    {
                        token: this.config.token,
                        concurrency: this.config.concurrency || 10,
                        use_order_prefix: this.config.useOrderPrefix || false,
                        incremental: this.config.incremental !== false, // 默认启用增量同步
                        from_time: this.config.fromTime,
                        verbose: this.config.verbose
                    }
                );

                await manager.init();
                const success = await manager.syncDocuments(this.config.targetFolder, true);

                if (success) {
                    this.logger.info('定时同步任务执行成功');
                } else {
                    this.logger.error('定时同步任务执行失败');
                }
            } catch (error) {
                this.logger.error(`定时同步任务执行异常: ${error.message}`);
            }
        };

        if (this.config.cronPattern) {
            // 使用 cron 表达式
            this.task = cron.schedule(this.config.cronPattern, syncTask, {
                scheduled: true
            });
            this.logger.info(`使用 cron 表达式: ${this.config.cronPattern}`);
        } else {
            // 使用间隔时间
            const intervalMs = this.config.intervalMinutes * 60 * 1000;
            this.task = setInterval(syncTask, intervalMs);
            this.logger.info(`使用间隔时间: ${this.config.intervalMinutes} 分钟`);
        }

        // 立即执行一次
        if (this.config.runImmediately !== false) {
            syncTask();
        }
    }

    stop() {
        if (!this.isRunning) {
            this.logger.warn('定时任务未在运行');
            return;
        }

        this.isRunning = false;

        if (this.task) {
            if (this.config.cronPattern) {
                this.task.stop();
            } else {
                clearInterval(this.task);
            }
            this.task = null;
        }

        this.logger.info('TRP 定时同步任务已停止');
    }
}

export { TrpScheduler };