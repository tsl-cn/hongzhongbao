/**
 * ActionDecider.js — AI碰杠胡决策
 *
 * 高手策略：
 * - 碰：减少向听数则碰；不减少但能增加番型可能性则看情况
 * - 杠：减少向听数则杠；暗杠且有分数价值则杠
 * - 胡：自摸必胡；点炮评估番数
 */

const Shanten = require('./Shanten');
const { isWild, TILE_NAMES } = require('../game/TileDef');

class ActionDecider {
  /**
   * 决定是否碰
   * @param {number[]} hand - 手牌
   * @param {number} tileType - 要碰的牌
   * @param {number} shanten - 当前向听数
   * @returns {boolean} 是否碰
   */
  static shouldPong(hand, tileType, shanten) {
    // 模拟碰后的手牌
    const newHand = [...hand];
    // 移除手牌中的2张(碰)
    let removed = 0;
    for (let i = newHand.length - 1; i >= 0 && removed < 2; i--) {
      if (newHand[i] === tileType) {
        newHand.splice(i, 1);
        removed++;
      }
    }

    // 碰完后手牌数 -2，要出1张
    const newShanten = Shanten.calculate(newHand);

    // 核心策略：向听数减少则碰
    if (newShanten < shanten) return true;

    // 向听数不变但已经是听牌：看番型潜力
    if (newShanten === shanten && shanten === 0) {
      // 如果碰后能增加番型价值（如碰碰胡），可以考虑碰
      return false; // 保守：不碰
    }

    // 向听数不变且不是听牌：评估碰后的进张数
    if (newShanten === shanten) {
      const evals = Shanten.evaluateDiscards(newHand);
      if (evals.length > 0 && evals[0].usefulTiles >= 8) {
        return true; // 进张多可以碰
      }
    }

    return false; // 向听数不减少，不碰
  }

  /**
   * 决定是否杠
   * @param {string} kongType - 杠类型: 'exposed'(明杠) | 'concealed'(暗杠) | '补杠'
   * @param {number[]} hand - 手牌(杠前)
   * @param {number} tileType - 杠的牌
   * @param {number} shanten - 当前向听数
   * @returns {boolean} 是否杠
   */
  static shouldKong(kongType, hand, tileType, shanten) {
    const newHand = [...hand];

    if (kongType === 'concealed') {
      // 暗杠：移除4张
      let removed = 0;
      for (let i = newHand.length - 1; i >= 0 && removed < 4; i--) {
        if (newHand[i] === tileType) {
          newHand.splice(i, 1);
          removed++;
        }
      }
    } else {
      // 明杠/补杠：移除3张
      let removed = 0;
      for (let i = newHand.length - 1; i >= 0 && removed < 3; i--) {
        if (newHand[i] === tileType) {
          newHand.splice(i, 1);
          removed++;
        }
      }
    }

    // 杠后手牌减少，要补摸1张(但这里简化判断)
    // 暗杠：+1番，值得
    if (kongType === 'concealed') return true;

    // 明杠/补杠：只加1番，但暴露牌型，谨慎
    const newShanten = Shanten.calculate(newHand);
    if (newShanten < shanten) return true;
    if (newShanten === shanten && shanten <= 1) return true;

    return false;
  }

  /**
   * 决定是否胡
   * @param {boolean} isSelfDraw - 是否自摸
   * @param {number} fan - 番数
   * @param {number} shanten - 当前向听数
   * @returns {boolean} 是否胡
   */
  static shouldWin(isSelfDraw, fan, shanten) {
    // 自摸必胡
    if (isSelfDraw) return true;

    // 点炮：番数≥3就胡（三番起胡）
    if (fan >= 3) return true;

    // 牌墙快空了（海底）→ 降低要求
    return false;
  }

  /**
   * 决定是否抢杠胡
   */
  static shouldRobbingKong(fan) {
    return fan >= 3;
  }
}

module.exports = ActionDecider;
