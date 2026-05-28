/**
 * SocketManager.js — WebSocket 通信管理器
 *
 * 封装所有与服务器的消息收发
 */

import { io } from 'socket.io-client';

class SocketManager {
  constructor() {
    this.socket = null;
    this.listeners = {};
    this.connected = false;
    this.playerId = null;
    this.roomId = null;
    this.playerName = '';
  }

  /** 连接服务器 */
  connect(serverUrl = '') {
    return new Promise((resolve) => {
      this.socket = io(serverUrl || undefined, {
        transports: ['websocket', 'polling'],
      });

      this.socket.on('connect', () => {
        console.log('[Socket] 已连接:', this.socket.id);
        this.connected = true;
        this.playerId = this.socket.id;
        resolve();
      });

      this.socket.on('disconnect', () => {
        console.log('[Socket] 已断开');
        this.connected = false;
      });

      // 自动绑定所有已注册的事件
      this.socket.onAny((event, data) => {
        this._handleEvent(event, data);
      });
    });
  }

  /** 监听事件 */
  on(event, callback) {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(callback);
    // 返回取消监听的函数
    return () => {
      this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
    };
  }

  /** 发送事件 */
  emit(event, data = {}) {
    if (!this.socket || !this.connected) {
      console.warn('[Socket] 未连接，无法发送:', event);
      return;
    }
    this.socket.emit(event, data);
  }

  /** 处理收到的事件 */
  _handleEvent(event, data) {
    const cbs = this.listeners[event];
    if (cbs) {
      for (const cb of cbs) {
        try { cb(data); } catch (e) { console.error(`[Socket] 处理事件 ${event} 出错:`, e); }
      }
    }
  }

  /** ===== 房间 API ===== */

  createRoom(name) {
    this.playerName = name;
    this.emit('create_room', { name });
  }

  joinRoom(roomId, name) {
    this.playerName = name;
    this.emit('join_room', { roomId, name });
  }

  leaveRoom() {
    this.emit('leave_room');
  }

  getRoomList() {
    this.emit('get_room_list');
  }

  setReady() {
    this.emit('player_ready');
  }

  /** ===== 游戏 API ===== */

  discardTile(tileType) {
    this.emit('discard_tile', { tileType });
  }

  pong() {
    this.emit('pong');
  }

  kong(tileType) {
    this.emit('kong', { tileType });
  }

  win() {
    this.emit('win');
  }

  skipAction() {
    this.emit('skip_action');
  }

  /** ===== 语音 API ===== */

  sendVoiceOffer(roomId, description) {
    this.emit('voice_offer', { roomId, description });
  }

  sendVoiceAnswer(roomId, description) {
    this.emit('voice_answer', { roomId, description });
  }

  sendVoiceICE(roomId, candidate) {
    this.emit('voice_ice', { roomId, candidate });
  }

  sendVoiceMute(roomId, muted) {
    this.emit('voice_mute', { roomId, muted });
  }

  /** 断开连接 */
  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    this.connected = false;
  }
}

export default SocketManager;
