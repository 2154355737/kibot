"""
Python插件启动检查模块
检查Python版本、依赖包等环境要求
"""

import sys
import os
import importlib.util
from typing import List, Dict, Tuple


class StartupChecker:
    """启动环境检查器"""
    
    @staticmethod
    def check_python_version(required_version: str = "3.8") -> Tuple[bool, str]:
        """
        检查Python版本
        
        Args:
            required_version: 要求的最低版本（如 "3.8"）
        
        Returns:
            (是否满足, 消息)
        """
        current = sys.version_info
        required = tuple(map(int, required_version.split('.')))
        
        current_version = f"{current.major}.{current.minor}.{current.micro}"
        
        if (current.major, current.minor) >= required[:2]:
            return True, f"✅ Python版本: {current_version} (要求: >={required_version})"
        else:
            return False, f"❌ Python版本不满足要求: {current_version} < {required_version}"
    
    @staticmethod
    def check_package(package_name: str, version: str = None) -> Tuple[bool, str]:
        """
        检查Python包是否安装
        
        Args:
            package_name: 包名
            version: 要求的版本（可选）
        
        Returns:
            (是否安装, 消息)
        """
        try:
            # 尝试导入包
            spec = importlib.util.find_spec(package_name)
            if spec is None:
                return False, f"❌ 缺少依赖包: {package_name}"
            
            # 如果指定了版本，检查版本
            if version:
                try:
                    module = importlib.import_module(package_name)
                    installed_version = getattr(module, '__version__', 'unknown')
                    return True, f"✅ {package_name}=={installed_version}"
                except Exception:
                    return True, f"✅ {package_name} (版本未知)"
            
            return True, f"✅ {package_name} 已安装"
            
        except Exception as e:
            return False, f"❌ 检查包 {package_name} 失败: {e}"
    
    @staticmethod
    def check_requirements_file(file_path: str) -> Tuple[bool, List[str]]:
        """
        检查requirements.txt中的所有依赖
        
        Args:
            file_path: requirements.txt文件路径
        
        Returns:
            (是否全部满足, 消息列表)
        """
        if not os.path.exists(file_path):
            return True, ["ℹ️ 无requirements.txt文件"]
        
        messages = []
        all_ok = True
        
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                lines = f.readlines()
            
            for line in lines:
                line = line.strip()
                
                # 跳过注释和空行
                if not line or line.startswith('#'):
                    continue
                
                # 解析包名和版本
                if '>=' in line:
                    package_name = line.split('>=')[0].strip()
                    version = line.split('>=')[1].strip()
                elif '==' in line:
                    package_name = line.split('==')[0].strip()
                    version = line.split('==')[1].strip()
                else:
                    package_name = line
                    version = None
                
                ok, msg = StartupChecker.check_package(package_name, version)
                messages.append(msg)
                
                if not ok:
                    all_ok = False
            
            return all_ok, messages
            
        except Exception as e:
            return False, [f"❌ 读取requirements.txt失败: {e}"]
    
    @staticmethod
    def check_sdk_available() -> Tuple[bool, str]:
        """检查KiBot SDK是否可用"""
        try:
            # 检查SDK模块
            sdk_modules = [
                'plugin_base',
                'ipc_client',
                'logger',
                'storage',
                'cq_parser'
            ]
            
            for module_name in sdk_modules:
                spec = importlib.util.find_spec(module_name)
                if spec is None:
                    return False, f"❌ SDK模块缺失: {module_name}"
            
            return True, "✅ KiBot Python SDK 可用"
            
        except Exception as e:
            return False, f"❌ SDK检查失败: {e}"
    
    @classmethod
    def run_all_checks(cls, plugin_dir: str = None, 
                       required_python: str = "3.8") -> Tuple[bool, List[str]]:
        """
        运行所有启动检查
        
        Args:
            plugin_dir: 插件目录（用于查找requirements.txt）
            required_python: 要求的Python版本
        
        Returns:
            (是否全部通过, 消息列表)
        """
        messages = []
        all_ok = True
        
        # 检查Python版本
        ok, msg = cls.check_python_version(required_python)
        messages.append(msg)
        if not ok:
            all_ok = False
        
        # 检查SDK
        ok, msg = cls.check_sdk_available()
        messages.append(msg)
        if not ok:
            all_ok = False
        
        # 检查依赖包
        if plugin_dir:
            requirements_file = os.path.join(plugin_dir, 'requirements.txt')
            ok, msgs = cls.check_requirements_file(requirements_file)
            messages.extend(msgs)
            if not ok:
                all_ok = False
        
        return all_ok, messages
    
    @classmethod
    def print_check_results(cls, plugin_name: str, plugin_dir: str = None, 
                           required_python: str = "3.8"):
        """
        打印检查结果
        
        Args:
            plugin_name: 插件名称
            plugin_dir: 插件目录
            required_python: 要求的Python版本
        """
        all_ok, messages = cls.run_all_checks(plugin_dir, required_python)
        
        # 简化输出格式
        if all_ok:
            # 只输出成功的关键信息
            for msg in messages:
                if '✅' in msg:
                    print(msg, file=sys.stderr)
            return True
        else:
            # 输出详细的错误信息
            print(f"\n{'='*60}", file=sys.stderr)
            print(f"❌ {plugin_name} - 环境检查失败", file=sys.stderr)
            print(f"{'='*60}", file=sys.stderr)
            
            for msg in messages:
                print(msg, file=sys.stderr)
            
            print(f"{'='*60}", file=sys.stderr)
            print("提示: 运行以下命令安装依赖:", file=sys.stderr)
            if plugin_dir:
                requirements_file = os.path.join(plugin_dir, 'requirements.txt')
                if os.path.exists(requirements_file):
                    print(f"  pip install -r {requirements_file}\n", file=sys.stderr)
            return False


# 快捷函数
def check_and_start(plugin_name: str, required_python: str = "3.8") -> bool:
    """
    检查环境并决定是否启动插件
    
    Args:
        plugin_name: 插件名称
        required_python: 要求的Python版本
    
    Returns:
        是否可以启动
    """
    plugin_dir = os.path.dirname(os.path.abspath(sys.argv[0]))
    return StartupChecker.print_check_results(plugin_name, plugin_dir, required_python)

