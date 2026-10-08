import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, 'data/store.db');
const backupPath = path.join(__dirname, `data/store.db.backup_${new Date().toISOString().replace(/[:.]/g, '-')}`);

// 1. 备份数据库
console.log('[1/4] 备份数据库...');
fs.copyFileSync(dbPath, backupPath);
console.log(`  备份文件：${backupPath}`);

const db = new Database(dbPath);

// 2. 清除订单相关数据
console.log('\n[2/4] 清除订单相关数据...');
db.exec('DELETE FROM allocations');
console.log('  ✓ 已清除：allocations（分配记录）');
db.exec('DELETE FROM inventory_logs');
console.log('  ✓ 已清除：inventory_logs（库存日志）');
db.exec('DELETE FROM payments');
console.log('  ✓ 已清除：payments（支付记录）');
db.exec('DELETE FROM order_items');
console.log('  ✓ 已清除：order_items（订单商品）');
db.exec('DELETE FROM orders');
console.log('  ✓ 已清除：orders（订单）');

// 3. 清除进货相关数据
console.log('\n[3/4] 清除进货相关数据...');
db.exec('DELETE FROM purchase_items');
console.log('  ✓ 已清除：purchase_items（进货商品）');
db.exec('DELETE FROM purchase_orders');
console.log('  ✓ 已清除：purchase_orders（进货单）');

// 4. 清除其他数据
console.log('\n[4/4] 清除其他数据...');
try { db.exec('DELETE FROM notifications'); console.log('  ✓ 已清除：notifications（消息通知）'); } catch(e) {}
try { db.exec('DELETE FROM other_costs'); console.log('  ✓ 已清除：other_costs（其他成本）'); } catch(e) {}
try { db.exec('DELETE FROM monthly_targets'); console.log('  ✓ 已清除：monthly_targets（月度目标）'); } catch(e) {}
try { db.exec('DELETE FROM push_config'); console.log('  ✓ 已清除：push_config（推送配置）'); } catch(e) {}

// 5. 保留的数据
console.log('\n✅ 保留的数据：');
const productCount = db.prepare('SELECT COUNT(*) as count FROM products').get().count;
console.log(`  - 商品管理：${productCount} 个商品`);
const inventoryCount = db.prepare('SELECT COUNT(*) as count FROM inventory').get().count;
console.log(`  - 库存数据：${inventoryCount} 条记录`);
const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
console.log(`  - 用户数据：${userCount} 个用户`);
const productNameCount = db.prepare('SELECT COUNT(*) as count FROM product_names').get().count;
console.log(`  - 商品名称：${productNameCount} 个`);

// 6. 重置自增ID
console.log('\n🔄 重置自增ID...');
db.exec('DELETE FROM sqlite_sequence');
console.log('  ✓ 已重置所有表的自增计数器');

db.close();

console.log('\n✅ 数据重置完成！');
console.log(`📦 备份文件：${backupPath}`);
console.log('\n⚠️  请重启服务器以应用更改');
