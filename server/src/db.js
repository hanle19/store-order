import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import bcrypt from 'bcryptjs';
import { runMigrations, getSchemaVersion } from './utils/migrations.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'store.db');

let db;

export function getDb() {
  if (!db) {
    initDb();
  }
  return db;
}

// 上传目录（运行时图片/视频存放处，与 upload.js / index.js 保持一致）
export function getUploadsDir() {
  return path.join(__dirname, '..', 'uploads');
}

// 备份目录（data/backups）
export function getBackupsDir() {
  return path.join(path.dirname(DB_PATH), 'backups');
}

// 关闭当前数据库连接（用于一键恢复时安全替换数据库文件）
export function closeDb() {
  if (db) {
    try { db.close(); } catch (e) { /* 忽略 */ }
    db = null;
  }
}

export function initDb() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000'); // 并发写遇锁时等待 5s 而非立即抛 SQLITE_BUSY

  // 迁移助手函数
  const addColumn = (table, col, def) => {
    const hasCol = db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === col);
    if (!hasCol) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
      console.log(`[DB] ${table}.${col} 字段已添加`);
    }
  };

  // 物理删除列（仅用于清理已废弃字段，如原价/折扣价）；新库不再创建，旧库在此清理
  const dropColumnIfExists = (table, col) => {
    try {
      const hasCol = db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === col);
      if (hasCol) {
        db.exec(`ALTER TABLE ${table} DROP COLUMN ${col}`);
        console.log(`[DB] ${table}.${col} 字段已删除`);
      }
    } catch (e) { console.warn(`[DB] drop ${table}.${col} skipped:`, e.message); }
  };

  const dropIndex = (name) => {
    try { db.exec(`DROP INDEX IF EXISTS ${name}`); } catch(e) {}
  };

  // =====================================================
  // 基础表结构
  // =====================================================

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin','boss','sales')),
      phone TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      model TEXT DEFAULT '',
      code TEXT UNIQUE,
      category TEXT NOT NULL CHECK(category IN ('sample','gift','order')),
      unit TEXT DEFAULT '件',
      spec TEXT DEFAULT '',
      price REAL NOT NULL DEFAULT 0,
      cost_price REAL DEFAULT 0,
      description TEXT,
      image_url TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS inventory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES products(id),
      quantity INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      UNIQUE(product_id)
    );

    CREATE TABLE IF NOT EXISTS inventory_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES products(id),
      change_amount INTEGER NOT NULL,
      after_quantity INTEGER NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('in','out','adjust')),
      reason TEXT,
      order_id INTEGER,
      operator_id INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS product_variants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES products(id),
      spec TEXT NOT NULL,
      price REAL NOT NULL DEFAULT 0,
      cost_price REAL DEFAULT 0,
      stock INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS monthly_targets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      year INTEGER NOT NULL,
      month INTEGER NOT NULL,
      user_id INTEGER REFERENCES users(id),
      target_amount REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      UNIQUE(year, month, user_id)
      -- 注：本表级约束对 user_id IS NULL 的行不互斥（NULL 视为互异），无法保护"门店级目标"幂等。
      -- 门店级唯一性由下方迁移创建的部分唯一索引 uniq_store_target(store_id, year, month) WHERE user_id IS NULL 保证。
      -- 此处约束仅对"用户级目标(user_id 非空)"生效，作为历史定义保留，勿依赖它做门店级去重。
    );

    CREATE TABLE IF NOT EXISTS product_names (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      brand TEXT DEFAULT '',
      model TEXT DEFAULT '',
      spec TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS other_costs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      year INTEGER NOT NULL,
      month INTEGER NOT NULL,
      name TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      category TEXT DEFAULT 'other',
      note TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
  `);

  // =====================================================
  // v5.0 多店多仓：stores / warehouses / stock 表（叠加层，向后兼容）
  // =====================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS stores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      code TEXT DEFAULT '',
      address TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      manager_id INTEGER REFERENCES users(id),
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS warehouses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      code TEXT DEFAULT '',
      store_id INTEGER NOT NULL DEFAULT 1,
      is_default INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      note TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS stock (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      variant_id INTEGER NOT NULL DEFAULT 0,
      warehouse_id INTEGER NOT NULL DEFAULT 1,
      quantity INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      UNIQUE(product_id, variant_id, warehouse_id)
    );
    CREATE INDEX IF NOT EXISTS idx_stock_product ON stock(product_id);
    CREATE INDEX IF NOT EXISTS idx_stock_wh ON stock(warehouse_id);
  `);

  // 配送师傅表
  db.exec(`
    CREATE TABLE IF NOT EXISTS delivery_persons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT NOT NULL DEFAULT '',
      note TEXT DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
  `);

  // =====================================================
  // 销售日报模块（v2 — 客资9字段 + 今日工作6项 + 自动汇总5指标）
  // 独立统计，不碰订单系统；仅复用 users / monthly_targets
  // =====================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS daily_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      salesperson_id INTEGER NOT NULL REFERENCES users(id),
      report_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      -- 汇总字段（闭店提交时从客资自动聚合计算）
      reception_count INTEGER DEFAULT 0,
      deal_count INTEGER DEFAULT 0,
      deal_amount REAL DEFAULT 0,
      phone_count INTEGER DEFAULT 0,
      wechat_count INTEGER DEFAULT 0,
      -- 今日工作（手动填写）
      post_moments INTEGER DEFAULT 0,
      post_douyin INTEGER DEFAULT 0,
      live_stream INTEGER DEFAULT 0,
      follow_up INTEGER DEFAULT 0,
      work_issue TEXT DEFAULT '',
      tomorrow_plan TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      UNIQUE(salesperson_id, report_date)
    );
    CREATE TABLE IF NOT EXISTS daily_customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      salesperson_id INTEGER NOT NULL REFERENCES users(id),
      report_date TEXT NOT NULL,
      customer_name TEXT DEFAULT '',
      customer_desc TEXT DEFAULT '',
      source TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      is_wechat INTEGER DEFAULT 0,
      is_douyin_comment INTEGER DEFAULT 0,
      intention_product TEXT DEFAULT '',
      is_deal INTEGER NOT NULL DEFAULT 0,
      deal_amount REAL DEFAULT 0,
      not_deal_reason TEXT DEFAULT '',
      note TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS daily_field_config (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      field_key TEXT NOT NULL UNIQUE,
      field_label TEXT NOT NULL DEFAULT '',
      field_type TEXT NOT NULL DEFAULT 'number',
      scope TEXT NOT NULL DEFAULT 'report',
      is_enabled INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_daily_reports_sp_date ON daily_reports(salesperson_id, report_date);
    CREATE INDEX IF NOT EXISTS idx_daily_customers_sp_date ON daily_customers(salesperson_id, report_date);

    -- =====================================================
    -- 客户主档：独立于每日日报，长期沉淀，用于门店每日客户跟进
    -- =====================================================
    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      gender TEXT DEFAULT '',
      birthday TEXT DEFAULT '',
      source TEXT DEFAULT '',
      intention_product TEXT DEFAULT '',
      budget REAL DEFAULT 0,
      address TEXT DEFAULT '',
      level TEXT DEFAULT 'C',
      status TEXT DEFAULT 'new',
      is_wechat INTEGER DEFAULT 0,
      is_douyin INTEGER DEFAULT 0,
      owner_id INTEGER,
      note TEXT DEFAULT '',
      last_followup_date TEXT DEFAULT '',
      next_followup_date TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

    -- =====================================================
    -- 客户跟进记录：每日跟进时间线
    -- =====================================================
    CREATE TABLE IF NOT EXISTS customer_followups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL,
      salesperson_id INTEGER NOT NULL,
      followup_date TEXT NOT NULL,
      method TEXT DEFAULT '',
      content TEXT DEFAULT '',
      next_followup_date TEXT DEFAULT '',
      result TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

    CREATE INDEX IF NOT EXISTS idx_customers_owner_status ON customers(owner_id, status);
    CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);
    CREATE INDEX IF NOT EXISTS idx_followups_customer ON customer_followups(customer_id);
    CREATE INDEX IF NOT EXISTS idx_followups_next ON customer_followups(next_followup_date);
  `);

  // 销售日报 v2 字段配置 seed 函数
  function seedDailyFieldConfig(db) {
    const seed = [
      // === report: 今日工作（手动填写）6 项 ===
      ['post_moments',   '发朋友圈',     'number', 'report',    1],
      ['post_douyin',    '发抖音',       'number', 'report',    2],
      ['live_stream',    '开直播',       'number', 'report',    3],
      ['follow_up',      '跟进客户',     'number', 'report',    4],
      ['work_issue',     '今日工作问题',  'text',   'report',    5],
      ['tomorrow_plan',  '明日工作计划',  'text',   'report',    6],
      // === customer: 客资录入（每条保存）9 项 ===
      ['customer_desc',        '客户情况',     'text',   'customer', 7],
      ['customer_name',        '客户名称',     'text',   'customer', 8],
      ['phone',               '客户电话',     'text',   'customer', 9],
      ['source',              '客户来源',     'text',   'customer', 10],
      ['intention_product',   '客户意向产品', 'text',   'customer', 11],
      ['is_deal',             '是否成交',     'select', 'customer', 12],
      ['deal_amount',         '订单金额',     'number', 'customer', 13],
      ['not_deal_reason',     '未成交原因',   'text',   'customer', 14],
      ['is_wechat',           '是否留微信',   'select', 'customer', 15],
      ['is_douyin_comment',   '是否抖音评论', 'select', 'customer', 16],
      // === computed: 自动汇总（闭店时从客资聚合）5 项 ===
      ['reception_count',  '接待组数', 'computed','computed', 17],
      ['deal_count_summary', '成交单数', 'computed','computed', 18],
      ['deal_amount_summary', '成交金额', 'computed','computed', 19],
      ['phone_count_summary', '留电话数', 'computed','computed', 20],
      ['wechat_count_summary', '加微信数', 'computed','computed', 21],
    ];
    const ins = db.prepare(`INSERT OR IGNORE INTO daily_field_config (field_key, field_label, field_type, scope, sort_order) VALUES (?,?,?,?,?)`);
    const tx = db.transaction((rows) => { for (const r of rows) ins.run(...r); });
    tx(seed);
    console.log('[DB] daily_field_config v2 初始化 21 个字段');
  }

  // 字段配置 seed（v2: 6 日报工作 + 9 客资 + 5 自动汇总 = 21 个字段）
  // 检测是否需要迁移：若存在旧行（14个）则清空后重新 seed v2
  const fcCount = db.prepare('SELECT COUNT(*) AS c FROM daily_field_config').get().c;
  if (fcCount === 0) {
    // 全新库，直接 seed
    seedDailyFieldConfig(db);
  } else if (fcCount < 20 && db.prepare("SELECT 1 FROM daily_field_config WHERE field_key='wechat_follow_count' LIMIT 1").get()) {
    // v1 旧字段 → 清空并升级到 v2
    db.exec('DELETE FROM daily_field_config');
    console.log(`[DB] daily_field_config v1→v2 迁移：清除 ${fcCount} 条旧字段`);
    seedDailyFieldConfig(db);
  }

  // 增量迁移：daily_customers 新增字段（兼容已有数据的库）
  addColumn('daily_customers', 'customer_name', "TEXT DEFAULT ''");
  addColumn('daily_customers', 'customer_desc', "TEXT DEFAULT ''");
  addColumn('daily_customers', 'source', "TEXT DEFAULT ''");
  addColumn('daily_customers', 'phone', "TEXT DEFAULT ''");
  addColumn('daily_customers', 'is_wechat', "INTEGER DEFAULT 0");
  addColumn('daily_customers', 'is_douyin_comment', "INTEGER DEFAULT 0");
  addColumn('daily_customers', 'deal_amount', "REAL DEFAULT 0");
  // 增量迁移：daily_reports 新增字段
  addColumn('daily_reports', 'reception_count', "INTEGER DEFAULT 0");
  addColumn('daily_reports', 'phone_count', "INTEGER DEFAULT 0");
  addColumn('daily_reports', 'wechat_count', "INTEGER DEFAULT 0");
  addColumn('daily_reports', 'post_moments', "INTEGER DEFAULT 0");
  addColumn('daily_reports', 'post_douyin', "INTEGER DEFAULT 0");
  addColumn('daily_reports', 'live_stream', "INTEGER DEFAULT 0");
  addColumn('daily_reports', 'follow_up', "INTEGER DEFAULT 0");
  // 增量迁移补全：work_issue / tomorrow_plan / deal_count / deal_amount
  // （这 4 列在 CREATE TABLE 中已定义，但早期库在建表时尚未包含，
  //  且此前漏加 addColumn，导致旧库保存/读取时报错或缺值，长图不显示）
  addColumn('daily_reports', 'work_issue', "TEXT DEFAULT ''");
  addColumn('daily_reports', 'tomorrow_plan', "TEXT DEFAULT ''");
  addColumn('daily_reports', 'deal_count', "INTEGER DEFAULT 0");
  addColumn('daily_reports', 'deal_amount', "REAL DEFAULT 0");

  // 基础索引
  db.exec(`CREATE INDEX IF NOT EXISTS idx_other_costs_ym ON other_costs(year, month)`);

  // =====================================================
  // products 表：增量添加字段（兼容旧库）
  // =====================================================
  addColumn('products', 'spec', "TEXT DEFAULT ''");
  addColumn('products', 'model', "TEXT DEFAULT ''");
  addColumn('products', 'brand', "TEXT DEFAULT ''");
  addColumn('products', 'highlight', "TEXT DEFAULT ''");
  addColumn('products', 'images', "TEXT DEFAULT '[]'");
  addColumn('products', 'detail_desc', "TEXT DEFAULT ''");
  addColumn('products', 'sort_order', "INTEGER DEFAULT 0");
  addColumn('products', 'stock', "INTEGER DEFAULT 0");
  addColumn('products', 'in_transit', "INTEGER DEFAULT 0");
  addColumn('products', 'promo_start', "TEXT DEFAULT ''");
  addColumn('products', 'promo_end', "TEXT DEFAULT ''");
  addColumn('products', 'barcode', "TEXT DEFAULT ''");
  // 商品类目（与 category 货物分类区分）：自由文本，如 手机/笔记本/耳机，服务于通用零售批发
  addColumn('products', 'type', "TEXT DEFAULT ''");
  // 保本价（基础售价）：按进价 ÷ (1 − break_even_margin) 自动计算，低于即亏损
  addColumn('products', 'break_even_price', "REAL DEFAULT 0");
  // 规格表保本价：逐规格按进价与门店利润率自动计算
  addColumn('product_variants', 'break_even_price', "REAL DEFAULT 0");
  // 废弃字段清理：原价 / 折扣价（已按用户要求从商品编辑窗口移除）
  dropColumnIfExists('products', 'original_price');
  dropColumnIfExists('products', 'discount_price');

  // 促销引擎：优惠券、券核销、捆绑套餐（开关关闭时不被使用，建表无副作用）
  db.exec(`
    CREATE TABLE IF NOT EXISTS coupons (
      code TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      threshold REAL DEFAULT 0,
      value REAL NOT NULL,
      scope TEXT NOT NULL DEFAULT 'all',
      scope_ids TEXT DEFAULT '',
      start TEXT DEFAULT '',
      end TEXT DEFAULT '',
      total_qty INTEGER DEFAULT 0,
      used_qty INTEGER DEFAULT 0,
      status INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS coupon_usages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      coupon_code TEXT NOT NULL,
      order_id INTEGER,
      customer_id INTEGER,
      discount_amount REAL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_coupon_usages_code ON coupon_usages(coupon_code);
    CREATE TABLE IF NOT EXISTS bundles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      combo_price REAL NOT NULL,
      category TEXT DEFAULT '',
      brand TEXT DEFAULT '',
      start TEXT DEFAULT '',
      end TEXT DEFAULT '',
      status INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS bundle_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bundle_id INTEGER NOT NULL REFERENCES bundles(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id),
      qty INTEGER DEFAULT 1,
      is_main INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_bundle_items_bundle ON bundle_items(bundle_id);
  `);

  // 优惠券渠道列：coupons 表在上方建表块中才创建，须在建表后补 addColumn，
  // 否则全新库初始化时 coupons 尚不存在，addColumn 会抛 "no such table: coupons" 导致启动崩溃。
  addColumn('coupons', 'channel', "TEXT DEFAULT 'all'");

  // =====================================================
  // orders 表：v2.0 完全重建（支持新状态流）
  // =====================================================
  const ordersCols = db.prepare("PRAGMA table_info(orders)").all().map(c => c.name);
  const needsOrdersRebuild = !ordersCols.includes('order_category') ||
    !ordersCols.includes('tail_payment_status') ||
    !ordersCols.includes('delivery_mode') ||
    !ordersCols.includes('archived_at') ||
    !ordersCols.includes('special_release_by');

  if (needsOrdersRebuild) {
    console.log('[DB] 迁移 orders 表到 v2.0...');
    db.pragma('foreign_keys = OFF');

    // 备份旧数据
    db.exec(`
      CREATE TABLE IF NOT EXISTS orders_v2_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_no TEXT NOT NULL UNIQUE,
        customer_name TEXT NOT NULL,
        customer_phone TEXT,
        customer_address TEXT,
        total_amount REAL NOT NULL DEFAULT 0,
        deposit_amount REAL DEFAULT 0,
        balance_amount REAL DEFAULT 0,
        discount REAL DEFAULT 0,
        actual_amount REAL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK(status IN ('pending','deposited','full_paid',
            'purchasing','ordered',
            'arrived','ready',
            'balance_paid','special_released',
            'delivering','partially_delivered',
            'signed','completed','cancelled')),
        order_category TEXT DEFAULT 'order',
        payment_method TEXT DEFAULT 'deposit',
        tail_payment_status TEXT DEFAULT 'pending',
        special_release_by INTEGER REFERENCES users(id),
        special_release_at TEXT,
        delivery_mode TEXT DEFAULT 'full',
        salesperson_id INTEGER REFERENCES users(id),
        salesperson_name TEXT DEFAULT '',
        salesperson_phone TEXT DEFAULT '',
        delivery_date TEXT,
        note TEXT,
        archived_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
      )
    `);

    // 迁移数据：仅当旧 orders 表存在时迁移（存量库）；全新空库直接建表，避免 "no such table: orders"
    const oldOrdersExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='orders'").get();
    if (oldOrdersExists) {
    db.exec(`
      INSERT INTO orders_v2_new (
        id, order_no, customer_name, customer_phone, customer_address,
        total_amount, deposit_amount, balance_amount,
        discount, actual_amount,
        status, payment_method, tail_payment_status, special_release_by, special_release_at, delivery_mode,
        salesperson_id, salesperson_name, salesperson_phone,
        delivery_date, note, archived_at, created_at, updated_at
      )
      SELECT
        id, order_no, customer_name, customer_phone, customer_address,
        total_amount, deposit_amount, balance_amount,
        COALESCE(discount,0), COALESCE(actual_amount,0),
        status, COALESCE(payment_method,'deposit'), 'pending', NULL, NULL, 'full',
        salesperson_id, COALESCE(salesperson_name,''), COALESCE(salesperson_phone,''),
        delivery_date, note, NULL, created_at, updated_at
      FROM orders
    `);

    db.exec(`DROP TABLE orders`);
    }
    db.exec(`ALTER TABLE orders_v2_new RENAME TO orders`);
    db.pragma('foreign_keys = ON');

    // 重建索引
    db.exec(`CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)`);
    // 补充字段（迁移后添加）
    addColumn('orders', 'order_category', "TEXT DEFAULT 'order'");
    addColumn('orders', 'special_release_at', "TEXT");

    console.log('[DB] orders 表 v2.0 迁移完成');
  }

  // 确保 orders 索引存在（兼容未触发上面迁移分支的已迁移库）
  db.exec(`CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)`);

  // =====================================================
  // CRM 增强迁移：客户-订单关联 + 头像 + 流失时间
  // =====================================================
  // 1) 客户主档：头像（存 /uploads/xxx.jpg 相对路径）、流失时间（用于流失挽回）
  addColumn('customers', 'avatar', "TEXT DEFAULT ''");
  addColumn('customers', 'lost_at', "TEXT DEFAULT ''");

  // 2) 订单表：关联客户主档 id（可空，存量按 phone 优先、name 兜底回填）
  addColumn('orders', 'customer_id', "INTEGER");
  db.exec(`CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id)`);
  // 促销引擎：券与外部核销额记录（开关关闭时不被使用）
  addColumn('orders', 'coupon_code', "TEXT DEFAULT ''");
  addColumn('orders', 'coupon_discount', "REAL DEFAULT 0");
  addColumn('orders', 'external_coupon_amount', "REAL DEFAULT 0");
  addColumn('orders', 'promo_applied', "INTEGER DEFAULT 0");
  // 最终价是否人工修改：1=手改（财务以手改值为准），0=未改（财务以自动核减后的收款额为准）
  addColumn('orders', 'amount_manual', "INTEGER DEFAULT 0");

  // system_config 表须在建表阶段提前创建（回填去重标记、外部券开关等依赖它），避免全新库初始化时 "no such table: system_config"
  db.exec(`
    CREATE TABLE IF NOT EXISTS system_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    )
  `);

  // 3) 一次性回填 orders.customer_id（仅执行一次，靠 system_config 标记去重）
  const backfillFlag = db.prepare("SELECT value FROM system_config WHERE key='orders_customer_backfilled'").get();
  if (!backfillFlag) {
    // 先按手机号精确关联（最可靠）
    db.prepare(`
      UPDATE orders SET customer_id = (
        SELECT c.id FROM customers c
        WHERE c.phone <> '' AND c.phone = orders.customer_phone
        LIMIT 1
      )
      WHERE customer_id IS NULL
        AND customer_phone IS NOT NULL AND customer_phone <> ''
    `).run();
    // 再按客户姓名关联（仅手机号未匹配且姓名非空时）
    db.prepare(`
      UPDATE orders SET customer_id = (
        SELECT c.id FROM customers c
        WHERE c.phone = '' AND c.name = orders.customer_name
        LIMIT 1
      )
      WHERE customer_id IS NULL
        AND customer_name IS NOT NULL AND customer_name <> ''
    `).run();
    db.prepare(`INSERT INTO system_config (key, value, updated_at) VALUES ('orders_customer_backfilled','1', datetime('now','localtime')) ON CONFLICT(key) DO UPDATE SET value='1', updated_at=datetime('now','localtime')`).run();
    console.log('[DB] orders.customer_id 关联回填完成');
  }

  // =====================================================
  // order_items 表：核心子表，必须存在（兼容全新空库）
  // =====================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES orders(id),
      product_id INTEGER REFERENCES products(id),
      product_name TEXT NOT NULL,
      product_model TEXT DEFAULT '',
      spec TEXT DEFAULT '',
      unit_price REAL DEFAULT 0,
      total_price REAL DEFAULT 0,
      quantity INTEGER NOT NULL DEFAULT 1,
      product_type TEXT DEFAULT 'order',
      item_status TEXT DEFAULT 'pending',
      delivered_quantity INTEGER DEFAULT 0,
      allocated INTEGER DEFAULT 0,
      merge_group TEXT DEFAULT '',
      warehouse TEXT DEFAULT ''
    )
  `);

  // =====================================================
  // order_items 表：增量添加字段
  // =====================================================
  addColumn('order_items', 'spec', "TEXT DEFAULT ''");
  addColumn('order_items', 'product_model', "TEXT DEFAULT ''");
  addColumn('order_items', 'item_status', "TEXT DEFAULT 'pending'");
  addColumn('order_items', 'delivered_quantity', "INTEGER DEFAULT 0");
  addColumn('order_items', 'merge_group', "TEXT DEFAULT ''");
  addColumn('order_items', 'warehouse', "TEXT DEFAULT ''");
  addColumn('order_items', 'allocated', "INTEGER DEFAULT 0");
  // 计价快照：逐商品到手价 / 保本价 / 进价（下单时落库，供财务整单核算与逐商品亏损判定）
  addColumn('order_items', 'final_price', "REAL DEFAULT 0");
  addColumn('order_items', 'break_even_price', "REAL DEFAULT 0");
  addColumn('order_items', 'cost_price', "REAL DEFAULT 0");

  // =====================================================
  // payments 表
  // =====================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES orders(id),
      amount REAL NOT NULL,
      payment_type TEXT NOT NULL CHECK(payment_type IN ('deposit','balance','full')),
      payment_method TEXT DEFAULT 'cash',
      note TEXT,
      operator_id INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    )
  `);

  // payments 表兼容：支持 full 类型（如果旧库只有 deposit/balance）
  const payCheck = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='payments'").get();
  if (payCheck && payCheck.sql.includes("payment_type IN ('deposit','balance')") && !payCheck.sql.includes("'full'")) {
    console.log('[DB] 迁移 payments 表 payment_type CHECK 约束...');
    db.pragma('foreign_keys = OFF');
    db.exec(`
      CREATE TABLE payments_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER NOT NULL REFERENCES orders(id),
        amount REAL NOT NULL,
        payment_type TEXT NOT NULL CHECK(payment_type IN ('deposit','balance','full')),
        payment_method TEXT DEFAULT 'cash',
        note TEXT,
        operator_id INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
      );
      INSERT INTO payments_new SELECT * FROM payments;
      DROP TABLE payments;
      ALTER TABLE payments_new RENAME TO payments;
    `);
    db.pragma('foreign_keys = ON');
  }

  // =====================================================
  // purchase_orders 表 + 增量字段
  // =====================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS purchase_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      po_no TEXT NOT NULL UNIQUE,
      supplier TEXT,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending','ordered','arrived','cancelled')),
      total_amount REAL DEFAULT 0,
      note TEXT,
      operator_id INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    )
  `);

  addColumn('purchase_orders', 'order_id', "INTEGER REFERENCES orders(id)");
  addColumn('purchase_orders', 'arrival_warehouse', "TEXT DEFAULT ''");
  addColumn('purchase_orders', 'purchase_type', "TEXT DEFAULT 'order'");
  addColumn('purchase_orders', 'payment_voucher', "TEXT DEFAULT ''"); // 财务付款凭证（逗号分隔的图片URL列表）

  // =====================================================
  // purchase_items 表 + 增量字段
  // =====================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS purchase_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      purchase_id INTEGER NOT NULL REFERENCES purchase_orders(id),
      product_name TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      unit_price REAL DEFAULT 0,
      total_price REAL DEFAULT 0,
      allocated INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    )
  `);

  addColumn('purchase_items', 'brand', "TEXT DEFAULT ''");

  // 性能优化索引（O1-优化建议-v3.4）：高频按 order_id / product_id / salesperson_id 查询，缺少索引会整表扫描
  db.exec(`CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_order_items_product ON order_items(product_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(order_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_purchase_items_po ON purchase_items(purchase_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_orders_salesperson ON orders(salesperson_id)`);
  // 2026-09-06 审查补充：库存流水追溯 / 商品规格查询此前零索引，全表扫描
  db.exec(`CREATE INDEX IF NOT EXISTS idx_inventory_logs_product ON inventory_logs(product_id, created_at)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_inventory_logs_order ON inventory_logs(order_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_product_variants_product ON product_variants(product_id)`);
  addColumn('purchase_items', 'model', "TEXT DEFAULT ''");
  addColumn('purchase_items', 'spec', "TEXT DEFAULT ''");
  addColumn('purchase_items', 'note', "TEXT DEFAULT ''");
  addColumn('purchase_items', 'product_id', "INTEGER REFERENCES products(id)");
  addColumn('purchase_items', 'arrived', "INTEGER DEFAULT 0");
  addColumn('purchase_items', 'arrived_warehouse', "TEXT DEFAULT ''");
  addColumn('purchase_items', 'remain_quantity', "INTEGER DEFAULT 0");
  addColumn('purchase_items', 'arrival_voucher', "TEXT DEFAULT ''"); // 到货单凭证（逗号分隔的图片URL列表）

  // 库存流水支持按变体追溯
  addColumn('inventory_logs', 'variant_id', "INTEGER REFERENCES product_variants(id)");

  // 回填进货项 product_id（旧数据按商品名匹配；新数据下单时已带），使"已订未到"可精确按商品聚合
  db.prepare(`UPDATE purchase_items SET product_id = (
    SELECT id FROM products WHERE products.name = purchase_items.product_name LIMIT 1
  ) WHERE product_id IS NULL AND product_name IS NOT NULL`).run();

  // =====================================================
  // allocations 表
  // =====================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS allocations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      purchase_item_id INTEGER NOT NULL REFERENCES purchase_items(id),
      order_item_id INTEGER NOT NULL REFERENCES order_items(id),
      quantity INTEGER NOT NULL,
      operator_id INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    )
  `);

  // =====================================================
  // v2.0 新增表：送货单
  // =====================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS delivery_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES orders(id),
      batch_no TEXT NOT NULL,
      delivery_type TEXT NOT NULL CHECK(delivery_type IN ('full','batch')),
      delivery_date TEXT,
      delivery_person TEXT,
      delivery_phone TEXT,
      customer_name TEXT,
      customer_phone TEXT,
      customer_address TEXT,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending','dispatched','signed','cancelled')),
      signature_status TEXT DEFAULT 'unsigned',
      note TEXT,
      operator_id INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS delivery_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      delivery_id INTEGER NOT NULL REFERENCES delivery_orders(id) ON DELETE CASCADE,
      order_item_id INTEGER NOT NULL REFERENCES order_items(id),
      product_id INTEGER REFERENCES products(id),
      product_name TEXT NOT NULL,
      product_model TEXT DEFAULT '',
      spec TEXT DEFAULT '',
      quantity INTEGER NOT NULL DEFAULT 1,
      warehouse TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    )
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_delivery_order ON delivery_orders(order_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_delivery_items_did ON delivery_items(delivery_id)`);

  // =====================================================
  // v2.0 新增表：操作日志
  // =====================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS operation_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target_type TEXT NOT NULL CHECK(target_type IN (
        'order','purchase','delivery','payment','inventory','product','product_name',
        'customer','finance','knowledge','coupon','bundle','daily',
        'delivery_person','user','config','other'
      )),
      target_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      operator_id INTEGER REFERENCES users(id),
      operator_name TEXT DEFAULT '',
      reason TEXT DEFAULT '',
      old_status TEXT DEFAULT '',
      new_status TEXT DEFAULT '',
      details TEXT DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_operation_logs_target ON operation_logs(target_type, target_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_operation_logs_operator ON operation_logs(operator_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_operation_logs_time ON operation_logs(created_at)`);

  // =====================================================
  // v2.0 新增表：回退审批
  // =====================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS rollback_approvals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target_type TEXT NOT NULL,
      target_id INTEGER NOT NULL,
      from_node TEXT NOT NULL,
      to_node TEXT NOT NULL,
      applicant_id INTEGER NOT NULL REFERENCES users(id),
      approver_id INTEGER REFERENCES users(id),
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending','approved','rejected')),
      reason TEXT DEFAULT '',
      result_note TEXT DEFAULT '',
      executed INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_rollback_target ON rollback_approvals(target_type, target_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_rollback_status ON rollback_approvals(status)`);

  // =====================================================
  // 退/换主单：order_returns（退货 return / 换货 exchange）
  // =====================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS order_returns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES orders(id),
      type TEXT NOT NULL CHECK(type IN ('return','exchange')),
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending','processing','completed','cancelled')),
      reason TEXT DEFAULT '',
      refund_amount REAL DEFAULT 0,
      diff_amount REAL DEFAULT 0,
      note TEXT DEFAULT '',
      operator_id INTEGER REFERENCES users(id),
      operator_name TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      completed_at TEXT DEFAULT ''
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_order_returns_order ON order_returns(order_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_order_returns_status ON order_returns(status)`);

  // =====================================================
  // 退/换明细：order_return_items（独立落库，不污染 order_items）
  // action: return_in 退回入库 / exchange_out 旧品退库 / exchange_in 换出新品
  // =====================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS order_return_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      return_id INTEGER NOT NULL REFERENCES order_returns(id) ON DELETE CASCADE,
      order_item_id INTEGER REFERENCES order_items(id),
      product_id INTEGER REFERENCES products(id),
      variant_id INTEGER REFERENCES product_variants(id),
      product_name TEXT DEFAULT '',
      product_model TEXT DEFAULT '',
      spec TEXT DEFAULT '',
      action TEXT NOT NULL,
      quantity INTEGER DEFAULT 1,
      unit_price REAL DEFAULT 0,
      cost_price REAL DEFAULT 0,
      new_product_id INTEGER REFERENCES products(id),
      new_variant_id INTEGER REFERENCES product_variants(id),
      new_product_name TEXT DEFAULT '',
      new_spec TEXT DEFAULT ''
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_order_return_items_return ON order_return_items(return_id)`);

  // =====================================================
  // 售后工单：order_aftersales
  // type: repair 维修 / parts 补件 / complaint 投诉咨询 / other 其他
  // =====================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS order_aftersales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES orders(id),
      type TEXT NOT NULL CHECK(type IN ('repair','parts','complaint','other')),
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending','processing','completed','closed')),
      priority TEXT DEFAULT 'normal' CHECK(priority IN ('low','normal','high')),
      title TEXT DEFAULT '',
      description TEXT DEFAULT '',
      customer_name TEXT DEFAULT '',
      customer_phone TEXT DEFAULT '',
      handler TEXT DEFAULT '',
      cost REAL DEFAULT 0,
      cost_type TEXT DEFAULT '' CHECK(cost_type IN ('','service','parts')),
      created_by INTEGER REFERENCES users(id),
      created_by_name TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      closed_at TEXT DEFAULT ''
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_order_aftersales_order ON order_aftersales(order_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_order_aftersales_status ON order_aftersales(status)`);

  // =====================================================
  // 售后处理时间线：order_aftersales_logs
  // =====================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS order_aftersales_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      aftersales_id INTEGER NOT NULL REFERENCES order_aftersales(id) ON DELETE CASCADE,
      action TEXT DEFAULT '',
      note TEXT DEFAULT '',
      operator_id INTEGER REFERENCES users(id),
      operator_name TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_order_aftersales_logs_as ON order_aftersales_logs(aftersales_id)`);

  // =====================================================
  // 售后补件明细：order_aftersales_items（仅 type='parts' 时使用）
  // =====================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS order_aftersales_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      aftersales_id INTEGER NOT NULL REFERENCES order_aftersales(id) ON DELETE CASCADE,
      product_id INTEGER REFERENCES products(id),
      variant_id INTEGER REFERENCES product_variants(id),
      product_name TEXT DEFAULT '',
      spec TEXT DEFAULT '',
      quantity INTEGER DEFAULT 1
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_order_aftersales_items_as ON order_aftersales_items(aftersales_id)`);

  // 库存是否已应用标记：退/换单与售后工单的状态在 completed/closed 间反复切换时，
  // 据此保证库存只应用一次、回滚一次（幂等收口，避免重复加减导致库存漂移）。
  addColumn('order_returns', 'stock_applied', 'INTEGER DEFAULT 0');
  addColumn('order_aftersales', 'stock_applied', 'INTEGER DEFAULT 0');

  // v5.0 多店多仓：维度列（全部 DEFAULT，不破坏旧数据）
  addColumn('orders', 'store_id', "INTEGER DEFAULT 1");
  addColumn('orders', 'channel', "TEXT DEFAULT 'offline'");
  addColumn('orders', 'external_order_no', "TEXT DEFAULT ''");
  addColumn('purchase_orders', 'store_id', "INTEGER DEFAULT 1");
  addColumn('customers', 'store_id', "INTEGER DEFAULT 1");
  addColumn('users', 'store_id', "INTEGER DEFAULT 1");
  addColumn('delivery_orders', 'store_id', "INTEGER DEFAULT 1");
  addColumn('daily_reports', 'store_id', "INTEGER DEFAULT 1");
  addColumn('inventory_logs', 'warehouse_id', "INTEGER DEFAULT 1");
  addColumn('inventory_logs', 'store_id', "INTEGER DEFAULT 1");
  // v5.0 多店：other_costs 加 store_id 维度（与 orders/purchase_orders 一致），
  // DEFAULT 1 让历史/单店数据自动归到默认门店，多店时按店隔离其他成本。
  addColumn('other_costs', 'store_id', "INTEGER DEFAULT 1");

  // v5.0 多店多仓：monthly_targets 加 store_id 维度，重建 UNIQUE(year, month, store_id, user_id)
  // 旧 user_id IS NULL 行（原全局门店目标）→ store_id=1（默认门店）
  // 旧 per-user 行 → 该用户所属 store_id（users.store_id，缺省 1）
  {
    const mtCols = db.prepare('PRAGMA table_info(monthly_targets)').all().map(c => c.name);
    if (!mtCols.includes('store_id')) {
      console.log('[DB] 迁移 monthly_targets 加 store_id 维度...');
      db.pragma('foreign_keys = OFF');
      db.exec(`
        CREATE TABLE monthly_targets_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          year INTEGER NOT NULL,
          month INTEGER NOT NULL,
          store_id INTEGER NOT NULL DEFAULT 1,
          user_id INTEGER REFERENCES users(id),
          target_amount REAL NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
          UNIQUE(year, month, store_id, user_id)
        )
      `);
      db.exec(`
        INSERT INTO monthly_targets_new (id, year, month, store_id, user_id, target_amount, created_at, updated_at)
        SELECT mt.id, mt.year, mt.month,
          COALESCE((SELECT u.store_id FROM users u WHERE u.id = mt.user_id), 1) AS store_id,
          mt.user_id, mt.target_amount, mt.created_at, mt.updated_at
        FROM monthly_targets mt
      `);
      db.exec('DROP TABLE monthly_targets');
      db.exec('ALTER TABLE monthly_targets_new RENAME TO monthly_targets');
      db.pragma('foreign_keys = ON');
      console.log('[DB] monthly_targets 加 store_id 维度并重建 UNIQUE 完成');
    }
  }

  // v5.0 修正：monthly_targets 表级 UNIQUE(year,month,store_id,user_id) 对 user_id=NULL 不互斥，
  // 门店级目标(user_id=NULL) 可能产生重复行，导致 dashboard 汇总翻倍。
  // 1) 清理重复门店级目标行（保留每组最小 id）；2) 建部分唯一索引约束门店级目标唯一。
  {
    const mtFixFlag = db.prepare("SELECT value FROM system_config WHERE key='monthly_targets_null_unique_fixed'").get();
    if (!mtFixFlag) {
      db.pragma('foreign_keys = OFF');
      db.exec(`
        DELETE FROM monthly_targets
        WHERE user_id IS NULL
          AND id NOT IN (
            SELECT MIN(id) FROM monthly_targets WHERE user_id IS NULL GROUP BY year, month, store_id
          )
      `);
      db.exec(`
        DELETE FROM monthly_targets
        WHERE user_id IS NOT NULL
          AND id NOT IN (
            SELECT MIN(id) FROM monthly_targets WHERE user_id IS NOT NULL GROUP BY year, month, store_id, user_id
          )
      `);
      db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_store_target ON monthly_targets(store_id, year, month) WHERE user_id IS NULL`);
      db.pragma('foreign_keys = ON');
      db.prepare(`INSERT INTO system_config (key, value, updated_at) VALUES ('monthly_targets_null_unique_fixed','1', datetime('now','localtime')) ON CONFLICT(key) DO UPDATE SET value='1', updated_at=datetime('now','localtime')`).run();
      console.log('[DB] monthly_targets NULL 唯一性修正（部分唯一索引 + 清理重复行）完成');
    }
  }

  // =====================================================
  // 知识库表
  // =====================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      cover_image TEXT,
      content_blocks TEXT DEFAULT '[]',
      category TEXT,
      product_tags TEXT DEFAULT '[]',
      selling_tags TEXT DEFAULT '[]',
      difficulty TEXT DEFAULT '入门',
      status TEXT DEFAULT 'draft',
      is_pinned INTEGER DEFAULT 0,
      scheduled_at TEXT,
      author_id INTEGER REFERENCES users(id),
      view_count INTEGER DEFAULT 0,
      favorite_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS knowledge_favorites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      note_id INTEGER NOT NULL REFERENCES knowledge_notes(id),
      created_at TEXT DEFAULT (datetime('now','localtime')),
      UNIQUE(user_id, note_id)
    );

    CREATE TABLE IF NOT EXISTS knowledge_views (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      note_id INTEGER NOT NULL REFERENCES knowledge_notes(id),
      viewed_at TEXT DEFAULT (datetime('now','localtime'))
    )
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_knowledge_status ON knowledge_notes(status)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_knowledge_category ON knowledge_notes(category)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_knowledge_pinned ON knowledge_notes(is_pinned)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_knowledge_fav_user ON knowledge_favorites(user_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_knowledge_views_user ON knowledge_views(user_id, viewed_at)`);

  // =====================================================
  // 系统配置表
  // =====================================================
  // 初始化默认配置（如果不存在）
  const defaultConfig = {
    site_name: '门店系统',
    store_name: '我的门店',
    store_address: '',
    store_phone: '',
    store_logo: '',
    primary_color: '#A88C78',
    industry: 'furniture',
    setup_completed: '0',
    promo_enabled: '0',
    promo_coupon_enabled: '0',
    promo_bundle_enabled: '0',
    // 外部/平台券（抖音等）核销额是否计入订单实收核减：1=计入（门店让利或平台已补），0=仅记录不核减
    external_coupon_reduce: '1',
    // 保本价利润率（按售价毛利率）：保本价 = 进价 ÷ (1 − 此值)，默认 0.4（保证每件商品至少 40% 毛利）
    break_even_margin: '0.4',
    low_stock_threshold: '5',
    // 库房（物流仓库）列表：前端到货仓库下拉可选项，由系统设置自定义维护，JSON 字符串数组
    warehouses: '["正大物流","广东物流","其它物流"]',
    holidays_json: '[{"month":1,"day":1,"name":"元旦"},{"month":2,"day":14,"name":"情人节"},{"month":3,"day":8,"name":"女神节"},{"month":4,"day":5,"name":"清明"},{"month":5,"day":1,"name":"劳动节"},{"month":6,"day":19,"name":"端午"},{"month":9,"day":25,"name":"中秋"},{"month":10,"day":1,"name":"国庆"},{"month":11,"day":11,"name":"双11"},{"month":12,"day":25,"name":"圣诞"},{"month":2,"day":17,"name":"春节"}]',
    contract_terms: '1. 定货周期：常规商品30天，定制商品45天，从付定金次日起算。\n2. 客户支付定金后，本店开始排产/采购；如客户中途取消订单，定金不予退还。\n3. 货到后客户需在7日内结清尾款并安排送货，逾期每日收取仓管费（货值万分之三）。\n4. 送货安装完成后如无质量问题，不接受退货。\n5. 本合同一式两份，双方各执一份，具有同等法律效力。',
  };

  const insertConfig = db.prepare('INSERT OR IGNORE INTO system_config (key, value) VALUES (?, ?)');
  for (const [key, value] of Object.entries(defaultConfig)) {
    insertConfig.run(key, value);
  }

  // =====================================================
  // 数据修复
  // =====================================================
  db.transaction(() => {
    const wrongName = db.prepare("SELECT id FROM products WHERE name = ?").get('晚安床头');
    if (wrongName) {
      db.prepare("UPDATE products SET name = '晚安枕头' WHERE name = '晚安床头'").run();
      db.prepare("UPDATE order_items SET product_name = '晚安枕头' WHERE product_name = '晚安床头'").run();
      db.prepare("UPDATE purchase_items SET product_name = '晚安枕头' WHERE product_name = '晚安床头'").run();
      console.log('[DB] 数据修复：晚安床头 -> 晚安枕头');
    }
  })();

  // 初始化 product_names 表
  const existingNames = db.prepare("SELECT COUNT(*) as cnt FROM product_names").get();
  if (existingNames.cnt === 0) {
    const products = db.prepare("SELECT DISTINCT name, brand, model, spec FROM products").all();
    for (const p of products) {
      try {
        db.prepare("INSERT INTO product_names (name, brand, model, spec) VALUES (?, ?, ?, ?)")
          .run(p.name, p.brand || '', p.model || '', p.spec || '');
      } catch (e) { /* 忽略重复 */ }
    }
    console.log(`[DB] 已从 products 导入 ${products.length} 条商品名称到 product_names`);
  }

  // 默认管理员
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
  if (!existing) {
    const hash = bcrypt.hashSync('admin123', 10);
    db.prepare('INSERT INTO users (username, password, display_name, role) VALUES (?, ?, ?, ?)').run('admin', hash, '管理员', 'admin');
    console.log('[DB] 默认管理员账号已创建: admin / admin123');
  }

  // v5.0 多店多仓：默认门店 + 默认仓库种子（历史数据 store_id=1 / warehouse_id=1）
  const storeCnt = db.prepare('SELECT COUNT(*) AS c FROM stores').get().c;
  if (storeCnt === 0) {
    db.prepare(`INSERT INTO stores (id, name, code, is_active) VALUES (1, '默认门店', 'DEFAULT', 1)`).run();
    console.log('[DB] 默认门店已创建: id=1 默认门店');
  }
  const whCnt = db.prepare('SELECT COUNT(*) AS c FROM warehouses').get().c;
  if (whCnt === 0) {
    db.prepare(`INSERT INTO warehouses (id, name, code, store_id, is_default, is_active) VALUES (1, '主仓', 'MAIN', 1, 1, 1)`).run();
    console.log('[DB] 默认仓库已创建: id=1 主仓');
  }

  // v5.0 多店多仓：一次性回填 stock 表（默认仓 warehouse_id=1）
  // 有规格商品 → 逐变体 (product_id, variant_id, 1)；无规格商品 → (product_id, 0, 1)
  // 仅回填非零库存，避免噪声；后续出入库经 recomputeStockTable 自动维护镜像
  const stockCnt = db.prepare('SELECT COUNT(*) AS c FROM stock').get().c;
  if (stockCnt === 0) {
    db.exec(`
      INSERT INTO stock (product_id, variant_id, warehouse_id, quantity)
      SELECT product_id, id, 1, stock FROM product_variants WHERE stock <> 0
    `);
    db.exec(`
      INSERT INTO stock (product_id, variant_id, warehouse_id, quantity)
      SELECT p.id, 0, 1, p.stock FROM products p
      WHERE p.stock <> 0
        AND NOT EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id)
    `);
    const cnt = db.prepare('SELECT COUNT(*) AS c FROM stock').get().c;
    console.log(`[DB] stock 表回填完成: ${cnt} 行 (默认仓)`);
  }

  // 版本化迁移：只处理 addColumn 做不到的事（改约束 / 重建表 / 数据订正）
  // 老库 user_version=0 → 自动落到基线后执行更高版本迁移；失败会中止启动，不留半新半旧的结构
  try {
    runMigrations(db);
  } catch (e) {
    console.error('[DB] 迁移执行失败，服务启动中止：', e.message);
    throw e;
  }

  console.log(`[DB] 数据库初始化完成 (schema v${getSchemaVersion(db)})`);
  return db;
}

// =====================================================
// 一键恢复出厂设置（仅供管理员调用）
// 清空所有业务数据 + 重置系统配置 + 仅保留默认 admin
// =====================================================
// 读取系统配置布尔开关（默认 false/off）。供促销引擎等模块统一守卫。
export function getConfigFlag(db, key) {
  try {
    const row = db.prepare('SELECT value FROM system_config WHERE key = ?').get(key);
    return row ? row.value === '1' : false;
  } catch {
    return false;
  }
}

export function resetToFactory(targetDb) {
  const d = targetDb || getDb();
  // 临时关闭外键约束，避免 DELETE 顺序触发约束失败
  d.pragma('foreign_keys = OFF');
  try {
    // 动态获取所有用户表（排除 sqlite 内部表与索引），逐个清空，避免漏表
    const tables = d.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'idx_%'"
    ).all().map(r => r.name);

    const tx = d.transaction(() => {
      for (const t of tables) {
        try { d.prepare(`DELETE FROM ${t}`).run(); } catch (e) { /* 忽略个别报错 */ }
      }
      // 重建默认管理员（固定 id=1，保持与登录 token 中的 id 一致，避免重置后被迫登出）
      const hash = bcrypt.hashSync('admin123', 10);
      d.prepare('INSERT INTO users (id, username, password, display_name, role) VALUES (?, ?, ?, ?, ?)')
        .run(1, 'admin', hash, '管理员', 'admin');
      // 重置系统配置为默认值
      const defaults = {
        site_name: '门店系统',
        store_name: '我的门店',
        store_address: '',
        store_phone: '',
        store_logo: '',
        primary_color: '#A88C78',
        industry: 'furniture',
        setup_completed: '0',
        promo_enabled: '0',
        promo_coupon_enabled: '0',
        promo_bundle_enabled: '0',
        external_coupon_reduce: '1',
        break_even_margin: '0.4',
        holidays_json: '[{"month":1,"day":1,"name":"元旦"},{"month":2,"day":14,"name":"情人节"},{"month":3,"day":8,"name":"女神节"},{"month":4,"day":5,"name":"清明"},{"month":5,"day":1,"name":"劳动节"},{"month":6,"day":19,"name":"端午"},{"month":9,"day":25,"name":"中秋"},{"month":10,"day":1,"name":"国庆"},{"month":11,"day":11,"name":"双11"},{"month":12,"day":25,"name":"圣诞"},{"month":2,"day":17,"name":"春节"}]',
        contract_terms: '1. 定货周期：常规商品30天，定制商品45天，从付定金次日起算。\n2. 客户支付定金后，本店开始排产/采购；如客户中途取消订单，定金不予退还。\n3. 货到后客户需在7日内结清尾款并安排送货，逾期每日收取仓管费（货值万分之三）。\n4. 送货安装完成后如无质量问题，不接受退货。\n5. 本合同一式两份，双方各执一份，具有同等法律效力。',
        warehouses: '["正大物流","广东物流","其它物流"]',
      };
      const insCfg = d.prepare("INSERT OR REPLACE INTO system_config (key, value, updated_at) VALUES (?, ?, datetime('now','localtime'))");
      for (const [k, v] of Object.entries(defaults)) insCfg.run(k, v);
      // 重建销售日报字段配置（21 个默认字段）
      d.exec('DELETE FROM daily_field_config');
      const seed = [
        ['post_moments','发朋友圈','number','report',1],
        ['post_douyin','发抖音','number','report',2],
        ['live_stream','开直播','number','report',3],
        ['follow_up','跟进客户','number','report',4],
        ['work_issue','今日工作问题','text','report',5],
        ['tomorrow_plan','明日工作计划','text','report',6],
        ['customer_desc','客户情况','text','customer',7],
        ['customer_name','客户名称','text','customer',8],
        ['phone','客户电话','text','customer',9],
        ['source','客户来源','text','customer',10],
        ['intention_product','客户意向产品','text','customer',11],
        ['is_deal','是否成交','select','customer',12],
        ['deal_amount','订单金额','number','customer',13],
        ['not_deal_reason','未成交原因','text','customer',14],
        ['is_wechat','是否留微信','select','customer',15],
        ['is_douyin_comment','是否抖音评论','select','customer',16],
        ['reception_count','接待组数','computed','computed',17],
        ['deal_count_summary','成交单数','computed','computed',18],
        ['deal_amount_summary','成交金额','computed','computed',19],
        ['phone_count_summary','留电话数','computed','computed',20],
        ['wechat_count_summary','加微信数','computed','computed',21],
      ];
      const insF = d.prepare(`INSERT OR IGNORE INTO daily_field_config (field_key, field_label, field_type, scope, sort_order) VALUES (?,?,?,?,?)`);
      const seedTx = d.transaction((rows) => { for (const r of rows) insF.run(...r); });
      seedTx(seed);
    });
    tx();
    return { ok: true };
  } finally {
    d.pragma('foreign_keys = ON');
  }
}
