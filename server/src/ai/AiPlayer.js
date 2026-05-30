/**
 * AiPlayer.js — AI玩家入口（反作弊版）
 *
 * ## 铁律：AI 不得偷看未出牌墙和其他玩家手牌
 *
 * AI 通过 AiView（闭包隔离的信息防火墙）获取游戏信息。
 * 底层 GameState 引用永不暴露 — 即使 AI 代码被恶意修改也无法访问隐私数据。
 *
 * 决策流程：
 *   事件 → 读取 AiView 公开信息 → 调用纯函数决策模块 → 发送行动
 *
 * 决策模块（DiscardPicker / ActionDecider / Shanten）均为纯函数，
 * 不持有任何 GameState 引用，确保无法绕过防火墙。
 */

const Shanten = require('./Shanten');
const DiscardPicker = require('./DiscardPicker');
const ActionDecider = require('./ActionDecider');
const { TILE_NAMES, isWild } = require('../game/TileDef');

class AiPlayer {
  /**
   * @param {number} seat - 座位号 (0-3)
   * @param {object} view - AiView.createAiView() 返回的只读视图
   * @param {function} emitAction - 发送决策的回调 (actionType, data)
   */
  constructor(seat, view, emitAction) {
    this.seat = seat;
    /** @type {object} AiView 只读视图 — 仅含公开信息 */
    this.view = view;
    this.emitAction = emitAction;
    this.thinkingTime = 300; // ms, AI思考延迟
  }

  // ──── 事件入口 ──────────────────────────────────────────

  /** AI开始决策 */
  async decide(event) {
    await this._delay(this.thinkingTime);

    switch (event.type) {
      case 'draw':
        return this._onDraw(event);
      case 'discard':
        return this._onDiscard(event);
      case 'action_available':
        return this._onActionAvailable(event);
      case 'pong_available':
        return this._onPongAvailable(event);
      case 'kong_available':
        return this._onKongAvailable(event);
      case 'win_available':
        return this._onWinAvailable(event);
      default:
        console.log(`[AI-${this.seat}] 未知事件: ${event.type}`);
    }
  }

  // ──── 决策方法（仅使用 AiView 公开信息） ────────────────

  /** 摸牌后 → 自摸检查（服务端已判断） → 否则出牌 */
  _onDraw(event) {
    if (event.canSelfWin) {
      this.emitAction('win', { seat: this.seat, isSelfDraw: true });
      return;
    }

    this._doDiscard();
  }

  /** 出牌决策 */
  _onDiscard() {
    this._doDiscard();
  }

  /**
   * 核心：选择弃牌并打出
   *
   * 使用的信息（全部来自 AiView 公开接口）：
   *   - myHand         自己的手牌
   *   - allDiscards    所有人的弃牌（公开）
   *   - wallRemaining  牌墙剩余张数（仅数量）
   */
  _doDiscard() {
    const hand = this.view.myHand;
    if (!hand || hand.length === 0) return;

    const result = DiscardPicker.pickBestDiscard(
      hand,
      this.view.allDiscards,
      this.seat,
      this.view.wallRemaining
    );

    console.log(`[AI-${this.seat}] 打出 ${TILE_NAMES[result.discardTile]} (${result.reason})`);

    this.emitAction('discard', {
      seat: this.seat,
      tileType: result.discardTile,
    });
  }

  /** 有其他玩家出牌后，是否要响应（碰/杠/胡） */
  _onActionAvailable(event) {
    const actions = event.availableActions.filter(a => a.seat === this.seat);

    for (const action of actions) {
      switch (action.type) {
        case 'win':
          this.emitAction('win', { seat: this.seat, tileType: action.tileType });
          return;
        case 'kong':
          if (this._decideKong(action)) {
            this.emitAction('kong', { seat: this.seat, tileType: action.tileType });
            return;
          }
          break;
        case 'pong':
          if (this._decidePong(action)) {
            this.emitAction('pong', { seat: this.seat, tileType: action.tileType });
            return;
          }
          break;
      }
    }

    this.emitAction('skip', { seat: this.seat });
  }

  /** 碰决策 */
  _onPongAvailable(event) {
    const hand = this.view.myHand;
    const shanten = Shanten.calculate(hand);

    if (ActionDecider.shouldPong(hand, event.tileType, shanten)) {
      this.emitAction('pong', { seat: this.seat, tileType: event.tileType });
    } else {
      this.emitAction('skip', { seat: this.seat });
    }
  }

  /** 杠决策 */
  _onKongAvailable(event) {
    if (this._decideKong(event)) {
      this.emitAction('kong', { seat: this.seat, tileType: event.tileType });
    } else {
      this.emitAction('skip', { seat: this.seat });
    }
  }

  /** 胡决策 */
  _onWinAvailable(event) {
    if (ActionDecider.shouldWin(event.isSelfDraw, event.fan || 3, 0)) {
      this.emitAction('win', {
        seat: this.seat,
        tileType: event.tileType,
        isSelfDraw: event.isSelfDraw,
      });
    } else {
      this.emitAction('skip', { seat: this.seat });
    }
  }

  // ──── 内部决策辅助（仅使用 AiView） ─────────────────────

  _decidePong(action) {
    const hand = this.view.myHand;
    if (!hand || hand.length === 0) return false;
    const shanten = Shanten.calculate(hand);
    return ActionDecider.shouldPong(hand, action.tileType, shanten);
  }

  _decideKong(action) {
    const hand = this.view.myHand;
    if (!hand || hand.length === 0) return false;
    const shanten = Shanten.calculate(hand);
    return ActionDecider.shouldKong(
      action.kongType || 'exposed',
      hand,
      action.tileType,
      shanten
    );
  }

  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = AiPlayer;
