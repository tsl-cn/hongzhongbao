/**
 * ThemeManager — 三套主题系统
 * 管理所有视觉常量，通过 switchTheme() 全局切换
 */
const THEMES = {
  classic: {
    name: '经典中国风',
    id: 'classic',
    colors: {
      background:     0x1a0f0a,  // 深檀木色
      tableBg:        0x2d6b3f,  // 墨绿毛毡
      tableInner:     0x357a4a,  // 桌面内圈
      tableBorder:    0xb8860b,  // 金色边框
      primary:        0xc4302b,  // 中国红
      primaryDark:    0x8b0000,  // 暗红
      accent:         0xd4a017,  // 金色
      accentLight:    0xf0d060,  // 亮金
      text:           0xf5e6c8,  // 象牙白
      textDark:       0x8b7355,  // 深褐
      tileBg:         0xfff8f0,  // 米白牌底
      tileBorder:     0xb8860b,  // 金色边框
      tileCategory:   [0xc4302b, 0x2d8a4e, 0x2563eb, 0xd4a017], // 万/筒/条/字
      tileBack:       0x8b0000,  // 牌背暗红
      tileBackPattern:0xd4a017,  // 牌背金纹
      success:        0x22c55e,  // 赢/正分
      error:          0xef4444,  // 输/负分
      overlay:        0x000000,  // 遮罩
      panelBg:        0x2a1a0a,  // 面板背景
      panelBorder:    0xd4a017,  // 面板边框
      buttonBg:       0xc4302b,  // 按钮背景
      buttonHover:    0xdc2626,  // 按钮悬停
      buttonActive:   0x991b1b,  // 按钮按下
      buttonText:     0xf5e6c8,  // 按钮文字
      buttonDisabled: 0x666666,  // 按钮禁用
      inputBg:        0x2a1f15,  // 输入框背景
      inputBorder:    0xb8860b,  // 输入框边框
      logBg:          0x1a0f0a,  // 日志背景
      logText:        0xd4a017,  // 日志文字
      highlight:      0xd4a017,  // 高亮/选中
      glowColor:      0xd4a017,  // 光晕颜色
    },
    fonts: {
      title:  { fontSize: '48px', fontFamily: 'KaiTi, STKaiti, serif', color: '#d4a017' },
      subtitle: { fontSize: '16px', fontFamily: 'Arial, sans-serif', color: '#f5e6c8' },
      body:   { fontSize: '14px', fontFamily: 'Arial, sans-serif', color: '#f5e6c8' },
      log:    { fontSize: '13px', fontFamily: 'Arial, sans-serif', color: '#d4a017' },
    },
    particleColor: [0xd4a017, 0xf0d060, 0xc4302b],
  },

  modern: {
    name: '现代简约风',
    id: 'modern',
    colors: {
      background:     0x111827,  // 深灰蓝
      tableBg:        0x1f2937,  // 半透明磨砂
      tableInner:     0x283548,  // 内圈更深
      tableBorder:    0x6366f1,  // 靛蓝边框
      primary:        0x6366f1,  // 靛蓝
      primaryDark:    0x4338ca,  // 深靛蓝
      accent:         0x22c55e,  // 翠绿
      accentLight:    0x4ade80,  // 亮绿
      text:           0xf8fafc,  // 白
      textDark:       0x64748b,  // 石板灰
      tileBg:         0xffffff,  // 白牌底
      tileBorder:     0x475569,  // 深灰边框
      tileCategory:   [0xef4444, 0x22c55e, 0x3b82f6, 0xa855f7], // 红/绿/蓝/紫
      tileBack:       0x334155,  // 牌背深灰
      tileBackPattern:0x6366f1,  // 牌背靛蓝
      success:        0x22c55e,
      error:          0xef4444,
      overlay:        0x000000,
      panelBg:        0x1e293b,
      panelBorder:    0x6366f1,
      buttonBg:       0x6366f1,
      buttonHover:    0x818cf8,
      buttonActive:   0x4338ca,
      buttonText:     0xffffff,
      buttonDisabled: 0x475569,
      inputBg:        0x1e293b,
      inputBorder:    0x6366f1,
      logBg:          0x0f172a,
      logText:        0x22c55e,
      highlight:      0x22c55e,
      glowColor:      0x6366f1,
    },
    fonts: {
      title:  { fontSize: '42px', fontFamily: 'Inter, Arial, sans-serif', color: '#f8fafc' },
      subtitle: { fontSize: '14px', fontFamily: 'Inter, Arial, sans-serif', color: '#94a3b8' },
      body:   { fontSize: '14px', fontFamily: 'Inter, Arial, sans-serif', color: '#f8fafc' },
      log:    { fontSize: '13px', fontFamily: 'Inter, Arial, sans-serif', color: '#22c55e' },
    },
    particleColor: [0x6366f1, 0x818cf8, 0x22c55e],
  },

  gamey: {
    name: '轻游戏风',
    id: 'gamey',
    colors: {
      background:     0x0f172a,  // 深蓝底
      tableBg:        0x2d8a4e,  // 亮翠绿
      tableInner:     0x34a853,  // 内圈更亮
      tableBorder:    0xffd93d,  // 亮黄边框
      primary:        0xff6b6b,  // 珊瑚红
      primaryDark:    0xe05555,  // 深珊瑚
      accent:         0xffd93d,  // 亮黄
      accentLight:    0xffe66d,  // 浅黄
      text:           0xffffff,  // 白
      textDark:       0x94a3b8,  // 浅灰
      tileBg:         0xfffdf0,  // 暖白牌底
      tileBorder:     0xff6b6b,  // 珊瑚红边框
      tileCategory:   [0xff6b6b, 0x4ecdc4, 0x45b7d1, 0xffd93d], // 红/青/蓝/黄
      tileBack:       0x7c3aed,  // 紫色牌背
      tileBackPattern:0xffd93d,  // 黄纹
      success:        0x4ecdc4,
      error:          0xff6b6b,
      overlay:        0x000000,
      panelBg:        0x1e1b4b,
      panelBorder:    0xffd93d,
      buttonBg:       0xff6b6b,
      buttonHover:    0xff8787,
      buttonActive:   0xcc5555,
      buttonText:     0xffffff,
      buttonDisabled: 0x6b7280,
      inputBg:        0x1e1b4b,
      inputBorder:    0xffd93d,
      logBg:          0x0f172a,
      logText:        0x4ecdc4,
      highlight:      0xffd93d,
      glowColor:      0xffd93d,
    },
    fonts: {
      title:  { fontSize: '44px', fontFamily: '"Comic Sans MS", "Segoe UI", Arial, sans-serif', color: '#ffd93d' },
      subtitle: { fontSize: '15px', fontFamily: '"Segoe UI", Arial, sans-serif', color: '#ffffff' },
      body:   { fontSize: '14px', fontFamily: '"Segoe UI", Arial, sans-serif', color: '#ffffff' },
      log:    { fontSize: '13px', fontFamily: '"Segoe UI", Arial, sans-serif', color: '#4ecdc4' },
    },
    particleColor: [0xff6b6b, 0xffd93d, 0x4ecdc4, 0x45b7d1],
  },
};

/**
 * 当前激活主题，默认经典中国风
 */
let currentTheme = THEMES.classic;
let listeners = [];

/**
 * 切换主题
 * @param {'classic'|'modern'|'gamey'} themeId
 */
function switchTheme(themeId) {
  if (!THEMES[themeId]) return;
  currentTheme = THEMES[themeId];
  try {
    localStorage.setItem('hongzhongbao_theme', themeId);
  } catch (e) { /* ignore */ }
  listeners.forEach(fn => fn(currentTheme));
}

/**
 * 获取当前主题
 */
function getTheme() {
  return currentTheme;
}

/**
 * 获取主题色值（十六进制数字，供 Phaser 用）
 */
function color(key) {
  return currentTheme.colors[key] || 0x000000;
}

/**
 * 获取主题字体样式（对象，供 Phaser 用）
 */
function font(key) {
  return currentTheme.fonts[key] || currentTheme.fonts.body;
}

/**
 * 订阅主题变更
 */
function onThemeChange(fn) {
  listeners.push(fn);
  return () => { listeners = listeners.filter(f => f !== fn); };
}

/**
 * 初始化：从 localStorage 恢复上次主题
 */
function initTheme() {
  try {
    const saved = localStorage.getItem('hongzhongbao_theme');
    if (saved && THEMES[saved]) {
      currentTheme = THEMES[saved];
    }
  } catch (e) { /* ignore */ }
  return currentTheme;
}

// 在浏览器环境自动初始化
if (typeof window !== 'undefined') {
  initTheme();
}

// ES Module 导出
export { THEMES, switchTheme, getTheme, color, font, onThemeChange, initTheme };
export default { THEMES, switchTheme, getTheme, color, font, onThemeChange, initTheme };
