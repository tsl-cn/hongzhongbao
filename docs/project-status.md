# 红中宝自摸麻将 — 项目状态

## 项目定位

四人联网麻将，支持真人 + AI 混合对战、语音聊天、红中万能牌、三番起胡、买马。

## 完成度 ~95%

### 后端（全部就绪）

| 模块 | 文件 | 说明 |
|------|------|------|
| 游戏引擎 | `server/src/game/GameState.js` | 状态机（draw/discard/action/settle 阶段） |
| 番型计算 | `server/src/game/FanCalculator.js` | 18 种番型，红中万能牌，三番起胡 20 封顶 |
| 牌墙 | `server/src/game/Wall.js` | 4 层安全洗牌（CSPRNG + HMAC-SHA256 盐 + 双重 Fisher-Yates + 中局洗牌） |
| 买马 | `server/src/game/HorseBuyer.js` | 独立牌堆，每人 0-4 匹 |
| AI | `server/src/ai/` | AiPlayer + Shanten + DiscardPicker + ActionDecider |
| AI 信息防火墙 | `server/src/ai/AiView.js` | 闭包工厂，AI 只能看到公开信息 |
| 房间管理 | `server/src/rooms/` | RoomManager + Player |
| 协议 | `server/src/protocol/messages.js` | 完整消息协议 |
| 服务入口 | `server/src/index.js` | Express + Socket.IO，完整路由 |

### 前端（全部就绪）

| 模块 | 文件 | 说明 |
|------|------|------|
| 入口 | `client/src/main.js` | Phaser 3 |
| 场景 | `client/src/scenes/` | BootScene / LobbyScene / GameScene |
| 牌面渲染 | `client/src/game/TileRenderer.js` | 优先图片，回退文字 + 色块 |
| 网络 | `client/src/network/SocketManager.js` | Socket.IO 客户端 |
| 语音 | `client/src/network/VoiceChatManager.js` | WebRTC + SimplePeer |
| Vite 代理 | `client/vite.config.js` | 代理到 `localhost:3000` |

### 模块2（已完成 2026-06-03）

1. **出牌 30 秒倒计时** — 服务端 setTimeout + 客户端倒数 UI
2. **超时自动出牌 + AI 托管** — 30 秒到自动出非红中牌
3. **手动 AI 托管** — "托"按钮，确认后 AI 代打
4. **断线 → AI 接管** — 不断线不删人，标记 disconnected + AI 代打
5. **重连** — 按昵称 + 房间匹配，挤 AI 恢复真人控制，发完整快照
6. **分享按钮** — 右上角复制 `?room=xxx&nickname=xxx` 链接

### 即将重构

- **结算规则** — 已定 4 层架构（非胡家明暗杠 / 手牌胡牌 / 马牌站队 / 加总），待代码实现
- 结算页展示格式

## 番型表（18 种）

| 番型 | 番数 |
|------|------|
| 门清 | 2 |
| 碰碰胡 | 2 |
| 混一色 | 2 |
| 七小对 | 4 |
| 清一色 | 6 |
| 四暗刻 | 6 |
| 混幺九 | 8 |
| 豪华七小对 | 10 |
| 全风 | 20 |
| 全幺九 | 20 |
| 双豪华七小对 | 20 |
| 三豪华七小对 | 20 |
| 天胡 | 20 |
| 地胡 | 20 |
| 人胡 | 20 |
| 十八罗汉 | 20 |
| 明杠 | 1/杠 |
| 暗杠 | 2/杠 |

**倍数番型：** 杠上开花 ×2、杠上杠开花 ×4、海底捞月 ×2

## 安全机制

- 4 层洗牌：CSPRNG → 256-bit 盐 → 双重 Fisher-Yates → 中局 ≥11 次洗牌
- AI 信息防火墙：AiView 只读代理，不泄露对手手牌 / 牌墙
- 所有安全机制后台静默运行

## 启动方式

```bash
npm start              # 同时起 server:3000 + client:8080
npm run server         # 仅后端
npm run client         # 仅前端
```

## 编码规范

- 服务端: CommonJS (`require/module.exports`)
- 客户端: ES Modules (`import/export`)
- 变量名 camelCase，类名 PascalCase
- 常量全大写: `PHASE`, `SEAT_NAMES`

## 未来方向

牌局回放 / 复盘、AI 难度分级、音效、成就统计、手机触屏优化
