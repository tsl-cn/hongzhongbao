/**
 * BootScene.js — 启动场景
 * 加载必要资源后跳转到大厅
 */

import Phaser from 'phaser';

export default class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BootScene' });
  }

  preload() {
    // 显示加载进度
    const width = this.cameras.main.width;
    const height = this.cameras.main.height;

    this.add.text(width / 2, height / 2 - 50, '红中宝', {
      fontSize: '48px',
      color: '#ffd700',
      fontFamily: 'Arial',
    }).setOrigin(0.5);

    const loadingText = this.add.text(width / 2, height / 2 + 20, '加载中...', {
      fontSize: '18px',
      color: '#ffffff',
    }).setOrigin(0.5);

    // 进度条
    const barBg = this.add.graphics();
    barBg.fillStyle(0x333333, 1);
    barBg.fillRect(width / 2 - 150, height / 2 + 50, 300, 20);

    const bar = this.add.graphics();
    this.load.on('progress', (value) => {
      bar.clear();
      bar.fillStyle(0xffd700, 1);
      bar.fillRect(width / 2 - 148, height / 2 + 52, 296 * value, 16);
    });

    this.load.on('complete', () => {
      loadingText.setText('加载完成');
    });

    // 加载34张牌面图片
    this._loadTileImages();
  }

  /** 加载所有牌面图片到 Phaser 缓存 */
  _loadTileImages() {
    // 万 (tile 0-8)
    for (let i = 0; i <= 8; i++) {
      this.load.image(`tile_${i}`, `assets/tiles/man/${i + 1}.png`);
    }
    // 筒 (tile 9-17)
    for (let i = 9; i <= 17; i++) {
      this.load.image(`tile_${i}`, `assets/tiles/pin/${i - 8}.png`);
    }
    // 条 (tile 18-26)
    for (let i = 18; i <= 26; i++) {
      this.load.image(`tile_${i}`, `assets/tiles/sou/${i - 17}.png`);
    }
    // 风 (tile 27-30)
    const windMap = { 27: 'east', 28: 'south', 29: 'west', 30: 'north' };
    for (let t = 27; t <= 30; t++) {
      this.load.image(`tile_${t}`, `assets/tiles/wind/${windMap[t]}.png`);
    }
    // 箭 (tile 31-33)
    const dragonMap = { 31: 'red', 32: 'green', 33: 'white' };
    for (let t = 31; t <= 33; t++) {
      this.load.image(`tile_${t}`, `assets/tiles/dragon/${dragonMap[t]}.png`);
    }
    // 牌背图（可选，没有也不阻塞）
    this.load.image('tile_back', 'assets/tiles/back.png');
  }

  create() {
    // 短暂停留后跳转到大厅
    this.time.delayedCall(500, () => {
      this.scene.start('LobbyScene');
    });
  }
}
