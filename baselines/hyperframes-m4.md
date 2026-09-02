# HyperFrames 本机基准 — Apple M4

> 执行日期：2026-08-11 · 与 HyperFrames 的单帧对照

## 机器与环境

| 项 | 值 |
| --- | --- |
| CPU | Apple M4，10 核（4 性能 + 6 能效） |
| ffmpeg | 8.0（Homebrew） |
| HyperFrames | `hyperframes-main` @ 本地 checkout |
| Chrome | `~/.cache/puppeteer/chrome-headless-shell/mac_arm-148.0.7778.97`（puppeteer 想要的 150 下载失败，回落到缓存的 148） |
| 捕获模式 | **screenshot**（非 beginframe，见下方caveat） |

## 素材

`registry/examples/nyt-graph` —— 1920×1080 / 15 s / 450 帧 / 30 fps，GSAP 驱动的数据可视化图表。
选它的原因：分辨率与时长贴近目标规格，内容落在目标甜蜜点（motion graphics + 数据可视化），且不含视频轨道。

**必要的预处理**：本机网络对 `cdn.jsdelivr.net` 返回 **403**，GSAP 加载失败会让渲染静默降级（无动画，产物仅 38 KiB）。
已把 GSAP 从 unpkg 下载到本地并改写 `<script src>`，产物变为 214 KiB —— 动画确实在跑。
Google Fonts 仍走网络（200 OK），是残留的方差来源。

## 结果（每档 3 次，取中位）

| 配置 | workers | 中位 wall | **ms/帧** | capture avg | peak RSS |
| --- | ---: | ---: | ---: | ---: | ---: |
| 30fps · standard · auto | 10 | 14,488 ms | **32.20 ms** | 20 ms | 275 MB |
| 30fps · standard · 1 worker | 1 | 17,186 ms | **38.19 ms** | 36–47 ms | 344 MB |

原始逐次：
```
auto : 14488 / 16372 / 13663 ms   (capture avg 20 ms/帧)
1w   : 21350 / 17186 / 16270 ms   (capture avg 47 / 38 / 36 ms/帧)
```

分阶段（第一次运行，ms）：
```
auto : compile 471  capture 12410 (frame 9112 + setup 3298)  encode 1531  assemble 44
1w   : compile 191  capture 21111 (frame 21102)              encode 21100 assemble 46
```

## 三个结论

### 1. HyperFrames 官方数字在本机复现了

官方 `docs/guides/performance.mdx` 声称 1920×1080 / 300 帧 / 9.8 s = **32.7 ms/帧**。
本机实测 auto workers 下 **32.20 ms/帧**——几乎完全一致。**性能宣称的对照基准成立。**

### 2. 并行扩展性很差：10 workers 只比 1 worker 快 1.19×

17,186 → 14,488 ms。原因从分阶段能看出来：
- 纯捕获从 21.1 s 降到 9.1 s（2.3×）
- 但多付了 3.3 s 的 `captureSetupMs`（10 个浏览器实例的启动）
- 且 M4 是 4 性能核 + 6 能效核，后者慢得多

**含义**：拿"HyperFrames 有全核并行"来抵消单线程差距是站不住的——它的并行本身效率就很低。

### 3. 单线程对单线程，是最诚实的口径

| | ms/帧 | 并行度 |
| --- | ---: | --- |
| HyperFrames nyt-graph 1080p | **38.19** | 1 worker |
| HyperFrames nyt-graph 1080p | **32.20** | 10 workers |
| PocketJS 50 元素 1080p（光栅化） | 4.32 | 1 线程 |
| PocketJS 实拍+20 叠加 1080p | 9.24 | 1 线程 |

- 单线程 vs 单线程：**PocketJS 快 4.1×–8.8×**
- PocketJS 单线程 vs HyperFrames 全 10 核：**快 3.5×–7.5×**

## Caveats（必须随数字一起引用）

1. 🔴 **macOS 强制 screenshot 捕获模式。** `packages/producer/src/services/renderOrchestrator.ts:847`：
   ```ts
   return forceScreenshot || platform !== "linux" ? "screenshot" : "beginframe";
   ```
   **`HeadlessExperimental.beginFrame` 只在 Linux 启用。** 本次测的是 HyperFrames 在 macOS 上的回落路径。
   Linux + beginframe 可能更快——**这个数字未测**（本机 Docker daemon 未运行）。
   官方文档那个 32.7 ms 与本机 macOS 数字吻合，暗示 beginframe 未必快很多，但这只是暗示，不能当结论。

2. 🟡 **内容不同。** nyt-graph（GSAP 数据可视化）vs PocketJS 合成基准（N 个圆角盒 / 瓦片素材）。
   不是同一份工作量。**真正的头对头需要同一段内容**——`remotion-m4.md` 那一组才是同一份
   composition，这一组不是。

3. 🟡 **口径不同。** PocketJS 的数字是纯光栅化（不含编码）；HyperFrames 的是端到端。
   不过 auto workers 下 encode 只占 1,531 ms / 14,488 ms ≈ 10%。
   更可比的口径是 capture-only：HyperFrames 单 worker **36–47 ms/帧** vs PocketJS **4.32–9.24 ms/帧**。

4. 🟢 Google Fonts 走网络，残留方差。

---

## 追加：Linux 测试（2026-08-11）—— beginframe 在 Apple Silicon 上**不可达**

用仓库自带的 `Dockerfile.test`（`node:22-bookworm-slim` + 预装 chrome-headless-shell 148）跑了同素材同口径。

### 结果（容器内 nproc=10，Linux aarch64）

| 配置 | workers | 中位 wall | ms/帧 | capture avg |
| --- | ---: | ---: | ---: | ---: |
| 30fps · standard · auto | 10 | 25,140 ms | 55.87 | 28 ms |
| 30fps · standard · 1 worker | 1 | 20,542 ms | **45.65** | 41 ms |

### 但它**没有**跑到 beginframe

```
[BrowserManager] Browser launched (Chrome/151.0.7922.108, screenshot,
                 headlessShell=false, platform=linux)
```

原因在 HyperFrames 自己的代码里，而且是**刻意**的（`packages/engine/src/services/browserManager.ts`）：

```ts
const CACHED_HEADLESS_SHELL_EXECUTABLES = {
  "darwin/arm64": [...], "darwin/x64": [...],
  "linux/x64":    ["chrome-headless-shell-linux64", "chrome-headless-shell"],
  "win32/ia32":   [...], "win32/x64": [...],
};   // ← 没有 linux/arm64
```

> **Chrome for Testing does not publish Linux ARM64 binaries.** ... so both hosts deliberately
> fall through to system browser discovery instead of attempting a potentially foreign cached binary.

实测印证：Dockerfile 装出来的 `linux_arm-148.0.7778.167/` 里其实是 **x86_64 的 ELF**（内层目录名就叫 `chrome-headless-shell-linux64`），在 ARM64 上直接跑不起来：

```
rosetta error: failed to open elf at /lib64/ld-linux-x86-64.so.2
Trace/breakpoint trap
```

### 结论：beginframe 的可达性矩阵

| 宿主 | 捕获模式 | 原因 |
| --- | --- | --- |
| macOS（任意架构） | **screenshot** | `platform !== "linux"` 平台门（`renderOrchestrator.ts:847`） |
| Linux **ARM64** | **screenshot** | Chrome for Testing 无 ARM64 构建，解析器刻意回落 |
| Linux **x86_64** | **beginframe** | 唯一可达路径 |

**在 Apple Silicon 上，beginframe 无论如何都不可达**——不是我的测试环境问题，是架构事实。
要测它需要真实的 x86_64 Linux（`--platform linux/amd64` 会走 QEMU 模拟，计时无意义）。

### 这个"失败"的实验其实很有价值

它把宣称的**适用人群**精确化了：我们的 macOS 基准对**整个 macOS + ARM Linux 群体**有效。
考虑到 Graviton / Ampere 这类 ARM 服务器正因成本被广泛采用，这个群体不小。

beginframe 只在 x86_64 Linux 上帮到 HyperFrames——**那是唯一还没测的场景**。

### ⚠️ 一个需要回补的 confound

Linux 这次日志里有：

```
static-frame dedup: 175/450 frame(s) reusable (39%, verified)
[static-dedup] reused 175/450 frame(s) (39%), est. ~11025ms saved
```

**HyperFrames 会跳过重复帧**——这次省了 39%。macOS 那次的日志我没保留这一行，
若 macOS 未触发 dedup，则两组之间不可直接比较（macOS 做了更多实际工作）。
**不影响与 PocketJS 的对比结论**（两者都远慢于 4.32–9.24 ms/帧），但要回补确认。

- [ ] 回补：确认 macOS 那次是否触发 static-frame dedup
- [ ] x86_64 Linux 上的 beginframe（需要真实 x86 机器）
- [ ] Phase 0 完成后：同一段内容的真正头对头
