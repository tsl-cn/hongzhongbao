/**
 * RoomManager.js — 房间管理器
 *
 * 功能：创建/加入/离开房间、自动AI补位、游戏生命周期管理
 */

const Player = require('./Player');
const GameState = require('../game/GameState');

class RoomManager {
  constructor() {
    this.rooms = new Map();   // roomId → Room
    this.playerRoom = new Map(); // playerId → roomId
    this.roomIdCounter = 0;
  }

  /** 创建房间（自动补AI到4人） */
  createRoom(hostId, hostName, password) {
    const roomId = `room_${++this.roomIdCounter}`;
    const room = {
      id: roomId,
      hostId,
      password: password || '',   // 空字符串 = 无密码
      players: [],
      gameState: null,
      status: 'waiting', // waiting | playing
    };
    
    const host = new Player(hostId, hostName, false, 0);
    room.players.push(host);
    this.rooms.set(roomId, room);
    this.playerRoom.set(hostId, roomId);

    // 补AI到4人，让房间立即可见满员状态
    this.fillWithAI(roomId);

    return room;
  }

  /** 加入房间（满员时自动挤掉AI） */
  joinRoom(roomId, playerId, playerName, password) {
    const room = this.rooms.get(roomId);
    if (!room) return { error: '房间不存在' };
    if (room.status === 'playing') return { error: '游戏已经开始' };
    if (this.playerRoom.has(playerId)) return { error: '你已在其他房间' };
    if (room.password && room.password !== password) return { error: '密码错误' };

    // 如果房间满员但有AI，挤掉最后一个AI
    if (room.players.length >= 4) {
      const aiIdx = room.players.findIndex(p => p.isAI);
      if (aiIdx === -1) return { error: '房间已满' };
      // 移除AI
      const removedAi = room.players.splice(aiIdx, 1)[0];
      this.playerRoom.delete(removedAi.id);
    }

    const seatIndex = room.players.length; // 重排座位号
    const player = new Player(playerId, playerName, false, seatIndex);
    room.players.push(player);
    // 重新分配座位号
    room.players.forEach((p, i) => p.seatIndex = i);
    this.playerRoom.set(playerId, roomId);

    return { room, player };
  }

  /** 离开房间 */
  leaveRoom(playerId) {
    const roomId = this.playerRoom.get(playerId);
    if (!roomId) return null;

    const room = this.rooms.get(roomId);
    if (!room) return null;

    // 房主在等待页面离开时，转移房主给下一个真人
    let newHostId = null;
    if (room.status === 'waiting' && playerId === room.hostId) {
      const nextHost = room.players.find(p => !p.isAI && p.id !== playerId);
      if (nextHost) {
        room.hostId = nextHost.id;
        newHostId = nextHost.id;
      }
    }

    // 移除玩家
    const idx = room.players.findIndex(p => p.id === playerId);
    if (idx !== -1) {
      room.players.splice(idx, 1);
      room.players.forEach((p, i) => p.seatIndex = i);
    }

    this.playerRoom.delete(playerId);

    // 没有真人了 → 关闭房间（AI 全部移除）
    const hasHumans = room.players.some(p => !p.isAI);
    if (!hasHumans) {
      this.rooms.delete(roomId);
      return null;
    }

    // 有人离开后重新补AI，保持房间始终4人可见
    if (room.status === 'waiting') {
      this.fillWithAI(roomId);
    }

    room.newHostId = newHostId;
    return room;
  }

  /** 填充AI到满4人 */
  fillWithAI(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return null;

    const aiNames = ['AI-小东', 'AI-小南', 'AI-小西', 'AI-小北'];
    
    while (room.players.length < 4) {
      const aiId = `ai_${roomId}_${room.players.length}`;
      const aiName = aiNames[room.players.length] || `AI-${room.players.length}`;
      const seatIndex = room.players.length;
      const aiPlayer = new Player(aiId, aiName, true, seatIndex);
      aiPlayer.isReady = true; // AI 默认已准备
      room.players.push(aiPlayer);
    }

    return room;
  }

  /** 检查玩家是否准备好（所有真人已准备） */
  allHumansReady(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return false;
    return room.players
      .filter(p => !p.isAI)
      .every(p => p.isReady);
  }

  /** 检查是否可以开始游戏 */
  canStartGame(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return { ok: false, error: '房间不存在' };
    if (room.status !== 'waiting') return { ok: false, error: '游戏已开始' };

    const humans = room.players.filter(p => !p.isAI);
    if (humans.length === 0) return { ok: false, error: '没有真人玩家' };

    // 房主必须已准备
    const host = humans.find(p => p.id === room.hostId);
    if (!host || !host.isReady) return { ok: false, error: '房主尚未准备' };

    // 所有真人必须已准备
    if (!humans.every(p => p.isReady)) {
      return { ok: false, error: '还有玩家未准备' };
    }

    return { ok: true };
  }

  /** 玩家准备 */
  setReady(playerId) {
    const roomId = this.playerRoom.get(playerId);
    if (!roomId) return false;
    const room = this.rooms.get(roomId);
    if (!room) return false;
    
    const player = room.players.find(p => p.id === playerId);
    if (!player) return false;
    
    player.isReady = true;
    return true;
  }

  /**
   * 开始游戏
   * 1. 补AI到4人
   * 2. 创建GameState
   * 3. 执行定庄
   * 4. 执行起牌
   */
  startGame(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return { error: '房间不存在' };

    // 补AI
    this.fillWithAI(roomId);

    if (room.players.length !== 4) {
      return { error: '人数不足' };
    }

    room.status = 'playing';

    // 重置上一局的AI托管标记
    room.players.forEach(p => { p.aiControlled = false; p.disconnected = false; });

    // 创建游戏状态
    const gameState = new GameState(room.players);
    room.gameState = gameState;

    // 定庄 → 起牌
    const initData = gameState.initialize();

    return { room, gameState, initData };
  }

  /** 下一局（保留庄家，不重新定庄） */
  startNextRound(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return { error: '房间不存在' };

    // 确保AI还在
    this.fillWithAI(roomId);

    if (room.players.length !== 4) {
      return { error: '人数不足' };
    }

    room.status = 'playing';

    // 重置上一局的AI托管标记
    room.players.forEach(p => { p.aiControlled = false; p.disconnected = false; });

    // 沿用同一个 GameState，保留 windDealer
    const gameState = room.gameState || new GameState(room.players);
    room.gameState = gameState;

    // 保留庄家，只洗牌起牌
    const initData = gameState.initializeNextRound();

    return { room, gameState, initData };
  }

  /** 获取房间信息（不含敏感数据） */
  getRoomInfo(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    return {
      id: room.id,
      hostId: room.hostId,
      hasPassword: !!room.password,
      status: room.status,
      playerCount: room.players.length,
      players: room.players.map(p => ({
        id: p.id,
        name: p.name,
        isAI: p.isAI,
        seatIndex: p.seatIndex,
        isReady: p.isReady,
      })),
    };
  }

  /** 获取玩家所在的房间 */
  getPlayerRoom(playerId) {
    const roomId = this.playerRoom.get(playerId);
    if (!roomId) return null;
    return this.rooms.get(roomId);
  }

  /** 游戏中断线标记（不删除玩家，补AI） */
  markDisconnectedInGame(playerId) {
    const roomId = this.playerRoom.get(playerId);
    if (!roomId) return null;
    const room = this.rooms.get(roomId);
    if (!room || room.status !== 'playing') return null;

    const player = room.players.find(p => p.id === playerId);
    if (!player) return null;

    player.disconnected = true;
    return { room, player };
  }

  /** 根据昵称在房间中找到玩家（用于重连） */
  findPlayerByNickname(roomId, nickname) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    return room.players.find(p => !p.isAI && p.name === nickname) || null;
  }

  /** 重连：挤掉AI，恢复真人控制 */
  reconnectPlayer(roomId, player, newSocketId) {
    const room = this.rooms.get(roomId);
    if (!room) return false;

    // 恢复真人控制
    player.id = newSocketId;
    player.disconnected = false;
    player.aiControlled = false;
    this.playerRoom.set(newSocketId, roomId);

    return true;
  }

  /** 获取所有等待中的房间列表 */
  getWaitingRooms() {
    const list = [];
    for (const [id, room] of this.rooms) {
      if (room.status === 'waiting') {
        list.push(this.getRoomInfo(id));
      }
    }
    return list;
  }
}

module.exports = RoomManager;
