"""
CQ码解析和构建工具
支持QQ消息中的富媒体内容处理
"""

import re
from typing import List, Dict, Any, Optional
from urllib.parse import quote, unquote


class CQParser:
    """CQ码解析器"""
    
    # CQ码正则表达式
    CQ_CODE_PATTERN = re.compile(r'\[CQ:([a-zA-Z]+)((?:,[a-zA-Z]+=[^,\]]*)*)\]')
    
    @classmethod
    def parse(cls, message: str) -> List[Dict[str, Any]]:
        """
        解析消息为消息段数组
        
        Args:
            message: 原始消息字符串
        
        Returns:
            消息段列表
        """
        segments = []
        last_end = 0
        
        for match in cls.CQ_CODE_PATTERN.finditer(message):
            # 添加纯文本段
            if match.start() > last_end:
                text = message[last_end:match.start()]
                if text:
                    segments.append({
                        'type': 'text',
                        'data': {'text': text}
                    })
            
            # 解析CQ码
            cq_type = match.group(1)
            params_str = match.group(2)
            
            # 解析参数
            data = {}
            if params_str:
                for param in params_str.split(','):
                    if not param:
                        continue
                    if '=' in param:
                        key, value = param.split('=', 1)
                        data[key] = cls._unescape(value)
            
            segments.append({
                'type': cq_type,
                'data': data
            })
            
            last_end = match.end()
        
        # 添加剩余文本
        if last_end < len(message):
            text = message[last_end:]
            if text:
                segments.append({
                    'type': 'text',
                    'data': {'text': text}
                })
        
        return segments
    
    @classmethod
    def extract_text(cls, segments: List[Dict[str, Any]]) -> str:
        """提取纯文本内容"""
        texts = []
        for segment in segments:
            if segment['type'] == 'text':
                texts.append(segment['data'].get('text', ''))
        return ''.join(texts)
    
    @classmethod
    def extract_by_type(cls, segments: List[Dict[str, Any]], seg_type: str) -> List[Dict[str, Any]]:
        """提取指定类型的消息段"""
        return [seg for seg in segments if seg['type'] == seg_type]
    
    @classmethod
    def has_type(cls, segments: List[Dict[str, Any]], seg_type: str) -> bool:
        """检查是否包含指定类型的消息段"""
        return any(seg['type'] == seg_type for seg in segments)
    
    @staticmethod
    def _unescape(text: str) -> str:
        """反转义CQ码参数"""
        return text.replace('&amp;', '&').replace('&#91;', '[').replace('&#93;', ']').replace('&#44;', ',')
    
    @staticmethod
    def _escape(text: str) -> str:
        """转义CQ码参数"""
        return text.replace('&', '&amp;').replace('[', '&#91;').replace(']', '&#93;').replace(',', '&#44;')


class CQBuilder:
    """CQ码构建器"""
    
    @staticmethod
    def _build(cq_type: str, **params) -> str:
        """构建CQ码"""
        if not params:
            return f"[CQ:{cq_type}]"
        
        param_str = ','.join(
            f"{k}={CQParser._escape(str(v))}" 
            for k, v in params.items()
        )
        return f"[CQ:{cq_type},{param_str}]"
    
    @classmethod
    def at(cls, qq: int) -> str:
        """@某人"""
        return cls._build('at', qq=qq)
    
    @classmethod
    def at_all(cls) -> str:
        """@全体成员"""
        return cls._build('at', qq='all')
    
    @classmethod
    def face(cls, face_id: int) -> str:
        """QQ表情"""
        return cls._build('face', id=face_id)
    
    @classmethod
    def image(cls, file: str, url: Optional[str] = None, cache: bool = True) -> str:
        """
        图片
        
        Args:
            file: 图片文件名或URL
            url: 图片URL（可选）
            cache: 是否使用缓存
        """
        params = {'file': file}
        if url:
            params['url'] = url
        if not cache:
            params['cache'] = 0
        return cls._build('image', **params)
    
    @classmethod
    def record(cls, file: str, magic: bool = False) -> str:
        """
        语音
        
        Args:
            file: 语音文件名
            magic: 是否变声
        """
        params = {'file': file}
        if magic:
            params['magic'] = 1
        return cls._build('record', **params)
    
    @classmethod
    def video(cls, file: str) -> str:
        """视频"""
        return cls._build('video', file=file)
    
    @classmethod
    def reply(cls, message_id: int) -> str:
        """回复消息"""
        return cls._build('reply', id=message_id)
    
    @classmethod
    def poke(cls, qq: int) -> str:
        """戳一戳"""
        return cls._build('poke', qq=qq)
    
    @classmethod
    def share(cls, url: str, title: str, content: Optional[str] = None, image: Optional[str] = None) -> str:
        """
        分享链接
        
        Args:
            url: 链接URL
            title: 标题
            content: 内容描述
            image: 封面图URL
        """
        params = {'url': url, 'title': title}
        if content:
            params['content'] = content
        if image:
            params['image'] = image
        return cls._build('share', **params)
    
    @classmethod
    def music(cls, music_type: str, music_id: str) -> str:
        """
        音乐分享
        
        Args:
            music_type: 音乐平台 (qq/163/xm)
            music_id: 音乐ID
        """
        return cls._build('music', type=music_type, id=music_id)
    
    @classmethod
    def custom_music(cls, url: str, audio: str, title: str, content: Optional[str] = None, image: Optional[str] = None) -> str:
        """
        自定义音乐分享
        
        Args:
            url: 点击链接
            audio: 音频URL
            title: 标题
            content: 描述
            image: 封面图URL
        """
        params = {
            'type': 'custom',
            'url': url,
            'audio': audio,
            'title': title
        }
        if content:
            params['content'] = content
        if image:
            params['image'] = image
        return cls._build('music', **params)
    
    @classmethod
    def location(cls, lat: float, lon: float, title: Optional[str] = None, content: Optional[str] = None) -> str:
        """
        位置分享
        
        Args:
            lat: 纬度
            lon: 经度
            title: 位置标题
            content: 位置描述
        """
        params = {'lat': lat, 'lon': lon}
        if title:
            params['title'] = title
        if content:
            params['content'] = content
        return cls._build('location', **params)
    
    @classmethod
    def forward(cls, forward_id: str) -> str:
        """合并转发"""
        return cls._build('forward', id=forward_id)
    
    @classmethod
    def json(cls, data: str) -> str:
        """JSON消息"""
        return cls._build('json', data=data)
    
    @classmethod
    def xml(cls, data: str) -> str:
        """XML消息"""
        return cls._build('xml', data=data)

