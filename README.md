# 🀄 红中宝自摸麻将

四人联网麻将游戏，支持**真人+AI混合**对战、**语音聊天**。

## 特色

- 🎮 **自摸麻将** — 不能吃，只能碰/杠/自摸，三番起胡
- 🃏 **红中万能牌** — 31号牌为万能牌
- 🤖 **高手AI** — 基于向听数计算+防守策略的AI补位
- 🎤 **语音聊天** — WebRTC P2P语音，打牌同时聊天
- 📱 **跨平台** — 浏览器打开即玩，电脑手机均可

## 快速启动

```bash
# 1. 安装所有依赖
cd Reasonix/红中宝
npm install
npm run install:all

# 2. 启动（前后端同时）
npm start

# 3. 浏览器打开
#    电脑: http://localhost:8080
#    手机: http://<电脑IP>:8080 (同一局域网)
```

## 项目结构

```
Reasonix/红中宝/
├── client/                # 前端 (Phaser.js + Vite)
│   ├── src/
│   │   ├── scenes/        # 游戏场景
│   │   ├── network/       # Socket + 语音
│   │   └── game/          # 牌面渲染
│   └── public/assets/tiles/  # 牌面图片素材(需自行添加)
├── server/                # 后端 (Node.js + Socket.IO)
│   └── src/
│       ├── game/          # 游戏引擎(状态机/番型/牌墙)
│       ├── ai/            # 高手AI(向听数/防守/决策)
│       ├── rooms/         # 房间管理
│       └── protocol/      # 通信协议
└── package.json
```

## 图片素材

游戏需要34张麻将牌图片和1张牌背图，放在 `client/public/assets/tiles/` 目录下：

```
tiles/
├── man/1.png ~ 9.png      # 1万~9万
├── pin/1.png ~ 9.png      # 1筒~9筒
├── sou/1.png ~ 9.png      # 1条~9条
├── wind/east/south/west/north.png  # 东南西北
├── dragon/red/green/white.png      # 中发白
└── back.png               # 牌背
```

没有图片也能玩——代码会用文字+色块渲染牌面。

## 规则概要

- 136张标准牌，红中为万能牌
- 不能吃，可碰/杠/自摸
- 三番起胡，满20番封顶
- 支持买马、抢杠胡一炮多响
- 流局下家坐庄
