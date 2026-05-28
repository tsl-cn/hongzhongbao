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

    // 如果有牌背图则加载，没有也不阻塞
    // 实际图片素材由用户放置
    // this.load.image('tile_back', 'assets/tiles/back.png');
  }

  create() {
    // 短暂停留后跳转到大厅
    this.time.delayedCall(500, () => {
      this.scene.start('LobbyScene');
    });
  }
}
