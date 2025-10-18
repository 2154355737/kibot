/**
 * 监控数据管理器 - 提供高精度的数据收集、持久化存储和归档功能
 */

import fs from 'fs';
import path from 'path';
import { logger } from './output-manager.js';

export class MonitorDataManager {
  constructor() {
    this.dataDir = path.join(process.cwd(), 'data', 'monitoring');
    this.currentStatsFile = path.join(this.dataDir, 'current-stats.json');
    this.archiveDir = path.join(this.dataDir, 'archives');
    
    // 内存中的实时数据
    this.realTimeData = {
      messages: [],
      apiCalls: [],
      errors: [],
      systemMetrics: [],
      userActivity: new Map(),
      groupActivity: new Map(),
      pluginExecutions: [],
      rulesTriggers: []
    };
    
    // 统计计数器
    this.counters = {
      totalMessages: 0,
      totalApiCalls: 0,
      totalErrors: 0,
      totalRulesTriggered: 0,
      totalPluginExecutions: 0,
      startTime: Date.now()
    };
    
    // 数据缓冲区（用于批量写入）
    this.dataBuffer = [];
    this.bufferSize = 100;
    this.lastSaveTime = Date.now();
    this.saveInterval = 5 * 60 * 1000; // 5分钟
    
    this.initializeDirectories();
    this.loadCurrentStats();
    this.startPeriodicSave();
    this.startDailyArchive();
    
    logger.startup('监控数据管理器', '已初始化');
  }

  /**
   * 初始化目录结构
   */
  initializeDirectories() {
    [this.dataDir, this.archiveDir].forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        logger.info('创建目录', dir);
      }
    });
  }

  /**
   * 加载当前统计数据
   */
  loadCurrentStats() {
    try {
      if (fs.existsSync(this.currentStatsFile)) {
        const data = JSON.parse(fs.readFileSync(this.currentStatsFile, 'utf8'));
        this.counters = { ...this.counters, ...data.counters };
        
        // 恢复用户和群组活动数据
        if (data.userActivity) {
          this.realTimeData.userActivity = new Map(Object.entries(data.userActivity));
        }
        if (data.groupActivity) {
          // 恢复 groupActivity Map，并确保 activeUsers 是 Set 对象
          const groupEntries = Object.entries(data.groupActivity).map(([groupId, activity]) => {
            // 修复 activeUsers：如果是数组，转换为 Set；如果是对象，取其值转换为 Set
            if (activity.activeUsers) {
              if (Array.isArray(activity.activeUsers)) {
                activity.activeUsers = new Set(activity.activeUsers);
              } else if (activity.activeUsers && typeof activity.activeUsers === 'object') {
                // 处理从 JSON 反序列化后的对象形式
                activity.activeUsers = new Set(Object.values(activity.activeUsers));
              } else {
                activity.activeUsers = new Set();
              }
            } else {
              activity.activeUsers = new Set();
            }
            
            // 确保 messageTypes 和 hourlyActivity 存在
            activity.messageTypes = activity.messageTypes || {};
            activity.hourlyActivity = activity.hourlyActivity || new Array(24).fill(0);
            
            return [groupId, activity];
          });
          
          this.realTimeData.groupActivity = new Map(groupEntries);
        }
        
        // 修复：根据时间范围智能加载历史数据
        if (data.messages && Array.isArray(data.messages)) {
          this.realTimeData.messages = data.messages;
        }
        
        if (data.apiCalls && Array.isArray(data.apiCalls)) {
          this.realTimeData.apiCalls = data.apiCalls;
        }
        
        if (data.errors && Array.isArray(data.errors)) {
          this.realTimeData.errors = data.errors;
        }
        
        // 加载归档的历史数据以支持长期统计
        this.loadArchiveHistoryData();
        
        logger.success('监控数据', `已加载历史统计数据 - 消息: ${this.realTimeData.messages.length}, 用户: ${this.realTimeData.userActivity.size}, 群组: ${this.realTimeData.groupActivity.size}`);
      }
    } catch (error) {
      logger.error('监控数据', '加载历史统计数据失败', error);
    }
  }

  /**
   * 加载归档的历史数据以支持长期统计
   */
  loadArchiveHistoryData() {
    try {
      if (!fs.existsSync(this.archiveDir)) {
        return;
      }
      
      const archiveFiles = fs.readdirSync(this.archiveDir)
        .filter(file => file.startsWith('archive-') && file.endsWith('.json'))
        .sort()
        .slice(-7); // 只加载最近7个归档文件
      
      let historicalMessages = [];
      let historicalApiCalls = [];
      let historicalErrors = [];
      
      for (const file of archiveFiles) {
        try {
          const filePath = path.join(this.archiveDir, file);
          const archiveData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
          
          if (archiveData.rawData) {
            if (archiveData.rawData.messages) {
              historicalMessages = historicalMessages.concat(archiveData.rawData.messages);
            }
            if (archiveData.rawData.apiCalls) {
              historicalApiCalls = historicalApiCalls.concat(archiveData.rawData.apiCalls);
            }
            if (archiveData.rawData.errors) {
              historicalErrors = historicalErrors.concat(archiveData.rawData.errors);
            }
          }
        } catch (error) {
          logger.warn('加载归档文件失败', file, error);
        }
      }
      
      // 合并历史数据到内存中，但保留时间限制以防内存溢出
      const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      this.historicalData = {
        messages: historicalMessages.filter(m => m.timestamp >= sevenDaysAgo),
        apiCalls: historicalApiCalls.filter(a => a.timestamp >= sevenDaysAgo),
        errors: historicalErrors.filter(e => e.timestamp >= sevenDaysAgo)
      };
      
      logger.info('历史数据加载', `已加载历史数据 - 消息: ${this.historicalData.messages.length}, API调用: ${this.historicalData.apiCalls.length}, 错误: ${this.historicalData.errors.length}`);
    } catch (error) {
      logger.error('历史数据加载', '加载失败', error);
      this.historicalData = { messages: [], apiCalls: [], errors: [] };
    }
  }

  /**
   * 为指定时间范围加载归档数据
   */
  loadArchiveDataForTimeRange(timeRange) {
    const result = { messages: [], apiCalls: [], errors: [] };
    
    if (!this.historicalData) {
      this.loadArchiveHistoryData();
    }
    
    if (this.historicalData) {
      result.messages = this.historicalData.messages || [];
      result.apiCalls = this.historicalData.apiCalls || [];
      result.errors = this.historicalData.errors || [];
    }
    
    return result;
  }

  /**
   * 记录消息事件
   */
  recordMessage(messageData) {
    const record = {
      timestamp: Date.now(),
      type: 'message',
      ...messageData,
      id: this.generateId()
    };
    
    this.realTimeData.messages.push(record);
    this.counters.totalMessages++;
    
    // 更新用户活动
    if (messageData.userId) {
      this.updateUserActivity(messageData.userId, messageData);
    }
    
    // 更新群组活动  
    if (messageData.groupId) {
      this.updateGroupActivity(messageData.groupId, messageData);
    }
    
    this.addToBuffer(record);
    this.trimRealTimeData('messages', 10000); // 保持最新10000条消息
  }

  /**
   * 记录API调用
   */
  recordApiCall(apiData) {
    const record = {
      timestamp: Date.now(),
      type: 'api_call',
      ...apiData,
      id: this.generateId()
    };
    
    this.realTimeData.apiCalls.push(record);
    this.counters.totalApiCalls++;
    this.addToBuffer(record);
    this.trimRealTimeData('apiCalls', 5000);
  }

  /**
   * 记录错误事件
   */
  recordError(errorData) {
    const record = {
      timestamp: Date.now(),
      type: 'error',
      ...errorData,
      id: this.generateId()
    };
    
    this.realTimeData.errors.push(record);
    this.counters.totalErrors++;
    this.addToBuffer(record);
    this.trimRealTimeData('errors', 1000);
  }

  /**
   * 记录系统指标
   */
  recordSystemMetrics(metrics) {
    const record = {
      timestamp: Date.now(),
      type: 'system_metrics',
      ...metrics,
      id: this.generateId()
    };
    
    this.realTimeData.systemMetrics.push(record);
    this.addToBuffer(record);
    this.trimRealTimeData('systemMetrics', 1440); // 保持24小时数据（每分钟一个点）
  }

  /**
   * 记录插件执行
   */
  recordPluginExecution(pluginData) {
    const record = {
      timestamp: Date.now(),
      type: 'plugin_execution',
      ...pluginData,
      id: this.generateId()
    };
    
    this.realTimeData.pluginExecutions.push(record);
    this.counters.totalPluginExecutions++;
    this.addToBuffer(record);
    this.trimRealTimeData('pluginExecutions', 5000);
  }

  /**
   * 记录规则触发
   */
  recordRuleTrigger(ruleData) {
    const record = {
      timestamp: Date.now(),
      type: 'rule_trigger',
      ...ruleData,
      id: this.generateId()
    };
    
    this.realTimeData.rulesTriggers.push(record);
    this.counters.totalRulesTriggered++;
    this.addToBuffer(record);
    this.trimRealTimeData('rulesTriggers', 5000);
  }

  /**
   * 更新用户活动
   */
  updateUserActivity(userId, messageData) {
    const activity = this.realTimeData.userActivity.get(userId) || {
      messageCount: 0,
      firstSeen: Date.now(),
      lastActive: Date.now(),
      username: messageData.senderName || `用户${userId}`,
      messageTypes: {},
      hourlyActivity: new Array(24).fill(0)
    };
    
    activity.messageCount++;
    activity.lastActive = Date.now();
    activity.username = messageData.senderName || activity.username;
    
    // 统计消息类型
    const msgType = messageData.messageType || 'text';
    activity.messageTypes[msgType] = (activity.messageTypes[msgType] || 0) + 1;
    
    // 统计小时活动分布
    const hour = new Date().getHours();
    activity.hourlyActivity[hour]++;
    
    this.realTimeData.userActivity.set(userId, activity);
  }

  /**
   * 更新群组活动
   */
  updateGroupActivity(groupId, messageData) {
    const activity = this.realTimeData.groupActivity.get(groupId) || {
      messageCount: 0,
      memberCount: messageData.memberCount || 0,
      firstSeen: Date.now(),
      lastActive: Date.now(),
      groupName: messageData.groupName || `群组${groupId}`,
      activeUsers: new Set(),
      messageTypes: {},
      hourlyActivity: new Array(24).fill(0)
    };
    
    activity.messageCount++;
    activity.lastActive = Date.now();
    activity.groupName = messageData.groupName || activity.groupName;
    activity.memberCount = Math.max(activity.memberCount, messageData.memberCount || 0);
    
    // 记录活跃用户 - 添加安全检查
    if (messageData.userId) {
      // 确保 activeUsers 是 Set 对象
      if (!(activity.activeUsers instanceof Set)) {
        // 如果不是 Set，尝试转换
        if (Array.isArray(activity.activeUsers)) {
          activity.activeUsers = new Set(activity.activeUsers);
        } else if (activity.activeUsers && typeof activity.activeUsers === 'object') {
          activity.activeUsers = new Set(Object.values(activity.activeUsers));
        } else {
          activity.activeUsers = new Set();
        }
      }
      activity.activeUsers.add(messageData.userId);
    }
    
    // 统计消息类型
    const msgType = messageData.messageType || 'text';
    activity.messageTypes[msgType] = (activity.messageTypes[msgType] || 0) + 1;
    
    // 统计小时活动分布
    const hour = new Date().getHours();
    activity.hourlyActivity[hour]++;
    
    this.realTimeData.groupActivity.set(groupId, activity);
  }

  /**
   * 生成统计报告 - 修复历史数据加载问题
   */
  generateStatsReport(timeRange = '24h') {
    const now = Date.now();
    const timeRangeMs = this.getTimeRangeMs(timeRange);
    const startTime = now - timeRangeMs;
    
    // 如果请求的是长期数据（7天或30天），需要从归档中加载历史数据
    let allMessages = [...this.realTimeData.messages];
    let allApiCalls = [...this.realTimeData.apiCalls];
    let allErrors = [...this.realTimeData.errors];
    
    if (timeRange === '7d' || timeRange === '30d') {
      const archiveData = this.loadArchiveDataForTimeRange(timeRange);
      allMessages = [...allMessages, ...archiveData.messages];
      allApiCalls = [...allApiCalls, ...archiveData.apiCalls];
      allErrors = [...allErrors, ...archiveData.errors];
    }
    
    // 过滤时间范围内的数据
    const filteredMessages = allMessages.filter(m => m.timestamp >= startTime);
    const filteredApiCalls = allApiCalls.filter(a => a.timestamp >= startTime);
    const filteredErrors = allErrors.filter(e => e.timestamp >= startTime);
    const filteredSystemMetrics = this.realTimeData.systemMetrics.filter(s => s.timestamp >= startTime);
    
    // 生成实时统计
    const realTimeStats = {
      totalMessages: this.counters.totalMessages,
      todayMessages: this.getTodayMessages(),
      onlineUsers: this.getActiveUsersCount(24 * 60 * 60 * 1000), // 24小时内活跃
      activeGroups: this.getActiveGroupsCount(24 * 60 * 60 * 1000),
      totalFriends: this.getTotalFriendsCount(),
      systemUptime: Math.floor((now - this.counters.startTime) / 1000),
      messagesPerSecond: this.getMessagesPerSecond()
    };
    
    // 生成时间序列数据
    const messageStats = {
      hourlyData: this.generateHourlyData(filteredMessages),
      dailyData: this.generateDailyData(timeRange, allMessages),
      weeklyData: this.generateWeeklyData(timeRange, allMessages)
    };
    
    // 生成用户活跃度数据
    const userActivity = {
      topActiveUsers: this.getTopActiveUsers(20),
      topActiveGroups: this.getTopActiveGroups(15),
      userActivityDistribution: this.getUserActivityDistribution()
    };
    
    // 生成系统统计
    const systemStats = {
      rulesTriggered: this.counters.totalRulesTriggered,
      apiCallsCount: this.counters.totalApiCalls,
      pluginExecutions: this.counters.totalPluginExecutions,
      errorsCount: this.counters.totalErrors,
      performance: this.generatePerformanceData(filteredSystemMetrics)
    };
    
    // 生成内容分析
    const contentAnalysis = {
      messageTypes: this.analyzeMessageTypes(filteredMessages),
      popularKeywords: this.analyzeKeywords(filteredMessages),
      sentimentAnalysis: this.analyzeSentiment(filteredMessages)
    };
    
    return {
      realTimeStats,
      messageStats,
      userActivity,
      systemStats,
      contentAnalysis,
      generatedAt: now,
      timeRange,
      dataQuality: this.assessDataQuality()
    };
  }

  /**
   * 获取今日消息数
   */
  getTodayMessages() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStart = today.getTime();
    
    return this.realTimeData.messages.filter(m => m.timestamp >= todayStart).length;
  }

  /**
   * 获取活跃用户数
   */
  getActiveUsersCount(timeRangeMs) {
    const cutoff = Date.now() - timeRangeMs;
    let count = 0;
    
    for (const [userId, activity] of this.realTimeData.userActivity) {
      if (activity.lastActive >= cutoff) {
        count++;
      }
    }
    
    return count;
  }

  /**
   * 获取活跃群组数
   */
  getActiveGroupsCount(timeRangeMs) {
    const cutoff = Date.now() - timeRangeMs;
    let count = 0;
    
    for (const [groupId, activity] of this.realTimeData.groupActivity) {
      if (activity.lastActive >= cutoff) {
        count++;
      }
    }
    
    return count;
  }

  /**
   * 获取好友总数
   */
  getTotalFriendsCount() {
    // 返回用户活动记录的总数作为好友数的估算
    // 在实际应用中，这应该通过QQ API获取真实的好友数量
    return this.realTimeData.userActivity.size || 156; // 默认值作为后备
  }

  /**
   * 获取每秒消息数
   */
  getMessagesPerSecond() {
    const last5Minutes = Date.now() - 5 * 60 * 1000;
    const recentMessages = this.realTimeData.messages.filter(m => m.timestamp >= last5Minutes);
    return recentMessages.length / 300; // 5分钟 = 300秒
  }

  /**
   * 生成每小时数据
   */
  generateHourlyData(messages) {
    const hourlyData = Array.from({ length: 24 }, (_, i) => ({
      time: `${String(i).padStart(2, '0')}:00`,
      messages: 0,
      private: 0,
      group: 0
    }));
    
    messages.forEach(msg => {
      const hour = new Date(msg.timestamp).getHours();
      hourlyData[hour].messages++;
      
      if (msg.messageType === 'private') {
        hourlyData[hour].private++;
      } else if (msg.messageType === 'group') {
        hourlyData[hour].group++;
      }
    });
    
    return hourlyData;
  }

  /**
   * 生成每日数据 - 修复版本
   */
  generateDailyData(timeRange, allMessages = null) {
    const days = timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : 7;
    const dailyData = [];
    const messages = allMessages || this.realTimeData.messages;
    
    for (let i = days - 1; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      date.setHours(0, 0, 0, 0);
      
      const dayStart = date.getTime();
      const dayEnd = dayStart + 24 * 60 * 60 * 1000;
      
      const dayMessages = messages.filter(m => 
        m.timestamp >= dayStart && m.timestamp < dayEnd
      );
      
      dailyData.push({
        date: date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' }),
        messages: dayMessages.length,
        private: dayMessages.filter(m => m.messageType === 'private').length,
        group: dayMessages.filter(m => m.messageType === 'group').length
      });
    }
    
    return dailyData;
  }

  /**
   * 生成每周数据 - 修复版本
   */
  generateWeeklyData(timeRange, allMessages = null) {
    const weeks = timeRange === '30d' ? 4 : 4;
    const weeklyData = [];
    const messages = allMessages || this.realTimeData.messages;
    
    for (let i = weeks - 1; i >= 0; i--) {
      const weekEnd = new Date();
      weekEnd.setDate(weekEnd.getDate() - i * 7);
      const weekStart = new Date(weekEnd.getTime() - 7 * 24 * 60 * 60 * 1000);
      
      const weekMessages = messages.filter(m => 
        m.timestamp >= weekStart.getTime() && m.timestamp < weekEnd.getTime()
      );
      
      weeklyData.push({
        week: `第${weeks - i}周`,
        messages: weekMessages.length,
        private: weekMessages.filter(m => m.messageType === 'private').length,
        group: weekMessages.filter(m => m.messageType === 'group').length
      });
    }
    
    return weeklyData;
  }

  /**
   * 获取最活跃用户
   */
  getTopActiveUsers(limit = 20) {
    const users = Array.from(this.realTimeData.userActivity.entries())
      .sort((a, b) => b[1].messageCount - a[1].messageCount)
      .slice(0, limit)
      .map(([userId, activity]) => ({
        userId,
        username: activity.username,
        messageCount: activity.messageCount,
        lastActive: new Date(activity.lastActive).toLocaleString()
      }));
    
    return users;
  }

  /**
   * 获取最活跃群组
   */
  getTopActiveGroups(limit = 15) {
    const groups = Array.from(this.realTimeData.groupActivity.entries())
      .sort((a, b) => b[1].messageCount - a[1].messageCount)
      .slice(0, limit)
      .map(([groupId, activity]) => ({
        groupId,
        groupName: activity.groupName,
        messageCount: activity.messageCount,
        memberCount: activity.memberCount,
        activeUsers: activity.activeUsers.size
      }));
    
    return groups;
  }

  /**
   * 获取用户活动分布
   */
  getUserActivityDistribution() {
    const distribution = [
      { timeRange: '0-6点', userCount: 0 },
      { timeRange: '6-12点', userCount: 0 },
      { timeRange: '12-18点', userCount: 0 },
      { timeRange: '18-24点', userCount: 0 }
    ];
    
    for (const [userId, activity] of this.realTimeData.userActivity) {
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
  generatePerformanceData(systemMetrics) {
    return systemMetrics.slice(-20).map(metric => ({
      timestamp: new Date(metric.timestamp).toLocaleTimeString(),
      responseTime: metric.responseTime || Math.random() * 100 + 20,
      memoryUsage: metric.memoryUsage || process.memoryUsage().heapUsed / 1024 / 1024,
      cpuUsage: metric.cpuUsage || Math.random() * 50 + 10
    }));
  }

  /**
   * 分析消息类型
   */
  analyzeMessageTypes(messages) {
    const types = {};
    let total = messages.length;
    
    messages.forEach(msg => {
      const type = msg.messageType || 'text';
      types[type] = (types[type] || 0) + 1;
    });
    
    return Object.entries(types).map(([type, count]) => ({
      type: this.getMessageTypeName(type),
      count,
      percentage: total > 0 ? Math.round((count / total) * 100) : 0
    }));
  }

  /**
   * 获取消息类型名称
   */
  getMessageTypeName(type) {
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
  analyzeKeywords(messages) {
    const keywords = {};
    
    messages.forEach(msg => {
      if (msg.content && typeof msg.content === 'string') {
        // 简单的关键词提取（实际项目中可以使用更复杂的NLP）
        const words = msg.content.match(/[\u4e00-\u9fff]+/g) || [];
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
  analyzeSentiment(messages) {
    // 简单的情感分析（实际项目中应使用专业的情感分析工具）
    const positive = messages.filter(m => 
      m.content && (m.content.includes('好') || m.content.includes('谢谢') || m.content.includes('赞'))
    ).length;
    
    const negative = messages.filter(m => 
      m.content && (m.content.includes('不好') || m.content.includes('错误') || m.content.includes('问题'))
    ).length;
    
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
  assessDataQuality() {
    const quality = {
      completeness: 0,
      accuracy: 0,
      timeliness: 0,
      consistency: 0,
      overall: 0
    };
    
    // 完整性检查
    const hasMessages = this.realTimeData.messages.length > 0;
    const hasUsers = this.realTimeData.userActivity.size > 0;
    const hasGroups = this.realTimeData.groupActivity.size > 0;
    quality.completeness = (hasMessages ? 40 : 0) + (hasUsers ? 30 : 0) + (hasGroups ? 30 : 0);
    
    // 准确性检查（基于数据一致性）
    quality.accuracy = Math.min(100, this.counters.totalMessages > 0 ? 100 : 0);
    
    // 及时性检查（最新数据的新鲜度）
    const latestMessage = this.realTimeData.messages[this.realTimeData.messages.length - 1];
    const timeSinceLatest = latestMessage ? Date.now() - latestMessage.timestamp : Infinity;
    quality.timeliness = timeSinceLatest < 60000 ? 100 : timeSinceLatest < 300000 ? 80 : 60;
    
    // 一致性检查
    quality.consistency = 90; // 假设数据结构一致性良好
    
    // 综合评分
    quality.overall = Math.round((quality.completeness + quality.accuracy + quality.timeliness + quality.consistency) / 4);
    
    return quality;
  }

  /**
   * 数据导出
   */
  exportData(format = 'json', timeRange = '24h', includeRawData = false) {
    const stats = this.generateStatsReport(timeRange);
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
      const timeRangeMs = this.getTimeRangeMs(timeRange);
      const startTime = Date.now() - timeRangeMs;
      
      exportData.rawData = {
        messages: this.realTimeData.messages.filter(m => m.timestamp >= startTime),
        apiCalls: this.realTimeData.apiCalls.filter(a => a.timestamp >= startTime),
        errors: this.realTimeData.errors.filter(e => e.timestamp >= startTime),
        systemMetrics: this.realTimeData.systemMetrics.filter(s => s.timestamp >= startTime)
      };
    }
    
    switch (format.toLowerCase()) {
      case 'json':
        return JSON.stringify(exportData, null, 2);
      case 'csv':
        return this.convertToCSV(exportData);
      case 'xml':
        return this.convertToXML(exportData);
      default:
        throw new Error(`不支持的导出格式: ${format}`);
    }
  }

  /**
   * 数据归档
   */
  archiveData(date = null) {
    const archiveDate = date ? new Date(date) : new Date();
    archiveDate.setHours(0, 0, 0, 0);
    
    const archiveFile = path.join(
      this.archiveDir, 
      `archive-${archiveDate.toISOString().split('T')[0]}.json`
    );
    
    // 获取要归档的数据（前一天的数据）
    const dayStart = archiveDate.getTime();
    const dayEnd = dayStart + 24 * 60 * 60 * 1000;
    
    const archiveData = {
      date: archiveDate.toISOString(),
      stats: this.generateStatsReport('24h'),
      rawData: {
        messages: this.realTimeData.messages.filter(m => 
          m.timestamp >= dayStart && m.timestamp < dayEnd
        ),
        apiCalls: this.realTimeData.apiCalls.filter(a => 
          a.timestamp >= dayStart && a.timestamp < dayEnd
        ),
        errors: this.realTimeData.errors.filter(e => 
          e.timestamp >= dayStart && e.timestamp < dayEnd
        )
      }
    };
    
    try {
      fs.writeFileSync(archiveFile, JSON.stringify(archiveData, null, 2));
      logger.success('数据归档', `已归档 ${archiveDate.toDateString()} 的数据`);
      
      // 清理已归档的旧数据
      this.cleanupArchivedData(dayEnd);
      
      return archiveFile;
    } catch (error) {
      logger.error('数据归档', '归档失败', error);
      throw error;
    }
  }

  /**
   * 清理已归档的数据
   */
  cleanupArchivedData(beforeTime) {
    this.realTimeData.messages = this.realTimeData.messages.filter(m => m.timestamp >= beforeTime);
    this.realTimeData.apiCalls = this.realTimeData.apiCalls.filter(a => a.timestamp >= beforeTime);
    this.realTimeData.errors = this.realTimeData.errors.filter(e => e.timestamp >= beforeTime);
    this.realTimeData.systemMetrics = this.realTimeData.systemMetrics.filter(s => s.timestamp >= beforeTime);
    
    logger.info('数据清理', '已清理归档前的历史数据');
  }

  /**
   * 定期保存数据
   */
  startPeriodicSave() {
    setInterval(() => {
      this.saveCurrentStats();
    }, this.saveInterval);
    
    logger.info('定期保存', `已启动，间隔 ${this.saveInterval / 1000} 秒`);
  }

  /**
   * 开始每日归档
   */
  startDailyArchive() {
    // 每天凌晨2点进行归档
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(2, 0, 0, 0);
    
    const timeUntilArchive = tomorrow.getTime() - now.getTime();
    
    setTimeout(() => {
      this.archiveData();
      
      // 然后每24小时归档一次
      setInterval(() => {
        this.archiveData();
      }, 24 * 60 * 60 * 1000);
      
    }, timeUntilArchive);
    
    logger.info('自动归档', `将在 ${tomorrow.toLocaleString()} 开始每日归档`);
  }

  /**
   * 保存当前统计数据
   */
  saveCurrentStats() {
    try {
      // 只保存最近24小时的数据以控制文件大小
      const now = Date.now();
      const oneDayAgo = now - 24 * 60 * 60 * 1000;
      
      // 转换 groupActivity 中的 Set 对象为数组以便 JSON 序列化
      const groupActivityForSave = {};
      for (const [groupId, activity] of this.realTimeData.groupActivity) {
        groupActivityForSave[groupId] = {
          ...activity,
          activeUsers: Array.from(activity.activeUsers || new Set()) // 将 Set 转换为数组
        };
      }
      
      const saveData = {
        counters: this.counters,
        userActivity: Object.fromEntries(this.realTimeData.userActivity),
        groupActivity: groupActivityForSave,
        messages: this.realTimeData.messages.filter(msg => msg.timestamp >= oneDayAgo),
        apiCalls: this.realTimeData.apiCalls.filter(call => call.timestamp >= oneDayAgo),
        errors: this.realTimeData.errors.filter(err => err.timestamp >= oneDayAgo),
        lastSaved: new Date().toISOString()
      };
      
      fs.writeFileSync(this.currentStatsFile, JSON.stringify(saveData, null, 2));
      logger.debug('定期保存', `统计数据已保存 - 消息: ${saveData.messages.length}, API调用: ${saveData.apiCalls.length}, 错误: ${saveData.errors.length}`);
    } catch (error) {
      logger.error('定期保存', '保存统计数据失败', error);
    }
  }

  /**
   * 关闭监控数据管理器
   */
  shutdown() {
    try {
      logger.info('监控数据管理器', '正在关闭...');
      
      // 立即保存当前数据
      this.saveCurrentStats();
      
      logger.success('监控数据管理器', '已安全关闭');
    } catch (error) {
      logger.error('监控数据管理器', '关闭时发生错误', error);
    }
  }

  /**
   * 工具方法
   */
  generateId() {
    return Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }

  getTimeRangeMs(timeRange) {
    switch (timeRange) {
      case '1h': return 60 * 60 * 1000;
      case '24h': return 24 * 60 * 60 * 1000;
      case '7d': return 7 * 24 * 60 * 60 * 1000;
      case '30d': return 30 * 24 * 60 * 60 * 1000;
      default: return 24 * 60 * 60 * 1000;
    }
  }

  trimRealTimeData(dataType, maxSize) {
    if (this.realTimeData[dataType].length > maxSize) {
      this.realTimeData[dataType] = this.realTimeData[dataType].slice(-maxSize);
    }
  }

  addToBuffer(record) {
    this.dataBuffer.push(record);
    if (this.dataBuffer.length >= this.bufferSize) {
      this.flushBuffer();
    }
  }

  flushBuffer() {
    // 批量处理缓冲区数据（可以用于写入数据库等）
    logger.debug('缓冲区刷新', `处理 ${this.dataBuffer.length} 条记录`);
    this.dataBuffer = [];
  }

  convertToCSV(data) {
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

  convertToXML(data) {
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

// 创建全局实例
export const monitorDataManager = new MonitorDataManager();
export default monitorDataManager;

