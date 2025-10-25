"""
KiBot Python插件基类
提供插件开发的核心功能

核心设计原则：
1. 性能统计和错误捕获在SDK层面强制执行，不可被插件覆盖
2. 所有命令、事件、任务的执行都自动追踪
3. 使用私有方法确保核心逻辑不被覆盖

Version: 3.0.1
"""

import asyncio
import json
import time
import traceback
import sys
import warnings
from typing import Dict, Any, Optional, Callable, List
from datetime import datetime
from functools import wraps

# 使用绝对导入而不是相对导入
try:
    from ipc_client import IPCClient
    from logger import Logger
    from storage import Storage
    from plugin_context import PluginContext
except ImportError:
    # 如果作为包导入失败，尝试相对导入
    from .ipc_client import IPCClient
    from .logger import Logger
    from .storage import Storage
    from .plugin_context import PluginContext


class PluginBase:
    """Python插件基类"""
    
    def __init__(self, plugin_info: Dict[str, Any], context_config: Dict[str, Any]):
        """
        初始化插件
        
        Args:
            plugin_info: 插件信息（来自plugin.json）
            context_config: 上下文配置（Node.js提供）
        """
        self.info = plugin_info
        self.is_enabled = False
        
        # 创建IPC客户端
        self.ipc = IPCClient()
        
        # 创建上下文
        self.context = PluginContext(context_config, self.ipc)
        
        # 创建日志器
        self.logger = Logger(plugin_info['id'])
        
        # 创建存储
        self.storage = Storage(plugin_info['id'], self.ipc)
        
        # 事件处理器映射
        self._event_handlers: Dict[str, List[Callable]] = {}
        
        # 指令处理器映射
        self._command_handlers: Dict[str, Callable] = {}
        
        # 定时任务映射
        self._scheduled_tasks: Dict[str, Dict[str, Any]] = {}
        
        # 统计信息
        self.statistics = {
            'command_executions': 0,
            'events_handled': 0,
            'tasks_executed': 0,
            'errors_occurred': 0
        }
        
        # 性能监控数据
        self.performance = {
            'command_performance': {},  # 命令性能数据
            'event_performance': {},     # 事件性能数据
            'task_performance': {}       # 任务性能数据
        }
        
        self.last_activity = datetime.now().timestamp()
        self.errors: List[Dict[str, Any]] = []
        
        # 线程安全监控（Python使用异步并发）
        self._concurrent_operations = 0
        self._max_concurrent_operations = 0
        
        # 【全局错误处理器】确保所有未捕获的错误都被记录
        self._setup_global_error_handlers()
    
    # ==================== 全局错误处理 ====================
    
    def _setup_global_error_handlers(self):
        """
        【核心方法 - SDK层面全局错误处理】
        设置全局错误处理器，捕获所有未处理的异常
        确保插件的任何错误都不会被遗漏
        """
        # 保存原始的excepthook
        self._original_excepthook = sys.excepthook
        
        # 创建自定义excepthook
        def custom_excepthook(exc_type, exc_value, exc_traceback):
            # 检查是否来自当前插件
            if self._is_plugin_error(exc_value):
                # 使用正确的name mangling调用
                self._PluginBase__record_error_internal('uncaughtException', 'global', exc_value)
                self.logger.error(f'捕获到未捕获的异常: {exc_value}')
            
            # 调用原始的excepthook
            self._original_excepthook(exc_type, exc_value, exc_traceback)
        
        # 设置自定义excepthook
        sys.excepthook = custom_excepthook
        
        # 捕获warnings并记录
        def custom_warning_handler(message, category, filename, lineno, file=None, line=None):
            if self.info['id'] in filename:
                # Logger没有warning方法，使用error或debug
                self.logger.error(f'[Warning:{category.__name__}] {message} ({filename}:{lineno})')
        
        warnings.showwarning = custom_warning_handler
        
        self.logger.debug('全局错误处理器已启用')
    
    def _is_plugin_error(self, error: Exception) -> bool:
        """
        判断错误是否来自当前插件
        通过错误堆栈分析判断
        """
        if not error:
            return False
        
        tb_str = ''.join(traceback.format_tb(error.__traceback__))
        
        # 检查堆栈是否包含插件ID
        return self.info['id'] in tb_str
    
    def _cleanup_global_error_handlers(self):
        """
        清理全局错误处理器
        在插件卸载时调用
        """
        if hasattr(self, '_original_excepthook'):
            sys.excepthook = self._original_excepthook
            self.logger.debug('全局错误处理器已清理')
    
    # ==================== 生命周期钩子 ====================
    
    async def on_load(self):
        """插件加载时调用（子类可覆盖）"""
        pass  # 由子类实现，避免重复日志
    
    async def on_enable(self):
        """插件启用时调用（子类可覆盖）"""
        self.is_enabled = True
        # 不再输出默认日志，由子类决定
    
    async def on_disable(self):
        """插件禁用时调用（子类可覆盖）"""
        self.is_enabled = False
        # 不再输出默认日志，由子类决定
    
    async def on_unload(self):
        """插件卸载时调用（子类可覆盖）"""
        # 【清理全局错误处理器】
        self._cleanup_global_error_handlers()
        pass  # 由子类实现，避免重复日志
    
    # ==================== 性能和错误追踪核心方法 ====================
    
    def _PluginBase__record_error_internal(self, error_type: str, source: str, error: Exception):
        """
        【核心方法 - 不可覆盖】
        错误记录的内部实现，确保所有错误都被捕获
        使用name mangling防止子类覆盖
        """
        error_info = {
            'type': error_type,
            'source': source,
            'message': str(error),
            'stack': traceback.format_exc(),
            'timestamp': time.time() * 1000,  # 毫秒时间戳
            'plugin_id': self.info['id'],
            'plugin_name': self.info.get('name', self.info['id'])
        }
        
        self.errors.append(error_info)
        self.statistics['errors_occurred'] += 1
        
        # 只保留最近100个错误
        if len(self.errors) > 100:
            self.errors.pop(0)
        
        # 输出错误日志（确保错误可见）
        self.logger.error(f"[{error_type}:{source}] {error_info['message']}")
    
    def _PluginBase__record_performance_internal(self, perf_type: str, name: str, duration: float, success: bool = True):
        """
        【核心方法 - 不可覆盖】
        性能数据记录的内部实现，确保所有操作都被追踪
        使用name mangling防止子类覆盖
        """
        if not isinstance(duration, (int, float)) or duration < 0:
            return
        
        # 选择性能数据字典
        perf_map = {
            'command': self.performance['command_performance'],
            'event': self.performance['event_performance'],
            'task': self.performance['task_performance']
        }.get(perf_type, self.performance['command_performance'])
        
        if name not in perf_map:
            perf_map[name] = {
                'total_executions': 0,
                'successful_executions': 0,
                'failed_executions': 0,
                'total_duration': 0,
                'min_duration': float('inf'),
                'max_duration': 0,
                'avg_duration': 0,
                'last_executions': []
            }
        
        perf = perf_map[name]
        perf['total_executions'] += 1
        
        if success:
            perf['successful_executions'] += 1
        else:
            perf['failed_executions'] += 1
        
        perf['total_duration'] += duration
        perf['min_duration'] = min(perf['min_duration'], duration)
        perf['max_duration'] = max(perf['max_duration'], duration)
        perf['avg_duration'] = perf['total_duration'] / perf['total_executions']
        
        # 记录最近执行
        perf['last_executions'].append({
            'timestamp': time.time() * 1000,
            'duration': duration,
            'success': success
        })
        
        # 只保留最近20次执行记录
        if len(perf['last_executions']) > 20:
            perf['last_executions'].pop(0)
    
    def _record_error(self, error_type: str, source: str, error: Exception):
        """
        【公开API】记录错误
        插件可以调用，但实际执行通过内部方法
        """
        return self._PluginBase__record_error_internal(error_type, source, error)
    
    def _record_performance(self, perf_type: str, name: str, duration: float, success: bool = True):
        """
        【公开API】记录性能数据
        插件可以调用，但实际执行通过内部方法
        """
        return self._PluginBase__record_performance_internal(perf_type, name, duration, success)
    
    # ==================== IPC处理器注册 ====================
    
    def _setup_ipc_handlers(self):
        """
        设置IPC请求处理器（内部方法）
        这个方法应该在插件启动时调用，用于注册核心IPC处理器
        """
        # 注册指令分发处理器
        async def dispatch_command_handler(data):
            try:
                await self.dispatch_command(
                    data.get('command'),
                    data.get('event', {}),
                    data.get('args', [])
                )
                return {'success': True}
            except Exception as e:
                import traceback
                traceback.print_exc()
                raise
        
        self.ipc.on_request('dispatchCommand', dispatch_command_handler)
        
        # 注册任务分发处理器
        async def dispatch_task_handler(data):
            try:
                await self.dispatch_task(data['taskName'])
                return {'success': True}
            except Exception as e:
                import traceback
                traceback.print_exc()
                raise
        
        self.ipc.on_request('dispatchTask', dispatch_task_handler)
        
        # 注册事件分发处理器
        async def dispatch_event_handler(data):
            try:
                await self.dispatch_event(
                    data.get('eventType'),
                    data.get('event', {})
                )
                return {'success': True}
            except Exception as e:
                import traceback
                traceback.print_exc()
                raise
        
        self.ipc.on_request('dispatchEvent', dispatch_event_handler)
    
    # ==================== 事件处理 ====================
    
    def register_event(self, event_type: str, handler: Callable):
        """
        注册事件处理器
        
        Args:
            event_type: 事件类型 (message, group_join, etc.)
            handler: 处理函数 async def handler(event)
        """
        if event_type not in self._event_handlers:
            self._event_handlers[event_type] = []
        
        # 【强制包装】确保所有事件处理都被追踪，无法被插件绕过
        async def wrapped_handler(event):
            # ========== SDK强制执行：统计数据收集 ==========
            self.last_activity = datetime.now().timestamp()
            self.statistics['events_handled'] += 1
            self._concurrent_operations += 1
            
            if self._concurrent_operations > self._max_concurrent_operations:
                self._max_concurrent_operations = self._concurrent_operations
            
            start_time = time.time()
            success = True
            
            try:
                # 执行插件的处理器
                await handler(event)
            except Exception as error:
                success = False
                
                # ========== SDK强制执行：错误记录 ==========
                # 使用正确的name mangling调用
                self._PluginBase__record_error_internal('event', event_type, error)
                
                # 继续抛出错误
                raise
            finally:
                # ========== SDK强制执行：性能记录（无论成功失败都记录） ==========
                self._concurrent_operations -= 1
                duration = (time.time() - start_time) * 1000  # 转换为毫秒
                # 使用正确的name mangling调用
                self._PluginBase__record_performance_internal('event', event_type, duration, success)
        
        self._event_handlers[event_type].append(wrapped_handler)
        self.logger.debug(f"注册事件处理器: {event_type}")
    
    async def dispatch_event(self, event_type: str, event_data: Dict[str, Any]):
        """
        分发事件到处理器（由IPC客户端调用）
        
        Args:
            event_type: 事件类型
            event_data: 事件数据
        """
        if event_type in self._event_handlers:
            for handler in self._event_handlers[event_type]:
                try:
                    await handler(event_data)
                except Exception as error:
                    self.logger.error(f"事件处理器错误: {error}")
    
    # ==================== 指令处理 ====================
    
    def register_command(self, command: str, handler: Callable, **options):
        """
        注册指令处理器
        
        Args:
            command: 指令名称（不带/前缀）
            handler: 处理函数 async def handler(event, args)
            **options: 指令选项（description, usage, etc.）
        """
        # 【强制包装】确保所有命令执行都被追踪，无法被插件绕过
        async def wrapped_handler(event, args):
            # ========== SDK强制执行：统计数据收集 ==========
            self.last_activity = datetime.now().timestamp()
            self.statistics['command_executions'] += 1
            self._concurrent_operations += 1
            
            if self._concurrent_operations > self._max_concurrent_operations:
                self._max_concurrent_operations = self._concurrent_operations
            
            start_time = time.time()
            success = True
            
            try:
                # 执行插件的处理器
                await handler(event, args)
            except Exception as error:
                success = False
                
                # ========== SDK强制执行：错误记录 ==========
                # 使用正确的name mangling调用
                self._PluginBase__record_error_internal('command', command, error)
                
                # 发送错误消息给用户
                try:
                    error_msg = f"⚠️ 执行指令 /{command} 时出错：{str(error)}"
                    await self.send_message(
                        event.get('user_id'),
                        error_msg,
                        event.get('message_type', 'private')
                    )
                except:
                    pass  # 发送错误消息失败不影响主流程
            finally:
                # ========== SDK强制执行：性能记录（无论成功失败都记录） ==========
                self._concurrent_operations -= 1
                duration = (time.time() - start_time) * 1000  # 转换为毫秒
                # 使用正确的name mangling调用
                self._PluginBase__record_performance_internal('command', command, duration, success)
        
        self._command_handlers[command] = wrapped_handler
        
        # 通知Node.js注册指令
        asyncio.create_task(self._register_command_remote(command, options))
        
        self.logger.debug(f"注册指令: /{command}")
    
    async def _register_command_remote(self, command: str, options: Dict[str, Any]):
        """向Node.js注册指令"""
        await self.ipc.send_request('registerCommand', {
            'command': command,
            'plugin': self.info['id'],
            **options
        })
    
    # dispatch_command 方法移至后面统一实现
    
    # ==================== 消息发送 ====================
    
    async def send_message(self, chat_id: Any, message: str, msg_type: str = 'private') -> Dict[str, Any]:
        """
        发送消息
        
        Args:
            chat_id: 聊天ID（QQ号或群号）
            message: 消息内容
            msg_type: 消息类型 ('private' 或 'group')
        
        Returns:
            API响应结果
        """
        return await self.call_api(
            f"send_{msg_type}_msg",
            {
                'user_id' if msg_type == 'private' else 'group_id': chat_id,
                'message': message
            }
        )
    
    async def send_group_msg(self, group_id: int, message: str) -> Dict[str, Any]:
        """发送群消息"""
        return await self.send_message(group_id, message, 'group')
    
    async def send_private_msg(self, user_id: int, message: str) -> Dict[str, Any]:
        """发送私聊消息"""
        return await self.send_message(user_id, message, 'private')
    
    # ==================== API调用 ====================
    
    async def call_api(self, action: str, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """
        调用QQ Bot API
        
        Args:
            action: API动作名称
            params: API参数
        
        Returns:
            API响应结果
        """
        return await self.ipc.send_request('callApi', {
            'action': action,
            'params': params or {}
        })
    
    # ==================== 定时任务 ====================
    
    async def schedule(self, name: str, cron: str, handler: Callable):
        """
        创建定时任务
        
        Args:
            name: 任务名称
            cron: Cron表达式
            handler: 处理函数 async def handler()
        """
        task_info = {
            'name': name,
            'cron': cron,
            'execution_count': 0,
            'last_executed': None,
            'is_active': True
        }
        
        # 包装处理器
        async def wrapped_handler():
            self.last_activity = datetime.now().timestamp()
            self.statistics['tasks_executed'] += 1
            task_info['execution_count'] += 1
            task_info['last_executed'] = datetime.now().timestamp()
            
            try:
                await handler()
            except Exception as error:
                self._record_error('task', name, error)
                raise
        
        self._scheduled_tasks[name] = task_info
        
        # 向Node.js注册定时任务
        await self.ipc.send_request('registerSchedule', {
            'name': f"{self.info['id']}.{name}",
            'cron': cron
        })
        
        # 保存处理器供后续调用
        self._scheduled_tasks[name]['handler'] = wrapped_handler
        
        self.logger.debug(f"注册定时任务: {name} ({cron})")
    
    async def dispatch_command(self, command: str, event: Dict[str, Any], args: Optional[List[Any]] = None):
        """
        分发指令到处理器（由IPC客户端调用）
        
        Args:
            command: 指令名称
            event: 事件对象
            args: 指令参数
        """
        start_time = time.time()
        self.logger.debug(f"开始执行命令: {command}, args={args}")
        
        if command in self._command_handlers:
            handler = self._command_handlers[command]
            try:
                self.last_activity = datetime.now().timestamp()
                self.statistics['command_executions'] += 1
                
                await handler(event, args or [])
                
                duration = int((time.time() - start_time) * 1000)
                self.logger.debug(f"命令执行成功: {command} (耗时: {duration}ms)")
                
            except Exception as error:
                duration = int((time.time() - start_time) * 1000)
                self.logger.error(f"命令执行失败: {command} (耗时: {duration}ms)")
                self.logger.error(f"错误详情: {error}")
                
                self._record_error('command', command, error)
                raise
        else:
            self.logger.warn(f"未找到指令处理器: {command}")
            raise Exception(f"Unknown command: {command}")
    
    async def dispatch_task(self, task_name: str):
        """
        执行定时任务（由IPC客户端调用）
        
        Args:
            task_name: 任务名称（不含插件ID前缀）
        """
        if task_name in self._scheduled_tasks:
            handler = self._scheduled_tasks[task_name].get('handler')
            if handler:
                try:
                    await handler()
                except Exception as error:
                    self.logger.error(f"定时任务执行错误: {error}")
    
    # ==================== 配置管理 ====================
    
    async def get_config(self, key: str, default_value: Any = None) -> Any:
        """获取配置"""
        return await self.storage.get(f"config.{key}", default_value)
    
    async def set_config(self, key: str, value: Any) -> bool:
        """设置配置"""
        return await self.storage.set(f"config.{key}", value)
    
    # ==================== 错误处理 ====================
    # 错误处理方法已移至上方统一实现（使用name mangling防止覆盖）
    
    # ==================== 工具方法 ====================
    
    def get_detailed_info(self) -> Dict[str, Any]:
        """获取插件详细信息"""
        return {
            'basic': self.info,
            'status': {
                'is_enabled': self.is_enabled,
                'last_activity': self.last_activity
            },
            'commands': list(self._command_handlers.keys()),
            'events': list(self._event_handlers.keys()),
            'tasks': [
                {
                    'name': name,
                    **{k: v for k, v in task.items() if k != 'handler'}
                }
                for name, task in self._scheduled_tasks.items()
            ],
            'errors': self.errors[-10:],  # 最近10个错误
            'statistics': self.statistics,
            'performance': {
                'commandPerformance': self.performance['command_performance'],
                'eventPerformance': self.performance['event_performance'],
                'taskPerformance': self.performance['task_performance'],
                'avgExecutionTime': self._calculate_avg_execution_time()
            },
            'threadSafety': {
                'concurrentRequests': self._concurrent_operations,
                'maxConcurrentRequests': self._max_concurrent_operations,
                'warnings': [],  # Python插件目前没有并发警告
                'isHealthy': True
            }
        }
    
    def _calculate_avg_execution_time(self) -> float:
        """计算平均执行时间"""
        all_performance = []
        
        for perf_dict in [
            self.performance['command_performance'],
            self.performance['event_performance'],
            self.performance['task_performance']
        ]:
            all_performance.extend(perf_dict.values())
        
        if not all_performance:
            return 0
        
        total_duration = sum(p['total_duration'] for p in all_performance)
        total_executions = sum(p['total_executions'] for p in all_performance)
        
        return total_duration / total_executions if total_executions > 0 else 0


# ==================== 插件启动辅助函数 ====================

async def run_plugin(plugin_class):
    """
    运行Python插件的辅助函数
    自动处理IPC初始化、事件注册和生命周期管理
    
    Args:
        plugin_class: 插件类（继承自PluginBase）
    
    使用示例:
        if __name__ == '__main__':
            asyncio.run(run_plugin(MyPlugin))
    """
    import sys
    import json
    
    try:
        print(f"🔧 [run_plugin] 等待初始化消息...", file=sys.stderr)
        
        # 1. 等待load命令
        init_line = sys.stdin.readline().strip()
        if not init_line:
            raise Exception("未收到初始化消息")
        
        print(f"🔧 [run_plugin] 收到初始化消息: {init_line[:100]}...", file=sys.stderr)
        
        init_message = json.loads(init_line)
        
        if init_message.get('action') != 'load':
            raise Exception(f"期望收到load命令，实际收到: {init_message.get('action')}")
        
        print(f"🔧 [run_plugin] 解析成功，action=load", file=sys.stderr)
        
        # 2. 创建插件实例
        plugin_info = init_message['data']['pluginInfo']
        context_config = init_message['data']['context']
        
        print(f"🔧 [run_plugin] 创建插件实例: {plugin_info.get('name')}", file=sys.stderr)
        
        plugin = plugin_class(plugin_info, context_config)
        
        print(f"🔧 [run_plugin] 插件实例已创建", file=sys.stderr)
        
        # 3. 启动IPC客户端
        await plugin.ipc.start()
        print(f"✅ IPC客户端已启动", file=sys.stderr)
        
        # 4. 自动注册核心IPC处理器
        plugin._setup_ipc_handlers()
        print(f"✅ IPC处理器已注册", file=sys.stderr)
        
        # 5. 注册生命周期处理器
        async def handle_enable(data):
            await plugin.on_enable()
            return {'success': True}
        
        async def handle_disable(data):
            await plugin.on_disable()
            return {'success': True}
        
        async def handle_unload(data):
            await plugin.on_unload()
            await plugin.ipc.stop()
            return {'success': True}
        
        async def handle_get_info(data):
            return plugin.get_detailed_info()
        
        plugin.ipc.on_request('enable', handle_enable)
        plugin.ipc.on_request('disable', handle_disable)
        plugin.ipc.on_request('unload', handle_unload)
        plugin.ipc.on_request('getInfo', handle_get_info)
        
        # 6. 调用onLoad
        print(f"🔧 [run_plugin] 调用 on_load...", file=sys.stderr)
        await plugin.on_load()
        print(f"✅ [run_plugin] on_load 完成", file=sys.stderr)
        
        # 7. 发送ready响应
        print(f"🔧 [run_plugin] 发送ready响应...", file=sys.stderr)
        await plugin.ipc.send_response(init_message['id'], {
            'success': True,
            'message': 'Plugin loaded'
        })
        print(f"✅ [run_plugin] 插件已就绪，进入主循环", file=sys.stderr)
        
        # 8. 保持运行
        try:
            while plugin.ipc.running:
                await asyncio.sleep(0.1)
        except asyncio.CancelledError:
            # 正常关闭，不输出错误
            print(f"✅ [run_plugin] 收到关闭信号", file=sys.stderr)
            
    except KeyboardInterrupt:
        # 静默退出（Ctrl+C或关闭信号）
        print(f"✅ [run_plugin] 正常退出", file=sys.stderr)
        sys.exit(0)
    except asyncio.CancelledError:
        # asyncio 取消，正常退出
        print(f"✅ [run_plugin] 异步任务已取消，正常退出", file=sys.stderr)
        sys.exit(0)
    except Exception as error:
        print(f"❌ 插件运行错误: {error}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)

