/**
 * レトロPC風 PSG (Programmable Sound Generator) 音源エミュレーター
 * Web Audio API による矩形波 (Square Wave) およびホワイトノイズのリアルタイム波形合成。
 * 外部音声ファイル一切不要・ヘッドレス環境（Node.js）セーフフォールバック設計。
 */

export class PSGAudio {
  private static instance: PSGAudio | null = null;

  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  private muted: boolean = false;
  private volume: number = 0.3;

  // BGMループ用ステート
  private bgmPlaying: boolean = false;
  private bgmTimer: number | null = null;
  private bgmStep: number = 0;

  constructor() {
    this.initAudioContext();
  }

  public static getInstance(): PSGAudio {
    if (!PSGAudio.instance) {
      PSGAudio.instance = new PSGAudio();
    }
    return PSGAudio.instance;
  }

  private initAudioContext(): void {
    if (typeof window === 'undefined') return;

    try {
      const AudioCtxClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtxClass) {
        this.ctx = new AudioCtxClass();
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.setValueAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime);
        this.masterGain.connect(this.ctx.destination);
        this.createNoiseBuffer();
      }
    } catch {
      // AudioContext 非サポート環境または制限環境
      this.ctx = null;
    }
  }

  private resumeContext(): void {
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  private createNoiseBuffer(): void {
    if (!this.ctx) return;
    const bufferSize = this.ctx.sampleRate * 2; // 2秒分のホワイトノイズ
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    this.noiseBuffer = buffer;
  }

  public isAvailable(): boolean {
    return this.ctx !== null;
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public setMuted(mute: boolean): void {
    this.muted = mute;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setValueAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime);
    }
    if (this.muted && this.bgmPlaying) {
      this.stopBGM();
    }
  }

  public toggleMute(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  public setVolume(vol: number): void {
    this.volume = Math.max(0, Math.min(1, vol));
    if (this.masterGain && this.ctx && !this.muted) {
      this.masterGain.gain.setValueAtTime(this.volume, this.ctx.currentTime);
    }
  }

  // ==========================================
  // レトロSE (Sound Effects)
  // ==========================================

  /**
   * 1. 体当たり戦闘音（急激な周波数低下矩形波）
   */
  public playBumpCombat(): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    this.resumeContext();

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'square';
    osc.frequency.setValueAtTime(320, t);
    osc.frequency.exponentialRampToValueAtTime(70, t + 0.08);

    gain.gain.setValueAtTime(0.4, t);
    gain.gain.exponentialRampToValueAtTime(0.01, t + 0.08);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start(t);
    osc.stop(t + 0.09);
  }

  /**
   * 2. プレイヤー被弾・ダメージ音（低音矩形波＋微弱ノイズ）
   */
  public playDamage(): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    this.resumeContext();

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'square';
    osc.frequency.setValueAtTime(140, t);
    osc.frequency.setValueAtTime(110, t + 0.05);
    osc.frequency.setValueAtTime(75, t + 0.1);

    gain.gain.setValueAtTime(0.5, t);
    gain.gain.exponentialRampToValueAtTime(0.01, t + 0.18);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start(t);
    osc.stop(t + 0.19);
  }

  /**
   * 3. 壁破壊・キック音（BREAK / KICK: ノイズ破裂音）
   */
  public playBreak(): void {
    if (!this.ctx || !this.masterGain || !this.noiseBuffer || this.muted) return;
    this.resumeContext();

    const t = this.ctx.currentTime;
    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1200, t);
    filter.frequency.exponentialRampToValueAtTime(200, t + 0.25);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.6, t);
    gain.gain.exponentialRampToValueAtTime(0.01, t + 0.25);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);

    noise.start(t);
    noise.stop(t + 0.26);
  }

  /**
   * 4. 宝箱解錠音（軽快な高音分散和音）
   */
  public playUnlockChest(): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    this.resumeContext();

    const t = this.ctx.currentTime;
    const notes = [440, 554, 659, 880]; // A4, C#5, E5, A5
    notes.forEach((freq, idx) => {
      if (!this.ctx || !this.masterGain) return;
      const noteTime = t + idx * 0.05;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'square';
      osc.frequency.setValueAtTime(freq, noteTime);

      gain.gain.setValueAtTime(0.3, noteTime);
      gain.gain.exponentialRampToValueAtTime(0.01, noteTime + 0.08);

      osc.connect(gain);
      gain.connect(this.masterGain);

      osc.start(noteTime);
      osc.stop(noteTime + 0.09);
    });
  }

  /**
   * 5. アイテム取得音（短い高音ピピッ）
   */
  public playPickup(): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    this.resumeContext();

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'square';
    osc.frequency.setValueAtTime(880, t);
    osc.frequency.setValueAtTime(1320, t + 0.04);

    gain.gain.setValueAtTime(0.35, t);
    gain.gain.exponentialRampToValueAtTime(0.01, t + 0.1);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start(t);
    osc.stop(t + 0.11);
  }

  /**
   * 6. アイテム交換・ドロップ音
   */
  public playSwap(): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    this.resumeContext();

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'square';
    osc.frequency.setValueAtTime(600, t);
    osc.frequency.setValueAtTime(400, t + 0.05);

    gain.gain.setValueAtTime(0.3, t);
    gain.gain.exponentialRampToValueAtTime(0.01, t + 0.09);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start(t);
    osc.stop(t + 0.1);
  }

  /**
   * 7. 魔法発動音（周波数の急上昇スイープ）
   */
  public playMagicCast(): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    this.resumeContext();

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'square';
    osc.frequency.setValueAtTime(300, t);
    osc.frequency.exponentialRampToValueAtTime(1800, t + 0.2);

    gain.gain.setValueAtTime(0.4, t);
    gain.gain.exponentialRampToValueAtTime(0.01, t + 0.25);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start(t);
    osc.stop(t + 0.26);
  }

  /**
   * 8. ドラゴン火炎弾発射音（低域ノイズ＋バンドパス）
   */
  public playFireball(): void {
    if (!this.ctx || !this.masterGain || !this.noiseBuffer || this.muted) return;
    this.resumeContext();

    const t = this.ctx.currentTime;
    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(600, t);
    filter.frequency.exponentialRampToValueAtTime(300, t + 0.3);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.5, t);
    gain.gain.exponentialRampToValueAtTime(0.01, t + 0.3);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);

    noise.start(t);
    noise.stop(t + 0.31);
  }

  /**
   * 9. ワープゾーン移動音（上昇アルペジオ・テレポート）
   */
  public playWarp(): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    this.resumeContext();

    const t = this.ctx.currentTime;
    const notes = [330, 495, 660, 990, 1320];
    notes.forEach((freq, idx) => {
      if (!this.ctx || !this.masterGain) return;
      const noteTime = t + idx * 0.04;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'square';
      osc.frequency.setValueAtTime(freq, noteTime);

      gain.gain.setValueAtTime(0.3, noteTime);
      gain.gain.exponentialRampToValueAtTime(0.01, noteTime + 0.07);

      osc.connect(gain);
      gain.connect(this.masterGain);

      osc.start(noteTime);
      osc.stop(noteTime + 0.08);
    });
  }

  /**
   * 10. ゲームオーバー音（悲壮感漂う下降ジングル）
   */
  public playGameOver(): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    this.resumeContext();
    this.stopBGM();

    const t = this.ctx.currentTime;
    const notes = [440, 415, 392, 330, 220]; // A4, G#4, G4, E4, A3
    notes.forEach((freq, idx) => {
      if (!this.ctx || !this.masterGain) return;
      const noteTime = t + idx * 0.16;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'square';
      osc.frequency.setValueAtTime(freq, noteTime);

      gain.gain.setValueAtTime(0.4, noteTime);
      gain.gain.exponentialRampToValueAtTime(0.01, noteTime + 0.22);

      osc.connect(gain);
      gain.connect(this.masterGain);

      osc.start(noteTime);
      osc.stop(noteTime + 0.24);
    });
  }

  /**
   * 12. 我が家帰還・HP全快ジングル (心地よいレトロPSGアルペジオ)
   */
  public playHomeHeal(): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    this.resumeContext();

    const t = this.ctx.currentTime;
    // 心地よいレトロPSGアルペジオ: C5 -> E5 -> G5 -> C6
    const notes = [
      { f: 523, d: 0.08 }, // C5
      { f: 659, d: 0.08 }, // E5
      { f: 784, d: 0.08 }, // G5
      { f: 1046, d: 0.28 }, // C6 (長めに余韻)
    ];

    let offset = 0;
    notes.forEach((n) => {
      if (!this.ctx || !this.masterGain) return;
      const noteTime = t + offset;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'square';
      osc.frequency.setValueAtTime(n.f, noteTime);

      gain.gain.setValueAtTime(0.35, noteTime);
      gain.gain.exponentialRampToValueAtTime(0.01, noteTime + n.d);

      osc.connect(gain);
      gain.connect(this.masterGain);

      osc.start(noteTime);
      osc.stop(noteTime + n.d + 0.02);

      offset += 0.07;
    });
  }

  /**
   * 11. ステージクリア・ファンファーレ
   */
  public playClearFanfare(): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    this.resumeContext();
    this.stopBGM();

    const t = this.ctx.currentTime;
    // ド・ミ・ソ・ド・ソ・ドのファンファーレ
    const notes = [
      { f: 523, d: 0.12 }, // C5
      { f: 659, d: 0.12 }, // E5
      { f: 784, d: 0.12 }, // G5
      { f: 1046, d: 0.24 }, // C6
      { f: 784, d: 0.12 }, // G5
      { f: 1046, d: 0.5 }, // C6
    ];

    let offset = 0;
    notes.forEach((n) => {
      if (!this.ctx || !this.masterGain) return;
      const noteTime = t + offset;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'square';
      osc.frequency.setValueAtTime(n.f, noteTime);

      gain.gain.setValueAtTime(0.4, noteTime);
      gain.gain.exponentialRampToValueAtTime(0.01, noteTime + n.d);

      osc.connect(gain);
      gain.connect(this.masterGain);

      osc.start(noteTime);
      osc.stop(noteTime + n.d + 0.02);

      offset += n.d + 0.03;
    });
  }

  // ==========================================
  // PSG BGM (簡易ダンジョンループ)
  // ==========================================

  public startBGM(): void {
    if (this.bgmPlaying || !this.ctx || this.muted) return;
    this.resumeContext();
    this.bgmPlaying = true;
    this.bgmStep = 0;

    // A minor ダンジョンアルペジオ
    const melody = [220, 261, 330, 293, 261, 246, 220, 196]; // A3, C4, E4, D4, C4, B3, A3, G3

    const tick = () => {
      if (!this.bgmPlaying || !this.ctx || !this.masterGain || this.muted) return;

      const freq = melody[this.bgmStep % melody.length];
      this.bgmStep++;

      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'square';
      osc.frequency.setValueAtTime(freq, t);

      // 短くスタッカート気味に鳴らす
      gain.gain.setValueAtTime(0.12, t);
      gain.gain.exponentialRampToValueAtTime(0.005, t + 0.18);

      osc.connect(gain);
      gain.connect(this.masterGain);

      osc.start(t);
      osc.stop(t + 0.19);

      this.bgmTimer = window.setTimeout(tick, 220);
    };

    tick();
  }

  public stopBGM(): void {
    this.bgmPlaying = false;
    if (this.bgmTimer !== null) {
      if (typeof window !== 'undefined') {
        window.clearTimeout(this.bgmTimer);
      }
      this.bgmTimer = null;
    }
  }

  public isBGMPlaying(): boolean {
    return this.bgmPlaying;
  }
}
