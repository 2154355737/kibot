/**
 * KiBot 插件开发SDK
 * 提供标准的插件开发接口和工具
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 插件基础接口
export class PluginBase {
  constructor(pluginInfo, context) {
    this.info = pluginInfo;
    this.context = context;
    this.isEnabled = false;
    this.logger = context.createLogger(pluginInfo.id);
    this.storage = context.createStorage(pluginInfo.id);
    this.eventHandlers = new Map();
    this.commandHandlers = new Map();
    
    // 扩展跟踪信息
    this.registeredCommands = new Map(); // 注册的指令详情
    this.usedRules = new Set(); // 使用的规则ID
    this.scheduledTasks = new Map(); // 定时任务
    this.errors = []; // 错误记录
    this.lastActivity = Date.now(); // 最后活动时间
    this.statistics = {
      commandExecutions: 0,
      eventHandled: 0,
      tasksExecuted: 0,
      errorsOccurred: 0
    };
  }

  /**
   * 插件启动时调用
   */
  async onLoad() {
    this.logger.info(`插件 ${this.info.name} 正在加载...`);
    
    // 加载统计数据
    this.loadStatistics();
    
    // 启动统计数据保存器
    this.startStatisticsSaver();
  }

  /**
   * 插件启用时调用
   */
  async onEnable() {
    this.isEnabled = true;
    this.logger.info(`插件 ${this.info.name} 已启用`);
  }

  /**
   * 插件禁用时调用
   */
  async onDisable() {
    this.isEnabled = false;
    this.logger.info(`插件 ${this.info.name} 已禁用`);
  }

  /**
   * 插件卸载时调用
   */
  async onUnload() {
    // 停止统计数据保存器
    this.stopStatisticsSaver();
    
    // 清理资源
    this.eventHandlers.clear();
    this.commandHandlers.clear();
    this.logger.info(`插件 ${this.info.name} 已卸载`);
  }

  /**
   * 注册事件监听器
   * @param {string} eventType - 事件类型
   * @param {Function} handler - 处理函数
   */
  onEvent(eventType, handler) {
    if (!this.eventHandlers.has(eventType)) {
      this.eventHandlers.set(eventType, []);
    }
    
    // 包装事件处理器以记录统计信息和错误
    const wrappedHandler = async (...args) => {
      this.lastActivity = Date.now();
      this.statistics.eventHandled++;
      
      try {
        const result = await handler(...args);
        return result;
      } catch (error) {
        this.recordError('event', eventType, error);
        throw error;
      }
    };
    
    this.eventHandlers.get(eventType).push(wrappedHandler);
    this.context.eventBus.on(`plugin.${this.info.id}.${eventType}`, wrappedHandler);
    this.logger.debug(`注册事件处理器: ${eventType}`);
  }

  /**
   * 注册指令处理器
   * @param {string} command - 指令名称
   * @param {Object} options - 指令选项
   * @param {Function} handler - 处理函数
   */
  onCommand(command, options = {}, handler) {
    if (typeof options === 'function') {
      handler = options;
      options = {};
    }
    
    const commandInfo = {
      plugin: this.info.id,
      command,
      type: 'custom', // 标记为自定义指令
      registeredAt: Date.now(),
      executionCount: 0,
      lastExecuted: null,
      lastError: null,
      ...options,
      handler
    };
    
    // 包装处理器以记录统计信息
    const wrappedHandler = async (...args) => {
      this.lastActivity = Date.now();
      this.statistics.commandExecutions++;
      commandInfo.executionCount++;
      commandInfo.lastExecuted = Date.now();
      
      try {
        const result = await handler(...args);
        return result;
      } catch (error) {
        commandInfo.lastError = {
          message: error.message,
          stack: error.stack,
          timestamp: Date.now()
        };
        this.recordError('command', command, error);
        throw error;
      }
    };
    
    commandInfo.handler = wrappedHandler;
    this.commandHandlers.set(command, commandInfo);
    this.registeredCommands.set(command, { ...commandInfo, handler: undefined }); // 不包含实际处理器
    
    this.context.commandRegistry.register(commandInfo);
    this.logger.debug(`注册指令: ${command}`, options);
  }

  /**
   * 发送消息
   * @param {string} chatId - 聊天ID
   * @param {string} message - 消息内容
   * @param {string} type - 消息类型 (private/group)
   */
  async sendMessage(chatId, message, type = 'private') {
    return await this.context.messageService.send(chatId, message, type);
  }

  /**
   * 调用API
   * @param {string} action - API动作
   * @param {Object} params - 参数
   */
  async callApi(action, params = {}) {
    return await this.context.apiService.call(action, params);
  }

  /**
   * 发送通知到前端
   * @param {string} type - 通知类型
   * @param {Object} data - 通知数据
   */
  notify(type, data) {
    this.context.notificationService.send({
      type: `plugin.${this.info.id}.${type}`,
      data,
      timestamp: Date.now()
    });
  }

  /**
   * 创建定时任务
   * @param {string} name - 任务名称
   * @param {string} cron - Cron表达式
   * @param {Function} handler - 处理函数
   */
  schedule(name, cron, handler) {
    const taskInfo = {
      name,
      cron,
      registeredAt: Date.now(),
      executionCount: 0,
      lastExecuted: null,
      lastError: null,
      isActive: true
    };
    
    // 包装处理器以记录统计信息
    const wrappedHandler = async (...args) => {
      this.lastActivity = Date.now();
      this.statistics.tasksExecuted++;
      taskInfo.executionCount++;
      taskInfo.lastExecuted = Date.now();
      
      try {
        const result = await handler(...args);
        return result;
      } catch (error) {
        taskInfo.lastError = {
          message: error.message,
          stack: error.stack,
          timestamp: Date.now()
        };
        this.recordError('task', name, error);
        throw error;
      }
    };
    
    const task = this.context.scheduler.create(`${this.info.id}.${name}`, cron, wrappedHandler);
    this.scheduledTasks.set(name, taskInfo);
    
    this.logger.debug(`注册定时任务: ${name} (${cron})`);
    return task;
  }

  /**
   * 记录错误信息
   * @param {string} type - 错误类型 (command/task/event)
   * @param {string} source - 错误源
   * @param {Error} error - 错误对象
   */
  recordError(type, source, error) {
    const errorInfo = {
      type,
      source,
      message: error.message,
      stack: error.stack,
      timestamp: Date.now(),
      pluginId: this.info.id
    };
    
    this.errors.push(errorInfo);
    this.statistics.errorsOccurred++;
    
    // 只保留最近100个错误
    if (this.errors.length > 100) {
      this.errors.shift();
    }
    
    this.logger.error(`${type} 错误`, `${source}: ${error.message}`);
  }

  /**
   * 获取插件详细信息
   */
  getDetailedInfo() {
    const commands = Array.from(this.registeredCommands.values());
    const tasks = Array.from(this.scheduledTasks.values());
    const recentErrors = this.errors.slice(-10); // 最近10个错误
    
    return {
      basic: this.info,
      status: {
        isEnabled: this.isEnabled,
        lastActivity: this.lastActivity
      },
      commands: commands.map(cmd => ({
        command: cmd.command,
        type: cmd.type,
        description: cmd.description,
        usage: cmd.usage,
        category: cmd.category || 'general',
        adminOnly: cmd.adminOnly || false,
        executionCount: cmd.executionCount,
        lastExecuted: cmd.lastExecuted,
        lastError: cmd.lastError,
        registeredAt: cmd.registeredAt
      })),
      tasks: tasks.map(task => ({
        name: task.name,
        cron: task.cron,
        executionCount: task.executionCount,
        lastExecuted: task.lastExecuted,
        lastError: task.lastError,
        isActive: task.isActive,
        registeredAt: task.registeredAt
      })),
      rules: Array.from(this.usedRules),
      errors: recentErrors,
      statistics: this.statistics
    };
  }

  /**
   * 保存统计数据到文件
   */
  saveStatistics() {
    try {
      const statsData = {
        statistics: this.statistics,
        lastActivity: this.lastActivity,
        commands: Object.fromEntries(
          Array.from(this.registeredCommands.entries()).map(([key, cmd]) => [
            key,
            {
              executionCount: cmd.executionCount,
              lastExecuted: cmd.lastExecuted,
              lastError: cmd.lastError
            }
          ])
        ),
        tasks: Object.fromEntries(
          Array.from(this.scheduledTasks.entries()).map(([key, task]) => [
            key,
            {
              executionCount: task.executionCount,
              lastExecuted: task.lastExecuted,
              lastError: task.lastError
            }
          ])
        ),
        errors: this.errors.slice(-50), // 保留最近50个错误
        timestamp: Date.now()
      };
      
      this.storage.set('plugin_statistics', statsData);
    } catch (error) {
      console.error(`保存插件 ${this.info.id} 统计数据失败:`, error);
    }
  }

  /**
   * 加载统计数据
   */
  loadStatistics() {
    try {
      const statsData = this.storage.get('plugin_statistics', null);
      if (statsData) {
        // 恢复统计信息
        this.statistics = {
          commandExecutions: 0,
          eventHandled: 0,
          tasksExecuted: 0,
          errorsOccurred: 0,
          ...statsData.statistics
        };
        
        this.lastActivity = statsData.lastActivity || Date.now();
        this.errors = statsData.errors || [];
        
        // 恢复指令统计
        if (statsData.commands) {
          for (const [cmdKey, cmdStats] of Object.entries(statsData.commands)) {
            if (this.registeredCommands.has(cmdKey)) {
              const cmd = this.registeredCommands.get(cmdKey);
              cmd.executionCount = cmdStats.executionCount || 0;
              cmd.lastExecuted = cmdStats.lastExecuted;
              cmd.lastError = cmdStats.lastError;
            }
          }
        }
        
        // 恢复任务统计
        if (statsData.tasks) {
          for (const [taskKey, taskStats] of Object.entries(statsData.tasks)) {
            if (this.scheduledTasks.has(taskKey)) {
              const task = this.scheduledTasks.get(taskKey);
              task.executionCount = taskStats.executionCount || 0;
              task.lastExecuted = taskStats.lastExecuted;
              task.lastError = taskStats.lastError;
            }
          }
        }
        
        this.logger.debug('统计数据加载完成');
      }
    } catch (error) {
      console.error(`加载插件 ${this.info.id} 统计数据失败:`, error);
    }
  }

  /**
   * 定期保存统计数据
   */
  startStatisticsSaver() {
    // 每5分钟保存一次统计数据
    this.statsInterval = setInterval(() => {
      this.saveStatistics();
    }, 5 * 60 * 1000);
    
    // 在插件停止时保存
    process.on('SIGINT', () => {
      this.saveStatistics();
    });
    process.on('SIGTERM', () => {
      this.saveStatistics();
    });
  }

  /**
   * 停止统计数据保存器
   */
  stopStatisticsSaver() {
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
      this.statsInterval = null;
    }
    // 最后保存一次
    this.saveStatistics();
  }

  /**
   * 获取配置
   * @param {string} key - 配置键
   * @param {*} defaultValue - 默认值
   */
  getConfig(key, defaultValue) {
    return this.storage.get(`config.${key}`, defaultValue);
  }

  /**
   * 设置配置
   * @param {string} key - 配置键
   * @param {*} value - 配置值
   */
  setConfig(key, value) {
    return this.storage.set(`config.${key}`, value);
  }
}

// 插件工具类
export class PluginUtils {
  /**
   * 验证插件信息
   * @param {Object} pluginInfo - 插件信息
   */
  static validatePluginInfo(pluginInfo) {
    const required = ['id', 'name', 'version', 'author', 'main'];
    const missing = required.filter(field => !pluginInfo[field]);
    
    if (missing.length > 0) {
      throw new Error(`插件信息缺少必需字段: ${missing.join(', ')}`);
    }

    // 验证版本格式
    if (!/^\d+\.\d+\.\d+$/.test(pluginInfo.version)) {
      throw new Error('插件版本格式应为 x.y.z');
    }

    // 验证ID格式
    if (!/^[a-z0-9_-]+$/.test(pluginInfo.id)) {
      throw new Error('插件ID只能包含小写字母、数字、下划线和连字符');
    }

    return true;
  }

  /**
   * 解析插件依赖
   * @param {Array} dependencies - 依赖列表
   */
  static parseDependencies(dependencies = []) {
    return dependencies.map(dep => {
      if (typeof dep === 'string') {
        return { id: dep, version: '*' };
      }
      return dep;
    });
  }

  /**
   * 比较版本号
   * @param {string} version1 - 版本1
   * @param {string} version2 - 版本2
   */
  static compareVersions(version1, version2) {
    const v1Parts = version1.split('.').map(Number);
    const v2Parts = version2.split('.').map(Number);
    
    for (let i = 0; i < 3; i++) {
      if (v1Parts[i] > v2Parts[i]) return 1;
      if (v1Parts[i] < v2Parts[i]) return -1;
    }
    return 0;
  }
}

// 插件上下文 - 提供给插件的运行环境
export class PluginContext {
  constructor(mainServer) {
    this.mainServer = mainServer;
    this.eventBus = mainServer.eventBus;
    this.commandRegistry = mainServer.commandRegistry;
    this.messageService = mainServer.messageService;
    this.apiService = mainServer.apiService;
    this.notificationService = mainServer.notificationService;
    this.scheduler = mainServer.scheduler;
  }

  createLogger(pluginId) {
    return {
      info: (msg) => console.log(`[Plugin:${pluginId}] ℹ️  ${msg}`),
      warn: (msg) => console.log(`[Plugin:${pluginId}] ⚠️  ${msg}`),
      error: (msg) => console.log(`[Plugin:${pluginId}] ❌ ${msg}`),
      debug: (msg) => console.log(`[Plugin:${pluginId}] 🐛 ${msg}`)
    };
  }

  createStorage(pluginId) {
    const storageDir = path.join(__dirname, '../../data/plugins', pluginId);
    
    // 确保存储目录存在
    if (!fs.existsSync(storageDir)) {
      fs.mkdirSync(storageDir, { recursive: true });
    }

    return {
      get: (key, defaultValue) => {
        try {
          const filePath = path.join(storageDir, 'storage.json');
          if (fs.existsSync(filePath)) {
            const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            return data[key] !== undefined ? data[key] : defaultValue;
          }
          return defaultValue;
        } catch (error) {
          console.error(`插件 ${pluginId} 读取存储失败:`, error);
          return defaultValue;
        }
      },

      set: (key, value) => {
        try {
          const filePath = path.join(storageDir, 'storage.json');
          let data = {};
          if (fs.existsSync(filePath)) {
            data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
          }
          data[key] = value;
          fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
          return true;
        } catch (error) {
          console.error(`插件 ${pluginId} 写入存储失败:`, error);
          return false;
        }
      },

      delete: (key) => {
        try {
          const filePath = path.join(storageDir, 'storage.json');
          if (fs.existsSync(filePath)) {
            const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            delete data[key];
            fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
          }
          return true;
        } catch (error) {
          console.error(`插件 ${pluginId} 删除存储失败:`, error);
          return false;
        }
      }
    };
  }
}

// 导出类型定义
export const PluginTypes = {
  // 插件状态
  Status: {
    UNLOADED: 'unloaded',
    LOADED: 'loaded',
    ENABLED: 'enabled',
    DISABLED: 'disabled',
    ERROR: 'error'
  },

  // 插件类型
  Category: {
    UTILITY: 'utility',
    ENTERTAINMENT: 'entertainment',
    ADMIN: 'admin',
    INTEGRATION: 'integration',
    OTHER: 'other'
  },

  // 事件类型
  Events: {
    MESSAGE: 'message',
    GROUP_MESSAGE: 'group_message',
    PRIVATE_MESSAGE: 'private_message',
    GROUP_JOIN: 'group_join',
    GROUP_LEAVE: 'group_leave',
    FRIEND_ADD: 'friend_add',
    FRIEND_DELETE: 'friend_delete'
  }
};