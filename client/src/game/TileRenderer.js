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
   * 纹理是否已加载（图片是否存在）
   */
  static _hasTexture(scene, key) {
    return scene.textures.exists(key) && scene.textures.get(key).key !== '__DEFAULT';
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
      // 牌背：优先使用精灵图片
      const hasBackTexture = TileRenderer._hasTexture(scene, 'tile_back');
      if (hasBackTexture) {
        const sprite = scene.add.image(0, 0, 'tile_back');
        sprite.setDisplaySize(w, h);
        sprite.setOrigin(0.5);
        container.add(sprite);
      } else {
        // 回退：文字+色块牌背
        const bg = scene.add.rectangle(0, 0, w, h, 0x2a5a8a);
        bg.setStrokeStyle(2, 0x1a4a7a);
        container.add(bg);
        const pattern = scene.add.text(0, 0, '🀄', {
          fontSize: '20px',
        }).setOrigin(0.5);
        container.add(pattern);
      }
      return container;
    }

    // 牌面：优先使用精灵图片
    const texKey = `tile_${tileType}`;
    const hasTexture = TileRenderer._hasTexture(scene, texKey);

    if (hasTexture) {
      const sprite = scene.add.image(0, 0, texKey);
      sprite.setDisplaySize(w, h);
      sprite.setOrigin(0.5);
      container.add(sprite);
      // 红中加边框标记
      if (tileType === 31) {
        const border = scene.add.rectangle(0, 0, w - 2, h - 2);
        border.setStrokeStyle(2, 0xff0000);
        border.setFillStyle(0x000000, 0);
        container.add(border);
      }
    } else {
      // 回退：文字渲染
      const bg = scene.add.rectangle(0, 0, w, h, 0xffffff);
      bg.setStrokeStyle(2, tileType === 31 ? 0xff0000 : 0x333333);
      container.add(bg);

      const name = TILE_NAMES[tileType] || '?';
      const textColor = tileType === 31 ? '#ff0000' : tileType === 32 ? '#00aa00' : '#000000';
      const text = scene.add.text(0, 0, name, {
        fontSize: w < 40 ? '12px' : '15px',
        color: textColor,
        fontFamily: 'Arial',
        fontStyle: 'bold',
      }).setOrigin(0.5);
      container.add(text);

      if (tileType === 31) {
        const star = scene.add.text(0, -h / 2 + 10, '★', {
          fontSize: '10px', color: '#ff0000',
        }).setOrigin(0.5);
        container.add(star);
      }
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

    // 悬停高亮效果
    hitZone.on('pointerover', () => {
      // 如果第一个元素是 sprite，加半透明覆盖层
      const first = container.getAt(0);
      if (first && first.type === 'Image') {
        const overlay = scene.add.rectangle(0, 0, w, h, 0xffffaa, 0.3);
        overlay.setName('hover_overlay');
        container.add(overlay);
      } else if (first && first.type === 'Rectangle') {
        first.setFillStyle(0xffffcc);
      }
    });
    hitZone.on('pointerout', () => {
      // 移除覆盖层
      const overlay = container.getByName('hover_overlay');
      if (overlay) overlay.destroy();
      const first = container.getAt(0);
      if (first && first.type === 'Rectangle') {
        first.setFillStyle(0xffffff);
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
