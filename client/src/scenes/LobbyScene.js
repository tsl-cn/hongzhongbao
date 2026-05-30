/**
 * LobbyScene.js — 大厅场景
 *
 * 功能：输入昵称（HTML input）、创建房间、加入房间、开始游戏
 */

import Phaser from 'phaser';

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
    this.roomPlayersText = null;
    this.readyBtn = null;
    this.startBtn = null;

    // 清理旧的 HTML 输入框
    ['nickname-input', 'password-input'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.remove();
    });
  }

  create() {
    const W = this.cameras.main.width;
    const H = this.cameras.main.height;

    this.add.rectangle(W / 2, H / 2, W, H, 0x1a3a2e);

    this.add.text(W / 2, 50, '🀄 红中宝自摸麻将', {
      fontSize: '40px', color: '#ffd700', fontStyle: 'bold', padding: { top: 4, bottom: 2 },
    }).setOrigin(0.5);

    this.statusText = this.add.text(W / 2, 80, '正在连接服务器...', {
      fontSize: '15px', color: '#888888', padding: { top: 2, bottom: 1 },
    }).setOrigin(0.5);

    // === 昵称输入（HTML input 覆盖在 canvas 上） ===
    this.add.text(W / 2 - 180, 150, '昵称:', {
      fontSize: '20px', color: '#ffffff', padding: { top: 3, bottom: 2 },
    });

    this._createNameInput();
    this._createPasswordInput();

    // === 按钮 ===
    this.createBtn = this._makeButton(W / 2 - 120, 280, '创建房间', () => this._createRoom());
    this.refreshBtn = this._makeButton(W / 2 + 120, 280, '刷新列表', () => this._refreshList());

    this.add.text(W / 2, 335, '— 房间列表 —', {
      fontSize: '18px', color: '#cccccc', padding: { top: 2, bottom: 1 },
    }).setOrigin(0.5);

    this.roomListContainer = this.add.container(0, 0);

    this._registerSocketEvents();
    this._connect();
  }

  /** 创建 HTML 昵称输入框 */
  _createNameInput() {
    const W = this.cameras.main.width;
    const inputEl = document.createElement('input');
    inputEl.id = 'nickname-input';
    inputEl.type = 'text';
    inputEl.placeholder = '输入昵称';
    inputEl.value = '';
    inputEl.style.cssText = `
      position: fixed;
      left: calc(50% - 80px);
      top: 163px;
      width: 200px;
      padding: 8px 12px;
      font-size: 17px;
      background: #333;
      color: #ffd700;
      border: 1px solid #4a7a5e;
      border-radius: 4px;
      outline: none;
      z-index: 100;
    `;
    document.body.appendChild(inputEl);
    this.nameInputEl = inputEl;
  }

  _connect() {
    this.socket.connect().then(() => {
      this.statusText.setText('已连接 ✓');
      this.statusText.setColor('#00ff00');
      this.socket.getRoomList();
    }).catch(() => {
      this.statusText.setText('连接失败 ✗');
      this.statusText.setColor('#ff0000');
    });
  }

  _getPlayerName() {
    return (this.nameInputEl ? this.nameInputEl.value : '').trim()
      || `玩家${Math.floor(Math.random() * 1000)}`;
  }

  /** 创建密码输入框 */
  _createPasswordInput() {
    const el = document.getElementById('password-input');
    if (el) el.remove();
    const inputEl = document.createElement('input');
    inputEl.id = 'password-input';
    inputEl.type = 'text';
    inputEl.placeholder = '房间密码（可选）';
    inputEl.value = '';
    inputEl.style.cssText = `
      position: fixed;
      left: calc(50% - 80px);
      top: 203px;
      width: 200px;
      padding: 6px 10px;
      font-size: 15px;
      background: #333;
      color: #ffd700;
      border: 1px solid #4a7a5e;
      border-radius: 4px;
      outline: none;
      z-index: 100;
    `;
    document.body.appendChild(inputEl);
    this.passInputEl = inputEl;
    return inputEl;
  }

  _createRoom() {
    const pass = this.passInputEl ? this.passInputEl.value.trim() : '';
    this.socket.createRoom(this._getPlayerName(), pass);
  }

  _refreshList() {
    this.socket.getRoomList();
  }

  _joinRoom(roomId) {
    const room = this.rooms.find(r => r.id === roomId);
    if (room && room.hasPassword) {
      const pass = prompt('请输入房间密码:');
      if (pass === null) return; // 取消
      this.socket.joinRoom(roomId, this._getPlayerName(), pass);
    } else {
      this.socket.joinRoom(roomId, this._getPlayerName());
    }
  }

  /** 显示房间内界面 */
  _showInRoom(roomData) {
    this.inRoom = true;
    this.roomId = roomData.id;
    this.isHost = (roomData.hostId === this.socket.playerId);
    this.isReady = false;
    this.roomListContainer.removeAll(true);

    // 隐藏密码输入框
    const passEl = document.getElementById('password-input');
    if (passEl) passEl.remove();

    const W = this.cameras.main.width;

    const lockStr = roomData.hasPassword ? ' 🔒' : '';
    this.roomListContainer.add(
      this.add.text(W / 2, 335, `房间: ${roomData.id}${lockStr}`, {
        fontSize: '22px', color: '#ffd700', fontStyle: 'bold', padding: { top: 2, bottom: 1 },
      }).setOrigin(0.5)
    );

    this._renderRoomPlayers(roomData);

    // 准备按钮（非主机）
    if (this.readyBtn) { this.readyBtn.destroy(); this.readyBtn = null; }
    this.readyBtn = this._makeButton(W / 2, 490, '准备', () => {
      this.socket.setReady();
      this.isReady = true;
    });
    this.roomListContainer.add(this.readyBtn);

    // 房主 → 开始游戏
    if (this.isHost) {
      if (this.startBtn) { this.startBtn.destroy(); this.startBtn = null; }
      const allReady = (roomData.players || []).every(p => p.isReady);
      this.startBtn = this._makeButton(W / 2, 535, '开始游戏', () => {
        this.socket.emit('host_start_game');
        if (this.startBtn) this.startBtn.setAlpha(0.5);
      });
      if (!allReady) this.startBtn.setAlpha(0.5);
      this.roomListContainer.add(this.startBtn);
    }

    // 离开按钮
    const leaveY = this.isHost ? 580 : 535;
    this.roomListContainer.add(
      this._makeButton(W / 2, leaveY, '离开房间', () => {
        this.socket.leaveRoom();
        this.inRoom = false;
        this.isReady = false;
        this.roomListContainer.removeAll(true);
        if (this.nameInputEl) this.nameInputEl.style.display = 'block';
        this._createPasswordInput();
        this._refreshList();
      })
    );
  }

  /** 渲染房间内玩家列表 */
  _renderRoomPlayers(roomData) {
    const players = roomData.players || [];
    const seatNames = ['东', '南', '西', '北'];
    const playerTexts = players.map((p) => {
      return `${seatNames[p.seatIndex]}: ${p.name}${p.isAI ? ' (AI)' : ''}${p.isReady ? ' ✓' : ' ...'}`;
    }).join('\n');

    if (this.roomPlayersText) this.roomPlayersText.destroy();
    this.roomPlayersText = this.add.text(
      this.cameras.main.width / 2, 375, playerTexts, {
        fontSize: '17px', color: '#ffffff', lineSpacing: 9, padding: { top: 2, bottom: 1 },
      }).setOrigin(0.5);
    this.roomListContainer.add(this.roomPlayersText);
  }

  _updateRoomPlayers(roomData) {
    if (roomData && this.inRoom) {
      this._renderRoomPlayers(roomData);
    } else {
      this.socket.getRoomList();
    }
  }

  _renderRoomList() {
    this.roomListContainer.removeAll(true);
    if (this.inRoom) return;

    const W = this.cameras.main.width;
    const startY = 350;

    if (this.rooms.length === 0) {
      const emptyText = this.add.text(W / 2, startY, '暂无房间，创建一个吧', {
        fontSize: '17px', color: '#888888', padding: { top: 2, bottom: 1 },
      }).setOrigin(0.5);
      this.roomListContainer.add(emptyText);
      return;
    }

    this.rooms.forEach((room, i) => {
      const y = startY + i * 45;
      const bg = this.add.rectangle(W / 2, y, 500, 38, 0x2a5a3e).setInteractive();
      const lockIcon = room.hasPassword ? ' 🔒' : '';
      const text = this.add.text(W / 2, y, `${room.id}${lockIcon}  |  ${room.playerCount}/4人`, {
        fontSize: '17px', color: '#ffffff', padding: { top: 2, bottom: 1 },
      }).setOrigin(0.5);

      bg.on('pointerdown', () => this._joinRoom(room.id));
      bg.on('pointerover', () => bg.setFillStyle(0x3a7a5e));
      bg.on('pointerout', () => bg.setFillStyle(0x2a5a3e));

      this.roomListContainer.add(bg);
      this.roomListContainer.add(text);
    });
  }

  _registerSocketEvents() {
    this.socket.on('room_created', (data) => this._showInRoom(data));
    this.socket.on('room_joined', (data) => this._showInRoom(data));
    this.socket.on('player_joined', (roomData) => this._updateRoomPlayers(roomData));
    this.socket.on('player_left', (roomData) => this._updateRoomPlayers(roomData));

    this.socket.on('room_list', (data) => {
      this.rooms = data.rooms || [];
      if (!this.inRoom) this._renderRoomList();
    });

    this.socket.on('player_ready_update', (roomData) => {
      if (this.inRoom) {
        this._renderRoomPlayers(roomData);
        // 更新开始按钮状态
        if (this.isHost && this.startBtn) {
          const allReady = (roomData.players || []).every(p => p.isReady);
          this.startBtn.setAlpha(allReady ? 1 : 0.5);
        }
        // 更新准备按钮状态
        const myPlayer = (roomData.players || []).find(p => p.id === this.socket.playerId);
        if (myPlayer && myPlayer.isReady && this.readyBtn) {
          this.readyBtn.setAlpha(0.5);
          this.isReady = true;
        }
      }
    });

    this.socket.on('game_start', (data) => {
      if (this.nameInputEl) this.nameInputEl.style.display = 'none';
      this.scene.start('GameScene', { gameData: data });
    });

    this.socket.on('error', (data) => {
      this.statusText.setText('错误: ' + data.message);
      this.statusText.setColor('#ff4444');
    });
  }

  _makeButton(x, y, label, callback) {
    const w = 160, h = 38, r = 8;
    const container = this.add.container(x, y);

    // 阴影
    const shadow = this.add.graphics();
    shadow.fillStyle(0x000000, 0.3);
    shadow.fillRoundedRect(-w / 2 + 2, -h / 2 + 2, w, h, r);
    container.add(shadow);

    // 按钮背景
    const bg = this.add.graphics();
    bg.fillStyle(0x4a7a5e, 1);
    bg.fillRoundedRect(-w / 2, -h / 2, w, h, r);
    bg.lineStyle(1, 0x6aaa7e, 1);
    bg.strokeRoundedRect(-w / 2, -h / 2, w, h, r);
    container.add(bg);

    // 点击区域
    const hitZone = this.add.rectangle(0, 0, w, h, 0x000000, 0)
      .setInteractive({ useHandCursor: true });
    container.add(hitZone);

    const text = this.add.text(0, 0, label, {
      fontSize: '16px', color: '#ffffff', fontStyle: 'bold', padding: { top: 3, bottom: 2 },
    }).setOrigin(0.5);
    container.add(text);

    hitZone.on('pointerdown', callback);
    hitZone.on('pointerover', () => {
      bg.clear();
      bg.fillStyle(0x6a9a7e, 1);
      bg.fillRoundedRect(-w / 2, -h / 2, w, h, r);
      bg.lineStyle(1, 0x8acc9e, 1);
      bg.strokeRoundedRect(-w / 2, -h / 2, w, h, r);
    });
    hitZone.on('pointerout', () => {
      bg.clear();
      bg.fillStyle(0x4a7a5e, 1);
      bg.fillRoundedRect(-w / 2, -h / 2, w, h, r);
      bg.lineStyle(1, 0x6aaa7e, 1);
      bg.strokeRoundedRect(-w / 2, -h / 2, w, h, r);
    });

    return container;
  }
}
