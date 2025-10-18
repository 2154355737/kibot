// QQ机器人相关类型定义

/**
 * API响应基础结构
 * @typedef {Object} ApiResponse
 * @property {string} status - 状态
 * @property {number} retcode - 返回码
 * @property {*} data - 数据
 * @property {string} message - 消息
 * @property {string} wording - 说明
 */

/**
 * 登录信息
 * @typedef {Object} LoginInfo
 * @property {number} user_id - QQ号
 * @property {string} nickname - 昵称
 */

/**
 * 消息段基础结构
 * @typedef {Object} MessageSegment
 * @property {string} type - 消息段类型
 * @property {Object} data - 消息段数据
 */

/**
 * 文本消息段
 * @typedef {Object} TextSegment
 * @property {'text'} type
 * @property {Object} data
 * @property {string} data.text - 文本内容
 */

/**
 * 图片消息段
 * @typedef {Object} ImageSegment
 * @property {'image'} type
 * @property {Object} data
 * @property {string} data.file - 图片文件
 * @property {string} [data.url] - 图片URL
 * @property {string} [data.path] - 本地路径
 */

/**
 * AT消息段
 * @typedef {Object} AtSegment
 * @property {'at'} type
 * @property {Object} data
 * @property {string|number} data.qq - QQ号或'all'
 * @property {string} [data.name] - 显示名称
 */

/**
 * 消息发送者
 * @typedef {Object} MessageSender
 * @property {number} user_id - QQ号
 * @property {string} nickname - 昵称
 * @property {string} [card] - 群名片
 * @property {'male'|'female'|'unknown'} [sex] - 性别
 * @property {number} [age] - 年龄
 * @property {string} [level] - 群等级
 * @property {'owner'|'admin'|'member'} [role] - 群角色
 * @property {string} [title] - 专属头衔
 * @property {number} [group_id] - 群号
 */

/**
 * 消息事件
 * @typedef {Object} MessageEvent
 * @property {number} time - 时间戳
 * @property {number} self_id - 机器人QQ号
 * @property {'message'|'message_sent'} post_type - 事件类型
 * @property {number} message_id - 消息ID
 * @property {number} message_seq - 消息序列号
 * @property {number} [real_id] - 真实消息ID
 * @property {number} user_id - 发送者QQ号
 * @property {number} [group_id] - 群号
 * @property {'private'|'group'} message_type - 消息类型
 * @property {'friend'|'group'|'normal'} [sub_type] - 消息子类型
 * @property {MessageSender} sender - 发送者信息
 * @property {MessageSegment[]} message - 消息内容
 * @property {'array'|'string'} message_format - 消息格式
 * @property {string} raw_message - 原始消息
 * @property {number} font - 字体ID
 * @property {number} [target_id] - 目标ID
 * @property {number} [temp_source] - 临时聊天来源
 */

/**
 * 群申请事件
 * @typedef {Object} GroupRequestEvent
 * @property {number} time - 事件时间戳（Unix 时间戳，秒）
 * @property {number} self_id - 机器人的 QQ 号
 * @property {'request'} post_type - 事件类型
 * @property {'group'} request_type - 请求类型
 * @property {'add'|'invite'} sub_type - add = 加群请求，invite = 邀请机器人入群
 * @property {string} comment - 请求消息
 * @property {string} flag - 请求标识，用于处理请求
 * @property {number} group_id - 群号
 * @property {number} user_id - 用户 ID（add 类型为请求者，invite 类型为邀请者）
 * @property {number} [invitor_id] - 邀请者 ID（invite 类型）
 */

/**
 * 群成员增加事件
 * @typedef {Object} GroupIncreaseEvent
 * @property {number} time - 事件时间戳（Unix 时间戳，秒）
 * @property {number} self_id - 机器人的 QQ 号
 * @property {'notice'} post_type - 事件类型
 * @property {'group_increase'} notice_type - 通知类型
 * @property {'approve'|'invite'} sub_type - approve = 同意入群，invite = 邀请入群
 * @property {number} group_id - 群号
 * @property {number} user_id - 新成员的 QQ 号
 * @property {number} operator_id - 操作者 ID（同意/邀请的人）
 */

/**
 * 群成员减少事件
 * @typedef {Object} GroupDecreaseEvent
 * @property {number} time - 事件时间戳（Unix 时间戳，秒）
 * @property {number} self_id - 机器人的 QQ 号
 * @property {'notice'} post_type - 事件类型
 * @property {'group_decrease'} notice_type - 通知类型
 * @property {'leave'|'kick'|'kick_me'} sub_type - leave = 主动退群，kick = 被管理员踢出，kick_me = 机器人被踢
 * @property {number} group_id - 群号
 * @property {number} user_id - 离开/被踢的用户
 * @property {number} operator_id - 操作者 ID（执行操作的人）
 */

/**
 * WebSocket消息类型
 * @typedef {Object} WebSocketMessage
 * @property {'api_call'|'api_response'|'event'|'heartbeat'} type - 消息类型
 * @property {string} [id] - 请求ID
 * @property {string} [action] - API动作
 * @property {Object} [params] - API参数
 * @property {*} [data] - 数据
 * @property {number} [retcode] - 返回码
 * @property {string} [status] - 状态
 * @property {string} [message] - 消息
 */

/**
 * 好友信息
 * @typedef {Object} Friend
 * @property {number} user_id - QQ号
 * @property {string} nickname - 昵称
 * @property {string} [remark] - 备注
 */

/**
 * 群组信息
 * @typedef {Object} Group
 * @property {number} group_id - 群号
 * @property {string} group_name - 群名
 * @property {number} member_count - 成员数
 * @property {number} max_member_count - 最大成员数
 */

export {};
