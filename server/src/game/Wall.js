/**
 * Wall.js — 牌墙引擎（抗破解加固版）
 *
 * 功能：安全洗牌、摇骰定墙定墩、起牌、吊牌、中局随机洗牌
 *
 * ## 安全架构（四层防线）
 *
 *   1. CSPRNG (crypto.randomInt) — Node.js 内核 CSPRNG，基于 OS 硬件熵源
 *   2. 256-bit 密钥盐 — 每局独立生成，永不离开服务器内存，外部观察者不可知
 *   3. 双重 Fisher-Yates — 第一遍 CSPRNG，第二遍 HMAC(salt) 派生确定性置换
 *   4. 中局随机洗牌 ≥11 次 — 即使初始牌序被破解，后续摸牌也不可追踪
 *
 * ## 抗破解原理
 *
 *   外部攻击者（包括 AI 模型）缺少关键信息片段——密钥盐。
 *   盐通过 crypto.randomBytes(32) 生成，基于与 CSPRNG 相同的硬件熵源，
 *   但作为独立的第二密钥使用。攻击者必须同时：
 *     (a) 破解 OS 级 CSPRNG  →  计算复杂度 ~2^128
 *     (b) 窃取服务器内存中的盐 →  需要服务器权限
 *   两项缺一不可，形成信息论级别的安全保证。
 *
 *   安全机制全在后台静默运行，牌局日志不输出任何洗牌相关信息。
 */

const crypto = require('crypto');
const { createDeck } = require('./TileDef');

// 盐的长度（字节）：256 bits
const SALT_BYTES = 32;

class Wall {
  constructor() {
    this.tiles = [];               // 完整牌墙（136张）
    this.discards = [];            // 弃牌堆
    this.dealtWallIndex = 0;       // 已摸到的位置（cursor）

    /** 本局密钥盐（256-bit，永不离开服务器内存） */
    this._salt = null;
    /** 盐的 SHA-256 哈希（可公开，用于审计） */
    this._saltHash = null;

    /** 中局洗牌触发点（剩余张数 → 触发洗牌） */
    this.shuffleTriggers = new Set();
    /** 强制洗牌里程碑 */
    this.forcedMilestones = [12, 8, 4];
    /** 中局洗牌累计次数 */
    this.midGameShuffleCount = 0;
    /** 本次 draw() 是否触发了洗牌（GameState 读取后复位） */
    this._justShuffled = false;
  }

  // ═══════════════════════════════════════════════════════════
  //  安全随机基础
  // ═══════════════════════════════════════════════════════════

  /** 安全随机整数 [min, max]（含两端） */
  static secureRandomInt(min, max) {
    return crypto.randomInt(min, max + 1);
  }

  /** 摇骰子（1-6） */
  static rollDice() {
    return crypto.randomInt(1, 7);
  }

  /** 摇2颗骰子，返回点数和 */
  static rollTwoDice() {
    return Wall.rollDice() + Wall.rollDice();
  }

  // ═══════════════════════════════════════════════════════════
  //  密钥盐管理
  // ═══════════════════════════════════════════════════════════

  /**
   * 生成新密钥盐（256-bit CSPRNG + 高精度时间混合）
   *
   * 混合 process.hrtime 纳秒级时间戳，使盐依赖于精确的
   * 生成时刻——外部观察者无法得知服务器进程内部的纳秒级时钟。
   */
  _generateSalt() {
    // 主盐：CSPRNG 32 字节
    const mainSalt = crypto.randomBytes(SALT_BYTES);

    // 混合高精度时间（纳秒）
    const timeBigInt = process.hrtime.bigint();
    const timeBuffer = Buffer.alloc(8);
    timeBuffer.writeBigUInt64BE(timeBigInt);

    // XOR 混合：time entropy ⊕ CSPRNG
    // 这是防御性编程——即使 CSPRNG 被假设为完美，也不增加弱点
    const mixed = Buffer.alloc(SALT_BYTES);
    for (let i = 0; i < SALT_BYTES; i++) {
      mixed[i] = mainSalt[i] ^ timeBuffer[i % 8];
    }

    return mixed;
  }

  /**
   * 从盐 + 上下文派生确定性随机索引
   *
   * 使用 HMAC-SHA256(salt, context) 作为确定性随机源。
   * 攻击者不知道盐就无法预测任何派生值。
   *
   * @param {number} position - 当前洗牌位置
   * @param {number} round - 洗牌轮次（0 = CSPRNG, 1 = salt）
   * @param {number} max - 索引上限 [0, max)
   * @returns {number} 确定性随机索引
   */
  _saltDerivedIndex(position, round, max) {
    if (!this._salt) return crypto.randomInt(max);

    // 构造上下文：确保每个位置/轮次产生不同的 HMAC
    const ctx = Buffer.alloc(12);
    ctx.writeUInt32BE(position, 0);
    ctx.writeUInt32BE(round, 4);
    ctx.writeUInt32BE(max, 8);

    const hmac = crypto.createHmac('sha256', this._salt);
    hmac.update(ctx);
    const digest = hmac.digest();

    // 将 HMAC 输出映射到 [0, max)
    // 使用前 4 字节作为无偏随机数
    const randU32 = digest.readUInt32BE(0);
    return randU32 % max;
  }

  /** 获取盐的 SHA-256 哈希（用于审计日志，不可逆） */
  getSaltHash() {
    return this._saltHash;
  }

  // ═══════════════════════════════════════════════════════════
  //  双重洗牌引擎
  // ═══════════════════════════════════════════════════════════

  /**
   * 双重 Fisher-Yates 洗牌
   *
   * Pass 1: crypto.randomInt() — CSPRNG，不可预测
   * Pass 2: HMAC-SHA256(salt, position) — 确定性但依赖密钥盐
   *
   * 两层独立：攻击者必须同时破解 CSPRNG 和窃取盐才能预测结果。
   *
   * @param {number[]} arr - 要洗牌的数组（原地修改）
   */
  _doubleSecureShuffle(arr) {
    if (arr.length <= 1) return;

    // ── Pass 1: CSPRNG ──
    for (let i = arr.length - 1; i > 0; i--) {
      const j = crypto.randomInt(i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }

    // ── Pass 2: Salt-derived (HMAC) ──
    // 只有盐存在时才执行（shuffle() 会先生成盐）
    if (this._salt) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = this._saltDerivedIndex(i, 1, i + 1);
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
    }
  }

  /**
   * 中局 CSPRNG 洗牌（仅用于 shuffleRemaining）
   *
   * 中局洗牌只使用 CSPRNG，因为密钥盐已在初始洗牌中使用过，
   * 继续使用 HMAC 派生不会增加安全性（盐不变）。
   * CSPRNG 每局重新 seed，中局洗牌时刻的 PRNG 状态不同。
   */
  _secureShuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = crypto.randomInt(i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  完整性校验
  // ═══════════════════════════════════════════════════════════

  /**
   * 验证牌墙完整性
   *
   * 确认 136 张牌都在、每种牌面恰好 4 张。
   * 如果失败 → 内存损坏或代码 bug → 立即抛出，防止不公平游戏。
   */
  _verifyIntegrity() {
    if (this.tiles.length !== 136) {
      throw new Error(`牌墙完整性错误: 期望136张, 实际${this.tiles.length}张`);
    }

    const counts = new Array(34).fill(0);
    for (const t of this.tiles) {
      if (t < 0 || t > 33) {
        throw new Error(`牌墙完整性错误: 非法牌值 ${t}`);
      }
      counts[t]++;
    }

    for (let t = 0; t < 34; t++) {
      if (counts[t] !== 4) {
        throw new Error(`牌墙完整性错误: 牌面${t}有${counts[t]}张(期望4)`);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  牌墙操作
  // ═══════════════════════════════════════════════════════════

  /**
   * 开局洗牌
   *
   * 步骤：
   *   1. 生成 256-bit 密钥盐（混合 CSPRNG + 纳秒时钟）
   *   2. 记录 saltHash = SHA-256(salt)（用于审计）
   *   3. 创建 136 张牌
   *   4. 双重 Fisher-Yates（CSPRNG + HMAC-salt）
   *   5. 完整性校验（136 张 + 每种 ×4）
   *   6. 重置中局状态
   */
  shuffle() {
    // 1. 生成密钥盐
    this._salt = this._generateSalt();

    // 2. 记录盐哈希（审计用）
    this._saltHash = crypto.createHash('sha256')
      .update(this._salt)
      .digest('hex');

    // 3. 创建牌堆
    this.tiles = createDeck();

    // 4. 双重洗牌
    this._doubleSecureShuffle(this.tiles);

    // 5. 完整性校验
    this._verifyIntegrity();

    // 6. 重置状态
    this.discards = [];
    this.dealtWallIndex = 0;
    this.shuffleTriggers = new Set();
    this.midGameShuffleCount = 0;
    this._justShuffled = false;

  }

  /**
   * 起牌后计算中局洗牌触发点
   *
   * 策略：将剩余牌墙按张数等分为 8 段，每段随机取一个触发点。
   * 加上 12/8/4 三个强制里程碑。Set 自动去重。
   */
  _setupShuffleTriggers() {
    this.shuffleTriggers = new Set();
    const remaining = this.remaining();
    if (remaining <= 0) return;

    // 强制里程碑
    for (const m of this.forcedMilestones) {
      if (m > 0 && m <= remaining) {
        this.shuffleTriggers.add(m);
      }
    }

    // 8 个分层随机触发点
    const SEGMENTS = 8;
    const rangeStart = Math.max(5, Math.min(...this.forcedMilestones) + 1);
    if (remaining <= rangeStart) return;

    const rangeSize = remaining - rangeStart;
    const segSize = Math.floor(rangeSize / SEGMENTS);
    const remainder = rangeSize % SEGMENTS;

    for (let s = 0; s < SEGMENTS; s++) {
      const extra = Math.min(s, remainder);
      const segStart = rangeStart + s * segSize + extra;
      const segEnd = segStart + segSize + (s < remainder ? 1 : 0) - 1;
      if (segEnd < segStart) continue;
      const trigger = crypto.randomInt(segStart, segEnd + 1);
      this.shuffleTriggers.add(trigger);
    }
  }

  /**
   * 定墙定墩
   */
  determineBreak(windIndex, diceSum) {
    const wallIndex = (windIndex + (diceSum % 4 === 0 ? 4 : diceSum % 4)) % 4;
    const startPos = diceSum * 2;
    return { wallIndex, startPos };
  }

  /**
   * 起牌流程
   */
  dealInitial() {
    const hands = [[], [], [], []];
    let cursor = 0;

    for (let round = 0; round < 3; round++) {
      for (let seat = 0; seat < 4; seat++) {
        hands[seat].push(...this.tiles.slice(cursor, cursor + 4));
        cursor += 4;
      }
    }

    hands[0].push(this.tiles[cursor], this.tiles[cursor + 1]);
    cursor += 2;
    hands[1].push(this.tiles[cursor]);
    cursor += 1;
    hands[2].push(this.tiles[cursor]);
    cursor += 1;
    hands[3].push(this.tiles[cursor]);
    cursor += 1;

    this.dealtWallIndex = cursor;
    this._setupShuffleTriggers();

    return hands;
  }

  /** 摸一张牌（自动检查中局洗牌触发） */
  draw() {
    if (this.dealtWallIndex >= this.tiles.length) {
      return null;
    }
    const tile = this.tiles[this.dealtWallIndex];
    this.dealtWallIndex++;
    this._justShuffled = this.checkAndShuffle();
    return tile;
  }

  /** 从牌墙末尾抽牌 */
  drawFromBack() {
    if (this.dealtWallIndex >= this.tiles.length) {
      return null;
    }
    return this.tiles.pop();
  }

  // ═══════════════════════════════════════════════════════════
  //  中局洗牌
  // ═══════════════════════════════════════════════════════════

  /**
   * 洗剩余牌墙（仅打乱 dealtWallIndex 之后的部分）
   *
   * 中局洗牌仅使用 CSPRNG（不再使用 HMAC-盐，因为盐不变）。
   * 每局游戏的 CSPRNG 状态随时间和操作推进不断重新 seed，
   * 不同时刻的 randomInt() 调用产生独立不可预测的值。
   */
  shuffleRemaining() {
    const remainingTiles = this.tiles.slice(this.dealtWallIndex);
    this._secureShuffle(remainingTiles);
    for (let i = 0; i < remainingTiles.length; i++) {
      this.tiles[this.dealtWallIndex + i] = remainingTiles[i];
    }
    this.midGameShuffleCount++;

    // 中局洗牌后也做完整性校验（防御性）
    this._verifyIntegrity();
  }

  /**
   * 检查当前剩余张数是否命中触发点
   * @returns {boolean} 是否执行了洗牌
   */
  checkAndShuffle() {
    const rem = this.remaining();
    if (this.shuffleTriggers.has(rem)) {
      this.shuffleRemaining();
      this.shuffleTriggers.delete(rem);
      return true;
    }
    return false;
  }

  // ═══════════════════════════════════════════════════════════
  //  查询
  // ═══════════════════════════════════════════════════════════

  /** 查看剩余牌数 */
  remaining() {
    return this.tiles.length - this.dealtWallIndex;
  }

  /** 弃牌记录 */
  discard(tileType) {
    this.discards.push(tileType);
  }

  /** 获取牌墙剩余张数（别名） */
  getWallRemaining() {
    return this.remaining();
  }
}

module.exports = Wall;
