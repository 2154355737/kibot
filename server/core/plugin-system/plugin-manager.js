/**
 * KiBot 插件管理器
 * 负责插件的生命周期管理、热重载、依赖管理等
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { EventEmitter } from 'events';
import { PluginBase, PluginUtils, PluginContext, PluginTypes } from './plugin-sdk.js';
import { EnhancedPluginBase } from './plugin-sdk-enhanced.js';
import { logger } from '../../utils/output-manager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
      console.log('👀 已启用插件热重载监听');
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
    console.log('🔍 扫描插件目录...');
    const plugins = [];

    if (!fs.existsSync(this.pluginDir)) {
      console.log('📁 插件目录不存在，跳过扫描');
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
            
            console.log(`📦 发现插件: ${pluginInfo.name} (${pluginInfo.version})`);
          } catch (error) {
            console.error(`❌ 解析插件信息失败 ${item}:`, error.message);
          }
        }
      }
    }

    console.log(`✅ 扫描完成，发现 ${plugins.length} 个插件`);
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

      console.log(`🔄 加载插件: ${pluginInfo.name}`);
      console.log(`📁 插件路径: ${pluginInfo.path}`);
      console.log(`📄 插件主文件: ${pluginInfo.main || 'index.js'}`);

      // 检查依赖
      await this.checkDependencies(pluginInfo);

      // 动态导入插件模块
      const mainFile = path.join(pluginInfo.path, pluginInfo.main || 'index.js');
      console.log(`🎯 完整主文件路径: ${mainFile}`);
      
      if (!fs.existsSync(mainFile)) {
        throw new Error(`插件主文件不存在: ${pluginInfo.main}`);
      }

      // 清理模块缓存（用于热重载）
      // 确保使用正确的文件URL格式
      const absolutePath = path.resolve(mainFile);
      const moduleUrl = `file://${absolutePath.replace(/\\/g, '/')}?t=${Date.now()}`;
      console.log(`🔗 尝试导入模块: ${moduleUrl}`);
      
      const module = await import(moduleUrl);
      
      if (!module.default) {
        throw new Error('插件必须导出默认类');
      }

      // 实例化插件
      const PluginClass = module.default;
      const pluginInstance = new PluginClass(pluginInfo, this.context);

      // 验证插件实例 - 支持 PluginBase 和 EnhancedPluginBase
      const isValidPlugin = pluginInstance instanceof PluginBase || 
                           pluginInstance instanceof EnhancedPluginBase;
      
      if (!isValidPlugin) {
        throw new Error('插件必须继承自 PluginBase 或 EnhancedPluginBase');
      }
      
      console.log(`✅ 插件类型验证通过: ${pluginInstance.constructor.name}`);

      // 调用插件加载钩子
      await pluginInstance.onLoad();

      // 注册插件
      this.plugins.set(pluginId, pluginInstance);
      this.updatePluginStatus(pluginId, PluginTypes.Status.LOADED);

      console.log(`✅ 插件加载成功: ${pluginInfo.name}`);
      console.log(`📊 当前已加载插件数量: ${this.plugins.size}`);
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

      console.log(`🚀 启用插件: ${plugin.info.name}`);

      // 调用插件启用钩子
      await plugin.onEnable();

      // 更新状态
      this.updatePluginStatus(pluginId, PluginTypes.Status.ENABLED);
      this.setPluginConfig(pluginId, 'enabled', true);

      console.log(`✅ 插件启用成功: ${plugin.info.name}`);
      console.log(`📊 当前已启用插件数量: ${Array.from(this.plugins.values()).filter(p => p.isEnabled).length}`);
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
   */
  async disablePlugin(pluginId) {
    try {
      const plugin = this.plugins.get(pluginId);
      if (!plugin) {
        throw new Error(`插件未加载: ${pluginId}`);
      }

      if (!plugin.isEnabled) {
        console.log(`⚠️ 插件已禁用: ${pluginId}`);
        return;
      }

      console.log(`⏸️ 禁用插件: ${plugin.info.name}`);

      // 调用插件禁用钩子
      await plugin.onDisable();

      // 更新状态
      this.updatePluginStatus(pluginId, PluginTypes.Status.DISABLED);
      this.setPluginConfig(pluginId, 'enabled', false);

      console.log(`✅ 插件禁用成功: ${plugin.info.name}`);
      this.emit('pluginDisabled', pluginId);
    } catch (error) {
      console.error(`❌ 插件禁用失败 ${pluginId}:`, error);
      this.emit('pluginError', pluginId, error);
      throw error;
    }
  }

  /**
   * 卸载插件
   */
  async unloadPlugin(pluginId) {
    try {
      const plugin = this.plugins.get(pluginId);
      if (!plugin) {
        console.log(`⚠️ 插件未加载: ${pluginId}`);
        return;
      }

      console.log(`📤 卸载插件: ${plugin.info.name}`);

      // 先禁用插件
      if (plugin.isEnabled) {
        await this.disablePlugin(pluginId);
      }

      // 调用插件卸载钩子
      await plugin.onUnload();

      // 清理资源
      this.plugins.delete(pluginId);
      this.updatePluginStatus(pluginId, PluginTypes.Status.UNLOADED);

      console.log(`✅ 插件卸载成功: ${plugin.info.name}`);
      this.emit('pluginUnloaded', pluginId);
    } catch (error) {
      console.error(`❌ 插件卸载失败 ${pluginId}:`, error);
      this.emit('pluginError', pluginId, error);
      throw error;
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
        
        console.log('✅ 插件配置加载完成');
      }
    } catch (error) {
      console.error('❌ 加载插件配置失败:', error);
    }
  }

  /**
   * 初始化插件系统
   */
  async initialize() {
    console.log('🚀 初始化插件系统...');
    
    // 加载配置
    this.loadPluginConfigs();
    
    // 扫描插件
    const plugins = await this.scanPlugins();
    
    // 自动加载和启用已启用的插件
    for (const pluginInfo of plugins) {
      console.log(`🔍 检查插件: ${pluginInfo.id}, 启用状态: ${pluginInfo.enabled}`);
      if (pluginInfo.enabled) {
        try {
          console.log(`🔄 开始加载插件: ${pluginInfo.id}`);
          await this.loadPlugin(pluginInfo.id);
          console.log(`🔄 开始启用插件: ${pluginInfo.id}`);
          await this.enablePlugin(pluginInfo.id);
          console.log(`✅ 插件 ${pluginInfo.id} 加载并启用成功`);
        } catch (error) {
          console.error(`❌ 自动启用插件失败 ${pluginInfo.id}:`, error);
          console.error(`❌ 错误堆栈:`, error.stack);
        }
      }
    }
    
    console.log('✅ 插件系统初始化完成');
    console.log(`📊 最终状态 - 总插件数: ${this.pluginInfos.size}, 已加载: ${this.plugins.size}, 已启用: ${Array.from(this.plugins.values()).filter(p => p.isEnabled).length}`);
  }

  /**
   * 关闭插件系统
   */
  async shutdown() {
    console.log('⏹️ 关闭插件系统...');
    
    // 禁用所有插件
    for (const pluginId of this.plugins.keys()) {
      try {
        await this.unloadPlugin(pluginId);
      } catch (error) {
        console.error(`❌ 卸载插件失败 ${pluginId}:`, error);
      }
    }
    
    // 保存配置
    this.savePluginConfigs();
    
    console.log('✅ 插件系统已关闭');
  }
}

export default PluginManager;