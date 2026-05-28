/**
 * TileRenderer.js — 牌面渲染器
 *
 * 用 Phaser 图形绘制麻将牌（占位用）
 * 如用户添加了图片素材，可切换为 sprite 渲染
 */

import Phaser from 'phaser';

// 牌面中文名
const TILE_NAMES = {
  0: '1万', 1: '2万', 2: '3万', 3: '4万', 4: '5万',
  5: '6万', 6: '7万', 7: '8万', 8: '9万',
  9: '1筒', 10: '2筒', 11: '3筒', 12: '4筒', 13: '5筒',
  14: '6筒', 15: '7筒', 16: '8筒', 17: '9筒',
  18: '1条', 19: '2条', 20: '3条', 21: '4条', 22: '5条',
  23: '6条', 24: '7条', 25: '8条', 26: '9条',
  27: '东', 28: '南', 29: '西', 30: '北',
  31: '中', 32: '发', 33: '白',
};

// 牌面颜色
const TILE_COLORS = {
  man: 0xffffff,       // 万 → 白底黑字
  pin: 0xffffff,       // 筒 → 白底黑字
  sou: 0xffffff,       // 条 → 白底黑字
  wind: 0xffffff,      // 风 → 白底黑字
  red: 0xffffff,       // 红中 → 白底红字
  green: 0xffffff,     // 发财 → 白底绿字
  white: 0xffffff,     // 白板 → 白底
};

class TileRenderer {
  /**
   * 在场景中创建一张牌的显示
   * @param {Phaser.Scene} scene
   * @param {number} tileType - 牌类型 0-33
   * @param {number} x - 位置
   * @param {number} y - 位置
   * @param {number} w - 宽度 (默认 40)
   * @param {number} h - 高度 (默认 56)
   * @param {boolean} faceDown - 是否盖牌
   * @returns {Phaser.GameObjects.Container}
   */
  static createTile(scene, tileType, x, y, w = 40, h = 56, faceDown = false) {
    const container = scene.add.container(x, y);

    if (faceDown) {
      // 牌背
      const bg = scene.add.rectangle(0, 0, w, h, 0x2a5a8a);
      bg.setStrokeStyle(2, 0x1a4a7a);
      container.add(bg);

      const pattern = scene.add.text(0, 0, '🀄', {
        fontSize: '20px',
      }).setOrigin(0.5);
      container.add(pattern);

      return container;
    }

    // 牌面
    const isWild = tileType === 31;
    const num = tileType <= 26 ? (tileType % 9) + 1 : 0;
    const suit = tileType <= 8 ? 'man' : tileType <= 17 ? 'pin' : tileType <= 26 ? 'sou' : 'honor';

    // 牌的背景
    const bg = scene.add.rectangle(0, 0, w, h, 0xffffff);
    bg.setStrokeStyle(2, isWild ? 0xff0000 : 0x333333);
    container.add(bg);

    // 牌面文字
    const name = TILE_NAMES[tileType] || '?';
    const textColor = isWild ? '#ff0000' : tileType === 32 ? '#00aa00' : '#000000';

    const text = scene.add.text(0, 0, name, {
      fontSize: w < 40 ? '12px' : '15px',
      color: textColor,
      fontFamily: 'Arial',
      fontStyle: 'bold',
    }).setOrigin(0.5);
    container.add(text);

    // 红中加特殊标记
    if (isWild) {
      const star = scene.add.text(0, -h / 2 + 10, '★', {
        fontSize: '10px', color: '#ff0000',
      }).setOrigin(0.5);
      container.add(star);
    }

    // 保存数据
    container.setData('tileType', tileType);
    container.setData('width', w);
    container.setData('height', h);

    return container;
  }

  /**
   * 创建一张高亮牌（可点击）
   */
  static createClickableTile(scene, tileType, x, y, w = 40, h = 56, onClick) {
    const container = TileRenderer.createTile(scene, tileType, x, y, w, h);

    // 添加点击区域
    const hitZone = scene.add.rectangle(0, 0, w, h, 0x000000, 0)
      .setInteractive({ useHandCursor: true });
    container.add(hitZone);

    hitZone.on('pointerdown', () => {
      if (onClick) onClick(tileType);
    });

    // 悬停效果
    hitZone.on('pointerover', () => {
      const bg = container.getAt(0);
      if (bg && bg.type === 'Rectangle') {
        bg.setFillStyle(0xffffcc);
      }
    });
    hitZone.on('pointerout', () => {
      const bg = container.getAt(0);
      if (bg && bg.type === 'Rectangle') {
        bg.setFillStyle(0xffffff);
      }
    });

    return container;
  }

  /**
   * 获得牌的中文名
   */
  static getTileName(tileType) {
    return TILE_NAMES[tileType] || '?';
  }
}

export default TileRenderer;
