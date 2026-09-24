import { Game } from './game/game';

/**
 * 《星港防线 STARHOLD》—— 空间站波次生存 FPS。
 *
 * 启动顺序（平台硬性规范）：
 *   ThreeUmicat.init() -> RAPIER.init() -> 读场景/manifest ->
 *   loadScene3D -> 游戏逻辑。见 game/game.ts。
 *
 * 调试：?autopilot=1 进入自动试玩模式（bot 接管视角与开火，
 * 跳过开始界面），配合 window.__game 做自动化验证。
 */
async function start(): Promise<void> {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  await Game.create(canvas);
}

void start().catch((err) => {
  // 启动失败要说出来，而不是留一块黑画布
  const hud = document.getElementById('hud');
  if (hud) {
    const d = document.createElement('div');
    d.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#ff8080;background:#0a0d16;font-size:16px;padding:24px;text-align:center;';
    d.textContent = `启动失败：${String(err)}`;
    hud.appendChild(d);
  }
  console.error('[starhold] 启动失败', err);
});
