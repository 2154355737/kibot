import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

/**
 * 会话管理器 - 负责用户认证和会话管理
 */
export class SessionManager {
  constructor() {
    this.sessions = new Map(); // 存储活跃会话
    this.authCodes = new Map(); // 存储授权码
    this.loginAttempts = new Map(); // 登录尝试记录
    this.config = this.loadSecurityConfig();
    
    // 定期清理过期会话
    this.startSessionCleanup();
    
    console.log('🔐 会话管理器初始化完成');
  }

  /**
   * 加载安全配置
   */
  loadSecurityConfig() {
    try {
      // 尝试多个可能的路径（兼容不同的启动方式）
      const possiblePaths = [
        path.join(process.cwd(), 'config', 'security.json'),        // 从 server 目录启动
        path.join(process.cwd(), 'server', 'config', 'security.json') // 从项目根目录启动
      ];
      
      for (const configPath of possiblePaths) {
        if (fs.existsSync(configPath)) {
          const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
          console.log('📋 已加载安全配置文件:', configPath);
          return config;
        }
      }
      
      console.warn('⚠️ 未找到安全配置文件，使用默认配置');
    } catch (error) {
      console.warn('⚠️ 加载安全配置失败，使用默认配置:', error.message);
    }
    
    // 默认安全配置
    return {
      authCodes: {
        admin: process.env.ADMIN_CODE || 'kibot-admin-2024',
        operator: process.env.OPERATOR_CODE || 'kibot-op-2024',
        viewer: process.env.VIEWER_CODE || 'kibot-view-2024'
      },
      session: {
        expireTime: 24 * 60 * 60 * 1000, // 24小时
        maxConcurrent: 5,
        renewThreshold: 2 * 60 * 60 * 1000 // 2小时
      },
      security: {
        maxLoginAttempts: 5,
        lockoutDuration: 15 * 60 * 1000, // 15分钟
        ipWhitelist: [], // 空数组表示不限制IP
        requireSecureCode: true
      }
    };
  }

  /**
   * 生成安全的授权码
   */
  generateSecureCode(length = 16) {
    return crypto.randomBytes(length).toString('hex');
  }

  /**
   * 验证授权码并创建会话
   * @param {string} authCode - 授权码
   * @param {string} clientIp - 客户端IP
   * @param {string} userAgent - 用户代理
   * @returns {Object} 认证结果
   */
  async authenticate(authCode, clientIp = 'unknown', userAgent = 'unknown') {
    const clientKey = `${clientIp}_${userAgent}`;
    
    // 检查IP白名单
    if (this.config.security.ipWhitelist.length > 0 && 
        !this.config.security.ipWhitelist.includes(clientIp)) {
      console.warn(`🚫 IP不在白名单: ${clientIp}`);
      return {
        success: false,
        error: 'IP_NOT_ALLOWED',
        message: 'IP地址不在允许范围内'
      };
    }

    // 检查登录尝试限制
    const attempts = this.loginAttempts.get(clientKey) || { count: 0, lastAttempt: 0 };
    const now = Date.now();
    
    if (attempts.count >= this.config.security.maxLoginAttempts) {
      const timeSinceLast = now - attempts.lastAttempt;
      if (timeSinceLast < this.config.security.lockoutDuration) {
        const remainingTime = Math.ceil((this.config.security.lockoutDuration - timeSinceLast) / 60000);
        console.warn(`🔒 客户端被锁定: ${clientKey}, 剩余时间: ${remainingTime}分钟`);
        return {
          success: false,
          error: 'LOCKED_OUT',
          message: `登录尝试过多，请${remainingTime}分钟后再试`,
          remainingMinutes: remainingTime
        };
      } else {
        // 锁定时间已过，重置尝试次数
        this.loginAttempts.delete(clientKey);
      }
    }

    // 验证授权码
    const permission = this.validateAuthCode(authCode);
    if (!permission) {
      // 记录失败尝试
      this.loginAttempts.set(clientKey, {
        count: (attempts.count || 0) + 1,
        lastAttempt: now
      });
      
      console.warn(`❌ 授权码验证失败: ${clientIp} - ${authCode.substring(0, 4)}****`);
      return {
        success: false,
        error: 'INVALID_AUTH_CODE',
        message: '授权码无效'
      };
    }

    // 清除失败记录
    this.loginAttempts.delete(clientKey);

    // 检查并发会话限制
    const userSessions = Array.from(this.sessions.values()).filter(s => s.permission === permission);
    if (userSessions.length >= this.config.session.maxConcurrent) {
      // 移除最旧的会话
      const oldestSession = userSessions.reduce((oldest, current) => 
        current.createdAt < oldest.createdAt ? current : oldest
      );
      this.revokeSession(oldestSession.sessionId);
      console.log(`🔄 移除最旧会话为新会话腾出空间: ${oldestSession.sessionId}`);
    }

    // 创建新会话
    const sessionId = uuidv4();
    const session = {
      sessionId,
      permission,
      clientIp,
      userAgent,
      createdAt: now,
      lastActivity: now,
      isActive: true,
      metadata: {
        loginTime: new Date(now).toISOString(),
        authCodeType: this.getAuthCodeType(authCode)
      }
    };

    this.sessions.set(sessionId, session);
    
    console.log(`✅ 会话创建成功: ${sessionId} (权限: ${permission}, IP: ${clientIp})`);
    
    return {
      success: true,
      sessionId,
      permission,
      expiresAt: now + this.config.session.expireTime,
      message: '认证成功'
    };
  }

  /**
   * 验证授权码
   * @param {string} authCode - 授权码
   * @returns {string|null} 权限级别
   */
  validateAuthCode(authCode) {
    for (const [permission, code] of Object.entries(this.config.authCodes)) {
      if (authCode === code) {
        return permission;
      }
    }
    return null;
  }

  /**
   * 获取授权码类型（用于日志记录）
   */
  getAuthCodeType(authCode) {
    for (const [type, code] of Object.entries(this.config.authCodes)) {
      if (authCode === code) {
        return type;
      }
    }
    return 'unknown';
  }

  /**
   * 验证会话
   * @param {string} sessionId - 会话ID
   * @returns {Object|null} 会话信息
   */
  validateSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return null;
    }

    const now = Date.now();
    const timeSinceCreated = now - session.createdAt;
    const timeSinceActivity = now - session.lastActivity;

    // 检查会话是否过期
    if (timeSinceCreated > this.config.session.expireTime) {
      console.log(`⏰ 会话已过期: ${sessionId}`);
      this.revokeSession(sessionId);
      return null;
    }

    // 检查是否需要续期
    if (timeSinceActivity < this.config.session.renewThreshold) {
      session.lastActivity = now;
    }

    return session;
  }

  /**
   * 撤销会话
   * @param {string} sessionId - 会话ID
   */
  revokeSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.isActive = false;
      this.sessions.delete(sessionId);
      console.log(`🗑️ 会话已撤销: ${sessionId}`);
      return true;
    }
    return false;
  }

  /**
   * 续期会话
   * @param {string} sessionId - 会话ID
   */
  renewSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastActivity = Date.now();
      console.log(`🔄 会话已续期: ${sessionId}`);
      return true;
    }
    return false;
  }

  /**
   * 获取会话统计信息
   */
  getSessionStats() {
    const sessions = Array.from(this.sessions.values());
    const now = Date.now();
    
    return {
      total: sessions.length,
      byPermission: this.groupBy(sessions, 'permission'),
      active: sessions.filter(s => (now - s.lastActivity) < 5 * 60 * 1000).length, // 5分钟内活跃
      oldest: sessions.length > 0 ? Math.min(...sessions.map(s => s.createdAt)) : null,
      newest: sessions.length > 0 ? Math.max(...sessions.map(s => s.createdAt)) : null
    };
  }

  /**
   * 获取所有活跃会话
   */
  getActiveSessions() {
    return Array.from(this.sessions.values()).map(session => ({
      sessionId: session.sessionId,
      permission: session.permission,
      clientIp: session.clientIp,
      createdAt: session.createdAt,
      lastActivity: session.lastActivity,
      isActive: session.isActive,
      metadata: session.metadata
    }));
  }

  /**
   * 根据权限撤销所有会话
   * @param {string} permission - 权限级别
   */
  revokeSessionsByPermission(permission) {
    let revokedCount = 0;
    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.permission === permission) {
        this.revokeSession(sessionId);
        revokedCount++;
      }
    }
    console.log(`🔒 已撤销 ${revokedCount} 个 ${permission} 权限的会话`);
    return revokedCount;
  }

  /**
   * 启动会话清理定时器
   */
  startSessionCleanup() {
    setInterval(() => {
      this.cleanupExpiredSessions();
    }, 5 * 60 * 1000); // 每5分钟清理一次
  }

  /**
   * 清理过期会话
   */
  cleanupExpiredSessions() {
    const now = Date.now();
    let cleanedCount = 0;
    
    for (const [sessionId, session] of this.sessions.entries()) {
      const timeSinceCreated = now - session.createdAt;
      if (timeSinceCreated > this.config.session.expireTime) {
        this.sessions.delete(sessionId);
        cleanedCount++;
      }
    }
    
    if (cleanedCount > 0) {
      console.log(`🧹 清理了 ${cleanedCount} 个过期会话`);
    }
  }

  /**
   * 工具方法：按字段分组
   */
  groupBy(array, key) {
    return array.reduce((groups, item) => {
      const group = item[key];
      groups[group] = (groups[group] || 0) + 1;
      return groups;
    }, {});
  }

  /**
   * 更新安全配置
   * @param {Object} newConfig - 新配置
   */
  updateSecurityConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    
    // 保存配置到文件
    try {
      // 尝试保存到正确的路径（兼容不同的启动方式）
      const possibleDirs = [
        path.join(process.cwd(), 'config'),           // 从 server 目录启动
        path.join(process.cwd(), 'server', 'config')  // 从项目根目录启动
      ];
      
      let configPath = null;
      for (const configDir of possibleDirs) {
        if (fs.existsSync(configDir) || fs.existsSync(path.dirname(configDir))) {
          if (!fs.existsSync(configDir)) {
            fs.mkdirSync(configDir, { recursive: true });
          }
          configPath = path.join(configDir, 'security.json');
          break;
        }
      }
      
      if (configPath) {
        fs.writeFileSync(configPath, JSON.stringify(this.config, null, 2));
        console.log('💾 安全配置已保存:', configPath);
      } else {
        throw new Error('无法确定配置文件保存路径');
      }
    } catch (error) {
      console.error('❌ 保存安全配置失败:', error);
    }
  }

  /**
   * 生成新的授权码
   * @param {string} permission - 权限级别
   */
  generateNewAuthCode(permission) {
    const newCode = this.generateSecureCode();
    this.config.authCodes[permission] = newCode;
    
    // 保存配置到文件
    this.updateSecurityConfig(this.config);
    
    // 撤销该权限级别的所有现有会话
    this.revokeSessionsByPermission(permission);
    
    console.log(`🔑 已为 ${permission} 权限生成新授权码并保存到配置文件`);
    return newCode;
  }

  /**
   * 重新加载安全配置（用于配置文件被手动修改后）
   * @returns {boolean} 是否成功重新加载
   */
  reloadSecurityConfig() {
    try {
      const oldConfig = { ...this.config };
      this.config = this.loadSecurityConfig();
      
      // 检查授权码是否发生变化
      const changedPermissions = [];
      for (const [permission, code] of Object.entries(this.config.authCodes)) {
        if (oldConfig.authCodes[permission] !== code) {
          changedPermissions.push(permission);
        }
      }
      
      // 如果有授权码发生变化，撤销相应的会话
      if (changedPermissions.length > 0) {
        console.log(`🔄 授权码已变化，撤销相关会话: ${changedPermissions.join(', ')}`);
        changedPermissions.forEach(permission => {
          this.revokeSessionsByPermission(permission);
        });
      }
      
      console.log('✅ 安全配置已重新加载');
      return true;
    } catch (error) {
      console.error('❌ 重新加载安全配置失败:', error);
      return false;
    }
  }
}

export default SessionManager;

