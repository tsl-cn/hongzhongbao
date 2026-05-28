/**
 * TileRenderer.js — 牌面渲染器
 *
 * 优先使用 assets/tiles/ 下的 .png 图片
 * 图片不存在时回退文字+色块渲染
 */

import Phaser from 'phaser';

// 牌面中文名（回退渲染用）
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

class TileRenderer {
  /**
   * 检查图片是否在 Phaser 缓存中
   */
  static _hasTexture(scene, key) {
    return scene.textures.exists(key);
  }

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
      // 优先使用牌背图
      if (TileRenderer._hasTexture(scene, 'tile_back')) {
        const img = scene.add.image(0, 0, 'tile_back');
        img.setDisplaySize(w, h);
        container.add(img);
      } else {
        // 回退：蓝色背景 + 🀄
        const bg = scene.add.rectangle(0, 0, w, h, 0x2a5a8a);
        bg.setStrokeStyle(2, 0x1a4a7a);
        container.add(bg);
        const pattern = scene.add.text(0, 0, '🀄', { fontSize: '20px' }).setOrigin(0.5);
        container.add(pattern);
      }
      return container;
    }

    // 牌面 — 优先使用图片
    const imgKey = `tile_${tileType}`;
    if (TileRenderer._hasTexture(scene, imgKey)) {
      const img = scene.add.image(0, 0, imgKey);
      img.setDisplaySize(w, h);
      container.add(img);
    } else {
      // 回退：文字+色块
      const isWild = tileType === 31;
      const bg = scene.add.rectangle(0, 0, w, h, 0xffffff);
      bg.setStrokeStyle(2, isWild ? 0xff0000 : 0x333333);
      container.add(bg);

      const name = TILE_NAMES[tileType] || '?';
      const textColor = isWild ? '#ff0000' : tileType === 32 ? '#00aa00' : '#000000';
      const text = scene.add.text(0, 0, name, {
        fontSize: w < 40 ? '12px' : '15px',
        color: textColor,
        fontFamily: 'Arial',
        fontStyle: 'bold',
      }).setOrigin(0.5);
      container.add(text);

      if (isWild) {
        const star = scene.add.text(0, -h / 2 + 10, '★', {
          fontSize: '10px', color: '#ff0000',
        }).setOrigin(0.5);
        container.add(star);
      }
    }

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

    // 半透明点击区域
    const hitZone = scene.add.rectangle(0, 0, w, h, 0x000000, 0)
      .setInteractive({ useHandCursor: true });
    container.add(hitZone);

    hitZone.on('pointerdown', () => {
      if (onClick) onClick(tileType);
    });

    // 悬停高亮：图片模式下加半透明黄色遮罩
    hitZone.on('pointerover', () => {
      const overlay = scene.add.rectangle(0, 0, w, h, 0xffff00, 0.15);
      overlay.setName('hover_overlay');
      container.add(overlay);
    });
    hitZone.on('pointerout', () => {
      const overlay = container.getByName('hover_overlay');
      if (overlay) overlay.destroy();
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
