/**
 * AiView.js — AI 信息防火墙
 *
 * ## 铁律：AI 不得偷看未出牌墙和其他玩家手牌
 *
 * 本模块用闭包封装 GameState，AI 只能通过预定义的只读 getter
 * 获取公开信息。底层 GameState 引用永不暴露。
 *
 * ## AI 可获取的信息（公开信息，真实牌桌也能看到）
 *
 *   1. 自己的手牌、副露、弃牌
 *   2. 所有玩家的公开副露（碰/杠牌）
 *   3. 所有玩家的弃牌堆
 *   4. 各玩家手牌张数（公开可数）
 *   5. 牌墙剩余张数（不能看具体牌面）
 *   6. 当前阶段、座位、庄家、回合数等公共状态
 *
 * ## AI 绝对无法获取（闭包隔离）
 *
 *   - 其他玩家的手牌内容
 *   - 牌墙中未摸的牌
 *   - FanCalculator.checkWin() 对其他玩家手牌的判断
 *   - 任何通过 GameState 内部方法间接获取的隐私信息
 */

const FanCalculator = require('../game/FanCalculator');
const { WILD_TILE, isWild } = require('../game/TileDef');

/**
 * 创建 AI 视角的只读信息视图
 *
 * @param {object} gameState - 原始 GameState 实例
 * @param {number} seat - AI 的座位号 (0-3)
 * @returns {object} 只读视图对象
 */
function createAiView(gameState, seat) {
  // ── 闭包私有引用（AI 代码无法访问） ──
  const _gs = gameState;
  const _mySeat = seat;

  // ── 辅助：安全拷贝手牌（防止引用外泄） ──
  const copyHand = () => {
    const p = _gs.players[_mySeat];
    return p ? [...p.hand] : [];
  };

  const copyDiscards = (s) => {
    const p = _gs.players[s];
    return p ? [...p.discards] : [];
  };

  const copyMelds = (s) => {
    const p = _gs.players[s];
    if (!p) return [];
    // 对其他玩家的暗杠，遮盖牌面
    return p.melds.map(m => {
      const copy = { ...m };
      if (m.type === 'concealed_kong' && s !== _mySeat) {
        copy.tiles = m.tiles.map(() => 0);  // 替换为牌背
      }
      return copy;
    });
  };

  // ── 返回的视图对象 ──
  return Object.freeze({
    // ============ 自己的信息 ============

    /** 自己的手牌（副本，修改不影响原始） */
    get myHand() { return copyHand(); },

    /** 自己的副露（碰/杠） */
    get myMelds() { return copyMelds(_mySeat); },

    /** 自己的弃牌 */
    get myDiscards() { return copyDiscards(_mySeat); },

    // ============ 公开的全局信息 ============

    /** 所有玩家的弃牌 [东弃牌[], 南弃牌[], 西弃牌[], 北弃牌[]] */
    get allDiscards() {
      return [0, 1, 2, 3].map(s => copyDiscards(s));
    },

    /** 所有玩家的公开副露 */
    get allMelds() {
      return [0, 1, 2, 3].map(s => copyMelds(s));
    },

    /** 各玩家手牌张数（公开可数，不暴露具体牌面） */
    get playerHandSizes() {
      return [0, 1, 2, 3].map(s => {
        const p = _gs.players[s];
        return p ? p.hand.length : 0;
      });
    },

    /** 牌墙剩余张数（仅张数，不能看具体牌） */
    get wallRemaining() {
      return _gs.wall.remaining();
    },

    /** 最后打出的牌信息 { tileType, seat } */
    get lastDiscard() {
      return _gs.lastDiscard ? { ..._gs.lastDiscard } : null;
    },

    /** 弃牌者的座位号 */
    get lastDiscardBySeat() {
      return _gs.lastDiscardBySeat;
    },

    // ============ 游戏公共状态 ============

    /** 当前轮到谁 */
    get currentSeat() { return _gs.currentSeat; },

    /** 庄家座位 */
    get windDealer() { return _gs.windDealer; },

    /** 游戏阶段 */
    get phase() { return _gs.phase; },

    /** 第几局 */
    get round() { return _gs.round; },

    /** 回合计数（用于天胡/地胡/人胡判定） */
    get turnNumber() { return _gs.turnNumber; },

    /** 是否刚杠后补牌（影响杠上开花） */
    get isKongAfterDraw() { return _gs.isKongAfterDraw; },

    /** 连续杠计数 */
    get consecutiveKongCount() { return _gs.consecutiveKongCount; },

    /** 待处理的操作队列 */
    get actionQueue() {
      return _gs.actionQueue.map(a => ({ ...a }));
    },

    // ============ AI 可用的辅助方法 ============

    /**
     * 判断自己的手牌能否胡（不加入额外牌）
     * 使用 FanCalculator 纯函数，不访问其他玩家数据
     * @returns {boolean}
     */
    canSelfWin() {
      const hand = copyHand();
      const result = FanCalculator.checkWin(hand);
      return result.isWin;
    },

    /**
     * 判断如果加入一张牌后能否胡（用于评估碰/吃/听牌价值）
     * @param {number} tileType - 假设加入的牌
     * @returns {boolean}
     */
    canWinWith(tileType) {
      const hand = copyHand();
      const testHand = [...hand, tileType].sort((a, b) => a - b);
      const result = FanCalculator.checkWin(testHand);
      return result.isWin;
    },

    /**
     * 获取某玩家的昵称（公开信息）
     * @param {number} s - 座位号
     * @returns {string}
     */
    playerName(s) {
      const p = _gs.players[s];
      return p ? p.name : '?';
    },

    /**
     * 获取某玩家是否 AI（公开信息）
     * @param {number} s - 座位号
     * @returns {boolean}
     */
    isPlayerAI(s) {
      const p = _gs.players[s];
      return p ? !!p.isAI : false;
    },
  });
}

module.exports = { createAiView };
