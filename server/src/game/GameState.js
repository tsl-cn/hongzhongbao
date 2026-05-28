/**
 * GameState.js — 游戏状态机
 *
 * 管理一局麻将的完整生命周期：
 *   定庄 → 起牌 → 摸牌 → 出牌 → 碰/杠/胡判定 → 结算/流局
 */

const Wall = require('./Wall');
const FanCalculator = require('./FanCalculator');
const { isWild, TILE_NAMES } = require('./TileDef');

// 状态常量
const PHASE = {
  INIT: 'init',
  DRAW: 'draw',       // 等待摸牌
  DISCARD: 'discard',  // 等待出牌
  ACTION: 'action',    // 等待其他玩家响应（碰/杠/胡）
  SETTLE: 'settle',    // 结算
};

// 座次名称
const SEAT_NAMES = ['东', '南', '西', '北'];

class GameState {
  /**
   * @param {Array} players - Player实例数组 [东南西北]
   */
  constructor(players) {
    this.players = players;           // [东,南,西,北]
    this.wall = new Wall();
    this.windDealer = 0;              // 当前庄家座位号
    this.currentSeat = 0;             // 当前行动座位
    this.phase = PHASE.INIT;
    this.round = 1;                   // 局数
    this.lastDiscard = null;          // 最后出的牌 { tileType, seat }
    this.lastDiscardBySeat = -1;
    this.actionQueue = [];            // 碰杠胡等待队列
    this.winners = [];                // 赢家 [{ seat, tileType, isSelfDraw, fanResult }]
    this.isKongAfterDraw = false;     // 摸牌后是否开杠（影响杠上开花判断）
    this.kongDrawTile = null;         // 杠后补摸的牌
    this.result = null;               // 结算结果
    /** 牌局事件日志 */
    this.gameLog = [];
  }

  /** 添加一条牌局日志 */
  logEvent(msg) {
    this.gameLog.push(msg);
    console.log(`[Game] ${msg}`);
  }

  /** 获取日志副本 */
  getLog() {
    return [...this.gameLog];
  }

  /**
   * 初始化 — 定庄 + 起牌
   * 返回初始数据 { dealer, hands, wallRemaining }
   */
  initialize() {
    this.wall.shuffle();

    // 定庄：每人摇2骰子，点数和最大为庄
    const diceResults = this._determineDealer();
    this.windDealer = diceResults.dealerSeat;
    this.currentSeat = this.windDealer;

    // 庄家再摇骰定墙定墩 (规则中用，但我们的Wall简化了起牌位置)
    // 实际起牌逻辑在 wall.dealInitial() 中处理
    const hands = this.wall.dealInitial();

    // 分配手牌：庄家拿14张(hands[0])，其余13张
    // hands[0]永远给庄家，需要根据windDealer旋转
    for (let i = 0; i < 4; i++) {
      const srcIdx = (i - this.windDealer + 4) % 4;
      this.players[i].hand = hands[srcIdx].sort((a, b) => a - b);
    }

    this.phase = PHASE.DISCARD;
    this._log(`定庄: ${SEAT_NAMES[this.windDealer]}为庄`);
    for (let i = 0; i < 4; i++) {
      this._log(`${SEAT_NAMES[i]}(${this.players[i].name}): ${this.players[i].handToString()}`);
    }
    this.logEvent(`🎲 ${SEAT_NAMES[this.windDealer]}为庄家`);
    this.logEvent(`📦 起牌完成，每人13/14张，牌墙剩余${this.wall.remaining()}张`);

    return {
      dealer: this.windDealer,
      dealerName: SEAT_NAMES[this.windDealer],
      hands: hands.map(h => [...h]),
      wallRemaining: this.wall.remaining(),
      diceResults,
    };
  }

  /**
   * 定庄：每人摇2骰子，点数和从大到小定东南西北
   */
  _determineDealer() {
    const results = [];
    for (let i = 0; i < 4; i++) {
      const sum = Wall.rollTwoDice();
      results.push({ seat: i, sum });
    }
    // 按点数从大到小排序
    const sorted = [...results].sort((a, b) => b.sum - a.sum);
    // sorted[0] = 东(庄), sorted[1] = 南, sorted[2] = 西, sorted[3] = 北
    const seatMap = {}; // 原始座位 → 风位
    sorted.forEach((r, idx) => {
      seatMap[r.seat] = idx; // 0=东 1=南 2=西 3=北
    });
    // 重新分配座位
    const dealerSeat = sorted[0].seat;
    return { dealerSeat, results: sorted };
  }

  /** 当前玩家摸牌 */
  drawTile() {
    if (this.phase !== PHASE.DISCARD && this.phase !== PHASE.DRAW) {
      return { error: '当前不是摸牌阶段' };
    }

    // 牌墙是否空了
    if (this.wall.remaining() <= 0) {
      return this._flowGame();
    }

    const tile = this.wall.draw();
    if (tile === null) {
      return this._flowGame();
    }

    const player = this.players[this.currentSeat];
    player.addToHand(tile);

    this.phase = PHASE.DISCARD;
    this.kongDrawTile = null;

    this.logEvent(`${SEAT_NAMES[this.currentSeat]}摸牌，牌墙剩余${this.wall.remaining()}张`);

    // 检查自摸
    if (this._checkSelfWin(this.currentSeat)) {
      this.phase = PHASE.ACTION;
      return {
        type: 'draw',
        tile,
        seat: this.currentSeat,
        canSelfWin: true,
        hand: [...player.hand],
        wallRemaining: this.wall.remaining(),
      };
    }

    return {
      type: 'draw',
      tile,
      seat: this.currentSeat,
      canSelfWin: false,
      hand: [...player.hand],
      wallRemaining: this.wall.remaining(),
    };
  }

  /** 出牌 */
  discardTile(tileType) {
    if (this.phase !== PHASE.DISCARD) {
      return { error: '当前不是出牌阶段' };
    }

    const player = this.players[this.currentSeat];

    // 检查手牌是否有这张牌
    if (!player.hand.includes(tileType)) {
      return { error: '手牌中没有这张牌' };
    }

    player.discardTile(tileType);
    this.lastDiscard = { tileType, seat: this.currentSeat };
    this.lastDiscardBySeat = this.currentSeat;

    this._log(`${SEAT_NAMES[this.currentSeat]}(${player.name}) 出牌: ${TILE_NAMES[tileType]}`);
    this.logEvent(`${SEAT_NAMES[this.currentSeat]}打出 ${TILE_NAMES[tileType]}`);

    // 检查其他玩家能否碰/杠/胡
    const actions = this._checkOtherActions(this.currentSeat, tileType);

    if (actions.length > 0) {
      this.phase = PHASE.ACTION;
      this.actionQueue = actions;
      return {
        type: 'discard',
        tileType,
        seat: this.currentSeat,
        availableActions: actions,
        hand: [...player.hand],
        wallRemaining: this.wall.remaining(),
      };
    }

    // 没人响应，下家摸牌
    this._nextTurn();
    this.phase = PHASE.DRAW;

    return {
      type: 'discard',
      tileType,
      seat: this.currentSeat,
      availableActions: [],
      hand: [...player.hand],
      wallRemaining: this.wall.remaining(),
    };
  }

  /**
   * 检查其他玩家对弃牌的响应（胡 > 杠 > 碰）
   */
  _checkOtherActions(discardSeat, tileType) {
    const actions = [];

    for (let i = 1; i <= 3; i++) {
      const checkSeat = (discardSeat + i) % 4;
      const player = this.players[checkSeat];

      // 检查胡 (抢杠胡或点炮胡)
      if (this._canWinOnDiscard(checkSeat, tileType)) {
        actions.push({ type: 'win', seat: checkSeat, tileType });
      }

      // 检查杠 (明杠)
      const kongCount = player.hand.filter(t => t === tileType).length;
      if (kongCount === 3) {
        actions.push({ type: 'kong', seat: checkSeat, tileType, kongType: 'exposed' });
      }

      // 检查碰
      const pongCount = player.hand.filter(t => t === tileType).length;
      if (pongCount >= 2) {
        actions.push({ type: 'pong', seat: checkSeat, tileType });
      }
    }

    return actions;
  }

  /** 玩家请求碰 */
  requestPong(playerId) {
    const seat = this._findSeatById(playerId);
    if (seat === -1) return { error: '玩家不在游戏中' };

    const action = this.actionQueue.find(a => a.seat === seat && a.type === 'pong');
    if (!action) return { error: '不能碰' };

    const player = this.players[seat];
    const tileType = action.tileType;

    // 移除手牌中的2张
    let removed = 0;
    for (let i = player.hand.length - 1; i >= 0 && removed < 2; i--) {
      if (player.hand[i] === tileType) {
        player.hand.splice(i, 1);
        removed++;
      }
    }

    player.addMeld({ type: 'pong', tiles: [tileType, tileType, tileType], from: this.lastDiscardBySeat });

    // 碰完后该玩家出牌
    this.currentSeat = seat;
    this.phase = PHASE.DISCARD;
    this.actionQueue = [];

    this._log(`${SEAT_NAMES[seat]}(${player.name}) 碰了 ${TILE_NAMES[tileType]}`);
    this.logEvent(`${SEAT_NAMES[seat]}碰了 ${TILE_NAMES[tileType]}`);

    return {
      type: 'pong',
      seat,
      tileType,
      hand: [...player.hand],
      melds: [...player.melds],
    };
  }

  /** 玩家请求杠 */
  requestKong(playerId, tileType) {
    const seat = this._findSeatById(playerId);
    if (seat === -1) return { error: '玩家不在游戏中' };

    const player = this.players[seat];

    // 检查是明杠（别人出的牌）还是暗杠（自己的牌）
    const action = this.actionQueue.find(a => a.seat === seat && a.type === 'kong');

    if (action) {
      // 明杠
      if (action.kongType === 'exposed') {
        let removed = 0;
        for (let i = player.hand.length - 1; i >= 0 && removed < 3; i--) {
          if (player.hand[i] === tileType) {
            player.hand.splice(i, 1);
            removed++;
          }
        }
        player.addMeld({ type: 'exposed_kong', tiles: [tileType, tileType, tileType, tileType], from: this.lastDiscardBySeat });
      }
    } else {
      // 暗杠或补杠：检查手牌是否有4张相同
      const count = player.hand.filter(t => t === tileType).length;
      if (count === 4) {
        // 暗杠
        for (let i = player.hand.length - 1; i >= 0; i--) {
          if (player.hand[i] === tileType) {
            player.hand.splice(i, 1);
          }
        }
        player.addMeld({ type: 'concealed_kong', tiles: [tileType, tileType, tileType, tileType] });
      } else if (count === 1) {
        // 补杠：碰了之后摸到第4张
        const meld = player.melds.find(m => m.type === 'pong' && m.tiles[0] === tileType);
        if (meld) {
          meld.type = 'exposed_kong';
          meld.tiles.push(tileType);
          player.removeFromHand(tileType);
        } else {
          return { error: '不能杠' };
        }
      } else {
        return { error: '不能杠' };
      }
    }

    this.actionQueue = [];

    // 杠后补牌
    const drawTile = this.wall.draw();
    if (drawTile === null) {
      return this._flowGame();
    }

    player.addToHand(drawTile);
    this.currentSeat = seat;
    this.phase = PHASE.DISCARD;
    this.isKongAfterDraw = true;
    this.kongDrawTile = drawTile;

    // 检查杠后自摸
    if (this._checkSelfWin(seat)) {
      this.phase = PHASE.ACTION;
      return {
        type: 'kong',
        seat,
        tileType,
        drawTile,
        canSelfWin: true,
        hand: [...player.hand],
        wallRemaining: this.wall.remaining(),
      };
    }

    this._log(`${SEAT_NAMES[seat]}(${player.name}) 杠了 ${TILE_NAMES[tileType]}`);
    this.logEvent(`${SEAT_NAMES[seat]}杠了 ${TILE_NAMES[tileType]}`);

    return {
      type: 'kong',
      seat,
      tileType,
      drawTile,
      canSelfWin: false,
      hand: [...player.hand],
      wallRemaining: this.wall.remaining(),
    };
  }

  /** 玩家请求胡 */
  requestWin(playerId) {
    const seat = this._findSeatById(playerId);
    if (seat === -1) return { error: '玩家不在游戏中' };

    const player = this.players[seat];
    const isSelfDraw = (seat === this.currentSeat);

    return this._settleWin(seat, isSelfDraw);
  }

  /** 跳过操作（碰/杠/胡） */
  skipAction(playerId) {
    const seat = this._findSeatById(playerId);
    if (seat === -1) return { error: '玩家不在游戏中' };

    // 移除这个玩家的待定操作
    this.actionQueue = this.actionQueue.filter(a => a.seat !== seat);

    // 如果所有玩家都跳过了，进入下家摸牌
    if (this.actionQueue.length === 0) {
      this._nextTurn();
      this.phase = PHASE.DRAW;
      return { type: 'skip_all', nextSeat: this.currentSeat };
    }

    return { type: 'skip', seat };
  }

  /** 自摸检查：用 FanCalculator 判断是否能胡（含三番起胡） */
  _checkSelfWin(seat) {
    const player = this.players[seat];
    if (!player) return false;

    const hand = [...player.hand];
    const result = FanCalculator.calculate(hand, player.melds, {
      isSelfDraw: true,
      isDealer: seat === this.windDealer,
      isKongDraw: this.isKongAfterDraw,
    });

    if (result.isWin) {
      const patternNames = result.patterns.map(p => p.name).join(' + ');
      this._log(`自摸可胡! ${SEAT_NAMES[seat]} ${result.fan}番 (${patternNames})`);
    }

    return result.isWin;
  }

  /** 点炮胡检查：将弃牌加入手牌后判断是否能胡 */
  _canWinOnDiscard(seat, tileType) {
    const player = this.players[seat];
    if (!player) return false;

    // 模拟将这张弃牌加入手牌
    const testHand = [...player.hand, tileType];
    const result = FanCalculator.calculate(testHand, player.melds, {
      isSelfDraw: false,
      isDealer: seat === this.windDealer,
    });

    if (result.isWin) {
      const patternNames = result.patterns.map(p => p.name).join(' + ');
      this._log(`点炮可胡! ${SEAT_NAMES[seat]} ${result.fan}番 (${patternNames})`);
    }

    return result.isWin;
  }

  /** 流局处理 */
  _flowGame() {
    this.phase = PHASE.SETTLE;
    this.result = { type: 'flow', message: '流局 — 牌墙空' };
    this.logEvent('💨 流局！牌墙已空');
    return { type: 'flow', message: '流局' };
  }

  /** 胡牌结算：调用 FanCalculator 真实算番 */
  _settleWin(winSeat, isSelfDraw) {
    this.phase = PHASE.SETTLE;

    const seatName = SEAT_NAMES[winSeat];
    const player = this.players[winSeat];
    const hand = [...player.hand];

    // 如果是对面点炮，需要将最后一张弃牌加入手牌来算番
    const calcHand = isSelfDraw ? hand : [...hand];

    const calcResult = FanCalculator.calculate(calcHand, player.melds, {
      isSelfDraw,
      isDealer: winSeat === this.windDealer,
      isKongDraw: this.isKongAfterDraw,
    });

    const fan = calcResult.isWin ? calcResult.fan : 3;
    const patternNames = calcResult.patterns.map(p => p.name).join(' + ');
    const details = `${fan}番${patternNames ? ' (' + patternNames + ')' : ''}`;

    this.logEvent(`🏆 ${seatName}(${player.name})${isSelfDraw ? '自摸' : '点炮'}胡牌！${details}`);

    this.result = {
      type: 'win',
      winner: winSeat,
      isSelfDraw,
      fan,
      details,
      patterns: calcResult.patterns,
    };

    return {
      type: 'win',
      seat: winSeat,
      isSelfDraw,
      result: this.result,
    };
  }

  /** 转到下一个玩家 */
  _nextTurn() {
    this.currentSeat = (this.currentSeat + 1) % 4;
    this.actionQueue = [];
    this.isKongAfterDraw = false;
  }

  /** 通过ID找座位号 */
  _findSeatById(playerId) {
    for (let i = 0; i < 4; i++) {
      if (this.players[i].id === playerId) return i;
    }
    return -1;
  }

  /** 获取当前状态快照 */
  getState() {
    return {
      phase: this.phase,
      round: this.round,
      currentSeat: this.currentSeat,
      windDealer: this.windDealer,
      wallRemaining: this.wall.remaining(),
      lastDiscard: this.lastDiscard,
      actionQueue: this.actionQueue,
      result: this.result,
      gameLog: this.getLog(),
      players: this.players.map(p => ({
        id: p.id,
        name: p.name,
        isAI: p.isAI,
        seatIndex: p.seatIndex,
        handSize: p.hand.length,
        hand: [...p.hand],
        melds: [...p.melds],
        discards: [...p.discards],
      })),
    };
  }

  /** 日志 */
  _log(msg) {
    console.log(`[Game] ${msg}`);
  }
}

module.exports = GameState;
