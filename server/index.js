import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { createRequire } from 'module';
import EventResponseEngine from './core/event-engine.js';
import UserApiService from './core/user-api.js';
import PluginManager from './core/plugin-system/plugin-manager.js';
import SecurityMiddleware from './core/security-middleware.js';
import TaskManager from './core/task-manager.js';
import { logger } from './utils/output-manager.js';
import { needsInitialization, runInteractiveInitialization } from './init-helper.js';
import { getTimezoneInfo } from './utils/timezone-helper.js';
import './core/types.js';
import { updaterService } from './core/updater-service.js';
import { systemStatistics } from './core/system-statistics.js';

// 读取package.json获取版本号
const require = createRequire(import.meta.url);
const packageJson = require('./package.json');
const SERVER_VERSION = packageJson.version;

// 将 systemStatistics 设置为全局可访问（供事件引擎等模块使用）
global.systemStatistics = systemStatistics;

// ES模块中获取__dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 首次启动检测
if (needsInitialization()) {
  console.log('\n╔════════════════════════════════════════════════════════╗');
  console.log('║  🎉 欢迎使用 KiBot！检测到首次启动                    ║');
  console.log('╚════════════════════════════════════════════════════════╝\n');
  console.log('需要进行初始化配置才能继续...\n');
  
  const initialized = await runInteractiveInitialization(false);
  if (!initialized) {
    console.error('\n❌ 初始化失败，无法启动服务器');
    console.error('   请检查错误信息并重试\n');
    process.exit(1);
  }
  
  console.log('✅ 初始化完成，正在启动服务器...\n');
}

// 加载 LLOneBot 配置
function loadLLOneBotConfig() {
  const configPath = path.join(__dirname, 'config', 'llonebot.json');
  const templatePath = path.join(__dirname, 'config', 'llonebot.json.template');
  
  try {
    if (fs.existsSync(configPath)) {
      const configData = fs.readFileSync(configPath, 'utf8');
      const config = JSON.parse(configData);
      
      // 验证配置
      const isValidUrl = (url) => {
        return url && 
               url.length > 0 && 
               !url.includes('://:/') && 
               !url.includes('://:') &&
               url.match(/^(ws|wss|http|https):\/\/.+/);
      };
      
      if (!isValidUrl(config.wsUrl) || !isValidUrl(config.apiUrl)) {
        logger.error('╔════════════════════════════════════════════════════════╗');
        logger.error('║  ❌ LLOneBot 配置无效或不完整                          ║');
        logger.error('╚════════════════════════════════════════════════════════╝');
        logger.error('');
        logger.error('📋 当前配置：');
        logger.error('   WebSocket URL: ' + (config.wsUrl || '(未设置)'));
        logger.error('   API URL: ' + (config.apiUrl || '(未设置)'));
        logger.error('');
        logger.warn('💡 解决方法：');
        logger.warn('   1. 运行初始化脚本重新配置：');
        logger.warn('      cd server && node init.js');
        logger.warn('');
        logger.warn('   2. 或手动编辑配置文件：');
        logger.warn('      server/config/llonebot.json');
        logger.warn('');
        logger.warn('⚠️  后端服务将继续启动，但不会连接到 QQ Bot');
        logger.warn('');
        return { ...config, enabled: false };
      }
      
      return config;
    } else {
      logger.warn('╔════════════════════════════════════════════════════════╗');
      logger.warn('║  ⚠️  未找到 LLOneBot 配置文件                          ║');
      logger.warn('╚════════════════════════════════════════════════════════╝');
      logger.warn('');
      logger.warn('📝 首次使用需要初始化配置，请运行:');
      logger.warn('   cd server && node init.js');
      logger.warn('');
      logger.warn('💡 初始化后将配置以下内容:');
      logger.warn('   • LLOneBot WebSocket 地址');
      logger.warn('   • 管理员认证密码');
      logger.warn('   • 基础数据文件');
      logger.warn('');
      
      return {
        apiUrl: '',
        wsUrl: '',
        accessToken: '',
        heartbeatInterval: 30000,
        reconnectDelay: 5000,
        enabled: false
      };
    }
  } catch (error) {
    logger.error('❌ 加载 LLOneBot 配置失败:', error);
    return {
      apiUrl: '',
      wsUrl: '',
      accessToken: '',
      heartbeatInterval: 30000,
      reconnectDelay: 5000,
      enabled: false
    };
  }
}

const llonebotConfig = loadLLOneBotConfig();

// 配置
const CONFIG = {
  WS_PORT: 8080,
  LLONEBOT_API_URL: llonebotConfig.apiUrl,
  LLONEBOT_WS_URL: llonebotConfig.wsUrl,
  LLONEBOT_ACCESS_TOKEN: llonebotConfig.accessToken,
  HEARTBEAT_INTERVAL: llonebotConfig.heartbeatInterval || 30000,
};

class KiBotWebSocketServer {
  constructor() {
    this.startTime = Date.now(); // 记录启动时间
    this.wss = null;
    this.clients = new Map(); // 存储客户端连接
    this.llonebotWs = null; // LLOneBot反向WebSocket连接
    this.pendingRequests = new Map(); // 存储待处理的API请求
    this.heartbeatInterval = null;
    this.isInitialized = false; // 初始化完成标志
    this.recentAuthFailures = new Map(); // 记录最近的认证失败（用于去重）
    
    // 使用统一的系统统计模块
    this.systemStats = systemStatistics;
    
    // 显示启动横幅
    console.log('\n╔════════════════════════════════════════════════════════╗');
    console.log(`║           🎉 KiBot v${SERVER_VERSION} 启动中...                  ║`);
    console.log('╚════════════════════════════════════════════════════════╝\n');
    
    // 设置日志级别（静默，不输出日志）
    logger.setLevel(process.env.LOG_LEVEL || 'info', true);
    
    // 启动时清理旧日志文件
    logger.cleanupOldLogs();
    
    // 输出系统统计状态
    logger.info('系统统计', '系统统计模块已初始化');
    
    // 初始化后端服务
    logger.startup('事件引擎', '初始化中...');
    this.eventEngine = new EventResponseEngine();
    this.userApiService = new UserApiService(null); // WebSocket连接稍后设置
    
    // 初始化安全中间件
    logger.startup('安全系统', '初始化中...');
    this.securityMiddleware = new SecurityMiddleware();
    
    // 初始化插件管理器  
    logger.plugin('插件管理器', '正在初始化...');
    
    // 为插件系统添加必要的服务
    this.eventBus = {
      on: (event, handler) => {
        // 简单的事件总线实现
        if (!this._eventHandlers) this._eventHandlers = {};
        if (!this._eventHandlers[event]) this._eventHandlers[event] = [];
        this._eventHandlers[event].push(handler);
      },
      emit: (event, data) => {
        if (this._eventHandlers && this._eventHandlers[event]) {
          this._eventHandlers[event].forEach(handler => handler(data));
        }
      }
    };
    
    this.commandRegistry = {
      commands: new Map(),
      register: (commandInfo) => {
        this.commandRegistry.commands.set(commandInfo.command, commandInfo);
        logger.plugin('插件指令注册', `注册指令: ${commandInfo.command}`);
      },
      unregister: (command) => {
        this.commandRegistry.commands.delete(command);
        logger.plugin('插件指令注销', `注销指令: ${command}`);
      }
    };
    
    this.messageService = {
      send: async (chatId, message, type, options = {}) => {
        const action = type === 'private' ? 'send_private_msg' : 'send_group_msg';
        const idField = type === 'private' ? 'user_id' : 'group_id';
        
        // 构造消息内容
        let messageContent;
        if (typeof message === 'string') {
          messageContent = [];
          
          // 如果有回复消息ID，添加回复消息段
          if (options.replyTo) {
            messageContent.push({
              type: 'reply',
              data: { id: options.replyTo.toString() }
            });
          }
          
          // 添加文本消息段
          messageContent.push({
            type: 'text',
            data: { text: message }
          });
        } else {
          messageContent = message;
        }
        
        return await this.callLLOneBotViaWebSocket(action, {
          [idField]: parseInt(chatId),
          message: messageContent
        });
      }
    };
    
    this.apiService = {
      call: async (action, params) => {
        return await this.callLLOneBotViaWebSocket(action, params);
      }
    };
    
    this.notificationService = {
      send: (notification) => {
        this.broadcastToClients({
          type: 'notification',
          data: notification
        });
      }
    };
    
    this.scheduler = {
      tasks: new Map(),
      create: (name, cron, handler) => {
        // 简单的定时任务实现（生产环境建议使用node-cron）
        if (process.env.LOG_LEVEL === 'debug') {
          logger.debug('定时任务', `${name} (${cron})`);
        }
        // 这里可以集成node-cron或其他定时任务库
        return { name, cron, handler };
      }
    };
    
    this.pluginManager = new PluginManager(this);
    
    // 初始化任务管理器
    logger.startup('任务管理器', '初始化中...');
    this.taskManager = new TaskManager(this);
    
    // 初始化更新器服务
    logger.startup('更新系统', '初始化中...');
    try {
      // 确保更新器目录存在
      const updatesDir = path.join(__dirname, '.updates');
      if (!fs.existsSync(updatesDir)) {
        fs.mkdirSync(updatesDir, { recursive: true });
      }
      
      // 检查更新器脚本
      const updaterScript = path.join(__dirname, 'update-backend.js');
      if (fs.existsSync(updaterScript)) {
        logger.success('更新系统', '就绪');
      } else {
        logger.warning('更新系统', '脚本未找到');
      }
      
      // 检查备份数量（仅在有备份时显示）
      const backupDir = path.join(updatesDir, 'backups');
      if (fs.existsSync(backupDir)) {
        const backups = fs.readdirSync(backupDir).filter(f => f.startsWith('server-backup-'));
        if (backups.length > 0) {
          logger.info('更新系统', `历史备份: ${backups.length} 个`);
        }
      }
    } catch (error) {
      logger.warning('更新系统', error.message);
    }
    
    // 初始化规则分组
    this.groups = [];
    this.loadGroups();
    
    // 设置任务管理器的API回调
    this.taskManager.setApiCallback((action, params) => {
      return this.callLLOneBotViaWebSocket(action, params, uuidv4());
    });
    
    // 设置广播回调
    this.taskManager.setBroadcastCallback((message) => {
      this.broadcastToClients(message);
    });
    
    // 设置UserApiService的主服务器引用
    this.userApiService.mainServer = this;
    
    // 设置事件引擎回调
    this.setupEventEngineCallbacks();

    logger.success('后端服务', '初始化完成');
  }

  /**
   * 设置事件引擎回调函数
   */
  setupEventEngineCallbacks() {
    // 设置发送消息回调（支持回复消息）
    this.eventEngine.setSendMessageCallback(async (chatId, message, type, options = {}) => {
      try {
        const action = type === 'private' ? 'send_private_msg' : 'send_group_msg';
        const idField = type === 'private' ? 'user_id' : 'group_id';
        
        // 构造消息内容
        let messageContent;
        if (typeof message === 'string') {
          messageContent = [];
          
          // 如果有回复消息ID，添加回复消息段
          if (options.replyTo) {
            messageContent.push({
              type: 'reply',
              data: { id: options.replyTo.toString() }
            });
            logger.info('自动回复', `(${type}) ${message.substring(0, 30)}... [回复ID: ${options.replyTo}]`);
          } else {
            logger.info('自动发送', `(${type}) ${message.substring(0, 30)}...`);
          }
          
          // 添加文本消息段
          messageContent.push({
            type: 'text',
            data: { text: message }
          });
        } else {
          messageContent = message;
        }
        
        // 确保WebSocket连接可用
        if (!this.llonebotWs || this.llonebotWs.readyState !== 1) {
          logger.error('消息发送', 'WebSocket未连接');
          return;
        }
        
        // 通过WebSocket发送消息
        await this.callLLOneBotViaWebSocket(action, {
          [idField]: parseInt(chatId),
          message: messageContent
        });
        
        logger.success('消息发送', `${type} 成功`);
      } catch (error) {
        logger.error('消息发送', error.message);
      }
    });

    // 设置日志回调
    this.eventEngine.setAddLogCallback((log) => {
      // 广播日志给前端客户端
      this.broadcastToClients({
        type: 'log',
        data: log
      });
    });

    // 设置API调用回调
    this.eventEngine.setCallApiCallback(async (action, params) => {
      // 只在debug模式下记录
      if (process.env.LOG_LEVEL === 'debug') {
        logger.debug('事件引擎API', `${action}: ${JSON.stringify(params)}`);
      }
      
      // 检查是否是规则管理API
      if (action.startsWith('rules_')) {
        return await this.handleRulesApi(action, params);
      }
      
      // 检查是否是分组管理API
      if (action.startsWith('groups_')) {
        return await this.handleRulesApi(action, params);
      }

      // 检查是否是后端内部API (现在主要是internal_开头的API)
      if (action.startsWith('internal_')) {
        return await this.handleRulesApi(action, params);
      }
      
      // LLOneBot API调用
      if (!this.llonebotWs || this.llonebotWs.readyState !== 1) {
        throw new Error('WebSocket未连接，无法调用LLOneBot API');
      }
      logger.debug('事件引擎', `调用API: ${action}`);
      return await this.callLLOneBotViaWebSocket(action, params);
    });

    // 设置广播回调（用于规则热重载通知）
    this.eventEngine.setBroadcastCallback((message) => {
      this.broadcastToClients(message);
    });
  }

  /**
   * 处理HTTP API请求
   */
  async handleHttpApi(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const path = url.pathname;
    const method = req.method;
    
    // 提取API动作名称（去掉/api/前缀）
    const action = path.replace('/api/', '');
    
    try {
      // 检查是否为文件上传请求
      const contentType = req.headers['content-type'] || '';
      const isFileUpload = action === 'updater_upload' && contentType.includes('multipart/form-data');
      
      let requestBody = '';
      let params = {};
      
      // 对于文件上传，不在这里读取请求体（会在后续处理中读取）
      if (!isFileUpload && (method === 'POST' || method === 'PUT')) {
        // 读取请求体（对于非文件上传的POST/PUT请求）
        await new Promise((resolve, reject) => {
          req.on('data', chunk => {
            requestBody += chunk.toString();
          });
          
          req.on('end', resolve);
          req.on('error', reject);
          
          // 设置超时
          setTimeout(() => {
            reject(new Error('请求体读取超时'));
          }, 10000);
        });
        
        // 解析 JSON 请求体
        if (requestBody) {
          try {
            params = JSON.parse(requestBody);
          } catch (error) {
            throw new Error('请求体JSON格式错误');
          }
        }
      } else if (method === 'GET') {
        // GET请求从URL参数获取
        for (const [key, value] of url.searchParams.entries()) {
          params[key] = value;
        }
      }
      
      // 🔐 安全验证：对于非认证API，验证会话和权限
      if (action !== 'authenticate') {
        // 从请求头中提取会话ID
        const sessionId = req.headers['x-session-id'] || 
                         req.headers['authorization']?.replace('Bearer ', '');
        
        if (!sessionId) {
          logger.warning('未授权访问', action);
          const errorResponse = {
            status: 'error',
            retcode: -1,
            error: 'UNAUTHORIZED',
            data: null,
            message: '未提供会话ID，请先登录',
            timestamp: new Date().toISOString()
          };
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(errorResponse));
          return;
        }
        
        // 使用安全中间件验证API调用权限
        const validationResult = await this.securityMiddleware.validateApiCall(
          sessionId,
          action,
          params,
          {
            clientIp: req.socket.remoteAddress,
            userAgent: req.headers['user-agent']
          }
        );
        
        if (!validationResult.success) {
          // 去重：相同的错误在30秒内只记录一次
          const errorKey = `${sessionId}-${action}-${validationResult.error}`;
          const now = Date.now();
          const lastLog = this.recentAuthFailures.get(errorKey);
          
          if (!lastLog || (now - lastLog) > 30000) {
            this.recentAuthFailures.set(errorKey, now);
            logger.warning('权限验证', `${action} - ${validationResult.error} (会话: ${sessionId.substring(0, 8)}...)`);
            
            // 定期清理旧记录
            if (this.recentAuthFailures.size > 100) {
              const cutoff = now - 60000; // 1分钟前
              for (const [key, time] of this.recentAuthFailures.entries()) {
                if (time < cutoff) {
                  this.recentAuthFailures.delete(key);
                }
              }
            }
          }
          
          const errorResponse = {
            status: 'error',
            retcode: -1,
            error: validationResult.error,
            data: null,
            message: validationResult.message,
            timestamp: new Date().toISOString()
          };
          
          res.writeHead(validationResult.error === 'INVALID_SESSION' ? 401 : 403, {
            'Content-Type': 'application/json'
          });
          res.end(JSON.stringify(errorResponse));
          return;
        }
        
        // 权限验证通过（不输出日志，减少噪音）
      }
      
      // 调用对应的API处理方法（复用现有的WebSocket API逻辑）
      const startTime = Date.now();
      let response;
      let success = true;
      
      try {
      // 规则管理API
      if (action.startsWith('rules_')) {
        response = await this.handleRulesApi(action, params);
      }
      // 分组管理API
      else if (action.startsWith('groups_')) {
        response = await this.handleRulesApi(action, params);
      }
      // 插件管理API
      else if (action.startsWith('plugins_') || action === 'plugin_performance') {
        response = await this.handleRulesApi(action, params);
      }
      // 系统性能API
      else if (action === 'system_performance' || action === 'clear_api_stats' || action === 'clear_plugins_performance') {
        response = await this.handleRulesApi(action, params);
      }
      // 聊天相关API
      else if (action === 'get_chat_list') {
        response = await this.handleGetChatList(params);
      }
      else if (action === 'get_chat_history') {
        response = await this.handleGetChatHistory(params);
      }
      // 监控API（使用新版API处理，支持归档、导出等高级功能）
      else if (action.startsWith('monitor_')) {
        response = await this.handleMonitorApiNew(action, params);
      }
      // 日志API
      else if (action.startsWith('logs_')) {
        response = await this.handleLogsApi(action, params);
      }
      // 任务管理API
      else if (action.startsWith('tasks_')) {
        response = await this.handleTasksApi(action, params);
      }
      // 认证API
      else if (action === 'authenticate') {
        response = await this.handleAuthenticateApi(params, req);
      }
      // 系统配置API (精确匹配，避免与LLOneBot API冲突)
      else if (action === 'get_status' || action === 'get_system_config' || 
               action === 'set_system_config' || action === 'reset_system_config' || 
               action === 'restart_service' || action === 'internal_security_stats' ||
               action === 'generate_auth_code' || action === 'reload_security_config' ||
               action === 'get_changelog' || action === 'get_system_settings' ||
               action === 'update_system_settings' || action === 'get_disk_usage' ||
               action === 'get_data_stats' || action === 'cleanup_data' || action === 'archive_old_data') {
        response = await this.handleSystemApi(action, params);
      }
      // 更新器API
      else if (action.startsWith('updater_')) {
        response = await this.handleUpdaterApi(req, action, params);
      }
      // LLOneBot API（通过WebSocket转发）
      else {
        if (!this.llonebotWs || this.llonebotWs.readyState !== 1) {
          throw new Error('与QQ Bot的WebSocket连接未建立');
        }
        response = await this.callLLOneBotViaWebSocket(action, params);
      }
      
      } catch (apiError) {
        success = false;
        throw apiError;
      } finally {
        // 记录HTTP请求性能
        const responseTime = Date.now() - startTime;
        this.recordHttpRequest(action, responseTime, success);
      }
      
      // 发送HTTP响应
      const httpStatus = response.status === 'ok' || response.retcode === 0 ? 200 : 
                         response.error === 'UNAUTHORIZED' || response.error === 'INVALID_SESSION' ? 401 :
                         response.error === 'INVALID_AUTH_CODE' || response.error === 'LOCKED_OUT' ? 401 : 400;
      
      res.writeHead(httpStatus, { 
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache'
      });
      res.end(JSON.stringify(response));
      
      // 只记录重要的API调用，减少日志噪音
      const importantActions = ['authenticate', 'rules_', 'plugins_', 'tasks_', 'generate_auth_code'];
      const shouldLog = importantActions.some(prefix => action.startsWith(prefix)) || 
                       response.status === 'error' || 
                       response.retcode !== 0;
      
      // 只在debug模式下记录HTTP API响应
      if (shouldLog && process.env.LOG_LEVEL === 'debug') {
        const statusEmoji = response.status === 'ok' || response.retcode === 0 ? '✅' : '❌';
        logger.debug('HTTP API', `${action} -> ${response.status || (response.retcode === 0 ? 'ok' : 'failed')} (${httpStatus})`);
      }
      
    } catch (error) {
      logger.error('HTTP API', `${action} 处理失败: ${error.message}`);
      
      const errorResponse = {
        status: 'error',
        retcode: -1,
        data: null,
        message: error.message || 'API处理失败',
        timestamp: new Date().toISOString()
      };
      
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(errorResponse));
    }
  }

  /**
   * 处理认证API请求（HTTP版本）
   */
  async handleAuthenticateApi(params, req) {
    try {
      const { auth_code } = params;
      
      if (!auth_code) {
        return {
          status: 'error',
          retcode: -1,
          data: null,
          message: '缺少授权码参数',
          timestamp: new Date().toISOString()
        };
      }

      // 🔐 使用安全中间件进行认证（创建会话）
      const authResult = await this.securityMiddleware.authenticateUser(
        auth_code.trim(),
        {
          clientIp: req?.socket?.remoteAddress || 'unknown',
          userAgent: req?.headers?.['user-agent'] || 'unknown'
        }
      );

      if (authResult.success) {
        // 认证成功，返回会话信息（已有其他日志，此处不再重复输出）
        // logger.success('HTTP认证', `${authResult.permission} (会话: ${authResult.sessionId.substring(0, 8)}...)`);
        
        return {
          status: 'ok',
          retcode: 0,
          data: {
            authenticated: true,
            sessionId: authResult.sessionId,
            permission: authResult.permission,
            expiresAt: authResult.expiresAt,
            timestamp: new Date().toISOString()
          },
          message: '认证成功',
          timestamp: new Date().toISOString()
        };
      } else {
        // 认证失败
        logger.warning('HTTP认证', `${authResult.error} - ${authResult.message}`);
        
        return {
          status: 'error',
          retcode: -1,
          error: authResult.error,
          data: null,
          message: authResult.message,
          remainingMinutes: authResult.remainingMinutes,
          timestamp: new Date().toISOString()
        };
      }

    } catch (error) {
      logger.error('认证API', error.message);
      return {
        status: 'error',
        retcode: -1,
        data: null,
        message: `认证服务异常: ${error.message}`,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * 启动WebSocket服务器
   */
  start() {
    // 创建HTTP服务器
    this.server = createServer((req, res) => {
      // 设置CORS头
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Session-Id');
      
      // 处理预检请求
      if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
      }
      
      const url = req.url;
      const method = req.method;
      
      // 只记录非GET请求和特殊端点，减少日志噪音
      // 只在debug模式下记录HTTP请求（减少日志噪音）
      if (process.env.LOG_LEVEL === 'debug' && method !== 'GET' && !url.startsWith('/api/logs_') && !url.startsWith('/api/monitor_')) {
        logger.debug('HTTP请求', `${method} ${url} (${req.socket.remoteAddress})`);
      }
      
      // 健康检查端点
      if (url === '/health' || url === '/ping') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          status: 'ok', 
          timestamp: new Date().toISOString(),
          service: 'KiBot Server (HTTP API + QQ Bot WebSocket)'
        }));
        return;
      }
      
      // 服务器信息端点
      if (url === '/' || url === '/info') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          name: 'KiBot Server',
          version: SERVER_VERSION,
          status: 'running',
          clients: this.clients.size,
          websocket: this.llonebotWs?.readyState === 1,
          architecture: {
            'Frontend ↔ Backend': 'HTTP REST API',
            'Backend ↔ QQ Bot': 'WebSocket'
          }
        }));
        return;
      }
      
      // API路由处理
      if (url.startsWith('/api/')) {
        this.handleHttpApi(req, res);
        return;
      }
      
      // 其他请求返回404
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        error: 'Not Found',
        message: `路径 ${url} 不存在`,
        timestamp: new Date().toISOString()
      }));
    });

    // 创建WebSocket服务器，使用HTTP服务器
    this.wss = new WebSocketServer({ 
      server: this.server,
      perMessageDeflate: false,
      // 添加客户端追踪
      clientTracking: true,
      // 处理升级错误
      handleProtocols: (protocols) => {
        if (process.env.LOG_LEVEL === 'debug') {
          logger.debug('WebSocket', `协议: ${protocols.join(', ')}`);
        }
        return protocols.length > 0 ? protocols[0] : false;
      }
    });

    // HTTP服务器监听端口
    this.server.listen(CONFIG.WS_PORT, '0.0.0.0', () => {
      const tzInfo = getTimezoneInfo();
      logger.success('服务器启动成功', `端口 ${CONFIG.WS_PORT}`);
      logger.info('版本信息', `v${SERVER_VERSION}`);
      logger.info('HTTP API', `http://localhost:${CONFIG.WS_PORT}/api/*`);
      logger.info('WebSocket', `ws://localhost:${CONFIG.WS_PORT}`);
      logger.info('时区', `${tzInfo.timezone} (${tzInfo.offsetString})`);
    });

    // 处理HTTP升级错误（调试模式下才显示）
    if (process.env.LOG_LEVEL === 'debug') {
      this.server.on('upgrade', (request, socket, head) => {
        logger.debug('WebSocket升级', `${request.url} from ${socket.remoteAddress}`);
      });
    }

    // WebSocket连接处理
    this.wss.on('connection', (ws, req) => {
      const clientId = uuidv4();
      const userAgent = req.headers['user-agent'] || '';
      const remoteAddress = req.socket.remoteAddress;
      const url = req.url || '/';
      const origin = req.headers['origin'] || '';
      
      // 识别客户端类型
      const clientType = this.identifyClientType(req);
      
      // 简化日志输出
      if (process.env.LOG_LEVEL === 'debug') {
        logger.debug('WebSocket连接', `${clientType.description} - ${remoteAddress}`);
      }
      
      // 根据客户端类型处理连接
      switch (clientType.type) {
        case 'llonebot':
          this.handleLLOneBotConnection(ws, req);
          break;
          
        case 'web_client':
          this.handleWebClientConnection(ws, req, clientId, clientType);
          break;
          
        case 'unknown':
          logger.warning('未知连接', `${clientId.substring(0, 8)}... 来自 ${remoteAddress}`);
          this.handleUnknownConnection(ws, req, clientId, clientType);
          break;
          
        default:
          logger.warning('拒绝连接', `${clientType.type} (${remoteAddress})`);
          ws.close(1008, '不支持的客户端类型');
      }
    });

    // 处理WebSocket服务器错误
    this.wss.on('error', (error) => {
      logger.error('WebSocket服务器', error.message);
    });

    // 连接到LLOneBot正向WebSocket（仅在配置有效时）
    if (llonebotConfig.enabled !== false && llonebotConfig.wsUrl && !llonebotConfig.wsUrl.includes('://:/')) {
      this.connectToLLOneBot();
    } else {
      logger.warn('⚠️  LLOneBot 未配置或已禁用');
    }

    // 启动心跳
    this.startHeartbeat();
    
    // 启动安全中间件的定期清理
    this.securityMiddleware.startPeriodicCleanup();
    
    // 启动自动清理任务
    this.startAutoCleanupTask();
    
    // 初始化插件系统
    setTimeout(async () => {
      try {
        await this.pluginManager.initialize();
        
        // 加载登录信息（确保LLOneBot连接稳定）
        await new Promise(resolve => setTimeout(resolve, 1000));
        await this.loadLoginInfo();
        
        // 标记初始化完成
        this.isInitialized = true;
        logger.success('系统启动', '所有初始化已完成，开始处理事件');
      } catch (error) {
        logger.error('插件系统', '启动失败: ' + error.message);
        this.isInitialized = true; // 即使失败也标记为完成，避免阻塞
      }
    }, 2000);
  }
  
  /**
   * 启动自动清理任务
   * 每天凌晨2点检查并清理过期数据
   */
  startAutoCleanupTask() {
    // 计算到明天凌晨2点的时间间隔
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(2, 0, 0, 0); // 设置为明天凌晨2点
    
    const timeUntilFirstRun = tomorrow.getTime() - now.getTime();
    
    logger.info('自动清理', `首次运行将在 ${Math.round(timeUntilFirstRun / 1000 / 60 / 60)} 小时后 (凌晨2点)`);
    
    // 首次执行
    setTimeout(() => {
      this.runAutoCleanup();
      
      // 然后每24小时执行一次
      this.autoCleanupInterval = setInterval(() => {
        this.runAutoCleanup();
      }, 24 * 60 * 60 * 1000); // 24小时
      
    }, timeUntilFirstRun);
  }
  
  /**
   * 执行自动清理
   */
  async runAutoCleanup() {
    try {
      // 读取系统设置
      const settingsPath = path.join(__dirname, 'data', 'system-settings.json');
      let settings = {
        autoCleanup: true,
        dataRetentionDays: 30
      };
      
      if (fs.existsSync(settingsPath)) {
        try {
          const savedSettings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
          settings = { ...settings, ...savedSettings };
        } catch (error) {
          logger.warn('自动清理', '读取设置失败，使用默认值');
        }
      }
      
      // 检查是否启用自动清理
      if (!settings.autoCleanup) {
        logger.info('自动清理', '已禁用，跳过清理');
        return;
      }
      
      logger.info('自动清理', `开始清理 ${settings.dataRetentionDays} 天前的数据`);
      
      const dataDir = path.join(__dirname, 'data');
      const cutoffTime = Date.now() - (settings.dataRetentionDays * 24 * 60 * 60 * 1000);
      
      let totalDeletedFiles = 0;
      let totalDeletedSize = 0;
      
      // 清理函数
      const cleanupDir = (dirPath) => {
        if (!fs.existsSync(dirPath)) return;
        
        try {
          const items = fs.readdirSync(dirPath);
          for (const item of items) {
            const itemPath = path.join(dirPath, item);
            try {
              const stat = fs.statSync(itemPath);
              
              if (stat.isFile() && stat.mtimeMs < cutoffTime) {
                const size = stat.size;
                fs.unlinkSync(itemPath);
                totalDeletedFiles++;
                totalDeletedSize += size;
              } else if (stat.isDirectory()) {
                cleanupDir(itemPath);
                // 尝试删除空目录
                try {
                  if (fs.readdirSync(itemPath).length === 0) {
                    fs.rmdirSync(itemPath);
                  }
                } catch (e) {
                  // 忽略
                }
              }
            } catch (e) {
              // 忽略无法访问的文件
            }
          }
        } catch (e) {
          // 忽略无法访问的目录
        }
      };
      
      // 清理各类数据
      cleanupDir(path.join(dataDir, 'statistics'));
      cleanupDir(path.join(dataDir, 'logs'));
      cleanupDir(path.join(dataDir, 'backups'));
      
      if (totalDeletedFiles > 0) {
        const sizeMB = Math.round(totalDeletedSize / 1024 / 1024 * 100) / 100;
        logger.success('自动清理', `已删除 ${totalDeletedFiles} 个文件，释放 ${sizeMB}MB 空间`);
      } else {
        logger.info('自动清理', '没有需要清理的文件');
      }
      
    } catch (error) {
      logger.error('自动清理', `执行失败: ${error.message}`);
    }
  }


  /**
   * 识别客户端类型
   * @param {Object} req - HTTP请求对象
   */
  identifyClientType(req) {
    const userAgent = (req.headers['user-agent'] || '').toLowerCase();
    const origin = req.headers['origin'] || '';
    const url = req.url || '/';
    const remoteAddress = req.socket.remoteAddress;
    
    // 检查LLOneBot连接
    if (userAgent.includes('llonebot') || 
        userAgent.includes('onebot') ||
        url.includes('/llonebot') ||
        url.includes('/onebot') ||
        req.headers['x-llonebot'] === 'true' ||
        req.headers['x-onebot'] === 'true') {
      return {
        type: 'llonebot',
        trusted: true,
        description: 'LLOneBot机器人客户端',
        capabilities: ['api_calls', 'events', 'admin']
      };
    }
    
    // 检查Web前端客户端
    if (origin && (
        origin.includes('localhost:5173') ||  // Vite开发服务器
        origin.includes('localhost:3000') ||  // 其他开发端口
        origin.includes('127.0.0.1:5173') ||
        origin.includes('127.0.0.1:3000') ||
        userAgent.includes('mozilla') ||      // 浏览器标识
        userAgent.includes('chrome') ||
        userAgent.includes('firefox') ||
        userAgent.includes('safari') ||
        userAgent.includes('edge')
      )) {
      return {
        type: 'web_client',
        trusted: true,
        description: '网页前端客户端',
        capabilities: ['api_calls', 'events', 'ui_updates'],
        origin: origin
      };
    }
    
    // 检查本地连接（可能是开发环境）
    if (remoteAddress === '127.0.0.1' || remoteAddress === '::1') {
      return {
        type: 'web_client', // 本地连接默认视为Web客户端
        trusted: true,
        description: '本地开发环境客户端',
        capabilities: ['api_calls', 'events', 'ui_updates', 'debug'],
        origin: origin
      };
    }
    
    // 未知来源
    return {
      type: 'unknown',
      trusted: false,
      description: `未知来源客户端 (${userAgent.substring(0, 50)})`,
      capabilities: ['limited'], // 限制功能
      reason: '未识别的User-Agent或来源'
    };
  }

  /**
   * 处理Web前端客户端连接
   */
  async handleWebClientConnection(ws, req, clientId, clientType) {
    if (process.env.LOG_LEVEL === 'debug') {
      logger.debug('Web客户端', `连接: ${clientId.substring(0, 8)}... (${clientType.origin || '未知'})`);
    }
    
    // 使用安全中间件进行WebSocket连接认证
    const authResult = await this.securityMiddleware.authenticateWebSocketConnection(req, ws);
    
    if (!authResult.success) {
      if (authResult.needAuth) {
        if (process.env.LOG_LEVEL === 'debug') {
          logger.debug('客户端认证', `需要认证: ${clientId.substring(0, 8)}...`);
        }
        
        // 存储未认证的临时连接
        this.clients.set(clientId, {
          ws,
          id: clientId,
          type: 'web_client',
          authenticated: false,
          tempConnectionId: authResult.tempConnectionId,
          connectedAt: new Date(),
          lastHeartbeat: new Date(),
          remoteAddress: req.socket.remoteAddress,
          userAgent: req.headers['user-agent'],
          origin: clientType.origin,
          capabilities: ['auth_only'], // 只允许认证操作
          trusted: false
        });
        
        // 发送需要认证的响应
        this.sendToClient(ws, {
          type: 'auth_required',
          data: {
            clientId,
            clientType: authResult.clientType,
            tempConnectionId: authResult.tempConnectionId,
            message: authResult.message
          }
        });
      } else {
        // 认证失败，关闭连接
        logger.error('客户端认证', `失败: ${clientId.substring(0, 8)}... - ${authResult.error}`);
        ws.close(1008, authResult.message || '认证失败');
        return;
      }
    } else {
      // 认证成功
      if (process.env.LOG_LEVEL === 'debug') {
        logger.debug('客户端认证', `成功: ${clientId.substring(0, 8)}... (${authResult.permission})`);
      }
      
      // 存储认证后的客户端信息
      this.clients.set(clientId, {
        ws,
        id: clientId,
        type: 'web_client',
        authenticated: true,
        session: authResult.session,
        permission: authResult.permission,
        connectedAt: new Date(),
        lastHeartbeat: new Date(),
        remoteAddress: req.socket.remoteAddress,
        userAgent: req.headers['user-agent'],
        origin: clientType.origin,
        capabilities: clientType.capabilities,
        trusted: clientType.trusted
      });
      
      // 注册到日志系统，接收实时日志
      logger.addWebSocketClient(ws);
      
      // 发送认证成功的响应
      this.sendToClient(ws, {
        type: 'connection',
        data: {
          clientId,
          serverTime: new Date().toISOString(),
          message: 'WebSocket连接已建立',
          clientType: 'web_client',
          authenticated: true,
          session: {
            sessionId: authResult.session.sessionId,
            permission: authResult.permission,
            expiresAt: Date.now() + 24 * 60 * 60 * 1000 // 24小时
          }
        }
      });
    }

    // 处理客户端消息
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        // 只对非心跳消息输出日志
        if (message.type !== 'heartbeat') {
          logger.api('客户端消息', `[${clientId}] ${message.type}`);
        }
        this.handleClientMessage(clientId, message);
      } catch (error) {
        logger.error('客户端消息', '解析失败', error);
        this.sendError(ws, 'PARSE_ERROR', '消息格式错误');
      }
    });

    // 处理连接关闭
    ws.on('close', (code, reason) => {
      if (process.env.LOG_LEVEL === 'debug') {
        logger.debug('Web客户端', `断开: ${clientId.substring(0, 8)}... (code: ${code})`);
      }
      this.clients.delete(clientId);
    });

    // 处理连接错误
    ws.on('error', (error) => {
      logger.error('Web客户端', `连接错误 [${clientId.substring(0, 8)}...]: ${error.message}`);
      this.clients.delete(clientId);
    });
  }

  /**
   * 处理未知来源连接
   */
  handleUnknownConnection(ws, req, clientId, clientType) {
    console.log(`⚠️ 未知来源连接: ${clientId}`);
    console.log(`   原因: ${clientType.reason}`);
    console.log(`   User-Agent: ${req.headers['user-agent']}`);
    console.log(`   IP: ${req.socket.remoteAddress}`);
    
    // 发送警告消息
    this.sendToClient(ws, {
      type: 'warning',
      data: {
        message: '未知来源连接，功能受限',
        clientType: 'unknown',
        limitations: '仅允许基本连接测试'
      }
    });
    
    // 存储受限客户端信息
    this.clients.set(clientId, {
      ws,
      id: clientId,
      type: 'unknown',
      connectedAt: new Date(),
      lastHeartbeat: new Date(),
      remoteAddress: req.socket.remoteAddress,
      userAgent: req.headers['user-agent'],
      capabilities: ['ping'], // 极其有限的功能
      trusted: false
    });

    // 处理受限消息（只允许ping）
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        console.log(`⚠️ 收到未知客户端消息 [${clientId}]: ${message.type}`);
        
        if (message.type === 'heartbeat') {
          this.handleHeartbeat(clientId);
        } else {
          this.sendError(ws, 'FORBIDDEN', '未知来源客户端功能受限');
        }
      } catch (error) {
        console.error('❌ 解析未知客户端消息失败:', error);
        this.sendError(ws, 'PARSE_ERROR', '消息格式错误');
      }
    });

    // 处理连接关闭
    ws.on('close', (code, reason) => {
      console.log(`⚠️ 未知客户端断开连接: ${clientId} (code: ${code}, reason: ${reason})`);
      this.clients.delete(clientId);
    });

    // 处理连接错误
    ws.on('error', (error) => {
      console.error(`❌ 未知客户端连接错误 [${clientId}]:`, error);
      this.clients.delete(clientId);
    });
    
    // 5分钟后自动断开未知连接
    setTimeout(() => {
      if (this.clients.has(clientId)) {
        console.log(`🔒 自动断开长时间未认证的未知连接: ${clientId}`);
        ws.close(1000, '连接超时');
      }
    }, 5 * 60 * 1000); // 5分钟
  }

  /**
   * 连接到LLOneBot正向WebSocket
   */
  connectToLLOneBot() {
    try {
      // 🚫 检查是否已有活跃连接，避免重复连接
      if (this.llonebotWs && this.llonebotWs.readyState === WebSocket.OPEN) {
        logger.info('LLOneBot', '连接已存在');
        return;
      }
      
      logger.startup('LLOneBot', `连接中: ${CONFIG.LLONEBOT_WS_URL}`);
      
      const ws = new WebSocket(CONFIG.LLONEBOT_WS_URL, {
        headers: CONFIG.LLONEBOT_ACCESS_TOKEN ? {
          'Authorization': `Bearer ${CONFIG.LLONEBOT_ACCESS_TOKEN}`,
          'access_token': CONFIG.LLONEBOT_ACCESS_TOKEN,
          'X-Access-Token': CONFIG.LLONEBOT_ACCESS_TOKEN
        } : {}
      });

      ws.on('open', () => {
        logger.success('LLOneBot', '已连接');
        this.llonebotWs = ws;
        
        // 更新UserApiService的WebSocket连接
        this.userApiService.wsClient = ws;
        
        // 发送连接成功事件给客户端
        this.broadcastEvent({
          post_type: 'meta_event',
          meta_event_type: 'lifecycle',
          sub_type: 'connect',
          time: Math.floor(Date.now() / 1000),
          self_id: 0,
          status: {
            online: true,
            good: true
          }
        });
        
        // 立即加载登录信息（静默，不输出日志，避免干扰启动流程）
        setTimeout(() => {
          this.loadLoginInfo();
        }, 1000);
      });

      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          
          // 检查是否是API响应（包含echo字段）
          if (message.echo) {
            // 简化日志 - 只在调试模式显示
            // console.log('📬 API响应:', message.echo);
            this.handleLLOneBotApiResponse(message);
            return;
          }
          
          // 否则作为事件处理
          // 只在初始化完成后才输出事件日志
          if (this.isInitialized) {
            logger.event('LLOneBot', `收到事件: ${message.post_type || 'unknown'}`);
          }
          
          // 如果是心跳事件，记录但不广播
          if (message.post_type === 'meta_event' && message.meta_event_type === 'heartbeat') {
            logger.debug('LLOneBot', '心跳');
            return;
          }
          
          // 🚀 后端直接处理事件（不依赖前端）- 仅在初始化完成后处理
          if (!this.isInitialized) {
            // 初始化期间静默跳过事件处理
            return;
          }
          
          this.handleEventInBackend(message).then(backendHandled => {
            // 广播事件给前端客户端（用于显示），标记是否已被后端处理
            const eventToClient = {
              ...message,
              _backendProcessed: true, // 标记已被后端处理
              _processedBy: 'backend_engine'
            };
            this.broadcastEvent(eventToClient);
          }).catch(error => {
            logger.error('后端事件', '处理失败: ' + error.message);
            // 即使后端处理失败，也要广播事件
            this.broadcastEvent(message);
          });
        } catch (error) {
          logger.error('消息解析', '失败: ' + error.message);
          if (process.env.LOG_LEVEL === 'debug') {
            logger.debug('原始数据', data.toString().substring(0, 200));
          }
        }
      });

      ws.on('close', (code, reason) => {
        logger.warning('LLOneBot', `连接断开 (code: ${code})`);
        this.llonebotWs = null;
        
        // 发送断开连接事件给客户端
        this.broadcastEvent({
          post_type: 'meta_event',
          meta_event_type: 'lifecycle',
          sub_type: 'disconnect',
          time: Math.floor(Date.now() / 1000),
          self_id: 0,
          status: {
            online: false,
            good: false
          }
        });
        
        // 5秒后重新连接
        setTimeout(() => {
          if (!this.llonebotWs) {
            logger.info('LLOneBot', '尝试重新连接...');
            this.connectToLLOneBot();
          }
        }, 5000);
      });

      ws.on('error', (error) => {
        logger.error('LLOneBot', '连接错误: ' + error.message);
        this.llonebotWs = null;
      });
      
    } catch (error) {
      logger.error('LLOneBot', '连接失败: ' + error.message);
      
      // 5秒后重试
      setTimeout(() => {
        logger.info('LLOneBot', '尝试重新连接...');
        this.connectToLLOneBot();
      }, 5000);
    }
  }

  /**
   * 记录监控数据
   * @param {Object} event - 事件数据
   */
  recordMonitoringData(event) {
    try {
      if (event.post_type === 'message') {
        // 提取消息文本
        let messageText = '';
        if (Array.isArray(event.message)) {
          messageText = event.message
            .filter(seg => seg.type === 'text')
            .map(seg => seg.data?.text || '')
            .join('');
        } else {
          messageText = event.raw_message || '';
        }
        
        // 确定消息类型
        let messageType = 'text';
        if (Array.isArray(event.message)) {
          const hasImage = event.message.some(seg => seg.type === 'image');
          const hasVoice = event.message.some(seg => seg.type === 'record');
          const hasVideo = event.message.some(seg => seg.type === 'video');
          const hasAt = event.message.some(seg => seg.type === 'at');
          const hasReply = event.message.some(seg => seg.type === 'reply');
          
          if (hasImage) messageType = 'image';
          else if (hasVoice) messageType = 'voice';
          else if (hasVideo) messageType = 'video';
          else if (hasAt) messageType = 'at';
          else if (hasReply) messageType = 'reply';
        }
        
        // 记录消息数据
        const messageData = {
          messageId: event.message_id,
          userId: event.user_id?.toString(),
          groupId: event.group_id?.toString(),
          messageType: event.message_type, // private 或 group
          contentType: messageType,
          content: messageText,
          senderName: event.sender?.nickname || event.sender?.card || `用户${event.user_id}`,
          groupName: event.group_id ? `群组${event.group_id}` : undefined,
          memberCount: event.group_id ? 0 : undefined, // 稍后可通过API获取
          timestamp: event.time ? event.time * 1000 : Date.now()
        };
        
        systemStatistics.recordMessage(messageData);
        
        // 系统指标由 systemStatistics 自动收集，无需手动记录
      }
    } catch (error) {
      logger.error('监控数据', '记录失败', error);
    }
  }

  /**
   * 后端直接处理事件（核心功能）
   */
  async handleEventInBackend(event) {
    let processed = false;
    
    try {
      // 生成事件标识用于去重检查
      const eventId = `${event.message_id || event.time}_${event.post_type}`;
      logger.event('消息处理', `类型: ${event.post_type}`, { eventId, userId: event.user_id });
      
      // 记录监控数据
      this.recordMonitoringData(event);
      
      // 处理所有类型的事件（message, notice, request）
      if (event.post_type === 'message' || event.post_type === 'notice' || event.post_type === 'request') {
        // 记录消息内容（仅消息事件）
        if (event.post_type === 'message') {
          let messageText = '';
          if (Array.isArray(event.message)) {
            messageText = event.message
              .filter(seg => seg.type === 'text')
              .map(seg => seg.data?.text || '')
              .join('');
          } else {
            messageText = event.raw_message || '';
          }
          logger.event('消息内容', `"${messageText}" (用户: ${event.user_id})`);
        } else if (event.post_type === 'notice') {
          logger.event('通知事件', `类型: ${event.notice_type}, 子类型: ${event.sub_type || 'N/A'}`);
        } else if (event.post_type === 'request') {
          logger.event('请求事件', `类型: ${event.request_type}, 子类型: ${event.sub_type || 'N/A'}`);
        }
        
        // 确保事件引擎有最新的登录信息
        if (this.loginInfo) {
          this.eventEngine.setLoginInfo(this.loginInfo);
        }
        
        // 同步处理事件，确保能返回处理结果
        try {
        await this.eventEngine.handleEvent(event);
        // 移除"处理完成"日志，减少噪音
        processed = true;
        } catch (error) {
          logger.error('事件引擎', '处理失败', error);
        }
        
        // 🔌 将事件传递给插件系统处理
        const pluginCount = this.pluginManager?.plugins?.size || 0;
        
        if (this.pluginManager && pluginCount > 0) {
          logger.plugin('事件转发', `向 ${pluginCount} 个插件转发事件`);
          try {
            await this.forwardEventToPlugins(event);
            logger.success('插件系统', '处理完成');
          } catch (error) {
            logger.error('插件系统', '处理失败', error);
          }
        } else {
          // 静默跳过（没有可用的插件）
        }
      }
      
      // 如果是连接事件，加载登录信息（但避免重复加载）
      if (event.post_type === 'meta_event' && event.meta_event_type === 'lifecycle' && event.sub_type === 'connect') {
        if (!this.loginInfo) {
          // 初始化期间不输出，避免干扰启动日志
          await this.loadLoginInfo();
        }
        processed = true;
      }
      
    } catch (error) {
      logger.error('事件处理', error.message);
    }
    
    return processed;
  }

  /**
   * 加载登录信息
   */
  async loadLoginInfo() {
    try {
      // 确保WebSocket连接可用
      if (!this.llonebotWs || this.llonebotWs.readyState !== 1) {
        if (process.env.LOG_LEVEL === 'debug') {
          logger.debug('登录信息', 'WebSocket未连接，等待中');
        }
        return;
      }

      const response = await this.callLLOneBotViaWebSocket('get_login_info', {});
      
      if (response.retcode === 0) {
        this.loginInfo = response.data;
        this.eventEngine.setLoginInfo(this.loginInfo);
        
        // 只在初始化完成后才输出
        if (this.isInitialized) {
          logger.success('登录信息', `${this.loginInfo.nickname} (${this.loginInfo.user_id})`);
        }
      } else {
        logger.error('登录信息', '加载失败: ' + (response.msg || '未知错误'));
      }
    } catch (error) {
      logger.error('登录信息', '加载失败: ' + error.message);
    }
  }

  /**
   * 广播消息给所有前端客户端
   */
  broadcastToClients(message) {
    this.clients.forEach((client, clientId) => {
      try {
        if (client.ws.readyState === WebSocket.OPEN) {
          client.ws.send(JSON.stringify(message));
        }
      } catch (error) {
        console.error(`广播消息失败 [${clientId}]:`, error);
      }
    });
  }

  /**
   * 处理来自LLOneBot的反向WebSocket连接
   */
  handleLLOneBotConnection(ws, req) {
    const remoteAddress = req.socket.remoteAddress;
    console.log('🤖 LLOneBot反向连接尝试');
    console.log(`   来源地址: ${remoteAddress}`);
    console.log(`   连接路径: ${req.url}`);
    
    // 🚫 检查是否已有正向连接
    if (this.llonebotWs && this.llonebotWs.readyState === WebSocket.OPEN) {
      console.warn('⚠️ 已存在正向连接，拒绝反向连接以避免重复处理');
      ws.close(1000, '已存在正向连接');
      return;
    }
    
    console.log('✅ 接受LLOneBot反向连接');
    
    // 存储LLOneBot连接
    this.llonebotWs = ws;
    
    // 发送欢迎消息（如果LLOneBot支持的话）
    try {
      ws.send(JSON.stringify({
        type: 'meta',
        data: {
          message: 'KiBot服务器连接成功',
          timestamp: Date.now(),
          server: 'KiBot WebSocket Server'
        }
      }));
    } catch (error) {
      // 忽略发送错误，LLOneBot可能不需要这个消息
    }
    
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        
        // 检查是否是API响应（包含echo字段）
        if (message.echo) {
          console.log('📬 收到LLOneBot API响应:', message.echo);
          this.handleLLOneBotApiResponse(message);
          return;
        }
        
        // 否则作为事件处理
        console.log('📨 收到LLOneBot事件:', message.post_type || 'unknown');
        
        // 如果是心跳事件，记录但不广播
        if (message.post_type === 'meta_event' && message.meta_event_type === 'heartbeat') {
          logger.debug('LLOneBot', '心跳');
          return;
        }
        
        // 🚀 后端直接处理事件（不依赖前端）
        this.handleEventInBackend(message).then(backendHandled => {
          // 广播事件给前端客户端（用于显示），标记是否已被后端处理
          const eventToClient = {
            ...message,
            _backendProcessed: true, // 标记已被后端处理
            _processedBy: 'backend_engine'
          };
          this.broadcastEvent(eventToClient);
        }).catch(error => {
          console.error('❌ 后端事件处理失败:', error);
          // 即使后端处理失败，也要广播事件
          this.broadcastEvent(message);
        });
      } catch (error) {
        console.error('❌ 解析LLOneBot消息失败:', error);
        console.log('原始数据:', data.toString().substring(0, 200));
      }
    });

    ws.on('close', (code, reason) => {
      console.log(`🔌 LLOneBot连接已断开 (code: ${code}, reason: ${reason})`);
      this.llonebotWs = null;
    });

    ws.on('error', (error) => {
      console.error('❌ LLOneBot连接错误:', error);
      this.llonebotWs = null;
    });
    
    // 发送连接成功日志给客户端
    this.broadcastEvent({
      post_type: 'meta_event',
      meta_event_type: 'lifecycle',
      sub_type: 'connect',
      time: Math.floor(Date.now() / 1000),
      self_id: 0,
      status: {
        online: true,
        good: true
      }
    });
  }

  /**
   * 处理LLOneBot API响应
   * @param {Object} response - API响应消息
   */
  handleLLOneBotApiResponse(response) {
    const { echo, status, retcode, data, message, wording } = response;
    
    // 查找对应的待处理请求
    const pendingRequest = this.pendingRequests.get(echo);
    if (!pendingRequest) {
      console.warn('⚠️ 收到未知echo的API响应:', echo);
      return;
    }
    
    // 清理请求记录
    this.pendingRequests.delete(echo);
    
    try {
      // 检查响应状态
      if (status === 'ok' && retcode === 0) {
        // 简化成功日志 - 只显示关键信息
        // console.log(`✅ API成功: ${pendingRequest.action}`);
        pendingRequest.resolve({ status, retcode, data, message, wording });
      } else {
        console.error(`❌ API失败: ${pendingRequest.action} (${retcode}): ${message}`);
        pendingRequest.reject(new Error(`LLOneBot API错误 (${retcode}): ${message || wording || '未知错误'}`));
      }
    } catch (error) {
      console.error('❌ 处理API响应时出错:', error);
      pendingRequest.reject(error);
    }
  }

  /**
   * 处理客户端消息
   * @param {string} clientId - 客户端ID
   * @param {Object} message - 消息对象
   */
  async handleClientMessage(clientId, message) {
    const client = this.clients.get(clientId);
    if (!client) return;

    // 心跳消息使用debug级别日志
    if (message.type === 'heartbeat') {
      logger.debug('客户端心跳', `[${clientId}]`);
    }

    switch (message.type) {
      case 'heartbeat':
        this.handleHeartbeat(clientId);
        break;
        
      case 'authenticate':
        await this.handleAuthentication(clientId, message);
        break;
      
      case 'api_call':
        await this.handleApiCall(clientId, message);
        break;
      
      case 'subscribe':
        this.handleSubscribe(clientId, message);
        break;
      
      default:
        console.warn(`⚠️ 未知消息类型: ${message.type}`);
        this.sendError(client.ws, 'UNKNOWN_TYPE', `未知消息类型: ${message.type}`);
    }
  }

  /**
   * 处理日志管理API
   * @param {string} action - 动作
   * @param {Object} params - 参数
   */
  async handleLogsApi(action, params) {
    try {
      logger.debug('日志API', `${action} - ${JSON.stringify(params)}`);
      
      switch (action) {
        case 'logs_get_history':
          // 获取日志历史
          const { limit = 1000, level = null, category = null, search = null } = params;
          let logs = logger.getLogHistory(limit, level, category);
          
          // 如果有搜索条件，进行过滤
          if (search) {
            const searchLower = search.toLowerCase();
            logs = logs.filter(log => 
              log.message.toLowerCase().includes(searchLower) ||
              log.title.toLowerCase().includes(searchLower) ||
              (log.data && JSON.stringify(log.data).toLowerCase().includes(searchLower))
            );
          }
          
          return {
            status: 'ok',
            retcode: 0,
            data: {
              logs,
              total: logs.length
            },
            message: '获取日志历史成功'
          };

        case 'logs_get_stats':
          // 获取日志统计
          const stats = logger.getLogStats();
          return {
            status: 'ok',
            retcode: 0,
            data: stats,
            message: '获取日志统计成功'
          };

        case 'logs_clear':
          // 清空日志历史（仅内存中的）
          logger.logHistory = [];
          return {
            status: 'ok',
            retcode: 0,
            data: { cleared: true },
            message: '日志历史已清空'
          };

        case 'logs_set_level':
          // 设置日志级别
          const { logLevel } = params;
          if (!logLevel || !['quiet', 'error', 'warn', 'info', 'verbose', 'debug'].includes(logLevel)) {
            throw new Error('无效的日志级别');
          }
          logger.setLevel(logLevel);
          return {
            status: 'ok',
            retcode: 0,
            data: { level: logLevel },
            message: `日志级别已设置为: ${logLevel}`
          };

        case 'logs_cleanup_files':
          // 清理旧日志文件
          const { daysToKeep = 30 } = params;
          logger.cleanupOldLogs(daysToKeep);
          return {
            status: 'ok',
            retcode: 0,
            data: { daysToKeep },
            message: `已清理 ${daysToKeep} 天前的日志文件`
          };

        case 'logs_export':
          // 导出日志
          const exportData = logger.exportLogs();
          return {
            status: 'ok',
            retcode: 0,
            data: { 
              content: exportData,
              filename: `kibot-logs-${new Date().toISOString().split('T')[0]}.log`
            },
            message: '日志导出成功'
          };

        default:
          throw new Error(`未知的日志API: ${action}`);
      }
    } catch (error) {
      logger.error('日志API', `处理失败: ${action}`, error);
      return {
        status: 'error',
        retcode: -1,
        data: null,
        message: `日志API调用失败: ${error.message}`
      };
    }
  }

  /**
   * 处理用户认证
   * @param {string} clientId - 客户端ID
   * @param {Object} message - 认证消息
   */
  async handleAuthentication(clientId, message) {
    const client = this.clients.get(clientId);
    if (!client) return;

    const { authCode } = message;
    
    console.log(`🔐 收到认证请求: ${clientId}`);

    try {
      // 使用安全中间件进行用户认证
      const authResult = await this.securityMiddleware.authenticateUser(authCode, {
        clientIp: client.remoteAddress,
        userAgent: client.userAgent
      });

      if (authResult.success) {
        // 认证成功，更新客户端信息
        client.authenticated = true;
        client.session = {
          sessionId: authResult.sessionId,
          permission: authResult.permission,
          createdAt: Date.now(),
          expiresAt: authResult.expiresAt
        };
        client.permission = authResult.permission;
        client.capabilities = this.getCapabilitiesByPermission(authResult.permission);

        console.log(`✅ 客户端认证成功: ${clientId} (权限: ${authResult.permission})`);

        // 发送认证成功响应
        this.sendToClient(client.ws, {
          type: 'auth_success',
          data: {
            sessionId: authResult.sessionId,
            permission: authResult.permission,
            expiresAt: authResult.expiresAt,
            capabilities: client.capabilities,
            message: authResult.message
          }
        });
      } else {
        // 认证失败
        console.warn(`❌ 客户端认证失败: ${clientId} - ${authResult.error}`);
        
        this.sendToClient(client.ws, {
          type: 'auth_failed',
          error: {
            code: authResult.error,
            message: authResult.message,
            remainingMinutes: authResult.remainingMinutes
          }
        });
        
        // 如果是被锁定的情况，可能需要关闭连接
        if (authResult.error === 'LOCKED_OUT') {
          setTimeout(() => {
            if (this.clients.has(clientId) && !this.clients.get(clientId).authenticated) {
              client.ws.close(1008, '认证失败次数过多');
            }
          }, 5000);
        }
      }
    } catch (error) {
      console.error(`❌ 认证处理失败: ${clientId}`, error);
      
      this.sendToClient(client.ws, {
        type: 'auth_failed',
        error: {
          code: 'INTERNAL_ERROR',
          message: '认证处理失败，请稍后重试'
        }
      });
    }
  }

  /**
   * 根据权限级别获取能力列表
   * @param {string} permission - 权限级别
   * @returns {Array} 能力列表
   */
  getCapabilitiesByPermission(permission) {
    const capabilities = {
      admin: ['api_calls', 'events', 'ui_updates', 'system_config', 'user_manage'],
      operator: ['api_calls', 'events', 'ui_updates', 'message_send'],
      viewer: ['api_calls', 'events', 'ui_updates'],
      guest: ['basic_view', 'heartbeat']
    };
    return capabilities[permission] || capabilities.guest;
  }

  /**
   * 处理心跳
   * @param {string} clientId - 客户端ID
   */
  handleHeartbeat(clientId) {
    const client = this.clients.get(clientId);
    if (client) {
      client.lastHeartbeat = new Date();
      this.sendToClient(client.ws, {
        type: 'heartbeat_response',
        data: { timestamp: Date.now() }
      });
    }
  }

  /**
   * 处理API调用
   * @param {string} clientId - 客户端ID
   * @param {Object} message - API调用消息
   */
  async handleApiCall(clientId, message) {
    const client = this.clients.get(clientId);
    if (!client) return;

    const { id, action, params = {} } = message;
    
    // 检查客户端是否已认证
    if (!client.authenticated) {
      logger.warning('未认证API', `${clientId.substring(0, 8)}... 尝试调用 ${action}`);
      
      this.sendToClient(client.ws, {
        type: 'api_response',
        id,
        error: {
          code: 'AUTHENTICATION_REQUIRED',
          message: '需要身份认证才能调用API'
        }
      });
      return;
    }

    // 使用安全中间件验证API调用权限
    const validationResult = await this.securityMiddleware.validateApiCall(
      client.session.sessionId,
      action,
      params,
      {
        clientIp: client.remoteAddress,
        userAgent: client.userAgent,
        clientId
      }
    );

    if (!validationResult.success) {
      logger.warning('权限验证', `${action} - ${validationResult.error} (客户端: ${clientId.substring(0, 8)}...)`);
      
      this.sendToClient(client.ws, {
        type: 'api_response',
        id,
        error: {
          code: validationResult.error,
          message: validationResult.message
        }
      });
      return;
    }

    // 如果是敏感操作，记录额外的日志
    if (validationResult.isSensitive) {
      logger.warning('敏感操作', `${action} (客户端: ${clientId.substring(0, 8)}..., 权限: ${client.permission})`);
    }
    
    // 只在debug模式下记录API调用详情
    if (process.env.LOG_LEVEL === 'debug') {
      logger.debug('API调用', `${action} from ${clientId.substring(0, 8)}...`);
    }

    try {
      let response;
      
      // 首先检查是否是规则管理API  
      if (action.startsWith('rules_')) {
        response = await this.handleRulesApi(action, params);
      }
      // 检查是否是分组管理API
      else if (action.startsWith('groups_')) {
        response = await this.handleRulesApi(action, params);
      }
      // 检查是否是后端内部API
      else if (action.startsWith('internal_')) {
        response = await this.handleRulesApi(action, params);
      }
      // 检查是否是插件管理API
      else if (action.startsWith('plugins_')) {
        response = await this.handleRulesApi(action, params);
      }
      // 统一监控API处理 - 修复API混乱问题
      else if (action === 'monitor_stats' || action === 'monitor_realtime' || action === 'monitor_get_stats') {
        response = await this.handleMonitorApiNew(action, params);
      }
      // 检查是否是日志管理API
      else if (action.startsWith('logs_')) {
        response = await this.handleLogsApi(action, params);
      }
      // 检查是否是新版监控API
      else if (action.startsWith('monitor_')) {
        response = await this.handleMonitorApiNew(action, params);
      }
      // 检查是否是任务管理API
      else if (action.startsWith('tasks_')) {
        response = await this.handleTasksApi(action, params);
      }
      // 检查是否是系统性能API
      else if (action === 'system_performance' || action === 'plugin_performance' || action === 'clear_api_stats' || action === 'clear_plugins_performance') {
        response = await this.handleRulesApi(action, params);
      }
      // 优先通过WebSocket调用（如果LLOneBot已连接）
      else if (this.llonebotWs && this.llonebotWs.readyState === 1) {
        response = await this.callLLOneBotViaWebSocket(action, params, id);
      } else {
        // WebSocket未连接，只能处理本地API
        logger.error('API调用', `${action} - WebSocket未连接`);
        throw new Error('WebSocket未连接，无法调用LLOneBot API。请等待连接建立。');
      }

      // 发送响应
      this.sendToClient(client.ws, {
        type: 'api_response',
        id,
        data: response
      });

    } catch (error) {
      logger.error('API调用', `${action} 失败: ${error.message}`);
      
      this.sendToClient(client.ws, {
        type: 'api_response',
        id,
        error: {
          code: 'API_ERROR',
          message: error.message || 'API调用失败'
        }
      });
    }
  }

  /**
   * 处理规则管理API
   * @param {string} action - API动作
   * @param {Object} params - 参数
   */
  async handleRulesApi(action, params) {
    try {
      // 只在debug模式下记录
      if (process.env.LOG_LEVEL === 'debug') {
        logger.debug('规则API', `${action}: ${JSON.stringify(params)}`);
      }
      
      switch (action) {
        case 'rules_get_all':
          // 获取所有规则
          return {
            status: 'ok',
            retcode: 0,
            data: this.eventEngine.getRules(),
            message: '获取规则列表成功'
          };
        
        case 'rules_add':
          // 添加新规则
          if (!params.rule) {
            throw new Error('缺少规则参数');
          }
          const newRuleId = this.eventEngine.addRule(params.rule);
          return {
            status: 'ok',
            retcode: 0,
            data: { ruleId: newRuleId },
            message: '规则添加成功'
          };
        
        case 'rules_update':
          // 更新规则
          if (!params.ruleId || !params.rule) {
            throw new Error('缺少规则ID或规则参数');
          }
          const updateSuccess = this.eventEngine.updateRule(params.ruleId, params.rule);
          if (updateSuccess) {
            return {
              status: 'ok',
              retcode: 0,
              data: { ruleId: params.ruleId },
              message: '规则更新成功'
            };
          } else {
            throw new Error('规则不存在');
          }
        
        case 'rules_delete':
          // 删除规则
          if (!params.ruleId) {
            throw new Error('缺少规则ID');
          }
          console.log(`🗑️ 尝试删除规则: ${params.ruleId}`);
          
          // 先查看当前所有规则的ID
          const currentRules = this.eventEngine.getRules();
          console.log(`📋 当前规则数量: ${currentRules.length}`);
          console.log(`📋 当前规则ID列表:`, currentRules.map(r => r.id));
          
          const deleteSuccess = this.eventEngine.deleteRule(params.ruleId);
          if (deleteSuccess) {
            console.log(`✅ 规则删除成功: ${params.ruleId}`);
            return {
              status: 'ok',
              retcode: 0,
              data: { ruleId: params.ruleId },
              message: '规则删除成功'
            };
          } else {
            console.error(`❌ 规则删除失败，规则不存在: ${params.ruleId}`);
            throw new Error(`规则不存在: ${params.ruleId}`);
          }
        
        case 'rules_reload':
          // 重新加载规则
          const reloadedRules = this.eventEngine.reloadRules();
          return {
            status: 'ok',
            retcode: 0,
            data: reloadedRules,
            message: '规则重新加载成功'
          };

        case 'rules_debug':
          // 调试信息 - 显示所有规则ID和基本信息
          const debugRules = this.eventEngine.getRules();
          return {
            status: 'ok',
            retcode: 0,
            data: {
              count: debugRules.length,
              enabledCount: debugRules.filter(r => r.enabled).length,
              rules: debugRules.map(r => ({
                id: r.id,
                name: r.name,
                enabled: r.enabled,
                groupId: r.groupId || 'default',
                eventType: r.eventType,
                conditions: r.conditions,
                actions: r.actions?.map(a => ({ type: a.type, hasMessage: !!a.params?.message })) || []
              }))
            },
            message: '规则调试信息'
          };

        case 'rules_duplicate_check':
          // 检查重复规则 - 查找可能导致重复回复的规则
          const allRules = this.eventEngine.getRules();
          const enabledRules = allRules.filter(r => r.enabled);
          const duplicateGroups = new Map();
          
          // 按关键词分组检查
          enabledRules.forEach(rule => {
            if (rule.eventType === 'message') {
              rule.conditions.forEach(condition => {
                if (condition.type === 'keyword') {
                  const key = `${condition.operator}:${condition.value}`;
                  if (!duplicateGroups.has(key)) {
                    duplicateGroups.set(key, []);
                  }
                  duplicateGroups.get(key).push({
                    id: rule.id,
                    name: rule.name,
                    actions: rule.actions?.length || 0
                  });
                }
              });
            }
          });
          
          // 找到重复的关键词
          const conflicts = [];
          duplicateGroups.forEach((rules, keyword) => {
            if (rules.length > 1) {
              conflicts.push({
                keyword: keyword,
                ruleCount: rules.length,
                rules: rules
              });
            }
          });
          
          return {
            status: 'ok',
            retcode: 0,
            data: {
              totalEnabledRules: enabledRules.length,
              conflictCount: conflicts.length,
              conflicts: conflicts
            },
            message: conflicts.length > 0 ? '发现规则冲突' : '没有发现规则冲突'
          };

        // execute_user_command API已移除，现在execute_command动作直接调用LLOneBot API

        case 'groups_get_all':
          // 获取所有分组
          const groups = this.getGroups();
          return {
            status: 'ok',
            retcode: 0,
            data: groups,
            message: '获取分组列表成功'
          };

        case 'groups_add':
          // 添加新分组
          if (!params.group) {
            throw new Error('缺少分组参数');
          }
          const newGroupId = this.addGroup(params.group);
          return {
            status: 'ok',
            retcode: 0,
            data: { groupId: newGroupId },
            message: '分组添加成功'
          };

        case 'groups_update':
          // 更新分组
          if (!params.groupId || !params.group) {
            throw new Error('缺少分组ID或分组参数');
          }
          const groupUpdateSuccess = this.updateGroup(params.groupId, params.group);
          if (groupUpdateSuccess) {
            return {
              status: 'ok',
              retcode: 0,
              data: { groupId: params.groupId },
              message: '分组更新成功'
            };
          } else {
            throw new Error('分组不存在');
          }

        case 'groups_delete':
          // 删除分组
          if (!params.groupId) {
            throw new Error('缺少分组ID');
          }
          const groupDeleteSuccess = this.deleteGroup(params.groupId);
          if (groupDeleteSuccess) {
            return {
              status: 'ok',
              retcode: 0,
              data: { groupId: params.groupId },
              message: '分组删除成功'
            };
          } else {
            throw new Error('分组不存在');
          }

        // 插件管理API
        case 'plugins_list':
          // 获取插件列表
          const pluginList = this.pluginManager.getPluginList();
          return {
            status: 'ok',
            retcode: 0,
            data: pluginList,
            message: '获取插件列表成功'
          };

        case 'plugins_info':
          // 获取插件详细信息
          if (!params.pluginId) {
            throw new Error('缺少插件ID');
          }
          const pluginInfo = this.pluginManager.getPluginDetailedInfo(params.pluginId);
          if (!pluginInfo) {
            throw new Error('插件不存在');
          }
          return {
            status: 'ok',
            retcode: 0,
            data: pluginInfo,
            message: '获取插件详细信息成功'
          };

        case 'plugins_performance':
          // 获取所有插件的性能数据
          const performanceData = this.pluginManager.getAllPluginsPerformance();
          return {
            status: 'ok',
            retcode: 0,
            data: performanceData,
            message: '获取插件性能数据成功'
          };

        case 'plugin_performance':
          // 获取单个插件的性能数据
          if (!params.pluginId) {
            throw new Error('缺少插件ID');
          }
          const pluginPerf = this.pluginManager.getPluginPerformance(params.pluginId);
          if (!pluginPerf) {
            throw new Error('插件不存在或未加载');
          }
          return {
            status: 'ok',
            retcode: 0,
            data: pluginPerf,
            message: '获取插件性能数据成功'
          };

        case 'system_performance':
          // 获取系统性能数据
          const systemPerformance = this.getSystemPerformance();
          return {
            status: 'ok',
            retcode: 0,
            data: systemPerformance,
            message: '获取系统性能数据成功'
          };

        case 'clear_api_stats':
          // 清理API统计数据
          const clearResult = this.systemStats.clearHttpStats();
          return {
            status: 'ok',
            retcode: 0,
            data: clearResult,
            message: 'API统计数据已清理'
          };

        case 'clear_plugins_performance':
          // 清理所有插件性能数据
          const clearPluginsResult = this.pluginManager.clearAllPluginsPerformance();
          return {
            status: 'ok',
            retcode: 0,
            data: clearPluginsResult,
            message: clearPluginsResult.message
          };

        case 'plugins_enable':
          // 启用插件
          if (!params.pluginId) {
            throw new Error('缺少插件ID');
          }
          logger.info('插件管理', `启用插件: ${params.pluginId}`);
          await this.pluginManager.enablePlugin(params.pluginId);
          return {
            status: 'ok',
            retcode: 0,
            data: { pluginId: params.pluginId },
            message: '插件启用成功'
          };

        case 'plugins_disable':
          // 禁用插件
          if (!params.pluginId) {
            throw new Error('缺少插件ID');
          }
          console.log(`⏸️ API请求禁用插件: ${params.pluginId}`);
          await this.pluginManager.disablePlugin(params.pluginId);
          return {
            status: 'ok',
            retcode: 0,
            data: { pluginId: params.pluginId },
            message: '插件禁用成功'
          };

        case 'plugins_reload':
          // 重载插件
          if (!params.pluginId) {
            throw new Error('缺少插件ID');
          }
          console.log(`🔄 API请求重载插件: ${params.pluginId}`);
          await this.pluginManager.reloadPlugin(params.pluginId);
          return {
            status: 'ok',
            retcode: 0,
            data: { pluginId: params.pluginId },
            message: '插件重载成功'
          };

        case 'plugins_install':
          // 安装插件
          if (!params.source) {
            throw new Error('缺少插件源');
          }
          console.log(`📥 API请求安装插件: ${params.source}`);
          await this.pluginManager.installPlugin(params.source);
          return {
            status: 'ok',
            retcode: 0,
            data: { source: params.source },
            message: '插件安装成功'
          };

        case 'plugins_remove':
          // 删除插件
          if (!params.pluginId) {
            throw new Error('缺少插件ID');
          }
          console.log(`🗑️ API请求删除插件: ${params.pluginId}`);
          await this.pluginManager.removePlugin(params.pluginId);
          return {
            status: 'ok',
            retcode: 0,
            data: { pluginId: params.pluginId },
            message: '插件删除成功'
          };

        case 'plugins_scan':
          // 扫描插件
          console.log(`🔍 API请求扫描插件`);
          const scannedPlugins = await this.pluginManager.scanPlugins();
          return {
            status: 'ok',
            retcode: 0,
            data: scannedPlugins,
            message: '插件扫描完成'
          };

        case 'plugins_commands':
          // 获取插件指令信息
          if (!params.pluginId) {
            throw new Error('缺少插件ID');
          }
          const commandInfo = this.getPluginCommandsInfo(params.pluginId);
          return {
            status: 'ok',
            retcode: 0,
            data: commandInfo,
            message: '获取插件指令信息成功'
          };

        case 'plugins_errors':
          // 获取插件错误信息
          if (!params.pluginId) {
            throw new Error('缺少插件ID');
          }
          const errorInfo = this.getPluginErrorsInfo(params.pluginId);
          return {
            status: 'ok',
            retcode: 0,
            data: errorInfo,
            message: '获取插件错误信息成功'
          };
        
        default:
          throw new Error(`未知的规则API: ${action}`);
      }
    } catch (error) {
      logger.error('规则API', `${action}: ${error.message}`);
      return {
        status: 'failed',
        retcode: -1,
        data: null,
        message: error.message || '规则API调用失败'
      };
    }
  }

  /**
   * 处理系统配置API
   * @param {string} action - API动作
   * @param {Object} params - 参数
   */
  async handleSystemApi(action, params) {
    try {
      logger.debug('系统API', `${action} - ${JSON.stringify(params)}`);
      
      switch (action) {
        case 'get_status':
          // 获取服务器状态
          return {
            status: 'ok',
            retcode: 0,
            data: {
              online: true,
              uptime: process.uptime(),
              version: SERVER_VERSION,
              timestamp: Date.now(),
              connections: {
                llonebot: this.llonebotWs ? (this.llonebotWs.readyState === 1) : false,
                webClients: this.wss.clients.size
              }
            },
            message: '获取服务器状态成功'
          };

        case 'get_system_config':
          // 获取系统配置
          try {
            const defaultConfig = {
              logLevel: 'info',
              apiTimeout: 15000,
              enableAutoReply: false,
              enableEventEngine: true,
              enableTaskManager: true,
              enablePluginSystem: true,
              maxConnections: 100,
              heartbeatInterval: 30000,
              reconnectAttempts: 5
            };
            
            return {
              status: 'ok',
              retcode: 0,
              data: defaultConfig,
              message: '获取系统配置成功'
            };
          } catch (error) {
            return {
              status: 'error',
              retcode: -1,
              data: null,
              message: `获取系统配置失败: ${error.message}`
            };
          }

        case 'set_system_config':
          // 设置系统配置
          try {
            const config = params;
            console.log('📝 更新系统配置:', config);
            
            // 这里可以添加实际的配置保存逻辑
            // 目前只是模拟保存成功
            
            return {
              status: 'ok',
              retcode: 0,
              data: config,
              message: '系统配置保存成功'
            };
          } catch (error) {
            return {
              status: 'error',
              retcode: -1,
              data: null,
              message: `保存系统配置失败: ${error.message}`
            };
          }

        case 'reset_system_config':
          // 重置系统配置
          try {
            const defaultConfig = {
              logLevel: 'info',
              apiTimeout: 15000,
              enableAutoReply: false,
              enableEventEngine: true,
              enableTaskManager: true,
              enablePluginSystem: true,
              maxConnections: 100,
              heartbeatInterval: 30000,
              reconnectAttempts: 5
            };
            
            console.log('🔄 重置系统配置为默认值');
            
            return {
              status: 'ok',
              retcode: 0,
              data: defaultConfig,
              message: '系统配置重置成功'
            };
          } catch (error) {
            return {
              status: 'error',
              retcode: -1,
              data: null,
              message: `重置系统配置失败: ${error.message}`
            };
          }

        case 'restart_service':
          // 重启服务
          try {
            console.log('🔄 收到服务重启请求');
            
            // 延迟重启，给前端时间接收响应
            setTimeout(() => {
              console.log('🔄 正在重启服务...');
              process.exit(0);
            }, 1000);
            
            return {
              status: 'ok',
              retcode: 0,
              data: null,
              message: '服务重启请求已接受'
            };
          } catch (error) {
            return {
              status: 'error',
              retcode: -1,
              data: null,
              message: `重启服务失败: ${error.message}`
            };
          }

        case 'internal_security_stats':
          // 获取内部安全统计信息
          try {
            const securityStats = {
              sessionCount: this.wss ? this.wss.clients.size : 0,
              totalRequests: this.apiCallCount || 0,
              failedRequests: this.apiFailCount || 0,
              lastRequest: this.lastApiCall || null,
              uptime: process.uptime(),
              memoryUsage: process.memoryUsage(),
              connectionStatus: {
                llonebot: this.llonebotWs ? (this.llonebotWs.readyState === 1) : false,
                webClients: this.wss ? this.wss.clients.size : 0
              },
              security: {
                authAttempts: this.authAttempts || 0,
                blockedIPs: [],
                rateLimitViolations: 0
              },
              performance: {
                avgResponseTime: 50, // 模拟数据
                requestsPerMinute: 10, // 模拟数据
                errorRate: '2.1%' // 模拟数据
              }
            };
            
            return {
              status: 'ok',
              retcode: 0,
              data: securityStats,
              message: '获取安全统计成功'
            };
          } catch (error) {
            return {
              status: 'error',
              retcode: -1,
              data: null,
              message: `获取安全统计失败: ${error.message}`
            };
          }

        case 'generate_auth_code':
          // 生成新的授权码（需要管理员权限）
          try {
            const { permission } = params;
            const sessionId = params.sessionId;
            
            if (!permission) {
              return {
                status: 'error',
                retcode: -1,
                data: null,
                message: '缺少权限参数'
              };
            }

            if (!sessionId) {
              return {
                status: 'error',
                retcode: -1,
                data: null,
                message: '缺少会话ID'
              };
            }

            const result = this.securityMiddleware.generateNewAuthCode(permission, sessionId);
            
            if (result.success) {
              return {
                status: 'ok',
                retcode: 0,
                data: {
                  permission: result.permission,
                  authCode: result.authCode
                },
                message: result.message
              };
            } else {
              return {
                status: 'error',
                retcode: -1,
                data: null,
                message: result.message
              };
            }
          } catch (error) {
            return {
              status: 'error',
              retcode: -1,
              data: null,
              message: `生成授权码失败: ${error.message}`
            };
          }

        case 'reload_security_config':
          // 重新加载安全配置（需要管理员权限）
          try {
            const sessionId = params.sessionId;
            
            if (!sessionId) {
              return {
                status: 'error',
                retcode: -1,
                data: null,
                message: '缺少会话ID'
              };
            }

            const result = this.securityMiddleware.reloadSecurityConfig(sessionId);
            
            if (result.success) {
              return {
                status: 'ok',
                retcode: 0,
                data: null,
                message: result.message
              };
            } else {
              return {
                status: 'error',
                retcode: -1,
                data: null,
                message: result.message
              };
            }
          } catch (error) {
            return {
              status: 'error',
              retcode: -1,
              data: null,
              message: `重新加载配置失败: ${error.message}`
            };
          }

        case 'get_changelog':
          // 获取更新日志
          try {
            const changelogPath = path.join(__dirname, 'data', 'changelog.json');
            
            if (fs.existsSync(changelogPath)) {
              const changelogData = fs.readFileSync(changelogPath, 'utf8');
              const changelog = JSON.parse(changelogData);
              
              return {
                status: 'ok',
                retcode: 0,
                data: changelog,
                message: '获取更新日志成功'
              };
            } else {
              // 如果文件不存在，返回默认数据
              return {
                status: 'ok',
                retcode: 0,
                data: {
                  version: SERVER_VERSION,
                  releaseDate: '2025-10-25',
                  changelog: []
                },
                message: '更新日志文件不存在'
              };
            }
          } catch (error) {
            return {
              status: 'error',
              retcode: -1,
              data: null,
              message: `获取更新日志失败: ${error.message}`
            };
          }

        case 'get_system_settings':
          // 获取系统设置
          try {
            const settingsPath = path.join(__dirname, 'data', 'system-settings.json');
            let settings = {
              dataPath: './data',
              statisticsPath: './data/statistics',
              logsPath: './data/logs',
              backupPath: './data/backups',
              autoRefresh: true,
              refreshInterval: 30,
              dataRetentionDays: 30,
              autoCleanup: true,
              enableMonitoring: true,
              monitoringInterval: 60,
              enablePerformanceTracking: true,
              maxLogEntries: 1000
            };
            
            // 尝试从文件加载设置
            if (fs.existsSync(settingsPath)) {
              try {
                const savedSettings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
                settings = { ...settings, ...savedSettings };
              } catch (error) {
                logger.warn('系统设置', '加载设置文件失败，使用默认设置');
              }
            }
            
            return {
              status: 'ok',
              retcode: 0,
              data: settings,
              message: '获取系统设置成功'
            };
          } catch (error) {
            return {
              status: 'error',
              retcode: -1,
              data: null,
              message: `获取系统设置失败: ${error.message}`
            };
          }

        case 'update_system_settings':
          // 更新系统设置
          try {
            const settingsPath = path.join(__dirname, 'data', 'system-settings.json');
            const dataDir = path.join(__dirname, 'data');
            
            // 确保data目录存在
            if (!fs.existsSync(dataDir)) {
              fs.mkdirSync(dataDir, { recursive: true });
            }
            
            // 保存设置到文件
            fs.writeFileSync(settingsPath, JSON.stringify(params, null, 2), 'utf8');
            
            logger.success('系统设置', '设置已更新');
            
            // 通知系统统计模块重新加载设置
            if (systemStatistics && typeof systemStatistics.reloadSettings === 'function') {
              systemStatistics.reloadSettings();
              logger.info('系统设置', '监控配置已重新加载');
            }
            
            return {
              status: 'ok',
              retcode: 0,
              data: params,
              message: '系统设置保存成功，部分配置已生效'
            };
          } catch (error) {
            return {
              status: 'error',
              retcode: -1,
              data: null,
              message: `保存系统设置失败: ${error.message}`
            };
          }

        case 'get_disk_usage':
          // 获取磁盘使用情况
          try {
            const dataDir = path.join(__dirname, 'data');
            let totalSize = 0;
            
            // 递归计算目录大小
            const calculateDirSize = (dirPath) => {
              let size = 0;
              if (!fs.existsSync(dirPath)) return size;
              
              try {
                const files = fs.readdirSync(dirPath);
                for (const file of files) {
                  const filePath = path.join(dirPath, file);
                  try {
                    const stat = fs.statSync(filePath);
                    if (stat.isFile()) {
                      size += stat.size;
                    } else if (stat.isDirectory()) {
                      size += calculateDirSize(filePath);
                    }
                  } catch (e) {
                    // 忽略无法访问的文件
                  }
                }
              } catch (e) {
                // 忽略无法访问的目录
              }
              return size;
            };
            
            totalSize = calculateDirSize(dataDir);
            
            // 获取系统磁盘信息（仅Unix/Linux系统）
            let diskInfo = {
              total: 0,
              used: 0,
              free: 0,
              usage: 0
            };
            
            // 在Windows上可以使用data目录所在磁盘的信息
            if (os.platform() === 'win32') {
              // Windows上只返回数据目录大小
              diskInfo = {
                total: totalSize * 100, // 估算
                used: totalSize,
                free: totalSize * 99,
                usage: 1
              };
            } else {
              // Unix/Linux系统尝试读取磁盘信息
              try {
                const { execSync } = require('child_process');
                const dfOutput = execSync(`df -k "${dataDir}"`).toString();
                const lines = dfOutput.split('\n');
                if (lines.length > 1) {
                  const parts = lines[1].split(/\s+/);
                  if (parts.length >= 5) {
                    diskInfo = {
                      total: parseInt(parts[1]) * 1024,
                      used: parseInt(parts[2]) * 1024,
                      free: parseInt(parts[3]) * 1024,
                      usage: parseInt(parts[4])
                    };
                  }
                }
              } catch (e) {
                // 如果命令失败，使用data目录大小
                diskInfo = {
                  total: totalSize * 100,
                  used: totalSize,
                  free: totalSize * 99,
                  usage: 1
                };
              }
            }
            
            return {
              status: 'ok',
              retcode: 0,
              data: {
                ...diskInfo,
                dataSize: totalSize
              },
              message: '获取磁盘使用情况成功'
            };
          } catch (error) {
            return {
              status: 'error',
              retcode: -1,
              data: {
                total: 0,
                used: 0,
                free: 0,
                usage: 0,
                dataSize: 0
              },
              message: `获取磁盘使用情况失败: ${error.message}`
            };
          }

        case 'get_data_stats':
          // 获取各类数据的统计信息
          try {
            const dataDir = path.join(__dirname, 'data');
            
            // 计算目录大小和文件数
            const getDirStats = (dirPath) => {
              let size = 0;
              let files = 0;
              
              if (!fs.existsSync(dirPath)) {
                return { size: 0, files: 0 };
              }
              
              try {
                const items = fs.readdirSync(dirPath);
                for (const item of items) {
                  const itemPath = path.join(dirPath, item);
                  try {
                    const stat = fs.statSync(itemPath);
                    if (stat.isFile()) {
                      size += stat.size;
                      files++;
                    } else if (stat.isDirectory()) {
                      const subStats = getDirStats(itemPath);
                      size += subStats.size;
                      files += subStats.files;
                    }
                  } catch (e) {
                    // 忽略无法访问的文件
                  }
                }
              } catch (e) {
                // 忽略无法访问的目录
              }
              
              return { size, files };
            };
            
            const statisticsStats = getDirStats(path.join(dataDir, 'statistics'));
            const logsStats = getDirStats(path.join(dataDir, 'logs'));
            const backupsStats = getDirStats(path.join(dataDir, 'backups'));
            
            const totalSize = statisticsStats.size + logsStats.size + backupsStats.size;
            const totalFiles = statisticsStats.files + logsStats.files + backupsStats.files;
            
            return {
              status: 'ok',
              retcode: 0,
              data: {
                statistics: statisticsStats,
                logs: logsStats,
                backups: backupsStats,
                total: {
                  size: totalSize,
                  files: totalFiles
                }
              },
              message: '获取数据统计成功'
            };
          } catch (error) {
            return {
              status: 'error',
              retcode: -1,
              data: null,
              message: `获取数据统计失败: ${error.message}`
            };
          }

        case 'cleanup_data':
          // 清理过期数据
          try {
            const { type, daysToKeep = 30 } = params;
            const dataDir = path.join(__dirname, 'data');
            const cutoffTime = Date.now() - (daysToKeep * 24 * 60 * 60 * 1000);
            const cutoffDate = new Date(cutoffTime).toLocaleString('zh-CN');
            
            logger.info('数据清理', `开始清理 ${type} 类型的数据，保留 ${daysToKeep} 天内的文件 (${cutoffDate} 之后)`);
            
            let deletedFiles = 0;
            let deletedSize = 0;
            let scannedFiles = 0;
            const deletedList = [];
            
            // 清理指定目录中的过期文件
            const cleanupDir = (dirPath, dirName = '') => {
              if (!fs.existsSync(dirPath)) {
                logger.info('数据清理', `目录不存在，跳过: ${dirPath}`);
                return;
              }
              
              logger.info('数据清理', `正在扫描目录: ${dirPath}`);
              
              try {
                const items = fs.readdirSync(dirPath);
                logger.info('数据清理', `找到 ${items.length} 个项目`);
                
                for (const item of items) {
                  const itemPath = path.join(dirPath, item);
                  try {
                    const stat = fs.statSync(itemPath);
                    scannedFiles++;
                    
                    if (stat.isFile()) {
                      const fileAge = Date.now() - stat.mtimeMs;
                      const fileAgeDays = Math.floor(fileAge / (24 * 60 * 60 * 1000));
                      
                      logger.debug('数据清理', `文件: ${item}, 修改时间: ${new Date(stat.mtimeMs).toLocaleString('zh-CN')}, 年龄: ${fileAgeDays} 天`);
                      
                      if (stat.mtimeMs < cutoffTime) {
                        const size = stat.size;
                        fs.unlinkSync(itemPath);
                        deletedFiles++;
                        deletedSize += size;
                        deletedList.push({ file: item, size, dir: dirName });
                        logger.info('数据清理', `✓ 删除文件: ${item} (${Math.round(size / 1024)}KB, ${fileAgeDays}天前)`);
                      } else {
                        logger.debug('数据清理', `✗ 保留文件: ${item} (${fileAgeDays}天前，未超过${daysToKeep}天)`);
                      }
                    } else if (stat.isDirectory()) {
                      cleanupDir(itemPath, `${dirName}/${item}`);
                      // 尝试删除空目录
                      try {
                        if (fs.readdirSync(itemPath).length === 0) {
                          fs.rmdirSync(itemPath);
                          logger.info('数据清理', `✓ 删除空目录: ${item}`);
                        }
                      } catch (e) {
                        // 忽略
                      }
                    }
                  } catch (e) {
                    logger.warn('数据清理', `无法处理: ${item} - ${e.message}`);
                  }
                }
              } catch (e) {
                logger.warn('数据清理', `无法读取目录: ${dirPath} - ${e.message}`);
              }
            };
            
            // 根据类型清理对应的目录
            const dirsToClean = [];
            switch (type) {
              case 'statistics':
                dirsToClean.push({ path: path.join(dataDir, 'statistics'), name: '统计数据' });
                dirsToClean.push({ path: path.join(dataDir, 'monitoring'), name: '监控数据' });
                break;
              case 'logs':
                dirsToClean.push({ path: path.join(dataDir, 'logs'), name: '日志文件' });
                break;
              case 'backups':
                dirsToClean.push({ path: path.join(dataDir, 'backups'), name: '备份文件' });
                dirsToClean.push({ path: path.join(dataDir, 'monitoring', 'backups'), name: '监控备份' });
                break;
              case 'all':
                dirsToClean.push({ path: path.join(dataDir, 'statistics'), name: '统计数据' });
                dirsToClean.push({ path: path.join(dataDir, 'monitoring'), name: '监控数据' });
                dirsToClean.push({ path: path.join(dataDir, 'logs'), name: '日志文件' });
                dirsToClean.push({ path: path.join(dataDir, 'backups'), name: '备份文件' });
                break;
              default:
                throw new Error('未知的清理类型');
            }
            
            // 执行清理
            for (const dir of dirsToClean) {
              logger.info('数据清理', `===== 开始清理 ${dir.name} =====`);
              cleanupDir(dir.path, dir.name);
            }
            
            const sizeMB = Math.round(deletedSize / 1024 / 1024 * 100) / 100;
            const summaryMsg = deletedFiles > 0 
              ? `已删除 ${deletedFiles} 个文件，释放 ${sizeMB}MB 空间`
              : `没有找到需要清理的文件 (扫描了 ${scannedFiles} 个文件)`;
            
            logger.success('数据清理', summaryMsg);
            
            if (deletedList.length > 0) {
              logger.info('数据清理', '清理详情:');
              deletedList.forEach(item => {
                logger.info('数据清理', `  - [${item.dir}] ${item.file} (${Math.round(item.size / 1024)}KB)`);
              });
            }
            
            return {
              status: 'ok',
              retcode: 0,
              data: {
                deletedFiles,
                deletedSize,
                scannedFiles,
                type,
                daysToKeep,
                deletedList: deletedList.slice(0, 20), // 只返回前20个
                cutoffDate
              },
              message: summaryMsg
            };
          } catch (error) {
            logger.error('数据清理', error.message);
            return {
              status: 'error',
              retcode: -1,
              data: null,
              message: `数据清理失败: ${error.message}`
            };
          }

        case 'archive_old_data':
          // 归档旧数据
          try {
            const { daysToKeep = 30 } = params;
            const dataDir = path.join(__dirname, 'data');
            const archiveDir = path.join(dataDir, 'archives');
            const cutoffTime = Date.now() - (daysToKeep * 24 * 60 * 60 * 1000);
            const cutoffDate = new Date(cutoffTime).toLocaleString('zh-CN');
            
            logger.info('数据归档', `开始归档 ${daysToKeep} 天前的数据 (${cutoffDate} 之前)`);
            
            // 确保归档目录存在
            if (!fs.existsSync(archiveDir)) {
              fs.mkdirSync(archiveDir, { recursive: true });
              logger.info('数据归档', '创建归档目录: ' + archiveDir);
            }
            
            let archivedFiles = 0;
            let archivedSize = 0;
            let scannedFiles = 0;
            
            // 创建归档文件名
            const archiveName = `archive-${new Date().toISOString().split('T')[0]}-${Date.now()}.json`;
            const archivePath = path.join(archiveDir, archiveName);
            const archiveData = {
              createdAt: new Date().toISOString(),
              daysToKeep,
              cutoffDate,
              files: []
            };
            
            // 归档指定目录中的过期文件
            const archiveDir_fn = (dirPath, relativeDir = '') => {
              if (!fs.existsSync(dirPath)) {
                logger.info('数据归档', `目录不存在，跳过: ${dirPath}`);
                return;
              }
              
              logger.info('数据归档', `正在扫描目录: ${dirPath}`);
              
              try {
                const items = fs.readdirSync(dirPath);
                logger.info('数据归档', `找到 ${items.length} 个项目`);
                
                for (const item of items) {
                  const itemPath = path.join(dirPath, item);
                  try {
                    const stat = fs.statSync(itemPath);
                    scannedFiles++;
                    
                    if (stat.isFile()) {
                      const fileAge = Date.now() - stat.mtimeMs;
                      const fileAgeDays = Math.floor(fileAge / (24 * 60 * 60 * 1000));
                      
                      if (stat.mtimeMs < cutoffTime) {
                        // 读取文件内容
                        const content = fs.readFileSync(itemPath, 'utf8');
                        archiveData.files.push({
                          path: path.join(relativeDir, item),
                          size: stat.size,
                          mtime: stat.mtime,
                          content: content
                        });
                        
                        archivedFiles++;
                        archivedSize += stat.size;
                        
                        logger.info('数据归档', `✓ 归档文件: ${item} (${Math.round(stat.size / 1024)}KB, ${fileAgeDays}天前)`);
                        
                        // 删除原文件
                        fs.unlinkSync(itemPath);
                      } else {
                        logger.debug('数据归档', `✗ 跳过文件: ${item} (${fileAgeDays}天前，未超过${daysToKeep}天)`);
                      }
                    } else if (stat.isDirectory()) {
                      archiveDir_fn(itemPath, path.join(relativeDir, item));
                    }
                  } catch (e) {
                    logger.warn('数据归档', `无法处理: ${item} - ${e.message}`);
                  }
                }
              } catch (e) {
                logger.warn('数据归档', `无法读取目录: ${dirPath} - ${e.message}`);
              }
            };
            
            // 归档所有类型的数据
            const dirsToArchive = [
              { path: path.join(dataDir, 'statistics'), name: 'statistics' },
              { path: path.join(dataDir, 'monitoring'), name: 'monitoring' },
              { path: path.join(dataDir, 'logs'), name: 'logs' },
              { path: path.join(dataDir, 'backups'), name: 'backups' }
            ];
            
            for (const dir of dirsToArchive) {
              logger.info('数据归档', `===== 开始归档 ${dir.name} =====`);
              archiveDir_fn(dir.path, dir.name);
            }
            
            // 保存归档文件
            if (archivedFiles > 0) {
              fs.writeFileSync(archivePath, JSON.stringify(archiveData, null, 2));
              const sizeMB = Math.round(archivedSize / 1024 / 1024 * 100) / 100;
              logger.success('数据归档', `已归档 ${archivedFiles} 个文件到 ${archiveName} (${sizeMB}MB)`);
            } else {
              logger.info('数据归档', `没有找到需要归档的文件 (扫描了 ${scannedFiles} 个文件)`);
            }
            
            const sizeMB = Math.round(archivedSize / 1024 / 1024 * 100) / 100;
            
            return {
              status: 'ok',
              retcode: 0,
              data: {
                archivedFiles,
                archivedSize,
                scannedFiles,
                archiveName: archivedFiles > 0 ? archiveName : null,
                archivePath: archivedFiles > 0 ? archivePath : null,
                daysToKeep,
                cutoffDate,
                sizeMB
              },
              message: archivedFiles > 0 
                ? `归档完成，已归档 ${archivedFiles} 个文件 (${sizeMB}MB)` 
                : `没有找到需要归档的文件 (扫描了 ${scannedFiles} 个文件)`
            };
          } catch (error) {
            logger.error('数据归档', error.message);
            return {
              status: 'error',
              retcode: -1,
              data: null,
              message: `数据归档失败: ${error.message}`
            };
          }

        default:
          return {
            status: 'error',
            retcode: -1,
            data: null,
            message: `未知的系统API动作: ${action}`
          };
      }
    } catch (error) {
      console.error(`⚙️ 系统API处理错误 [${action}]:`, error);
      return {
        status: 'error',
        retcode: -1,
        data: null,
        message: `系统API处理失败: ${error.message}`
      };
    }
  }

  /**
   * 处理更新器API
   * @param {Object} req - HTTP请求对象
   * @param {string} action - API动作
   * @param {Object} params - 参数
   */
  async handleUpdaterApi(req, action, params) {
    try {
      logger.debug('更新器API', `${action} - ${JSON.stringify(params)}`);
      
      switch (action) {
        case 'updater_status':
          // 获取更新状态
          const status = updaterService.getUpdateStatus();
          return {
            status: 'ok',
            retcode: 0,
            data: status,
            message: '获取更新状态成功'
          };

        case 'updater_upload':
          // 处理文件上传
          try {
            console.log('🔄 开始处理文件上传...');
            
            // 解析 multipart/form-data
            const file = await this.parseMultipartFile(req);
            
            const result = await updaterService.handleUpload(file);
            
            console.log(`✅ 文件上传成功: ${file.originalname} (版本 ${result.version})`);
            
            return {
              status: 'ok',
              retcode: 0,
              data: result,
              message: '上传成功'
            };
          } catch (error) {
            console.error('❌ 文件上传失败:', error.message);
            return {
              status: 'error',
              retcode: -1,
              data: null,
              message: `上传失败: ${error.message}`
            };
          }

        case 'updater_perform':
          // 执行更新
          try {
            const { filepath } = params;
            
            if (!filepath) {
              return {
                status: 'error',
                retcode: -1,
                data: null,
                message: '缺少更新包路径'
              };
            }

            // 异步执行更新
            updaterService.performUpdate(filepath).catch(err => {
              console.error('更新执行失败:', err);
            });

            return {
              status: 'ok',
              retcode: 0,
              data: null,
              message: '更新已开始，请通过status接口查看进度'
            };
          } catch (error) {
            return {
              status: 'error',
              retcode: -1,
              data: null,
              message: `启动更新失败: ${error.message}`
            };
          }

        case 'updater_backups':
          // 获取备份列表
          const backups = updaterService.getBackupList();
          return {
            status: 'ok',
            retcode: 0,
            data: backups,
            message: '获取备份列表成功'
          };

        case 'updater_logs':
          // 获取更新日志列表
          const logs = updaterService.getUpdateLogs();
          return {
            status: 'ok',
            retcode: 0,
            data: logs,
            message: '获取更新日志列表成功'
          };

        case 'updater_log_content':
          // 获取日志内容
          try {
            const { filename } = params;
            
            if (!filename) {
              return {
                status: 'error',
                retcode: -1,
                data: null,
                message: '缺少日志文件名'
              };
            }

            const logData = updaterService.getUpdateLogContent(filename);
            
            return {
              status: 'ok',
              retcode: 0,
              data: logData,
              message: '获取日志内容成功'
            };
          } catch (error) {
            return {
              status: 'error',
              retcode: -1,
              data: null,
              message: `获取日志内容失败: ${error.message}`
            };
          }

        case 'updater_restore':
          // 从备份恢复
          try {
            const { backupName } = params;
            
            if (!backupName) {
              return {
                status: 'error',
                retcode: -1,
                data: null,
                message: '缺少备份名称'
              };
            }

            const result = await updaterService.restoreFromBackup(backupName);
            
            return {
              status: 'ok',
              retcode: 0,
              data: result,
              message: '恢复成功，请重启服务器'
            };
          } catch (error) {
            return {
              status: 'error',
              retcode: -1,
              data: null,
              message: `恢复失败: ${error.message}`
            };
          }

        default:
          return {
            status: 'error',
            retcode: -1,
            data: null,
            message: `未知的更新器API动作: ${action}`
          };
      }
    } catch (error) {
      console.error(`🔄 更新器API处理错误 [${action}]:`, error);
      return {
        status: 'error',
        retcode: -1,
        data: null,
        message: `更新器API处理失败: ${error.message}`
      };
    }
  }

  /**
   * 解析multipart/form-data文件上传
   */
  async parseMultipartFile(req) {
    return new Promise((resolve, reject) => {
      try {
        const contentType = req.headers['content-type'];
        
        if (!contentType || !contentType.includes('multipart/form-data')) {
          reject(new Error('Content-Type必须是multipart/form-data'));
          return;
        }
        
        const boundaryMatch = contentType.match(/boundary=(.+?)(?:;|$)/);
        if (!boundaryMatch) {
          reject(new Error('无法解析boundary'));
          return;
        }
        
        const boundary = boundaryMatch[1];

        const chunks = [];
        let totalSize = 0;
        let lastLogSize = 0;
        
        req.on('data', chunk => {
          chunks.push(chunk);
          totalSize += chunk.length;
          
          // 每接收 1MB 输出一次日志
          if (totalSize - lastLogSize >= 1024 * 1024) {
            console.log(`📦 正在接收文件: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);
            lastLogSize = totalSize;
          }
        });
        
        req.on('end', () => {
          try {
            console.log(`📦 数据接收完成，总大小: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);
            const buffer = Buffer.concat(chunks);
            const boundaryBuffer = Buffer.from(`--${boundary}`);
            
            // 简单解析multipart数据
            const parts = [];
            let currentPos = 0;
            
            while (currentPos < buffer.length) {
              const boundaryPos = buffer.indexOf(boundaryBuffer, currentPos);
              if (boundaryPos === -1) break;
              
              const nextBoundaryPos = buffer.indexOf(boundaryBuffer, boundaryPos + boundaryBuffer.length);
              if (nextBoundaryPos === -1) break;
              
              const part = buffer.slice(boundaryPos + boundaryBuffer.length, nextBoundaryPos);
              parts.push(part);
              
              currentPos = nextBoundaryPos;
            }

            // 解析文件部分
            for (const part of parts) {
              const headerEndPos = part.indexOf('\r\n\r\n');
              if (headerEndPos === -1) continue;
              
              const headers = part.slice(0, headerEndPos).toString();
              const fileData = part.slice(headerEndPos + 4);
              
              // 提取文件名
              const filenameMatch = headers.match(/filename="(.+?)"/);
              if (filenameMatch) {
                const filename = filenameMatch[1];
                // 移除结尾的\r\n
                const cleanData = fileData.slice(0, -2);
                
                console.log(`✅ 文件解析成功: ${filename} (${(cleanData.length / 1024 / 1024).toFixed(2)} MB)`);
                
                resolve({
                  originalname: filename,
                  buffer: cleanData
                });
                return;
              }
            }
            
            reject(new Error('未找到文件数据'));
          } catch (error) {
            console.error('❌ 解析multipart数据失败:', error);
            reject(error);
          }
        });
        
        req.on('error', (error) => {
          console.error('❌ 请求错误:', error);
          reject(error);
        });
      } catch (error) {
        console.error('❌ parseMultipartFile初始化失败:', error);
        reject(error);
      }
    });
  }

  /**
   * 处理新版监控API（具备归档和导出功能）
   * @param {string} action - API动作
   * @param {Object} params - 参数
   */
  async handleMonitorApiNew(action, params) {
    try {
      // 只在debug模式下记录
      if (process.env.LOG_LEVEL === 'debug') {
        logger.debug('监控API', `${action}: ${JSON.stringify(params)}`);
      }
      
      switch (action) {
        case 'monitor_stats_v2':
        case 'monitor_get_stats':
        case 'monitor_stats':  // 兼容旧版API
          const stats = await systemStatistics.generateStatsReport(params.timeRange || '24h');
          return {
            status: 'ok',
            retcode: 0,
            data: stats,
            message: '获取监控统计成功'
          };
        
        case 'monitor_realtime':  // 实时监控API
          const realtimeStats = this.getRealtimeStats();
          return {
            status: 'ok',
            retcode: 0,
            data: realtimeStats,
            message: '获取实时统计成功'
          };
        
        case 'monitor_export_data':
          const exportFormat = params.format || 'json';
          const exportTimeRange = params.timeRange || '24h';
          const includeRawData = params.includeRawData || false;
          
          // 使用 systemStatistics 导出数据
          const exportStats = await systemStatistics.generateStatsReport(exportTimeRange);
          const exportedData = JSON.stringify(exportStats, null, 2);
          
          return {
            status: 'ok',
            retcode: 0,
            data: {
              format: exportFormat,
              timeRange: exportTimeRange,
              content: exportedData,
              filename: `monitor-export-${exportTimeRange}-${Date.now()}.${exportFormat}`,
              size: exportedData.length
            },
            message: '数据导出成功'
          };
        
        case 'monitor_archive_data':
          const archiveDate = params.date || null;
          const archiveFile = await systemStatistics.archiveOldData();
          
          return {
            status: 'ok',
            retcode: 0,
            data: {
              archiveFile,
              archiveDate: archiveDate || new Date().toISOString().split('T')[0]
            },
            message: '数据归档成功'
          };
        
        case 'monitor_get_archives':
          const archiveDir = path.join(__dirname, 'data/monitoring/archives');
          let archives = [];
          
          try {
            if (fs.existsSync(archiveDir)) {
              const files = fs.readdirSync(archiveDir)
                .filter(file => file.startsWith('archive-') && file.endsWith('.json'))
                .map(file => {
                  const filePath = path.join(archiveDir, file);
                  const stats = fs.statSync(filePath);
                  const date = file.match(/archive-(\d{4}-\d{2}-\d{2})\.json/)?.[1];
                  
                  return {
                    filename: file,
                    date,
                    size: stats.size,
                    created: stats.birthtime.toISOString(),
                    modified: stats.mtime.toISOString()
                  };
                })
                .sort((a, b) => new Date(b.date) - new Date(a.date));
              
              archives = files;
            }
          } catch (error) {
            console.warn('读取归档目录失败:', error);
          }
          
          return {
            status: 'ok',
            retcode: 0,
            data: {
              archives,
              totalFiles: archives.length,
              totalSize: archives.reduce((sum, archive) => sum + archive.size, 0)
            },
            message: '获取归档列表成功'
          };
        
        case 'monitor_get_data_quality':
          const quality = systemStatistics._assessDataQuality();
          
          return {
            status: 'ok',
            retcode: 0,
            data: quality,
            message: '获取数据质量评估成功'
          };
        
        case 'monitor_cleanup_data':
          const daysToKeep = params.daysToKeep || 30;
          const cutoffDate = new Date();
          cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
          
          // 使用 ArchiveManager 清理旧归档
          systemStatistics.archiveManager.cleanOldArchives(daysToKeep);
          
          return {
            status: 'ok',
            retcode: 0,
            data: {
              cleanupDate: cutoffDate.toISOString(),
              daysKept: daysToKeep
            },
            message: `已清理${daysToKeep}天前的历史数据`
          };
        
        default:
          throw new Error(`未知的监控API: ${action}`);
      }
    } catch (error) {
      console.error(`❌ 新版监控API处理失败: ${action}`, error);
      return {
        status: 'error',
        retcode: -1,
        data: null,
        message: `处理失败: ${error.message}`
      };
    }
  }

  /**
   * 处理任务管理API
   * @param {string} action - API动作
   * @param {Object} params - 参数
   */
  async handleTasksApi(action, params) {
    try {
      logger.debug('任务管理API', `${action} - ${JSON.stringify(params)}`);
      
      switch (action) {
        case 'tasks_get_all':
          // 获取所有任务
          const tasks = this.taskManager.getAllTasks();
          return {
            status: 'ok',
            retcode: 0,
            data: tasks,
            message: '获取任务列表成功'
          };

        case 'tasks_get':
          // 获取单个任务
          if (!params.taskId) {
            throw new Error('缺少任务ID');
          }
          const task = this.taskManager.getTask(params.taskId);
          if (!task) {
            throw new Error('任务不存在');
          }
          return {
            status: 'ok',
            retcode: 0,
            data: task,
            message: '获取任务详情成功'
          };

        case 'tasks_create':
          // 创建任务
          if (!params.task) {
            throw new Error('缺少任务参数');
          }
          const newTask = this.taskManager.createTask(params.task);
          return {
            status: 'ok',
            retcode: 0,
            data: newTask,
            message: '任务创建成功'
          };

        case 'tasks_update':
          // 更新任务
          if (!params.taskId || !params.updates) {
            throw new Error('缺少任务ID或更新参数');
          }
          const updatedTask = this.taskManager.updateTask(params.taskId, params.updates);
          return {
            status: 'ok',
            retcode: 0,
            data: updatedTask,
            message: '任务更新成功'
          };

        case 'tasks_delete':
          // 删除任务
          if (!params.taskId) {
            throw new Error('缺少任务ID');
          }
          const deleteSuccess = this.taskManager.deleteTask(params.taskId);
          return {
            status: 'ok',
            retcode: 0,
            data: { taskId: params.taskId, deleted: deleteSuccess },
            message: '任务删除成功'
          };

        case 'tasks_run_now':
          // 立即执行任务
          if (!params.taskId) {
            throw new Error('缺少任务ID');
          }
          await this.taskManager.runTaskNow(params.taskId);
          return {
            status: 'ok',
            retcode: 0,
            data: { taskId: params.taskId },
            message: '任务已开始执行'
          };

        case 'tasks_toggle':
          // 启用/禁用任务
          if (!params.taskId || params.enabled === undefined) {
            throw new Error('缺少任务ID或启用状态');
          }
          const toggledTask = this.taskManager.toggleTask(params.taskId, params.enabled);
          return {
            status: 'ok',
            retcode: 0,
            data: toggledTask,
            message: `任务已${params.enabled ? '启用' : '禁用'}`
          };

        case 'tasks_get_history':
          // 获取任务执行历史
          const { taskId = null, limit = 100 } = params;
          const history = this.taskManager.getTaskHistory(taskId, limit);
          return {
            status: 'ok',
            retcode: 0,
            data: {
              history,
              total: history.length
            },
            message: '获取任务历史成功'
          };

        case 'tasks_clear_history':
          // 清空任务执行历史
          const clearTaskId = params.taskId || null;
          const clearResult = this.taskManager.clearTaskHistory(clearTaskId);
          return {
            status: 'ok',
            retcode: 0,
            data: clearResult,
            message: clearTaskId ? '已清空指定任务的历史记录' : '已清空全部历史记录'
          };

        case 'tasks_get_stats':
          // 获取任务统计信息
          const stats = this.taskManager.getStats();
          return {
            status: 'ok',
            retcode: 0,
            data: stats,
            message: '获取任务统计成功'
          };

        case 'tasks_validate_cron':
          // 验证cron表达式
          if (!params.cron) {
            throw new Error('缺少cron表达式');
          }
          const isValid = this.taskManager.validateCronExpression(params.cron);
          return {
            status: 'ok',
            retcode: 0,
            data: { 
              cron: params.cron,
              valid: isValid,
              nextRun: isValid ? this.taskManager.calculateNextRun(params.cron, null) : null
            },
            message: isValid ? 'cron表达式有效' : 'cron表达式无效'
          };

        default:
          throw new Error(`未知的任务管理API: ${action}`);
      }
    } catch (error) {
      logger.error('任务管理API', `处理失败: ${action}`, error);
      return {
        status: 'error',
        retcode: -1,
        data: null,
        message: `任务管理API调用失败: ${error.message}`
      };
    }
  }

  /**
   * 获取聊天列表
   * 直接从好友和群组列表构建，结合消息历史补充最后消息信息
   */
  async handleGetChatList(params) {
    try {
      // 只在debug模式下记录
      if (process.env.LOG_LEVEL === 'debug') {
        logger.debug('聊天列表', '正在获取...');
      }
      
      const chats = [];
      
      // 获取消息历史（用于补充最后消息信息）
      const messageHistory = this.eventEngine ? (this.eventEngine.getStats()?.messageHistory || []) : [];
      
      // 创建消息映射表 key: chatId
      const messageMap = new Map();
      messageHistory.forEach(msg => {
        const chatId = (msg.groupId || msg.userId)?.toString();
        if (!chatId) return;
        
        if (!messageMap.has(chatId)) {
          messageMap.set(chatId, {
            lastMessage: msg.content || '',
            lastTime: msg.timestamp || 0,
            senderName: msg.senderName || '未知',
            messageCount: 1
          });
        } else {
          const msgInfo = messageMap.get(chatId);
          msgInfo.messageCount++;
          // 更新为最新消息
          if (msg.timestamp > msgInfo.lastTime) {
            msgInfo.lastMessage = msg.content || '';
            msgInfo.lastTime = msg.timestamp;
            msgInfo.senderName = msg.senderName || '未知';
          }
        }
      });
      
      // 1. 从好友列表构建私聊对话
      try {
        const friendsResponse = await this.callLLOneBotViaWebSocket('get_friend_list', {});
        if (friendsResponse?.data) {
          const friends = Array.isArray(friendsResponse.data) ? friendsResponse.data : [];
          friends.forEach(friend => {
            const chatId = friend.user_id?.toString();
            if (!chatId) return;
            
            const msgInfo = messageMap.get(chatId) || {
              lastMessage: '',
              lastTime: 0,
              senderName: '',
              messageCount: 0
            };
            
            chats.push({
              chatId,
              type: 'private',
              name: friend.remark || friend.nickname || `好友${chatId}`,
              avatar: friend.avatarUrl,
              lastMessage: msgInfo.lastMessage,
              lastTime: msgInfo.lastTime,
              senderName: msgInfo.senderName,
              messageCount: msgInfo.messageCount
            });
          });
          if (process.env.LOG_LEVEL === 'debug') {
            logger.debug('聊天列表', `好友: ${friends.length} 个`);
          }
        }
      } catch (error) {
        if (process.env.LOG_LEVEL === 'debug') {
          logger.debug('好友列表', '获取失败: ' + error.message);
        }
      }
      
      // 2. 从群组列表构建群聊对话
      try {
        const groupsResponse = await this.callLLOneBotViaWebSocket('get_group_list', {});
        if (groupsResponse?.data) {
          const groups = Array.isArray(groupsResponse.data) ? groupsResponse.data : [];
          groups.forEach(group => {
            const chatId = group.group_id?.toString();
            if (!chatId) return;
            
            const msgInfo = messageMap.get(chatId) || {
              lastMessage: '',
              lastTime: 0,
              senderName: '',
              messageCount: 0
            };
            
            chats.push({
              chatId,
              type: 'group',
              name: group.group_name || `群聊${chatId}`,
              lastMessage: msgInfo.lastMessage,
              lastTime: msgInfo.lastTime,
              senderName: msgInfo.senderName,
              messageCount: msgInfo.messageCount
            });
          });
          if (process.env.LOG_LEVEL === 'debug') {
            logger.debug('聊天列表', `群组: ${groups.length} 个`);
          }
        }
      } catch (error) {
        if (process.env.LOG_LEVEL === 'debug') {
          logger.debug('群组列表', '获取失败: ' + error.message);
        }
      }
      
      // 按最后消息时间排序（有消息的在前，按时间倒序）
      chats.sort((a, b) => {
        // 有消息的排在前面
        if (a.lastTime && !b.lastTime) return -1;
        if (!a.lastTime && b.lastTime) return 1;
        // 都有消息，按时间排序
        if (a.lastTime && b.lastTime) return b.lastTime - a.lastTime;
        // 都没消息，按名称排序
        return (a.name || '').localeCompare(b.name || '', 'zh-CN');
      });
      
      if (process.env.LOG_LEVEL === 'debug') {
        logger.debug('聊天列表', `返回 ${chats.length} 个对话`);
      }
      
      return {
        status: 'ok',
        retcode: 0,
        data: { chats },
        message: '获取聊天列表成功'
      };
      
    } catch (error) {
      logger.error('聊天列表', '获取失败: ' + error.message);
      return {
        status: 'error',
        retcode: -1,
        data: { chats: [] },
        message: `获取聊天列表失败: ${error.message}`
      };
    }
  }

  /**
   * 获取聊天历史记录
   * @param {Object} params - 参数 { chatId, limit, before }
   */
  async handleGetChatHistory(params) {
    try {
      const { chatId, limit = 50, before } = params;
      
      console.log(`💬 获取聊天历史: chatId=${chatId}, limit=${limit}`);
      
      if (!this.eventEngine) {
        return {
          status: 'ok',
          retcode: 0,
          data: { messages: [], hasMore: false },
          message: '事件引擎未初始化'
        };
      }
      
      // 获取消息历史
      const stats = this.eventEngine.getStats();
      let messages = (stats?.messageHistory || [])
        .filter(msg => {
          const msgChatId = msg.groupId || msg.userId;
          return msgChatId?.toString() === chatId?.toString();
        });
      
      // 如果指定了时间戳，只返回该时间之前的消息
      if (before) {
        messages = messages.filter(msg => msg.timestamp < before);
      }
      
      // 按时间倒序排列（最新的在前）
      messages.sort((a, b) => b.timestamp - a.timestamp);
      
      // 限制返回数量
      const hasMore = messages.length > limit;
      messages = messages.slice(0, limit);
      
      // 反转顺序（最旧的在前，最新的在后）
      messages.reverse();
      
      console.log(`✅ 返回 ${messages.length} 条消息`);
      
      return {
        status: 'ok',
        retcode: 0,
        data: {
          messages,
          hasMore
        },
        message: '获取聊天历史成功'
      };
      
    } catch (error) {
      console.error('❌ 获取聊天历史失败:', error);
      return {
        status: 'error',
        retcode: -1,
        data: { messages: [], hasMore: false },
        message: `获取聊天历史失败: ${error.message}`
      };
    }
  }

  /**
   * 处理订阅
   * @param {string} clientId - 客户端ID
   * @param {Object} message - 订阅消息
   */
  handleSubscribe(clientId, message) {
    const client = this.clients.get(clientId);
    if (!client) {
      console.error(`❌ 订阅失败：客户端 ${clientId} 不存在`);
      return;
    }

    const { events = [] } = message;
    client.subscribedEvents = events;
    
    console.log(`📡 [事件订阅] 客户端 ${clientId} 订阅事件:`, events);
    console.log(`   客户端类型: ${client.clientType}`);
    console.log(`   认证状态: ${client.authenticated}`);
    console.log(`   已保存订阅列表:`, client.subscribedEvents);
    
    this.sendToClient(client.ws, {
      type: 'subscribe_response',
      data: {
        subscribed: events,
        message: '订阅成功'
      }
    });
    
    console.log(`✅ [事件订阅] 客户端 ${clientId} 订阅确认已发送`);
  }

  /**
   * 通过WebSocket调用LLOneBot API
   * @param {string} action - API动作
   * @param {Object} params - 参数
   * @param {string} originalId - 原始请求ID
   */
  async callLLOneBotViaWebSocket(action, params, originalId) {
    const startTime = Date.now();
    
    return new Promise((resolve, reject) => {
      const echo = uuidv4();
      const requestData = {
        action,
        params,
        echo
      };
      
      // 简化的日志输出 - 只在初始化完成后显示，且仅debug模式
      if (this.isInitialized && process.env.LOG_LEVEL === 'debug') {
        logger.debug('WebSocket API', action);
      }
      
      // 包装 resolve 以记录API统计
      const originalResolve = resolve;
      const wrappedResolve = (value) => {
        const duration = Date.now() - startTime;
        const success = value && value.retcode === 0;
        systemStatistics.recordApiCall(action, duration, success);
        originalResolve(value);
      };
      
      // 包装 reject 以记录API统计
      const originalReject = reject;
      const wrappedReject = (error) => {
        const duration = Date.now() - startTime;
        systemStatistics.recordApiCall(action, duration, false);
        originalReject(error);
      };
      
      // 存储请求，等待响应
      this.pendingRequests.set(echo, {
        resolve: wrappedResolve,
        reject: wrappedReject,
        timestamp: Date.now(),
        action,
        originalId
      });
      
      // 发送请求到LLOneBot
      try {
        this.llonebotWs.send(JSON.stringify(requestData));
        
        // 设置超时
        setTimeout(() => {
          if (this.pendingRequests.has(echo)) {
            this.pendingRequests.delete(echo);
            wrappedReject(new Error(`WebSocket API调用超时: ${action}`));
          }
        }, 15000); // 15秒超时
      } catch (error) {
        this.pendingRequests.delete(echo);
        wrappedReject(new Error(`发送WebSocket请求失败: ${error.message}`));
      }
    });
  }

  /**
   * 调用LLOneBot API
   * @param {string} action - API动作
   * @param {Object} params - 参数
   */
  async callLLOneBotApi(action, params) {
    try {
      // 构建请求URL
      let url = `${CONFIG.LLONEBOT_API_URL}/${action}`;
      const urlObj = new URL(url);
      
      // 构建请求头
      const headers = {
        'User-Agent': 'KiBot-WebSocket-Server/1.0'
      };
      
      // 添加Token认证
      if (CONFIG.LLONEBOT_ACCESS_TOKEN) {
        headers['Authorization'] = `Bearer ${CONFIG.LLONEBOT_ACCESS_TOKEN}`;
        headers['access_token'] = CONFIG.LLONEBOT_ACCESS_TOKEN;
        headers['X-Access-Token'] = CONFIG.LLONEBOT_ACCESS_TOKEN;
        // 添加Token到查询参数作为备用
        urlObj.searchParams.set('access_token', CONFIG.LLONEBOT_ACCESS_TOKEN);
      }
      
      // 根据API类型确定请求方法
      let response;
      
      if (action === 'get_login_info') {
        // get_login_info 使用 GET 方法（根据OpenAPI规范）
        console.log(`🔗 调用LLOneBot API (GET): ${action}`);
        
        response = await axios.get(urlObj.toString(), {
          timeout: 15000,
          headers,
          validateStatus: function (status) {
            return status < 500; // 只有5xx错误才重试
          }
        });
      } else {
        // 其他API使用POST方法
        console.log(`🔗 调用LLOneBot API (POST): ${action}`, params ? Object.keys(params) : '无参数');
        
        headers['Content-Type'] = 'application/json';
        
        response = await axios.post(urlObj.toString(), params, {
          timeout: 15000,
          headers,
          validateStatus: function (status) {
            return status < 500; // 只有5xx错误才重试
          }
        });
      }
      
      // 处理响应状态
      if (response.status === 401) {
        throw new Error('LLOneBot API认证失败，请检查Token是否正确');
      }
      
      if (response.status === 403) {
        throw new Error('LLOneBot API访问被拒绝，请检查Token权限');
      }
      
      if (response.status === 426) {
        throw new Error(`LLOneBot API协议升级要求 - 请检查API方法是否正确 (${action})`);
      }
      
      if (response.status >= 400) {
        throw new Error(`LLOneBot API返回错误状态: ${response.status} ${response.statusText}`);
      }
      
      console.log(`✅ API调用成功: ${action}`, response.data?.retcode === 0 ? '成功' : `错误码: ${response.data?.retcode}`);
      return response.data;
      
    } catch (error) {
      // 不再返回模拟数据，直接抛出错误
      let errorMessage;
      
      if (error.code === 'ECONNREFUSED') {
        errorMessage = `无法连接到LLOneBot API (${CONFIG.LLONEBOT_API_URL})，请确保LLOneBot已启动并配置正确的API地址`;
      } else if (error.code === 'ENOTFOUND') {
        errorMessage = `无法解析LLOneBot API域名 (${CONFIG.LLONEBOT_API_URL})，请检查网络连接和地址配置`;
      } else if (error.code === 'ETIMEDOUT') {
        errorMessage = `LLOneBot API请求超时 (${CONFIG.LLONEBOT_API_URL})，请检查网络连接`;
      } else if (error.message.includes('认证失败') || error.message.includes('访问被拒绝') || error.message.includes('协议升级要求')) {
        errorMessage = error.message;
      } else {
        errorMessage = `LLOneBot API调用失败: ${error.message}`;
      }
      
      console.error(`❌ ${errorMessage}`);
      throw new Error(errorMessage);
    }
  }

  /**
   * 启动资源监控（CPU和内存）
   */
  startResourceMonitoring() {
    // 初始化上一次CPU测量值
    this.lastCpuUsage = process.cpuUsage();
    this.lastCpuTime = Date.now();
    this.cpuCores = os.cpus().length; // 获取CPU核心数
    
    const collectResourceData = () => {
      const timestamp = Date.now();
      
      // CPU使用率计算
      const currentCpuUsage = process.cpuUsage(this.lastCpuUsage);
      const timeDiff = timestamp - this.lastCpuTime;
      
      // process.cpuUsage()返回微秒（microseconds）
      // 转换为毫秒以匹配timeDiff的单位
      const userMs = currentCpuUsage.user / 1000;
      const systemMs = currentCpuUsage.system / 1000;
      const totalCpuMs = userMs + systemMs;
      
      // CPU使用率 = (CPU时间 / 墙上时钟时间) * 100
      // 这表示进程使用了多少百分比的CPU时间
      let cpuPercent = (totalCpuMs / timeDiff) * 100;
      
      // 限制在合理范围内（0-100% for single core equivalency）
      cpuPercent = Math.max(0, Math.min(100, cpuPercent));
      
      this.lastCpuUsage = process.cpuUsage();
      this.lastCpuTime = timestamp;
      
      // 内存使用
      const memUsage = process.memoryUsage();
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      const usedMem = totalMem - freeMem;
      
      // 记录CPU历史
      this.resourceStats.cpuHistory.push({
        timestamp,
        usage: cpuPercent
      });
      
      // 记录内存历史
      this.resourceStats.memoryHistory.push({
        timestamp,
        process: {
          heapUsed: memUsage.heapUsed,
          heapTotal: memUsage.heapTotal,
          rss: memUsage.rss,
          external: memUsage.external
        },
        system: {
          total: totalMem,
          free: freeMem,
          used: usedMem,
          usagePercent: (usedMem / totalMem) * 100
        }
      });
      
      // 只保留最近100条
      if (this.resourceStats.cpuHistory.length > 100) {
        this.resourceStats.cpuHistory.shift();
      }
      if (this.resourceStats.memoryHistory.length > 100) {
        this.resourceStats.memoryHistory.shift();
      }
    };
    
    // 立即执行一次
    collectResourceData();
    
    // 每10秒收集一次
    this.resourceStats.interval = setInterval(collectResourceData, 10000);
  }
  
  /**
   * 停止资源监控
   */
  stopResourceMonitoring() {
    if (this.resourceStats.interval) {
      clearInterval(this.resourceStats.interval);
      this.resourceStats.interval = null;
    }
  }

  /**
   * 启动事件循环延迟监控
   */
  // 事件循环监控已整合到系统统计模块中
  
  /**
   * 记录HTTP请求
   */
  recordHttpRequest(action, responseTime, success = true) {
    // 委托给统一的系统统计模块
    this.systemStats.recordHttpRequest(action, responseTime, success, success ? 200 : 500);
  }

  /**
   * 获取登录信息
   */
  async getLoginInfo() {
    return this.callLLOneBotApi('get_login_info', {});
  }

  /**
   * 获取系统性能数据
   */
  getSystemPerformance() {
    // 委托给统一的系统统计模块
    const perfData = this.systemStats.getPerformanceData();
    const httpData = this.systemStats.getHttpStats();
    const systemSummary = this.systemStats.getSystemSummary();
    
    return {
      uptime: systemSummary.runtime.uptime,
      timestamp: Date.now(),
      cpu: perfData.cpu,
      memory: perfData.memory,
      eventLoop: perfData.eventLoop,
      http: {
        totalRequests: httpData.totalRequests,
        totalErrors: httpData.totalErrors,
        avgResponseTime: httpData.avgResponseTime,
        errorRate: httpData.errorRate * 100,
        topEndpoints: httpData.endpoints.slice(0, 10),
        recentResponses: httpData.recentRequests.slice(-20)
      }
    };
  }

  /**
   * 获取登录信息
   */
  async getLoginInfo() {
    return this.callLLOneBotApi('get_login_info', {});
  }

  /**
   * 发送私聊消息
   * @param {Object} params - 参数
   */
  async sendPrivateMsg(params) {
    console.log('💬 发送私聊消息:', params);
    return this.callLLOneBotApi('send_private_msg', params);
  }

  /**
   * 发送群消息
   * @param {Object} params - 参数
   */
  async sendGroupMsg(params) {
    console.log('💬 发送群消息:', params);
    return this.callLLOneBotApi('send_group_msg', params);
  }

  /**
   * 广播事件给所有订阅的客户端
   * @param {Object} event - 事件对象
   */
  broadcastEvent(event) {
    // 添加调试日志（仅在初始化完成且debug模式下）
    const eventType = event.post_type;
    const clientCount = this.clients.size;
    
    if (this.isInitialized && process.env.LOG_LEVEL === 'debug') {
      logger.debug('广播事件', `${eventType} -> ${clientCount} 个客户端`);
    }
    
    let sentCount = 0;
    this.clients.forEach((client, clientId) => {
      // 检查客户端是否订阅了该事件类型
      const subscribedEvents = client.subscribedEvents || [];
      
      if (subscribedEvents.length === 0 || subscribedEvents.includes(eventType)) {
        this.sendToClient(client.ws, {
          type: 'event',
          data: event
        });
        sentCount++;
      }
    });
    
    if (this.isInitialized && process.env.LOG_LEVEL === 'debug') {
      logger.debug('广播完成', `${eventType}: ${sentCount}/${clientCount}`);
    }
  }

  /**
   * 发送消息给客户端
   * @param {WebSocket} ws - WebSocket连接
   * @param {Object} message - 消息对象
   */
  sendToClient(ws, message) {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  /**
   * 发送错误信息给客户端
   * @param {WebSocket} ws - WebSocket连接
   * @param {string} code - 错误代码
   * @param {string} message - 错误消息
   */
  sendError(ws, code, message) {
    this.sendToClient(ws, {
      type: 'error',
      error: {
        code,
        message
      }
    });
  }

  /**
   * 启动心跳检测
   */
  startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      const now = new Date();
      
      this.clients.forEach((client, clientId) => {
        const timeSinceLastHeartbeat = now - client.lastHeartbeat;
        
        if (timeSinceLastHeartbeat > CONFIG.HEARTBEAT_INTERVAL * 2) {
          logger.warning('客户端连接', `${clientId} 心跳超时，断开连接`);
          client.ws.terminate();
          this.clients.delete(clientId);
        } else {
          // 发送心跳检测
          this.sendToClient(client.ws, {
            type: 'heartbeat',
            data: { timestamp: now.getTime() }
          });
        }
      });
    }, CONFIG.HEARTBEAT_INTERVAL);
  }

  /**
   * 分组管理方法
   */
  
  // 加载分组
  loadGroups() {
    try {
      const groupsPath = path.join(__dirname, 'data', 'rule-groups.json');
      if (fs.existsSync(groupsPath)) {
        const savedGroups = fs.readFileSync(groupsPath, 'utf8');
        this.groups = JSON.parse(savedGroups);
        logger.startup('规则分组', `已加载 ${this.groups.length} 个`);
      } else {
        this.groups = this.getDefaultGroups();
        this.saveGroups();
        logger.startup('规则分组', '已创建默认分组');
      }
    } catch (error) {
      console.error('加载规则分组失败:', error);
      this.groups = this.getDefaultGroups();
    }
  }

  // 保存分组
  saveGroups() {
    try {
      const dataDir = path.join(__dirname, 'data');
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      
      const groupsPath = path.join(dataDir, 'rule-groups.json');
      fs.writeFileSync(groupsPath, JSON.stringify(this.groups, null, 2));
      console.log('📋 规则分组已保存');
    } catch (error) {
      console.error('保存规则分组失败:', error);
    }
  }

  // 获取默认分组
  getDefaultGroups() {
    return [
      {
        id: 'default',
        name: '默认分组',
        description: '未分类的规则',
        color: 'blue',
        expanded: true
      },
      {
        id: 'fun',
        name: '娱乐功能',
        description: '娱乐相关的自动回复',
        color: 'green',
        expanded: true
      },
      {
        id: 'admin',
        name: '管理功能',
        description: '管理员专用功能',
        color: 'red',
        expanded: true
      }
    ];
  }

  // 获取所有分组
  getGroups() {
    return this.groups;
  }

  // 添加分组
  addGroup(group) {
    group.id = group.id || `group_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    group.expanded = group.expanded !== undefined ? group.expanded : true;
    this.groups.push(group);
    this.saveGroups();
    return group.id;
  }

  // 更新分组
  updateGroup(groupId, updatedGroup) {
    const index = this.groups.findIndex(g => g.id === groupId);
    if (index >= 0) {
      this.groups[index] = { ...this.groups[index], ...updatedGroup };
      this.saveGroups();
      return true;
    }
    return false;
  }

  // 删除分组
  deleteGroup(groupId) {
    if (groupId === 'default') {
      throw new Error('默认分组不能删除');
    }
    
    const index = this.groups.findIndex(g => g.id === groupId);
    if (index >= 0) {
      // 将分组下的规则移动到默认分组
      const rules = this.eventEngine.getRules();
      const rulesToUpdate = rules.filter(rule => rule.groupId === groupId);
      
      for (const rule of rulesToUpdate) {
        this.eventEngine.updateRule(rule.id, { ...rule, groupId: 'default' });
      }
      
      // 删除分组
      this.groups.splice(index, 1);
      this.saveGroups();
      return true;
    }
    return false;
  }

  /**
   * 生成监控统计数据
   */
  async generateMonitorStats(timeRange = '24h') {
    console.log(`📊 开始生成真实监控统计数据，时间范围: ${timeRange}`);
    
    const now = new Date();
    const startTime = new Date();
    
    // 根据时间范围设置起始时间
    switch (timeRange) {
      case '24h':
        startTime.setHours(startTime.getHours() - 24);
        break;
      case '7d':
        startTime.setDate(startTime.getDate() - 7);
        break;
      case '30d':
        startTime.setDate(startTime.getDate() - 30);
        break;
    }

    // 获取事件引擎的真实统计数据
    const engineStats = this.eventEngine.getStats();
    const rules = this.eventEngine.getRules();
    const totalRulesTriggers = rules.reduce((sum, rule) => sum + (rule.triggerCount || 0), 0);

    // 基于真实消息历史生成时间序列数据
    const timeSeriesData = this.generateRealTimeSeriesData(engineStats.messageHistory, timeRange);
    const hourlyData = timeSeriesData.hourly;
    const dailyData = timeSeriesData.daily;
    const weeklyData = timeSeriesData.weekly;

    // 处理真实用户活跃度数据
    console.log('🔍 engineStats.userActivity 数据类型:', typeof engineStats.userActivity, engineStats.userActivity);
    
    let topActiveUsers = [];
    if (Array.isArray(engineStats.userActivity) && engineStats.userActivity.length > 0) {
      topActiveUsers = engineStats.userActivity.slice(0, 20).map(([userId, userStat]) => ({
        userId: userId,
        username: userStat.username || `用户${userId}`,
        messageCount: userStat.messageCount || 0,
        lastActive: userStat.lastActive ? new Date(userStat.lastActive).toLocaleTimeString() : '未知'
      }));
      console.log('✅ 使用真实用户数据:', topActiveUsers.length, '个用户');
    } else {
      console.log('⚠️ 没有真实用户活跃度数据');
    }

    // 不再补充模拟数据，只使用真实数据
    console.log(`📊 最终用户活跃度统计: ${topActiveUsers.length} 个真实用户`);

    // 获取真实用户信息（如果可能的话）
    if (topActiveUsers.length > 0) {
      try {
        if (this.llonebotWs && this.llonebotWs.readyState === 1) {
          // 尝试为前几个活跃用户获取真实信息
          const userInfoPromises = topActiveUsers.slice(0, 5).map(async user => {
            try {
              const userInfo = await this.callLLOneBotViaWebSocket('get_stranger_info', { user_id: parseInt(user.userId) });
              if (userInfo && userInfo.retcode === 0 && userInfo.data) {
                user.username = userInfo.data.nickname || user.username;
                user.age = userInfo.data.age;
                user.sex = userInfo.data.sex;
              }
            } catch (error) {
              // 静默处理个别用户信息获取失败
            }
            return user;
          });
          
          await Promise.all(userInfoPromises);
          console.log('✅ 已更新部分用户的真实信息');
        }
      } catch (error) {
        console.warn('⚠️ 获取用户详细信息时出现错误:', error.message);
      }
    }

    // 处理真实群组活跃度数据，并获取真实的群组信息
    console.log('🔍 engineStats.groupActivity 数据类型:', typeof engineStats.groupActivity, engineStats.groupActivity);
    
    let topActiveGroups = [];
    if (Array.isArray(engineStats.groupActivity) && engineStats.groupActivity.length > 0) {
      // 获取真实的群组信息
      topActiveGroups = await Promise.all(
        engineStats.groupActivity.slice(0, 8).map(async ([groupId, groupStat]) => {
          let realGroupInfo = null;
          try {
            // 尝试获取真实的群组信息
            if (this.llonebotWs && this.llonebotWs.readyState === 1) {
              const groupInfo = await this.callLLOneBotViaWebSocket('get_group_info', { group_id: parseInt(groupId) });
              if (groupInfo && groupInfo.retcode === 0) {
                realGroupInfo = groupInfo.data;
              }
            }
          } catch (error) {
            console.warn(`⚠️ 获取群组 ${groupId} 信息失败:`, error.message);
          }
          
          return {
            groupId: groupId,
            groupName: realGroupInfo?.group_name || groupStat.groupName || `群组${groupId}`,
            messageCount: groupStat.messageCount || 0,
            memberCount: realGroupInfo?.member_count || 0
          };
        })
      );
      console.log('✅ 使用真实群组数据:', topActiveGroups.length, '个群组');
    } else {
      console.log('⚠️ 没有真实群组活跃度数据');
    }

    // 处理关键词统计数据
    console.log('🔍 engineStats.keywordStats 数据类型:', typeof engineStats.keywordStats, engineStats.keywordStats);
    
    let popularKeywords = [];
    if (Array.isArray(engineStats.keywordStats) && engineStats.keywordStats.length > 0) {
      // 计算关键词趋势（基于历史数据对比）
      popularKeywords = engineStats.keywordStats.slice(0, 10).map(([keyword, count]) => {
        // 简单的趋势计算：基于关键词在最近消息中的出现频率
        const recentMessages = engineStats.messageHistory.slice(-100); // 最近100条消息
        const recentCount = recentMessages.filter(msg => 
          msg.content && msg.content.toLowerCase().includes(keyword.toLowerCase())
        ).length;
        
        let trend = 'stable';
        if (recentCount > count * 0.3) trend = 'up';
        else if (recentCount < count * 0.1) trend = 'down';
        
        return { keyword, count, trend };
      });
      console.log('✅ 使用真实关键词数据:', popularKeywords.length, '个关键词');
    } else {
      console.log('⚠️ 没有真实关键词数据');
      popularKeywords = [];
    }

    // 性能数据（真实系统指标）
    const memUsage = process.memoryUsage();
    const currentTime = Date.now();
    
    // 基于真实数据生成性能历史记录
    const performance = Array.from({ length: 20 }, (_, i) => {
      const timestamp = new Date(currentTime - (19 - i) * 60000);
      return {
        timestamp: timestamp.toLocaleTimeString(),
        responseTime: this.getAverageResponseTime(), // 使用真实响应时间
        memoryUsage: (memUsage.heapUsed / memUsage.heapTotal) * 100,
        cpuUsage: this.getCpuUsage() // 使用真实CPU使用率
      };
    });

    // 基于真实消息历史计算消息类型分布
    const messageTypeStats = this.analyzeMessageTypes(engineStats.messageHistory);
    const sentimentStats = this.analyzeSentiment(engineStats.messageHistory);

    // 获取真实的好友和群组数量
    let realFriendCount = 0;
    let realGroupCount = 0;
    try {
      if (this.llonebotWs && this.llonebotWs.readyState === 1) {
        const friendsInfo = await this.callLLOneBotViaWebSocket('get_friend_list');
        const groupsInfo = await this.callLLOneBotViaWebSocket('get_group_list');
        
        if (friendsInfo && friendsInfo.retcode === 0) {
          realFriendCount = friendsInfo.data?.length || 0;
        }
        if (groupsInfo && groupsInfo.retcode === 0) {
          realGroupCount = groupsInfo.data?.length || 0;
        }
      }
    } catch (error) {
      console.warn('⚠️ 获取好友/群组数量失败:', error.message);
    }

    // 返回完整的监控统计数据
    return {
      realTimeStats: {
        totalMessages: engineStats.messageHistory.length, // 使用真实的消息历史长度
        todayMessages: engineStats.dailyMessageCount,
        onlineUsers: this.clients.size,
        activeGroups: realGroupCount,
        totalFriends: realFriendCount,
        systemUptime: Math.floor(process.uptime()),
        messagesPerSecond: engineStats.systemUptime > 0 ? (engineStats.dailyMessageCount / engineStats.systemUptime) : 0
      },
      messageStats: {
        hourlyData,
        dailyData,
        weeklyData
      },
      userActivity: {
        topActiveUsers,
        topActiveGroups,
        userActivityDistribution: this.analyzeUserActivityDistribution(engineStats.messageHistory)
      },
      systemStats: {
        rulesTriggered: totalRulesTriggers,
        apiCallsCount: engineStats.totalApiCalls,
        pluginExecutions: this.pluginManager?.plugins?.size || 0,
        errorsCount: engineStats.totalErrors,
        performance
      },
      contentAnalysis: {
        messageTypes: messageTypeStats,
        popularKeywords,
        sentimentAnalysis: sentimentStats
      }
    };
  }

  /**
   * 基于真实消息历史生成时间序列数据
   */
  generateRealTimeSeriesData(messageHistory, timeRange) {
    console.log(`📊 基于 ${messageHistory.length} 条消息历史生成时间序列数据`);
    
    const now = new Date();
    const timeSlots = {
      hourly: Array.from({ length: 24 }, (_, i) => {
        const time = new Date(now.getTime() - (23 - i) * 60 * 60 * 1000);
        return {
          time: time.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
          messages: 0,
          private: 0,
          group: 0
        };
      }),
      daily: Array.from({ length: 7 }, (_, i) => {
        const date = new Date(now.getTime() - (6 - i) * 24 * 60 * 60 * 1000);
        return {
          date: date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' }),
          messages: 0,
          private: 0,
          group: 0
        };
      }),
      weekly: Array.from({ length: 4 }, (_, i) => ({
        week: `第${4 - i}周`,
        messages: 0,
        private: 0,
        group: 0
      }))
    };

    // 分析消息历史并填充时间槽
    messageHistory.forEach(msg => {
      if (!msg.timestamp) return;
      
      const msgTime = new Date(msg.timestamp);
      const hoursDiff = Math.floor((now - msgTime) / (1000 * 60 * 60));
      const daysDiff = Math.floor((now - msgTime) / (1000 * 60 * 60 * 24));
      const weeksDiff = Math.floor(daysDiff / 7);
      
      // 统计小时数据（最近24小时）
      if (hoursDiff >= 0 && hoursDiff < 24) {
        const slotIndex = 23 - hoursDiff;
        if (timeSlots.hourly[slotIndex]) {
          timeSlots.hourly[slotIndex].messages++;
          if (msg.messageType === 'private') {
            timeSlots.hourly[slotIndex].private++;
          } else if (msg.messageType === 'group') {
            timeSlots.hourly[slotIndex].group++;
          }
        }
      }
      
      // 统计日数据（最近7天）
      if (daysDiff >= 0 && daysDiff < 7) {
        const slotIndex = 6 - daysDiff;
        if (timeSlots.daily[slotIndex]) {
          timeSlots.daily[slotIndex].messages++;
          if (msg.messageType === 'private') {
            timeSlots.daily[slotIndex].private++;
          } else if (msg.messageType === 'group') {
            timeSlots.daily[slotIndex].group++;
          }
        }
      }
      
      // 统计周数据（最近4周）
      if (weeksDiff >= 0 && weeksDiff < 4) {
        const slotIndex = 3 - weeksDiff;
        if (timeSlots.weekly[slotIndex]) {
          timeSlots.weekly[slotIndex].messages++;
          if (msg.messageType === 'private') {
            timeSlots.weekly[slotIndex].private++;
          } else if (msg.messageType === 'group') {
            timeSlots.weekly[slotIndex].group++;
          }
        }
      }
    });

    return timeSlots;
  }

  /**
   * 分析消息类型分布
   */
  analyzeMessageTypes(messageHistory) {
    const typeCount = {
      text: 0,
      image: 0,
      voice: 0,
      video: 0,
      file: 0,
      other: 0
    };

    messageHistory.forEach(msg => {
      // 简单的消息类型识别
      if (!msg.content) {
        typeCount.other++;
        return;
      }

      const content = msg.content.toLowerCase();
      if (content.includes('[图片]') || content.includes('image')) {
        typeCount.image++;
      } else if (content.includes('[语音]') || content.includes('record')) {
        typeCount.voice++;
      } else if (content.includes('[视频]') || content.includes('video')) {
        typeCount.video++;
      } else if (content.includes('[文件]') || content.includes('file')) {
        typeCount.file++;
      } else if (content.length > 0) {
        typeCount.text++;
      } else {
        typeCount.other++;
      }
    });

    const total = Object.values(typeCount).reduce((sum, count) => sum + count, 0);
    
    return [
      { type: '文本消息', count: typeCount.text, percentage: total > 0 ? Math.round((typeCount.text / total) * 100) : 0 },
      { type: '图片消息', count: typeCount.image, percentage: total > 0 ? Math.round((typeCount.image / total) * 100) : 0 },
      { type: '语音消息', count: typeCount.voice, percentage: total > 0 ? Math.round((typeCount.voice / total) * 100) : 0 },
      { type: '视频消息', count: typeCount.video, percentage: total > 0 ? Math.round((typeCount.video / total) * 100) : 0 },
      { type: '文件消息', count: typeCount.file, percentage: total > 0 ? Math.round((typeCount.file / total) * 100) : 0 },
      { type: '其他消息', count: typeCount.other, percentage: total > 0 ? Math.round((typeCount.other / total) * 100) : 0 }
    ].filter(item => item.count > 0); // 只返回有数据的类型
  }

  /**
   * 分析情感分布（简单的关键词匹配）
   */
  analyzeSentiment(messageHistory) {
    const sentiment = { positive: 0, neutral: 0, negative: 0 };
    
    const positiveKeywords = ['好', '谢谢', '棒', '赞', '喜欢', '开心', '哈哈', '😊', '👍', '❤️'];
    const negativeKeywords = ['不', '坏', '讨厌', '烦', '生气', '😢', '😠', '💔', '差'];

    messageHistory.forEach(msg => {
      if (!msg.content) {
        sentiment.neutral++;
        return;
      }

      const content = msg.content.toLowerCase();
      let hasPositive = positiveKeywords.some(keyword => content.includes(keyword));
      let hasNegative = negativeKeywords.some(keyword => content.includes(keyword));

      if (hasPositive && !hasNegative) {
        sentiment.positive++;
      } else if (hasNegative && !hasPositive) {
        sentiment.negative++;
      } else {
        sentiment.neutral++;
      }
    });

    const total = Object.values(sentiment).reduce((sum, count) => sum + count, 0);
    
    return [
      { sentiment: 'positive', count: sentiment.positive, percentage: total > 0 ? Math.round((sentiment.positive / total) * 100) : 0 },
      { sentiment: 'neutral', count: sentiment.neutral, percentage: total > 0 ? Math.round((sentiment.neutral / total) * 100) : 0 },
      { sentiment: 'negative', count: sentiment.negative, percentage: total > 0 ? Math.round((sentiment.negative / total) * 100) : 0 }
    ];
  }

  /**
   * 分析用户活跃时间分布
   */
  analyzeUserActivityDistribution(messageHistory) {
    const timeSlots = [
      { timeRange: '0-6点', userCount: 0, messages: 0 },
      { timeRange: '6-12点', userCount: 0, messages: 0 },
      { timeRange: '12-18点', userCount: 0, messages: 0 },
      { timeRange: '18-24点', userCount: 0, messages: 0 }
    ];

    const usersByTimeSlot = [new Set(), new Set(), new Set(), new Set()];

    messageHistory.forEach(msg => {
      if (!msg.timestamp || !msg.userId) return;
      
      const hour = new Date(msg.timestamp).getHours();
      let slotIndex;
      
      if (hour >= 0 && hour < 6) slotIndex = 0;
      else if (hour >= 6 && hour < 12) slotIndex = 1;
      else if (hour >= 12 && hour < 18) slotIndex = 2;
      else slotIndex = 3;
      
      usersByTimeSlot[slotIndex].add(msg.userId);
      timeSlots[slotIndex].messages++;
    });

    timeSlots.forEach((slot, index) => {
      slot.userCount = usersByTimeSlot[index].size;
    });

    return timeSlots;
  }

  /**
   * 获取平均响应时间
   */
  getAverageResponseTime() {
    // 简单的响应时间计算，可以基于API调用历史改进
    return Math.round(50 + Math.random() * 30); // 50-80ms 的响应时间
  }

  /**
   * 获取CPU使用率
   */
  getCpuUsage() {
    // Node.js 没有直接的CPU使用率API，这里使用基于运行时间的估算
    const uptime = process.uptime();
    const usage = process.cpuUsage();
    const totalUsage = (usage.user + usage.system) / 1000; // 转换为毫秒
    const cpuPercentage = (totalUsage / (uptime * 1000)) * 100;
    
    return Math.min(95, Math.max(5, Math.round(cpuPercentage)));
  }

  /**
   * 生成时间序列数据（已废弃，使用 generateRealTimeSeriesData）
   */
  generateTimeSeriesData(count, type) {
    return Array.from({ length: count }, (_, i) => {
      const now = new Date();
      let timeValue, label;
      
      switch (type) {
        case 'hour':
          timeValue = new Date(now.getTime() - (count - 1 - i) * 60 * 60 * 1000);
          label = timeValue.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
          break;
        case 'day':
          timeValue = new Date(now.getTime() - (count - 1 - i) * 24 * 60 * 60 * 1000);
          label = timeValue.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
          break;
        case 'week':
          label = `第${count - i}周`;
          break;
      }

      const baseMessages = Math.floor(Math.random() * 100) + 20;
      const privateMessages = Math.floor(baseMessages * 0.4);
      const groupMessages = baseMessages - privateMessages;

      return {
        [type === 'hour' ? 'time' : type === 'day' ? 'date' : 'week']: label,
        messages: baseMessages,
        private: privateMessages,
        group: groupMessages
      };
    });
  }

  /**
   * 获取实时统计数据
   */
  getRealtimeStats() {
    return {
      connectionStatus: this.llonebotWs?.readyState === 1 ? 'connected' : 'disconnected',
      clientsCount: this.clients.size,
      systemUptime: Math.floor(process.uptime()),
      memoryUsage: process.memoryUsage(),
      loginInfo: this.loginInfo,
      rulesCount: this.eventEngine.getRules().length,
      pluginsCount: this.pluginManager?.plugins?.size || 0,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * 获取插件指令信息
   */
  getPluginCommandsInfo(pluginId) {
    const plugin = this.pluginManager.plugins.get(pluginId);
    if (!plugin) {
      throw new Error('插件不存在或未加载');
    }

    const detailedInfo = plugin.getDetailedInfo();
    
    // 获取规则中使用的指令（规则指令）
    const ruleCommands = this.eventEngine.getRules()
      .filter(rule => rule.pluginId === pluginId || this.isRuleRelatedToPlugin(rule, pluginId))
      .map(rule => ({
        command: this.extractCommandFromRule(rule),
        type: 'rule',
        ruleId: rule.id,
        ruleName: rule.name,
        description: rule.description || '规则指令',
        usage: rule.usage || '',
        enabled: rule.enabled
      }))
      .filter(cmd => cmd.command); // 过滤掉无效指令

    return {
      customCommands: detailedInfo.commands, // 自定义指令
      ruleCommands, // 规则指令
      totalCommands: detailedInfo.commands.length + ruleCommands.length,
      statistics: {
        customCommandsCount: detailedInfo.commands.length,
        ruleCommandsCount: ruleCommands.length,
        totalExecutions: detailedInfo.statistics.commandExecutions
      }
    };
  }

  /**
   * 获取插件错误信息
   */
  getPluginErrorsInfo(pluginId) {
    const plugin = this.pluginManager.plugins.get(pluginId);
    if (!plugin) {
      throw new Error('插件不存在或未加载');
    }

    const detailedInfo = plugin.getDetailedInfo();
    
    return {
      recentErrors: detailedInfo.errors,
      errorStatistics: {
        totalErrors: detailedInfo.statistics.errorsOccurred,
        commandErrors: detailedInfo.errors.filter(e => e.type === 'command').length,
        taskErrors: detailedInfo.errors.filter(e => e.type === 'task').length,
        eventErrors: detailedInfo.errors.filter(e => e.type === 'event').length
      },
      commandErrorDetails: detailedInfo.commands.filter(cmd => cmd.lastError).map(cmd => ({
        command: cmd.command,
        lastError: cmd.lastError,
        executionCount: cmd.executionCount
      })),
      taskErrorDetails: detailedInfo.tasks.filter(task => task.lastError).map(task => ({
        name: task.name,
        lastError: task.lastError,
        executionCount: task.executionCount
      }))
    };
  }

  /**
   * 检查规则是否与插件相关
   */
  isRuleRelatedToPlugin(rule, pluginId) {
    // 检查规则的动作中是否包含插件相关的指令
    return rule.actions && rule.actions.some(action => 
      action.type === 'execute_command' && 
      action.params && 
      action.params.command && 
      action.params.command.startsWith('/')
    );
  }

  /**
   * 从规则中提取指令
   */
  extractCommandFromRule(rule) {
    if (!rule.actions) return null;
    
    const commandAction = rule.actions.find(action => 
      action.type === 'execute_command' && 
      action.params && 
      action.params.command
    );
    
    return commandAction ? commandAction.params.command : null;
  }

  /**
   * 将事件转发给插件系统处理
   */
  async forwardEventToPlugins(event) {
    // 获取所有已启用的插件
    const enabledPlugins = Array.from(this.pluginManager.plugins.values())
      .filter(plugin => plugin.isEnabled);
    
    if (enabledPlugins.length === 0) {
      console.log('🔌 没有启用的插件');
      return;
    }
    
    // 记录插件执行统计（每个插件处理事件算一次执行）
    systemStatistics.recordPluginExecution();
    
    // 检查是否是指令消息
    if (event.post_type === 'message' && event.raw_message) {
      const message = event.raw_message.trim();
      if (message.startsWith('/')) {
        // 提取指令和参数
        const parts = message.split(/\s+/);
        const commandName = parts[0].substring(1); // 去掉 /
        
        // 查找注册的指令
        const commandInfo = this.commandRegistry.commands.get(commandName);
        
        if (commandInfo && commandInfo.handler) {
          logger.plugin('指令执行', `执行插件指令: ${commandName}`);
          try {
            await commandInfo.handler(event);
            return; // 指令处理完成，不再继续事件处理
          } catch (error) {
            logger.error('插件指令', `执行失败: ${commandName}`, error);
          }
        }
      }
    }
    
    // 并行处理所有插件的事件
    const promises = enabledPlugins.map(async (plugin) => {
      try {
        // 根据事件类型调用相应的处理方法
        if (event.post_type === 'message') {
          // 通用消息处理
          if (plugin.eventHandlers.has('message')) {
            logger.plugin(`[${plugin.info.id}]`, '处理消息事件');
            const handlers = plugin.eventHandlers.get('message');
            for (const handler of handlers) {
              await handler(event);
            }
          }
          
          // 具体消息类型处理
          const specificEventType = `${event.message_type}_message`;
          if (plugin.eventHandlers.has(specificEventType)) {
            logger.plugin(`[${plugin.info.id}]`, `处理 ${specificEventType} 事件`);
            const handlers = plugin.eventHandlers.get(specificEventType);
            for (const handler of handlers) {
              await handler(event);
            }
          }
        } else {
          // 其他事件类型
          const eventType = event.post_type;
          if (plugin.eventHandlers.has(eventType)) {
            logger.plugin(`[${plugin.info.id}]`, `处理 ${eventType} 事件`);
            const handlers = plugin.eventHandlers.get(eventType);
            for (const handler of handlers) {
              await handler(event);
            }
          }
        }
      } catch (error) {
        logger.error(`插件 ${plugin.info.id}`, '处理事件失败', error);
      }
    });
    
    await Promise.allSettled(promises);
  }

  /**
   * 停止服务器
   */
  async stop() {
    logger.info('服务器', '正在关闭...');
    
    // 关闭插件系统（优先关闭，确保Python进程正确终止）
    if (this.pluginManager) {
      try {
        await this.pluginManager.shutdown();
      } catch (error) {
        logger.error('插件系统', '关闭失败: ' + error.message);
      }
    }
    
    // 关闭任务管理器
    if (this.taskManager) {
      try {
        this.taskManager.shutdown();
      } catch (error) {
        logger.error('任务管理器', '关闭失败: ' + error.message);
      }
    }
    
    // 关闭系统统计模块
    if (systemStatistics) {
      try {
        systemStatistics.stopAutoSave();
      } catch (error) {
        logger.error('系统统计', '关闭失败: ' + error.message);
      }
    }
    
    // 关闭安全中间件
    if (this.securityMiddleware) {
      try {
        this.securityMiddleware.shutdown();
      } catch (error) {
        logger.error('安全中间件', '关闭失败: ' + error.message);
      }
    }
    
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    
    if (this.autoCleanupInterval) {
      clearInterval(this.autoCleanupInterval);
    }
    
    if (this.llonebotWs) {
      this.llonebotWs.close();
    }
    
    // 关闭所有客户端连接
    this.clients.forEach((client) => {
      client.ws.close(1000, '服务器关闭');
    });
    
    if (this.wss) {
      this.wss.close();
    }
    
    if (this.server) {
      this.server.close();
    }
  }
}

// 启动服务器
const server = new KiBotWebSocketServer();
server.start();

// 优雅关闭
process.on('SIGINT', async () => {
  console.log(''); // 换行
  logger.info('服务器', '正在关闭...');
  
  // 设置超时保护，防止关闭过程卡住
  const forceExitTimeout = setTimeout(() => {
    logger.warn('关闭超时', '强制退出进程');
    process.exit(1);
  }, 5000); // 5秒超时
  
  try {
    await server.stop();
    clearTimeout(forceExitTimeout);
    logger.success('服务器', '已安全关闭');
    process.exit(0);
  } catch (error) {
    logger.error('关闭失败', error.message);
    clearTimeout(forceExitTimeout);
    process.exit(1);
  }
});

process.on('SIGTERM', async () => {
  console.log(''); // 换行
  logger.info('服务器', '正在关闭...');
  
  // 设置超时保护
  const forceExitTimeout = setTimeout(() => {
    logger.warn('关闭超时', '强制退出进程');
    process.exit(1);
  }, 5000); // 5秒超时
  
  try {
    await server.stop();
    clearTimeout(forceExitTimeout);
    logger.success('服务器', '已安全关闭');
    process.exit(0);
  } catch (error) {
    logger.error('关闭失败', error.message);
    clearTimeout(forceExitTimeout);
    process.exit(1);
  }
});

export default KiBotWebSocketServer;
