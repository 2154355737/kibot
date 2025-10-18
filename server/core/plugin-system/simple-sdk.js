/**
 * KiBot 超简化插件SDK
 * 为初学者提供最简单的API
 * 
 * @module simple-sdk
 * @version 3.0.0
 * @author KiBot Team
 */

import { EnhancedPluginBase } from './plugin-sdk-enhanced.js';

/**
 * 简化的插件创建函数
 * @param {Object} options 插件配置
 * @returns {Class} 插件类
 */
export function createSimplePlugin(options = {}) {
  const {
    // 基本信息
    name = 'SimplePlugin',
    description = '',
    version = '1.0.0',
    author = '',
    
    // 生命周期
    onLoad,
    onEnable,
    onDisable,
    onUnload,
    
    // 指令处理
    commands = {},
    
    // 事件处理
    events = {},
    
    // 定时任务
    tasks = {},
    
    // 自定义方法
    methods = {}
  } = options;

  // 动态创建插件类
  class SimplePlugin extends EnhancedPluginBase {
    constructor(pluginInfo, context) {
      super(pluginInfo, context);
      
      // 注入自定义方法
      for (const [methodName, methodFn] of Object.entries(methods)) {
        this[methodName] = methodFn.bind(this);
      }
    }

    async onLoad() {
      await super.onLoad();
      
      // 注册所有指令
      for (const [cmd, handler] of Object.entries(commands)) {
        this.registerCommand(cmd, handler);
      }
      
      // 注册所有事件
      for (const [event, handler] of Object.entries(events)) {
        this.registerEvent(event, handler);
      }
      
      // 注册所有定时任务
      for (const [taskName, taskConfig] of Object.entries(tasks)) {
        this.registerTask(taskName, taskConfig);
      }
      
      // 调用自定义onLoad
      if (onLoad) {
        await onLoad.call(this);
      }
    }

    async onEnable() {
      await super.onEnable();
      if (onEnable) {
        await onEnable.call(this);
      }
    }

    async onDisable() {
      await super.onDisable();
      if (onDisable) {
        await onDisable.call(this);
      }
    }

    async onUnload() {
      await super.onUnload();
      if (onUnload) {
        await onUnload.call(this);
      }
    }

    // 简化的指令注册
    registerCommand(cmd, handler) {
      const wrappedHandler = async (context, args) => {
        try {
          const result = await handler.call(this, context, args);
          if (result) {
            await this.sendMessage(
              context.user_id,
              result,
              context.message_type || 'private'
            );
          }
        } catch (error) {
          this.logger.error(`指令 ${cmd} 执行失败`, { error: error.message });
          await this.sendMessage(
            context.user_id,
            `❌ 指令执行失败: ${error.message}`,
            context.message_type || 'private'
          );
        }
      };
      
      // 使用现有的command注册机制
      if (this.context.commandRegistry) {
        this.context.commandRegistry.register({
          plugin: this.info.id,
          command: cmd,
          handler: wrappedHandler,
          description: handler.description || '',
          usage: handler.usage || `/${cmd}`
        });
      }
    }

    // 简化的事件注册
    registerEvent(eventType, handler) {
      const wrappedHandler = async (event) => {
        try {
          await handler.call(this, event);
        } catch (error) {
          this.logger.error(`事件 ${eventType} 处理失败`, { error: error.message });
        }
      };
      
      this.onEvent(eventType).handle(wrappedHandler);
    }

    // 简化的任务注册
    registerTask(taskName, config) {
      const { cron, handler } = config;
      
      if (!cron || !handler) {
        this.logger.warn(`任务 ${taskName} 配置不完整`);
        return;
      }
      
      const wrappedHandler = async () => {
        try {
          await handler.call(this);
        } catch (error) {
          this.logger.error(`任务 ${taskName} 执行失败`, { error: error.message });
        }
      };
      
      // 使用现有的scheduler机制
      if (this.context.scheduler) {
        this.context.scheduler.create(
          `${this.info.id}.${taskName}`,
          cron,
          wrappedHandler
        );
      }
    }
  }

  return SimplePlugin;
}

/**
 * 快捷创建指令处理器
 */
export function command(name, options, handler) {
  if (typeof options === 'function') {
    handler = options;
    options = {};
  }
  
  handler.description = options.description || '';
  handler.usage = options.usage || `/${name}`;
  handler.aliases = options.aliases || [];
  handler.cooldown = options.cooldown || 0;
  handler.adminOnly = options.adminOnly || false;
  
  return { [name]: handler };
}

/**
 * 快捷创建事件处理器
 */
export function event(name, handler) {
  return { [name]: handler };
}

/**
 * 快捷创建定时任务
 */
export function task(name, cron, handler) {
  return { [name]: { cron, handler } };
}

/**
 * 一行代码创建简单插件
 */
export function oneLinePlugin(name, commands) {
  return createSimplePlugin({
    name,
    commands: typeof commands === 'object' ? commands : { default: commands }
  });
}

/**
 * 示例: 超简单的使用方式
 * 
 * ```javascript
 * import { createSimplePlugin, command, event, task } from '@kibot/simple-sdk';
 * 
 * export default createSimplePlugin({
 *   name: '我的插件',
 *   description: '这是一个简单插件',
 *   version: '1.0.0',
 *   author: '开发者',
 *   
 *   // 定义指令
 *   commands: {
 *     ...command('hello', async function(ctx, args) {
 *       const name = args[0] || '朋友';
 *       return `你好，${name}！`;
 *     }),
 *     
 *     ...command('stats', { description: '查看统计' }, async function(ctx) {
 *       const stats = this.storage.get('stats', { count: 0 });
 *       return `当前计数: ${stats.count}`;
 *     })
 *   },
 *   
 *   // 定义事件
 *   events: {
 *     ...event('message', async function(evt) {
 *       const stats = this.storage.get('stats', { count: 0 });
 *       stats.count++;
 *       this.storage.set('stats', stats);
 *     })
 *   },
 *   
 *   // 定义定时任务
 *   tasks: {
 *     ...task('daily-report', '0 0 9 * * *', async function() {
 *       this.logger.info('执行每日报告');
 *     })
 *   },
 *   
 *   // 自定义方法
 *   methods: {
 *     async myCustomMethod() {
 *       // 自定义逻辑
 *     }
 *   }
 * });
 * ```
 */

