import { logger } from '../utils/output-manager.js';

/**
 * 权限控制器 - 负责API权限验证和操作审计
 */
export class PermissionController {
  constructor() {
    this.permissions = this.initializePermissions();
    this.auditLogs = [];
    this.rateLimits = new Map(); // API调用频率限制
    
    logger.startup('权限控制器', '初始化完成');
  }

  /**
   * 初始化权限配置
   */
  initializePermissions() {
    return {
      // 管理员权限 - 完全访问
      admin: {
        level: 0,
        description: '管理员 - 完全访问权限',
        allowedActions: ['*'], // * 表示所有权限
        deniedActions: [], // 拒绝列表为空
        apiLimits: {
          requestsPerMinute: 200,
          requestsPerHour: 10000
        }
      },

      // 操作员权限 - 日常操作
      operator: {
        level: 1,
        description: '操作员 - 日常操作权限',
        allowedActions: [
          // 消息相关
          'send_private_msg', 'send_group_msg', 'delete_msg',
          
          // 用户管理
          'get_stranger_info', 'get_friend_list', 'get_group_list',
          'get_group_info', 'get_group_member_info', 'get_group_member_list',
          
          // 规则管理
          'rules_get_all', 'rules_add', 'rules_update', 'rules_delete', 'rules_reload',
          
          // 插件管理
          'plugins_list', 'plugins_info', 'plugins_enable', 'plugins_disable', 'plugins_reload',
          
          // 监控数据
          'monitor_stats', 'monitor_realtime',
          
          // 基础API
          'get_login_info', 'get_status', 'get_version_info',
          
          // 文件操作（限制）
          'get_image', 'get_record', 'get_file'
        ],
        deniedActions: [
          // 系统配置
          'set_restart', 'clean_cache',
          
          // 敏感操作
          'plugins_install', 'plugins_remove', 'plugins_scan',
          
          // 系统管理
          'internal_system_config', 'internal_user_manage'
        ],
        apiLimits: {
          requestsPerMinute: 100,
          requestsPerHour: 5000
        }
      },

      // 查看者权限 - 只读访问
      viewer: {
        level: 2,
        description: '查看者 - 只读权限',
        allowedActions: [
          // 查看类API
          'get_login_info', 'get_status', 'get_version_info',
          'get_stranger_info', 'get_friend_list', 'get_group_list',
          'get_group_info', 'get_group_member_info', 'get_group_member_list',
          
          // 规则查看
          'rules_get_all', 'rules_debug',
          
          // 插件查看
          'plugins_list', 'plugins_info', 'plugins_commands', 'plugins_errors',
          
          // 监控数据查看
          'monitor_stats', 'monitor_realtime',
          
          // 分组查看
          'groups_get_all'
        ],
        deniedActions: [
          // 所有修改操作
          'send_private_msg', 'send_group_msg', 'delete_msg',
          'rules_add', 'rules_update', 'rules_delete', 'rules_reload',
          'plugins_enable', 'plugins_disable', 'plugins_reload', 'plugins_install', 'plugins_remove',
          
          // 系统操作
          'set_restart', 'clean_cache',
          'internal_*' // 所有内部API
        ],
        apiLimits: {
          requestsPerMinute: 50,
          requestsPerHour: 2000
        }
      },

      // 访客权限 - 极度受限
      guest: {
        level: 3,
        description: '访客 - 基础查看权限',
        allowedActions: [
          'get_login_info', 'get_status', 'monitor_realtime'
        ],
        deniedActions: ['*'], // 默认拒绝所有，只允许白名单
        apiLimits: {
          requestsPerMinute: 10,
          requestsPerHour: 100
        }
      }
    };
  }

  /**
   * 检查API访问权限
   * @param {string} action - API动作
   * @param {string} permission - 用户权限级别
   * @param {string} sessionId - 会话ID（用于审计）
   * @returns {Object} 权限检查结果
   */
  checkApiPermission(action, permission, sessionId = null) {
    const permConfig = this.permissions[permission];
    if (!permConfig) {
      this.logAuditEvent('PERMISSION_CHECK', sessionId, action, false, 'INVALID_PERMISSION');
      return {
        allowed: false,
        reason: 'INVALID_PERMISSION',
        message: '无效的权限级别'
      };
    }

    // 管理员拥有所有权限
    if (permission === 'admin') {
      this.logAuditEvent('PERMISSION_CHECK', sessionId, action, true, 'ADMIN_ACCESS');
      return {
        allowed: true,
        reason: 'ADMIN_ACCESS',
        message: '管理员权限'
      };
    }

    // 检查拒绝列表
    if (this.isActionDenied(action, permConfig.deniedActions)) {
      this.logAuditEvent('PERMISSION_CHECK', sessionId, action, false, 'ACTION_DENIED');
      return {
        allowed: false,
        reason: 'ACTION_DENIED',
        message: `权限 ${permission} 不允许执行操作 ${action}`
      };
    }

    // 检查允许列表
    if (!this.isActionAllowed(action, permConfig.allowedActions)) {
      this.logAuditEvent('PERMISSION_CHECK', sessionId, action, false, 'ACTION_NOT_ALLOWED');
      return {
        allowed: false,
        reason: 'ACTION_NOT_ALLOWED',
        message: `权限 ${permission} 不包含操作 ${action}`
      };
    }

    // 检查API调用频率限制
    const rateLimitResult = this.checkRateLimit(sessionId, permConfig.apiLimits);
    if (!rateLimitResult.allowed) {
      this.logAuditEvent('PERMISSION_CHECK', sessionId, action, false, 'RATE_LIMIT_EXCEEDED');
      return rateLimitResult;
    }

    this.logAuditEvent('PERMISSION_CHECK', sessionId, action, true, 'PERMISSION_GRANTED');
    return {
      allowed: true,
      reason: 'PERMISSION_GRANTED',
      message: '权限验证通过'
    };
  }

  /**
   * 检查动作是否被拒绝
   * @param {string} action - 动作
   * @param {Array} deniedActions - 拒绝动作列表
   */
  isActionDenied(action, deniedActions) {
    return deniedActions.some(denied => {
      if (denied === '*') return true;
      if (denied.endsWith('*')) {
        const prefix = denied.slice(0, -1);
        return action.startsWith(prefix);
      }
      return denied === action;
    });
  }

  /**
   * 检查动作是否被允许
   * @param {string} action - 动作
   * @param {Array} allowedActions - 允许动作列表
   */
  isActionAllowed(action, allowedActions) {
    return allowedActions.some(allowed => {
      if (allowed === '*') return true;
      if (allowed.endsWith('*')) {
        const prefix = allowed.slice(0, -1);
        return action.startsWith(prefix);
      }
      return allowed === action;
    });
  }

  /**
   * 检查API调用频率限制
   * @param {string} sessionId - 会话ID
   * @param {Object} limits - 限制配置
   */
  checkRateLimit(sessionId, limits) {
    if (!sessionId || !limits) {
      return { allowed: true };
    }

    const now = Date.now();
    const windowSize = 60 * 1000; // 1分钟窗口
    const hourWindowSize = 60 * 60 * 1000; // 1小时窗口

    // 获取或创建用户的调用记录
    if (!this.rateLimits.has(sessionId)) {
      this.rateLimits.set(sessionId, {
        minuteWindow: [],
        hourWindow: []
      });
    }

    const userLimits = this.rateLimits.get(sessionId);

    // 清理过期的记录
    userLimits.minuteWindow = userLimits.minuteWindow.filter(time => now - time < windowSize);
    userLimits.hourWindow = userLimits.hourWindow.filter(time => now - time < hourWindowSize);

    // 检查分钟级限制
    if (userLimits.minuteWindow.length >= limits.requestsPerMinute) {
      return {
        allowed: false,
        reason: 'RATE_LIMIT_EXCEEDED',
        message: `API调用频率超限：每分钟最多 ${limits.requestsPerMinute} 次`
      };
    }

    // 检查小时级限制
    if (userLimits.hourWindow.length >= limits.requestsPerHour) {
      return {
        allowed: false,
        reason: 'RATE_LIMIT_EXCEEDED',
        message: `API调用频率超限：每小时最多 ${limits.requestsPerHour} 次`
      };
    }

    // 记录此次调用
    userLimits.minuteWindow.push(now);
    userLimits.hourWindow.push(now);

    return { allowed: true };
  }

  /**
   * 记录审计日志
   * @param {string} eventType - 事件类型
   * @param {string} sessionId - 会话ID
   * @param {string} action - 动作
   * @param {boolean} success - 是否成功
   * @param {string} reason - 原因
   * @param {Object} metadata - 额外元数据
   */
  logAuditEvent(eventType, sessionId, action, success, reason, metadata = {}) {
    const auditLog = {
      id: `audit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date().toISOString(),
      eventType,
      sessionId: sessionId || 'anonymous',
      action,
      success,
      reason,
      metadata: {
        ...metadata,
        userAgent: metadata.userAgent || 'unknown',
        clientIp: metadata.clientIp || 'unknown'
      }
    };

    this.auditLogs.push(auditLog);

    // 只保留最近1000条审计日志（防止内存泄露）
    if (this.auditLogs.length > 1000) {
      this.auditLogs = this.auditLogs.slice(-1000);
    }

    // 如果是失败的权限检查，输出警告日志
    if (!success) {
      console.warn(`🚫 权限检查失败: ${action} (会话: ${sessionId || '匿名'}, 原因: ${reason})`);
    }
  }

  /**
   * 获取审计日志
   * @param {Object} filters - 过滤条件
   * @param {number} limit - 返回数量限制
   */
  getAuditLogs(filters = {}, limit = 100) {
    let filteredLogs = this.auditLogs;

    // 按会话ID过滤
    if (filters.sessionId) {
      filteredLogs = filteredLogs.filter(log => log.sessionId === filters.sessionId);
    }

    // 按成功/失败过滤
    if (filters.success !== undefined) {
      filteredLogs = filteredLogs.filter(log => log.success === filters.success);
    }

    // 按时间范围过滤
    if (filters.startTime || filters.endTime) {
      filteredLogs = filteredLogs.filter(log => {
        const logTime = new Date(log.timestamp).getTime();
        if (filters.startTime && logTime < new Date(filters.startTime).getTime()) {
          return false;
        }
        if (filters.endTime && logTime > new Date(filters.endTime).getTime()) {
          return false;
        }
        return true;
      });
    }

    // 按动作过滤
    if (filters.action) {
      filteredLogs = filteredLogs.filter(log => 
        log.action.toLowerCase().includes(filters.action.toLowerCase())
      );
    }

    // 排序并限制数量
    return filteredLogs
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, limit);
  }

  /**
   * 获取权限统计信息
   */
  getPermissionStats() {
    const recentLogs = this.auditLogs.filter(log => 
      Date.now() - new Date(log.timestamp).getTime() < 24 * 60 * 60 * 1000
    );

    return {
      totalAuditLogs: this.auditLogs.length,
      recentAuditLogs: recentLogs.length,
      successfulActions: recentLogs.filter(log => log.success).length,
      failedActions: recentLogs.filter(log => !log.success).length,
      topActions: this.getTopActions(recentLogs),
      topFailReasons: this.getTopFailReasons(recentLogs.filter(log => !log.success)),
      activeSessions: new Set(recentLogs.map(log => log.sessionId)).size
    };
  }

  /**
   * 获取最频繁的操作
   */
  getTopActions(logs, limit = 10) {
    const actionCounts = {};
    logs.forEach(log => {
      actionCounts[log.action] = (actionCounts[log.action] || 0) + 1;
    });

    return Object.entries(actionCounts)
      .sort(([,a], [,b]) => b - a)
      .slice(0, limit)
      .map(([action, count]) => ({ action, count }));
  }

  /**
   * 获取最频繁的失败原因
   */
  getTopFailReasons(failedLogs, limit = 10) {
    const reasonCounts = {};
    failedLogs.forEach(log => {
      reasonCounts[log.reason] = (reasonCounts[log.reason] || 0) + 1;
    });

    return Object.entries(reasonCounts)
      .sort(([,a], [,b]) => b - a)
      .slice(0, limit)
      .map(([reason, count]) => ({ reason, count }));
  }

  /**
   * 清理过期的频率限制记录
   */
  cleanupRateLimits() {
    const now = Date.now();
    const hourWindowSize = 60 * 60 * 1000;

    for (const [sessionId, limits] of this.rateLimits.entries()) {
      // 如果用户超过1小时没有任何请求，清理其记录
      const lastRequest = Math.max(
        ...limits.hourWindow,
        ...limits.minuteWindow,
        0
      );
      
      if (now - lastRequest > hourWindowSize) {
        this.rateLimits.delete(sessionId);
      }
    }
  }

  /**
   * 检查是否为敏感操作（需要额外确认）
   * @param {string} action - 动作
   */
  isSensitiveAction(action) {
    const sensitiveActions = [
      'delete_msg',
      'set_restart',
      'clean_cache',
      'plugins_install',
      'plugins_remove',
      'rules_delete',
      'internal_system_config'
    ];

    return sensitiveActions.some(sensitive => {
      if (sensitive.endsWith('*')) {
        return action.startsWith(sensitive.slice(0, -1));
      }
      return action === sensitive;
    });
  }

  /**
   * 更新权限配置
   * @param {string} permission - 权限级别
   * @param {Object} config - 新配置
   */
  updatePermissionConfig(permission, config) {
    if (this.permissions[permission]) {
      this.permissions[permission] = { ...this.permissions[permission], ...config };
      console.log(`✅ 权限配置已更新: ${permission}`);
      
      // 记录权限配置变更
      this.logAuditEvent('PERMISSION_CONFIG_UPDATE', null, permission, true, 'CONFIG_UPDATED', {
        changes: Object.keys(config)
      });
    }
  }

  /**
   * 获取用户权限信息
   * @param {string} permission - 权限级别
   */
  getPermissionInfo(permission) {
    const permConfig = this.permissions[permission];
    if (!permConfig) {
      return null;
    }

    return {
      level: permConfig.level,
      description: permConfig.description,
      allowedActionsCount: permConfig.allowedActions.length,
      deniedActionsCount: permConfig.deniedActions.length,
      apiLimits: permConfig.apiLimits,
      // 不返回具体的动作列表，避免信息泄露
      isAdmin: permission === 'admin',
      canModify: permConfig.level <= 1
    };
  }
}

export default PermissionController;

