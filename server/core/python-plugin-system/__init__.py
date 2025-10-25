"""
KiBot Python Plugin SDK
支持使用Python开发KiBot插件

@version 1.0.0
@author KiBot Team
"""

try:
    # 尝试相对导入（作为包使用）
    from .plugin_base import PluginBase, run_plugin
    from .decorators import command, event, task
    from .cq_parser import CQParser, CQBuilder
    from .startup_check import StartupChecker, check_and_start
except ImportError:
    # 如果失败，尝试绝对导入（直接运行）
    from plugin_base import PluginBase, run_plugin
    from decorators import command, event, task
    from cq_parser import CQParser, CQBuilder
    from startup_check import StartupChecker, check_and_start

__version__ = "1.0.0"
__all__ = [
    "PluginBase",
    "run_plugin",
    "command",
    "event", 
    "task",
    "CQParser",
    "CQBuilder",
    "StartupChecker",
    "check_and_start"
]

