# 《我是造物主》技术基线 v1.1（判定树与性能预算已冻结）

> 专业域：技术架构 / 构建与性能｜版本：**v1.1-FROZEN** · 2026-10-26｜作者：柯桥良（技术架构总监）
> **冻结范围**：§4 契约表（§5 判定树 10 序，序 2 关停）与 §4 性能预算 P1–P11。冻结依据：`decisions.md` D11（绳不实装）。
> 冻结后如需变更，走变更单并同步 game-design-director（阈值一变，关卡可解性判据跟着变）。
> §5 判定树版本号：**`S8-v1.1-FROZEN`**（引用时用此号）。
> 上游已定稿（不推翻）：`decisions.md` D1/D2/D3、`levels.md`（9 关 / 24 能力 / 附录 A·B）、`research.md` 第三节开源复用清单。
> 本文只出方案，**不含游戏代码、不建工程、不装依赖**。阶段 2 由主程序施工，本文为验收基线。
> 数值写法：`X [待实测标定]` = 需要实机调参，本文不写死。**本轮所有库体积为 2026-10-26 unpkg 实测字节数**。

## 0. 前提假设（假设变了结论重估）

| # | 假设 | 若不成立的后果 |
|---|---|---|
| A1 | 交付 = 单个 `.html`，双击可玩、断网可跑、零外部请求 | 若必须走 CDN/多文件，第 2 节构建策略与第 4 节首交互预算全部重写 |
| A2 | 目标 = 手机竖屏优先，P0 机型为 2020 年 Android 中端机 + iPhone 8 | 若只跑桌面，物理/渲染预算可放宽 2 倍，DPR cap 可取消 |
| A3 | 无后端、无账号、无网络；进度存 localStorage | 若需云存档，需新增网络层与隐私合规，6 天内不可行 |
| A4 | 4 个库均为 MIT，可内联分发（需保留版权声明注释） | 若换成 GPL 库，单文件分发需附完整源码，交付形态变化 |
| A5 | 团队 = 1 人主程序 + 兼职美术/文案；6 天工期 | 若只有 3 天，砍到关 1–3 + 沙盒占位 |
| A6 | 引擎中立不需要选型（Web 是既定交付形态），本节不讨论 Unity/Godot/UE | — |

---

## 1. 技术选型结论表

| 层 | 选型 | 版本（锁定） | 实测体积 | 理由 | 不选替代的理由 |
|---|---|---|---|---|---|
| 渲染 | **Canvas 2D**（1 张主 canvas + 1 张离屏静态层） | 浏览器原生 | 0 | rough.js 直接输出 Canvas2D 路径；手绘线条本质是描边+填充，无光照/后处理需求；DPR cap 2 后填充率可控 | WebGL(PixiJS/three)：多 60–600KB，手绘描边无 GPU 收益，shader 调试吃掉半天工期；SVG/DOM：每帧重排，手机必卡 |
| 物理 | **matter-js** | `0.20.0` | 83,476 B (min) | MIT；运行时可增删刚体与复合 body(`Body.create({parts})`)；`Engine.update` 支持固定步长；自带 `Body.setStatic/setDensity` 覆盖 24 能力里的质量类改写 | planck.js(Box2D)：需 Fixture 重建才能改材质，运行时增删成本高，体积约为 matter 的 1.4 倍；自研：6 天不可能 |
| 凹多边形拆凸 | **poly-decomp** | `0.3.0` | 5,609 B (min) | MIT；matter 官方配套（`Common.setDecomp`），与 `Bodies.fromVertices` 直接对接 | 自己写 ear-clipping：可跑但在自交/共线顶点上必崩，不值得省 5.5KB |
| 笔迹 | **perfect-freehand** | `1.2.3` | 4,638 B（CJS 源，需 bundle） | MIT；压感轮廓决定"落笔像不像真在画"；输出点集可直接喂给描边 | 纯 `lineTo`：无压感、转折处断裂，观感差一个档；粉笔/毛笔滤镜：体积更大且不可控 |
| 手绘风格 | **roughjs** | `4.6.6` | 27,762 B（ESM，需 bundle） | MIT；抖动/双线/纸张质感一次性解决背景与 UI 框 | 手写抖动算法：省 25KB 但需要调试 seed 与线条重叠，工期不允许 |
| 音频 | **自研 WebAudio**（约 200 行：噪声+滤波器包络+五声音阶垫） | 原生 API | 0 | research 第三节已定"零音频文件"；只需 6 个音色 + 1 条垫音 | Tone.js（14.8k★）：min 后约 150KB+，为 6 个音色引入整套调度器属于过度工程；howler：需要文件，直接排除 |
| 语音 | **`speechSynthesis`** + `getVoices()` 探测 + 强制降级 | 原生 API | 0 | research D4 已定；只能用于情绪高点 | 云 TTS：需网络与密钥，违反 A1/A3 |
| 存储 | **localStorage**（键前缀 `ic_`），不可用时退内存 | 原生 API | 0 | 只存关卡进度与设置（<2KB） | IndexedDB：异步成本对 2KB 数据无意义 |
| 构建 | **esbuild**（单二进制，零配置）+ 自写 `tools/build.mjs` 内联 | esbuild 精确版本写入 devDependencies | — | 唯一职责：把 4 个 CJS/ESM 库打成 IIFE + 把 app 打成 IIFE；esbuild 是**单文件二进制**，无插件链、无 dev server、无 node_modules 树 | webpack/vite：配置与插件链的维护成本远超"拼 6 段字符串"；rollup：能实现但要手写配置文件与多份 plugin，等价功能 esbuild 一条命令行；纯手写拼接：rough 与 perfect-freehand **没有 UMD 构建**（实测只有 CJS/ESM），手工改源码不可维护 |
| 测试 | Node 原生 `node:test` + 无头断言（阶段 4 由 QA 出） | 原生 | 0 | 几何/分类/能力组合是纯函数，可脱离浏览器测 | Jest/Vitest：为 20 条断言引入一套运行时 |

**许可证义务**：4 个库内联进单文件时，必须保留各自的 MIT 版权声明，集中放在产物末尾一个 `<script type="text/plain" id="licenses">` 块内（不入执行路径，不影响体积上限判定，但便于审计）。

---

## 2. 单文件构建策略

**源码组织**：`src/` 下全用原生 ESM（`import`/`export`），不写打包器专属语法、不用 TS、不用 JSX。

**构建三步**（全部由 `node tools/build.mjs` 一个命令完成）：

| 步 | 动作 | 产出 |
|---|---|---|
| B1 | esbuild 把 4 个 vendored 库分别打成 IIFE + globalName：`MATTER` / `decomp` / `rough` / `getStroke` | `dist/_vendor.js`（min，约 105KB [估算]） |
| B2 | esbuild 把 `src/main.js` 打成 IIFE（`bundle:true, minify:true, target:'es2019'`） | `dist/_app.js` |
| B3 | 读 `template/index.html`，把 `<!--__VENDOR__-->` / `<!--__APP__-->` / `<!--__LICENSES__-->` 三个占位符替换为内联 `<script>`（**用函数式 replace，禁止用 `$&` 语义的字符串替换，否则代码里的 `$` 会被吃掉**） | `dist/game.html` + 根目录 `index.html` |

**构建命令**（构建脚本内部调用 esbuild API，用户只需一条）：

```bash
node tools/build.mjs          # 完整构建
node tools/build.mjs --check  # 只跑断言，不写文件
```

**构建后强制断言**（`tools/check-single-file.mjs`，不通过则 exit 1，不许发布）：

| 断言 | 判据 |
|---|---|
| 零外链 | 产物中 `https?://`、`src=`/`href=` 指向外部、`fetch(`、`XMLHttpRequest`、`import(` 动态导入 → 命中数 = 0（MIT 声明块除外） |
| 体积 | ≤ 600,000 B（硬门禁，见第 4 节） |
| 单文件自足 | 产物中 `<script src` / `<link rel="stylesheet"` 出现次数 = 0 |
| 无 sourcemap 引用 | `sourceMappingURL` 命中 = 0 |

**产物去向 / git 策略**：

| 路径 | 内容 | 进 git | 说明 |
|---|---|---|---|
| `dist/` | `game.html`、中间 `_vendor.js`/`_app.js` | **排除**（.gitignore） | 纯构建输出，可复现，不进版本库 |
| `index.html`（根） | `dist/game.html` 的副本 | **进** | 唯一例外：赛事/Pages 需要仓库根即可直接跑；它由构建脚本生成，每次构建覆盖 |

> 若后续确认赛事按 Star 排名（research 第五节待确认项），根 `index.html` 进 git 即可满足"仓库可跑"；不需要额外发布流程。

---

## 3. 目录骨架

```
我是造物主/
├─ docs/                       设计/技术文档（本文所在）
├─ src/                        ★ 可复跑源（ESM，进 git）
│  ├─ main.js                  入口：装配模块、启动主循环
│  ├─ core/
│  │  ├─ loop.js               rAF 主循环 + 固定步长累积器
│  │  ├─ bus.js                事件总线（能力钩子挂这里）
│  │  ├─ state.js              关卡状态机 / 造物槽
│  │  ├─ storage.js            localStorage + 内存降级
│  │  └─ perf.js               PerfGovernor / 降级仲裁（见第 4 节契约）
│  ├─ stroke/                  ★ 独创部分：笔画 → 几何
│  │  ├─ capture.js            指针采样、pointer capture、防误触
│  │  ├─ simplify.js           RDP 简化 / 去重 / 抽稀
│  │  ├─ geometry.js           周长、包围盒、面积、重心、孔洞、自交检测
│  │  └─ classify.js           形态判定决策树（附录 A）
│  ├─ physics/
│  │  ├─ world.js              matter 引擎封装 / 步长 / NaN 守卫
│  │  ├─ body-factory.js       点集 → 复合刚体（含 poly-decomp）
│  │  ├─ materials.js          质量/摩擦/弹性基线值与乘数
│  │  └─ budget.js             BodyBudget 刚体配额
│  ├─ abilities/
│  │  ├─ registry.js           24 个能力的纯数据定义
│  │  ├─ compose.js            组合裁定器（相位/优先级/确定性顺序）
│  │  └─ combos.js             组合查表（怕痒+变硬 等）
│  ├─ level/
│  │  ├─ schema.js             关卡数据结构校验
│  │  ├─ runtime.js            机关原型：压板/感光/咬合/沙漏（D3 R3）
│  │  └─ levels/ch1-01.js …    9 个关卡数据文件
│  ├─ render/
│  │  ├─ canvas.js             canvas 尺寸 / DPR cap / 静态层缓存
│  │  ├─ handdrawn.js          rough.js 封装 + 质量分级
│  │  └─ hud.js                能力芯片 / 提示阶梯 / 文字气泡
│  ├─ audio/
│  │  ├─ sfx.js                程序合成音效
│  │  ├─ bgm.js                五声音阶垫
│  │  └─ voice.js              speechSynthesis + 探测 + 降级
│  └─ text/
│     ├─ lines.js              台词表（≤18 字标记哪些可朗读）
│     └─ namer.js              修饰词+名词 匹配 / 兜底吐槽
├─ vendor/                     ★ 4 个库的锁定源码快照（进 git，供离线构建）
├─ template/index.html         ★ 唯一 HTML 模板（占位符在 B3 被替换）
├─ tools/                      ★ 生成器，**永不放进 dist/**
│  ├─ build.mjs                B1–B3
│  └─ check-single-file.mjs    四条断言
├─ tests/                      ★ 阶段 4 QA：node:test 纯函数断言（不进产物）
│  ├─ geometry.test.mjs
│  ├─ classify.test.mjs
│  └─ abilities.test.mjs
├─ dist/                       × git 排除（构建产物）
└─ index.html                  √ 发布产物副本（唯一进 git 的生成物）
```

**两条硬规则**（不满足即为架构违规）：

1. **源与产物分目录**：`src/` `vendor/` `template/` `tools/` `tests/` 全部不在产物内；`dist/` 只由 `tools/build.mjs` 写入。
2. **生成器不在产物目录**：`tools/*.mjs` 一旦出现在 `dist/` 或被打进 HTML，构建断言直接失败。

**现在就要做 vs 到那一步再说**：

| 现在（阶段 2，必须一次做对） | 到那一步再说（不许提前做） |
|---|---|
| `core/` `stroke/` `physics/` `abilities/` 四层骨架 + 构建脚本 | 美术资源管线（本作零素材文件） |
| 关卡 `schema.js` + 4 类机关原型 | 章节转调 BGM 编排 |
| 静态层缓存与 DPR cap | 沙盒模式（复用同一系统，通关后再接） |
| 关 1–3 内容 | 关 7–9 的沙漏/审计员演出 |

---

## 4. 性能预算

**目标机型（判定基准）**

| 级别 | 机型定义 | 用途 |
|---|---|---|
| P0-a | Android 中端：骁龙 665 / 720G 级、4GB RAM、2020 年主流机，Chrome 120+ 与微信 XWeb 双测 | 预算判定机（不达标即不发布） |
| P0-b | iPhone 8（A11 / 2GB）Safari 16+ | 崩溃与帧率下限判据 |
| P1 | 桌面 Chrome（开发自测） | 只作对照，不作为达标依据 |

视口与画布：CSS 像素上限 430×932；`canvas.width = cssW × min(devicePixelRatio, 2)`（**DPR 硬 cap 2**，iPhone DPR=3 时省 55% 填充率）。

**最坏场景定义（用来卡预算，不是平均场景）**

关 8「断层」+ 复制能力 + 岩浆弹回 + 怕痒持续冲量：
- 顶层刚体 ≤ 24（含复制后的 3 个造物 + 机关动态件）
- 物理 parts 总数 ≤ 80（单造物拆凸 ≤ 8 块 × 6 槽位 + 机关）
- 约束（`Constraint`，绳/焊点）≤ 40
- 同时活跃接触对 ≤ 40
- 屏上笔迹：0（全部已转刚体）；绘制路径 ≤ 100 条/帧
- rough 抖动填充（hachure）：关闭（动态体只描边）

**固定步长**

| 项 | 值 | 依据 |
|---|---|---|
| 物理固定步长 | 16.667 ms（`1/60 s`） | matter 变步长会让叠放/堆叠抖动，必须定步长 |
| 单帧最大子步 | 3 | 掉帧到 20fps 仍保持真实时间 |
| 累积时间上限 | 50 ms，超出丢弃 | 切后台回来不许"追帧"造成一次性 10 步爆卡 |
| 实现 | `acc += dt; steps = min(3, floor(acc/16.667)); for(;steps--;) Engine.update(engine, 16.667); acc -= steps*16.667` | — |

**单帧预算分配（16.67 ms @60fps）**

| 段 | 预算 | 说明 |
|---|---|---|
| 物理（`Engine.update` × k） | ≤ 6.0 ms | 最坏场景 80 parts / 40 约束 |
| 渲染：静态层 blit | ≤ 1.0 ms | 背景预渲染成离屏 canvas，画完不再重画 |
| 渲染：造物+机关 | ≤ 5.0 ms | ≤100 路径，描边为主 |
| 笔迹重绘 | ≤ 1.5 ms | 只重画当前未提交笔画 |
| 输入+逻辑+GC 余量 | ≤ 2.0 ms | — |
| 合计 | 15.5 ms（余量 1.17 ms） | — |

**预算表（每行含：数值目标 / 测量方式 / 超阈处置）**

| # | 指标 | 数值目标（P0） | 测量方式 | 超阈处置（类型 · 触发点 · 执行者） | 归类依据 |
|---|---|---|---|---|---|
| P1 | 帧时间 p90 | ≤ 16.7 ms（等价 p90 ≥ 55fps） | `core/loop.js` 内：每帧 `performance.now()` 差入环形缓冲，每 120 帧统计 p50/p90；`?debug=1` 显示 HUD | **自动降级**：连续 120 帧 p90 > 16.7ms → `PerfGovernor.setTier('low')`，该函数内一次执行 `RenderQuality.setFill(false)` + `RenderQuality.setShadow(false)` + `PhysicsWorld.setSubSteps(1)`；降级后 300 帧仍超 → `BodyBudget.setMax(40)`（拒绝新造物，旧造物保留） | 有运行时机制，走降级 |
| P2 | 物理段耗时 | ≤ 6.0 ms/帧 | `loop.js` 中以 `performance.now()` 夹住 `Engine.update` 循环，取最大值；HUD 显示 | **自动降级**：连续 30 帧 physicsMs > 6.0 → `PhysicsWorld.setSubSteps(1)` | 与预算同阈值（6.0 对 6.0），无缓冲带 |
| P3 | 渲染段耗时 | ≤ 6.0 ms/帧（blit 1.0 + 造物 5.0） | 同上，夹住 `Renderer.draw` / 自绘函数 | **自动降级**：连续 30 帧 drawMs > 6.0 → `RenderQuality.setFill(false)`；再连续 60 帧 > 6.0 → `RenderQuality.setShadow(false)` + 单造物拆凸上限 8 → 4 | 同上 |
| P4 | 动态刚体数 | 顶层 ≤ 24，parts ≤ 80 | `BodyBudget.count()` 在 `world.js` 每次 spawn 前查询 | **自动降级**：`BodyBudget.trySpawn()` 返回 `false` 时不生成新刚体，改为在落点放静态轮廓贴图 + 播"造物簿满了"音效与台词（不阻塞玩家） | 有配额函数，走降级 |
| P5 | 采样点上限 | 单笔 ≤ 400 点 | `StrokeBudget.push(pt)` 计数 | **自动降级**：达 400 点后改为 2 点取 1 抽稀，不丢笔画 | 同上 |
| P6 | JS 堆内存 | ≤ 120 MB（Safari 200MB 崩溃线的 60%） | 手动：Chrome DevTools Performance Monitor / Safari Web Inspector，在关 8 最坏场景驻留 60 s 读数 | **门禁卡点**：发布前主程序记录读数，> 120MB 不许发版；QA 在阶段 4 复测 | 浏览器无可靠运行时降级 API（`performance.memory` 仅 Chrome、粒度粗、无法触发释放），故无降级动作 |
| P7 | 单文件体积 | ≤ 600,000 B 未压缩（gzip ≤ 200,000 B 建议值） | `tools/check-single-file.mjs` 断言 | **门禁卡点**：`node tools/build.mjs` 中该断言失败 → exit 1，不产出 `index.html`；主程序必须裁库或删内容后才可发布 | 体积在加载前就固定，运行时无法缩小，天然无降级 |
| P8 | 外部请求数 | 0 | 构建断言（第 2 节）+ 发布前 F12 Network 计数 | **门禁卡点**：断言命中即构建失败；Network 面板非 0 时 QA 拒收 | 同 P7 |
| P9 | 首次可交互时间 | ≤ 2.5 s（P0-a，4G） | 手动：`performance.now()` 打点 `boot→第一帧→首次 pointerdown 可被响应`；线上链接冷加载测 3 次取中位 | **门禁 + 一次性降级**：首帧 > 1200 ms 时 `Boot.skipIntro()`（跳过开场 3s 眼睛动画，直接进造物簿）；> 2.5s 记门禁不通过 | 只有一次启动，无持续运行时机制；仅开场可省，故以门禁为主 |
| P10 | 电池/降频后帧率 | ≥ 30 fps | 手动：P0-a 机连续玩 8 分钟后读数 | **门禁卡点**：QA 记录，< 30fps 视为不达标，主程序须削减最坏场景 | 无可靠降级信号（无 Battery API 支持面），列入门禁 |

**接口契约（主程序必须按此名实装；未实装则对应预算条目自动降级为门禁，不得声称"已绑定降级"）**

| 函数 | 签名 | 责任 |
|---|---|---|
| `PerfGovernor.sample(dtMs, physicsMs, drawMs)` | `→ void` | 每帧末调用，维护环形缓冲与降级仲裁 |
| `PerfGovernor.setTier(t)` | `'high'｜'mid'｜'low'` | 统一降低画质/物理负载（幂等，可多次调用） |
| `RenderQuality.setFill(on)` | `bool` | 开关 rough hachure 填充 |
| `RenderQuality.setShadow(on)` | `bool` | 开关投影/双层描边 |
| `PhysicsWorld.setSubSteps(n)` | `1..3` | 改单帧最大子步 |
| `BodyBudget.trySpawn()` | `→ bool` | 刚体配额准入 |
| `BodyBudget.setMax(n)` | `int` | 动态降配 |
| `StrokeBudget.push(pt)` | `→ bool` | 采样点准入 |
| `Boot.skipIntro()` | `→ void` | 首帧过慢时跳过开场动画 |
| `NaNGuard.sweep(engine)` | `→ void` | 每 10 帧扫一遍 position/velocity，非有限值即移除该 body（防物理爆炸） |
| `PhysicsWorld.freezeChain(creature)` | ~~`→ Body`~~ **不在 v1** | ⚠️ v1 不施工（D11：绳不实装）。阶段 3 若重启绳再补此契约；规格仍留在 §5「绳+变硬」表，**但那是阶段 3 的参考，不是 v1 的验收项** |
| `AudioBus.unlockMedia()` | `→ void` | 音频与语音的**唯一**解锁点（首次 `pointerdown` 内调用）；幂等。解锁前：`speak` 丢弃；`play` **排队 ≤3 条（只排 `pendown`/`spawn`），解锁后一次性放出**（否则第一笔没声音，评审会判"声音没做"） |
| `AudioBus.play(sfxId, opts)` | `{score?, material?, x?}` | 唯一播放入口。`x` = 立体声定位，**P2 可砍**；同一时刻带 panner 的 SFX ≤ 2，`collide`/`pendown` 永不加 panner（高频音叠 pan 听不出、白烧节点）。**游戏层禁止 `new AudioContext`** |
| `AudioBus.speak(lineId)` | `lineId` | 语音；不可用时静默返回（文字气泡由调用方先行渲染，语音失败不得影响文本，**不许等语音就绪再出字**） |
| `AudioBus.setEnabled(on)` | `bool` | 声音开关（BGM+SFX+语音一起停，不留单边）。**实现用 `suspend()`/`resume()`（保节点图），不用 `stop()`**——`stop()` 会拆图，重开必须重建全部源节点，是"关一次声音音乐再也不响"的成因。`stop()+disconnect()` 只留给单次 SFX 播完自清理。`resume()` 被拒（iOS 需手势）时**不报错、保持 suspended、等下次 `pointerdown`** |
| `AudioBus.setVolume(bus, v)` | `'bgm'｜'sfx'｜'voice'`, `0..1` | **P1 才实装**（P0 只做 `setEnabled` 总开关 + 语音单独开关） |
| `AudioBus.setKey(rootHz, modeId?)` | `Hz`, **数字** `0=宫 1=羽 2=…` | **换根音 + 重选音阶**的唯一入口；`modeId` 用数字不用字符串（第 2 章羽↔宫每 4 小节翻转，数字可直接当索引） |
| `PhysicsWorld.onImpact(cb)` | `cb({score, material, bodyId})` | **每 rAF 帧最多回调 1 次**，取本帧（含全部子步）内 `score` 最大的一条。方向：音频在 boot 时**订阅一次**（`PhysicsWorld.onImpact(fn)`），数据流为物理→音频；物理侧不 import `AudioBus` |

> 说明：本项目为 0 代码起步，以上函数**尚不存在**，是本文定义的契约。主程序必须在阶段 2 按此名落地，QA 阶段 4 用 `grep` 校验函数存在且阈值一致（`6.0` / `120 帧` / `400 点` / `600000` 等常量必须与本文数值逐字对上）。

---

## 5. 形状判定管线

**总流程**：`pointerdown → 采样 → 冻结 → 简化 → 闭合检测 → 几何属性 → 形态分类 → 刚体生成 → 注册能力槽`

| # | 步骤 | 输入 | 输出 | 失败处理 | 阈值 |
|---|---|---|---|---|---|
| S1 | `pointerdown` 起笔 | PointerEvent | `Stroke{ id, ptrType, pts:[{x,y,p,t}], t0 }` | `pointerType==='touch'` 且非 `isPrimary` → 丢弃（双指误触）；`e.button` 非主键 → 丢弃 | 起笔前 `setPointerCapture`，`touch-action:none` |
| S2 | 采样 | `pointermove` | 追加点 | 单帧 > 20 个 move 事件（高回报率笔）→ 每帧最多取 4 个点 | 与上一点距离 ≥ **2 CSS px** [待实测标定] 才追加；点数上限 400（超则抽稀） |
| S3 | 冻结 | `pointerup` / `pointercancel` / 2 s 无输入 | `Stroke.closed=false` 候选 | `pointercancel` → 视为抬起，正常冻结（不丢弃玩家笔画） | 静默超时 **2000 ms** [待实测标定] |
| S4 | 简化 | 原始点集 | 折线（节点数 ≤ 120） | 节点数 < 3 且总长 < 8px → 走 S9「单点」 | RDP ε = **1.2 CSS px** [待实测标定]；同时去掉共线点 |
| S5 | 闭合检测 | 折线 | `closed:bool` + 归一化首尾（合并为一点） | 首尾距临界（0.9–1.1 倍容差）→ **判闭合**（宁可判闭合，闭合后仍能落进团块兜底） | 首尾距 ≤ `max(8px, 0.18 × min(bboxW,bboxH))` [待实测标定] |
| S6 | 几何属性 | 折线 | `{perimeter, bbox{w,h}, aspect=max/min, area|Shoelace|, centroid, holes:[], strokeGroup}` | 面积 ≈ 0 → 按线段处理（梁候选）；`aspect` 分母为 0 → 视为 1 | 重心：闭合用多边形形心公式，开笔画用点均值；孔洞：某完整闭合笔画的所有点都在本多边形内 → 记 1 孔 |
| S7 | 自交检测 | 折线（简化后 n ≤ 120） | `selfIntersect:bool` | **命中即不再尝试修形**：直接用凸包（`decomp.makeCCW` + `decomp.quickDecomp`）兜底，并置 `stroke.selfIntersect=true` 供台词使用（"你这个结……"） | O(n²) 线段相交，n ≤ 120 → 7140 次比较，< 0.2 ms；**不做**交点分割（工程量 ≫ 收益） |
| S8 | 形态分类 | 几何属性 + 同组笔画数 | `form: 'beam'|'wheel'|'blob'|'container'|'rope'|'pile'|'grain'` | 任何分支未命中 → **兜底 `blob`**（附录 A 铁律） | 见下方判定树 |
| S9 | 单点/极小 | 点数 ≤ 2 或总长 < 8px 或 area < 60 px² | 不生成刚体 | 落点画一个墨点 + 纸响音效，**不消耗造物槽**，不出错误提示 | 总长 **8 px** [待实测标定]；面积 **60 px²** [待实测标定] |
| S10 | 拆凸 | 点集（CSS px → 物理世界单位，缩放 1:1） | 凸块数组 ≤ 8 | 拆出 > 8 块 → 取面积前 8；拆出 0 块/decomp 抛错 → `Bodies.fromVertices` 退化到矩形 bbox；矩形也失败 → 圆形 | 拆块上限 **8** [待实测标定] |
| S11 | 刚体生成 | 凸块数组 + `form` 基线材质 | `Body`（复合）+ `strokeId` | 任一块顶点 < 3 → 丢弃该块；全部丢弃 → 走 S9 不生成 | 质量 = 面积 × 密度（`materials.js` 基线，密度 [待实测标定]） |
| S12 | 注册能力槽 | `Body` + 本关能力池 | `Creature{ body, form, abilities:[], mods:{} }` | 能力数 > 2 → 拒绝第 3 个并抖动芯片 + 台词 | 单造物能力上限 **2** |

**形态判定决策树（顺序即互斥，先命中先出）**：若不按顺序，附录 A 的「梁（未闭合）」与「颗粒（闭合+小面积）」会互相抢。

| 序 | 条件 | 形态 |
|---|---|---|
| 1 | 组内笔画数 ≥ 3 且各笔画首尾互不相邻 | `pile` 松散堆 |
| 2 | 组内笔画数 ≥ 2 且相邻笔画端点距 ≤ 闭合容差 **且 aspect ≤ 6** | `rope` 绳 |
| 2b | 组内笔画数 ≥ 2 且相邻笔画相连 **且 aspect > 6** | `beam` 梁（`stitched:true`：接缝处画一道铅笔接痕，供台词「你这是两笔接的，我看见了」） |
| 3 | 闭合 且 孔洞数 ≥ 1 且 孔面积 > 0.15 × 外面积 | `container` 容器 |
| 4 | 闭合 且 area < 60 px² | `grain` 颗粒 |
| 5 | 闭合 且 aspect ≤ 1.5 | `wheel` 轮 |
| 6 | 闭合 且 1.5 < aspect ≤ 3 | `blob` 团块 |
| 7 | 闭合 且 aspect > 3 | `blob`（长闭合：不允许判梁，否则玩家画个长圈能白拿梁） |
| 8 | 未闭合 且 aspect > 6 | `beam` 梁 |
| 9 | 其余 | `blob` 兜底 |

**为什么加 2b（关 1 可解性硬约束）**：双笔首尾相接 + 细长（aspect > 6）在几何上就是一根梁，判绳会让"两笔画的玩家"拿到一条会垂的链条，而关 1 面板只有「变硬」一个芯片。**判梁是让玩家占便宜在「兜底也能过」上，不能让在「投机白嫖」上**——所以细长双笔判梁，但保留 `stitched:true` 让接缝可见、台词可点，视觉上仍暴露"它是两笔"，不抹掉玩家的操作痕迹。

**「绳 + 变硬」的承载规则（关键，决定关 1 是否软性死路）**

| 项 | 结论 |
|---|---|
| 只调 constraint `stiffness → 1` 能否承载 | **不能**。matter-js 的约束是**铰接（pin joint）**，没有角度限位。自由度算一下：N 段绳 = N 个刚体 + (N−1) 个铰，每刚体 3 自由度、每铰约束掉 2 → `3N − 2(N−1) = N + 2` 自由度；**12 段绳 ≈ 14 个自由度**，是机构不是结构。`stiffness` 只影响求解器"追赶目标长度"的力度，不消除自由度，横向受压/受弯必屈曲折叠。**禁止**用调 stiffness 冒充"变硬" |
| 正确实现 | 变硬作用于 `form==='rope'` 时，触发 **复合刚体重建** `PhysicsWorld.freezeChain(creature)`：移除全部 `Constraint` → 取每段的世界顶点 → `Body.create({ parts })` 合成单个复合刚体（matter 中同一 body 的 parts 互不碰撞，天然自洽）→ 保留原 `position/angle/velocity`。之后它是一块硬质折带，可承重 |
| 边界情况 | 若硬化时链条已经下垂（玩家投放后落定才点芯片）→ 冻结成"下垂的硬折带"，形态难看但**能走**（两端搭岸即有支撑）。**不做自动拉直**（拉直等于篡改玩家形状，违反 D2"只读形状"）；台词兜一句「它现在是一条很没精神的桥」 |
| 代价 | 新增 1 条代码路径约 30 行；不可逆（硬化后不能再回软，本作无撤销需求，可接受） |
| 段数上限 | 绳每 **24 CSS px** 一段 [待实测标定]，单条绳 ≤ 12 段；超出则加长段长而非加段数（保护性能预算 P4） |

> **【已定 · D11 · 2026-10-26】绳不在 v1 实装**
> 裁定：`ENABLE_ROPE=false`，不写 `freezeChain`，`P4 parts 上限维持 80`（不提 96、不压 loose pile）。判定树保留完整 10 序，跳过序 2，两笔相连直接落 `blob` 兜底。
> 依据：设计侧 grep 确认 9 关无任何必需路径/演出/台词依赖绳；绳 = 零必需内容 + 72 parts 顶满 80 + matter 铰接链低子步必抖 + 四类人眼调参，同时成立时不该进 6 天工期的 v1。
> 可解性：两笔相连 → 团块 + 变硬 = 垫脚石（正是关 1 解法②），9 关零影响。
> 下表「绳+变硬」规格**保留但仅作阶段 3 重启时的参考**，v1 不验收。

**阈值初始猜测值汇总（全部 `[待实测标定]`，须用真人手绘样本回归，不许用几何理想值）**

| 参数 | 初值 | 标定方法（由谁在哪阶段） |
|---|---|---|
| 采样距离 | 2 CSS px | 主程序阶段 2，桌面曲线 + 手机各 20 笔 |
| RDP ε | 1.2 CSS px | 同上，看轮廓保真 |
| 闭合容差 | `max(8px, 0.18×短边)` | 主程序阶段 2，30 个真人"故意不闭合"样本 |
| 梁长宽比阈值 | 6.0 | 主程序阶段 2，关 1 通关样本 |
| 轮/团块分界 | 1.5 | 同上 |
| 团块/长闭合分界 | 3.0 | 同上 |
| 颗粒面积 | 60 px² | 主程序阶段 2，避免"点一下出个颗粒" |
| 单点拒判长度 | 8 px | 同上 |
| 容器孔面积比 | 0.15 | 主程序 + QA 阶段 4 |
| 拆凸块上限 | 8 | 主程序阶段 2，配合性能预算 P4 |

---

## 6. 能力系统的工程结构

**原则**：24 个能力 = **24 条纯数据记录**，不含 `if-else` 分支；作用通过三种机制施加：

| 机制 | 用途 | 施加时机 |
|---|---|---|
| `mods` | 静态物理属性改写（质量/摩擦/弹性/透明/密度） | 造物生成时一次性 `applyMods`，可重复计算（幂等） |
| `hooks` | 事件钩子（碰撞、每 tick、接触） | 运行时按 `order` 升序，确定性排序 |
| `flags` | 行为开关（`noCut`/`conductor`/`emitsSound`/`emitsLight`） | 供其它系统读取（渲染、机关、AI） |

**数据结构示例**

```js
// abilities/registry.js —— 纯数据，无函数式 if-else
export const ABILITIES = {
  harden: {
    id: 'harden', name: '变硬', chapter: 1,
    layer: 'material',        // material | motion | sense | meta
    priority: 10,             // 同层冲突，数值小者胜
    mods: { restitution: 0.02, friction: 0.9, bendFactor: 0, densityMul: 1 },
    flags: { rigid: true },
    hooks: {},
    onApply: (ctx) => {                       // 只在"需要改物理拓扑"时用，空实现即纯数值改写
      if (ctx.creature.form === 'rope') ctx.world.freezeChain(ctx.creature);  // 见 §5「绳+变硬」
    },
    tags: ['structural'],
    conflicts: [],            // 与哪些能力互斥（同属性冲突时按 priority 裁，不硬禁）
  },
  tickle: {
    id: 'tickle', name: '怕痒', chapter: 2,
    layer: 'motion', priority: 20,
    mods: {},
    flags: { bounceOnContact: true },
    hooks: {
      collisionStart: {
        order: 100,
        fn: (ctx, ev) => {                        // ctx = { creature, world, rng }
          const n = ev.normal;
          const J = ctx.creature.mods.impulseBase * (ctx.creature.flags.rigid ? 1.8 : 1.0);
          Body.applyForce(ctx.creature.body, ctx.creature.body.position,
            { x: -n.x * J, y: -n.y * J });
        },
      },
    },
    tags: ['trap'],
    conflicts: [],
  },
  // …其余 22 个同构
};
```

**组合生效顺序规则（必须确定性，否则玩家复现不了）**

| 序 | 规则 |
|---|---|
| R1 | **层优先**：先 `material` → `motion` → `sense` → `meta`。质量/摩擦改完才轮到冲量，冲量不会被质量改写反向污染 |
| R2 | **同层冲突**：`priority` 小者胜，覆盖失败方的那条 `mods` 键；被覆盖时在台词里点名（"变硬盖过了滑"），把冲突变成笑点 |
| R3 | **数值可交换**：`densityMul` 用乘算（0.2 × 3 = 3 × 0.2），`impulseBase` 用加算，保证结果与芯片点选顺序无关 |
| R4 | **同 order 决胜**：按 `id` 字典序，禁止依赖对象键插入顺序 |
| R5 | **单造物上限 2**；第 3 个被拒（抖动 + 台词），关 9 "只能选 2" 是同一规则的自然结果，不写特例 |
| R6 | **组合查表**：`combos.js` 以 `[a,b].sort().join('+')` 为键，O(1)；命中时叠加 `comboBonus`（数值倍数）并解锁专属台词 |
| R7 | **钩子不得改几何**：能力只改物理参数与行为，不许改 `parts` 顶点（否则拆凸失效、复现困难）。**唯一例外**：`onApply` 允许改**拓扑**（`freezeChain` 把绳的 N 段约束合成复合刚体），但顶点一律取原值，不许位移 |

**两能力组合的逐帧执行序列（怕痒 + 变硬，关 4 弹射板）**

| 时机 | 发生什么 |
|---|---|
| 生成 | `applyMods`：harden 先写入 `restitution 0.02 / friction 0.9 / bendFactor 0`；tickle 的 `mods` 为空，只置 `flags.bounceOnContact` |
| 生成末 | `compose` 查 `harden+tickle` → 命中 combo，`comboBonus.impulseMul = 1.8`，台词入队 |
| 每帧 tick | 无 hook（两个能力都不需要 tick）→ 零额外开销 |
| 首次 `collisionStart`（小人踩上 / 石台碰边） | matter 触发事件 → `bus` 按 `order`（仅 1 个钩子）→ `tickle.fn` 读 `impulseBase × 1.8`，沿接触法线反方向 `Body.applyForce` 一次，并置 `cooldownUntil = t + 120ms` [待实测标定] 防每帧连弹 |
| 视觉 | `flags.rigid` → rough 描边用直边（不抖动），与"软东西乱弹"形成反差，暗示"它不变形" |

> 24 能力的 `impulseBase` / 半径 R / 间隔 N / 质量倍数 全部 `[待实测标定]`（对接 levels.md 附录 B），阈值表在 `materials.js` 集中，禁止散落在钩子里。

**系统性推论：`变轻` 对"弹射类"能力天然无效（这是设计刻意保留的对照组，不是 bug）**

| 事实 | 后果 |
|---|---|
| 冲量统一为 `J = k × mass` ⇒ `Δv = k` 与质量无关 | 对「怕痒 / 会跳 / 记仇」这类弹射，**`densityMul` 不改变弹射速度** |
| 因此 `变轻 + 怕痒` 的观感与只贴 `怕痒` **完全一致** | 设计侧已把它定为**关 4 的"对照组"**：证明"配对不是随便贴两个，得贴对" |
| QA 注意 | **不要把这个 no-op 报成"能力叠加失效"**——它是刻意行为（A 裁定 `k×mass` 的直接推论），且承担教学功能 |
| 变轻仍然有效的地方 | 重力下落的慢速、被风场/上升气流推动、惯性（碰撞后被推走的距离）——**不是"弹得更高"** |

**能力 × 形态适用性（不做这张表，能力会被写成"对所有形态都生效"的隐性 bug）**

| 能力 | 适用形态 | 实现约束 |
|---|---|---|
| 1 变硬 | 全部 | 只改 `mods`。`rope` 分支（`freezeChain`）**v1 不存在**（D11），阶段 3 重启时再启用 |
| 2 变轻 / 4 变重 | 全部 | 只改 `densityMul`，不改体积（体积变了会让已搭好的桥穿插） |
| 16 无限长 | `beam` / `blob` | **`rope` 不生效**（`appliesTo: ['beam','blob']`）。绳受 12 段上限，无限长会让玩家以为能把绳拉成藤蔓；生效时会突破 P4 的 parts 预算 |
| 17 复制 | 全部 | **复制体继承"除复制本身以外的另一枚能力"**（`黏`/`变硬`/… 必须继承，否则"复制+黏"的三块台阶不焊接，关 7 解法② 与关 9 阶段三同时失效）。爆炸风险由**「不触发链式复制」**挡住（复制体不再生成复制体），**不靠"不继承能力"来挡** |
| 5 怕痒 | 全部 | 冲量**正比于自身质量**（`impulse = k × mass`），等价于给一个**固定 Δv**，与造物面积无关。**已裁定采用此式（A 方案）**，否决 `mass^0.7`：面积 2 倍差下 `mass^0.7` 会给约 **19%** 的 Δv 差，足以让"画得大"的玩家弹不上四倍高台——那是软性死路；而"重物也弹一样高"最多是观感略怪，怪不卡关（风险不对称）。关 4 ① 与关 9 阶段三 ① 都依赖这条 |
| 18 时间慢 | 全局刚体 | **沙漏等非刚体对象不受影响**（D3 R1 裁定）；实现为遍历 `Composite.allBodies` 调速，沙漏是纯定时器对象，天然不在其中 |

**「复制」的生成参数（间距是解法成败的关键，不许主程序随手选值）**

**归属（D13 治理要求）**：**间距由设计给定，实现只负责标定**——主程序不得自行选择排列方向与间距系数，只允许在给定值上做 `[待实测标定]` 范围内的微调。

**⚠️ D13 数值已更正（由设计归属方自行撤回）**：D13 原写「错开量 = 造物宽度 × 1.2」**不可实现**，现改为「**紧贴生成（接触距离内），像素由技术侧标定**」——设计只规定"必须焊得上"与"焊上后两端搭岸能走"，不规定像素。理由：`黏` = 「**接触瞬间**焊成同一复合刚体」，中心距 1.2×宽 = 留 0.2×宽 空隙 → 三块各自下落、永不接触 → **黏一次都不触发**（现象是"点了黏它没黏"，不是"粘成一坨"，更难归因）。

**方案 B 已否决**（把 `黏` 改成"投放后 200ms 内、半径 1.3×宽内焊合"）：
1. 工程：加定时器 + 半径查询，波及关 5 桥头焊死与关 9 的 `黏` 语义，还要防误焊。
2. **设计侧理由（更重要，其本人提出）**：`黏` 会从"**接触式规则**"变成"**时间窗口式规则**"——接触式 = 我推过去碰到就粘住（物理）；时间窗口式 = 我放下后它自己粘（魔法）。本作能力统一叙事是"改写物理参数"，开这个口子会破坏玩家对能力类别的认知一致性。

**实现路径（推荐，主程序按此写）：组合「复制 + 黏」命中时生成即预焊**

| 项 | 做法 |
|---|---|
| 触发 | `combo(dup, stick)` 命中走预焊分支，**不走**"先分开再接触焊" |
| 生成 | 一次 `Body.create({ parts: [p1, p2, p3] })`，三块**共享边**（间距 0），直接是 1 个复合刚体 |
| 收益 | 不需要 2px 缝、不需要闭合速度、不需要 300ms 焊接等待、不需要去抖；parts = 3（预算 24 富余） |
| 代价 | 看不到"逐渐粘住"的过程——设计侧已确认"落地即焊成整板"，画面本就是如此（画面服从物理） |
| 风险 | 单体生成若与地形重叠会触发穿透解算 → **生成前做落点合法性检查**（与静态体重叠则整体沿重力反向上移直至无重叠） |
| 非 combo 的 `黏`（关 5 桥头焊死等） | 仍走**运行时接触焊**；只有这条路径才需要下面的 2px 缝 + 闭合速度 |

| 参数（接触焊路径，非 combo） | 取值 | 理由 |
|---|---|---|
| 排列方向 | 水平，沿造物最长边方向 | 形成横向平台，两端才搭得到对岸 |
| 相邻中心距 `d` | **`d = 宽 + 2 CSS px`** [待实测标定] | 必须 **< 宽 × 1.05**：2px 只防"同帧生成即重叠"，**绝不留可见缝**，否则黏不触发 |
| 闭合速度 `v_close` | 每块 ±**30 px/s** [待实测标定] 指向内侧 | 让 2px 缝在 **30–60 ms** 内闭合触发 `collisionStart` |
| 同帧重叠 | **禁止** | 同帧重叠 → matter 用巨大速度解算穿透（三块一起被弹飞）。只能靠 2px 缝 + 闭合速度，不能靠重叠 |
| 空间不足（贴墙/贴地） | 退化为垂直堆叠；再不足只生成 2 个 + 台词 | 不许把复制体生成进地形内部 |
| 链式复制 | **禁止**（`dupDepth > 0` 跳过复制） | 与"继承另一枚能力"配套，二者缺一即爆或失效 |
| 退化必须上报 | `spawnCreature()` 返回 `{ ok, degraded?: 'tooNarrow'｜'onlyTwo' }`，供台词/提示层消费 | **静默退化 = 玩家认定是 bug**："能力看起来没生效"和"空间不够"在玩家眼里是同一现象；不给一句话，他会从此不再用这个能力，关 7 想教的组合被玩家自己关掉 |

**可测判据**：
- 预焊路径（combo）：生成后**当帧**即为 `Composite` 顶层 body 数 = 1、parts ≤ 24；两端搭岸，玩家两次跳跃内通过
- 接触焊路径：3 块在 **300 ms** [待实测标定] 内焊成 1 个复合刚体；若只达到"三块各自搭岸但没焊"，说明间距超了接触距离 → 改 `d`，**不要改 `黏` 的判定半径**


**碰撞音聚合（跨物理/音频的边界，只在物理侧实现一次）**

| 项 | 规格 |
|---|---|
| 事实 1 | matter 的 `collisionStart` **一次事件带 `pairs[]` 数组**；且我们一帧最多 3 个子步 → **一帧最多 3 次事件**。音频侧若照单全收，静置/滚动接触的 start-end 抖动会打出噪音墙并瞬间打满并发节点 |
| 事实 2 | `pair` **没有冲量字段**，必须自算代理量：`vRel = dot(vB − vA, normal)`，`mEff = mA·mB/(mA+mB)`，`score = \|vRel\| · mEff`（约 10 次浮点运算/pair，成本可忽略） |
| 聚合规则 | `onImpact` 在 `collisionStart` 里只**收集**，在**帧末**（不是子步末）取 `score` 最大的一条回调；其余丢弃 |
| 闸门 | `score > impactMinScore` [待实测标定] 才回调（滤掉静置接触）；同一 `bodyId` 冷却 **90 ms** [待实测标定]（滤掉滚动抖动） |
| 标定判据（由 audio-director 出，物理侧只负责给数） | **A「落地必响」**：关 8 造物从最高点自由落体，首次触地那帧的 `score` 必须过闸；**B「静置无噪音」**：农夫+造物静置 5 s，回调次数必须 = 0。取值 = A 的 0.4–0.5 倍，再抬到 B 刚成立 |
| 可选补丁（P1 起必做，且**先于阈值标定**） | 以 `min(idA,idB)+max(idA,idB)` 为键，同一对 **200 ms** [待实测标定] 内重复的 start 事件丢弃。它与调阈值修的是**不同问题**：调阈值=提高门槛掩盖抖动（必然牺牲 A）；去抖=消除同一对的重复 start（不碰阈值）。**标定顺序必须是：先去抖 → 再看 score 分布 → 最后定 `impactMinScore`**，反过来会用被抖动污染的分布定出偏高的阈值，表现是"轻碰撞没声音"、又被误判成"配方增益太小" |
| 上限 | **每帧最多 1 次** `AudioBus.play('impact', …)`；音频侧不再做去重（去重逻辑只在物理侧存在一份，避免两处语义漂移） |
| 责任划分 | 物理侧给 `{score, material, bodyId}`；音量映射、音色选择、并发节点上限全归音频侧 |

**音频节点预算（归属 audio 模块，物理/渲染侧不得占用）**

| 项 | 数值 | 说明 |
|---|---|---|
| WebAudio 节点总数 | **≤ 40**（含 BGM 常驻 + 全部瞬时 SFX） | 超 40 会显著抬高音频线程开销，且移动端可能直接爆音/静音 |
| BGM + 主链常驻 | ≤ 12 | pad 双 osc detune + bass + motif + gain + filter + 总线/master |
| SFX 瞬时并发 | ≤ **8**（8 × 3 节点 = 24） | 12+24 = 36，留 4 个余量；**并发上限必须按节点数反推，不能只写"并发 12"** |
| 噪声 buffer | **只生成 2 个**（白 1 s / 棕 1 s）全局共享 | 绝不 per-sfx `new AudioBuffer` |
| 每次播放收尾 | 必须 `stop()` + `disconnect()` | 节点泄漏不涨内存、只涨 CPU，表现为"玩十分钟后开始卡" |
| 章节切换 | **不新建 Context、不新建 osc**，只改参数 + 增益交叉淡化 ≤ 300 ms [待实测标定] | 切换瞬间若重建节点，峰值会撞穿 40 |
| 静音（`setEnabled(false)`） | 停止并断开所有源节点，不只把 gain 置 0 | 否则关掉声音仍在跑 CPU |
| 闸门实现位置 | `AudioBus.play()` 内部准入（音频侧单例自己拒绝） | 物理侧不感知音频预算 |
| BGM/SFX 归类通则 | **按游戏事件触发 = SFX；按章节持续 = BGM** | 反例：沙漏滴答若写进第 3 章 BGM，关 8 会"听见沙漏在漏但屏上没有沙漏"，且不报错、只在全流程试玩暴露 |
| 程序混响 | **不做**（不生成 `OfflineAudioContext` IR） | 砍了没人发现；且 idle 调度时机可能落在低端机帧率恢复期，与最坏物理场景撞车 |


---

## 7. 输入方案

| 项 | 方案 | 备注 |
|---|---|---|
| 统一事件 | 只用 `PointerEvent`（`pointerdown/move/up/cancel`），**不写 touch/mouse 双套** | 支持鼠标、触控、触控笔；`e.pointerType` 用于笔宽与压感 |
| 指针捕获 | 起笔即 `canvas.setPointerCapture(e.pointerId)`，`pointerup` 释放 | 手指滑出画布不丢笔、不缺口 |
| 手绘防误触 | `touch-action: none`；`e.preventDefault()`（`{passive:false}`）；`user-select:none`；`-webkit-touch-callout:none`；`-webkit-tap-highlight-color: transparent` | 阻断滚动/长按菜单/双击缩放 |
| 双指 | 不缩放、不落笔：非 `isPrimary` 的指针全部忽略 | 6 天内不做 pinch zoom，避免与落笔抢事件 |
| 落笔判定 | `pointerdown` 立即进入"待定"状态，移动 ≥ 2px 才真正开笔（区分点按按钮与画画） | 避免点击能力芯片时误画 |
| 笔宽 | `pointerType==='pen'` 用 `e.pressure`；touch/mouse 用速度反推（perfect-freehand 的 `simulatePressure`） | 无压感设备也有粗细变化 |
| 高回报率 | 每帧最多取 4 个 move 点，超出丢弃中间点 | 120Hz 笔不会撑爆采样上限 |
| 冷却 | 提交后 **150 ms** [待实测标定] 内忽略新手势（防抖手画两笔） | — |
| iOS 语音解锁 | 首次 `pointerdown` 内 `speechSynthesis.speak(new SpeechSynthesisUtterance(''))`（空串，无感） | iOS 必须手势解锁，否则后续静默失败 |
| 音频解锁 | 同一手势内 `AudioContext.resume()` | 与语音解锁合并为一次 `unlockMedia()` |
| 键盘 | 仅 `Escape` 撤销当前笔画、`R` 重置本关（桌面调试用，不写进 UI） | 儿童不依赖键盘 |
| 尺寸变化 | `resize` / `orientationchange` 用 `ResizeObserver` 重建 canvas 与静态层缓存，**不重建物理世界**（世界坐标固定，仅改变视图变换） | 手机横竖切换不重置关卡 |

---

## 8. 交付与发布

| 项 | 值/做法 |
|---|---|
| 产物 | `dist/game.html`（构建中间物）+ 根 `index.html`（发布副本，同一字节） |
| 构建命令 | `node tools/build.mjs`（内部 esbuild ×3 + 断言） |
| 发布 | 单文件直传任意静态托管（GitHub Pages / EdgeOne / OSS），无需 CDN、无需构建服务、无需环境变量 |
| 体积上限 | **600,000 B 未压缩（硬门禁）**；gzip 目标 ≤ 200,000 B；当前估算 ≈ 105KB 库 + 60–100KB app ≈ 200–250KB [估算，实施后以断言值为准] |
| 首屏要求 | 单文件内联全部资源，`<head>` 内不引入任何跨域字体；字体用系统栈（`system-ui, "PingFang SC", "Microsoft YaHei"`） |
| 离线验证（3 步，缺一不可） | ① 构建断言：外链/`fetch`/`XMLHttpRequest`/`import()` 命中数 = 0；② 断网 + 双击 `index.html`（`file://`）走通关 1；③ DevTools Network 面板全程 0 请求（`file://` 下过滤可用 `filter:-scheme:file`） |
| `file://` 与 `http://` 差异 | `localStorage` 在部分 `file://` 环境不可用 → `storage.js` 必须 try/catch 降级到内存对象，**不许抛错阻塞启动** |
| 发布前清单（每次发版） | P7 体积断言过 / P8 请求数 0 / P9 首交互 ≤2.5s / P6 内存 ≤120MB / iPhone 8 + Android 中端机各走通关 1–3 / 语音降级路径手测（关掉系统语音仍能玩） |
| 版本号 | `index.html` 首个 `<meta name="app-version" content="0.1.0+YYYYMMDD">`，与 git tag 对齐 |

---

## 9. 风险清单（按"会不会导致无法交付"排序）

| # | 风险 | 触发概率 | 后果 | 缓解办法（可执行） |
|---|---|---|---|---|
| K1 | **iOS Safari 性能崩塌 / 页面被系统回收**（2GB 内存机 + Canvas 大尺寸） | 高 | 演示现场打不开或卡死 → 直接无法交付 | DPR cap 2；canvas CSS 上限 430×932；动态 body ≤ 24；Safari 上默认 `tier='mid'`（不填 hachure、不投影）；`NaNGuard` 防泄漏；**iPhone 8 实机每天跑一次关 8**；兜底：静态背景预渲染成 1 张位图，砍掉动态抖动 |
| K2 | **`speechSynthesis` 无中文语音 / iOS 静音开关无输出** | 高（iOS 常见） | 如把语音当必需，则"演出缺失" | 语音**只做增强**：`getVoices()` 空或无 `zh-*` → `VoiceService` 自动切文字气泡 + 音效，且不重试；所有台词 ≤18 字只走文字也能完整通关；发布前用手测清单验证"全静音可玩" |
| K3 | **凹多边形拆凸失败 → 物理爆炸（NaN / 飞走 / 卡穿）** | 中高（手绘必然凹/自交） | 玩家核心动作失效 | 三级退化：decomp → 凸包 → 矩形 bbox → 圆形；拆块上限 8；`NaNGuard.sweep` 每 10 帧清非有限值 body；`Body.setVelocity` 上限 clamp；自交一律走凸包不做交点修复 |
| K4 | **手绘阈值判错（画梁判成团块）** | 高（必然发生） | 玩家困惑但不至于不能玩 | 依赖 levels.md 附录 A 铁律：**团块兜底 + 某能力永远可解**，判错只多花 30 秒；`?debug=1` HUD 显示判定结果与几何数值，便于标定；阈值必须用真人样本回归（第 5 节标定表） |
| K5 | **单文件体积失控**（引入 Tone.js 或多个美术管线） | 中 | 线上加载超 2.5s 首交互门禁 | 硬门禁 600KB 断言；不引 Tone.js（第 1 节已排除）；零音频/图片素材；若超限，第一批砍 rough 的填充与动画 |
| K6 | **构建环境装不上 npm/esbuild**（比赛机器/离线） | 中 | 无法产出交付物 | `vendor/` 提交 4 个库的**已构建 IIFE 快照**；`build.mjs` 做能力探测：有 esbuild 用 esbuild，无 esbuild 直接拼 `vendor/*.iife.min.js` + 未压缩 app（体积会涨，仍可交付） |
| K7 | **6 天工期不足**（9 关 + 24 能力） | 中高 | 只交灰盒或半成品 | 顺序锁死：关 1–3 + 构建管线 + 判定管线先跑通（可交付的最小可玩）；关 4–9 复用 4 类机关原型（D3 R3）；24 能力按"每章 8 个"分三批，第 3 章能力允许降级为同一钩子不同参数 |
| K8 | **`file://` 下 localStorage / AudioContext 行为差异** | 中 | 双击版存不了进度或没声音 | `storage.js` try/catch 降级内存；音频必须首次手势 `unlockMedia()`；在 `file://` 与 `https://` 各跑一遍关 1 |
| K9 | **手机竖屏布局与画布 45% 占位冲突**（levels.md 第八节硬指标） | 中 | 首屏看不懂在玩什么 | 画布区固定占下半屏 45%，HUD 用绝对定位覆盖，`dvh` 单位（不用 `vh`，避开 iOS 地址栏跳动）；`visualViewport` 变化只重排 UI 不重建世界 |

---

## 10. 待实测项清单（四字段，交付主程序 / QA）

| 验证问题 | 预期结论 | 验证方法（一句话） | 由谁在哪个阶段验证 |
|---|---|---|---|
| P0-a 机关 8 最坏场景能否 p90 ≥ 55fps | 达标（≤16.7ms p90） | 在 Android 中端机跑关 8 + 复制 + 怕痒 60 秒，读 `?debug=1` HUD 的 p90 | 主程序 阶段 2 / QA 阶段 4 复测 |
| 物理 80 parts / 40 约束下单帧 `Engine.update` 是否 ≤ 6.0ms | 达标 | HUD 的 physicsMs 峰值 | 主程序 阶段 2 |
| DPR cap 2 是否足够（观感 vs 性能） | 足够，字仍清晰 | 在 DPR 3 手机上对比 cap 1.5 / 2 / 3 的截图与帧率 | 主程序 阶段 2 |
| 采样距离 2px / RDP ε 1.2px 是否保住笔迹手感 | 手感接近真实纸笔 | 20 条真人手绘（含快速划线）对比原图与简化图 | 主程序 阶段 2 |
| 闭合容差 `0.18×短边` 的误判率 | 误判 < 10% | 30 个"故意不闭合"样本统计被判闭合的比例 | 主程序 阶段 2 |
| 梁/团块长宽比阈值（6.0 / 1.5 / 3.0） | 关 1 玩家画的长条 90% 被判梁 | 用关 1 通关样本回归 | 主程序 阶段 2 / 设计 阶段 3 复核 |
| 拆凸后单造物平均块数 | ≤ 5 块（预算 8 有余量） | 记录 50 笔样本的 `parts.length` 分布 | 主程序 阶段 2 |
| **「绳 + 变硬」硬化后的绳桥能否承载农夫单人通过**（标定目标：**农夫单人重量走过去不塌、不折、中点垂度 ≤ 0.08 × 跨度**） | 能（复合刚体重建后成立） | 关 1 画两笔接成长条 → 落定 → 点变硬 → 农夫连走 10 次，记录垂度与是否折叠 | 主程序 阶段 2 / QA 阶段 4 复测 |
| 绳分段长度 24px / ≤12 段的观感与成本 | 弯折自然、无"木棍感"，且不超 P4 预算 | 关 5 吊桥样本目测 + 帧率读数 | 主程序 阶段 2 |
| 双笔细长判梁（序 2b）的命中率 | 玩家两笔画的桥 90% 判梁而非绳 | 20 个"两笔画长条"样本回归 | 主程序 阶段 2 |
| 怕痒的 `k`（Δv 常量）标定 | 关 4 ① 能把小人弹上四倍高台、不弹飞；**同一对芯片在面积 2 倍差的两个造物上，Δv 差 ≤ 5%** | 画大/画小各 10 次，记 Δv 与弹射高度 | 主程序 阶段 2 / 设计 阶段 3 复核 |
| 碰撞音闸门 `impactMinScore` 与 90ms 冷却 | 闲时 ≤ 1 次/秒；落笔造物落地必响；静置无噪音 | 关 8 最坏场景听 60 s，统计每秒触发次数 | 主程序 + audio-director 阶段 2 |
| `voiceschanged` 等待窗口 1500ms 是否够（Chrome 桌面异步填充） | 够，且不出现"迟到语音" | 三端冷启动各 10 次，记录首次可用语音的延迟 | audio-director 阶段 2 |
| 关 7 三条路径的**玩家实际耗时**是否同量级（R1 验收口径） | ② 选落点比 ① 多 **1–2 s** 以内；若明显更慢，说明② 退化为"高手路线"而非正解 | 录 5 名玩家各走三条路，记通关耗时中位数 | 设计 + QA 阶段 4 |
| 上述不达标时的处置（**已定，别选错方向**） | **把 ③ 提上来、② 降为隐藏解法**；**禁止为救 ② 而放长沙漏**——沙漏被三条路共同约束，松一条等于把另两条一起放松 | 设计裁定 | 设计 阶段 4 |
| decomp 在自交笔画上的失败率 | < 5%（其余走凸包） | 20 个自交样本统计抛错/块数异常比例 | 主程序 阶段 2 |
| iOS Safari 是否需要默认 `tier='mid'` | 需要 | iPhone 8 上对比 high/mid 的 p90 | 主程序 阶段 2 |
| `speechSynthesis` 中文可用性（iOS/Android/桌面） | iOS 常缺，Android 可用 | 三端各跑 `getVoices()` 过滤 `zh` 并试读一句 | 主程序 阶段 2 / QA 阶段 4 |
| 首次可交互 2.5s 是否可达（线上 4G） | 可达（估算 1.2–1.8s） | 3 次冷加载取中位 | QA 阶段 4 |
| 关 8 驻留 60 s 后 JS 堆是否 ≤ 120MB | 达标 | Chrome DevTools 记录堆曲线 | 主程序 阶段 2 / QA 阶段 4 |
| 单文件最终体积 | ≤ 600KB（估算 200–250KB） | 构建断言读数 | 主程序 阶段 2 起每次构建 |
| 关 8 岩浆弹回 + 复制 + 怕痒 是否造成速度爆炸（穿墙/飞出屏幕） | 无 NaN、无飞出场外 | 跑 10 次记录最大速度与出界次数 | QA 阶段 4 |
| 150ms 提交冷却 / 120ms 弹射冷却的手感 | 不粘、不连弹 | 手动连画/连踩各 20 次 | 主程序 阶段 2 |
| 时间慢是否影响沙漏（levels.md 附录 B 遗留） | 按 D3 R1 裁定：只作用于刚体，沙漏不受影响 | 关 7 解法③ 实跑对比 | 主程序 阶段 3 |

---

## 11. 架构违规红线（供 QA 校验）

| # | 红线 | 判据 |
|---|---|---|
| L1 | 产物内有外链 | 构建断言命中 > 0 |
| L2 | `tools/` 或 `tests/` 被打进产物 | 产物中出现 `build.mjs`/`.test.` 字样 |
| L3 | 生成器写在产物目录 | `dist/` 内存在 `.mjs` |
| L4 | 能力写成 if-else 链 | `abilities/` 下出现按 `abilityId ===` 的分支超过 2 处 |
| L5 | 降级函数缺失却声称已绑定 | §4 契约表中的函数名 `grep` 命中为 0。**例外：`freezeChain`（D11 已划出 v1）、`setVolume`（P1 才实装）不计入** |
| L6 | 数值散落 | `materials.js` / 第 5 节阈值表之外出现物理常量字面量 |
| L7 | 引入 webpack/vite | devDependencies 出现 webpack / vite / rollup 插件 |
