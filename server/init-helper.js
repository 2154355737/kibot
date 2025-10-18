/**
 * 后端初始化助手模块
 * 提供首次启动初始化和重置功能
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import readline from 'readline';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 生成随机密码
function generatePassword(length = 16) {
  return crypto.randomBytes(length).toString('base64').slice(0, length);
}

// 确保目录存在
function ensureDirectoryExists(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

// 复制模板文件
function copyTemplateFile(templatePath, targetPath) {
  if (fs.existsSync(templatePath)) {
    const content = fs.readFileSync(templatePath, 'utf8');
    fs.writeFileSync(targetPath, content, 'utf8');
    return true;
  }
  return false;
}

/**
 * 检查是否需要初始化
 */
export function needsInitialization() {
  const securityConfigPath = path.join(__dirname, 'config', 'security.json');
  const llonebotConfigPath = path.join(__dirname, 'config', 'llonebot.json');
  
  return !fs.existsSync(securityConfigPath) || !fs.existsSync(llonebotConfigPath);
}

/**
 * 交互式初始化流程
 */
export async function runInteractiveInitialization(isReset = false) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const question = (query) => new Promise(resolve => rl.question(query, resolve));

  try {
    console.log('\n╔════════════════════════════════════════════════════════╗');
    console.log(`║          ${isReset ? '🔄 重置' : '🎉 首次'}初始化 QQ Bot 后端服务            ║`);
    console.log('╚════════════════════════════════════════════════════════╝\n');

    // 配置 LLOneBot 连接
    console.log('--- 步骤 1/2: 配置 LLOneBot 连接 ---\n');
    console.log('💡 LLOneBot 是 QQ 机器人框架，需要单独部署');
    console.log('   GitHub: https://github.com/LLOneBot/LLOneBot\n');
    
    const configureLLOneBot = await question('是否现在配置 LLOneBot？(Y/n): ');
    
    let llonebotConfig;
    if (configureLLOneBot.toLowerCase() !== 'n') {
      let host = '';
      while (!host) {
        host = await question('主机地址 (例如: localhost 或 192.168.1.100): ');
        if (!host) {
          console.log('❌ 主机地址不能为空，请重新输入');
        }
      }
      
      const port = await question('端口 (默认: 3000): ') || '3000';
      const token = await question('访问令牌 (access_token，可选): ') || '';
      
      const useHttps = await question('使用 HTTPS/WSS？(y/N): ');
      const httpProtocol = useHttps.toLowerCase() === 'y' ? 'https' : 'http';
      const wsProtocol = useHttps.toLowerCase() === 'y' ? 'wss' : 'ws';
      
      llonebotConfig = {
        apiUrl: `${httpProtocol}://${host}:${port}`,
        wsUrl: `${wsProtocol}://${host}:${port}`,
        accessToken: token,
        heartbeatInterval: 30000,
        reconnectDelay: 5000,
        enabled: true
      };
      
      console.log('\n✅ LLOneBot 配置完成：');
      console.log('   API URL:', llonebotConfig.apiUrl);
      console.log('   WebSocket URL:', llonebotConfig.wsUrl);
    } else {
      console.log('\n⚠️  跳过 LLOneBot 配置');
      llonebotConfig = {
        apiUrl: '',
        wsUrl: '',
        accessToken: '',
        heartbeatInterval: 30000,
        reconnectDelay: 5000,
        enabled: false
      };
    }

    // 配置认证密码
    console.log('\n--- 步骤 2/2: 配置认证密码 ---\n');
    const useRandomPasswords = await question('是否自动生成随机密码？(Y/n): ');
    
    let authCodes = {};
    if (useRandomPasswords.toLowerCase() !== 'n') {
      authCodes = {
        admin: generatePassword(20),
        operator: generatePassword(18),
        viewer: generatePassword(16),
        guest: generatePassword(16)
      };
      console.log('\n✅ 已生成随机密码：');
      console.log('   管理员密码:', authCodes.admin);
      console.log('   操作员密码:', authCodes.operator);
      console.log('   查看者密码:', authCodes.viewer);
      console.log('   访客密码:', authCodes.guest);
      console.log('\n⚠️  请务必保存这些密码！');
    } else {
      console.log('\n请设置各角色的认证密码：');
      authCodes = {
        admin: await question('  管理员密码: '),
        operator: await question('  操作员密码: '),
        viewer: await question('  查看者密码: '),
        guest: await question('  访客密码: ')
      };
    }

    // 创建配置文件
    const configDir = path.join(__dirname, 'config');
    ensureDirectoryExists(configDir);

    // 安全配置
    const securityConfig = {
      authCodes,
      session: {
        expireTime: 86400000,
        maxConcurrent: 5,
        renewThreshold: 7200000
      },
      security: {
        maxLoginAttempts: 5,
        lockoutDuration: 900000,
        ipWhitelist: [],
        requireSecureCode: true
      },
      rateLimit: {
        windowMs: 60000,
        max: 100
      }
    };

    fs.writeFileSync(
      path.join(configDir, 'security.json'),
      JSON.stringify(securityConfig, null, 2),
      'utf8'
    );

    // LLOneBot 配置
    fs.writeFileSync(
      path.join(configDir, 'llonebot.json'),
      JSON.stringify(llonebotConfig, null, 2),
      'utf8'
    );

    // 初始化数据文件
    console.log('\n--- 初始化数据文件 ---');
    const dataDir = path.join(__dirname, 'data');
    ensureDirectoryExists(dataDir);

    // 使用模板或创建空文件
    const eventRulesTemplate = path.join(dataDir, 'event-rules.json.template');
    const eventRulesTarget = path.join(dataDir, 'event-rules.json');
    if (!copyTemplateFile(eventRulesTemplate, eventRulesTarget)) {
      fs.writeFileSync(eventRulesTarget, '[]', 'utf8');
    }

    const ruleGroupsTemplate = path.join(dataDir, 'rule-groups.json.template');
    const ruleGroupsTarget = path.join(dataDir, 'rule-groups.json');
    if (!copyTemplateFile(ruleGroupsTemplate, ruleGroupsTarget)) {
      fs.writeFileSync(ruleGroupsTarget, '[]', 'utf8');
    }

    const monitorStatsTemplate = path.join(dataDir, 'monitor-stats.json.template');
    const monitorStatsTarget = path.join(dataDir, 'monitor-stats.json');
    if (!copyTemplateFile(monitorStatsTemplate, monitorStatsTarget)) {
      const emptyStats = {
        dailyMessageCount: 0,
        totalRulesTriggered: 0,
        totalApiCalls: 0,
        totalErrors: 0,
        messageHistory: [],
        userActivity: {},
        groupActivity: {},
        keywordStats: {},
        lastSaved: null,
        startTime: null
      };
      fs.writeFileSync(monitorStatsTarget, JSON.stringify(emptyStats, null, 2), 'utf8');
    }

    // 插件配置
    const pluginsDir = path.join(dataDir, 'plugins');
    ensureDirectoryExists(pluginsDir);
    const pluginConfigsTarget = path.join(pluginsDir, 'plugin-configs.json');
    if (!fs.existsSync(pluginConfigsTarget)) {
      fs.writeFileSync(pluginConfigsTarget, '{}', 'utf8');
    }

    // 日志目录
    const logsDir = path.join(dataDir, 'logs');
    ensureDirectoryExists(logsDir);
    const logConfig = {
      maxFileSize: 10485760,
      maxFiles: 30,
      logLevel: "info",
      enableConsole: true,
      enableFile: true
    };
    fs.writeFileSync(
      path.join(logsDir, 'log-config.json'),
      JSON.stringify(logConfig, null, 2),
      'utf8'
    );

    // 监控目录
    const monitoringDir = path.join(dataDir, 'monitoring');
    ensureDirectoryExists(monitoringDir);
    ensureDirectoryExists(path.join(monitoringDir, 'archives'));
    const currentStats = {
      cpu: [],
      memory: [],
      network: [],
      startTime: Date.now()
    };
    fs.writeFileSync(
      path.join(monitoringDir, 'current-stats.json'),
      JSON.stringify(currentStats, null, 2),
      'utf8'
    );

    // 任务数据
    fs.writeFileSync(path.join(dataDir, 'tasks.json'), '[]', 'utf8');
    fs.writeFileSync(path.join(dataDir, 'task-history.json'), '[]', 'utf8');

    console.log('✓ 数据文件初始化完成');

    // 完成提示
    console.log('\n╔════════════════════════════════════════════════════════╗');
    console.log('║              ✅ 初始化完成！                           ║');
    console.log('╚════════════════════════════════════════════════════════╝\n');

    if (!llonebotConfig.enabled) {
      console.log('⚠️  提醒：LLOneBot 未配置');
      console.log('   后端将正常启动，但无法连接到 QQ Bot');
      console.log('   稍后可编辑: server/config/llonebot.json\n');
    }

    console.log('📝 认证密码 (请保存):');
    if (useRandomPasswords.toLowerCase() !== 'n') {
      console.log('   管理员:', authCodes.admin);
      console.log('   操作员:', authCodes.operator);
      console.log('   查看者:', authCodes.viewer);
      console.log('   访客:', authCodes.guest);
    }
    
    console.log('\n💡 提示：配置文件位于 server/config/');
    console.log('   - security.json: 认证配置');
    console.log('   - llonebot.json: LLOneBot 连接\n');

    rl.close();
    return true;

  } catch (error) {
    console.error('\n❌ 初始化失败:', error);
    rl.close();
    return false;
  }
}

/**
 * 静默初始化（使用默认值）
 */
export function runSilentInitialization() {
  try {
    console.log('📋 使用默认配置进行初始化...');

    const configDir = path.join(__dirname, 'config');
    ensureDirectoryExists(configDir);

    // 生成默认配置
    const authCodes = {
      admin: generatePassword(20),
      operator: generatePassword(18),
      viewer: generatePassword(16),
      guest: generatePassword(16)
    };

    const securityConfig = {
      authCodes,
      session: {
        expireTime: 86400000,
        maxConcurrent: 5,
        renewThreshold: 7200000
      },
      security: {
        maxLoginAttempts: 5,
        lockoutDuration: 900000,
        ipWhitelist: [],
        requireSecureCode: true
      },
      rateLimit: {
        windowMs: 60000,
        max: 100
      }
    };

    const llonebotConfig = {
      apiUrl: '',
      wsUrl: '',
      accessToken: '',
      heartbeatInterval: 30000,
      reconnectDelay: 5000,
      enabled: false
    };

    fs.writeFileSync(
      path.join(configDir, 'security.json'),
      JSON.stringify(securityConfig, null, 2),
      'utf8'
    );

    fs.writeFileSync(
      path.join(configDir, 'llonebot.json'),
      JSON.stringify(llonebotConfig, null, 2),
      'utf8'
    );

    console.log('✅ 默认配置已创建');
    console.log('⚠️  管理员密码:', authCodes.admin);
    console.log('💡 运行 npm run init 可重新配置\n');

    return true;
  } catch (error) {
    console.error('❌ 静默初始化失败:', error);
    return false;
  }
}


