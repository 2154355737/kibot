/**
 * KiBot 插件统计数据管理模块
 * 提供统一的插件统计数据收集、存储、查询和持久化功能
 * 
 * 核心设计原则：
 * 1. 统一的数据结构和接口
 * 2. 自动化的数据持久化
 * 3. 完善的数据验证和迁移
 * 4. 高性能的数据存取
 * 
 * @module plugin-statistics
 * @version 1.0.0
 * @author KiBot Team
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 数据版本号 - 用于数据迁移
const DATA_VERSION = '1.0.0';

// 数据存储路径配置
const STORAGE_CONFIG = {
  // 插件数据根目录
  baseDir: path.join(__dirname, '../../data/plugins'),
  
  // 统计数据文件名
  statsFile: 'statistics.json',
  
  // 性能数据文件名
  performanceFile: 'performance.json',
  
  // 错误日志文件名
  errorsFile: 'errors.json',
  
  // 备份目录
  backupDir: 'backups',
  
  // 数据保存间隔（毫秒）
  saveInterval: 5 * 60 * 1000, // 5分钟
  
  // 数据保留策略
  retention: {
    errors: 100,           // 保留最近100个错误
    memoryRecords: 100,    // 保留最近100条内存记录
    executionRecords: 10,  // 每个命令/事件/任务保留最近10次执行记录
    backups: 5             // 保留最近5个备份
  }
};

/**
 * 插件统计数据管理器
 * 负责单个插件的所有统计数据
 */
export class PluginStatistics {
  constructor(pluginId, storageProvider = null) {
    this.pluginId = pluginId;
    this.storageProvider = storageProvider; // 可选的自定义存储提供者
    
    // 数据存储路径
    this.dataDir = path.join(STORAGE_CONFIG.baseDir, pluginId);
    this.statsPath = path.join(this.dataDir, STORAGE_CONFIG.statsFile);
    this.performancePath = path.join(this.dataDir, STORAGE_CONFIG.performanceFile);
    this.errorsPath = path.join(this.dataDir, STORAGE_CONFIG.errorsFile);
    this.backupDir = path.join(this.dataDir, STORAGE_CONFIG.backupDir);
    
    // 确保目录存在
    this._ensureDirectories();
    
    // 初始化统计数据结构
    this._initializeStats();
    
    // 启动自动保存
    this._startAutoSave();
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
    // 基础统计数据
    this.stats = {
      commandExecutions: 0,      // 指令执行总次数
      eventHandled: 0,          // 事件处理总次数
      tasksExecuted: 0,         // 任务执行总次数
      errorsOccurred: 0,        // 错误发生总次数
      lastActivity: Date.now(), // 最后活动时间
      version: DATA_VERSION,    // 数据版本
      timestamp: Date.now()     // 最后保存时间
    };
    
    // 命令执行详细统计
    this.commandStats = new Map(); // key: commandName, value: CommandStats
    
    // 任务执行详细统计
    this.taskStats = new Map(); // key: taskName, value: TaskStats
    
    // 性能监控数据
    this.performance = {
      commandPerformance: new Map(), // key: commandName, value: PerformanceMetric
      eventPerformance: new Map(),   // key: eventType, value: PerformanceMetric
      taskPerformance: new Map(),    // key: taskName, value: PerformanceMetric
      memoryUsage: [],               // MemoryRecord[]
      cpuUsage: [],                  // CpuRecord[]
      outputLogs: [],                // OutputLog[]
      monitorStartTime: Date.now(),
      dataVersion: DATA_VERSION
    };
    
    // 错误记录
    this.errors = [];
    
    // 异步并发监控
    this.asyncSafety = {
      concurrentOperations: 0,
      maxConcurrentOperations: 0,
      warnings: [],
      _locked: false
    };
    
    // 加载持久化数据
    this.load();
  }
  
  // ==================== 统计数据更新方法 ====================
  
  /**
   * 增加指令执行次数
   * @param {string} commandName - 指令名称
   * @param {Object} metadata - 执行元数据
   */
  incrementCommandExecutions(commandName = null, metadata = {}) {
    this.stats.commandExecutions++;
    this.stats.lastActivity = Date.now();
    
    if (commandName) {
      if (!this.commandStats.has(commandName)) {
        this.commandStats.set(commandName, {
          name: commandName,
          executionCount: 0,
          lastExecuted: null,
          lastError: null,
          registeredAt: Date.now(),
          metadata: {}
        });
      }
      
      const cmdStats = this.commandStats.get(commandName);
      cmdStats.executionCount++;
      cmdStats.lastExecuted = Date.now();
      if (metadata) {
        cmdStats.metadata = { ...cmdStats.metadata, ...metadata };
      }
    }
  }
  
  /**
   * 增加事件处理次数
   * @param {string} eventType - 事件类型
   */
  incrementEventHandled(eventType = null) {
    this.stats.eventHandled++;
    this.stats.lastActivity = Date.now();
  }
  
  /**
   * 增加任务执行次数
   * @param {string} taskName - 任务名称
   * @param {Object} metadata - 执行元数据
   */
  incrementTasksExecuted(taskName = null, metadata = {}) {
    this.stats.tasksExecuted++;
    this.stats.lastActivity = Date.now();
    
    if (taskName) {
      if (!this.taskStats.has(taskName)) {
        this.taskStats.set(taskName, {
          name: taskName,
          executionCount: 0,
          lastExecuted: null,
          lastError: null,
          registeredAt: Date.now(),
          metadata: {}
        });
      }
      
      const taskSt = this.taskStats.get(taskName);
      taskSt.executionCount++;
      taskSt.lastExecuted = Date.now();
      if (metadata) {
        taskSt.metadata = { ...taskSt.metadata, ...metadata };
      }
    }
  }
  
  /**
   * 增加错误次数
   */
  incrementErrorsOccurred() {
    this.stats.errorsOccurred++;
    this.stats.lastActivity = Date.now();
  }
  
  // ==================== 性能数据记录方法 ====================
  
  /**
   * 记录性能数据
   * @param {string} type - 类型 ('command' | 'event' | 'task')
   * @param {string} name - 名称
   * @param {number} duration - 持续时间（毫秒）
   * @param {boolean} success - 是否成功
   */
  recordPerformance(type, name, duration, success = true) {
    // 数据验证
    if (typeof duration !== 'number' || isNaN(duration) || duration < 0) {
      console.warn(`[${this.pluginId}] 无效的性能数据: ${type}.${name}, duration=${duration}`);
      return;
    }
    
    // 异常检测
    if (duration > 60000) {
      console.warn(`[${this.pluginId}] 检测到异常长执行时间: ${type}.${name} = ${duration}ms`);
    }
    
    // 选择对应的性能数据映射
    let perfMap = this.performance.commandPerformance;
    if (type === 'event') perfMap = this.performance.eventPerformance;
    if (type === 'task') perfMap = this.performance.taskPerformance;
    
    // 初始化性能指标
    if (!perfMap.has(name)) {
      perfMap.set(name, {
        totalExecutions: 0,
        successfulExecutions: 0,
        failedExecutions: 0,
        totalDuration: 0,
        minDuration: Infinity,
        maxDuration: 0,
        avgDuration: 0,
        lastExecutions: [],
        firstRecordTime: Date.now(),
        _dataIntegrity: true
      });
    }
    
    // 更新性能指标
    const perf = perfMap.get(name);
    perf.totalExecutions++;
    if (success) {
      perf.successfulExecutions++;
    } else {
      perf.failedExecutions++;
    }
    
    perf.totalDuration += duration;
    perf.minDuration = Math.min(perf.minDuration, duration);
    perf.maxDuration = Math.max(perf.maxDuration, duration);
    perf.avgDuration = perf.totalDuration / perf.totalExecutions;
    
    // 记录最近执行
    perf.lastExecutions.push({
      timestamp: Date.now(),
      duration,
      success,
      _verified: true
    });
    
    // 只保留配置的记录数量
    const maxRecords = STORAGE_CONFIG.retention.executionRecords;
    if (perf.lastExecutions.length > maxRecords) {
      perf.lastExecutions = perf.lastExecutions.slice(-maxRecords);
    }
  }
  
  /**
   * 记录内存使用情况
   */
  recordMemoryUsage() {
    try {
      const memUsage = process.memoryUsage();
      const timestamp = Date.now();
      
      // 数据完整性检查
      if (this.performance.memoryUsage.length > 0) {
        const lastRecord = this.performance.memoryUsage[this.performance.memoryUsage.length - 1];
        if (timestamp <= lastRecord.timestamp) {
          return; // 时间戳未增加，跳过本次记录
        }
      }
      
      this.performance.memoryUsage.push({
        timestamp,
        heapUsed: memUsage.heapUsed,
        heapTotal: memUsage.heapTotal,
        external: memUsage.external,
        rss: memUsage.rss,
        _verified: true
      });
      
      // 只保留配置的记录数量
      const maxRecords = STORAGE_CONFIG.retention.memoryRecords;
      if (this.performance.memoryUsage.length > maxRecords) {
        this.performance.memoryUsage = this.performance.memoryUsage.slice(-maxRecords);
      }
    } catch (error) {
      console.error(`[${this.pluginId}] 内存监控采样失败:`, error);
    }
  }
  
  /**
   * 记录输出日志
   * @param {string} level - 日志级别
   * @param {string} message - 日志消息
   * @param {Object} metadata - 元数据
   */
  recordOutput(level, message, metadata = {}) {
    const output = {
      timestamp: Date.now(),
      level,
      message,
      metadata,
      isValid: this._validateOutputFormat(level, message)
    };
    
    this.performance.outputLogs.push(output);
    
    // 只保留最近50条
    if (this.performance.outputLogs.length > 50) {
      this.performance.outputLogs.shift();
    }
  }
  
  /**
   * 验证输出格式
   */
  _validateOutputFormat(level, message) {
    const validLevels = ['info', 'warn', 'error', 'debug'];
    if (!validLevels.includes(level)) return false;
    if (typeof message !== 'string' || message.trim() === '') return false;
    if (message.length > 1000) return false;
    return true;
  }
  
  // ==================== 错误记录方法 ====================
  
  /**
   * 记录错误
   * @param {string} type - 错误类型
   * @param {string} source - 错误来源
   * @param {Error|string} error - 错误对象或消息
   */
  recordError(type, source, error) {
    const errorInfo = {
      type,
      source,
      message: error?.message || String(error),
      stack: error?.stack || new Error().stack,
      timestamp: Date.now(),
      pluginId: this.pluginId
    };
    
    this.errors.push(errorInfo);
    this.incrementErrorsOccurred();
    
    // 只保留配置的错误数量
    const maxErrors = STORAGE_CONFIG.retention.errors;
    if (this.errors.length > maxErrors) {
      this.errors = this.errors.slice(-maxErrors);
    }
    
    // 如果是命令或任务错误，更新对应的统计
    if (type === 'command' && this.commandStats.has(source)) {
      const cmdStats = this.commandStats.get(source);
      cmdStats.lastError = {
        message: errorInfo.message,
        timestamp: errorInfo.timestamp
      };
    } else if (type === 'task' && this.taskStats.has(source)) {
      const taskSt = this.taskStats.get(source);
      taskSt.lastError = {
        message: errorInfo.message,
        timestamp: errorInfo.timestamp
      };
    }
  }
  
  // ==================== 异步并发监控 ====================
  
  /**
   * 检查异步并发安全
   */
  checkAsyncSafety() {
    if (this.asyncSafety._locked) return;
    
    try {
      this.asyncSafety._locked = true;
      
      // 数据验证
      if (this.asyncSafety.concurrentOperations < 0) {
        this.asyncSafety.concurrentOperations = 0;
      }
      
      // 更新最大值
      if (this.asyncSafety.concurrentOperations > this.asyncSafety.maxConcurrentOperations) {
        this.asyncSafety.maxConcurrentOperations = this.asyncSafety.concurrentOperations;
      }
      
      // 并发警告
      if (this.asyncSafety.concurrentOperations > 10) {
        const timestamp = Date.now();
        const lastWarning = this.asyncSafety.warnings[this.asyncSafety.warnings.length - 1];
        
        if (!lastWarning || timestamp - lastWarning.timestamp > 1000) {
          this.asyncSafety.warnings.push({
            timestamp,
            concurrentOperations: this.asyncSafety.concurrentOperations,
            message: 'High concurrent async operations detected',
            _verified: true
          });
          
          if (this.asyncSafety.warnings.length > 20) {
            this.asyncSafety.warnings.shift();
          }
        }
      }
    } finally {
      this.asyncSafety._locked = false;
    }
  }
  
  /**
   * 增加并发操作计数
   */
  incrementConcurrentOperations() {
    this.asyncSafety.concurrentOperations++;
    this.checkAsyncSafety();
  }
  
  /**
   * 减少并发操作计数
   */
  decrementConcurrentOperations() {
    this.asyncSafety.concurrentOperations--;
    this.checkAsyncSafety();
  }
  
  // ==================== 数据查询方法 ====================
  
  /**
   * 获取基础统计数据
   */
  getStats() {
    return {
      ...this.stats,
      timestamp: Date.now()
    };
  }
  
  /**
   * 获取命令统计详情
   */
  getCommandStats() {
    return Array.from(this.commandStats.values());
  }
  
  /**
   * 获取任务统计详情
   */
  getTaskStats() {
    return Array.from(this.taskStats.values());
  }
  
  /**
   * 获取性能数据
   */
  getPerformanceData() {
    return {
      commandPerformance: Object.fromEntries(this.performance.commandPerformance),
      eventPerformance: Object.fromEntries(this.performance.eventPerformance),
      taskPerformance: Object.fromEntries(this.performance.taskPerformance),
      memoryUsage: this.performance.memoryUsage.slice(-20), // 最近20条
      outputLogs: this.performance.outputLogs.slice(-20),
      invalidOutputCount: this.performance.outputLogs.filter(log => !log.isValid).length,
      totalOutputCount: this.performance.outputLogs.length,
      avgExecutionTime: this.calculateAvgExecutionTime(),
      monitorStartTime: this.performance.monitorStartTime,
      dataVersion: this.performance.dataVersion
    };
  }
  
  /**
   * 计算平均执行时间
   */
  calculateAvgExecutionTime() {
    const allPerformance = [
      ...Array.from(this.performance.commandPerformance.values()),
      ...Array.from(this.performance.eventPerformance.values()),
      ...Array.from(this.performance.taskPerformance.values())
    ];
    
    if (allPerformance.length === 0) return 0;
    
    const totalDuration = allPerformance.reduce((sum, perf) => sum + perf.totalDuration, 0);
    const totalExecutions = allPerformance.reduce((sum, perf) => sum + perf.totalExecutions, 0);
    
    return totalExecutions > 0 ? totalDuration / totalExecutions : 0;
  }
  
  /**
   * 获取错误列表
   * @param {number} limit - 限制数量
   */
  getErrors(limit = 10) {
    return this.errors.slice(-limit);
  }
  
  /**
   * 获取异步安全状态
   */
  getAsyncSafetyStatus() {
    const lastWarning = this.asyncSafety.warnings[this.asyncSafety.warnings.length - 1];
    return {
      concurrentOperations: this.asyncSafety.concurrentOperations,
      maxConcurrentOperations: this.asyncSafety.maxConcurrentOperations,
      warnings: this.asyncSafety.warnings.slice(-10),
      isHealthy: this.asyncSafety.warnings.length === 0 || 
                 (Date.now() - (lastWarning?.timestamp || 0) > 60000)
    };
  }
  
  /**
   * 获取完整的详细信息
   */
  getDetailedInfo() {
    return {
      statistics: this.getStats(),
      commands: this.getCommandStats(),
      tasks: this.getTaskStats(),
      performance: this.getPerformanceData(),
      errors: this.getErrors(10),
      asyncSafety: this.getAsyncSafetyStatus()
    };
  }
  
  // ==================== 数据持久化方法 ====================
  
  /**
   * 保存所有统计数据
   */
  save() {
    try {
      // 更新时间戳
      this.stats.timestamp = Date.now();
      
      // 保存基础统计数据
      this._saveStats();
      
      // 保存性能数据
      this._savePerformance();
      
      // 保存错误日志
      this._saveErrors();
      
      return true;
    } catch (error) {
      console.error(`[${this.pluginId}] 保存统计数据失败:`, error);
      return false;
    }
  }
  
  /**
   * 保存基础统计数据
   */
  _saveStats() {
    const data = {
      ...this.stats,
      commands: Object.fromEntries(this.commandStats),
      tasks: Object.fromEntries(this.taskStats),
      asyncSafety: {
        maxConcurrentOperations: this.asyncSafety.maxConcurrentOperations,
        warnings: this.asyncSafety.warnings.slice(-20)
      }
    };
    
    fs.writeFileSync(this.statsPath, JSON.stringify(data, null, 2));
  }
  
  /**
   * 保存性能数据
   */
  _savePerformance() {
    const data = {
      commandPerformance: Object.fromEntries(this.performance.commandPerformance),
      eventPerformance: Object.fromEntries(this.performance.eventPerformance),
      taskPerformance: Object.fromEntries(this.performance.taskPerformance),
      memoryUsage: this.performance.memoryUsage,
      outputLogs: this.performance.outputLogs,
      monitorStartTime: this.performance.monitorStartTime,
      dataVersion: this.performance.dataVersion
    };
    
    fs.writeFileSync(this.performancePath, JSON.stringify(data, null, 2));
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
      this._loadStats();
      this._loadPerformance();
      this._loadErrors();
      return true;
    } catch (error) {
      console.error(`[${this.pluginId}] 加载统计数据失败:`, error);
      return false;
    }
  }
  
  /**
   * 加载基础统计数据
   */
  _loadStats() {
    if (!fs.existsSync(this.statsPath)) return;
    
    try {
      const data = JSON.parse(fs.readFileSync(this.statsPath, 'utf8'));
      
      // 恢复基础统计
      this.stats = {
        commandExecutions: data.commandExecutions || 0,
        eventHandled: data.eventHandled || 0,
        tasksExecuted: data.tasksExecuted || 0,
        errorsOccurred: data.errorsOccurred || 0,
        lastActivity: data.lastActivity || Date.now(),
        version: data.version || DATA_VERSION,
        timestamp: data.timestamp || Date.now()
      };
      
      // 恢复命令统计
      if (data.commands) {
        this.commandStats = new Map(Object.entries(data.commands));
      }
      
      // 恢复任务统计
      if (data.tasks) {
        this.taskStats = new Map(Object.entries(data.tasks));
      }
      
      // 恢复异步安全数据
      if (data.asyncSafety) {
        this.asyncSafety.maxConcurrentOperations = data.asyncSafety.maxConcurrentOperations || 0;
        this.asyncSafety.warnings = data.asyncSafety.warnings || [];
      }
    } catch (error) {
      console.error(`[${this.pluginId}] 解析统计数据失败:`, error);
    }
  }
  
  /**
   * 加载性能数据
   */
  _loadPerformance() {
    if (!fs.existsSync(this.performancePath)) return;
    
    try {
      const data = JSON.parse(fs.readFileSync(this.performancePath, 'utf8'));
      
      // 恢复性能数据
      if (data.commandPerformance) {
        this.performance.commandPerformance = new Map(Object.entries(data.commandPerformance));
      }
      if (data.eventPerformance) {
        this.performance.eventPerformance = new Map(Object.entries(data.eventPerformance));
      }
      if (data.taskPerformance) {
        this.performance.taskPerformance = new Map(Object.entries(data.taskPerformance));
      }
      
      this.performance.memoryUsage = data.memoryUsage || [];
      this.performance.outputLogs = data.outputLogs || [];
      this.performance.monitorStartTime = data.monitorStartTime || Date.now();
      this.performance.dataVersion = data.dataVersion || DATA_VERSION;
    } catch (error) {
      console.error(`[${this.pluginId}] 解析性能数据失败:`, error);
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
      console.error(`[${this.pluginId}] 解析错误日志失败:`, error);
    }
  }
  
  /**
   * 创建数据备份
   */
  backup() {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = path.join(this.backupDir, `backup-${timestamp}`);
      
      if (!fs.existsSync(backupPath)) {
        fs.mkdirSync(backupPath, { recursive: true });
      }
      
      // 备份所有数据文件
      if (fs.existsSync(this.statsPath)) {
        fs.copyFileSync(this.statsPath, path.join(backupPath, STORAGE_CONFIG.statsFile));
      }
      if (fs.existsSync(this.performancePath)) {
        fs.copyFileSync(this.performancePath, path.join(backupPath, STORAGE_CONFIG.performanceFile));
      }
      if (fs.existsSync(this.errorsPath)) {
        fs.copyFileSync(this.errorsPath, path.join(backupPath, STORAGE_CONFIG.errorsFile));
      }
      
      // 清理旧备份
      this._cleanOldBackups();
      
      return true;
    } catch (error) {
      console.error(`[${this.pluginId}] 创建备份失败:`, error);
      return false;
    }
  }
  
  /**
   * 清理旧备份
   */
  _cleanOldBackups() {
    try {
      const backups = fs.readdirSync(this.backupDir)
        .filter(name => name.startsWith('backup-'))
        .map(name => ({
          name,
          path: path.join(this.backupDir, name),
          time: fs.statSync(path.join(this.backupDir, name)).mtime
        }))
        .sort((a, b) => b.time - a.time);
      
      // 删除超过保留数量的备份
      const maxBackups = STORAGE_CONFIG.retention.backups;
      if (backups.length > maxBackups) {
        for (let i = maxBackups; i < backups.length; i++) {
          fs.rmSync(backups[i].path, { recursive: true, force: true });
        }
      }
    } catch (error) {
      console.error(`[${this.pluginId}] 清理备份失败:`, error);
    }
  }
  
  /**
   * 启动自动保存
   */
  _startAutoSave() {
    // 每隔指定时间自动保存
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
    
    // 最后保存一次
    this.save();
  }
  
  /**
   * 重置所有统计数据
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
  }
}

/**
 * 统计管理器工厂
 * 管理所有插件的统计实例
 */
export class StatisticsManager {
  constructor() {
    this.statistics = new Map(); // key: pluginId, value: PluginStatistics
  }
  
  /**
   * 获取或创建插件统计实例
   */
  getOrCreate(pluginId) {
    if (!this.statistics.has(pluginId)) {
      this.statistics.set(pluginId, new PluginStatistics(pluginId));
    }
    return this.statistics.get(pluginId);
  }
  
  /**
   * 获取插件统计实例
   */
  get(pluginId) {
    return this.statistics.get(pluginId);
  }
  
  /**
   * 移除插件统计实例
   */
  remove(pluginId) {
    const stats = this.statistics.get(pluginId);
    if (stats) {
      stats.destroy();
      this.statistics.delete(pluginId);
    }
  }
  
  /**
   * 保存所有插件的统计数据
   */
  saveAll() {
    for (const stats of this.statistics.values()) {
      stats.save();
    }
  }
  
  /**
   * 获取所有插件的统计摘要
   */
  getAllSummary() {
    const summary = [];
    for (const [pluginId, stats] of this.statistics.entries()) {
      summary.push({
        pluginId,
        ...stats.getStats()
      });
    }
    return summary;
  }
}

// 导出单例实例
export const statisticsManager = new StatisticsManager();

// 导出配置供外部使用
export { STORAGE_CONFIG, DATA_VERSION };

