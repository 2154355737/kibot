/**
 * 兼容适配器 - 保持与 MonitorDataManager 相同的 API
 * 
 * 该适配器提供与旧的 MonitorDataManager 完全兼容的接口，
 * 使得可以无缝迁移到新的 SystemStatistics 模块。
 * 
 * @module legacy-stats-adapter
 * @version 1.0.0
 */

import { systemStatistics } from './system-statistics.js';

/**
 * 兼容适配器类
 */
export class LegacyStatsAdapter {
  constructor() {
    this.systemStats = systemStatistics;
  }
  
  // ==================== 兼容 MonitorDataManager 的方法签名 ====================
  
  /**
   * 记录消息事件
   * @param {Object} messageData - 消息数据
   */
  recordMessage(messageData) {
    return this.systemStats.recordMessage(messageData);
  }
  
  /**
   * 记录API调用
   * @param {Object} apiData - API调用数据
   */
  recordApiCall(apiData) {
    const action = apiData.action || 'unknown';
    const duration = apiData.duration || apiData.responseTime || 0;
    const success = apiData.success !== false;
    
    return this.systemStats.recordApiCall(action, duration, success);
  }
  
  /**
   * 记录错误事件
   * @param {Object} errorData - 错误数据
   */
  recordError(errorData) {
    const type = errorData.type || 'unknown';
    const source = errorData.source || 'system';
    const error = errorData.error || errorData.message || 'Unknown error';
    const metadata = errorData.metadata || {};
    
    return this.systemStats.recordError(type, source, error, metadata);
  }
  
  /**
   * 记录系统指标
   * @param {Object} metrics - 系统指标数据
   */
  recordSystemMetrics(metrics) {
    // SystemStatistics 自动收集系统指标，此方法为兼容性保留
    // 可以选择不实现或记录到自定义位置
    console.log('recordSystemMetrics: SystemStatistics 自动收集系统指标');
  }
  
  /**
   * 记录插件执行
   * @param {Object} pluginData - 插件数据
   */
  recordPluginExecution(pluginData) {
    return this.systemStats.recordPluginExecution();
  }
  
  /**
   * 记录规则触发
   * @param {Object} ruleData - 规则数据
   */
  recordRuleTrigger(ruleData) {
    return this.systemStats.recordRuleTriggered();
  }
  
  /**
   * 生成统计报告
   * @param {string} timeRange - 时间范围 ('1h', '24h', '7d', '30d')
   * @returns {Promise<Object>} 统计报告
   */
  async generateStatsReport(timeRange = '24h') {
    return await this.systemStats.generateStatsReport(timeRange);
  }
  
  /**
   * 获取最活跃用户
   * @param {number} limit - 限制数量
   * @returns {Array} 用户列表
   */
  getTopActiveUsers(limit = 20) {
    const stats = this.systemStats.getMessageStats();
    return stats.topUsers.slice(0, limit).map(user => ({
      userId: user.userId,
      username: `用户${user.userId}`,
      messageCount: user.messageCount,
      lastActive: new Date(user.lastActive).toLocaleString()
    }));
  }
  
  /**
   * 获取最活跃群组
   * @param {number} limit - 限制数量
   * @returns {Array} 群组列表
   */
  getTopActiveGroups(limit = 15) {
    const stats = this.systemStats.getMessageStats();
    return stats.topGroups.slice(0, limit).map(group => ({
      groupId: group.groupId,
      groupName: `群组${group.groupId}`,
      messageCount: group.messageCount,
      memberCount: 0,
      activeUsers: group.activeUserCount
    }));
  }
  
  /**
   * 获取今日消息数
   * @returns {number} 消息数量
   */
  getTodayMessages() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStart = today.getTime();
    
    return this.systemStats.messageStats.recentMessages
      .filter(m => m.timestamp >= todayStart).length;
  }
  
  /**
   * 获取活跃用户数
   * @param {number} timeRangeMs - 时间范围（毫秒）
   * @returns {number} 活跃用户数
   */
  getActiveUsersCount(timeRangeMs) {
    const cutoff = Date.now() - timeRangeMs;
    let count = 0;
    
    for (const [userId, activity] of this.systemStats.messageStats.userActivity) {
      if (activity.lastActive >= cutoff) {
        count++;
      }
    }
    
    return count;
  }
  
  /**
   * 获取活跃群组数
   * @param {number} timeRangeMs - 时间范围（毫秒）
   * @returns {number} 活跃群组数
   */
  getActiveGroupsCount(timeRangeMs) {
    const cutoff = Date.now() - timeRangeMs;
    let count = 0;
    
    for (const [groupId, activity] of this.systemStats.messageStats.groupActivity) {
      if (activity.lastActive >= cutoff) {
        count++;
      }
    }
    
    return count;
  }
  
  /**
   * 获取好友总数
   * @returns {number} 好友数量
   */
  getTotalFriendsCount() {
    return this.systemStats.messageStats.userActivity.size || 0;
  }
  
  /**
   * 获取每秒消息数
   * @returns {number} 每秒消息数
   */
  getMessagesPerSecond() {
    const last5Minutes = Date.now() - 5 * 60 * 1000;
    const recentMessages = this.systemStats.messageStats.recentMessages
      .filter(m => m.timestamp >= last5Minutes);
    return recentMessages.length / 300; // 5分钟 = 300秒
  }
  
  /**
   * 更新用户活动
   * @param {string} userId - 用户ID
   * @param {Object} messageData - 消息数据
   */
  updateUserActivity(userId, messageData) {
    // SystemStatistics 在 recordMessage 时自动更新用户活动
    // 此方法为兼容性保留
  }
  
  /**
   * 更新群组活动
   * @param {string} groupId - 群组ID
   * @param {Object} messageData - 消息数据
   */
  updateGroupActivity(groupId, messageData) {
    // SystemStatistics 在 recordMessage 时自动更新群组活动
    // 此方法为兼容性保留
  }
  
  /**
   * 数据导出
   * @param {string} format - 导出格式 ('json', 'csv', 'xml')
   * @param {string} timeRange - 时间范围
   * @param {boolean} includeRawData - 是否包含原始数据
   * @returns {Promise<string>} 导出的数据
   */
  async exportData(format = 'json', timeRange = '24h', includeRawData = false) {
    const stats = await this.generateStatsReport(timeRange);
    const exportData = {
      metadata: {
        exportTime: new Date().toISOString(),
        timeRange,
        dataQuality: stats.dataQuality,
        version: '1.0.0'
      },
      statistics: stats
    };
    
    if (includeRawData) {
      exportData.rawData = {
        messages: this.systemStats.messageStats.recentMessages,
        httpRequests: this.systemStats.httpStats.recentRequests,
        errors: this.systemStats.errors
      };
    }
    
    switch (format.toLowerCase()) {
      case 'json':
        return JSON.stringify(exportData, null, 2);
      case 'csv':
        return this._convertToCSV(exportData);
      case 'xml':
        return this._convertToXML(exportData);
      default:
        throw new Error(`不支持的导出格式: ${format}`);
    }
  }
  
  /**
   * 数据归档
   * @param {Date} date - 归档日期
   * @returns {Promise<string>} 归档文件路径
   */
  async archiveData(date = null) {
    return await this.systemStats.archiveOldData();
  }
  
  /**
   * 保存当前统计数据
   */
  saveCurrentStats() {
    return this.systemStats.save();
  }
  
  /**
   * 加载当前统计数据
   * @param {boolean} silent - 是否静默加载
   */
  loadCurrentStats(silent = false) {
    return this.systemStats.load();
  }
  
  /**
   * 输出监控系统状态日志
   */
  logStatus() {
    console.log('--- 统计系统状态 ---');
    const summary = this.systemStats.getSystemSummary();
    console.log(`总消息数: ${summary.counters.totalMessages}`);
    console.log(`总API调用: ${summary.counters.totalApiCalls}`);
    console.log(`总错误数: ${summary.counters.totalErrors}`);
    console.log(`运行时间: ${Math.floor(summary.runtime.uptime / 1000)}秒`);
  }
  
  /**
   * 关闭监控数据管理器
   */
  shutdown() {
    return this.systemStats.stopAutoSave();
  }
  
  /**
   * 获取时间范围的毫秒数
   * @param {string} timeRange - 时间范围
   * @returns {number} 毫秒数
   */
  getTimeRangeMs(timeRange) {
    const ranges = {
      '1h': 60 * 60 * 1000,
      '24h': 24 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000,
      '30d': 30 * 24 * 60 * 60 * 1000
    };
    return ranges[timeRange] || ranges['24h'];
  }
  
  // ==================== 内部辅助方法 ====================
  
  /**
   * 转换为CSV格式
   * @private
   */
  _convertToCSV(data) {
    // 简单的CSV转换实现
    const flatten = (obj, prefix = '') => {
      return Object.keys(obj).reduce((acc, k) => {
        const pre = prefix.length ? prefix + '.' : '';
        if (typeof obj[k] === 'object' && obj[k] !== null && !Array.isArray(obj[k])) {
          Object.assign(acc, flatten(obj[k], pre + k));
        } else {
          acc[pre + k] = obj[k];
        }
        return acc;
      }, {});
    };

    const flattened = flatten(data);
    const headers = Object.keys(flattened).join(',');
    const values = Object.values(flattened).map(v => 
      typeof v === 'string' ? `"${v.replace(/"/g, '""')}"` : v
    ).join(',');
    
    return headers + '\n' + values;
  }
  
  /**
   * 转换为XML格式
   * @private
   */
  _convertToXML(data) {
    // 简单的XML转换实现
    const toXML = (obj, rootName = 'root') => {
      let xml = `<${rootName}>`;
      
      for (const [key, value] of Object.entries(obj)) {
        if (typeof value === 'object' && value !== null) {
          if (Array.isArray(value)) {
            xml += `<${key}>`;
            value.forEach((item, index) => {
              xml += toXML(item, `item_${index}`);
            });
            xml += `</${key}>`;
          } else {
            xml += toXML(value, key);
          }
        } else {
          xml += `<${key}>${value}</${key}>`;
        }
      }
      
      xml += `</${rootName}>`;
      return xml;
    };

    return '<?xml version="1.0" encoding="UTF-8"?>' + toXML(data, 'monitorData');
  }
}

// 导出兼容实例
export const legacyStatsAdapter = new LegacyStatsAdapter();

// 默认导出
export default legacyStatsAdapter;

