import { useState, useEffect } from 'react';
import {
  Card, Table, Tag, Button, Space, Modal, Form, InputNumber, Input, Select,
  message, Timeline, Popconfirm, Tooltip, Alert
} from 'antd';
import EmptyState from '../components/EmptyState';
import {
  RedoOutlined, SwapOutlined, CustomerServiceOutlined, PrinterOutlined,
  PlusOutlined, DeleteOutlined
} from '@ant-design/icons';
import api from '../api';
import { formatMoney } from '../utils/format';

// ============ 常量 ============
const RETURN_STATUS = { pending: '待处理', processing: '处理中', completed: '已完成', cancelled: '已取消' };
const RETURN_STATUS_COLOR = { pending: 'var(--status-todo)', processing: 'var(--status-stock)', completed: 'var(--status-done)', cancelled: 'var(--status-cancel)' };
const AS_TYPE = { repair: '维修', parts: '补件', complaint: '投诉/咨询', other: '其他' };
const AS_TYPE_COLOR = { repair: 'blue', parts: 'purple', complaint: 'orange', other: 'default' };
const AS_STATUS = { pending: '待处理', processing: '处理中', completed: '已完成', closed: '已关闭' };
const AS_STATUS_COLOR = { pending: 'var(--status-todo)', processing: 'var(--status-stock)', completed: 'var(--status-done)', closed: 'var(--status-cancel)' };
const PRIORITY = { low: '低', normal: '普通', high: '高' };
const PRIORITY_COLOR = { low: 'default', normal: 'var(--status-todo)', high: 'var(--status-cancel)' };

const token = () => localStorage.getItem('token');

// ============ 主组件 ============
export default function AftersalesSection({ id, order, isAdmin, returnModal, setReturnModal, aftersalesModal, setAftersalesModal, onChanged }) {
  const [returns, setReturns] = useState([]);
  const [aftersales, setAftersales] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(false);

  const loadReturns = async () => {
    try { const r = await api.get(`/orders/${id}/returns`); setReturns(r.data.returns || []); } catch { /* ignore */ }
  };
  const loadAftersales = async () => {
    try { const r = await api.get(`/orders/${id}/aftersales`); setAftersales(r.data.aftersales || []); } catch { /* ignore */ }
  };
  const loadProducts = async () => {
    try { const r = await api.get('/products'); setProducts(r.data || []); } catch { /* ignore */ }
  };

  useEffect(() => {
    setLoading(true);
    Promise.all([loadReturns(), loadAftersales(), loadProducts()]).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const refresh = async () => { await Promise.all([loadReturns(), loadAftersales()]); onChanged && onChanged(); };

  // 某订单明细行已退/换数量
  const returnedQty = (orderItemId) => {
    let q = 0;
    for (const r of returns) {
      if (r.status === 'cancelled') continue;
      for (const it of (r.items || [])) {
        if (it.order_item_id === orderItemId && ['return_in', 'exchange_out'].includes(it.action)) q += Number(it.quantity) || 0;
      }
    }
    return q;
  };

  const canReturn = isAdmin && ['signed', 'completed'].includes(order?.status);
  const printReturn = async (rid) => {
    try {
      const res = await api.get(`/orders/${id}/returns/${rid}/print`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(res.data);
      window.open(url, '_blank');
      setTimeout(() => window.URL.revokeObjectURL(url), 30000);
    } catch (e) { message.error('打印退货单失败'); }
  };

  const returnColumns = [
    { title: '类型', dataIndex: 'type', width: 64, render: v => <Tag color={v === 'exchange' ? 'purple' : 'orange'}>{v === 'exchange' ? '换货' : '退货'}</Tag> },
    { title: '状态', dataIndex: 'status', width: 72, render: v => <Tag color={RETURN_STATUS_COLOR[v]}>{RETURN_STATUS[v] || v}</Tag> },
    { title: '原因', dataIndex: 'reason', ellipsis: true },
    { title: '退款/差价', key: 'amt', width: 110, render: (_, r) => r.type === 'return'
      ? <span>退款 ¥{(Number(r.refund_amount) || 0).toFixed(2)}</span>
      : <span>差价 ¥{(Number(r.diff_amount) || 0).toFixed(2)}</span> },
    { title: '操作', key: 'act', width: 150, render: (_, r) => (
      <Space size={4}>
        {isAdmin && <Button size="small" icon={<PrinterOutlined />} onClick={() => printReturn(r.id)}>打印</Button>}
        {isAdmin && r.status !== 'cancelled' && (
          <Popconfirm title="确认取消该退/换单？" onConfirm={async () => {
            try { await api.put(`/orders/returns/${r.id}`, { status: 'cancelled' }); message.success('已取消'); refresh(); }
            catch (e) { message.error(e.response?.data?.error || '操作失败'); }
          }}>
            <Button size="small" danger>取消</Button>
          </Popconfirm>
        )}
      </Space>
    ) },
  ];

  const returnExpanded = (r) => (
    <Table dataSource={r.items || []} rowKey="id" size="small" pagination={false}
      columns={[
        { title: '商品', render: (v, r) => (r.action === 'exchange_in' ? (r.new_product_name || v || '-') : (v || '-')) },
        { title: '型号', dataIndex: 'product_model', render: (v, r) => (r.action === 'exchange_in' ? '-' : (v || '-')) },
        { title: '规格', render: (v, r) => (r.action === 'exchange_in' ? (r.new_spec || '-') : (v || '-')) },
        { title: '动作', dataIndex: 'action', width: 100, render: v => ({
          return_in: <Tag color="orange">退货入库</Tag>,
          exchange_out: <Tag color="blue">旧品退库</Tag>,
          exchange_in: <Tag color="green">换出新品</Tag>,
        }[v] || v) },
        { title: '数量', dataIndex: 'quantity', width: 56 },
        { title: '单价', dataIndex: 'unit_price', width: 80, render: v => formatMoney(v) },
        { title: '成本', dataIndex: 'cost_price', width: 80, render: v => formatMoney(v) },
      ]} />
  );

  const asColumns = [
    { title: '类型', dataIndex: 'type', width: 84, render: v => <Tag color={AS_TYPE_COLOR[v]}>{AS_TYPE[v] || v}</Tag> },
    { title: '状态', dataIndex: 'status', width: 72, render: v => <Tag color={AS_STATUS_COLOR[v]}>{AS_STATUS[v] || v}</Tag> },
    { title: '优先级', dataIndex: 'priority', width: 56, render: v => <Tag color={PRIORITY_COLOR[v]}>{PRIORITY[v] || v}</Tag> },
    { title: '标题', dataIndex: 'title', ellipsis: true },
    { title: '处理人', dataIndex: 'handler', width: 80, render: v => v || '-' },
    { title: '费用', dataIndex: 'cost', width: 80, render: (v, r) => (Number(v) > 0 ? `${formatMoney(v)} (${r.cost_type === 'parts' ? '配件' : '服务'})` : '-') },
  ];

  const asExpanded = (a) => (
    <div>
      {a.description && <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>描述：{a.description}</p>}
      {(a.items || []).length > 0 && (
        <Table dataSource={a.items} rowKey="id" size="small" pagination={false} style={{ margin: '8px 0' }}
          columns={[
            { title: '补件商品', dataIndex: 'product_name' },
            { title: '规格', dataIndex: 'spec', render: v => v || '-' },
            { title: '数量', dataIndex: 'quantity', width: 56 },
          ]} />
      )}
      <Timeline items={(a.logs || []).map(l => ({
        children: <span style={{ fontSize: 12 }}>
          <span style={{ color: 'var(--color-text-tertiary)' }}>{l.created_at?.slice(0, 19)}</span>
          &nbsp;{l.operator_name} {l.action && <Tag>{l.action}</Tag>} {l.note}
        </span>
      }))} />
    </div>
  );

  return (
    <Card size="small" title="退换与售后" style={{ marginBottom: 16, borderRadius: 8 }}
      extra={canReturn ? (
        <Space size={4} wrap>
          <Button size="small" icon={<RedoOutlined />} onClick={() => setReturnModal({ open: true, type: 'return' })}>退货</Button>
          <Button size="small" icon={<SwapOutlined />} onClick={() => setReturnModal({ open: true, type: 'exchange' })}>换货</Button>
          <Button size="small" icon={<CustomerServiceOutlined />} onClick={() => setAftersalesModal(true)}>售后</Button>
        </Space>
      ) : null}
    >
      <Alert type="info" showIcon style={{ marginBottom: 8 }} message="退货/换货按单件商品维度操作，可部分退；售后工单默认轻量，仅「补件」联动库存与费用。" />
      <div style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)', margin: '4px 0 8px' }}>退/换单</div>
      <Table dataSource={returns} rowKey="id" size="small" pagination={false} loading={loading}
        locale={{ emptyText: <EmptyState title="暂无退/换单" description="点击右上角「退货/换货」发起退/换单" /> }}
        columns={returnColumns} expandable={{ expandedRowRender: returnExpanded }} />

      <div style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)', margin: '16px 0 8px' }}>售后工单</div>
      <Table dataSource={aftersales} rowKey="id" size="small" pagination={false} loading={loading}
        locale={{ emptyText: <EmptyState title="暂无售后工单" description="点击右上角「售后」发起工单" /> }}
        columns={asColumns} expandable={{ expandedRowRender: asExpanded }} />

      <ReturnModal open={returnModal?.open} type={returnModal?.type} order={order} returns={returns}
        products={products} onClose={() => setReturnModal({ open: false, type: '' })} onDone={refresh} />
      <AftersalesModal open={aftersalesModal} products={products} onClose={() => setAftersalesModal(false)} onDone={refresh} id={id} />
    </Card>
  );
}

// ============ 退/换弹窗 ============
function ReturnModal({ open, type, order, returns, products, onClose, onDone }) {
  const [rows, setRows] = useState([]);
  const [selected, setSelected] = useState([]);
  const [newMap, setNewMap] = useState({});   // orderItemId -> { productId, qty }
  const [refund, setRefund] = useState(0);
  const [diff, setDiff] = useState(0);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const returnedQty = (orderItemId) => {
    let q = 0;
    for (const r of (returns || [])) {
      if (r.status === 'cancelled') continue;
      for (const it of (r.items || [])) {
        if (it.order_item_id === orderItemId && ['return_in', 'exchange_out'].includes(it.action)) q += Number(it.quantity) || 0;
      }
    }
    return q;
  };

  useEffect(() => {
    if (open && order) {
      const init = (order.items || []).map(it => {
        const max = (Number(it.quantity) || 0) - returnedQty(it.id);
        return { key: it.id, item: it, maxQty: max, qty: 0 };
      });
      setRows(init);
      setSelected([]);
      setNewMap({});
      setRefund(0); setDiff(0); setReason(''); setNote('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const updateRow = (key, field, value) => setRows(rs => rs.map(r => r.key === key ? { ...r, [field]: value } : r));

  const selItems = rows.filter(r => selected.includes(r.key) && r.qty > 0);
  const totalOld = selItems.reduce((s, r) => s + (Number(r.item.final_price) || Number(r.item.unit_price) || 0) * (Number(r.qty) || 0), 0);

  const handleOk = async () => {
    if (selItems.length === 0) { message.warning('请选择至少一件商品并填写数量'); return; }
    if (type === 'exchange') {
      for (const r of selItems) {
        if (!newMap[r.key] || !newMap[r.key].productId) { message.warning(`请为「${r.item.product_name}」选择换出的新品`); return; }
      }
    }
    setSubmitting(true);
    const items = [];
    let refundSum = 0, diffSum = 0;
    for (const r of selItems) {
      const price = Number(r.item.final_price) || Number(r.item.unit_price) || 0;
      const cost = Number(r.item.cost_price) || 0;
      const qty = Number(r.qty) || 0;
      if (type === 'return') {
        items.push({
          order_item_id: r.item.id, product_id: r.item.product_id, variant_id: r.item.variant_id,
          product_name: r.item.product_name, product_model: r.item.product_model, spec: r.item.spec,
          action: 'return_in', quantity: qty, unit_price: price, cost_price: cost,
        });
        refundSum += price * qty;
      } else {
        // 旧品退库
        items.push({
          order_item_id: r.item.id, product_id: r.item.product_id, variant_id: r.item.variant_id,
          product_name: r.item.product_name, product_model: r.item.product_model, spec: r.item.spec,
          action: 'exchange_out', quantity: qty, unit_price: price, cost_price: cost,
        });
        const np = newMap[r.key];
        const prod = products.find(p => p.id === np.productId);
        const nQty = Number(np.qty) || qty;
        const nPrice = Number(prod?.price) || 0;
        const nCost = Number(prod?.cost_price) || 0;
        items.push({
          new_product_id: prod?.id, new_product_name: prod?.name, new_spec: prod?.spec || '',
          action: 'exchange_in', quantity: nQty, unit_price: nPrice, cost_price: nCost,
        });
        diffSum += nPrice * nQty - price * qty;
      }
    }
    const payload = {
      type,
      reason,
      note,
      refund_amount: type === 'return' ? (Number(refund) || refundSum) : 0,
      diff_amount: type === 'exchange' ? (Number(diff) || diffSum) : 0,
      items,
    };
    try {
      const res = await api.post(`/orders/${order.id}/returns`, payload);
      message.success(res.data?.message || '已创建');
      onDone(); onClose();
    } catch (e) { message.error(e.response?.data?.error || '操作失败'); }
    finally { setSubmitting(false); }
  };

  const columns = [
    { title: '商品', dataIndex: 'product_name', render: (v, r) => (
      <div>
        <div style={{ fontWeight: 500 }}>{r.item.product_name}</div>
        <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>已退/换 {returnedQty(r.item.id)} / {r.item.quantity}</div>
      </div>
    ) },
    { title: '型号/规格', key: 'spec', render: (_, r) => (
      <div style={{ fontSize: 'var(--font-size-sm)' }}>
        {r.item.product_model ? <div>型号：{r.item.product_model}</div> : null}
        <div>规格：{r.item.spec || '-'}</div>
      </div>
    ) },
    { title: '可退', key: 'max', width: 56, align: 'center', render: (_, r) => r.maxQty },
    { title: '数量', key: 'qty', width: 110, render: (_, r) => (
      <InputNumber min={0} max={r.maxQty} value={r.qty} disabled={!selected.includes(r.key)}
        onChange={v => updateRow(r.key, 'qty', v == null ? 0 : v)} style={{ width: '100%' }} />
    ) },
    { title: '成交单价', key: 'price', width: 90, render: (_, r) => formatMoney(Number(r.item.final_price) || Number(r.item.unit_price) || 0) },
  ];
  if (type === 'exchange') {
    columns.push({
      title: '换出新品', key: 'new', width: 200, render: (_, r) => selected.includes(r.key) && r.qty > 0 ? (
        <Space direction="vertical" style={{ width: '100%' }} size={4}>
          <Select size="small" placeholder="选择换出的新品" showSearch optionFilterProp="label" style={{ width: '100%' }}
            value={newMap[r.key]?.productId}
            onChange={pid => setNewMap(m => ({ ...m, [r.key]: { ...(m[r.key] || {}), productId: pid, qty: r.qty } }))}
            options={products.map(p => ({ value: p.id, label: `${p.name}${p.spec ? ' ' + p.spec : ''}` }))} />
          {newMap[r.key]?.productId && (
            <InputNumber size="small" min={1} max={r.maxQty} value={newMap[r.key]?.qty ?? r.qty}
              onChange={v => setNewMap(m => ({ ...m, [r.key]: { ...(m[r.key] || {}), qty: v == null ? r.qty : v } }))}
              addonAfter="件" style={{ width: '100%' }} />
          )}
        </Space>
      ) : <span style={{ color: 'var(--color-text-tertiary)' }}>-</span>
    });
  }

  return (
    <Modal className="modal-lg" title={type === 'exchange' ? '换货' : '退货'} open={open} onOk={handleOk} onCancel={onClose}
      destroyOnClose okText="提交" confirmLoading={submitting}>
      <Alert type="info" showIcon style={{ marginBottom: 10 }}
        message={type === 'return'
          ? '勾选需退货的商品并填写数量（不超过可退数量），退款金额默认按成交价×数量，可修改。'
          : '勾选需换货的旧品并填写数量，再为每件选择换出的新品与数量。差价自动按新旧品计算，可修改。'} />
      <Table rowKey="key" size="small" pagination={false} dataSource={rows} columns={columns}
        rowSelection={{ selectedRowKeys: selected, onChange: setSelected }}
        scroll={{ y: 300 }} />

      <div style={{ marginTop: 12 }}>
        {type === 'return' ? (
          <div style={{ marginBottom: 8 }}>
            <span style={{ marginRight: 8, color: 'var(--color-text-secondary)' }}>退款金额(¥)</span>
            <InputNumber min={0} prefix="¥" value={refund} onChange={setRefund} style={{ width: 200 }}
              placeholder={`默认 ${formatMoney(totalOld)}`} />
          </div>
        ) : (
          <div style={{ marginBottom: 8 }}>
            <span style={{ marginRight: 8, color: 'var(--color-text-secondary)' }}>差价(¥，正=客户补)</span>
            <InputNumber prefix="¥" value={diff} onChange={setDiff} style={{ width: 200 }}
              placeholder={`自动计算 ${formatMoney(diffSumCalc(selItems, newMap, products))}`} />
          </div>
        )}
        <Input style={{ marginBottom: 8 }} placeholder="原因" value={reason} onChange={e => setReason(e.target.value)} />
        <Input.TextArea rows={2} placeholder="备注（可选）" value={note} onChange={e => setNote(e.target.value)} />
      </div>
    </Modal>
  );
}

function diffSumCalc(selItems, newMap, products) {
  let s = 0;
  for (const r of selItems) {
    const old = (Number(r.item.final_price) || Number(r.item.unit_price) || 0) * (Number(r.qty) || 0);
    const np = newMap[r.key];
    const prod = products.find(p => p.id === np?.productId);
    const nQty = Number(np?.qty) || Number(r.qty) || 0;
    const nPrice = Number(prod?.price) || 0;
    s += nPrice * nQty - old;
  }
  return s;
}

// ============ 售后弹窗 ============
function AftersalesModal({ open, id, products, onClose, onDone }) {
  const [form] = Form.useForm();
  const [type, setType] = useState('repair');
  const [parts, setParts] = useState([]);   // [{ productId, spec, qty }]
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      form.resetFields();
      setType('repair');
      setParts([]);
    }
  }, [open, form]);

  const addPart = () => setParts(ps => [...ps, { productId: undefined, spec: '', qty: 1 }]);
  const updatePart = (i, field, v) => setParts(ps => ps.map((p, idx) => idx === i ? { ...p, [field]: v } : p));
  const removePart = (i) => setParts(ps => ps.filter((_, idx) => idx !== i));

  const handleOk = async () => {
    const v = await form.validateFields();
    const payload = {
      type: v.type,
      priority: v.priority || 'normal',
      title: v.title || '',
      description: v.description || '',
      handler: v.handler || '',
      cost: Number(v.cost) || 0,
      cost_type: v.cost_type || '',
      items: v.type === 'parts' ? parts.filter(p => p.productId).map(p => {
        const prod = products.find(pr => pr.id === p.productId);
        return { product_id: p.productId, product_name: prod?.name || '', spec: p.spec || prod?.spec || '', quantity: Number(p.qty) || 1 };
      }) : [],
    };
    setSubmitting(true);
    try {
      const res = await api.post(`/orders/${id}/aftersales`, payload);
      message.success(res.data?.message || '已创建');
      onDone(); onClose();
    } catch (e) { message.error(e.response?.data?.error || '操作失败'); }
    finally { setSubmitting(false); }
  };

  return (
    <Modal title="新建售后工单" open={open} onOk={handleOk} onCancel={onClose} destroyOnClose className="modal-md" okText="提交" confirmLoading={submitting}>
      <Form form={form} layout="vertical" initialValues={{ type: 'repair', priority: 'normal' }}>
        <Form.Item name="type" label="类型" rules={[{ required: true }]}>
          <Select onChange={setType} options={Object.keys(AS_TYPE).map(k => ({ value: k, label: AS_TYPE[k] }))} />
        </Form.Item>
        <Form.Item name="priority" label="优先级">
          <Select options={Object.keys(PRIORITY).map(k => ({ value: k, label: PRIORITY[k] }))} />
        </Form.Item>
        <Form.Item name="title" label="标题" rules={[{ required: true, message: '请填写标题' }]}>
          <Input placeholder="如：床头柜抽屉滑轨维修" />
        </Form.Item>
        <Form.Item name="description" label="描述">
          <Input.TextArea rows={3} placeholder="客户问题描述、处理要求等" />
        </Form.Item>
        <Form.Item name="handler" label="处理人">
          <Input placeholder="负责处理的同事" />
        </Form.Item>
        {type === 'parts' && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ marginBottom: 6, color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)' }}>补件商品</div>
            {parts.length === 0 && <Button size="small" icon={<PlusOutlined />} onClick={addPart}>添加补件</Button>}
            {parts.map((p, i) => (
              <Space key={i} style={{ display: 'flex', marginBottom: 6 }} align="baseline">
                <Select placeholder="选择商品" showSearch optionFilterProp="label" style={{ width: 220 }}
                  value={p.productId} onChange={v => updatePart(i, 'productId', v)}
                  options={products.map(pr => ({ value: pr.id, label: `${pr.name}${pr.spec ? ' ' + pr.spec : ''}` }))} />
                <Input style={{ width: 120 }} placeholder="规格" value={p.spec} onChange={e => updatePart(i, 'spec', e.target.value)} />
                <InputNumber min={1} value={p.qty} onChange={v => updatePart(i, 'qty', v == null ? 1 : v)} addonAfter="件" />
                <Button size="small" danger icon={<DeleteOutlined />} onClick={() => removePart(i)} />
                {i === parts.length - 1 && <Button size="small" icon={<PlusOutlined />} onClick={addPart}>添加</Button>}
              </Space>
            ))}
          </div>
        )}
        <Space size={12} wrap>
          <Form.Item name="cost_type" label="费用类型" style={{ marginBottom: 0 }}>
            <Select style={{ width: 140 }} options={[{ value: '', label: '无' }, { value: 'service', label: '服务费' }, { value: 'parts', label: '配件费' }]} />
          </Form.Item>
          <Form.Item name="cost" label="费用金额(¥)" style={{ marginBottom: 0 }}>
            <InputNumber min={0} prefix="¥" style={{ width: 160 }} />
          </Form.Item>
        </Space>
      </Form>
    </Modal>
  );
}
