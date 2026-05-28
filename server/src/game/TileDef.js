/**
 * TileDef.js — 麻将牌定义
 *
 * 136张标准麻将牌，34种牌面 × 4张
 *
 * 编号规则:
 *   0-8  : 万 (1万-9万)
 *   9-17 : 筒 (1筒-9筒)
 *  18-26 : 条 (1条-9条)
 *  27-30 : 风 (东南西北)
 *  31    : 红中 (万能牌)
 *  32-33 : 发财、白板
 */

// 牌面类型（0-33）
const TILE_TYPES = {
  // 万 (0-8)
  MAN_1: 0, MAN_2: 1, MAN_3: 2, MAN_4: 3, MAN_5: 4,
  MAN_6: 5, MAN_7: 6, MAN_8: 7, MAN_9: 8,
  // 筒 (9-17)
  PIN_1: 9, PIN_2: 10, PIN_3: 11, PIN_4: 12, PIN_5: 13,
  PIN_6: 14, PIN_7: 15, PIN_8: 16, PIN_9: 17,
  // 条 (18-26)
  SOU_1: 18, SOU_2: 19, SOU_3: 20, SOU_4: 21, SOU_5: 22,
  SOU_6: 23, SOU_7: 24, SOU_8: 25, SOU_9: 26,
  // 风 (27-30)
  EAST: 27, SOUTH: 28, WEST: 29, NORTH: 30,
  // 箭 (31-33)
  RED: 31,      // 红中 ← 万能牌！
  GREEN: 32,    // 发财
  WHITE: 33,    // 白板
};

const WILD_TILE = 31; // 红中是万能牌

// 每种牌面的中文名
const TILE_NAMES = {
  0: '1万', 1: '2万', 2: '3万', 3: '4万', 4: '5万',
  5: '6万', 6: '7万', 7: '8万', 8: '9万',
  9: '1筒', 10: '2筒', 11: '3筒', 12: '4筒', 13: '5筒',
  14: '6筒', 15: '7筒', 16: '8筒', 17: '9筒',
  18: '1条', 19: '2条', 20: '3条', 21: '4条', 22: '5条',
  23: '6条', 24: '7条', 25: '8条', 26: '9条',
  27: '东', 28: '南', 29: '西', 30: '北',
  31: '红中', 32: '发财', 33: '白板',
};

// 牌面归属花色
function getSuit(tileType) {
  if (tileType <= 8) return 'man';
  if (tileType <= 17) return 'pin';
  if (tileType <= 26) return 'sou';
  return 'honor'; // 风 + 箭
}

// 是否是字牌（风/箭）
function isHonor(tileType) {
  return tileType >= 27;
}

// 是否是万
function isMan(tileType) {
  return tileType <= 8;
}

// 是否是筒
function isPin(tileType) {
  return tileType >= 9 && tileType <= 17;
}

// 是否是条
function isSou(tileType) {
  return tileType >= 18 && tileType <= 26;
}

// 是否是红中（万能牌）
function isWild(tileType) {
  return tileType === WILD_TILE;
}

// 是否是箭牌（中发白）
function isDragon(tileType) {
  return tileType >= 31;
}

// 是否是风牌
function isWind(tileType) {
  return tileType >= 27 && tileType <= 30;
}

// 创建一副完整的136张牌
function createDeck() {
  const deck = [];
  for (let tileType = 0; tileType <= 33; tileType++) {
    for (let copy = 0; copy < 4; copy++) {
      deck.push(tileType);
    }
  }
  return deck;
}

// 获取牌的文件名（用于前端渲染）
function getTileImagePath(tileType) {
  if (tileType <= 8) return `assets/tiles/man/${tileType + 1}.png`;
  if (tileType <= 17) return `assets/tiles/pin/${tileType - 8}.png`;
  if (tileType <= 26) return `assets/tiles/sou/${tileType - 17}.png`;
  const windMap = { 27: 'east', 28: 'south', 29: 'west', 30: 'north' };
  if (tileType <= 30) return `assets/tiles/wind/${windMap[tileType]}.png`;
  const dragonMap = { 31: 'red', 32: 'green', 33: 'white' };
  return `assets/tiles/dragon/${dragonMap[tileType]}.png`;
}

module.exports = {
  TILE_TYPES,
  WILD_TILE,
  TILE_NAMES,
  getSuit,
  isHonor,
  isMan,
  isPin,
  isSou,
  isWild,
  isDragon,
  isWind,
  createDeck,
  getTileImagePath,
};
