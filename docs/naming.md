# 命名方案 v1.0（2026-10-28）

> 唯一有效版本。本文件是英文名的**唯一出处**，README / 游戏内标题 / 商店条目一律引用此处，不复述候选表。

## 结论

| 项 | 值 |
|---|---|
| 英文名（正式） | **Sketchsmith** |
| 中文名（保留） | 我是造物主 |
| 并列写法 | Sketchsmith《我是造物主》 |
| 副标 / Subtitle | I Am the Creator |
| Tagline | Draw it. Bless it. See if it holds. |
| 一句话释义 | 你是用笔造物的匠人；画出来的东西不是装饰，是真的会滚、会弹、会砸人的实物。 |

## 为什么是 Sketchsmith

1. **对得上核心机制**：`sketch`（手绘）+ `smith`（匠人）= 亲手造物。游戏里玩家画的形状经 poly-decomp 变成真实刚体（决策 D2「形状即物理」），
   smith 比 creator/god 更贴近「有工具、有手艺、会失手」的实际体验。
2. **调性匹配**：中文名「我是造物主」有股自大劲，而游戏实际体验是造物主经常翻车
   （关 4 弹射把小人弹进悬崖、关 5 画的桥被鱼顶翻）。smith 的谦逊感与这种反差幽默同频；
   `Creator` / `God` 反而太庄重，接不住笑点。
3. **工程可用性**：8 字母、无大小写歧义、母语者与中文用户都能一次念对；
   可作域名前缀（sketchsmith.io / .game）、可作 npm 包名、可作 itch.io 项目路径。
4. **搜索洁度**：精确检索未命中任何同名游戏或商店条目（见下节证据），参赛期搜索「Sketchsmith」能直接落到本项目。

## 候选与裁决

| 候选 | 气质 | 裁决 | 依据 |
|---|---|---|---|
| **Sketchsmith** | 匠人品牌感，干净利落 | ✅ 采用 | 精确检索零命中 |
| I Am the Doodler | 与中文名逐字对应，自嘲幽默 | 🟡 备选 | `Doodler` 单词已有 Steam app/479310（2016，平台跳跃）；整句虽唯一，但检索会被该作污染 |
| Paper Genesis | 造物主气势 + 纸感双关 | 🟡 备选 | 未做撞名核查；`Genesis` 在游戏名中偏重，且与「幽默」调性有张力 |
| Draw It Real | 直接说玩法（画出来即成真） | ⚪ 可作 tagline | 读起来像口号不像作品名 |
| The Great Doodler | 幽默夸张 | ⚪ 可作副标 | `The Great` 前缀同质化高，且与上一条同源 |
| Doodle Deity | 造物主 + 涂鸦 | ❌ 淘汰 | 撞 Steam *Doodle Deities*（Golden Calf Studio，Roguelike 卡牌构筑） |
| Doodle God / Doodle Devil | 画元素造物 | ❌ 淘汰 | 同类鼻祖，正是需求里要求「避免同类」的对象 |
| Drawn to Life / Scribblenauts | 画物 / 写词造物 | ❌ 淘汰 | 同类祖爷爷，撞名即撞玩法联想 |
| Inkbound | 墨之束缚 | ❌ 淘汰 | 撞 Shiny Shoe 的 Roguelike *Inkbound* |
| God Hand | 神之手 | ❌ 淘汰 | 撞 Capcom *God Hand*（2006） |

## 撞名核查证据（2026-10-28 检索）

- `"Sketchsmith" game steam` → 无同名游戏命中；返回结果为 Steam 首页与 *Sketch*（app/1943220，Opin Mind Games，2022）等泛手绘类作品，无 `Sketchsmith` 条目。
- `"Sketchsmith" itch.io OR steam OR 游戏` → 同上，无精确匹配页。
- `"Doodle Deity" game` → 命中 Steam app/2911750 *Doodle Deities*，故淘汰单数形式。
- `"I Am the Doodler" game` → 命中 Steam app/479310 *Doodler*（2016）与其衍生网页游戏，故整句降为备选。

> 检索为公开网络快照，非商标库查询。若后续要注册域名或上架商店，需另做商标与域名可用性核查。

## 接线点（改名时需同步的位置）

| 位置 | 当前值 | 目标值 | 状态 |
|---|---|---|---|
| `README.md` 首行 | 我是造物主 · 5 关 + 沙盒 | Sketchsmith《我是造物主》· 5 关 + 沙盒 | ✅ 已接线 |
| 构建产物 `<title>` | 我是造物主 | Sketchsmith《我是造物主》 | ✅ 已接线（`template/index.html`） |
| 游戏内标题 / 封面字 | （原无封面页） | 双语并列：中文《我是造物主》作主视觉，SKETCHSMITH 作副行 | ✅ 已接线（`src/render/title-card.js` 开场扉页） |
| `package.json` name（若开源） | — | `sketchsmith` | ⚠️ 未接线（尚未开源） |
| 参赛表单「作品名称」 | — | Sketchsmith（英文名）/ 我是造物主（中文名）双栏填写 | ⏳ 待填 |

### 开场扉页的排版契约（`src/render/title-card.js`）

- **主次不可颠倒**：中文 48px 宋体粗体为唯一主视觉；`SKETCHSMITH` 13px + 6px 字距、淡墨（alpha 0.66），tagline 11px 斜体更淡（0.38）。英文不得加大或加粗到与中文争重。
- **不出字体文件**：走系统宋体系回退（`Songti SC → Noto Serif SC → Source Han Serif SC → serif`），保持单文件零网络请求。
- **手写感是静态的**：逐字 ±0.63° 交替微旋 + 基线起伏 ±1.6px，相位固定不随时间抖动（会抖的字看起来像加载失败）。
- **落款印章「造」**完整落在下框线内侧，不骑线。
- **时长**：静止 1250ms + 淡出 380ms；点一下即进淡出（不硬切），扉页期间物理冻结。
- **开场台词延后到扉页落下那一刻**才说，否则玩家只听见声音、看不到人。`?skipIntro=1` 或 `Boot.skipIntro()` 可跳过。
