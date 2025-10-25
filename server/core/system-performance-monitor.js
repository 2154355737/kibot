/**
 * KiBot系统性能监控器
 * 监控整个框架的性能指标
 */

import os from 'os';
import { EventEmitter } from 'events';
import { logger } from '../utils/output-manager.js';

export class SystemPerformanceMonitor extends EventEmitter {
  constructor() {
    super();
    
    // 系统信息
    this.systemInfo = {
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
      cpuCount: os.cpus().length,
      totalMemory: os.totalmem(),
      hostname: os.hostname(),
      startTime: Date.now()
    };
    
    // 性能指标
    this.metrics = {
      // CPU使用率
      cpu: {
        usage: [],
        avgUsage: 0,
        maxUsage: 0,
        lastCheck: Date.now()
      },
      
      // 内存使用
      memory: {
        process: [],      // 进程内存
        system: [],       // 系统内存
        lastCheck: Date.now()
      },
      
      // 事件循环延迟
      eventLoop: {
        delays: [],
        avgDelay: 0,
        maxDelay: 0,
        lastCheck: Date.now()
      },
      
      // HTTP请求统计
      http: {
        totalRequests: 0,
        activeRequests: 0,
        requestsByEndpoint: new Map(),
        responseTimeByEndpoint: new Map(),
        errorsByEndpoint: new Map(),
        requestsPerMinute: [],
        avgResponseTime: 0
      },
      
      // WebSocket连接统计
      websocket: {
        totalConnections: 0,
        activeConnections: 0,
        messagesSent: 0,
        messagesReceived: 0,
        connectionsByType: new Map(),
        avgLatency: 0,
        latencyHistory: []
      },
      
      // 事件引擎统计
      eventEngine: {
        eventsProcessed: 0,
        eventsPerMinute: [],
        processingTimeByType: new Map(),
        errorsByType: new Map(),
        avgProcessingTime: 0
      },
      
      // 数据库/文件IO
      io: {
        fileReads: 0,
        fileWrites: 0,
        dataReads: 0,
        dataWrites: 0,
        avgReadTime: 0,
        avgWriteTime: 0,
        ioHistory: []
      },
      
      // 错误统计
      errors: {
        total: 0,
        byType: new Map(),
        recent: [],
        errorRate: 0
      },
      
      // 性能告警
      alerts: []
    };
    
    // 监控配置
    this.config = {
      cpuThreshold: 80,           // CPU使用率告警阈值
      memoryThreshold: 85,        // 内存使用率告警阈值
      eventLoopDelayThreshold: 50,// 事件循环延迟告警阈值(ms)
      responseTimeThreshold: 1000,// 响应时间告警阈值(ms)
      errorRateThreshold: 5,      // 错误率告警阈值(%)
      historyLength: 100          // 历史数据保留条数
    };
    
    // 监控状态
    this.isRunning = false;
    this.intervals = {};
    
    // 上次CPU测量
    this.lastCpuUsage = process.cpuUsage();
    this.lastCpuTime = Date.now();
  }
  
  /**
   * 启动性能监控
   */
  start() {
    if (this.isRunning) {
      logger.warn('系统性能监控', '已在运行中');
      return;
    }
    
    this.isRunning = true;
    logger.success('系统性能监控', '已启动');
    
    // CPU和内存监控 - 每10秒
    this.intervals.systemMetrics = setInterval(() => {
      this.collectSystemMetrics();
    }, 10 * 1000);
    
    // 事件循环延迟监控 - 每5秒
    this.intervals.eventLoop = setInterval(() => {
      this.measureEventLoopDelay();
    }, 5 * 1000);
    
    // 请求统计汇总 - 每分钟
    this.intervals.requestStats = setInterval(() => {
      this.aggregateRequestStats();
    }, 60 * 1000);
    
    // 告警检查 - 每30秒
    this.intervals.alertCheck = setInterval(() => {
      this.checkAlerts();
    }, 30 * 1000);
    
    // 立即执行一次采集
    this.collectSystemMetrics();
    this.measureEventLoopDelay();
  }
  
  /**
   * 停止性能监控
   */
  stop() {
    if (!this.isRunning) {
      return;
    }
    
    this.isRunning = false;
    
    // 清理所有定时器
    Object.values(this.intervals).forEach(interval => {
      clearInterval(interval);
    });
    
    this.intervals = {};
    logger.info('系统性能监控', '已停止');
  }
  
  /**
   * 收集系统指标
   */
  collectSystemMetrics() {
    try {
      const timestamp = Date.now();
      
      // CPU使用率
      const cpuUsage = this.calculateCpuUsage();
      this.metrics.cpu.usage.push({
        timestamp,
        usage: cpuUsage,
        _verified: true
      });
      
      this.metrics.cpu.avgUsage = this.calculateAverage(
        this.metrics.cpu.usage.map(u => u.usage)
      );
      this.metrics.cpu.maxUsage = Math.max(this.metrics.cpu.maxUsage, cpuUsage);
      
      // 限制历史长度
      if (this.metrics.cpu.usage.length > this.config.historyLength) {
        this.metrics.cpu.usage.shift();
      }
      
      // 进程内存
      const processMemory = process.memoryUsage();
      this.metrics.memory.process.push({
        timestamp,
        heapUsed: processMemory.heapUsed,
        heapTotal: processMemory.heapTotal,
        rss: processMemory.rss,
        external: processMemory.external,
        _verified: true
      });
      
      // 系统内存
      const freeMemory = os.freemem();
      const totalMemory = os.totalmem();
      const usedMemory = totalMemory - freeMemory;
      const memoryUsagePercent = (usedMemory / totalMemory) * 100;
      
      this.metrics.memory.system.push({
        timestamp,
        total: totalMemory,
        free: freeMemory,
        used: usedMemory,
        usagePercent: memoryUsagePercent,
        _verified: true
      });
      
      // 限制历史长度
      if (this.metrics.memory.process.length > this.config.historyLength) {
        this.metrics.memory.process.shift();
      }
      if (this.metrics.memory.system.length > this.config.historyLength) {
        this.metrics.memory.system.shift();
      }
      
      this.metrics.cpu.lastCheck = timestamp;
      this.metrics.memory.lastCheck = timestamp;
      
    } catch (error) {
      logger.error('系统指标采集失败', error.message);
    }
  }
  
  /**
   * 计算CPU使用率
   */
  calculateCpuUsage() {
    const currentUsage = process.cpuUsage(this.lastCpuUsage);
    const currentTime = Date.now();
    const timeDiff = currentTime - this.lastCpuTime;
    
    // 计算CPU使用率（百分比）
    const userUsage = (currentUsage.user / 1000) / timeDiff * 100;
    const systemUsage = (currentUsage.system / 1000) / timeDiff * 100;
    const totalUsage = userUsage + systemUsage;
    
    this.lastCpuUsage = process.cpuUsage();
    this.lastCpuTime = currentTime;
    
    return Math.min(100, totalUsage); // 限制在0-100之间
  }
  
  /**
   * 测量事件循环延迟
   */
  measureEventLoopDelay() {
    const start = Date.now();
    
    setImmediate(() => {
      const delay = Date.now() - start;
      const timestamp = Date.now();
      
      this.metrics.eventLoop.delays.push({
        timestamp,
        delay,
        _verified: true
      });
      
      this.metrics.eventLoop.avgDelay = this.calculateAverage(
        this.metrics.eventLoop.delays.map(d => d.delay)
      );
      this.metrics.eventLoop.maxDelay = Math.max(
        this.metrics.eventLoop.maxDelay,
        delay
      );
      
      // 限制历史长度
      if (this.metrics.eventLoop.delays.length > this.config.historyLength) {
        this.metrics.eventLoop.delays.shift();
      }
      
      this.metrics.eventLoop.lastCheck = timestamp;
    });
  }
  
  /**
   * 记录HTTP请求
   */
  recordHttpRequest(endpoint, responseTime, success = true) {
    try {
      this.metrics.http.totalRequests++;
      
      // 按端点统计
      if (!this.metrics.http.requestsByEndpoint.has(endpoint)) {
        this.metrics.http.requestsByEndpoint.set(endpoint, {
          count: 0,
          errors: 0,
          totalTime: 0,
          avgTime: 0,
          minTime: Infinity,
          maxTime: 0
        });
      }
      
      const endpointStats = this.metrics.http.requestsByEndpoint.get(endpoint);
      endpointStats.count++;
      
      if (!success) {
        endpointStats.errors++;
        
        if (!this.metrics.http.errorsByEndpoint.has(endpoint)) {
          this.metrics.http.errorsByEndpoint.set(endpoint, 0);
        }
        this.metrics.http.errorsByEndpoint.set(
          endpoint,
          this.metrics.http.errorsByEndpoint.get(endpoint) + 1
        );
      }
      
      // 响应时间统计
      endpointStats.totalTime += responseTime;
      endpointStats.avgTime = endpointStats.totalTime / endpointStats.count;
      endpointStats.minTime = Math.min(endpointStats.minTime, responseTime);
      endpointStats.maxTime = Math.max(endpointStats.maxTime, responseTime);
      
      // 更新全局平均响应时间
      this.updateAvgResponseTime();
      
    } catch (error) {
      logger.error('HTTP请求记录失败', error.message);
    }
  }
  
  /**
   * 更新平均响应时间
   */
  updateAvgResponseTime() {
    let totalTime = 0;
    let totalRequests = 0;
    
    for (const stats of this.metrics.http.requestsByEndpoint.values()) {
      totalTime += stats.totalTime;
      totalRequests += stats.count;
    }
    
    this.metrics.http.avgResponseTime = totalRequests > 0 
      ? totalTime / totalRequests 
      : 0;
  }
  
  /**
   * 记录事件处理
   */
  recordEventProcessing(eventType, processingTime, success = true) {
    try {
      this.metrics.eventEngine.eventsProcessed++;
      
      // 按类型统计
      if (!this.metrics.eventEngine.processingTimeByType.has(eventType)) {
        this.metrics.eventEngine.processingTimeByType.set(eventType, {
          count: 0,
          totalTime: 0,
          avgTime: 0,
          minTime: Infinity,
          maxTime: 0
        });
      }
      
      const typeStats = this.metrics.eventEngine.processingTimeByType.get(eventType);
      typeStats.count++;
      typeStats.totalTime += processingTime;
      typeStats.avgTime = typeStats.totalTime / typeStats.count;
      typeStats.minTime = Math.min(typeStats.minTime, processingTime);
      typeStats.maxTime = Math.max(typeStats.maxTime, processingTime);
      
      if (!success) {
        if (!this.metrics.eventEngine.errorsByType.has(eventType)) {
          this.metrics.eventEngine.errorsByType.set(eventType, 0);
        }
        this.metrics.eventEngine.errorsByType.set(
          eventType,
          this.metrics.eventEngine.errorsByType.get(eventType) + 1
        );
      }
      
      // 更新平均处理时间
      this.updateAvgEventProcessingTime();
      
    } catch (error) {
      logger.error('事件处理记录失败', error.message);
    }
  }
  
  /**
   * 更新平均事件处理时间
   */
  updateAvgEventProcessingTime() {
    let totalTime = 0;
    let totalEvents = 0;
    
    for (const stats of this.metrics.eventEngine.processingTimeByType.values()) {
      totalTime += stats.totalTime;
      totalEvents += stats.count;
    }
    
    this.metrics.eventEngine.avgProcessingTime = totalEvents > 0 
      ? totalTime / totalEvents 
      : 0;
  }
  
  /**
   * 记录错误
   */
  recordError(errorType, error) {
    try {
      this.metrics.errors.total++;
      
      // 按类型统计
      if (!this.metrics.errors.byType.has(errorType)) {
        this.metrics.errors.byType.set(errorType, 0);
      }
      this.metrics.errors.byType.set(
        errorType,
        this.metrics.errors.byType.get(errorType) + 1
      );
      
      // 记录最近错误
      this.metrics.errors.recent.push({
        timestamp: Date.now(),
        type: errorType,
        message: error.message || String(error),
        stack: error.stack
      });
      
      // 只保留最近50个错误
      if (this.metrics.errors.recent.length > 50) {
        this.metrics.errors.recent.shift();
      }
      
      // 计算错误率
      this.updateErrorRate();
      
    } catch (err) {
      console.error('错误记录失败:', err);
    }
  }
  
  /**
   * 更新错误率
   */
  updateErrorRate() {
    const totalOperations = this.metrics.http.totalRequests + 
                           this.metrics.eventEngine.eventsProcessed;
    
    this.metrics.errors.errorRate = totalOperations > 0 
      ? (this.metrics.errors.total / totalOperations) * 100 
      : 0;
  }
  
  /**
   * 汇总请求统计
   */
  aggregateRequestStats() {
    const timestamp = Date.now();
    
    // 记录每分钟请求数
    this.metrics.http.requestsPerMinute.push({
      timestamp,
      count: this.metrics.http.totalRequests
    });
    
    if (this.metrics.http.requestsPerMinute.length > 60) {
      this.metrics.http.requestsPerMinute.shift();
    }
    
    // 记录每分钟事件数
    this.metrics.eventEngine.eventsPerMinute.push({
      timestamp,
      count: this.metrics.eventEngine.eventsProcessed
    });
    
    if (this.metrics.eventEngine.eventsPerMinute.length > 60) {
      this.metrics.eventEngine.eventsPerMinute.shift();
    }
  }
  
  /**
   * 检查告警
   */
  checkAlerts() {
    const timestamp = Date.now();
    
    // CPU使用率告警
    if (this.metrics.cpu.avgUsage > this.config.cpuThreshold) {
      this.addAlert({
        timestamp,
        level: 'warning',
        category: 'cpu',
        message: `CPU使用率过高: ${this.metrics.cpu.avgUsage.toFixed(2)}%`,
        value: this.metrics.cpu.avgUsage
      });
    }
    
    // 内存使用告警
    if (this.metrics.memory.system.length > 0) {
      const latestMemory = this.metrics.memory.system[this.metrics.memory.system.length - 1];
      if (latestMemory.usagePercent > this.config.memoryThreshold) {
        this.addAlert({
          timestamp,
          level: 'warning',
          category: 'memory',
          message: `内存使用率过高: ${latestMemory.usagePercent.toFixed(2)}%`,
          value: latestMemory.usagePercent
        });
      }
    }
    
    // 事件循环延迟告警
    if (this.metrics.eventLoop.avgDelay > this.config.eventLoopDelayThreshold) {
      this.addAlert({
        timestamp,
        level: 'warning',
        category: 'eventLoop',
        message: `事件循环延迟过高: ${this.metrics.eventLoop.avgDelay.toFixed(2)}ms`,
        value: this.metrics.eventLoop.avgDelay
      });
    }
    
    // 响应时间告警
    if (this.metrics.http.avgResponseTime > this.config.responseTimeThreshold) {
      this.addAlert({
        timestamp,
        level: 'warning',
        category: 'responseTime',
        message: `平均响应时间过长: ${this.metrics.http.avgResponseTime.toFixed(0)}ms`,
        value: this.metrics.http.avgResponseTime
      });
    }
    
    // 错误率告警
    if (this.metrics.errors.errorRate > this.config.errorRateThreshold) {
      this.addAlert({
        timestamp,
        level: 'error',
        category: 'errorRate',
        message: `错误率过高: ${this.metrics.errors.errorRate.toFixed(2)}%`,
        value: this.metrics.errors.errorRate
      });
    }
  }
  
  /**
   * 添加告警
   */
  addAlert(alert) {
    // 防止重复告警（5分钟内同类告警只记录一次）
    const recentAlert = this.metrics.alerts.find(a => 
      a.category === alert.category && 
      Date.now() - a.timestamp < 5 * 60 * 1000
    );
    
    if (recentAlert) {
      return;
    }
    
    this.metrics.alerts.push(alert);
    
    // 只保留最近50条告警
    if (this.metrics.alerts.length > 50) {
      this.metrics.alerts.shift();
    }
    
    // 发送告警事件
    this.emit('alert', alert);
    logger.warn('性能告警', alert.message);
  }
  
  /**
   * 计算平均值
   */
  calculateAverage(values) {
    if (values.length === 0) return 0;
    const sum = values.reduce((a, b) => a + b, 0);
    return sum / values.length;
  }
  
  /**
   * 获取性能摘要
   */
  getPerformanceSummary() {
    const uptime = Date.now() - this.systemInfo.startTime;
    
    return {
      systemInfo: this.systemInfo,
      uptime,
      timestamp: Date.now(),
      
      // CPU
      cpu: {
        current: this.metrics.cpu.usage[this.metrics.cpu.usage.length - 1]?.usage || 0,
        average: this.metrics.cpu.avgUsage,
        max: this.metrics.cpu.maxUsage,
        history: this.metrics.cpu.usage.slice(-20)
      },
      
      // 内存
      memory: {
        process: this.metrics.memory.process[this.metrics.memory.process.length - 1],
        system: this.metrics.memory.system[this.metrics.memory.system.length - 1],
        processHistory: this.metrics.memory.process.slice(-20),
        systemHistory: this.metrics.memory.system.slice(-20)
      },
      
      // 事件循环
      eventLoop: {
        current: this.metrics.eventLoop.delays[this.metrics.eventLoop.delays.length - 1]?.delay || 0,
        average: this.metrics.eventLoop.avgDelay,
        max: this.metrics.eventLoop.maxDelay,
        history: this.metrics.eventLoop.delays.slice(-20)
      },
      
      // HTTP
      http: {
        totalRequests: this.metrics.http.totalRequests,
        activeRequests: this.metrics.http.activeRequests,
        avgResponseTime: this.metrics.http.avgResponseTime,
        requestsPerMinute: this.metrics.http.requestsPerMinute.slice(-10),
        topEndpoints: this.getTopEndpoints(10),
        slowestEndpoints: this.getSlowestEndpoints(10)
      },
      
      // WebSocket
      websocket: {
        total: this.metrics.websocket.totalConnections,
        active: this.metrics.websocket.activeConnections,
        messagesSent: this.metrics.websocket.messagesSent,
        messagesReceived: this.metrics.websocket.messagesReceived,
        avgLatency: this.metrics.websocket.avgLatency
      },
      
      // 事件引擎
      eventEngine: {
        eventsProcessed: this.metrics.eventEngine.eventsProcessed,
        avgProcessingTime: this.metrics.eventEngine.avgProcessingTime,
        eventsPerMinute: this.metrics.eventEngine.eventsPerMinute.slice(-10),
        topEventTypes: this.getTopEventTypes(10)
      },
      
      // 错误
      errors: {
        total: this.metrics.errors.total,
        errorRate: this.metrics.errors.errorRate,
        byType: Object.fromEntries(this.metrics.errors.byType),
        recent: this.metrics.errors.recent.slice(-10)
      },
      
      // 告警
      alerts: this.metrics.alerts.slice(-20),
      activeAlerts: this.metrics.alerts.filter(a => 
        Date.now() - a.timestamp < 5 * 60 * 1000
      )
    };
  }
  
  /**
   * 获取TOP端点
   */
  getTopEndpoints(limit = 10) {
    return Array.from(this.metrics.http.requestsByEndpoint.entries())
      .map(([endpoint, stats]) => ({
        endpoint,
        count: stats.count,
        avgTime: stats.avgTime,
        errors: stats.errors
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }
  
  /**
   * 获取最慢端点
   */
  getSlowestEndpoints(limit = 10) {
    return Array.from(this.metrics.http.requestsByEndpoint.entries())
      .map(([endpoint, stats]) => ({
        endpoint,
        avgTime: stats.avgTime,
        maxTime: stats.maxTime,
        count: stats.count
      }))
      .sort((a, b) => b.avgTime - a.avgTime)
      .slice(0, limit);
  }
  
  /**
   * 获取TOP事件类型
   */
  getTopEventTypes(limit = 10) {
    return Array.from(this.metrics.eventEngine.processingTimeByType.entries())
      .map(([type, stats]) => ({
        type,
        count: stats.count,
        avgTime: stats.avgTime,
        errors: this.metrics.eventEngine.errorsByType.get(type) || 0
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }
  
  /**
   * 重置统计数据
   */
  resetStats() {
    this.metrics.http.totalRequests = 0;
    this.metrics.http.requestsByEndpoint.clear();
    this.metrics.http.errorsByEndpoint.clear();
    this.metrics.eventEngine.eventsProcessed = 0;
    this.metrics.eventEngine.processingTimeByType.clear();
    this.metrics.eventEngine.errorsByType.clear();
    this.metrics.errors.total = 0;
    this.metrics.errors.byType.clear();
    
    logger.info('系统性能监控', '统计数据已重置');
  }
}

export default SystemPerformanceMonitor;

