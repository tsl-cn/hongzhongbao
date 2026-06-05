/**
 * SettlementEngine.js — 4层结算引擎
 *
 * 统一子层公式，逐马加总，按玩家汇总。
 * 流局时无需调用 settle()（各家不输赢）。
 */

const { TILE_NAMES } = require('./TileDef');

class SettlementEngine {
  /**
   * 完整4层结算
   * @param {object} params
   * @param {number} params.winner - 胡家座位 (0-3)
   * @param {number} params.fan_w - 胡家手牌番型 (FanCalculator 结果)
   * @param {object[]} params.players - [{ name, melds, seatIndex }] 全4家
   * @param {object[]} [params.horseResults] - [{ seatIndex, playerName, horses: [{tileType, ownerSeat}] }]
   * @param {number[]} [params.playerNames] - ['东','南','西','北']
   * @returns {object}
   */
  static settle({ winner, fan_w, players, horseResults, playerNames }) {
    const seatNames = playerNames || ['东', '南', '西', '北'];

    // ====== 1. 构建所有马 ======
    const horses = SettlementEngine._buildHorses(players, horseResults);

    // ====== 2. 初始化每马价值累加器 ======
    const horseValues = new Array(horses.length).fill(0);

    // ====== 3. 层2：胡家手牌子层 ======
    if (winner !== undefined && winner !== null) {
      const sublayerVals = SettlementEngine._runSublayer(horses, winner, fan_w);
      for (let i = 0; i < horses.length; i++) {
        horseValues[i] += sublayerVals[i];
      }
    }

    // ====== 4. 层1：非胡家逐杠子层 ======
    for (let s = 0; s < 4; s++) {
      if (s === winner) continue;
      const player = players[s];
      if (!player || !player.melds) continue;

      for (const meld of player.melds) {
        let f = 0;
        if (meld.type === 'kong' || meld.type === 'exposed_kong') {
          f = 1; // 明杠
        } else if (meld.type === 'concealed_kong') {
          f = 2; // 暗杠
        }
        if (f <= 0) continue;

        const sublayerVals = SettlementEngine._runSublayer(horses, s, f);
        for (let i = 0; i < horses.length; i++) {
          horseValues[i] += sublayerVals[i];
        }
      }
    }

    // ====== 5. 按 owner 汇总（层4） ======
    const perPlayer = [0, 0, 0, 0];
    for (let i = 0; i < horses.length; i++) {
      perPlayer[horses[i].owner] += horseValues[i];
    }

    // ====== 6. 格式化 horseSettlement（兼容客户端） ======
    const horseSettlement = [];
    for (let s = 0; s < 4; s++) {
      const pName = players[s]?.name || seatNames[s];
      // 该玩家拥有的所有马
      const myHorses = horses
        .map((h, idx) => ({ ...h, idx, value: horseValues[idx] }))
        .filter(h => h.owner === s);

      const results = myHorses.map(h => ({
        tileType: h.tileType !== undefined ? h.tileType : -1,
        tileName: h.tileName || (h.isSelfWind ? '自风马' : '?'),
        ownerSeat: h.owner,
        isHit: h.mapped === winner, // 是否相对胡家中马（仅用于显示）
        adjustment: h.value,
      }));

      horseSettlement[s] = {
        seatIndex: s,
        playerName: pName,
        count: myHorses.length,
        virtualAdjustment: 0,
        results,
        pickerAdjustment: perPlayer[s],
      };
    }

    // ====== 7. 兼容 result.payments ======
    const payments = {};
    for (let s = 0; s < 4; s++) {
      const pName = players[s]?.name || seatNames[s];
      payments[seatNames[s]] = {
        pay: Math.abs(perPlayer[s]),  // 客户端展示绝对值
        playerName: pName,
      };
    }

    // 校验归零
    const total = perPlayer.reduce((a, b) => a + b, 0);
    if (total !== 0) {
      console.error(`🚨 4层结算不平衡! total=${total}`);
    }

    return {
      perPlayer,
      horseSettlement,
      payments,
    };
  }

  /**
   * 构建所有马（自风马 + 实马）
   */
  static _buildHorses(players, horseResults) {
    const horses = [];

    // 4匹自风马
    for (let s = 0; s < 4; s++) {
      horses.push({
        owner: s,
        mapped: s,
        isSelfWind: true,
        tileType: -1,
        tileName: '自风马',
      });
    }

    // 实马
    if (horseResults) {
      for (const hr of horseResults) {
        if (!hr || !hr.horses || hr.horses.length === 0) continue;
        const ownerSeat = hr.seatIndex !== undefined ? hr.seatIndex : hr.ownerSeat;
        for (const horse of hr.horses) {
          horses.push({
            owner: ownerSeat,
            mapped: horse.ownerSeat, // HorseBuyer 已算出 ownerSeat (=mapped)
            isSelfWind: false,
            tileType: horse.tileType,
            tileName: TILE_NAMES[horse.tileType] || '?',
          });
        }
      }
    }

    return horses;
  }

  /**
   * 单个子层结算
   * @param {object[]} horses - [{ owner, mapped }]
   * @param {number} center - 中心人座位
   * @param {number} f - 当前子层番值
   * @returns {number[]} - 每匹马的价值
   */
  static _runSublayer(horses, center, f) {
    const values = new Array(horses.length).fill(0);

    // 统计 hit camp (mapped=center) 和 miss camp (mapped≠center)
    const hitHorses = horses.filter(h => h.mapped === center);
    const missHorses = horses.filter(h => h.mapped !== center);
    const hitCount = hitHorses.length;

    // 有效 miss 数 = miss camp 中 owner≠center 的马数
    // （中心人自己的 miss 马不计入"非中心人阵营"）
    const effectiveMissHorses = missHorses.filter(h => h.owner !== center);
    const effectiveMissCount = effectiveMissHorses.length;

    for (let i = 0; i < horses.length; i++) {
      const h = horses[i];

      if (h.mapped === center) {
        // -- Hit camp --
        if (h.owner === center) {
          // owner=C: +f × 有效 miss 数
          values[i] = f * effectiveMissCount;
        } else {
          // owner=X≠C: +f × (有效 miss 数 - X在有效miss中的马数)
          const xMissCount = effectiveMissHorses.filter(mh => mh.owner === h.owner).length;
          values[i] = f * (effectiveMissCount - xMissCount);
        }
      } else {
        // -- Miss camp --
        if (h.owner !== center) {
          // owner=X≠C: -f × (|hit camp| - |X在hit camp中的马数|)
          const xHitCount = hitHorses.filter(hh => hh.owner === h.owner).length;
          values[i] = -f * (hitCount - xHitCount);
        }
        // owner=C → 0
      }
    }

    return values;
  }
}

module.exports = SettlementEngine;
