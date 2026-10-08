// server/src/services/orderCustomer.js
// 订单↔客户管理打通（从 routes/orders.js 抽取，纯 DB 逻辑，可独立单测）。
// 抽取价值：客户主档的"电话优先关联 + 空白字段补齐 + 自动建档"是下单的隐性副作用，
// 独立后可单独验证"重复下单不重复建档""已维护字段不被覆盖"等边界。

// 客户↔订单打通：将关联客户推进为「已成交」（deal），并清流失标记、更新最近跟进日期。
// 仅对未成交客户生效（已是 deal 则幂等跳过）；流失客户重新下单会被正确激活。
export function markCustomerDeal(db, customerId) {
  if (!customerId) return;
  const c = db.prepare('SELECT id, status FROM customers WHERE id = ?').get(Number(customerId));
  if (!c || c.status === 'deal') return;
  db.prepare(`UPDATE customers SET status = 'deal', lost_at = '',
    last_followup_date = date('now','localtime'), updated_at = datetime('now','localtime') WHERE id = ?`)
    .run(c.id);
}

// 订单↔客户管理实时同步：按 电话优先 / 姓名(无电话) 关联客户主档。
// 命中：仅补充空白字段（不覆盖已维护信息）并推进成交(deal)；未发现则自动建档（下单即成交）。
// 返回客户主档 id（供 orders.customer_id 回填，使其实时出现在客户管理模块）。
export function syncCustomerFromOrder(db, { name, phone, address, ownerId }) {
  const nm = (name || '').trim();
  const ph = (phone || '').trim();
  if (!nm && !ph) return null;

  let exist = null;
  if (ph) {
    exist = db.prepare('SELECT * FROM customers WHERE phone = ?').get(ph);
  }
  if (!exist && nm) {
    exist = db.prepare("SELECT * FROM customers WHERE name = ? AND phone = ''").get(nm);
  }

  if (exist) {
    // 仅补充空白字段，不覆盖已有信息；重新下单/再次购买则激活为成交
    db.prepare(`
      UPDATE customers SET
        name = CASE WHEN name = '' THEN ? ELSE name END,
        phone = CASE WHEN phone = '' THEN ? ELSE phone END,
        address = CASE WHEN address = '' THEN ? ELSE address END,
        status = CASE WHEN status IN ('new','following','intention','lost') THEN 'deal' ELSE status END,
        updated_at = datetime('now','localtime')
      WHERE id = ?`)
      .run(nm, ph, address || '', exist.id);
    return exist.id;
  }

  // 自动建档：下单即成交
  const info = db.prepare(`
    INSERT INTO customers
      (name, phone, address, owner_id, status, level, last_followup_date, created_at, updated_at)
    VALUES (?,?,?,?, 'deal', 'C', date('now','localtime'), datetime('now','localtime'), datetime('now','localtime'))`)
    .run(nm, ph, address || '', ownerId || null);
  return info.lastInsertRowid;
}
