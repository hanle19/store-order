// service 层单测：证明 orders.js 拆分后，定价/库存/客户逻辑可脱离 HTTP 独立验证。
// 用法：node scripts/verify-services.mjs
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC_DB = path.join(__dirname, '..', 'data', 'store.db');
const TMP_DB = path.join(os.tmpdir(), `_svc-${Date.now()}.db`);
fs.copyFileSync(SRC_DB, TMP_DB);
process.env.DB_PATH = TMP_DB;

let pass = 0;
let fail = 0;
const failures = [];
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ''}`); }
  else { fail++; failures.push(name); console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); }
}

const { getDb } = await import('../src/db.js');
const { buildItemPricing, calcAutoActual } = await import('../src/services/orderPricing.js');
const { applySaleStockOut, returnSaleStockIn, resolveProductId } = await import('../src/services/orderInventory.js');
const { syncCustomerFromOrder, markCustomerDeal } = await import('../src/services/orderCustomer.js');

const db = getDb();

try {
  console.log('\n[服务层] 1. calcAutoActual（金额计算，纯函数）');
  check('基础扣减 items-discount-coupon', calcAutoActual(db, { itemsBase: 1000, discount: 100, couponDiscount: 50 }) === 850);
  check('不为负数', calcAutoActual(db, { itemsBase: 10, discount: 100, couponDiscount: 0 }) === 0);
  check('空值安全（不 NaN）', Number.isFinite(calcAutoActual(db, {})));
  // 显式控制开关，测 on/off 两态（默认库该开关为 1）
  db.prepare("UPDATE system_config SET value='0' WHERE key='external_coupon_reduce'").run();
  check('开关 off 时不计 ext', calcAutoActual(db, { itemsBase: 1000, externalCouponAmount: 200 }) === 1000);
  db.prepare("UPDATE system_config SET value='1' WHERE key='external_coupon_reduce'").run();
  check('开关 on 时计 ext', calcAutoActual(db, { itemsBase: 1000, externalCouponAmount: 200 }) === 800);

  console.log('\n[服务层] 2. 库存出库→退回 往返不漂移');
  const p = db.prepare(`INSERT INTO products (name, category, stock, price, cost_price) VALUES (?,?,?,?,?)`)
    .run('服务层测试样品', 'sample', 10, 100, 50);
  const pid = p.lastInsertRowid;
  const stockOf = () => db.prepare('SELECT stock FROM products WHERE id=?').get(pid).stock;

  applySaleStockOut(db, { product_id: pid, product_type: 'sample' }, 3, 1, 1);
  check('出库后 stock 10→7', stockOf() === 7, String(stockOf()));
  returnSaleStockIn(db, { product_id: pid, product_type: 'sample' }, 3, 1, 1);
  check('退回后 stock 回到 10', stockOf() === 10, String(stockOf()));
  const dir = db.prepare("SELECT type, SUM(change_amount) s FROM inventory_logs WHERE product_id=? GROUP BY type").all(pid);
  check('流水 out/in 各一条且量一致', dir.length === 2 && dir.every(r => Math.abs(r.s) === 3), JSON.stringify(dir));

  console.log('\n[服务层] 3. returnSaleStockIn 对订货类跳过（不对称防御在函数内）');
  applySaleStockOut(db, { product_id: pid, product_type: 'sample' }, 5, 1, 1); // 10 → 5
  returnSaleStockIn(db, { product_id: pid, product_type: 'order' }, 5, 1, 1);  // order 类跳过，仍 5
  check('order 类退回不加库存（仍为 5）', stockOf() === 5, String(stockOf()));
  returnSaleStockIn(db, { product_id: pid, product_type: 'sample' }, 5, 1, 1); // 复位 5 → 10

  console.log('\n[服务层] 4. resolveProductId 反查回填');
  const it = { product_name: '服务层测试样品' };
  resolveProductId(db, it);
  check('按名称回填 product_id', it.product_id === pid, String(it.product_id));

  console.log('\n[服务层] 5. syncCustomerFromOrder 客户打通');
  db.prepare('DELETE FROM customers').run();
  const id1 = syncCustomerFromOrder(db, { name: '张三', phone: '13900000001', address: '太原', ownerId: 1 });
  check('新客户自动建档返回 id', Number.isInteger(id1) && id1 > 0, String(id1));
  const c1 = db.prepare('SELECT * FROM customers WHERE id=?').get(id1);
  check('建档即成交 deal', c1.status === 'deal', String(c1.status));
  const id2 = syncCustomerFromOrder(db, { name: '张三', phone: '13900000001', address: '', ownerId: 1 });
  check('同电话再同步不重复建档', id2 === id1, `${id1} vs ${id2}`);
  const cnt = db.prepare('SELECT COUNT(*) c FROM customers').get().c;
  check('客户总数仍为 1', cnt === 1, String(cnt));
  syncCustomerFromOrder(db, { name: '张三改名', phone: '13900000001', address: '新地址', ownerId: 1 });
  const c2 = db.prepare('SELECT * FROM customers WHERE id=?').get(id1);
  check('已维护的姓名不被覆盖（空白补齐原则）', c2.name === '张三', String(c2.name));

  console.log('\n[服务层] 6. buildItemPricing 计价快照');
  const price = buildItemPricing(db, { product_id: pid, unit_price: 88 });
  check('手动成交价优先', price.finalPrice === 88, String(price.finalPrice));
  check('进价快照正确', price.costPrice === 50, String(price.costPrice));
  const price2 = buildItemPricing(db, { product_id: pid });
  check('未传手动价时回退权威价', price2.finalPrice === 100, String(price2.finalPrice));
} catch (e) {
  fail++;
  failures.push(`异常：${e.message}`);
  console.error('  ❌ 运行异常:', e.message);
}

try { fs.unlinkSync(TMP_DB); } catch (e) { /* ignore */ }
for (const s of ['-wal', '-shm']) { try { fs.unlinkSync(TMP_DB + s); } catch (e) { /* ignore */ } }

console.log(`\n${'='.repeat(48)}`);
console.log(`服务层单测：${pass} 通过 / ${fail} 失败`);
if (fail) { console.log('失败项：', failures.join(' | ')); process.exit(1); }
process.exit(0);
