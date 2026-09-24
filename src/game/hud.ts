/**
 * 游戏 HUD：全部挂在 #hud 的子元素上。
 * 平台规范：绝不写 hud.textContent（会清空平台的触屏控件层）。
 */
import './hud.css';

export interface HudCallbacks {
  onStart: () => void;
  onResume: () => void;
  onRestart: () => void;
}

function el(tag: string, cls: string, parent: HTMLElement): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  parent.appendChild(e);
  return e;
}

export class HUD {
  private root: HTMLElement;
  private crosshair: HTMLElement;
  private hitmarker: HTMLElement;
  private hpFill: HTMLElement;
  private hpText: HTMLElement;
  private ammoMag: HTMLElement;
  private ammoReserve: HTMLElement;
  private weaponName: HTMLElement;
  private reloadTip: HTMLElement;
  private waveText: HTMLElement;
  private enemiesText: HTMLElement;
  private scoreText: HTMLElement;
  private bestText: HTMLElement;
  private banner: HTMLElement;
  private vignette: HTMLElement;
  private lockHint: HTMLElement;
  private startScreen: HTMLElement;
  private pauseScreen: HTMLElement;
  private overScreen: HTMLElement;
  private overScore: HTMLElement;
  private overBest: HTMLElement;
  private startBest: HTMLElement;
  private bannerTimer = 0;

  constructor(cb: HudCallbacks) {
    const hud = document.getElementById('hud')!;
    const root = el('div', 'sh-root', hud);
    this.root = root;

    // 准星
    const ch = el('div', 'sh-crosshair', root);
    for (const c of ['t', 'b', 'l', 'r']) el('div', `sh-ch-${c}`, ch);
    el('div', 'sh-ch-dot', ch);
    this.crosshair = ch;

    // 命中标记
    const hm = el('div', 'sh-hitmarker', root);
    for (const c of ['a', 'b', 'c', 'd']) el('div', `sh-hm-${c}`, hm);
    this.hitmarker = hm;

    // 血条（左下）
    const hpWrap = el('div', 'sh-hp', root);
    el('div', 'sh-hp-label', hpWrap).textContent = '生命';
    const hpBar = el('div', 'sh-hp-bar', hpWrap);
    this.hpFill = el('div', 'sh-hp-fill', hpBar);
    this.hpText = el('div', 'sh-hp-text', hpWrap);

    // 弹药（右下）
    const ammo = el('div', 'sh-ammo', root);
    this.weaponName = el('div', 'sh-weapon', ammo);
    const ammoNums = el('div', 'sh-ammo-nums', ammo);
    this.ammoMag = el('span', 'sh-mag', ammoNums);
    this.ammoReserve = el('span', 'sh-reserve', ammoNums);
    this.reloadTip = el('div', 'sh-reload-tip', ammo);
    this.reloadTip.textContent = '按 R 换弹';

    // 波次（顶部中央）
    const wave = el('div', 'sh-wave', root);
    this.waveText = el('div', 'sh-wave-num', wave);
    this.enemiesText = el('div', 'sh-wave-left', wave);

    // 分数（右上）
    const score = el('div', 'sh-score', root);
    this.scoreText = el('div', 'sh-score-num', score);
    this.bestText = el('div', 'sh-score-best', score);

    // 中央横幅
    this.banner = el('div', 'sh-banner', root);

    // 受伤红屏
    this.vignette = el('div', 'sh-vignette', root);

    // 底部提示
    this.lockHint = el('div', 'sh-lockhint', root);

    // 开始界面
    const start = el('div', 'sh-overlay', root);
    const startCard = el('div', 'sh-card', start);
    el('div', 'sh-title', startCard).textContent = '星港防线';
    el('div', 'sh-subtitle', startCard).textContent = 'STARHOLD · 空间站波次生存';
    el('div', 'sh-desc', startCard).textContent =
      '失控的机械叛军正在从四个舱门涌入。一人，一枪，守住停机坪。';
    const startBtn = el('button', 'sh-btn', startCard) as HTMLButtonElement;
    startBtn.textContent = '进入战场';
    startBtn.addEventListener('click', cb.onStart);
    const controls = el('div', 'sh-controls', startCard);
    controls.innerHTML =
      'WASD 移动 · 鼠标 瞄准 · 左键 射击 · R 换弹<br>1/2/3 或滚轮 切换武器 · Shift 疾跑 · 空格 跳跃';
    this.startBest = el('div', 'sh-start-best', startCard);
    this.startScreen = start;

    // 暂停界面
    const pause = el('div', 'sh-overlay sh-hidden', root);
    const pauseCard = el('div', 'sh-card', pause);
    el('div', 'sh-title-sm', pauseCard).textContent = '已暂停';
    el('div', 'sh-desc', pauseCard).textContent = '点击下方按钮回到战斗';
    const resumeBtn = el('button', 'sh-btn', pauseCard) as HTMLButtonElement;
    resumeBtn.textContent = '继续战斗';
    resumeBtn.addEventListener('click', cb.onResume);
    this.pauseScreen = pause;

    // 结算界面
    const over = el('div', 'sh-overlay sh-hidden', root);
    const overCard = el('div', 'sh-card', over);
    el('div', 'sh-title-sm', overCard).textContent = '防线告破';
    this.overScore = el('div', 'sh-over-score', overCard);
    this.overBest = el('div', 'sh-over-best', overCard);
    const restartBtn = el('button', 'sh-btn', overCard) as HTMLButtonElement;
    restartBtn.textContent = '再来一局';
    restartBtn.addEventListener('click', cb.onRestart);
    this.overScreen = over;
  }

  // ------------------------------------------------------------ 状态更新 ---

  setHealth(hp: number, max: number): void {
    const ratio = Math.max(0, hp / max);
    this.hpFill.style.width = `${ratio * 100}%`;
    this.hpFill.classList.toggle('sh-low', ratio < 0.3);
    this.hpText.textContent = `${Math.ceil(Math.max(0, hp))}`;
  }

  setAmmo(weaponName: string, mag: number | null, reserve: number | null): void {
    this.weaponName.textContent = weaponName;
    this.ammoMag.textContent = mag === null ? '∞' : String(mag);
    this.ammoReserve.textContent = reserve === null ? '' : `/ ${reserve}`;
  }

  setReloading(reloading: boolean, empty: boolean): void {
    this.reloadTip.classList.toggle('sh-show', reloading || empty);
    this.reloadTip.textContent = reloading ? '换弹中…' : '按 R 换弹';
  }

  setWave(n: number, left: number): void {
    this.waveText.textContent = `第 ${n} 波`;
    this.enemiesText.textContent = left > 0 ? `剩余敌人 ${left}` : '清理战场…';
  }

  /** 波间休整倒计时 */
  setIntermission(secondsLeft: number): void {
    if (secondsLeft > 0.05) {
      this.enemiesText.textContent = `下一波 ${Math.ceil(secondsLeft)}s`;
    }
  }

  setScore(score: number, best: number): void {
    this.scoreText.textContent = `${score}`;
    this.bestText.textContent = `最高 ${best}`;
  }

  setStartBest(best: number): void {
    this.startBest.textContent = best > 0 ? `历史最高分：${best}` : '';
  }

  /** 受伤红屏：0..1 */
  setDamageFlash(v: number): void {
    this.vignette.style.opacity = String(Math.min(1, v));
  }

  showHitmarker(kill: boolean): void {
    this.hitmarker.classList.remove('sh-show', 'sh-kill');
    // 强制重启动画
    void this.hitmarker.offsetWidth;
    this.hitmarker.classList.add('sh-show');
    if (kill) this.hitmarker.classList.add('sh-kill');
  }

  setFiring(firing: boolean): void {
    this.crosshair.classList.toggle('sh-firing', firing);
  }

  showBanner(text: string, sub = '', ms = 2200): void {
    this.banner.innerHTML = '';
    const t = document.createElement('div');
    t.className = 'sh-banner-t';
    t.textContent = text;
    const s = document.createElement('div');
    s.className = 'sh-banner-s';
    s.textContent = sub;
    this.banner.appendChild(t);
    this.banner.appendChild(s);
    this.banner.classList.remove('sh-show');
    void this.banner.offsetWidth;
    this.banner.classList.add('sh-show');
    window.clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => this.banner.classList.remove('sh-show'), ms);
  }

  setLockHint(text: string): void {
    this.lockHint.textContent = text;
    this.lockHint.classList.toggle('sh-show', text.length > 0);
  }

  /** 飘字（击杀得分等），sx/sy 为屏幕像素坐标 */
  floatText(text: string, sx: number, sy: number, cls = ''): void {
    const d = document.createElement('div');
    d.className = `sh-float ${cls}`;
    d.textContent = text;
    d.style.left = `${sx}px`;
    d.style.top = `${sy}px`;
    this.root.appendChild(d);
    window.setTimeout(() => d.remove(), 900);
  }

  // ------------------------------------------------------------ 界面切换 ---

  showStart(): void {
    this.startScreen.classList.remove('sh-hidden');
    this.pauseScreen.classList.add('sh-hidden');
    this.overScreen.classList.add('sh-hidden');
  }
  hideStart(): void {
    this.startScreen.classList.add('sh-hidden');
  }
  showPause(): void {
    this.pauseScreen.classList.remove('sh-hidden');
  }
  hidePause(): void {
    this.pauseScreen.classList.add('sh-hidden');
  }
  showGameOver(score: number, best: number, isNewBest: boolean): void {
    this.overScore.textContent = `得分 ${score}`;
    this.overBest.textContent = isNewBest ? '新纪录！' : `最高 ${best}`;
    this.overScreen.classList.remove('sh-hidden');
  }
  hideGameOver(): void {
    this.overScreen.classList.add('sh-hidden');
  }

  dispose(): void {
    this.root.remove();
  }
}
