/**
 * 更新包验证器
 * 提供更新包的安全检测和版本验证
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export class UpdateValidator {
  /**
   * 比较版本号
   * @param {string} v1 - 版本1
   * @param {string} v2 - 版本2
   * @returns {number} 1: v1 > v2, 0: v1 = v2, -1: v1 < v2
   */
  static compareVersions(v1, v2) {
    const parts1 = v1.split('.').map(Number);
    const parts2 = v2.split('.').map(Number);
    
    const maxLength = Math.max(parts1.length, parts2.length);
    
    for (let i = 0; i < maxLength; i++) {
      const num1 = parts1[i] || 0;
      const num2 = parts2[i] || 0;
      
      if (num1 > num2) return 1;
      if (num1 < num2) return -1;
    }
    
    return 0;
  }

  /**
   * 检查是否为逆向更新（降级）
   * @param {string} currentVersion - 当前版本
   * @param {string} newVersion - 新版本
   * @returns {boolean}
   */
  static isDowngrade(currentVersion, newVersion) {
    return this.compareVersions(newVersion, currentVersion) < 0;
  }

  /**
   * 验证更新包结构
   * @param {string} serverPath - 解压后的 server 目录路径
   * @returns {Object}
   */
  static validatePackageStructure(serverPath) {
    const errors = [];
    const warnings = [];

    // 必须存在的关键文件
    const requiredFiles = [
      'package.json',
      'index.js',
      'init.js',
      'init-helper.js',
      'core/event-engine.js',
      'core/task-manager.js',
      'core/plugin-system/plugin-manager.js',
      'core/security-middleware.js',
      'core/session-manager.js',
      'config/security.json.template',
      'config/llonebot.json.template'
    ];

    for (const file of requiredFiles) {
      const filePath = path.join(serverPath, file);
      if (!fs.existsSync(filePath)) {
        errors.push(`缺少关键文件: ${file}`);
      }
    }

    // 必须存在的关键目录
    const requiredDirs = [
      'core',
      'config',
      'data',
      'utils'
    ];

    for (const dir of requiredDirs) {
      const dirPath = path.join(serverPath, dir);
      if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
        errors.push(`缺少关键目录: ${dir}`);
      }
    }

    // 检查嵌套结构（不应该存在）
    const forbiddenNested = [
      'server/server',
      'server/data/data',
      'server/core/core',
      'data/data',
      'core/core'
    ];

    for (const nested of forbiddenNested) {
      const nestedPath = path.join(serverPath, nested);
      if (fs.existsSync(nestedPath)) {
        errors.push(`发现错误的嵌套结构: ${nested}`);
      }
    }

    // 检查是否包含用户数据（不应该包含）
    const forbiddenUserData = [
      'config/security.json',
      'config/llonebot.json',
      'data/event-rules.json',
      'data/tasks.json'
    ];

    for (const file of forbiddenUserData) {
      const filePath = path.join(serverPath, file);
      if (fs.existsSync(filePath)) {
        warnings.push(`更新包包含用户数据文件: ${file}（将被忽略）`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * 读取更新包的元数据
   * @param {string} serverPath - 解压后的 server 目录路径
   * @returns {Object}
   */
  static readPackageMetadata(serverPath) {
    try {
      const packageJsonPath = path.join(serverPath, 'package.json');
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

      return {
        name: packageJson.name,
        version: packageJson.version,
        description: packageJson.description,
        dependencies: packageJson.dependencies || {},
        hasValidStructure: true
      };
    } catch (error) {
      throw new Error(`读取元数据失败: ${error.message}`);
    }
  }

  /**
   * 计算文件MD5哈希
   * @param {string} filePath - 文件路径
   * @returns {string}
   */
  static calculateFileMD5(filePath) {
    try {
      const fileBuffer = fs.readFileSync(filePath);
      const hash = crypto.createHash('md5');
      hash.update(fileBuffer);
      return hash.digest('hex');
    } catch (error) {
      throw new Error(`计算MD5失败: ${error.message}`);
    }
  }

  /**
   * 验证更新包名称
   * @param {string} filename - 文件名
   * @returns {Object}
   */
  static validatePackageName(filename) {
    // 标准格式: QQBot-vX.X.X.zip 或 KiBot-vX.X.X.zip
    const match = filename.match(/^(QQBot|KiBot)-v(\d+\.\d+\.\d+)\.zip$/i);
    
    if (!match) {
      return {
        valid: false,
        reason: '文件名格式不正确，应为: QQBot-vX.X.X.zip 或 KiBot-vX.X.X.zip'
      };
    }

    return {
      valid: true,
      productName: match[1],
      version: match[2]
    };
  }

  /**
   * 完整验证更新包
   * @param {string} zipPath - ZIP文件路径
   * @param {string} serverPath - 解压后的server目录
   * @param {string} currentVersion - 当前版本
   * @returns {Object}
   */
  static async validateUpdate(zipPath, serverPath, currentVersion) {
    const results = {
      valid: true,
      errors: [],
      warnings: [],
      metadata: null,
      checksum: null
    };

    try {
      // 1. 验证文件名
      const filename = path.basename(zipPath);
      const nameCheck = this.validatePackageName(filename);
      
      if (!nameCheck.valid) {
        results.warnings.push(nameCheck.reason);
      } else {
        results.metadata = {
          productName: nameCheck.productName,
          filenameVersion: nameCheck.version
        };
      }

      // 2. 计算ZIP文件的MD5
      results.checksum = this.calculateFileMD5(zipPath);

      // 3. 读取更新包元数据
      const metadata = this.readPackageMetadata(serverPath);
      results.metadata = { ...results.metadata, ...metadata };

      // 4. 验证结构完整性
      const structureCheck = this.validatePackageStructure(serverPath);
      results.errors.push(...structureCheck.errors);
      results.warnings.push(...structureCheck.warnings);

      // 5. 检查版本降级
      if (currentVersion && currentVersion !== '未知') {
        if (this.isDowngrade(currentVersion, metadata.version)) {
          results.errors.push(
            `禁止逆向更新（降级）: 当前版本 ${currentVersion} > 新版本 ${metadata.version}`
          );
        }

        // 相同版本给出警告
        if (this.compareVersions(currentVersion, metadata.version) === 0) {
          results.warnings.push(
            `版本相同: 当前版本和新版本都是 ${currentVersion}（将执行覆盖安装）`
          );
        }
      }

      // 6. 验证包名称一致性
      if (metadata.name !== 'kibot-websocket-server') {
        results.warnings.push(
          `包名称不匹配: 期望 'kibot-websocket-server'，实际 '${metadata.name}'`
        );
      }

      results.valid = results.errors.length === 0;

    } catch (error) {
      results.valid = false;
      results.errors.push(`验证失败: ${error.message}`);
    }

    return results;
  }

  /**
   * 生成更新报告
   * @param {Object} validationResult - 验证结果
   * @returns {string}
   */
  static generateReport(validationResult) {
    let report = '\n📋 更新包验证报告\n';
    report += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';

    if (validationResult.metadata) {
      report += '📦 包信息:\n';
      report += `   产品: ${validationResult.metadata.productName || '未知'}\n`;
      report += `   版本: ${validationResult.metadata.version}\n`;
      report += `   名称: ${validationResult.metadata.name}\n`;
      if (validationResult.checksum) {
        report += `   MD5: ${validationResult.checksum}\n`;
      }
      report += '\n';
    }

    if (validationResult.warnings.length > 0) {
      report += '⚠️  警告 (' + validationResult.warnings.length + '):\n';
      validationResult.warnings.forEach(warning => {
        report += `   • ${warning}\n`;
      });
      report += '\n';
    }

    if (validationResult.errors.length > 0) {
      report += '❌ 错误 (' + validationResult.errors.length + '):\n';
      validationResult.errors.forEach(error => {
        report += `   • ${error}\n`;
      });
      report += '\n';
    }

    if (validationResult.valid) {
      report += '✅ 验证通过，可以安全更新\n';
    } else {
      report += '❌ 验证失败，无法更新\n';
    }

    report += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';

    return report;
  }
}

export default UpdateValidator;

