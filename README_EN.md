# store-order · Store Order Management System

A full-lifecycle operations management web system for physical retail stores (retail / wholesale / furniture & building materials / general stores). It covers the complete business loop from "lead follow-up → order → purchase → stocking → delivery → sign-off → finance → after-sales", plus store daily reports, a knowledge base, business analytics, and WeCom (Enterprise WeChat) push.

The codebase is **category-agnostic** (no hard-coded "bed / sofa / screw" constraints). The product, customer, order, and promotion models are all generic, so it works for convenience stores, clothing shops, hardware stores, etc.

- Version: v5.0.0
- Default URL: http://localhost:3333

## Features

| Area | Capabilities |
|---|---|
| Customer CRM | Customer master, follow-up timeline, duplicate check, lead-source analysis, today's follow-ups, daily-report lead capture |
| Products / Inventory | Multi-variant products, 3-price model (cost/sale/break-even), sample & gift stock, multi-warehouse mirror, stock logs |
| Orders | 14-state state machine, deposit / balance / full payment, contract printing, partial delivery, sign-off, cancel, rollback approval |
| Purchasing | Purchase orders, arrivals, PO-item → order-item allocation, derived in-transit quantity |
| Delivery | Delivery orders, sign-off, rollback, delivery-person management |
| Returns / After-sales | Return/exchange orders, after-sales tickets (repair / parts / complaint), parts outbound, precise stock rollback |
| Finance | Monthly / yearly summary, cash flow, cost breakdown, receivables, after-sales ledger, other costs |
| Promotions | Coupons (full-reduction / discount / channel), bundles |
| Daily report | Configurable sales daily report, lead details, store-close push, long-image sharing |
| Knowledge base | Sales-note waterfall, favorites / view history, admin console, rich media |
| Analytics | Sales trend, category share, customer value, sales ranking, conversion funnel, profit, best-sellers |
| Multi-store / multi-warehouse | Stores, warehouses, store targets, cross-store comparison, store-scoped data isolation |
| System | One-click backup / restore / factory-reset, auto-backup, request / error logs, config masking, JWT auth, login rate-limit |

### Roles & data scope

| Role | Capabilities | Data scope |
|---|---|---|
| `admin` | Everything, including system settings, backup / restore / reset, approvals | All stores (can scope to one via `?store_id=`) |
| `boss` | Near-admin, no dangerous system ops (reset / restore are admin-only) | All stores |
| `sales` | Ordering / daily report / customer follow-up / knowledge browsing | Only own store and own orders / customers |

## Tech Stack

| Layer | Tech | Notes |
|---|---|---|
| Frontend | React 18 + Ant Design 5 + Vite 5 + react-router-dom 6 + recharts 3 | `client/` |
| Backend | Node (portable `nodejs/` bundled, no install needed) + Express 4 + better-sqlite3 | `server/`, ESM |
| Database | SQLite single file (`server/data/store.db`), WAL mode | Synchronous API, zero external deps |
| Auth | jsonwebtoken (JWT, 30-day) | Roles: `admin` / `boss` / `sales` |
| Push | WeCom group-bot Webhook | Outbound only |
| Packaging | archiver / adm-zip / sharp / xlsx | see `server/package.json` |

## Quick Start

### Requirements
- Node.js ≥ 18 (a portable `nodejs/` is bundled; your own Node works too)
- Windows / macOS / Linux; Docker recommended for production

### Option A: One-click on Windows
Double-click **`启动系统.bat`** at the repo root. It frees port 3333 → installs missing deps → builds the frontend (if `server/public/index.html` is absent) → starts the backend → opens the browser.
- Visit: http://localhost:3333
- Default account: `admin` / `admin123`

### Option B: Manual (cross-platform)
```bash
# Backend
cd server && npm install
PORT=3333 node src/index.js

# Frontend (dev, proxies /api to 3333) — another terminal
cd client && npm install
npm run dev          # http://localhost:5173
```

### Option C: Docker
```bash
docker compose up -d --build
# Port 3333; volume ./data -> /app/data
```

### Production build
```bash
node build-safe.mjs   # remove old build → vite build → copy client/dist to server/public
```
Production static files are served from `server/public` (not `client/dist`).

## ⚠️ Security (read before deploying publicly)
1. **Change the default password**: `admin` / `admin123`. Change it immediately after first deploy.
2. **Set JWT_SECRET**: set it via env var in production (`docker-compose.yml` value is a placeholder — replace with a random string). If unset, the backend auto-generates and persists it to `server/.jwt_secret`.
3. **Configure CORS**: default allows localhost only. For other domains / Feishu embed / public, set `CORS_ORIGINS` (comma-separated).
4. **Production data is not in the repo**: `.gitignore` excludes the production DB (`*.db`), the portable Node runtime (`nodejs/`), dependencies (`node_modules`), build output, secrets, and runtime logs. Do not commit real business databases.

## Environment Variables

| Var | Default | Purpose |
|---|---|---|
| `PORT` | `3333` | HTTP listen port |
| `JWT_SECRET` | auto-generated to `server/.jwt_secret` | JWT signing key — **set explicitly in production** |
| `CORS_ORIGINS` | localhost whitelist | Allowed CORS origins (comma-separated) |
| `DB_PATH` | `server/data/store.db` | SQLite path (tests may point to a temp file) |
| `AUTO_BACKUP` | on (`off` to disable) | Auto-backup switch |
| `AUTO_BACKUP_HOUR` | `3` | Daily backup hour (0-23) |
| `AUTO_BACKUP_KEEP` | `30` | Backups retained (1-365) |
| `LOG_KEEP_DAYS` | `14` | Log retention days |

## Project Structure
```
store-order/
├─ 启动系统.bat / deploy.bat / build-safe.mjs
├─ Dockerfile / docker-compose.yml
├─ nodejs/                 # portable Node runtime (gitignored)
├─ client/                 # frontend (React 18 + antd 5 + Vite)
└─ server/
   ├─ src/                 # index.js, db.js, stock.js, middleware/, routes/, services/, utils/
   ├─ data/store.db        # main DB (gitignored)
   ├─ public/              # production frontend (copied from client/dist)
   ├─ logs/                # request / error logs (gitignored)
   └─ scripts/             # self-check / smoke / 12 verify suites
```

## Documentation & Contributing
- **Developer guide (Chinese):** [`docs/开发者指南.md`](docs/开发者指南.md) — the authoritative manual.
- **Code review report (Chinese):** [`docs/code-review-report-2026-10-07.md`](docs/code-review-report-2026-10-07.md)
- **Regression tests:** `npm run verify` (or `node scripts/verify-all.mjs`) — 12 suites, uses `DB_PATH` temp DB, never touches production.
- Issue and PR templates live under `.github/`.

## License
[MIT](LICENSE) — free to use, modify, and distribute (including commercial), provided the copyright notice is retained. Software is provided "as is", without warranty.
