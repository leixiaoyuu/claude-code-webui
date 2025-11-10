#!/usr/bin/env node

/**
 * 集成启动脚本
 * 启动 Claude Code WebUI 并自动配置 TRP Sync
 */

import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';

// 解析启动命令参数
function parseDevArgs(args) {
    const result = {
        maxThinkingTokens: null,
        defaultCwd: null,
        autobaCwdPrefix: null,
        otherArgs: []
    };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];

        if (arg === '--max-thinking-tokens' && i + 1 < args.length) {
            result.maxThinkingTokens = args[i + 1];
            i++;
        } else if (arg === '--default-cwd' && i + 1 < args.length) {
            result.defaultCwd = args[i + 1];
            i++;
        } else if (arg === '--autoba-cwd-prefix' && i + 1 < args.length) {
            result.autobaCwdPrefix = args[i + 1];
            i++;
        } else {
            result.otherArgs.push(arg);
        }
    }

    return result;
}

// 更新 TRP Sync 配置
async function updateTrpConfig(autobaCwdPrefix) {
    try {
        // 检查配置文件是否存在
        const configPath = './trp-sync/trp-sync-config.json';
        try {
            await fs.access(configPath);
        } catch {
            console.log('📝 TRP Sync 配置文件不存在，创建默认配置...');
            const { spawn } = await import('child_process');
            await new Promise((resolve, reject) => {
                const child = spawn('node', ['./trp-sync/trp-sync-cli.js', 'init'], {
                    stdio: 'inherit'
                });
                child.on('close', resolve);
                child.on('error', reject);
            });
        }

        // 读取配置文件
        const configContent = await fs.readFile(configPath, 'utf-8');
        const config = JSON.parse(configContent);

        // 计算新的 targetFolder
        const newTargetFolder = path.join(autobaCwdPrefix, 'knowledge-base', 'trp-docs');
        const oldTargetFolder = config.targetFolder;

        // 检查是否需要更新
        if (oldTargetFolder !== newTargetFolder) {
            // 更新配置
            config.targetFolder = newTargetFolder;

            // 确保目录存在
            await fs.mkdir(newTargetFolder, { recursive: true });

            // 写入更新后的配置
            await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');

            console.log('✅ TRP Sync 配置已自动更新');
            console.log(`📁 目标文件夹: ${oldTargetFolder || '未设置'} → ${newTargetFolder}`);
        } else {
            console.log('✅ TRP Sync 配置已是最新，无需更新');
        }

        return newTargetFolder;

    } catch (error) {
        console.warn('⚠️ TRP Sync 配置更新失败:', error.message);
        return null;
    }
}

// 启动定时同步任务
function startTrpScheduler() {
    console.log('⏰ 启动 TRP 定时同步任务...');

    const schedulerChild = spawn('npm', ['run', 'trp-sync:scheduler'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: true
    });

    let schedulerOutput = '';

    schedulerChild.stdout.on('data', (data) => {
        const output = data.toString();
        schedulerOutput += output;
        // 只显示重要信息，避免刷屏
        if (output.includes('启动') || output.includes('同步') || output.includes('完成') || output.includes('错误')) {
            console.log(`[TRP Sync] ${output.trim()}`);
        }
    });

    schedulerChild.stderr.on('data', (data) => {
        console.error(`[TRP Sync Error] ${data.toString().trim()}`);
    });

    schedulerChild.on('close', (code) => {
        console.log(`TRP 定时同步任务已退出，代码: ${code}`);
    });

    schedulerChild.on('error', (error) => {
        console.error('❌ 启动 TRP 定时同步失败:', error.message);
    });

    return schedulerChild;
}

// 启动开发服务器
function startDevServer(args, schedulerChild) {
    console.log('🚀 启动 Claude Code WebUI 开发服务器...');

    const child = spawn('npm', ['run', 'dev', '--debug', '--max-thinking-tokens', args.maxThinkingTokens || '2048', '--default-cwd', args.defaultCwd || '/Users/xiaoyu/Desktop/next-aotuba/data/workspaces/lxy3', '--autoba-cwd-prefix', args.autobaCwdPrefix || '/Users/xiaoyu/Desktop/next-aotuba/data', ...args.otherArgs], {
        stdio: 'inherit',
        shell: true
    });

    // 处理进程信号 - 同时停止两个进程
    const cleanup = () => {
        console.log('\n🛑 正在停止所有服务...');

        if (schedulerChild) {
            console.log('🛑 停止 TRP 定时同步...');
            schedulerChild.kill('SIGTERM');
            // 如果5秒后还没停止，强制杀死
            setTimeout(() => {
                if (schedulerChild && !schedulerChild.killed) {
                    schedulerChild.kill('SIGKILL');
                }
            }, 5000);
        }

        console.log('🛑 停止开发服务器...');
        child.kill('SIGINT');
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);

    child.on('close', (code) => {
        console.log(`开发服务器已退出，代码: ${code}`);
        // 延迟一点再退出，让 TRP 同步有时间显示退出信息
        setTimeout(() => {
            process.exit(code);
        }, 1000);
    });

    child.on('error', (error) => {
        console.error('❌ 启动开发服务器失败:', error.message);
        if (schedulerChild) {
            schedulerChild.kill();
        }
        process.exit(1);
    });

    return child;
}

// 主函数
async function main() {
    console.log('🔧 Claude Code WebUI + TRP Sync 集成启动');

    // 解析命令行参数
    const args = parseDevArgs(process.argv.slice(2));

    // 显示配置信息
    console.log('📋 启动配置:');
    console.log(`   🧠 最大思考令牌数: ${args.maxThinkingTokens || '2048'}`);
    console.log(`   📁 默认工作目录: ${args.defaultCwd || '/Users/xiaoyu/Desktop/next-aotuba/data/workspaces/lxy3'}`);
    console.log(`   📂 AutoBA 前缀: ${args.autobaCwdPrefix || '/Users/xiaoyu/Desktop/next-aotuba/data'}`);

    // 自动更新 TRP Sync 配置
    if (args.autobaCwdPrefix) {
        console.log('\n🔧 自动配置 TRP Sync...');
        const targetFolder = await updateTrpConfig(args.autobaCwdPrefix);

        if (targetFolder) {
            console.log('✅ TRP Sync 已配置，可以随时启动同步:');
            console.log('   npm run trp-sync:sync    # 执行一次同步');
            console.log('   npm run trp-sync:scheduler  # 启动定时同步');
        }
    } else {
        console.log('\n⚠️ 未指定 --autoba-cwd-prefix，跳过 TRP Sync 配置');
        console.log('💡 如需自动配置，请使用: --autoba-cwd-prefix <路径>');
    }

    console.log('\n' + '='.repeat(50));

    // 启动定时同步任务
    const schedulerChild = startTrpScheduler();

    // 等待一下让定时任务先启动
    await new Promise(resolve => setTimeout(resolve, 2000));

    // 启动开发服务器
    startDevServer(args, schedulerChild);
}

// 运行主函数
if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch(error => {
        console.error('💥 启动失败:', error.message);
        process.exit(1);
    });
}

export { parseDevArgs, updateTrpConfig };