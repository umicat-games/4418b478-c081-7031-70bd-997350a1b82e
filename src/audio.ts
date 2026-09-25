/**
 * 这个游戏的声音：用哪几个 clip、多响、多久才允许再响一次。
 *
 * Web 音频里所有难的部分 —— 用 Web Audio 而不是 `<audio>` 元素（四十个
 * `HTMLAudioElement` 曾把一个游戏拖到 iPhone 上 11fps，静音就回到 60）、
 * 手势解锁、异步的 `resume()`、iOS 在切后台时挂起音频上下文 —— 现在都在
 * SDK 的 `GameAudio` 里。每个 3D 游戏都需要这一整套，而且没有一个失败模式
 * 会出现在创作者看得到的地方。
 *
 * **这张表是按这个游戏重写过的，不是从 Balaboo 搬过来的那张。** 原来那张
 * 有二十八个 clip，塔防的炮、闸门、建造、村庄音乐全在里面 —— 搬过来再
 * 注释掉，下一个读代码的人会以为它有用；而且 `GameAudio` 在第一次手势里会
 * 把表里每个文件都去拉一遍，留着就是白付的流量。
 *
 * **在这个类型里，一个没有 `throttle` 的 clip 就是 bug。** 已经量过：一次性
 * 杀死 25 / 100 / 400 只，实际播放的音效都是 **1 个** —— 挡住它的正是
 * `throttle`。`GameAudio` 每次 `play()` 建一个 `BufferSource` + 一个
 * `GainNode`，除了按 clip 的节流之外**没有任何总量上限**，而这个游戏后段
 * 每秒死三十只。
 */
import { GameAudio, type AudioClipSpec } from '@umicat/three-sdk';

const CLIPS: Record<string, AudioClipSpec> = {
  // 打中和打死。**一次事件一个声音，按结果选**：没死放 `hit-enemy`，死了放
  // `enemy-die`（Balaboo 的规则，照搬）。
  //
  // 两个都卡得很死：后段每秒几十次命中，节流之外的每一次都是纯粹的浪费 ——
  // 玩家也分辨不出第三十只和第三十一只。170ms 意味着命中声最多每秒 5.9 次，
  // 加上死亡声的 7.7 次，乱战里是一层稳定的底噪而不是一串可数的响声。
  //
  // 命中声**比死亡声轻一半**：它是垫在下面的质感层，死亡才是要被听见的事件。
  // 这个比例是按耳朵定的，真机上值得再听一遍 —— 无头浏览器跑不满帧，量出来的
  // 「每秒几声」比真机低。
  'hit-enemy': { volume: 0.22, throttle: 170 },
  'enemy-die': { volume: 0.4, throttle: 130 },
  // 三把要开火的武器各有自己的声音，这样"我刚才放了什么"是听得出来的。
  // 节流略大于各自的冷却，免得一次齐射响三声。
  'cannon-shot': { volume: 0.32, throttle: 200 },                        // 追踪弹
  'fire-magic-wand-sound-effect.mp3': { volume: 0.4, throttle: 500 },    // 前向冲击
  // 链式闪电。用的是 `magic-attack-sound.mp3` **裁过头的那一版**。
  //
  // 玩家报的是「显示已经放完了，音效还在播」，而**根因不是"太长"，是"慢起"**。
  // 量一下包络就看见了：原始 clip 前 0.4 秒几乎无声，最响的地方在 0.6~0.9 秒
  // —— 而画面那道弧 0.4 秒就没了。声音的冲击落在画面**之后**，于是两边对不上。
  //
  //     原始：  0.0s ▁ 0.2s ▂ 0.4s ▃ 0.6s ██ 0.8s ██ 1.0s ▅ 1.4s ▁ 2.0s ▁
  //     裁完：  0.0s ▅ 0.2s ██ 0.4s ██ 0.6s ▅ 0.8s ▁
  //
  // 所以砍掉开头那 0.40 秒、留 1.30 秒、尾部 0.15 秒淡出（`ffmpeg`）。
  // **一个瞬发动作的声音，冲击必须在开头。** 画面那边的寿命也拉到了 0.8 秒，
  // 两边同时开始、同时结束。
  //
  // 音量照旧是量出来的：裁完「最响那四分之一」的 RMS 是 0.2181，而基准（旧的
  // lightning clip）是 0.2769 @ 0.42 —— 0.42 × (0.2769/0.2181) ≈ 0.53。
  //
  // 原始文件留在 `public/audio/magic-attack-sound.mp3`，没动。
  'magic-attack.mp3': { volume: 0.53, throttle: 400 },                     // 链式闪电
  // 挨打。**这个不能节流得太狠** —— 它是玩家唯一一个"我正在掉血"的耳朵信号，
  // 而被围住的时候屏幕上全是敌人，血条在角落里。
  'hero-hurt': { volume: 0.6, throttle: 420 },
  coin: { volume: 0.22, throttle: 120 },
  upgrade: { volume: 0.6 },
  'ui-press': { volume: 0.55, throttle: 60 },
  'victory-sound.mp3': { volume: 0.62 },
  lose: { volume: 0.7 },
};

export const MUSIC = { level: 'bgm-level.mp3' } as const;

/** 名字按**事件**起，不按文件名 —— 调用处该读起来像发生了什么事。 */
export const SFX = {
  /** 打中了但没打死。打死了放 `kill`。 */
  hit: 'hit-enemy',
  kill: 'enemy-die',
  bolt: 'cannon-shot',
  shock: 'fire-magic-wand-sound-effect.mp3',
  chain: 'magic-attack.mp3',
  hurt: 'hero-hurt',
  gem: 'coin',
  levelUp: 'upgrade',
  uiPress: 'ui-press',
  victory: 'victory-sound.mp3',
  lose: 'lose',
} as const;

/**
 * 按钮底下的那一声 —— 以及**为什么一局里第一次按下是哑的**。
 *
 * `GameAudio` 在第一次手势里才建上下文、才开始拉所有 clip（它的 `start()`
 * 是私有的，游戏没法更早预热）。所以就在那一次手势上，还没有任何解码好的
 * 缓冲区，`play()` 什么都不放。
 *
 * 重试的方案试过又拿掉了，它做不安全：延迟要同时盖住一次 fetch 和一次
 * decode，`setTimeout` 在跑 3D 场景的页面上漂得厉害，而一次落在节流窗口
 * 外的重试会让**每一个普通按钮响两声**（实测：一次按下两个 buffer）。
 * 何况按下 500ms 之后的一声本来也不算反馈。
 *
 * 真正的修法是 SDK 开一个通用的 `preload()`。
 */
export const createAudio = (): GameAudio =>
  new GameAudio({ clips: CLIPS, base: 'audio/', music: MUSIC.level, musicVolume: 0.28 });
