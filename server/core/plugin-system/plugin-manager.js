/**
 * KiBot 插件管理器
 * 负责插件的生命周期管理、热重载、依赖管理等
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { EventEmitter } from 'events';
// 注意：PluginBase 已淘汰，改用 EnhancedPluginBase
import { EnhancedPluginBase, PluginContext } from './plugin-sdk-enhanced.js';
import { PythonPluginAdapter } from './python-plugin-adapter.js';
import { logger } from '../../utils/output-manager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * 插件工具类
 */
class PluginUtils {
  /**
   * 验证插件信息
   */
  static validatePluginInfo(pluginInfo) {
    const required = ['id', 'name', 'version', 'author', 'main'];
    const missing = required.filter(field => !pluginInfo[field]);
    
    if (missing.length > 0) {
      throw new Error(`插件信息缺少必需字段: ${missing.join(', ')}`);
    }

    // 验证版本格式
    if (!/^\d+\.\d+\.\d+$/.test(pluginInfo.version)) {
      throw new Error('插件版本格式应为 x.y.z');
    }

    // 验证ID格式
    if (!/^[a-z0-9_-]+$/i.test(pluginInfo.id)) {
      throw new Error('插件ID只能包含字母、数字、下划线和连字符');
    }

    return true;
  }

  /**
   * 解析插件依赖
   */
  static parseDependencies(dependencies = []) {
    return dependencies.map(dep => {
      if (typeof dep === 'string') {
        return { id: dep, version: '*' };
      }
      return dep;
    });
  }

  /**
   * 比较版本号
   */
  static compareVersions(version1, version2) {
    const v1Parts = version1.split('.').map(Number);
    const v2Parts = version2.split('.').map(Number);
    
    for (let i = 0; i < 3; i++) {
      if (v1Parts[i] > v2Parts[i]) return 1;
      if (v1Parts[i] < v2Parts[i]) return -1;
    }
    return 0;
  }
}

/**
 * 插件类型定义
 */
const PluginTypes = {
  // 插件状态
  Status: {
    UNLOADED: 'unloaded',
    LOADED: 'loaded',
    ENABLED: 'enabled',
    DISABLED: 'disabled',
    ERROR: 'error'
  },

  // 插件类型
  Category: {
    UTILITY: 'utility',
    ENTERTAINMENT: 'entertainment',
    ADMIN: 'admin',
    INTEGRATION: 'integration',
    OTHER: 'other'
  },

  // 事件类型
  Events: {
    MESSAGE: 'message',
    GROUP_MESSAGE: 'group_message',
    PRIVATE_MESSAGE: 'private_message',
    GROUP_JOIN: 'group_join',
    GROUP_LEAVE: 'group_leave',
    FRIEND_ADD: 'friend_add',
    FRIEND_DELETE: 'friend_delete'
  }
};

export class PluginManager extends EventEmitter {
  constructor(mainServer) {
    super();
    this.mainServer = mainServer;
    this.context = new PluginContext(mainServer);
    this.plugins = new Map(); // 已加载的插件实例
    this.pluginInfos = new Map(); // 插件信息
    this.pluginConfigs = new Map(); // 插件配置
    this.pluginDependencies = new Map(); // 依赖关系
    this.moduleCache = new Map(); // 模块缓存
    
    // 插件目录 - 使用相对于模块的路径（确保从任何目录启动都正确）
    this.pluginDir = path.join(__dirname, '../../plugins');
    this.dataDir = path.join(__dirname, '../../data/plugins');
    
    // 确保目录存在
    this.ensureDirectories();
    
    // 监听文件系统变化（用于热重载）
    this.setupFileWatcher();
    
    logger.plugin('插件管理器', '已初始化', { 
      pluginDir: this.pluginDir, 
      dataDir: this.dataDir 
    });
  }

  /**
   * 确保必要的目录存在
   */
  ensureDirectories() {
    [this.pluginDir, this.dataDir].forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`📁 创建目录: ${dir}`);
      }
    });
  }

  /**
   * 设置文件监听（用于热重载）
   */
  setupFileWatcher() {
    if (fs.existsSync(this.pluginDir)) {
      fs.watch(this.pluginDir, { recursive: true }, (eventType, filename) => {
        if (filename && (filename.endsWith('.js') || filename.endsWith('plugin.json'))) {
          const pluginId = this.getPluginIdFromPath(filename);
          if (pluginId && this.plugins.has(pluginId)) {
            console.log(`🔄 检测到插件文件变化: ${filename}`);
            this.scheduleHotReload(pluginId);
          }
        }
      });
      logger.info('插件系统', '已启用热重载监听');
    }
  }

  /**
   * 从文件路径获取插件ID
   */
  getPluginIdFromPath(filePath) {
    const parts = filePath.split(path.sep);
    return parts[0]; // 假设插件都在独立的文件夹中
  }

  /**
   * 调度热重载（防抖处理）
   */
  scheduleHotReload(pluginId) {
    if (this.reloadTimeouts) {
      clearTimeout(this.reloadTimeouts.get(pluginId));
    } else {
      this.reloadTimeouts = new Map();
    }

    this.reloadTimeouts.set(pluginId, setTimeout(async () => {
      try {
        console.log(`🔄 热重载插件: ${pluginId}`);
        await this.reloadPlugin(pluginId);
        this.emit('pluginReloaded', pluginId);
      } catch (error) {
        console.error(`❌ 热重载插件失败 ${pluginId}:`, error);
        this.emit('pluginError', pluginId, error);
      }
    }, 1000)); // 1秒防抖
  }

  /**
   * 扫描插件目录
   */
  async scanPlugins() {
    const plugins = [];

    if (!fs.existsSync(this.pluginDir)) {
      console.log('📁 插件目录不存在');
      return plugins;
    }

    const items = fs.readdirSync(this.pluginDir);
    
    for (const item of items) {
      const itemPath = path.join(this.pluginDir, item);
      const stat = fs.statSync(itemPath);
      
      if (stat.isDirectory()) {
        const pluginJsonPath = path.join(itemPath, 'plugin.json');
        
        if (fs.existsSync(pluginJsonPath)) {
          try {
            const pluginInfo = JSON.parse(fs.readFileSync(pluginJsonPath, 'utf8'));
            PluginUtils.validatePluginInfo(pluginInfo);
            
            pluginInfo.path = itemPath;
            pluginInfo.enabled = this.getPluginConfig(pluginInfo.id, 'enabled', false);
            
            plugins.push(pluginInfo);
            this.pluginInfos.set(pluginInfo.id, pluginInfo);
            
            // 只显示启用的插件
            if (pluginInfo.enabled) {
              logger.plugin('发现插件', `${pluginInfo.name} (${pluginInfo.version})`);
            }
          } catch (error) {
            console.error(`❌ 解析插件失败 ${item}:`, error.message);
          }
        }
      }
    }

    const enabledCount = plugins.filter(p => p.enabled).length;
    logger.success('插件扫描', `发现 ${plugins.length} 个 (${enabledCount} 个已启用)`);
    return plugins;
  }

  /**
   * 加载插件
   */
  async loadPlugin(pluginId) {
    try {
      const pluginInfo = this.pluginInfos.get(pluginId);
      if (!pluginInfo) {
        throw new Error(`插件信息不存在: ${pluginId}`);
      }

      if (this.plugins.has(pluginId)) {
        console.log(`⚠️ 插件已加载: ${pluginId}`);
        return this.plugins.get(pluginId);
      }

      const langIcon = pluginInfo.language === 'python' ? '🐍' : '📦';
      logger.plugin('插件加载', `${langIcon} ${pluginInfo.name}`);

      // 检查依赖
      await this.checkDependencies(pluginInfo);

      let pluginInstance;

      // 检查插件语言类型
      if (pluginInfo.language === 'python') {
        // 加载Python插件
        pluginInstance = new PythonPluginAdapter(pluginInfo, this.context);
        await pluginInstance.start();
      } else {
        // 加载JavaScript插件（原有逻辑）
        const mainFile = path.join(pluginInfo.path, pluginInfo.main || 'index.js');
        if (process.env.LOG_LEVEL === 'debug') {
          logger.debug('插件路径', mainFile);
        }
        
        if (!fs.existsSync(mainFile)) {
          throw new Error(`插件主文件不存在: ${pluginInfo.main}`);
        }

        // 清理模块缓存（用于热重载）
        // 确保使用正确的文件URL格式
        const absolutePath = path.resolve(mainFile);
        const moduleUrl = `file://${absolutePath.replace(/\\/g, '/')}?t=${Date.now()}`;
        if (process.env.LOG_LEVEL === 'debug') {
          logger.debug('插件导入', moduleUrl);
        }
        
        const module = await import(moduleUrl);
        
        if (!module.default) {
          throw new Error('插件必须导出默认类');
        }

        // 实例化插件
        const PluginClass = module.default;
        pluginInstance = new PluginClass(pluginInfo, this.context);

        // 验证插件实例 - 只支持 EnhancedPluginBase
        const isValidPlugin = pluginInstance instanceof EnhancedPluginBase;
        
        if (!isValidPlugin) {
          throw new Error('插件必须继承自 EnhancedPluginBase');
        }
        
        // 调用插件加载钩子
        await pluginInstance.onLoad();
      }

      // 注册插件
      this.plugins.set(pluginId, pluginInstance);
      this.updatePluginStatus(pluginId, PluginTypes.Status.LOADED);

      // 移除中间状态日志，由initialize统一显示
      this.emit('pluginLoaded', pluginId);

      return pluginInstance;
    } catch (error) {
      console.error(`❌ 插件加载失败 ${pluginId}:`, error);
      this.updatePluginStatus(pluginId, PluginTypes.Status.ERROR, error.message);
      this.emit('pluginError', pluginId, error);
      throw error;
    }
  }

  /**
   * 启用插件
   */
  async enablePlugin(pluginId) {
    try {
      let plugin = this.plugins.get(pluginId);
      
      // 如果插件未加载，先加载
      if (!plugin) {
        plugin = await this.loadPlugin(pluginId);
      }

      if (plugin.isEnabled) {
        console.log(`⚠️ 插件已启用: ${pluginId}`);
        return;
      }

      // 调用插件启用钩子
      await plugin.onEnable();

      // 更新状态
      this.updatePluginStatus(pluginId, PluginTypes.Status.ENABLED);
      this.setPluginConfig(pluginId, 'enabled', true);

      logger.success('插件启用', plugin.info.name);
      
      // 移除中间状态日志，由initialize统一显示
      this.emit('pluginEnabled', pluginId);
    } catch (error) {
      console.error(`❌ 插件启用失败 ${pluginId}:`, error);
      this.updatePluginStatus(pluginId, PluginTypes.Status.ERROR, error.message);
      this.emit('pluginError', pluginId, error);
      throw error;
    }
  }

  /**
   * 禁用插件
   * @param {boolean} silent - 是否静默禁用（用于关闭流程）
   */
  async disablePlugin(pluginId, silent = false) {
    try {
      const plugin = this.plugins.get(pluginId);
      if (!plugin) {
        throw new Error(`插件未加载: ${pluginId}`);
      }

      if (!plugin.isEnabled) {
        return;
      }

      // 调用插件禁用钩子
      await plugin.onDisable();

      // 更新状态
      this.updatePluginStatus(pluginId, PluginTypes.Status.DISABLED);
      this.setPluginConfig(pluginId, 'enabled', false);

      if (!silent) {
        logger.success('插件禁用', plugin.info.name);
      }
      this.emit('pluginDisabled', pluginId);
    } catch (error) {
      logger.error('插件禁用', `${pluginId}: ${error.message}`);
      this.emit('pluginError', pluginId, error);
      throw error;
    }
  }

  /**
   * 卸载插件
   * @param {boolean} silent - 是否静默卸载（不输出日志）
   */
  async unloadPlugin(pluginId, silent = false) {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      return;
    }

    try {
      // 先禁用插件（静默）
      if (plugin.isEnabled) {
        await this.disablePlugin(pluginId, true); // 传入silent标志
      }

      // 调用插件卸载钩子
      await plugin.onUnload();

      if (!silent) {
        logger.success('插件卸载', plugin.info.name);
      }
    } catch (error) {
      // 即使卸载失败也要清理资源，且只在非静默模式输出错误
      if (!silent) {
        logger.error('插件卸载', `${pluginId}: ${error.message}`);
      }
    } finally {
      // 确保资源被清理（即使出错也执行）
      this.plugins.delete(pluginId);
      this.updatePluginStatus(pluginId, PluginTypes.Status.UNLOADED);
      this.emit('pluginUnloaded', pluginId);
    }
  }

  /**
   * 重载插件（热重载）
   */
  async reloadPlugin(pluginId) {
    console.log(`🔄 重载插件: ${pluginId}`);
    
    const wasEnabled = this.plugins.get(pluginId)?.isEnabled || false;
    
    // 卸载插件
    await this.unloadPlugin(pluginId);
    
    // 重新加载插件
    await this.loadPlugin(pluginId);
    
    // 如果之前是启用状态，重新启用
    if (wasEnabled) {
      await this.enablePlugin(pluginId);
    }
    
    console.log(`✅ 插件重载完成: ${pluginId}`);
  }

  /**
   * 删除插件（从文件系统中删除）
   */
  async removePlugin(pluginId) {
    try {
      console.log(`🗑️ 删除插件: ${pluginId}`);
      
      // 先卸载插件
      await this.unloadPlugin(pluginId);
      
      // 删除插件目录
      const pluginPath = path.join(this.pluginDir, pluginId);
      if (fs.existsSync(pluginPath)) {
        // 递归删除目录
        fs.rmSync(pluginPath, { recursive: true, force: true });
        console.log(`✅ 插件目录已删除: ${pluginPath}`);
      }
      
      // 删除插件数据目录
      const dataPath = path.join(this.dataDir, pluginId);
      if (fs.existsSync(dataPath)) {
        fs.rmSync(dataPath, { recursive: true, force: true });
        console.log(`✅ 插件数据已删除: ${dataPath}`);
      }
      
      // 从插件信息中移除
      this.pluginInfos.delete(pluginId);
      this.pluginConfigs.delete(pluginId);
      
      console.log(`✅ 插件删除完成: ${pluginId}`);
      this.emit('pluginRemoved', pluginId);
    } catch (error) {
      console.error(`❌ 插件删除失败 ${pluginId}:`, error);
      this.emit('pluginError', pluginId, error);
      throw error;
    }
  }

  /**
   * 检查插件依赖
   */
  async checkDependencies(pluginInfo) {
    const dependencies = PluginUtils.parseDependencies(pluginInfo.dependencies);
    
    for (const dep of dependencies) {
      const depInfo = this.pluginInfos.get(dep.id);
      
      if (!depInfo) {
        throw new Error(`缺少依赖插件: ${dep.id}`);
      }
      
      if (dep.version !== '*') {
        const comparison = PluginUtils.compareVersions(depInfo.version, dep.version);
        if (comparison < 0) {
          throw new Error(`依赖插件版本过低: ${dep.id} 需要 ${dep.version}，当前 ${depInfo.version}`);
        }
      }
      
      // 确保依赖插件已加载和启用
      if (!this.plugins.has(dep.id)) {
        console.log(`🔗 自动加载依赖插件: ${dep.id}`);
        await this.loadPlugin(dep.id);
      }
      
      if (!this.plugins.get(dep.id).isEnabled) {
        console.log(`🔗 自动启用依赖插件: ${dep.id}`);
        await this.enablePlugin(dep.id);
      }
    }
  }

  /**
   * 获取插件列表
   */
  getPluginList() {
    const plugins = [];
    
    for (const [id, info] of this.pluginInfos) {
      const plugin = this.plugins.get(id);
      plugins.push({
        ...info,
        status: plugin ? (plugin.isEnabled ? PluginTypes.Status.ENABLED : PluginTypes.Status.LOADED) : PluginTypes.Status.UNLOADED,
        loaded: !!plugin,
        enabled: plugin?.isEnabled || false
      });
    }
    
    return plugins;
  }

  /**
   * 获取插件信息
   */
  getPluginInfo(pluginId) {
    const info = this.pluginInfos.get(pluginId);
    const plugin = this.plugins.get(pluginId);
    
    if (!info) return null;
    
    return {
      ...info,
      status: plugin ? (plugin.isEnabled ? PluginTypes.Status.ENABLED : PluginTypes.Status.LOADED) : PluginTypes.Status.UNLOADED,
      loaded: !!plugin,
      enabled: plugin?.isEnabled || false,
      config: this.getPluginAllConfig(pluginId)
    };
  }

  /**
   * 获取插件详细信息
   */
  getPluginDetailedInfo(pluginId) {
    const basicInfo = this.getPluginInfo(pluginId);
    const plugin = this.plugins.get(pluginId);
    
    if (!basicInfo || !plugin) return basicInfo;
    
    // 获取插件的详细信息
    const detailedInfo = plugin.getDetailedInfo();
    
    return {
      ...basicInfo,
      details: detailedInfo
    };
  }

  /**
   * 获取所有插件的性能数据
   */
  getAllPluginsPerformance() {
    const performanceData = [];
    
    for (const [id, plugin] of this.plugins) {
      const info = this.pluginInfos.get(id);
      if (!info) continue;
      
      const detailedInfo = plugin.getDetailedInfo();
      
      performanceData.push({
        pluginId: id,
        pluginName: info.name,
        language: info.language || 'javascript',
        isEnabled: plugin.isEnabled,
        statistics: detailedInfo.statistics,
        performance: detailedInfo.performance || {},
        errors: detailedInfo.errors || [],
        processMonitor: detailedInfo.processMonitor || null,
        threadSafety: detailedInfo.threadSafety || null,
        asyncSafety: detailedInfo.asyncSafety || null,
        lastActivity: detailedInfo.status.lastActivity
      });
    }
    
    return performanceData;
  }

  /**
   * 获取单个插件的性能数据
   */
  getPluginPerformance(pluginId) {
    const plugin = this.plugins.get(pluginId);
    const info = this.pluginInfos.get(pluginId);
    
    if (!plugin || !info) return null;
    
    const detailedInfo = plugin.getDetailedInfo();
    
    return {
      pluginId,
      pluginName: info.name,
      language: info.language || 'javascript',
      isEnabled: plugin.isEnabled,
      statistics: detailedInfo.statistics,
      performance: detailedInfo.performance || {},
      errors: detailedInfo.errors || [],
      processMonitor: detailedInfo.processMonitor || null,
      threadSafety: detailedInfo.threadSafety || null,
      asyncSafety: detailedInfo.asyncSafety || null,
      status: detailedInfo.status,
      commands: detailedInfo.commands,
      tasks: detailedInfo.tasks
    };
  }

  /**
   * 清理所有插件的性能数据
   */
  clearAllPluginsPerformance() {
    let clearedCount = 0;
    
    for (const [id, plugin] of this.plugins) {
      try {
        // 如果插件有 stats 属性（PluginStatistics 实例），调用 reset 方法
        if (plugin.stats && typeof plugin.stats.reset === 'function') {
          plugin.stats.reset();
          clearedCount++;
        }
      } catch (error) {
        console.error(`❌ 清理插件 ${id} 性能数据失败:`, error);
      }
    }
    
    console.log(`🧹 已清理 ${clearedCount} 个插件的性能数据`);
    
    return {
      success: true,
      message: `已清理 ${clearedCount} 个插件的性能数据`,
      clearedCount
    };
  }

  /**
   * 清理单个插件的性能数据
   */
  clearPluginPerformance(pluginId) {
    const plugin = this.plugins.get(pluginId);
    
    if (!plugin) {
      return {
        success: false,
        message: '插件不存在'
      };
    }
    
    try {
      if (plugin.stats && typeof plugin.stats.reset === 'function') {
        plugin.stats.reset();
        console.log(`🧹 已清理插件 ${pluginId} 的性能数据`);
        return {
          success: true,
          message: '插件性能数据已清理'
        };
      } else {
        return {
          success: false,
          message: '插件不支持性能数据清理'
        };
      }
    } catch (error) {
      console.error(`❌ 清理插件 ${pluginId} 性能数据失败:`, error);
      return {
        success: false,
        message: `清理失败: ${error.message}`
      };
    }
  }

  /**
   * 更新插件状态
   */
  updatePluginStatus(pluginId, status, error = null) {
    const info = this.pluginInfos.get(pluginId);
    if (info) {
      info.status = status;
      info.lastError = error;
      info.lastUpdate = new Date().toISOString();
    }
  }

  /**
   * 获取插件配置
   */
  getPluginConfig(pluginId, key, defaultValue = null) {
    const config = this.pluginConfigs.get(pluginId) || {};
    return config[key] !== undefined ? config[key] : defaultValue;
  }

  /**
   * 设置插件配置
   */
  setPluginConfig(pluginId, key, value) {
    if (!this.pluginConfigs.has(pluginId)) {
      this.pluginConfigs.set(pluginId, {});
    }
    this.pluginConfigs.get(pluginId)[key] = value;
    this.savePluginConfigs();
  }

  /**
   * 获取插件所有配置
   */
  getPluginAllConfig(pluginId) {
    return this.pluginConfigs.get(pluginId) || {};
  }

  /**
   * 保存插件配置
   */
  savePluginConfigs() {
    try {
      const configPath = path.join(this.dataDir, 'plugin-configs.json');
      const configs = {};
      
      for (const [pluginId, config] of this.pluginConfigs) {
        configs[pluginId] = config;
      }
      
      fs.writeFileSync(configPath, JSON.stringify(configs, null, 2));
    } catch (error) {
      console.error('❌ 保存插件配置失败:', error);
    }
  }

  /**
   * 加载插件配置
   */
  loadPluginConfigs() {
    try {
      const configPath = path.join(this.dataDir, 'plugin-configs.json');
      
      if (fs.existsSync(configPath)) {
        const configs = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        
        for (const [pluginId, config] of Object.entries(configs)) {
          this.pluginConfigs.set(pluginId, config);
        }
      }
    } catch (error) {
      console.error('❌ 加载插件配置失败:', error);
    }
  }

  /**
   * 初始化插件系统
   */
  async initialize() {
    logger.startup('插件系统', '正在扫描...');
    
    // 加载配置
    this.loadPluginConfigs();
    
    // 扫描插件
    const plugins = await this.scanPlugins();
    
    // 自动加载和启用已启用的插件
    const enabledPlugins = plugins.filter(p => p.enabled);
    if (enabledPlugins.length > 0) {
      logger.startup('插件系统', '正在加载...');
      for (const pluginInfo of enabledPlugins) {
        try {
          await this.loadPlugin(pluginInfo.id);
          await this.enablePlugin(pluginInfo.id);
        } catch (error) {
          logger.error('插件启用', `${pluginInfo.name} - ${error.message}`);
          if (process.env.LOG_LEVEL === 'debug') {
            console.error('   堆栈:', error.stack);
          }
        }
      }
    }
    
    const enabledCount = Array.from(this.plugins.values()).filter(p => p.isEnabled).length;
    const disabledCount = this.pluginInfos.size - enabledCount;
    
    logger.success('插件系统', `总计 ${this.pluginInfos.size} 个 | 已启用 ${enabledCount} | 未启用 ${disabledCount}`);
  }

  /**
   * 关闭插件系统
   */
  async shutdown() {
    const pluginCount = this.plugins.size;
    if (pluginCount === 0) {
      return;
    }
    
    // 并发卸载所有插件，但有超时保护
    const unloadPromises = Array.from(this.plugins.keys()).map(async (pluginId) => {
      try {
        // 为每个插件设置独立的超时（2秒足够）
        await Promise.race([
          this.unloadPlugin(pluginId, true), // 静默卸载
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('卸载超时')), 2000)
          )
        ]);
      } catch (error) {
        // 静默处理所有错误（包括超时）
      }
    });
    
    // 等待所有插件卸载完成或超时
    await Promise.allSettled(unloadPromises);
    
    // 保存配置
    this.savePluginConfigs();
    
    logger.success('插件系统', '已关闭');
  }
}

// 导出工具类和类型定义
export { PluginUtils, PluginTypes };

export default PluginManager;