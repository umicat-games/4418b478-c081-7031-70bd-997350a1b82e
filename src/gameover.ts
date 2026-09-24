import { readoutPlate } from './hud';

/**
 * 一局结束：把这局发生了什么摆出来，再给一条往下走的路。
 *
 * **没有这个对话框的时候，一局结束是什么都不发生。** 角落那行字从
 * 「0:47 Lv3 击杀 62」变成「倒下了 · 0:47 · 3 级 · 击杀 62」，然后世界就停在
 * 那儿 —— 玩家看着一屏还在飘的敌人，没有任何东西告诉他这局已经完了，更没有
 * 任何办法再来一局，除非重新加载页面。
 *
 * **结束必须是一个事件，不是一个状态。** 这个项目在别处也记过同一条：终局是
 * 对话框，不是角落里改一行字。
 */

export interface RunSummary {
  /** 撑了多少秒。 */
  clock: number;
  level: number;
  kills: number;
  /** 这局捡的金币，和账上一共有多少。 */
  gold: number;
  totalGold: number;
  /** 赢了（撑满全程）还是倒下了。 */
  won: boolean;
  /** 历史最好成绩，用来说明这局是不是新纪录。 */
  bestClock: number;
  bestKills: number;
}

export interface GameOverOpts {
  /** 停住世界并关掉输入 —— 和升级面板同一个理由。 */
  pause(on: boolean): void;
  restart(): void;
  /** 只有宿主在的时候才有得返回；独立打开时这个是 `null`，按钮也不画。 */
  exit: (() => void) | null;
  press?(): void;
}

export interface GameOver {
  readonly open: boolean;
  show(s: RunSummary): void;
  dispose(): void;
}

const mmss = (t: number): string =>
  `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

export function createGameOver(opts: GameOverOpts): GameOver {
  let open = false;

  const layer = document.createElement('div');
  layer.dataset.gameover = '';
  // 和升级面板一样要在平台控件层（z-index 10）之上，否则画得出来点不到。
  layer.style.cssText = `position:fixed; inset:0; z-index:60; display:none;
    align-items:center; justify-content:center; background:rgba(6,10,14,.72);
    padding:14px; font:500 14px/1.45 system-ui,sans-serif; color:#fff;`;

  const card = document.createElement('div');
  card.style.cssText = 'width:min(460px,96vw); max-height:92svh; overflow:auto;';
  layer.append(card);
  document.body.append(layer);

  const close = (): void => {
    if (!open) return;
    open = false;
    layer.style.display = 'none';
    opts.pause(false);
  };

  const button = (label: string, primary: boolean, go: () => void): HTMLButtonElement => {
    const b = document.createElement('button');
    b.style.cssText = `flex:1; padding:13px 16px; border:0; border-radius:14px;
      cursor:pointer; font:800 15px/1.2 system-ui; min-width:0;
      background:${primary ? '#fff' : 'rgba(255,255,255,.14)'};
      color:${primary ? '#10151c' : '#fff'};`;
    b.textContent = label;
    b.addEventListener('click', () => { opts.press?.(); go(); });
    return b;
  };

  return {
    get open() { return open; },
    show(s) {
      open = true;
      opts.pause(true);
      card.textContent = '';

      const head = document.createElement('div');
      head.style.cssText = 'font:800 22px/1.3 system-ui; text-align:center;';
      head.textContent = s.won ? '撑满了十五分钟' : '你倒下了';

      const time = document.createElement('div');
      time.style.cssText = `font:800 42px/1.1 system-ui; text-align:center;
        margin:6px 0 12px; font-variant-numeric:tabular-nums;`;
      time.textContent = mmss(s.clock);

      // 新纪录**只在真的破了的时候**出现。每局都挂一行「最好 x:xx」是背景噪音，
      // 而破纪录是这个游戏唯一跨局累积的成就感。
      if (!s.won && s.clock > s.bestClock) {
        const rec = document.createElement('div');
        rec.style.cssText = `text-align:center; margin:-8px 0 12px;
          font:800 13px/1.4 system-ui; color:#ffd45c;`;
        rec.textContent = `新纪录（上次 ${mmss(s.bestClock)}）`;
        card.append(head, time, rec);
      } else {
        card.append(head, time);
      }

      const rows = document.createElement('div');
      rows.style.cssText = `display:grid; grid-template-columns:1fr 1fr;
        gap:8px; margin-bottom:14px;`;
      const stat = (k: string, v: string): HTMLElement => {
        const d = document.createElement('div');
        d.style.cssText = `background:rgba(255,255,255,.08); border-radius:12px;
          padding:9px 12px;`;
        const a = document.createElement('div');
        a.style.cssText = 'opacity:.6; font-size:12px;';
        a.textContent = k;
        const c = document.createElement('div');
        c.style.cssText = 'font:800 18px/1.3 system-ui; font-variant-numeric:tabular-nums;';
        c.textContent = v;
        d.append(a, c);
        return d;
      };
      rows.append(
        stat('等级', `Lv${s.level}`),
        stat('击杀', String(s.kills)),
        stat('本局金币', String(s.gold)),
        // 金币是跨局的，所以「一共」这一格是它现在唯一能起的作用 ——
        // 在有地方花之前，至少它得看起来在累积。
        stat('金币总数', String(s.totalGold)),
      );

      const bar = document.createElement('div');
      bar.style.cssText = 'display:flex; gap:8px;';
      bar.append(button('再来一局', true, () => { close(); opts.restart(); }));
      // 独立打开（没有宿主）时不画返回 —— SDK 的原话：与其给一个按了没反应的
      // 控件，不如不给。
      if (opts.exit) bar.append(button('返回 Umicat', false, () => opts.exit?.()));

      card.append(readoutPlate(rows, bar));
      layer.style.display = 'flex';
    },
    dispose() { close(); layer.remove(); },
  };
}
