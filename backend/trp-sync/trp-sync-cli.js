#!/usr/bin/env node

import { Command } from 'commander';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import TrpSyncManager, { TrpScheduler } from './trp-sync.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const program = new Command();

// 默认配置文件路径
const DEFAULT_CONFIG_FILE = path.join(__dirname, 'trp-sync-config.json');

// 配置文件模板
const DEFAULT_CONFIG = {
    baseUrl: '',
    workspaceSn: '',
    versionIid: '',
    token: 'sunline',
    targetFolder: './trp-docs',
    concurrency: 10,
    useOrderPrefix: false,
    incremental: true,
    fromTime: null,
    verbose: false,
    // 定时任务配置
    scheduler: {
        enabled: false,
        cronPattern: null, // 例如: '*/1 * * * *' 每分钟执行一次
        intervalMinutes: 1, // 或者使用间隔时间（分钟）
        runImmediately: true
    }
};

async function loadConfig(configPath) {
    try {
        const configContent = await fs.readFile(configPath, 'utf-8');
        return JSON.parse(configContent);
    } catch (error) {
        if (error.code === 'ENOENT') {
            // 配置文件不存在，创建默认配置
            console.log(`配置文件不存在，创建默认配置文件: ${configPath}`);
            await fs.writeFile(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf-8');
            return DEFAULT_CONFIG;
        }
        throw new Error(`加载配置文件失败: ${error.message}`);
    }
}

async function saveConfig(config, configPath) {
    await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

program
    .name('trp-sync')
    .description('TRP 文档同步工具 - Node.js 版本')
    .version('1.0.0');

// 一次性同步命令
program
    .command('sync')
    .description('执行一次性文档同步')
    .option('-c, --config <path>', '配置文件路径', DEFAULT_CONFIG_FILE)
    .option('--base-url <url>', 'TRP API 基础地址')
    .option('--workspace-sn <sn>', '工作空间编号')
    .option('--version-iid <iid>', '版本实例ID')
    .option('--token <token>', 'API 访问令牌', 'sunline')
    .option('--target-folder <folder>', '本地目标文件夹路径')
    .option('--concurrency <num>', '并发下载数量', '10')
    .option('--use-order-prefix', '使用序号前缀')
    .option('--incremental', '启用增量同步模式')
    .option('--from-time <time>', '增量同步起始时间 (格式: 2024-01-01T00:00:00)')
    .option('--overwrite', '覆盖已存在的文件')
    .option('--verbose, -v', '详细输出')
    .action(async (options) => {
        try {
            // 加载配置文件
            const config = await loadConfig(options.config);

            // 命令行参数覆盖配置文件
            const baseUrl = options.baseUrl || config.baseUrl;
            const workspaceSn = options.workspaceSn || config.workspaceSn;
            const versionIid = options.versionIid || config.versionIid;
            const token = options.token || config.token;
            const targetFolder = options.targetFolder || config.targetFolder;
            const concurrency = parseInt(options.concurrency) || config.concurrency;
            const useOrderPrefix = options.useOrderPrefix || config.useOrderPrefix;
            const incremental = options.incremental || config.incremental;
            const fromTime = options.fromTime || config.fromTime;
            const verbose = options.verbose || config.verbose;
            const overwrite = options.overwrite;

            // 验证必需参数
            if (!baseUrl || !workspaceSn || !versionIid || !targetFolder) {
                console.error('错误: 缺少必需参数 (base-url, workspace-sn, version-iid, target-folder)');
                process.exit(1);
            }

            // 检查目标文件夹的父目录是否存在
            const targetPath = path.resolve(targetFolder);
            const parentDir = path.dirname(targetPath);
            try {
                await fs.access(parentDir);
            } catch {
                console.error(`错误: 目标文件夹的父目录不存在: ${parentDir}`);
                process.exit(1);
            }

            console.log('🚀 开始执行 TRP 文档同步...');
            console.log(`📁 目标文件夹: ${targetPath}`);
            console.log(`🏢 工作空间: ${workspaceSn}`);
            console.log(`📋 版本: ${versionIid}`);
            console.log(`🔄 同步模式: ${incremental ? '增量同步' : '全量同步'}`);

            // 执行同步
            const manager = new TrpSyncManager(baseUrl, workspaceSn, versionIid, {
                token,
                concurrency,
                use_order_prefix: useOrderPrefix,
                incremental,
                from_time: fromTime,
                verbose
            });

            await manager.init();
            const success = await manager.syncDocuments(targetFolder, overwrite);

            if (success) {
                console.log('✅ 同步完成!');
                process.exit(0);
            } else {
                console.error('❌ 同步过程中出现错误');
                process.exit(1);
            }

        } catch (error) {
            console.error(`❌ 同步失败: ${error.message}`);
            if (options.verbose) {
                console.error(error.stack);
            }
            process.exit(1);
        }
    });

// 启动定时任务命令
program
    .command('start-scheduler')
    .description('启动定时同步任务')
    .option('-c, --config <path>', '配置文件路径', DEFAULT_CONFIG_FILE)
    .option('--daemon', '以守护进程模式运行')
    .action(async (options) => {
        try {
            const config = await loadConfig(options.config);

            // 验证调度器配置
            if (!config.scheduler.enabled) {
                console.error('错误: 定时任务未启用，请在配置文件中设置 scheduler.enabled = true');
                process.exit(1);
            }

            if (!config.baseUrl || !config.workspaceSn || !config.versionIid || !config.targetFolder) {
                console.error('错误: 配置文件中缺少必需参数 (baseUrl, workspaceSn, versionIid, targetFolder)');
                process.exit(1);
            }

            console.log('🕐 启动 TRP 定时同步任务...');
            console.log(`📁 目标文件夹: ${config.targetFolder}`);
            console.log(`🏢 工作空间: ${config.workspaceSn}`);
            console.log(`📋 版本: ${config.versionIid}`);

            if (config.scheduler.cronPattern) {
                console.log(`⏰ Cron 表达式: ${config.scheduler.cronPattern}`);
            } else {
                console.log(`⏰ 间隔时间: ${config.scheduler.intervalMinutes} 分钟`);
            }

            // 创建调度器
            const schedulerConfig = {
                ...config,
                ...config.scheduler
            };

            const scheduler = new TrpScheduler(schedulerConfig);

            // 处理进程信号
            const cleanup = () => {
                console.log('\n🛑 正在停止定时任务...');
                scheduler.stop();
                process.exit(0);
            };

            process.on('SIGINT', cleanup);
            process.on('SIGTERM', cleanup);

            // 启动调度器
            scheduler.start();

            console.log('✅ 定时任务已启动，按 Ctrl+C 停止');

            // 如果不是守护进程模式，保持进程运行
            if (!options.daemon) {
                // 保持进程运行
                process.stdin.resume();
            }

        } catch (error) {
            console.error(`❌ 启动定时任务失败: ${error.message}`);
            process.exit(1);
        }
    });

// 停止定时任务命令
program
    .command('stop-scheduler')
    .description('停止定时同步任务')
    .action(() => {
        console.log('⚠️ 请使用 Ctrl+C 停止正在运行的定时任务');
        console.log('或者使用进程管理工具 kill 相关进程');
    });

// 配置管理命令
program
    .command('config')
    .description('配置管理')
    .option('-c, --config <path>', '配置文件路径', DEFAULT_CONFIG_FILE)
    .option('--show', '显示当前配置')
    .option('--set <key=value>', '设置配置项 (可多次使用)')
    .option('--reset', '重置为默认配置')
    .action(async (options) => {
        try {
            const configPath = options.config;

            if (options.reset) {
                await saveConfig(DEFAULT_CONFIG, configPath);
                console.log(`✅ 配置已重置为默认值: ${configPath}`);
                return;
            }

            const config = await loadConfig(configPath);

            if (options.show) {
                console.log('📋 当前配置:');
                console.log(JSON.stringify(config, null, 2));
                return;
            }

            if (options.set) {
                const sets = Array.isArray(options.set) ? options.set : [options.set];

                for (const setItem of sets) {
                    const [key, value] = setItem.split('=', 2);
                    if (!key || value === undefined) {
                        console.error(`错误: 无效的配置项格式: ${setItem}，应为 key=value`);
                        process.exit(1);
                    }

                    // 支持嵌套键，例如 scheduler.enabled
                    const keys = key.split('.');
                    let current = config;

                    for (let i = 0; i < keys.length - 1; i++) {
                        if (!(keys[i] in current)) {
                            current[keys[i]] = {};
                        }
                        current = current[keys[i]];
                    }

                    // 尝试解析值类型
                    let parsedValue = value;
                    if (value === 'true') {
                        parsedValue = true;
                    } else if (value === 'false') {
                        parsedValue = false;
                    } else if (/^\d+$/.test(value)) {
                        parsedValue = parseInt(value, 10);
                    } else if (/^\d+\.\d+$/.test(value)) {
                        parsedValue = parseFloat(value);
                    }

                    current[keys[keys.length - 1]] = parsedValue;
                    console.log(`✅ 设置 ${key} = ${parsedValue}`);
                }

                await saveConfig(config, configPath);
                console.log(`💾 配置已保存到: ${configPath}`);
                return;
            }

            // 如果没有指定任何操作，显示帮助
            console.log('请指定操作: --show, --set <key=value>, 或 --reset');

        } catch (error) {
            console.error(`❌ 配置操作失败: ${error.message}`);
            process.exit(1);
        }
    });

// 初始化配置命令
program
    .command('init')
    .description('初始化配置文件')
    .option('-c, --config <path>', '配置文件路径', DEFAULT_CONFIG_FILE)
    .option('--interactive', '交互式配置')
    .action(async (options) => {
        try {
            const configPath = options.config;

            // 检查配置文件是否已存在
            try {
                await fs.access(configPath);
                const overwrite = await promptOverwrite();
                if (!overwrite) {
                    console.log('❌ 操作已取消');
                    process.exit(0);
                }
            } catch {
                // 配置文件不存在，继续创建
            }

            let config = { ...DEFAULT_CONFIG };

            if (options.interactive) {
                console.log('🔧 交互式配置向导');
                console.log('请输入以下配置信息（按回车使用默认值）:\n');

                config.baseUrl = await promptInput('TRP API 基础地址', config.baseUrl);
                config.workspaceSn = await promptInput('工作空间编号', config.workspaceSn);
                config.versionIid = await promptInput('版本实例ID', config.versionIid);
                config.token = await promptInput('API 访问令牌', config.token);
                config.targetFolder = await promptInput('本地目标文件夹路径', config.targetFolder);
                config.concurrency = parseInt(await promptInput('并发下载数量', config.concurrency.toString()));
                config.useOrderPrefix = await promptConfirm('使用序号前缀', config.useOrderPrefix);
                config.incremental = await promptConfirm('启用增量同步模式', config.incremental);
                config.fromTime = await promptInput('增量同步起始时间 (可选)', config.fromTime || '');
                config.verbose = await promptConfirm('详细输出', config.verbose);

                console.log('\n⏰ 定时任务配置:');
                config.scheduler.enabled = await promptConfirm('启用定时任务', config.scheduler.enabled);
                if (config.scheduler.enabled) {
                    config.scheduler.intervalMinutes = parseInt(await promptInput('同步间隔时间（分钟）', config.scheduler.intervalMinutes.toString()));
                    config.scheduler.runImmediately = await promptConfirm('启动时立即执行一次同步', config.scheduler.runImmediately);
                }
            }

            await saveConfig(config, configPath);
            console.log(`\n✅ 配置文件已创建: ${configPath}`);
            console.log('📝 你可以使用以下命令:');
            console.log(`  trp-sync sync -c ${configPath}`);
            console.log(`  trp-sync start-scheduler -c ${configPath}`);

        } catch (error) {
            console.error(`❌ 初始化配置失败: ${error.message}`);
            process.exit(1);
        }
    });

// 状态检查命令
program
    .command('status')
    .description('检查同步状态和配置')
    .option('-c, --config <path>', '配置文件路径', DEFAULT_CONFIG_FILE)
    .action(async (options) => {
        try {
            const config = await loadConfig(options.config);

            console.log('📊 TRP 同步工具状态');
            console.log('='.repeat(30));

            // 检查配置文件
            console.log(`📄 配置文件: ${options.config}`);
            console.log(`🌐 API 基础地址: ${config.baseUrl || '❌ 未配置'}`);
            console.log(`🏢 工作空间: ${config.workspaceSn || '❌ 未配置'}`);
            console.log(`📋 版本 ID: ${config.versionIid || '❌ 未配置'}`);
            console.log(`📁 目标文件夹: ${config.targetFolder || '❌ 未配置'}`);
            console.log(`⚙️ 并发数: ${config.concurrency}`);
            console.log(`🔄 同步模式: ${config.incremental ? '增量同步' : '全量同步'}`);

            // 检查定时任务配置
            console.log(`⏰ 定时任务: ${config.scheduler.enabled ? '✅ 启用' : '❌ 禁用'}`);
            if (config.scheduler.enabled) {
                if (config.scheduler.cronPattern) {
                    console.log(`   Cron 表达式: ${config.scheduler.cronPattern}`);
                } else {
                    console.log(`   间隔时间: ${config.scheduler.intervalMinutes} 分钟`);
                }
            }

            // 检查目标文件夹
            if (config.targetFolder) {
                try {
                    await fs.access(config.targetFolder);
                    console.log(`📁 目标文件夹状态: ✅ 存在`);

                    const metadataDir = path.join(config.targetFolder, '.trp_metadata');
                    try {
                        await fs.access(metadataDir);
                        console.log(`📊 同步元数据: ✅ 存在`);

                        // 读取最后一次同步时间
                        const syncLogFile = path.join(metadataDir, 'sync_log.json');
                        try {
                            const syncLogContent = await fs.readFile(syncLogFile, 'utf-8');
                            const syncLog = JSON.parse(syncLogContent);
                            console.log(`🕐 最后同步时间: ${syncLog.sync_time || '❌ 无记录'}`);
                            console.log(`📈 同步统计: 总计 ${syncLog.stats?.total || 0}, 成功 ${syncLog.stats?.success || 0}, 失败 ${syncLog.stats?.errors || 0}`);
                        } catch {
                            console.log(`📊 同步记录: ❌ 无记录`);
                        }
                    } catch {
                        console.log(`📊 同步元数据: ❌ 不存在（未执行过同步）`);
                    }
                } catch {
                    console.log(`📁 目标文件夹状态: ❌ 不存在`);
                }
            }

        } catch (error) {
            console.error(`❌ 检查状态失败: ${error.message}`);
            process.exit(1);
        }
    });

// 辅助函数
async function promptOverwrite() {
    const readline = await import('readline');
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    return new Promise((resolve) => {
        rl.question('配置文件已存在，是否覆盖？(y/N): ', (answer) => {
            rl.close();
            resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
        });
    });
}

async function promptInput(question, defaultValue = '') {
    const readline = await import('readline');
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    return new Promise((resolve) => {
        const prompt = defaultValue ? `${question} [${defaultValue}]: ` : `${question}: `;
        rl.question(prompt, (answer) => {
            rl.close();
            resolve(answer || defaultValue);
        });
    });
}

async function promptConfirm(question, defaultValue = false) {
    const readline = await import('readline');
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    return new Promise((resolve) => {
        const prompt = defaultValue ? `${question} (Y/n): ` : `${question} (y/N): `;
        rl.question(prompt, (answer) => {
            rl.close();
            if (!answer) {
                resolve(defaultValue);
            } else {
                const lower = answer.toLowerCase();
                if (lower === 'y' || lower === 'yes') {
                    resolve(true);
                } else if (lower === 'n' || lower === 'no') {
                    resolve(false);
                } else {
                    resolve(defaultValue);
                }
            }
        });
    });
}

// 错误处理
program.on('command:*', () => {
    console.error('❌ 未知命令');
    program.help();
});

// 解析命令行参数
program.parse();

// 如果没有提供任何命令，显示帮助
if (!process.argv.slice(2).length) {
    program.help();
}