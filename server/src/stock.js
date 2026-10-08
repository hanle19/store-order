import { getDb } from './db.js';

// 统一库存调整入口（O22 收口）
// 替代各路由里散落的「UPDATE products.stock + UPDATE inventory」双写，避免两张表漂移。
//
// 设计要点：
//  - products.stock：无规格商品 = 直接库存（独立维护）；有规格商品 = Σ规格库存（派生值，
//    由 syncProductStockFromVariants 在每次规格变动后自动重算，2026-09-07 业务决策「方案 A」）；
//  - inventory 表仅服务于 sample/gift 类商品：仅当该商品【已存在】inventory 行时才同步其 quantity，
//    绝不给订货类商品（无 inventory 行）强行建行——否则会把 products.stock 误算成 delta 造成库存损坏；
//  - 库存不允许为负（Math.max(0, ...)）；
//  - 统一写入 inventory_logs 便于追溯（含 order_id / operator_id / warehouse_id / store_id）。
//
// v5.0 多店多仓：新增 stock 表（product_id, variant_id, warehouse_id, quantity）作为仓库维度库存。
// 当前阶段（单仓）stock 表是 products.stock / product_variants.stock 的「镜像」，由 recomputeStockTable
// 维护；Phase 2 起 setStock 将升级为按仓写入的唯一入口，legacy 列退化为「全仓合计」。
//   - variant_id = 0 代表「商品本身（无具体规格）」。
//   - 默认仓库 warehouse_id = 1，默认门店 store_id = 1（历史数据兜底）。

const DEFAULT_WAREHOUSE = 1;
const DEFAULT_STORE = 1;

// prepared statement 缓存：按 db 实例缓存（WeakMap 随实例自动回收）。
// 背景：这些语句在批量场景（Excel 批量导入、一张单 N 条明细）会被反复调用，
// 逐次 db.prepare() 会重复编译同一条 SQL。用 WeakMap 按实例缓存后，
// 「恢复出厂 / 重建连接」换了 db 实例会自动重新 prepare，不会拿到失效语句。
const stmtCache = new WeakMap();
function S(db) {
  let s = stmtCache.get(db);
  if (!s) {
    s = {
      selVariantStock: db.prepare('SELECT stock FROM product_variants WHERE id = ?'),
      selProductStock: db.prepare('SELECT stock FROM products WHERE id = ?'),
      upsertStock: db.prepare(`INSERT INTO stock (product_id, variant_id, warehouse_id, quantity, updated_at)
        VALUES (?, ?, ?, ?, datetime('now','localtime'))
        ON CONFLICT(product_id, variant_id, warehouse_id)
        DO UPDATE SET quantity = excluded.quantity, updated_at = excluded.updated_at`),
      hasVariant: db.prepare('SELECT 1 FROM product_variants WHERE product_id = ? LIMIT 1'),
      sumVariants: db.prepare('SELECT COALESCE(SUM(stock), 0) AS s FROM product_variants WHERE product_id = ?'),
      updProductStock: db.prepare(`UPDATE products SET stock = ?, updated_at = datetime('now','localtime') WHERE id = ?`),
      selInventory: db.prepare('SELECT * FROM inventory WHERE product_id = ?'),
      updInventory: db.prepare(`UPDATE inventory SET quantity = ?, updated_at = datetime('now','localtime') WHERE product_id = ?`),
      selVariant: db.prepare('SELECT id, product_id, stock FROM product_variants WHERE id = ?'),
      updVariantStock: db.prepare(`UPDATE product_variants SET stock = ? WHERE id = ?`),
      insLog: db.prepare(`INSERT INTO inventory_logs
        (product_id, change_amount, after_quantity, type, reason, order_id, operator_id, warehouse_id, store_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`),
      insLogVariant: db.prepare(`INSERT INTO inventory_logs
        (product_id, variant_id, change_amount, after_quantity, type, reason, order_id, operator_id, warehouse_id, store_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    };
    stmtCache.set(db, s);
  }
  return s;
}

// 维护 stock 表（仓库维度）镜像，与 products.stock / product_variants.stock 保持一致。
// 必须在已开启的事务内或独立调用（自身不含事务，由调用方决定）。
export function recomputeStockTable(db, productId, variantId = 0) {
  const wid = DEFAULT_WAREHOUSE;
  const vid = variantId || 0;
  let qty = 0;
  const s = S(db);
  if (vid > 0) {
    const v = s.selVariantStock.get(vid);
    if (!v) return;
    qty = v.stock;
  } else {
    const p = s.selProductStock.get(productId);
    if (!p) return;
    qty = p.stock;
  }
  s.upsertStock.run(productId, vid, wid, qty);
}

// 方案 A（2026-09-07 业务决策）：有规格商品的 products.stock = Σ(product_variants.stock)，
// 是**派生值**——不独立维护，任何规格变动后自动重算，保证与 Σ规格永远相等。
// 口径与 excel.js:408 一致：SUM(stock) WHERE product_id = ?（不过滤 active）。
// 返回 true = 该商品有规格且已重算；false = 无规格（总库存由 adjustStock 独立维护）。
function syncProductStockFromVariants(db, productId) {
  const s = S(db);
  const hasVariant = s.hasVariant.get(productId);
  if (!hasVariant) return false;
  const sum = s.sumVariants.get(productId).s;
  s.updProductStock.run(sum, productId);
  recomputeStockTable(db, productId, 0); // 同步商品级仓库镜像
  return true;
}

// 主商品库存调整（样品/赠品/订货均走这里，按 products.stock 为基准）。
// delta 为正数表示入库，负数表示出库。返回调整后的 products.stock。
export function adjustStock(productId, delta, opts = {}) {
  const { reason = '库存调整', operatorId = null, type = 'adjust', orderId = null } = opts;
  const db = getDb();
  const qty = Number(delta) || 0;
  const body = () => {
    const s = S(db);
    const product = s.selProductStock.get(productId);
    if (!product) return null;

    const effectiveType = type || (qty < 0 ? 'out' : 'in');
    // 有规格商品：总库存是 Σ规格派生值，此处以重算为准。
    // 订单流程会先 adjustVariantStock 再 adjustStock，若这里继续按 delta 增减会「双扣减」；
    // 改为重算后两步幂等——无论调用顺序，结果都等于 Σ规格。
    let newStock;
    if (syncProductStockFromVariants(db, productId)) {
      newStock = s.selProductStock.get(productId).stock;
    } else {
      // 无规格商品：主库存以 products.stock 为基准，裁剪到 0
      newStock = Math.max(0, product.stock + qty);
      s.updProductStock.run(newStock, productId);
    }

    // 仅当 inventory 行已存在（样品/赠品）时同步；订货类商品不碰 inventory
    const inv = s.selInventory.get(productId);
    if (inv) {
      const newInv = Math.max(0, inv.quantity + qty);
      s.updInventory.run(newInv, productId);
    }

    s.insLog
      .run(productId, qty, newStock, effectiveType, reason, orderId, operatorId, DEFAULT_WAREHOUSE, DEFAULT_STORE);

    // 同步仓库维度镜像（默认仓）
    recomputeStockTable(db, productId, 0);
    return newStock;
  };
  // 已在外层事务内则直接执行，避免嵌套事务报错；否则自包事务
  return db.inTransaction ? body() : db.transaction(body)();
}

// 变体维度库存调整（样品/赠品带规格时，每个规格独立库存）。
// 改完 product_variants.stock 后，按方案 A 自动重算 products.stock = Σ规格（总库存同步跟随）。
// delta 正数入库、负数出库；库存不允许为负；统一写 inventory_logs（带 variant_id）便于追溯。
export function adjustVariantStock(variantId, delta, opts = {}) {
  const { reason = '变体库存调整', operatorId = null, type = 'adjust', orderId = null } = opts;
  const db = getDb();
  const qty = Number(delta) || 0;
  const body = () => {
    const s = S(db);
    const v = s.selVariant.get(variantId);
    if (!v) return null;

    const effectiveType = type || (qty < 0 ? 'out' : 'in');
    const newStock = Math.max(0, v.stock + qty);
    s.updVariantStock.run(newStock, variantId);

    s.insLogVariant
      .run(v.product_id, variantId, qty, newStock, effectiveType, reason, orderId, operatorId, DEFAULT_WAREHOUSE, DEFAULT_STORE);

    // 同步仓库维度镜像（默认仓）
    recomputeStockTable(db, v.product_id, variantId);
    // 方案 A：规格变动后重算商品总库存（products.stock = Σ规格）
    syncProductStockFromVariants(db, v.product_id);
    return newStock;
  };
  return db.inTransaction ? body() : db.transaction(body)();
}

// v5.0 统一出入库入口（Phase 0：仓库维度收口雏形）
// 默认 warehouseId=1 / storeId=1；旧调用（adjustStock / adjustVariantStock）行为完全不变 → 单仓零回归。
// Phase 2 起将升级为按仓写入 stock 表的唯一入口，并支持 storeId 注入与调拨单。
// 注：db 参数在 Phase 0 暂未使用（adjust* 内部已通过 getDb 收口并维护 stock 镜像），
//     保留以对齐后续"传入外部事务 db"的用法。
export function setStock(db, productId, variantId, warehouseId, delta, opts = {}) {
  const w = warehouseId || DEFAULT_WAREHOUSE;
  void w; // Phase 2 启用：按 w 定位 stock 行
  let result;
  if (variantId && variantId > 0) {
    result = adjustVariantStock(variantId, delta, opts);
  } else {
    result = adjustStock(productId, delta, opts);
  }
  return result;
}
