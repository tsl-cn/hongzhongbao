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
    this.roomId = null;
    this.roomPlayersText = null;
    this.readyBtn = null;
    this.startBtn = null;

    // 清理旧的 HTML 输入框
    const oldInput = document.getElementById('nickname-input');
    if (oldInput) oldInput.remove();
  }

  create() {
    const W = this.cameras.main.width;
    const H = this.cameras.main.height;

    this.add.rectangle(W / 2, H / 2, W, H, 0x1a3a2e);

    this.add.text(W / 2, 50, '🀄 红中宝自摸麻将', {
      fontSize: '36px', color: '#ffd700',
    }).setOrigin(0.5);

    this.statusText = this.add.text(W / 2, 90, '正在连接服务器...', {
      fontSize: '14px', color: '#aaaaaa',
    }).setOrigin(0.5);

    // === 昵称输入（HTML input 覆盖在 canvas 上） ===
    this.add.text(W / 2 - 180, 130, '昵称:', {
      fontSize: '18px', color: '#ffffff',
    });

    this._createNameInput();

    // === 按钮 ===
    this.createBtn = this._makeButton(W / 2 - 120, 190, '创建房间', () => this._createRoom());
    this.refreshBtn = this._makeButton(W / 2 + 120, 190, '刷新列表', () => this._refreshList());

    this.add.text(W / 2, 240, '— 房间列表 —', {
      fontSize: '16px', color: '#cccccc',
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
      top: 148px;
      width: 200px;
      padding: 6px 10px;
      font-size: 16px;
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

  _createRoom() {
    this.socket.createRoom(this._getPlayerName());
  }

  _refreshList() {
    this.socket.getRoomList();
  }

  _joinRoom(roomId) {
    this.socket.joinRoom(roomId, this._getPlayerName());
  }

  /** 显示房间内界面 */
  _showInRoom(roomData) {
    this.inRoom = true;
    this.roomId = roomData.id;
    this.isHost = (roomData.hostId === this.socket.playerId);
    this.roomListContainer.removeAll(true);

    const W = this.cameras.main.width;

    this.roomListContainer.add(
      this.add.text(W / 2, 270, `房间: ${roomData.id}`, {
        fontSize: '20px', color: '#ffd700',
      }).setOrigin(0.5)
    );

    const players = roomData.players || [];
    const seatNames = ['东', '南', '西', '北'];
    const playerTexts = players.map((p, i) => {
      return `${seatNames[p.seatIndex]}: ${p.name}${p.isAI ? ' (AI)' : ''}${p.isReady ? ' ✓' : ' ...'}`;
    }).join('\n');

    if (this.roomPlayersText) this.roomPlayersText.destroy();
    this.roomPlayersText = this.add.text(W / 2, 310, playerTexts, {
      fontSize: '16px', color: '#ffffff', lineSpacing: 8,
    }).setOrigin(0.5);
    this.roomListContainer.add(this.roomPlayersText);

    // 准备按钮
    if (this.readyBtn) { this.readyBtn.destroy(); this.readyBtn = null; }
    this.readyBtn = this._makeButton(W / 2 - 80, 390, '准备', () => {
      this.socket.setReady();
      if (this.readyBtn) this.readyBtn.setAlpha(0.5);
    });
    this.roomListContainer.add(this.readyBtn);

    // 房主 → 显示"开始游戏"按钮
    if (this.isHost) {
      if (this.startBtn) { this.startBtn.destroy(); this.startBtn = null; }
      this.startBtn = this._makeButton(W / 2 + 80, 390, '开始游戏', () => {
        this.socket.emit('host_start_game');
        if (this.startBtn) this.startBtn.setAlpha(0.5);
      });
      this.roomListContainer.add(this.startBtn);
    }

    // 离开按钮
    this.roomListContainer.add(
      this._makeButton(W / 2, 440, '离开房间', () => {
        this.socket.leaveRoom();
        this.inRoom = false;
        this.roomListContainer.removeAll(true);
        if (this.nameInputEl) this.nameInputEl.style.display = 'block';
        this._refreshList();
      })
    );
  }

  _updateRoomPlayers() {
    this.socket.getRoomList();
  }

  _renderRoomList() {
    this.roomListContainer.removeAll(true);
    if (this.inRoom) return;

    const W = this.cameras.main.width;
    const startY = 280;

    if (this.rooms.length === 0) {
      const emptyText = this.add.text(W / 2, startY, '暂无房间，创建一个吧', {
        fontSize: '16px', color: '#888888',
      }).setOrigin(0.5);
      this.roomListContainer.add(emptyText);
      return;
    }

    this.rooms.forEach((room, i) => {
      const y = startY + i * 45;
      const bg = this.add.rectangle(W / 2, y, 500, 38, 0x2a5a3e).setInteractive();
      const text = this.add.text(W / 2, y, `${room.id}  |  ${room.playerCount}/4人`, {
        fontSize: '16px', color: '#ffffff',
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
    this.socket.on('player_joined', () => this._updateRoomPlayers());
    this.socket.on('player_left', () => this._updateRoomPlayers());

    this.socket.on('room_list', (data) => {
      this.rooms = data.rooms || [];
      if (!this.inRoom) this._renderRoomList();
    });

    this.socket.on('all_ready', () => {
      this.statusText.setText('等待其他玩家准备...');
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
    const bg = this.add.rectangle(x, y, 150, 36, 0x4a7a5e).setInteractive({ useHandCursor: true });
    const text = this.add.text(x, y, label, {
      fontSize: '15px', color: '#ffffff',
    }).setOrigin(0.5);

    bg.on('pointerdown', callback);
    bg.on('pointerover', () => bg.setFillStyle(0x6a9a7e));
    bg.on('pointerout', () => bg.setFillStyle(0x4a7a5e));

    const container = this.add.container(0, 0);
    container.add(bg);
    container.add(text);
    return container;
  }
}
