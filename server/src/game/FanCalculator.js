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
    const wildCount = hand.filter(t => t === WILD_TILE).length;

    // 1. 判断是否能胡
    const winResult = FanCalculator.checkWin(hand);
    if (!winResult.isWin) {
      return { isWin: false, fan: 0, baseFan: 0, multiplier: 1, patterns: [] };
    }

    // 2. 计算共享番型（不依赖牌型分解）
    const shared = FanCalculator._calcSharedPatterns(hand, melds, options, wildCount);

    // 3. 牌型相关番型
    let typePatterns;
    if (winResult.type === 'fourWilds') {
      typePatterns = [{ name: '4红中', fan: 8, desc: '手牌有4张红中万能牌，直接胡' }];
    } else if (winResult.type === 'sevenPairs') {
      typePatterns = FanCalculator._calcSevenPairFans(hand);
    } else if (winResult.type === 'thirteenOrphans') {
      typePatterns = [{ name: '十三幺', fan: 20, desc: '13种幺九牌各1张+任意1对' }];
    } else {
      typePatterns = FanCalculator._calcStandardFans(hand, melds, winResult);
    }

    // 花色 + 幺九（仅非fourWilds/thirteenOrphans时有效）
    let suitTerminalPatterns = [];
    if (winResult.type !== 'fourWilds' && winResult.type !== 'thirteenOrphans') {
      suitTerminalPatterns = [
        ...FanCalculator._calcSuitFans(hand, melds),
        ...FanCalculator._calcTerminalHonorFans(hand, melds),
      ];
    }

    // 4. 如果有4红中，尝试两条路径取高番
    if (wildCount >= 4 && winResult.type === 'fourWilds') {
      // Path A: 4红中（已算）
      const patternsA = [...shared, ...typePatterns];       // 4红中 + 共享
      const resolvedA = FanCalculator._resolveOverlaps(patternsA);
      const fanA = FanCalculator._computeFan(resolvedA, shared._multiplier || 1);

      // Path B: 用红中当万能牌组成标准牌型
      const stdResult = FanCalculator._checkStandard(hand);
      let typeB, typePatternsB;
      if (stdResult.isWin) {
        typeB = 'standard';
        typePatternsB = FanCalculator._calcStandardFans(hand, melds, stdResult);
      } else {
        const toResult = FanCalculator._checkThirteenOrphans(hand);
        if (toResult.isWin) {
          typeB = 'thirteenOrphans';
          typePatternsB = [{ name: '十三幺', fan: 20, desc: '13种幺九牌各1张+任意1对' }];
        } else {
          const spResult = FanCalculator._checkSevenPairs(hand);
          if (spResult.isWin) {
            typeB = 'sevenPairs';
            typePatternsB = FanCalculator._calcSevenPairFans(hand);
          } else {
            typeB = null;
            typePatternsB = [];
          }
        }
      }

      if (typeB) {
        const suitB = (typeB === 'thirteenOrphans')
          ? []
          : [...FanCalculator._calcSuitFans(hand, melds), ...FanCalculator._calcTerminalHonorFans(hand, melds)];
        const patternsB = [...shared, ...typePatternsB, ...suitB];
        const resolvedB = FanCalculator._resolveOverlaps(patternsB);
        const fanB = FanCalculator._computeFan(resolvedB, shared._multiplier || 1);

        if (fanB.fan > fanA.fan) {
          return { ...fanB, isWin: true, handType: typeB };
        }
      }
      return { ...fanA, isWin: true, handType: 'fourWilds' };
    }

    // 普通路径
    const allPatterns = [...shared, ...typePatterns, ...suitTerminalPatterns];
    const finalPatterns = FanCalculator._resolveOverlaps(allPatterns);
    const multiplier = shared._multiplier || 1;
    const computed = FanCalculator._computeFan(finalPatterns, multiplier);
    return { ...computed, handType: winResult.type };
  }

  /** 计算共享番型（门清/杠/无红中/特殊/倍数），返回 patterns[] + _multiplier */
  static _calcSharedPatterns(hand, melds, options, wildCount) {
    const patterns = [];
    let multiplier = 1;

    // 门清
    const hasExposedMeld = melds.some(m =>
      m.type === 'chow' || m.type === 'pong' || m.type === 'kong' || m.type === 'exposed_kong'
    );
    if (!hasExposedMeld) {
      patterns.push({ name: '门清', fan: 2, desc: '无碰无明杠（暗杠可），自摸胡牌' });
    }

    // 杠
    patterns.push(...FanCalculator._calcKongFans(melds));

    // 无红中
    if (wildCount === 0) {
      patterns.push({ name: '无红中', fan: 2, desc: '手牌没有红中万能牌' });
    }

    // 自摸
    if (options.isSelfDraw) {
      patterns.push({ name: '自摸', fan: 2, desc: '自摸胡牌' });
    }

    // 天胡
    if (options.isFirstTurn && options.isDealer && options.isSelfDraw && !options.hasMelds) {
      patterns.push({ name: '天胡', fan: 20, desc: '庄家起手14张即胡' });
    }
    // 地胡
    if (options.isFirstTurn && !options.isDealer && !options.isSelfDraw && !options.hasMelds) {
      patterns.push({ name: '地胡', fan: 20, desc: '庄家首张弃牌时非庄家点炮胡' });
    }
    // 人胡
    if (options.isFirstTurn && !options.isDealer && options.isSelfDraw && !options.hasMelds) {
      patterns.push({ name: '人胡', fan: 20, desc: '非庄家首次摸牌自摸胡' });
    }

    // 十八罗汉
    const kongCount = melds.filter(m => m.type.includes('kong')).length;
    if (kongCount === 4) {
      patterns.push({ name: '十八罗汉', fan: 20, desc: '累计4个杠（明/暗杠均可）' });
    }

    // 倍数
    if (options.isKongDraw) {
      if (options.isDoubleKongDraw) {
        multiplier *= 4;
        patterns.push({ name: '杠上杠开花', fan: 4, isMultiplier: true, desc: '连续两次杠后补牌自摸胡' });
      } else {
        multiplier *= 2;
        patterns.push({ name: '杠上开花', fan: 2, isMultiplier: true, desc: '杠后补牌自摸胡' });
      }
    }
    if (options.isLastTile) {
      multiplier *= 2;
      patterns.push({ name: '海底捞月', fan: 2, isMultiplier: true, desc: '牌墙最后一张牌自摸胡' });
    }
    if (options.isRobbingKong) {
      patterns.push({ name: '抢杠胡', fan: 0, desc: '别家补杠时胡那张牌' });
    }

    patterns._multiplier = multiplier;
    return patterns;
  }

  /** 从已解析的番型列表计算最终 fan */
  static _computeFan(resolvedPatterns, multiplier) {
    let baseFan = 0;
    for (const p of resolvedPatterns) {
      if (!p.isMultiplier) baseFan += p.fan;
    }
    if (baseFan < 3) {
      return { isWin: false, fan: 0, baseFan, multiplier, patterns: resolvedPatterns, reason: '三番起胡不足' };
    }
    const fan = Math.min(baseFan * multiplier, 20);
    return { isWin: true, fan, baseFan, multiplier, patterns: resolvedPatterns };
  }

  /**
   * 判断手牌是否能胡（含红中万能牌）
   * 返回 { isWin, type: 'standard'|'sevenPairs'|'thirteenOrphans', combinations? }
   */
  static checkWin(hand) {
    // 四红中：4张红中直接胡（含非庄家13张）
    const wildCount = hand.filter(t => t === WILD_TILE).length;
    if (wildCount >= 4) {
      // 红中万能牌，4张红中可配成任意牌型
      return { isWin: true, type: 'fourWilds' };
    }

    // 检查十三幺
    const thirteenResult = FanCalculator._checkThirteenOrphans(hand);
    if (thirteenResult.isWin) {
      return { isWin: true, type: 'thirteenOrphans', ...thirteenResult };
    }

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
   * 十三幺所需的13种幺九牌（不含红中，红中为万能牌）
   * 1万/9万/1筒/9筒/1条/9条 + 东南西北发白
   */
  static get THIRTEEN_YAO_TYPES() {
    return [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 32, 33];
  }

  /**
   * 检查十三幺（红中可以替补缺的幺九牌）
   * 手牌需包含13种幺九牌各至少1张 + 1对（自然的或用红中补）
   */
  static _checkThirteenOrphans(hand) {
    if (hand.length !== 14) return { isWin: false };

    const yaoTypes = FanCalculator.THIRTEEN_YAO_TYPES;
    const counts = {};
    let wildCount = 0;
    for (const t of hand) {
      if (isWild(t)) {
        wildCount++;
      } else {
        counts[t] = (counts[t] || 0) + 1;
      }
    }

    // 非红中牌必须全是幺九牌
    for (const t of Object.keys(counts).map(Number)) {
      if (!yaoTypes.includes(t)) {
        return { isWin: false }; // 有非幺九牌
      }
    }

    // 统计已有的幺九种类数和是否存在自然对子
    let typesPresent = 0;
    let hasNaturalPair = false;
    for (const t of yaoTypes) {
      const c = counts[t] || 0;
      if (c >= 2) hasNaturalPair = true;
      if (c >= 1) typesPresent++;
    }

    // 缺几种幺九牌需要红中补
    const missingTypes = yaoTypes.length - typesPresent; // 12 - typesPresent
    let remainingWilds = wildCount - missingTypes;
    if (remainingWilds < 0) return { isWin: false };

    // 检查对子
    if (hasNaturalPair) {
      return { isWin: true };
    }

    // 用剩下的红中做对子
    if (remainingWilds >= 2) {
      return { isWin: true };
    }

    // 某一种幺九牌有1张，再加1张红中成对
    for (const t of yaoTypes) {
      if ((counts[t] || 0) === 1 && remainingWilds >= 1) {
        return { isWin: true };
      }
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

    // === 第一步：从非红中牌中计数 ===
    let pairs = 0;        // 已成对数
    let singles = 0;      // 落单张数（需要红中配）
    let count4Tiles = 0;  // 天然四张相同的牌数
    let count3Tiles = 0;  // 三张相同的牌数
    let count2Tiles = 0;  // 两张相同的牌数

    for (const [tile, count] of Object.entries(counts)) {
      if (parseInt(tile) === WILD_TILE) continue;
      if (count === 4) { pairs += 2; count4Tiles++; }
      else if (count === 3) { pairs += 1; count3Tiles++; singles++; }  // 3张出1对，余1张落单
      else if (count === 2) { pairs += 1; count2Tiles++; }
      else if (count === 1) { singles++; }  // 1张落单
    }

    // === 第二步：用红中配落单 ===
    let wild = wildCount;

    // 优先用红中配 count3 的落单 → 形成四归一（豪华）
    const wildUsedForQuad3 = Math.min(wild, count3Tiles);
    pairs += wildUsedForQuad3;       // 每用1红中，落单成对，多1对
    singles -= wildUsedForQuad3;
    wild -= wildUsedForQuad3;

    // 其次用红中配普通落单（count1）
    const wildUsedForSingles = Math.min(wild, singles);
    pairs += wildUsedForSingles;
    singles -= wildUsedForSingles;
    wild -= wildUsedForSingles;

    // 检查是否还有未配对的落单
    if (singles > 0) return { isWin: false };

    // 尝试用2红中升级count2为四归一（双豪华）
    // 优先将红中用于形成四归一，最大化豪华等级
    let wildForQuad2 = 0;
    while (wild >= 2 && count2Tiles > 0) {
      wildForQuad2++;
      count2Tiles--;
      pairs += 1;       // 原有的1对 + 升级后的1对 = 2对，净增1对
      wild -= 2;
    }

    // 剩余红中自己成对
    pairs += Math.floor(wild / 2);

    // === 第三步：判断 ===
    const quadruples = count4Tiles + wildUsedForQuad3 + wildForQuad2;

    if (pairs === 7) {
      return {
        isWin: true,
        quadruples,
        luxuryLevel: quadruples, // 0=普通 1=豪华 2=双豪华 3=三豪华
      };
    }

    // 如果超过7对（红中太多）也判胡，按7对算
    if (pairs > 7) {
      return {
        isWin: true,
        quadruples,
        luxuryLevel: quadruples,
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
      patterns.push({ name: '七小对', fan: 4, desc: '7个对子，无四归一' });
    } else if (result.quadruples === 1) {
      patterns.push({ name: '豪华七小对', fan: 10, desc: '7个对子含1组四归一' });
    } else if (result.quadruples === 2) {
      patterns.push({ name: '双豪华七小对', fan: 20, desc: '7个对子含2组四归一' });
    } else if (result.quadruples >= 3) {
      patterns.push({ name: '三豪华七小对', fan: 20, desc: '7个对子含3组四归一' });
    }

    return patterns;
  }

  /**
   * 标准牌型（4面子1将）相关番型
   */
  static _calcStandardFans(hand, melds, winResult) {
    const patterns = [];

    // 碰碰胡 (所有面子都是刻子)
    if (FanCalculator._isAllPongs(hand, melds)) {
      patterns.push({ name: '碰碰胡', fan: 2, desc: '4刻子+1雀头' });

      // 四暗刻 (4个暗刻子+1对将，无碰/无明杠，暗杠算暗刻)
      const hasExposedMelds = melds.some(m =>
        m.type === 'chow' || m.type === 'pong' || m.type === 'kong' || m.type === 'exposed_kong'
      );
      if (!hasExposedMelds) {
        patterns.push({ name: '四暗刻', fan: 6, desc: '4暗刻+1雀头，无碰无明杠' });
      }
    } else {
      // 平胡（自摸）：4面子含顺子，雀头非字牌/红中
      // 有碰/明杠/暗杠都不算平胡
      const hasPong = melds.some(m => m.type === 'pong');
      const hasKong = melds.some(m => m.type === 'kong' || m.type === 'exposed_kong' || m.type === 'concealed_kong');
      const canPingHu = !hasPong && !hasKong;
      if (canPingHu) {
        const pairTile = winResult && winResult.pairTile;
        if (pairTile !== undefined && pairTile !== WILD_TILE && !isHonor(pairTile)) {
          patterns.push({ name: '平胡（自摸）', fan: 2, desc: '杂色顺或刻子+1雀头（碰牌后无杠不能胡）' });
        }
      }
    }

    return patterns;
  }

  /** 检查是否所有面子都是刻子（碰碰胡） */
  static _isAllPongs(hand, melds) {
    // 有碰副露 → 至少有一个刻子已碰出
    if (melds.some(m => m.type === 'pong')) return true;
    // 检查手牌是否只剩刻子+雀头（含红中万能牌补位）
    const counts = {};
    for (const t of hand) {
      if (isWild(t)) continue;
      counts[t] = (counts[t] || 0) + 1;
    }
    // 手牌中所有非红中牌应该是3张一组或2张(将)，允许红中补缺
    let oddCount = 0;
    for (const c of Object.values(counts)) {
      if (c % 3 === 1) oddCount++;
      if (c % 3 === 1 && c > 3) return false;
    }
    return oddCount <= 1;
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
      patterns.push({ name: '混一色', fan: 2, desc: '单花色+字牌' });
    } else if (suitsInHand === 1 && !hasHonor) {
      patterns.push({ name: '清一色', fan: 6, desc: '纯单花色，无字牌' });
    }

    // 全风
    const allWinds = allTiles.every(t => t >= 27 || isWild(t));
    if (allWinds) {
      patterns.push({ name: '全风', fan: 20, desc: '全部由风牌/箭牌组成' });
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
        patterns.push({ name: '混幺九', fan: 8, desc: '全幺九牌（含字牌）' });
      } else {
        patterns.push({ name: '全幺九', fan: 20, desc: '全幺九牌（无字牌）' });
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
        patterns.push({ name: '明杠', fan: 1, desc: '碰后杠或别家弃牌杠' });
      } else if (m.type === 'concealed_kong') {
        patterns.push({ name: '暗杠', fan: 2, desc: '手牌四张相同暗杠' });
      }
    }
    return patterns;
  }

  /**
   * 叠加逻辑处理
   * 仅两组互斥：碰碰胡 ⊗ 四暗刻、七小对系列互斥、清一色 ⊗ 混一色
   * 其余自由叠加
   */
  static _resolveOverlaps(patterns) {
    const regulars = patterns.filter(p => !p.isMultiplier);
    const multipliers = patterns.filter(p => p.isMultiplier);
    const names = () => regulars.map(p => p.name);

    // 互斥组1：碰碰胡 ⊗ 四暗刻（四暗刻优先）
    if (names().includes('四暗刻')) {
      const idx = regulars.findIndex(p => p.name === '碰碰胡');
      if (idx !== -1) regulars.splice(idx, 1);
    }

    // 互斥组2：清一色 ⊗ 混一色（清一色优先）
    if (names().includes('清一色')) {
      const idx = regulars.findIndex(p => p.name === '混一色');
      if (idx !== -1) regulars.splice(idx, 1);
    }

    // 互斥组3：平胡（自摸）已含自摸，不重复计
    if (names().includes('平胡（自摸）')) {
      const idx = regulars.findIndex(p => p.name === '自摸');
      if (idx !== -1) regulars.splice(idx, 1);
    }

    // 互斥组4：七小对系列只保留最高级
    const sevenPairs = ['七小对', '豪华七小对', '双豪华七小对', '三豪华七小对'];
    const present = sevenPairs.filter(n => names().includes(n));
    if (present.length > 1) {
      // 保留番数最大的（最后一个出现的）
      const keep = present[present.length - 1];
      for (const n of present) {
        if (n !== keep) {
          const idx = regulars.findIndex(p => p.name === n);
          if (idx !== -1) regulars.splice(idx, 1);
        }
      }
    }

    return [...regulars, ...multipliers];
  }
}

module.exports = FanCalculator;
