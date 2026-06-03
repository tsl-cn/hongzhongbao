/**
 * Player.js — 玩家基类
 * 人类玩家和 AI 玩家都继承自此
 */

const { TILE_NAMES } = require('../game/TileDef');

class Player {
  /**
   * @param {string} id - 唯一标识
   * @param {string} name - 显示名称
   * @param {boolean} isAI - 是否是AI
   * @param {number} seatIndex - 座位号 0=东 1=南 2=西 3=北
   */
  constructor(id, name, isAI, seatIndex) {
    this.id = id;
    this.name = name;
    this.isAI = isAI;
    this.seatIndex = seatIndex; // 0=东 1=南 2=西 3=北
    this.hand = [];        // 手牌
    this.melds = [];       // 副露（碰/杠）
    this.kongCount = 0;    // 杠的数量
    this.discards = [];    // 弃牌记录
    this.isReady = false;  // 是否准备
    this.isConnected = true;
    this.disconnected = false;  // 断线标记
    this.aiControlled = false;   // AI 托管中
  }

  /** 获取手牌数量 */
  get handSize() {
    return this.hand.length;
  }

  /** 添加手牌（不自动排序，保留摸牌顺序） */
  addToHand(tileType) {
    this.hand.push(tileType);
  }

  /** 手牌排序（打出后调用） */
  sortHand() {
    this.hand.sort((a, b) => a - b);
  }

  /** 从手牌移除 */
  removeFromHand(tileType) {
    const idx = this.hand.indexOf(tileType);
    if (idx !== -1) {
      this.hand.splice(idx, 1);
      return true;
    }
    return false;
  }

  /** 出牌 */
  discardTile(tileType) {
    if (this.removeFromHand(tileType)) {
      this.discards.push(tileType);
      return true;
    }
    return false;
  }

  /** 添加副露（碰/杠） */
  addMeld(meld) {
    this.melds.push(meld);
    if (meld.type === 'kong' || meld.type === 'exposed_kong' || meld.type === 'concealed_kong') {
      this.kongCount++;
    }
  }

  /** 重置（新一局） */
  reset() {
    this.hand = [];
    this.melds = [];
    this.kongCount = 0;
    this.discards = [];
    this.isReady = false;
  }

  /** 获取手牌中每种牌的数量 */
  getHandCounts() {
    const counts = {};
    for (const tile of this.hand) {
      counts[tile] = (counts[tile] || 0) + 1;
    }
    return counts;
  }

  /** 显示手牌（调试用） */
  handToString() {
    return this.hand.map(t => TILE_NAMES[t] || t).join(' ');
  }
}

module.exports = Player;
