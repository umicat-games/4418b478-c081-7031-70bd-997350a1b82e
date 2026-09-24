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
  // 打中和打死。两个都卡得很死：后段每秒几十次，节流之外的每一次都是
  // 纯粹的浪费 —— 玩家也分辨不出第三十只和第三十一只。
  // 只给追踪弹的命中用 —— 别的武器的命中**没有声音**，理由见 `main.ts`。
  'hit-enemy': { volume: 0.26, throttle: 140 },
  'enemy-die': { volume: 0.4, throttle: 130 },
  // 三把要开火的武器各有自己的声音，这样"我刚才放了什么"是听得出来的。
  // 节流略大于各自的冷却，免得一次齐射响三声。
  'cannon-shot': { volume: 0.32, throttle: 200 },                        // 追踪弹
  'fire-magic-wand-sound-effect.mp3': { volume: 0.4, throttle: 500 },    // 前向冲击
  'lightning-magic-wand-sound-effect.mp3': { volume: 0.42, throttle: 400 }, // 链式闪电
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
  hit: 'hit-enemy',
  kill: 'enemy-die',
  bolt: 'cannon-shot',
  shock: 'fire-magic-wand-sound-effect.mp3',
  chain: 'lightning-magic-wand-sound-effect.mp3',
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
