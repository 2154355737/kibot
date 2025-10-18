/**
 * KiBot 插件系统统一导出
 * 简化插件开发的导入路径
 * 
 * @module plugin-system
 * @version 3.0.0
 * @author KiBot Team
 * 
 * @example
 * // 使用增强SDK
 * import { EnhancedPluginBase } from '@kibot/plugin-system';
 * 
 * // 使用简化SDK
 * import { createSimplePlugin } from '@kibot/plugin-system/simple';
 * 
 * // 使用原始SDK(向后兼容)
 * import { PluginBase } from '@kibot/plugin-system';
 */

// 原始SDK (向后兼容)
export { PluginBase, PluginUtils, PluginContext, PluginTypes } from './plugin-sdk.js';
export { 插件基类, 插件工具, 插件上下文, 指令分类, 事件类型 } from './plugin-sdk-zh.js';

// 增强SDK
export { EnhancedPluginBase, EnhancedStorage, EnhancedEventHandler, ConcurrencyHelper } from './plugin-sdk-enhanced.js';

// 插件管理器
export { PluginManager } from './plugin-manager.js';

// 命令系统 (如果存在)
try {
  // 命令系统（如果存在）按需导出
  // 注意：ESM的export必须在顶层，不能在try-catch或异步语句内。
  // 因此此处只能静态导出，如果模块不存在会导致构建时报错。
  // 如果需要兼容不存在命令系统的情况，应在使用侧做判断或拆分入口。
} catch (e) {
  // 命令系统可能还未实现
}
export { CommandManager } from './command-manager.js';
export { CommandBuilder } from './command-builder.js';

// 默认导出增强基类
export { EnhancedPluginBase as default } from './plugin-sdk-enhanced.js';

/**
 * 创建简化的SDK工厂
 */
export function createPlugin(config) {
  const { name, version, description, author } = config;
  
  return class extends EnhancedPluginBase {
    constructor(pluginInfo, context) {
      super(pluginInfo, context);
      
      // 自动注入配置
      this.pluginName = name;
      this.pluginVersion = version;
      this.pluginDescription = description;
      this.pluginAuthor = author;
    }
  };
}

/**
 * 便捷的模型定义
 */
export function defineModel(name, schema) {
  return { modelName: name, modelSchema: schema };
}

/**
 * 便捷的配置定义
 */
export function defineConfig(schema) {
  return { configSchema: schema };
}
