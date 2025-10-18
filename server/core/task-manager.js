/**
 * KiBot 定时任务管理器
 * 支持创建、管理和执行定时任务
 */

import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/output-manager.js';

class TaskManager {
  constructor(mainServer) {
    this.mainServer = mainServer;
    this.tasks = new Map(); // 存储任务定义
    this.runningTasks = new Map(); // 存储运行中的任务
    this.taskHistory = []; // 任务执行历史
    this.maxHistorySize = 1000;
    
    // API回调函数
    this.apiCallback = null;
    this.broadcastCallback = null;
    
    // 任务数据文件路径 - 修复路径问题
    this.dataDir = path.join(process.cwd(), 'server', 'server', 'data');
    this.tasksFile = path.join(this.dataDir, 'tasks.json');
    this.taskHistoryFile = path.join(this.dataDir, 'task-history.json');
    
    // 确保数据目录存在
    this.ensureDataDirectory();
    
    // 加载已保存的任务
    this.loadTasks();
    this.loadTaskHistory();
    
    // 启动任务调度器
    this.startScheduler();
    
    logger.startup('任务管理器', '已初始化');
  }

  /**
   * 设置API回调函数
   */
  setApiCallback(callback) {
    this.apiCallback = callback;
    logger.success('任务管理器', 'API回调已设置');
  }

  /**
   * 设置广播回调函数
   */
  setBroadcastCallback(callback) {
    this.broadcastCallback = callback;
    logger.success('任务管理器', '广播回调已设置');
  }

  /**
   * 确保数据目录存在
   */
  ensureDataDirectory() {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
  }

  /**
   * 加载任务配置
   */
  loadTasks() {
    try {
      if (fs.existsSync(this.tasksFile)) {
        const data = fs.readFileSync(this.tasksFile, 'utf8');
        const tasksArray = JSON.parse(data);
        
        this.tasks.clear();
        tasksArray.forEach(task => {
          this.tasks.set(task.id, task);
        });
        
        logger.success('任务管理器', `已加载 ${this.tasks.size} 个任务`);
      } else {
        logger.info('任务管理器', '未找到任务配置文件，使用默认配置');
        this.createDefaultTasks();
      }
    } catch (error) {
      logger.error('任务管理器', '加载任务配置失败', error);
      this.createDefaultTasks();
    }
  }

  /**
   * 加载任务执行历史
   */
  loadTaskHistory() {
    try {
      if (fs.existsSync(this.taskHistoryFile)) {
        const data = fs.readFileSync(this.taskHistoryFile, 'utf8');
        this.taskHistory = JSON.parse(data);
        logger.info('任务管理器', `已加载 ${this.taskHistory.length} 条任务历史`);
      }
    } catch (error) {
      logger.error('任务管理器', '加载任务历史失败', error);
      this.taskHistory = [];
    }
  }

  /**
   * 保存任务配置
   */
  saveTasks() {
    try {
      const tasksArray = Array.from(this.tasks.values());
      fs.writeFileSync(this.tasksFile, JSON.stringify(tasksArray, null, 2));
      logger.debug('任务管理器', '任务配置已保存');
    } catch (error) {
      logger.error('任务管理器', '保存任务配置失败', error);
    }
  }

  /**
   * 保存任务执行历史
   */
  saveTaskHistory() {
    try {
      // 限制历史记录数量
      if (this.taskHistory.length > this.maxHistorySize) {
        this.taskHistory = this.taskHistory.slice(-this.maxHistorySize);
      }
      
      fs.writeFileSync(this.taskHistoryFile, JSON.stringify(this.taskHistory, null, 2));
      logger.debug('任务管理器', '任务历史已保存');
    } catch (error) {
      logger.error('任务管理器', '保存任务历史失败', error);
    }
  }

  /**
   * 创建默认任务示例
   */
  createDefaultTasks() {
    const defaultTasks = [
      {
        id: 'demo-daily-greeting',
        name: '每日问候',
        description: '每天早上8点发送问候消息（使用简化格式：08:00）',
        cron: '08:00',
        enabled: false,
        actions: [
          {
            type: 'send_message',
            params: {
              target: 'group',
              target_id: '123456789',
              message: '早上好！新的一天开始了，祝大家今天愉快！'
            }
          }
        ],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        lastRun: null,
        nextRun: null,
        runCount: 0
      },
      {
        id: 'demo-system-status',
        name: '系统状态检查',
        description: '每小时检查系统状态（使用间隔格式：every_1_hours）',
        cron: 'every_1_hours',
        enabled: false,
        actions: [
          {
            type: 'system_check',
            params: {
              check_memory: true,
              check_connections: true,
              notify_threshold: 80
            }
          }
        ],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        lastRun: null,
        nextRun: null,
        runCount: 0
      },
      {
        id: 'demo-frequent-check',
        name: '频繁检查示例',
        description: '每5分钟执行一次（使用间隔格式：every_5_minutes）',
        cron: 'every_5_minutes',
        enabled: false,
        actions: [
          {
            type: 'notification',
            params: {
              title: '定时检查',
              message: '这是一个每5分钟执行一次的示例任务',
              level: 'info'
            }
          }
        ],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        lastRun: null,
        nextRun: null,
        runCount: 0
      }
    ];

    defaultTasks.forEach(task => {
      this.tasks.set(task.id, task);
    });

    this.saveTasks();
    logger.info('任务管理器', '已创建默认任务示例（使用友好的时间格式）');
  }

  /**
   * 启动任务调度器
   */
  startScheduler() {
    // 每30秒检查一次任务（提高响应速度）
    this.schedulerInterval = setInterval(() => {
      this.checkAndRunTasks();
    }, 30000); // 30秒

    // 立即执行一次检查
    this.checkAndRunTasks();
    
    logger.info('任务管理器', '任务调度器已启动（检查间隔: 30秒）');
  }

  /**
   * 停止任务调度器
   */
  stopScheduler() {
    if (this.schedulerInterval) {
      clearInterval(this.schedulerInterval);
      this.schedulerInterval = null;
    }

    // 停止所有运行中的任务
    this.runningTasks.forEach((task, taskId) => {
      if (task.timeout) {
        clearTimeout(task.timeout);
      }
    });
    this.runningTasks.clear();

    logger.info('任务管理器', '任务调度器已停止');
  }

  /**
   * 检查并运行到期的任务
   */
  checkAndRunTasks() {
    const now = new Date();
    logger.debug('任务调度器', `检查待执行任务，当前时间: ${now.toLocaleString()}`);
    
    let checkedCount = 0;
    let executedCount = 0;
    
    this.tasks.forEach((task, taskId) => {
      if (!task.enabled) {
        logger.debug('任务调度器', `任务 ${task.name} 已禁用，跳过`);
        return;
      }
      
      checkedCount++;
      
      // 如果是首次运行或上次运行后需要重新计算
      if (!task.nextRun || (task.lastRun && task.nextRun <= task.lastRun)) {
        const nextRun = this.calculateNextRun(task.cron, task.lastRun);
        task.nextRun = nextRun;
        logger.info('任务调度器', `计算任务 ${task.name} 下次运行时间: ${nextRun ? nextRun.toLocaleString() : '无法计算'}`);
      }
      
      // 检查是否需要运行
      if (task.nextRun && now >= task.nextRun) {
        logger.info('任务调度器', `触发任务: ${task.name} (预定: ${task.nextRun.toLocaleString()})`);
        executedCount++;
        this.executeTask(task);
      } else if (task.nextRun) {
        const timeUntilNext = Math.ceil((task.nextRun - now) / 1000);
        logger.debug('任务调度器', `任务 ${task.name} 等待中，还需 ${timeUntilNext} 秒`);
      }
    });
    
    if (checkedCount > 0) {
      logger.debug('任务调度器', `检查完成: 已检查 ${checkedCount} 个任务，执行 ${executedCount} 个任务`);
    }
  }

  /**
   * 计算下次运行时间（改进的cron解析）
   */
  calculateNextRun(cronExpression, lastRun) {
    try {
      // 支持简化的时间格式：HH:MM（如 "08:00"）
      if (cronExpression.match(/^\d{1,2}:\d{2}$/)) {
        const [hour, minute] = cronExpression.split(':').map(Number);
        const now = new Date();
        const next = new Date(now);
        next.setHours(hour, minute, 0, 0);
        
        // 如果今天的这个时间已经过了，设置为明天
        if (next <= now) {
          next.setDate(next.getDate() + 1);
        }
        
        logger.debug('任务管理器', `简化格式 ${cronExpression} 下次执行: ${next.toLocaleString()}`);
        return next;
      }
      
      // 支持间隔格式：every_N_minutes（如 "every_5_minutes"）
      if (cronExpression.startsWith('every_') && cronExpression.endsWith('_minutes')) {
        const minutes = parseInt(cronExpression.match(/every_(\d+)_minutes/)[1]);
        const now = new Date();
        const next = new Date(now);
        next.setSeconds(0, 0);
        
        // 如果有上次运行时间，从上次运行时间开始计算
        if (lastRun) {
          const lastRunDate = new Date(lastRun);
          next.setTime(lastRunDate.getTime() + minutes * 60 * 1000);
          // 如果计算出的时间还在过去，继续往后推
          while (next <= now) {
            next.setTime(next.getTime() + minutes * 60 * 1000);
          }
        } else {
          // 首次运行，设置为下一个整分钟
          next.setMinutes(next.getMinutes() + 1);
        }
        
        logger.debug('任务管理器', `间隔格式 ${cronExpression} 下次执行: ${next.toLocaleString()}`);
        return next;
      }
      
      // 支持间隔格式：every_N_hours（如 "every_1_hours"）
      if (cronExpression.startsWith('every_') && cronExpression.endsWith('_hours')) {
        const hours = parseInt(cronExpression.match(/every_(\d+)_hours/)[1]);
        const now = new Date();
        const next = new Date(now);
        next.setMinutes(0, 0, 0);
        
        if (lastRun) {
          const lastRunDate = new Date(lastRun);
          next.setTime(lastRunDate.getTime() + hours * 60 * 60 * 1000);
          while (next <= now) {
            next.setTime(next.getTime() + hours * 60 * 60 * 1000);
          }
        } else {
          next.setHours(next.getHours() + 1);
        }
        
        logger.debug('任务管理器', `间隔格式 ${cronExpression} 下次执行: ${next.toLocaleString()}`);
        return next;
      }
      
      // 标准 cron 格式解析：分 时 日 月 周
      const parts = cronExpression.split(' ');
      if (parts.length !== 5) {
        logger.error('任务管理器', `无效的cron表达式: ${cronExpression}`);
        return null;
      }

      const [minute, hour, day, month, dayOfWeek] = parts;
      const now = new Date();
      const next = new Date(now);
      next.setSeconds(0, 0);

      // 每天特定时间：M H * * *
      if (day === '*' && month === '*' && dayOfWeek === '*' && minute !== '*' && hour !== '*') {
        const m = parseInt(minute);
        const h = parseInt(hour);
        if (!isNaN(h) && !isNaN(m)) {
          next.setHours(h, m, 0, 0);
          // 如果今天的这个时间已经过了，设置为明天
          if (next <= now) {
            next.setDate(next.getDate() + 1);
          }
          logger.debug('任务管理器', `每日定时 ${cronExpression} 下次执行: ${next.toLocaleString()}`);
          return next;
        }
      }
      
      // 每小时：0 * * * *
      if (minute === '0' && hour === '*' && day === '*' && month === '*' && dayOfWeek === '*') {
        next.setMinutes(0, 0, 0);
        if (next <= now) {
          next.setHours(next.getHours() + 1);
        }
        logger.debug('任务管理器', `每小时 ${cronExpression} 下次执行: ${next.toLocaleString()}`);
        return next;
      }
      
      // 每分钟：* * * * *
      if (minute === '*' && hour === '*' && day === '*' && month === '*' && dayOfWeek === '*') {
        next.setSeconds(0, 0);
        if (next <= now) {
          next.setMinutes(next.getMinutes() + 1);
        }
        logger.debug('任务管理器', `每分钟 ${cronExpression} 下次执行: ${next.toLocaleString()}`);
        return next;
      }
      
      // 每N分钟：*/N * * * *
      if (minute.startsWith('*/') && hour === '*' && day === '*' && month === '*' && dayOfWeek === '*') {
        const interval = parseInt(minute.substring(2));
        if (!isNaN(interval)) {
          const currentMinutes = next.getMinutes();
          const nextMinutes = Math.ceil((currentMinutes + 1) / interval) * interval;
          
          if (nextMinutes >= 60) {
            next.setHours(next.getHours() + 1);
            next.setMinutes(nextMinutes % 60, 0, 0);
          } else {
            next.setMinutes(nextMinutes, 0, 0);
          }
          
          logger.debug('任务管理器', `每${interval}分钟 ${cronExpression} 下次执行: ${next.toLocaleString()}`);
          return next;
        }
      }
      
      // 每周特定时间：M H * * D
      if (day === '*' && month === '*' && dayOfWeek !== '*' && minute !== '*' && hour !== '*') {
        const m = parseInt(minute);
        const h = parseInt(hour);
        const dow = parseInt(dayOfWeek);
        
        if (!isNaN(m) && !isNaN(h) && !isNaN(dow)) {
          next.setHours(h, m, 0, 0);
          
          // 计算下一个指定星期几
          const currentDow = now.getDay();
          let daysToAdd = dow - currentDow;
          if (daysToAdd < 0 || (daysToAdd === 0 && next <= now)) {
            daysToAdd += 7;
          }
          
          next.setDate(next.getDate() + daysToAdd);
          logger.debug('任务管理器', `每周${dow} ${cronExpression} 下次执行: ${next.toLocaleString()}`);
          return next;
        }
      }

      logger.warning('任务管理器', `不支持的cron表达式: ${cronExpression}`);
      return null;
    } catch (error) {
      logger.error('任务管理器', `解析cron表达式失败: ${cronExpression}`, error);
      return null;
    }
  }

  /**
   * 执行任务
   */
  async executeTask(task) {
    if (this.runningTasks.has(task.id)) {
      logger.warning('任务管理器', `任务 ${task.name} 正在运行中，跳过此次执行`);
      return;
    }

    const executionId = uuidv4();
    const startTime = Date.now();

    logger.info('任务管理器', `开始执行任务: ${task.name} (${task.id})`);

    // 标记任务为运行中
    this.runningTasks.set(task.id, {
      executionId,
      startTime,
      task
    });

    try {
      // 执行任务动作
      for (const action of task.actions) {
        await this.executeAction(action, task);
      }

      // 任务执行成功
      const endTime = Date.now();
      const duration = endTime - startTime;

      // 更新任务统计
      task.lastRun = new Date();
      task.runCount = (task.runCount || 0) + 1;

      // 记录执行历史
      this.addTaskHistory({
        taskId: task.id,
        taskName: task.name,
        executionId,
        startTime: new Date(startTime),
        endTime: new Date(endTime),
        duration,
        status: 'success',
        message: '任务执行成功'
      });

      logger.success('任务管理器', `任务执行完成: ${task.name} (耗时: ${duration}ms)`);

    } catch (error) {
      // 任务执行失败
      const endTime = Date.now();
      const duration = endTime - startTime;

      this.addTaskHistory({
        taskId: task.id,
        taskName: task.name,
        executionId,
        startTime: new Date(startTime),
        endTime: new Date(endTime),
        duration,
        status: 'error',
        message: error.message || '任务执行失败',
        error: error.stack
      });

      logger.error('任务管理器', `任务执行失败: ${task.name}`, error);
    } finally {
      // 清理运行状态
      this.runningTasks.delete(task.id);
      
      // 保存任务配置和历史
      this.saveTasks();
      this.saveTaskHistory();
    }
  }

  /**
   * 执行任务动作
   */
  async executeAction(action, task) {
    switch (action.type) {
      case 'send_message':
        await this.executeSendMessage(action.params, task);
        break;
        
      case 'system_check':
        await this.executeSystemCheck(action.params, task);
        break;
        
      case 'call_api':
        await this.executeApiCall(action.params, task);
        break;
        
      case 'execute_command':
        await this.executeCommand(action.params, task);
        break;
        
      case 'notification':
        await this.executeNotification(action.params, task);
        break;
        
      default:
        throw new Error(`未知的动作类型: ${action.type}`);
    }
  }

  /**
   * 替换消息中的变量
   */
  replaceMessageVariables(message, task) {
    const now = new Date();
    const variables = {
      '{time}': now.toLocaleString('zh-CN'),
      '{date}': now.toLocaleDateString('zh-CN'),
      '{task_name}': task.name || '',
      '{task_id}': task.id || '',
      '{run_count}': (task.runCount || 0).toString()
    };

    let result = message;
    for (const [variable, value] of Object.entries(variables)) {
      result = result.replace(new RegExp(variable.replace(/[{}]/g, '\\$&'), 'g'), value);
    }
    
    return result;
  }

  /**
   * 执行发送消息动作
   */
  async executeSendMessage(params, task) {
    const { target, target_id, message } = params;
    
    if (!this.apiCallback) {
      throw new Error('API回调未设置，请检查任务管理器初始化');
    }

    // 替换消息中的变量
    const processedMessage = this.replaceMessageVariables(message, task);

    const action = target === 'private' ? 'send_private_msg' : 'send_group_msg';
    const idField = target === 'private' ? 'user_id' : 'group_id';
    
    const apiParams = {
      [idField]: parseInt(target_id),
      message: [{ type: 'text', data: { text: processedMessage } }]
    };

    logger.info('任务执行', `准备发送消息: ${action}`, apiParams);
    
    try {
      const response = await this.apiCallback(action, apiParams);
      logger.success('任务执行', `消息发送成功到 ${target}:${target_id}`, response);
    } catch (error) {
      logger.error('任务执行', `消息发送失败到 ${target}:${target_id}`, error);
      throw error;
    }
  }

  /**
   * 执行系统检查动作
   */
  async executeSystemCheck(params, task) {
    const { check_memory, check_connections, notify_threshold = 80 } = params;
    
    let alerts = [];

    if (check_memory) {
      const memUsage = process.memoryUsage();
      const memoryUsagePercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;
      
      if (memoryUsagePercent > notify_threshold) {
        alerts.push(`内存使用率过高: ${memoryUsagePercent.toFixed(1)}%`);
      }
    }

    if (check_connections) {
      const connectionsCount = this.mainServer.clients?.size || 0;
      if (connectionsCount === 0) {
        alerts.push('没有活跃的客户端连接');
      }
    }

    if (alerts.length > 0) {
      logger.warning('系统检查', alerts.join(', '));
      
      // 发送通知给管理员（如果配置了的话）
      if (this.broadcastCallback) {
        this.broadcastCallback({
          type: 'system_alert',
          data: {
            taskId: task.id,
            taskName: task.name,
            alerts,
            timestamp: new Date().toISOString()
          }
        });
      }
    } else {
      logger.info('系统检查', '系统状态正常');
    }
  }

  /**
   * 执行API调用动作
   */
  async executeApiCall(params, task) {
    const { action: apiAction, params: apiParams } = params;
    
    if (!this.apiCallback) {
      throw new Error('API回调未设置，请检查任务管理器初始化');
    }

    try {
      const response = await this.apiCallback(apiAction, apiParams);
      logger.success('任务执行', `API调用完成: ${apiAction}`, response);
    } catch (error) {
      logger.error('任务执行', `API调用失败: ${apiAction}`, error);
      throw error;
    }
  }

  /**
   * 执行命令动作
   */
  async executeCommand(params, task) {
    const { command, args = [] } = params;
    
    // 这里可以扩展支持系统命令或插件命令
    logger.info('任务执行', `执行命令: ${command} ${args.join(' ')}`);
  }

  /**
   * 执行通知动作
   */
  async executeNotification(params, task) {
    const { title, message, level = 'info' } = params;
    
    if (this.broadcastCallback) {
      this.broadcastCallback({
        type: 'notification',
        data: {
          title,
          message,
          level,
          source: `任务: ${task.name}`,
          timestamp: new Date().toISOString()
        }
      });
    }

    logger.info('任务执行', `发送通知: ${title} - ${message}`);
  }

  /**
   * 添加任务执行历史
   */
  addTaskHistory(historyItem) {
    this.taskHistory.unshift(historyItem);
    
    // 限制历史记录数量
    if (this.taskHistory.length > this.maxHistorySize) {
      this.taskHistory = this.taskHistory.slice(0, this.maxHistorySize);
    }
  }

  /**
   * 创建新任务
   */
  createTask(taskData) {
    const task = {
      id: taskData.id || uuidv4(),
      name: taskData.name,
      description: taskData.description || '',
      cron: taskData.cron,
      enabled: taskData.enabled !== false,
      actions: taskData.actions || [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastRun: null,
      nextRun: null,
      runCount: 0
    };

    // 验证cron表达式
    if (!this.validateCronExpression(task.cron)) {
      throw new Error(`无效的cron表达式: ${task.cron}`);
    }

    this.tasks.set(task.id, task);
    this.saveTasks();

    logger.info('任务管理器', `已创建任务: ${task.name} (${task.id})`);
    
    // 立即触发一次检查，快速响应新任务
    if (task.enabled) {
      logger.info('任务管理器', '触发即时任务检查');
      setTimeout(() => this.checkAndRunTasks(), 100);
    }
    
    return task;
  }

  /**
   * 更新任务
   */
  updateTask(taskId, updates) {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`任务不存在: ${taskId}`);
    }

    // 如果更新了cron表达式，需要验证
    if (updates.cron && updates.cron !== task.cron) {
      if (!this.validateCronExpression(updates.cron)) {
        throw new Error(`无效的cron表达式: ${updates.cron}`);
      }
      // 重置nextRun，强制重新计算
      task.nextRun = null;
    }

    // 更新任务
    Object.assign(task, updates, {
      updatedAt: Date.now()
    });

    this.tasks.set(taskId, task);
    this.saveTasks();

    logger.info('任务管理器', `已更新任务: ${task.name} (${taskId})`);
    
    // 立即触发一次检查，快速响应任务更新
    if (task.enabled) {
      logger.info('任务管理器', '触发即时任务检查');
      setTimeout(() => this.checkAndRunTasks(), 100);
    }
    
    return task;
  }

  /**
   * 删除任务
   */
  deleteTask(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`任务不存在: ${taskId}`);
    }

    // 如果任务正在运行，先停止它
    if (this.runningTasks.has(taskId)) {
      const runningTask = this.runningTasks.get(taskId);
      if (runningTask.timeout) {
        clearTimeout(runningTask.timeout);
      }
      this.runningTasks.delete(taskId);
    }

    this.tasks.delete(taskId);
    this.saveTasks();

    logger.info('任务管理器', `已删除任务: ${task.name} (${taskId})`);
    return true;
  }

  /**
   * 立即执行任务
   */
  async runTaskNow(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`任务不存在: ${taskId}`);
    }

    logger.info('任务管理器', `手动执行任务: ${task.name} (${taskId})`);
    await this.executeTask(task);
  }

  /**
   * 启用/禁用任务
   */
  toggleTask(taskId, enabled) {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`任务不存在: ${taskId}`);
    }

    task.enabled = enabled;
    task.updatedAt = Date.now();
    
    // 启用时重置nextRun，确保重新计算
    if (enabled) {
      task.nextRun = null;
    }
    
    this.saveTasks();

    logger.info('任务管理器', `任务 ${task.name} 已${enabled ? '启用' : '禁用'}`);
    
    // 启用任务时立即触发检查
    if (enabled) {
      logger.info('任务管理器', '触发即时任务检查');
      setTimeout(() => this.checkAndRunTasks(), 100);
    }
    
    return task;
  }

  /**
   * 验证cron表达式
   */
  validateCronExpression(cron) {
    // 支持简化的时间格式：HH:MM
    if (/^\d{1,2}:\d{2}$/.test(cron)) {
      const [hour, minute] = cron.split(':').map(Number);
      return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
    }
    
    // 支持间隔格式：every_N_minutes 或 every_N_hours
    if (/^every_\d+_(minutes|hours)$/.test(cron)) {
      return true;
    }
    
    // 标准 cron 格式验证
    const parts = cron.split(' ');
    if (parts.length !== 5) {
      return false;
    }

    // 检查常用的表达式格式
    const validPatterns = [
      /^\d+$/, // 数字
      /^\*$/, // 星号
      /^\*\/\d+$/, // */N
      /^\d+-\d+$/, // N-M
      /^\d+(,\d+)*$/ // N,M,O
    ];

    return parts.every(part => 
      validPatterns.some(pattern => pattern.test(part))
    );
  }

  /**
   * 获取所有任务
   */
  getAllTasks() {
    return Array.from(this.tasks.values()).map(task => ({
      ...task,
      isRunning: this.runningTasks.has(task.id)
    }));
  }

  /**
   * 获取任务详情
   */
  getTask(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) {
      return null;
    }

    return {
      ...task,
      isRunning: this.runningTasks.has(taskId)
    };
  }

  /**
   * 获取任务执行历史
   */
  getTaskHistory(taskId = null, limit = 100) {
    let history = this.taskHistory;
    
    if (taskId) {
      history = history.filter(item => item.taskId === taskId);
    }
    
    return history.slice(0, limit);
  }

  /**
   * 清空任务执行历史
   */
  clearTaskHistory(taskId = null) {
    if (taskId) {
      // 清空特定任务的历史
      const beforeCount = this.taskHistory.length;
      this.taskHistory = this.taskHistory.filter(item => item.taskId !== taskId);
      const clearedCount = beforeCount - this.taskHistory.length;
      
      logger.info('任务管理器', `已清空任务 ${taskId} 的 ${clearedCount} 条历史记录`);
    } else {
      // 清空所有历史
      const clearedCount = this.taskHistory.length;
      this.taskHistory = [];
      
      logger.info('任务管理器', `已清空全部 ${clearedCount} 条历史记录`);
    }
    
    this.saveTaskHistory();
    return { cleared: taskId ? 'task' : 'all', count: taskId ? this.taskHistory.length : 0 };
  }

  /**
   * 获取统计信息
   */
  getStats() {
    const totalTasks = this.tasks.size;
    const enabledTasks = Array.from(this.tasks.values()).filter(t => t.enabled).length;
    const runningTasks = this.runningTasks.size;
    
    const recentHistory = this.taskHistory.slice(0, 100);
    const successCount = recentHistory.filter(h => h.status === 'success').length;
    const errorCount = recentHistory.filter(h => h.status === 'error').length;
    
    return {
      totalTasks,
      enabledTasks,
      runningTasks,
      successRate: recentHistory.length > 0 ? (successCount / recentHistory.length * 100).toFixed(1) : 0,
      recentExecutions: recentHistory.length,
      successCount,
      errorCount
    };
  }

  /**
   * 关闭任务管理器
   */
  shutdown() {
    this.stopScheduler();
    this.saveTasks();
    this.saveTaskHistory();
    logger.info('任务管理器', '已关闭');
  }
}

export default TaskManager;
