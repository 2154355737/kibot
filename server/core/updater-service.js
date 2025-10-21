/**
 * 后端更新服务
 * 提供HTTP API接口用于前端调用更新功能
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { EventEmitter } from 'events';
import { UpdateValidator } from './update-validator.js';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class UpdaterService extends EventEmitter {
  /**
   * 获取当前版本
   */
  getCurrentVersion() {
    try {
      const packageJsonPath = path.resolve(__dirname, '../package.json');
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
      return packageJson.version || '未知';
    } catch (error) {
      return '未知';
    }
  }

  constructor() {
    super();
    this.isUpdating = false;
    this.updateProgress = {
      status: 'idle', // idle, uploading, extracting, backing-up, updating, installing, validating, completed, failed, rolling-back
      percent: 0,
      message: '',
      currentVersion: this.getCurrentVersion(),
      newVersion: '',
      logs: []
    };
    
    // 更新器目录（使用后端根目录下的 .updates）
    this.updaterDir = path.resolve(__dirname, '../.updates');
    this.packagesDir = path.join(this.updaterDir, 'packages');
    this.uploadsDir = path.join(this.updaterDir, 'uploads');
    
    this.initDirectories();
  }

  /**
   * 初始化必要的目录
   */
  initDirectories() {
    [this.packagesDir, this.uploadsDir].forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
  }

  /**
   * 添加日志
   */
  addLog(level, message) {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level,
      message
    };
    
    this.updateProgress.logs.push(logEntry);
    this.updateProgress.message = message;
    
    // 发送更新进度事件
    this.emit('progress', this.updateProgress);
    
    console.log(`[${level}] ${message}`);
  }

  /**
   * 更新进度
   */
  setProgress(status, percent, message) {
    this.updateProgress.status = status;
    this.updateProgress.percent = percent;
    if (message) {
      this.addLog('INFO', message);
    }
  }

  /**
   * 获取更新包的版本信息
   */
  async getPackageVersion(zipPath) {
    let tempDir = null;
    try {
      // 创建临时目录
      tempDir = path.join(this.uploadsDir, `temp-${Date.now()}`);
      fs.mkdirSync(tempDir, { recursive: true });

      // 解压整个 ZIP 文件（Windows tar 不支持 --wildcards）
      if (process.platform === 'win32') {
        // Windows: 使用 tar 解压整个 ZIP
        await execAsync(`tar -xf "${zipPath}" -C "${tempDir}"`);
      } else {
        // Unix/Linux: 使用 unzip
        await execAsync(`unzip -q "${zipPath}" -d "${tempDir}"`);
      }

      // 递归查找 server/package.json
      const findPackageJson = (dir) => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            // 优先查找 server 目录
            if (entry.name === 'server') {
              const pkgPath = path.join(fullPath, 'package.json');
              if (fs.existsSync(pkgPath)) {
                return pkgPath;
              }
            }
            // 递归查找
            const result = findPackageJson(fullPath);
            if (result) return result;
          }
        }
        return null;
      };

      const packageJsonPath = findPackageJson(tempDir);
      if (!packageJsonPath) {
        throw new Error('更新包中未找到 server/package.json');
      }

      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
      
      // 清理临时目录
      fs.rmSync(tempDir, { recursive: true, force: true });

      return {
        version: packageJson.version,
        name: packageJson.name,
        description: packageJson.description
      };
    } catch (error) {
      // 确保清理临时目录
      if (tempDir && fs.existsSync(tempDir)) {
        try {
          fs.rmSync(tempDir, { recursive: true, force: true });
        } catch (cleanupError) {
          console.error('清理临时目录失败:', cleanupError);
        }
      }
      throw new Error(`读取版本信息失败: ${error.message}`);
    }
  }

  /**
   * 处理上传的更新包
   */
  async handleUpload(file) {
    try {
      // 1. 检查文件类型
      if (!file.originalname.endsWith('.zip')) {
        throw new Error('只支持 .zip 格式的更新包');
      }

      // 2. 验证文件名格式
      const nameValidation = UpdateValidator.validatePackageName(file.originalname);
      if (!nameValidation.valid) {
        throw new Error(nameValidation.reason);
      }

      // 3. 保存上传的文件
      const timestamp = Date.now();
      const filename = `update-${timestamp}.zip`;
      const filepath = path.join(this.packagesDir, filename);

      // 将 buffer 写入文件
      fs.writeFileSync(filepath, file.buffer);

      // 4. 读取版本信息和验证
      const versionInfo = await this.getPackageVersion(filepath);

      // 5. 检查是否为降级更新
      const currentVersion = this.getCurrentVersion();
      if (UpdateValidator.isDowngrade(currentVersion, versionInfo.version)) {
        // 删除上传的文件
        fs.unlinkSync(filepath);
        throw new Error(
          `禁止逆向更新（降级）：当前版本 ${currentVersion} > 新版本 ${versionInfo.version}。` +
          `如需降级，请手动备份数据后重新安装。`
        );
      }

      return {
        success: true,
        filename,
        filepath,
        originalFilename: file.originalname,
        checksum: UpdateValidator.calculateFileMD5(filepath),
        ...versionInfo,
        ...nameValidation
      };
    } catch (error) {
      throw new Error(`上传失败: ${error.message}`);
    }
  }

  /**
   * 执行更新
   */
  async performUpdate(zipPath) {
    if (this.isUpdating) {
      throw new Error('更新正在进行中，请等待完成');
    }

    this.isUpdating = true;
    this.updateProgress = {
      status: 'starting',
      percent: 0,
      message: '',
      currentVersion: this.getCurrentVersion(),
      newVersion: '',
      logs: []
    };

    try {
      this.setProgress('starting', 5, '开始更新流程...');

      // 检查文件是否存在
      if (!fs.existsSync(zipPath)) {
        throw new Error('更新包文件不存在');
      }

      // 读取新版本信息
      this.setProgress('reading-version', 10, '读取版本信息...');
      const versionInfo = await this.getPackageVersion(zipPath);
      this.updateProgress.newVersion = versionInfo.version;

      // 调用更新器脚本
      this.setProgress('executing', 15, '启动更新器...');
      
      const updaterScript = path.resolve(__dirname, '../update-backend.js');
      
      // 使用 spawn 来实时获取输出
      const { spawn } = await import('child_process');
      
      return new Promise((resolve, reject) => {
        const updateProcess = spawn('node', [updaterScript, zipPath], {
          cwd: path.resolve(__dirname, '..'),
          env: process.env
        });

        let output = '';
        let errorOutput = '';

        // 监听标准输出
        updateProcess.stdout.on('data', (data) => {
          const text = data.toString();
          output += text;
          
          // 解析进度信息
          this.parseUpdateOutput(text);
        });

        // 监听错误输出
        updateProcess.stderr.on('data', (data) => {
          const text = data.toString();
          errorOutput += text;
          this.addLog('ERROR', text.trim());
        });

        // 监听进程结束
        updateProcess.on('close', (code) => {
          if (code === 0) {
            this.setProgress('completed', 100, '更新成功完成！');
            this.isUpdating = false;
            resolve({
              success: true,
              message: '更新成功',
              logs: this.updateProgress.logs
            });
          } else {
            this.setProgress('failed', 0, '更新失败');
            this.isUpdating = false;
            reject(new Error('更新失败: ' + errorOutput || '未知错误'));
          }
        });

        // 监听进程错误
        updateProcess.on('error', (error) => {
          this.setProgress('failed', 0, '更新失败: ' + error.message);
          this.isUpdating = false;
          reject(error);
        });
      });

    } catch (error) {
      this.setProgress('failed', 0, '更新失败: ' + error.message);
      this.isUpdating = false;
      throw error;
    }
  }

  /**
   * 解析更新器输出
   */
  parseUpdateOutput(text) {
    const lines = text.split('\n');
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // 解析不同的步骤
      if (trimmed.includes('正在解压更新包')) {
        this.setProgress('extracting', 20, '正在解压更新包...');
      } else if (trimmed.includes('正在备份当前版本')) {
        this.setProgress('backing-up', 30, '正在备份当前版本...');
      } else if (trimmed.includes('开始更新文件')) {
        this.setProgress('updating', 50, '正在更新文件...');
      } else if (trimmed.includes('正在安装/更新依赖')) {
        this.setProgress('installing', 70, '正在安装依赖...');
      } else if (trimmed.includes('正在验证更新')) {
        this.setProgress('validating', 90, '正在验证更新...');
      } else if (trimmed.includes('更新成功完成')) {
        this.setProgress('completed', 100, '更新成功完成！');
      } else if (trimmed.includes('正在回滚')) {
        this.setProgress('rolling-back', 0, '更新失败，正在回滚...');
      } else {
        // 其他日志
        this.addLog('INFO', trimmed);
      }
    }
  }

  /**
   * 获取更新状态
   */
  getUpdateStatus() {
    return {
      isUpdating: this.isUpdating,
      ...this.updateProgress,
      // 确保始终返回当前版本
      currentVersion: this.updateProgress.currentVersion || this.getCurrentVersion()
    };
  }

  /**
   * 获取备份列表
   */
  getBackupList() {
    try {
      const backupDir = path.join(this.updaterDir, 'backups');
      if (!fs.existsSync(backupDir)) {
        return [];
      }

      const backups = fs.readdirSync(backupDir)
        .filter(f => f.startsWith('server-backup-'))
        .map(f => {
          const fullPath = path.join(backupDir, f);
          const stats = fs.statSync(fullPath);
          
          // 解析备份名称获取版本号
          const match = f.match(/server-backup-(.+?)-(\d{4}-\d{2}-\d{2})/);
          
          return {
            name: f,
            version: match ? match[1] : '未知',
            date: stats.mtime,
            size: this.getDirectorySize(fullPath)
          };
        })
        .sort((a, b) => b.date.getTime() - a.date.getTime());

      return backups;
    } catch (error) {
      console.error('获取备份列表失败:', error);
      return [];
    }
  }

  /**
   * 获取更新日志列表
   */
  getUpdateLogs() {
    try {
      const logDir = path.join(this.updaterDir, 'logs');
      if (!fs.existsSync(logDir)) {
        return [];
      }

      const logs = fs.readdirSync(logDir)
        .filter(f => f.startsWith('update-') && f.endsWith('.log'))
        .map(f => {
          const fullPath = path.join(logDir, f);
          const stats = fs.statSync(fullPath);
          
          // 从文件名提取时间戳
          const match = f.match(/update-(\d+)\.log/);
          const timestamp = match ? parseInt(match[1]) : 0;
          
          return {
            filename: f,
            path: fullPath,
            date: new Date(timestamp),
            size: stats.size,
            timestamp
          };
        })
        .sort((a, b) => b.timestamp - a.timestamp);

      return logs;
    } catch (error) {
      console.error('获取更新日志列表失败:', error);
      return [];
    }
  }

  /**
   * 读取更新日志内容
   */
  getUpdateLogContent(filename) {
    try {
      const logPath = path.join(this.updaterDir, 'logs', filename);
      
      if (!fs.existsSync(logPath)) {
        throw new Error('日志文件不存在');
      }

      const content = fs.readFileSync(logPath, 'utf8');
      const lines = content.split('\n').filter(line => line.trim());

      // 解析日志行
      const parsedLogs = lines.map(line => {
        const match = line.match(/\[(.*?)\]\s*\[(.*?)\]\s*(.*)/);
        if (match) {
          return {
            timestamp: match[1],
            level: match[2],
            message: match[3]
          };
        }
        return {
          timestamp: '',
          level: 'INFO',
          message: line
        };
      });

      return {
        filename,
        content: parsedLogs,
        rawContent: content
      };
    } catch (error) {
      throw new Error(`读取日志失败: ${error.message}`);
    }
  }

  /**
   * 获取目录大小
   */
  getDirectorySize(dirPath) {
    let size = 0;
    
    const calculateSize = (currentPath) => {
      try {
        const stat = fs.statSync(currentPath);
        
        if (stat.isFile()) {
          size += stat.size;
        } else if (stat.isDirectory()) {
          const files = fs.readdirSync(currentPath);
          files.forEach(file => {
            calculateSize(path.join(currentPath, file));
          });
        }
      } catch (error) {
        // 忽略错误
      }
    };
    
    calculateSize(dirPath);
    return Math.round(size / 1024 / 1024 * 100) / 100; // MB
  }

  /**
   * 从备份恢复
   */
  async restoreFromBackup(backupName) {
    if (this.isUpdating) {
      throw new Error('更新正在进行中，无法恢复备份');
    }

    try {
      const backupPath = path.join(this.updaterDir, 'backups', backupName);
      if (!fs.existsSync(backupPath)) {
        throw new Error('备份不存在');
      }

      const serverDir = path.resolve(__dirname, '..');

      // 删除当前 server 目录（除了 node_modules）
      const items = fs.readdirSync(serverDir);
      items.forEach(item => {
        if (item !== 'node_modules') {
          const itemPath = path.join(serverDir, item);
          fs.rmSync(itemPath, { recursive: true, force: true });
        }
      });

      // 复制备份
      this.copyDirectory(backupPath, serverDir);

      return {
        success: true,
        message: '恢复成功'
      };
    } catch (error) {
      throw new Error(`恢复失败: ${error.message}`);
    }
  }

  /**
   * 复制目录
   */
  copyDirectory(src, dest) {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }

    const entries = fs.readdirSync(src, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      if (entry.isDirectory()) {
        this.copyDirectory(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }
}

// 导出单例
export const updaterService = new UpdaterService();
export default updaterService;

