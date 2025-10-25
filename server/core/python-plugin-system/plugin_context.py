"""
插件上下文 - 提供插件运行所需的服务
"""

from typing import Dict, Any

try:
    from ipc_client import IPCClient
except ImportError:
    from .ipc_client import IPCClient


class PluginContext:
    """插件上下文"""
    
    def __init__(self, context_config: Dict[str, Any], ipc: IPCClient):
        self.config = context_config
        self.ipc = ipc
        
        # API端点配置
        self.api_endpoint = context_config.get('apiEndpoint')
        self.auth_token = context_config.get('authToken')
    
    async def emit_event(self, event_type: str, data: Dict[str, Any]):
        """发送自定义事件到事件总线"""
        await self.ipc.send_event('customEvent', {
            'event_type': event_type,
            'data': data
        })
    
    async def notify(self, notification_type: str, data: Dict[str, Any]):
        """发送通知到前端"""
        await self.ipc.send_request('notify', {
            'type': notification_type,
            'data': data
        })

