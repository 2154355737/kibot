// 后端用户API服务
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// ES模块中获取__dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 加载 LLOneBot 配置
function loadLLOneBotConfig() {
  const configPath = path.join(__dirname, '..', 'config', 'llonebot.json');
  const templatePath = path.join(__dirname, '..', 'config', 'llonebot.json.template');
  
  try {
    if (fs.existsSync(configPath)) {
      const configData = fs.readFileSync(configPath, 'utf8');
      return JSON.parse(configData);
    } else if (fs.existsSync(templatePath)) {
      const templateData = fs.readFileSync(templatePath, 'utf8');
      return JSON.parse(templateData);
    } else {
      return {
        apiUrl: 'http://localhost:3000',
        accessToken: ''
      };
    }
  } catch (error) {
    console.error('加载 LLOneBot 配置失败:', error);
    return {
      apiUrl: 'http://localhost:3000',
      accessToken: ''
    };
  }
}

const llonebotConfig = loadLLOneBotConfig();

// 获取配置
const CONFIG = {
  LLONEBOT_API_URL: llonebotConfig.apiUrl,
  LLONEBOT_ACCESS_TOKEN: llonebotConfig.accessToken
};

class UserApiService {
  constructor(wsClient) {
    this.wsClient = wsClient; // WebSocket连接，用于调用API
    this.apiCommands = this.getApiCommands();
  }

  // 基础API请求方法
  async request(action, params = {}) {
    try {
      console.log(`🚀 后端调用API: ${action}`, params);
      
      // 只使用WebSocket调用（不支持HTTP）
      if (!this.wsClient || this.wsClient.readyState !== 1) {
        throw new Error('WebSocket未连接，无法调用API');
      }
      
      return await this.callViaWebSocket(action, params);
    } catch (error) {
      console.error(`❌ API调用失败 (${action}):`, error);
      throw error;
    }
  }

  // 通过WebSocket调用API
  async callViaWebSocket(action, params) {
    console.log(`🔧 用户API服务调用: ${action}`, params);
    
    if (!this.mainServer) {
      throw new Error('主服务器未设置');
    }
    
    // 检查是否是规则管理API
    if (action.startsWith('rules_')) {
      console.log(`📋 用户API服务调用规则API: ${action}`);
      return await this.mainServer.handleRulesApi(action, params);
    }
    
    // 检查是否是分组管理API
    if (action.startsWith('groups_')) {
      console.log(`📂 用户API服务调用分组API: ${action}`);
      return await this.mainServer.handleRulesApi(action, params);
    }

    // 检查是否是后端内部API (现在主要是internal_开头的API)
    if (action.startsWith('internal_')) {
      console.log(`🔧 用户API服务调用后端内部API: ${action}`);
      return await this.mainServer.handleRulesApi(action, params);
    }
    
    // LLOneBot API调用
    if (!this.mainServer.callLLOneBotViaWebSocket) {
      throw new Error('WebSocket调用方法不可用');
    }
    console.log(`📡 用户API服务调用LLOneBot API: ${action}`);
    return await this.mainServer.callLLOneBotViaWebSocket(action, params);
  }

  // 通过HTTP调用API
  async callViaHttp(action, params) {
    try {
      let url = `${CONFIG.LLONEBOT_API_URL}/${action}`;
      const urlObj = new URL(url);
      
      const headers = {
        'User-Agent': 'KiBot-Backend/1.0'
      };
      
      if (CONFIG.LLONEBOT_ACCESS_TOKEN) {
        headers['Authorization'] = `Bearer ${CONFIG.LLONEBOT_ACCESS_TOKEN}`;
        headers['access_token'] = CONFIG.LLONEBOT_ACCESS_TOKEN;
        headers['X-Access-Token'] = CONFIG.LLONEBOT_ACCESS_TOKEN;
        urlObj.searchParams.set('access_token', CONFIG.LLONEBOT_ACCESS_TOKEN);
      }
      
      let response;
      
      if (action === 'get_login_info') {
        response = await axios.get(urlObj.toString(), {
          timeout: 15000,
          headers,
          validateStatus: function (status) {
            return status < 500;
          }
        });
      } else {
        headers['Content-Type'] = 'application/json';
        response = await axios.post(urlObj.toString(), params, {
          timeout: 15000,
          headers,
          validateStatus: function (status) {
            return status < 500;
          }
        });
      }
      
      if (response.status >= 400) {
        throw new Error(`LLOneBot API返回错误状态: ${response.status} ${response.statusText}`);
      }
      
      console.log(`✅ API调用成功: ${action}`);
      return response.data;
      
    } catch (error) {
      let errorMessage;
      
      if (error.code === 'ECONNREFUSED') {
        errorMessage = `无法连接到LLOneBot API (${CONFIG.LLONEBOT_API_URL})`;
      } else if (error.code === 'ETIMEDOUT') {
        errorMessage = `LLOneBot API请求超时`;
      } else {
        errorMessage = `LLOneBot API调用失败: ${error.message}`;
      }
      
      console.error(`❌ ${errorMessage}`);
      throw new Error(errorMessage);
    }
  }

  // 获取API指令定义
  getApiCommands() {
    return [
      {
        id: 'get_user_info',
        name: '获取用户信息',
        description: '获取指定用户的详细信息',
        category: 'user',
        args: [
          { name: 'user_id', type: 'number', description: '用户QQ号', required: true }
        ],
        action: 'get_user_info'
      },
      {
        id: 'send_like',
        name: '点赞',
        description: '给指定用户点赞',
        category: 'user',
        args: [
          { name: 'user_id', type: 'number', description: '用户QQ号', required: true },
          { name: 'times', type: 'number', description: '点赞次数', required: false, default: 1 }
        ],
        action: 'send_like'
      },
      {
        id: 'delete_friend',
        name: '删除好友',
        description: '删除指定好友',
        category: 'friend',
        args: [
          { name: 'user_id', type: 'number', description: '好友QQ号', required: true }
        ],
        action: 'delete_friend'
      },
      {
        id: 'approve_friend_request',
        name: '处理好友申请',
        description: '同意或拒绝好友申请',
        category: 'friend',
        args: [
          { name: 'flag', type: 'string', description: '请求flag', required: true },
          { name: 'approve', type: 'boolean', description: '是否同意', required: true },
          { name: 'remark', type: 'string', description: '好友备注', required: false }
        ],
        action: 'set_friend_add_request'
      },
      {
        id: 'set_group_card',
        name: '设置群名片',
        description: '设置群成员名片',
        category: 'group',
        args: [
          { name: 'group_id', type: 'number', description: '群号', required: true },
          { name: 'user_id', type: 'number', description: '用户QQ号', required: true },
          { name: 'card', type: 'string', description: '群名片', required: true }
        ],
        action: 'set_group_card'
      },
      {
        id: 'set_group_ban',
        name: '群组禁言',
        description: '禁言或解除禁言群成员',
        category: 'group',
        args: [
          { name: 'group_id', type: 'number', description: '群号', required: true },
          { name: 'user_id', type: 'number', description: '用户QQ号', required: true },
          { name: 'duration', type: 'number', description: '禁言时长(秒)', required: false, default: 0 }
        ],
        action: 'set_group_ban'
      },
      {
        id: 'set_group_kick',
        name: '群组踢人',
        description: '将成员踢出群聊',
        category: 'group',
        args: [
          { name: 'group_id', type: 'number', description: '群号', required: true },
          { name: 'user_id', type: 'number', description: '用户QQ号', required: true },
          { name: 'reject_add_request', type: 'boolean', description: '拒绝此人的加群请求', required: false, default: false }
        ],
        action: 'set_group_kick'
      },
      {
        id: 'set_group_admin',
        name: '设置群管理员',
        description: '设置或取消群管理员',
        category: 'group',
        args: [
          { name: 'group_id', type: 'number', description: '群号', required: true },
          { name: 'user_id', type: 'number', description: '用户QQ号', required: true },
          { name: 'enable', type: 'boolean', description: '是否设置为管理员', required: true }
        ],
        action: 'set_group_admin'
      },
      {
        id: 'set_group_special_title',
        name: '设置群专属头衔',
        description: '设置群成员专属头衔',
        category: 'group',
        args: [
          { name: 'group_id', type: 'number', description: '群号', required: true },
          { name: 'user_id', type: 'number', description: '用户QQ号', required: true },
          { name: 'special_title', type: 'string', description: '专属头衔', required: true },
          { name: 'duration', type: 'number', description: '有效期(秒)', required: false, default: -1 }
        ],
        action: 'set_group_special_title'
      },
      {
        id: 'delete_msg',
        name: '撤回消息',
        description: '撤回指定消息',
        category: 'message',
        args: [
          { name: 'message_id', type: 'number', description: '消息ID', required: true }
        ],
        action: 'delete_msg'
      },
      {
        id: 'get_group_member_info',
        name: '获取群成员信息',
        description: '获取群成员详细信息',
        category: 'group',
        args: [
          { name: 'group_id', type: 'number', description: '群号', required: true },
          { name: 'user_id', type: 'number', description: '用户QQ号', required: true },
          { name: 'no_cache', type: 'boolean', description: '不使用缓存', required: false, default: false }
        ],
        action: 'get_group_member_info'
      },
      {
        id: 'get_group_member_list',
        name: '获取群成员列表',
        description: '获取群成员列表',
        category: 'group',
        args: [
          { name: 'group_id', type: 'number', description: '群号', required: true }
        ],
        action: 'get_group_member_list'
      }
    ];
  }

  // 执行API指令
  async executeCommand(commandId, args) {
    try {
      const command = this.apiCommands.find(cmd => cmd.id === commandId);
      if (!command) {
        throw new Error(`未找到指令: ${commandId}`);
      }

      // 验证和转换参数
      const params = {};
      for (const argDef of command.args) {
        const argValue = args[argDef.name];
        
        if (argDef.required && (argValue === undefined || argValue === null)) {
          throw new Error(`缺少必需参数: ${argDef.name}`);
        }

        if (argValue !== undefined && argValue !== null) {
          // 类型转换
          switch (argDef.type) {
            case 'number':
              const numValue = parseInt(argValue);
              if (isNaN(numValue)) {
                throw new Error(`参数 ${argDef.name} 必须是数字`);
              }
              params[argDef.name] = numValue;
              break;
            case 'boolean':
              params[argDef.name] = Boolean(argValue);
              break;
            case 'string':
              params[argDef.name] = String(argValue);
              break;
            default:
              params[argDef.name] = argValue;
          }
        } else if (argDef.default !== undefined) {
          params[argDef.name] = argDef.default;
        }
      }

      console.log(`🚀 执行指令: ${command.name} (${commandId})`);
      console.log(`📝 参数:`, params);

      const result = await this.request(command.action, params);
      
      return {
        success: true,
        message: '指令执行成功',
        data: result.data || result,
        command: command
      };

    } catch (error) {
      console.error(`❌ 指令执行失败: ${commandId}`, error);
      return {
        success: false,
        message: error.message || '指令执行失败',
        error: error
      };
    }
  }

  // 获取所有可用指令
  getAvailableCommands() {
    return this.apiCommands;
  }

  // 获取指定指令信息
  getCommandInfo(commandId) {
    return this.apiCommands.find(cmd => cmd.id === commandId);
  }

  // 搜索指令
  searchCommands(query) {
    const lowerQuery = query.toLowerCase();
    return this.apiCommands.filter(cmd => 
      cmd.name.toLowerCase().includes(lowerQuery) ||
      cmd.description.toLowerCase().includes(lowerQuery) ||
      cmd.category.toLowerCase().includes(lowerQuery)
    );
  }
}

export default UserApiService;
