/**
 * 游戏 HUD：全部挂在 #hud 的子元素上。
 * 平台规范：绝不写 hud.textContent（会清空平台的触屏控件层）。
 */
import './hud.css';
import { t, getLang, setLang, supportedLangs, langDisplayName } from './i18n';

export interface HudCallbacks {
  onStart: () => void;
  onResume: () => void;
  onRestart: () => void;
  /** 玩家换了语言。调用方重写自己拥有的文字（横幅之类不归 HUD 管的）。 */
  onLangChange?: () => void;
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
  // 需要在切语言时重写的静态文字。都存成字段而不是就地写死，因为
  // 「支持两种语言」的意思是能换，而不是启动时挑一次。
  private hpLabel!: HTMLElement;
  private startTitle!: HTMLElement;
  private startSubtitle!: HTMLElement;
  private startDesc!: HTMLElement;
  private startBtn!: HTMLButtonElement;
  private controls!: HTMLElement;
  private pauseTitle!: HTMLElement;
  private pauseDesc!: HTMLElement;
  private resumeBtn!: HTMLButtonElement;
  private overTitle!: HTMLElement;
  private restartBtn!: HTMLButtonElement;
  private langBtn!: HTMLButtonElement;
  private startScreen: HTMLElement;
  private pauseScreen: HTMLElement;
  private overScreen: HTMLElement;
  private overScore: HTMLElement;
  private overBest: HTMLElement;
  private startBest: HTMLElement;
  private bannerTimer = 0;

  /** 这台机器是不是触屏。决定标题界面上写哪一套控件说明 —— 在手机上
   *  报「WASD 移动」是在描述一块不存在的键盘。 */
  private readonly touch: boolean;

  constructor(cb: HudCallbacks) {
    this.touch = 'ontouchstart' in window && !window.matchMedia?.('(pointer: fine)').matches;
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
    this.hpLabel = el('div', 'sh-hp-label', hpWrap);
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
    this.reloadTip.textContent = t('reload_tip');

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
    this.startTitle = el('div', 'sh-title', startCard);
    this.startSubtitle = el('div', 'sh-subtitle', startCard);
    this.startDesc = el('div', 'sh-desc', startCard);
    const startBtn = el('button', 'sh-btn', startCard) as HTMLButtonElement;
    this.startBtn = startBtn;
    startBtn.addEventListener('click', cb.onStart);
    this.controls = el('div', 'sh-controls', startCard);
    this.startBest = el('div', 'sh-start-best', startCard);
    // 语言开关。放在标题界面上，因为那是唯一一个玩家有空读字的地方 ——
    // 战斗中弹一个语言菜单，等他选完人已经死了。
    this.langBtn = el('button', 'sh-lang', startCard) as HTMLButtonElement;
    this.langBtn.addEventListener('click', () => {
      const all = supportedLangs();
      setLang(all[(all.indexOf(getLang()) + 1) % all.length]);
      this.retext();
      cb.onLangChange?.();
    });
    this.startScreen = start;

    // 暂停界面
    const pause = el('div', 'sh-overlay sh-hidden', root);
    const pauseCard = el('div', 'sh-card', pause);
    this.pauseTitle = el('div', 'sh-title-sm', pauseCard);
    this.pauseDesc = el('div', 'sh-desc', pauseCard);
    const resumeBtn = el('button', 'sh-btn', pauseCard) as HTMLButtonElement;
    this.resumeBtn = resumeBtn;
    resumeBtn.addEventListener('click', cb.onResume);
    this.pauseScreen = pause;

    // 结算界面
    const over = el('div', 'sh-overlay sh-hidden', root);
    const overCard = el('div', 'sh-card', over);
    this.overTitle = el('div', 'sh-title-sm', overCard);
    this.overScore = el('div', 'sh-over-score', overCard);
    this.overBest = el('div', 'sh-over-best', overCard);
    const restartBtn = el('button', 'sh-btn', overCard) as HTMLButtonElement;
    this.restartBtn = restartBtn;
    restartBtn.addEventListener('click', cb.onRestart);
    this.overScreen = over;

    this.retext();
  }

  /** 重写每一条静态文字。
   *
   *  构造时调一次，之后每次换语言再调 —— 这是「换语言」和「启动时挑一种
   *  语言」之间的全部区别。会变的动态文字（波次、分数、弹药）由它们各自的
   *  setter 负责，下一帧自然就是新语言了。 */
  retext(): void {
    this.hpLabel.textContent = t('hp');
    this.reloadTip.textContent = t('reload_tip');
    this.startTitle.textContent = t('title');
    this.startSubtitle.textContent = t('subtitle');
    this.startDesc.textContent = t('blurb');
    this.startBtn.textContent = t('start');
    // `innerHTML`，因为这条串里有个 `<br>` —— 控件说明分两行读起来才不费劲。
    // 串是本文件作者写的，不是玩家输入。
    this.controls.innerHTML = this.touch ? t('controls_touch') : t('controls_desktop');
    this.pauseTitle.textContent = t('paused');
    this.pauseDesc.textContent = t('paused_desc');
    this.resumeBtn.textContent = t('resume');
    this.overTitle.textContent = t('game_over');
    this.restartBtn.textContent = t('restart');
    // 按钮上写的是「切过去会变成哪种语言」，不是当前语言 —— 一个写着
    // 「中文」的按钮在中文界面上，没人知道按下去会发生什么。
    const all = supportedLangs();
    this.langBtn.textContent = langDisplayName(all[(all.indexOf(getLang()) + 1) % all.length]);
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
    this.reloadTip.textContent = reloading ? t('reloading') : t('reload_tip');
  }

  setWave(n: number, left: number): void {
    this.waveText.textContent = t('wave_n', { n });
    this.enemiesText.textContent = left > 0 ? t('enemies_left', { n: left }) : t('clearing');
  }

  /** 波间休整倒计时 */
  setIntermission(secondsLeft: number): void {
    if (secondsLeft > 0.05) {
      this.enemiesText.textContent = t('next_wave_in', { s: Math.ceil(secondsLeft) });
    }
  }

  setScore(score: number, best: number): void {
    this.scoreText.textContent = `${score}`;
    this.bestText.textContent = t('best', { best });
  }

  setStartBest(best: number): void {
    this.startBest.textContent = best > 0 ? t('best_ever', { best }) : '';
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
    this.overScore.textContent = t('score_n', { score });
    this.overBest.textContent = isNewBest ? t('new_best') : t('best', { best });
    this.overScreen.classList.remove('sh-hidden');
  }
  hideGameOver(): void {
    this.overScreen.classList.add('sh-hidden');
  }

  dispose(): void {
    this.root.remove();
  }
}
