# store-order · 门店订单管理系统

一套面向实体门店（零售 / 批发 / 家居建材 / 通用门店）的全链路经营管理 Web 系统。覆盖「客户跟进 → 开单 → 进货 → 备货 → 送货 → 签收 → 财务 → 售后」的完整业务闭环，并附带日报、知识库、经营分析、企业微信推送等门店常用能力。

**代码不含任何品类限定**（无「床/沙发/螺丝」之类的硬编码约束），商品、客户、订单、促销都是通用模型。便利店、服装店、五金店均可直接使用。

- 版本：v5.0.0
- 仓库语言：中文（界面文案、注释、文档均为中文）
- 默认访问地址：http://localhost:3333

---

## 功能特性

| 域 | 能力 |
|---|---|
| 客户 CRM | 客户主档、跟进时间线、重复校验、客资来源分析、今日待跟进、日报客资沉淀 |
| 商品 / 库存 | 多规格商品、进价 / 售价 / 保本价三价、样品赠品独立库存、多仓镜像、库存流水 |
| 订单 | 14 态状态机、定金 / 尾款 / 全款、合同打印、分批送货、签收、取消、回退审批 |
| 进货 | 进货单、到货、进货项 → 订单项分配、在途量派生 |
| 送货 | 送货单、签收、回退、配送师傅管理 |
| 退换 / 售后 | 退 / 换单、售后工单（维修 / 补件 / 投诉）、补件出库、库存精确回滚 |
| 财务 | 月度 / 年度汇总、现金流、成本分解、应收账、售后台账、其他成本 |
| 促销 | 优惠券（满减 / 折扣 / 渠道）、捆绑套餐 |
| 日报 | 销售日报（字段可配置）、客资明细、闭店推送、长图分享 |
| 知识库 | 导购笔记瀑布流、收藏 / 浏览历史、管理后台、富媒体 |
| 经营分析 | 销售走势、品类占比、客单价、导购排行、转化漏斗、毛利、畅销榜 |
| 多店多仓 | 门店、仓库、门店级目标、分店对比、数据按门店隔离 |
| 系统 | 一键备份 / 恢复 / 恢复出厂、自动备份、请求 / 错误日志、配置脱敏、JWT 鉴权、登录限流 |

### 角色与数据范围

| 角色 | 能力 | 数据范围 |
|---|---|---|
| `admin` | 全部，含系统设置、备份 / 恢复 / 复位、审批 | 全部门店（可 `?store_id=` 限定单店） |
| `boss` | 近似 admin，无危险系统操作（reset / restore 仅 admin） | 全部门店 |
| `sales` | 开单 / 日报 / 客户跟进 / 知识库浏览 | 仅自身门店与自己名下的订单、客户 |

---

## 技术栈

| 层 | 技术 | 说明 |
|---|---|---|
| 前端 | React 18 + Ant Design 5 + Vite 5 + react-router-dom 6 + recharts 3 | `client/` 独立子项目 |
| 后端 | Node（仓库自带便携版 `nodejs/`，无需另行安装）+ Express 4 + better-sqlite3 | `server/`，ESM（`"type":"module"`） |
| 数据库 | SQLite 单文件（`server/data/store.db`），WAL 模式 | 同步 API，零外部依赖 |
| 鉴权 | jsonwebtoken（JWT，30 天有效期） | 角色：`admin` / `boss` / `sales` |
| 推送 | 企业微信群机器人 Webhook | 纯出站，无需公网 / 可信域名 |
| 打包 | archiver（备份）+ adm-zip（恢复）+ sharp（图片压缩）+ xlsx | 见 `server/package.json` |

```
┌─────────────────────────────┐         ┌──────────────────────────────────┐
│  前端 React 18 + antd 5      │  HTTP   │  后端 Express (Node)             │
│  Vite 5 构建                 │ ──────▶ │  better-sqlite3 (SQLite 单文件)  │
│  端口 5173 (dev)            │ /api/*  │  端口 3333                       │
│  生产静态文件由后端托管       │ ◀────── │  JWT 鉴权 + 角色 + 多店隔离       │
└─────────────────────────────┘         └──────────────────────────────────┘
```

---

## 快速开始

### 环境要求

- **Node.js ≥ 18**（仓库自带便携版 `nodejs/`，无需单独安装；也可用自己的 Node）
- 操作系统：Windows / macOS / Linux 均可；生产推荐 Docker

### 方式一：Windows 一键启动（推荐）

双击根目录 **`启动系统.bat`**，它会自动：释放 3333 端口 → 安装缺失依赖 → 构建前端（若缺 `server/public/index.html`）→ 拉起后端 → 打开浏览器。

- 访问：http://localhost:3333
- 默认账号：`admin` / `admin123`

### 方式二：手动启动（跨平台）

```bash
# 1) 后端
cd server
npm install
PORT=3333 node src/index.js

# 2) 另开一个终端，启动前端 dev（带 /api 代理到 3333）
cd client
npm install
npm run dev          # http://localhost:5173
```

前端 dev 服务器已配置 `proxy: { '/api': 'http://localhost:3333' }`，开发时直接调用相对路径 `/api/...` 即可。

### 方式三：Docker 部署（飞牛 NAS / 服务器）

```bash
docker compose up -d --build
# 映射端口 3333，数据卷 ./data -> /app/data
```

`docker-compose.yml` 已设 `JWT_SECRET`、`LANG=C.UTF-8`；`Dockerfile` 为多阶段构建（先构建前端、再装生产依赖、最后拷贝 `dist` 到 `public`）。

### 生产构建（更新前端后）

仓库根目录执行：

```bash
node build-safe.mjs     # 移旧产物 → vite build → 回拷 client/dist 到 server/public
```

生产静态文件由 `server/public` 提供（不是 `client/dist`），手工分步易漏拷贝导致 500。

---

## ⚠️ 安全提醒（部署公网前必读）

1. **改默认密码**：系统初始管理员账号为 `admin` / `admin123`，首次部署请立即在「系统设置」或通过 `POST /api/auth/change-password` 修改。
2. **设置 JWT_SECRET**：生产环境务必通过环境变量显式设置 `JWT_SECRET`（`docker-compose.yml` 中的值仅为占位示例，请替换为随机串）。未设置时后端会自动生成并持久化到 `server/.jwt_secret`。
3. **配置 CORS**：默认仅允许本地白名单；部署到其他域名 / 飞书内嵌 / 公网时，用 `CORS_ORIGINS` 环境变量显式指定允许的来源（逗号分隔）。
4. **生产数据不入库**：本仓库已通过 `.gitignore` 排除生产数据库（`*.db`）、便携 Node 运行时（`nodejs/`）、依赖（`node_modules`）、构建产物、密钥文件与运行日志。请勿将真实业务数据库提交进仓库。

---

## 环境变量

| 变量 | 默认值 | 作用 |
|---|---|---|
| `PORT` | `3333` | HTTP 监听端口 |
| `JWT_SECRET` | 无则自动生成并持久化到 `server/.jwt_secret` | JWT 签名密钥，**生产务必显式设置** |
| `CORS_ORIGINS` | 本地白名单 | 允许跨域来源（逗号分隔） |
| `DB_PATH` | `server/data/store.db` | SQLite 数据库路径（测试可指向临时文件） |
| `AUTO_BACKUP` | 启用（`off` 关闭） | 自动备份总开关 |
| `AUTO_BACKUP_HOUR` | `3` | 每日备份触发小时（0-23） |
| `AUTO_BACKUP_KEEP` | `30` | 保留备份份数（1-365） |
| `LOG_KEEP_DAYS` | `14` | 日志保留天数 |

---

## 项目结构

```
store-order/
├─ 启动系统.bat            # Windows 一键启动
├─ deploy.bat              # Windows 部署（自检→构建→拷→重启→冒烟）
├─ build-safe.mjs          # 安全构建脚本（移旧产物 → vite build → 回拷 server/public）
├─ Dockerfile / docker-compose.yml
├─ nodejs/                 # 便携 Node 运行时（生产用，已 gitignore）
├─ client/                 # 前端（React 18 + antd 5 + Vite）
│  └─ src/                 # 入口 / 路由 / 页面 / 组件 / 设计令牌
└─ server/
   ├─ src/
   │  ├─ index.js          # 入口：路由注册、静态托管、SPA fallback、全局错误处理
   │  ├─ db.js             # 建表 + 幂等 initDb + 调用迁移
   │  ├─ stock.js          # 库存收口
   │  ├─ middleware/       # auth.js（JWT+角色+限流）、requestLog.js
   │  ├─ routes/           # 业务路由
   │  ├─ services/         # 业务下沉层
   │  └─ utils/            # storeScope（多店隔离）/ audit / autoBackup / migrations / aggCache
   ├─ data/store.db        # 主数据库（已 gitignore）
   ├─ public/              # 生产前端静态文件（由 client/dist 回拷而来）
   ├─ logs/                # 请求 / 错误日志（按天，已 gitignore）
   └─ scripts/             # 自检 / 冒烟 / 回归测试（verify-*.mjs，共 12 套件）
```

> 改了后端代码（`db.js` / `routes/*` / `index.js`）必须重启后端进程才加载新代码；前端改动后需重新构建。

---

## 二次开发与文档

- **开发者完全手册**：[`docs/开发者指南.md`](docs/开发者指南.md) —— 本系统的唯一权威文档，读完即可本地跑起来、读懂任意接口、独立新增业务模块（含「从零加一个模块」完整模板、路由挂载顺序铁律、多店隔离别名约定、踩坑清单）。
- **代码审计报告**：[`docs/code-review-report-2026-10-07.md`](docs/code-review-report-2026-10-07.md) —— 全量代码审计结论与修复记录。
- **回归测试**：改完代码运行 `npm run verify`（或 `node scripts/verify-all.mjs`），12 套件覆盖冒烟、业务流、审计、迁移、service 层等，测试用 `DB_PATH` 指向临时库，不碰生产数据。

---

## 常见问题

**Q：默认管理员密码是多少？**
A：`admin / admin123`。生产请立即改密码。

**Q：sales 能看到别的店数据吗？**
A：不能。`storeScope.js` 强制按 `store_id` 隔离；`sales` 仅自身门店与自己名下订单 / 客户。

**Q：Docker 部署后数据在哪？**
A：卷 `./data` 映射到容器 `/app/data`，即 `store.db` 所在。备份 / 恢复走系统设置，或直接备份该目录。

**Q：如何二次开发最稳？**
A：先读 `docs/开发者指南.md` 第九章的「公告模块」模板，照「建表 → 路由（带 storeScope + 审计）→ 注册 → 前端页面 + 菜单」四步走，每加一个接口就手测一次。

---

## License

本项目采用 [MIT License](LICENSE) 开源协议。可自由使用、修改、分发（含商用），仅需保留版权声明与许可声明；软件按「原样」提供，不附带任何担保。
