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
    this.discardElements = [];
    this.lastDiscardSeen = '';
    this.selectedTileIdx = null;  // 预出牌选中的牌索引
    this.lastDrawTile = null;     // 刚摸的牌（放在最右边显示）
    this._lastClickTime = 0;      // 双击检测
    this._lastClickIdx = -1;
    this._roundStarted = false;   // 牌局未开始，手牌背面
    this._handBounds = {};        // 手牌边界信息（供碰杠牌定位）

    this.TILE_W = 54;         // 自摸手牌宽（1.5倍）
    this.TILE_H = 72;         // 自摸手牌高（1.5倍）
    this.HAND_Y = 515;        // 手牌下移0.7牌位 (72*0.7≈50)
  }

  create() {
    const W = this.cameras.main.width;
    const H = this.cameras.main.height;

    // 桌面背景（深色底色 + 径向渐变桌面纹理）
    this.add.rectangle(W / 2, H / 2, W, H, 0x1a3a2e);
    const tableGfx = this.add.graphics();
    tableGfx.fillStyle(0x2a5a3e, 1);
    tableGfx.fillRoundedRect(W / 2 - 330, H / 2 - 140, 660, 280, 6);
    tableGfx.fillStyle(0x2f6345, 0.6);
    tableGfx.fillRoundedRect(W / 2 - 310, H / 2 - 125, 620, 250, 4);
    tableGfx.lineStyle(2, 0x4a8a5e, 1);
    tableGfx.strokeRoundedRect(W / 2 - 330, H / 2 - 140, 660, 280, 6);

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
    this.statusText = this.add.text(W / 2, H / 2 - 138, '', {
      fontSize: '16px', color: '#ffd700', fontStyle: 'bold', padding: { top: 2, bottom: 1 },
    }).setOrigin(0.5).setDepth(10);

    this.wallText = this.add.text(W - 12, 12, '', {
      fontSize: '14px', color: '#aaaaaa', padding: { top: 2, bottom: 1 },
    }).setOrigin(1, 0);

    this.hintText = this.add.text(W / 2, H - 12, '', {
      fontSize: '16px', color: '#dddddd', padding: { top: 2, bottom: 1 },
    }).setOrigin(0.5).setDepth(10).setVisible(false);

    // === 注册事件（重启时自动清理旧监听） ===
    this.events.once('shutdown', () => {
      this.socket.off('your_hand');
      this.socket.off('your_turn');
      this.socket.off('game_state_update');
      this.socket.off('game_over');
      this.socket.off('horse_bought');
      this.socket.off('your_turn');
      this.socket.off('your_hand');
      this.socket.off('game_start');
      this.socket.off('game_state_update');
    });
    this._registerEvents();

    // === 初始化语音 ===
    this._initVoiceChat();

    // === 牌墙上方麦克风开关 ===
    this._createMicButton();

    // === 播放定庄骰子动画 ===
    this.time.delayedCall(300, () => {
      this._playDealerDiceAnimation(this.gameData.diceResults);
    });
  }

  /** 创建圆角按钮（统一样式） */
  _makeRoundedBtn(x, y, w, h, color, label, fontSize, fontColor, callback, depth) {
    const r = 6;
    const container = this.add.container(x, y).setDepth(depth || 15);

    // 阴影
    const shadow = this.add.graphics();
    shadow.fillStyle(0x000000, 0.25);
    shadow.fillRoundedRect(-w / 2 + 2, -h / 2 + 2, w, h, r);
    container.add(shadow);

    // 背景
    const bg = this.add.graphics();
    bg.fillStyle(color, 1);
    bg.fillRoundedRect(-w / 2, -h / 2, w, h, r);
    bg.lineStyle(1, 0xffffff, 0.15);
    bg.strokeRoundedRect(-w / 2, -h / 2, w, h, r);
    container.add(bg);

    // 点击区
    const hitZone = this.add.rectangle(0, 0, w, h, 0x000000, 0)
      .setInteractive({ useHandCursor: true });
    container.add(hitZone);

    // 文字
    const text = this.add.text(0, 0, label, {
      fontSize, color: fontColor, fontStyle: 'bold',
      padding: { top: 3, bottom: 2 },
    }).setOrigin(0.5);
    container.add(text);

    hitZone.on('pointerdown', callback);
    return container;
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

      if (rel === 1 || rel === 3) {
        // 左右两家：风位字 + 昵称竖排
        const originX = rel === 1 ? 1 : 0;
        const windLabel = this.add.text(x, y, SEAT_NAMES[i], {
          fontSize: '15px', color: '#ffffff',
          fontStyle: 'normal', padding: { top: 2, bottom: 1 },
        }).setOrigin(originX, 0.5).setDepth(5);
        this.playerLabels.push(windLabel);
        // 昵称竖排一列
        const nameChars = (p.isAI ? p.name : p.name).split('');
        nameChars.forEach((ch, ci) => {
          const cl = this.add.text(x, y + 18 + ci * 16, ch, {
            fontSize: '13px', color: '#cccccc',
            padding: { top: 0, bottom: 0 },
          }).setOrigin(originX, 0.5).setDepth(5);
          this.playerLabels.push(cl);
        });
      } else {
        // 自己和对面：原有样式
        const label = this.add.text(x, y,
          `${SEAT_NAMES[i]} ${p.name}${p.isAI ? ' (AI)' : ''}`, {
            fontSize: '15px', color: i === this.mySeat ? '#ffd700' : '#ffffff',
            fontStyle: i === this.mySeat ? 'bold' : 'normal',
            padding: { top: 2, bottom: 1 },
          }).setOrigin(0.5, 0.5).setDepth(5);
        this.playerLabels.push(label);
      }

      // 累计输赢（番数总计放大2倍+重定位）
      if (this.game.cumulativeStats && this.game.cumulativeStats[p.name]) {
        const total = this.game.cumulativeStats[p.name].total;
        if (total !== 0) {
          const totalColor = total > 0 ? '#44ff44' : '#ff4444';
          const totalStr = `${total > 0 ? '+' : ''}${total}`;
          let tx = x, ty = y;
          if (rel === 0) {
            // 玩家：左移0.3牌位 (54*0.3≈16)
            tx = x - 71; ty = y;
          } else if (rel === 2) {
            // 对家：风位字左边移1.5牌位再右移1牌位
            tx = x - 82; ty = y;
          } else if (rel === 1) {
            // 右边家：风位字上方再左移1牌位
            tx = x - 54; ty = y - 22;
          } else {
            // 左边家：风位字上方0.3牌位
            tx = x; ty = y - 22;
          }
          const totalLabel = this.add.text(tx, ty, totalStr, {
            fontSize: '26px', color: totalColor, fontStyle: 'bold',
            padding: { top: 1, bottom: 0 },
          }).setOrigin(0.5, 0.5).setDepth(5);
          this.playerLabels.push(totalLabel);
        }
      }
    }
  }

  // ========== 中央牌局日志 ==========

  _createLogArea() {
    const W = this.cameras.main.width;
    const H = this.cameras.main.height;

    // 日志区在弃牌矩形内部，高度5行中文
    const logW = 6 * 29 - 20;   // 174 - 边距
    const logH = 100;           // 5行中文 ≈ 5*(13+4)+10
    this.logBg = this.add.rectangle(W / 2, H / 2 - 36, logW, logH, 0x000000, 0.7)
      .setDepth(3).setStrokeStyle(1, 0x4a8a5e).setVisible(true);

    this.logText = this.add.text(W / 2, H / 2 - 36 - logH / 2 + 6, '', {
      fontSize: '13px', color: '#ffffff', lineSpacing: 6, fontFamily: 'Arial, sans-serif',
      wordWrap: { width: logW - 10 }, padding: { top: 1, bottom: 1 },
    }).setOrigin(0.5, 0).setDepth(4).setVisible(true);
  }

  /** 更新日志显示 — 最近5行 */
  _updateLogDisplay(logArray) {
    if (!logArray || logArray.length === 0) return;
    // 取最后5条显示
    const lastLines = logArray.slice(-5);
    this.logText.setText(lastLines.join('\n'));
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

    this.hintText.setVisible(true).setText('🎲 摇骰定庄...');
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
      this.hintText.setVisible(true).setText(`🎲 ${seatName}(${p.name}) 摇骰: ?`);

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

            this.hintText.setVisible(true).setText(`🎲 ${seatName}(${p.name}) 摇骰: ${r.sum}点`);
            // 合并到中央日志框
            this.gameData.gameLog.push(`🎲 ${seatName}(${p.name}) ${r.sum}点`);
            this._updateLogDisplay(this.gameData.gameLog);

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

  /** 定庄动画完成后 → 先问是否买马 */
  _afterDealerDice() {
    const dealer = this.gameData.dealer;
    const dealerName = SEAT_NAMES[dealer];

    this.hintText.setVisible(true).setText(`🎲 ${dealerName}为庄家`);
    this._updateLogDisplay(this.gameData.gameLog);

    if (this.gameData.needHorseSelection) {
      this.time.delayedCall(800, () => this._showHorseChoice());
    } else {
      this.time.delayedCall(500, () => {
        const dSeat = this.gameData.dealer;
        this.statusText.setText(`${dSeat !== undefined ? SEAT_NAMES[dSeat] : '东'}先出牌`);
      });
    }
  }

  /** 是否买马选择 */
  _showHorseChoice() {
    const W = this.cameras.main.width;
    const H = this.cameras.main.height;
    const elements = [];
    const add = (obj) => { elements.push(obj); return obj; };

    add(this.add.rectangle(W / 2, H / 2, 260, 130, 0x000000, 0.8)
      .setDepth(30).setStrokeStyle(2, 0x4a8a5e));
    add(this.add.text(W / 2, H / 2 - 35, '是否买马？', {
      fontSize: '18px', color: '#ffd700', padding: { top: 2 },
    }).setOrigin(0.5).setDepth(31));

    const cleanup = () => { elements.forEach(e => e.destroy()); };

    const yesBtn = add(this._makeRoundedBtn(W / 2 - 50, H / 2 + 20, 80, 32, 0x4a7a5e,
      '买马', '16px', '#ffffff', () => { cleanup(); this._showHorseSelector(); }, 31));

    const noBtn = add(this._makeRoundedBtn(W / 2 + 50, H / 2 + 20, 80, 32, 0x664444,
      '不买', '16px', '#ffffff', () => {
        cleanup();
        this.socket.emit('select_horse_count', { count: 0 });
        this.hintText.setVisible(true).setText('不买马，开始游戏');
      }, 31));
  }

  /** 选马UI（定庄后弹出，1-4匹） */
  _showHorseSelector() {
    const W = this.cameras.main.width;
    const H = this.cameras.main.height;
    const bg = this.add.rectangle(W / 2, H / 2, 300, 160, 0x000000, 0.8)
      .setDepth(30).setStrokeStyle(2, 0x4a8a5e);
    const title = this.add.text(W / 2, H / 2 - 50, '选择买马数量', {
      fontSize: '18px', color: '#ffd700',
    }).setOrigin(0.5).setDepth(31);

    let selected = 1;
    const btns = [];
    const redrawSelectors = () => {
      btns.forEach(b => b.destroy());
      btns.length = 0;
      for (let h = 1; h <= 4; h++) {
        const bx = W / 2 - 75 + (h - 1) * 50;
        const by = H / 2 + 10;
        const btn = this._makeRoundedBtn(bx, by, 40, 32,
          h === selected ? 0x4a7a5e : 0x3a5a4e, `${h}匹`, '14px', '#ffffff', () => {
            selected = h;
            redrawSelectors();
          }, 31);
        btns.push(btn);
      }
    };
    redrawSelectors();

    const ok = this._makeRoundedBtn(W / 2, H / 2 + 55, 100, 30, 0x4a7a5e,
      '确定', '16px', '#ffffff', () => {
        bg.destroy(); title.destroy(); ok.destroy();
        btns.forEach(b => b.destroy());
        this.socket.emit('select_horse_count', { count: selected });
        this.hintText.setVisible(true).setText(`🐴 选马${selected}匹，摇骰中...`);
      }, 31);
  }

  /** 显示四家马牌（扣牌，各自靠近桌边） */
  _showHorseTiles(horseCounts) {
    if (!horseCounts) return;
    const W = this.cameras.main.width;
    const H = this.cameras.main.height;

    if (this.horseTiles) this.horseTiles.forEach(t => t.destroy());
    this.horseTiles = [];
    const hW = 24, hH = 32, hGap = 1;

    horseCounts.forEach((count, seatIdx) => {
      if (!count || count <= 0) return;
      const rel = (seatIdx - this.mySeat + 4) % 4;
      const hb = this._handBounds && this._handBounds[rel];
      const hh = Math.floor(0.5 * hH); // 0.5牌位

      let startX, startY, dirX, dirY;
      if (rel === 0) {
        // 自己：原位不变
        startX = 148; startY = H - 27; dirX = 1; dirY = 0;
      } else if (rel === 3 && hb) {
        // 左边家：手牌左上+右移3牌位靠中心，竖排向下
        startX = hb.x - hb.oW / 2 - hh + 3 * hW; startY = hb.topY - hb.oH / 2 - hh; dirX = 0; dirY = 1;
      } else if (rel === 1 && hb) {
        // 右边家：手牌右下+左移3牌位靠中心，竖排向上
        startX = hb.x + hb.oW / 2 + hh - 3 * hW; startY = hb.bottomY + hh; dirX = 0; dirY = -1;
      } else if (rel === 2 && hb) {
        // 对家：手牌右上+下移3牌位靠中心，横排向左
        startX = hb.rightX + hh; startY = hb.y - hb.oH / 2 - hh + 3 * hH; dirX = -1; dirY = 0;
      } else {
        // 后备
        startX = 0; startY = 0; dirX = 0; dirY = 0;
      }

      for (let h = 0; h < count; h++) {
        const hx = startX + h * (hW + hGap) * dirX;
        const hy = startY + h * (hH + hGap) * dirY;
        const tile = TileRenderer.createTile(this, 0, hx, hy, hW, hH, true);
        tile.setDepth(5).setAlpha(0.9);
        this.horseTiles.push(tile);
      }
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
    const tileStep = this.TILE_W + 1;  // 1.5倍牌用更紧凑间距

    // 构建渲染用的手牌数组：刚摸的牌移到最右边
    let renderHand = [...this.hand];
    if (this.lastDrawTile !== null && renderHand.length === 14) {
      const drawIdx = renderHand.lastIndexOf(this.lastDrawTile);
      if (drawIdx !== -1 && drawIdx !== 13) {
        renderHand.splice(drawIdx, 1);
        renderHand.push(this.lastDrawTile);
      }
    }

    // 第14张牌（刚摸来的）放在最右边，间隔半个牌位宽度
    const gapIdx = 13;
    const extraGap = Math.floor(this.TILE_W / 2); // 半个牌位宽
    const totalW = renderHand.length * tileStep + (renderHand.length > gapIdx ? extraGap : 0);

    const startX = W / 2 - totalW / 2;
    this._handLeftX = startX;
    if (!this._handBounds) this._handBounds = {};
    this._handBounds[0] = { leftX: startX, y: this.HAND_Y, step: tileStep, count: renderHand.length };

    // 手牌全部显示背面，等买马结束后翻正（首局+再开局通用）
    const showBack = !this._roundStarted;

    renderHand.forEach((tile, idx) => {
      let x = startX + idx * tileStep;
      if (idx >= gapIdx) x += extraGap;
      const liftY = (this.selectedTileIdx === idx) ? this.HAND_Y - this.TILE_H / 2 : this.HAND_Y;

      if (showBack) {
        // 再开局：全部牌背，不可点击
        const container = TileRenderer.createTile(this, tile, x, liftY, this.TILE_W, this.TILE_H, true);
        container.setDepth(10);
        this.tileElements.push(container);
      } else {
        const container = TileRenderer.createClickableTile(
          this, tile, x, liftY, this.TILE_W, this.TILE_H,
          () => this._onTileClick(tile, idx)
        );
        container.setDepth(10);
        this.tileElements.push(container);

        // 预出牌高亮：选中牌本身变色
        if (this.selectedTileIdx === idx) {
          const glow = this.add.rectangle(x, liftY, this.TILE_W + 6, this.TILE_H + 6, 0xffff00, 0.25)
            .setDepth(11).setStrokeStyle(2, 0xffdd00);
          this.tileElements.push(glow);
        }
      }
    });
  }

  _renderOpponentHands(players) {
    // 如果手牌数量没变，跳过重绘（避免抖动）
    if (!this._opponentHandSizes) this._opponentHandSizes = {};
    let changed = false;
    for (let i = 0; i < 4; i++) {
      if (i === this.mySeat) continue;
      const sz = players[i]?.handSize;
      if (this._opponentHandSizes[i] !== sz) {
        this._opponentHandSizes[i] = sz;
        changed = true;
      }
    }
    if (!changed && this.opponentTiles && this.opponentTiles.length > 0) return;

    const W = this.cameras.main.width;
    const H = this.cameras.main.height;

    if (this.opponentTiles) {
      this.opponentTiles.forEach(t => t.destroy());
    }
    this.opponentTiles = [];

    // 所有牌墙向中心靠拢，左右牌墙紧挨（gap=0）
    const oW = 22, oH = 30;

    for (let i = 0; i < 4; i++) {
      if (i === this.mySeat) continue;
      const p = players[i];
      const rel = (i - this.mySeat + 4) % 4;
      const count = p.handSize || 13;
      const step = oW + 1;

      if (rel === 2) {
        // 上方（北）：居中靠中心
        const startX = W / 2 - (count * step) / 2;
        this._handBounds[2] = { rightX: startX + (count - 1) * step + oW, y: 50, oW, oH };
        for (let j = 0; j < count; j++) {
          const tile = TileRenderer.createTile(this, 0,
            startX + j * step, 50, oW, oH, true).setDepth(1);
          this.opponentTiles.push(tile);
        }
      } else if (rel === 1) {
        // 右侧（东）：与玩家牌墙间隔一致（gap=2）
        const sideGap = 2;
        const oStep = oW + sideGap;
        const gapIdx = 13;
        const extraGap = Math.floor(oW / 2);
        const totalH = count * oStep + (count > gapIdx ? extraGap : 0);
        const startY = H / 2 - totalH / 2;
        const lastY = startY + (count - 1) * oStep + (count > gapIdx ? extraGap : 0);
        this._handBounds[1] = { bottomY: lastY + oH, x: W - 68, oW, oH };
        for (let j = 0; j < count; j++) {
          let y = startY + j * oStep;
          if (j >= gapIdx) y += extraGap;
          const tile = TileRenderer.createTile(this, 0,
            W - 68, y, oW, oH, true).setDepth(1);
          tile.setAngle(-90);
          this.opponentTiles.push(tile);
        }
      } else {
        // 左侧（西）：与玩家牌墙间隔一致（gap=2）
        const sideGap = 2;
        const oStep = oW + sideGap;
        const gapIdx = 13;
        const extraGap = Math.floor(oW / 2);
        const totalH = count * oStep + (count > gapIdx ? extraGap : 0);
        const startY = H / 2 - totalH / 2;
        this._handBounds[3] = { topY: startY, x: 68, oW, oH };
        for (let j = 0; j < count; j++) {
          let y = startY + j * oStep;
          if (j >= gapIdx) y += extraGap;
          const tile = TileRenderer.createTile(this, 0,
            68, y, oW, oH, true).setDepth(1);
          tile.setAngle(90);
          this.opponentTiles.push(tile);
        }
      }
    }
  }

  _onTileClick(tileType, idx) {
    if (!this.isMyTurn) return;

    const now = Date.now();
    const isDoubleClick = (now - this._lastClickTime < 350) && (this._lastClickIdx === idx);
    this._lastClickTime = now;
    this._lastClickIdx = idx;

    if (isDoubleClick) {
      // 双击 → 直接出牌
      this.socket.discardTile(tileType);
      this.selectedTileIdx = null;
      this.isMyTurn = false;
      this._renderHand();
      return;
    }

    if (this.selectedTileIdx === idx) {
      // 再次点击已选中的牌 → 出牌
      this.socket.discardTile(tileType);
      this.selectedTileIdx = null;
      this.selectedTileType = null;
      this.isMyTurn = false;
      this._renderHand();
      this._renderDiscardsFromState();
    } else {
      // 点击另一张牌 → 切换预出牌
      this.selectedTileIdx = idx;
      this.selectedTileType = tileType;  // 记录预出牌型，用于牌河高亮
      this._renderHand();
      this._renderDiscardsFromState();
    }
  }

  _clearTiles() {
    this.tileElements.forEach(t => t.destroy());
    this.tileElements = [];
  }

  // ========== 弃牌渲染（前6张围成矩形，日志在矩形内） ==========

  _renderDiscards(players) {
    this.discardElements.forEach(e => e.destroy());
    this.discardElements = [];

    const W = this.cameras.main.width;
    const H = this.cameras.main.height;

    // 日志区居中，每边留出6张弃牌的空间
    const tW = 28, tH = 36, gap = 1, perSide = 6;
    // 水平方向6张的宽度作为日志区宽度参考
    const rowW = perSide * (tW + gap);
    const colH = perSide * (tH + gap);

    // 日志区边界（被弃牌矩形包围）
    // 牌河整体偏移：上移0.3牌位(11px), 右移0.5牌位(14px)
    const DISCARD_DX = 14;
    const DISCARD_DY = -11;
    const logLeft = W / 2 - rowW / 2 + DISCARD_DX;
    const logRight = W / 2 + rowW / 2 + DISCARD_DX;
    const logTop = H / 2 - colH / 2 + DISCARD_DY;
    const logBottom = H / 2 + colH / 2 + DISCARD_DY;

    players.forEach((p, i) => {
      const rel = (i - this.mySeat + 4) % 4;
      const discards = p.discards || [];
      if (discards.length === 0) return;

      if (rel === 0 || rel === 2) {
        // 自己（下方）或对家（上方）：水平排列，每行6张
        const maxPerRow = perSide;
        const startX = W / 2 - rowW / 2 + DISCARD_DX;
        // 上下牌河各向中心挪1.5个牌位（向外移半牌高）
        const shiftY = Math.floor(1.5 * (tH + gap));
        const startY = rel === 0 ? logBottom + 2 - shiftY : logTop - 2 - tH + shiftY;
        discards.forEach((tile, idx) => {
          const row = Math.floor(idx / maxPerRow);
          const col = idx % maxPerRow;
          const x = startX + col * (tW + gap);
          const y = startY + (rel === 0 ? 1 : -1) * row * (tH + gap);
          const el = TileRenderer.createTile(this, tile, x, y, tW, tH, false);
          el.setDepth(3).setAlpha(0.9);
          this.discardElements.push(el);
          // 预出牌高亮：牌河里同牌变色
          if (this.selectedTileType !== null && tile === this.selectedTileType) {
            const glow = this.add.rectangle(x, y, tW + 4, tH + 4, 0xffff00, 0.3)
              .setDepth(3).setStrokeStyle(2, 0xffdd00);
            this.discardElements.push(glow);
          }
        });
      } else {
        // 左右两侧：垂直排列，每列6张
        const maxPerCol = perSide;
        const startX = rel === 1 ? logRight + 2 : logLeft - 2 - tW;
        const startY = H / 2 - colH / 2;
        discards.forEach((tile, idx) => {
          const col = Math.floor(idx / maxPerCol);
          const row = idx % maxPerCol;
          const x = startX + (rel === 1 ? 1 : -1) * col * (tW + gap);
          const y = startY + row * (tH + gap);
          const el = TileRenderer.createTile(this, tile, x, y, tW, tH, false);
          el.setDepth(3).setAlpha(0.9);
          this.discardElements.push(el);
          if (this.selectedTileType !== null && tile === this.selectedTileType) {
            const glow = this.add.rectangle(x, y, tW + 4, tH + 4, 0xffff00, 0.3)
              .setDepth(3).setStrokeStyle(2, 0xffdd00);
            this.discardElements.push(glow);
          }
        });
      }
    });
  }

  // ========== 副露渲染（自家碰杠牌在手牌左边，大小与牌河一致） ==========

  _renderMelds(players) {
    if (this.meldElements) {
      this.meldElements.forEach(e => e.destroy());
    }
    this.meldElements = [];

    const W = this.cameras.main.width;
    const H = this.cameras.main.height;
    // 碰杠牌大小与弃牌牌河一致
    const tW = 28, tH = 36, gap = 1;

    // 自家手牌左边界
    const handLeft = this._handLeftX || (W / 2 - 14 * (this.TILE_W + 1) / 2);

    players.forEach((p, i) => {
      const melds = p.melds || [];
      if (melds.length === 0) return;
      const rel = (i - this.mySeat + 4) % 4;

      let baseX, baseY, dirX, dirY;
      const hb = this._handBounds && this._handBounds[rel];

      if (rel === 0 && hb) {
        // 自己：碰杠在手牌最左外侧，同横排，向左排列
        baseX = hb.leftX - tW - 4; baseY = hb.y; dirX = -1; dirY = 0;
      } else if (rel === 2 && hb) {
        // 对家：碰杠在手牌最右外侧，同横排，向右排列
        baseX = hb.rightX + 4; baseY = hb.y; dirX = 1; dirY = 0;
      } else if (rel === 1 && hb) {
        // 右边家：碰杠在手牌最下外侧，同竖排，向下排列
        baseX = hb.x; baseY = hb.bottomY + 4; dirX = 0; dirY = 1;
      } else if (rel === 3 && hb) {
        // 左边家：碰杠在手牌最上外侧，同竖排，向上排列
        baseX = hb.x; baseY = hb.topY - tH - 4; dirX = 0; dirY = -1;
      } else {
        // 后备方案（无边界数据时）
        if (rel === 0) { baseX = handLeft - tW - 4; baseY = this.HAND_Y; dirX = -1; dirY = 0; }
        else if (rel === 2) { baseX = 8; baseY = 5; dirX = 1; dirY = 0; }
        else if (rel === 1) { baseX = W - 5 - tW; baseY = H / 2 + 20; dirX = 0; dirY = -1; }
        else { baseX = 5; baseY = H / 2 - 20; dirX = 0; dirY = 1; }
      }

      melds.forEach((meld) => {
        const tiles = meld.tiles || [];
        const isConcealed = meld.type === 'concealed_kong';
        const showFace = !(isConcealed && i !== this.mySeat);

        tiles.forEach((tile, idx) => {
          const x = baseX + idx * (tW + gap) * dirX;
          const y = baseY + idx * (tH + gap - 1) * dirY;
          const el = TileRenderer.createTile(this,
            showFace ? tile : 0, x, y, tW, tH, !showFace);
          el.setDepth(4);
          // 明杠取自哪家标记
          if (meld.from !== undefined && meld.from !== null && idx === 2 && showFace) {
            const fromLabel = this.add.text(x, y + tH / 2 + 2,
              SEAT_NAMES[meld.from], { fontSize: '10px', color: '#ffaa00' })
              .setOrigin(0.5).setDepth(5);
            this.meldElements.push(fromLabel);
          }
          this.meldElements.push(el);
        });

        // 副露间距
        const offset = (tiles.length * (tW + gap) + 8) * dirX || (tiles.length * (tH + gap - 1) + 8) * dirY;
        if (dirX !== 0) baseX += offset;
        else baseY += offset;
      });
    });
  }

  // ========== 操作按钮 ==========

  _showActionButtons(actions) {
    this._clearActions();
    const W = this.cameras.main.width;
    const H = this.cameras.main.height;
    // 碰杠胡提示放在牌桌正中央，多 action 上下错开
    const centerX = W / 2;
    const iconW = 40, iconH = 56, iconGap = 2;
    const btnW = 60, btnH = 40;
    const tileBtnGap = 10, btnGap = 8, rowGap = 10;

    // 碰杠时高亮牌河里对应的牌
    const pongKongAction = actions.find(a => a.type === 'pong' || a.type === 'kong');
    if (pongKongAction) {
      this.selectedTileType = pongKongAction.tileType;
      this._renderDiscardsFromState();
    }
    const rowH = Math.max(iconH, btnH) + rowGap;
    const totalH = actions.length * rowH - rowGap;
    const startY = H / 2 - totalH / 2;

    actions.forEach((action, idx) => {
      const rowY = startY + idx * rowH + Math.max(iconH, btnH) / 2;
      const tileCount = action.type === 'kong' ? 4 : action.type === 'pong' ? 3 : 0;
      const tilesW = tileCount * (iconW + iconGap) - iconGap;
      const totalW = tilesW + (tileCount > 0 ? tileBtnGap : 0) + btnW + btnGap + btnW;
      const startX = centerX - totalW / 2;
      let xOff = 0;

      // 牌面图标（×2大小）
      if (tileCount > 0) {
        for (let i = 0; i < tileCount; i++) {
          const t = TileRenderer.createTile(this, action.tileType,
            startX + xOff + i * (iconW + iconGap), rowY,
            iconW, iconH, false);
          t.setDepth(15);
          this.actionButtons.push(t);
        }
        xOff += tilesW + tileBtnGap;
      }

      // 操作按钮
      const btnLabel = action.type === 'pong' ? '碰' : action.type === 'kong' ? '杠' : '胡';
      const btnColor = action.type === 'pong' ? 0x44ff44
        : action.type === 'kong' ? 0x44aaff : 0xff4444;
      const btnFontSize = action.type === 'win' ? '22px' : '18px';
      const actBtn = this._makeRoundedBtn(startX + xOff + btnW / 2, rowY,
        btnW, btnH, btnColor, btnLabel, btnFontSize, '#ffffff',
        () => this._handleAction(action), 15);
      this.actionButtons.push(actBtn);
      xOff += btnW + btnGap;

      // 跳过按钮紧跟在后
      const skipBtn = this._makeRoundedBtn(startX + xOff + btnW / 2, rowY,
        btnW, btnH, 0x666666, '跳过', '16px', '#ffffff',
        () => { this.socket.skipAction(); this._clearActions(); }, 15);
      this.actionButtons.push(skipBtn);
    });
  }

  /** 检查杠机会：暗杠（手牌4张）+ 补杠/明杠（手牌1张+已有碰） */
  _findConcealedKongs() {
    const counts = {};
    for (const t of this.hand) {
      counts[t] = (counts[t] || 0) + 1;
    }
    const actions = [];
    const myPlayer = this.players && this.players[this.mySeat];
    for (const [tileType, count] of Object.entries(counts)) {
      const tt = parseInt(tileType);
      if (count >= 4) {
        // 暗杠
        actions.push({ type: 'kong', seat: this.mySeat, tileType: tt });
      } else if (count === 1 && myPlayer) {
        // 补杠/明杠：手牌有1张 + 已有碰牌
        const hasPong = myPlayer.melds && myPlayer.melds.some(
          m => m.type === 'pong' && m.tiles && m.tiles[0] === tt
        );
        if (hasPong) {
          actions.push({ type: 'kong', seat: this.mySeat, tileType: tt, kongType: 'exposed' });
        }
      }
    }
    return actions;
  }

  /** 用缓存的玩家数据重绘弃牌区（预出牌高亮更新用） */
  _renderDiscardsFromState() {
    if (this._lastPlayers) this._renderDiscards(this._lastPlayers);
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
    // 清除牌河高亮
    if (this.selectedTileType !== null) {
      this.selectedTileType = null;
      this._renderDiscardsFromState();
    }
  }

  // ========== Socket 事件 ==========

  _registerEvents() {
    this.socket.on('your_hand', (data) => {
      if (data.seatIndex === this.mySeat) {
        this.hand = data.hand;
        this.lastDrawTile = data.lastDrawnTile !== undefined ? data.lastDrawnTile : null;
        this._renderHand();
      }
    });

    this.socket.on('your_turn', (data) => {
      this._roundStarted = true;  // 标记牌局已开始，翻正手牌
      this._renderHand();         // 立即重绘，翻正牌面
      if (data.playerId === this.socket.playerId) {
        this.isMyTurn = true;
      } else {
        this.isMyTurn = false;
      }
    });

    this.socket.on('game_state_update', (data) => {
      const state = data.state;
      this.wallText.setText(`剩余: ${state.wallRemaining}张`);

      // 更新牌局日志
      if (state.gameLog) this._updateLogDisplay(state.gameLog);

      if (data.players) {
        this._lastPlayers = data.players;  // 缓存用于预出牌高亮刷新
        this._renderOpponentHands(data.players);
        this._renderDiscards(data.players);
        this._renderMelds(data.players);
      }

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
          // 检查暗杠机会（手牌有4张相同牌）
          const kongActions = this._findConcealedKongs();
          if (kongActions.length > 0) this._showActionButtons(kongActions);
        } else {
          this.isMyTurn = false;
        }
      }
    });

    this.socket.on('game_over', (data) => {
      this._updateCumulativeStats(data);
      this._handleGameOver(data);
    });

    // 买马结果 → 显示四家马牌（扣牌）
    this.socket.on('horse_bought', (data) => {
      if (data && Array.isArray(data)) {
        this._showHorseTiles(data);
      }
    });

    // 下一局：重新初始化场景
    this.socket.on('game_start', (data) => {
      this.scene.restart({ gameData: data });
    });
  }

  // ========== 语音 ==========

  _initVoiceChat() {
    this.voiceChat = new VoiceChatManager(this.socket, this);
    const realPlayers = this.players.filter(p => !p.isAI && p.id !== this.socket.playerId);
    if (realPlayers.length > 0) {
      this.voiceChat.initiateCall(this.gameData.roomId || this.socket.roomId);
    }
  }

  /** 麦克风开关（手牌下方，昵称右侧并排） */
  _createMicButton() {
    const W = this.cameras.main.width;
    const H = this.cameras.main.height;
    this.micMuted = false;

    const micX = W / 2 + 65;  // 昵称右侧
    const micY = H - 25;      // 与昵称同高

    const createMic = (muted) => {
      if (this.micBtn) this.micBtn.destroy();
      this.micBtn = this._makeRoundedBtn(micX, micY, 40, 24, muted ? 0x664444 : 0x446644,
        muted ? '🔇' : '🎤', '13px', '#ffffff', () => {
          if (this.voiceChat) {
            const m = this.voiceChat.toggleMute();
            this.micMuted = m;
            createMic(m);
          }
        }, 15);
    };
    createMic(false);
  }

  // ========== 累计统计（跨局） ==========

  /** 更新各玩家累计输赢（含马牌） */
  _updateCumulativeStats(data) {
    if (!this.game.cumulativeStats) this.game.cumulativeStats = {};
    const stats = this.game.cumulativeStats;
    const result = data.result;
    if (!result || !result.payments) return;

    // 计算各玩家本轮净输赢（牌局部分），用玩家昵称做key
    const roundNet = {};
    let totalWinnerGain = 0;
    for (const [seatName, p] of Object.entries(result.payments)) {
      const playerName = p.playerName || seatName;
      roundNet[playerName] = -(p.pay || 0);
      totalWinnerGain += (p.pay || 0);
    }
    if (result.winner !== undefined) {
      const winnerPlayerName = result.winnerName
        || this.players[result.winner]?.name
        || SEAT_NAMES[result.winner];
      roundNet[winnerPlayerName] = totalWinnerGain;
    }

    // 马牌调整：每人独立马牌输赢
    if (data.horseResults) {
      data.horseResults.forEach((hr) => {
        if (!hr || hr.pickerAdjustment === 0) return;
        roundNet[hr.playerName] = (roundNet[hr.playerName] || 0) + hr.pickerAdjustment;
      });
    }

    for (const [name, net] of Object.entries(roundNet)) {
      if (!stats[name]) stats[name] = { total: 0, rounds: [] };
      stats[name].total += net;
      stats[name].rounds.push(net);
    }
  }

  /** 渲染统计表 */
  _renderSettlementStats(depthBase, startY) {
    const stats = this.game.cumulativeStats;
    if (!stats || Object.keys(stats).length === 0) return;

    const W = this.cameras.main.width;
    let y = startY || 200;

    // 表头
    this.add.text(W / 2, y, '── 累计统计 ──', {
      fontSize: '24px', color: '#ffd700',
      padding: { top: 4, bottom: 2 },
    }).setOrigin(0.5).setDepth(depthBase + 1);
    y += 30;

    // 表头列名
    this.add.text(W / 2 - 120, y, '玩家', {
      fontSize: '20px', color: '#aaaaaa', padding: { top: 3 },
    }).setOrigin(0, 0.5).setDepth(depthBase + 1);
    this.add.text(W / 2 + 10, y, '本轮(含马)', {
      fontSize: '20px', color: '#aaaaaa', padding: { top: 3 },
    }).setOrigin(0.5).setDepth(depthBase + 1);
    this.add.text(W / 2 + 80, y, '累计', {
      fontSize: '20px', color: '#aaaaaa', padding: { top: 3 },
    }).setOrigin(0.5).setDepth(depthBase + 1);
    y += 30;

    for (const [name, s] of Object.entries(stats)) {
      const lastRound = s.rounds.length > 0 ? s.rounds[s.rounds.length - 1] : 0;
      const color = s.total > 0 ? '#44ff44' : s.total < 0 ? '#ff4444' : '#ffffff';
      this.add.text(W / 2 - 120, y, name, {
        fontSize: '22px', color, padding: { top: 3 },
      }).setOrigin(0, 0.5).setDepth(depthBase + 1);
      this.add.text(W / 2 + 10, y, `${lastRound > 0 ? '+' : ''}${lastRound}`, {
        fontSize: '22px', color: lastRound > 0 ? '#44ff44' : '#ff4444', padding: { top: 3 },
      }).setOrigin(0.5).setDepth(depthBase + 1);
      this.add.text(W / 2 + 80, y, `${s.total > 0 ? '+' : ''}${s.total}`, {
        fontSize: '22px', color, padding: { top: 3 },
      }).setOrigin(0.5).setDepth(depthBase + 1);
      y += 30;
    }

    return y; // 返回结束Y，供后续布局使用
  }

  // ========== 结算页（带图案牌墙） ==========

  _handleGameOver(data) {
    // 清理马牌
    if (this.horseTiles) {
      this.horseTiles.forEach(t => t.destroy());
      this.horseTiles = [];
    }

    const W = this.cameras.main.width;
    const H = this.cameras.main.height;
    const depthBase = 50;

    // 半透明背景遮罩
    this.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0.75).setDepth(depthBase);

    // 结算面板装饰背景（动态高度，容纳马牌信息）
    const hasHorseResults = data.horseResults && data.horseResults.some(h => h && h.results && h.results.length > 0);
    const panelH = hasHorseResults ? 200 : 165;
    const panelGfx = this.add.graphics().setDepth(depthBase);
    panelGfx.fillStyle(0x1a3a2e, 0.85);
    panelGfx.fillRoundedRect(W / 2 - 280, 22, 560, panelH, 8);
    panelGfx.lineStyle(2, 0x4a8a5e, 0.6);
    panelGfx.strokeRoundedRect(W / 2 - 280, 22, 560, panelH, 8);

    // ====== 标题：胡牌信息 ======
    let msg = '';
    if (data.result && data.result.type === 'flow') {
      msg = '💨 流局';
    } else if (data.result) {
      const winType = data.result.isRobbingKong ? '⚡抢杠' : (data.result.isSelfDraw ? '自摸' : '点炮');
      msg = `🏆 ${this.players[data.result.winner]?.name || '?'} ${winType}胡牌！`;
    }
    this.add.text(W / 2, 95, msg, {
      fontSize: '24px', color: '#ffd700', fontStyle: 'bold',
      padding: { top: 4, bottom: 2 },
    }).setOrigin(0.5).setDepth(depthBase + 1);

    // ====== 番型+赔付 ======
    if (data.result && data.result.fan) {
      const patternsStr = data.result.patterns && data.result.patterns.length > 0
        ? data.result.patterns.map(p => p.name || p).join(' + ')
        : '';
      const robSuffix = data.result.isRobbingKong ? ' ×3(抢杠)' : '';
      const fanLine = patternsStr
        ? `${data.result.fan}番${robSuffix}: ${patternsStr}`
        : `${data.result.fan}番${robSuffix}`;
      this.add.text(W / 2, 120, fanLine, {
        fontSize: '15px', color: '#ffaa00',
        padding: { top: 3, bottom: 1 },
      }).setOrigin(0.5).setDepth(depthBase + 1);

      // 赔付详情
      if (data.result.payments) {
        // 抢杠胡只显示有赔付的（被抢杠者）
        const entries = Object.entries(data.result.payments)
          .filter(([s, p]) => !data.result.isRobbingKong || p.pay > 0);
        const payLine = entries
          .map(([s, p]) => `${p.playerName}: -${p.pay}番`)
          .join('  ');
        this.add.text(W / 2, 140, `💰 ${payLine}`, {
          fontSize: '14px', color: '#ffdd88',
          padding: { top: 3, bottom: 1 },
        }).setOrigin(0.5).setDepth(depthBase + 1);
      }
    }

    // ====== 每人独立马牌结算明细（横排） ======
    let horseY = 160;
    const colX = [W / 2 - 200, W / 2 - 65, W / 2 + 65, W / 2 + 200];
    if (data.horseResults) {
      const withHorses = data.horseResults.filter(hr => hr && hr.results && hr.results.length > 0);
      if (withHorses.length > 0) {
        // 每家标题行（同一横排）
        withHorses.forEach((hr, idx) => {
          const x = colX[idx] || (W / 2);
          const seatName = SEAT_NAMES[hr.seatIndex];
          this.add.text(x, horseY, `🐴${seatName}(${hr.playerName})${hr.count}匹`, {
            fontSize: '12px', color: '#ffaa00', fontStyle: 'bold',
            padding: { top: 1, bottom: 0 },
          }).setOrigin(0.5).setDepth(depthBase + 1);
        });
        horseY += 16;

        // 每张马牌明细行
        const maxResults = Math.max(...withHorses.map(h => h.results.length));
        for (let rIdx = 0; rIdx < maxResults; rIdx++) {
          withHorses.forEach((hr, idx) => {
            const x = colX[idx] || (W / 2);
            const r = hr.results[rIdx];
            if (!r) return;
            const hitStr = r.isHit ? '✓' : '✗';
            const adjStr = `${r.adjustment > 0 ? '+' : ''}${r.adjustment}`;
            const color = r.isHit ? '#44ff44' : '#ff6666';
            this.add.text(x, horseY, `${r.tileName}→${SEAT_NAMES[r.ownerSeat]}${hitStr}(${adjStr})`, {
              fontSize: '11px', color, padding: { top: 0, bottom: 0 },
            }).setOrigin(0.5).setDepth(depthBase + 1);
          });
          horseY += 14;
        }

        // 小计行
        withHorses.forEach((hr, idx) => {
          const x = colX[idx] || (W / 2);
          const subColor = hr.pickerAdjustment > 0 ? '#44ff44' : hr.pickerAdjustment < 0 ? '#ff6666' : '#aaaaaa';
          const subStr = `${hr.pickerAdjustment > 0 ? '+' : ''}${hr.pickerAdjustment}`;
          this.add.text(x, horseY, `🐴${subStr}`, {
            fontSize: '12px', color: subColor, fontStyle: 'bold',
            padding: { top: 1, bottom: 0 },
          }).setOrigin(0.5).setDepth(depthBase + 1);
        });
        horseY += 18;
      }
    }

    // ====== 累计统计表 ======
    const statsStartY = Math.max(horseY + 10, 200);

    // 视觉分隔线
    const sepGfx = this.add.graphics().setDepth(depthBase);
    sepGfx.lineStyle(1, 0x4a8a5e, 0.5);
    sepGfx.lineBetween(W / 2 - 120, statsStartY - 2, W / 2 + 120, statsStartY - 2);
    const statsEndY = this._renderSettlementStats(depthBase, statsStartY);

    // ====== 四家牌墙（带图案UI） ======
    const tileW = 28, tileH = 38, gap = 1;
    const wallStartY = Math.max(statsEndY + 10 || 135, 135);

    if (data.players) {
      data.players.forEach((p, i) => {
        const rel = (i - this.mySeat + 4) % 4;
        const sortedHand = [...p.hand].sort((a, b) => a - b);
        const count = sortedHand.length;

        let baseX, baseY, dirX, dirY;
        const labelColor = i === data.result?.winner ? '#ffd700' : '#cccccc';

        if (rel === 0) {
          // 自己（下方）— 水平排列
          const totalW = count * (tileW + gap);
          baseX = W / 2 - totalW / 2;
          baseY = H - 75;
          dirX = 1; dirY = 0;
        } else if (rel === 2) {
          // 对家（最上方）下移半个牌位
          const totalW = count * (tileW + gap);
          baseX = W / 2 - totalW / 2;
          baseY = 37;
          dirX = 1; dirY = 0;
        } else if (rel === 1) {
          // 下家（右侧）— 垂直排列，向中心移2牌位
          const totalH = count * (tileH + gap);
          baseX = W - 106;
          baseY = H / 2 - totalH / 2 + 20;
          dirX = 0; dirY = 1;
        } else {
          // 上家（左侧）— 垂直排列，向中心移2牌位
          const totalH = count * (tileH + gap);
          baseX = 106;
          baseY = H / 2 - totalH / 2 + 20;
          dirX = 0; dirY = 1;
        }

        // 手牌中心坐标
        const handCX = baseX + (dirX !== 0 ? (count - 1) * (tileW + gap) / 2 : 0);
        const handCY = baseY + (dirY !== 0 ? (count - 1) * (tileH + gap) / 2 : 0);
        const handHW = tileW / 2, handHH = tileH / 2;
        let labelX, labelY, labelOriginX;

        if (rel === 0) {
          // 自己：手牌上方，再上移1牌位
          labelX = handCX; labelY = baseY - handHH - 8 - tileH;
          labelOriginX = 0.5;
        } else if (rel === 2) {
          // 对家：手牌下方，再上移1牌位
          labelX = handCX; labelY = baseY + 8;
          labelOriginX = 0.5;
        } else if (rel === 1) {
          // 右边家：手牌左边，再左移1牌位
          labelX = baseX - 6 - tileW; labelY = handCY;
          labelOriginX = 1;
        } else {
          // 左边家：手牌右边居中
          labelX = baseX + tileW + 6; labelY = handCY;
          labelOriginX = 0;
        }

        // 昵称
        this.add.text(labelX, labelY, `${p.name}`, {
          fontSize: '13px', color: labelColor,
        }).setOrigin(labelOriginX, 0.5).setDepth(depthBase + 1);

        // 累计输赢
        if (this.game.cumulativeStats && this.game.cumulativeStats[p.name]) {
          const total = this.game.cumulativeStats[p.name].total;
          const totalColor = total > 0 ? '#44ff44' : total < 0 ? '#ff4444' : '#aaaaaa';
          const totalStr = `${total > 0 ? '+' : ''}${total}番`;
          const statsY = (rel === 0 || rel === 2) ? labelY + 14 : labelY + 16;
          this.add.text(labelX, statsY, totalStr, {
            fontSize: '12px', color: totalColor, fontStyle: 'bold',
          }).setOrigin(labelOriginX, 0.5).setDepth(depthBase + 1);
        }

        // 渲染每张牌
        sortedHand.forEach((tile, idx) => {
          const x = baseX + (dirX !== 0 ? idx * (tileW + gap) : 0);
          const y = baseY + (dirY !== 0 ? idx * (tileH + gap) : 0);
          const el = TileRenderer.createTile(this, tile, x, y, tileW, tileH, false);
          el.setDepth(depthBase + 2);
        });

        // 副露（碰/杠）横向对齐排列，与牌墙间隔半个牌位
        if (p.melds && p.melds.length > 0) {
          const halfGap = Math.floor(tileW / 2);
          const mStep = tileW + gap;
          let meldOffset = count * mStep + halfGap;
          p.melds.forEach((meld) => {
            const tiles = meld.tiles || [];
            tiles.forEach((mt, mi) => {
              // 所有碰杠牌横向排列（向右延伸），无论牌墙方向
              const mx = baseX + meldOffset + mi * mStep;
              const my = baseY;
              const showFace = !(meld.type === 'concealed_kong');
              const meldEl = TileRenderer.createTile(this, showFace ? mt : 0, mx, my, tileW, tileH, !showFace);
              meldEl.setDepth(depthBase + 2);
            });
            meldOffset += tiles.length * mStep + 4; // 每组副露之间留间距
          });
        }
      });
    }

    // ====== 按钮：开始下一局 + 返回大厅 ======
    const btnY = H - 20;

    // "开始下一局"按钮（房主有效）
    this._makeRoundedBtn(W / 2 - 80, btnY, 130, 32, 0x4a7a5e,
      '开始下一局', '15px', '#ffffff', () => {
        this.socket.emit('host_next_round', { buyHorses: true });
      }, depthBase + 3);

    // "返回大厅"按钮
    this._makeRoundedBtn(W / 2 + 80, btnY, 130, 32, 0x666666,
      '返回大厅', '15px', '#cccccc', () => { this.scene.start('LobbyScene'); }, depthBase + 3);
  }
}
