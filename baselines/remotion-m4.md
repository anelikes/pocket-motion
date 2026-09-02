# Remotion 本机基准 — Apple M4

> 执行日期：2026-08-12 · 与 [`hyperframes-m4.md`](hyperframes-m4.md) 同机、同口径

reel 第 3 镜里那根 `Remotion · 1 worker` 的条来自这里。**不是引用官方数字，也不是估算。**

## 机器与环境

| 项 | 值 |
| --- | --- |
| CPU | Apple M4，10 核（4 性能 + 6 能效） |
| Remotion | 4.0.508（`@remotion/cli`、`@remotion/renderer`） |
| Node | v22.22.2 |
| 浏览器 | Chrome Headless Shell **149.0.7790.0**（Remotion 自行下载） |
| ffmpeg | Remotion 自带 n7.1 |
| 并发 | `--concurrency=1` |

## 素材：smoke composition 的忠实移植

对照的不是 Remotion 的模板，而是 **PocketJS Motion 自己那条 5.75 ms/帧 的 composition**
（`compositions/smoke/app.tsx`）逐元素移植到 React：同样的 1920×1080 / 30 fps / 450 帧，
同样的版式，同样四个动作（pulse、spin、ping、280° 环形扇区）。源码在
[`remotion-bench/`](remotion-bench/)。

这比 HyperFrames 那组对照更严格：那一组是「同类内容」（§ `phase0-acceptance.md` 已标注口径），
这一组是**同一份内容**。

移植时的一个刻意选择：所有运动值都由 `useCurrentFrame()` 推导，也就是 Remotion 的惯用写法。
那些逐帧 JS 正是 PocketJS Motion 不做的工作，所以它应当计入对比，而不是被绕开。

## 结果（3 次，取中位）

```
npx remotion render src/index.ts Smoke out.mp4 --concurrency=1
```

| 次 | wall |
| --- | ---: |
| 1 | 25.19 s |
| 2 | 22.15 s |
| 3 | 23.56 s |

**中位 23.56 s ÷ 450 帧 = 52.36 ms/帧**

含编码，wall-clock 端到端 —— 与另外两个数字口径一致。

## 三条并排

| | ms/帧 | 并行 | 内容 |
| --- | ---: | --- | --- |
| Remotion | **52.36** | 1 worker | smoke composition 的 React 移植 |
| HyperFrames `nyt-graph` | 38.19 | 1 worker | GSAP 数据可视化（同类，非同一份） |
| **PocketJS Motion** | **5.75** | 1 thread | smoke composition |

- 对 Remotion **9.1×**
- 对 HyperFrames **6.6×**

reel 的圆环里放的是 **6.6×**，也就是对**较快**的那一家的比值。把 9.1× 放上去、
让观众自己发现还有个更小的数字，方向是反的。

## 口径说明

- Remotion 与 PocketJS Motion 是**同一份 composition**；HyperFrames 那一组仍是同类内容而非同一份。
- 三者都在同一台机器、同一分辨率、同一并发下测量，这也是它们能放进同一张图的唯一理由。
- 第 1 次运行明显偏慢（25.19 s），是冷启动；取中位而非最小值。
