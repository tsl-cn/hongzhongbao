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
const { createAiView } = require('./ai/AiView');
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
    const room = roomManager.createRoom(socket.id, data.name || '玩家', data.password || '');
    socket.join(room.id);
    socket.emit('room_created', roomManager.getRoomInfo(room.id));
    console.log(`[房间] ${socket.id} 创建了房间 ${room.id}${data.password ? ' (有密码)' : ''}`);
  });

  socket.on('get_room_list', () => {
    socket.emit('room_list', { rooms: roomManager.getWaitingRooms() });
  });

  socket.on('join_room', (data) => {
    const result = roomManager.joinRoom(data.roomId, socket.id, data.name || '玩家', data.password || '');
    if (result.error) {
      socket.emit('error', { message: result.error });
      return;
    }
    socket.join(data.roomId);
    const roomInfo = roomManager.getRoomInfo(data.roomId);
    socket.emit('room_joined', roomInfo);
    // 通知其他玩家（含完整房间信息）
    socket.to(data.roomId).emit('player_joined', roomInfo);
    console.log(`[房间] ${socket.id} 加入了房间 ${data.roomId}`);
  });

  socket.on('leave_room', (data) => {
    const room = roomManager.leaveRoom(socket.id);
    if (room) {
      socket.leave(room.id);
      io.to(room.id).emit('player_left', roomManager.getRoomInfo(room.id));
    }
  });

  // ---- 准备 ----
  socket.on('player_ready', () => {
    const ready = roomManager.setReady(socket.id);
    if (!ready) return;

    const room = roomManager.getPlayerRoom(socket.id);
    if (!room) return;

    // 通知房间内所有人准备状态更新
    io.to(room.id).emit('player_ready_update', roomManager.getRoomInfo(room.id));
  });

  // ---- 房主开始游戏（需全员准备） ----
  socket.on('host_start_game', (data) => {
    const room = roomManager.getPlayerRoom(socket.id);
    if (!room) return;
    if (room.hostId !== socket.id) {
      socket.emit('error', { message: '只有房主可以开始游戏' });
      return;
    }
    // 填充AI并自动准备
    roomManager.fillWithAI(room.id);
    room.players.forEach(p => { if (p.isAI) p.isReady = true; });
    // 检查所有真人是否已准备
    if (!roomManager.allHumansReady(room.id)) {
      socket.emit('error', { message: '还有玩家未准备' });
      return;
    }
    startGame(room.id);
  });

  // ---- 选马（每人独立） ----
  socket.on('select_horse_count', (data) => {
    const room = roomManager.getPlayerRoom(socket.id);
    if (!room) return;

    // 用 seatIndex 存储选马（不受重连影响）
    const player = room.players.find(p => !p.isAI && p.id === socket.id);
    if (!player) return;
    if (!room._horseSelections) room._horseSelections = {};
    room._horseSelections[player.seatIndex] = data?.count || 0;

    // 检查所有真人是否已选完（用 seatIndex）
    const humans = room.players.filter(p => !p.isAI);
    const allSelected = humans.every(p => room._horseSelections[p.seatIndex] !== undefined);
    if (allSelected && room._onAllHorsesSelected) {
      room._onAllHorsesSelected();
      room._onAllHorsesSelected = null;
    }
  });

  // ---- 房主开始下一局（保留庄家） ----
  socket.on('host_next_round', (data) => {
    const room = roomManager.getPlayerRoom(socket.id);
    if (!room) return;
    if (room.hostId !== socket.id) {
      socket.emit('error', { message: '只有房主可以开始下一局' });
      return;
    }
    if (room.status !== 'playing') return;
    startNextRound(room.id);
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
    _recordWinner(room);
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
  const initData = result.initData;

  const playersWithHands = room.players.map(p => {
    const sortedHand = [...p.hand].sort((a, b) => a - b);
    return {
      id: p.id,
      name: p.name,
      isAI: p.isAI,
      seatIndex: p.seatIndex,
      handSize: sortedHand.length,
      hand: sortedHand,
    };
  });

  // 天胡/四红中人胡：跳过选马直接结算
  if (initData.isHeavenWin || initData.isHumanWin) {
    io.to(roomId).emit('game_start', {
      dealer: initData.dealer,
      dealerName: initData.dealerName,
      diceResults: initData.diceResults,
      horseResult: null,
      needHorseSelection: false,
      wallRemaining: initData.wallRemaining,
      seatCount: room.players.length,
      players: playersWithHands,
      gameLog: gameState.getLog(),
      isHeavenWin: initData.isHeavenWin || false,
      isHumanWin: initData.isHumanWin || false,
    });
    // 延迟让客户端看到起手牌，再广播结算
    setTimeout(() => {
      _broadcastGameState(room, initData.winResult);
    }, 3000);
    return;
  }

  const dealer = initData.dealer;
  const diceResults = initData.diceResults;

  // 初始化选马状态
  room._horseSelections = {};

  // 每人独立选马（AI 0-4，真人由客户端确定）
  room._horseSelections = {};
  room.players.forEach(p => {
    if (p.isAI) {
      const rand = Math.random();
      const count = rand < 0.4 ? 0 : rand < 0.7 ? 1 : 2;
      room._horseSelections[p.seatIndex] = count;
    }
  });

  // 全部人选完后执行：每人从独立牌堆各抽各的马
  room._onAllHorsesSelected = () => {
    const horseBuyer = new HorseBuyer();
    room.horseResults = [];

    for (let i = 0; i < 4; i++) {
      const count = room._horseSelections[i] || 0;
      const p = room.players[i];
      if (!p) continue;
      const horses = count > 0 ? horseBuyer.drawRandom(count) : [];
      room.horseResults[i] = { seatIndex: i, playerName: p.name, count, horses };
      if (count > 0) {
        gameState.logEvent(`🐴 ${['东','南','西','北'][i]}(${p.name})买了${count}匹`);
      }
    }

    // 广播所有玩家的马牌数（客户端各自在桌边渲染）
    const horseCounts = [0, 0, 0, 0];
    for (let i = 0; i < 4; i++) {
      const hr = room.horseResults[i];
      if (hr) horseCounts[i] = hr.horses.length;
    }
    io.to(roomId).emit('horse_bought', horseCounts);

    setTimeout(() => { _startFirstTurn(roomId); }, 1000);
  };

  // 回调注册完后才发 game_start
  io.to(roomId).emit('game_start', {
    dealer,
    dealerName: initData.dealerName,
    diceResults,
    horseResult: null,
    needHorseSelection: true,
    wallRemaining: initData.wallRemaining,
    seatCount: room.players.length,
    players: playersWithHands,
    gameLog: gameState.getLog(),
  });
}

function _startFirstTurn(roomId) {
  const roomNow = roomManager.rooms.get(roomId);
  if (!roomNow || !roomNow.gameState || roomNow.players.length === 0) return;
  io.to(roomId).emit('your_turn', {
    seat: roomNow.gameState.currentSeat,
    playerId: roomNow.players[roomNow.gameState.currentSeat]?.id || '',
  });
  _triggerAITurn(roomNow);
}

// ==================== 下一局（保留庄家，不重新定庄） ====================

function startNextRound(roomId) {
  const room = roomManager.rooms.get(roomId);
  if (!room) return;

  // 上一局赢家坐庄
  if (room._lastWinner !== undefined && room.gameState) {
    room.gameState.windDealer = room._lastWinner;
  }

  const result = roomManager.startNextRound(roomId);
  if (result.error) {
    io.to(roomId).emit('error', { message: result.error });
    return;
  }

  const gameState = room.gameState;
  const initData = result.initData;

  const playersWithHands = room.players.map(p => {
    const sortedHand = [...p.hand].sort((a, b) => a - b);
    return {
      id: p.id,
      name: p.name,
      isAI: p.isAI,
      seatIndex: p.seatIndex,
      handSize: sortedHand.length,
      hand: sortedHand,
    };
  });

  // 天胡/四红中人胡：跳过选马直接结算
  if (initData.isHeavenWin || initData.isHumanWin) {
    io.to(roomId).emit('game_start', {
      dealer: initData.dealer,
      dealerName: initData.dealerName,
      diceResults: null,
      horseResult: null,
      needHorseSelection: false,
      wallRemaining: initData.wallRemaining,
      seatCount: room.players.length,
      players: playersWithHands,
      isNextRound: true,
      gameLog: gameState.getLog(),
      isHeavenWin: initData.isHeavenWin || false,
      isHumanWin: initData.isHumanWin || false,
    });
    setTimeout(() => {
      _broadcastGameState(room, initData.winResult);
    }, 3000);
    return;
  }

  const dealer = initData.dealer;

  // 每人独立选马（AI 0-4）
  room._horseSelections = {};
  room.players.forEach(p => {
    if (p.isAI) {
      const rand = Math.random();
      room._horseSelections[p.seatIndex] = rand < 0.4 ? 0 : rand < 0.7 ? 1 : 2;
    }
  });

  room._onAllHorsesSelected = () => {
    const horseBuyer = new HorseBuyer();
    room.horseResults = [];

    for (let i = 0; i < 4; i++) {
      const count = room._horseSelections[i] || 0;
      const p = room.players[i];
      if (!p) continue;
      const horses = count > 0 ? horseBuyer.drawRandom(count) : [];
      room.horseResults[i] = { seatIndex: i, playerName: p.name, count, horses };
      if (count > 0) {
        gameState.logEvent(`🐴 ${['东','南','西','北'][i]}(${p.name})买了${count}匹`);
      }
    }

    // 广播所有玩家的马牌数
    const horseCounts = [0, 0, 0, 0];
    for (let i = 0; i < 4; i++) {
      const hr = room.horseResults[i];
      if (hr) horseCounts[i] = hr.horses.length;
    }
    io.to(roomId).emit('horse_bought', horseCounts);

    setTimeout(() => { _startFirstTurn(roomId); }, 1000);
  };

  io.to(roomId).emit('game_start', {
    dealer,
    dealerName: initData.dealerName,
    diceResults: null,
    horseResult: null,
    needHorseSelection: true,
    wallRemaining: initData.wallRemaining,
    seatCount: room.players.length,
    players: playersWithHands,
    isNextRound: true,
    gameLog: gameState.getLog(),
  });
}

// ==================== AI 决策引擎 ====================

function _getOrCreateAI(player, room) {
  let ai = aiPlayers.get(player.id);
  if (!ai) {
    // 创建 AI 信息防火墙：AI 只能看到公开信息
    const aiView = createAiView(room.gameState, player.seatIndex);
    ai = new AiPlayer(player.seatIndex, aiView, (actionType, data) => {
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
      const roomId = room.id;
      setTimeout(() => {
        if (!roomManager.rooms.has(roomId)) return; // 房间已销毁
        ai.decide({ type: 'action_available', availableActions: [firstAction] });
      }, 300 + Math.random() * 300);
    }
    return;
  }

  // DISCARD阶段：当前AI出牌
  const currentPlayer = room.players[room.gameState.currentSeat];
  if (!currentPlayer || !currentPlayer.isAI) return;

  const ai = _getOrCreateAI(currentPlayer, room);
  const roomId = room.id;
  setTimeout(() => {
    if (!roomManager.rooms.has(roomId)) return; // 房间已销毁
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
      _recordWinner(room);
      _broadcastGameState(room, winResult);
      break;
    case 'skip':
      const skipResult = room.gameState.skipAction(aiId);
      _broadcastGameState(room, skipResult);
      break;
  }
}

// 记录上一局赢家用于下一局坐庄
function _recordWinner(room) {
  if (room && room.gameState && room.gameState.result) {
    room._lastWinner = room.gameState.result.winner;
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

  // 发送各玩家手牌（只能看自己的），刚摸的牌单独标记
  for (let i = 0; i < 4; i++) {
    const p = room.players[i];
    if (!p.isAI) {
      const isDrawer = state.lastDrawnTile !== null && state.lastDrawnSeat === i;
      // 有刚摸牌 → 保留原顺序（客户端移到最右）；无刚摸牌 → 排序
      const hand = isDrawer ? [...p.hand] : [...p.hand].sort((a, b) => a - b);
      const handData = { hand, seatIndex: i };
      if (isDrawer) {
        handData.lastDrawnTile = state.lastDrawnTile;
      }
      io.to(p.id).emit('your_hand', handData);
    }
  }

  // 如果是结算阶段
  if (state.phase === 'settle') {
    // 每人独立马牌结算
    const horseResults = [];
    const winner = state.result?.winner;
    if (winner !== undefined && winner !== null && room.horseResults) {
      for (let i = 0; i < 4; i++) {
        const hr = room.horseResults[i];
        if (!hr || hr.horses.length === 0) {
          horseResults[i] = null;
          continue;
        }
        horseResults[i] = {
          seatIndex: i,
          playerName: hr.playerName,
          count: hr.count,
          ...HorseBuyer.settleHorses(hr.horses, winner, state.result.fan || 3, i),
        };
      }

      // 每匹马独立结算规则（总计必=0）：
      //   中马: owner +3fan, 其他3家各 -fan
      //   不中(owner≠胡牌家): owner -fan, 胡牌家 +fan
      //   不中(owner=胡牌家): 0
      // 胡牌家合计 = W_hit×fan×3 + 非胡牌家不中总数×fan - 非胡牌家中总数×fan
      // 非胡牌家X合计 = X_hit×fan×3 - X_not×fan - (总中马 - X_hit)×fan
      const totalHits = [0, 0, 0, 0];
      let totalAllHits = 0, totalNonWinnerNot = 0;
      for (let i = 0; i < 4; i++) {
        const hr = horseResults[i];
        if (hr) {
          totalHits[i] = hr.results.filter(r => r.isHit).length;
          totalAllHits += totalHits[i];
          if (i !== winner) totalNonWinnerNot += hr.results.filter(r => !r.isHit).length;
        }
      }
      const fan = state.result.fan || 3;
      for (let i = 0; i < 4; i++) {
        if (!horseResults[i]) continue;
        const isWinner = (i === winner);
        const myHits = totalHits[i];
        let directAdj = 0;
        for (const r of horseResults[i].results) {
          if (isWinner) {
            r.adjustment = r.isHit ? fan * 3 : 0;
          } else {
            r.adjustment = r.isHit ? fan * 3 : -fan;
          }
          directAdj += r.adjustment;
        }
        // 计算交叉项
        let crossTerm = 0;
        if (!isWinner) {
          crossTerm = -fan * (totalAllHits - myHits);
        }
        if (isWinner) {
          const totalNonWinnerHits = totalAllHits - myHits;
          crossTerm = totalNonWinnerNot * fan - totalNonWinnerHits * fan;
        }
        // 交叉项分摊（便于结算页逐马展示完整输赢）
        // 胡牌家：只分摊给中马，不中马保持0
        // 非胡牌家：分摊给所有马
        if (isWinner) {
          const hitHorses = horseResults[i].results.filter(r => r.isHit);
          const hCount = hitHorses.length;
          if (hCount > 0) {
            const perHit = Math.floor(crossTerm / hCount);
            const rem = crossTerm - perHit * hCount;
            let idx = 0;
            horseResults[i].results.forEach((r) => {
              if (r.isHit) {
                r.adjustment += perHit;
                if (idx === hCount - 1) r.adjustment += rem;
                idx++;
              }
              // 不中马保持 direct(0)
            });
          }
        } else {
          const hCount = horseResults[i].results.length;
          const perHorse = hCount > 0 ? Math.floor(crossTerm / hCount) : 0;
          const remainder = crossTerm - perHorse * hCount;
          horseResults[i].results.forEach((r, idx) => {
            r.adjustment += perHorse;
            if (idx === hCount - 1) r.adjustment += remainder;
          });
        }
        horseResults[i].pickerAdjustment = directAdj + crossTerm;
      }
    }
    _broadcastToRoom(room.id, 'game_over', {
      result: state.result,
      horseResults,
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

  // 摸牌阶段 → 自动摸牌（不分Human/AI），深度保护防无限递归
  if (state.phase === 'draw') {
    const drawResult = room.gameState.drawTile();
    if (drawResult.error || drawResult.type === 'flow') {
      if (drawResult.type === 'flow') _broadcastGameState(room, drawResult);
      return;
    }
    // 摸牌后再次广播（此时phase变为discard或action）
    // 加深度标记防循环递归
    if (!room._broadcastDepth) room._broadcastDepth = 0;
    if (room._broadcastDepth++ > 10) {
      room._broadcastDepth = 0;
      console.error('[BUG] _broadcastGameState 递归过深，终止');
      return;
    }
    _broadcastGameState(room, drawResult);
    room._broadcastDepth = 0;
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
