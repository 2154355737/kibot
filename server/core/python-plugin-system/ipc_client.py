"""
IPC客户端 - 与Node.js主服务器通信
使用stdin/stdout进行JSON Lines通信
"""

import sys
import json
import asyncio
import uuid
from typing import Dict, Any, Optional, Callable
from datetime import datetime


class IPCClient:
    """IPC通信客户端"""
    
    def __init__(self):
        self.pending_requests: Dict[str, asyncio.Future] = {}
        self.event_handlers: Dict[str, Callable] = {}
        self.running = False
        self.reader_task = None
    
    async def start(self):
        """启动IPC客户端"""
        self.running = True
        # 启动消息读取任务
        self.reader_task = asyncio.create_task(self._read_messages())
    
    async def stop(self):
        """停止IPC客户端"""
        self.running = False
        if self.reader_task:
            self.reader_task.cancel()
            try:
                await self.reader_task
            except asyncio.CancelledError:
                pass
    
    async def _read_messages(self):
        """读取来自Node.js的消息"""
        loop = asyncio.get_event_loop()
        
        self._log_info("IPC消息读取循环已启动")
        
        while self.running:
            try:
                # 从stdin异步读取一行
                line = await loop.run_in_executor(None, sys.stdin.readline)
                
                if not line:
                    # stdin关闭，退出
                    self._log_info("stdin已关闭，退出消息读取循环")
                    break
                
                line = line.strip()
                if not line:
                    continue
                
                self._log_info(f"收到消息: {line[:100]}...")  # 只显示前100个字符
                
                try:
                    message = json.loads(line)
                    await self._handle_message(message)
                except json.JSONDecodeError as error:
                    self._log_error(f"JSON解析错误: {error}")
                    self._log_error(f"原始消息: {line}")
                    
            except Exception as error:
                self._log_error(f"读取消息错误: {error}")
                import traceback
                traceback.print_exc()
                await asyncio.sleep(0.1)
        
        self._log_info("IPC消息读取循环已结束")
    
    async def _handle_message(self, message: Dict[str, Any]):
        """处理接收到的消息"""
        msg_type = message.get('type')
        msg_id = message.get('id')
        
        self._log_info(f"处理消息: type={msg_type}, id={msg_id}")
        
        if msg_type == 'response':
            # 响应消息
            if msg_id and msg_id in self.pending_requests:
                future = self.pending_requests.pop(msg_id)
                if message.get('error'):
                    future.set_exception(Exception(message['error']))
                else:
                    future.set_result(message.get('data'))
        
        elif msg_type == 'request':
            # 请求消息（Node.js调用Python）
            # 异步处理请求，不阻塞消息读取循环
            asyncio.create_task(self._handle_request(message))
        
        elif msg_type == 'event':
            # 事件消息
            # 异步处理事件，不阻塞消息读取循环
            asyncio.create_task(self._handle_event(message))
        
        else:
            self._log_error(f"未知消息类型: {msg_type}")
    
    async def _handle_request(self, message: Dict[str, Any]):
        """处理Node.js的请求"""
        action = message.get('action')
        data = message.get('data', {})
        msg_id = message.get('id')
        
        # 验证必需字段
        if not msg_id:
            self._log_error("收到没有ID的请求，忽略")
            return
        
        import time
        start_time = time.time()
        
        # 调用注册的请求处理器
        handler = self.event_handlers.get(f'request:{action}')
        
        if handler:
            try:
                self._log_info(f"开始处理请求: {action}, ID: {msg_id}")
                result = await handler(data)
                
                duration = int((time.time() - start_time) * 1000)
                self._log_info(f"请求处理完成: {action}, ID: {msg_id}, 耗时: {duration}ms")
                
                # 发送响应（同步方式，不使用await）
                self.send_response_sync(msg_id, result)
            except Exception as error:
                duration = int((time.time() - start_time) * 1000)
                self._log_error(f"请求处理失败: {action}, ID: {msg_id}, 耗时: {duration}ms")
                
                import traceback
                traceback.print_exc()
                self.send_error_sync(msg_id, str(error))
        else:
            self._log_error(f"未知请求: {action}, ID: {msg_id}")
            self.send_error_sync(msg_id, f"Unknown action: {action}")
    
    async def _handle_event(self, message: Dict[str, Any]):
        """处理事件消息"""
        action = message.get('action')
        data = message.get('data', {})
        
        # 调用注册的事件处理器
        handler = self.event_handlers.get(f'event:{action}')
        
        if handler:
            try:
                await handler(data)
            except Exception as error:
                self._log_error(f"事件处理错误: {error}")
    
    def on_request(self, action: str, handler: Callable):
        """注册请求处理器"""
        self.event_handlers[f'request:{action}'] = handler
    
    def on_event(self, action: str, handler: Callable):
        """注册事件处理器"""
        self.event_handlers[f'event:{action}'] = handler
    
    async def send_request(self, action: str, data: Optional[Dict[str, Any]] = None, timeout: float = 30.0) -> Any:
        """
        发送请求并等待响应
        
        Args:
            action: 动作名称
            data: 请求数据
            timeout: 超时时间（秒）
        
        Returns:
            响应数据
        """
        msg_id = self._generate_id()
        
        message = {
            'id': msg_id,
            'type': 'request',
            'action': action,
            'data': data or {},
            'timestamp': datetime.now().timestamp()
        }
        
        # 创建Future等待响应
        future = asyncio.get_event_loop().create_future()
        self.pending_requests[msg_id] = future
        
        # 发送消息
        self._send(message)
        
        # 等待响应（带超时）
        try:
            result = await asyncio.wait_for(future, timeout=timeout)
            return result
        except asyncio.TimeoutError:
            self.pending_requests.pop(msg_id, None)
            raise Exception(f"Request timeout: {action}")
    
    def send_response_sync(self, msg_id: str, data: Any):
        """发送响应消息（同步）"""
        message = {
            'id': msg_id,
            'type': 'response',
            'data': data,
            'timestamp': datetime.now().timestamp()
        }
        self._send(message)
    
    def send_error_sync(self, msg_id: str, error: str):
        """发送错误响应（同步）"""
        message = {
            'id': msg_id,
            'type': 'response',
            'error': error,
            'timestamp': datetime.now().timestamp()
        }
        self._send(message)
    
    async def send_response(self, msg_id: str, data: Any):
        """发送响应消息（异步包装）"""
        self.send_response_sync(msg_id, data)
    
    async def send_error(self, msg_id: str, error: str):
        """发送错误响应（异步包装）"""
        self.send_error_sync(msg_id, error)
    
    async def send_event(self, action: str, data: Optional[Dict[str, Any]] = None):
        """发送事件消息"""
        message = {
            'type': 'event',
            'action': action,
            'data': data or {},
            'timestamp': datetime.now().timestamp()
        }
        self._send(message)
    
    def _send(self, message: Dict[str, Any]):
        """发送消息到stdout"""
        try:
            json_str = json.dumps(message, ensure_ascii=False)
            sys.stdout.write(json_str + '\n')
            sys.stdout.flush()
        except Exception as error:
            self._log_error(f"发送消息错误: {error}")
    
    @staticmethod
    def _generate_id() -> str:
        """生成唯一ID"""
        return str(uuid.uuid4())
    
    @staticmethod
    def _log_info(message: str):
        """输出信息日志到stderr"""
        sys.stderr.write(f"[IPC] {message}\n")
        sys.stderr.flush()
    
    @staticmethod
    def _log_error(message: str):
        """输出错误日志到stderr"""
        sys.stderr.write(f"[IPC Error] {message}\n")
        sys.stderr.flush()

