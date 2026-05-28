/**
 * VoiceChatManager.js — 语音聊天管理器
 *
 * 基于 WebRTC + SimplePeer 的 P2P 语音
 * Mesh 架构：每个玩家与其他真人玩家直连
 */

class VoiceChatManager {
  /**
   * @param {SocketManager} socketMgr - Socket管理器
   * @param {Phaser.Scene} scene - 游戏场景（用于UI更新）
   */
  constructor(socketMgr, scene) {
    this.socket = socketMgr;
    this.scene = scene;
    this.peers = new Map();     // playerId → SimplePeer instance
    this.localStream = null;
    this.muted = false;
    this.connected = false;
    this.roomId = null;

    // 语音状态UI
    this.statusIcon = null;
    this.muteBtn = null;

    this._registerSocketEvents();
  }

  /**
   * 发起语音通话
   * @param {string} roomId - 房间ID
   */
  async initiateCall(roomId) {
    this.roomId = roomId;

    try {
      // 获取麦克风权限
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });

      this.connected = true;
      console.log('[语音] 麦克风已就绪');

      // 在场景中显示语音状态
      this._createVoiceUI();

      // Socket 事件监听语音信令
    } catch (err) {
      console.warn('[语音] 无法获取麦克风:', err.message);
      this._showVoiceStatus('麦克风不可用');
    }
  }

  /** 创建到某个玩家的连接 */
  _createPeerConnection(targetId, initiator = true) {
    if (this.peers.has(targetId)) return;

    // 动态导入 SimplePeer
    import('simple-peer').then(({ default: SimplePeer }) => {
      const peer = new SimplePeer({
        initiator,
        stream: this.localStream,
        trickle: true,
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
          ],
        },
      });

      peer.on('signal', (data) => {
        // 发送信令数据
        if (data.type === 'offer') {
          this.socket.sendVoiceOffer(this.roomId, data);
        } else if (data.type === 'answer') {
          this.socket.sendVoiceAnswer(this.roomId, data);
        } else if (data.type === 'candidate' && data.candidate) {
          this.socket.sendVoiceICE(this.roomId, data);
        }
      });

      peer.on('stream', (remoteStream) => {
        // 播放远端音频
        const audio = new Audio();
        audio.srcObject = remoteStream;
        audio.autoplay = true;
        audio.volume = 1.0;
        audio.play().catch(e => console.warn('[语音] 播放失败:', e.message));
        console.log('[语音] 远端音频已连接:', targetId);
      });

      peer.on('connect', () => {
        console.log('[语音] P2P连接建立:', targetId);
        this._showVoiceStatus('语音已连接');
      });

      peer.on('close', () => {
        console.log('[语音] P2P连接关闭:', targetId);
        this.peers.delete(targetId);
      });

      peer.on('error', (err) => {
        console.warn('[语音] P2P错误:', err.message);
      });

      this.peers.set(targetId, peer);
    }).catch(err => {
      console.warn('[语音] SimplePeer加载失败:', err.message);
    });
  }

  /** 接收信令 */
  _registerSocketEvents() {
    this.socket.on('voice_offer', (data) => {
      if (data.from === this.socket.playerId) return;
      this._createPeerConnection(data.from, false);
      // 等 peer 创建完后发送 answer
      setTimeout(() => {
        const peer = this.peers.get(data.from);
        if (peer && data.description) {
          peer.signal(data.description);
        }
      }, 500);
    });

    this.socket.on('voice_answer', (data) => {
      if (data.from === this.socket.playerId) return;
      const peer = this.peers.get(data.from);
      if (peer && data.description) {
        peer.signal(data.description);
      }
    });

    this.socket.on('voice_ice', (data) => {
      if (data.from === this.socket.playerId) return;
      const peer = this.peers.get(data.from);
      if (peer && data.candidate) {
        peer.signal(data.candidate);
      }
    });
  }

  /** 切换静音 */
  toggleMute() {
    this.muted = !this.muted;
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach(track => {
        track.enabled = !this.muted;
      });
    }
    this.socket.sendVoiceMute(this.roomId, this.muted);
    this._updateMuteUI();
    return this.muted;
  }

  /** 创建语音UI */
  _createVoiceUI() {
    const W = this.scene.cameras.main.width;

    // 语音状态图标
    this.statusIcon = this.scene.add.text(W / 2, 5, '🎤 语音就绪', {
      fontSize: '12px', color: '#44ff44',
    }).setOrigin(0.5, 0);

    // 静音按钮
    const muteBg = this.scene.add.rectangle(W - 50, 40, 60, 30, 0x444444)
      .setInteractive({ useHandCursor: true });
    this.muteBtnText = this.scene.add.text(W - 50, 40, '静音', {
      fontSize: '13px', color: '#ffffff',
    }).setOrigin(0.5);

    muteBg.on('pointerdown', () => {
      const muted = this.toggleMute();
      this.muteBtnText.setText(muted ? '已静音' : '静音');
    });
  }

  _updateMuteUI() {
    if (this.statusIcon) {
      this.statusIcon.setText(this.muted ? '🔇 已静音' : '🎤 通话中');
      this.statusIcon.setColor(this.muted ? '#ff4444' : '#44ff44');
    }
  }

  _showVoiceStatus(msg) {
    if (this.statusIcon) {
      this.statusIcon.setText(msg);
    }
  }

  /** 断开所有连接 */
  disconnect() {
    for (const [id, peer] of this.peers) {
      peer.destroy();
    }
    this.peers.clear();

    if (this.localStream) {
      this.localStream.getTracks().forEach(t => t.stop());
      this.localStream = null;
    }

    this.connected = false;
  }
}

export default VoiceChatManager;
