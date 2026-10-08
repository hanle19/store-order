import fs from 'fs';
import os from 'os';
import path from 'path';

const Database = (await import('better-sqlite3')).default;
const tmp = path.join(os.tmpdir(), `_bench-${Date.now()}.db`);
const db = new Database(tmp);
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE orders (
  id INTEGER PRIMARY KEY, customer_name TEXT, customer_phone TEXT,
  order_no TEXT, status TEXT, created_at TEXT
);
CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT, phone TEXT);
`);

// 模拟 5 年经营：2 万单 + 5000 客户（远超单店实际量级）
const surnames = ['张', '王', '李', '赵', '刘', '陈', '杨', '黄', '周', '吴'];
const names = ['伟', '芳', '娜', '敏', '静', '磊', '强', '洋', '勇', '艳', '杰', '涛'];
const rnd = (n) => Math.floor(Math.random() * n);
const pick = (a) => a[rnd(a.length)];

const insOrder = db.prepare('INSERT INTO orders (customer_name, customer_phone, order_no, status, created_at) VALUES (?,?,?,?,?)');
const insCust = db.prepare('INSERT INTO customers (name, phone) VALUES (?,?)');
const N_ORDER = 20000;
const N_CUST = 5000;

db.transaction(() => {
  for (let i = 0; i < N_ORDER; i++) {
    const nm = pick(surnames) + pick(names);
    insOrder.run(nm, `138${String(10000000 + i).slice(0, 8)}`, `PO2026${String(i).padStart(6, '0')}`, '已完成', '2026-01-01');
  }
  for (let i = 0; i < N_CUST; i++) {
    insCust.run(pick(surnames) + pick(names), `139${String(10000000 + i).slice(0, 8)}`);
  }
})();

function bench(label, sql, param, times = 20) {
  const params = Array.isArray(param) ? param : [param];
  const stmt = db.prepare(sql);
  // 预热
  for (let i = 0; i < 3; i++) stmt.all(...params);
  const t0 = process.hrtime.bigint();
  let rows = 0;
  for (let i = 0; i < times; i++) rows = stmt.all(...params).length;
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / times;
  console.log(`${label.padEnd(42)} ${ms.toFixed(3)} ms/次   命中 ${rows} 行`);
  return ms;
}

console.log(`\n数据量：orders ${N_ORDER} 行 / customers ${N_CUST} 行（远超单店实际量级）\n`);
console.log('--- 无索引（当前生产状态：customer_name 无索引）---');
const a1 = bench('订单 LIKE %关键词%（全表扫描）',
  "SELECT * FROM orders WHERE customer_name LIKE ? OR customer_phone LIKE ?", ['%张伟%', '%张伟%']);
const a2 = bench('客户 LIKE %关键词%',
  "SELECT * FROM customers WHERE name LIKE ? OR phone LIKE ?", ['%张%', '%张%']);

console.log('\n--- 加普通索引后（LIKE %..% 仍无法用索引）---');
db.exec('CREATE INDEX idx_orders_name ON orders(customer_name)');
db.exec('CREATE INDEX idx_cust_name ON customers(name)');
const b1 = bench('订单 LIKE %关键词%（有索引）',
  "SELECT * FROM orders WHERE customer_name LIKE ? OR customer_phone LIKE ?", ['%张伟%', '%张伟%']);
const b2 = bench('客户 LIKE %关键词%（有索引）',
  "SELECT * FROM customers WHERE name LIKE ? OR phone LIKE ?", ['%张%', '%张%']);

console.log('\n--- FTS5 虚拟表 ---');
db.exec('CREATE VIRTUAL TABLE orders_fts USING fts5(customer_name, customer_phone, content=\'\')');
db.exec('INSERT INTO orders_fts(rowid, customer_name, customer_phone) SELECT id, customer_name, customer_phone FROM orders');
db.exec('CREATE VIRTUAL TABLE cust_fts USING fts5(name, phone, content=\'\')');
db.exec('INSERT INTO cust_fts(rowid, name, phone) SELECT id, name, phone FROM customers');
try {
  const c1 = bench('FTS5 MATCH 订单', "SELECT rowid FROM orders_fts WHERE orders_fts MATCH ?", '张伟');
  const c2 = bench('FTS5 MATCH 客户', "SELECT rowid FROM cust_fts WHERE cust_fts MATCH ?", '张*');
  console.log(`\n加速比：订单 ${(a1 / c1).toFixed(1)}x　客户 ${(a2 / c2).toFixed(1)}x`);
} catch (e) {
  console.log('FTS5 不可用:', e.message);
}

console.log('\n--- 维护成本：FTS5 索引体积 ---');
db.exec('VACUUM');
console.log('DB 文件大小:', (fs.statSync(tmp).size / 1024 / 1024).toFixed(2), 'MB');

db.close();
try { fs.unlinkSync(tmp); } catch (e) { /* ignore */ }
