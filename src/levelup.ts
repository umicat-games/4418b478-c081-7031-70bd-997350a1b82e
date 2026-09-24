import { readoutPlate } from './hud';

/**
 * 升级：暂停，给三个选项，选一个。
 *
 * **它必须暂停。** 这个类型里升级是一局中唯一一次「思考」的机会 —— 其余时间
 * 全部注意力都在走位上。不暂停的话玩家会在被围着的时候胡乱点一个，那就不是
 * 选择，是带菜单的反射。
 *
 * **三个选项，不是全部。** 把所有可选项摊开就变成了一张表，玩家会去算最优解；
 * 三个是一个**处境**：你手上有什么、缺什么、这三个里哪个补得上。
 *
 * 满了之后不再出新东西只出升级 —— 否则后期的三选一会全是你拿不到的东西。
 */

export interface Offer {
  id: string;
  title: string;
  /** 一句话说它**做什么**，不是它叫什么。
   *
   *  名字只对已经懂这个游戏的人有意义 —— Balaboo 那边的原话是「我打开了它，
   *  没有任何东西告诉我发生了什么变化」。 */
  body: string;
  /** 已经强化过几次。满级的不再出现。 */
  level: number;
  max: number;
  /** 这一项**现在还没有**（选了才第一次出现在游戏里）。
   *
   *  只有它能挂「新」。第一版是拿 `level === 0` 当「新」，于是「吸引」和
   *  「疾行」这种一开局就有、只是还没强化过的东西也顶着「新」—— 玩家会
   *  以为自己在开一样没见过的东西，拿到手才发现是把已有的数值往上推。 */
  isNew?: boolean;
  take(): void;
}

export interface LevelUp {
  readonly open: boolean;
  show(level: number, offers: Offer[]): void;
  dispose(): void;
}

export interface LevelUpOpts {
  /** 停住世界，并且**关掉输入** —— 平台的触屏控件是一整层盖在 DOM 上的，
   *  不关的话按钮点不到，点下去的是它背后的移动区。 */
  pause(on: boolean): void;
  press?(): void;
}

export function createLevelUp(opts: LevelUpOpts): LevelUp {
  let open = false;

  const layer = document.createElement('div');
  layer.dataset.levelup = '';
  // z-index 要在平台那层（10）之上，否则面板画得出来却点不到。
  layer.style.cssText = `position:fixed; inset:0; z-index:60; display:none;
    align-items:center; justify-content:center; background:rgba(6,10,14,.66);
    padding:14px; font:500 14px/1.45 system-ui,sans-serif; color:#fff;`;

  const card = document.createElement('div');
  card.style.cssText = 'width:min(560px,96vw); max-height:92svh; overflow:auto;';
  layer.append(card);
  document.body.append(layer);

  const close = (): void => {
    if (!open) return;
    open = false;
    layer.style.display = 'none';
    opts.pause(false);
  };

  return {
    get open() { return open; },
    show(level, offers) {
      open = true;
      opts.pause(true);
      card.textContent = '';

      const head = document.createElement('div');
      head.style.cssText = 'font:800 19px/1.4 system-ui; text-align:center; margin-bottom:10px;';
      head.textContent = `升到 ${level} 级`;

      const rows = document.createElement('div');
      rows.style.cssText = 'display:flex; flex-direction:column; gap:8px;';
      for (const o of offers) {
        const b = document.createElement('button');
        b.style.cssText = `display:flex; gap:12px; align-items:center; text-align:left;
          width:100%; padding:12px 14px; border:0; border-radius:14px; cursor:pointer;
          background:rgba(255,255,255,.1); color:#fff; font:inherit;`;
        const text = document.createElement('div');
        text.style.cssText = 'flex:1; min-width:0;';
        const t = document.createElement('div');
        t.style.cssText = 'font:800 15px/1.4 system-ui;';
        // 「新」和「强化 2」是两件不同的事，玩家要一眼分得出「我在开一样
        // 没有过的东西」还是「我在加深已有的」。
        t.textContent = o.isNew && o.level === 0
          ? `${o.title}　新` : `${o.title}　强化 ${o.level + 1}`;
        const d = document.createElement('div');
        d.style.cssText = 'opacity:.72; font-size:13px;';
        d.textContent = o.body;
        text.append(t, d);
        b.append(text);
        b.addEventListener('click', () => { opts.press?.(); o.take(); close(); });
        rows.append(b);
      }

      card.append(readoutPlate(head, rows));
      layer.style.display = 'flex';
    },
    dispose() { close(); layer.remove(); },
  };
}
