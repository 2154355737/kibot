/**
 * 独立初始化/重置脚本
 * 使用方法：npm run init
 */

import { runInteractiveInitialization } from './init-helper.js';

console.log('🔧 KiBot 配置工具\n');

const args = process.argv.slice(2);
const isReset = args.includes('--reset') || args.includes('-r');

if (isReset) {
  console.log('⚠️  这将重置所有配置文件！\n');
}

runInteractiveInitialization(isReset).then((success) => {
  if (success) {
    console.log('✅ 配置完成！');
    console.log('💡 运行 npm start 启动服务器\n');
    process.exit(0);
  } else {
    console.error('❌ 配置失败\n');
    process.exit(1);
  }
}).catch((error) => {
  console.error('❌ 发生错误:', error);
  process.exit(1);
});
