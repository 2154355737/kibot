import SessionManager from './session-manager.js';
import PermissionController from './permission-controller.js';

/**
 * 安全中间件 - 统一的身份验证和权限控制
 */
export class SecurityMiddleware {
  constructor() {
    this.sessionManager = new SessionManager();
    this.permissionController = new PermissionController();
    this.securityEventHandlers = new Map();
    
    console.log('🛡️ 安全中间件初始化完成');
  }

  /**
   * WebSocket连接认证中间件
   * @param {Object} req - HTTP请求对象
   * @param {WebSocket} ws - WebSocket连接
   * @returns {Object} 认证结果
   */
  async authenticateWebSocketConnection(req, ws) {
    const clientIp = req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'] || '';
    const origin = req.headers['origin'] || '';
    
    // 检查连接头中的认证信息
    const sessionId = req.headers['x-session-id'] || 
                     req.headers['authorization']?.replace('Bearer ', '') ||
                     new URL(`http://localhost${req.url}`).searchParams.get('sessionId');

    console.log('🔐 WebSocket连接认证:', {
      clientIp,
      userAgent: userAgent.substring(0, 50),
      origin,
      hasSessionId: !!sessionId
    });

    // 如果没有会话ID，这是一个新的连接，需要认证
    if (!sessionId) {
      return {
        success: false,
        needAuth: true,
        clientType: this.identifyClientType(req),
        message: '需要身份认证',
        tempConnectionId: this.generateTempId()
      };
    }

    // 验证现有会话
    const session = this.sessionManager.validateSession(sessionId);
    if (!session) {
      return {
        success: false,
        needAuth: true,
        error: 'INVALID_SESSION',
        message: '会话无效或已过期，请重新认证'
      };
    }

    // 记录安全事件
    this.logSecurityEvent('WEBSOCKET_AUTH_SUCCESS', {
      sessionId,
      clientIp,
      userAgent,
      permission: session.permission
    });

    return {
      success: true,
      session,
      message: '认证成功',
      permission: session.permission
    };
  }

  /**
   * API调用认证和权限验证中间件
   * @param {string} sessionId - 会话ID
   * @param {string} action - API动作
   * @param {Object} params - API参数
   * @param {Object} clientInfo - 客户端信息
   * @returns {Object} 验证结果
   */
  async validateApiCall(sessionId, action, params = {}, clientInfo = {}) {
    // 验证会话
    const session = this.sessionManager.validateSession(sessionId);
    if (!session) {
      this.logSecurityEvent('API_AUTH_FAILED', {
        sessionId,
        action,
        reason: 'INVALID_SESSION',
        ...clientInfo
      });
      
      return {
        success: false,
        error: 'INVALID_SESSION',
        message: '会话无效或已过期'
      };
    }

    // 检查权限
    const permissionResult = this.permissionController.checkApiPermission(
      action, 
      session.permission, 
      sessionId
    );

    if (!permissionResult.allowed) {
      this.logSecurityEvent('API_PERMISSION_DENIED', {
        sessionId,
        action,
        permission: session.permission,
        reason: permissionResult.reason,
        ...clientInfo
      });

      return {
        success: false,
        error: permissionResult.reason,
        message: permissionResult.message
      };
    }

    // 检查是否为敏感操作
    const isSensitive = this.permissionController.isSensitiveAction(action);
    
    // 记录API调用
    this.logSecurityEvent('API_CALL_AUTHORIZED', {
      sessionId,
      action,
      permission: session.permission,
      isSensitive,
      paramsCount: Object.keys(params).length,
      ...clientInfo
    });

    return {
      success: true,
      session,
      isSensitive,
      message: '权限验证通过'
    };
  }

  /**
   * 用户认证方法
   * @param {string} authCode - 授权码
   * @param {Object} clientInfo - 客户端信息
   * @returns {Object} 认证结果
   */
  async authenticateUser(authCode, clientInfo = {}) {
    const { clientIp, userAgent } = clientInfo;
    
    console.log('🔐 用户认证请求:', {
      clientIp,
      userAgent: userAgent?.substring(0, 50),
      authCodeLength: authCode?.length
    });

    if (!authCode) {
      this.logSecurityEvent('AUTH_FAILED', {
        reason: 'MISSING_AUTH_CODE',
        ...clientInfo
      });
      
      return {
        success: false,
        error: 'MISSING_AUTH_CODE',
        message: '请提供授权码'
      };
    }

    // 使用会话管理器进行认证
    const authResult = await this.sessionManager.authenticate(
      authCode,
      clientIp,
      userAgent
    );

    if (authResult.success) {
      this.logSecurityEvent('AUTH_SUCCESS', {
        sessionId: authResult.sessionId,
        permission: authResult.permission,
        ...clientInfo
      });
    } else {
      this.logSecurityEvent('AUTH_FAILED', {
        reason: authResult.error,
        message: authResult.message,
        ...clientInfo
      });
    }

    return authResult;
  }

  /**
   * 客户端类型识别（从原有代码移植）
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
        req.headers['x-llonebot'] === 'true') {
      return {
        type: 'llonebot',
        trusted: true,
        description: 'LLOneBot机器人客户端'
      };
    }
    
    // 检查Web前端客户端
    if (origin && (
        origin.includes('localhost') ||
        origin.includes('127.0.0.1') ||
        userAgent.includes('mozilla') ||
        userAgent.includes('chrome') ||
        userAgent.includes('firefox') ||
        userAgent.includes('safari') ||
        userAgent.includes('edge')
      )) {
      return {
        type: 'web_client',
        trusted: remoteAddress === '127.0.0.1' || remoteAddress === '::1',
        description: '网页前端客户端'
      };
    }
    
    return {
      type: 'unknown',
      trusted: false,
      description: '未知客户端类型'
    };
  }

  /**
   * 生成临时连接ID
   */
  generateTempId() {
    return `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 记录安全事件
   * @param {string} eventType - 事件类型
   * @param {Object} eventData - 事件数据
   */
  logSecurityEvent(eventType, eventData = {}) {
    const securityEvent = {
      id: `sec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date().toISOString(),
      type: eventType,
      data: {
        ...eventData,
        timestamp: Date.now()
      }
    };

    // 输出到控制台（根据事件类型决定日志级别）
    // 只记录重要的安全事件，减少日志噪音
    const importantEvents = [
      'AUTH_SUCCESS', 'AUTH_FAILED', 
      'SESSION_REVOKED', 'CONFIG_RELOADED',
      'API_PERMISSION_DENIED', 'WEBSOCKET_AUTH_SUCCESS'
    ];
    
    if (!importantEvents.includes(eventType)) {
      // 跳过常规API调用的日志，减少输出
      return;
    }
    
    const isWarning = eventType.includes('FAILED') || 
                     eventType.includes('DENIED') || 
                     eventType.includes('INVALID');
    
    if (isWarning) {
      console.warn(`🚨 安全事件 [${eventType}]:`, eventData);
    } else {
      console.log(`🔒 安全事件 [${eventType}]:`, eventData);
    }

    // 触发安全事件处理器
    this.triggerSecurityEventHandlers(eventType, securityEvent);
  }

  /**
   * 注册安全事件处理器
   * @param {string} eventType - 事件类型
   * @param {Function} handler - 处理器函数
   */
  onSecurityEvent(eventType, handler) {
    if (!this.securityEventHandlers.has(eventType)) {
      this.securityEventHandlers.set(eventType, new Set());
    }
    this.securityEventHandlers.get(eventType).add(handler);
  }

  /**
   * 移除安全事件处理器
   * @param {string} eventType - 事件类型
   * @param {Function} handler - 处理器函数
   */
  offSecurityEvent(eventType, handler) {
    const handlers = this.securityEventHandlers.get(eventType);
    if (handlers) {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this.securityEventHandlers.delete(eventType);
      }
    }
  }

  /**
   * 触发安全事件处理器
   * @param {string} eventType - 事件类型
   * @param {Object} eventData - 事件数据
   */
  triggerSecurityEventHandlers(eventType, eventData) {
    const handlers = this.securityEventHandlers.get(eventType) || new Set();
    const allHandlers = this.securityEventHandlers.get('*') || new Set(); // 通用处理器
    
    [...handlers, ...allHandlers].forEach(handler => {
      try {
        handler(eventData);
      } catch (error) {
        console.error(`❌ 安全事件处理器错误 [${eventType}]:`, error);
      }
    });
  }

  /**
   * 获取安全统计信息
   */
  getSecurityStats() {
    const sessionStats = this.sessionManager.getSessionStats();
    const permissionStats = this.permissionController.getPermissionStats();
    
    return {
      sessions: sessionStats,
      permissions: permissionStats,
      security: {
        eventHandlers: this.securityEventHandlers.size,
        timestamp: new Date().toISOString()
      }
    };
  }

  /**
   * 撤销用户会话
   * @param {string} sessionId - 会话ID
   * @param {string} reason - 撤销原因
   */
  revokeSession(sessionId, reason = 'MANUAL_REVOKE') {
    const result = this.sessionManager.revokeSession(sessionId);
    
    if (result) {
      this.logSecurityEvent('SESSION_REVOKED', {
        sessionId,
        reason,
        revokedAt: Date.now()
      });
    }
    
    return result;
  }

  /**
   * 获取会话信息
   * @param {string} sessionId - 会话ID
   */
  getSessionInfo(sessionId) {
    return this.sessionManager.validateSession(sessionId);
  }

  /**
   * 获取所有活跃会话
   */
  getActiveSessions() {
    return this.sessionManager.getActiveSessions();
  }

  /**
   * 获取审计日志
   * @param {Object} filters - 过滤条件
   * @param {number} limit - 返回数量限制
   */
  getAuditLogs(filters = {}, limit = 100) {
    return this.permissionController.getAuditLogs(filters, limit);
  }

  /**
   * 检查用户权限信息
   * @param {string} permission - 权限级别
   */
  getPermissionInfo(permission) {
    return this.permissionController.getPermissionInfo(permission);
  }

  /**
   * 生成新的授权码
   * @param {string} permission - 权限级别
   * @param {string} requestSessionId - 请求者会话ID
   */
  generateNewAuthCode(permission, requestSessionId) {
    // 只有管理员可以生成新的授权码
    const session = this.sessionManager.validateSession(requestSessionId);
    if (!session || session.permission !== 'admin') {
      this.logSecurityEvent('AUTH_CODE_GENERATION_DENIED', {
        sessionId: requestSessionId,
        requestedPermission: permission,
        reason: 'INSUFFICIENT_PERMISSION'
      });
      
      return {
        success: false,
        error: 'INSUFFICIENT_PERMISSION',
        message: '只有管理员可以生成新的授权码'
      };
    }

    const newCode = this.sessionManager.generateNewAuthCode(permission);
    
    this.logSecurityEvent('AUTH_CODE_GENERATED', {
      sessionId: requestSessionId,
      targetPermission: permission,
      newCodeLength: newCode.length
    });

    return {
      success: true,
      authCode: newCode,
      permission,
      message: '新授权码生成成功'
    };
  }

  /**
   * 重新加载安全配置
   * @param {string} requestSessionId - 请求者会话ID（需要管理员权限）
   * @returns {Object} 重新加载结果
   */
  reloadSecurityConfig(requestSessionId) {
    // 只有管理员可以重新加载配置
    const session = this.sessionManager.validateSession(requestSessionId);
    if (!session || session.permission !== 'admin') {
      this.logSecurityEvent('CONFIG_RELOAD_DENIED', {
        sessionId: requestSessionId,
        reason: 'INSUFFICIENT_PERMISSION'
      });
      
      return {
        success: false,
        error: 'INSUFFICIENT_PERMISSION',
        message: '只有管理员可以重新加载安全配置'
      };
    }

    const reloadResult = this.sessionManager.reloadSecurityConfig();
    
    if (reloadResult) {
      this.logSecurityEvent('CONFIG_RELOADED', {
        sessionId: requestSessionId,
        timestamp: Date.now()
      });

      return {
        success: true,
        message: '安全配置已重新加载，相关会话已撤销'
      };
    } else {
      return {
        success: false,
        error: 'RELOAD_FAILED',
        message: '重新加载配置失败，请检查配置文件'
      };
    }
  }

  /**
   * 定期清理过期数据
   */
  startPeriodicCleanup() {
    // 每小时执行一次清理
    setInterval(() => {
      try {
        this.sessionManager.cleanupExpiredSessions();
        this.permissionController.cleanupRateLimits();
        console.log('🧹 安全数据定期清理完成');
      } catch (error) {
        console.error('❌ 定期清理失败:', error);
      }
    }, 60 * 60 * 1000);
  }

  /**
   * 关闭安全中间件
   */
  shutdown() {
    console.log('🛡️ 安全中间件正在关闭...');
    
    // 清理所有会话
    const sessions = this.sessionManager.getActiveSessions();
    sessions.forEach(session => {
      this.sessionManager.revokeSession(session.sessionId);
    });
    
    // 清理事件处理器
    this.securityEventHandlers.clear();
    
    console.log('✅ 安全中间件已关闭');
  }
}

export default SecurityMiddleware;

