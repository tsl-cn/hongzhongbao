/**
 * main.js — Phaser 游戏入口
 */

import Phaser from 'phaser';
import BootScene from './scenes/BootScene.js';
import LobbyScene from './scenes/LobbyScene.js';
import GameScene from './scenes/GameScene.js';
import SocketManager from './network/SocketManager.js';

// 创建 Socket 管理器（全局单例）
const socketMgr = new SocketManager();

const config = {
  type: Phaser.AUTO,
  parent: 'game-container',
  width: 1066,
  height: 600,
  backgroundColor: '#1a3a2e',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  dom: {
    createContainer: true,
  },
  scene: [BootScene, LobbyScene, GameScene],
  callbacks: {
    postBoot: (game) => {
      // 把 socket 管理器挂到全局
      game.socketMgr = socketMgr;
    },
  },
};

const game = new Phaser.Game(config);

export default game;
