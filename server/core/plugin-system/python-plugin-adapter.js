/**
 * Python插件适配器
 * 通过进程间通信与Python插件进程交互
 */

import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import readline from 'readline';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { getLocalTime } from '../../utils/timezone-helper.js';
import { PluginStatistics } from './plugin-statistics.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class PythonPluginAdapter extends EventEmitter {
  constructor(pluginInfo, context) {
    super();
    this.info = pluginInfo;
    this.context = context;
    this.process = null;
    this.pendingRequests = new Map();
    this.isReady = false;
    this.isEnabled = false;
    
    // 添加事件处理器映射（兼容JS插件的接口）
    this.eventHandlers = new Map();
    this.commandHandlers = new Map();
    
    // 【统一统计模块】使用 PluginStatistics 管理所有统计数据
    this.stats = new PluginStatistics(pluginInfo.id, null);
    
    // 插件注册信息
    this.registeredCommands = new Map();
    this.scheduledTasks = new Map();
    
    // 进程监控数据（Python插件特有）
    this.processMonitor = {
      pid: null,
      startTime: null,
      isAlive: false,
      restartCount: 0,
      lastRestartTime: null,
      cpuUsage: [],
      memoryUsage: [],
      healthChecks: []
    };
    
    // IPC响应时间监控（Python插件特有）
    this.responseTime = [];
    
    // 线程安全检测（Python插件特有，对应JS插件的asyncSafety）
    this.threadSafety = {
      concurrentRequests: 0,
      maxConcurrentRequests: 0,
      requestQueue: [],
      warnings: []
    };
    
    // 【核心保护机制】保护关键属性不被修改
    this._protectCoreProperties();
  }
  
  /**
   * 【核心保护机制】保护关键属性不被覆盖或修改
   */
  _protectCoreProperties() {
    const protectedProperties = ['stats', 'info', 'context', 'isReady', 'isEnabled'];
    
    for (const propName of protectedProperties) {
      try {
        const currentValue = this[propName];
        
        // 对于 stats，确保它是 PluginStatistics 实例
        if (propName === 'stats' && !(currentValue instanceof PluginStatistics)) {
          console.warn(`⚠️ [Python:${this.info.id}] stats 属性类型错误，正在修复...`);
          this[propName] = new PluginStatistics(this.info.id, null);
        }
        
        // 使用 Object.defineProperty 锁定属性
        Object.defineProperty(this, propName, {
          value: this[propName],
          writable: propName === 'isReady' || propName === 'isEnabled', // 状态属性可写
          configurable: false,
          enumerable: true
        });
      } catch (error) {
        // 如果属性已经被保护，忽略错误
        if (error.message && !error.message.includes('Cannot redefine property')) {
          console.error(`保护Python插件属性 ${propName} 失败:`, error);
        }
      }
    }
  }

  /**
   * 启动Python插件进程
   */
  async start() {
    try {
      // 查找Python解释器
      const pythonPath = this.getPythonPath();
      
      // 获取插件主文件
      const mainFile = path.join(this.info.path, this.info.runtime?.main || 'main.py');
      
      // 仅在debug模式下显示详细路径
      if (process.env.LOG_LEVEL === 'debug') {
        console.log(`🐍 Python: ${pythonPath}`);
        console.log(`📄 主文件: ${mainFile}`);
      }
      
      if (!fs.existsSync(mainFile)) {
        throw new Error(`Python插件主文件不存在: ${mainFile}`);
      }
      
      // 启动Python进程
      this.process = spawn(pythonPath, [mainFile], {
        cwd: this.info.path,
        env: {
          ...process.env,
          PYTHONUNBUFFERED: '1',  // 禁用Python输出缓冲
          PYTHONIOENCODING: 'utf-8',  // 强制使用UTF-8编码
          KIBOT_PLUGIN_ID: this.info.id
        },
        stdio: ['pipe', 'pipe', 'pipe']
      });
      
      // 记录进程信息
      this.processMonitor.pid = this.process.pid;
      this.processMonitor.startTime = Date.now();
      this.processMonitor.isAlive = true;
      
      // 设置进程事件
      this.setupProcessHandlers();
      
      // 设置通信
      this.setupCommunication();
      
      // 启动进程监控
      this.startProcessMonitoring();
      
      // 等待Python进程准备就绪
      await this.waitForReady();
      
      return true;
    } catch (error) {
      console.error(`❌ 启动失败 ${this.info.name}:`, error.message);
      throw error;
    }
  }

  /**
   * 获取Python解释器路径
   */
  getPythonPath() {
    // 优先使用配置的Python路径
    if (this.info.runtime?.pythonPath) {
      return this.info.runtime.pythonPath;
    }
    
    // 使用系统Python
    return process.platform === 'win32' ? 'python' : 'python3';
  }

  /**
   * 设置进程处理器
   */
  setupProcessHandlers() {
    this.process.on('error', (error) => {
      console.error(`❌ Python进程错误 ${this.info.name}:`, error);
      this.emit('error', error);
    });

    this.process.on('exit', (code, signal) => {
      // 只在异常退出时输出日志
      if (code !== 0 && code !== null) {
        console.error(`❌ Python进程异常退出 ${this.info.name}: code=${code}, signal=${signal}`);
      }
      this.isReady = false;
      this.emit('exit', code, signal);
      
      // 如果是异常退出，可能需要重启
      if (code !== 0 && this.isEnabled) {
        console.log(`🔄 尝试重启Python插件: ${this.info.name}`);
        setTimeout(() => this.start(), 3000);
      }
    });
  }

  /**
   * 设置IPC通信
   */
  setupCommunication() {
    // 设置stdout编码为UTF-8
    this.process.stdout.setEncoding('utf8');
    this.process.stderr.setEncoding('utf8');
    
    // 使用readline逐行读取stdout
    const rl = readline.createInterface({
      input: this.process.stdout,
      crlfDelay: Infinity
    });

    rl.on('line', (line) => {
      if (!line.trim()) return;
      
      try {
        const message = JSON.parse(line);
        this.handleMessage(message);
      } catch (error) {
        console.error(`❌ 解析Python消息失败 ${this.info.name}:`, error);
        console.error(`消息内容: ${line}`);
      }
    });

    // 监听stderr（日志和错误）
    const stderrRl = readline.createInterface({
      input: this.process.stderr,
      crlfDelay: Infinity
    });

    stderrRl.on('line', (line) => {
      if (line.trim()) {
        const timestamp = getLocalTime();
        // 检查是否已经包含前缀（避免重复）
        if (line.startsWith(`[Python:${this.info.id}]`)) {
          console.log(`[${timestamp}] ${line}`);
        } else {
          console.log(`[${timestamp}] [Python:${this.info.id}] ${line}`);
        }
      }
    });
  }

  /**
   * 处理收到的消息
   */
  async handleMessage(message) {
    const { id, type, action, data } = message;

    switch (type) {
      case 'response':
        this.handleResponse(message);
        break;
      
      case 'request':
        await this.handleRequest(message);
        break;
      
      case 'event':
        await this.handleEvent(message);
        break;
      
      default:
        console.warn(`⚠️ 未知消息类型: ${type}`);
    }
  }

  /**
   * 处理响应消息
   */
  handleResponse(message) {
    const { id, data, error } = message;
    
    const timestamp = getLocalTime();
    
    if (this.pendingRequests.has(id)) {
      const { resolve, reject } = this.pendingRequests.get(id);
      this.pendingRequests.delete(id);
      
      if (error) {
        console.error(`[${timestamp}] [Python:${this.info.id}] ❌ 收到错误响应, ID: ${id}, 错误: ${error}`);
        reject(new Error(error));
      } else {
        console.log(`[${timestamp}] [Python:${this.info.id}] ✅ 收到成功响应, ID: ${id}`);
        resolve(data);
      }
    } else {
      console.warn(`[${timestamp}] [Python:${this.info.id}] ⚠️ 收到未知请求的响应, ID: ${id} (可能已超时)`);
    }
  }

  /**
   * 处理Python发来的请求
   */
  async handleRequest(message) {
    const { id, action, data } = message;
    
    const timestamp = getLocalTime();
    console.log(`[${timestamp}] [Python:${this.info.id}] 📥 收到请求: ${action}, ID: ${id}`);
    
    try {
      let result;
      
      switch (action) {
        case 'callApi':
          result = await this.handleApiCall(data);
          break;
        
        case 'registerCommand':
          result = await this.handleRegisterCommand(data);
          break;
        
        case 'registerSchedule':
          result = await this.handleRegisterSchedule(data);
          break;
        
        case 'storage.get':
          result = await this.handleStorageGet(data);
          break;
        
        case 'storage.set':
          result = await this.handleStorageSet(data);
          break;
        
        case 'storage.delete':
          result = await this.handleStorageDelete(data);
          break;
        
        case 'storage.has':
          result = await this.handleStorageHas(data);
          break;
        
        case 'storage.keys':
          result = await this.handleStorageKeys(data);
          break;
        
        case 'storage.clear':
          result = await this.handleStorageClear(data);
          break;
        
        case 'notify':
          result = await this.handleNotify(data);
          break;
        
        default:
          throw new Error(`Unknown action: ${action}`);
      }
      
      this.sendResponse(id, result);
    } catch (error) {
      this.sendError(id, error.message);
    }
  }

  /**
   * 处理事件消息
   */
  async handleEvent(message) {
    const { action, data } = message;
    
    if (action === 'customEvent') {
      this.context.eventBus?.emit(data.event_type, data.data);
    }
  }

  /**
   * 调用QQ Bot API
   */
  async handleApiCall(data) {
    // 兼容两种字段名：action（Python端）和 api（统一标准）
    const action = data.action || data.api;
    const params = data.params || {};
    
    if (!action) {
      throw new Error('API action is required');
    }
    
    const timestamp = getLocalTime();
    console.log(`[${timestamp}] [Python:${this.info.id}] 🔄 调用API: ${action}`);
    
    try {
      const result = await this.context.apiService.call(action, params);
      console.log(`[${timestamp}] [Python:${this.info.id}] ✅ API调用成功: ${action}`);
      return result;
    } catch (error) {
      console.log(`[${timestamp}] [Python:${this.info.id}] ❌ API调用失败: ${action}`, error);
      throw error;
    }
  }

  /**
   * 注册指令
   */
  async handleRegisterCommand(data) {
    const { command, plugin, ...options } = data;
    
    const commandInfo = {
      command,
      plugin: plugin || this.info.id,
      type: 'custom',
      registeredAt: Date.now(),
      executionCount: 0,
      ...options,
      handler: async (event, args) => {
        // 转发到Python进程
        await this.dispatchCommand(command, event, args);
      }
    };
    
    this.registeredCommands.set(command, commandInfo);
    this.context.commandRegistry?.register(commandInfo);
    
    return { success: true };
  }

  /**
   * 注册定时任务
   */
  async handleRegisterSchedule(data) {
    const { name, cron } = data;
    
    if (this.context.scheduler) {
      const task = this.context.scheduler.create(name, cron, async () => {
        // 转发到Python进程
        await this.dispatchTask(name);
      });
      
      this.scheduledTasks.set(name, { name, cron, task });
      return { success: true };
    }
    
    return { success: false, error: 'Scheduler not available' };
  }

  /**
   * 存储操作
   */
  async handleStorageGet(data) {
    const { key } = data;
    return this.context.createStorage(this.info.id).get(key);
  }

  async handleStorageSet(data) {
    const { key, value } = data;
    return this.context.createStorage(this.info.id).set(key, value);
  }

  async handleStorageDelete(data) {
    const { key } = data;
    return this.context.createStorage(this.info.id).delete(key);
  }

  async handleStorageHas(data) {
    const { key } = data;
    const storage = this.context.createStorage(this.info.id);
    const value = storage.get(key);
    return value !== undefined;
  }

  async handleStorageKeys() {
    // 需要实现keys方法
    return [];
  }

  async handleStorageClear() {
    // 需要实现clear方法
    return true;
  }

  /**
   * 发送通知
   */
  async handleNotify(data) {
    this.context.notificationService?.send({
      type: `plugin.${this.info.id}.${data.type}`,
      data: data.data,
      timestamp: Date.now()
    });
    return { success: true };
  }

  /**
   * 等待Python进程就绪
   */
  async waitForReady(timeout = 10000) {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error('Python插件启动超时'));
      }, timeout);

      // 发送load命令
      this.sendCommand('load', {
        pluginInfo: this.info,
        context: {
          apiEndpoint: 'ipc',  // 使用IPC通信
          authToken: 'internal'
        }
      }).then(() => {
        clearTimeout(timeoutId);
        this.isReady = true;
        resolve();
      }).catch((error) => {
        clearTimeout(timeoutId);
        reject(error);
      });
    });
  }

  /**
   * 发送命令到Python进程
   */
  async sendCommand(action, data = {}, timeout = 30000) {
    if (!this.process || this.process.killed) {
      const error = new Error(`Python进程未运行: ${this.info.id}`);
      console.error(`❌ [Python:${this.info.id}]`, error.message);
      throw error;
    }

    const id = this.generateId();
    const startTime = Date.now();
    
    // 线程安全检测
    this.threadSafety.concurrentRequests++;
    this.checkThreadSafety();
    
    const message = {
      id,
      type: 'request',
      action,
      data,
      timestamp: startTime
    };
    
    const timestamp = getLocalTime();
    console.log(`[${timestamp}] [Python:${this.info.id}] 🔄 发送IPC请求: ${action}, ID: ${id}`);

    try {
      const result = await new Promise((resolve, reject) => {
        // 设置超时
        const timeoutId = setTimeout(() => {
          this.pendingRequests.delete(id);
          this.threadSafety.concurrentRequests--;
          
          const timeoutDuration = Date.now() - startTime;
          
          // 关闭相关操作超时是正常的，使用警告而不是错误
          const isShutdownAction = ['disable', 'unload', 'stop'].includes(action);
          
          if (isShutdownAction) {
            console.warn(`⚠️ [Python:${this.info.id}] 关闭操作超时（正常）: ${action}, 耗时: ${timeoutDuration}ms`);
          } else {
            console.error(`❌ [Python:${this.info.id}] IPC请求超时: ${action}, ID: ${id}, 耗时: ${timeoutDuration}ms`);
            console.error(`   当前待处理请求数: ${this.pendingRequests.size}`);
            console.error(`   并发请求数: ${this.threadSafety.concurrentRequests}`);
            console.error(`   进程状态: ${this.process ? (this.process.killed ? 'killed' : 'running') : 'null'}`);
          }
          
          reject(new Error(`Request timeout: ${action} (${timeoutDuration}ms)`));
        }, timeout);

        this.pendingRequests.set(id, {
          resolve: (result) => {
            clearTimeout(timeoutId);
            this.threadSafety.concurrentRequests--;
            
            // 记录IPC响应时间
            const duration = Date.now() - startTime;
            this.responseTime.push({
              timestamp: Date.now(),
              action,
              duration
            });
            
            if (this.responseTime.length > 100) {
              this.responseTime.shift();
            }
            
            console.log(`[${timestamp}] [Python:${this.info.id}] ✅ IPC响应成功: ${action}, ID: ${id}, 耗时: ${duration}ms`);
            
            resolve(result);
          },
          reject: (error) => {
            clearTimeout(timeoutId);
            this.threadSafety.concurrentRequests--;
            
            const duration = Date.now() - startTime;
            console.error(`❌ [Python:${this.info.id}] IPC请求被拒绝: ${action}, ID: ${id}, 耗时: ${duration}ms`);
            console.error(`   错误信息: ${error.message || error}`);
            
            reject(error);
          }
        });

        this.send(message);
      });
      
      return result;
    } catch (error) {
      // 确保并发计数正确
      if (this.threadSafety.concurrentRequests > 0) {
        this.threadSafety.concurrentRequests--;
      }
      throw error;
    }
  }

  /**
   * 发送消息到Python进程
   */
  send(message) {
    if (!this.process || this.process.killed) {
      console.error(`❌ 无法发送消息，Python进程未运行: ${this.info.name}`);
      return;
    }

    try {
      const json = JSON.stringify(message);
      this.process.stdin.write(json + '\n');
    } catch (error) {
      console.error(`❌ 发送消息失败 ${this.info.name}:`, error);
    }
  }

  /**
   * 发送响应
   */
  sendResponse(id, data) {
    const timestamp = getLocalTime();
    console.log(`[${timestamp}] [Python:${this.info.id}] 📤 发送响应, ID: ${id}`);
    this.send({
      id,
      type: 'response',
      data,
      timestamp: Date.now()
    });
  }

  /**
   * 发送错误响应
   */
  sendError(id, error) {
    this.send({
      id,
      type: 'response',
      error,
      timestamp: Date.now()
    });
  }

  /**
   * 分发事件到Python
   * 【强制追踪】确保统计和性能数据无论成功失败都被记录
   */
  async dispatchEvent(eventType, eventData) {
    // ========== SDK强制执行：统计数据收集（总是记录，即使插件未准备好） ==========
    this.stats.incrementEventHandled(eventType);
    
    if (!this.isReady || !this.isEnabled) return;
    
    const startTime = Date.now();
    let success = true;
    
    try {
      this.send({
        type: 'event',
        action: eventType,
        data: eventData,
        timestamp: Date.now()
      });
    } catch (error) {
      success = false;
      
      // ========== SDK强制执行：错误记录 ==========
      this.recordError('event', eventType, error);
      
      console.error(`❌ 分发事件到Python插件失败 ${this.info.name}:`, error);
      // 事件错误不抛出
    } finally {
      // ========== SDK强制执行：性能记录（无论成功失败） ==========
      const duration = Date.now() - startTime;
      this.recordPerformance('event', eventType, duration, success);
    }
  }

  /**
   * 分发指令到Python
   * 【强制追踪】确保统计和性能数据无论成功失败都被记录
   */
  async dispatchCommand(command, event, args) {
    if (!this.isReady || !this.isEnabled) {
      console.warn(`⚠️ [Python:${this.info.id}] 跳过命令分发 - 未就绪或已禁用: ${command}`);
      return;
    }
    
    // ========== SDK强制执行：统计数据收集（执行前） ==========
    this.stats.incrementCommandExecutions(command);
    
    const startTime = Date.now();
    let success = true;
    
    const timestamp = getLocalTime();
    console.log(`[${timestamp}] [Python:${this.info.id}] 📨 开始分发命令: ${command}`);
    
    try {
      const result = await this.sendCommand('dispatchCommand', {
        command,
        event: event || {},
        args: args || []
      }, 30000); // 30秒超时
      
      const duration = Date.now() - startTime;
      console.log(`[${timestamp}] [Python:${this.info.id}] ✅ 命令执行完成: ${command} (耗时: ${duration}ms)`);
      
      return result;
    } catch (error) {
      success = false;
      
      const duration = Date.now() - startTime;
      
      // ========== SDK强制执行：错误记录 ==========
      this.recordError('command', command, error);

      console.error(`❌ [Python:${this.info.id}] 命令执行失败: ${command} (耗时: ${duration}ms)`);
      console.error(`错误详情:`, error.message);
      console.error(`插件状态: ready=${this.isReady}, enabled=${this.isEnabled}, process=${this.process ? 'running' : 'stopped'}`);
      console.error(`待处理请求数: ${this.pendingRequests.size}`);
      
      // 不抛出错误，避免影响主流程
      // throw error;
    } finally {
      // ========== SDK强制执行：性能记录（无论成功失败） ==========
      const duration = Date.now() - startTime;
      this.recordPerformance('command', command, duration, success);
    }
  }

  /**
   * 分发定时任务到Python
   * 【强制追踪】确保统计和性能数据无论成功失败都被记录
   */
  async dispatchTask(taskName) {
    // 去掉插件ID前缀
    const simpleName = taskName.replace(`${this.info.id}.`, '');
    
    // ========== SDK强制执行：统计数据收集（总是记录，即使插件未准备好） ==========
    this.stats.incrementTasksExecuted(taskName);
    
    if (!this.isReady) return;
    
    const startTime = Date.now();
    let success = true;
    
    try {
      await this.sendCommand('dispatchTask', {
        taskName: simpleName
      });
    } catch (error) {
      success = false;
      
      // ========== SDK强制执行：错误记录 ==========
      this.recordError('task', simpleName, error);
      
      throw error;
    } finally {
      // ========== SDK强制执行：性能记录（无论成功失败） ==========
      const duration = Date.now() - startTime;
      this.recordPerformance('task', simpleName, duration, success);
    }
  }

  /**
   * 生命周期：启用插件
   */
  async onEnable() {
    this.isEnabled = true;
    
    // 注册通用事件处理器（用于主服务器分发事件）
    // 这样主服务器的 plugin.eventHandlers.has('message') 检查就能通过
    const eventTypes = ['message', 'notice', 'request', 'meta_event'];
    for (const eventType of eventTypes) {
      if (!this.eventHandlers.has(eventType)) {
        this.eventHandlers.set(eventType, [
          async (event) => {
            await this.dispatchEvent(eventType, event);
          }
        ]);
      }
    }
    
    await this.sendCommand('enable');
    // 移除重复的日志，由plugin-manager统一输出
  }

  /**
   * 生命周期：禁用插件
   */
  async onDisable() {
    this.isEnabled = false;
    try {
      // 尝试发送disable命令，但不阻塞（1秒超时）
      await Promise.race([
        this.sendCommand('disable', {}, 1000),
        new Promise(resolve => setTimeout(resolve, 1000))
      ]);
    } catch (error) {
      // 静默处理错误（关闭时超时是正常的）
    }
  }

  /**
   * 生命周期：卸载插件
   */
  async onUnload() {
    // 直接停止进程，不等待Python响应（避免卡住）
    await this.stop();
  }

  /**
   * 停止Python进程
   */
  async stop() {
    // 停止进程监控
    this.stopProcessMonitoring();
    
    if (this.process && !this.process.killed) {
      // 清理定时任务
      for (const [name, { task }] of this.scheduledTasks) {
        if (task && typeof task.stop === 'function') {
          task.stop();
        }
      }
      
      const processToKill = this.process;
      const pid = processToKill.pid;
      
      // 标记进程为已清理
      this.process = null;
      this.isReady = false;
      this.processMonitor.isAlive = false;
      
      // 直接强制终止进程（快速可靠）
      if (process.platform === 'win32') {
        // Windows: 使用taskkill强制终止进程树
        try {
          const { execSync } = require('child_process');
          execSync(`taskkill /pid ${pid} /T /F`, { 
            stdio: 'ignore',
            timeout: 2000
          });
        } catch (e) {
          // taskkill失败时使用kill
          try {
            processToKill.kill('SIGKILL');
          } catch (killError) {
            // 忽略错误
          }
        }
      } else {
        // Unix/Linux: 使用SIGKILL
        try {
          processToKill.kill('SIGKILL');
        } catch (error) {
          // 忽略错误
        }
      }
      
      // 等待进程真正退出（最多500ms）
      await new Promise(resolve => {
        const checkInterval = setInterval(() => {
          if (processToKill.killed || !processToKill.pid) {
            clearInterval(checkInterval);
            resolve();
          }
        }, 50);
        
        setTimeout(() => {
          clearInterval(checkInterval);
          resolve();
        }, 500);
      });
    }
  }
  
  /**
   * 启动进程监控
   */
  startProcessMonitoring() {
    // 每30秒检查一次进程状态
    this.monitorInterval = setInterval(() => {
      this.checkProcessHealth();
    }, 30 * 1000);
    
    // 立即执行一次
    this.checkProcessHealth();
  }
  
  /**
   * 停止进程监控
   */
  stopProcessMonitoring() {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
    }
  }
  
  /**
   * 检查进程健康状态
   */
  async checkProcessHealth() {
    if (!this.process || !this.process.pid) {
      return;
    }
    
    try {
      // 检查进程是否存活
      const isAlive = !this.process.killed;
      this.processMonitor.isAlive = isAlive;
      
      // 记录健康检查
      this.processMonitor.healthChecks.push({
        timestamp: Date.now(),
        isAlive,
        pid: this.process.pid,
        uptime: Date.now() - this.processMonitor.startTime
      });
      
      // 只保留最近50次检查
      if (this.processMonitor.healthChecks.length > 50) {
        this.processMonitor.healthChecks.shift();
      }
      
      // 记录内存使用（通过Node.js的process.memoryUsage无法获取子进程信息）
      // 这里记录一个标记，实际的内存监控需要Python端配合
      this.processMonitor.memoryUsage.push({
        timestamp: Date.now(),
        note: 'Requires Python process support'
      });
      
      if (this.processMonitor.memoryUsage.length > 100) {
        this.processMonitor.memoryUsage.shift();
      }
      
    } catch (error) {
      console.error(`进程监控错误 ${this.info.name}:`, error);
    }
  }
  
  /**
   * 【核心方法】记录错误
   * 确保所有错误都被捕获和统计
   */
  recordError(type, source, error) {
    const errorInfo = {
      type,
      source,
      message: error?.message || String(error),
      stack: error?.stack || new Error().stack,
      timestamp: Date.now(),
      pluginId: this.info.id,
      pluginName: this.info.name
    };
    
    // 使用统一的统计模块记录错误
    this.stats.recordError(type, source, error);
    
    // 输出错误日志
    console.log(`[${getLocalTime()}] [Python:${this.info.id}] ❌ [${type}:${source}] ${errorInfo.message}`);
  }
  
  /**
   * 【核心方法】记录性能指标
   * 确保所有操作都被追踪
   */
  recordPerformance(type, name, duration, success = true) {
    // 使用统一的统计模块记录性能
    this.stats.recordPerformance(type, name, duration, success);
  }
  
  /**
   * 记录输出日志
   */
  recordOutput(level, message, metadata = {}) {
    const output = {
      timestamp: Date.now(),
      level,
      message,
      metadata,
      isValid: this.validateOutputFormat(level, message)
    };
    
    // 使用统一的统计模块记录输出日志
    this.stats.recordOutput(level, message, metadata);
  }
  
  /**
   * 验证输出格式
   */
  validateOutputFormat(level, message) {
    const validLevels = ['info', 'warn', 'error', 'debug'];
    if (!validLevels.includes(level)) {
      return false;
    }
    
    if (typeof message !== 'string' || message.trim() === '') {
      return false;
    }
    
    if (message.length > 1000) {
      return false;
    }
    
    return true;
  }
  
  /**
   * 检查线程安全（并发请求检测）
   */
  checkThreadSafety() {
    if (this.threadSafety.concurrentRequests > this.threadSafety.maxConcurrentRequests) {
      this.threadSafety.maxConcurrentRequests = this.threadSafety.concurrentRequests;
    }
    
    // 如果并发请求过多，记录警告
    if (this.threadSafety.concurrentRequests > 10) {
      this.threadSafety.warnings.push({
        timestamp: Date.now(),
        concurrentRequests: this.threadSafety.concurrentRequests,
        message: 'High concurrent requests detected - potential thread safety issue'
      });
      
      // 只保留最近20条警告
      if (this.threadSafety.warnings.length > 20) {
        this.threadSafety.warnings.shift();
      }
    }
  }

  /**
   * 获取详细信息
   */
  /**
   * 获取插件详细信息（使用统一的统计模块）
   */
  getDetailedInfo() {
    // 从统计模块获取完整数据
    const statsInfo = this.stats.getDetailedInfo();
    
    return {
      basic: this.info,
      status: {
        isEnabled: this.isEnabled,
        isReady: this.isReady,
        lastActivity: statsInfo.statistics.lastActivity
      },
      commands: Array.from(this.registeredCommands.values()).map(cmd => ({
        command: cmd.command,
        type: cmd.type,
        description: cmd.description,
        usage: cmd.usage,
        executionCount: cmd.executionCount,
        lastExecuted: cmd.lastExecuted,
        lastError: cmd.lastError,
        registeredAt: cmd.registeredAt
      })),
      tasks: Array.from(this.scheduledTasks.values()).map(task => ({
        name: task.name,
        cron: task.cron,
        executionCount: task.executionCount,
        lastExecuted: task.lastExecuted,
        lastError: task.lastError,
        isActive: task.isActive,
        registeredAt: task.registeredAt
      })),
      errors: statsInfo.errors,
      statistics: statsInfo.statistics,
      performance: {
        ...statsInfo.performance,
        // 添加Python插件特有的IPC响应时间数据
        responseTime: this.responseTime.slice(-20),
        avgResponseTime: this.responseTime.length > 0 
          ? this.responseTime.reduce((sum, r) => sum + r.duration, 0) / this.responseTime.length 
          : 0
      },
      // Python插件特有的进程监控数据
      processMonitor: {
        pid: this.processMonitor.pid,
        startTime: this.processMonitor.startTime,
        isAlive: this.processMonitor.isAlive,
        restartCount: this.processMonitor.restartCount,
        lastRestartTime: this.processMonitor.lastRestartTime,
        uptime: this.processMonitor.startTime ? Date.now() - this.processMonitor.startTime : 0,
        healthChecks: this.processMonitor.healthChecks.slice(-10),
        memoryUsage: this.processMonitor.memoryUsage.slice(-20)
      },
      // Python插件使用threadSafety，对应JS插件的asyncSafety
      threadSafety: {
        concurrentRequests: this.threadSafety.concurrentRequests,
        maxConcurrentRequests: this.threadSafety.maxConcurrentRequests,
        warnings: this.threadSafety.warnings.slice(-10),
        isHealthy: this.threadSafety.warnings.length === 0 || 
                   (Date.now() - this.threadSafety.warnings[this.threadSafety.warnings.length - 1]?.timestamp > 60000)
      },
      rules: []  // Python插件暂不支持规则追踪
    };
  }

  /**
   * 生成唯一ID
   */
  generateId() {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

export default PythonPluginAdapter;

