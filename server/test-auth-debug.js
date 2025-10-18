// 授权码调试脚本
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log('=== 授权码调试工具 ===\n');

// 读取配置文件
const configPath = path.join(__dirname, 'config', 'security.json');
console.log('📂 配置文件路径:', configPath);
console.log('📂 文件是否存在:', fs.existsSync(configPath));

if (!fs.existsSync(configPath)) {
  console.error('❌ 配置文件不存在！');
  process.exit(1);
}

// 读取并解析配置
const configContent = fs.readFileSync(configPath, 'utf8');
console.log('\n📄 配置文件原始内容:');
console.log(configContent);

const securityConfig = JSON.parse(configContent);
const authCodes = securityConfig.authCodes;

console.log('\n🔑 授权码列表:');
for (const [role, code] of Object.entries(authCodes)) {
  console.log(`  ${role}:`);
  console.log(`    - 值: "${code}"`);
  console.log(`    - 长度: ${code.length}`);
  console.log(`    - 字节: [${Buffer.from(code).toString('hex')}]`);
  console.log(`    - 是否包含空格: ${code.includes(' ') ? '是' : '否'}`);
  console.log(`    - trim后: "${code.trim()}"`);
  console.log(`    - trim后长度: ${code.trim().length}`);
}

// 测试授权码
const testCode = 'ahk12378dxdxdx';
console.log(`\n🧪 测试授权码: "${testCode}"`);
console.log(`   长度: ${testCode.length}`);

let matched = false;
for (const [role, code] of Object.entries(authCodes)) {
  console.log(`\n   检查 ${role}:`);
  console.log(`     配置: "${code}"`);
  console.log(`     测试: "${testCode}"`);
  console.log(`     严格相等 (===): ${code === testCode}`);
  console.log(`     trim后相等: ${code.trim() === testCode.trim()}`);
  
  if (code === testCode) {
    console.log(`     ✅ 匹配成功！角色: ${role}`);
    matched = true;
    break;
  }
}

if (!matched) {
  console.log('\n❌ 没有找到匹配的授权码');
  console.log('\n可能的原因:');
  console.log('  1. 授权码中包含不可见字符（空格、换行等）');
  console.log('  2. 编码问题（UTF-8 BOM等）');
  console.log('  3. 配置文件被意外修改');
  console.log('\n💡 建议修复方案:');
  console.log('  修改后端代码，在比较前先trim():');
  console.log('  if (code.trim() === auth_code.trim()) { ... }');
}

console.log('\n=== 调试完成 ===');

