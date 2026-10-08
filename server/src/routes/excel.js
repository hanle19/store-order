import { Router } from 'express';
import { getDb } from '../db.js';
import { adjustStock, adjustVariantStock, recomputeStockTable } from '../stock.js';
import { authMiddleware, roleMiddleware } from '../middleware/auth.js';
import multer from 'multer';
import * as XLSX from 'xlsx';

const router = Router();
router.use(authMiddleware);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// ===== 工具函数 =====
function sendExcel(res, wb, filename) {
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}.xlsx"`);
  res.send(buf);
}

function autoWidth(ws) {
  const colWidths = {};
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
  for (let r = range.s.r; r <= range.e.r; r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (!cell) continue;
      const len = cell.v ? String(cell.v).length : 0;
      const col = XLSX.utils.encode_col(c);
      colWidths[col] = Math.max(colWidths[col] || 8, Math.min(len + 2, 40));
    }
  }
  ws['!cols'] = Object.entries(colWidths).map(([k, v]) => ({ wch: v }));
}

function sheetFromAOA(data, sheetName) {
  const ws = XLSX.utils.aoa_to_sheet(data);
  autoWidth(ws);
  return ws;
}

// ===== 订单管理导出 =====
router.get('/export/orders', roleMiddleware('admin', 'boss'), (req, res) => {
  const db = getDb();
  const { year, month, status } = req.query;

  let where = "WHERE 1=1";
  const params = [];
  if (status) { where += " AND o.status = ?"; params.push(status); }
  if (year && month) {
    const ms = `${year}-${String(month).padStart(2, '0')}-01`;
    const nm = parseInt(month) === 12 ? `${parseInt(year) + 1}-01-01` : `${year}-${String(parseInt(month) + 1).padStart(2, '0')}-01`;
    where += " AND o.created_at >= ? AND o.created_at < ?";
    params.push(ms, nm);
  }

  const orders = db.prepare(`
    SELECT o.*, u.display_name as salesperson
    FROM orders o LEFT JOIN users u ON o.salesperson_id = u.id
    ${where} ORDER BY o.created_at DESC
  `).all(...params);

  const orderItems = db.prepare(`
    SELECT oi.*, o.order_no FROM order_items oi
    JOIN orders o ON oi.order_id = o.id
    ${where}
    ORDER BY o.created_at DESC
  `).all(...params);

  const wb = XLSX.utils.book_new();

  // 订单汇总表
  const orderRows = [['订单号', '客户姓名', '客户电话', '客户地址', '订单总额', '折扣', '实际成交价', '已付定金', '未付尾款', '支付方式', '状态', '导购', '送货日期', '备注', '下单时间']];
  const statusText = { pending: '待付定金', deposited: '已付定金', full_paid: '已付全款', purchasing: '进货中', arrived: '已到货', balance_paid: '已收尾款', delivered: '已送货', completed: '已完成', cancelled: '已取消' };
  for (const o of orders) {
    orderRows.push([
      o.order_no, o.customer_name, o.customer_phone || '', o.customer_address || '',
      o.total_amount, o.discount, o.actual_amount, o.deposit_amount, o.balance_amount,
      o.payment_method === 'full' ? '全款' : '定金',
      statusText[o.status] || o.status,
      o.salesperson_name || o.salesperson || '',
      o.delivery_date || '', o.note || '', o.created_at,
    ]);
  }
  XLSX.utils.book_append_sheet(wb, sheetFromAOA(orderRows, '订单汇总'), '订单汇总');

  // 订单明细表
  const itemRows = [['订单号', '商品名称', '型号', '分类', '规格', '数量', '单价', '小计', '已分配']];
  const typeText = { sample: '样品', gift: '赠品', order: '订货' };
  for (const item of orderItems) {
    itemRows.push([
      item.order_no, item.product_name, item.product_model || '',
      typeText[item.product_type] || item.product_type,
      item.spec || '', item.quantity, item.unit_price, item.total_price, item.allocated,
    ]);
  }
  XLSX.utils.book_append_sheet(wb, sheetFromAOA(itemRows, '订单明细'), '订单明细');

  sendExcel(res, wb, `订单数据_${year || '全部'}${month ? String(month).padStart(2, '0') : ''}`);
});

// ===== 订单管理导入 =====
router.post('/import/orders', roleMiddleware('admin', 'boss'), upload.single('file'), (req, res) => {
  try {
    const db = getDb();
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    const ws = wb.Sheets['订单汇总'] || wb.Sheets[wb.SheetNames[0]];
    if (!ws) return res.status(400).json({ error: '未找到工作表，请确保Excel文件至少包含一个工作表' });
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

    let imported = 0, skipped = 0;
    const importTx = db.transaction(() => {
      for (const row of rows) {
        const orderNo = row['订单号'];
        if (!orderNo) { skipped++; continue; }
        const exists = db.prepare('SELECT id FROM orders WHERE order_no = ?').get(orderNo);
        if (exists) { skipped++; continue; }

        const statusMap = { '待付定金': 'pending', '已付定金': 'deposited', '已付全款': 'full_paid', '进货中': 'purchasing', '已到货': 'arrived', '已收尾款': 'balance_paid', '已送货': 'delivered', '已完成': 'completed', '已取消': 'cancelled' };
        const payMap = { '全款': 'full', '定金': 'deposit' };

        db.prepare(`INSERT INTO orders (order_no, customer_name, customer_phone, customer_address,
          total_amount, discount, actual_amount, deposit_amount, balance_amount, payment_method,
          status, salesperson_name, delivery_date, note, created_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
          orderNo, row['客户姓名'] || '', row['客户电话'] || '', row['客户地址'] || '',
          parseFloat(row['订单总额']) || 0, parseFloat(row['折扣']) || 0,
          parseFloat(row['实际成交价']) || 0, parseFloat(row['已付定金']) || 0,
          parseFloat(row['未付尾款']) || 0, payMap[row['支付方式']] || 'deposit',
          statusMap[row['状态']] || 'pending', row['导购'] || '',
          row['送货日期'] || '', row['备注'] || '',
          row['下单时间'] || new Date().toISOString().slice(0, 19).replace('T', ' ')
        );
        imported++;
      }
    });
    importTx();

    // 订单明细导入（可选）：若文件包含「订单明细」工作表，则同步写入 order_items
    const detailWs = wb.Sheets['订单明细'] || wb.Sheets['订单详情'];
    if (detailWs) {
      const detailRows = XLSX.utils.sheet_to_json(detailWs, { defval: '' });
      const typeMap = { '样品': 'sample', '订货': 'order', '赠品': 'gift' };
      const stMap = { '已完成': 'signed', '已签收': 'signed', '已送货': 'signed',
        '已付全款': 'pending', '已付定金': 'pending', '待付定金': 'pending',
        '进货中': 'ordered', '订货中': 'ordered', '已订货': 'ordered',
        '已到货': 'arrived', '齐货待收': 'arrived', '尾款结清': 'arrived',
        '配送中': 'delivering', '分批配送': 'delivering', '已取消': 'cancelled' };
      const orderByNo = {};
      db.prepare('SELECT id, order_no, status FROM orders').all().forEach(o => { orderByNo[o.order_no] = o; });
      for (const d of detailRows) {
        const ono = d['订单号'];
        const o = ono ? orderByNo[ono] : null;
        if (!o) continue;
        const ptype = typeMap[d['类型']] || 'order';
        const prod = d['商品名称'] ? db.prepare('SELECT id FROM products WHERE name = ? LIMIT 1').get(d['商品名称']) : null;
        const pid = prod ? prod.id : null;
        const qty = parseInt(d['数量']) || 1;
        const up = parseFloat(d['单价']) || 0;
        const ap = parseFloat(d['成交单价']) || up;
        const istatus = stMap[o.status] || 'pending';
        db.prepare(`INSERT INTO order_items (order_id, product_id, product_name, product_model, spec, unit_price, total_price, quantity, product_type, item_status)
          VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
          o.id, pid, d['商品名称'] || '', d['型号'] || '', d['规格'] || '', up, ap * qty, qty, ptype, istatus
        );
      }
    }

    res.json({ message: `导入完成：新增 ${imported} 条，跳过 ${skipped} 条`, imported, skipped });
  } catch (err) {
    console.error('订单导入失败:', err);
    res.status(500).json({ error: '导入失败: ' + err.message });
  }
});

// ===== 商品管理导出 =====
// 规格感知：每个商品按「型号」聚合后，逐规格（product_variants）展开为一行，
// 商品名称相同、规格不同 —— 与导入互为逆操作，保证无损往返。
router.get('/export/products', roleMiddleware('admin', 'boss'), (req, res) => {
  const db = getDb();
  const products = db.prepare(`
    SELECT id, name, model, code, barcode, category, type, unit, spec, brand, price, cost_price,
           stock, description, highlight, active
    FROM products ORDER BY category, name
  `).all();

  // 规格明细一次性取出并按商品分组，避免 N+1
  const variantRows = db.prepare(
    'SELECT product_id, spec, price, cost_price, stock FROM product_variants WHERE active = 1 ORDER BY sort_order, id'
  ).all();
  const vmap = {};
  for (const v of variantRows) (vmap[v.product_id] ||= []).push(v);

  const catText = { sample: '样品', gift: '赠品', order: '订货' };
  const rows = [['商品名称', '型号', '编码', '条码', '分类', '类目', '单位', '规格', '品牌', '售价', '进价', '库存', '描述', '亮点', '是否上架']];
  for (const p of products) {
    const vs = vmap[p.id] || [];
    if (vs.length) {
      // 有规格：逐规格展开
      for (const v of vs) {
        rows.push([
          p.name, p.model || '', p.code || '', p.barcode || '', catText[p.category] || p.category, p.type || '',
          p.unit || '', v.spec || '', p.brand || '',
          v.price, v.cost_price || 0, v.stock || 0, p.description || '', p.highlight || '',
          p.active ? '是' : '否',
        ]);
      }
    } else {
      // 无规格（旧版单规格商品）：保持单行，规格列回填 products.spec
      rows.push([
        p.name, p.model || '', p.code || '', p.barcode || '', catText[p.category] || p.category, p.type || '',
        p.unit || '', p.spec || '', p.brand || '',
        p.price, p.cost_price || 0, p.stock || 0, p.description || '', p.highlight || '',
        p.active ? '是' : '否',
      ]);
    }
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheetFromAOA(rows, '商品列表'), '商品列表');
  sendExcel(res, wb, '商品数据');
});

// ===== 商品管理导入 =====
// 条码唯一识别：每个不同条码 = 一个独立商品。条码相同则更新；条码为空退化为
// 编码 → 名称+型号（本次导入内去重）。同名商品（条码不同）各自独立成商品，
// 名称相同但互不影响。每个商品生成 1 条 product_variants，前端展示一致。
router.post('/import/products', roleMiddleware('admin', 'boss'), upload.single('file'), (req, res) => {
  try {
    const db = getDb();
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    const ws = wb.Sheets['商品列表'] || wb.Sheets[wb.SheetNames[0]];
    if (!ws) return res.status(400).json({ error: '未找到工作表' });
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

    let added = 0, updated = 0, variants = 0, skipped = 0;
    const warnings = [];
    const catMap = { '样品': 'sample', '赠品': 'gift', '订货': 'order' };

    // 保本价利润率（默认 0.4）：保本价 = 进价 ÷ (1 − 利润率)
    let margin = 0.4;
    try { const mr = db.prepare("SELECT value FROM system_config WHERE key='break_even_margin'").get(); if (mr) { const m = Number(mr.value); if (m > 0 && m < 1) margin = m; } } catch {}
    const breakEven = (cost) => { const c = Number(cost) || 0; return c > 0 ? Math.round((c / (1 - margin)) * 100) / 100 : 0; };

    // 本次导入内内存去重键（仅当条码与编码都缺失时生效）
    const seenKeys = new Map();
    const colOf = (r, k) => (r[k] || '').toString().trim();

    const insertProduct = db.prepare(`INSERT INTO products (name, model, code, barcode, category, type, unit, spec, brand,
      price, cost_price, stock, description, highlight, active, break_even_price)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const insertProductNoCode = db.prepare(`INSERT INTO products (name, model, barcode, category, type, unit, spec, brand,
      price, cost_price, stock, description, highlight, active, break_even_price)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const updateProduct = db.prepare(`UPDATE products SET model=?, code=?, barcode=?, category=?, type=?, unit=?, spec=?, brand=?,
      price=?, cost_price=?, stock=?, description=?, highlight=?, active=?, break_even_price=?, updated_at=datetime('now','localtime') WHERE id=?`);
    const updateProductNoCode = db.prepare(`UPDATE products SET model=?, barcode=?, category=?, type=?, unit=?, spec=?, brand=?,
      price=?, cost_price=?, stock=?, description=?, highlight=?, active=?, break_even_price=?, updated_at=datetime('now','localtime') WHERE id=?`);
    const deleteVariants = db.prepare('DELETE FROM product_variants WHERE product_id = ?');
    const insertVariant = db.prepare('INSERT INTO product_variants (product_id, spec, price, cost_price, stock, sort_order, active, break_even_price) VALUES (?, ?, ?, ?, ?, ?, 1, ?)');
    const getByBarcode = db.prepare("SELECT id FROM products WHERE barcode = ? AND barcode != ''");
    const getByCode = db.prepare("SELECT id FROM products WHERE code = ? AND code != ''");

    const tx = db.transaction(() => {
      for (const row of rows) {
        const name = colOf(row, '商品名称');
        if (!name) { skipped++; continue; }
        const barcode = colOf(row, '条码');
        const code = colOf(row, '编码');
        const model = colOf(row, '型号');
        const spec = colOf(row, '规格');
        const category = catMap[colOf(row, '分类')] || 'order';

        // 唯一键匹配：条码 > 编码 > 名称+型号（本次导入内）
        let existingId = null;
        if (barcode) {
          const e = getByBarcode.get(barcode);
          if (e) existingId = e.id;
        } else if (code) {
          const e = getByCode.get(code);
          if (e) existingId = e.id;
        } else {
          const key = name + '｜' + model;
          if (seenKeys.has(key)) existingId = seenKeys.get(key);
        }

        const price = parseFloat(row['售价']) || 0;
        const cost = parseFloat(row['进价']) || 0;
        const stock = parseInt(row['库存']) || 0;
        const be = breakEven(cost);
        const active = (row['是否上架'] === '否') ? 0 : 1;
        const topSpec = spec || model || '';            // 顶层 spec 兼容（列表优先展示 variants.spec）
        const variantSpec = spec || model || '默认';    // 每个商品至少 1 个规格变体（对齐前端校验）

        if (existingId) {
          try {
            updateProduct.run(model, code || null, barcode, category, colOf(row, '类目'), colOf(row, '单位') || '件', topSpec, colOf(row, '品牌'),
              price, cost, stock, colOf(row, '描述'), colOf(row, '亮点'), active, be, existingId);
          } catch (e) {
            if (String(e.message).includes('UNIQUE') && code) {
              updateProductNoCode.run(model, barcode, category, colOf(row, '类目'), colOf(row, '单位') || '件', topSpec, colOf(row, '品牌'),
                price, cost, stock, colOf(row, '描述'), colOf(row, '亮点'), active, be, existingId);
              warnings.push(`商品「${name}」编码冲突，已忽略其编码`);
            } else throw e;
          }
          deleteVariants.run(existingId);               // 重建规格，保证与本次导入完全一致
          insertVariant.run(existingId, variantSpec, price, cost, stock, 0, be);
          updated++;
        } else {
          try {
            const result = insertProduct.run(name, model, code || null, barcode, category, colOf(row, '类目'), colOf(row, '单位') || '件', topSpec, colOf(row, '品牌'),
              price, cost, stock, colOf(row, '描述'), colOf(row, '亮点'), active, be);
            existingId = result.lastInsertRowid;
            insertVariant.run(existingId, variantSpec, price, cost, stock, 0, be);
            if (!barcode && !code) seenKeys.set(name + '｜' + model, existingId);
            added++;
          } catch (e) {
            if (String(e.message).includes('UNIQUE') && code) {
              const result = insertProductNoCode.run(name, model, barcode, category, colOf(row, '类目'), colOf(row, '单位') || '件', topSpec, colOf(row, '品牌'),
                price, cost, stock, colOf(row, '描述'), colOf(row, '亮点'), active, be);
              existingId = result.lastInsertRowid;
              insertVariant.run(existingId, variantSpec, price, cost, stock, 0, be);
              if (!barcode && !code) seenKeys.set(name + '｜' + model, existingId);
              added++;
              warnings.push(`商品「${name}」编码冲突，已忽略其编码`);
            } else throw e;
          }
        }

        // 主库存 = 该商品规格库存之和（当前恰为 1 个规格 = stock）；样品/赠品同步 inventory 表
        db.prepare(`UPDATE products SET stock = ?, updated_at=datetime('now','localtime') WHERE id = ?`).run(stock, existingId);
        if (category === 'sample' || category === 'gift') {
          db.prepare('INSERT OR IGNORE INTO inventory (product_id, quantity) VALUES (?, ?)').run(existingId, stock);
          db.prepare(`UPDATE inventory SET quantity = ?, updated_at=datetime('now','localtime') WHERE product_id = ?`).run(stock, existingId);
        }
        // 同步仓库维度镜像（默认仓）
        recomputeStockTable(db, existingId, 0);
      }
    });
    tx();

    const msg = `导入完成：新增商品 ${added} 个，更新 ${updated} 个，跳过 ${skipped} 行`
      + (warnings.length ? `；警告：${warnings.join('；')}` : '');
    res.json({ message: msg, added, updated, skipped, warnings });
  } catch (err) {
    console.error('商品导入失败:', err);
    res.status(500).json({ error: '导入失败: ' + err.message });
  }
});

// ===== 库存管理导出 =====
// 规格感知：有规格的商品按 product_variants 逐规格展开一行，保证与导入可往返匹配。
router.get('/export/inventory', roleMiddleware('admin', 'boss'), (req, res) => {
  const db = getDb();
  const items = db.prepare(`
    SELECT p.id, p.name, p.model, p.code, p.category, p.unit, p.spec, p.brand,
           p.price, p.cost_price, p.stock
    FROM products p WHERE p.active = 1 ORDER BY p.category, p.name
  `).all();

  const variantRows = db.prepare('SELECT product_id, spec, price, cost_price, stock FROM product_variants WHERE active = 1 ORDER BY sort_order, id').all();
  const vmap = {};
  for (const v of variantRows) (vmap[v.product_id] ||= []).push(v);

  const catText = { sample: '样品', gift: '赠品', order: '订货' };
  const rows = [['商品名称', '型号', '编码', '分类', '单位', '规格', '品牌', '售价', '进价', '库存数量']];
  for (const item of items) {
    const vs = vmap[item.id] || [];
    if (vs.length) {
      for (const v of vs) {
        rows.push([
          item.name, item.model || '', item.code || '',
          catText[item.category] || item.category,
          item.unit || '', v.spec || '', item.brand || '',
          v.price, v.cost_price || 0, v.stock || 0,
        ]);
      }
    } else {
      rows.push([
        item.name, item.model || '', item.code || '',
        catText[item.category] || item.category,
        item.unit || '', item.spec || '', item.brand || '',
        item.price, item.cost_price || 0, item.stock || 0,
      ]);
    }
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheetFromAOA(rows, '库存列表'), '库存列表');
  sendExcel(res, wb, '库存数据');
});

// ===== 库存管理导入 =====
// 精确定位：优先按「编码」定位商品；无编码则按「名称」查找，若同名多个商品，
// 再按「规格/型号」匹配其 product_variants 锁定具体商品（适配按条码分商品的模型）。
// 命中规格走 adjustVariantStock，无规格商品走 adjustStock；导入后重算主库存。
router.post('/import/inventory', roleMiddleware('admin', 'boss'), upload.single('file'), (req, res) => {
  try {
    const db = getDb();
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    const ws = wb.Sheets['库存列表'] || wb.Sheets[wb.SheetNames[0]];
    if (!ws) return res.status(400).json({ error: '未找到工作表' });
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

    let updated = 0, notFound = 0;
    const getByCode = db.prepare("SELECT id, category, stock FROM products WHERE code = ? AND code != '' LIMIT 1");
    const getByNameAll = db.prepare('SELECT id, category, stock FROM products WHERE name = ?');
    const getVarCount = db.prepare('SELECT COUNT(*) AS c FROM product_variants WHERE product_id = ?');
    const getVariant = db.prepare('SELECT id, stock FROM product_variants WHERE product_id = ? AND spec = ? LIMIT 1');
    const sumVar = db.prepare('SELECT COALESCE(SUM(stock),0) AS s FROM product_variants WHERE product_id = ?');

    const tx = db.transaction(() => {
      for (const row of rows) {
        const name = (row['商品名称'] || '').toString().trim();
        if (!name) continue;
        const code = (row['编码'] || '').toString().trim();
        const specKey = (row['规格'] || '').toString().trim() || (row['型号'] || '').toString().trim() || '';
        const qty = parseInt(row['库存数量']) || 0;

        // 定位商品：编码优先；无编码按名称，同名多个再按规格/型号匹配变体
        let product = code ? getByCode.get(code) : null;
        let matchedVariant = null;
        if (!product) {
          const sameName = getByNameAll.all(name);
          if (sameName.length === 0) { notFound++; continue; }
          if (sameName.length === 1) {
            product = sameName[0];
          } else if (specKey) {
            let hit = null;
            for (const cand of sameName) {
              const v = getVariant.get(cand.id, specKey);
              if (v) { hit = { product: cand, variant: v }; break; }
            }
            if (hit) { product = hit.product; matchedVariant = hit.variant; }
            else { notFound++; continue; }
          } else {
            notFound++; continue; // 同名多商品且无规格可区分，无法唯一锁定
          }
        }

        const varCount = getVarCount.get(product.id).c;
        if (varCount > 0) {
          const v = matchedVariant || (specKey ? getVariant.get(product.id, specKey) : null);
          if (!v) { notFound++; continue; }
          const delta = qty - v.stock;
          if (delta !== 0) adjustVariantStock(v.id, delta, { type: 'adjust', reason: 'Excel 导入库存', operatorId: req.user?.id });
          const total = sumVar.get(product.id).s;
          db.prepare(`UPDATE products SET stock = ?, updated_at=datetime('now','localtime') WHERE id = ?`).run(total, product.id);
          if (product.category === 'sample' || product.category === 'gift') {
            db.prepare('INSERT OR IGNORE INTO inventory (product_id, quantity) VALUES (?, ?)').run(product.id, total);
            db.prepare(`UPDATE inventory SET quantity = ?, updated_at=datetime('now','localtime') WHERE product_id = ?`).run(total, product.id);
          }
          // 同步仓库维度镜像（默认仓）
          recomputeStockTable(db, product.id, 0);
        } else {
          const delta = qty - product.stock;
          if (delta !== 0) adjustStock(product.id, delta, { type: 'adjust', reason: 'Excel 导入库存', operatorId: req.user?.id });
        }
        updated++;
      }
    });
    tx();
    res.json({ message: `导入完成：更新 ${updated} 条，未找到/无法匹配 ${notFound} 条`, updated, notFound });
  } catch (err) {
    console.error('库存导入失败:', err);
    res.status(500).json({ error: '导入失败: ' + err.message });
  }
});

// ===== 进货管理导出 =====
router.get('/export/purchases', roleMiddleware('admin', 'boss'), (req, res) => {
  const db = getDb();
  const { year, month } = req.query;

  let where = "WHERE 1=1";
  const params = [];
  if (year && month) {
    const ms = `${year}-${String(month).padStart(2, '0')}-01`;
    const nm = parseInt(month) === 12 ? `${parseInt(year) + 1}-01-01` : `${year}-${String(parseInt(month) + 1).padStart(2, '0')}-01`;
    where += " AND po.created_at >= ? AND po.created_at < ?";
    params.push(ms, nm);
  }

  const orders = db.prepare(`
    SELECT po.*, u.display_name as operator
    FROM purchase_orders po LEFT JOIN users u ON po.operator_id = u.id
    ${where} ORDER BY po.created_at DESC
  `).all(...params);

  const items = db.prepare(`
    SELECT pi.*, po.po_no FROM purchase_items pi
    JOIN purchase_orders po ON pi.purchase_id = po.id
    ${where.replace(/po\./g, 'po.')}
    ORDER BY po.created_at DESC
  `).all(...params);

  const wb = XLSX.utils.book_new();
  const statusText = { pending: '待处理', ordered: '已下单', arrived: '已到货', cancelled: '已取消' };

  const orderRows = [['进货单号', '供应商', '状态', '总金额', '操作人', '备注', '创建时间']];
  for (const o of orders) {
    orderRows.push([o.po_no, o.supplier || '', statusText[o.status] || o.status, o.total_amount, o.operator || '', o.note || '', o.created_at]);
  }
  XLSX.utils.book_append_sheet(wb, sheetFromAOA(orderRows, '进货单汇总'), '进货单汇总');

  const itemRows = [['进货单号', '商品名称', '品牌', '型号', '规格', '数量', '进价', '总价', '已分配', '备注']];
  for (const item of items) {
    itemRows.push([item.po_no, item.product_name, item.brand || '', item.model || '', item.spec || '', item.quantity, item.unit_price, item.total_price, item.allocated, item.note || '']);
  }
  XLSX.utils.book_append_sheet(wb, sheetFromAOA(itemRows, '进货明细'), '进货明细');

  sendExcel(res, wb, `进货数据_${year || '全部'}${month ? String(month).padStart(2, '0') : ''}`);
});

// ===== 进货管理导入 =====
router.post('/import/purchases', roleMiddleware('admin', 'boss'), upload.single('file'), (req, res) => {
  try {
    const db = getDb();
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    const ws = wb.Sheets['进货明细'] || wb.Sheets[wb.SheetNames[0]];
    if (!ws) return res.status(400).json({ error: '未找到工作表' });
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

    let imported = 0;
    const statusMap = { '待处理': 'pending', '已下单': 'ordered', '已到货': 'arrived', '已取消': 'cancelled' };
    const tx = db.transaction(() => {
      // Group by po_no
      const grouped = {};
      for (const row of rows) {
        const poNo = row['进货单号'];
        if (!poNo) continue;
        if (!grouped[poNo]) grouped[poNo] = { items: [], supplier: '', status: 'pending', note: '' };
        grouped[poNo].items.push(row);
      }

      // Also read from 进货单汇总 if available
      const summaryWs = wb.Sheets['进货单汇总'];
      if (summaryWs) {
        const summaryRows = XLSX.utils.sheet_to_json(summaryWs, { defval: '' });
        for (const row of summaryRows) {
          const poNo = row['进货单号'];
          if (poNo && grouped[poNo]) {
            grouped[poNo].supplier = row['供应商'] || '';
            grouped[poNo].status = statusMap[row['状态']] || 'pending';
            grouped[poNo].note = row['备注'] || '';
          }
        }
      }

      for (const [poNo, data] of Object.entries(grouped)) {
        // Check if exists
        const exists = db.prepare('SELECT id FROM purchase_orders WHERE po_no = ?').get(poNo);
        if (exists) continue;

        let totalAmount = 0;
        const validItems = [];
        for (const item of data.items) {
          const qty = parseInt(item['数量']) || 0;
          if (qty <= 0) continue;
          const unitPrice = parseFloat(item['进价']) || 0;
          const totalPrice = unitPrice * qty;
          totalAmount += totalPrice;
          validItems.push({ name: item['商品名称'] || '', brand: item['品牌'] || '', model: item['型号'] || '', spec: item['规格'] || '', quantity: qty, unit_price: unitPrice, total_price: totalPrice, note: item['备注'] || '' });
        }
        if (validItems.length === 0) continue;

        const result = db.prepare(`INSERT INTO purchase_orders (po_no, supplier, status, total_amount, note, operator_id, store_id) VALUES (?, ?, ?, ?, ?, ?, ?)`)
          .run(poNo, data.supplier, data.status, totalAmount, data.note, req.user.id, req.user?.store_id || 1);

        for (const item of validItems) {
          db.prepare('INSERT INTO purchase_items (purchase_id, product_name, brand, model, spec, quantity, unit_price, total_price, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
            .run(result.lastInsertRowid, item.name, item.brand, item.model, item.spec, item.quantity, item.unit_price, item.total_price, item.note);
        }
        imported++;
      }
    });
    tx();
    res.json({ message: `导入完成：新增 ${imported} 张进货单`, imported });
  } catch (err) {
    res.status(500).json({ error: '导入失败: ' + err.message });
  }
});

// ===== 财务管理导出（仅管理员和老板） =====
router.get('/export/finance', roleMiddleware('admin', 'boss'), (req, res) => {
  const db = getDb();
  const { year, month } = req.query;
  const y = parseInt(year) || new Date().getFullYear();
  const m = parseInt(month) || new Date().getMonth() + 1;
  const monthStr = `${y}-${String(m).padStart(2, '0')}`;
  const monthStart = `${y}-${String(m).padStart(2, '0')}-01`;
  const nextMonth = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;

  // 汇总数据
  const salesData = db.prepare(`
    SELECT COALESCE(SUM(CASE WHEN actual_amount > 0 THEN actual_amount ELSE total_amount END), 0) as revenue,
           COUNT(*) as order_count
    FROM orders WHERE status != 'cancelled' AND created_at >= ? AND created_at < ?
  `).get(monthStart, nextMonth);

  const costData = db.prepare(`
    SELECT COALESCE(SUM(oi.quantity * COALESCE(p.cost_price, 0)), 0) as goods_cost
    FROM order_items oi JOIN orders o ON oi.order_id = o.id
    LEFT JOIN products p ON oi.product_id = p.id
    WHERE o.status != 'cancelled' AND o.created_at >= ? AND o.created_at < ?
  `).get(monthStart, nextMonth);

  const otherCosts = db.prepare('SELECT * FROM other_costs WHERE year = ? AND month = ? ORDER BY created_at DESC').all(y, m);
  const otherTotal = otherCosts.reduce((s, c) => s + c.amount, 0);

  const revenue = salesData.revenue || 0;
  const goodsCost = costData.goods_cost || 0;
  const totalCost = goodsCost + otherTotal;
  const profit = revenue - totalCost;
  const margin = revenue > 0 ? (profit / revenue * 100) : 0;

  // 订单利润明细
  const orderProfits = db.prepare(`
    SELECT o.order_no, o.customer_name, o.status,
      CASE WHEN o.actual_amount > 0 THEN o.actual_amount ELSE o.total_amount END as revenue,
      o.created_at,
      (SELECT COALESCE(SUM(oi.quantity * COALESCE(p.cost_price, 0)), 0)
       FROM order_items oi LEFT JOIN products p ON oi.product_id = p.id
       WHERE oi.order_id = o.id) as goods_cost
    FROM orders o
    WHERE o.status != 'cancelled' AND o.created_at >= ? AND o.created_at < ?
    ORDER BY o.created_at DESC
  `).all(monthStart, nextMonth);

  const wb = XLSX.utils.book_new();

  // 财务汇总
  const sumRows = [
    ['项目', '金额', '说明'],
    ['销售收入', parseFloat(revenue.toFixed(2)), `${salesData.order_count} 笔订单`],
    ['货物成本', parseFloat(goodsCost.toFixed(2)), '商品进价合计'],
    ['其他成本', parseFloat(otherTotal.toFixed(2)), `${otherCosts.length} 项支出`],
    ['总成本', parseFloat(totalCost.toFixed(2)), '货物成本 + 其他成本'],
    ['净利润', parseFloat(profit.toFixed(2)), ''],
    ['利润率', parseFloat(margin.toFixed(2)) + '%', ''],
  ];
  XLSX.utils.book_append_sheet(wb, sheetFromAOA(sumRows, '财务汇总'), '财务汇总');

  // 其他成本明细
  const catText = { rent: '房租', salary: '工资', utility: '水电', material: '物料', other: '其他' };
  const costRows = [['名称', '类别', '金额', '备注', '创建时间']];
  for (const c of otherCosts) {
    costRows.push([c.name, catText[c.category] || c.category, c.amount, c.note || '', c.created_at]);
  }
  XLSX.utils.book_append_sheet(wb, sheetFromAOA(costRows, '其他成本'), '其他成本');

  // 订单利润明细
  const statusText = { pending: '待付定金', deposited: '已付定金', full_paid: '已付全款', purchasing: '进货中', arrived: '已到货', balance_paid: '已收尾款', delivered: '已送货', completed: '已完成', cancelled: '已取消' };
  const opRows = [['订单号', '客户', '状态', '销售额', '货物成本', '利润', '利润率', '下单时间']];
  for (const o of orderProfits) {
    const rev = parseFloat(o.revenue) || 0;
    const cost = parseFloat(o.goods_cost) || 0;
    const p = rev - cost;
    opRows.push([o.order_no, o.customer_name, statusText[o.status] || o.status, rev, cost, parseFloat(p.toFixed(2)), rev > 0 ? parseFloat((p / rev * 100).toFixed(2)) + '%' : '0%', o.created_at]);
  }
  XLSX.utils.book_append_sheet(wb, sheetFromAOA(opRows, '订单利润'), '订单利润');

  sendExcel(res, wb, `财务数据_${y}年${m}月`);
});

// ===== 财务管理导入（其他成本，仅管理员和老板） =====
router.post('/import/finance', roleMiddleware('admin', 'boss'), upload.single('file'), (req, res) => {
  try {
    const db = getDb();
    const { year, month } = req.body;
    const y = parseInt(year) || new Date().getFullYear();
    const m = parseInt(month) || new Date().getMonth() + 1;

    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    const ws = wb.Sheets['其他成本'] || wb.Sheets[wb.SheetNames[0]];
    if (!ws) return res.status(400).json({ error: '未找到工作表' });
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

    let imported = 0;
    const catMap = { '房租': 'rent', '工资': 'salary', '水电': 'utility', '物料': 'material', '其他': 'other' };
    const tx = db.transaction(() => {
      for (const row of rows) {
        const name = row['名称'];
        if (!name) continue;
        const amount = parseFloat(row['金额']);
        if (!amount) continue;
        db.prepare(`INSERT INTO other_costs (year, month, name, amount, category, note) VALUES (?, ?, ?, ?, ?, ?)`)
          .run(y, m, name, amount, catMap[row['类别']] || 'other', row['备注'] || '');
        imported++;
      }
    });
    tx();
    res.json({ message: `导入完成：新增 ${imported} 条其他成本`, imported });
  } catch (err) {
    res.status(500).json({ error: '导入失败: ' + err.message });
  }
});

// ===== 下载导入模板 =====
router.get('/template/:module', (req, res) => {
  const { module } = req.params;
  const wb = XLSX.utils.book_new();

  const templates = {
    orders: [['订单号', '客户姓名', '客户电话', '客户地址', '订单总额', '折扣', '实际成交价', '已付定金', '未付尾款', '支付方式', '状态', '导购', '送货日期', '备注', '下单时间']],
    products: [['商品名称', '型号', '编码', '条码', '分类', '类目', '单位', '规格', '品牌', '售价', '进价', '库存', '描述', '亮点', '是否上架']],
    inventory: [['商品名称', '型号', '编码', '分类', '单位', '规格', '品牌', '售价', '进价', '库存数量']],
    purchases: [['进货单号', '供应商', '状态', '总金额', '操作人', '备注', '创建时间']],
    finance: [['名称', '类别', '金额', '备注', '创建时间']],
  };

  const data = templates[module];
  if (!data) return res.status(400).json({ error: '未知模块' });

  XLSX.utils.book_append_sheet(wb, sheetFromAOA(data, '模板'), '模板');
  sendExcel(res, wb, `${module}_导入模板`);
});

export default router;
