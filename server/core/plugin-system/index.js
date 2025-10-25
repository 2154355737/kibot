/**
 * KiBot 插件系统统一导出
 * 
 * @module plugin-system
 * @version 3.1.0
 * @author KiBot Team
 * 
 * 重大更新 v3.1：
 * - 统一统计数据管理模块
 * - 删除淘汰的 SDK 版本
 * - 仅保留 EnhancedPluginBase（推荐）
 * - 统一 JS 和 Python 插件的统计接口
 * 
 * @example
 * // 推荐使用增强SDK
 * import { EnhancedPluginBase } from '../../core/plugin-system/plugin-sdk-enhanced.js';
 * 
 * export default class MyPlugin extends EnhancedPluginBase {
 *   async onLoad() {
 *     this.registerCommand('test', async (event) => {
 *       await this.sendMessage(event.user_id, 'Hello!');
 *     });
 *   }
 * }
 */

// ==================== KiBot 插件系统 v3.1 ====================

// 增强SDK - 提供完整的性能监控和统计功能（唯一推荐）
export { 
  EnhancedPluginBase, 
  EnhancedStorage, 
  EnhancedEventHandler, 
  ConcurrencyHelper,
  PluginContext,
  CQParser,
  CQBuilder,
  MessageSegment
} from './plugin-sdk-enhanced.js';

// 统一的统计数据管理模块
export { 
  PluginStatistics, 
  StatisticsManager, 
  statisticsManager, 
  STORAGE_CONFIG, 
  DATA_VERSION 
} from './plugin-statistics.js';

// 插件管理器及工具类
export { 
  PluginManager, 
  PluginUtils, 
  PluginTypes 
} from './plugin-manager.js';

// Python 插件适配器
export { PythonPluginAdapter } from './python-plugin-adapter.js';

// 默认导出增强基类
export { EnhancedPluginBase as default } from './plugin-sdk-enhanced.js';
