/**
 * index.js — 服务器入口
 *
 * Express + Socket.IO
 * 处理房间管理、游戏事件路由、语音信令转发
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const RoomManager = require('./rooms/RoomManager');
const AiPlayer = require('./ai/AiPlayer');
const HorseBuyer = require('./game/HorseBuyer');
const { TILE_NAMES } = require('./game/TileDef');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

const roomManager = new RoomManager();
const aiPlayers = new Map(); // playerId → AiPlayer instance

// 静态文件（生产环境使用）
const clientDist = path.join(__dirname, '../../client/dist');
app.use(express.static(clientDist));

// ==================== Socket.IO 事件处理 ====================

io.on('connection', (socket) => {
  console.log(`[连接] ${socket.id} 已连接`);

  // ---- 房间 ----
  socket.on('create_room', (data) => {
    const room = roomManager.createRoom(socket.id, data.name || '玩家');
    socket.join(room.id);
    socket.emit('room_created', roomManager.getRoomInfo(room.id));
    console.log(`[房间] ${socket.id} 创建了房间 ${room.id}`);
  });

  socket.on('get_room_list', () => {
    socket.emit('room_list', { rooms: roomManager.getWaitingRooms() });
  });

  socket.on('join_room', (data) => {
    const result = roomManager.joinRoom(data.roomId, socket.id, data.name || '玩家');
    if (result.error) {
      socket.emit('error', { message: result.error });
      return;
    }
    socket.join(data.roomId);
    socket.emit('room_joined', roomManager.getRoomInfo(data.roomId));
    // 通知其他玩家
    socket.to(data.roomId).emit('player_joined', {
      player: { id: socket.id, name: data.name, seatIndex: result.player.seatIndex },
    });
    console.log(`[房间] ${socket.id} 加入了房间 ${data.roomId}`);
  });

  socket.on('leave_room', (data) => {
    const room = roomManager.leaveRoom(socket.id);
    if (room) {
      socket.leave(room.id);
      io.to(room.id).emit('player_left', { playerId: socket.id });
    }
  });

  // ---- 准备 ----
  socket.on('player_ready', () => {
    const ready = roomManager.setReady(socket.id);
    if (!ready) return;

    const room = roomManager.getPlayerRoom(socket.id);
    if (!room) return;

    io.to(room.id).emit('all_ready', { playerId: socket.id });

    // 检查所有真人是否已准备
    if (roomManager.allHumansReady(room.id)) {
      startGame(room.id);
    }
  });

  // ---- 房主强制开始游戏 ----
  socket.on('host_start_game', () => {
    const room = roomManager.getPlayerRoom(socket.id);
    if (!room) return;
    if (room.hostId !== socket.id) {
      socket.emit('error', { message: '只有房主可以开始游戏' });
      return;
    }
    // 填充AI → 强制开始
    roomManager.fillWithAI(room.id);
    // 所有真人标记为已准备
    room.players.forEach(p => { if (!p.isAI) p.isReady = true; });
    startGame(room.id);
  });

  // ---- 游戏操作 ----
  socket.on('discard_tile', (data) => {
    const room = roomManager.getPlayerRoom(socket.id);
    if (!room || !room.gameState) return;
    const result = room.gameState.discardTile(data.tileType);
    _broadcastGameState(room, result);
  });

  socket.on('pong', (data) => {
    const room = roomManager.getPlayerRoom(socket.id);
    if (!room || !room.gameState) return;
    const result = room.gameState.requestPong(socket.id);
    _broadcastGameState(room, result);
  });

  socket.on('kong', (data) => {
    const room = roomManager.getPlayerRoom(socket.id);
    if (!room || !room.gameState) return;
    const result = room.gameState.requestKong(socket.id, data.tileType);
    _broadcastGameState(room, result);
  });

  socket.on('win', (data) => {
    const room = roomManager.getPlayerRoom(socket.id);
    if (!room || !room.gameState) return;
    const result = room.gameState.requestWin(socket.id);
    _broadcastGameState(room, result);
  });

  socket.on('skip_action', () => {
    const room = roomManager.getPlayerRoom(socket.id);
    if (!room || !room.gameState) return;
    const result = room.gameState.skipAction(socket.id);
    _broadcastGameState(room, result);
  });

  // ---- 语音信令 ----
  socket.on('voice_offer', (data) => {
    socket.to(data.roomId).emit('voice_offer', {
      from: socket.id,
      description: data.description,
    });
  });

  socket.on('voice_answer', (data) => {
    socket.to(data.roomId).emit('voice_answer', {
      from: socket.id,
      description: data.description,
    });
  });

  socket.on('voice_ice', (data) => {
    socket.to(data.roomId).emit('voice_ice', {
      from: socket.id,
      candidate: data.candidate,
    });
  });

  socket.on('voice_mute', (data) => {
    socket.to(data.roomId).emit('voice_mute', {
      playerId: socket.id,
      muted: data.muted,
    });
  });

  // ---- 断开连接 ----
  socket.on('disconnect', () => {
    console.log(`[断开] ${socket.id} 已断开`);
    const room = roomManager.leaveRoom(socket.id);
    if (room) {
      io.to(room.id).emit('player_left', { playerId: socket.id });
    }
  });
});

// ==================== 游戏启动 ====================

function startGame(roomId) {
  const room = roomManager.rooms.get(roomId);
  if (!room) return;

  const result = roomManager.startGame(roomId);
  if (result.error) {
    io.to(roomId).emit('error', { message: result.error });
    return;
  }

  const gameState = room.gameState;
  const dealer = result.initData.dealer;
  const diceResults = result.initData.diceResults;

  // 买马：抓完牌后执行
  const horseBuyer = new HorseBuyer();
  const fullHorseResult = horseBuyer.buyHorses(dealer, 1); // 默认买1张
  // 存到 room 上，结算时用
  room.horseResult = fullHorseResult;
  gameState.logEvent(`🎲 买马骰子: ${fullHorseResult.dice1}+${fullHorseResult.dice2}=${fullHorseResult.diceSum}`);
  const seatNames = ['东', '南', '西', '北'];
  gameState.logEvent(`🐴 ${seatNames[fullHorseResult.pickerSeat]}买马 ${fullHorseResult.horses.length}张`);

  // 通知所有人游戏开始（马牌只发数量，不发牌面）
  const horseForClient = {
    dice1: fullHorseResult.dice1,
    dice2: fullHorseResult.dice2,
    diceSum: fullHorseResult.diceSum,
    pickerSeat: fullHorseResult.pickerSeat,
    horseCount: fullHorseResult.horses.length,
  };

  // game_start 包含所有玩家的手牌，客户端初始化时直接使用
  const playersWithHands = room.players.map(p => ({
    id: p.id,
    name: p.name,
    isAI: p.isAI,
    seatIndex: p.seatIndex,
    handSize: p.hand.length,
    hand: [...p.hand],  // 直接包含手牌
  }));

  io.to(roomId).emit('game_start', {
    dealer,
    dealerName: result.initData.dealerName,
    diceResults,
    horseResult: horseForClient,
    wallRemaining: result.initData.wallRemaining,
    seatCount: room.players.length,
    players: playersWithHands,
    gameLog: gameState.getLog(),
  });

  // 延迟发送 your_turn，给客户端留时间初始化场景 + 播骰子动画
  setTimeout(() => {
    // 保护：房间可能已被清空（玩家提前断开）
    const roomNow = roomManager.rooms.get(roomId);
    if (!roomNow || !roomNow.gameState || roomNow.players.length === 0) return;

    _broadcastToRoom(roomId, 'your_turn', {
      seat: roomNow.gameState.currentSeat,
      playerId: roomNow.players[roomNow.gameState.currentSeat]?.id || '',
    });

    // 如果是AI先手，触发AI
    _triggerAITurn(roomNow);
  }, 8000); // 约8秒后开始（骰子动画+买马动画大约需要6-7秒）
}

// ==================== AI 决策引擎 ====================

function _getOrCreateAI(player, room) {
  let ai = aiPlayers.get(player.id);
  if (!ai) {
    ai = new AiPlayer(player.seatIndex, room.gameState, (actionType, data) => {
      _handleAIAction(room.id, player.id, actionType, data);
    });
    aiPlayers.set(player.id, ai);
  }
  return ai;
}

function _triggerAITurn(room) {
  // ACTION阶段：处理AI的碰/杠/胡决策
  if (room.gameState.phase === 'action' && room.gameState.actionQueue.length > 0) {
    const firstAction = room.gameState.actionQueue[0];
    const player = room.players[firstAction.seat];
    if (player && player.isAI) {
      const ai = _getOrCreateAI(player, room);
      setTimeout(() => {
        ai.decide({ type: 'action_available', availableActions: [firstAction] });
      }, 300 + Math.random() * 300);
    }
    return;
  }

  // DISCARD阶段：当前AI出牌
  const currentPlayer = room.players[room.gameState.currentSeat];
  if (!currentPlayer || !currentPlayer.isAI) return;

  const ai = _getOrCreateAI(currentPlayer, room);
  setTimeout(() => {
    ai.decide({ type: 'discard' });
  }, 500 + Math.random() * 500);
}

function _handleAIAction(roomId, aiId, actionType, data) {
  const room = roomManager.rooms.get(roomId);
  if (!room) return;

  console.log(`[AI] 决策: ${actionType}`, data);

  switch (actionType) {
    case 'discard':
      const result = room.gameState.discardTile(data.tileType);
      _broadcastGameState(room, result);
      break;
    case 'pong':
      const pongResult = room.gameState.requestPong(aiId);
      _broadcastGameState(room, pongResult);
      break;
    case 'kong':
      const kongResult = room.gameState.requestKong(aiId, data.tileType);
      _broadcastGameState(room, kongResult);
      break;
    case 'win':
      const winResult = room.gameState.requestWin(aiId);
      _broadcastGameState(room, winResult);
      break;
    case 'skip':
      const skipResult = room.gameState.skipAction(aiId);
      _broadcastGameState(room, skipResult);
      break;
  }
}

// ==================== 广播工具 ====================

function _broadcastGameState(room, result) {
  if (!room) return;
  const state = room.gameState.getState();

  // 广播当前状态给所有人
  _broadcastToRoom(room.id, 'game_state_update', {
    state: {
      phase: state.phase,
      currentSeat: state.currentSeat,
      windDealer: state.windDealer,
      wallRemaining: state.wallRemaining,
      lastDiscard: state.lastDiscard,
      actionQueue: state.actionQueue,
      result: state.result,
      gameLog: state.gameLog,
    },
    event: result,
    players: state.players.map(p => ({
      id: p.id,
      name: p.name,
      isAI: p.isAI,
      seatIndex: p.seatIndex,
      handSize: p.hand.length,
      melds: p.melds,
      discards: p.discards,
    })),
  });

  // 发送各玩家手牌（只能看自己的）
  for (let i = 0; i < 4; i++) {
    const p = room.players[i];
    if (!p.isAI) {
      io.to(p.id).emit('your_hand', { hand: [...p.hand], seatIndex: i });
    }
  }

  // 如果是结算阶段
  if (state.phase === 'settle') {
    // 马牌结算
    let horseSettlement = null;
    if (room.horseResult) {
      const winner = state.result?.winner;
      if (winner !== undefined && winner !== null) {
        horseSettlement = HorseBuyer.settleHorses(
          room.horseResult.horses, winner, state.result.fan || 3
        );
      }
    }
    _broadcastToRoom(room.id, 'game_over', {
      result: state.result,
      horseSettlement,
      players: state.players.map(p => ({
        id: p.id,
        name: p.name,
        hand: [...p.hand],
        melds: [...p.melds],
        discards: [...p.discards],
        seatIndex: p.seatIndex,
      })),
    });
    return;
  }

  // 摸牌阶段 → 自动摸牌（不分Human/AI）
  if (state.phase === 'draw') {
    const drawResult = room.gameState.drawTile();
    if (drawResult.error || drawResult.type === 'flow') {
      if (drawResult.type === 'flow') _broadcastGameState(room, drawResult);
      return;
    }
    // 摸牌后再次广播（此时phase变为discard或action）
    _broadcastGameState(room, drawResult);
    return;
  }

  // 如果当前轮到AI，触发AI
  _triggerAITurn(room);
}

function _broadcastToRoom(roomId, event, data) {
  io.to(roomId).emit(event, data);
}

// ==================== 启动 ====================

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🀄 红中宝服务器已启动: http://0.0.0.0:${PORT}`);
  console.log(`📱 手机连接请使用电脑IP地址: http://<your-ip>:${PORT}`);
});
