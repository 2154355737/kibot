"""
存储服务 - 通过IPC访问Node.js的存储系统
"""

from typing import Any, Optional

try:
    from ipc_client import IPCClient
except ImportError:
    from .ipc_client import IPCClient


class Storage:
    """插件存储"""
    
    def __init__(self, plugin_id: str, ipc: IPCClient):
        self.plugin_id = plugin_id
        self.ipc = ipc
    
    async def get(self, key: str, default_value: Any = None) -> Any:
        """
        获取存储值
        
        Args:
            key: 键名
            default_value: 默认值
        
        Returns:
            存储的值或默认值
        """
        try:
            result = await self.ipc.send_request('storage.get', {
                'plugin_id': self.plugin_id,
                'key': key
            })
            return result if result is not None else default_value
        except Exception:
            return default_value
    
    async def set(self, key: str, value: Any) -> bool:
        """
        设置存储值
        
        Args:
            key: 键名
            value: 值
        
        Returns:
            是否成功
        """
        try:
            await self.ipc.send_request('storage.set', {
                'plugin_id': self.plugin_id,
                'key': key,
                'value': value
            })
            return True
        except Exception:
            return False
    
    async def delete(self, key: str) -> bool:
        """
        删除存储值
        
        Args:
            key: 键名
        
        Returns:
            是否成功
        """
        try:
            await self.ipc.send_request('storage.delete', {
                'plugin_id': self.plugin_id,
                'key': key
            })
            return True
        except Exception:
            return False
    
    async def has(self, key: str) -> bool:
        """检查键是否存在"""
        try:
            result = await self.ipc.send_request('storage.has', {
                'plugin_id': self.plugin_id,
                'key': key
            })
            return result
        except Exception:
            return False
    
    async def keys(self) -> list:
        """获取所有键"""
        try:
            result = await self.ipc.send_request('storage.keys', {
                'plugin_id': self.plugin_id
            })
            return result or []
        except Exception:
            return []
    
    async def clear(self) -> bool:
        """清空所有存储"""
        try:
            await self.ipc.send_request('storage.clear', {
                'plugin_id': self.plugin_id
            })
            return True
        except Exception:
            return False

