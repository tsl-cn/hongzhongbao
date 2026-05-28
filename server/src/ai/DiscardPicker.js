/**
 * DiscardPicker.js — 弃牌选择器
 *
 * 高手级弃牌策略：
 * 1. 优先选向听数最小的方案
 * 2. 同向听数时选有効牌（进张）最多的
 * 3. 同进张数时选安全牌（防守）
 * 4. 兼顾做大的可能性（如保留同花色牌凑清一色）
 */

const Shanten = require('./Shanten');
const { isWild, getSuit, isHonor, TILE_NAMES, WILD_TILE } = require('../game/TileDef');

class DiscardPicker {
  /**
   * 选择最佳弃牌
   * @param {number[]} hand - 当前手牌
   * @param {number[][]} allDiscards - 所有玩家的弃牌记录 [ [东弃牌], [南弃牌], [西弃牌], [北弃牌] ]
   * @param {number} mySeat - 自己的座位
   * @param {number} wallRemaining - 牌墙剩余张数
   * @returns {object} { discardTile, shanten, reason }
   */
  static pickBestDiscard(hand, allDiscards, mySeat, wallRemaining) {
    const evaluations = Shanten.evaluateDiscards(hand);

    if (evaluations.length === 0) {
      // 全是红中？随便打
      const nonWild = hand.filter(t => !isWild(t));
      return { discardTile: nonWild[0] || hand[0], shanten: -1, reason: '无牌可选' };
    }

    const bestShanten = evaluations[0].shanten;

    // 选出所有向听数最小的方案
    const candidates = evaluations.filter(e => e.shanten === bestShanten);

    if (candidates.length === 1) {
      return {
        discardTile: candidates[0].discardTile,
        shanten: candidates[0].shanten,
        usefulTiles: candidates[0].usefulTiles,
        reason: '唯一最优',
      };
    }

    // 多方案：打分排序
    let bestScore = -Infinity;
    let bestCandidate = candidates[0];

    for (const c of candidates) {
      const score = DiscardPicker._scoreDiscard(c, hand, allDiscards, mySeat, wallRemaining);
      if (score > bestScore) {
        bestScore = score;
        bestCandidate = c;
      }
    }

    return {
      discardTile: bestCandidate.discardTile,
      shanten: bestCandidate.shanten,
      usefulTiles: bestCandidate.usefulTiles,
      reason: `评分 ${bestScore.toFixed(1)}`,
    };
  }

  /**
   * 对弃牌方案进行综合评分（越高越好）
   */
  static _scoreDiscard(evaluation, hand, allDiscards, mySeat, wallRemaining) {
    const tile = evaluation.discardTile;
    let score = 0;

    // 1. 进张数评分 (最重要)
    score += evaluation.usefulTiles * 10;

    // 2. 防守评分：打别人弃过的牌更安全
    const dangerLevel = DiscardPicker._assessDanger(tile, allDiscards, mySeat);
    score += (5 - dangerLevel) * 3; // danger 0=安全→+15, danger 5=极危险→0

    // 3. 手牌效率评分
    const suit = getSuit(tile);
    const suitCounts = { man: 0, pin: 0, sou: 0, honor: 0 };
    for (const t of hand) {
      if (!isWild(t)) {
        suitCounts[getSuit(t)]++;
      }
    }

    // 保留多花色（有利于凑牌）
    // 如果某花色只有1-2张，优先打掉（除非在做清/混一色）
    if (suitCounts[suit] <= 2 && suitCounts[suit] > 0) {
      score += 2; // 打掉孤张
    }

    // 4. 中张牌（3-7）价值高于边张（1/9）和字牌
    const num = tile <= 26 ? (tile % 9) + 1 : 0;
    if (num >= 3 && num <= 7) {
      score -= 1; // 中张牌留着可能有更多进张
    } else if (num === 1 || num === 9 || isHonor(tile)) {
      score += 1; // 边张和字牌价值低
    }

    return score;
  }

  /**
   * 评估一张牌的危险程度 (0=安全 ~ 5=极危险)
   * 基于其他玩家的弃牌记录
   */
  static _assessDanger(tile, allDiscards, mySeat) {
    let danger = 0;

    for (let seat = 0; seat < 4; seat++) {
      if (seat === mySeat) continue;
      const discards = allDiscards[seat] || [];

      // 如果该玩家打过这张牌 → 安全（他不会胡这张）
      if (discards.includes(tile)) {
        danger -= 0.5;
        continue;
      }

      // 如果该玩家打过邻张 → 可能在做顺子
      const num = tile <= 26 ? (tile % 9) + 1 : 0;
      if (num > 0) {
        const neighbors = [tile - 1, tile + 1].filter(t =>
          t >= 0 && t <= 26 && Math.floor(t / 9) === Math.floor(tile / 9)
        );
        const hasNeighbor = neighbors.some(n => discards.includes(n));
        if (hasNeighbor) {
          danger += 0.3; // 打邻张可能在做顺子，有较小危险
        }
      }

      // 未出牌张数多 → 可能听牌
      if (discards.length > 8) {
        danger += 0.5; // 中局以后
      }
      if (discards.length > 14) {
        danger += 0.5; // 后期，危险增加
      }
    }

    return Math.min(5, Math.max(0, danger));
  }
}

module.exports = DiscardPicker;
