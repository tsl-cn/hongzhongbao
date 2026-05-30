/**
 * GameState.js — 游戏状态机
 *
 * 管理一局麻将的完整生命周期：
 *   定庄 → 起牌 → 摸牌 → 出牌 → 碰/杠/胡判定 → 结算/流局
 */

const Wall = require('./Wall');
const { isWild, TILE_NAMES, WILD_TILE } = require('./TileDef');
const FanCalculator = require('./FanCalculator');

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
    this.lastDrawnTile = null;        // 刚摸的牌（用于客户端最右显示）
    this.lastDrawnSeat = -1;
    this.result = null;               // 结算结果
    this.turnNumber = 0;              // 回合计数（首轮<4为天胡/地胡/人胡判定）
    this.consecutiveKongCount = 0;    // 连续杠计数（出牌重置，用于杠上杠开花）
    this.pendingRobKong = null;       // 待处理抢杠 { seat, tileType }
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

    this.turnNumber = 0;
    this.consecutiveKongCount = 0;
    this.pendingRobKong = null;
    this.phase = PHASE.DISCARD;
    this._log(`定庄: ${SEAT_NAMES[this.windDealer]}为庄`);
    // 显示各家摇骰点数
    for (const r of diceResults.results) {
      this.logEvent(`🎲 ${SEAT_NAMES[r.seat]}(${this.players[r.seat].name}): ${r.sum}点`);
    }
    for (let i = 0; i < 4; i++) {
      this._log(`${SEAT_NAMES[i]}(${this.players[i].name}): ${this.players[i].handToString()}`);
    }
    this.logEvent(`🎲 ${SEAT_NAMES[this.windDealer]}为庄家`);
    this.logEvent(`📦 起牌完成，每人13/14张，牌墙剩余${this.wall.remaining()}张`);

    const baseResult = {
      dealer: this.windDealer,
      dealerName: SEAT_NAMES[this.windDealer],
      hands: hands.map(h => [...h]),
      wallRemaining: this.wall.remaining(),
      diceResults,
    };

    // 天胡检查：庄家起手14张即胡
    if (this._checkSelfWin(this.windDealer)) {
      this.logEvent('☀️ 天胡！庄家起手即胡');
      const winResult = this._settleWin(this.windDealer, true);
      return { ...baseResult, isHeavenWin: true, winResult };
    }

    // 四红中/人胡检查：非庄家开局4张红中
    for (let i = 0; i < 4; i++) {
      if (i === this.windDealer) continue; // 庄家已在上方天胡覆盖
      const p = this.players[i];
      const wildCount = p.hand.filter(t => t === WILD_TILE).length;
      if (wildCount >= 4) {
        this.logEvent(`🀄 四红中！${SEAT_NAMES[i]}(${p.name})开局4张红中 → 人胡`);
        const winResult = this._settleWin(i, true);
        return { ...baseResult, isHumanWin: true, winResult };
      }
    }

    return baseResult;
  }

  /**
   * 下一局初始化（保留庄家，不要定庄骰子）
   */
  initializeNextRound() {
    this.wall.shuffle();
    this.wall.discards = [];
    this.phase = PHASE.INIT;
    this.lastDiscard = null;
    this.lastDiscardBySeat = -1;
    this.actionQueue = [];
    this.winners = [];
    this.isKongAfterDraw = false;
    this.kongDrawTile = null;
    this.result = null;
    this.gameLog = [];

    this.turnNumber = 0;
    this.consecutiveKongCount = 0;
    this.pendingRobKong = null;
    this.currentSeat = this.windDealer;

    const hands = this.wall.dealInitial();

    for (let i = 0; i < 4; i++) {
      const srcIdx = (i - this.windDealer + 4) % 4;
      this.players[i].hand = hands[srcIdx].sort((a, b) => a - b);
      this.players[i].melds = [];
      this.players[i].discards = [];
    }

    this.phase = PHASE.DISCARD;
    this._log(`续庄: ${SEAT_NAMES[this.windDealer]}为庄`);
    for (let i = 0; i < 4; i++) {
      this._log(`${SEAT_NAMES[i]}(${this.players[i].name}): ${this.players[i].handToString()}`);
    }
    this.logEvent(`🎲 ${SEAT_NAMES[this.windDealer]}继续坐庄`);
    this.logEvent(`📦 起牌完成，每人13/14张，牌墙剩余${this.wall.remaining()}张`);

    const baseResult = {
      dealer: this.windDealer,
      dealerName: SEAT_NAMES[this.windDealer],
      hands: hands.map(h => [...h]),
      wallRemaining: this.wall.remaining(),
      diceResults: null,  // 没有定庄骰子
    };

    // 天胡检查：庄家起手14张即胡
    if (this._checkSelfWin(this.windDealer)) {
      this.logEvent('☀️ 天胡！庄家起手即胡');
      const winResult = this._settleWin(this.windDealer, true);
      return { ...baseResult, isHeavenWin: true, winResult };
    }

    // 四红中/人胡检查：非庄家开局4张红中
    for (let i = 0; i < 4; i++) {
      if (i === this.windDealer) continue;
      const p = this.players[i];
      const wildCount = p.hand.filter(t => t === WILD_TILE).length;
      if (wildCount >= 4) {
        this.logEvent(`🀄 四红中！${SEAT_NAMES[i]}(${p.name})开局4张红中 → 人胡`);
        const winResult = this._settleWin(i, true);
        return { ...baseResult, isHumanWin: true, winResult };
      }
    }

    return baseResult;
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

    // 中局洗牌静默执行
    this.wall._justShuffled = false;

    const player = this.players[this.currentSeat];
    player.addToHand(tile);

    this.phase = PHASE.DISCARD;
    this.kongDrawTile = null;
    // 记录刚摸的牌，客户端用于最右显示
    this.lastDrawnTile = tile;
    this.lastDrawnSeat = this.currentSeat;

    this.logEvent(`${SEAT_NAMES[this.currentSeat]}摸牌，牌墙剩余${this.wall.remaining()}张`);

    // 检查自摸
    if (this._checkSelfWin(this.currentSeat)) {
      this.phase = PHASE.ACTION;
      this.actionQueue = [{ type: 'win', seat: this.currentSeat, tileType: tile, isSelfDraw: true }];
      return {
        type: 'draw',
        tile,
        seat: this.currentSeat,
        canSelfWin: true,
        actionQueue: [...this.actionQueue],
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
    // 红中是万能牌，不能打出
    if (isWild(tileType)) {
      return { error: '红中不能打出' };
    }

    player.discardTile(tileType);
    player.sortHand();                         // 打出后手牌自动排序
    this.lastDiscard = { tileType, seat: this.currentSeat };
    this.lastDiscardBySeat = this.currentSeat;
    this.lastDrawnTile = null;  // 已出牌，清除刚摸标记
    this.consecutiveKongCount = 0; // 出牌打断连续杠

    this._log(`${SEAT_NAMES[this.currentSeat]}(${player.name}) 出牌: ${TILE_NAMES[tileType]}`);
    this.logEvent(`${SEAT_NAMES[this.currentSeat]}打出 ${TILE_NAMES[tileType]}`);

    // 检查其他玩家能否碰/杠/胡
    const actions = this._checkOtherActions(this.currentSeat, tileType);

    // 地胡检查：庄家首张弃牌，非庄家点炮胡（支持一炮多响）
    if (this.turnNumber === 0 && this.currentSeat === this.windDealer) {
      for (let i = 1; i <= 3; i++) {
        const checkSeat = (this.currentSeat + i) % 4;
        const p = this.players[checkSeat];
        if (p.melds.length === 0 && this._canWinOnDiscard(checkSeat, tileType)) {
          actions.unshift({ type: 'win', seat: checkSeat, tileType, isSelfDraw: false });
          this.logEvent(`🌍 地胡！${SEAT_NAMES[checkSeat]}(${p.name})可胡庄家首弃`);
        }
      }
    }

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

      // 红中宝规则：只能自摸，不能点炮胡，所以不检查胡
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
    player.sortHand();                         // 碰完后手牌排序

    // 碰完后该玩家出牌
    this.currentSeat = seat;
    this.phase = PHASE.DISCARD;
    this.actionQueue = [];
    this.lastDrawnTile = null;                 // 碰后无刚摸牌

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
        // 补杠：碰了之后摸到第4张 —— 先检查抢杠
        const meld = player.melds.find(m => m.type === 'pong' && m.tiles[0] === tileType);
        if (meld) {
          // 抢杠检查：其他三家是否能胡这张牌（支持一炮多响）
          const robWinners = [];
          for (let i = 0; i < 4; i++) {
            if (i === seat) continue;
            if (this._canWinOnDiscard(i, tileType)) {
              robWinners.push({ type: 'win', seat: i, tileType, isSelfDraw: false });
              this.logEvent(`⚡ ${SEAT_NAMES[i]}(${this.players[i].name})可抢杠胡${TILE_NAMES[tileType]}！`);
            }
          }
          if (robWinners.length > 0) {
            this.phase = PHASE.ACTION;
            this.pendingRobKong = { seat, tileType };
            this.lastDiscard = { tileType, seat, type: 'kong' };
            this.actionQueue = robWinners;
            return {
              type: 'kong_blocked',
              seat,
              tileType,
              availableActions: this.actionQueue,
              hand: [...player.hand],
              wallRemaining: this.wall.remaining(),
            };
          }
          // 没人抢杠，正常执行补杠
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
    this.consecutiveKongCount++; // 连续杠计数

    // 杠后补牌
    const drawTile = this.wall.draw();
    if (drawTile === null) {
      return this._flowGame();
    }

    // 中局洗牌静默执行
    this.wall._justShuffled = false;

    player.addToHand(drawTile);
    this.currentSeat = seat;
    this.phase = PHASE.DISCARD;
    this.isKongAfterDraw = true;
    this.kongDrawTile = drawTile;
    this.lastDrawnTile = drawTile;       // 杠后补牌标记为刚摸的牌
    this.lastDrawnSeat = seat;

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

    // 如果所有玩家都跳过了
    if (this.actionQueue.length === 0) {
      // 抢杠被跳过：执行被中断的补杠
      if (this.pendingRobKong) {
        return this._finishRobbedKong();
      }
      this._nextTurn();
      this.phase = PHASE.DRAW;
      return { type: 'skip_all', nextSeat: this.currentSeat };
    }

    return { type: 'skip', seat };
  }

  /** 抢杠被跳过，执行被中断的补杠 */
  _finishRobbedKong() {
    const { seat, tileType } = this.pendingRobKong;
    this.pendingRobKong = null;
    const player = this.players[seat];

    const meld = player.melds.find(m => m.type === 'pong' && m.tiles[0] === tileType);
    if (!meld) return { error: '补杠状态异常' };
    meld.type = 'exposed_kong';
    meld.tiles.push(tileType);
    player.removeFromHand(tileType);

    this.actionQueue = [];
    this.consecutiveKongCount++;

    const drawTile = this.wall.draw();
    if (drawTile === null) return this._flowGame();

    // 中局洗牌静默执行
    this.wall._justShuffled = false;

    player.addToHand(drawTile);
    this.currentSeat = seat;
    this.phase = PHASE.DISCARD;
    this.isKongAfterDraw = true;
    this.kongDrawTile = drawTile;

    if (this._checkSelfWin(seat)) {
      this.phase = PHASE.ACTION;
      this.actionQueue = [{ type: 'win', seat, tileType: drawTile, isSelfDraw: true }];
    }

    this._log(`${SEAT_NAMES[seat]}(${player.name}) 杠了 ${TILE_NAMES[tileType]}`);
    this.logEvent(`${SEAT_NAMES[seat]}杠了 ${TILE_NAMES[tileType]}`);

    return {
      type: 'kong',
      seat,
      tileType,
      drawTile,
      canSelfWin: this.actionQueue.length > 0,
      hand: [...player.hand],
      wallRemaining: this.wall.remaining(),
    };
  }

  /** 自摸检查：使用 FanCalculator.calculate 判断胡牌（含三番起胡+碰牌无杠规则） */
  _checkSelfWin(seat) {
    const player = this.players[seat];
    if (!player) return false;
    const options = {
      isSelfDraw: true,
      isDealer: (seat === this.windDealer),
      isKongDraw: this.isKongAfterDraw,
      isFirstTurn: this.turnNumber < 4,
      isLastTile: this.wall.remaining() === 0,
      isDoubleKongDraw: this.consecutiveKongCount >= 2,
      hasMelds: player.melds.length > 0,
    };
    const fanResult = FanCalculator.calculate(player.hand, player.melds, options);
    return fanResult.isWin;
  }

  /** 点炮胡检查：手牌+待牌合成后判断（含三番起胡规则） */
  _canWinOnDiscard(seat, tileType) {
    const player = this.players[seat];
    if (!player) return false;
    // 手牌加入待牌（别人出的牌）合成完整14张
    const allTiles = [...player.hand, tileType].sort((a, b) => a - b);
    const options = {
      isSelfDraw: false,
      isDealer: (seat === this.windDealer),
      isKongDraw: false,
      isFirstTurn: this.turnNumber < 4,
      isLastTile: this.wall.remaining() === 0,
      isDoubleKongDraw: false,
      hasMelds: player.melds.length > 0,
    };
    const fanResult = FanCalculator.calculate(allTiles, player.melds, options);
    return fanResult.isWin;
  }

  /** 流局处理 */
  _flowGame() {
    this.phase = PHASE.SETTLE;
    this.result = { type: 'flow', message: '流局 — 牌墙空' };
    this.logEvent('💨 流局！牌墙已空');
    return { type: 'flow', message: '流局' };
  }

  /** 胡牌结算：使用 FanCalculator 实际算番 */
  _settleWin(winSeat, isSelfDraw) {
    const seatName = SEAT_NAMES[winSeat];
    const player = this.players[winSeat];

    const isRobbingKong = !isSelfDraw && this.lastDiscard && this.lastDiscard.type === 'kong';
    const kongMakerSeat = isRobbingKong ? this.lastDiscard.seat : -1;

    // 抢杠胡：手牌不含被抢牌，临时加入计算
    let calcHand = player.hand;
    if (this.pendingRobKong && isRobbingKong) {
      calcHand = [...player.hand, this.pendingRobKong.tileType].sort((a, b) => a - b);
    }

    // 使用 FanCalculator 实际算番
    const options = {
      isSelfDraw,
      isDealer: (winSeat === this.windDealer),
      isKongDraw: this.isKongAfterDraw && isSelfDraw,
      isRobbingKong,
      isFirstTurn: this.turnNumber < 4,
      isLastTile: this.wall.remaining() === 0,
      isDoubleKongDraw: this.consecutiveKongCount >= 2 && isSelfDraw,
      hasMelds: player.melds.length > 0,
    };
    const fanResult = FanCalculator.calculate(calcHand, player.melds, options);

    if (!fanResult.isWin) {
      return { error: fanResult.reason || '番数不足三番起胡' };
    }

    this.phase = PHASE.SETTLE;
    this.logEvent(`🏆 ${seatName}(${player.name})${isRobbingKong ? '抢杠' : isSelfDraw ? '自摸' : '点炮'}胡牌！`);
    const fan = fanResult.fan;
    const patterns = fanResult.patterns || [];

    // 计算各家赔付
    const payments = {};

    if (isRobbingKong) {
      // 抢杠胡：被抢杠者赔 fan×3，其他两家 0
      for (let i = 0; i < 4; i++) {
        if (i === winSeat) continue;
        const pay = (i === kongMakerSeat) ? fan * 3 : 0;
        payments[SEAT_NAMES[i]] = { pay, playerName: this.players[i].name };
      }
    } else {
      for (let i = 0; i < 4; i++) {
        if (i === winSeat) continue;
        let pay;
        if (isSelfDraw) {
          pay = fan;
        } else {
          const discarderSeat = this.lastDiscard ? this.lastDiscard.seat : -1;
          pay = (i === discarderSeat) ? fan * 2 : fan;
        }
        payments[SEAT_NAMES[i]] = { pay, playerName: this.players[i].name };
      }
    }

    const payStr = Object.entries(payments)
      .map(([seat, p]) => `${seat}(${p.playerName}): -${p.pay}番`)
      .join(', ');
    this.logEvent(`📊 ${seatName}(${player.name}) ${fan}番(抢杠×3): ${patterns.map(p => p.name || p).join(', ')}`);
    this.logEvent(`💰 ${seatName}(${player.name})赢得: ${payStr}`);

    this.result = {
      type: 'win',
      winner: winSeat,
      winnerName: player.name,
      isSelfDraw,
      isRobbingKong,
      kongMakerSeat,
      fan,
      patterns,
      payments,
      details: fanResult.detail || '胡牌',
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
    this.turnNumber++;
    this.actionQueue = [];
    this.isKongAfterDraw = false;
    this.consecutiveKongCount = 0;
    this.lastDrawnTile = null;  // 换人，清除标记
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
      lastDrawnTile: this.lastDrawnTile,
      lastDrawnSeat: this.lastDrawnSeat,
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
