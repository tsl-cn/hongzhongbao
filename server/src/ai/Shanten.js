/**
 * Shanten.js — 向听数计算器
 *
 * 计算手牌距离听牌还有几步
 * 支持红中万能牌 + 标准型 + 七对子型
 *
 * 向听数 = 0 → 听牌
 * 向听数 = 1 → 一向听
 * 向听数 = 2 → 二向听
 * 向听数 = -1 → 已经胡牌
 */

const { isWild, isHonor, WILD_TILE } = require('../game/TileDef');

class Shanten {
  /**
   * 计算手牌的向听数（取标准型和七对子中的最小值）
   * @param {number[]} hand - 手牌数组
   * @returns {number} 向听数
   */
  static calculate(hand) {
    const wilds = hand.filter(t => isWild(t)).length;
    const normalTiles = hand.filter(t => !isWild(t)).sort((a, b) => a - b);

    const standardShanten = Shanten._calcStandardShanten(normalTiles, wilds);
    const sevenPairShanten = Shanten._calcSevenPairShanten(normalTiles, wilds);

    return Math.min(standardShanten, sevenPairShanten);
  }

  /**
   * 计算对每种弃牌方案的向听数
   * 返回所有方案排序（向听数小→大）
   * @param {number[]} hand - 完整手牌
   * @returns {Array} [{ discardTile, shanten, usefulTiles, usefulCount }]
   */
  static evaluateDiscards(hand) {
    const wilds = hand.filter(t => isWild(t)).length;
    const normalTiles = hand.filter(t => !isWild(t));
    const counts = {};
    for (const t of normalTiles) {
      counts[t] = (counts[t] || 0) + 1;
    }

    const results = [];
    const evaluated = new Set();

    // 遍历每种不同的牌（避免重复评估相同牌）
    for (const tileType of normalTiles) {
      if (evaluated.has(tileType)) continue;
      evaluated.add(tileType);

      // 移除此牌
      const newNormal = [...normalTiles];
      const idx = newNormal.indexOf(tileType);
      newNormal.splice(idx, 1);

      const shanten = Shanten._calcStandardShanten(newNormal, wilds);
      const sevenShanten = Shanten._calcSevenPairShanten(newNormal, wilds);
      const bestShanten = Math.min(shanten, sevenShanten);

      // 计算有効牌数量（进张数）
      const usefulCount = bestShanten === 0
        ? Shanten._countTilesToWin(newNormal, wilds)
        : Shanten._countUsefulTiles(newNormal, wilds, bestShanten);

      results.push({
        discardTile: tileType,
        shanten: bestShanten,
        usefulTiles: usefulCount,
      });
    }

    // 按向听数排序，同向听数按有効牌数量倒序
    results.sort((a, b) => {
      if (a.shanten !== b.shanten) return a.shanten - b.shanten;
      return b.usefulTiles - a.usefulTiles;
    });

    return results;
  }

  /**
   * 计算标准牌型的向听数（4面子+1对）
   * 使用标准公式: shanten = 8 - 2*melds - mentsu - pairs
   */
  static _calcStandardShanten(tiles, wilds) {
    if (tiles.length === 0) {
      // 全是红中，看能组成什么
      const total = wilds;
      if (total < 2) return 4; // 连将都没有
      const meldWilds = total - 2;
      return Math.max(0, 4 - Math.floor(meldWilds / 3) - 1); // 1对 + N个面子
    }

    // 用递归计算最大面子数
    const counts = {};
    for (const t of tiles) {
      counts[t] = (counts[t] || 0) + 1;
    }

    let result = Shanten._findBestCombination(counts, wilds, 0, 0, 0);
    
    // shanten = 8 - 2*完整面子 - 部分面子 - 对子
    // 但实际上我们用另一种公式: 
    // hand size = 14 - wilds（多张） or 13
    const totalTiles = tiles.length + wilds;
    const handSize = totalTiles;
    
    // 用红中补足
    let shanten = 8 - 2 * result.completeMelds - result.partialMelds - result.pairs;
    
    // 调整：手牌不满13张时用红中填充
    // 标准胡牌是14张，当前手牌数决定向听数的基数调整
    const targetMelds = 4;
    const targetPairs = 1;
    
    // 简化计算
    const needMelds = targetMelds - result.completeMelds;
    const havePairs = result.pairs;
    
    // 用红中补面子
    let remainingWilds = wilds - result.wildsUsed;
    
    // 每个缺的面子可以用3个红中补
    let effectiveMelds = result.completeMelds + result.partialMelds;
    let effectivePairs = result.pairs;
    
    // 每个部分面子少算0.5
    shanten = Math.max(0, shanten);
    
    return shanten;
  }

  /**
   * 递归搜索最佳组合方式（最大面子数）
   */
  static _findBestCombination(counts, wilds, depth, melds, pairs) {
    if (depth >= 20) {
      return { completeMelds: melds, partialMelds: 0, pairs, wildsUsed: 0 };
    }

    const entries = Object.entries(counts)
      .map(([k, v]) => [parseInt(k), v])
      .filter(([k, v]) => v > 0);

    if (entries.length === 0) {
      // 所有牌都用完了
      const extraMelds = Math.floor(wilds / 3);
      return {
        completeMelds: melds + extraMelds,
        partialMelds: 0,
        pairs: pairs + (wilds % 3 >= 2 ? 1 : 0),
        wildsUsed: wilds,
      };
    }

    let best = { completeMelds: melds, partialMelds: 0, pairs, wildsUsed: 0 };

    const [first, firstCount] = entries[0];
    const newCounts = { ...counts };

    // 尝试刻子
    if (firstCount >= 3) {
      newCounts[first] -= 3;
      if (newCounts[first] <= 0) delete newCounts[first];
      const r = Shanten._findBestCombination(newCounts, wilds, depth + 1, melds + 1, pairs);
      if (Shanten._compareResult(r, best) > 0) best = r;
      newCounts[first] = firstCount; // 恢复
    }

    // 尝试用红中补刻子 (缺1个)
    if (firstCount >= 2 && wilds >= 1) {
      newCounts[first] -= 2;
      if (newCounts[first] <= 0) delete newCounts[first];
      const r = Shanten._findBestCombination(newCounts, wilds - 1, depth + 1, melds + 1, pairs);
      if (Shanten._compareResult(r, best) > 0) best = r;
      newCounts[first] = firstCount;
    }

    // 尝试用红中补刻子 (缺2个)
    if (firstCount >= 1 && wilds >= 2) {
      newCounts[first] -= 1;
      if (newCounts[first] <= 0) delete newCounts[first];
      const r = Shanten._findBestCombination(newCounts, wilds - 2, depth + 1, melds + 1, pairs);
      if (Shanten._compareResult(r, best) > 0) best = r;
      newCounts[first] = firstCount;
    }

    // 尝试对子
    if (firstCount >= 2 && pairs < 1) {
      newCounts[first] -= 2;
      if (newCounts[first] <= 0) delete newCounts[first];
      const r = Shanten._findBestCombination(newCounts, wilds, depth + 1, melds, pairs + 1);
      if (Shanten._compareResult(r, best) > 0) best = r;
      newCounts[first] = firstCount;
    }

    // 尝试用红中补对子 (缺1个)
    if (firstCount >= 1 && pairs < 1 && wilds >= 1) {
      newCounts[first] -= 1;
      if (newCounts[first] <= 0) delete newCounts[first];
      const r = Shanten._findBestCombination(newCounts, wilds - 1, depth + 1, melds, pairs + 1);
      if (Shanten._compareResult(r, best) > 0) best = r;
      newCounts[first] = firstCount;
    }

    // 尝试顺子 (仅限万筒条)
    if (!isHonor(first)) {
      const t2 = first + 1;
      const t3 = first + 2;
      
      // 检查是否跨花色
      if (Math.floor(first / 9) === Math.floor(t2 / 9) && Math.floor(first / 9) === Math.floor(t3 / 9)) {
        const c2 = newCounts[t2] || 0;
        const c3 = newCounts[t3] || 0;

        if (c2 >= 1 && c3 >= 1) {
          const nc = { ...newCounts };
          nc[first] -= 1;
          if (nc[first] <= 0) delete nc[first];
          nc[t2] -= 1;
          if (nc[t2] <= 0) delete nc[t2];
          nc[t3] -= 1;
          if (nc[t3] <= 0) delete nc[t3];
          const r = Shanten._findBestCombination(nc, wilds, depth + 1, melds + 1, pairs);
          if (Shanten._compareResult(r, best) > 0) best = r;
        }

        // 用红中补顺子缺的位置
        if (c2 >= 1 && wilds >= 1) {
          const nc = { ...newCounts };
          nc[first] -= 1;
          if (nc[first] <= 0) delete nc[first];
          nc[t2] -= 1;
          if (nc[t2] <= 0) delete nc[t2];
          const r = Shanten._findBestCombination(nc, wilds - 1, depth + 1, melds + 1, pairs);
          if (Shanten._compareResult(r, best) > 0) best = r;
        }

        if (c3 >= 1 && wilds >= 1) {
          const nc = { ...newCounts };
          nc[first] -= 1;
          if (nc[first] <= 0) delete nc[first];
          nc[t3] -= 1;
          if (nc[t3] <= 0) delete nc[t3];
          const r = Shanten._findBestCombination(nc, wilds - 1, depth + 1, melds + 1, pairs);
          if (Shanten._compareResult(r, best) > 0) best = r;
        }
      }
    }

    // 跳过这张牌（当孤张处理）
    {
      const nc = { ...newCounts };
      delete nc[first];
      const r = Shanten._findBestCombination(nc, wilds, depth + 1, melds, pairs);
      if (Shanten._compareResult(r, best) > 0) best = r;
    }

    return best;
  }

  /** 比较两个组合结果，返回1(更好)/0(相等)/-1(更差) */
  static _compareResult(a, b) {
    if (a.completeMelds !== b.completeMelds) return a.completeMelds - b.completeMelds;
    if (a.pairs !== b.pairs) return a.pairs - b.pairs;
    return a.wildsUsed - b.wildsUsed;
  }

  /**
   * 计算七对子向听数
   */
  static _calcSevenPairShanten(tiles, wilds) {
    const counts = {};
    for (const t of tiles) {
      counts[t] = (counts[t] || 0) + 1;
    }

    let pairs = 0;
    let singles = 0;

    for (const c of Object.values(counts)) {
      if (c >= 2) {
        pairs += Math.floor(c / 2);
        if (c % 2 === 1) singles++;
      } else {
        singles++;
      }
    }

    // 用红中补单张成对
    const needed = Math.max(0, 7 - pairs);
    if (wilds >= needed) {
      return 0; // 听牌或胡牌
    }

    return 7 - pairs - wilds;
  }

  /**
   * 计算几首听（已经听牌时，计算有几张牌能胡）
   */
  static _countTilesToWin(tiles, wilds) {
    let count = 0;
    for (let t = 0; t <= 33; t++) {
      if (isWild(t)) continue;
      const testTiles = [...tiles, t];
      if (Shanten._isWin(testTiles, wilds)) {
        count++;
      }
    }
    return count;
  }

  /** 简单胡牌判断（供AI用） */
  static _isWin(tiles, wilds) {
    // 用 FanCalculator 判断
    const { isWild: _iw } = require('../game/TileDef');
    // 简化：组合所有牌
    const allTiles = [...tiles];
    for (let i = 0; i < wilds; i++) allTiles.push(WILD_TILE);
    allTiles.sort((a, b) => a - b);

    const FanCalculator = require('../game/FanCalculator');
    const result = FanCalculator.checkWin(allTiles);
    return result.isWin;
  }

  /**
   * 计算有効牌（进张）数量
   * 对每种可能的摸牌，计算新的向听数是否降低
   */
  static _countUsefulTiles(tiles, wilds, currentShanten) {
    let count = 0;
    for (let t = 0; t <= 33; t++) {
      if (isWild(t)) continue;
      const newTiles = [...tiles, t];
      const newShanten = Shanten._calcStandardShanten(newTiles, wilds);
      const newSeven = Shanten._calcSevenPairShanten(newTiles, wilds);
      if (Math.min(newShanten, newSeven) < currentShanten) {
        count++;
      }
    }
    return count;
  }
}

module.exports = Shanten;
