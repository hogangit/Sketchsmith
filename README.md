# 我是造物主 · 阶段 2 灰盒 Demo（v0.2.0）

关 1–3 可玩灰盒。单文件 `file://` 双击即开，零网络请求。

---

## 一、怎么跑起来

```bash
node tools/build.mjs                 # 生成 dist/game.html + 根目录 index.html
```

- **玩**：双击 `dist/game.html`（或根目录 `index.html`）。不需要服务器、不需要联网。
- **自测（真浏览器，无需 npm 依赖）**：
  ```bash
  node tools/smoke-browser.mjs       # Edge headless + CDP：430×932，三关各用参考解法真的走通
  node --test tests/core.test.mjs   # 14 条单元测试（几何/判定/能力/总线/存档迁移）
  node tools/check-single-file.mjs  # 单文件 13 条门禁
  node tests/tune.mjs               # 标定用：逐关逐画法打印物理轨迹
  node tests/probe2.mjs             # 摩擦矩阵探针（关2 设计的依据，见第五节）
  ```
- **调试开关**：`?debug=1`（形态/几何/帧时/刚体数）、`?impactDebug=1`（本帧碰撞 score 与是否被闸门拦下）、`?skipIntro=1`。
  与 query 组合用：`file:///.../dist/game.html?debug=1`

**按键**：`R` 重来本关　`Esc` 回第 1 关　`Enter` 立刻提交当前笔迹（默认抬笔后 700ms 自动提交）

**操作**：在下方「造物簿」里画 → 抬笔 0.7s 后造物从天上落到你画的位置 → 点上方芯片贴能力（每件最多 2 个）。

---

## 二、产物

| 文件 | 说明 |
|---|---|
| `dist/game.html` | 单文件游戏（262,065 B / 上限 600,000 B），4 个 MIT 库 + app + 许可正文全部内联 |
| `index.html` | 同一份产物（构建通过断言后才复制，失败则不生成） |
| `dist/smoke-l1..l3.png` | 430×932 竖屏实机截图（三关各一张） |
| `vendor/` | curl 自 unpkg 落盘的 4 个库 + 4 份许可 + 聚合 `LICENSES.txt` |

`perfect-freehand` 只有 CJS/ESM、没有 UMD，因此仓库里多了一个 `vendor/perfect-freehand.umd.js` 包装器（原文件逐字保留，只加外壳）。

---

## 三、这一轮真的做了什么

1. **单文件构建**：`tools/build.mjs` 先探测 esbuild，没有则走 `tools/bundle-fallback.mjs`（约束拼接器：只允许单行具名 import、具名 export、顶层名全仓库唯一、DAG 无环）。**本机没有 esbuild，所以产物走的是兜底路径**（未压缩，262KB，仍在门禁内）。
2. **形态判定 S1–S12**：采样（2px / 400 点）→ RDP ε=1.2 → 闭合检测 → 几何属性 → 十序判定树（序 2 绳按 D11 不实装、序 2b 双笔细长判梁）→ 凹多边形分解 → 刚体生成。
3. **三级退化 + NaN 守卫**：分解 → 凸包 → AABB → 圆；每 10 帧 `NaNGuard.sweep` + 速度钳制。`?debug=1` 里 `degraded` 会如实显示。
4. **能力骨架**：纯数据记录（`mods` / `hooks` / `flags`），无 24 连 if-else。本轮实装 4 个：变硬 / 会滚 / 变重 / 变轻；其余 20 个只有名字表。
5. **最小音频**：1 个 `AudioContext`（单例 `AudioBus`），6 个 P0 音效 + 1 层五声 BGM 垫音（lookahead 调度）+ 语音；**无中文语音时自动降级成气泡**，不会拿英文嗓音念中文；首次 `pointerdown` 同步解锁（iOS）。
6. **碰撞音聚合**：物理侧每帧跨子步取 `score = |vRel| × mEff` 最大者回调一次（静态体 `mEff` 用另一方质量，避免 `Infinity` 传染 NaN），带最小分闸门 + 同 pair 90ms 冷却。
7. **存档抽象层**：core 只依赖 `SaveStore` 四个方法（read/write/list/migrate），唯一实现 `src/platform/local-storage-save-store.js`；`file://` 下 localStorage 不可用时自动退化内存桩，绝不阻塞启动。v1→v2 迁移有单测（幂等、不丢数据）。

---

## 四、关 1–3 可解性：实测结论（不是声称）

`node tools/smoke-browser.mjs`（真 Edge、`file://`、430×932、走 rAF 主循环）：

```
L1 梁+变硬   → 过关（3.3s, form=beam）
L2 梁+变硬   → 过关（5.8s, form=beam）
L3 团块+变重 → 过关（1.8s, form=wheel）
无未捕获异常 / 无 console.error
```

`node tests/tune.mjs`（Node 里整关跑物理，9 种画法）：

| 关卡 | 画法 | 结果 | 说明 |
|---|---|---|---|
| 关1 | 梁 + 变硬 | **WIN** | 参考解法 |
| 关1 | 扁闭合团块 + 变硬 | **WIN** | 兜底团块路径 |
| 关1 | 扁闭合团块（无能力） | 失败（actor-fell） | 软团块会弹/滑，必须变硬才稳 |
| 关1 | 梁 无能力 | 失败（actor-fell） | 软梁中缝折下去 = 教学性失败 |
| 关1 | 圆轮 + 变硬 | 失败 | 圆滚走，不能当桥 |
| 关1 | 什么都不画 | 失败 | — |
| 关2 | 梁 + 变硬 | **WIN** | 参考解法（以 smoke 为准：5.8s 过关） |
| 关2 | 扁团块 + 变硬 | **WIN** | 兜底团块路径 |
| 关2 | 梁 无能力 | 失败（prop-lost） | 软梁接不住 13.4kg 南瓜 |
| 关2 | 梁 + 会滚 | 失败 | 会滚在旧关2 是干扰芯片（新关2 里它是解法④，见第五节） |
| 关2 | 不架桥 | 失败（prop-lost） | 南瓜落河，自动重来不惩罚 |

> **关2 的 `tests/tune.mjs` 坐标是旧几何的**（116px 梁 vs 110px 沟），关 2 重做后必须一并更新；在那之前关 2 以 `smoke-browser.mjs` 的整关结果为唯一依据。
| 关3 | 团块 + 变重 | **WIN** | 参考解法 |
| 关3 | 大团块 无能力 | **WIN** | 面积够重也行（第二解法） |
| 关3 | 团块 无能力 | 失败（too-light） | 压板不动 |
| 关3 | 轮 + 会滚 + 变重 | **WIN** | 第三条 |

每关都满足「≥2 条真解 + 兜底团块可行」；也都有明确的失败反馈（不死路：关2 南瓜掉河后农夫式自动重来，玩家随时可重画）。

---

## 五、与设计案的偏差（必须知道）

1. **关2 换了机制（最大偏差，正在改回新案）**。设计总监已把关 2 重设计为三解（① 圆滚 / ② 长条撬杠 / ③ 团块逐级跌，④ `会滚` 是正解变体），并保留"只向下"的几何。**本包仍是旧几何**（平台 → 桥 → 集市），新几何（坡道 + 台沿石 + 集市棚布）待撬杠可行性拍板后重做。撬杠实测见 `tests/lever.mjs`：力矩够（支点离南瓜 ≤32px、梁 ≥200px 时梁转角 +28~+52°），但**梁架在单块石头上会翻**，需要"防翻夹槽"构件；另外 `pumpkin.friction = 0` 是旧设计遗留债（新三条解都不依赖滑动，而这个 0 会让南瓜在梁上"滑回去"而不是"被顶翻"）。
2. **旧机制的原始偏差记录（保留）**。`levels.md` 的三条参考解法都以「南瓜滑/滚起来」为前提。实测 `matter-js` 的摩擦求解器（`tests/probe2.mjs` 全部实测数据）：
   - `pair.friction = min(a,b)`、`pair.frictionStatic = max(a,b)`，求解时两者**相乘** → 接触对里只要有一方 `friction > 0`，切向相对速度就被清零。0.05 与 0.9 的停止距离**都是 ≈8px**。
   - 只有 `friction = 0` 才滑得起来；而 `friction = 0` 的滑行体**任何 ≥5px 的台阶都会把它彻底卡死**（实测 5px 就停、9px 还会往回滑）。
   - 所以「平地架桥让南瓜滑过去」在本引擎里必然卡在桥面比岸面高出的那一个梁厚上，不是调参能救的。
   - 改成：南瓜 `friction = 0` 自己慢慢滑 → 滑出高台（落差 60px）→ 玩家在沟里架桥（两头搭两岸，桥面必然低于高台）→ 滑到集市。**全程只向下，没有向上的台阶**。教学点从「形状决定形态」偏向「强度」（软梁接不住 13.4kg）。
   - 代价：`会滚` 在关2 成了干扰芯片；`轮/雪橇` 两条参考解法不可实现。已同步反映在 `failHints` 与本表。
3. **`ENABLE_ROPE=false`（D11）**：判定树序 2（绳）整条不写，没有 `freezeChain`。`body-factory` 里的 rope 分支仍保留但当前判定树不会产出 rope。
4. **`?debug=1` 是唯一标定依据**：所有阈值仍带 `[待实测标定]`，没有按个人手感定死。
5. **音频 P0 之外没做**：22 个 SFX 里只做了 6 个 + `collide`/`ui` 两个补充；机关/环境音（压板/感光/沙漏/水/火/岩浆）未做；`setVolume` 只做了最小实现；`x`（立体声定位）忽略。

---

## 五之二、`会滚`（D16）：不改摩擦，只压空气阻尼

`friction`/`frictionStatic` 一旦非 0，matter 的摩擦求解器就会把切向速度清掉——所以"降摩擦"换来的不是滚，是"既不打滑也不滚、被任何 5px 台阶卡死"，名字和实现相反。`frictionAir` 每个子步同时衰减 `velocity` 与 `angularVelocity`，压低它 = 抓地还在 + 滚得更远，不需要额外扭矩。

- 实现：`CREATURE_ROLL = { frictionAirMul: 0.25 }`（乘算键，与 `变重` 可交换）；`body-factory.applyMods` 里 `frictionAir = 基线 × 0.25`
- 验收：`node tests/roll.test.mjs`（11 条断言）
  - `friction` 0.05 → 0.05，`frictionStatic` 0.08 → 0.08（一个数没动）
  - 8° 斜面 3 秒：裸圆 65px/1.5 rad → 会滚 **100px/2.9 rad（×1.55）**
  - 长条贴会滚：9px → 10px（**差 11%**）= 形状不对就基本没意义
  - 被否决的 `friction=0` 留证：平地滑 292px 但只转 0.08 rad（真滚应转 11.2 rad）= 雪橇，不是滚

## 六、没做完 / 明确是占位

- **关 4–9**：未做（本轮范围外）。
- **其余 20 个能力**：只有名字表，点不出来。
- **美术**：纯灰盒（平涂 + 骨架线），`rough.js` 只在静态层与少量轮廓上用，`RenderQuality` 的 hachure/投影在 `mid` 档关闭。
- **剧情文本**：每关 1–2 句，没有完整叙事。
- **沙盒模式 / 存档界面**：未做。存档只记通关进度（`wcwz:progress`，v2）。
- **性能降级只做了"绑定"，没有在真机压测**：`PerfGovernor` / `RenderQuality` / `BodyBudget` / `StrokeBudget` / `Boot.skipIntro` / `NaNGuard` 全部按契约实装且能被 grep 到，但**降级是否真的在低端机触发过，我没有实测证据**，按技术基线口径这一项应视为「门禁」而非「已绑定降级」。
- **手绘手感未由真人验证**：`smoke-browser.mjs` 走的是 `spawnFromStrokes()`（绕过 pointer 采样）。我**没有**用鼠标/手指在真实设备上完整玩一遍 1→3，所以「pointer 采样密度在真机上的手感」「多笔归组 700ms 是否跟手」这两点仍是未验证项。
- **iOS 真机音频未验证**：解锁逻辑按规格实现（首次 pointerdown 同步 `unlockMedia()`），但没有 iPhone 实机证据。

## 七、我自己玩下来卡住的点（已知体验问题）

1. **关2 的节奏偏慢**：南瓜从高台滑到桥面要 4–5 秒，玩家会误以为"没反应"。已加 `propReleaseDelayMs=1500` + 失败提示阶梯，但首次仍然偏闷。
2. **一次只有一个造物**：新画会立刻替换旧造物，玩家在关2 想"改一下桥"时会发现桥瞬间消失、南瓜直接落河。这是阶段 2 的简化，会让人误以为是 bug。
3. **薄团块反而能过、厚团块会卡住**（关2）：物理上说得通（厚团块顶面高过高台，把南瓜挡住），但玩家第一反应是"我画得更结实怎么反而失败"。已在第 3 条 failHint 里写明，仍需要更好的视觉反馈。
4. **`?debug=1` 会挡住提示文字**：调试块在 y=118..250，失败提示从 y=100 起换行，两者重叠（只在调试时出现，玩家界面没有）。

## 八、标定待办（下一轮）

| 项 | 位置 | 判据 |
|---|---|---|
| `IMPACT_MIN_SCORE` / pair 冷却 | `src/physics/materials.js` | 关8：最高点落地必响 / 静置 5 秒零回调（`?impactDebug=1`） |
| `LANDING_MAX_FALL_SPEED` / `LANDING_FRAMES` | `src/level/runtime.js` | 造物落桥成功率 ≥ 8/10，且不能"贴"在岸上 |
| `PUMPKIN frictionAir` | `materials.js` | 南瓜滑完一整条路径不停、不飘 |
| `PUMPKIN friction`（待拍板） | `materials.js` | 现在是旧"沿坡滑"设计留下的 0；新关2 三解都不依赖滑动，但改它属标定，等设计与架构确认 |
| `CREATURE_ROLL.frictionAirMul` | `materials.js` | 圆在 8° 斜面上滚距 ≥1.4× 裸圆、且能自己停下（当前实测 ×1.55） |
| `PLATE.threshold` / `sustainMs` | `materials.js` + 关3 数据 | 变重必压、不变重必不压 |
| `SOFT_BEAM_STIFFNESS` | `materials.js` | 软梁必须塌、且塌得好看 |
| 语音同说话人冷却 45s | `audio-bus.js` | 需等第 1 章三关都能跑后由音频侧实测 |
