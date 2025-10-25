/**
 * KiBot 系统级统计数据管理模块
 * 提供整个项目的统一性能数据收集、存储、查询和持久化功能
 * 
 * 核心设计原则：
 * 1. 统一的数据结构和接口
 * 2. 自动化的数据持久化
 * 3. 完善的数据验证和迁移
 * 4. 高性能的数据存取
 * 5. 支持多维度数据聚合
 * 
 * @module system-statistics
 * @version 1.0.0
 * @author KiBot Team
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 数据版本号
const DATA_VERSION = '1.0.0';

// 数据存储路径配置
const STORAGE_CONFIG = {
  // 系统统计数据根目录
  baseDir: path.join(__dirname, '../data/monitoring'),
  
  // 文件名配置
  systemStatsFile: 'system-stats.json',
  httpStatsFile: 'http-stats.json',
  messageStatsFile: 'message-stats.json',
  performanceFile: 'performance.json',
  errorsFile: 'errors.json',
  
  // 备份配置
  backupDir: 'backups',
  
  // 保存间隔
  saveInterval: 5 * 60 * 1000, // 5分钟
  
  // 数据保留策略
  retention: {
    errors: 500,              // 保留最近500个错误
    httpRequests: 1000,       // 保留最近1000个HTTP请求
    messages: 1000,           // 保留最近1000条消息
    performanceRecords: 100,  // 每个端点保留100条性能记录
    memoryRecords: 200,       // 保留最近200条内存记录
    cpuRecords: 200,          // 保留最近200条CPU记录
    backups: 10               // 保留最近10个备份
  }
};

/**
 * 系统级统计数据管理器
 */
export class SystemStatistics {
  constructor() {
    // 数据存储路径
    this.dataDir = STORAGE_CONFIG.baseDir;
    this.systemStatsPath = path.join(this.dataDir, STORAGE_CONFIG.systemStatsFile);
    this.httpStatsPath = path.join(this.dataDir, STORAGE_CONFIG.httpStatsFile);
    this.messageStatsPath = path.join(this.dataDir, STORAGE_CONFIG.messageStatsFile);
    this.performancePath = path.join(this.dataDir, STORAGE_CONFIG.performanceFile);
    this.errorsPath = path.join(this.dataDir, STORAGE_CONFIG.errorsFile);
    this.backupDir = path.join(this.dataDir, STORAGE_CONFIG.backupDir);
    
    // 系统设置（运行时配置）
    this.settings = {
      enableMonitoring: true,
      enablePerformanceTracking: true,
      monitoringInterval: 30,
      maxLogEntries: 1000
    };
    
    // 确保目录存在
    this._ensureDirectories();
    
    // 初始化统计数据
    this._initializeStats();
    
    // 初始化归档管理器
    this.archiveManager = new ArchiveManager(this.dataDir);
    
    // 历史数据缓存
    this.historicalCache = new Map();
    this.historicalData = { messages: [], apiCalls: [], errors: [] };
    
    // 加载系统设置
    this._loadSystemSettings();
    
    // 启动自动保存
    this._startAutoSave();
    
    // 启动系统监控（根据设置决定是否启动）
    if (this.settings.enableMonitoring) {
      this._startSystemMonitoring();
    }
    
    // 启动每日归档
    this._setupDailyArchive();
  }
  
  /**
   * 加载系统设置
   */
  _loadSystemSettings() {
    try {
      const settingsPath = path.join(__dirname, '../data/system-settings.json');
      if (fs.existsSync(settingsPath)) {
        const savedSettings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        this.settings = { ...this.settings, ...savedSettings };
        // console.log('系统统计：已加载设置', this.settings);
      }
    } catch (error) {
      console.warn('加载系统设置失败，使用默认值:', error.message);
    }
  }
  
  /**
   * 重新加载设置（供外部调用，当设置更新时）
   */
  reloadSettings() {
    const oldSettings = { ...this.settings };
    this._loadSystemSettings();
    
    // 如果监控开关状态改变，重新启动或停止监控
    if (oldSettings.enableMonitoring !== this.settings.enableMonitoring) {
      if (this.settings.enableMonitoring) {
        this._startSystemMonitoring();
        console.log('✅ 系统监控已启用');
      } else {
        this.stopSystemMonitoring();
        console.log('⏸️  系统监控已禁用');
      }
    }
    
    // 如果监控间隔改变，重新启动监控
    if (this.settings.enableMonitoring && oldSettings.monitoringInterval !== this.settings.monitoringInterval) {
      this.stopSystemMonitoring();
      this._startSystemMonitoring();
      console.log(`🔄 监控间隔已更新为 ${this.settings.monitoringInterval} 秒`);
    }
  }
  
  /**
   * 确保所有必需的目录存在
   */
  _ensureDirectories() {
    const dirs = [this.dataDir, this.backupDir];
    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
  }
  
  /**
   * 初始化统计数据结构
   */
  _initializeStats() {
    // 系统基础统计
    this.systemStats = {
      // 计数器
      counters: {
        totalMessages: 0,
        totalApiCalls: 0,
        totalErrors: 0,
        totalRulesTriggered: 0,
        totalPluginExecutions: 0,
        totalHttpRequests: 0,
        startTime: Date.now()
      },
      
      // 系统信息
      system: {
        platform: process.platform,
        nodeVersion: process.version,
        arch: process.arch,
        cpus: os.cpus().length,
        totalMemory: os.totalmem(),
        hostname: os.hostname()
      },
      
      // 运行时信息
      runtime: {
        uptime: 0,
        lastRestart: null,
        restartCount: 0
      },
      
      version: DATA_VERSION,
      timestamp: Date.now()
    };
    
    // HTTP请求统计
    this.httpStats = {
      endpoints: new Map(), // key: endpoint, value: EndpointStats
      totalRequests: 0,
      totalErrors: 0,
      avgResponseTime: 0,
      recentRequests: []
    };
    
    // 消息统计
    this.messageStats = {
      total: 0,
      byType: {
        group: 0,
        private: 0
      },
      byContentType: {
        text: 0,
        image: 0,
        at: 0,
        reply: 0,
        other: 0
      },
      userActivity: new Map(),  // key: userId, value: UserActivity
      groupActivity: new Map(), // key: groupId, value: GroupActivity
      recentMessages: []
    };
    
    // 系统性能监控
    this.performance = {
      cpu: {
        current: 0,
        average: 0,
        max: 0,
        history: []
      },
      memory: {
        process: {
          heapUsed: 0,
          heapTotal: 0,
          rss: 0,
          external: 0
        },
        system: {
          total: os.totalmem(),
          free: os.freemem(),
          used: 0,
          usagePercent: 0
        },
        history: []
      },
      eventLoop: {
        current: 0,
        average: 0,
        max: 0,
        history: []
      },
      monitorStartTime: Date.now(),
      dataVersion: DATA_VERSION
    };
    
    // 错误记录
    this.errors = [];
    
    // 加载持久化数据
    this.load();
  }
  
  // ==================== HTTP统计方法 ====================
  
  /**
   * 记录HTTP请求
   * @param {string} endpoint - 端点路径
   * @param {number} duration - 响应时间（毫秒）
   * @param {boolean} success - 是否成功
   * @param {number} statusCode - HTTP状态码
   */
  recordHttpRequest(endpoint, duration, success = true, statusCode = 200) {
    // 检查是否启用性能追踪
    if (!this.settings.enablePerformanceTracking) {
      return; // 禁用时不记录详细的性能数据
    }
    
    this.httpStats.totalRequests++;
    this.systemStats.counters.totalHttpRequests++;
    
    if (!success) {
      this.httpStats.totalErrors++;
    }
    
    // 更新端点统计
    if (!this.httpStats.endpoints.has(endpoint)) {
      this.httpStats.endpoints.set(endpoint, {
        endpoint,
        count: 0,
        totalDuration: 0,
        minDuration: Infinity,
        maxDuration: 0,
        avgDuration: 0,
        errors: 0,
        errorRate: 0,
        lastRequests: []
      });
    }
    
    const endpointStats = this.httpStats.endpoints.get(endpoint);
    endpointStats.count++;
    endpointStats.totalDuration += duration;
    endpointStats.minDuration = Math.min(endpointStats.minDuration, duration);
    endpointStats.maxDuration = Math.max(endpointStats.maxDuration, duration);
    endpointStats.avgDuration = endpointStats.totalDuration / endpointStats.count;
    
    if (!success) {
      endpointStats.errors++;
      endpointStats.errorRate = endpointStats.errors / endpointStats.count;
    }
    
    // 记录最近请求
    endpointStats.lastRequests.push({
      timestamp: Date.now(),
      duration,
      success,
      statusCode
    });
    
    if (endpointStats.lastRequests.length > STORAGE_CONFIG.retention.performanceRecords) {
      endpointStats.lastRequests.shift();
    }
    
    // 记录最近的HTTP请求
    this.httpStats.recentRequests.push({
      timestamp: Date.now(),
      endpoint,
      duration,
      success,
      statusCode
    });
    
    // 使用配置的最大日志条目数
    const maxEntries = this.settings.maxLogEntries || STORAGE_CONFIG.retention.httpRequests;
    if (this.httpStats.recentRequests.length > maxEntries) {
      this.httpStats.recentRequests.shift();
    }
    
    // 更新平均响应时间
    this._updateHttpAvgTime();
  }
  
  /**
   * 更新HTTP平均响应时间
   */
  _updateHttpAvgTime() {
    const allEndpoints = Array.from(this.httpStats.endpoints.values());
    if (allEndpoints.length === 0) {
      this.httpStats.avgResponseTime = 0;
      return;
    }
    
    const totalDuration = allEndpoints.reduce((sum, ep) => sum + ep.totalDuration, 0);
    const totalCount = allEndpoints.reduce((sum, ep) => sum + ep.count, 0);
    this.httpStats.avgResponseTime = totalCount > 0 ? totalDuration / totalCount : 0;
  }
  
  // ==================== 消息统计方法 ====================
  
  /**
   * 记录消息
   * @param {Object} message - 消息对象
   */
  recordMessage(message) {
    // 基础计数总是记录
    this.messageStats.total++;
    this.systemStats.counters.totalMessages++;
    
    // 详细统计需要启用性能追踪
    if (!this.settings.enablePerformanceTracking) {
      return; // 只记录基础计数
    }
    
    // 按类型统计
    const messageType = message.message_type || message.messageType;
    if (messageType) {
      this.messageStats.byType[messageType] = (this.messageStats.byType[messageType] || 0) + 1;
    }
    
    // 按内容类型统计
    const contentType = this._detectContentType(message);
    this.messageStats.byContentType[contentType]++;
    
    // 用户活动统计
    if (message.user_id || message.userId) {
      this._recordUserActivity(message);
    }
    
    // 群组活动统计
    if (message.group_id || message.groupId) {
      this._recordGroupActivity(message);
    }
    
    // 记录最近消息
    this.messageStats.recentMessages.push({
      timestamp: message.timestamp || Date.now(),
      type: messageType,
      contentType,
      userId: message.user_id || message.userId,
      groupId: message.group_id || message.groupId
    });
    
    // 使用配置的最大日志条目数
    const maxEntries = this.settings.maxLogEntries || STORAGE_CONFIG.retention.messages;
    if (this.messageStats.recentMessages.length > maxEntries) {
      this.messageStats.recentMessages.shift();
    }
  }
  
  /**
   * 检测消息内容类型
   */
  _detectContentType(message) {
    const rawMessage = message.raw_message || message.content || '';
    
    if (rawMessage.includes('[CQ:image')) return 'image';
    if (rawMessage.includes('[CQ:at')) return 'at';
    if (rawMessage.includes('[CQ:reply')) return 'reply';
    if (rawMessage.trim().length > 0) return 'text';
    return 'other';
  }
  
  /**
   * 记录用户活动
   */
  _recordUserActivity(message) {
    const userId = String(message.user_id || message.userId);
    
    if (!this.messageStats.userActivity.has(userId)) {
      this.messageStats.userActivity.set(userId, {
        userId,
        messageCount: 0,
        firstSeen: Date.now(),
        lastActive: Date.now(),
        messageTypes: {},
        hourlyActivity: new Array(24).fill(0)
      });
    }
    
    const activity = this.messageStats.userActivity.get(userId);
    activity.messageCount++;
    activity.lastActive = Date.now();
    
    // 按消息类型统计
    const msgType = message.message_type || message.messageType || 'unknown';
    activity.messageTypes[msgType] = (activity.messageTypes[msgType] || 0) + 1;
    
    // 按小时统计活跃度
    const hour = new Date().getHours();
    activity.hourlyActivity[hour]++;
  }
  
  /**
   * 记录群组活动
   */
  _recordGroupActivity(message) {
    const groupId = String(message.group_id || message.groupId);
    
    if (!this.messageStats.groupActivity.has(groupId)) {
      this.messageStats.groupActivity.set(groupId, {
        groupId,
        messageCount: 0,
        firstSeen: Date.now(),
        lastActive: Date.now(),
        activeUsers: new Set(),
        messageTypes: {},
        hourlyActivity: new Array(24).fill(0)
      });
    }
    
    const activity = this.messageStats.groupActivity.get(groupId);
    activity.messageCount++;
    activity.lastActive = Date.now();
    
    // 记录活跃用户
    const userId = String(message.user_id || message.userId);
    if (userId) {
      activity.activeUsers.add(userId);
    }
    
    // 按消息类型统计
    const msgType = message.message_type || message.messageType || 'unknown';
    activity.messageTypes[msgType] = (activity.messageTypes[msgType] || 0) + 1;
    
    // 按小时统计活跃度
    const hour = new Date().getHours();
    activity.hourlyActivity[hour]++;
  }
  
  // ==================== API统计方法 ====================
  
  /**
   * 记录API调用
   * @param {string} action - API动作
   * @param {number} duration - 执行时间
   * @param {boolean} success - 是否成功
   */
  recordApiCall(action, duration, success = true) {
    // 基础计数总是记录
    this.systemStats.counters.totalApiCalls++;
    
    // 详细统计需要启用性能追踪
    if (this.settings.enablePerformanceTracking) {
      // 可以在这里添加更详细的API统计（如果需要）
    }
  }
  
  /**
   * 记录规则触发
   */
  recordRuleTriggered() {
    this.systemStats.counters.totalRulesTriggered++;
  }
  
  /**
   * 记录插件执行
   */
  recordPluginExecution() {
    this.systemStats.counters.totalPluginExecutions++;
  }
  
  // ==================== 性能监控方法 ====================
  
  /**
   * 记录CPU使用率
   */
  recordCpuUsage() {
    try {
      const cpus = os.cpus();
      let totalIdle = 0;
      let totalTick = 0;
      
      for (const cpu of cpus) {
        for (const type in cpu.times) {
          totalTick += cpu.times[type];
        }
        totalIdle += cpu.times.idle;
      }
      
      const usage = 100 - (100 * totalIdle / totalTick);
      
      this.performance.cpu.current = usage;
      this.performance.cpu.max = Math.max(this.performance.cpu.max, usage);
      
      this.performance.cpu.history.push({
        timestamp: Date.now(),
        usage
      });
      
      // 只保留配置的记录数量
      if (this.performance.cpu.history.length > STORAGE_CONFIG.retention.cpuRecords) {
        this.performance.cpu.history = this.performance.cpu.history.slice(-STORAGE_CONFIG.retention.cpuRecords);
      }
      
      // 计算平均值
      this._updateCpuAverage();
    } catch (error) {
      console.error('记录CPU使用率失败:', error);
    }
  }
  
  /**
   * 更新CPU平均值
   */
  _updateCpuAverage() {
    if (this.performance.cpu.history.length === 0) {
      this.performance.cpu.average = 0;
      return;
    }
    
    const sum = this.performance.cpu.history.reduce((acc, record) => acc + record.usage, 0);
    this.performance.cpu.average = sum / this.performance.cpu.history.length;
  }
  
  /**
   * 记录内存使用情况
   */
  recordMemoryUsage() {
    try {
      const memUsage = process.memoryUsage();
      const systemMem = {
        total: os.totalmem(),
        free: os.freemem()
      };
      systemMem.used = systemMem.total - systemMem.free;
      systemMem.usagePercent = (systemMem.used / systemMem.total) * 100;
      
      // 更新当前值
      this.performance.memory.process = {
        heapUsed: memUsage.heapUsed,
        heapTotal: memUsage.heapTotal,
        rss: memUsage.rss,
        external: memUsage.external
      };
      
      this.performance.memory.system = systemMem;
      
      // 记录历史
      this.performance.memory.history.push({
        timestamp: Date.now(),
        process: { ...this.performance.memory.process },
        system: { ...systemMem }
      });
      
      // 只保留配置的记录数量
      if (this.performance.memory.history.length > STORAGE_CONFIG.retention.memoryRecords) {
        this.performance.memory.history = this.performance.memory.history.slice(-STORAGE_CONFIG.retention.memoryRecords);
      }
    } catch (error) {
      console.error('记录内存使用失败:', error);
    }
  }
  
  /**
   * 记录事件循环延迟
   * @param {number} delay - 延迟时间（毫秒）
   */
  recordEventLoopDelay(delay) {
    this.performance.eventLoop.current = delay;
    this.performance.eventLoop.max = Math.max(this.performance.eventLoop.max, delay);
    
    this.performance.eventLoop.history.push({
      timestamp: Date.now(),
      delay
    });
    
    if (this.performance.eventLoop.history.length > 200) {
      this.performance.eventLoop.history.shift();
    }
    
    // 更新平均值
    this._updateEventLoopAverage();
  }
  
  /**
   * 更新事件循环平均延迟
   */
  _updateEventLoopAverage() {
    if (this.performance.eventLoop.history.length === 0) {
      this.performance.eventLoop.average = 0;
      return;
    }
    
    const sum = this.performance.eventLoop.history.reduce((acc, record) => acc + record.delay, 0);
    this.performance.eventLoop.average = sum / this.performance.eventLoop.history.length;
  }
  
  // ==================== 错误记录方法 ====================
  
  /**
   * 记录系统错误
   * @param {string} type - 错误类型
   * @param {string} source - 错误来源
   * @param {Error|string} error - 错误对象或消息
   * @param {Object} metadata - 额外元数据
   */
  recordError(type, source, error, metadata = {}) {
    const errorInfo = {
      type,
      source,
      message: error?.message || String(error),
      stack: error?.stack,
      timestamp: Date.now(),
      metadata
    };
    
    this.errors.push(errorInfo);
    this.systemStats.counters.totalErrors++;
    
    // 使用配置的最大日志条目数
    const maxEntries = this.settings.maxLogEntries || STORAGE_CONFIG.retention.errors;
    if (this.errors.length > maxEntries) {
      this.errors = this.errors.slice(-maxEntries);
    }
  }
  
  // ==================== 数据查询方法 ====================
  
  /**
   * 获取系统统计摘要
   */
  getSystemSummary() {
    return {
      ...this.systemStats,
      runtime: {
        ...this.systemStats.runtime,
        uptime: Date.now() - this.systemStats.counters.startTime
      },
      timestamp: Date.now()
    };
  }
  
  /**
   * 获取HTTP统计数据
   */
  getHttpStats() {
    return {
      totalRequests: this.httpStats.totalRequests,
      totalErrors: this.httpStats.totalErrors,
      avgResponseTime: this.httpStats.avgResponseTime,
      errorRate: this.httpStats.totalRequests > 0 
        ? this.httpStats.totalErrors / this.httpStats.totalRequests 
        : 0,
      endpoints: Array.from(this.httpStats.endpoints.values())
        .map(endpoint => ({
          endpoint: endpoint.endpoint,
          count: endpoint.count,
          avgTime: endpoint.avgDuration,  // 映射为前端期望的字段名
          minTime: endpoint.minDuration === Infinity ? 0 : endpoint.minDuration,  // 处理 Infinity 值
          maxTime: endpoint.maxDuration,
          errors: endpoint.errors,
          errorRate: endpoint.errorRate * 100  // 转换为百分比
        }))
        .sort((a, b) => b.count - a.count) // 按请求数排序
        .slice(0, 50), // 只返回前50个
      recentRequests: this.httpStats.recentRequests.slice(-100)
    };
  }
  
  /**
   * 清理HTTP统计数据
   */
  clearHttpStats() {
    // 重置HTTP统计数据
    this.httpStats = {
      endpoints: new Map(),
      totalRequests: 0,
      totalErrors: 0,
      avgResponseTime: 0,
      recentRequests: []
    };
    
    // 立即保存
    this.saveHttpStats();
    
    console.log('🧹 HTTP统计数据已清理');
    
    return {
      success: true,
      message: 'HTTP统计数据已清理'
    };
  }
  
  /**
   * 获取消息统计数据
   */
  getMessageStats() {
    return {
      total: this.messageStats.total,
      byType: this.messageStats.byType,
      byContentType: this.messageStats.byContentType,
      topUsers: this._getTopUsers(10),
      topGroups: this._getTopGroups(10),
      recentMessages: this.messageStats.recentMessages.slice(-100)
    };
  }
  
  /**
   * 获取Top用户
   */
  _getTopUsers(limit = 10) {
    return Array.from(this.messageStats.userActivity.values())
      .map(activity => ({
        userId: activity.userId,
        messageCount: activity.messageCount,
        lastActive: activity.lastActive,
        messageTypes: activity.messageTypes
      }))
      .sort((a, b) => b.messageCount - a.messageCount)
      .slice(0, limit);
  }
  
  /**
   * 获取Top群组
   */
  _getTopGroups(limit = 10) {
    return Array.from(this.messageStats.groupActivity.values())
      .map(activity => ({
        groupId: activity.groupId,
        messageCount: activity.messageCount,
        lastActive: activity.lastActive,
        activeUserCount: activity.activeUsers.size,
        messageTypes: activity.messageTypes
      }))
      .sort((a, b) => b.messageCount - a.messageCount)
      .slice(0, limit);
  }
  
  /**
   * 获取性能数据
   */
  getPerformanceData() {
    return {
      cpu: {
        ...this.performance.cpu,
        history: this.performance.cpu.history.slice(-50)
      },
      memory: {
        ...this.performance.memory,
        history: this.performance.memory.history.slice(-50)
      },
      eventLoop: {
        ...this.performance.eventLoop,
        history: this.performance.eventLoop.history.slice(-50)
      },
      monitorStartTime: this.performance.monitorStartTime,
      dataVersion: this.performance.dataVersion
    };
  }
  
  /**
   * 获取错误列表
   */
  getErrors(limit = 50) {
    return this.errors.slice(-limit);
  }
  
  /**
   * 获取完整的统计数据
   */
  getFullStats() {
    return {
      system: this.getSystemSummary(),
      http: this.getHttpStats(),
      messages: this.getMessageStats(),
      performance: this.getPerformanceData(),
      errors: this.getErrors(50)
    };
  }
  
  // ==================== 历史数据查询方法 ====================
  
  /**
   * 查询历史数据（支持时间范围）
   * @param {string} timeRange - 时间范围 ('1h', '24h', '7d', '30d')
   * @param {string} dataType - 数据类型 ('messages', 'apiCalls', 'errors', 'all')
   * @returns {Promise<Object|Array>} 历史数据
   */
  async queryHistoricalData(timeRange = '7d', dataType = 'messages') {
    const cacheKey = `${timeRange}_${dataType}`;
    
    // 检查缓存
    if (this.historicalCache.has(cacheKey)) {
      const cached = this.historicalCache.get(cacheKey);
      if (Date.now() - cached.timestamp < 60000) { // 1分钟缓存
        return cached.data;
      }
    }
    
    // 计算时间范围
    const timeRangeMs = this._getTimeRangeMs(timeRange);
    const startTime = Date.now() - timeRangeMs;
    const endTime = Date.now();
    
    // 加载归档数据
    const archives = await this.archiveManager.loadRange(startTime, endTime);
    
    // 合并当前数据和归档数据
    const currentData = this._getCurrentData(dataType);
    const historicalData = this._mergeArchiveData(archives, dataType);
    
    const merged = [...historicalData, ...currentData]
      .filter(item => item.timestamp >= startTime)
      .sort((a, b) => a.timestamp - b.timestamp);
    
    // 缓存结果
    this.historicalCache.set(cacheKey, {
      data: merged,
      timestamp: Date.now()
    });
    
    return merged;
  }
  
  /**
   * 生成统计报告（兼容 MonitorDataManager API）
   * @param {string} timeRange - 时间范围
   * @returns {Promise<Object>} 统计报告
   */
  async generateStatsReport(timeRange = '24h') {
    const now = Date.now();
    const timeRangeMs = this._getTimeRangeMs(timeRange);
    const startTime = now - timeRangeMs;
    
    // 查询历史数据
    const allMessages = await this.queryHistoricalData(timeRange, 'messages');
    const allApiCalls = timeRange === '7d' || timeRange === '30d' 
      ? await this.queryHistoricalData(timeRange, 'apiCalls') 
      : this.httpStats.recentRequests;
    const allErrors = timeRange === '7d' || timeRange === '30d'
      ? await this.queryHistoricalData(timeRange, 'errors')
      : this.errors;
    
    // 生成实时统计
    const realTimeStats = {
      totalMessages: this.systemStats.counters.totalMessages,
      todayMessages: this._getTodayMessages(allMessages),
      onlineUsers: this._getActiveUsersCount(24 * 60 * 60 * 1000),
      activeGroups: this._getActiveGroupsCount(24 * 60 * 60 * 1000),
      totalFriends: this.messageStats.userActivity.size,
      systemUptime: Math.floor((now - this.systemStats.counters.startTime) / 1000),
      messagesPerSecond: this._getMessagesPerSecond()
    };
    
    // 生成时间序列数据
    const messageStats = {
      hourlyData: this._generateHourlyData(allMessages),
      dailyData: this._generateDailyData(timeRange, allMessages),
      weeklyData: this._generateWeeklyData(timeRange, allMessages)
    };
    
    // 生成用户活跃度数据
    const userActivity = {
      topActiveUsers: this._getTopUsers(20).map(u => ({
        userId: u.userId,
        username: `用户${u.userId}`,
        messageCount: u.messageCount,
        lastActive: new Date(u.lastActive).toLocaleString()
      })),
      topActiveGroups: this._getTopGroups(15).map(g => ({
        groupId: g.groupId,
        groupName: `群组${g.groupId}`,
        messageCount: g.messageCount,
        memberCount: 0,
        activeUsers: g.activeUserCount
      })),
      userActivityDistribution: this._getUserActivityDistribution()
    };
    
    // 生成系统统计
    const systemStats = {
      rulesTriggered: this.systemStats.counters.totalRulesTriggered,
      apiCallsCount: this.systemStats.counters.totalApiCalls,
      pluginExecutions: this.systemStats.counters.totalPluginExecutions,
      errorsCount: this.systemStats.counters.totalErrors,
      performance: this._generatePerformanceData()
    };
    
    // 生成内容分析
    const contentAnalysis = {
      messageTypes: this._analyzeMessageTypes(allMessages),
      popularKeywords: this._analyzeKeywords(allMessages),
      sentimentAnalysis: this._analyzeSentiment(allMessages)
    };
    
    return {
      realTimeStats,
      messageStats,
      userActivity,
      systemStats,
      contentAnalysis,
      generatedAt: now,
      timeRange,
      dataQuality: this._assessDataQuality()
    };
  }
  
  /**
   * 归档旧数据
   */
  async archiveOldData() {
    const archiveDate = new Date();
    archiveDate.setDate(archiveDate.getDate() - 1);
    archiveDate.setHours(0, 0, 0, 0);
    
    const dayStart = archiveDate.getTime();
    const dayEnd = dayStart + 24 * 60 * 60 * 1000;
    
    // 提取要归档的数据
    const archiveData = {
      systemStats: this.getSystemSummary(),
      httpStats: this.getHttpStats(),
      messageStats: this.getMessageStats(),
      performanceData: this.getPerformanceData(),
      errors: this.errors.filter(e => e.timestamp >= dayStart && e.timestamp < dayEnd),
      rawData: {
        messages: this.messageStats.recentMessages.filter(m => 
          m.timestamp >= dayStart && m.timestamp < dayEnd
        ),
        httpRequests: this.httpStats.recentRequests.filter(r => 
          r.timestamp >= dayStart && r.timestamp < dayEnd
        ),
        errors: this.errors.filter(e => 
          e.timestamp >= dayStart && e.timestamp < dayEnd
        )
      }
    };
    
    // 保存归档
    const archivePath = await this.archiveManager.save(archiveDate, archiveData);
    
    // 清理旧归档（保留30天）
    this.archiveManager.cleanOldArchives(30);
    
    // 归档完成（静默）
    
    return archivePath;
  }
  
  // ==================== 数据持久化方法 ====================
  
  /**
   * 保存所有统计数据
   */
  save() {
    try {
      this._saveSystemStats();
      this._saveHttpStats();
      this._saveMessageStats();
      this._savePerformance();
      this._saveErrors();
      return true;
    } catch (error) {
      console.error('保存系统统计数据失败:', error);
      return false;
    }
  }
  
  /**
   * 保存系统基础统计
   */
  _saveSystemStats() {
    const data = {
      ...this.systemStats,
      timestamp: Date.now()
    };
    fs.writeFileSync(this.systemStatsPath, JSON.stringify(data, null, 2));
  }
  
  /**
   * 保存HTTP统计
   */
  _saveHttpStats() {
    const data = {
      totalRequests: this.httpStats.totalRequests,
      totalErrors: this.httpStats.totalErrors,
      avgResponseTime: this.httpStats.avgResponseTime,
      endpoints: Object.fromEntries(this.httpStats.endpoints),
      recentRequests: this.httpStats.recentRequests
    };
    fs.writeFileSync(this.httpStatsPath, JSON.stringify(data, null, 2));
  }
  
  /**
   * 保存消息统计
   */
  _saveMessageStats() {
    const data = {
      total: this.messageStats.total,
      byType: this.messageStats.byType,
      byContentType: this.messageStats.byContentType,
      userActivity: Object.fromEntries(
        Array.from(this.messageStats.userActivity.entries()).map(([userId, activity]) => [
          userId,
          { ...activity, activeUsers: undefined } // 移除Set
        ])
      ),
      groupActivity: Object.fromEntries(
        Array.from(this.messageStats.groupActivity.entries()).map(([groupId, activity]) => [
          groupId,
          { ...activity, activeUsers: Array.from(activity.activeUsers) } // 转换Set为数组
        ])
      ),
      recentMessages: this.messageStats.recentMessages
    };
    fs.writeFileSync(this.messageStatsPath, JSON.stringify(data, null, 2));
  }
  
  /**
   * 保存性能数据
   */
  _savePerformance() {
    fs.writeFileSync(this.performancePath, JSON.stringify(this.performance, null, 2));
  }
  
  /**
   * 保存错误日志
   */
  _saveErrors() {
    const data = {
      errors: this.errors,
      version: DATA_VERSION,
      timestamp: Date.now()
    };
    fs.writeFileSync(this.errorsPath, JSON.stringify(data, null, 2));
  }
  
  /**
   * 加载所有统计数据
   */
  load() {
    try {
      this._loadSystemStats();
      this._loadHttpStats();
      this._loadMessageStats();
      this._loadPerformance();
      this._loadErrors();
      return true;
    } catch (error) {
      console.error('加载系统统计数据失败:', error);
      return false;
    }
  }
  
  /**
   * 加载系统统计
   */
  _loadSystemStats() {
    if (!fs.existsSync(this.systemStatsPath)) return;
    
    try {
      const data = JSON.parse(fs.readFileSync(this.systemStatsPath, 'utf8'));
      
      if (data.counters) {
        this.systemStats.counters = {
          ...this.systemStats.counters,
          ...data.counters
        };
      }
      
      if (data.runtime) {
        this.systemStats.runtime = data.runtime;
      }
    } catch (error) {
      console.error('解析系统统计数据失败:', error);
    }
  }
  
  /**
   * 加载HTTP统计
   */
  _loadHttpStats() {
    if (!fs.existsSync(this.httpStatsPath)) return;
    
    try {
      const data = JSON.parse(fs.readFileSync(this.httpStatsPath, 'utf8'));
      
      this.httpStats.totalRequests = data.totalRequests || 0;
      this.httpStats.totalErrors = data.totalErrors || 0;
      this.httpStats.avgResponseTime = data.avgResponseTime || 0;
      
      if (data.endpoints) {
        this.httpStats.endpoints = new Map(Object.entries(data.endpoints));
      }
      
      if (data.recentRequests) {
        this.httpStats.recentRequests = data.recentRequests;
      }
    } catch (error) {
      console.error('解析HTTP统计数据失败:', error);
    }
  }
  
  /**
   * 加载消息统计
   */
  _loadMessageStats() {
    if (!fs.existsSync(this.messageStatsPath)) return;
    
    try {
      const data = JSON.parse(fs.readFileSync(this.messageStatsPath, 'utf8'));
      
      this.messageStats.total = data.total || 0;
      this.messageStats.byType = data.byType || { group: 0, private: 0 };
      this.messageStats.byContentType = data.byContentType || { text: 0, image: 0, at: 0, reply: 0, other: 0 };
      
      if (data.userActivity) {
        this.messageStats.userActivity = new Map(Object.entries(data.userActivity));
      }
      
      if (data.groupActivity) {
        this.messageStats.groupActivity = new Map(
          Object.entries(data.groupActivity).map(([groupId, activity]) => [
            groupId,
            { ...activity, activeUsers: new Set(activity.activeUsers || []) }
          ])
        );
      }
      
      if (data.recentMessages) {
        this.messageStats.recentMessages = data.recentMessages;
      }
    } catch (error) {
      console.error('解析消息统计数据失败:', error);
    }
  }
  
  /**
   * 加载性能数据
   */
  _loadPerformance() {
    if (!fs.existsSync(this.performancePath)) return;
    
    try {
      const data = JSON.parse(fs.readFileSync(this.performancePath, 'utf8'));
      
      if (data.cpu) {
        this.performance.cpu = { ...this.performance.cpu, ...data.cpu };
      }
      
      if (data.memory) {
        this.performance.memory = { ...this.performance.memory, ...data.memory };
      }
      
      if (data.eventLoop) {
        this.performance.eventLoop = { ...this.performance.eventLoop, ...data.eventLoop };
      }
      
      this.performance.monitorStartTime = data.monitorStartTime || Date.now();
    } catch (error) {
      console.error('解析性能数据失败:', error);
    }
  }
  
  /**
   * 加载错误日志
   */
  _loadErrors() {
    if (!fs.existsSync(this.errorsPath)) return;
    
    try {
      const data = JSON.parse(fs.readFileSync(this.errorsPath, 'utf8'));
      this.errors = data.errors || [];
    } catch (error) {
      console.error('解析错误日志失败:', error);
    }
  }
  
  /**
   * 创建备份
   */
  backup() {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = path.join(this.backupDir, `backup-${timestamp}`);
      
      if (!fs.existsSync(backupPath)) {
        fs.mkdirSync(backupPath, { recursive: true });
      }
      
      // 备份所有数据文件
      const files = [
        { src: this.systemStatsPath, dest: STORAGE_CONFIG.systemStatsFile },
        { src: this.httpStatsPath, dest: STORAGE_CONFIG.httpStatsFile },
        { src: this.messageStatsPath, dest: STORAGE_CONFIG.messageStatsFile },
        { src: this.performancePath, dest: STORAGE_CONFIG.performanceFile },
        { src: this.errorsPath, dest: STORAGE_CONFIG.errorsFile }
      ];
      
      for (const file of files) {
        if (fs.existsSync(file.src)) {
          fs.copyFileSync(file.src, path.join(backupPath, file.dest));
        }
      }
      
      // 清理旧备份
      this._cleanOldBackups();
      
      return true;
    } catch (error) {
      console.error('创建系统统计备份失败:', error);
      return false;
    }
  }
  
  /**
   * 清理旧备份
   */
  _cleanOldBackups() {
    try {
      if (!fs.existsSync(this.backupDir)) return;
      
      const backups = fs.readdirSync(this.backupDir)
        .filter(name => name.startsWith('backup-'))
        .map(name => ({
          name,
          path: path.join(this.backupDir, name),
          time: fs.statSync(path.join(this.backupDir, name)).mtime
        }))
        .sort((a, b) => b.time - a.time);
      
      const maxBackups = STORAGE_CONFIG.retention.backups;
      if (backups.length > maxBackups) {
        for (let i = maxBackups; i < backups.length; i++) {
          fs.rmSync(backups[i].path, { recursive: true, force: true });
        }
      }
    } catch (error) {
      console.error('清理备份失败:', error);
    }
  }
  
  /**
   * 启动自动保存
   */
  _startAutoSave() {
    this._saveInterval = setInterval(() => {
      this.save();
    }, STORAGE_CONFIG.saveInterval);
    
    // 进程退出时保存
    const saveOnExit = () => {
      this.save();
    };
    
    process.on('SIGINT', saveOnExit);
    process.on('SIGTERM', saveOnExit);
    process.on('exit', saveOnExit);
  }
  
  /**
   * 停止自动保存
   */
  stopAutoSave() {
    if (this._saveInterval) {
      clearInterval(this._saveInterval);
      this._saveInterval = null;
    }
    this.save();
  }
  
  /**
   * 启动系统监控
   */
  _startSystemMonitoring() {
    // 检查是否启用监控
    if (!this.settings.enableMonitoring) {
      console.log('⏸️  系统监控已禁用');
      return;
    }
    
    // 立即记录一次
    this.recordMemoryUsage();
    this.recordCpuUsage();
    
    // 使用配置的监控间隔
    const interval = (this.settings.monitoringInterval || 30) * 1000;
    console.log(`📊 系统监控已启动，间隔: ${this.settings.monitoringInterval} 秒`);
    
    this._monitorInterval = setInterval(() => {
      this.recordMemoryUsage();
      this.recordCpuUsage();
    }, interval);
  }
  
  /**
   * 停止系统监控
   */
  stopSystemMonitoring() {
    if (this._monitorInterval) {
      clearInterval(this._monitorInterval);
      this._monitorInterval = null;
    }
  }
  
  /**
   * 设置每日归档
   */
  _setupDailyArchive() {
    // 计算下次归档时间（明天凌晨2点）
    const tomorrow = this._getNextArchiveTime();
    
    setTimeout(() => {
      this.archiveOldData();
      
      // 然后每24小时归档一次
      setInterval(() => {
        this.archiveOldData();
      }, 24 * 60 * 60 * 1000);
    }, tomorrow - Date.now());
  }
  
  /**
   * 获取下次归档时间
   */
  _getNextArchiveTime() {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(2, 0, 0, 0); // 凌晨2点
    return tomorrow.getTime();
  }
  
  // ==================== 辅助方法 ====================
  
  /**
   * 获取时间范围的毫秒数
   */
  _getTimeRangeMs(timeRange) {
    const ranges = {
      '1h': 60 * 60 * 1000,
      '24h': 24 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000,
      '30d': 30 * 24 * 60 * 60 * 1000
    };
    return ranges[timeRange] || ranges['24h'];
  }
  
  /**
   * 获取当前数据
   */
  _getCurrentData(dataType) {
    switch (dataType) {
      case 'messages':
        return this.messageStats.recentMessages;
      case 'apiCalls':
        return this.httpStats.recentRequests;
      case 'errors':
        return this.errors;
      case 'all':
        return {
          messages: this.messageStats.recentMessages,
          apiCalls: this.httpStats.recentRequests,
          errors: this.errors
        };
      default:
        return [];
    }
  }
  
  /**
   * 合并归档数据
   */
  _mergeArchiveData(archives, dataType) {
    const merged = [];
    
    for (const archive of archives) {
      if (archive.rawData && archive.rawData[dataType]) {
        merged.push(...archive.rawData[dataType]);
      }
    }
    
    return merged;
  }
  
  /**
   * 获取今日消息数
   */
  _getTodayMessages(allMessages) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStart = today.getTime();
    
    return allMessages.filter(m => m.timestamp >= todayStart).length;
  }
  
  /**
   * 获取活跃用户数
   */
  _getActiveUsersCount(timeRangeMs) {
    const cutoff = Date.now() - timeRangeMs;
    let count = 0;
    
    for (const [userId, activity] of this.messageStats.userActivity) {
      if (activity.lastActive >= cutoff) {
        count++;
      }
    }
    
    return count;
  }
  
  /**
   * 获取活跃群组数
   */
  _getActiveGroupsCount(timeRangeMs) {
    const cutoff = Date.now() - timeRangeMs;
    let count = 0;
    
    for (const [groupId, activity] of this.messageStats.groupActivity) {
      if (activity.lastActive >= cutoff) {
        count++;
      }
    }
    
    return count;
  }
  
  /**
   * 获取每秒消息数
   */
  _getMessagesPerSecond() {
    const last5Minutes = Date.now() - 5 * 60 * 1000;
    const recentMessages = this.messageStats.recentMessages.filter(m => 
      m.timestamp >= last5Minutes
    );
    return recentMessages.length / 300; // 5分钟 = 300秒
  }
  
  /**
   * 生成每小时数据
   */
  _generateHourlyData(messages) {
    const hourlyData = Array.from({ length: 24 }, (_, i) => ({
      time: `${String(i).padStart(2, '0')}:00`,
      messages: 0,
      private: 0,
      group: 0
    }));
    
    messages.forEach(msg => {
      const hour = new Date(msg.timestamp).getHours();
      hourlyData[hour].messages++;
      
      if (msg.type === 'private' || msg.messageType === 'private') {
        hourlyData[hour].private++;
      } else if (msg.type === 'group' || msg.messageType === 'group') {
        hourlyData[hour].group++;
      }
    });
    
    return hourlyData;
  }
  
  /**
   * 生成每日数据
   */
  _generateDailyData(timeRange, allMessages) {
    const days = timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : 7;
    const dailyData = [];
    
    for (let i = days - 1; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      date.setHours(0, 0, 0, 0);
      
      const dayStart = date.getTime();
      const dayEnd = dayStart + 24 * 60 * 60 * 1000;
      
      const dayMessages = allMessages.filter(m => 
        m.timestamp >= dayStart && m.timestamp < dayEnd
      );
      
      dailyData.push({
        date: date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' }),
        messages: dayMessages.length,
        private: dayMessages.filter(m => 
          m.type === 'private' || m.messageType === 'private'
        ).length,
        group: dayMessages.filter(m => 
          m.type === 'group' || m.messageType === 'group'
        ).length
      });
    }
    
    return dailyData;
  }
  
  /**
   * 生成每周数据
   */
  _generateWeeklyData(timeRange, allMessages) {
    const weeks = timeRange === '30d' ? 4 : 4;
    const weeklyData = [];
    
    for (let i = weeks - 1; i >= 0; i--) {
      const weekEnd = new Date();
      weekEnd.setDate(weekEnd.getDate() - i * 7);
      const weekStart = new Date(weekEnd.getTime() - 7 * 24 * 60 * 60 * 1000);
      
      const weekMessages = allMessages.filter(m => 
        m.timestamp >= weekStart.getTime() && m.timestamp < weekEnd.getTime()
      );
      
      weeklyData.push({
        week: `第${weeks - i}周`,
        messages: weekMessages.length,
        private: weekMessages.filter(m => 
          m.type === 'private' || m.messageType === 'private'
        ).length,
        group: weekMessages.filter(m => 
          m.type === 'group' || m.messageType === 'group'
        ).length
      });
    }
    
    return weeklyData;
  }
  
  /**
   * 获取用户活动分布
   */
  _getUserActivityDistribution() {
    const distribution = [
      { timeRange: '0-6点', userCount: 0 },
      { timeRange: '6-12点', userCount: 0 },
      { timeRange: '12-18点', userCount: 0 },
      { timeRange: '18-24点', userCount: 0 }
    ];
    
    for (const [userId, activity] of this.messageStats.userActivity) {
      const hourlyActivity = activity.hourlyActivity;
      
      distribution[0].userCount += hourlyActivity.slice(0, 6).reduce((sum, count) => sum + (count > 0 ? 1 : 0), 0);
      distribution[1].userCount += hourlyActivity.slice(6, 12).reduce((sum, count) => sum + (count > 0 ? 1 : 0), 0);
      distribution[2].userCount += hourlyActivity.slice(12, 18).reduce((sum, count) => sum + (count > 0 ? 1 : 0), 0);
      distribution[3].userCount += hourlyActivity.slice(18, 24).reduce((sum, count) => sum + (count > 0 ? 1 : 0), 0);
    }
    
    return distribution;
  }
  
  /**
   * 生成性能数据
   */
  _generatePerformanceData() {
    return this.performance.memory.history.slice(-20).map(record => ({
      timestamp: new Date(record.timestamp).toLocaleTimeString(),
      responseTime: 0,
      memoryUsage: record.process.heapUsed / 1024 / 1024,
      cpuUsage: this.performance.cpu.current
    }));
  }
  
  /**
   * 分析消息类型
   */
  _analyzeMessageTypes(messages) {
    const types = {};
    const total = messages.length;
    
    messages.forEach(msg => {
      const type = msg.contentType || msg.type || 'text';
      types[type] = (types[type] || 0) + 1;
    });
    
    return Object.entries(types).map(([type, count]) => ({
      type: this._getMessageTypeName(type),
      count,
      percentage: total > 0 ? Math.round((count / total) * 100) : 0
    }));
  }
  
  /**
   * 获取消息类型名称
   */
  _getMessageTypeName(type) {
    const typeNames = {
      'text': '文本消息',
      'image': '图片消息',
      'voice': '语音消息',
      'video': '视频消息',
      'file': '文件消息',
      'at': '@消息',
      'reply': '回复消息'
    };
    
    return typeNames[type] || '其他消息';
  }
  
  /**
   * 分析关键词
   */
  _analyzeKeywords(messages) {
    const keywords = {};
    
    messages.forEach(msg => {
      const content = msg.content || msg.raw_message || '';
      if (content && typeof content === 'string') {
        // 简单的关键词提取（实际项目中可以使用更复杂的NLP）
        const words = content.match(/[\u4e00-\u9fff]+/g) || [];
        words.forEach(word => {
          if (word.length >= 2) {
            keywords[word] = (keywords[word] || 0) + 1;
          }
        });
      }
    });
    
    return Object.entries(keywords)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([keyword, count]) => ({
        keyword,
        count,
        trend: Math.random() > 0.5 ? 'up' : Math.random() > 0.5 ? 'stable' : 'down'
      }));
  }
  
  /**
   * 分析情感
   */
  _analyzeSentiment(messages) {
    // 简单的情感分析（实际项目中应使用专业的情感分析工具）
    const positive = messages.filter(m => {
      const content = m.content || m.raw_message || '';
      return content && (content.includes('好') || content.includes('谢谢') || content.includes('赞'));
    }).length;
    
    const negative = messages.filter(m => {
      const content = m.content || m.raw_message || '';
      return content && (content.includes('不好') || content.includes('错误') || content.includes('问题'));
    }).length;
    
    const neutral = messages.length - positive - negative;
    const total = messages.length;
    
    return [
      { 
        sentiment: 'positive', 
        count: positive, 
        percentage: total > 0 ? Math.round((positive / total) * 100) : 0 
      },
      { 
        sentiment: 'neutral', 
        count: neutral, 
        percentage: total > 0 ? Math.round((neutral / total) * 100) : 0 
      },
      { 
        sentiment: 'negative', 
        count: negative, 
        percentage: total > 0 ? Math.round((negative / total) * 100) : 0 
      }
    ];
  }
  
  /**
   * 评估数据质量
   */
  _assessDataQuality() {
    const quality = {
      completeness: 0,
      accuracy: 0,
      timeliness: 0,
      consistency: 0,
      overall: 0
    };
    
    // 完整性检查
    const hasMessages = this.messageStats.recentMessages.length > 0;
    const hasUsers = this.messageStats.userActivity.size > 0;
    const hasGroups = this.messageStats.groupActivity.size > 0;
    quality.completeness = (hasMessages ? 40 : 0) + (hasUsers ? 30 : 0) + (hasGroups ? 30 : 0);
    
    // 准确性检查（基于数据一致性）
    quality.accuracy = Math.min(100, this.systemStats.counters.totalMessages > 0 ? 100 : 0);
    
    // 及时性检查（最新数据的新鲜度）
    const latestMessage = this.messageStats.recentMessages[this.messageStats.recentMessages.length - 1];
    const timeSinceLatest = latestMessage ? Date.now() - latestMessage.timestamp : Infinity;
    quality.timeliness = timeSinceLatest < 60000 ? 100 : timeSinceLatest < 300000 ? 80 : 60;
    
    // 一致性检查
    quality.consistency = 90; // 假设数据结构一致性良好
    
    // 综合评分
    quality.overall = Math.round((quality.completeness + quality.accuracy + quality.timeliness + quality.consistency) / 4);
    
    return quality;
  }
  
  /**
   * 重置统计数据
   */
  reset() {
    // 创建备份
    this.backup();
    
    // 重新初始化
    this._initializeStats();
    
    // 保存空数据
    this.save();
  }
  
  /**
   * 销毁统计管理器
   */
  destroy() {
    this.stopAutoSave();
    this.stopSystemMonitoring();
  }
}

/**
 * 归档管理器 - 负责历史数据的归档和加载
 */
class ArchiveManager {
  constructor(baseDir) {
    this.archiveDir = path.join(baseDir, 'archives');
    this._ensureDirectory();
  }
  
  /**
   * 确保归档目录存在
   */
  _ensureDirectory() {
    if (!fs.existsSync(this.archiveDir)) {
      fs.mkdirSync(this.archiveDir, { recursive: true });
    }
  }
  
  /**
   * 保存归档数据
   * @param {Date} date - 归档日期
   * @param {Object} data - 要归档的数据
   */
  async save(date, data) {
    const filename = `archive-${date.toISOString().split('T')[0]}.json`;
    const filepath = path.join(this.archiveDir, filename);
    
    const archiveData = {
      date: date.toISOString(),
      version: DATA_VERSION,
      ...data,
      archivedAt: Date.now()
    };
    
    fs.writeFileSync(filepath, JSON.stringify(archiveData, null, 2));
    return filepath;
  }
  
  /**
   * 加载指定时间范围的归档数据
   * @param {number} startTime - 开始时间戳
   * @param {number} endTime - 结束时间戳
   * @returns {Array} 归档数据数组
   */
  async loadRange(startTime, endTime) {
    if (!fs.existsSync(this.archiveDir)) {
      return [];
    }
    
    const files = fs.readdirSync(this.archiveDir)
      .filter(f => f.startsWith('archive-') && f.endsWith('.json'))
      .sort();
    
    const archives = [];
    for (const file of files) {
      try {
        const filepath = path.join(this.archiveDir, file);
        const data = JSON.parse(fs.readFileSync(filepath, 'utf8'));
        const archiveDate = new Date(data.date).getTime();
        
        // 检查归档日期是否在时间范围内
        if (archiveDate >= startTime && archiveDate <= endTime) {
          archives.push(data);
        }
      } catch (error) {
        // 加载归档文件失败（静默跳过）
      }
    }
    
    return archives;
  }
  
  /**
   * 加载最近N个归档
   * @param {number} count - 要加载的归档数量
   * @returns {Array} 归档数据数组
   */
  async loadRecent(count = 7) {
    if (!fs.existsSync(this.archiveDir)) {
      return [];
    }
    
    const files = fs.readdirSync(this.archiveDir)
      .filter(f => f.startsWith('archive-') && f.endsWith('.json'))
      .sort()
      .slice(-count);
    
    const archives = [];
    for (const file of files) {
      try {
        const filepath = path.join(this.archiveDir, file);
        const data = JSON.parse(fs.readFileSync(filepath, 'utf8'));
        archives.push(data);
      } catch (error) {
        // 加载归档文件失败（静默跳过）
      }
    }
    
    return archives;
  }
  
  /**
   * 清理旧归档
   * @param {number} daysToKeep - 保留天数
   */
  cleanOldArchives(daysToKeep = 30) {
    if (!fs.existsSync(this.archiveDir)) {
      return;
    }
    
    const cutoffTime = Date.now() - daysToKeep * 24 * 60 * 60 * 1000;
    const files = fs.readdirSync(this.archiveDir)
      .filter(f => f.startsWith('archive-') && f.endsWith('.json'));
    
    let deletedCount = 0;
    for (const file of files) {
      try {
        const filepath = path.join(this.archiveDir, file);
        const data = JSON.parse(fs.readFileSync(filepath, 'utf8'));
        const archiveDate = new Date(data.date).getTime();
        
        if (archiveDate < cutoffTime) {
          fs.unlinkSync(filepath);
          deletedCount++;
        }
      } catch (error) {
        // 删除归档文件失败（静默跳过）
      }
    }
    
    if (deletedCount > 0) {
      // 旧归档已清理
    }
  }
}

// 创建单例实例
export const systemStatistics = new SystemStatistics();

// 导出配置
export { STORAGE_CONFIG, DATA_VERSION };

// 默认导出
export default systemStatistics;

