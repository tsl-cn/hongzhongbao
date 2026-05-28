/**
 * AiPlayer.js — AI玩家入口
 *
 * 通过内部事件驱动，接收游戏状态，做出决策
 * AI不连WebSocket，通过Server内部调用
 */

const Shanten = require('./Shanten');
const DiscardPicker = require('./DiscardPicker');
const ActionDecider = require('./ActionDecider');
const { TILE_NAMES, WILD_TILE, isWild } = require('../game/TileDef');

class AiPlayer {
  /**
   * @param {number} seat - 座位号
   * @param {object} gameState - GameState实例
   * @param {function} emitAction - 发送决策的回调 (actionType, data)
   */
  constructor(seat, gameState, emitAction) {
    this.seat = seat;
    this.game = gameState;
    this.emitAction = emitAction;
    this.thinkingTime = 300; // ms, AI思考延迟
  }

  /** AI开始决策 */
  async decide(event) {
    // 模拟思考延迟（更像真人）
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

  /** 摸牌后 → 检查自摸 → 否则出牌 */
  _onDraw(event) {
    if (event.canSelfWin) {
      // 自摸胡
      this.emitAction('win', { seat: this.seat, isSelfDraw: true });
      return;
    }

    // 选牌打出
    this._doDiscard();
  }

  /** 出牌决策 */
  _onDiscard(event) {
    this._doDiscard();
  }

  /** 核心：选择弃牌并打出 */
  _doDiscard() {
    const player = this.game.players[this.seat];
    const hand = [...player.hand];
    const allDiscards = this.game.players.map(p => [...p.discards]);

    const result = DiscardPicker.pickBestDiscard(
      hand,
      allDiscards,
      this.seat,
      this.game.wall.remaining()
    );

    console.log(`[AI-${this.seat}] 打出 ${TILE_NAMES[result.discardTile]} (${result.reason})`);

    this.emitAction('discard', {
      seat: this.seat,
      tileType: result.discardTile,
    });
  }

  /** 有其他玩家出牌后，是否要响应（碰/杠/胡） */
  _onActionAvailable(event) {
    // 按优先级处理：胡 > 杠 > 碰
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

    // 没有可做的操作
    this.emitAction('skip', { seat: this.seat });
  }

  /** 碰决策 */
  _onPongAvailable(event) {
    const player = this.game.players[this.seat];
    const hand = [...player.hand];
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
      this.emitAction('win', { seat: this.seat, tileType: event.tileType, isSelfDraw: event.isSelfDraw });
    } else {
      this.emitAction('skip', { seat: this.seat });
    }
  }

  _decidePong(action) {
    const player = this.game.players[this.seat];
    const hand = [...player.hand];
    const shanten = Shanten.calculate(hand);
    return ActionDecider.shouldPong(hand, action.tileType, shanten);
  }

  _decideKong(action) {
    const player = this.game.players[this.seat];
    const hand = [...player.hand];
    const shanten = Shanten.calculate(hand);
    return ActionDecider.shouldKong(action.kongType || 'exposed', hand, action.tileType, shanten);
  }

  _decideWin(action) {
    const isSelfDraw = action.isSelfDraw || false;
    return ActionDecider.shouldWin(isSelfDraw, action.fan || 3, 0);
  }

  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = AiPlayer;
