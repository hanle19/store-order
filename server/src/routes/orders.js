import { Router } from 'express';
import { randomBytes } from 'crypto';
import { getDb, getConfigFlag } from '../db.js';
import { authMiddleware, roleMiddleware } from '../middleware/auth.js';
import { verifyCoupon } from './coupons.js';
import { appendStoreFilter, resolveWriteStoreId } from '../utils/storeScope.js';
import { auditDelete, logAudit, TARGET_TYPES } from '../utils/audit.js';
import { buildItemPricing, calcAutoActual, reconcileCoupon } from '../services/orderPricing.js';
import { applySaleStockOut, returnSaleStockIn, resolveProductId } from '../services/orderInventory.js';
import { markCustomerDeal, syncCustomerFromOrder } from '../services/orderCustomer.js';

const router = Router();
router.use(authMiddleware);

// =============================================
// 工具函数
// =============================================

function generateOrderNo() {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, '');
  const rand = (randomBytes(4).readUInt32BE(0) % 9000) + 1000;
  return `DD${date}${rand}`;
}

function generateBatchNo() {
  const now = new Date();
  const ts = now.toISOString().replace(/[-:T.]/g, '').slice(0, 14);
  return `DL${ts}`;
}

// 订单状态流转向量（全系统唯一权威定义，推进与回退共用，避免两处数组漂移）
const ORDER_STATUS_ORDER = [
  'pending', 'deposited', 'full_paid',
  'purchasing', 'ordered',
  'arrived', 'ready',
  'balance_paid', 'special_released',
  'delivering', 'partially_delivered',
  'signed', 'completed'
];

// 推进订单状态（只能向前）
function advanceStatus(db, orderId, targetStatus) {
  const statusOrder = ORDER_STATUS_ORDER;

  const order = db.prepare('SELECT status FROM orders WHERE id = ?').get(orderId);
  if (!order) return false;

  const currentIdx = statusOrder.indexOf(order.status);
  const targetIdx = statusOrder.indexOf(targetStatus);

  if (targetIdx < 0) return false;
  if (currentIdx >= targetIdx && order.status !== targetStatus) return false; // 不能回退

  db.prepare('UPDATE orders SET status = ?, updated_at = datetime(\'now\',\'localtime\') WHERE id = ?')
    .run(targetStatus, orderId);
  return true;
}

// 写入操作日志
// 保留原位置参数签名（16 处调用不变），底层收敛到共享审计模块，避免两套 INSERT 逻辑漂移
function logOperation(db, targetType, targetId, action, operatorId, operatorName, reason, oldStatus, newStatus, details) {
  return logAudit(db, { targetType, targetId, action, operatorId, operatorName, reason, oldStatus, newStatus, details });
}

// XSS 防护：转义用户数据后再注入 HTML 模板
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// 越权防护（M1，策略 A：归属隔离）：
// - admin / boss 不受限（可操作任意订单）
// - sales 仅可操作「归属自己」的订单（order.salesperson_id === 本人 id）
// - legacy 订单 salesperson_id 为 NULL：视为仅 admin/boss 可操作，sales 返回 403
// 返回 true 表示放行；返回 false 时本函数已直接响应 403，调用方应 return。
function assertOrderOwner(req, res, order) {
  const role = req.user && req.user.role;
  if (role === 'admin' || role === 'boss') return true;
  if (order.salesperson_id == null || Number(order.salesperson_id) !== Number(req.user.id)) {
    res.status(403).json({ error: '只能操作自己负责的订单' });
    return false;
  }
  return true;
}

// 读权限校验（M1 遗留口子）：sales 角色仅可查看自己负责的订单，admin/boss 不受限
function assertOrderReadable(req, res, order) {
  const role = req.user && req.user.role;
  if (role === 'admin' || role === 'boss') return true;
  if (order.salesperson_id == null || Number(order.salesperson_id) !== Number(req.user.id)) {
    res.status(403).json({ error: '只能查看自己负责的订单' });
    return false;
  }
  return true;
}

// 根据单品状态自动计算订单状态
function syncOrderStatus(db, orderId) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order || order.status === 'cancelled' || order.status === 'completed') return;

  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId);
  if (items.length === 0) return;

  const orderItems = items.filter(i => i.product_type === 'order');
  const sampleItems = items.filter(i => i.product_type === 'sample');
  const totalItems = items.length;

  // 所有订货商品的状态
  const allOrdered = orderItems.length === 0 || orderItems.every(i =>
    ['ordered', 'merged', 'arrived', 'delivering', 'delivered', 'signed'].includes(i.item_status));
  const allArrived = items.every(i =>
    ['arrived', 'delivering', 'delivered', 'signed'].includes(i.item_status) ||
    (i.product_type === 'sample' && i.item_status === 'pending'));

  // 基于 item_status 同步状态
  const hasDelivering = items.some(i => i.item_status === 'delivering');
  const hasDelivered = items.some(i => i.item_status === 'delivered');
  const allSigned = items.every(i => i.item_status === 'signed');
  const allDeliveredOrSigned = items.every(i =>
    ['delivered', 'signed'].includes(i.item_status));

  // 部分到货
  const partialArrived = items.some(i => i.item_status === 'arrived') && !items.every(i =>
    ['arrived', 'delivering', 'delivered', 'signed'].includes(i.item_status) ||
    (i.product_type === 'sample'));

  let newStatus = order.status;

  if (['pending', 'deposited', 'full_paid'].includes(order.status)) {
    if (allOrdered && orderItems.length > 0) {
      newStatus = 'ordered';
    } else if (items.some(i => i.item_status === 'ordered' || i.item_status === 'merged')) {
      newStatus = 'purchasing';
    }
    // 纯样品/赠品订单（无订货商品），跳过订货链路，直接进入待送货状态
    else if (orderItems.length === 0 && sampleItems.length > 0) {
      newStatus = 'ready';
    }
  }

  if (['purchasing', 'ordered'].includes(order.status)) {
    // 检查是否还有待订货的单品——如果有，禁止推进到"到货"阶段
    const hasPendingOrders = orderItems.some(i => i.item_status === 'pending');
    if (allArrived && items.some(i => i.item_status === 'arrived' || i.item_status === 'delivering')) {
      newStatus = 'ready';
    } else if (!hasPendingOrders && (partialArrived || items.some(i => i.item_status === 'arrived'))) {
      newStatus = 'arrived';
    }
  }

  if (['arrived', 'ready'].includes(order.status)) {
    if (hasDelivering) {
      newStatus = items.every(i =>
        ['delivering', 'delivered', 'signed'].includes(i.item_status))
        ? 'delivering' : 'partially_delivered';
    } else if (allDeliveredOrSigned) {
      newStatus = 'signed';
    }
  }

  if (['delivering', 'partially_delivered'].includes(order.status)) {
    if (allDeliveredOrSigned) {
      newStatus = 'signed';
    }
  }

  if (newStatus !== order.status) {
    db.prepare('UPDATE orders SET status = ?, updated_at = datetime(\'now\',\'localtime\') WHERE id = ?')
      .run(newStatus, orderId);
  }
}

// =============================================
// API 端点
// =============================================

// GET / — 订单列表
router.get('/', (req, res) => {
  try {
    const db = getDb();
    const { status, customer, customer_id, salesperson_id, page = 1, page_size = 20 } = req.query;
    // 分页参数钳制：避免传入超大 page_size 一次性拉全表导致服务被打垮，同时拦截非法值
    const pageNum = Math.max(1, Number(page) || 1);
    const rawSize = Number(page_size);
    const pageSize = Math.min(200, Math.max(1, Number.isFinite(rawSize) && rawSize > 0 ? rawSize : 20));
    const conditions = [];
    const params = [];

    if (status) {
      conditions.push('o.status = ?');
      params.push(status);
    }
    if (customer_id) {
      conditions.push('o.customer_id = ?');
      params.push(Number(customer_id));
    }
    if (customer) {
      conditions.push("(o.customer_name LIKE ? OR o.customer_phone LIKE ?)");
      params.push(`%${customer}%`, `%${customer}%`);
    }
    if (salesperson_id) {
      conditions.push('o.salesperson_id = ?');
      params.push(Number(salesperson_id));
    }
    // 读越权加固（M1 遗留）：sales 角色强制只能查看自己负责的订单，admin/boss 不受限
    if (req.user.role === 'sales') {
      conditions.push('o.salesperson_id = ?');
      params.push(req.user.id);
    }

    let where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
    // 门店隔离（Phase 1）：sales 仅本店；admin/boss 受 ?store_id 限定，未传则看全部
    where = appendStoreFilter(where, params, 'o', req);
    const offset = (pageNum - 1) * pageSize;

    const total = db.prepare(`SELECT COUNT(*) as cnt FROM orders o ${where}`).get(...params).cnt;
    const data = db.prepare(`
      SELECT o.*, u.display_name as salesperson_display
      FROM orders o
      LEFT JOIN users u ON o.salesperson_id = u.id
      ${where}
      ORDER BY o.id DESC
      LIMIT ? OFFSET ?
    `).all(...params, pageSize, offset);

    // 为每个订单附带货品明细（O3：一次性 IN 查询替代逐单查询，避免 N+1）
    const ids = data.map(o => o.id);
    const placeholders = ids.map(() => '?').join(',');
    const allItems = ids.length
      ? db.prepare(`
        SELECT oi.id, oi.order_id, oi.product_name, oi.product_model, oi.spec, oi.product_type, oi.quantity, oi.unit_price, oi.total_price, oi.item_status
        FROM order_items oi
        WHERE oi.order_id IN (${placeholders})
        ORDER BY oi.id
      `).all(...ids)
      : [];
    const itemsByOrder = {};
    for (const it of allItems) {
      (itemsByOrder[it.order_id] = itemsByOrder[it.order_id] || []).push(it);
    }
    const dataWithItems = data.map(order => ({ ...order, items: itemsByOrder[order.id] || [] }));

    res.json({ total, page: pageNum, page_size: pageSize, data: dataWithItems });
  } catch (e) {
    console.error('[orders] list error:', e);
    res.status(500).json({ error: e.message });
  }
});

// GET /:id — 订单详情
router.get('/:id', (req, res) => {
  try {
    const db = getDb();
    const order = db.prepare(`
      SELECT o.*, u.display_name as salesperson_display
      FROM orders o LEFT JOIN users u ON o.salesperson_id = u.id
      WHERE o.id = ?
    `).get(req.params.id);

    if (!order) return res.status(404).json({ error: '订单不存在' });
    // 读越权加固（M1 遗留）：sales 仅可查看自己负责的订单
    if (!assertOrderReadable(req, res, order)) return;

    const items = db.prepare(`
      SELECT oi.*, p.code as product_code
      FROM order_items oi
      LEFT JOIN products p ON oi.product_id = p.id
      WHERE oi.order_id = ?
    `).all(order.id);

    const payments = db.prepare(`
      SELECT pay.*, u.display_name as operator_name
      FROM payments pay
      LEFT JOIN users u ON pay.operator_id = u.id
      WHERE pay.order_id = ?
      ORDER BY pay.created_at
    `).all(order.id);

    const deliveries = db.prepare(`
      SELECT d.*, u.display_name as operator_name
      FROM delivery_orders d
      LEFT JOIN users u ON d.operator_id = u.id
      WHERE d.order_id = ?
      ORDER BY d.created_at DESC
    `).all(order.id);

    // 关联订货单：按 purchase_orders.order_id 反查，支持销售单↔订货单双向打通
    const purchases = db.prepare(`
      SELECT po.*,
        (SELECT COALESCE(SUM(quantity),0) FROM purchase_items pi WHERE pi.purchase_id = po.id) AS total_qty,
        (SELECT COALESCE(SUM(quantity),0) FROM purchase_items pi WHERE pi.purchase_id = po.id AND pi.arrived = 1) AS arrived_qty
      FROM purchase_orders po
      WHERE po.order_id = ?
      ORDER BY po.id DESC
    `).all(order.id);
    for (const po of purchases) {
      po.items = db.prepare(
        'SELECT id, product_name, model, spec, quantity, unit_price, allocated, arrived FROM purchase_items WHERE purchase_id = ?'
      ).all(po.id);
    }

    const logs = db.prepare(`
      SELECT * FROM operation_logs
      WHERE target_type = 'order' AND target_id = ?
      ORDER BY created_at DESC
      LIMIT 50
    `).all(order.id);

    // O19 修复：订单详情为只读接口，不再写库触发状态同步。
    // 订单状态由到货/支付等写操作（arrive、syncOrderStatus）负责推进，无需在查看时改写。
    res.json({ ...order, items, payments, deliveries, logs, purchases });
  } catch (e) {
    console.error('[orders] detail error:', e);
    res.status(500).json({ error: e.message });
  }
});

// GET /:id/contract — 销售合同
router.get('/:id/contract', (req, res) => {
  try {
    const db = getDb();
    const order = db.prepare(`
      SELECT o.*, u.display_name as salesperson_display, u.phone as salesperson_user_phone
      FROM orders o LEFT JOIN users u ON o.salesperson_id = u.id
      WHERE o.id = ?
    `).get(req.params.id);

    if (!order) return res.status(404).json({ error: '订单不存在' });
    if (!assertOrderReadable(req, res, order)) return;

    const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);

    // XSS 防护：对用户录入字段做 HTML 转义（金额/单号等系统字段不改）
    const esc = escapeHtml;
    for (const k of ['customer_name', 'customer_phone', 'customer_address',
      'salesperson_name', 'salesperson_phone', 'salesperson_user_phone', 'salesperson_display',
      'note', 'brand_name']) {
      if (order[k] != null) order[k] = esc(order[k]);
    }
    items.forEach(it => {
      for (const k of ['product_name', 'product_model', 'spec', 'note']) {
        if (it[k] != null) it[k] = esc(it[k]);
      }
    });

    // 获取系统配置
    const configRows = db.prepare('SELECT key, value FROM system_config').all();
    const config = {};
    for (const row of configRows) {
      config[row.key] = row.value;
    }

    const storeName = config.store_name || '我的门店';
    const storeAddress = config.store_address || '';
    const storePhone = config.store_phone || '';
    const contractTerms = (config.contract_terms || '').trim();

    // 导购电话：优先 orders 表中的 salesperson_phone，其次 users 表 phone
    const salesPhone = order.salesperson_phone || order.salesperson_user_phone || '';

    // 订单备注
    const orderNote = (order.note || '').trim();

    const digitMap = ['零', '壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖'];
    const unitMap = ['', '拾', '佰', '仟', '万'];
    function toChinese(num) {
      if (num == null || isNaN(num) || num <= 0) return '零元整';
      const digit = ['零', '壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖'];
      const smallUnit = ['', '拾', '佰', '仟'];
      const bigUnit = ['', '万', '亿', '兆'];
      let n = Math.floor(num);
      const s = n.toString();
      let result = '';
      let zeroPending = false;
      let started = false;
      let prevGroup = -1;
      const groupHadNonZero = [];
      for (let i = 0; i < s.length; i++) {
        const d = +s[i];
        const pos = s.length - 1 - i;
        const group = Math.floor(pos / 4);
        if (group !== prevGroup) {
          if (prevGroup >= 0 && groupHadNonZero[prevGroup]) result += bigUnit[prevGroup];
          prevGroup = group;
        }
        if (d === 0) {
          zeroPending = true;
        } else {
          if (zeroPending && started) result += '零';
          result += digit[d] + smallUnit[pos % 4];
          zeroPending = false;
          started = true;
          groupHadNonZero[group] = true;
        }
      }
      if (prevGroup >= 0 && groupHadNonZero[prevGroup]) result += bigUnit[prevGroup];
      return result + '元整';
    }

    const itemsTotal = items.reduce((s, i) => s + i.total_price, 0);
    const discount = order.discount || 0;
    const chinese = toChinese(order.actual_amount || order.total_amount);

    // 状态映射为中文
    const statusLabel = ({
      completed: '已完成', cancelled: '已取消', signed: '已签收',
      pending: '待付定金', deposited: '已付定金', full_paid: '已付全款',
      purchasing: '订货中', ordered: '已订货', arrived: '部分到货',
      ready: '齐货待收', balance_paid: '尾款结清', special_released: '视同结清',
      delivering: '配送中', partially_delivered: '分批配送',
    })[order.status] || order.status;

    // 协议条款按行解析（支持 **加粗** 标记）。先转义文本，避免存储型 XSS
    const termsHtml = (contractTerms || '').split('\n').filter(t => t.trim()).map(t => {
        let line = esc(t.trim())
          .replace(/^(\d+)[\.\、\s]+/, '<span class="term-num">$1.</span>')
          .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        return `<p>${line}</p>`;
      }).join('');

    res.send(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>销售合同 - ${order.order_no}</title>
<style>
/* ===== 全局规范 ===== */
*{margin:0;padding:0;box-sizing:border-box}
body{
  font-family:"Microsoft YaHei","SimHei","PingFang SC",sans-serif;
  font-size:13px;
  color:#2C2C2C;
  background:#E8E5E0;
  line-height:1.6;
}
.page{
  width:210mm;
  min-height:297mm;
  margin:0 auto;
  background:#fff;
  padding:36px 80px 60px;
  position:relative;
}
/* 品牌色 */
.brd{color:#8B7355}

/* ===== 头部标题区 ===== */
.header-title{
  text-align:center;
  margin-bottom:0;
}
.header-title h1{
  font-family:"SimSun","Source Han Serif SC","Noto Serif SC",serif;
  font-size:26px;
  font-weight:700;
  letter-spacing:4px;
  color:#1A1A1A;
  margin:0;
}
.header-line{
  width:100%;
  height:2px;
  background:#8B7355;
  margin:12px 0 16px;
}
.header-meta{
  display:flex;
  justify-content:space-between;
  align-items:center;
  font-size:12px;
  color:#888;
  margin-bottom:20px;
}

/* ===== 客户信息栏 ===== */
.info-table{
  width:100%;
  border-collapse:collapse;
  margin-bottom:16px;
}
.info-table td{
  padding:8px 12px;
  font-size:13px;
  border-bottom:1px solid #E8E5E0;
  vertical-align:middle;
}
.info-table .label{
  width:88px;
  text-align:right;
  color:#666;
  background:#FAF8F5;
  font-weight:500;
}
.info-table .val{
  text-align:left;
  color:#2C2C2C;
  padding-left:16px;
}

/* ===== 备注区 ===== */
.note-section{
  margin-bottom:16px;
  padding:10px 14px;
  background:#FAFAF8;
  border-left:3px solid #8B7355;
  font-size:12px;
  color:#555;
  line-height:1.7;
}
.note-label{
  font-weight:600;
  color:#5D4E37;
  margin-bottom:4px;
}

/* ===== 商品明细表 ===== */
.items-table{
  width:100%;
  border-collapse:collapse;
  margin-bottom:0;
}
.items-table th{
  background:#F5F0EB;
  color:#5D4E37;
  font-size:12px;
  font-weight:600;
  padding:10px 8px;
  text-align:center;
  border-bottom:2px solid #D4C8B8;
}
.items-table td{
  padding:8px 8px;
  font-size:12px;
  border-bottom:1px solid #EEE8E0;
  vertical-align:middle;
}
.items-table tr:nth-child(even) td{
  background:#FAFAF8;
}
.items-table .num{text-align:right;font-variant-numeric:tabular-nums}
.items-table .txt{text-align:left}

/* ===== 合同总价区 ===== */
.total-section{
  margin-top:14px;
  padding-top:12px;
  border-top:1px solid #D4C8B8;
  text-align:right;
}
.total-discount{
  font-size:12px;
  color:#888;
  margin-bottom:6px;
}
.total-main{
  display:flex;
  justify-content:flex-end;
  align-items:baseline;
  gap:8px;
}
.total-label{
  font-size:14px;
  font-weight:600;
  color:#2C2C2C;
}
.total-chinese{
  font-size:16px;
  font-weight:700;
  color:#8B7355;
}
.total-number{
  font-size:13px;
  color:#888;
}

/* ===== 协议条款区 ===== */
.terms-section{
  margin-top:20px;
}
.terms-head{
  display:flex;
  align-items:center;
  gap:10px;
  margin-bottom:10px;
}
.terms-bar{
  width:3px;
  height:16px;
  background:#8B7355;
}
.terms-head h3{
  font-size:14px;
  font-weight:700;
  color:#1A1A1A;
  margin:0;
}
.terms-body{
  font-size:12px;
  color:#444;
  line-height:1.5;
}
.terms-body p{
  margin-bottom:2px;
  padding-left:0;
}
.term-num{
  font-weight:600;
  color:#8B7355;
  margin-right:4px;
}
.terms-body strong{
  color:#6B4F3A;
}

/* ===== 底部落款 ===== */
.sign-section{
  display:flex;
  justify-content:space-between;
  margin-top:28px;
  padding-top:0;
}
.sign-block{
  width:45%;
}
.sign-label{
  font-size:13px;
  font-weight:600;
  color:#2C2C2C;
  margin-bottom:4px;
}
.sign-line{
  border-bottom:1px solid #999;
  margin-top:20px;
  height:0;
}
.sign-sub{
  font-size:11px;
  color:#888;
  margin-top:4px;
}

/* ===== 页脚 ===== */
.footer{
  text-align:center;
  margin-top:8px;
  font-size:11px;
  color:#B0B0B0;
  line-height:1.6;
}

/* ===== 打印 / 自适应 ===== */
@media print{
  body{background:#fff}
  .page{box-shadow:none;margin:0;padding:28px 56px 48px;transform:none!important;max-height:none}
  @page{size:A4;margin:0}
}
/* 屏幕自适应：内容过多时缩小至一屏显示 */
@media screen{
  .page{transform-origin:top center}
}
</style>
</head>
<body>
<div class="page" id="contract">

<!-- 头部 -->
<div class="header-title">
  <h1>${storeName} 销售合同</h1>
  <div class="header-line"></div>
</div>
<div class="header-meta">
  <span>合同编号: ${order.order_no}</span>
  <span>日期: ${order.created_at ? order.created_at.slice(0,10) : ''}</span>
</div>

<!-- 客户信息 -->
<table class="info-table">
<tr>
  <td class="label">客户姓名</td><td class="val">${order.customer_name}</td>
  <td class="label">联系电话</td><td class="val">${order.customer_phone || '-'}</td>
</tr>
<tr>
  <td class="label">客户地址</td><td class="val" colspan="3">${order.customer_address || '-'}</td>
</tr>
<tr>
  <td class="label">支付方式</td><td class="val">${order.payment_method === 'full' ? '全款' : '定金'}</td>
  <td class="label">送货日期</td><td class="val">${order.delivery_date || '待定'}</td>
</tr>
<tr>
  <td class="label">导购</td><td class="val">${order.salesperson_name || order.salesperson_display || '-'}${salesPhone ? ' / ' + salesPhone : ''}</td>
  <td class="label">订单状态</td><td class="val">${statusLabel}</td>
</tr>
</table>

<!-- 备注 -->
${orderNote ? `<div class="note-section">
  <div class="note-label">备注</div>
  <div>${orderNote.replace(/\n/g, '<br>')}</div>
</div>` : ''}

<!-- 商品明细 -->
<table class="items-table">
<thead>
<tr>
  <th style="width:36px">序号</th>
  <th class="txt" style="width:auto">商品名称</th>
  <th style="width:80px">型号</th>
  <th style="width:72px">规格</th>
  <th style="width:52px">类型</th>
  <th class="num" style="width:48px">数量</th>
  <th class="num" style="width:76px">单价</th>
  <th class="num" style="width:76px">小计</th>
</tr>
</thead>
<tbody>
${items.map((it,i) => `<tr>
  <td style="text-align:center">${i+1}</td>
  <td class="txt">${it.product_name}</td>
  <td style="text-align:center">${it.product_model || '-'}</td>
  <td style="text-align:center">${it.spec || '-'}</td>
  <td style="text-align:center">${it.product_type === 'sample' ? '样品' : it.product_type === 'gift' ? '赠品' : '订货'}</td>
  <td class="num">${it.quantity}</td>
  <td class="num">¥${it.unit_price.toFixed(2)}</td>
  <td class="num">¥${it.total_price.toFixed(2)}</td>
</tr>`).join('')}
</tbody>
</table>

<!-- 合同总价 -->
<div class="total-section">
<div class="total-discount">商品合计: ¥${itemsTotal.toFixed(2)}${discount > 0 ? ` &nbsp; 折扣: -¥${discount.toFixed(2)}` : ''}${Number(order.coupon_discount) > 0 ? ` &nbsp; 门店券核减(${escapeHtml(order.coupon_code || '')}): -¥${Number(order.coupon_discount).toFixed(2)}` : ''}${Number(order.external_coupon_amount) > 0 ? ` &nbsp; 平台券核销: -¥${Number(order.external_coupon_amount).toFixed(2)}` : ''}</div>
<div class="total-main">
  <span class="total-label">合同总价（实收）</span>
  <span class="total-chinese">${chinese}</span>
  <span class="total-number">( ¥${(order.actual_amount || order.total_amount).toFixed(2)} )</span>
</div>
</div>

<!-- 协议条款 -->
<div class="terms-section">
<div class="terms-head">
  <div class="terms-bar"></div>
  <h3>协议条款</h3>
</div>
<div class="terms-body">
${termsHtml}
</div>
</div>

<!-- 落款 -->
<div class="sign-section">
<div class="sign-block">
  <div class="sign-label">甲方（客户）:</div>
  <div class="sign-line"></div>
  <div class="sign-sub">签字 / 签章</div>
</div>
<div class="sign-block">
  <div class="sign-label">乙方（${storeName}）:</div>
  <div class="sign-line"></div>
  <div class="sign-sub">盖章</div>
</div>
</div>

<!-- 页脚 -->
<div class="footer">
${storeAddress ? storeAddress : ''}${storePhone ? ' · 电话: ' + storePhone : ''}
</div>

</div>
<script>
(function(){
  var page=document.getElementById('contract');
  var pageWidth=page.offsetWidth;
  var pageHeight=page.offsetHeight;
  var availW=window.innerWidth-20;
  var availH=window.innerHeight-20;
  var wScale=availW/pageWidth;
  var hScale=availH/pageHeight;
  var scale=Math.min(wScale,hScale,1);
  page.style.transform='scale('+scale+')';
  page.style.transformOrigin='top center';
  page.style.marginBottom=(scale<1 ? (pageHeight*(scale-1))+'px' : '0');
})();
</script>
</body></html>`);
  } catch (e) {
    console.error('[orders] contract error:', e);
    res.status(500).json({ error: e.message });
  }
});

// =============================================
// POST / — 创建订单（节点一：客户选品开单）
// =============================================
router.post('/', (req, res) => {
  try {
    const db = getDb();
    const {
      customer_name, customer_phone, customer_address, customer_id,
      items, payment_method, deposit_amount,
      salesperson_id, salesperson_name, salesperson_phone,
      delivery_date, note, discount, actual_amount,
      coupon_code, external_coupon_amount, amount_manual
    } = req.body;

    if (!customer_name) return res.status(400).json({ error: '客户姓名不能为空' });
    if (!items || items.length === 0) return res.status(400).json({ error: '至少需要一件商品' });

    // 归属：导购只能把订单挂到自己名下；经理/管理员可指定归属导购（提前计算，供客户建档归属复用）
    let resolvedSalesId = salesperson_id != null ? Number(salesperson_id) : null;
    let resolvedSalesName = salesperson_name || '';
    let resolvedSalesPhone = salesperson_phone || '';
    if (req.user.role === 'sales') {
      resolvedSalesId = req.user.id;
      resolvedSalesName = req.user.display_name || resolvedSalesName;
      resolvedSalesPhone = req.user.phone || resolvedSalesPhone;
    }

    // 关联/建档客户主档：实时同步到「客户管理」模块
    let custId = customer_id ? Number(customer_id) : null;
    let resolvedName = customer_name || '';
    let resolvedPhone = customer_phone || '';
    if (custId) {
      // 已关联客户主档：仅回填空白姓名/电话
      const cust = db.prepare('SELECT id, name, phone FROM customers WHERE id = ?').get(custId);
      if (cust) {
        if (!resolvedName) resolvedName = cust.name;
        if (!resolvedPhone) resolvedPhone = cust.phone;
      }
    } else if (resolvedName || resolvedPhone) {
      // 未指定客户主档：按 姓名/电话 自动建档或关联，使客户管理实时可见该客户
      custId = syncCustomerFromOrder(db, {
        name: resolvedName, phone: resolvedPhone,
        address: customer_address || '', ownerId: resolvedSalesId,
      });
    }

    // 后台手填订单可能未带 product_id：按 商品名(+规格) 反查回填，确保库存核减与价格同步生效
    for (const it of items) resolveProductId(db, it);

    const orderNo = generateOrderNo();
    // 逐商品计价快照：到手价(核减后,不含整单券) / 进价 / 保本价；并汇总到手价基数
    let itemsBase = 0;
    const itemPricings = [];
    for (const it of items) {
      const pr = buildItemPricing(db, it);
      const rawQty = Number(it.quantity);
      if (!Number.isFinite(rawQty) || rawQty <= 0) {
        throw new Error(`商品「${it.product_name || it.product_id || '未知'}」的数量必须为正数`);
      }
      itemPricings.push({ it, pr, qty: rawQty });
      itemsBase += pr.finalPrice * rawQty;
    }
    const disc = Number(discount) || 0;
    const totalAmt = Math.max(0, itemsBase - disc);
    const isFull = payment_method === 'full';

    // 只读核销：先算出券减额与"自动核减后的应收"（供下方 INSERT 使用，必须在事务外先算）
    // 平台券是否核减取决于系统开关 external_coupon_reduce；开关关闭时存 0，保证 stored 字段与实收口径一致（治账实不符）
    const extCoupon = getConfigFlag(db, 'external_coupon_reduce') ? (Number(external_coupon_amount) || 0) : 0;
    const productIds = (items || []).map(i => i.product_id).filter(Boolean).map(Number);
    let couponCode = '';
    let couponDiscount = 0;
    let promoApplied = 0;
    const rawCoupon = String(coupon_code || '').trim().toUpperCase();
    if (rawCoupon) {
      const vr = verifyCoupon(db, rawCoupon, totalAmt, productIds);
      if (vr.valid) { couponCode = rawCoupon; couponDiscount = vr.discount_amount; promoApplied = 1; }
    }
    // 治本：自动核减后的收款额；保留人工修改权——若前端标记 amount_manual，则以手改值为准计入财务
    const autoActual = calcAutoActual(db, { itemsBase, discount: disc, couponDiscount, externalCouponAmount: extCoupon });
    let actualAmt;
    if (amount_manual === true) {
      actualAmt = Number(actual_amount) || autoActual;
    } else if (amount_manual === false) {
      actualAmt = autoActual;
    } else {
      // 兼容旧前端（未传 amount_manual）：沿用其传入值，无券时与自动核减等价
      actualAmt = Number(actual_amount) || totalAmt;
    }
    const isAmountManual = amount_manual === true ? 1 : 0;

    const deposit = isFull ? actualAmt : (Number(deposit_amount) || 0);
    const balance = isFull ? 0 : (actualAmt - deposit);

    const initialStatus = isFull ? 'full_paid' : 'pending';
    const tailStatus = isFull ? 'pending' : 'pending'; // 全款无需尾款

    const result = db.transaction(() => {
      const r = db.prepare(`INSERT INTO orders
        (order_no, customer_name, customer_phone, customer_address,
         total_amount, deposit_amount, balance_amount, discount, actual_amount,
         status, payment_method, order_category, tail_payment_status, delivery_mode,
         salesperson_id, salesperson_name, salesperson_phone, delivery_date, note, customer_id, amount_manual, store_id)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(orderNo, resolvedName, resolvedPhone || '', customer_address || '',
          totalAmt, deposit, balance, disc, actualAmt,
          initialStatus, payment_method || 'deposit', 'order', tailStatus, 'full',
          resolvedSalesId, resolvedSalesName, resolvedSalesPhone,
          delivery_date || null, note || '', custId, isAmountManual, resolveWriteStoreId(req));

      const orderId = r.lastInsertRowid;

      // 券核销入账：used_qty 仅在此处 +1（避免编辑重复计数）；券字段写入（actual_amount/amount_manual 已由 INSERT 写入）
      if (couponCode) {
        db.prepare('UPDATE coupons SET used_qty = used_qty + 1 WHERE code = ?').run(couponCode);
      }
      db.prepare(`UPDATE orders SET coupon_code = ?, coupon_discount = ?, external_coupon_amount = ?, promo_applied = ? WHERE id = ?`)
        .run(couponCode, couponDiscount, extCoupon, promoApplied, orderId);
      if (couponCode) {
        db.prepare('INSERT INTO coupon_usages (coupon_code, order_id, customer_id, discount_amount) VALUES (?,?,?,?)')
          .run(couponCode, orderId, custId || null, couponDiscount);
      }

      // 创建订单明细（落逐商品到手价/保本价/进价快照，供财务整单核算与逐商品亏损判定）
      // prepared statement 提到循环外：避免 N 条明细重复编译同一条 SQL
      const insertOrderItem = db.prepare(`INSERT INTO order_items
        (order_id, product_id, product_name, product_model, product_type, spec, quantity, unit_price, total_price, item_status, final_price, break_even_price, cost_price)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
      for (const { it, pr, qty } of itemPricings) {
        const itemType = it.product_type || 'order';
        // 单价与到手价/小计一致：以后端权威价（规格级）为准，避免合同"单价"与"小计"对不上
        const uprice = pr.finalPrice;
        const tprice = pr.finalPrice * qty;

        insertOrderItem
          .run(orderId, it.product_id || null, it.product_name || '', it.product_model || '',
            itemType, it.spec || '', qty, uprice, tprice, 'pending',
            pr.finalPrice, pr.breakEven, pr.costPrice);
      }

      // 成交出库：仅样品/赠品扣减库存；订货类不核减库存（在途由销售订单派生，见 inventory/products）
      // 经 adjustStock + adjustVariantStock 收口，保证商品主库存与各规格库存实时同步
      for (const { it, qty } of itemPricings) {
        if (!it.product_id) continue;
        const t = it.product_type || 'order';
        if (t === 'order') continue; // 订货不核减库存
        applySaleStockOut(db, it, qty, orderId, req.user.id);
      }

      // 全款支付自动记录
      if (isFull) {
        db.prepare('INSERT INTO payments (order_id, amount, payment_type, payment_method, note, operator_id) VALUES (?,?,?,?,?,?)')
          .run(orderId, actualAmt, 'full', payment_method || '全款', '开单全款支付', req.user.id);
      }

      logOperation(db, 'order', orderId, 'create', req.user.id, req.user.display_name,
        '', '', initialStatus, { customer_name, items_count: items.length, payment_method });

      // 客户↔订单打通：开单即把关联客户标记为已成交
      markCustomerDeal(db, custId);

      return db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    })();

    res.status(201).json({ message: '下单成功', order: result });
  } catch (e) {
    console.error('[orders] create error:', e);
    res.status(400).json({ error: e.message });
  }
});

// POST /:id/pay-deposit — 支付定金
router.post('/:id/pay-deposit', (req, res) => {
  try {
    const db = getDb();
    const { amount, payment_method, note } = req.body;
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
    if (!order) return res.status(404).json({ error: '订单不存在' });
    if (!assertOrderOwner(req, res, order)) return;

    const payAmt = Number(amount) || 0;
    if (payAmt <= 0) return res.status(400).json({ error: '支付金额必须大于0' });

    const result = db.transaction(() => {
      const newDeposit = order.deposit_amount + payAmt;
      const newBalance = Math.max(0, (order.actual_amount || order.total_amount) - newDeposit);

      db.prepare('INSERT INTO payments (order_id, amount, payment_type, payment_method, note, operator_id) VALUES (?,?,?,?,?,?)')
        .run(order.id, payAmt, 'deposit', payment_method || '现金', note || '', req.user.id);

      const updStatus = order.status === 'pending' ? 'deposited' : order.status;
      db.prepare('UPDATE orders SET deposit_amount = ?, balance_amount = ?, status = ?, updated_at = datetime(\'now\',\'localtime\') WHERE id = ?')
        .run(newDeposit, newBalance, updStatus, order.id);

      logOperation(db, 'order', order.id, 'pay_deposit', req.user.id, req.user.display_name,
        '', order.status, updStatus, { amount: payAmt, payment_method });

      return db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id);
    })();

    res.json({ message: '定金支付成功', order: result });
  } catch (e) {
    console.error('[orders] pay-deposit error:', e);
    res.status(500).json({ error: e.message });
  }
});

// =============================================
// POST /:id/start-purchase — 单品维度精细化订货（节点二）
// 支持四种场景：单品独立/跨单合并/常规厂家/样品补货
// =============================================
router.post('/:id/start-purchase', (req, res) => {
  try {
    const db = getDb();
    const orderId = req.params.id;
    const { items, arrival_warehouse, purchase_type, merge_group, payment_voucher } = req.body;

    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    if (!order) return res.status(404).json({ error: '订单不存在' });
    if (!assertOrderOwner(req, res, order)) return;
    if (order.status === 'cancelled' || order.status === 'completed') {
      return res.status(400).json({ error: '已取消/已完成的订单不能操作' });
    }

    if (!items || items.length === 0) {
      // 无进货项：仅推进状态
      if (['pending', 'deposited', 'full_paid'].includes(order.status)) {
        advanceStatus(db, orderId, 'purchasing');
      }
      return res.json({ message: '状态已推进', status: 'purchasing' });
    }

    const pt = purchase_type || 'order'; // 'order' | 'restock'

    const result = db.transaction(() => {
      const poNo = 'PO' + new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
      const poStoreId = db.prepare('SELECT store_id FROM orders WHERE id = ?').get(orderId)?.store_id || 1;
      const poResult = db.prepare(`INSERT INTO purchase_orders
        (po_no, supplier, status, total_amount, purchase_type, order_id, arrival_warehouse, note, operator_id, payment_voucher, store_id)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
        .run(poNo, '', 'ordered', 0, pt, pt === 'order' ? orderId : null,
          arrival_warehouse || '', '', req.user.id, payment_voucher || '', poStoreId);

      const poId = poResult.lastInsertRowid;
      let poTotal = 0;

      // prepared statement 提到循环外：避免 N 条明细重复编译同一条 SQL
      const insertPurchaseItem = db.prepare(`INSERT INTO purchase_items
        (purchase_id, product_id, product_name, brand, model, spec, quantity, unit_price, total_price, note, remain_quantity)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
      for (const item of items) {
        const rawQty = Number(item.quantity);
        if (!Number.isFinite(rawQty) || rawQty <= 0) {
          throw new Error(`进货项「${item.product_name || item.product_id || '未知'}」的数量必须为正数`);
        }
        const uprice = Number(item.unit_price) || 0;
        const tprice = uprice * rawQty;
        poTotal += tprice;

        insertPurchaseItem
          .run(poId, item.product_id || null, item.product_name || '',
            item.brand || '', item.model || '', item.spec || '',
            rawQty, uprice, tprice, item.note || '', rawQty);

        // 同步进货单价到订单项（财务核算利润以 order_items.cost_price 为准，不再写入商品进价）
        const orderItemId = item.order_item_id;
        if (orderItemId && uprice > 0) {
          db.prepare('UPDATE order_items SET cost_price = ? WHERE id = ? AND order_id = ?')
            .run(uprice, orderItemId, orderId);
        }

        // 更新订单明细状态
        if (orderItemId) {
          const newItemStatus = merge_group && merge_group !== '' ? 'merged' : 'ordered';
          db.prepare('UPDATE order_items SET item_status = ?, merge_group = ? WHERE id = ? AND order_id = ?')
            .run(newItemStatus, merge_group || '', orderItemId, orderId);
        }
      }

      // 更新进货单总金额
      db.prepare('UPDATE purchase_orders SET total_amount = ? WHERE id = ?').run(poTotal, poId);

      // 推进订单状态
      if (['pending', 'deposited', 'full_paid'].includes(order.status)) {
        advanceStatus(db, orderId, 'purchasing');
      }

      // 检查是否所有订货项都已订货
      const orderItems = db.prepare("SELECT * FROM order_items WHERE order_id = ? AND product_type = 'order'").all(orderId);
      const allOrdered = orderItems.every(oi =>
        ['ordered', 'merged', 'arrived'].includes(oi.item_status));
      if (allOrdered && orderItems.length > 0) {
        advanceStatus(db, orderId, 'ordered');
      }

      syncOrderStatus(db, orderId);

      logOperation(db, 'order', orderId, 'start_purchase', req.user.id, req.user.display_name,
        '', order.status, 'purchasing', { po_no: poNo, items_count: items.length, purchase_type: pt, merge_group });

      const updated = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
      return { order: updated, po_no: poNo, purchase_id: poId };
    })();

    res.json({ message: '订货单已创建', ...result });
  } catch (e) {
    console.error('[orders] start-purchase error:', e);
    res.status(500).json({ error: e.message });
  }
});

// =============================================
// POST /:id/arrive — 到货录入+智能匹配+手动分配（节点三）
// =============================================
router.post('/:id/arrive', (req, res) => {
  try {
    const db = getDb();
    const orderId = req.params.id;
    const { allocations, balance_payment, payment_method, note } = req.body;

    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    if (!order) return res.status(404).json({ error: '订单不存在' });
    if (!assertOrderOwner(req, res, order)) return;

    const result = db.transaction(() => {
      // 处理分配
      if (allocations && allocations.length > 0) {
        for (const alloc of allocations) {
          const orderItemId = alloc.order_item_id;
          const purchaseItemId = alloc.purchase_item_id;
          const qty = Number(alloc.quantity) || 0;

          if (qty <= 0) continue;

          // 检查进货项剩余
          const pItem = db.prepare('SELECT * FROM purchase_items WHERE id = ?').get(purchaseItemId);
          if (!pItem) continue;
          const remaining = pItem.remain_quantity || (pItem.quantity - pItem.allocated);
          if (remaining < qty) throw new Error(`进货项"${pItem.product_name}"可分配数量不足(剩余:${remaining})`);

          // 检查订单项
          const oItem = db.prepare('SELECT * FROM order_items WHERE id = ? AND order_id = ?').get(orderItemId, orderId);
          if (!oItem) continue;
          const oRemaining = oItem.quantity - oItem.allocated;
          if (oRemaining < qty) throw new Error(`订单项"${oItem.product_name}"待分配数量不足`);

          // 创建分配记录
          db.prepare('INSERT INTO allocations (purchase_item_id, order_item_id, quantity, operator_id) VALUES (?,?,?,?)')
            .run(purchaseItemId, orderItemId, qty, req.user.id);

          // 更新进货项已分配
          const newAlloc = pItem.allocated + qty;
          const newRemain = Math.max(0, (pItem.remain_quantity || pItem.quantity) - qty);
          db.prepare('UPDATE purchase_items SET allocated = ?, remain_quantity = ? WHERE id = ?')
            .run(newAlloc, newRemain, purchaseItemId);

          // 标记进货项到货
          const isFullyAllocated = newAlloc >= pItem.quantity;
          db.prepare('UPDATE purchase_items SET arrived = ?, arrived_warehouse = ? WHERE id = ?')
            .run(isFullyAllocated ? 1 : pItem.arrived, alloc.warehouse || pItem.arrived_warehouse || '', purchaseItemId);

          // 更新订单项已分配
          const oNewAlloc = oItem.allocated + qty;
          const isArrived = oNewAlloc >= oItem.quantity;
          db.prepare('UPDATE order_items SET allocated = ?, item_status = ?, warehouse = ? WHERE id = ?')
            .run(oNewAlloc, isArrived ? 'arrived' : oItem.item_status, alloc.warehouse || '', orderItemId);

          // 全部到货时推进进货单状态
          if (isFullyAllocated) {
            const poAllArrived = db.prepare(`
              SELECT COUNT(*) as total, SUM(CASE WHEN allocated >= quantity THEN 1 ELSE 0 END) as arrived_count
              FROM purchase_items WHERE purchase_id = ?
            `).get(pItem.purchase_id);
            if (poAllArrived.total === poAllArrived.arrived_count) {
              db.prepare("UPDATE purchase_orders SET status = 'arrived', updated_at = datetime('now','localtime') WHERE id = ?")
                .run(pItem.purchase_id);
            }
          }
        }
      }

      // 处理尾款
      const balPay = Number(balance_payment) || 0;
      if (balPay > 0) {
        db.prepare('INSERT INTO payments (order_id, amount, payment_type, payment_method, note, operator_id) VALUES (?,?,?,?,?,?)')
          .run(orderId, balPay, 'balance', payment_method || '现金', note || '', req.user.id);

        const newBalance = Math.max(0, order.balance_amount - balPay);
        db.prepare('UPDATE orders SET balance_amount = ?, updated_at = datetime(\'now\',\'localtime\') WHERE id = ?')
          .run(newBalance, orderId);

        if (newBalance <= 0 && order.payment_method !== 'full') {
          advanceStatus(db, orderId, 'balance_paid');
        }
      }

      // 同步订单状态
      syncOrderStatus(db, orderId);

      // 全款订单自动解锁
      if (order.payment_method === 'full' && ['arrived', 'ready'].includes(
        db.prepare('SELECT status FROM orders WHERE id = ?').get(orderId).status
      )) {
        advanceStatus(db, orderId, 'ready');
      }

      logOperation(db, 'order', orderId, 'arrive', req.user.id, req.user.display_name,
        '', order.status, db.prepare('SELECT status FROM orders WHERE id = ?').get(orderId).status,
        { allocations_count: allocations ? allocations.length : 0, balance_payment: balPay });

      return db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    })();

    res.json({ message: '到货处理完成', order: result });
  } catch (e) {
    console.error('[orders] arrive error:', e);
    res.status(500).json({ error: e.message });
  }
});

// POST /:id/pay-balance — 收尾款
router.post('/:id/pay-balance', (req, res) => {
  try {
    const db = getDb();
    const { amount, payment_method, note } = req.body;
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
    if (!order) return res.status(404).json({ error: '订单不存在' });
    if (!assertOrderOwner(req, res, order)) return;

    const payAmt = Number(amount) || 0;
    if (payAmt <= 0) return res.status(400).json({ error: '支付金额必须大于0' });

    const result = db.transaction(() => {
      db.prepare('INSERT INTO payments (order_id, amount, payment_type, payment_method, note, operator_id) VALUES (?,?,?,?,?,?)')
        .run(order.id, payAmt, 'balance', payment_method || '现金', note || '', req.user.id);

      const newBalance = Math.max(0, order.balance_amount - payAmt);
      db.prepare('UPDATE orders SET balance_amount = ?, updated_at = datetime(\'now\',\'localtime\') WHERE id = ?')
        .run(newBalance, order.id);

      if (newBalance <= 0) {
        advanceStatus(db, order.id, 'balance_paid');
      }

      logOperation(db, 'order', order.id, 'pay_balance', req.user.id, req.user.display_name,
        '', order.status, newBalance <= 0 ? 'balance_paid' : order.status, { amount: payAmt });

      return db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id);
    })();

    res.json({ message: '尾款收取成功', order: result });
  } catch (e) {
    console.error('[orders] pay-balance error:', e);
    res.status(500).json({ error: e.message });
  }
});

// POST /:id/special-release — 特殊尾款放行（店长操作）
router.post('/:id/special-release', roleMiddleware('admin'), (req, res) => {
  try {
    const db = getDb();
    const { reason } = req.body;
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
    if (!order) return res.status(404).json({ error: '订单不存在' });

    if (order.payment_method === 'full') {
      return res.status(400).json({ error: '全款订单无需特殊放行' });
    }
    if (order.tail_payment_status === 'confirmed') {
      return res.status(400).json({ error: '尾款已实收确认，无需放行' });
    }

    const result = db.transaction(() => {
      db.prepare(`UPDATE orders SET
        tail_payment_status = 'released',
        special_release_by = ?,
        special_release_at = datetime('now','localtime'),
        status = 'special_released',
        updated_at = datetime('now','localtime')
        WHERE id = ?`).run(req.user.id, order.id);

      logOperation(db, 'order', order.id, 'special_release', req.user.id, req.user.display_name,
        reason || '', order.status, 'special_released', {});

      return db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id);
    })();

    res.json({ message: '已标记为视同尾款已付，可提前送货', order: result });
  } catch (e) {
    console.error('[orders] special-release error:', e);
    res.status(500).json({ error: e.message });
  }
});

// POST /:id/confirm-tail — 确认尾款实收（闭环）
router.post('/:id/confirm-tail', (req, res) => {
  try {
    const db = getDb();
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
    if (!order) return res.status(404).json({ error: '订单不存在' });
    if (!assertOrderOwner(req, res, order)) return;

    if (order.tail_payment_status === 'confirmed') {
      return res.status(400).json({ error: '尾款已确认实收' });
    }

    const result = db.transaction(() => {
      db.prepare(`UPDATE orders SET
        tail_payment_status = 'confirmed',
        balance_amount = 0,
        updated_at = datetime('now','localtime')
        WHERE id = ?`).run(order.id);

      logOperation(db, 'order', order.id, 'confirm_tail', req.user.id, req.user.display_name,
        '', 'special_released', order.status, {});

      return db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id);
    })();

    res.json({ message: '尾款实收已确认，订单款项闭环', order: result });
  } catch (e) {
    console.error('[orders] confirm-tail error:', e);
    res.status(500).json({ error: e.message });
  }
});

// =============================================
// POST /:id/deliver — 送货（整单/分批）（节点五）
// =============================================
router.post('/:id/deliver', (req, res) => {
  try {
    const db = getDb();
    const orderId = req.params.id;
    const {
      delivery_type, delivery_date, delivery_person, delivery_phone,
      item_ids, note
    } = req.body;

    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    if (!order) return res.status(404).json({ error: '订单不存在' });
    if (!assertOrderOwner(req, res, order)) return;

    // 检查尾款状态
    if (order.payment_method !== 'full' && order.tail_payment_status === 'pending') {
      if (!['balance_paid', 'special_released'].includes(order.status)) {
        return res.status(400).json({ error: '请先结清尾款或申请特殊放行后再送货' });
      }
    }

    const dt = delivery_type || 'full';
    const targetItemIds = item_ids || [];

    const result = db.transaction(() => {
      // 获取可配送商品（已到货的订货商品 + 样品/赠品 pending 状态）
      const availableItems = db.prepare(`
        SELECT oi.* FROM order_items oi
        WHERE oi.order_id = ? AND (
          oi.item_status IN ('arrived', 'delivering', 'delivered')
          OR (oi.product_type = 'sample' AND oi.item_status = 'pending')
          OR (oi.product_type = 'gift' AND oi.item_status = 'pending')
        )
        ${dt === 'batch' && targetItemIds.length > 0
          ? 'AND oi.id IN (' + targetItemIds.map(() => '?').join(',') + ')'
          : ''}
      `).all(orderId, ...(dt === 'batch' ? targetItemIds : []));

      if (availableItems.length === 0) {
        throw new Error('没有已到货的商品可配送');
      }

      // 全量订单项（用于判断整单是否已全部纳入配送）
      const allOrderItems = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId);
      // 创建送货单
      const batchNo = generateBatchNo();
      const deliveryResult = db.prepare(`INSERT INTO delivery_orders
        (order_id, batch_no, delivery_type, delivery_date, delivery_person, delivery_phone,
         customer_name, customer_phone, customer_address, status, note, operator_id, store_id)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(orderId, batchNo, dt, delivery_date || null,
          delivery_person || '', delivery_phone || '',
          order.customer_name, order.customer_phone || '', order.customer_address || '',
          'dispatched', note || '', req.user.id, order.store_id);

      const deliveryId = deliveryResult.lastInsertRowid;

      // 创建送货明细 + 更新订单项状态
      for (const item of availableItems) {
        db.prepare(`INSERT INTO delivery_items
          (delivery_id, order_item_id, product_id, product_name, product_model, spec, quantity, warehouse)
          VALUES (?,?,?,?,?,?,?,?)`)
          .run(deliveryId, item.id, item.product_id, item.product_name,
            item.product_model || '', item.spec || '', item.quantity, item.warehouse || '');

        db.prepare("UPDATE order_items SET item_status = 'delivering', delivered_quantity = quantity WHERE id = ?")
          .run(item.id);
      }

      // 更新订单送货模式
      if (dt === 'batch') {
        db.prepare("UPDATE orders SET delivery_mode = 'batch', updated_at = datetime('now','localtime') WHERE id = ?")
          .run(orderId);
      }

      // 推进订单状态
      if (dt === 'full' && availableItems.length === allOrderItems.length) {
        advanceStatus(db, orderId, 'delivering');
      } else {
        // 部分送货
        if (!['delivering', 'partially_delivered', 'signed'].includes(order.status)) {
          advanceStatus(db, orderId, 'partially_delivered');
        }
      }

      syncOrderStatus(db, orderId);

      logOperation(db, 'order', orderId, 'deliver', req.user.id, req.user.display_name,
        '', order.status, 'delivering', { delivery_type: dt, items_count: availableItems.length, batch_no: batchNo });

      const updated = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
      return { order: updated, delivery_id: deliveryId, batch_no: batchNo };
    })();

    res.json({ message: dt === 'full' ? '整单配送已发起' : '分批配送已发起', ...result });
  } catch (e) {
    console.error('[orders] deliver error:', e);
    res.status(500).json({ error: e.message });
  }
});

// =============================================
// GET /:id/delivery-note/:deliveryId — 生成送货单
// =============================================
router.get('/:id/delivery-note/:deliveryId', (req, res) => {
  try {
    const db = getDb();
    const orderId = req.params.id;
    const deliveryId = req.params.deliveryId;

    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    if (!order) return res.status(404).json({ error: '订单不存在' });
    if (!assertOrderReadable(req, res, order)) return;

    const delivery = db.prepare('SELECT * FROM delivery_orders WHERE id = ? AND order_id = ?').get(deliveryId, orderId);
    if (!delivery) return res.status(404).json({ error: '送货单不存在' });

    const items = db.prepare(`SELECT di.*, oi.product_type AS item_product_type FROM delivery_items di LEFT JOIN order_items oi ON di.order_item_id = oi.id WHERE di.delivery_id = ?`).all(deliveryId);

    // XSS 防护：对用户录入字段做 HTML 转义
    const escD = escapeHtml;
    for (const k of ['customer_name', 'customer_phone', 'customer_address', 'salesperson_name']) {
      if (order[k] != null) order[k] = escD(order[k]);
    }
    items.forEach(it => {
      for (const k of ['product_name', 'product_model', 'spec']) {
        if (it[k] != null) it[k] = escD(it[k]);
      }
    });

    // 该订单关联订货单的到货仓库（用于订货类货品的目标仓库）
    const arrivalWarehouse = (db.prepare('SELECT arrival_warehouse FROM purchase_orders WHERE order_id = ? LIMIT 1').get(orderId) || {}).arrival_warehouse || '';

    // 读取系统设置
    const config = {};
    const configRows = db.prepare('SELECT key, value FROM system_config').all();
    for (const row of configRows) { config[row.key] = row.value; }

    const storeName = config.store_name || '我的门店';
    const storeAddress = config.store_address || '';
    const storePhone = config.store_phone || '';

    const totalQty = items.reduce((s, i) => s + (i.quantity || 0), 0);
    const statusLabel = {
      pending: '待配送', dispatched: '已发出', signed: '已签收', cancelled: '已取消'
    }[delivery.status] || delivery.status;

    // 生成大写金额
    const cnNums = ['零','壹','贰','叁','肆','伍','陆','柒','捌','玖'];
    const cnUnits = ['','拾','佰','仟','万'];

    const itemsHtml = items.map((it, idx) => {
      const warehouse = it.item_product_type === 'sample'
        ? '店面'
        : it.item_product_type === 'order'
          ? (arrivalWarehouse || it.warehouse || '-')
          : (it.warehouse || '-');
      return `
      <tr>
        <td class="idx">${idx + 1}</td>
        <td class="name">${it.product_name || ''}</td>
        <td class="model">${it.product_model || ''}</td>
        <td class="spec">${it.spec || ''}</td>
        <td class="qty">${it.quantity || 0}</td>
        <td class="warehouse"><span class="wh-tag">${warehouse}</span></td>
      </tr>`;
    }).join('');

    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;

    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>送货单 - ${delivery.batch_no}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: "Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", sans-serif;
    background: #F5F4F1;
    display: flex; justify-content: center; padding: 20px 12px;
  }
  .page {
    width: 210mm; min-height: 297mm;
    background: #fff; padding: 56px 72px 48px;
    box-shadow: 0 2px 16px rgba(0,0,0,0.08);
  }
  /* 页头 */
  .header { text-align: center; margin-bottom: 36px; }
  .header .store { font-size: 26px; font-weight: 700; color: #3C2F20; letter-spacing: 4px; }
  .header .sub { font-size: 12px; color: #999; margin-top: 6px; letter-spacing: 2px; }
  .header .divider {
    width: 60px; height: 3px; background: #A88C78;
    margin: 16px auto 0; border-radius: 2px;
  }
  /* 送货单标题 */
  .doc-title {
    text-align: center; margin-bottom: 32px;
  }
  .doc-title h2 {
    font-size: 22px; font-weight: 700; color: #1D1D1F;
    letter-spacing: 3px; margin-bottom: 8px;
  }
  .doc-title .batch {
    display: inline-block; background: #A88C78; color: #fff;
    padding: 4px 16px; border-radius: 4px; font-size: 14px;
    font-weight: 600; letter-spacing: 1px;
  }
  /* 信息区块 */
  .info-grid {
    display: grid; grid-template-columns: 1fr 1fr;
    gap: 0; margin-bottom: 24px;
    border: 1px solid #E8E4DF; border-radius: 8px; overflow: hidden;
  }
  .info-item {
    display: flex; border-bottom: 1px solid #F0EDE8;
  }
  .info-item:nth-last-child(-n+2) { border-bottom: none; }
  .info-label {
    width: 80px; flex-shrink: 0;
    background: #FAF8F5; padding: 11px 14px;
    font-size: 13px; color: #8E8E93; font-weight: 500;
    display: flex; align-items: center;
  }
  .info-value {
    flex: 1; padding: 11px 14px;
    font-size: 13px; color: #1D1D1F; font-weight: 500;
    display: flex; align-items: center;
  }
  .info-value.phone { color: #A88C78; font-weight: 600; font-size: 14px; letter-spacing: 0.5px; }
  .info-value.address { font-size: 12px; }
  /* 仓库提示 */
  .wh-notice {
    display: flex; align-items: center; gap: 10px;
    background: #FFF8E1; border-left: 4px solid #F5A623;
    padding: 14px 18px; border-radius: 6px;
    margin-bottom: 24px;
  }
  .wh-notice .icon { font-size: 20px; flex-shrink: 0; }
  .wh-notice .text { font-size: 13px; color: #8D6E00; line-height: 1.6; }
  .wh-notice .text b { color: #5D4037; }
  /* 商品表格 */
  .items-table {
    width: 100%; border-collapse: collapse; margin-bottom: 24px;
  }
  .items-table thead th {
    background: #FAF8F5; border-bottom: 2px solid #A88C78;
    padding: 10px 10px; font-size: 12px; color: #8E8E93;
    font-weight: 600; text-align: center; letter-spacing: 0.5px;
  }
  .items-table tbody td {
    padding: 11px 10px; border-bottom: 1px solid #F0EDE8;
    font-size: 13px; color: #1D1D1F; text-align: center;
  }
  .items-table .idx { width: 40px; color: #8E8E93; }
  .items-table .name { text-align: left; font-weight: 500; }
  .items-table .model { color: #8E8E93; }
  .items-table .qty { font-weight: 600; color: #A88C78; }
  .items-table .warehouse { }
  .wh-tag {
    display: inline-block; background: #E3F2FD; color: #1565C0;
    padding: 3px 10px; border-radius: 4px; font-size: 12px; font-weight: 600;
    max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .items-table tbody tr:nth-child(even) td { background: #FAFBFC; }
  /* 汇总 */
  .summary {
    display: flex; justify-content: flex-end; align-items: center;
    padding: 16px 0; border-top: 2px solid #A88C78;
    margin-bottom: 32px;
  }
  .summary .label { font-size: 14px; color: #8E8E93; margin-right: 8px; }
  .summary .count { font-size: 22px; font-weight: 700; color: #A88C78; }
  .summary .unit { font-size: 13px; color: #8E8E93; margin-left: 4px; }
  .summary-coupon {
    margin-top: 10px; padding: 8px 14px; border-radius: 8px;
    background: #F6F2EE; color: #6B4F3A; font-size: 13px; font-weight: 600;
    border-left: 3px solid #A88C78;
  }
  /* 签名区 */
  .sign-area {
    display: flex; justify-content: space-between; margin-top: 48px;
  }
  .sign-block { flex: 1; text-align: center; }
  .sign-block .label {
    font-size: 14px; color: #1D1D1F; font-weight: 600; margin-bottom: 32px;
    padding-bottom: 8px; border-bottom: 1px solid #E8E4DF;
  }
  .sign-block .line {
    font-size: 12px; color: #8E8E93; margin-top: 4px;
  }
  /* 页脚 */
  .footer {
    text-align: center; margin-top: 40px; padding-top: 16px;
    border-top: 1px solid #F0EDE8;
    font-size: 11px; color: #B0B0B0;
  }
  /* 打印 */
  @media print {
    body { background: #fff; padding: 0; }
    .page { box-shadow: none; padding: 40px 60px 36px; }
    @page { size: A4; margin: 0; }
  }
</style>
</head>
<body>
<div class="page">

  <!-- 页头 -->
  <div class="header">
    <div class="store">${storeName}</div>
    <div class="sub">DELIVERY NOTE · 送货单</div>
    <div class="divider"></div>
  </div>

  <!-- 送货单号 -->
  <div class="doc-title">
    <h2>送 货 单</h2>
    <span class="batch">${delivery.batch_no}</span>
  </div>

  <!-- 信息网格 -->
  <div class="info-grid">
    <div class="info-item">
      <div class="info-label">收货客户</div>
      <div class="info-value">${escapeHtml(delivery.customer_name)}</div>
    </div>
    <div class="info-item">
      <div class="info-label">联系电话</div>
      <div class="info-value phone">${escapeHtml(delivery.customer_phone)}</div>
    </div>
    <div class="info-item">
      <div class="info-label">司机/师傅</div>
      <div class="info-value" style="font-weight:700;color:#3C2F20;">${escapeHtml(delivery.delivery_person)}</div>
    </div>
    <div class="info-item">
      <div class="info-label">师傅电话</div>
      <div class="info-value phone">${escapeHtml(delivery.delivery_phone)}</div>
    </div>
    <div class="info-item">
      <div class="info-label">配送日期</div>
      <div class="info-value">${escapeHtml(delivery.delivery_date || dateStr)}</div>
    </div>
    <div class="info-item">
      <div class="info-label">送货状态</div>
      <div class="info-value" style="color:#A88C78;font-weight:600;">${statusLabel}</div>
    </div>
    <div class="info-item">
      <div class="info-label">收货地址</div>
      <div class="info-value address">${escapeHtml(delivery.customer_address)}</div>
    </div>
    <div class="info-item">
      <div class="info-label">关联订单</div>
      <div class="info-value" style="font-weight:500;">${escapeHtml(order.order_no)}</div>
    </div>
  </div>

  <!-- 仓库提示 -->
  <div class="wh-notice">
    <div class="icon">📍</div>
    <div class="text">
      <b>师傅提货仓库：</b>${escapeHtml(storeAddress)} · ${escapeHtml(storePhone)}<br>
      请携带本送货单至上述仓库提货，提货时请核对商品名称、型号、规格及数量。
    </div>
  </div>

  ${delivery.note ? `<div style="background:#FFF3E0;border-left:4px solid #FF9800;padding:10px 16px;border-radius:6px;margin-bottom:20px;font-size:13px;color:#E65100;"><b>备注：</b>${escapeHtml(delivery.note)}</div>` : ''}

  <!-- 商品明细 -->
  <table class="items-table">
    <thead>
      <tr>
        <th>序号</th><th>商品名称</th><th>型号</th><th>规格</th><th>数量</th><th>目标仓库</th>
      </tr>
    </thead>
    <tbody>
      ${itemsHtml}
    </tbody>
  </table>

  <!-- 汇总 -->
  <div class="summary">
    <span class="label">合计共</span>
    <span class="count">${totalQty}</span>
    <span class="unit">件 / 套</span>
  </div>
${(Number(order.coupon_discount) > 0 || Number(order.external_coupon_amount) > 0) ? `<div class="summary-coupon">本单实收 ¥${(Number(order.actual_amount) || 0).toFixed(2)}${Number(order.coupon_discount) > 0 ? ` · 门店券核减 ¥${Number(order.coupon_discount).toFixed(2)}（${escapeHtml(order.coupon_code || '')}）` : ''}${Number(order.external_coupon_amount) > 0 ? ` · 平台券核销 ¥${Number(order.external_coupon_amount).toFixed(2)}` : ''}</div>` : ''}

  <!-- 签名区 -->
  <div class="sign-area">
    <div class="sign-block">
      <div class="label">仓库发货人</div>
      <div class="line">签名：_______________</div>
      <div class="line" style="margin-top:6px;">日期：_______________</div>
    </div>
    <div class="sign-block">
      <div class="label">配送师傅</div>
      <div class="line">签名：_______________</div>
      <div class="line" style="margin-top:6px;">日期：_______________</div>
    </div>
    <div class="sign-block">
      <div class="label">客户签收</div>
      <div class="line">签名：_______________</div>
      <div class="line" style="margin-top:6px;">日期：_______________</div>
    </div>
  </div>

  <!-- 页脚 -->
  <div class="footer">
    ${storeName} · ${storeAddress || ''} · ${storePhone || ''}<br>
    打印时间：${dateStr} &nbsp;|&nbsp; 本送货单一式三份，仓库、师傅、客户各执一份
  </div>

</div>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (e) {
    console.error('[orders] delivery-note error:', e);
    res.status(500).json({ error: e.message });
  }
});

// =============================================
// POST /:id/sign — 送货签收（节点六）
// =============================================
router.post('/:id/sign', (req, res) => {
  try {
    const db = getDb();
    const orderId = req.params.id;
    const { delivery_id, item_ids, signature_status } = req.body;

    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    if (!order) return res.status(404).json({ error: '订单不存在' });
    if (!assertOrderOwner(req, res, order)) return;

    // 签收前必须先校验送货单是否存在（必须在事务外，避免事务回调内发送响应导致崩溃）
    if (delivery_id) {
      const delivery = db.prepare('SELECT * FROM delivery_orders WHERE id = ? AND order_id = ?').get(delivery_id, orderId);
      if (!delivery) return res.status(404).json({ error: '送货单不存在' });
    }

    const result = db.transaction(() => {
      if (delivery_id) {
        // 签收指定送货单
        db.prepare("UPDATE delivery_orders SET status = 'signed', signature_status = ? WHERE id = ?")
          .run(signature_status || 'signed', delivery_id);

        // 更新对应订单项状态为已签收
        const dItems = db.prepare('SELECT * FROM delivery_items WHERE delivery_id = ?').all(delivery_id);
        for (const di of dItems) {
          db.prepare("UPDATE order_items SET item_status = 'signed' WHERE id = ?").run(di.order_item_id);
        }
      } else if (item_ids && item_ids.length > 0) {
        // 签收指定订单项
        for (const itemId of item_ids) {
          db.prepare("UPDATE order_items SET item_status = 'signed' WHERE id = ? AND order_id = ?").run(itemId, orderId);
        }
      }

      // 同步订单状态
      syncOrderStatus(db, orderId);

      logOperation(db, 'order', orderId, 'sign', req.user.id, req.user.display_name,
        '', order.status, db.prepare('SELECT status FROM orders WHERE id = ?').get(orderId).status,
        { delivery_id, item_ids });

      return db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    })();

    res.json({ message: '签收完成', order: result });
  } catch (e) {
    console.error('[orders] sign error:', e);
    res.status(500).json({ error: e.message });
  }
});

// =============================================
// POST /:id/complete — 订单闭环完工（节点七）
// =============================================
router.post('/:id/complete', (req, res) => {
  try {
    const db = getDb();
    const orderId = req.params.id;

    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    if (!order) return res.status(404).json({ error: '订单不存在' });
    if (!assertOrderOwner(req, res, order)) return;
    if (order.status === 'completed') return res.status(400).json({ error: '订单已完成' });
    if (order.status === 'cancelled') return res.status(400).json({ error: '已取消的订单不能完成' });

    const result = db.transaction(() => {
      db.prepare(`UPDATE orders SET
        status = 'completed',
        archived_at = datetime('now','localtime'),
        updated_at = datetime('now','localtime')
        WHERE id = ?`).run(orderId);

      // 标记所有未签收项为已签收
      db.prepare("UPDATE order_items SET item_status = 'signed' WHERE order_id = ? AND item_status NOT IN ('signed')")
        .run(orderId);

      // 客户↔订单打通：订单完工闭环时确保关联客户为已成交（幂等，可激活流失客户）
      markCustomerDeal(db, order.customer_id);

      logOperation(db, 'order', orderId, 'complete', req.user.id, req.user.display_name,
        '', order.status, 'completed', {});

      return db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    })();

    res.json({ message: '订单已完工归档', order: result });
  } catch (e) {
    console.error('[orders] complete error:', e);
    res.status(500).json({ error: e.message });
  }
});

// =============================================
// POST /:id/cancel — 取消订单
// =============================================
router.post('/:id/cancel', (req, res) => {
  try {
    const db = getDb();
    const orderId = req.params.id;
    const { reason } = req.body;

    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    if (!order) return res.status(404).json({ error: '订单不存在' });
    if (!assertOrderOwner(req, res, order)) return;
    if (order.status === 'completed') return res.status(400).json({ error: '已完成的订单不能取消' });
    if (order.status === 'cancelled') return res.status(400).json({ error: '订单已取消' });

    const result = db.transaction(() => {
      // 退回样品/赠品已减库存（订货不核减，无需回退）；在途由销售订单状态派生，取消后自动移出
      const cancelItems = db.prepare("SELECT * FROM order_items WHERE order_id = ? AND product_id IS NOT NULL AND product_type != 'order'").all(orderId);
      for (const item of cancelItems) {
        returnSaleStockIn(db, item, Number(item.quantity) || 1, orderId, req.user.id);
      }

      db.prepare('UPDATE orders SET status = ?, updated_at = datetime(\'now\',\'localtime\') WHERE id = ?')
        .run('cancelled', orderId);

      logOperation(db, 'order', orderId, 'cancel', req.user.id, req.user.display_name,
        reason || '', order.status, 'cancelled', {});

      return db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    })();

    res.json({ message: '订单已取消', order: result });
  } catch (e) {
    console.error('[orders] cancel error:', e);
    res.status(500).json({ error: e.message });
  }
});

// =============================================
// PUT /:id — 编辑订单
// =============================================
router.put('/:id', (req, res) => {
  try {
    const db = getDb();
    const orderId = req.params.id;
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    if (!order) return res.status(404).json({ error: '订单不存在' });
    if (!assertOrderOwner(req, res, order)) return;
    if (['completed', 'cancelled'].includes(order.status)) {
      return res.status(400).json({ error: '已完成/已取消的订单不能编辑' });
    }

    const { customer_name, customer_phone, customer_address, customer_id, items, payment_method,
      deposit_amount, delivery_date, note, discount, actual_amount, salesperson_id,
      salesperson_name, salesperson_phone, coupon_code, external_coupon_amount, amount_manual } = req.body;

    let custId = customer_id ? Number(customer_id) : order.customer_id;
    let resolvedName = customer_name || order.customer_name;
    let resolvedPhone = customer_phone || order.customer_phone;
    if (custId) {
      const cust = db.prepare('SELECT id, name, phone FROM customers WHERE id = ?').get(custId);
      if (cust) {
        if (!customer_name) resolvedName = cust.name;
        if (!customer_phone) resolvedPhone = cust.phone;
      }
    }

    // 校验商品明细：显式传空数组视为非法（返回 400）；未传 items 则保留原明细，避免误删导致金额归零
    if (items !== undefined && (!Array.isArray(items) || items.length === 0)) {
      return res.status(400).json({ error: '商品明细不能为空，请至少添加一个商品' });
    }
    const hasItems = items !== undefined;

    const result = db.transaction(() => {
      // 仅当传入明细时才退回旧明细库存并删除旧明细；否则保留原明细
      if (hasItems) {
        // 退回旧明细已减的库存（仅样品/赠品；订货不核减，无需回退），保持商品/规格库存一致
        const oldItems = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId);
        for (const oi of oldItems) {
          if (!oi.product_id) continue;
          const t = oi.product_type || 'order';
          if (t === 'order') continue; // 订货不核减库存
          returnSaleStockIn(db, oi, Number(oi.quantity) || 1, orderId, req.user.id);
        }
        db.prepare('DELETE FROM order_items WHERE order_id = ?').run(orderId);
      }

      // 计算金额并写回明细（未传 items 时保留原明细，金额沿用原快照）
      let itemsBase = 0;
      const itemPricings = [];
      const newItems = hasItems ? items : [];
      // 后台手填订单可能未带 product_id：按 商品名(+规格) 反查回填
      for (const it of newItems) resolveProductId(db, it);
      for (const it of newItems) {
        const pr = buildItemPricing(db, it);
        const rawQty = Number(it.quantity);
        if (!Number.isFinite(rawQty) || rawQty <= 0) {
          throw new Error(`商品「${it.product_name || it.product_id || '未知'}」的数量必须为正数`);
        }
        itemPricings.push({ it, pr, qty: rawQty });
        itemsBase += pr.finalPrice * rawQty;

        db.prepare(`INSERT INTO order_items
          (order_id, product_id, product_name, product_model, product_type, spec, quantity, unit_price, total_price, item_status, final_price, break_even_price, cost_price)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
          .run(orderId, it.product_id || null, it.product_name || '', it.product_model || '',
            it.product_type || 'order', it.spec || '', rawQty, pr.finalPrice, pr.finalPrice * rawQty, 'pending',
            pr.finalPrice, pr.breakEven, pr.costPrice);

        // 新区划减库存（仅样品/赠品；订货不核减，与创建保持一致）
        if ((it.product_type || 'order') !== 'order') {
          applySaleStockOut(db, it, qty, orderId, req.user.id);
        }
      }

      // 未传明细时从原始订单明细还原到手价基数（用已落库的 final_price 快照）
      if (!hasItems) {
        const dbItems = db.prepare('SELECT quantity, final_price FROM order_items WHERE order_id = ?').all(orderId);
        itemsBase = dbItems.reduce((s, it) => s + (Number(it.final_price) || 0) * (Number(it.quantity) || 1), 0);
      }

      const disc = Number(discount) || 0;
      const totalAmt = Math.max(0, itemsBase - disc);
      const isFull = payment_method === 'full';

      // 券核销对账：沿用原券/释放/重核销，避免 used_qty 重复计数
      const reqCouponCode = coupon_code !== undefined ? coupon_code : (order.coupon_code || '');
      // 平台券是否核减取决于系统开关；开关关闭时取 0，stored 字段与实收口径一致
      const rawExt = external_coupon_amount !== undefined ? (Number(external_coupon_amount) || 0) : (Number(order.external_coupon_amount) || 0);
      const reqExtCoupon = getConfigFlag(db, 'external_coupon_reduce') ? rawExt : 0;
      const editProductIds = hasItems
        ? newItems.map(i => i.product_id).filter(Boolean).map(Number)
        : db.prepare('SELECT product_id FROM order_items WHERE order_id = ?').all(orderId).map(r => r.product_id).filter(Boolean);
      const { code: couponCode, discount: couponDiscount, promo: promoApplied } =
        reconcileCoupon(db, { newCode: reqCouponCode, orderAmount: totalAmt, productIds: editProductIds, existingCode: order.coupon_code, existingDiscount: order.coupon_discount });

      // 治本：自动核减后的收款额；保留人工修改权（discount 用 disc，避免手动折扣丢失）
      const autoActual = calcAutoActual(db, { itemsBase, discount: disc, couponDiscount, externalCouponAmount: reqExtCoupon });
      let actualAmt;
      if (amount_manual === true) {
        actualAmt = Number(actual_amount) || autoActual;
      } else if (amount_manual === false) {
        actualAmt = autoActual;
      } else {
        actualAmt = Number(actual_amount) || totalAmt;
      }
      const isAmountManual = amount_manual === true ? 1 : 0;

      // 处理支付（保持订单实收与支付流水一致）
      let newDeposit = order.deposit_amount;
      let newBalance = order.balance_amount;

      if (isFull) {
        if (order.payment_method !== 'full') {
          // 由定金切换为全款：删旧全款流水，重写
          db.prepare("DELETE FROM payments WHERE order_id = ? AND payment_type = 'full'").run(orderId);
          db.prepare('INSERT INTO payments (order_id, amount, payment_type, payment_method, operator_id) VALUES (?,?,?,?,?)')
            .run(orderId, actualAmt, 'full', '全款', req.user.id);
          newDeposit = actualAmt;
          newBalance = 0;
        } else {
          // 全款单编辑：实收可能随券/折扣变化，同步定金与全款支付流水，杜绝财务不一致
          newDeposit = actualAmt;
          newBalance = 0;
          const fullPay = db.prepare("SELECT id, amount FROM payments WHERE order_id = ? AND payment_type = 'full' ORDER BY id DESC LIMIT 1").get(orderId);
          if (fullPay && Math.abs(Number(fullPay.amount) - actualAmt) > 0.001) {
            db.prepare('UPDATE payments SET amount = ? WHERE id = ?').run(actualAmt, fullPay.id);
          }
        }
      } else {
        if (order.payment_method === 'full') {
          // 由全款切换为定金：删全款流水
          db.prepare("DELETE FROM payments WHERE order_id = ? AND payment_type = 'full'").run(orderId);
          newDeposit = Number(deposit_amount) || 0;
          newBalance = actualAmt - newDeposit;
        } else {
          newDeposit = Number(deposit_amount) || order.deposit_amount;
          newBalance = actualAmt - newDeposit;
        }
      }

      const newStatus = isFull ? 'full_paid' : (order.status === 'full_paid' ? 'deposited' : order.status);

      // 编辑时若订单尚未关联客户主档，按 姓名/电话 自动建档/关联（实时同步到客户管理）
      if (!custId && (resolvedName || resolvedPhone)) {
        custId = syncCustomerFromOrder(db, {
          name: resolvedName, phone: resolvedPhone,
          address: customer_address || '', ownerId: order.salesperson_id || null,
        });
      }

      db.prepare(`UPDATE orders SET
        customer_name = ?, customer_phone = ?, customer_address = ?,
        total_amount = ?, deposit_amount = ?, balance_amount = ?,
        discount = ?, actual_amount = ?,
        coupon_code = ?, coupon_discount = ?, external_coupon_amount = ?, promo_applied = ?, amount_manual = ?,
        payment_method = ?, status = ?,
        salesperson_id = ?, salesperson_name = ?, salesperson_phone = ?,
        delivery_date = ?, note = ?, customer_id = ?,
        updated_at = datetime('now','localtime')
        WHERE id = ?`)
        .run(resolvedName, resolvedPhone || '', customer_address || '',
          totalAmt, newDeposit, newBalance, disc, actualAmt,
          couponCode, couponDiscount, reqExtCoupon, promoApplied, isAmountManual,
          payment_method || 'deposit', newStatus,
          salesperson_id || order.salesperson_id, salesperson_name || order.salesperson_name,
          salesperson_phone || order.salesperson_phone,
          delivery_date || order.delivery_date, note || '',
          custId,
          orderId);

      // 注：新明细的库存已在上方 newItems 循环里经 applySaleStockOut 统一扣减（覆盖所有类型），此处不再重复处理

      logOperation(db, 'order', orderId, 'edit', req.user.id, req.user.display_name,
        '', order.status, newStatus, {});

      return db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    })();

    res.json({ message: '订单已更新', order: result });
  } catch (e) {
    console.error('[orders] edit error:', e);
    res.status(500).json({ error: e.message });
  }
});

// =============================================
// DELETE /:id — 删除订单（仅 admin，仅限已取消/已完成）
// =============================================
router.delete('/:id', roleMiddleware('admin'), (req, res) => {
  try {
    const db = getDb();
    const orderId = req.params.id;
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    if (!order) return res.status(404).json({ error: '订单不存在' });
    if (!['completed', 'cancelled'].includes(order.status)) {
      return res.status(400).json({ error: '仅已取消/已完成的订单可删除' });
    }
    // H2：拦截删除——该订单已存在退/换单或售后工单，避免产生孤儿单导致数据脏 + 财务虚减
    const relReturn = db.prepare('SELECT COUNT(*) AS c FROM order_returns WHERE order_id = ?').get(orderId).c;
    const relAftersales = db.prepare('SELECT COUNT(*) AS c FROM order_aftersales WHERE order_id = ?').get(orderId).c;
    if (relReturn > 0 || relAftersales > 0) {
      return res.status(409).json({
        error: `该订单已存在退/换单(${relReturn})或售后工单(${relAftersales})，请先处理或归档相关单据后再删除订单`,
      });
    }

    // 删除前先留快照：删单动作必须可追溯（谁删了哪单、原金额多少）
    const snapshot = {
      order_no: order.order_no, customer_name: order.customer_name,
      customer_phone: order.customer_phone, total_amount: order.total_amount,
      actual_amount: order.actual_amount, status: order.status, created_at: order.created_at,
    };

    db.transaction(() => {
      // 解除关联进货单
      db.prepare('UPDATE purchase_orders SET order_id = NULL WHERE order_id = ?').run(orderId);
      // 删除配送单明细
      const deliveries = db.prepare('SELECT id FROM delivery_orders WHERE order_id = ?').all(orderId);
      for (const d of deliveries) {
        db.prepare('DELETE FROM delivery_items WHERE delivery_id = ?').run(d.id);
      }
      db.prepare('DELETE FROM delivery_orders WHERE order_id = ?').run(orderId);
      // 删除分配记录
      db.prepare(`DELETE FROM allocations WHERE order_item_id IN (SELECT id FROM order_items WHERE order_id = ?)`).run(orderId);
      // 删除日志（先清历史，删单审计写在事务之后，确保"删单"这个动作本身留痕、不被此句抹掉）
      db.prepare('DELETE FROM operation_logs WHERE target_type = ? AND target_id = ?').run('order', orderId);
      // 删除审批
      db.prepare('DELETE FROM rollback_approvals WHERE target_type = ? AND target_id = ?').run('order', orderId);
      // 库存已在对应环节处理：取消订单由取消接口退回库存；已完成订单的库存为已售出货，删除订单不再改动库存
      db.prepare('DELETE FROM payments WHERE order_id = ?').run(orderId);
      db.prepare('DELETE FROM order_items WHERE order_id = ?').run(orderId);
      db.prepare('DELETE FROM orders WHERE id = ?').run(orderId);
    })();

    // 写在事务之后：上面已清掉该订单历史日志，此条审计不会再被清理
    auditDelete(req, TARGET_TYPES.ORDER, orderId, snapshot, { reason: '物理删除订单' });

    res.json({ message: '订单已删除' });
  } catch (e) {
    console.error('[orders] delete error:', e);
    res.status(500).json({ error: e.message });
  }
});

// =============================================
// POST /:id/rollback — 逐级回退（非店长需审批）
// =============================================
router.post('/:id/rollback', async (req, res) => {
  try {
    const db = getDb();
    const orderId = req.params.id;
    const { target_node, reason } = req.body;

    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    if (!order) return res.status(404).json({ error: '订单不存在' });
    if (!assertOrderOwner(req, res, order)) return;
    if (order.status === 'cancelled') return res.status(400).json({ error: '已取消的订单不能回退' });

    // 状态流转向量（复用全系统唯一权威定义）
    const statusChain = ORDER_STATUS_ORDER;

    const currentIdx = statusChain.indexOf(order.status);
    const targetIdx = statusChain.indexOf(target_node);

    if (currentIdx < 0 || targetIdx < 0) {
      return res.status(400).json({ error: '无效的状态节点' });
    }
    if (targetIdx >= currentIdx) {
      return res.status(400).json({ error: '只能回退到之前的节点' });
    }
    if (currentIdx - targetIdx > 1) {
      return res.status(400).json({ error: '禁止跨节点回退，必须逐级撤销' });
    }

    // 非店长需要审批
    if (req.user.role !== 'admin') {
      const approvalResult = db.prepare(`INSERT INTO rollback_approvals
        (target_type, target_id, from_node, to_node, applicant_id, status, reason)
        VALUES (?,?,?,?,?,?,?)`)
        .run('order', orderId, order.status, target_node, req.user.id, 'pending', reason || '');

      logOperation(db, 'order', orderId, 'rollback_request', req.user.id, req.user.display_name,
        reason || '', order.status, target_node, { approval_id: approvalResult.lastInsertRowid });

      return res.json({
        message: '回退申请已提交，等待店长审批',
        approval_id: approvalResult.lastInsertRowid
      });
    }

    // 店长直接执行回退
    const result = executeRollback(db, orderId, order.status, target_node, req.user, reason);
    res.json({ message: '回退成功', order: result });
  } catch (e) {
    console.error('[orders] rollback error:', e);
    res.status(500).json({ error: e.message });
  }
});

// 执行回退的核心函数
export function executeRollback(db, orderId, fromStatus, toStatus, operator, reason) {
  const body = () => {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);

    // completed → signed：回退样品/赠品已成交库存（订货不核减，无需回退）；在途由订单状态派生，签收后自动移出
    if (fromStatus === 'completed' && toStatus === 'signed') {
      const items = db.prepare("SELECT * FROM order_items WHERE order_id = ? AND product_id IS NOT NULL AND product_type != 'order'").all(orderId);
      for (const item of items) {
        returnSaleStockIn(db, item, Number(item.quantity) || 1, orderId, operator?.id);
      }
      db.prepare('UPDATE orders SET status = ?, archived_at = NULL, updated_at = datetime(\'now\',\'localtime\') WHERE id = ?').run('signed', orderId);
    }
    // signed → delivering/partially_delivered
    else if (fromStatus === 'signed' && (toStatus === 'delivering' || toStatus === 'partially_delivered')) {
      const items = db.prepare("SELECT * FROM order_items WHERE order_id = ? AND item_status = 'signed'").all(orderId);
      for (const item of items) {
        db.prepare("UPDATE order_items SET item_status = 'delivering' WHERE id = ?").run(item.id);
      }
      // 回退送货单签收
      db.prepare("UPDATE delivery_orders SET status = 'dispatched', signature_status = 'unsigned' WHERE order_id = ? AND status = 'signed'").run(orderId);
      db.prepare('UPDATE orders SET status = ?, updated_at = datetime(\'now\',\'localtime\') WHERE id = ?').run(toStatus, orderId);
    }
    // delivering → balance_paid/special_released/ready
    else if (['delivering', 'partially_delivered'].includes(fromStatus) &&
             ['balance_paid', 'special_released', 'ready'].includes(toStatus)) {
      const items = db.prepare("SELECT * FROM order_items WHERE order_id = ? AND item_status IN ('delivering','delivered')").all(orderId);
      for (const item of items) {
        db.prepare("UPDATE order_items SET item_status = 'arrived', delivered_quantity = 0 WHERE id = ?").run(item.id);
      }
      // 取消所有配送中送货单
      db.prepare("UPDATE delivery_orders SET status = 'cancelled' WHERE order_id = ? AND status IN ('pending','dispatched')").run(orderId);
      db.prepare('UPDATE orders SET status = ?, updated_at = datetime(\'now\',\'localtime\') WHERE id = ?').run(toStatus, orderId);
    }
    // balance_paid → arrived/ready
    else if (fromStatus === 'balance_paid' && ['arrived', 'ready'].includes(toStatus)) {
      const lastBalancePay = db.prepare("SELECT * FROM payments WHERE order_id = ? AND payment_type = 'balance' ORDER BY id DESC LIMIT 1").get(orderId);
      if (lastBalancePay) {
        db.prepare('DELETE FROM payments WHERE id = ?').run(lastBalancePay.id);
        db.prepare('UPDATE orders SET balance_amount = balance_amount + ? WHERE id = ?').run(lastBalancePay.amount, orderId);
      }
      db.prepare('UPDATE orders SET status = ?, updated_at = datetime(\'now\',\'localtime\') WHERE id = ?').run(toStatus, orderId);
    }
    // special_released → ready/arrived
    else if (fromStatus === 'special_released' && ['ready', 'arrived'].includes(toStatus)) {
      db.prepare("UPDATE orders SET tail_payment_status = 'pending', special_release_by = NULL, special_release_at = NULL, status = ?, updated_at = datetime('now','localtime') WHERE id = ?").run(toStatus, orderId);
    }
    // arrived → ordered/purchasing
    else if (fromStatus === 'arrived' && ['ordered', 'purchasing'].includes(toStatus)) {
      const lastAlloc = db.prepare(`
        SELECT a.*, oi.product_id, oi.product_name FROM allocations a
        JOIN order_items oi ON a.order_item_id = oi.id
        WHERE oi.order_id = ? ORDER BY a.id DESC LIMIT 1
      `).get(orderId);
      if (lastAlloc) {
        db.prepare('DELETE FROM allocations WHERE id = ?').run(lastAlloc.id);
        db.prepare('UPDATE purchase_items SET allocated = allocated - ?, remain_quantity = remain_quantity + ? WHERE id = ?')
          .run(lastAlloc.quantity, lastAlloc.quantity, lastAlloc.purchase_item_id);
        db.prepare('UPDATE order_items SET allocated = allocated - ?, item_status = ? WHERE id = ?')
          .run(lastAlloc.quantity, 'ordered', lastAlloc.order_item_id);
      }
      db.prepare('UPDATE orders SET status = ?, updated_at = datetime(\'now\',\'localtime\') WHERE id = ?').run(toStatus, orderId);
      syncOrderStatus(db, orderId);
    }
    // ordered/purchasing → deposited/full_paid/pending
    else if (['ordered', 'purchasing'].includes(fromStatus) && ['pending', 'deposited', 'full_paid'].includes(toStatus)) {
      const pos = db.prepare("SELECT * FROM purchase_orders WHERE order_id = ? AND status != 'cancelled'").all(orderId);
        for (const po of pos) {
          // 订货在途由销售订单状态派生，取消采购单时不手动调整在途（避免与派生值冲突）
          db.prepare("UPDATE purchase_orders SET status = 'cancelled' WHERE id = ?").run(po.id);
        }
      db.prepare("UPDATE order_items SET item_status = 'pending', merge_group = '' WHERE order_id = ?").run(orderId);
      db.prepare('UPDATE orders SET status = ?, updated_at = datetime(\'now\',\'localtime\') WHERE id = ?').run(toStatus, orderId);
      syncOrderStatus(db, orderId);
    }
    else {
      // 通用回退：直接改状态
      db.prepare('UPDATE orders SET status = ?, updated_at = datetime(\'now\',\'localtime\') WHERE id = ?').run(toStatus, orderId);
    }

    logOperation(db, 'order', orderId, 'rollback', operator.id, operator.display_name,
      reason || '', fromStatus, toStatus, {});

    return db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  };
  // 已在外部事务内（如店长审批回退）时直接执行，避免 better-sqlite3 嵌套事务报错；
  // 独立调用（店长直接回退）时自行开启事务，保证原子性。对齐 stock.js:129/157。
  return db.inTransaction ? body() : db.transaction(body)();
}

// =============================================
// GET /:id/logs — 操作日志
// =============================================
router.get('/:id/logs', (req, res) => {
  try {
    const db = getDb();
    const logs = db.prepare(`
      SELECT * FROM operation_logs
      WHERE target_type = 'order' AND target_id = ?
      ORDER BY created_at DESC
      LIMIT 100
    `).all(req.params.id);
    res.json({ logs });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
