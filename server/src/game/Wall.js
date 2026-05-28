/**
 * Wall.js — 牌墙引擎
 *
 * 功能：洗牌、摇骰定墙定墩、起牌、吊牌、买马抽牌
 */

const { createDeck } = require('./TileDef');

class Wall {
  constructor() {
    this.tiles = [];      // 剩余牌墙
    this.discards = [];   // 弃牌堆
    this.dealtWallIndex = 0; // 从哪墩开始拿牌
  }

  /** 洗牌（Fisher-Yates） */
  shuffle() {
    this.tiles = createDeck();
    for (let i = this.tiles.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.tiles[i], this.tiles[j]] = [this.tiles[j], this.tiles[i]];
    }
    this.discards = [];
  }

  /** 摇骰子（1-6） */
  static rollDice() {
    return Math.floor(Math.random() * 6) + 1;
  }

  /** 摇2颗骰子，返回点数和 */
  static rollTwoDice() {
    return Wall.rollDice() + Wall.rollDice();
  }

  /**
   * 定墙定墩
   * 庄家摇2骰子，点数和为S
   * 先大后小: 从庄家开始逆时针数S确定牌墙，再从右往左数S墩
   * 返回 { wallIndex, startPos }
   */
  determineBreak(windIndex, diceSum) {
    // windIndex: 0=东 1=南 2=西 3=北
    // 从庄家开始，逆时针数 diceSum % 4 确定哪面墙
    const wallIndex = (windIndex + (diceSum % 4 === 0 ? 4 : diceSum % 4)) % 4;
    // 从右往左数 diceSum 墩
    const startPos = diceSum * 2; // 一墩2张
    return { wallIndex, startPos };
  }

  /**
   * 起牌流程
   * 庄家先抓4张 → 南4张 → 西4张 → 北4张，绕3圈
   * 然后吊牌: 东2张 → 南1张 → 西1张 → 北1张
   * 最终: 东14张, 其他13张
   */
  dealInitial() {
    const hands = [[], [], [], []]; // 东南西北

    // 模拟136张牌排成牌墙
    // 实际上我们直接按顺序发
    let cursor = 0;

    // 绕3圈，每人每次4张
    for (let round = 0; round < 3; round++) {
      for (let seat = 0; seat < 4; seat++) {
        hands[seat].push(...this.tiles.slice(cursor, cursor + 4));
        cursor += 4;
      }
    }

    // 吊牌阶段
    // 东拿2张
    hands[0].push(this.tiles[cursor], this.tiles[cursor + 1]);
    cursor += 2;
    // 南拿1张
    hands[1].push(this.tiles[cursor]);
    cursor += 1;
    // 西拿1张
    hands[2].push(this.tiles[cursor]);
    cursor += 1;
    // 北拿1张
    hands[3].push(this.tiles[cursor]);
    cursor += 1;

    // 剩余牌墙
    this.dealtWallIndex = cursor;

    return hands;
  }

  /** 摸一张牌 */
  draw() {
    if (this.dealtWallIndex >= this.tiles.length) {
      return null; // 牌墙空了，流局
    }
    const tile = this.tiles[this.dealtWallIndex];
    this.dealtWallIndex++;
    return tile;
  }

  /** 从牌墙末尾抽牌（买马用） */
  drawFromBack() {
    if (this.dealtWallIndex >= this.tiles.length) {
      return null;
    }
    return this.tiles.pop();
  }

  /** 查看剩余牌数 */
  remaining() {
    return this.tiles.length - this.dealtWallIndex;
  }

  /** 弃牌 */
  discard(tileType) {
    this.discards.push(tileType);
  }

  /** 获取牌墙剩余张数 */
  getWallRemaining() {
    return this.tiles.length - this.dealtWallIndex;
  }
}

module.exports = Wall;
