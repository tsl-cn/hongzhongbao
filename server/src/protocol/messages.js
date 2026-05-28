/**
 * messages.js — 前后端通信消息协议
 *
 * 所有 WebSocket 消息类型定义
 */

const MESSAGE_TYPES = {
  // ====== 房间 ======
  CREATE_ROOM: 'create_room',           // C→S: 创建房间
  ROOM_CREATED: 'room_created',          // S→C: 房间已创建
  JOIN_ROOM: 'join_room',               // C→S: 加入房间
  ROOM_JOINED: 'room_joined',           // S→C: 已加入房间
  LEAVE_ROOM: 'leave_room',             // C→S: 离开房间
  PLAYER_LEFT: 'player_left',           // S→C: 有玩家离开
  PLAYER_JOINED: 'player_joined',       // S→C: 有玩家加入
  ROOM_LIST: 'room_list',               // S→C: 房间列表
  GET_ROOM_LIST: 'get_room_list',       // C→S: 请求房间列表

  // ====== 准备 ======
  PLAYER_READY: 'player_ready',         // C→S: 玩家准备
  ALL_READY: 'all_ready',               // S→C: 所有玩家已准备

  // ====== 游戏 ======
  GAME_START: 'game_start',             // S→C: 游戏开始
  INITIAL_HAND: 'initial_hand',         // S→C: 起牌分配
  DRAW_TILE: 'draw_tile',               // S→C: 摸牌
  YOUR_TURN: 'your_turn',              // S→C: 轮到你了
  DISCARD_TILE: 'discard_tile',         // C→S: 出牌
  TILE_DISCARDED: 'tile_discarded',     // S→C: 有玩家出牌
  PONG_REQUEST: 'pong_request',         // S→C: 可以碰
  PONG: 'pong',                         // C→S: 碰
  PONG_DONE: 'pong_done',              // S→C: 碰完成
  KONG_REQUEST: 'kong_request',         // S→C: 可以杠
  KONG: 'kong',                         // C→S: 杠
  KONG_DONE: 'kong_done',              // S→C: 杠完成
  WIN_REQUEST: 'win_request',           // S→C: 可以胡
  WIN: 'win',                           // C→S: 胡
  WIN_DONE: 'win_done',                // S→C: 胡完成
  SKIP_ACTION: 'skip_action',           // C→S: 跳过操作
  GAME_OVER: 'game_over',               // S→C: 游戏结束

  // ====== 语音信令 ======
  VOICE_SIGNAL: 'voice_signal',         // C↔S↔C: WebRTC信令转发
  VOICE_OFFER: 'voice_offer',
  VOICE_ANSWER: 'voice_answer',
  VOICE_ICE: 'voice_ice',
  VOICE_MUTE: 'voice_mute',            // C→S: 静音状态

  // ====== AI 信息 ======
  AI_FILL: 'ai_fill',                  // S→C: AI加入通知

  // ====== 错误 ======
  ERROR: 'error',                       // S→C: 错误
};

module.exports = { MESSAGE_TYPES };
