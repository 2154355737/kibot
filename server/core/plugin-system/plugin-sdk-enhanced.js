/**
 * KiBot 增强插件SDK v3.0
 * 提供更优雅的API和开发体验
 * 
 * 核心设计原则：
 * 1. 性能统计和错误捕获在SDK层面强制执行，不可被插件覆盖
 * 2. 所有命令、事件、任务的执行都自动追踪
 * 3. 使用Symbol确保核心方法不被覆盖
 * 
 * @module plugin-sdk-enhanced
 * @version 3.0.1
 * @author KiBot Team
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { EventEmitter } from 'events';
import { CQParser, CQBuilder, MessageSegment } from '../../utils/cq-parser.js';
import { getLocalTime } from '../../utils/timezone-helper.js';
import { PluginStatistics } from './plugin-statistics.js';

// 使用Symbol创建私有方法标识，防止插件覆盖核心功能
const REGISTER_COMMAND_INTERNAL = Symbol('registerCommandInternal');
const REGISTER_TASK_INTERNAL = Symbol('registerTaskInternal');
const RECORD_ERROR_INTERNAL = Symbol('recordErrorInternal');
const RECORD_PERFORMANCE_INTERNAL = Symbol('recordPerformanceInternal');

// ES Modules 环境下需要手动创建 __dirname 和 __filename
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * 增强的数据存储层
 * 提供类型安全和查询功能
 */
export class EnhancedStorage {
  constructor(pluginId, basePath) {
    this.pluginId = pluginId;
    this.storageDir = path.join(basePath, pluginId);
    this.dataFile = path.join(this.storageDir, 'storage.json');
    this.models = new Map();
    
    // 确保存储目录存在
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }
    
    // 加载数据
    this.data = this.loadData();
  }

  loadData() {
    try {
      if (fs.existsSync(this.dataFile)) {
        const content = fs.readFileSync(this.dataFile, 'utf8');
        return JSON.parse(content);
      }
    } catch (error) {
      console.error(`加载存储数据失败: ${error.message}`);
    }
    return {};
  }

  saveData() {
    try {
      fs.writeFileSync(this.dataFile, JSON.stringify(this.data, null, 2));
      return true;
    } catch (error) {
      console.error(`保存存储数据失败: ${error.message}`);
      return false;
    }
  }

  // 基础存储API
  get(key, defaultValue = null) {
    return this.data[key] !== undefined ? this.data[key] : defaultValue;
  }

  set(key, value) {
    this.data[key] = value;
    return this.saveData();
  }

  delete(key) {
    delete this.data[key];
    return this.saveData();
  }

  has(key) {
    return key in this.data;
  }

  keys() {
    return Object.keys(this.data);
  }

  clear() {
    this.data = {};
    return this.saveData();
  }

  // 批量操作
  setMany(entries) {
    for (const [key, value] of Object.entries(entries)) {
      this.data[key] = value;
    }
    return this.saveData();
  }

  getMany(keys) {
    const result = {};
    for (const key of keys) {
      if (key in this.data) {
        result[key] = this.data[key];
      }
    }
    return result;
  }

  // 模式匹配
  keysMatching(pattern) {
    const regex = new RegExp(pattern.replace(/\*/g, '.*'));
    return this.keys().filter(key => regex.test(key));
  }

  // 计数器
  increment(key, delta = 1) {
    const current = this.get(key, 0);
    const newValue = current + delta;
    this.set(key, newValue);
    return newValue;
  }

  decrement(key, delta = 1) {
    return this.increment(key, -delta);
  }

  // 列表操作
  listPush(key, ...items) {
    const list = this.get(key, []);
    list.push(...items);
    return this.set(key, list);
  }

  listPop(key) {
    const list = this.get(key, []);
    const item = list.pop();
    this.set(key, list);
    return item;
  }

  listGet(key, index) {
    const list = this.get(key, []);
    return list[index];
  }

  listLength(key) {
    const list = this.get(key, []);
    return list.length;
  }

  // 集合操作
  setAdd(key, ...items) {
    const set = new Set(this.get(key, []));
    items.forEach(item => set.add(item));
    return this.set(key, Array.from(set));
  }

  setRemove(key, ...items) {
    const set = new Set(this.get(key, []));
    items.forEach(item => set.delete(item));
    return this.set(key, Array.from(set));
  }

  setHas(key, item) {
    const set = new Set(this.get(key, []));
    return set.has(item);
  }

  setMembers(key) {
    return this.get(key, []);
  }

  // 类型化存储
  typed(namespace) {
    return {
      get: (key, defaultValue) => this.get(`${namespace}:${key}`, defaultValue),
      set: (key, value) => this.set(`${namespace}:${key}`, value),
      delete: (key) => this.delete(`${namespace}:${key}`),
      has: (key) => this.has(`${namespace}:${key}`),
      keys: () => this.keysMatching(`${namespace}:.*`).map(k => k.replace(`${namespace}:`, '')),
      clear: () => {
        const keys = this.keysMatching(`${namespace}:.*`);
        keys.forEach(key => this.delete(key));
      }
    };
  }

  // 简单的ORM风格模型
  model(name, schema = {}) {
    if (!this.models.has(name)) {
      this.models.set(name, new StorageModel(this, name, schema));
    }
    return this.models.get(name);
  }
}

/**
 * 简单的数据模型
 */
class StorageModel {
  constructor(storage, name, schema) {
    this.storage = storage;
    this.name = name;
    this.schema = schema;
    this.keyPrefix = `model:${name}`;
  }

  // 生成ID
  generateId() {
    const countKey = `${this.keyPrefix}:_id_counter`;
    return this.storage.increment(countKey);
  }

  // 验证数据
  validate(data) {
    for (const [field, rules] of Object.entries(this.schema)) {
      const value = data[field];
      
      // 必填检查
      if (rules.required && (value === undefined || value === null)) {
        throw new Error(`字段 ${field} 是必填的`);
      }
      
      // 类型检查
      if (value !== undefined && rules.type) {
        const typeName = rules.type.name.toLowerCase();
        const actualType = typeof value;
        if (typeName === 'number' && actualType !== 'number') {
          throw new Error(`字段 ${field} 应该是数字类型`);
        }
        if (typeName === 'string' && actualType !== 'string') {
          throw new Error(`字段 ${field} 应该是字符串类型`);
        }
        if (typeName === 'boolean' && actualType !== 'boolean') {
          throw new Error(`字段 ${field} 应该是布尔类型`);
        }
      }
      
      // 自定义验证
      if (rules.validate && typeof rules.validate === 'function') {
        if (!rules.validate(value)) {
          throw new Error(`字段 ${field} 验证失败`);
        }
      }
    }
    return true;
  }

  // 应用默认值
  applyDefaults(data) {
    const result = { ...data };
    for (const [field, rules] of Object.entries(this.schema)) {
      if (result[field] === undefined && rules.default !== undefined) {
        result[field] = typeof rules.default === 'function' 
          ? rules.default() 
          : rules.default;
      }
    }
    return result;
  }

  // 创建记录
  create(data) {
    const id = data.id || this.generateId();
    const fullData = this.applyDefaults({ ...data, id });
    
    this.validate(fullData);
    
    const key = `${this.keyPrefix}:${id}`;
    this.storage.set(key, fullData);
    
    // 添加到索引
    this.storage.listPush(`${this.keyPrefix}:_all_ids`, id);
    
    return fullData;
  }

  // 查找记录
  find(id) {
    const key = `${this.keyPrefix}:${id}`;
    return this.storage.get(key);
  }

  // 查找所有记录
  findAll() {
    const ids = this.storage.get(`${this.keyPrefix}:_all_ids`, []);
    return ids.map(id => this.find(id)).filter(item => item !== null);
  }

  // 简单查询
  where(field, operator, value) {
    const all = this.findAll();
    return all.filter(item => {
      const itemValue = item[field];
      switch (operator) {
        case '=':
        case '==':
          return itemValue === value;
        case '!=':
          return itemValue !== value;
        case '>':
          return itemValue > value;
        case '>=':
          return itemValue >= value;
        case '<':
          return itemValue < value;
        case '<=':
          return itemValue <= value;
        case 'in':
          return Array.isArray(value) && value.includes(itemValue);
        case 'contains':
          return String(itemValue).includes(String(value));
        default:
          return false;
      }
    });
  }

  // 更新记录
  update(id, updates) {
    const existing = this.find(id);
    if (!existing) {
      throw new Error(`记录不存在: ${id}`);
    }
    
    const updated = { ...existing, ...updates, id };
    this.validate(updated);
    
    const key = `${this.keyPrefix}:${id}`;
    this.storage.set(key, updated);
    
    return updated;
  }

  // 删除记录
  delete(id) {
    const key = `${this.keyPrefix}:${id}`;
    const result = this.storage.delete(key);
    
    // 从索引中移除
    const ids = this.storage.get(`${this.keyPrefix}:_all_ids`, []);
    const filteredIds = ids.filter(i => i !== id);
    this.storage.set(`${this.keyPrefix}:_all_ids`, filteredIds);
    
    return result;
  }

  // 计数
  count() {
    const ids = this.storage.get(`${this.keyPrefix}:_all_ids`, []);
    return ids.length;
  }
}

/**
 * 增强的事件处理器
 */
export class EnhancedEventHandler {
  constructor(pluginBase, eventType) {
    this.pluginBase = pluginBase;
    this.eventType = eventType;
    this.filters = [];
    this.middlewares = [];
    this.handler = null;
    this.priority = 0;
  }

  // 添加过滤器
  filter(predicate) {
    this.filters.push(predicate);
    return this;
  }

  // 添加中间件
  use(middleware) {
    this.middlewares.push(middleware);
    return this;
  }

  // 设置优先级
  setPriority(priority) {
    this.priority = priority;
    return this;
  }

  // 设置处理函数
  handle(handler) {
    this.handler = handler;
    this.pluginBase._registerEnhancedEvent(this);
    return this;
  }

  /**
   * 【强制包装】执行事件处理
   * SDK层面自动追踪所有事件处理的性能和错误
   */
  async execute(event) {
    // 检查过滤器
    for (const filter of this.filters) {
      if (!filter(event)) {
        return; // 过滤器不通过，跳过处理
      }
    }

    // ========== SDK强制执行：事件统计数据收集 ==========
    this.pluginBase.stats.incrementEventHandled(this.eventType);
    
    // 并发监控
    this.pluginBase.stats.incrementConcurrentOperations();
    
    const startTime = Date.now();
    let success = true;

    try {
      // 执行中间件链
      let index = 0;
      const next = async () => {
        if (index < this.middlewares.length) {
          const middleware = this.middlewares[index++];
          await middleware(event, next);
        } else if (this.handler) {
          await this.handler(event);
        }
      };

      await next();
    } catch (error) {
      success = false;
      
      // ========== SDK强制执行：错误记录 ==========
      this.pluginBase[RECORD_ERROR_INTERNAL]('event', this.eventType, error);
      
      // 继续抛出错误
      throw error;
    } finally {
      // 并发监控
      this.pluginBase.stats.decrementConcurrentOperations();
      
      // ========== SDK强制执行：性能记录 ==========
      const duration = Date.now() - startTime;
      this.pluginBase[RECORD_PERFORMANCE_INTERNAL]('event', this.eventType, duration, success);
    }
  }
}

/**
 * 并发控制工具
 */
export class ConcurrencyHelper {
  // 并发执行
  static async concurrent(items, handler, options = {}) {
    const { concurrency = 5 } = options;
    const results = [];
    const executing = [];

    for (const item of items) {
      const promise = Promise.resolve().then(() => handler(item));
      results.push(promise);

      if (concurrency <= items.length) {
        const executingPromise = promise.then(() => {
          executing.splice(executing.indexOf(executingPromise), 1);
        });
        executing.push(executingPromise);

        if (executing.length >= concurrency) {
          await Promise.race(executing);
        }
      }
    }

    return Promise.all(results);
  }

  // 批量处理
  static async batch(items, handler, options = {}) {
    const { batchSize = 100 } = options;
    const results = [];

    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      const batchResults = await handler(batch);
      results.push(...(Array.isArray(batchResults) ? batchResults : [batchResults]));
    }

    return results;
  }

  // 重试机制
  static async retry(handler, options = {}) {
    const { maxRetries = 3, delay = 1000, backoff = 2 } = options;
    let lastError;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await handler();
      } catch (error) {
        lastError = error;
        if (attempt < maxRetries) {
          const waitTime = delay * Math.pow(backoff, attempt);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }
      }
    }

    throw lastError;
  }
}

/**
 * 增强的插件基类
 */
export class EnhancedPluginBase extends EventEmitter {
  constructor(pluginInfo, context) {
    super();
    this.info = pluginInfo;
    this.context = context;
    this.isEnabled = false;
    
    // 增强的logger
    this.logger = this._createEnhancedLogger(pluginInfo.id);
    
    // 增强的storage
    this.storage = new EnhancedStorage(
      pluginInfo.id,
      path.join(__dirname, '../../data/plugins')
    );
    
    // 事件处理器映射
    this.eventHandlers = new Map();
    this.commandHandlers = new Map();
    this.enhancedEventHandlers = [];
    
    // 【统一统计模块】使用 PluginStatistics 管理所有统计数据
    this.stats = new PluginStatistics(pluginInfo.id, this.storage);
    
    // 插件注册信息
    this.registeredCommands = new Map();
    this.usedRules = new Set();
    this.scheduledTasks = new Map();
    
    // 启动性能监控
    this.startPerformanceMonitoring();
    
    // 【全局错误处理器】确保所有未捕获的错误都被记录
    this._setupGlobalErrorHandlers();
    
    // 【核心保护机制】延迟执行，确保在子类构造函数执行后再保护
    // 使用 setImmediate 在当前事件循环完成后执行
    setImmediate(() => {
      this._protectCoreProperties();
    });
  }
  
  /**
   * 【核心保护机制】保护关键属性不被覆盖
   * 在插件子类构造函数执行后调用，检测并修复被覆盖的核心属性
   */
  _protectCoreProperties() {
    const protectedProperties = {
      'stats': {
        expected: 'PluginStatistics实例',
        fix: () => {
          // 如果被覆盖，保存自定义数据到 customStats，然后恢复正确的 stats
          if (!(this.stats instanceof PluginStatistics)) {
            this.logger.warn('⚠️ 检测到插件覆盖了 this.stats，已自动修复');
            this.logger.warn('   请将自定义统计数据保存到 this.customStats 而不是 this.stats');
            
            // 保存被覆盖的数据到 customStats
            this.customStats = this.stats;
            
            // 恢复正确的 PluginStatistics 实例
            this.stats = new PluginStatistics(this.info.id, this.storage);
            
            this.logger.info('✅ 已恢复核心统计模块，你的自定义数据已迁移到 this.customStats');
          }
        }
      },
      'logger': {
        expected: '增强Logger实例',
        fix: () => {
          if (!this.logger || typeof this.logger.info !== 'function') {
            this.logger.warn('⚠️ 检测到插件覆盖了 this.logger，已自动修复');
            this.logger = this._createEnhancedLogger(this.info.id);
          }
        }
      },
      'storage': {
        expected: 'EnhancedStorage实例',
        fix: () => {
          if (!(this.storage instanceof EnhancedStorage)) {
            this.logger.warn('⚠️ 检测到插件覆盖了 this.storage，已自动修复');
            const oldStorage = this.storage;
            this.storage = new EnhancedStorage(
              this.info.id,
              path.join(__dirname, '../../data/plugins')
            );
            // 尝试迁移数据
            if (oldStorage && typeof oldStorage === 'object') {
              this.customStorage = oldStorage;
            }
          }
        }
      }
    };
    
    // 检查并修复被覆盖的属性
    let hasOverride = false;
    for (const [propName, config] of Object.entries(protectedProperties)) {
      try {
        // 先检查是否被覆盖
        const needsFix = (propName === 'stats' && !(this.stats instanceof PluginStatistics)) ||
                         (propName === 'logger' && (!this.logger || typeof this.logger.info !== 'function')) ||
                         (propName === 'storage' && !(this.storage instanceof EnhancedStorage));
        
        if (needsFix) {
          hasOverride = true;
          config.fix();
        }
        
        // 使用 Object.defineProperty 防止再次被覆盖
        const currentValue = this[propName];
        Object.defineProperty(this, propName, {
          value: currentValue,
          writable: false,        // 不可写
          configurable: false,    // 不可配置
          enumerable: true
        });
      } catch (error) {
        // 如果属性已经是不可配置的，忽略错误（说明已经保护过了）
        if (error.message && !error.message.includes('Cannot redefine property')) {
          this.logger.error(`保护属性 ${propName} 失败`, error);
        }
      }
    }
    
    if (hasOverride) {
      this.logger.warn('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      this.logger.warn('⚠️  插件开发注意事项：');
      this.logger.warn('   不要在构造函数中覆盖以下核心属性：');
      this.logger.warn('   • this.stats - 使用 this.customStats 代替');
      this.logger.warn('   • this.logger - 使用父类提供的 logger');
      this.logger.warn('   • this.storage - 使用父类提供的 storage');
      this.logger.warn('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    }
  }
  
  /**
   * 【核心方法 - SDK层面全局错误处理】
   * 设置全局错误处理器，捕获所有未处理的异常
   * 确保插件的任何错误都不会被遗漏
   */
  _setupGlobalErrorHandlers() {
    // 注意：process级别的错误处理器会影响整个进程
    // 这里我们只捕获并记录，不阻止错误传播
    
    // 捕获未处理的Promise rejection
    const unhandledRejectionHandler = (reason, promise) => {
      // 检查是否来自当前插件
      if (this._isPluginError(reason)) {
        this[RECORD_ERROR_INTERNAL]('unhandledRejection', 'global', reason);
        this.logger.error('捕获到未处理的Promise rejection', {
          reason: reason?.message || String(reason)
        });
      }
    };
    
    // 捕获未捕获的异常
    const uncaughtExceptionHandler = (error, origin) => {
      // 检查是否来自当前插件
      if (this._isPluginError(error)) {
        this[RECORD_ERROR_INTERNAL]('uncaughtException', 'global', error);
        this.logger.error('捕获到未捕获的异常', {
          error: error?.message || String(error),
          origin
        });
      }
    };
    
    // 存储处理器引用，以便后续清理
    this._globalErrorHandlers = {
      unhandledRejection: unhandledRejectionHandler,
      uncaughtException: uncaughtExceptionHandler
    };
    
    // 注册全局错误处理器
    process.on('unhandledRejection', unhandledRejectionHandler);
    process.on('uncaughtException', uncaughtExceptionHandler);
    
    this.logger.debug('全局错误处理器已启用');
  }
  
  /**
   * 判断错误是否来自当前插件
   * 通过错误堆栈分析判断
   */
  _isPluginError(error) {
    if (!error || !error.stack) return false;
    
    // 检查堆栈是否包含插件ID或插件目录
    const stack = error.stack;
    return stack.includes(this.info.id) || 
           stack.includes(`plugins/${this.info.id}`) ||
           stack.includes(`plugins\\${this.info.id}`);
  }
  
  /**
   * 清理全局错误处理器
   * 在插件卸载时调用
   */
  _cleanupGlobalErrorHandlers() {
    if (this._globalErrorHandlers) {
      process.off('unhandledRejection', this._globalErrorHandlers.unhandledRejection);
      process.off('uncaughtException', this._globalErrorHandlers.uncaughtException);
      this._globalErrorHandlers = null;
      this.logger.debug('全局错误处理器已清理');
    }
  }

  /**
   * 启动性能监控
   */
  startPerformanceMonitoring() {
    // 立即记录一次基线内存
    this.stats.recordMemoryUsage();
    
    // 每30秒记录一次内存使用
    this.performanceInterval = setInterval(() => {
      this.stats.recordMemoryUsage();
    }, 30 * 1000);
  }
  
  /**
   * 停止性能监控
   */
  stopPerformanceMonitoring() {
    if (this.performanceInterval) {
      clearInterval(this.performanceInterval);
      this.performanceInterval = null;
    }
  }
  
  /**
   * 记录内存使用（委托给统计模块）
   */
  recordMemoryUsage() {
    return this.stats.recordMemoryUsage();
  }
  
  /**
   * 【核心方法 - 不可覆盖】
   * 性能数据记录的内部实现，委托给统一的统计模块
   */
  [RECORD_PERFORMANCE_INTERNAL](type, name, duration, success = true) {
    return this.stats.recordPerformance(type, name, duration, success);
  }
  
  /**
   * 【公开API】记录性能数据
   * 插件可以调用，但实际执行通过内部方法
   */
  recordPerformance(type, name, duration, success = true) {
    return this[RECORD_PERFORMANCE_INTERNAL](type, name, duration, success);
  }
  
  /**
   * 检查异步并发安全（委托给统计模块）
   */
  checkAsyncSafety() {
    return this.stats.checkAsyncSafety();
  }
  
  /**
   * 计算平均执行时间（委托给统计模块）
   */
  calculateAvgExecutionTime() {
    return this.stats.calculateAvgExecutionTime();
  }

  // 创建增强的日志器
  _createEnhancedLogger(pluginId) {
    const createLogMethod = (level) => (message, metadata = {}) => {
      const logEntry = {
        level,
        plugin: pluginId,
        message,
        metadata,
        timestamp: new Date().toISOString()
      };
      
      // 输出日志（添加时间戳，不展开metadata）
      const timestamp = getLocalTime();
      const prefix = `[Plugin:${pluginId}]`;
      const emoji = { info: 'ℹ️', warn: '⚠️', error: '❌', debug: '🐛' }[level] || '📝';
      
      // 不展开空对象，保持单行
      if (metadata && Object.keys(metadata).length > 0) {
        console.log(`[${timestamp}] ${prefix} ${emoji} ${message} ${JSON.stringify(metadata)}`);
      } else {
        console.log(`[${timestamp}] ${prefix} ${emoji} ${message}`);
      }
      
      return logEntry;
    };

    return {
      info: createLogMethod('info'),
      warn: createLogMethod('warn'),
      error: createLogMethod('error'),
      debug: createLogMethod('debug'),
      
      // 子logger
      child: (childMetadata) => {
        const childLogger = this._createEnhancedLogger(pluginId);
        // 合并metadata
        for (const method of ['info', 'warn', 'error', 'debug']) {
          const original = childLogger[method];
          childLogger[method] = (message, metadata = {}) => {
            return original(message, { ...childMetadata, ...metadata });
          };
        }
        return childLogger;
      }
    };
  }

  // 注册增强的事件处理器
  _registerEnhancedEvent(handler) {
    this.enhancedEventHandlers.push(handler);
    
    // 按优先级排序
    this.enhancedEventHandlers.sort((a, b) => b.priority - a.priority);
    
    // 创建包装的处理器（添加性能监控）
    const wrappedHandler = async (event) => {
      // 使用统计模块更新
      this.stats.incrementEventHandled(handler.eventType);
      
      // 异步并发监控
      this.stats.incrementConcurrentOperations();
      
      const startTime = Date.now();
      let success = true;
      
      try {
        await handler.execute(event);
      } catch (error) {
        success = false;
        this.recordError('event', handler.eventType, error);
        throw error;
      } finally {
        this.stats.decrementConcurrentOperations();
        const duration = Date.now() - startTime;
        this.recordPerformance('event', handler.eventType, duration, success);
      }
    };
    
    // 注册到 eventHandlers（用于插件管理器调用）
    if (!this.eventHandlers.has(handler.eventType)) {
      this.eventHandlers.set(handler.eventType, []);
    }
    this.eventHandlers.get(handler.eventType).push(wrappedHandler);
    
    // 同时注册到事件总线
    this.context.eventBus?.on(`plugin.${this.info.id}.${handler.eventType}`, wrappedHandler);
    
    this.logger.debug(`注册事件处理器: ${handler.eventType}`);
  }

  // 增强的事件监听
  onEvent(eventType) {
    return new EnhancedEventHandler(this, eventType);
  }

  /**
   * 【核心方法 - 不可覆盖】
   * 注册命令的内部实现，强制执行性能统计和错误捕获
   * 插件无法覆盖此方法，确保所有统计数据正确收集
   */
  [REGISTER_COMMAND_INTERNAL](command, handler, options = {}) {
    const cmd = command.startsWith('/') ? command.substring(1) : command;
    
    const commandInfo = {
      plugin: this.info.id,
      command: cmd,
      description: options.description || `${command} 指令`,
      usage: options.usage || `/${cmd}`,
      type: 'custom',
      category: options.category || 'utility',
      adminOnly: options.adminOnly || false,
      executionCount: 0,
      lastExecuted: null,
      lastError: null,
      registeredAt: Date.now()
    };
    
    // 【强制包装】确保所有命令执行都被追踪，无法被插件绕过
    const wrappedHandler = async (event) => {
      // ========== SDK强制执行：统计数据收集 ==========
      this.stats.incrementCommandExecutions(cmd, {
        type: options.type,
        category: options.category
      });
      commandInfo.executionCount++;
      commandInfo.lastExecuted = Date.now();
      
      // ========== SDK强制执行：并发监控 ==========
      this.stats.incrementConcurrentOperations();
      
      const startTime = Date.now();
      let success = true;
      let error = null;
      
      try {
        // 执行插件的处理器
        await handler.call(this, event);
      } catch (err) {
        success = false;
        error = err;
        
        // ========== SDK强制执行：错误记录 ==========
        commandInfo.lastError = {
          message: err.message,
          stack: err.stack,
          timestamp: Date.now()
        };
        
        // 使用内部方法记录错误，确保不被覆盖
        this[RECORD_ERROR_INTERNAL]('command', cmd, err);
        
        // 继续抛出错误，让上层处理
        throw err;
      } finally {
        // ========== SDK强制执行：性能记录（无论成功失败都记录） ==========
        this.stats.decrementConcurrentOperations();
        const duration = Date.now() - startTime;
        this[RECORD_PERFORMANCE_INTERNAL]('command', cmd, duration, success);
      }
    };
    
    commandInfo.handler = wrappedHandler;
    this.context.commandRegistry?.register(commandInfo);
    this.registeredCommands.set(cmd, commandInfo);
    
    return commandInfo;
  }
  
  /**
   * 【公开API】注册命令
   * 内部调用Symbol方法，防止插件覆盖核心逻辑
   * 插件可以覆盖此方法进行扩展，但核心统计仍会执行
   */
  registerCommand(command, handler, options = {}) {
    // 调用内部实现，确保统计和错误捕获不被绕过
    return this[REGISTER_COMMAND_INTERNAL](command, handler, options);
  }

  /**
   * 【核心方法 - 不可覆盖】
   * 错误记录的内部实现，委托给统一的统计模块
   */
  [RECORD_ERROR_INTERNAL](type, source, error) {
    this.stats.recordError(type, source, error);
    
    // 输出错误日志（确保错误可见）
    this.logger.error(`[${type}:${source}] ${error?.message || String(error)}`);
  }
  
  /**
   * 【公开API】记录错误
   * 插件可以调用，但实际执行通过内部方法
   */
  recordError(type, source, error) {
    return this[RECORD_ERROR_INTERNAL](type, source, error);
  }

  // 并发处理
  async concurrent(items, handler, options) {
    return ConcurrencyHelper.concurrent(items, handler, options);
  }

  // 批量处理
  async batch(items, handler, options) {
    return ConcurrencyHelper.batch(items, handler, options);
  }

  // 重试
  async retry(handler, options) {
    return ConcurrencyHelper.retry(handler, options);
  }

  // 发送消息
  async sendMessage(chatId, message, type = 'private') {
    return await this.context.messageService.send(chatId, message, type);
  }

  // 调用API
  async callApi(action, params = {}) {
    return await this.context.apiService.call(action, params);
  }

  // ===== CQ码消息处理 =====

  /**
   * 解析消息中的CQ码
   * @param {string} message - 消息字符串
   * @returns {Array} 消息段数组
   */
  parseMessage(message) {
    return CQParser.parse(message);
  }

  /**
   * 从事件中解析消息段
   * @param {Object} event - 事件对象
   * @returns {Array} 消息段数组
   */
  parseEventMessage(event) {
    if (!event || !event.raw_message) {
      return [];
    }
    return this.parseMessage(event.raw_message);
  }

  /**
   * 提取消息中的纯文本
   * @param {string|Array} message - 消息字符串或消息段数组
   * @returns {string} 纯文本
   */
  extractText(message) {
    if (typeof message === 'string') {
      const segments = this.parseMessage(message);
      return CQParser.extractText(segments);
    }
    return CQParser.extractText(message);
  }

  /**
   * 提取消息中的图片
   * @param {string|Array} message - 消息字符串或消息段数组
   * @returns {Array} 图片消息段数组
   */
  extractImages(message) {
    if (typeof message === 'string') {
      const segments = this.parseMessage(message);
      return CQParser.extractByType(segments, 'image');
    }
    return CQParser.extractByType(message, 'image');
  }

  /**
   * 提取消息中的@
   * @param {string|Array} message - 消息字符串或消息段数组
   * @returns {Array} @消息段数组
   */
  extractAts(message) {
    if (typeof message === 'string') {
      const segments = this.parseMessage(message);
      return CQParser.extractByType(segments, 'at');
    }
    return CQParser.extractByType(message, 'at');
  }

  /**
   * 检查消息是否包含图片
   * @param {string|Array} message - 消息字符串或消息段数组
   * @returns {boolean}
   */
  hasImage(message) {
    if (typeof message === 'string') {
      const segments = this.parseMessage(message);
      return CQParser.hasType(segments, 'image');
    }
    return CQParser.hasType(message, 'image');
  }

  /**
   * 检查消息是否包含@
   * @param {string|Array} message - 消息字符串或消息段数组
   * @returns {boolean}
   */
  hasAt(message) {
    if (typeof message === 'string') {
      const segments = this.parseMessage(message);
      return CQParser.hasType(segments, 'at');
    }
    return CQParser.hasType(message, 'at');
  }

  /**
   * 检查消息是否@了指定QQ号
   * @param {string|Array} message - 消息字符串或消息段数组
   * @param {string|number} qq - QQ号
   * @returns {boolean}
   */
  isAtMe(message, qq) {
    const ats = this.extractAts(message);
    return ats.some(at => at.data.qq === String(qq));
  }

  /**
   * 构建CQ码消息
   * 提供便捷的CQBuilder访问
   */
  get CQ() {
    return CQBuilder;
  }

  /**
   * 消息段辅助工具
   */
  get MessageSegment() {
    return MessageSegment;
  }

  // 获取配置
  getConfig(key, defaultValue) {
    return this.storage.get(`config.${key}`, defaultValue);
  }

  // 设置配置
  setConfig(key, value) {
    return this.storage.set(`config.${key}`, value);
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
      // 使用统计模块
      this.stats.incrementTasksExecuted(name, { cron });
      taskInfo.executionCount++;
      taskInfo.lastExecuted = Date.now();
      
      // 并发监控
      this.stats.incrementConcurrentOperations();
      const startTime = Date.now();
      let success = true;
      
      try {
        const result = await handler(...args);
        return result;
      } catch (error) {
        success = false;
        taskInfo.lastError = {
          message: error.message,
          stack: error.stack,
          timestamp: Date.now()
        };
        this.recordError('task', name, error);
        throw error;
      } finally {
        this.stats.decrementConcurrentOperations();
        const duration = Date.now() - startTime;
        this.recordPerformance('task', name, duration, success);
      }
    };
    
    // 检查 scheduler 是否可用
    if (this.context.scheduler) {
      const task = this.context.scheduler.create(`${this.info.id}.${name}`, cron, wrappedHandler);
      this.scheduledTasks.set(name, taskInfo);
      this.logger.debug(`注册定时任务: ${name} (${cron})`);
      return task;
    } else {
      this.logger.warn(`Scheduler 不可用，无法注册定时任务: ${name}`);
      return null;
    }
  }

  // 生命周期钩子(子类可覆盖)
  async onLoad() {
    this.logger.info(`插件 ${this.info.name} 正在加载...`);
    
    // 统计模块已在构造函数中初始化并自动启动保存
    // 延迟加载统计数据（等待插件完成初始化和注册）
    setTimeout(() => {
      this.stats.load();
    }, 1000);
  }

  async onEnable() {
    this.isEnabled = true;
    this.logger.info(`插件 ${this.info.name} 已启用`);
  }

  async onDisable() {
    this.isEnabled = false;
    this.logger.info(`插件 ${this.info.name} 已禁用`);
  }

  async onUnload() {
    // 停止性能监控
    this.stopPerformanceMonitoring();
    
    // 【清理全局错误处理器】
    this._cleanupGlobalErrorHandlers();
    
    // 停止统计模块（包括保存和清理）
    this.stats.destroy();
    
    // 清理资源
    this.eventHandlers.clear();
    this.commandHandlers.clear();
    
    this.logger.info(`插件 ${this.info.name} 已卸载`);
  }

  /**
   * 保存统计数据（委托给统计模块）
   */
  saveStatistics() {
    return this.stats.save();
  }

  /**
   * 加载统计数据（委托给统计模块）
   */
  loadStatistics() {
    return this.stats.load();
  }

  // 获取详细信息（使用统一的统计模块）
  getDetailedInfo() {
    const commands = Array.from(this.registeredCommands.values());
    const tasks = Array.from(this.scheduledTasks.values());
    
    // 从统计模块获取完整数据
    const statsInfo = this.stats.getDetailedInfo();
    
    return {
      basic: this.info,
      status: {
        isEnabled: this.isEnabled,
        lastActivity: statsInfo.statistics.lastActivity
      },
      commands: commands.map(cmd => ({
        command: cmd.command || cmd.name,
        type: cmd.type || 'custom',
        description: cmd.description || '',
        usage: cmd.usage || '',
        category: cmd.category || 'general',
        adminOnly: cmd.adminOnly || false,
        executionCount: cmd.executionCount || 0,
        lastExecuted: cmd.lastExecuted || null,
        lastError: cmd.lastError || null,
        registeredAt: cmd.registeredAt || Date.now()
      })),
      tasks: tasks.map(task => ({
        name: task.name,
        cron: task.cron || task.schedule,
        executionCount: task.executionCount || 0,
        lastExecuted: task.lastExecuted || null,
        lastError: task.lastError || null,
        isActive: task.isActive !== false,
        registeredAt: task.registeredAt || Date.now()
      })),
      rules: Array.from(this.usedRules),
      errors: statsInfo.errors,
      statistics: statsInfo.statistics,
      performance: statsInfo.performance,
      asyncSafety: statsInfo.asyncSafety
    };
  }
}

/**
 * 插件上下文 - 提供给插件的运行环境
 */
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
      info: (msg) => console.log(`[${getLocalTime()}] [Plugin:${pluginId}] ℹ️  ${msg}`),
      warn: (msg) => console.log(`[${getLocalTime()}] [Plugin:${pluginId}] ⚠️  ${msg}`),
      error: (msg) => console.log(`[${getLocalTime()}] [Plugin:${pluginId}] ❌ ${msg}`),
      debug: (msg) => console.log(`[${getLocalTime()}] [Plugin:${pluginId}] 🐛 ${msg}`)
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

// 导出CQ工具类供外部使用
export { CQParser, CQBuilder, MessageSegment };

// 默认导出增强基类
export default EnhancedPluginBase;

