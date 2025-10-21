/**
 * KiBot 后端智能更新器
 * 支持从 ZIP 包一键更新后端文件，自动保护用户数据和配置
 * 
 * 使用方法: node update-backend.js [zip文件路径]
 * 
 * 功能特性:
 * - ✅ 智能识别更新包
 * - ✅ 自动备份当前版本
 * - ✅ 保护用户数据和配置
 * - ✅ 更新失败自动回滚
 * - ✅ 依赖自动安装
 * - ✅ 详细的更新日志
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import chalk from 'chalk';
import { UpdateValidator } from './core/update-validator.js';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 更新器配置
const CONFIG = {
  // 后端根目录（当前目录）
  SERVER_DIR: __dirname,
  
  // 更新包存放目录
  UPDATE_DIR: path.join(__dirname, '.updates/packages'),
  
  // 备份目录
  BACKUP_DIR: path.join(__dirname, '.updates/backups'),
  
  // 日志目录
  LOG_DIR: path.join(__dirname, '.updates/logs'),
  
  // 最大备份保留数量
  MAX_BACKUPS: 5
};

// 需要保护的文件和目录（不会被更新覆盖）
const PROTECTED_ITEMS = [
  // 用户配置文件
  'config/security.json',
  'config/llonebot.json',
  
  // 用户数据
  'data/event-rules.json',
  'data/rule-groups.json',
  'data/monitor-stats.json',
  'data/tasks.json',
  'data/task-history.json',
  
  // 日志和监控数据
  'data/logs',
  'data/monitoring',
  
  // 插件配置和数据
  'data/plugins/plugin-configs.json',
  'data/plugins/*/storage.json',
  
  // 用户安装的插件（非发布包自带）
  'plugins/*',
  
  // node_modules（依赖会重新安装）
  'node_modules'
  
  // 注意：
  // - .updates 目录不需要保护，它只包含临时文件
  // - server/server 嵌套目录不应该被保护，应该被清理
];

// 更新日志类
class UpdateLogger {
  constructor(logFile) {
    this.logFile = logFile;
    this.logs = [];
  }

  log(level, message) {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] [${level}] ${message}`;
    this.logs.push(logEntry);
    
    // 同时输出到控制台和文件
    const colorMap = {
      'INFO': chalk.blue,
      'SUCCESS': chalk.green,
      'WARNING': chalk.yellow,
      'ERROR': chalk.red
    };
    const colorFn = colorMap[level] || chalk.white;
    console.log(colorFn(logEntry));
  }

  info(message) { this.log('INFO', message); }
  success(message) { this.log('SUCCESS', message); }
  warning(message) { this.log('WARNING', message); }
  error(message) { this.log('ERROR', message); }

  save() {
    try {
      fs.writeFileSync(this.logFile, this.logs.join('\n'), 'utf8');
    } catch (error) {
      console.error('保存日志失败:', error.message);
    }
  }
}

// 后端更新器类
class BackendUpdater {
  constructor() {
    this.logger = null;
    this.tempDir = null;
    this.backupPath = null;
    this.updateInfo = null;
  }

  /**
   * 初始化更新器
   */
  async initialize() {
    console.log(chalk.cyan.bold('\n╔════════════════════════════════════════════════════════╗'));
    console.log(chalk.cyan.bold('║         🚀 KiBot 后端智能更新器 v1.0.0              ║'));
    console.log(chalk.cyan.bold('╚════════════════════════════════════════════════════════╝\n'));

    // 创建必要的目录
    [CONFIG.UPDATE_DIR, CONFIG.BACKUP_DIR, CONFIG.LOG_DIR].forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });

    // 初始化日志
    const logFile = path.join(CONFIG.LOG_DIR, `update-${Date.now()}.log`);
    this.logger = new UpdateLogger(logFile);
    this.logger.info('更新器初始化完成');
  }

  /**
   * 查找更新包
   */
  findUpdatePackage(specifiedPath = null) {
    this.logger.info('正在查找更新包...');

    // 如果指定了路径，使用指定的zip文件
    if (specifiedPath) {
      const fullPath = path.isAbsolute(specifiedPath) 
        ? specifiedPath 
        : path.join(process.cwd(), specifiedPath);
      
      if (!fs.existsSync(fullPath)) {
        throw new Error(`指定的更新包不存在: ${fullPath}`);
      }
      this.logger.success(`找到指定更新包: ${fullPath}`);
      return fullPath;
    }

    // 否则在 .updates/packages 目录查找最新的 zip 文件
    const files = fs.readdirSync(CONFIG.UPDATE_DIR)
      .filter(f => f.endsWith('.zip'))
      .map(f => ({
        name: f,
        path: path.join(CONFIG.UPDATE_DIR, f),
        time: fs.statSync(path.join(CONFIG.UPDATE_DIR, f)).mtime.getTime()
      }))
      .sort((a, b) => b.time - a.time);

    if (files.length === 0) {
      throw new Error(`未在 ${CONFIG.UPDATE_DIR} 目录找到更新包(.zip文件)\n请将更新包放入该目录或使用: node update-backend.js <zip文件路径>`);
    }

    const latestPackage = files[0];
    this.logger.success(`找到最新更新包: ${latestPackage.name}`);
    return latestPackage.path;
  }

  /**
   * 解压更新包
   */
  async extractPackage(zipPath) {
    this.logger.info('正在解压更新包...');
    
    this.tempDir = path.join(CONFIG.UPDATE_DIR, `temp-${Date.now()}`);
    fs.mkdirSync(this.tempDir, { recursive: true });

    try {
      // Windows 使用 tar 命令解压
      if (process.platform === 'win32') {
        await execAsync(`tar -xf "${zipPath}" -C "${this.tempDir}"`);
      } else {
        // Unix/Linux 使用 unzip
        await execAsync(`unzip -q "${zipPath}" -d "${this.tempDir}"`);
      }

      this.logger.success('更新包解压完成');

      // 查找解压后的 server 目录
      const extracted = fs.readdirSync(this.tempDir);
      
      // 可能是 QQBot-vX.X.X/server 这样的结构
      let serverPath = null;
      for (const item of extracted) {
        const itemPath = path.join(this.tempDir, item);
        if (fs.statSync(itemPath).isDirectory()) {
          const possibleServerPath = path.join(itemPath, 'server');
          if (fs.existsSync(possibleServerPath)) {
            serverPath = possibleServerPath;
            break;
          }
        }
      }

      if (!serverPath) {
        throw new Error('更新包格式错误：未找到 server 目录');
      }

      return serverPath;

    } catch (error) {
      // 清理临时目录
      if (fs.existsSync(this.tempDir)) {
        fs.rmSync(this.tempDir, { recursive: true, force: true });
      }
      throw error;
    }
  }

  /**
   * 读取版本信息
   */
  readVersionInfo(serverPath) {
    this.logger.info('正在读取版本信息...');

    try {
      const packageJsonPath = path.join(serverPath, 'package.json');
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
      
      const currentPackageJsonPath = path.join(CONFIG.SERVER_DIR, 'package.json');
      const currentPackageJson = fs.existsSync(currentPackageJsonPath)
        ? JSON.parse(fs.readFileSync(currentPackageJsonPath, 'utf8'))
        : { version: '未知' };

      this.updateInfo = {
        newVersion: packageJson.version,
        currentVersion: currentPackageJson.version,
        packageName: packageJson.name
      };

      this.logger.success(`当前版本: ${this.updateInfo.currentVersion}`);
      this.logger.success(`新版本: ${this.updateInfo.newVersion}`);

      return this.updateInfo;
    } catch (error) {
      this.logger.error('读取版本信息失败: ' + error.message);
      throw error;
    }
  }

  /**
   * 创建备份
   */
  async createBackup() {
    this.logger.info('正在备份当前版本...');

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupName = `server-backup-${this.updateInfo.currentVersion}-${timestamp}`;
    this.backupPath = path.join(CONFIG.BACKUP_DIR, backupName);

    try {
      // 先清理可能存在的错误嵌套结构
      this.cleanNestedStructures();
      
      // 复制整个 server 目录
      // excludeDirs 会自动排除：.updates, node_modules, server, 以及所有 . 开头和 temp- 开头的目录
      this.copyDirectory(CONFIG.SERVER_DIR, this.backupPath, ['server']);
      this.logger.success(`备份完成: ${backupName}`);

      // 清理旧备份
      this.cleanOldBackups();

    } catch (error) {
      this.logger.error('备份失败: ' + error.message);
      throw error;
    }
  }

  /**
   * 清理旧备份
   */
  cleanOldBackups() {
    try {
      const backups = fs.readdirSync(CONFIG.BACKUP_DIR)
        .filter(f => f.startsWith('server-backup-'))
        .map(f => ({
          name: f,
          path: path.join(CONFIG.BACKUP_DIR, f),
          time: fs.statSync(path.join(CONFIG.BACKUP_DIR, f)).mtime.getTime()
        }))
        .sort((a, b) => b.time - a.time);

      // 保留最新的几个备份
      if (backups.length > CONFIG.MAX_BACKUPS) {
        const toDelete = backups.slice(CONFIG.MAX_BACKUPS);
        toDelete.forEach(backup => {
          this.logger.info(`删除旧备份: ${backup.name}`);
          fs.rmSync(backup.path, { recursive: true, force: true });
        });
      }
    } catch (error) {
      this.logger.warning('清理旧备份失败: ' + error.message);
    }
  }

  /**
   * 清理错误的嵌套结构
   */
  cleanNestedStructures() {
    this.logger.info('检查并清理错误的嵌套结构...');
    
    const nestedDirs = ['server/server', 'server/data/data', 'server/core/core'];
    let cleanedCount = 0;
    
    nestedDirs.forEach(nestedPath => {
      const fullPath = path.join(CONFIG.SERVER_DIR, nestedPath);
      if (fs.existsSync(fullPath)) {
        this.logger.warning(`发现错误的嵌套目录: ${nestedPath}`);
        try {
          fs.rmSync(fullPath, { recursive: true, force: true });
          this.logger.success(`已清理: ${nestedPath}`);
          cleanedCount++;
        } catch (error) {
          this.logger.error(`清理失败 ${nestedPath}: ${error.message}`);
        }
      }
    });
    
    if (cleanedCount > 0) {
      this.logger.success(`清理了 ${cleanedCount} 个错误的嵌套目录`);
    } else {
      this.logger.info('未发现嵌套结构问题');
    }
  }

  /**
   * 执行更新
   */
  async performUpdate(newServerPath) {
    this.logger.info('开始更新文件...');

    try {
      // 0. 清理错误的嵌套结构
      this.cleanNestedStructures();
      
      // 1. 收集需要保护的文件
      const protectedFiles = this.collectProtectedFiles();
      this.logger.info(`找到 ${protectedFiles.length} 个受保护的文件/目录`);

      // 2. 临时保存受保护的文件
      this.logger.info('正在保护用户数据...');
      const tempProtectedDir = path.join(this.tempDir, 'protected');
      fs.mkdirSync(tempProtectedDir, { recursive: true });
      
      let protectedCount = 0;
      protectedFiles.forEach(file => {
        const srcPath = path.join(CONFIG.SERVER_DIR, file);
        const destPath = path.join(tempProtectedDir, file);
        
        // 双重检查：绝不保护 .updates 和临时目录
        if (file.includes('.updates') || file.includes('temp-') || file === 'server') {
          this.logger.warning(`跳过危险路径: ${file}`);
          return;
        }
        
        if (fs.existsSync(srcPath)) {
          this.logger.info(`保护文件 ${protectedCount + 1}/${protectedFiles.length}: ${file}`);
          
          const destDir = path.dirname(destPath);
          if (!fs.existsSync(destDir)) {
            fs.mkdirSync(destDir, { recursive: true });
          }
          
          if (fs.statSync(srcPath).isDirectory()) {
            // 使用安全的复制，避免递归
            this.copyDirectorySafe(srcPath, destPath);
          } else {
            fs.copyFileSync(srcPath, destPath);
          }
          protectedCount++;
        }
      });
      
      this.logger.success(`已保护 ${protectedCount} 个文件/目录`);

      // 3. 删除旧的文件（除了受保护的）
      this.logger.info('清理旧文件...');
      const items = fs.readdirSync(CONFIG.SERVER_DIR);
      let deletedCount = 0;
      items.forEach(item => {
        if (!['node_modules', '.updates'].includes(item)) {
          this.logger.info(`删除: ${item}`);
          const itemPath = path.join(CONFIG.SERVER_DIR, item);
          fs.rmSync(itemPath, { recursive: true, force: true });
          deletedCount++;
        }
      });
      this.logger.success(`已删除 ${deletedCount} 个项目`);

      // 4. 复制新文件
      this.logger.info('复制新文件...');
      this.logger.info(`源目录: ${newServerPath}`);
      this.logger.info(`目标目录: ${CONFIG.SERVER_DIR}`);
      this.copyDirectory(newServerPath, CONFIG.SERVER_DIR);
      this.logger.success('新文件复制完成');

      // 5. 恢复受保护的文件
      this.logger.info('恢复受保护的文件...');
      let restoredCount = 0;
      protectedFiles.forEach(file => {
        const srcPath = path.join(tempProtectedDir, file);
        const destPath = path.join(CONFIG.SERVER_DIR, file);
        
        if (fs.existsSync(srcPath)) {
          this.logger.info(`恢复 ${restoredCount + 1}/${protectedFiles.length}: ${file}`);
          
          const destDir = path.dirname(destPath);
          if (!fs.existsSync(destDir)) {
            fs.mkdirSync(destDir, { recursive: true });
          }
          
          if (fs.statSync(srcPath).isDirectory()) {
            // 先删除新版本的对应目录
            if (fs.existsSync(destPath)) {
              fs.rmSync(destPath, { recursive: true, force: true });
            }
            this.copyDirectory(srcPath, destPath);
          } else {
            fs.copyFileSync(srcPath, destPath);
          }
          restoredCount++;
        }
      });

      this.logger.success(`文件更新完成，已恢复 ${restoredCount} 个文件/目录`);

    } catch (error) {
      this.logger.error('更新失败: ' + error.message);
      throw error;
    }
  }

  /**
   * 收集受保护的文件
   */
  collectProtectedFiles() {
    const protectedFiles = new Set();
    
    // 绝对禁止保护的目录（避免递归复制）
    const FORBIDDEN_PROTECT = ['.updates', 'server', 'temp-'];

    PROTECTED_ITEMS.forEach(pattern => {
      // 检查是否在禁止列表中
      const isForbidden = FORBIDDEN_PROTECT.some(forbidden => 
        pattern.includes(forbidden)
      );
      
      if (isForbidden) {
        this.logger.warning(`跳过禁止保护的项: ${pattern}`);
        return;
      }
      
      // 处理通配符
      if (pattern.includes('*')) {
        const basePath = pattern.split('*')[0];
        const baseFullPath = path.join(CONFIG.SERVER_DIR, basePath);
        
        if (fs.existsSync(baseFullPath)) {
          this.findMatchingFiles(baseFullPath, pattern, protectedFiles);
        }
      } else {
        // 精确匹配
        const fullPath = path.join(CONFIG.SERVER_DIR, pattern);
        if (fs.existsSync(fullPath)) {
          protectedFiles.add(pattern);
        }
      }
    });

    return Array.from(protectedFiles);
  }

  /**
   * 查找匹配通配符的文件
   */
  findMatchingFiles(basePath, pattern, results) {
    try {
      const entries = fs.readdirSync(basePath, { withFileTypes: true });
      
      entries.forEach(entry => {
        const fullPath = path.join(basePath, entry.name);
        const relativePath = path.relative(CONFIG.SERVER_DIR, fullPath);
        
        // 简单的通配符匹配
        if (this.matchPattern(relativePath, pattern)) {
          results.add(relativePath);
        }
        
        // 递归处理子目录
        if (entry.isDirectory()) {
          this.findMatchingFiles(fullPath, pattern, results);
        }
      });
    } catch (error) {
      // 忽略错误
    }
  }

  /**
   * 简单的通配符匹配
   */
  matchPattern(str, pattern) {
    const regex = new RegExp(
      '^' + pattern.replace(/\*/g, '.*').replace(/\//g, '\\/') + '$'
    );
    return regex.test(str);
  }

  /**
   * 安装依赖
   */
  async installDependencies() {
    this.logger.info('正在安装/更新依赖...');

    try {
      const { stdout, stderr } = await execAsync('npm install', {
        cwd: CONFIG.SERVER_DIR,
        env: { ...process.env, NODE_ENV: 'production' }
      });

      if (stdout) this.logger.info(stdout.trim());
      if (stderr) this.logger.warning(stderr.trim());
      
      this.logger.success('依赖安装完成');
    } catch (error) {
      this.logger.error('依赖安装失败: ' + error.message);
      throw error;
    }
  }

  /**
   * 验证更新
   */
  async validateUpdate() {
    this.logger.info('正在验证更新...');

    try {
      // 检查关键文件
      const criticalFiles = [
        'package.json',
        'index.js',
        'init.js',
        'core/event-engine.js',
        'core/plugin-system/plugin-manager.js'
      ];

      for (const file of criticalFiles) {
        const filePath = path.join(CONFIG.SERVER_DIR, file);
        if (!fs.existsSync(filePath)) {
          throw new Error(`关键文件缺失: ${file}`);
        }
      }

      // 检查版本号
      const packageJson = JSON.parse(
        fs.readFileSync(path.join(CONFIG.SERVER_DIR, 'package.json'), 'utf8')
      );

      if (packageJson.version !== this.updateInfo.newVersion) {
        throw new Error('版本号验证失败');
      }

      // 检查是否存在错误的嵌套结构
      const nestedDirs = ['server/server', 'server/data/data', 'server/core/core'];
      const foundNested = [];
      
      nestedDirs.forEach(nestedPath => {
        const fullPath = path.join(CONFIG.SERVER_DIR, nestedPath);
        if (fs.existsSync(fullPath)) {
          foundNested.push(nestedPath);
        }
      });
      
      if (foundNested.length > 0) {
        this.logger.error(`发现错误的嵌套结构: ${foundNested.join(', ')}`);
        throw new Error(`更新包包含错误的嵌套结构: ${foundNested.join(', ')}`);
      }

      this.logger.success('更新验证通过');
      return true;

    } catch (error) {
      this.logger.error('验证失败: ' + error.message);
      throw error;
    }
  }

  /**
   * 回滚更新
   */
  async rollback() {
    this.logger.warning('正在回滚到之前的版本...');

    try {
      if (!this.backupPath || !fs.existsSync(this.backupPath)) {
        throw new Error('备份不存在，无法回滚');
      }

      // 删除当前的文件
      const items = fs.readdirSync(CONFIG.SERVER_DIR);
      items.forEach(item => {
        if (!['node_modules', '.updates'].includes(item)) {
          const itemPath = path.join(CONFIG.SERVER_DIR, item);
          fs.rmSync(itemPath, { recursive: true, force: true });
        }
      });

      // 恢复备份
      this.copyDirectory(this.backupPath, CONFIG.SERVER_DIR);

      this.logger.success('回滚完成');
    } catch (error) {
      this.logger.error('回滚失败: ' + error.message);
      throw error;
    }
  }

  /**
   * 清理临时文件
   */
  cleanup() {
    this.logger.info('清理临时文件...');

    try {
      if (this.tempDir && fs.existsSync(this.tempDir)) {
        fs.rmSync(this.tempDir, { recursive: true, force: true });
      }
      this.logger.success('清理完成');
    } catch (error) {
      this.logger.warning('清理失败: ' + error.message);
    }
  }

  /**
   * 安全复制目录（避免递归复制）
   */
  copyDirectorySafe(src, dest) {
    // 防止递归复制：检查目标路径是否在源路径内部
    const normalizedSrc = path.normalize(src);
    const normalizedDest = path.normalize(dest);
    
    if (normalizedDest.startsWith(normalizedSrc + path.sep)) {
      this.logger.warning(`⚠️ 阻止递归复制: ${dest} 在 ${src} 内部`);
      return;
    }
    
    if (normalizedSrc === normalizedDest) {
      this.logger.warning(`⚠️ 阻止自我复制: ${src}`);
      return;
    }
    
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }

    const entries = fs.readdirSync(src, { withFileTypes: true });

    for (const entry of entries) {
      // 严格跳过所有隐藏目录和临时目录
      if (entry.name.startsWith('.') || entry.name.startsWith('temp-')) {
        continue;
      }

      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      if (entry.isDirectory()) {
        this.copyDirectorySafe(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }

  /**
   * 复制目录
   */
  copyDirectory(src, dest, excludeDirs = []) {
    // 防止递归复制：检查目标路径是否在源路径内部
    const normalizedSrc = path.normalize(src);
    const normalizedDest = path.normalize(dest);
    
    if (normalizedDest.startsWith(normalizedSrc + path.sep)) {
      this.logger.warning(`⚠️ 阻止递归复制: ${dest} 在 ${src} 内部`);
      return;
    }
    
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }

    const entries = fs.readdirSync(src, { withFileTypes: true });

    for (const entry of entries) {
      // 跳过排除的目录、隐藏目录和临时目录
      if (excludeDirs.includes(entry.name) || entry.name.startsWith('.') || entry.name.startsWith('temp-')) {
        continue;
      }

      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      if (entry.isDirectory()) {
        this.copyDirectory(srcPath, destPath, excludeDirs);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }

  /**
   * 执行完整更新流程
   */
  async run(zipPath = null) {
    try {
      await this.initialize();

      // 1. 查找更新包
      const packagePath = this.findUpdatePackage(zipPath);

      // 2. 解压更新包
      const newServerPath = await this.extractPackage(packagePath);

      // 3. 读取版本信息
      await this.readVersionInfo(newServerPath);

      // 4. 验证更新包
      this.logger.info('正在验证更新包...');
      const validation = await UpdateValidator.validateUpdate(
        packagePath,
        newServerPath,
        this.updateInfo.currentVersion
      );

      // 显示验证报告
      const report = UpdateValidator.generateReport(validation);
      console.log(chalk.cyan(report));

      // 如果验证失败，终止更新
      if (!validation.valid) {
        this.logger.error('更新包验证失败，无法继续更新');
        validation.errors.forEach(error => {
          this.logger.error(`  • ${error}`);
        });
        throw new Error('更新包验证失败');
      }

      // 如果有警告，显示但继续
      if (validation.warnings.length > 0) {
        validation.warnings.forEach(warning => {
          this.logger.warning(`  • ${warning}`);
        });
      }

      this.logger.success('更新包验证通过');

      // 5. 确认更新
      console.log(chalk.yellow('\n⚠️  即将执行更新操作:'));
      console.log(chalk.white(`   当前版本: ${this.updateInfo.currentVersion}`));
      console.log(chalk.white(`   新版本: ${this.updateInfo.newVersion}`));
      console.log(chalk.white(`   更新包: ${path.basename(packagePath)}`));
      console.log(chalk.white(`   MD5: ${validation.checksum}\n`));
      
      // 6. 创建备份
      await this.createBackup();

      // 7. 执行更新
      await this.performUpdate(newServerPath);

      // 8. 安装依赖
      await this.installDependencies();

      // 9. 验证更新结果
      await this.validateUpdate();

      // 10. 清理临时文件
      this.cleanup();

      // 11. 完成
      console.log(chalk.green.bold('\n╔════════════════════════════════════════════════════════╗'));
      console.log(chalk.green.bold('║              ✅ 更新成功完成！                        ║'));
      console.log(chalk.green.bold('╚════════════════════════════════════════════════════════╝\n'));

      console.log(chalk.white('📊 更新摘要:'));
      console.log(chalk.white(`   版本: ${this.updateInfo.currentVersion} → ${this.updateInfo.newVersion}`));
      console.log(chalk.white(`   备份: ${path.basename(this.backupPath)}`));
      console.log(chalk.white(`   日志: ${path.basename(this.logger.logFile)}\n`));

      console.log(chalk.cyan('🚀 下一步:'));
      console.log(chalk.white('   重启后端服务: npm start'));
      console.log(chalk.white('   检查日志确认正常运行'));
      console.log(chalk.white('   如有问题可使用备份回滚\n'));

      this.logger.success('更新流程全部完成');
      this.logger.save();

      return true;

    } catch (error) {
      this.logger.error('更新失败: ' + error.message);
      
      // 尝试回滚
      if (this.backupPath) {
        try {
          await this.rollback();
          console.log(chalk.yellow('\n⚠️  已回滚到之前的版本'));
        } catch (rollbackError) {
          console.log(chalk.red('\n❌ 回滚失败: ' + rollbackError.message));
          console.log(chalk.red('   请手动从备份恢复: ' + this.backupPath));
        }
      }

      this.cleanup();
      this.logger.save();

      console.log(chalk.red('\n╔════════════════════════════════════════════════════════╗'));
      console.log(chalk.red('║              ❌ 更新失败                              ║'));
      console.log(chalk.red('╚════════════════════════════════════════════════════════╝\n'));
      console.log(chalk.red('错误详情: ' + error.message));
      console.log(chalk.white('日志文件: ' + this.logger.logFile + '\n'));

      return false;
    }
  }
}

// 主函数
async function main() {
  const args = process.argv.slice(2);
  const zipPath = args[0] || null;

  const updater = new BackendUpdater();
  const success = await updater.run(zipPath);

  process.exit(success ? 0 : 1);
}

// 运行
main();

