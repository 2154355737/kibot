"""
装饰器工具 - 简化插件开发
"""

from typing import Callable, Any, Dict
from functools import wraps


def command(cmd: str, **options):
    """
    指令装饰器
    
    使用示例:
    @command('hello', description='问候指令')
    async def handle_hello(self, event, args):
        pass
    """
    def decorator(func: Callable) -> Callable:
        func._is_command = True
        func._command_name = cmd
        func._command_options = options
        return func
    return decorator


def event(event_type: str):
    """
    事件装饰器
    
    使用示例:
    @event('message')
    async def handle_message(self, event):
        pass
    """
    def decorator(func: Callable) -> Callable:
        func._is_event = True
        func._event_type = event_type
        return func
    return decorator


def task(name: str, cron: str):
    """
    定时任务装饰器
    
    使用示例:
    @task('daily_task', '0 0 * * *')
    async def my_task(self):
        pass
    """
    def decorator(func: Callable) -> Callable:
        func._is_task = True
        func._task_name = name
        func._task_cron = cron
        return func
    return decorator


def permission(required_level: str = 'user'):
    """
    权限装饰器
    
    使用示例:
    @permission('admin')
    async def admin_command(self, event, args):
        pass
    """
    def decorator(func: Callable) -> Callable:
        @wraps(func)
        async def wrapper(self, *args, **kwargs):
            # 这里可以添加权限检查逻辑
            # 暂时只标记权限要求
            return await func(self, *args, **kwargs)
        
        wrapper._required_permission = required_level
        return wrapper
    return decorator


def rate_limit(calls: int = 5, period: int = 60):
    """
    速率限制装饰器
    
    Args:
        calls: 调用次数
        period: 时间段（秒）
    
    使用示例:
    @rate_limit(calls=3, period=60)
    async def limited_command(self, event, args):
        pass
    """
    def decorator(func: Callable) -> Callable:
        func._rate_limit = {
            'calls': calls,
            'period': period
        }
        return func
    return decorator


def cooldown(seconds: int):
    """
    冷却时间装饰器
    
    使用示例:
    @cooldown(10)
    async def cmd_with_cooldown(self, event, args):
        pass
    """
    def decorator(func: Callable) -> Callable:
        func._cooldown = seconds
        return func
    return decorator

