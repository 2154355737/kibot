#!/usr/bin/env python3
"""
Python示例插件
演示KiBot Python插件的基本用法

@author KiBot Team
@version 1.0.0
"""

import sys
import os
import asyncio

# 添加SDK路径
sdk_path = os.path.join(os.path.dirname(__file__), '../../core/python-plugin-system')
sys.path.insert(0, sdk_path)

# 启动环境检查
from startup_check import check_and_start
if not check_and_start("Python示例插件", required_python="3.8"):
    sys.exit(1)

from plugin_base import PluginBase, run_plugin
from cq_parser import CQBuilder


class ExamplePythonPlugin(PluginBase):
    """Python示例插件类"""
    
    def __init__(self, plugin_info, context_config):
        super().__init__(plugin_info, context_config)
        self.message_count = 0
        self.greeting_count = 0
    
    async def on_load(self):
        """插件加载"""
        await super().on_load()
        
        # 加载统计数据
        self.message_count = await self.storage.get('message_count', 0)
        self.greeting_count = await self.storage.get('greeting_count', 0)
        
        self.logger.info(f"加载完成 (消息: {self.message_count}, 问候: {self.greeting_count})")
    
    async def on_enable(self):
        """插件启用"""
        await super().on_enable()
        
        # 注册指令
        await self.register_commands()
        
        # 注册事件
        await self.register_events()
        
        # 注册定时任务（可选）
        # await self.register_tasks()
        
        self.logger.info("已启用 (指令: 3, 事件: 2)")
    
    async def register_commands(self):
        """注册指令"""
        
        # 问候指令
        self.register_command('pyhello', self.handle_hello, 
            description='Python问候指令',
            usage='/pyhello [名字]'
        )
        
        # 统计指令
        self.register_command('pystats', self.handle_stats,
            description='查看插件统计',
            usage='/pystats'
        )
        
        # Echo指令
        self.register_command('pyecho', self.handle_echo,
            description='回显消息（支持CQ码）',
            usage='/pyecho <消息>'
        )
        
        self.logger.debug("已注册指令: pyhello, pystats, pyecho")
    
    async def register_events(self):
        """注册事件处理器"""
        
        # 监听所有消息
        self.register_event('message', self.handle_message)
        
        # 监听群成员增加
        self.register_event('group_increase', self.handle_group_join)
        
        self.logger.debug("已注册事件: message, group_increase")
    
    async def register_tasks(self):
        """注册定时任务"""
        
        # 每小时统计一次
        await self.schedule('hourly_stats', '0 0 * * * *', self.hourly_task)
        
        self.logger.debug("已注册定时任务: hourly_stats")
    
    # ==================== 指令处理器 ====================
    
    async def handle_hello(self, event, args):
        """处理问候指令"""
        name = args[0] if args else '朋友'
        
        # 构建带@的回复消息
        message = f"{CQBuilder.at(event['user_id'])} 你好，{name}！\n"
        message += f"这是来自Python插件的问候！🐍\n"
        message += f"我已经问候了 {self.greeting_count + 1} 次了！"
        
        # 发送消息
        msg_type = event.get('message_type', 'private')
        chat_id = event.get('group_id') if msg_type == 'group' else event.get('user_id')
        
        await self.send_message(chat_id, message, msg_type)
        
        # 更新统计
        self.greeting_count += 1
        await self.storage.set('greeting_count', self.greeting_count)
    
    async def handle_stats(self, event, args):
        """处理统计指令"""
        stats_msg = f"📊 Python插件统计信息\n\n"
        stats_msg += f"插件名称: {self.info['name']}\n"
        stats_msg += f"版本: {self.info['version']}\n"
        stats_msg += f"语言: Python 🐍\n"
        stats_msg += f"状态: {'✅ 运行中' if self.is_enabled else '❌ 已禁用'}\n\n"
        stats_msg += f"处理消息数: {self.message_count}\n"
        stats_msg += f"问候次数: {self.greeting_count}\n"
        stats_msg += f"指令执行次数: {self.statistics['command_executions']}\n"
        stats_msg += f"事件处理次数: {self.statistics['events_handled']}\n"
        
        msg_type = event.get('message_type', 'private')
        chat_id = event.get('group_id') if msg_type == 'group' else event.get('user_id')
        
        await self.send_message(chat_id, stats_msg, msg_type)
    
    async def handle_echo(self, event, args):
        """回显消息（演示CQ码处理）"""
        if not args:
            msg = "❌ 请提供要回显的内容！\n用法: /pyecho <消息>"
        else:
            original = ' '.join(args)
            msg = f"🔊 Echo from Python:\n{original}"
        
        msg_type = event.get('message_type', 'private')
        chat_id = event.get('group_id') if msg_type == 'group' else event.get('user_id')
        
        await self.send_message(chat_id, msg, msg_type)
    
    # ==================== 事件处理器 ====================
    
    async def handle_message(self, event):
        """处理所有消息事件"""
        # 统计消息
        self.message_count += 1
        
        # 每100条消息保存一次
        if self.message_count % 100 == 0:
            await self.storage.set('message_count', self.message_count)
            self.logger.info(f"消息统计: {self.message_count}")
        
        # 检测Python关键词
        raw_message = event.get('raw_message', '')
        if 'python' in raw_message.lower() or '🐍' in raw_message:
            # 可以在这里做一些自动回复
            pass
    
    async def handle_group_join(self, event):
        """处理群成员加入事件"""
        user_id = event.get('user_id')
        group_id = event.get('group_id')
        
        if user_id and group_id:
            welcome_msg = f"{CQBuilder.at(user_id)} 欢迎加入！\n"
            welcome_msg += "这是Python插件发送的欢迎消息 🐍"
            
            # 延迟2秒发送欢迎消息
            await asyncio.sleep(2)
            await self.send_group_msg(group_id, welcome_msg)
    
    # ==================== 定时任务 ====================
    
    async def hourly_task(self):
        """每小时执行的任务"""
        self.logger.info(f"每小时统计 - 消息: {self.message_count}, 问候: {self.greeting_count}")
        
        # 保存统计数据
        await self.storage.set('message_count', self.message_count)
        await self.storage.set('greeting_count', self.greeting_count)
    
    # ==================== 生命周期钩子 ====================
    
    async def on_disable(self):
        """插件禁用"""
        await super().on_disable()
        
        # 保存数据
        await self.storage.set('message_count', self.message_count)
        await self.storage.set('greeting_count', self.greeting_count)
        
        self.logger.info("已禁用并保存数据")
    
    async def on_unload(self):
        """插件卸载"""
        await super().on_unload()
        
        # 最后保存
        await self.storage.set('message_count', self.message_count)
        await self.storage.set('greeting_count', self.greeting_count)
        
        self.logger.info("已卸载")


if __name__ == '__main__':
    # 使用推荐的 run_plugin 辅助函数
    # 它会自动处理IPC初始化、事件注册和生命周期管理
    asyncio.run(run_plugin(ExamplePythonPlugin))

