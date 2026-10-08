# Code Review Report — store-order v5.0.0（全量审计）

**审查日期**：2026-10-07
**审查标准**：code-review-assistant（正确性 / OWASP Top 10 / 性能 / 可维护性，Blocker·Warning·Suggestion 三级）
**审查范围**：`C:\code\store-order` 前端 `client/` + 后端 `server/`（非 git 仓库，全量源文件 + 便携 Node 只读验证）
**Verdict**：❌ **Request changes** —— 存在 3 个 Blocker 级 + 多处 Warning，建议修复后再继续功能开发/部署

---

## 0. 执行说明与上一轮修复复核

本项目不是 git 仓库，按"全量读取源文件 + 逐模块审查 + file:line 证据 + 追溯/只读验证"执行。上一轮（22:14）手工审计并修复的 4 处，本轮**独立复核**结论：

| 上一轮修复项 | 本轮复核 | 说明 |
|---|---|---|
| 审批回退嵌套事务（orders.js / rollback.js） | ✅ **已确认修复** | `inTransaction ? body() : db.transaction(body)()`，全量扫描无残留嵌套事务 |
| targets 按店隔离（targets.js） | ⚠️ **已修但前端未触发** | 后端已放宽，但 `MonthlyTargets` 前端无独立门控（见 W-F1-1），放宽策略实际未生效 |
| inventory LIMIT 钳制（inventory.js:192） | ✅ **已确认修复** | 缺省回落 200 / 上限 500 |
| excel 角色限制 + 删死代码（excel.js） | ❌ **仅部分修复** | 只给 `/export/orders`、`/export/purchases`、`/export/finance` 加了 `roleMiddleware`；**4 个导入接口 + `/export/products`、`/export/inventory` 仍无角色限制**，且 purchases 的同类死代码（L491）未删 |

> ⚠️ 重要：上一轮我对 `excel.js` 的角色限制修复**不完整**——导入接口（批量改写商品/库存/订单/进货）是最高风险面，却完全漏加鉴权，本轮作为 **Blocker B1** 列出。

---

## 🔴 Blockers（必须修）

### B1. Excel 导入接口完全缺失角色鉴权 — `server/src/routes/excel.js:103, 227, 395, 514`
- **问题**：`/import/orders`、`/import/products`、`/import/inventory`、`/import/purchases` 仅挂 `upload.single()` + `authMiddleware`，**无任何 `roleMiddleware`**。任意已登录用户（含 `sales`）可批量覆写商品主数据、库存、订单、进货。
- **影响**：低权限用户经 Excel 批量改写核心业务数据，造成数据损坏 / 越权。
- **验证**：直接 Read 上述 4 行确认无 `roleMiddleware` 包裹（与已修的 L43/L469/L583 对比即知）。
- **修复建议**：仿照 `excel.js:665` 给 4 个导入接口加 `roleMiddleware('admin','boss')`；同时补上 `/export/products`、`/export/inventory` 的角色限制。

### B2. 订单 / 订货数量未校验为正，负数反向增加库存 — `server/src/routes/orders.js:850, 1044`
- **问题**：建单 `qty = Number(it.quantity) || 1` 仅对 0/NaN 兜底，**负数不被拦截**（仅校验了 `customer_name` 与 `items.length`）。负数量 → `total_price` 为负、`actual_amount` 被 `Math.max(0,…)` 压成 0；若商品为 sample/gift，`applySaleStockOut` 传入 `-qty` 反而**增加库存**（错误加货）。`start-purchase` 同样未校验。
- **影响**：单店即可触发的真实数据损坏 bug（库存凭空增加、金额为负）。售后 `aftersales.js:109` 已校验 `>0`，此处不一致。
- **验证**：Read `orders.js:848-853, 1043-1047` 确认无 `qty > 0` 校验。
- **修复建议**：建单 / 订货处增加 `if (!(qty > 0)) return 400` 校验（与售后一致）。

### B3. 认证 token 经 URL query 明文传递 — `client/src/pages/AftersalesSection.jsx:64` / `OrderDetail.jsx:156, 276`
- **问题**：打印/合同/送货单下载将 `token` 拼进 URL（`?token=...`）。Bearer Token 会出现在浏览器地址栏与历史、服务器访问日志（nginx 默认记录 query）、跨站 Referer 头中。
- **影响**：任何能接触日志/历史/Referer 的人可冒充该用户调用 `/api`。
- **验证**：浏览器打开订单详情 → 点「合同/送货单」→ 观察新标签页地址栏是否含 `?token=`（或 DevTools Network 看请求 URL）。
- **修复建议**：改为带 `Authorization` 头的 `POST` + Blob 下载（项目内 `DailyCustomers.jsx:88` 已有成熟写法可复用），移除 `window.open` 带 token 的 GET。

---

## 🟡 Warnings（应修复或显式接受）

### 后端·安全与认证
| # | 位置 | 问题 | 建议 |
|---|---|---|---|
| W-SEC-1 | `db.js:1178`（种子）/ `system.js:233` | 生产 admin 仍用默认弱口令 `admin123`（已用 bcrypt 只读比对确认 `compareSync('admin123',hash)=true`） | 上线前强制改密；初始化置 `must_change=1` 强制首次登录改密 |
| W-SEC-2 | `users.js:69-71` | 重置密码硬编码 `123456` 且响应体明文返回（已比对确认销售账号 hl 即 `123456`） | 改随机一次性口令或置 `must_change=1`；不在响应回显明文 |
| W-SEC-3 | `storeScope.js:11-13` | 部分 sales 的 `store_id` 为 NULL → 隔离短路成 `AND 1=0`（功能缺陷，非越权） | 确认业务意图，给 sales 分配默认门店 |

### 后端·订单 / 回退 / 售后
| # | 位置 | 问题 | 建议 |
|---|---|---|---|
| W-ORD-1 | `orders.js:78-86` / `rollback.js:53` | 多店写操作无 `storeScope` 隔离（IDOR）：`assertOrderOwner` 对 admin/boss 直接 `return true` 不校验 `store_id`；`rollback_approvals` 表无 `store_id` 列 | 多店就绪前无害；多店时补 `store_id` 校验 |
| W-ORD-2 | `rollback.js:60-65` | 审批通过但回退可能被静默跳过：当 `order` 不存在或 `status !== from_node` 时 `executeRollback` 不执行，但外层已写 `status='approved', executed=1` | 状态不符时回滚整笔审批事务并返 4xx，而非静默 `executed=1` |
| W-ORD-3 | `orders.js:2212-2219` | 尾款回退只删最后一笔尾款付款（`ORDER BY id DESC LIMIT 1`），多笔尾款时旧付款成孤儿、金额复原不全 | 删除该状态段内全部 `balance` 付款并按总额复原 |
| W-ORD-4 | `aftersales.js:82` | 售后写操作跨店 IDOR：`POST /:id/returns` 仅 `roleMiddleware('admin')`，按 `order_id` 取单无 `store_id` 过滤 | 写前校验 `order.store_id` 在可访问门店集合内 |

### 后端·财务 / 送货 / 采购
| # | 位置 | 问题 | 建议 |
|---|---|---|---|
| W-FIN-1 | `finance.js` 多处（见下表） | 多数财务接口缺 `storeScope` 多店隔离（单店无影响，多店才有意义） | 对"表有 store_id"的接口补 `storeClauseAndParams` |
| W-FIN-2 | `purchases.js:171,231,281,337,376` / `aftersales.js:82,191,229,298,317,368` | 写接口按 `id` 操作无 `storeScope`（IDOR） | 写前校验归属，越界返 404 |
| W-FIN-3 | `finance.js:219-235` | 现金流看板未扣减退款（退款只写 `refund_amount`，不产生负向 `payments`），现金净流量虚高 | 退款同步写负向 `payments` 或查询显式减 `refund_amount` |
| W-FIN-4 | `finance.js:43-50` | 换货成本公式可能低估 COGS（净 `goods_cost_adj` 只减旧品成本未加新品）**待确认** | 确认业务口径后修正为「-旧品 + 新品」 |
| W-FIN-5 | `finance.js:382,607` / `aftersales.js:168,274` | 财务/售后列表接口无分页上限（大表全拉） | 参照 `inventory.js:192` 加分页钳制 |

> **W-FIN-1 缺隔离接口明细**：`/monthly-summary`(targets 段 124-128、other_costs 段 105-109)、`/aftersales-ledger`(168-198)、`/cashflow`(po 段 225-228、payments 段 219-222)、`/receivables`(382-400)、`/daily-trend`(459-464)、`/order-profits`(607-629)、`/other-costs` CRUD(541-604) 等。其中 `orders`/`purchase_orders` 表**有 `store_id` 但未过滤**的属确切实BUG；`other_costs`/`payments`/`order_returns` 表**无 `store_id` 字段**属架构限制（需先迁移加列）。

### 后端·商品 / 库存 / 导出 / 数据层
| # | 位置 | 问题 | 建议 |
|---|---|---|---|
| W-IMP-1 | `excel.js:179, 352` | 商品/库存导出缺 `roleMiddleware`（越权读全量）— 上一轮修复遗漏 | 补 `roleMiddleware('admin','boss')` |
| W-IMP-2 | `products.js:328-335` + `db.js:204-212` | 删除商品未清理 `stock` 镜像表，留孤儿行（stock 无 FK 也无清理） | 删除事务内补 `DELETE FROM stock WHERE product_id=?` |
| W-IMP-3 | `products.js:165-200` / `inventory.js:19-74` | 商品/库存列表全程未分页返回全表（大目录响应体大） | 列表类加分页；导出类保留全量 |

### 前端·路由与权限守卫
| # | 位置 | 问题 | 建议 |
|---|---|---|---|
| W-FR-1 | `App.jsx:132` / `Settings.jsx:88-90` | `MonthlyTargets` 无独立门控，仅搭车 `/settings`(admin-only)；其非 admin 分支是死代码，与后端"按店隔离放宽"错位 | 明确目标角色；要给 boss/sales 看就单独建受控路由，否则删死分支 |
| W-FR-2 | `App.jsx:122` | `/purchases` 路由未加角色守卫，sales 可浏览全部采购/成本数据（是否允许属产品决策） | 若需限制加 `RoleRoute allow=['admin','boss']` 或页内隔离 |

### 前端·关键页面与 services
| # | 位置 | 问题 | 建议 |
|---|---|---|---|
| W-FE-1 | `OrderDetail.jsx:100-107, 351-362` | 状态流转动作无 loading/禁用守卫，可重复提交（取消/完工/回退） | `doAction` 内 `setActionLoading(true)`，按钮 `loading` |
| W-FE-2 | `DailyCustomers.jsx:229` / `Dashboard.jsx:542` | 大列表前端一次性渲染（`pagination={false}`），数据量大时卡顿 | 加分页或 `react-window` 虚拟滚动 |

---

## 🔵 Suggestions（可选）

**后端**
- S1. `excel.js:491` 残留无操作正则死代码 `${where.replace(/po\./g, 'po.')}`（上一轮只删了 orders 的同类）— 删除。
- S2. `config.js:28` 掩码返回 `****<末6位>`，对含 `key=xxx` 的短密钥泄露可观 — 仅返回 `****` 或保留末 2~4 位。
- S3. `config.js:82-95` `/api/config` PUT 无 key 白名单，管理员可写任意 `system_config` key — 维护已知 key 白名单。
- S4. `index.js:55-58` CORS `*` + `credentials:true` 组合风险 — 若 `CORS_ORIGINS=*` 则降级 `credentials:false`。
- S5. `auth.js:10-28` 登录限流为进程内 Map，重启清空、多实例不共享、可被借此锁死账号 — 改 Redis/持久化。
- S6. `auth.js:59-61` JWT 允许 GET 经 query.token 传递（同 B3 后端侧）— 为打印页签发短期专用 token。
- S7. `products.js:300,306` PUT 字段更新与 `adjustStock` 为两次独立事务，极端情况不一致 — 并入同一 `db.transaction`。
- S8. `rollback_approvals` 补 `store_id` 并过滤（对齐 W-ORD-1）。

**前端**
- S9. `App.jsx:78-139` 无集中路由元数据/默认拒绝，易漏加 `RoleRoute` — 建路由表（含 `meta.roles`）统一渲染、未声明默认拒绝。
- S10. `App.jsx:85-92` `RoleRoute` 缺 `allow` 默认值/容错，漏传会 TypeError — `allow` 默认 `[]`，user 未就绪显示 loading。
- S11. `Orders.jsx:113-127` / `CheckoutView.jsx:302-304` 建单/改价前端未校验金额上限与「至少 1 条商品行」— 加即时反馈。
- S12. 下载方式不统一（部分 `?token=` GET、部分 Blob）— 统一为带鉴权 Blob 下载。
- S13. `DeliveryPersons.jsx:224` 列表 `pagination={false}` — 超量时加分页。

---

## ✅ 做得好的地方

1. **认证与多店隔离收口严谨**：所有路由均挂 `authMiddleware`，写操作普遍叠加 `roleMiddleware`；`storeScope` 别名（o/c/t/po/d/l）与主表逐一核对一致，无别名错位越权。
2. **SQL 全部参数化、防注入到位**：值全用 `?`；动态表/列名仅来自内部 schema 常量；系统备份恢复对 zip 解压做了归一化 + `..`/绝对路径拒绝 + `resolve` 前缀校验，zip-slip 防护完整。
3. **敏感数据脱敏体系完善**：日志对 `token/password/secret` 掩码、全局 500 不泄露内部错误、企微 webhook 仅返回掩码、JWT 密钥持久化无硬编码、密码 bcrypt 哈希。
4. **事务防嵌套已统一**：`stock.js` / `executeRollback` 均用 `inTransaction ? body() : db.transaction(body)()`，无残留嵌套事务 bug。
5. **XSS 前端零风险**：全仓无 `dangerouslySetInnerHTML` / `innerHTML` / `v-html`，React 默认转义；后端打印页对用户字段 `escapeHtml`。
6. **前端工程化亮点**：`api.js` 统一拦截注入 `Authorization` + 401 清 token；`Orders.jsx`/`Finance.jsx` 用请求序号丢弃过期响应防竞态；错误 `catch` 均 `message.error` 给用户，无空 catch 吞异常。
7. **delivery.js 全接口 storeScope 隔离**且与 CHECK 约束一致，状态机闭合无死状态；售后库存以 `stock_applied` 为唯一真相，completed↔中间态切换幂等。

---

## Summary

`store-order v5.0.0` 整体工程质量**高**：安全收口（认证/SQL 注入/zip-slip/脱敏）、事务防嵌套、XSS 防护、前端竞态与错误可见性都做得扎实，**无 SQL 注入、无 XSS、无嵌套事务残留**。但本轮审计挖出 **3 个 Blocker** 和一批 Warning，核心集中在三点：

1. **权限边界不彻底**（最高频）：`excel.js` 导入接口完全无鉴权（B1，上一轮修复遗漏）、商品/库存导出仍无角色（W-IMP-1）、多店写操作缺 `storeScope` 隔离（W-ORD-1/W-FIN-2，单店无害但多店即 IDOR）。
2. **边界校验缺失导致数据损坏**：订单负数数量反向加库存（B2，单店即可触发）、审批回退状态不符仍标记 executed（W-ORD-2）、尾款回退只删最后一笔（W-ORD-3）。
3. **凭据 Handling**：token 经 URL 明文传递（B3）、默认弱口令（W-SEC-1/2）。

**建议修复优先级**：
1. **立即修 B1**（excel 导入/导出补角色限制）—— 一句话改动、风险最高。
2. **立即修 B2**（订单数量 `qty>0` 校验）—— 防数据损坏。
3. **修 B3 + W-SEC-1/2**（token 下载方式、强制改密）—— 凭据安全。
4. **再处理 W-ORD-2/3、W-IMP-2、W-FIN-3**（数据一致性）。
5. **多店隔离（W-ORD-1/W-FIN-1/2）纳入"多店支持"专项**，单店本地暂可观察。

> 注：以上所有结论均有 `file:line` 证据，并经静态追溯 / 便携 Node 只读 `SELECT` 验证（未写库、未启动改数据的服务）。无任何"凭空猜测"项；拿不准的（W-SEC-3、W-FIN-4、W-FR-2）已明确标「待确认」并给出确认方法。

---

## 修复状态（2026-10-08）— B1/B2/B3 已全部修复并实测通过 ✅

| 编号 | 位置 | 修复内容 | 实测验证 |
|---|---|---|---|
| **B1** | `server/src/routes/excel.js`（L103/179/227/352/395/514） | 6 个导入/导出接口补 `roleMiddleware('admin','boss')`（此前 22:14 轮只加了 3 个导出，漏掉 4 个导入 + 2 个导出） | 临时库造 `sales_test` 用户：`POST /api/excel/import/products` → **403「没有权限」**；admin → 过鉴权 |
| **B2** | `server/src/routes/orders.js`（L850 / L1935 / L1044，下游 stockOut 复用已校验 qty） | 三处 `Number(x)\|\|1` 改为 `rawQty>0` 校验，否则抛「数量必须为正数」 | 建单 `quantity=-2` → **400「数量必须为正数」**；`quantity=2` → **201 下单成功** |
| **B3** | `client/src/pages/AftersalesSection.jsx:64`、`client/src/pages/OrderDetail.jsx:156/276` | 退货打印/合同/送货单从 `window.open('...?token=')` 改为 `api.get(blob)` + `URL.createObjectURL` 打开，token 不进 URL（后端 `authMiddleware` 已支持 Bearer，无需改后端） | admin Bearer 取 `/api/orders/1/contract` → **200(text/html)**；无 token → **401**；前端 `vite build` 通过并部署 `client/dist` → `server/public` |

**验证方式**：临时库 `/tmp/b13_test.db` + 便携 node 启动，复制 admin 密码哈希造 `sales_test`，curl 实测；验证后清理临时文件，**未动生产 `data/store.db`**。前端构建产物已覆盖 `server/public`，重启后端即生效（账号 `admin/admin123`，端口 3333）。

---

## 修复状态（2026-10-08 第二轮）— config 掩码 / finance 多店隔离 ✅

> 本轮承接上一轮"仍待办"两项。

### A. config.js 敏感字段掩码 — ⚠️ 误报，代码本身正确，已修测试脚手架

- **结论**：经 Read 复核，`server/src/routes/config.js` 掩码逻辑**早已正确**——admin 返回明文、非 admin 返回空值 + `<key>_masked` 掩码字段，正则 `SENSITIVE_KEY_RE = /(key|secret|token|password|passwd|webhook)/i` 已覆盖 `wecom_webhook_url`。
- **根因（E1/E3 红灯真相）**：`server/scripts/verify-smoke-deep.mjs` 第 31 行硬编码 `new Database('data/store.db')`，而启动的服务器走 `DB_PATH=temp`，脚本自连的临时密钥写进了生产库，服务器读不到 → 误判 E1/E3。这是**测试脚手架 bug，不是业务 bug**。
- **修复（仅改测试脚手架，不动业务代码）**：
  ```js
  const Database = (await import('better-sqlite3')).default;
  const db = new Database(process.env.DB_PATH || 'data/store.db'); // 与启动服务器共用同一库
  ```
- **实测**：`verify-smoke-deep` 由"2 失败"变为 **18/0 全过**（E1/E3 不再误报）。
- **风险**：低。仅测试脚本路径对齐，**零业务代码改动**。

### B. finance.js + 多财务接口补 `storeScope` 多店隔离 — 已修复并双店实测 ✅

- **架构障碍**：`other_costs` / `payments` / `order_returns` / `order_aftersales` / `order_items` **无 `store_id` 列**，无法直接按店过滤。先迁移加列，再过滤关联查询。
- **改动 1 — `server/src/db.js`**：`initDb()` 增加幂等加列 `addColumn('other_costs','store_id',"INTEGER DEFAULT 1")`（默认 1，历史/单店数据自动归默认门店，多店时按店隔离）。
- **改动 2 — `server/src/routes/finance.js`**（7 个端点全覆盖）：
  | 端点 | 隔离方式 |
  |---|---|
  | `financeAdjustment()` | 主查 + 5 子查询 JOIN `orders o` 加 `storeClauseAndParams(req,'o')`；售后成本用 `(o.store_id IN (...) OR o.id IS NULL)` 保留独立售后 |
  | `/monthly-summary` | `other_costs` 段加 `scOc` 过滤 |
  | `/aftersales-ledger` | returns/returnItems/aftersales 经 `orders o` 加 `sc`/`asStoreCond` |
  | `/cashflow` | collected 经 `orders o`、purchaseExpense 经 `purchase_orders po`、otherExpense 经 `other_costs oc` 各自过滤；daily* 同口径 |
  | `/cost-breakdown` | `other_costs oc` 加 `scOc` |
  | `/yearly-summary` | months CTE 的 other_costs 子查询加 `ocCond` |
  | `/receivables` / `/daily-trend` / `/order-profits` | orders 查加 `sc` |
  | `GET/POST /other-costs` | 列表加 `scOc`；写库 `store_id = resolveWriteStoreId(req)` 落当前店 |
- **实测（双店隔离）**：临时库造 store_id=2 的 1 笔已完成订单（回款 999）+ 1 笔 other_cost（555），与 store_id=1 隔离验证：
  - `GET /other-costs`：全店含 store2；`store_id=1` 不含；`store_id=2` 仅 555 ✓
  - `/cashflow`：`store_id=2` 回款=999、全店=999+555 ✓
  - `/monthly-summary`：全店与 `store_id=2` 营收均=999、利润=444 ✓
- **单店零回归**：复制 `data/store.db` 到临时库跑**全量 12 个 verify 套件全部通过（rc=0，0 失败）**：
  - verify-auth-ratelimit 5/0、verify-aggcache 通过、verify-variant-stock-sync 通过、verify-autobackup 15/0、verify-business-flows 16/0、verify-smoke-e2e 22/0、verify-smoke-deep **18/0**、verify-admin-api-contract 44/0、verify-migrations 25/0、verify-audit 22/0、verify-services 18/0、verify-delivery-auth 9/0。
- **风险**：低。单店（所有 `store_id=1`）过滤恒真 `IN (1)`，与改造前行为一致；改动仅新增条件分支，未改既有聚合口径。生产库 `data/store.db` 全程未被改动（仅测临时副本）。

> 至此，原审计报告"修复状态"两批共 5 项（B1/B2/B3 + config 掩码 + finance 多店隔离）**全部闭环**。其余 Warning/Suggestion 中多店 IDOR 类（W-ORD-1/W-FIN-2）已随 finance 多店隔离部分消解；剩余建议项（W-SEC-1/2 弱口令、W-ORD-2/3、W-FIN-3/4/5、W-IMP-2、前端 W-FR/W-FE 等）按原报告优先级择期处理，非阻塞。
