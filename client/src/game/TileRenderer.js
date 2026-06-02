/**
 * TileRenderer.js — 牌面渲染器（主题感知）
 *
 * 用 Phaser 图形绘制麻将牌。
 * 颜色从 ThemeManager 获取，跟随主题切换。
 */

import Phaser from 'phaser';
import { getTheme, color as tc } from './ThemeManager.js';

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

/**
 * 获取牌的分类索引
 * 0=万, 1=筒, 2=条, 3=字牌(东南西北中发白)
 */
function tileCategory(tileType) {
  if (tileType <= 8) return 0;      // 万
  if (tileType <= 17) return 1;     // 筒
  if (tileType <= 26) return 2;     // 条
  return 3;                          // 字牌
}

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
    const theme = getTheme();
    const cols = theme.colors;

    if (faceDown) {
      // 牌背：优先使用精灵图片
      const hasBackTexture = TileRenderer._hasTexture(scene, 'tile_back');
      if (hasBackTexture) {
        const sprite = scene.add.image(0, 0, 'tile_back');
        sprite.setDisplaySize(w, h);
        sprite.setOrigin(0.5);
        container.add(sprite);
      } else {
        // 回退：主题色牌背
        const bg = scene.add.rectangle(0, 0, w, h, cols.tileBack);
        bg.setStrokeStyle(2, cols.tileBackPattern);
        container.add(bg);
        const pattern = scene.add.text(0, 0, '🀄', {
          fontSize: Math.max(12, w * 0.45) + 'px',
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
      // 红中加边框标记（不受主题影响，始终红色）
      if (tileType === 31) {
        const border = scene.add.rectangle(0, 0, w - 2, h - 2);
        border.setStrokeStyle(2, 0xff0000);
        border.setFillStyle(0x000000, 0);
        container.add(border);
      }
    } else {
      // 回退：文字渲染（主题感知）
      const cat = tileCategory(tileType);
      const catColor = cols.tileCategory[cat];

      // 牌底色
      const bg = scene.add.rectangle(0, 0, w, h, cols.tileBg);
      const borderColor = tileType === 31 ? 0xff0000 : cols.tileBorder;
      bg.setStrokeStyle(2, borderColor);
      container.add(bg);

      // 牌面文字
      const name = TILE_NAMES[tileType] || '?';
      const textColor = tileType === 31 ? '#ff0000'
        : tileType === 32 ? '#00aa00'
        : tileType === 33 ? '#888888'
        : '#000000';
      const text = scene.add.text(0, -3, name, {
        fontSize: w < 40 ? Math.max(10, w * 0.28) + 'px' : Math.max(13, w * 0.26) + 'px',
        color: textColor,
        fontFamily: 'Arial, sans-serif',
        fontStyle: 'bold',
      }).setOrigin(0.5);
      container.add(text);

      // 底部彩色分类条
      const stripe = scene.add.rectangle(0, h / 2 - 3, w - 6, 4, catColor);
      stripe.setOrigin(0.5);
      container.add(stripe);

      // 红中标记
      if (tileType === 31) {
        const star = scene.add.text(0, -h / 2 + 10, '★', {
          fontSize: Math.max(8, w * 0.18) + 'px', color: '#ff0000',
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
    const theme = getTheme();
    const cols = theme.colors;

    // 添加点击区域
    const hitZone = scene.add.rectangle(0, 0, w, h, 0x000000, 0)
      .setInteractive({ useHandCursor: true });
    container.add(hitZone);

    hitZone.on('pointerdown', () => {
      if (onClick) onClick(tileType);
    });

    // 悬停高亮（主题感知）
    hitZone.on('pointerover', () => {
      const first = container.getAt(0);
      if (first && first.type === 'Image') {
        const overlay = scene.add.rectangle(0, 0, w, h, cols.highlight, 0.25);
        overlay.setName('hover_overlay');
        container.add(overlay);
      } else if (first && first.type === 'Rectangle') {
        first.setFillStyle(0xffffcc);
      }
    });
    hitZone.on('pointerout', () => {
      const overlay = container.getByName('hover_overlay');
      if (overlay) overlay.destroy();
      const first = container.getAt(0);
      if (first && first.type === 'Rectangle') {
        first.setFillStyle(cols.tileBg);
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
