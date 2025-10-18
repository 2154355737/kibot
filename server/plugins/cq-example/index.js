/**
 * CQ码处理示例插件
 * 演示如何处理各种CQ码消息段
 * 
 * @author KiBot Team
 * @version 1.0.0
 * @sdk Enhanced SDK v3.0
 */

import { EnhancedPluginBase } from '../../core/plugin-system/plugin-sdk-enhanced.js';

export default class CQExamplePlugin extends EnhancedPluginBase {
  constructor(pluginInfo, context) {
    super(pluginInfo, context);
  }

  async onLoad() {
    await super.onLoad();
    this.logger.info('CQ码处理示例插件加载中...');
    
    // 注册指令
    this.registerCommands();
    
    // 注册事件监听
    this.registerEvents();
    
    this.logger.info('CQ码处理示例插件加载完成');
  }
  
  /**
   * 注册指令
   */
  registerCommands() {
    // 发送图片指令
    this.registerCommand('/发图', async (event) => {
      const imageUrl = 'https://th.bing.com/th/id/R.987f582c510be58755c4933cda68d525?rik=C0D21hJDYvXosw&riu=http%3a%2f%2fimg.pconline.com.cn%2fimages%2fupload%2fupc%2ftx%2fwallpaper%2f1305%2f16%2fc4%2f20990657_1368686545122.jpg&ehk=netN2qzcCVS4ALUQfDOwxAwFcy41oxC%2b0xTFvOYy5ds%3d&risl=&pid=ImgRaw&r=0';
      const message = `看这张图片：${this.CQ.image(imageUrl)}`;
      await this.replyToEvent(event, message);
    });
    
    // 发送@指令
    this.registerCommand('/at测试', async (event) => {
      const message = `${this.CQ.at(event.user_id)} 你好！`;
      await this.replyToEvent(event, message);
    });
    
    // 发送表情指令
    this.registerCommand('/表情', async (event) => {
      const message = `来个表情 ${this.CQ.face(178)} 怎么样？`;
      await this.replyToEvent(event, message);
    });
    
    // 回复消息指令
    this.registerCommand('/回复我', async (event) => {
      const message = `${this.CQ.reply(event.message_id)} 我回复你了！`;
      await this.replyToEvent(event, message);
    });
    
    // 混合消息指令
    this.registerCommand('/混合', async (event) => {
      const message = `${this.CQ.at(event.user_id)} 看这个 ${this.CQ.face(178)} ${this.CQ.image('https://example.com/image.jpg')}`;
      await this.replyToEvent(event, message);
    });
    
    // 错误测试指令
    this.registerCommand('/测试错误', async (event) => {
      // 故意抛出一个错误来测试错误记录功能
      throw new Error('这是一个测试错误，用于验证错误记录功能是否正常工作');
    });
    
    // 错误统计查看指令
    this.registerCommand('/错误统计', async (event) => {
      const errorCount = this.errors.length;
      const totalErrors = this.statistics.errorsOccurred;
      
      let message = `📊 插件错误统计\n\n`;
      message += `总错误数: ${totalErrors}\n`;
      message += `记录的错误: ${errorCount}\n`;
      message += `指令执行: ${this.statistics.commandExecutions}\n`;
      message += `事件处理: ${this.statistics.eventHandled}\n\n`;
      
      if (errorCount > 0) {
        message += `最近的错误:\n`;
        const recentErrors = this.errors.slice(-3);
        recentErrors.forEach((err, idx) => {
          message += `${idx + 1}. [${err.type}] ${err.source}: ${err.message}\n`;
        });
      } else {
        message += `✅ 暂无错误记录`;
      }
      
      await this.replyToEvent(event, message, false);
    });
    
    this.logger.info('已注册 7 个CQ码示例指令（包括测试指令）');
  }
  
  /**
   * 注册事件监听
   */
  registerEvents() {
    // 监听包含图片的消息
    this.onEvent('message')
      .filter(event => {
        // 使用SDK提供的hasImage方法
        return this.hasImage(event.raw_message);
      })
      .handle(async (event) => {
        // 提取所有图片
        const images = this.extractImages(event.raw_message);
        
        this.logger.info(`收到图片消息，包含 ${images.length} 张图片`);
        
        // 输出图片信息
        images.forEach((img, index) => {
          this.logger.info(`图片 ${index + 1}:`, {
            file: img.data.file,
            url: img.data.url,
            subType: img.data.subType
          });
        });
        
        // 回复确认
        const imageCount = images.length;
        const message = `收到你的 ${imageCount} 张图片了！`;
        await this.replyToEvent(event, message);
      });
    
    // 监听@机器人的消息
    this.onEvent('message')
      .filter(event => event.message_type === 'group')
      .filter(event => {
        // 检查是否@了机器人（需要从context获取机器人QQ号）
        const botQQ = this.context.mainServer?.loginInfo?.user_id;
        if (!botQQ) return false;
        
        return this.isAtMe(event.raw_message, botQQ);
      })
      .handle(async (event) => {
        // 提取纯文本（去除CQ码）
        const text = this.extractText(event.raw_message);
        
        this.logger.info(`被@了，消息内容: ${text}`);
        
        // 回复
        const message = `${this.CQ.at(event.user_id)} 你叫我吗？你说："${text}"`;
        await this.replyToEvent(event, message);
      });
    
    // 监听所有消息并解析
    this.onEvent('message')
      .handle(async (event) => {
        // 解析消息段
        const segments = this.parseEventMessage(event);
        
        if (segments.length > 1) {
          // 只有包含多个消息段时才处理
          this.logger.debug(`消息包含 ${segments.length} 个消息段:`, 
            segments.map(s => s.type).join(', ')
          );
          
          // 统计各类型消息段
          const types = {};
          segments.forEach(seg => {
            types[seg.type] = (types[seg.type] || 0) + 1;
          });
          
          // 如果包含特殊消息段，记录日志
          if (types.image || types.at || types.face) {
            this.logger.info('消息段统计:', types);
          }
        }
      });
    
    this.logger.info('已注册 3 个CQ码事件处理器');
  }
  
  /**
   * 回复事件消息
   * @param {Object} event - 事件对象
   * @param {string} message - 消息内容
   * @param {boolean} throwError - 是否抛出错误（默认true）
   */
  async replyToEvent(event, message, throwError = true) {
    try {
      if (event.message_type === 'group') {
        await this.callApi('send_group_msg', {
          group_id: event.group_id,
          message: message
        });
      } else {
        await this.callApi('send_private_msg', {
          user_id: event.user_id,
          message: message
        });
      }
    } catch (error) {
      this.logger.error('发送消息失败', error);
      // 记录错误到插件错误列表
      this.recordError('api', 'replyToEvent', error);
      
      if (throwError) {
        throw error; // 重新抛出错误，让调用者知道失败了
      }
    }
  }
  
  /**
   * 注册单个指令
   */
  registerCommand(command, handler) {
    const cmd = command.startsWith('/') ? command.substring(1) : command;
    
    // 包装handler，添加错误处理
    const wrappedHandler = async (event) => {
      try {
        await handler.call(this, event);
      } catch (error) {
        // 记录错误到插件错误列表
        this.recordError('command', cmd, error);
        
        // 尝试通知用户（不抛出错误）
        const errorMsg = `⚠️ 执行指令 ${command} 时出错：${error.message}`;
        await this.replyToEvent(event, errorMsg, false);
      }
    };
    
    const commandInfo = {
      plugin: this.info.id,
      command: cmd,
      description: `CQ码示例: ${command}`,
      usage: command,
      type: 'custom',
      category: 'utility',
      executionCount: 0,
      registeredAt: Date.now(),
      handler: wrappedHandler
    };
    
    this.context.commandRegistry?.register(commandInfo);
    this.registeredCommands.set(cmd, commandInfo);
  }

  async onEnable() {
    await super.onEnable();
    this.logger.info('CQ码处理示例插件已启用');
  }

  async onDisable() {
    await super.onDisable();
    this.logger.info('CQ码处理示例插件已禁用');
  }

  async onUnload() {
    await super.onUnload();
    this.logger.info('CQ码处理示例插件已卸载');
  }
}

