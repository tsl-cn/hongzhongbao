/**
 * GameScene.js — 游戏主场景
 *
 * 布局: 上(对家) 左/右(边家) 下(自己)
 * 功能: 骰子动画、牌局日志、手牌渲染、碰杠胡操作、语音
 */

import Phaser from 'phaser';
import TileRenderer from '../game/TileRenderer.js';
import VoiceChatManager from '../network/VoiceChatManager.js';

const SEAT_NAMES = ['东', '南', '西', '北'];

export default class GameScene extends Phaser.Scene {
  constructor() {
    super({ key: 'GameScene' });
  }

  init(data) {
    this.gameData = data.gameData;
    this.socket = this.game.socketMgr;
    this.mySeat = -1;
    this.hand = [];
    this.players = [];
    this.tileElements = [];
    this.actionButtons = [];
    this.voiceChat = null;
    this.isMyTurn = false;
    this.gameLog = [];

    this.TILE_W = 44;
    this.TILE_H = 60;
    this.HAND_Y = 540;
  }

  create() {
    const W = this.cameras.main.width;
    const H = this.cameras.main.height;

    this.add.rectangle(W / 2, H / 2, W, H, 0x1a3a2e);
    this.add.rectangle(W / 2, H / 2, 560, 320, 0x2a5a3e).setStrokeStyle(2, 0x4a8a5e);

    this.players = this.gameData.players || [];
    this._calcMySeat();
    this._renderPlayers();

    // 从 game_start 数据直接获取手牌（不等 initial_hand 事件）
    const myPlayer = this.players[this.mySeat];
    if (myPlayer && myPlayer.hand) {
      this.hand = myPlayer.hand;
      this._renderHand();
    }
    this._renderOpponentHands(this.players);

    // === 中央日志区域 ===
    this._createLogArea();

    // === 状态文字 ===
    this.statusText = this.add.text(W / 2, H / 2 - 130, '', {
      fontSize: '14px', color: '#ffd700',
    }).setOrigin(0.5).setDepth(10);

    this.wallText = this.add.text(W - 10, 10, '', {
      fontSize: '13px', color: '#aaaaaa',
    }).setOrigin(1, 0);

    this.hintText = this.add.text(W / 2, H - 10, '', {
      fontSize: '14px', color: '#cccccc',
    }).setOrigin(0.5).setDepth(10);

    // === 注册事件 ===
    this._registerEvents();

    // === 初始化语音 ===
    this._initVoiceChat();

    // === 播放定庄骰子动画 ===
    this.time.delayedCall(300, () => {
      this._playDealerDiceAnimation(this.gameData.diceResults);
    });
  }

  /** 找自己的座位 */
  _calcMySeat() {
    for (let i = 0; i < this.players.length; i++) {
      if (this.players[i].id === this.socket.playerId) {
        this.mySeat = i; return;
      }
    }
    this.mySeat = 0;
  }

  /** 玩家标签 */
  _renderPlayers() {
    const W = this.cameras.main.width;
    const H = this.cameras.main.height;
    this.playerLabels = [];

    for (let i = 0; i < 4; i++) {
      const p = this.players[i];
      const rel = (i - this.mySeat + 4) % 4;
      let x, y;
      if (rel === 0) { x = W / 2; y = H - 25; }
      else if (rel === 2) { x = W / 2; y = 18; }
      else if (rel === 1) { x = W - 8; y = H / 2; }
      else { x = 8; y = H / 2; }

      const label = this.add.text(x, y,
        `${SEAT_NAMES[i]} ${p.name}${p.isAI ? ' (AI)' : ''}`, {
          fontSize: '12px', color: i === this.mySeat ? '#ffd700' : '#ffffff',
        }).setOrigin(rel === 1 ? 1 : rel === 3 ? 0 : 0.5, 0.5).setDepth(5);
      this.playerLabels.push(label);
    }
  }

  // ========== 中央牌局日志 ==========

  _createLogArea() {
    const W = this.cameras.main.width;
    const H = this.cameras.main.height;

    // 半透明背景
    this.logBg = this.add.rectangle(W / 2, H / 2, 380, 130, 0x000000, 0.5)
      .setDepth(3).setStrokeStyle(1, 0x4a8a5e);

    this.logText = this.add.text(W / 2, H / 2 - 50, '', {
      fontSize: '12px', color: '#ffffff', lineSpacing: 4,
      wordWrap: { width: 360 },
    }).setOrigin(0.5, 0).setDepth(4);
  }

  /** 更新日志显示 */
  _updateLogDisplay(logArray) {
    if (!logArray || logArray.length === 0) return;
    this.gameLog = logArray;
    // 只显示最近6条
    const recent = logArray.slice(-6);
    this.logText.setText(recent.join('\n'));
  }

  // ========== 骰子动画 ==========

  /** 定庄骰子动画 */
  _playDealerDiceAnimation(diceResults) {
    if (!diceResults || !diceResults.results) {
      this._afterDealerDice();
      return;
    }

    const W = this.cameras.main.width;
    const H = this.cameras.main.height;
    const results = diceResults.results; // [{seat, sum}]

    // 按点数排序显示
    const ordered = [...results].sort((a, b) => b.sum - a.sum);
    const seatOrder = ordered.map(r => r.seat);

    this.hintText.setText('🎲 摇骰定庄...');
    let idx = 0;

    // 逐家显示骰子
    const showNextDice = () => {
      if (idx >= ordered.length) {
        // 全部显示完毕
        this._afterDealerDice();
        return;
      }

      const r = ordered[idx];
      const p = this.players[r.seat];
      const seatName = SEAT_NAMES[r.seat];
      this.hintText.setText(`🎲 ${seatName}(${p.name}) 摇骰: ?`);

      // 骰子动画：快速切换点数
      const dice1 = this.add.text(W / 2 - 30, H / 2 - 60, '⚀', {
        fontSize: '48px', color: '#ffffff',
      }).setOrigin(0.5).setDepth(20);
      const dice2 = this.add.text(W / 2 + 30, H / 2 - 60, '⚀', {
        fontSize: '48px', color: '#ffffff',
      }).setOrigin(0.5).setDepth(20);

      const diceFaces = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
      let rollCount = 0;
      const rollInterval = this.time.addEvent({
        delay: 80,
        callback: () => {
          dice1.setText(diceFaces[Math.floor(Math.random() * 6)]);
          dice2.setText(diceFaces[Math.floor(Math.random() * 6)]);
          rollCount++;
          if (rollCount > 10) {
            rollInterval.remove();
            // 最终结果
            const d1 = Math.min(6, r.sum - 1 > 6 ? r.sum - 6 : Math.floor(Math.random() * 6) + 1);
            const d2 = r.sum - d1;
            const f1 = Math.max(1, Math.min(6, d1));
            const f2 = Math.max(1, Math.min(6, d2));
            dice1.setText(diceFaces[f1 - 1]);
            dice2.setText(diceFaces[f2 - 1]);
            dice1.setColor('#ffd700');
            dice2.setColor('#ffd700');

            this.hintText.setText(`🎲 ${seatName}(${p.name}) 摇骰: ${r.sum}点`);

            // 1秒后继续下一家
            this.time.delayedCall(1000, () => {
              dice1.destroy();
              dice2.destroy();
              idx++;
              showNextDice();
            });
          }
        },
        loop: true,
      });
    };

    showNextDice();
  }

  /** 定庄动画完成后 → 显示手牌 + 买马动画 */
  _afterDealerDice() {
    const dealer = this.gameData.dealer;
    const dealerName = SEAT_NAMES[dealer];

    // 先清空提示
    this.hintText.setText(`🎲 ${dealerName}为庄家`);

    // 显示手牌
    // (initial_hand 事件触发)
    this._updateLogDisplay(this.gameData.gameLog);

    // 延迟后播买马动画
    this.time.delayedCall(1500, () => {
      this._playHorseDiceAnimation(this.gameData.horseResult);
    });
  }

  /** 买马骰子动画 */
  _playHorseDiceAnimation(horseResult) {
    if (!horseResult) return;

    const W = this.cameras.main.width;
    const H = this.cameras.main.height;
    const seatName = SEAT_NAMES[horseResult.pickerSeat];

    this.hintText.setText(`🐴 买马: ${seatName}摇骰...`);

    const diceFaces = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
    const dice1 = this.add.text(W / 2 - 30, H / 2 - 60, '⚀', {
      fontSize: '48px', color: '#ffffff',
    }).setOrigin(0.5).setDepth(20);
    const dice2 = this.add.text(W / 2 + 30, H / 2 - 60, '⚀', {
      fontSize: '48px', color: '#ffffff',
    }).setOrigin(0.5).setDepth(20);

    let rollCount = 0;
    const rollInterval = this.time.addEvent({
      delay: 80,
      callback: () => {
        dice1.setText(diceFaces[Math.floor(Math.random() * 6)]);
        dice2.setText(diceFaces[Math.floor(Math.random() * 6)]);
        rollCount++;
        if (rollCount > 12) {
          rollInterval.remove();
          const f1 = Math.max(1, Math.min(6, horseResult.dice1));
          const f2 = Math.max(1, Math.min(6, horseResult.dice2));
          dice1.setText(diceFaces[f1 - 1]);
          dice2.setText(diceFaces[f2 - 1]);
          dice1.setColor('#ffd700');
          dice2.setColor('#ffd700');

          this.hintText.setText(`🐴 ${seatName}买马 ${horseResult.horseCount}张`);

          // 显示马牌（扣着），存引用以便之后清理
          this.horseTiles = [];
          for (let h = 0; h < horseResult.horseCount; h++) {
            const horseTile = TileRenderer.createTile(this, 0,
              W / 2 - 30 + h * 40, H / 2 + 20, 30, 42, true);
            horseTile.setDepth(20);
            this.horseTiles.push(horseTile);
          }

          // 2秒后进入游戏，清理马牌
          this.time.delayedCall(2000, () => {
            dice1.destroy();
            dice2.destroy();
            // 清理中央马牌（用户要求不显示）
            if (this.horseTiles) {
              this.horseTiles.forEach(t => t.destroy());
              this.horseTiles = [];
            }
            const dSeat = this.gameData.dealer;
    this.hintText.setText(`${dSeat !== undefined ? SEAT_NAMES[dSeat] : '东'}先出牌`);
          });
        }
      },
      loop: true,
    });
  }

  // ========== 手牌渲染 ==========

  _receiveHand(data) {
    this.hand = data.hand || [];
    this.mySeat = data.seatIndex;
    this._renderHand();
  }

  _renderHand() {
    this._clearTiles();
    const W = this.cameras.main.width;
    const startX = W / 2 - (this.hand.length * (this.TILE_W + 4)) / 2;

    this.hand.forEach((tile, idx) => {
      const x = startX + idx * (this.TILE_W + 4);
      const container = TileRenderer.createClickableTile(
        this, tile, x, this.HAND_Y, this.TILE_W, this.TILE_H,
        () => this._onTileClick(tile)
      );
      container.setDepth(10);
      this.tileElements.push(container);
    });
  }

  _renderOpponentHands(players) {
    const W = this.cameras.main.width;
    const H = this.cameras.main.height;

    if (this.opponentTiles) {
      this.opponentTiles.forEach(t => t.destroy());
    }
    this.opponentTiles = [];

    const oW = 32, oH = 44, gap = 2;

    for (let i = 0; i < 4; i++) {
      if (i === this.mySeat) continue;
      const p = players[i];
      const rel = (i - this.mySeat + 4) % 4;
      const count = p.handSize || 13;

      if (rel === 2) {
        const startX = W / 2 - (count * (oW + gap)) / 2;
        for (let j = 0; j < count; j++) {
          const tile = TileRenderer.createTile(this, 0,
            startX + j * (oW + gap), 30, oW, oH, true).setDepth(1);
          this.opponentTiles.push(tile);
        }
      } else if (rel === 1) {
        const startY = H / 2 - (count * (oH + gap - 4)) / 2;
        for (let j = 0; j < count; j++) {
          const tile = TileRenderer.createTile(this, 0,
            W - 28, startY + j * (oH + gap - 4), oW, oH, true).setDepth(1);
          tile.setAngle(-90);
          this.opponentTiles.push(tile);
        }
      } else {
        const startY = H / 2 - (count * (oH + gap - 4)) / 2;
        for (let j = 0; j < count; j++) {
          const tile = TileRenderer.createTile(this, 0,
            28, startY + j * (oH + gap - 4), oW, oH, true).setDepth(1);
          tile.setAngle(90);
          this.opponentTiles.push(tile);
        }
      }
    }
  }

  _onTileClick(tileType) {
    if (!this.isMyTurn) return;
    this.socket.discardTile(tileType);
    this.isMyTurn = false;
  }

  _clearTiles() {
    this.tileElements.forEach(t => t.destroy());
    this.tileElements = [];
  }

  // ========== 操作按钮 ==========

  _showActionButtons(actions) {
    this._clearActions();
    const W = this.cameras.main.width;
    const H = this.cameras.main.height;
    let btnX = W / 2 - 100;
    const btnY = H / 2 + 70;

    actions.forEach(action => {
      const label = action.type === 'pong' ? '碰' : action.type === 'kong' ? '杠' : '胡';
      const color = action.type === 'win' ? 0xff4444 : action.type === 'kong' ? 0x44aaff : 0x44ff44;
      const btn = this.add.rectangle(btnX, btnY, 70, 36, color)
        .setInteractive({ useHandCursor: true }).setDepth(15);
      const text = this.add.text(btnX, btnY, label, {
        fontSize: '18px', color: '#ffffff', fontStyle: 'bold',
      }).setOrigin(0.5).setDepth(16);
      btn.on('pointerdown', () => this._handleAction(action));
      this.actionButtons.push(btn, text);
      btnX += 80;
    });

    const skipBtn = this.add.rectangle(btnX, btnY, 70, 36, 0x666666)
      .setInteractive({ useHandCursor: true }).setDepth(15);
    const skipText = this.add.text(btnX, btnY, '跳过', {
      fontSize: '16px', color: '#ffffff',
    }).setOrigin(0.5).setDepth(16);
    skipBtn.on('pointerdown', () => { this.socket.skipAction(); this._clearActions(); });
    this.actionButtons.push(skipBtn, skipText);
  }

  _handleAction(action) {
    switch (action.type) {
      case 'pong': this.socket.pong(); break;
      case 'kong': this.socket.kong(action.tileType); break;
      case 'win': this.socket.win(); break;
    }
    this._clearActions();
  }

  _clearActions() {
    this.actionButtons.forEach(b => b.destroy());
    this.actionButtons = [];
  }

  // ========== Socket 事件 ==========

  _registerEvents() {
    this.socket.on('initial_hand', (data) => this._receiveHand(data));

    this.socket.on('your_hand', (data) => {
      if (data.seatIndex === this.mySeat) {
        this.hand = data.hand;
        this._renderHand();
      }
    });

    this.socket.on('your_turn', (data) => {
      if (data.playerId === this.socket.playerId) {
        this.isMyTurn = true;
        this.hintText.setText('👉 请出牌');
        this.hintText.setColor('#ffd700');
      } else {
        const p = this.players[data.seat];
        this.hintText.setText(`等待 ${p ? p.name : SEAT_NAMES[data.seat]} 出牌...`);
        this.hintText.setColor('#cccccc');
      }
    });

    this.socket.on('game_state_update', (data) => {
      const state = data.state;
      this.wallText.setText(`剩余: ${state.wallRemaining}张`);

      // 更新牌局日志
      if (state.gameLog) this._updateLogDisplay(state.gameLog);

      if (data.players) this._renderOpponentHands(data.players);

      // 可操作按钮
      if (state.actionQueue && state.actionQueue.length > 0) {
        const myActions = state.actionQueue.filter(a => a.seat === this.mySeat);
        if (myActions.length > 0) this._showActionButtons(myActions);
      }

      // 轮到我出牌
      if (state.phase === 'discard') {
        const cp = this.players[state.currentSeat];
        if (cp && cp.id === this.socket.playerId) {
          this.isMyTurn = true;
          this.hintText.setText('👉 请出牌');
          this.hintText.setColor('#ffd700');
        } else {
          this.isMyTurn = false;
        }
      }
    });

    this.socket.on('game_over', (data) => this._handleGameOver(data));
  }

  // ========== 语音 ==========

  _initVoiceChat() {
    this.voiceChat = new VoiceChatManager(this.socket, this);
    const realPlayers = this.players.filter(p => !p.isAI && p.id !== this.socket.playerId);
    if (realPlayers.length > 0) {
      this.voiceChat.initiateCall(this.gameData.roomId || this.socket.roomId);
    }
  }

  // ========== 游戏结束 ==========

  _handleGameOver(data) {
    const W = this.cameras.main.width;
    const H = this.cameras.main.height;

    this.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0.7).setDepth(50);

    let msg = '';
    if (data.result.type === 'flow') {
      msg = '💨 流局';
    } else {
      msg = `🏆 ${this.players[data.result.winner]?.name || '?'} 胡牌！`;
    }

    this.add.text(W / 2, H / 2 - 80, msg, {
      fontSize: '32px', color: '#ffd700', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(51);

    // 显示马牌结算
    if (data.horseSettlement) {
      let horseText = '🐴 马牌: ';
      data.horseSettlement.results.forEach(r => {
        horseText += `${r.tileName}(${SEAT_NAMES[r.ownerSeat]})${r.isHit ? '✓' : '✗'} `;
      });
      horseText += `\n总调整: ${data.horseSettlement.totalAdjustment}番`;
      this.add.text(W / 2, H / 2 - 40, horseText, {
        fontSize: '14px', color: '#ffaa00',
      }).setOrigin(0.5).setDepth(51);
    }

    // 显示所有手牌
    if (data.players) {
      data.players.forEach((p, i) => {
        const handStr = p.hand.sort((a, b) => a - b)
          .map(t => TileRenderer.getTileName(t)).join(' ');
        this.add.text(W / 2, H / 2 + 10 + i * 22,
          `${SEAT_NAMES[i]} ${p.name}: ${handStr}`, {
            fontSize: '13px', color: '#ffffff',
          }).setOrigin(0.5).setDepth(51);
      });
    }

    // 返回按钮
    const btn = this.add.rectangle(W / 2, H / 2 + 120, 160, 40, 0x4a7a5e)
      .setInteractive({ useHandCursor: true }).setDepth(51);
    this.add.text(W / 2, H / 2 + 120, '返回大厅', {
      fontSize: '16px', color: '#ffffff',
    }).setOrigin(0.5).setDepth(52);

    btn.on('pointerdown', () => { this.scene.start('LobbyScene'); });
  }
}
