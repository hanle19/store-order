/**
 * 数据完整性审计（只读，不改任何数据）
 * 用法：cd server && ../nodejs/node.exe scripts/audit-data.js
 *
 * 审计项：
 *  A. FK 孤儿引用（订单项/支付/进货/退换/售后/规格/库存流水）
 *  B. 库存健康（products / product_variants 负库存）
 *  C. 库存流水交叉审计：订单项期望出库量 vs inventory_logs 净出库量
 *     - 非取消订单：net_out 应 = quantity - 已完成退货数量
 *     - 已取消订单：net_out 应 = 0
 *  D. 金额一致性：order_items.total_price vs unit_price*quantity
 *  E. 未回填 product_id 但可精确匹配商品的嫌疑订单项（历史库存漏减风险）
 *  F. 重复商品（同名同规格且 active）
 */
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, '..', 'data', 'store.db');
const db = new Database(dbPath, { readonly: true });

const issues = [];
const add = (severity, category, detail) => issues.push({ severity, category, detail });
const has = (t) => !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(t);
const safe = (sql, ...args) => { try { return db.prepare(sql).all(...args); } catch { return []; } };

/* ---------- A. FK 孤儿引用 ---------- */
const orphanChecks = [
  ['order_items.order_id', `SELECT oi.id, oi.order_id FROM order_items oi LEFT JOIN orders o ON o.id=oi.order_id WHERE o.id IS NULL`],
  ['order_items.product_id', `SELECT oi.id, oi.product_id, oi.product_name FROM order_items oi LEFT JOIN products p ON p.id=oi.product_id WHERE oi.product_id IS NOT NULL AND p.id IS NULL`],
  ['order_items.variant_id', `SELECT oi.id, oi.variant_id FROM order_items oi LEFT JOIN product_variants v ON v.id=oi.variant_id WHERE oi.variant_id IS NOT NULL AND v.id IS NULL`],
  ['payments.order_id', `SELECT p.id, p.order_id FROM payments p LEFT JOIN orders o ON o.id=p.order_id WHERE o.id IS NULL`],
  ['purchase_items.purchase_id', `SELECT pi.id, pi.purchase_id FROM purchase_items pi LEFT JOIN purchase_orders po ON po.id=pi.purchase_id WHERE po.id IS NULL`],
  ['order_return_items.return_id', `SELECT ri.id, ri.return_id FROM order_return_items ri LEFT JOIN order_returns r ON r.id=ri.return_id WHERE r.id IS NULL`],
  ['order_returns.order_id', `SELECT r.id, r.order_id FROM order_returns r LEFT JOIN orders o ON o.id=r.order_id WHERE o.id IS NULL`],
  ['order_aftersales.order_id', `SELECT a.id, a.order_id FROM order_aftersales a LEFT JOIN orders o ON o.id=a.order_id WHERE o.id IS NULL`],
  ['product_variants.product_id', `SELECT v.id, v.product_id FROM product_variants v LEFT JOIN products p ON p.id=v.product_id WHERE p.id IS NULL`],
  ['inventory_logs.product_id', `SELECT l.id, l.product_id FROM inventory_logs l LEFT JOIN products p ON p.id=l.product_id WHERE p.id IS NULL`],
];
for (const [name, sql] of orphanChecks) {
  const rows = safe(sql);
  if (rows.length) add('高', 'FK孤儿', `${name}: ${rows.length} 条孤儿引用，样例 ${JSON.stringify(rows.slice(0, 3))}`);
}

/* ---------- B. 库存负数 ---------- */
for (const r of safe(`SELECT id, name, stock FROM products WHERE stock < 0`))
  add('高', '库存负数', `products id=${r.id}「${r.name}」stock=${r.stock}`);
for (const r of safe(`SELECT v.id, v.product_id, v.spec, v.stock FROM product_variants v WHERE v.stock < 0`))
  add('高', '库存负数', `product_variants id=${r.id} product=${r.product_id} 规格「${r.spec}」stock=${r.stock}`);

/* ---------- C. 库存流水交叉审计 ---------- */
// 已完成退货（return_in / exchange_out）按订单+商品+规格汇总回库数量
const returnedMap = new Map();
for (const r of safe(`
  SELECT r.order_id, ri.product_id, ri.variant_id, SUM(ri.quantity) qty
  FROM order_return_items ri JOIN order_returns r ON r.id = ri.return_id
  WHERE r.status='completed' AND ri.action IN ('return_in','exchange_out')
  GROUP BY r.order_id, ri.product_id, ri.variant_id`)) {
  returnedMap.set(`${r.order_id}|${r.product_id}|${r.variant_id ?? ''}`, r.qty);
}
// inventory_logs 净出库（out 为正、in 为负）
const netOutMap = new Map();
for (const r of safe(`
  SELECT order_id, product_id, variant_id,
         SUM(CASE WHEN type='out' THEN -change_amount ELSE change_amount END) net
  FROM inventory_logs WHERE order_id IS NOT NULL
  GROUP BY order_id, product_id, variant_id`)) {
  netOutMap.set(`${r.order_id}|${r.product_id}|${r.variant_id ?? ''}`, r.net);
}
// 逐订单项比对（仅 sample/gift 需要核减库存；order 订货类永不核减）
const items = safe(`
  SELECT oi.id, oi.order_id, oi.product_id, oi.variant_id, oi.product_name, oi.spec,
         oi.quantity, oi.product_type, o.status AS order_status, o.order_no
  FROM order_items oi JOIN orders o ON o.id = oi.order_id
  WHERE oi.product_id IS NOT NULL AND oi.product_type IN ('sample','gift')`);
for (const it of items) {
  const key = `${it.order_id}|${it.product_id}|${it.variant_id ?? ''}`;
  const net = netOutMap.get(key) || 0;
  const returned = returnedMap.get(key) || 0;
  if (it.order_status === 'cancelled') {
    if (net !== 0) add('高', '库存流水', `订单 ${it.order_no}(id=${it.order_id}) 已取消但「${it.product_name}/${it.spec || '-'}」净出库=${net}（应为 0）`);
  } else {
    const expected = it.quantity - returned;
    if (net !== expected)
      add('高', '库存流水', `订单 ${it.order_no}(id=${it.order_id})「${it.product_name}/${it.spec || '-'}」净出库=${net}，期望=${expected}（quantity=${it.quantity} 已退=${returned}）`);
  }
}

/* ---------- D. 金额一致性 ---------- */
for (const r of safe(`
  SELECT id, order_id, product_name, unit_price, quantity, total_price
  FROM order_items WHERE ABS(total_price - unit_price * quantity) > 0.01`))
  add('中', '金额一致', `order_items id=${r.id} 订单#${r.order_id}「${r.product_name}」total_price=${r.total_price} ≠ ${r.unit_price}×${r.quantity}`);

/* ---------- E. 未回填 product_id 的嫌疑订单项 ---------- */
for (const r of safe(`
  SELECT oi.id, oi.order_id, oi.product_name, oi.spec, oi.quantity, o.status, o.order_no
  FROM order_items oi JOIN orders o ON o.id = oi.order_id
  WHERE oi.product_id IS NULL AND oi.product_type IN ('sample','gift')
    AND o.status NOT IN ('cancelled')
    AND EXISTS (SELECT 1 FROM products p WHERE LOWER(TRIM(p.name)) = LOWER(TRIM(oi.product_name)))`))
  add('中', '未回填', `订单 ${r.order_no}(id=${r.order_id})「${r.product_name}/${r.spec || '-'}」×${r.quantity} product_id 为空但商品库可匹配——疑似历史库存漏减`);

/* ---------- F. 重复商品 ---------- */
for (const r of safe(`
  SELECT LOWER(TRIM(name)) n, IFNULL(spec,'') s, COUNT(*) c FROM products WHERE active=1
  GROUP BY n, s HAVING c > 1`))
  add('低', '重复商品', `「${r.n}」规格「${r.s || '-'}」有 ${r.c} 条 active 记录`);

/* ---------- 输出 ---------- */
const order = { '高': 0, '中': 1, '低': 2 };
issues.sort((a, b) => order[a.severity] - order[b.severity]);
console.log('========================================');
console.log(' 数据完整性审计报告（只读）');
console.log('========================================');
if (!issues.length) {
  console.log('✅ 未发现数据完整性问题');
} else {
  const cnt = { 高: 0, 中: 0, 低: 0 };
  issues.forEach(i => cnt[i.severity]++);
  console.log(`共 ${issues.length} 项：高 ${cnt.高} / 中 ${cnt.中} / 低 ${cnt.低}\n`);
  for (const i of issues) console.log(`[${i.severity}][${i.category}] ${i.detail}`);
  console.log('\n说明：「库存流水」「未回填」类问题确认后，用 /inventory/adjust 与 /inventory/variant/out 精准补减，勿用订单编辑修复（会虚增库存）。');
}
process.exit(0);
