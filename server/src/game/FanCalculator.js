/**
 * FanCalculator.js — 番型计算引擎
 *
 * 支持红中万能牌（31号牌）
 * 计算18种番型 + 叠加逻辑 + 20番封顶
 */

const { isWild, isMan, isPin, isSou, isHonor, TILE_NAMES, WILD_TILE } = require('./TileDef');

class FanCalculator {
  /**
   * 计算手牌的番数
   * @param {number[]} hand - 手牌（含红中）
   * @param {object[]} melds - 副露（碰/杠）
   * @param {object} options - { isSelfDraw, isDealer, isFirstTurn, isLastTile, isKongDraw, isRobbingKong }
   * @returns {object} { fan, patterns, detail }
   */
  static calculate(hand, melds, options = {}) {
    const result = {
      fan: 0,
      baseFan: 0,
      multiplier: 1,
      patterns: [],     // 番型列表
      isWin: false,
      handType: null,   // 'standard' | 'sevenPairs'
    };

    // 1. 判断是否能胡
    const winResult = FanCalculator.checkWin(hand);
    if (!winResult.isWin) {
      return { ...result, isWin: false };
    }

    result.isWin = true;
    result.handType = winResult.type;

    // 2. 基础番型计算
    const patterns = [];

    // 牌型相关
    if (winResult.type === 'sevenPairs') {
      patterns.push(...FanCalculator._calcSevenPairFans(hand));
    } else {
      // 4面子1将
      patterns.push(...FanCalculator._calcStandardFans(hand, melds));
    }

    // 花色相关
    patterns.push(...FanCalculator._calcSuitFans(hand, melds));

    // 幺九相关
    patterns.push(...FanCalculator._calcTerminalHonorFans(hand, melds));

    // 杠相关
    patterns.push(...FanCalculator._calcKongFans(melds));

    // 特殊条件
    if (options.isSelfDraw && !options.isFirstTurn && !options.isLastTile) {
      patterns.push({ name: '平胡(自摸)', fan: 2 });
    }

    // 门清 (没有副露且自摸)
    if (melds.length === 0 && options.isSelfDraw) {
      patterns.push({ name: '门清', fan: 2 });
    }

    // 天胡
    if (options.isFirstTurn && options.isDealer && options.isSelfDraw) {
      patterns.push({ name: '天胡', fan: 20 });
    }

    // 地胡
    if (options.isFirstTurn && !options.isDealer && !options.isDealerTurn && options.isSelfDraw) {
      patterns.push({ name: '地胡', fan: 20 });
    }

    // 人胡
    if (options.isFirstTurn && !options.isSelfDraw) {
      patterns.push({ name: '人胡', fan: 20 });
    }

    // 十八罗汉 (4个杠)
    const kongCount = melds.filter(m => m.type.includes('kong')).length;
    if (kongCount === 4) {
      patterns.push({ name: '十八罗汉', fan: 18 });
    }

    // 倍数
    if (options.isKongDraw) {
      if (options.isDoubleKongDraw) {
        result.multiplier *= 4;
        patterns.push({ name: '杠上杠开花', fan: 4, isMultiplier: true });
      } else {
        result.multiplier *= 2;
        patterns.push({ name: '杠上开花', fan: 2, isMultiplier: true });
      }
    }

    if (options.isLastTile) {
      result.multiplier *= 2;
      patterns.push({ name: '海底捞月', fan: 2, isMultiplier: true });
    }

    if (options.isRobbingKong) {
      patterns.push({ name: '抢杠胡', fan: 0, note: '抢杠者自算番' });
    }

    // 3. 叠加处理 (去除不可叠加的组合)
    const finalPatterns = FanCalculator._resolveOverlaps(patterns);
    result.patterns = finalPatterns;

    // 4. 计算总番
    let baseFan = 0;
    for (const p of finalPatterns) {
      if (!p.isMultiplier) {
        baseFan += p.fan;
      }
    }

    // 三番起胡
    if (baseFan < 3 && result.multiplier === 1) {
      return { ...result, isWin: false, reason: '三番起胡不足' };
    }

    result.baseFan = baseFan;
    result.fan = Math.min(baseFan * result.multiplier, 20); // 20番封顶

    return result;
  }

  /**
   * 判断手牌是否能胡（含红中万能牌）
   * 返回 { isWin, type: 'standard'|'sevenPairs', combinations? }
   */
  static checkWin(hand) {
    // 先检查七小对
    const sevenPairResult = FanCalculator._checkSevenPairs(hand);
    if (sevenPairResult.isWin) {
      return { isWin: true, type: 'sevenPairs', ...sevenPairResult };
    }

    // 检查标准牌型 (4面子+1将)
    const standardResult = FanCalculator._checkStandard(hand);
    if (standardResult.isWin) {
      return { isWin: true, type: 'standard', ...standardResult };
    }

    return { isWin: false };
  }

  /**
   * 检查七小对（红中可以配单张成对）
   */
  static _checkSevenPairs(hand) {
    if (hand.length !== 14) return { isWin: false };

    const counts = {};
    for (const t of hand) {
      counts[t] = (counts[t] || 0) + 1;
    }

    const wildCount = counts[WILD_TILE] || 0;
    let pairs = 0;
    let singles = [];
    let quadruples = 0; // 四张相同的数量

    for (const [tile, count] of Object.entries(counts)) {
      const t = parseInt(tile);
      if (t === WILD_TILE) continue;
      if (count === 4) {
        pairs += 2;
        quadruples++;
      } else if (count === 3) {
        pairs += 1;
        singles.push(t);
        singles.push(t); // 多的两张算两个单张
      } else if (count === 2) {
        pairs += 1;
      } else {
        singles.push(t);
      }
    }

    // 红中补单张成对
    let needed = singles.length;
    if (wildCount >= needed) {
      pairs += needed;
    } else {
      return { isWin: false };
    }

    if (pairs === 7) {
      return {
        isWin: true,
        quadruples,
        luxuryLevel: quadruples, // 0=普通 1=豪华 2=双豪华 3=三豪华
      };
    }

    return { isWin: false };
  }

  /**
   * 检查标准牌型 (4面子+1对)
   * 使用递归+回溯，红中作万能牌替代
   */
  static _checkStandard(hand) {
    if (hand.length !== 14) return { isWin: false };

    const counts = {};
    for (const t of hand) {
      counts[t] = (counts[t] || 0) + 1;
    }

    const wildCount = counts[WILD_TILE] || 0;
    delete counts[WILD_TILE];

    // 尝试每个可能的将牌
    for (const pairTile of Object.keys(counts)) {
      const t = parseInt(pairTile);
      let remainCounts = { ...counts };

      if (remainCounts[t] >= 2) {
        remainCounts[t] -= 2;
      } else if (remainCounts[t] === 1 && wildCount >= 1) {
        remainCounts[t] -= 1;
        if (FanCalculator._canFormMelds(remainCounts, wildCount - 1)) {
          return { isWin: true, pairTile: t };
        }
        continue;
      } else {
        continue;
      }

      if (remainCounts[t] === 0) delete remainCounts[t];

      if (FanCalculator._canFormMelds(remainCounts, wildCount)) {
        return { isWin: true, pairTile: t };
      }
    }

    // 将牌是红中
    if (wildCount >= 2) {
      const remainCounts = { ...counts };
      if (FanCalculator._canFormMelds(remainCounts, wildCount - 2)) {
        return { isWin: true, pairTile: WILD_TILE };
      }
    }

    return { isWin: false };
  }

  /**
   * 检查是否能组成4个面子（刻子或顺子）
   * 红中可替代任何牌
   */
  static _canFormMelds(counts, wilds, depth = 0) {
    if (depth >= 4) {
      // 检查是否所有牌都用完了
      const remaining = Object.values(counts).reduce((s, c) => s + c, 0);
      return remaining <= wilds;
    }

    // 找到第一张非零的牌
    const tiles = Object.keys(counts)
      .map(Number)
      .filter(t => counts[t] > 0)
      .sort((a, b) => a - b);

    if (tiles.length === 0) {
      return wilds >= 4 - depth; // 剩下的都用红中补
    }

    const first = tiles[0];

    // 尝试刻子 (三张相同)
    if (counts[first] >= 3) {
      const nextCounts = { ...counts };
      nextCounts[first] -= 3;
      if (nextCounts[first] === 0) delete nextCounts[first];
      if (FanCalculator._canFormMelds(nextCounts, wilds, depth + 1)) return true;
    }

    // 用红中补刻子 (counts[first] === 2, 用1个红中)
    if (counts[first] === 2 && wilds >= 1) {
      const nextCounts = { ...counts };
      delete nextCounts[first];
      if (FanCalculator._canFormMelds(nextCounts, wilds - 1, depth + 1)) return true;
    }

    // 用红中补刻子 (counts[first] === 1, 用2个红中)
    if (counts[first] === 1 && wilds >= 2) {
      const nextCounts = { ...counts };
      delete nextCounts[first];
      if (FanCalculator._canFormMelds(nextCounts, wilds - 2, depth + 1)) return true;
    }

    // 尝试顺子 (仅限万筒条)
    if (!isHonor(first)) {
      const suit = first <= 8 ? 'man' : first <= 17 ? 'pin' : 'sou';
      const suitBase = suit === 'man' ? 0 : suit === 'pin' ? 9 : 18;

      // 顺子 first, first+1, first+2
      const t2 = first + 1;
      const t3 = first + 2;

      // 检查是否在同一花色内
      if (first % 9 <= 7) { // first+1 在同一花色
        const c1 = counts[first] || 0;
        const c2 = counts[t2] || 0;
        const c3 = counts[t3] || 0;

        // 正常顺子
        if (c2 >= 1 && c3 >= 1) {
          const nextCounts = { ...counts };
          nextCounts[first] -= 1;
          if (nextCounts[first] === 0) delete nextCounts[first];
          nextCounts[t2] -= 1;
          if (nextCounts[t2] === 0) delete nextCounts[t2];
          nextCounts[t3] -= 1;
          if (nextCounts[t3] === 0) delete nextCounts[t3];
          if (FanCalculator._canFormMelds(nextCounts, wilds, depth + 1)) return true;
        }

        // 用红中补一个位置
        if (wilds >= 1) {
          // 缺 t2
          if (c1 >= 1 && c3 >= 1) {
            const nextCounts = { ...counts };
            nextCounts[first] -= 1;
            if (nextCounts[first] === 0) delete nextCounts[first];
            nextCounts[t3] -= 1;
            if (nextCounts[t3] === 0) delete nextCounts[t3];
            if (FanCalculator._canFormMelds(nextCounts, wilds - 1, depth + 1)) return true;
          }
          // 缺 t3
          if (c1 >= 1 && c2 >= 1) {
            const nextCounts = { ...counts };
            nextCounts[first] -= 1;
            if (nextCounts[first] === 0) delete nextCounts[first];
            nextCounts[t2] -= 1;
            if (nextCounts[t2] === 0) delete nextCounts[t2];
            if (FanCalculator._canFormMelds(nextCounts, wilds - 1, depth + 1)) return true;
          }
        }

        // 用红中补两个位置
        if (wilds >= 2 && c1 >= 1) {
          const nextCounts = { ...counts };
          nextCounts[first] -= 1;
          if (nextCounts[first] === 0) delete nextCounts[first];
          if (FanCalculator._canFormMelds(nextCounts, wilds - 2, depth + 1)) return true;
        }
      }
    }

    // 用3个红中凑一个面子
    if (wilds >= 3) {
      const nextCounts = { ...counts };
      if (FanCalculator._canFormMelds(nextCounts, wilds - 3, depth + 1)) return true;
    }

    return false;
  }

  /**
   * 七小对相关番型
   */
  static _calcSevenPairFans(hand) {
    const result = FanCalculator._checkSevenPairs(hand);
    const patterns = [];

    if (result.quadruples === 0) {
      patterns.push({ name: '七小对', fan: 6 });
    } else if (result.quadruples === 1) {
      patterns.push({ name: '豪华七小对', fan: 14 });
    } else if (result.quadruples === 2) {
      patterns.push({ name: '双豪华七小对', fan: 14 }); // 规则中豪华/双豪华都标14
    } else if (result.quadruples >= 3) {
      patterns.push({ name: '三豪华七小对', fan: 20 });
    }

    return patterns;
  }

  /**
   * 标准牌型（4面子1将）相关番型
   */
  static _calcStandardFans(hand, melds) {
    const patterns = [];

    // 碰碰胡 (所有面子都是刻子)
    if (FanCalculator._isAllPongs(hand, melds)) {
      patterns.push({ name: '碰碰胡', fan: 4, overlay: 2 });
    }

    return patterns;
  }

  /** 检查是否所有面子都是刻子（碰碰胡） */
  static _isAllPongs(hand, melds) {
    // 如果有顺子副露，不是碰碰胡
    for (const m of melds) {
      if (m.type === 'chow') return false;
    }
    // 检查手牌是否能组成全是刻子
    const counts = {};
    for (const t of hand) {
      if (isWild(t)) continue; // 红中万能牌
      counts[t] = (counts[t] || 0) + 1;
    }
    // 手牌中所有非红中牌应该是3张一组或2张(将)
    let hasPair = false;
    for (const c of Object.values(counts)) {
      if (c % 3 !== 0 && c % 3 !== 2) return false;
    }
    return true;
  }

  /**
   * 花色相关番型
   */
  static _calcSuitFans(hand, melds) {
    const patterns = [];
    const allTiles = [
      ...hand,
      ...melds.flatMap(m => m.tiles),
    ].filter(t => !isWild(t));

    const hasMan = allTiles.some(t => isMan(t));
    const hasPin = allTiles.some(t => isPin(t));
    const hasSou = allTiles.some(t => isSou(t));
    const hasHonor = allTiles.some(t => isHonor(t) && t !== WILD_TILE);

    const suitsInHand = [hasMan, hasPin, hasSou].filter(Boolean).length;

    if (suitsInHand === 0 && !hasHonor) {
      // 全是红中？不可能，但防御
    } else if (suitsInHand === 1 && hasHonor) {
      patterns.push({ name: '混一色', fan: 4, overlay: 2 });
    } else if (suitsInHand === 1 && !hasHonor) {
      patterns.push({ name: '清一色', fan: 8 });
    }

    // 全风
    const allWinds = allTiles.every(t => t >= 27 || isWild(t));
    if (allWinds) {
      patterns.push({ name: '全风', fan: 18 });
    }

    return patterns;
  }

  /**
   * 幺九相关番型
   */
  static _calcTerminalHonorFans(hand, melds) {
    const patterns = [];
    const allTiles = [
      ...hand,
      ...melds.flatMap(m => m.tiles),
    ].filter(t => !isWild(t));

    // 幺九牌 = 1万/9万/1筒/9筒/1条/9条 + 所有字牌
    const terminalHonorTiles = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33];

    const allAreTerminalHonor = allTiles.every(t => terminalHonorTiles.includes(t));

    if (allAreTerminalHonor) {
      // 检查是否有非幺九的牌（没有风/箭）
      const hasSimpleHonor = allTiles.some(t => t >= 27);
      if (hasSimpleHonor) {
        patterns.push({ name: '混幺九', fan: 8 });
      } else {
        patterns.push({ name: '全幺九', fan: 18 });
      }
    }

    return patterns;
  }

  /**
   * 杠相关番型
   */
  static _calcKongFans(melds) {
    const patterns = [];
    for (const m of melds) {
      if (m.type === 'kong' || m.type === 'exposed_kong') {
        patterns.push({ name: '明杠', fan: 1 });
      } else if (m.type === 'concealed_kong') {
        patterns.push({ name: '暗杠', fan: 2 });
      }
    }
    return patterns;
  }

  /**
   * 叠加逻辑处理
   * - 混幺九/全幺九/全风 含碰碰胡，不重复叠加
   * - 豪华七小对/三豪华七小对 不叠加普通七小对
   * - 混一色+清一色 不能同时存在
   */
  static _resolveOverlaps(patterns) {
    const result = [];

    // 提取非倍数和非叠加的番型
    const regulars = patterns.filter(p => !p.isMultiplier && !p.overlay);
    const overlays = patterns.filter(p => p.overlay);
    const multipliers = patterns.filter(p => p.isMultiplier);

    // 检查是否有互斥组合
    const names = regulars.map(p => p.name);

    // 清一色 + 混一色 互斥
    if (names.includes('清一色') && names.includes('混一色')) {
      // 清一色优先
      const idx = regulars.findIndex(p => p.name === '混一色');
      if (idx !== -1) regulars.splice(idx, 1);
    }

    // 七小对 / 豪华七小对 / 三豪华七小对 互不叠加
    const sevenPairTypes = ['七小对', '豪华七小对', '双豪华七小对', '三豪华七小对'];
    const hasSevenPair = sevenPairTypes.some(n => names.includes(n));
    if (hasSevenPair) {
      // 只保留最高级的七小对
      for (const n of sevenPairTypes.slice(0, -1)) {
        const idx = regulars.findIndex(p => p.name === n);
        if (idx !== -1 && regulars.some(p => {
          const ni = sevenPairTypes.indexOf(p.name);
          return ni > sevenPairTypes.indexOf(n);
        })) {
          regulars.splice(idx, 1);
        }
      }
    }

    // 全风 / 全幺九 / 混幺九 不叠加碰碰胡
    const bigPatterns = ['全风', '全幺九', '混幺九'];
    const hasBigPattern = bigPatterns.some(n => names.includes(n));
    if (hasBigPattern) {
      const pIdx = regulars.findIndex(p => p.name === '碰碰胡');
      if (pIdx !== -1) regulars.splice(pIdx, 1);
      const oIdx = overlays.findIndex(p => p.name === '碰碰胡');
      if (oIdx !== -1) overlays.splice(oIdx, 1);
    }

    // 叠加番型 (碰碰胡/混一色 叠加)
    for (const ov of overlays) {
      const existing = regulars.find(p => p.name === ov.name);
      if (!existing) {
        regulars.push({ name: ov.name, fan: ov.overlay });
      }
    }

    result.push(...regulars, ...multipliers);
    return result;
  }
}

module.exports = FanCalculator;
