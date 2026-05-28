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

    // ====== 加载麻将牌图片素材 ======
    // 万 1-9 (tileType 0-8)
    for (let i = 1; i <= 9; i++) {
      this.load.image(`tile_${i - 1}`, `assets/tiles/man/${i}.png`);
    }
    // 筒 1-9 (tileType 9-17)
    for (let i = 1; i <= 9; i++) {
      this.load.image(`tile_${i + 8}`, `assets/tiles/pin/${i}.png`);
    }
    // 条 1-9 (tileType 18-26)
    for (let i = 1; i <= 9; i++) {
      this.load.image(`tile_${i + 17}`, `assets/tiles/sou/${i}.png`);
    }
    // 风牌 (tileType 27-30)
    this.load.image('tile_27', 'assets/tiles/wind/east.png');
    this.load.image('tile_28', 'assets/tiles/wind/south.png');
    this.load.image('tile_29', 'assets/tiles/wind/west.png');
    this.load.image('tile_30', 'assets/tiles/wind/north.png');
    // 箭牌 (tileType 31-33)
    this.load.image('tile_31', 'assets/tiles/dragon/red.png');
    this.load.image('tile_32', 'assets/tiles/dragon/green.png');
    this.load.image('tile_33', 'assets/tiles/dragon/white.png');
    // 牌背
    this.load.image('tile_back', 'assets/tiles/back.png');
  }

  create() {
    // 短暂停留后跳转到大厅
    this.time.delayedCall(500, () => {
      this.scene.start('LobbyScene');
    });
  }
}
