/**
 * HorseBuyer.js — 买马逻辑
 *
 * 买马使用**独立牌堆**，不占用游戏牌墙
 *
 * 时机：抓完牌，东开打前
 * 选人：摇2骰子，点数和从东=1顺时针数
 * 马牌：从独立牌堆抽1-4张，扣桌上不能看
 * 开牌：胡牌后才亮开
 * 结算：中→赢胡牌人番数；不中→赔胡牌人番数
 */

const crypto = require('crypto');
const { createDeck, TILE_NAMES } = require('./TileDef');

// 马牌对应表：数字1/5/9+东风→东, 2/6+南风+红中→南, 3/7+西风+发财→西, 4/8+北风+白板→北
const HORSE_MAP = {};

function _initHorseMap() {
  const map = {};
  for (let i = 0; i <= 26; i++) {
    const num = (i % 9) + 1;
    if (num === 1 || num === 5 || num === 9) map[i] = 0;
    else if (num === 2 || num === 6) map[i] = 1;
    else if (num === 3 || num === 7) map[i] = 2;
    else if (num === 4 || num === 8) map[i] = 3;
  }
  map[27] = 0; map[28] = 1; map[29] = 2; map[30] = 3;
  map[31] = 1; map[32] = 2; map[33] = 3;
  return map;
}

const HORSE_MAP_INIT = _initHorseMap();

class HorseBuyer {
  constructor() {
    /** 独立马牌牌堆（136张，和游戏牌堆无关） */
    this.horseDeck = [];
    this._shuffleHorseDeck();
  }

  /** 洗独立马牌牌堆 */
  _shuffleHorseDeck() {
    this.horseDeck = createDeck();
    for (let i = this.horseDeck.length - 1; i > 0; i--) {
      const j = crypto.randomInt(i + 1);
      [this.horseDeck[i], this.horseDeck[j]] = [this.horseDeck[j], this.horseDeck[i]];
    }
    this.horseIndex = 0;
  }

  /**
   * 买马流程（从独立牌堆抽牌）
   * @param {number} dealerSeat - 庄家座位
   * @param {number} horseCount - 买马张数 (1-4)
   * @param {object} [fixedDice] - 可选，指定骰子值（用于外部已摇骰决定 picker 时）
   * @param {number} [fixedDice.dice1]
   * @param {number} [fixedDice.dice2]
   * @returns {object} { diceSum, pickerSeat, horses: [{tileType, ownerSeat}] }
   */
  buyHorses(dealerSeat, horseCount = 1, fixedDice) {
    // 1. 摇骰选人（或使用传入的骰子值）
    const dice1 = fixedDice ? fixedDice.dice1 : crypto.randomInt(1, 7);
    const dice2 = fixedDice ? fixedDice.dice2 : crypto.randomInt(1, 7);
    const diceSum = dice1 + dice2;
    const pickerOffset = (diceSum - 1) % 4;
    const pickerSeat = (dealerSeat + pickerOffset) % 4;

    // 2. 从独立牌堆抽马牌
    const horses = [];
    for (let i = 0; i < horseCount; i++) {
      if (this.horseIndex >= this.horseDeck.length) {
        this._shuffleHorseDeck();
      }
      const tileType = this.horseDeck[this.horseIndex++];
      const ownerSeat = HORSE_MAP_INIT[tileType] ?? -1;
      horses.push({ tileType, ownerSeat });
    }

    return {
      dice1, dice2, diceSum,
      pickerSeat,
      horses,
    };
  }

  /**
   * 直接从独立牌堆随机抽 N 张牌（无骰子，每人独立用）
   * @param {number} count - 抽牌张数 (0-4)
   * @returns {Array<{tileType, ownerSeat}>}
   */
  drawRandom(count) {
    const horses = [];
    for (let i = 0; i < count; i++) {
      if (this.horseIndex >= this.horseDeck.length) {
        this._shuffleHorseDeck();
      }
      const tileType = this.horseDeck[this.horseIndex++];
      const ownerSeat = HORSE_MAP_INIT[tileType] ?? -1;
      horses.push({ tileType, ownerSeat });
    }
    return horses;
  }

  /**
   * 亮马结算
   * @param {Array} horses - [{ tileType, ownerSeat }]
   * @param {number} winnerSeat - 胡牌者座位
   * @param {number} winnerFan - 胡牌番数
   * @param {number} pickerSeat - 买马者座位
   * @returns {object} { results, totalAdjustment, pickerSeat, pickerAdjustment }
   */
  static settleHorses(horses, winnerSeat, winnerFan, pickerSeat) {
    let pickerAdjustment = 0;
    const results = [];

    for (const horse of horses) {
      const isHit = horse.ownerSeat === winnerSeat;
      // 中马 ×3，不中 ×1
      const adjustment = isHit ? winnerFan * 3 : -winnerFan;
      pickerAdjustment += adjustment;
      results.push({
        tileType: horse.tileType,
        tileName: TILE_NAMES[horse.tileType] || '?',
        ownerSeat: horse.ownerSeat,
        isHit,
        adjustment,
      });
    }

    return { results, pickerAdjustment, pickerSeat };
  }

  static getHorseSeat(tileType) {
    return HORSE_MAP_INIT[tileType] ?? -1;
  }
}

module.exports = HorseBuyer;
