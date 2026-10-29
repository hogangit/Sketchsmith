# Sketchsmith《我是造物主》—— 项目长期笔记

## 托管与账号（别猜，已实测）
| 平台 | 用户名 | 仓库 | 状态 |
|---|---|---|---|
| GitHub | **hogangit** | `hogangit/Sketchsmith` | 已推（113 文件，2026-10-29） |
| Gitee | **chenhuanjin** | `sketchsmith` | 待用户在网页端建空仓后才能推 |

- **推 GitHub/Gitee 一律走 SSH**：`ssh -T git@github.com` / `git@github.com` → `Hi hogangit`；`git@gitee.com` → `Hi chenhuanjin`。本机 `~/.ssh/id_ed25519` 两边都已授权。
- **GitHub 的 HTTPS 会误判为「不通」**：`curl https://github.com` 12s 仍在传最后超时，但 SSH 秒通。别用 HTTPS 连通性判断 GitHub 能不能用。
- `raw.githubusercontent.com` 在本机网络被拒（http=000）；但 `hogangit.github.io` 可达 —— Pages 可用，raw 下载不行。Gitee 主页 2s 打开。
- Gitee 凭据文件 `~/.git-credentials-gitee` 有两条（`chenhuanjin:xxx` / `oauth2:xxx`），**都是仓库级私人令牌，无权建仓**（API 报 `仓库级私人令牌无权执行此操作`）。新仓必须由用户在网页端先建出来，之后 SSH 推。
- Gitee 账号现有 5 个私有仓：book-vault / movie-vault / qing-music / star-hop / edu-workbench，全 private —— 公开仓与 Pages 可能被实名认证卡住。

## 交付物形态
- `.gitignore` 忽略 `dist/`，但构建会再产一份**根目录 `index.html`**（~418KB 单文件，依赖全内联）且**已入库** → 任何静态托管放上去就能玩，无需 node/npm。
- 分支统一用 `main`（本地原 `master` 已改名对齐 GitHub）。

## 项目概况
- 纯前端单文件游戏：Canvas2D + matter-js + poly-decomp + roughjs + perfect-freehand（全部 MIT）。
- 构建 `node tools/build.mjs`（13 道门禁）；冒烟 `node tools/smoke-browser.mjs`（Edge headless + CDP 真实鼠标/触摸事件）。
- 测试：core 20/20、sandbox 7/7、audio-sfx 9、perf-governor 6/6、farmer 5/5、l4 两套。
