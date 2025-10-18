/**
 * KiBot 增强插件SDK v3.0
 * 提供更优雅的API和开发体验
 * 
 * @module plugin-sdk-enhanced
 * @version 3.0.0
 * @author KiBot Team
 */

import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import { CQParser, CQBuilder, MessageSegment } from '../../utils/cq-parser.js';

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

  // 执行事件处理
  async execute(event) {
    // 检查过滤器
    for (const filter of this.filters) {
      if (!filter(event)) {
        return; // 过滤器不通过，跳过处理
      }
    }

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
      path.join(process.cwd(), 'data', 'plugins')
    );
    
    // 事件处理器映射
    this.eventHandlers = new Map();
    this.commandHandlers = new Map();
    this.enhancedEventHandlers = [];
    
    // 统计信息
    this.registeredCommands = new Map();
    this.usedRules = new Set();
    this.scheduledTasks = new Map();
    this.errors = [];
    this.lastActivity = Date.now();
    this.statistics = {
      commandExecutions: 0,
      eventHandled: 0,
      tasksExecuted: 0,
      errorsOccurred: 0
    };
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
      
      // 输出日志
      const prefix = `[Plugin:${pluginId}]`;
      const emoji = { info: 'ℹ️', warn: '⚠️', error: '❌', debug: '🐛' }[level] || '📝';
      console.log(`${prefix} ${emoji} ${message}`, metadata);
      
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
    
    // 创建包装的处理器
    const wrappedHandler = async (event) => {
      this.lastActivity = Date.now();
      this.statistics.eventHandled++;
      
      try {
        await handler.execute(event);
      } catch (error) {
        this.recordError('event', handler.eventType, error);
        throw error;
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

  // 记录错误
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
    
    this.logger.error(`${type} 错误: ${source}`, { error: error.message });
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

  // 生命周期钩子(子类可覆盖)
  async onLoad() {
    this.logger.info(`插件 ${this.info.name} 正在加载...`);
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
    this.logger.info(`插件 ${this.info.name} 已卸载`);
  }

  // 获取详细信息
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
      errors: recentErrors.map(err => ({
        type: err.type || 'unknown',
        source: err.source || 'unknown',
        message: err.message || '',
        timestamp: err.timestamp || Date.now(),
        stack: err.stack
      })),
      statistics: this.statistics
    };
  }
}

// 导出CQ工具类供外部使用
export { CQParser, CQBuilder, MessageSegment };

// 默认导出增强基类
export default EnhancedPluginBase;

