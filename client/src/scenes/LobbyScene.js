/**
 * LobbyScene.js — 大厅场景（重设计版）
 *
 * 两视图模式：
 *   大厅视图 → 昵称、房间列表、创建/刷新
 *   房间视图 → 四方位座次、准备/开始/离开
 *
 * 视觉风格：深绿桌面 + 金色点缀 + 暖木色座位卡
 * 输入方式：Phaser DOM element（画布内原生 input）
 */

import Phaser from 'phaser';
import { getTheme, color as tc, font as tf, onThemeChange, switchTheme } from '../game/ThemeManager.js';

// UI 尺寸常量
const W = 1066;
const H = 600;
const CX = W / 2;
const CY = H / 2;

const SEAT_NAMES = ['东', '南', '西', '北'];

export default class LobbyScene extends Phaser.Scene {
  constructor() {
    super({ key: 'LobbyScene' });
  }

  init() {
    this.socket = this.game.socketMgr;
    this.playerName = '';
    this.rooms = [];
    this.inRoom = false;
    this.isHost = false;
    this.isReady = false;
    this.roomId = null;

    // 解析 URL 参数（分享房间自动加入）
    const params = new URLSearchParams(window.location.search);
    this._autoJoinRoom = params.get('room') || null;
    this._autoJoinPass = params.get('password') || '';

    // DOM elements track
    this._domElements = [];
  }

  create() {
    this._drawBackground();
    this._createTitle();

    // 大厅视图容器
    this.lobbyContainer = this.add.container(0, 0);
    this._createLobbyView();

    // 房间视图容器（初始隐藏）
    this.roomContainer = this.add.container(0, 0).setVisible(false);

    // 遮罩层（弹窗用）
    this.overlayContainer = this.add.container(0, 0).setVisible(false).setDepth(50);

    this._registerSocketEvents();
    this._connect();
  }

  // ============================================================
  //  背景
  // ============================================================

  _drawBackground() {
    const cols = getTheme().colors;
    // 主背景
    this.add.rectangle(CX, CY, W, H, cols.background);

    // 装饰性淡色风字（四角对称）
    const decorStyle = { fontSize: '72px', color: '#' + cols.accent.toString(16).padStart(6, '0'), fontStyle: 'bold' };
    const decorAlpha = 0.15;
    const decors = [
      { text: '東', x: 50, y: 50 },
      { text: '南', x: W - 50, y: 50 },
      { text: '西', x: 50, y: H - 50 },
      { text: '北', x: W - 50, y: H - 50 },
      { text: '🀄', x: CX, y: CY },
    ];
    decors.forEach(d => {
      const t = this.add.text(d.x, d.y, d.text, decorStyle).setOrigin(0.5).setAlpha(decorAlpha);
      this.lobbyContainer ? null : null; // keep reference later
    });

    // 底部暗纹纹理线
    const gfx = this.add.graphics();
    gfx.lineStyle(1, cols.tableBg, 0.2);
    for (let i = 0; i < W; i += 40) {
      gfx.lineBetween(i, 0, i, H);
    }
  }

  // ============================================================
  //  标题
  // ============================================================

  _createTitle() {
    const f = getTheme().fonts;
    // 标题阴影
    this.add.text(CX + 2, 32, '🀄 红中宝自摸麻将', {
      fontSize: f.title.fontSize, color: '#00000044', fontStyle: 'bold',
      padding: { top: 4, bottom: 2 },
    }).setOrigin(0.5);
    // 标题
    this.add.text(CX, 30, '🀄 红中宝自摸麻将', {
      fontSize: f.title.fontSize, color: f.title.color, fontFamily: f.title.fontFamily, fontStyle: 'bold',
      padding: { top: 4, bottom: 2 },
    }).setOrigin(0.5);
    // 副标题
    this.add.text(CX, 70, '四人联网 · 三番起胡 · 买马', {
      fontSize: '14px', color: '#' + getTheme().colors.textDark.toString(16).padStart(6, '0'),
    }).setOrigin(0.5);
  }

  // ============================================================
  //  大厅视图
  // ============================================================

  _createLobbyView() {
    const cv = this.lobbyContainer;

    // ---- 昵称输入（Phaser DOM） ----
    cv.add(this.add.text(CX - 160, 115, '🧑 昵称:', {
      fontSize: '18px', color: '#' + getTheme().colors.text.toString(16).padStart(6, '0'),
      padding: { top: 3, bottom: 1 },
    }).setOrigin(0, 0.5));

    this._createNameInput();

    // ---- 状态文字 ----
    this.statusText = this.add.text(CX, 155, '正在连接服务器...', {
      fontSize: '13px', color: '#888888',
    }).setOrigin(0.5);
    cv.add(this.statusText);

    // ---- 主题切换 ----
    this._createThemeToggle();

    // ---- 按钮行 ----
    this._makeButton(CX - 100, 200, 180, 40, '创建房间', 0, () => this._showCreateDialog());
    this._makeButton(CX + 100, 200, 180, 40, '🔄 刷新列表', 0, () => this._refreshList());

    // ---- 房间列表标题 ----
    cv.add(this.add.text(CX, 245, '─ 等待中的房间 ─', {
      fontSize: '15px', color: '#aaaaaa',
    }).setOrigin(0.5));

    // ---- 房间列表容器 ----
    this.roomItemsContainer = this.add.container(0, 0);
    cv.add(this.roomItemsContainer);
  }

  _createThemeToggle() {
    const cols = getTheme().colors;
    const themes = [
      { id: 'classic', label: '🏮' },
      { id: 'modern', label: '🎯' },
      { id: 'gamey', label: '🎮' },
    ];
    const currentId = getTheme().id;
    const btnW = 34, btnH = 34, gap = 4;
    const startX = CX + 420;
    const y = 30;

    themes.forEach((t, i) => {
      const x = startX + i * (btnW + gap);
      const isActive = t.id === currentId;

      const bg = this.add.graphics();
      bg.fillStyle(isActive ? cols.primary : cols.buttonBg, 1);
      bg.fillRoundedRect(x - btnW / 2, y - btnH / 2, btnW, btnH, 6);
      if (isActive) {
        bg.lineStyle(2, cols.accentLight, 1);
        bg.strokeRoundedRect(x - btnW / 2, y - btnH / 2, btnW, btnH, 6);
      }
      this.lobbyContainer.add(bg);

      const hit = this.add.rectangle(x, y, btnW, btnH, 0x000000, 0)
        .setInteractive({ useHandCursor: true });
      hit.on('pointerdown', () => {
        switchTheme(t.id);
        this.scene.restart();
      });
      this.lobbyContainer.add(hit);

      const label = this.add.text(x, y, t.label, { fontSize: '16px' }).setOrigin(0.5);
      this.lobbyContainer.add(label);
    });
  }

  _createNameInput() {
    const cols = getTheme().colors;
    const inputEl = document.createElement('input');
    inputEl.type = 'text';
    inputEl.placeholder = '输入昵称';
    inputEl.value = '';
    const borderHex = '#' + cols.inputBorder.toString(16).padStart(6, '0');
    const bgHex = '#' + cols.inputBg.toString(16).padStart(6, '0');
    const textHex = '#' + cols.text.toString(16).padStart(6, '0');
    const accentHex = '#' + cols.accent.toString(16).padStart(6, '0');
    inputEl.style.cssText = `
      width: 200px; height: 34px;
      padding: 6px 14px;
      font-size: 17px;
      background: ${bgHex};
      color: ${accentHex};
      border: 1px solid ${borderHex};
      border-radius: 6px;
      outline: none;
      caret-color: ${accentHex};
      font-family: inherit;
    `;
    const domInput = this.add.dom(CX + 70, 115, inputEl);
    domInput.setOrigin(0.5, 0.5);
    this.nameInput = domInput;
    this.lobbyContainer.add(domInput);
  }

  _getPlayerName() {
    if (!this.nameInput) return `玩家${Math.floor(Math.random() * 1000)}`;
    const val = this.nameInput.node.value.trim();
    return val || `玩家${Math.floor(Math.random() * 1000)}`;
  }

  _connect() {
    this.socket.connect().then(() => {
      this.statusText.setText('✅ 已连接');
      this.statusText.setColor('#00ff00');

      // 自动加入分享的房间
      if (this._autoJoinRoom) {
        const name = `玩家${Math.floor(Math.random() * 10000)}`;
        this.socket.joinRoom(this._autoJoinRoom, name, this._autoJoinPass);
        // 清除 URL 参数，防止刷新后重复加入
        window.history.replaceState({}, '', window.location.pathname);
        return;
      }

      this.socket.getRoomList();
    }).catch(() => {
      this.statusText.setText('❌ 连接失败');
      this.statusText.setColor('#ff4444');
    });
  }

  _refreshList() {
    this.socket.getRoomList();
  }

  // ============================================================
  //  房间列表渲染（卡片样式）
  // ============================================================

  _renderRoomList() {
    this.roomItemsContainer.removeAll(true);
    if (this.inRoom) return;

    if (this.rooms.length === 0) {
      const emptyText = this.add.text(CX, 275, '暂无房间，点击「创建房间」开一局吧', {
        fontSize: '15px', color: '#888888',
      }).setOrigin(0.5);
      this.roomItemsContainer.add(emptyText);
      return;
    }

    this.rooms.forEach((room, i) => {
      const y = 270 + i * 48;
      this._createRoomCard(room, i, y);
    });
  }

  _createRoomCard(room, i, y) {
    const cardW = 520;
    const cardH = 40;

    // 卡片背景
    const bg = this.add.graphics();
    bg.fillStyle(0x2a5a3e, 1);
    bg.fillRoundedRect(CX - cardW / 2, y - cardH / 2, cardW, cardH, 8);
    bg.lineStyle(1, 0x4a7a5e, 1);
    bg.strokeRoundedRect(CX - cardW / 2, y - cardH / 2, cardW, cardH, 8);
    this.roomItemsContainer.add(bg);

    // 点击区
    const hit = this.add.rectangle(CX, y, cardW, cardH, 0x000000, 0)
      .setInteractive({ useHandCursor: true });
    this.roomItemsContainer.add(hit);

    // 房间号
    const roomText = this.add.text(CX - 230, y, room.id, {
      fontSize: '16px', color: '#ffffff', fontStyle: 'bold',
    }).setOrigin(0, 0.5);
    this.roomItemsContainer.add(roomText);

    // 占位圆点
    const dotGap = 24;
    const dotStartX = CX - 40;
    for (let s = 0; s < 4; s++) {
      const filled = s < room.playerCount;
      const dot = this.add.graphics();
      dot.fillStyle(filled ? 0x4aff4a : 0x555555, 1);
      dot.fillCircle(dotStartX + s * dotGap, y, 6);
      this.roomItemsContainer.add(dot);
    }

    // 人数文字
    const countText = this.add.text(dotStartX + 4 * dotGap + 10, y, `${room.playerCount}/4人`, {
      fontSize: '13px', color: '#aaaaaa',
    }).setOrigin(0, 0.5);
    this.roomItemsContainer.add(countText);

    // 密码锁
    if (room.hasPassword) {
      const lockIcon = this.add.text(CX + 240, y, '🔒', {
        fontSize: '16px',
      }).setOrigin(0.5);
      this.roomItemsContainer.add(lockIcon);
    }

    // 悬停效果
    const cardData = { bg, defaultColor: 0x2a5a3e };
    hit.on('pointerover', () => {
      bg.clear();
      bg.fillStyle(0x3a7a5e, 1);
      bg.fillRoundedRect(CX - cardW / 2, y - cardH / 2, cardW, cardH, 8);
      bg.lineStyle(1, 0x6aaa7e, 1);
      bg.strokeRoundedRect(CX - cardW / 2, y - cardH / 2, cardW, cardH, 8);
    });
    hit.on('pointerout', () => {
      bg.clear();
      bg.fillStyle(cardData.defaultColor, 1);
      bg.fillRoundedRect(CX - cardW / 2, y - cardH / 2, cardW, cardH, 8);
      bg.lineStyle(1, 0x4a7a5e, 1);
      bg.strokeRoundedRect(CX - cardW / 2, y - cardH / 2, cardW, cardH, 8);
    });
    hit.on('pointerdown', () => this._joinRoom(room.id));
  }

  // ============================================================
  //  创建房间弹窗
  // ============================================================

  _showCreateDialog() {
    this._showOverlay();
    const oc = this.overlayContainer;

    // 弹窗背景
    const pw = 360, ph = 220;
    const dialogBg = this.add.graphics();
    dialogBg.fillStyle(0x1a3a2e, 0.95);
    dialogBg.fillRoundedRect(CX - pw / 2, CY - ph / 2, pw, ph, 16);
    dialogBg.lineStyle(2, 0xffd700, 1);
    dialogBg.strokeRoundedRect(CX - pw / 2, CY - ph / 2, pw, ph, 16);
    oc.add(dialogBg);

    oc.add(this.add.text(CX, CY - 80, '创建房间', {
      fontSize: '22px', color: '#ffd700', fontStyle: 'bold',
    }).setOrigin(0.5));

    // 昵称
    oc.add(this.add.text(CX - 120, CY - 40, '昵称:', {
      fontSize: '16px', color: '#ffffff',
    }).setOrigin(0, 0.5));

    const nameEl = document.createElement('input');
    nameEl.type = 'text';
    nameEl.placeholder = '输入昵称';
    nameEl.value = this.nameInput ? this.nameInput.node.value : '';
    nameEl.style.cssText = `
      width: 200px; height: 32px;
      padding: 4px 12px; font-size: 16px;
      background: #2a4a3e; color: #ffd700;
      border: 1px solid #4a7a5e; border-radius: 6px;
      outline: none; caret-color: #ffd700;
    `;
    const nameDom = this.add.dom(CX + 30, CY - 40, nameEl).setOrigin(0.5, 0.5);
    oc.add(nameDom);

    // 密码
    oc.add(this.add.text(CX - 120, CY + 5, '密码:', {
      fontSize: '16px', color: '#888888',
    }).setOrigin(0, 0.5));
    oc.add(this.add.text(CX - 84, CY + 5, '(可选)', {
      fontSize: '12px', color: '#666666',
    }).setOrigin(0, 0.5));

    const passEl = document.createElement('input');
    passEl.type = 'text';
    passEl.placeholder = '留空则无密码';
    passEl.style.cssText = `
      width: 200px; height: 32px;
      padding: 4px 12px; font-size: 16px;
      background: #2a4a3e; color: #ffd700;
      border: 1px solid #4a7a5e; border-radius: 6px;
      outline: none; caret-color: #ffd700;
    `;
    const passDom = this.add.dom(CX + 30, CY + 5, passEl).setOrigin(0.5, 0.5);
    oc.add(passDom);

    // 按钮
    this._makeOverlayBtn(CX - 70, CY + 60, 110, 34, '取消', 0x555555, () => {
      this._hideOverlay();
    });
    this._makeOverlayBtn(CX + 70, CY + 60, 110, 34, '创建', 0x4a7a5e, () => {
      const name = nameEl.value.trim() || `玩家${Math.floor(Math.random() * 1000)}`;
      const pass = passEl.value.trim();
      if (this.nameInput) this.nameInput.node.value = name;
      this._passInputEl = passEl; // 保存引用供分享用
      this.socket.createRoom(name, pass);
      this._hideOverlay();
    });

    // 焦点到昵称框
    setTimeout(() => nameEl.focus(), 100);
  }

  // ============================================================
  //  密码输入弹窗（替代 prompt）
  // ============================================================

  _showPasswordDialog(roomId) {
    const room = this.rooms.find(r => r.id === roomId);
    if (!room) return;

    this._showOverlay();
    const oc = this.overlayContainer;

    const pw = 340, ph = 200;
    const dialogBg = this.add.graphics();
    dialogBg.fillStyle(0x1a3a2e, 0.95);
    dialogBg.fillRoundedRect(CX - pw / 2, CY - ph / 2, pw, ph, 16);
    dialogBg.lineStyle(2, 0xffd700, 1);
    dialogBg.strokeRoundedRect(CX - pw / 2, CY - ph / 2, pw, ph, 16);
    oc.add(dialogBg);

    oc.add(this.add.text(CX, CY - 75, '🔒 输入房间密码', {
      fontSize: '20px', color: '#ffd700', fontStyle: 'bold',
    }).setOrigin(0.5));

    oc.add(this.add.text(CX, CY - 45, `房间 ${roomId} 需要密码`, {
      fontSize: '14px', color: '#aaaaaa',
    }).setOrigin(0.5));

    const passEl = document.createElement('input');
    passEl.type = 'text';
    passEl.placeholder = '输入密码';
    passEl.style.cssText = `
      width: 220px; height: 34px;
      padding: 4px 14px; font-size: 16px;
      background: #2a4a3e; color: #ffd700;
      border: 1px solid #4a7a5e; border-radius: 6px;
      outline: none; caret-color: #ffd700;
    `;
    const passDom = this.add.dom(CX, CY + 5, passEl).setOrigin(0.5, 0.5);
    oc.add(passDom);

    this._makeOverlayBtn(CX - 70, CY + 60, 110, 34, '取消', 0x555555, () => {
      this._hideOverlay();
    });
    this._makeOverlayBtn(CX + 70, CY + 60, 110, 34, '确定', 0x4a7a5e, () => {
      const pass = passEl.value;
      this.socket.joinRoom(roomId, this._getPlayerName(), pass);
      this._hideOverlay();
    });

    setTimeout(() => passEl.focus(), 100);
  }

  // ============================================================
  //  Overlay 工具
  // ============================================================

  _showOverlay() {
    this.overlayContainer.removeAll(true);
    // 遮罩
    const mask = this.add.rectangle(CX, CY, W, H, 0x000000, 0.6)
      .setInteractive(); // 阻止点击穿透
    mask.on('pointerdown', () => {}); // 不关闭，防止误触
    this.overlayContainer.add(mask);
    this.overlayContainer.setVisible(true);
  }

  _hideOverlay() {
    this.overlayContainer.removeAll(true);
    this.overlayContainer.setVisible(false);
  }

  _makeOverlayBtn(x, y, w, h, label, color, callback) {
    const oc = this.overlayContainer;
    const r = 8;
    const bg = this.add.graphics();
    bg.fillStyle(color, 1);
    bg.fillRoundedRect(x - w / 2, y - h / 2, w, h, r);
    oc.add(bg);

    const hit = this.add.rectangle(x, y, w, h, 0x000000, 0)
      .setInteractive({ useHandCursor: true });
    hit.on('pointerdown', callback);
    oc.add(hit);

    const text = this.add.text(x, y, label, {
      fontSize: '15px', color: '#ffffff', fontStyle: 'bold',
    }).setOrigin(0.5);
    oc.add(text);
  }

  // ============================================================
  //  加入房间
  // ============================================================

  _joinRoom(roomId) {
    const room = this.rooms.find(r => r.id === roomId);
    if (!room) return;
    if (room.hasPassword) {
      this._showPasswordDialog(roomId);
    } else {
      this.socket.joinRoom(roomId, this._getPlayerName());
    }
  }

  // ============================================================
  //  房间内视图 — 四方位座次
  // ============================================================

  _showRoomView(roomData) {
    this.inRoom = true;
    this.roomId = roomData.id;
    this.isHost = (roomData.hostId === this.socket.playerId);
    this.isReady = false;

    // 隐藏大厅视图
    this.lobbyContainer.setVisible(false);
    // 显示房间视图
    this.roomContainer.removeAll(true);
    this.roomContainer.setVisible(true);

    const rc = this.roomContainer;

    // ---- 顶部栏 ----
    const lockStr = roomData.hasPassword ? ' 🔒' : '';
    rc.add(this.add.text(W - 60, 22, `房间: ${roomData.id}${lockStr}`, {
      fontSize: '20px', color: '#ffd700', fontStyle: 'bold',
      padding: { top: 4, bottom: 2 },
    }).setOrigin(1, 0.5));

    // ---- 离开按钮（左上） ----
    this._makeLargeBtn(60, 22, '← 离开', 0x664444, () => {
      this.socket.leaveRoom();
      this.inRoom = false;
      this.isReady = false;
      this.roomContainer.setVisible(false);
      this.lobbyContainer.setVisible(true);
      this._refreshList();
    });

    // ---- 中央桌面装饰 ----
    const tableGfx = this.add.graphics();
    tableGfx.fillStyle(0x0f2a1e, 1);
    tableGfx.fillEllipse(CX, CY - 10, 460, 200);
    tableGfx.lineStyle(2, 0x2a5a3e, 1);
    tableGfx.strokeEllipse(CX, CY - 10, 460, 200);
    rc.add(tableGfx);

    // 桌面文字
    rc.add(this.add.text(CX, CY - 10, '🀄', {
      fontSize: '48px', color: '#2a5a3e',
    }).setOrigin(0.5).setAlpha(0.5));

    // ---- 分享房间按钮（中字正下方） ----
    this._makeSmallBtn(CX, CY + 35, '📋 分享房间', 0x3a6a4e, async () => {
      await this._copyRoomInfo(roomData);
    });

    // ---- 四个座位卡 ----
    this._createSeatCards(roomData);

    // ---- 按钮区 ----
    this._createRoomButtons(roomData);
  }

  _createSeatCards(roomData) {
    const players = roomData.players || [];
    const rc = this.roomContainer;

    // 四个座位的坐标
    const seatPositions = [
      // 下（自己）
      { x: CX, y: 458, originX: 0.5, originY: 0.5 },
      // 上（对家）
      { x: CX, y: 72, originX: 0.5, originY: 0.5 },
      // 右
      { x: 990, y: 210, originX: 1, originY: 0.5 },
      // 左
      { x: 76, y: 210, originX: 0, originY: 0.5 },
    ];

    this.seatCards = [];

    for (let i = 0; i < 4; i++) {
      const p = players.find(pl => pl.seatIndex === i);
      const pos = seatPositions[i];
      const isMe = p && p.id === this.socket.playerId;
      const isHostPlayer = p && p.id === roomData.hostId;
      const card = this._createSeatCard(pos.x, pos.y, pos.originX, pos.originY, p, isMe, isHostPlayer, i);

      // 加入动画：从屏幕外滑入
      if (p) {
        const startX = [CX, CX, 1100, -34][i];
        const startY = [650, -30, 210, 210][i];
        card.setPosition(startX, startY);
        this.tweens.add({
          targets: card,
          x: pos.x,
          y: pos.y,
          duration: 400,
          ease: 'Back.easeOut',
          delay: i * 100,
        });
      }

      this.seatCards.push(card);
      rc.add(card);
    }
  }

  _createSeatCard(x, y, ox, oy, player, isMe, isHostPlayer, seatIndex) {
    const cardW = 170;
    const cardH = 80;
    const card = this.add.container(0, 0);

    if (!player) {
      // 空座位
      const bg = this.add.graphics();
      bg.fillStyle(0x2a3a2e, 0.6);
      bg.fillRoundedRect(-cardW / 2, -cardH / 2, cardW, cardH, 12);
      bg.lineStyle(1, 0x3a5a4e, 0.5);
      bg.strokeRoundedRect(-cardW / 2, -cardH / 2, cardW, cardH, 12);
      card.add(bg);
      card.add(this.add.text(0, 0, '等待加入...', {
        fontSize: '13px', color: '#666666',
      }).setOrigin(0.5));
      return card;
    }

    const isHostSeat = isHostPlayer;
    const borderColor = isHostSeat ? 0xffd700 : isMe ? 0x4aff4a : 0x4a7a5e;

    // 卡片背景
    const bg = this.add.graphics();
    bg.fillStyle(isMe ? 0x3a5a4e : 0x2a4a3e, 0.95);
    bg.fillRoundedRect(-cardW / 2, -cardH / 2, cardW, cardH, 12);
    bg.lineStyle(2, borderColor, 1);
    bg.strokeRoundedRect(-cardW / 2, -cardH / 2, cardW, cardH, 12);
    card.add(bg);

    // 头像圈（昵称首字）
    const avatarChar = player.isAI ? 'AI' : player.name.charAt(0);
    const avatarColor = isMe ? 0x4a7a5e : 0x3a5a4e;
    const avatarCircle = this.add.graphics();
    avatarCircle.fillStyle(avatarColor, 1);
    avatarCircle.fillCircle(-cardW / 2 + 28, 0, 20);
    card.add(avatarCircle);
    card.add(this.add.text(-cardW / 2 + 28, 0, avatarChar, {
      fontSize: '16px', color: '#ffffff', fontStyle: 'bold',
      padding: { top: 2, bottom: 1 },
    }).setOrigin(0.5));

    // 房主皇冠
    if (isHostSeat) {
      card.add(this.add.text(-cardW / 2 + 28, -28, '👑', {
        fontSize: '14px',
      }).setOrigin(0.5));
    }

    // 自己标记
    if (isMe) {
      card.add(this.add.text(-cardW / 2 + 6, cardH / 2 - 10, '[我]', {
        fontSize: '11px', color: '#4aff4a',
      }).setOrigin(0, 0.5));
    }

    // 昵称
    const nameStr = player.isAI ? `AI-${player.name}` : player.name;
    card.add(this.add.text(-cardW / 2 + 55, -10, nameStr, {
      fontSize: '15px', color: isHostSeat ? '#ffd700' : '#ffffff',
      fontStyle: isHostSeat ? 'bold' : 'normal',
      padding: { top: 2, bottom: 1 },
    }).setOrigin(0, 0.5));

    // 风位
    card.add(this.add.text(-cardW / 2 + 55, 12, SEAT_NAMES[seatIndex], {
      fontSize: '12px', color: '#aaaaaa',
    }).setOrigin(0, 0.5));

    // 准备状态
    const isPlayerReady = player.isReady || player.isAI; // AI 自动已准备
    const readyText = this.add.text(cardW / 2 - 12, 0,
      isPlayerReady ? '✅' : '○', {
      fontSize: '20px',
    }).setOrigin(1, 0.5);
    card.add(readyText);

    card.setData('readyText', readyText);
    card.setData('playerId', player.id);

    return card;
  }

  _createRoomButtons(roomData) {
    const rc = this.roomContainer;

    // 准备按钮
    this.readyBtn = this._makeSmallBtn(CX - 100, 580, '准备', 0x4a7a5e, () => {
      this.socket.setReady();
      this.isReady = true;
      if (this.readyBtn) this.readyBtn.setAlpha(0.5);
    });
    rc.add(this.readyBtn);

    // 取消准备（在准备后显示）
    this.unreadyBtn = this._makeSmallBtn(CX - 100, 580, '取消准备', 0x664444, () => {
      // 简化处理：点击准备后不能取消（保持原有逻辑）
    });
    this.unreadyBtn.setVisible(false);
    rc.add(this.unreadyBtn);

    // 开始游戏（仅房主）
    this.startBtn = this._makeSmallBtn(CX + 100, 580, '▶ 开始游戏', 0x4a7a5e, () => {
      this.socket.emit('host_start_game');
      if (this.startBtn) this.startBtn.setAlpha(0.5);
    });
    if (!this.isHost) this.startBtn.setVisible(false);
    rc.add(this.startBtn);
  }

  // ============================================================
  //  按钮工具
  // ============================================================

  _makeButton(x, y, w, h, label, color, callback) {
    const cols = getTheme().colors;
    const cv = this.lobbyContainer;
    const r = 8;
    const bg = this.add.graphics();
    bg.fillStyle(cols.buttonBg, 1);
    bg.fillRoundedRect(x - w / 2, y - h / 2, w, h, r);
    bg.lineStyle(2, cols.panelBorder, 1);
    bg.strokeRoundedRect(x - w / 2, y - h / 2, w, h, r);
    cv.add(bg);

    const hit = this.add.rectangle(x, y, w, h, 0x000000, 0)
      .setInteractive({ useHandCursor: true });
    hit.on('pointerdown', callback);
    hit.on('pointerover', () => {
      bg.clear();
      bg.fillStyle(cols.buttonHover, 1);
      bg.fillRoundedRect(x - w / 2, y - h / 2, w, h, r);
      bg.lineStyle(2, cols.accentLight, 1);
      bg.strokeRoundedRect(x - w / 2, y - h / 2, w, h, r);
    });
    hit.on('pointerout', () => {
      bg.clear();
      bg.fillStyle(cols.buttonBg, 1);
      bg.fillRoundedRect(x - w / 2, y - h / 2, w, h, r);
      bg.lineStyle(2, cols.panelBorder, 1);
      bg.strokeRoundedRect(x - w / 2, y - h / 2, w, h, r);
    });
    cv.add(hit);

    const text = this.add.text(x, y, label, {
      fontSize: '16px', color: '#' + cols.buttonText.toString(16).padStart(6, '0'), fontStyle: 'bold',
    }).setOrigin(0.5);
    cv.add(text);
  }

  _makeSmallBtn(x, y, label, color, callback) {
    const container = this.add.container(x, y);
    const w = 140;
    const h = 34;
    const r = 6;

    const bg = this.add.graphics();
    bg.fillStyle(color, 1);
    bg.fillRoundedRect(-w / 2, -h / 2, w, h, r);
    container.add(bg);

    const hit = this.add.rectangle(0, 0, w, h, 0x000000, 0)
      .setInteractive({ useHandCursor: true });
    hit.on('pointerdown', callback);
    container.add(hit);

    const text = this.add.text(0, 0, label, {
      fontSize: '14px', color: '#ffffff', fontStyle: 'bold',
    }).setOrigin(0.5);
    container.add(text);

    return container;
  }

  /** 大号按钮（2倍大小） */
  _makeLargeBtn(x, y, label, color, callback) {
    const cols = getTheme().colors;
    const container = this.add.container(x, y);
    const w = 200, h = 48, r = 10;

    const bg = this.add.graphics();
    bg.fillStyle(color || cols.buttonBg, 1);
    bg.fillRoundedRect(-w / 2, -h / 2, w, h, r);
    bg.lineStyle(2, cols.panelBorder, 1);
    bg.strokeRoundedRect(-w / 2, -h / 2, w, h, r);
    container.add(bg);

    const hit = this.add.rectangle(0, 0, w, h, 0x000000, 0)
      .setInteractive({ useHandCursor: true });
    hit.on('pointerdown', callback);
    container.add(hit);

    const text = this.add.text(0, 0, label, {
      fontSize: '20px', color: '#' + cols.buttonText.toString(16).padStart(6, '0'), fontStyle: 'bold',
      padding: { top: 3, bottom: 1 },
    }).setOrigin(0.5);
    container.add(text);

    return container;
  }

  // ============================================================
  //  获取本机局域网 IP（通过 WebRTC）
  // ============================================================

  /** 尝试获取本机局域网 IP，失败返回 null */
  _getLocalIP() {
    return new Promise((resolve) => {
      try {
        const pc = new RTCPeerConnection({ iceServers: [] });
        pc.createDataChannel('');
        pc.createOffer().then(offer => pc.setLocalDescription(offer));
        pc.onicecandidate = (e) => {
          if (!e.candidate) { resolve(null); return; }
          const match = e.candidate.candidate.match(/(\d+\.\d+\.\d+\.\d+)/);
          if (match && !match[1].startsWith('127.')) {
            pc.close();
            resolve(match[1]);
          }
        };
        setTimeout(() => { pc.close(); resolve(null); }, 2000);
      } catch { resolve(null); }
    });
  }

  // ============================================================
  //  分享房间信息到剪贴板
  // ============================================================

  async _copyRoomInfo(roomData) {
    const isPassword = roomData.hasPassword;

    // 查找真实密码（从创建时的输入或已存信息）
    let password = '';
    if (isPassword && this._passInputEl) {
      password = this._passInputEl.value;
    }

    // 房间密码由服务器管理，我们无法从 roomData 拿到原文
    // 用占位提示让房主手动填写
    const passStr = isPassword ? `密码: ${password || '(已设置密码，请手动填写)'}\n` : '';

    // 构造分享文本 — 动态获取本机局域网 IP
    const host = window.location.host;
    const roomLink = `http://${host}?room=${roomData.id}` + (password ? `&password=${encodeURIComponent(password)}` : '');

    // 尝试获取本机局域网 IP（手机同 Wi-Fi 可用）
    const localIP = await this._getLocalIP();
    const mobileHost = localIP ? `${localIP}:8080` : '〈你的局域网IP〉:8080';
    const mobileLink = `http://${mobileHost}?room=${roomData.id}` + (password ? `&password=${encodeURIComponent(password)}` : '');

    const shareText =
`🀄 红中宝自摸麻将 - 房间 ${roomData.id}
电脑: ${roomLink}
手机: ${mobileLink}
${passStr}点击链接自动加入房间，等待开局！`;

    // 复制到剪贴板
    const doCopy = (text) => {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(text);
      }
      // 降级方案
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      return Promise.resolve();
    };

    doCopy(shareText).then(() => {
      this._showToast('✅ 房间信息已复制，发送给好友吧！');
    }).catch(() => {
      this._showToast('❌ 复制失败，请手动复制房间号');
    });
  }

  /** 短暂显示提示文字（Toast） */
  _showToast(msg) {
    const toast = this.add.text(CX, 60, msg, {
      fontSize: '14px', color: '#00ff00', fontStyle: 'bold',
      padding: { top: 4, bottom: 2, left: 8, right: 8 },
      backgroundColor: '#000000aa',
    }).setOrigin(0.5).setDepth(60);

    this.tweens.add({
      targets: toast,
      alpha: 0,
      y: 40,
      duration: 2000,
      delay: 1500,
      ease: 'Power2',
      onComplete: () => toast.destroy(),
    });
  }

  // ============================================================
  //  更新房间内玩家状态
  // ============================================================

  _updateRoomPlayers(roomData) {
    if (!roomData || !this.inRoom) {
      this.socket.getRoomList();
      return;
    }
    // 重建座位卡
    this.roomContainer.removeAll(true);
    this._showRoomView(roomData);
  }

  // ============================================================
  //  Socket 事件
  // ============================================================

  _registerSocketEvents() {
    this.socket.on('room_created', (data) => this._showRoomView(data));
    this.socket.on('room_joined', (data) => this._showRoomView(data));
    this.socket.on('player_joined', (roomData) => this._updateRoomPlayers(roomData));
    this.socket.on('player_left', (roomData) => this._updateRoomPlayers(roomData));

    this.socket.on('room_list', (data) => {
      this.rooms = data.rooms || [];
      if (!this.inRoom) this._renderRoomList();
    });

    this.socket.on('player_ready_update', (roomData) => {
      if (this.inRoom) {
        this._updateRoomPlayers(roomData);
      }
    });

    this.socket.on('game_start', (data) => {
      this._startGameTransition(data);
    });

    this.socket.on('error', (data) => {
      if (this.statusText) {
        this.statusText.setText('❌ ' + data.message);
        this.statusText.setColor('#ff4444');
      }
    });
  }

  // ============================================================
  //  场景过渡动画
  // ============================================================

  _startGameTransition(data) {
    // 创建全屏遮罩 + 淡入黑色
    const fadeRect = this.add.rectangle(CX, CY, W, H, 0x000000, 0).setDepth(100);

    this.tweens.add({
      targets: fadeRect,
      alpha: 1,
      duration: 400,
      ease: 'Power2',
      onComplete: () => {
        // 清理 DOM 输入元素
        if (this.nameInput) {
          this.nameInput.destroy();
          this.nameInput = null;
        }
        this._hideOverlay();
        this.scene.start('GameScene', { gameData: data });
      },
    });
  }

  // ============================================================
  //  场景清理
  // ============================================================

  shutdown() {
    // 清理所有 DOM 元素
    if (this.nameInput) {
      this.nameInput.destroy();
      this.nameInput = null;
    }
  }
}
