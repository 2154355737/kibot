/**
 * 检查并清理错误的文件夹嵌套结构
 * 用于修复 server/server, data/data 等错误的嵌套目录
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SERVER_DIR = path.resolve(__dirname, '..');

console.log('🔍 检查文件夹结构...\n');

// 需要检查的嵌套路径和危险目录
const NESTED_PATTERNS = [
  'server/server',
  'server/data/data',
  'server/core/core',
  'server/utils/utils',
  'server/config/config',
  'server/plugins/plugins',
  'data/data',
  'core/core',
  'utils/utils',
  'config/config'
];

// 需要清理的临时和缓存目录
const TEMP_PATTERNS = [
  'server/.updates',
  '.updates'
];

// 递归检查函数
function findNestedDirs(dir, pattern, depth = 0) {
  if (depth > 10) return []; // 防止无限递归
  
  const results = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    
    entries.forEach(entry => {
      if (entry.isDirectory()) {
        const fullPath = path.join(dir, entry.name);
        const relativePath = path.relative(SERVER_DIR, fullPath);
        
        // 检查是否匹配模式
        if (relativePath === pattern || relativePath.includes(pattern)) {
          results.push(relativePath);
        }
        
        // 递归查找（跳过 node_modules 和隐藏目录）
        if (entry.name !== 'node_modules' && !entry.name.startsWith('.')) {
          results.push(...findNestedDirs(fullPath, pattern, depth + 1));
        }
      }
    });
  } catch (error) {
    // 忽略权限错误等
  }
  
  return results;
}

let foundIssues = false;
let fixedIssues = 0;

// 检查嵌套结构
console.log('📋 检查嵌套结构...\n');

// 直接检查常见的嵌套目录
const directChecks = [
  'server',
  'data/data',
  'core/core',
  'utils/utils',
  'config/config',
  'plugins/plugins'
];

directChecks.forEach(pattern => {
  const fullPath = path.join(SERVER_DIR, pattern);
  
  if (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()) {
    foundIssues = true;
    console.log(`❌ 发现错误的嵌套结构: ${pattern}`);
    console.log(`   完整路径: ${fullPath}`);
    
    try {
      console.log(`   正在删除...`);
      fs.rmSync(fullPath, { recursive: true, force: true });
      console.log(`   ✅ 已删除\n`);
      fixedIssues++;
    } catch (error) {
      console.log(`   ❌ 删除失败: ${error.message}\n`);
    }
  }
});

// 使用递归查找（备用）
NESTED_PATTERNS.forEach(pattern => {
  const allMatches = findNestedDirs(SERVER_DIR, pattern);
  
  allMatches.forEach(matchPath => {
    const fullPath = path.join(SERVER_DIR, matchPath);
    
    if (fs.existsSync(fullPath)) {
      foundIssues = true;
      console.log(`❌ 发现深层嵌套结构: ${matchPath}`);
      console.log(`   完整路径: ${fullPath}`);
      
      try {
        console.log(`   正在删除...`);
        fs.rmSync(fullPath, { recursive: true, force: true });
        console.log(`   ✅ 已删除\n`);
        fixedIssues++;
      } catch (error) {
        console.log(`   ❌ 删除失败: ${error.message}\n`);
      }
    }
  });
});

// 清理临时目录
console.log('\n📋 检查临时目录...\n');
TEMP_PATTERNS.forEach(pattern => {
  const fullPath = path.join(SERVER_DIR, pattern);
  
  if (fs.existsSync(fullPath)) {
    console.log(`⚠️ 发现临时目录: ${pattern}`);
    console.log(`   路径: ${fullPath}`);
    console.log(`   提示: 可以安全删除此目录（包含备份、日志等）`);
    console.log(`   删除命令: rm -rf ${pattern}\n`);
  }
});

if (!foundIssues) {
  console.log('✅ 未发现嵌套结构问题，目录结构正常！\n');
} else {
  console.log(`\n📊 修复完成: 清理了 ${fixedIssues} 个错误的嵌套目录\n`);
}

// 显示当前 server 目录结构
console.log('📂 当前 server 目录结构:');
const items = fs.readdirSync(SERVER_DIR, { withFileTypes: true });
items.forEach(item => {
  const icon = item.isDirectory() ? '📁' : '📄';
  console.log(`   ${icon} ${item.name}`);
});

console.log('\n✅ 检查完成！\n');

