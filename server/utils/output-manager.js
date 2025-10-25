/**
 * KiBot 输出管理器
 * 整理和优化终端日志输出，支持文件存储和WebSocket推送
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { getLocalTime, getLocalDate, getLocalDateTime, createTimestamp } from './timezone-helper.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class OutputManager {
  constructor() {
    this.enabledCategories = new Set([
      'startup',
      'plugin',
      'event', 
      'api',
      'error',
      'warning',
      'success'
    ]);
    this.quietMode = false;
    
    // 日志存储
    this.logHistory = [];
    this.maxHistorySize = 5000;
    this.logFile = null;
    this.wsClients = new Set();
    
    // 日志文件配置
    this.logDirectory = path.join(__dirname, '../data/logs');
    this.ensureLogDirectory();
    
    // 分类图标
    this.icons = {
      startup: '🚀',
      plugin: '🔌', 
      event: '📨',
      api: '📡',
      error: '❌',
      warning: '⚠️',
      success: '✅',
      info: 'ℹ️',
      debug: '🐛'
    };
  }

  /**
   * 设置日志级别
   */
  setLevel(level, silent = false) {
    const levels = {
      'quiet': [],
      'error': ['error'],
      'warn': ['error', 'warning'], 
      'info': ['error', 'warning', 'success', 'info', 'startup'],
      'verbose': ['error', 'warning', 'success', 'info', 'startup', 'plugin', 'event'],
      'debug': ['error', 'warning', 'success', 'info', 'startup', 'plugin', 'event', 'api', 'debug']
    };
    
    this.enabledCategories = new Set(levels[level] || levels.info);
    
    // 只在非静默模式下输出
    if (!silent) {
      this.info('日志系统', `级别: ${level}`);
    }
  }

  /**
   * 格式化消息
   */
  formatMessage(category, title, message = '', data = null) {
    if (!this.enabledCategories.has(category)) {
      return null;
    }

    const timestamp = getLocalTime(); // 使用本地时间（CST）
    const icon = this.icons[category] || '';
    
    let output = `[${timestamp}] ${icon} ${title}`;
    
    if (message) {
      output += ` ${message}`;
    }
    
    // data参数不再展开显示，保持单行格式
    // 如果需要查看详情，应该在message中包含
    
    return output;
  }

  /**
   * 确保日志目录存在
   */
  ensureLogDirectory() {
    if (!fs.existsSync(this.logDirectory)) {
      fs.mkdirSync(this.logDirectory, { recursive: true });
    }
    
    // 设置当日日志文件（使用本地日期）
    const today = getLocalDate(); // 使用本地日期（CST）
    this.logFile = path.join(this.logDirectory, `kibot-${today}.log`);
  }

  /**
   * 添加WebSocket客户端
   */
  addWebSocketClient(ws) {
    this.wsClients.add(ws);
    
    // 发送最近的日志历史
    const recentLogs = this.logHistory.slice(-100);
    if (recentLogs.length > 0) {
      ws.send(JSON.stringify({
        type: 'log_history',
        data: recentLogs
      }));
    }
    
    ws.on('close', () => {
      this.wsClients.delete(ws);
    });
  }

  /**
   * 广播日志到WebSocket客户端
   */
  broadcastLog(logEntry) {
    const message = JSON.stringify({
      type: 'log_entry',
      data: logEntry
    });
    
    this.wsClients.forEach(ws => {
      try {
        if (ws.readyState === 1) { // WebSocket.OPEN
          ws.send(message);
        }
      } catch (error) {
        this.wsClients.delete(ws);
      }
    });
  }

  /**
   * 写入日志文件
   */
  writeToFile(logEntry) {
    try {
      const logLine = `${logEntry.timestamp} [${logEntry.level}] [${logEntry.category}] ${logEntry.message}\n`;
      fs.appendFileSync(this.logFile, logLine);
    } catch (error) {
      console.error('写入日志文件失败:', error);
    }
  }

  /**
   * 输出消息
   */
  log(category, title, message = '', data = null) {
    const formatted = this.formatMessage(category, title, message, data);
    if (formatted && !this.quietMode) {
      console.log(formatted);
    }
    
    // 创建日志条目
    // 创建包含本地时间和UTC时间的时间戳对象
    const timestampObj = createTimestamp();
    
    const logEntry = {
      id: Date.now() + Math.random().toString(36).substr(2, 9),
      timestamp: timestampObj.local, // 使用本地时间（CST）
      timestampUTC: timestampObj.utc, // 保留UTC时间用于兼容
      level: this.getLevelFromCategory(category),
      category: category,
      title: title,
      message: message,
      data: data,
      source: 'backend'
    };
    
    // 添加到历史记录
    this.logHistory.push(logEntry);
    if (this.logHistory.length > this.maxHistorySize) {
      this.logHistory.shift();
    }
    
    // 写入文件
    this.writeToFile(logEntry);
    
    // 广播到WebSocket客户端
    this.broadcastLog(logEntry);
  }

  /**
   * 从分类获取日志级别
   */
  getLevelFromCategory(category) {
    const levelMap = {
      'error': 'ERROR',
      'warning': 'WARN',
      'success': 'INFO',
      'info': 'INFO',
      'startup': 'INFO',
      'plugin': 'INFO',
      'event': 'INFO',
      'api': 'DEBUG',
      'debug': 'DEBUG'
    };
    return levelMap[category] || 'INFO';
  }

  // 便捷方法
  startup(title, message = '', data = null) {
    this.log('startup', title, message, data);
  }

  plugin(title, message = '', data = null) {
    this.log('plugin', title, message, data);
  }

  event(title, message = '', data = null) {
    this.log('event', title, message, data);
  }

  api(title, message = '', data = null) {
    this.log('api', title, message, data);
  }

  error(title, message = '', error = null) {
    const errorDetails = error ? {
      message: error.message,
      stack: error.stack?.split('\n').slice(0, 3).join('\n')
    } : null;
    this.log('error', title, message, errorDetails);
  }

  warning(title, message = '', data = null) {
    this.log('warning', title, message, data);
  }

  success(title, message = '', data = null) {
    this.log('success', title, message, data);
  }

  info(title, message = '', data = null) {
    this.log('info', title, message, data);
  }

  debug(title, message = '', data = null) {
    this.log('debug', title, message, data);
  }

  /**
   * 显示分隔线
   */
  separator(text = '') {
    if (this.quietMode) return;
    
    const line = '='.repeat(60);
    if (text) {
      const padding = Math.max(0, (60 - text.length - 2) / 2);
      const paddedText = ' '.repeat(Math.floor(padding)) + text + ' '.repeat(Math.ceil(padding));
      console.log(line);
      console.log(paddedText);
      console.log(line);
    } else {
      console.log(line);
    }
  }

  /**
   * 显示启动横幅
   */
  banner() {
    if (this.quietMode) return;
    
    console.log(`
╔══════════════════════════════════════════════════════════╗
║                    KiBot 后端服务器                       ║
║                   Backend Server v1.0                   ║  
╚══════════════════════════════════════════════════════════╝
`);
  }

  /**
   * 显示状态摘要
   */
  showStatus(status) {
    if (this.quietMode) return;
    
    this.separator('系统状态');
    Object.entries(status).forEach(([key, value]) => {
      const icon = value.healthy ? '✅' : '❌';
      console.log(`${icon} ${key}: ${value.status}`);
    });
    this.separator();
  }

  /**
   * 获取日志历史
   */
  getLogHistory(limit = 1000, level = null, category = null) {
    let logs = [...this.logHistory];
    
    if (level) {
      logs = logs.filter(log => log.level === level);
    }
    
    if (category) {
      logs = logs.filter(log => log.category === category);
    }
    
    return logs.slice(-limit);
  }

  /**
   * 清理旧日志文件
   */
  cleanupOldLogs(daysToKeep = 30) {
    try {
      const files = fs.readdirSync(this.logDirectory);
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
      
      let deletedCount = 0;
      files.forEach(file => {
        if (file.match(/^kibot-\d{4}-\d{2}-\d{2}\.log$/)) {
          const dateStr = file.match(/\d{4}-\d{2}-\d{2}/)[0];
          const fileDate = new Date(dateStr);
          
          if (fileDate < cutoffDate) {
            fs.unlinkSync(path.join(this.logDirectory, file));
            deletedCount++;
          }
        }
      });
      
      if (deletedCount > 0) {
        this.info('日志清理', `清理了 ${deletedCount} 个旧日志文件`);
      }
    } catch (error) {
      this.error('日志清理', '清理旧日志文件失败', error);
    }
  }

  /**
   * 获取日志统计
   */
  getLogStats() {
    const stats = {
      total: this.logHistory.length,
      byLevel: {},
      byCategory: {},
      recentActivity: []
    };

    // 按级别统计
    this.logHistory.forEach(log => {
      stats.byLevel[log.level] = (stats.byLevel[log.level] || 0) + 1;
      stats.byCategory[log.category] = (stats.byCategory[log.category] || 0) + 1;
    });

    // 最近活动（过去1小时）
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    stats.recentActivity = this.logHistory.filter(
      log => new Date(log.timestamp) > oneHourAgo
    ).length;

    return stats;
  }
}

// 创建全局实例
export const logger = new OutputManager();

// 设置默认日志级别（静默，不输出日志）
const defaultLevel = process.env.LOG_LEVEL || 'info';
const levels = {
  'quiet': [],
  'error': ['error'],
  'warn': ['error', 'warning'], 
  'info': ['error', 'warning', 'success', 'info', 'startup'],
  'verbose': ['error', 'warning', 'success', 'info', 'startup', 'plugin', 'event'],
  'debug': ['error', 'warning', 'success', 'info', 'startup', 'plugin', 'event', 'api', 'debug']
};
logger.enabledCategories = new Set(levels[defaultLevel] || levels.info);

export default OutputManager;
