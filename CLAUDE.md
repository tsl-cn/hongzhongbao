# 红中宝自摸麻将 — 项目规范

## 项目概述
四人联网麻将，支持真人+AI混合对战、语音聊天、红中万能牌、三番起胡、买马。

## 目录结构
```
/
├── client/                # 前端 (Phaser.js + Vite)
│   └── src/
│       ├── scenes/        # 游戏场景 (Boot/Lobby/Game)
│       ├── network/       # Socket + 语音
│       └── game/          # 牌面渲染
├── server/                # 后端 (Node.js + Socket.IO)
│   └── src/
│       ├── game/          # 游戏引擎 (状态机/番型/牌墙/买马)
│       ├── ai/            # AI (向听数/防守/决策)
│       ├── rooms/         # 房间管理
│       └── protocol/      # 通信协议
```

## 编码规范
- 服务端: CommonJS (`require/module.exports`)
- 客户端: ES Modules (`import/export`)
- 变量名: camelCase，类名 PascalCase
- 常量全大写: `PHASE`, `SEAT_NAMES`
- 文件注释用 JSDoc 描述模块功能

## 启动方式
```bash
npm start              # 同时启动 server:3000 + client:8080
npm run server         # 仅后端
npm run client         # 仅前端
```

## 验证方式
1. `npm start` 启动
2. 浏览器打开 `http://localhost:8080`
3. 多开标签页模拟多人
4. 手动进行完整游戏流程：创建房间 → 准备 → 摸牌出牌 → 碰杠胡 → 结算

## 构建部署
```bash
npm run build          # 构建前端到 client/dist/
```
生产环境由 server 提供静态文件服务。

## Git 规范
- 提交信息: `<类型>: <简短说明>`
- 类型: fix / feat / refactor / chore
- 不提交: node_modules/、dist/、.env、*.local、hongzhongbao.zip

## 红线
- 不改 .env / 密钥 / CI/CD 配置
- 不改数据库 schema（本项目无数据库）
- 不强制推送 git 历史
- 发布需确认

## 已知完成状态 (2026-06-09)
- **后端**: GameState 状态机 / FanCalculator 18种番型 / Wall 牌墙（四层安全洗牌）/ HorseBuyer 买马 / SettlementEngine 4层结算 / RoomManager / AI（Shanten+AiView信息防火墙）
- **前端**: BootScene / LobbyScene / GameScene / TileRenderer / SocketManager / VoiceChatManager
- **模块2**: 出牌30秒倒计时 / 超时AI托管 / 手动托管 / 断线AI接管+重连 / 分享房间
- **结算页**: 马牌明细 / 净收支 / 累计统计 / 番型展示
- **安全**: CSPRNG洗牌 / 256-bit盐 / 双重Fisher-Yates / 中局随机洗牌 / AI信息防火墙 / crypto替代Math.random
- 完成度 ~95%，无严重已知问题
