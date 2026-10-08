import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Card, Descriptions, Table, Tag, Button, Space, Modal, Form, InputNumber,
  Input, Select, message, Popconfirm, Steps, Row, Col, Divider, Timeline, Typography,
  Grid, Tabs, Alert, Tooltip
} from 'antd';
import {
  ArrowLeftOutlined, PrinterOutlined, DollarOutlined, ShoppingCartOutlined,
  CarOutlined, CheckCircleOutlined, CloseCircleOutlined, RollbackOutlined,
  TruckOutlined, SwapOutlined, HistoryOutlined, UnlockOutlined, LinkOutlined,
  RedoOutlined, CustomerServiceOutlined
} from '@ant-design/icons';
import api from '../api';
import { formatMoney, formatMoneyInt } from '../utils/format';
import PageHeader from '../components/PageHeader';
import VoucherUploader from '../components/VoucherUploader';
import { useWarehouses } from '../context/BrandContext';
import { useAuth } from '../context/AuthContext';
import AftersalesSection from './AftersalesSection';
import SuccessCheck from '../components/SuccessCheck';

const { useBreakpoint } = Grid;
const { Text } = Typography;

const STATUS_FLOW = [
  'pending', 'deposited', 'full_paid',
  'purchasing', 'ordered',
  'arrived', 'ready',
  'balance_paid', 'special_released',
  'delivering', 'partially_delivered',
  'signed', 'completed'
];

const STATUS_LABEL = {
  pending: '待付定金', deposited: '已付定金', full_paid: '已付全款',
  purchasing: '订货中', ordered: '已订货',
  arrived: '部分到货', ready: '齐货待收',
  balance_paid: '尾款结清', special_released: '视同结清',
  delivering: '配送中', partially_delivered: '分批配送',
  signed: '已签收', completed: '已完成', cancelled: '已取消'
};

const ITEM_STATUS_MAP = {
  pending: { color: 'var(--status-todo)', label: '待订货' },
  ordered: { color: 'var(--status-stock)', label: '已订货' },
  merged: { color: 'var(--status-stock)', label: '已合并订货' },
  restocking: { color: 'var(--status-stock)', label: '补货中' },
  arrived: { color: 'var(--status-deliver)', label: '已到货' },
  delivering: { color: 'var(--status-deliver)', label: '配送中' },
  delivered: { color: 'var(--status-done)', label: '已配送' },
  signed: { color: 'var(--status-done)', label: '已签收' },
};

// 样品/赠品无需订货：pending 实为"货已在店、待配送/待赠送"，而非"待订货"
const getItemStatusView = (r) => {
  if (r.item_status === 'pending' && (r.product_type === 'sample' || r.product_type === 'gift')) {
    return r.product_type === 'gift'
      ? { color: 'var(--status-todo)', label: '待赠送' }
      : { color: 'var(--status-deliver)', label: '待送货' };
  }
  return ITEM_STATUS_MAP[r.item_status] || { color: 'var(--status-todo)', label: r.item_status || '待订货' };
};

// 订货单状态（用于关联订货单卡片展示）
const PO_STATUS = { pending: '待进货', ordered: '已订货', arrived: '已到货', cancelled: '已取消' };
const PO_STATUS_COLOR = { pending: 'var(--status-todo)', ordered: 'var(--status-stock)', arrived: 'var(--status-done)', cancelled: 'var(--status-cancel)' };

export default function OrderDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const screens = useBreakpoint();
  const isMobile = !screens.md;

  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [payModal, setPayModal] = useState({ open: false, type: '' });
  const [purchaseModal, setPurchaseModal] = useState(false);
  const [arriveModal, setArriveModal] = useState(false);
  const [deliverModal, setDeliverModal] = useState(false);
  const [rollbackModal, setRollbackModal] = useState(false);
  const [releaseModal, setReleaseModal] = useState(false);
  const [returnModal, setReturnModal] = useState({ open: false, type: '' });
  const [aftersalesModal, setAftersalesModal] = useState(false);

  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const fetchOrder = async () => {
    setLoading(true);
    try {
      const res = await api.get(`/orders/${id}`);
      setOrder(res.data);
    } catch (e) { message.error('加载订单失败'); nav('/orders'); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchOrder(); }, [id]);

  const doAction = async (url, data, msg) => {
    try {
      const res = await api.post(url, data);
      message.success(res.data?.message || msg);
      fetchOrder();
      return true;
    } catch (e) { message.error(e.response?.data?.error || '操作失败'); return false; }
  };

  if (loading || !order) return <Card loading styles={{ body: { padding: 24 } }} />;

  const statusIdx = STATUS_FLOW.indexOf(order.status);
  const currentStep = statusIdx >= 0 ? statusIdx : 0;
  const isCancelled = order.status === 'cancelled';
  const isCompleted = order.status === 'completed';
  const items = order.items || [];
  const allSample = items.every(i => i.product_type === 'sample');
  const hasOrderItems = items.some(i => i.product_type === 'order');
  const allArrived = items.filter(i => i.product_type === 'order').every(i => ['arrived','delivering','delivered','signed'].includes(i.item_status));

  // 基于单品状态的条件（不再只看订单级别状态，防止单品遗漏）
  const hasPendingOrderItems = items.some(i => i.product_type === 'order' && i.item_status === 'pending');
  const hasDeliverableItems = items.some(i =>
    ['arrived', 'delivering', 'delivered'].includes(i.item_status)
    || (i.product_type === 'sample' && i.item_status === 'pending')
    || (i.product_type === 'gift' && i.item_status === 'pending')
  );
  const hasArrivedOrReadyItems = items.some(i =>
    ['arrived', 'delivering', 'delivered', 'signed'].includes(i.item_status)
    || (i.product_type === 'sample' && i.item_status === 'pending')
  );
  const allItemsSigned = items.length > 0 && items.every(i => i.item_status === 'signed');
  const hasDispatchedDeliveries = (order.deliveries || []).some(d => d.status === 'dispatched');
  const hasPurchasesWithPendingArrive = items.some(i => i.product_type === 'order' && ['ordered','merged'].includes(i.item_status));

  const canPayBalance = ['arrived','ready'].includes(order.status) && order.payment_method !== 'full' && order.balance_amount > 0 && order.tail_payment_status !== 'confirmed';
  const canSpecialRelease = ['arrived','ready'].includes(order.status) && order.payment_method !== 'full' && order.tail_payment_status === 'pending' && order.balance_amount > 0;
  // 送货条件：单品级别有可配送项，且订单在允许送货的状态（已收款/特殊放行/齐货/纯样品），或者单品已到货且付款已完成
  const canDeliver = hasDeliverableItems && (
    ['balance_paid','special_released','ready'].includes(order.status)
    || (order.payment_method === 'full' && ['ready','arrived'].includes(order.status))
    || (allSample && !hasOrderItems && ['deposited', 'full_paid'].includes(order.status))
    // 补丁：即使订单状态不在常规区间，只要有可配送单品就允许（防止状态卡死）
    || (!['pending','cancelled','completed'].includes(order.status) && hasArrivedOrReadyItems)
  );
  const canConfirmTail = order.tail_payment_status === 'released';

  return (
    <div>
      <PageHeader
        title="订单详情"
        subtitle={order ? `订单号 ${order.order_no}` : ''}
        extra={
          <Space wrap>
            {order && <Tag color={isCancelled ? 'var(--status-cancel)' : isCompleted ? 'var(--status-done)' : 'var(--status-deliver)'}>{STATUS_LABEL[order.status] || order.status}</Tag>}
            <Button icon={<ArrowLeftOutlined />} onClick={() => nav('/orders')}>返回</Button>
            <Button icon={<PrinterOutlined />} onClick={async () => {
              try {
                const res = await api.get(`/orders/${id}/contract`, { responseType: 'blob' });
                const url = window.URL.createObjectURL(res.data);
                window.open(url, '_blank');
                setTimeout(() => window.URL.revokeObjectURL(url), 30000);
              } catch { message.error('打开合同失败'); }
            }}>合同</Button>
          </Space>
        }
      />

      {/* 步骤条 */}
      <Card size="small" style={{ marginBottom: 16, borderRadius: 8 }} styles={{ body: { padding: isMobile ? '8px 12px' : '12px 24px' } }}>
        <Steps
          size="small"
          current={isCancelled ? -1 : currentStep}
          status={isCancelled ? 'error' : 'process'}
          direction={isMobile ? 'vertical' : 'horizontal'}
          items={[
            { title: '开单' },
            { title: '付款' },
            { title: '订货' },
            { title: '到货' },
            { title: '收款' },
            { title: '送货' },
            { title: '签收' },
            { title: '完工' },
          ]}
        />
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={24} md={16}>
          {/* 订单信息 */}
          <Card size="small" title="订单信息" style={{ marginBottom: 16, borderRadius: 8 }}>
            <Descriptions size="small" column={isMobile ? 1 : 3} colon={false}>
              <Descriptions.Item label="客户">{order.customer_name}</Descriptions.Item>
              <Descriptions.Item label="电话">{order.customer_phone || '-'}</Descriptions.Item>
              <Descriptions.Item label="地址">{order.customer_address || '-'}</Descriptions.Item>
              <Descriptions.Item label="支付方式">{order.payment_method === 'full' ? '全款' : '定金'}</Descriptions.Item>
              <Descriptions.Item label="订单总价"><span className="money">{formatMoney(order.total_amount || 0)}</span></Descriptions.Item>
              <Descriptions.Item label="已收定金"><span className="money">{formatMoney(order.deposit_amount || 0)}</span></Descriptions.Item>
              <Descriptions.Item label="待收尾款">
                <Text type={order.balance_amount > 0 ? 'danger' : 'success'}>
                  <span className="money">{formatMoney(order.balance_amount || 0)}</span>
                  {order.tail_payment_status === 'released' && <Tag color="var(--status-paid)" style={{ marginLeft: 6 }}>已放行</Tag>}
                  {order.tail_payment_status === 'confirmed' && <Tag color="var(--status-paid)" style={{ marginLeft: 6 }}>已实收</Tag>}
                </Text>
              </Descriptions.Item>
              <Descriptions.Item label="导购">{order.salesperson_name || '-'}</Descriptions.Item>
              <Descriptions.Item label="送货日期">{order.delivery_date || '待定'}</Descriptions.Item>
              <Descriptions.Item label="送货模式">{order.delivery_mode === 'batch' ? '分批' : '整单'}</Descriptions.Item>
            </Descriptions>
            {order.note && <Alert message={`备注: ${order.note}`} type="info" style={{ marginTop: 8 }} />}
            {canConfirmTail && (
              <Alert message="尾款已放行但未实收，请提醒客户补交尾款" type="warning" showIcon style={{ marginTop: 8 }}
                action={<Button onClick={() => doAction(`/orders/${id}/confirm-tail`, {}, '尾款实收已确认')}>确认实收</Button>} />
            )}
          </Card>

          {/* 商品明细 */}
          <Card size="small" title="商品明细" style={{ marginBottom: 16, borderRadius: 8 }}>
            <Table dataSource={items} rowKey="id" size="small" pagination={false}
              columns={[
                { title: '商品', dataIndex: 'product_name', width: 104 },
                { title: '型号', dataIndex: 'product_model', width: 72 },
                { title: '规格', dataIndex: 'spec', width: 64 },
                { title: '类型', dataIndex: 'product_type', width: 64, render: v => ({
                  sample: '样品', order: '订货', gift: '赠品'
                })[v] || v },
                { title: '数量', dataIndex: 'quantity', width: 48 },
                { title: '单价', dataIndex: 'unit_price', width: 72, render: v => <span className="money">{formatMoneyInt(v||0)}</span> },
                { title: '小计', dataIndex: 'total_price', width: 72, render: v => <span className="money">{formatMoneyInt(v||0)}</span> },
                { title: '到手价', dataIndex: 'final_price', width: 96, render: (v, r) => {
                  const fp = Number(r.final_price) || 0;
                  const be = Number(r.break_even_price) || 0;
                  const loss = be > 0 && fp < be;
                  return (
                    <span>
                      <span style={{ color: loss ? 'var(--color-error)' : undefined, fontWeight: loss ? 600 : 400 }}>¥{fp.toFixed(2)}</span>
                      {loss && <Tag color="red" style={{ marginLeft: 4, fontSize: 12, lineHeight: '16px' }}>亏损</Tag>}
                    </span>
                  );
                } },
                { title: '状态', key: 'item_status', width: 104, render: (_, r) => {
                  const s = getItemStatusView(r);
                  return <Tag color={s.color} style={{ fontSize: 12 }}>{s.label}</Tag>;
                }},
                { title: '到货', dataIndex: 'allocated', width: 64, render: (v, r) => r.product_type === 'order' ? `${v || 0}/${r.quantity}` : '-' },
              ]} />
          </Card>

          {/* 关联订货单：销售单 → 订货单 双向打通 */}
          {(order.purchases || []).length > 0 && (
            <Card size="small" title="关联订货单" style={{ marginBottom: 16, borderRadius: 8 }}>
              <Space direction="vertical" style={{ width: '100%' }} size={10}>
                {order.purchases.map(po => (
                  <div key={po.id} style={{ border: '1px solid var(--color-border)', borderRadius: 8, padding: '10px 12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <span style={{ fontWeight: 600 }}>{po.po_no}</span>
                      <Tag color={PO_STATUS_COLOR[po.status] || 'default'}>{PO_STATUS[po.status] || po.status}</Tag>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginBottom: 8 }}>
                      金额 <span className="money">{formatMoneyInt(po.total_amount || 0)}</span> · 到货 {po.arrived_qty || 0}/{po.total_qty || 0}
                    </div>
                    <Button size="small" type="link" icon={<LinkOutlined />} style={{ paddingLeft: 0 }}
                      onClick={() => nav(`/purchases?po=${po.id}`)}>打开订货单</Button>
                  </div>
                ))}
              </Space>
            </Card>
          )}

          {/* 送货记录 */}
          {(order.deliveries || []).length > 0 && (
            <Card size="small" title="送货记录" style={{ marginBottom: 16, borderRadius: 8 }}>
              <Table dataSource={order.deliveries} rowKey="id" size="small" pagination={false}
                columns={[
                  { title: '送货单号', dataIndex: 'batch_no', width: 120 },
                  { title: '类型', dataIndex: 'delivery_type', width: 64, render: v => v === 'full' ? '整单' : '分批' },
                  { title: '状态', dataIndex: 'status', width: 72, render: v => <Tag>{v === 'signed' ? '已签收' : v === 'dispatched' ? '已派单' : v}</Tag> },
                  { title: '日期', dataIndex: 'delivery_date', width: 88 },
                  { title: '师傅', dataIndex: 'delivery_person', width: 72 },
                  { title: '电话', dataIndex: 'delivery_phone', width: 104 },
                  { title: '签收', dataIndex: 'signature_status', width: 64, render: v => v === 'signed' ? '已签' : '-' },
                  { title: '送货单', width: 72, align: 'center',
                    render: (_, r) => <a onClick={async () => {
                      try {
                        const res = await api.get(`/orders/${order.id}/delivery-note/${r.id}`, { responseType: 'blob' });
                        const url = window.URL.createObjectURL(res.data);
                        window.open(url, '_blank');
                        setTimeout(() => window.URL.revokeObjectURL(url), 30000);
                      } catch { message.error('打开送货单失败'); }
                    }}
                      style={{ color: 'var(--color-primary)', fontWeight: 500 }}>查看/打印</a> },
                ]} />
            </Card>
          )}

          {/* 支付记录 */}
          <Card size="small" title="支付记录" style={{ marginBottom: 16, borderRadius: 8 }}>
            <Table dataSource={order.payments || []} rowKey="id" size="small" pagination={false}
              columns={[
                { title: '类型', dataIndex: 'payment_type', width: 64, render: v => ({ deposit: '定金', balance: '尾款', full: '全款' })[v] || v },
                { title: '金额', dataIndex: 'amount', width: 104, render: () => formatMoney(order?.actual_amount) },
                { title: '方式', dataIndex: 'payment_method', width: 72, render: v => ({ deposit: '定金', full: '全款' })[v] || v },
                { title: '操作人', dataIndex: 'operator_name', width: 72 },
                { title: '备注', dataIndex: 'note', width: 120, ellipsis: { showTitle: false }, render: v => v ? <Tooltip title={v}>{v}</Tooltip> : '-' },
                { title: '时间', dataIndex: 'created_at', width: 152, render: v => v ? v.slice(0, 19) : '-' },
              ]} />
          </Card>

          {/* 操作日志 */}
          {(order.logs || []).length > 0 && (
            <Card size="small" title="操作日志" style={{ marginBottom: 16, borderRadius: 8 }}>
              <Timeline items={(order.logs || []).slice(0, 20).map(l => ({
                children: <span>
                  <Text type="secondary">{l.created_at?.slice(0, 19)}</Text>
                  &nbsp;<Tag>{l.action}</Tag>
                  &nbsp;{l.operator_name} {l.reason && `· ${l.reason}`}
                  {l.old_status && <> · {STATUS_LABEL[l.old_status] || l.old_status} → {STATUS_LABEL[l.new_status] || l.new_status}</>}
                </span>
              }))} />
            </Card>
          )}

          {/* 退换与售后（集成到订单详情，仅管理员可发起/打印，查看对相关人员开放） */}
          <AftersalesSection id={id} order={order} isAdmin={isAdmin}
            returnModal={returnModal} setReturnModal={setReturnModal}
            aftersalesModal={aftersalesModal} setAftersalesModal={setAftersalesModal}
            onChanged={fetchOrder} />
        </Col>

        {/* 右侧操作栏 */}
        <Col xs={24} md={8}>
          <Card size="small" title="流程操作" style={{ marginBottom: 16, borderRadius: 8, position: 'sticky', top: 12 }}>
            <Space direction="vertical" style={{ width: '100%' }} size={8}>
              {order.status === 'pending' && (
                <Button icon={<DollarOutlined />} type="primary" block onClick={() => setPayModal({ open: true, type: 'deposit' })}>支付定金</Button>
              )}

              {/* 基于单品状态：只要存在待订货的订货商品，就显示进货按钮 */}
              {hasPendingOrderItems && !['cancelled','completed'].includes(order.status) && (
                <Button icon={<ShoppingCartOutlined />} type="primary" block onClick={() => setPurchaseModal(true)}>开始进货</Button>
              )}

              {/* 到货录入：有进货记录 且 存在已订货/已合并的单品 */}
              {(order.purchases || []).length > 0 && hasPurchasesWithPendingArrive && (
                <Button icon={<CheckCircleOutlined />} block onClick={() => setArriveModal(true)}>到货录入</Button>
              )}

              {canPayBalance && (
                <Button icon={<DollarOutlined />} block onClick={() => setPayModal({ open: true, type: 'balance' })}>收取尾款</Button>
              )}

              {canSpecialRelease && (
                <Button icon={<UnlockOutlined />} type="dashed" block onClick={() => setReleaseModal(true)}>特殊放行</Button>
              )}

              {canDeliver && (
                <Button icon={<CarOutlined />} type="primary" block onClick={() => setDeliverModal(true)}>发起送货</Button>
              )}

              {/* 确认签收：只要有已派送的送货单 */}
              {hasDispatchedDeliveries && (
                <Button icon={<CheckCircleOutlined />} block onClick={() => setPayModal({ open: true, type: 'sign' })}>确认签收</Button>
              )}

              {!['completed', 'cancelled'].includes(order.status) && (
                <>
                  <Button icon={<RollbackOutlined />} danger block onClick={() => setRollbackModal(true)}>逐级回退</Button>
                  <Popconfirm title="确认取消此订单？" onConfirm={() => doAction(`/orders/${id}/cancel`, {}, '订单已取消')}>
                    <Button icon={<CloseCircleOutlined />} danger block>取消订单</Button>
                  </Popconfirm>
                </>
              )}

              {/* 完工归档：所有单品均已签收 */}
              {allItemsSigned && order.status !== 'completed' && (
                <Button icon={<CheckCircleOutlined />} type="primary" block onClick={() => doAction(`/orders/${id}/complete`, {}, '订单已完工')}>完工归档</Button>
              )}

              {/* 退换与售后：仅管理员，且订单已签收/已完成 */}
              {isAdmin && ['signed', 'completed'].includes(order.status) && (
                <>
                  <Divider style={{ margin: '4px 0' }} plain>退换与售后</Divider>
                  <Button icon={<RedoOutlined />} block onClick={() => setReturnModal({ open: true, type: 'return' })}>退货</Button>
                  <Button icon={<SwapOutlined />} block onClick={() => setReturnModal({ open: true, type: 'exchange' })}>换货</Button>
                  <Button icon={<CustomerServiceOutlined />} block onClick={() => setAftersalesModal(true)}>售后</Button>
                </>
              )}
            </Space>
          </Card>
        </Col>
      </Row>

      {/* 付款/签收弹窗 */}
      <PayModal id={id} open={payModal} onClose={() => setPayModal({ open: false, type: '' })} onDone={fetchOrder} order={order} />

      {/* 进货弹窗 */}
      <PurchaseModal id={id} open={purchaseModal} onClose={() => setPurchaseModal(false)} onDone={fetchOrder}
        items={items.filter(i => i.product_type === 'order' && ['pending'].includes(i.item_status))} />

      {/* 到货弹窗 */}
      <ArriveModal id={id} open={arriveModal} onClose={() => setArriveModal(false)} onDone={fetchOrder}
        items={items.filter(i => i.product_type === 'order' && ['ordered','merged'].includes(i.item_status))} />

      {/* 送货弹窗 */}
      <DeliverModal id={id} open={deliverModal} onClose={() => setDeliverModal(false)} onDone={fetchOrder}
        items={items.filter(i => ['arrived', 'delivering', 'delivered'].includes(i.item_status) || (i.product_type === 'sample' && i.item_status === 'pending') || (i.product_type === 'gift' && i.item_status === 'pending'))} order={order} />

      {/* 回退弹窗 */}
      <RollbackModal id={id} currentStatus={order.status} open={rollbackModal} onClose={() => setRollbackModal(false)} onDone={fetchOrder} />

      {/* 特殊放行弹窗 */}
      <ReleaseModal id={id} open={releaseModal} onClose={() => setReleaseModal(false)} onDone={fetchOrder} />
    </div>
  );
}

// ----- 付款/签收弹窗 -----
function PayModal({ id, open, onClose, onDone, order }) {
  const [form] = Form.useForm();
  const [signLoading, setSignLoading] = useState(false);
  const [signed, setSigned] = useState(false);

  // 每次打开弹窗重置成功态
  useEffect(() => { if (open.open) setSigned(false); }, [open.open]);

  const handleOk = async () => {
    if (open.type === 'sign') {
      // 签收：自动签收所有已派送的送货单
      setSignLoading(true);
      try {
        const dispatched = (order?.deliveries || []).filter(d => d.status === 'dispatched');
        if (dispatched.length === 0) {
          message.warning('没有待签收的送货单');
          setSignLoading(false);
          return;
        }
        for (const d of dispatched) {
          await api.post(`/orders/${id}/sign`, { delivery_id: d.id });
        }
        // 先展示签收成功打勾动画，短暂停留后再关闭并刷新
        setSigned(true);
        setTimeout(() => { onDone(); onClose(); }, 1000);
      } catch (e) { message.error(e.response?.data?.error || '签收失败'); }
      finally { setSignLoading(false); }
      return;
    }
    const v = await form.validateFields();
    const url = open.type === 'deposit' ? `/orders/${id}/pay-deposit` : `/orders/${id}/pay-balance`;
    try {
      const res = await api.post(url, v);
      message.success(res.data?.message || '操作成功');
      onDone(); onClose();
    } catch (e) { message.error(e.response?.data?.error || '操作失败'); }
  };

  const isSign = open.type === 'sign';
  const dispatchedCount = (order?.deliveries || []).filter(d => d.status === 'dispatched').length;

  return (
    <Modal
      className="modal-md"
      title={isSign ? '确认签收' : open.type === 'deposit' ? '支付定金' : '收取尾款'}
      open={open.open} onOk={handleOk} onCancel={onClose} destroyOnClose
      confirmLoading={signLoading}
      okText={isSign ? '确认签收' : '确定'}
      okButtonProps={{ style: { display: signed ? 'none' : undefined } }}
    >
      {signed ? (
        <SuccessCheck />
      ) : isSign ? (
        <div style={{ padding: '16px 0' }}>
          <p>将签收以下 <strong>{dispatchedCount}</strong> 个已派送的送货单：</p>
          {(order?.deliveries || []).filter(d => d.status === 'dispatched').map(d => (
            <Tag key={d.id} color="blue" style={{ marginBottom: 4 }}>{d.batch_no}</Tag>
          ))}
          {dispatchedCount === 0 && <p style={{ color: 'var(--color-text-tertiary)' }}>暂无待签收的送货单</p>}
        </div>
      ) : (
        <Form form={form} layout="vertical">
          <Form.Item name="amount" label="金额" rules={[{ required: true }]}><InputNumber min={0} prefix="¥" style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="payment_method" label="支付方式" initialValue="现金"><Input /></Form.Item>
          <Form.Item name="note" label="备注"><Input.TextArea rows={2} /></Form.Item>
        </Form>
      )}
    </Modal>
  );
}

// ----- 进货弹窗 -----
function PurchaseModal({ id, open, onClose, onDone, items }) {
  const [rows, setRows] = useState([]);
  const [selectedKeys, setSelectedKeys] = useState([]);
  const [warehouse, setWarehouse] = useState('');
  const [mergeGroup, setMergeGroup] = useState('');
  const [paymentVoucher, setPaymentVoucher] = useState([]);
  const warehouses = useWarehouses();

  // 每次打开时，根据待订货明细初始化可编辑行（显示型号/规格、可订数量、当前进价）
  useEffect(() => {
    if (!open) return;
    const init = (items || []).map(it => {
      const maxQty = Math.max(0, (Number(it.quantity) || 0) - (Number(it.allocated) || 0));
      return {
        key: it.id,
        order_item_id: it.id,
        product_id: it.product_id,
        product_name: it.product_name,
        product_model: it.product_model || '',
        spec: it.spec || '',
        brand: it.brand || '',
        product_type: it.product_type,
        maxQty,
        qty: maxQty,
        price: Number(it.cost_price) || 0,
      };
    });
    setRows(init);
    setSelectedKeys(init.map(r => r.key));
    setWarehouse(warehouses[0] || '');
    setMergeGroup('');
    setPaymentVoucher([]);
  }, [open, warehouses]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateRow = (key, field, value) =>
    setRows(prev => prev.map(r => (r.key === key ? { ...r, [field]: value } : r)));

  const handleOk = async () => {
    const selected = rows.filter(r => selectedKeys.includes(r.key) && Number(r.qty) > 0);
    if (selected.length === 0) {
      message.warning('请至少勾选一项并填写进货数量');
      return;
    }
    const payloadItems = selected.map(r => ({
      order_item_id: r.order_item_id,
      product_id: r.product_id,
      product_name: r.product_name,
      model: r.product_model,
      spec: r.spec,
      brand: r.brand,
      quantity: Number(r.qty),
      unit_price: Number(r.price) || 0,
    }));
    try {
      const res = await api.post(`/orders/${id}/start-purchase`, {
        items: payloadItems,
        arrival_warehouse: warehouse,
        merge_group: mergeGroup || '',
        payment_voucher: paymentVoucher.join(','),
      });
      message.success(res.data?.message || '订货单已创建');
      onDone(); onClose();
    } catch (e) { message.error(e.response?.data?.error || '操作失败'); }
  };

  if ((items || []).length === 0) {
    return (
      <Modal title="开始进货" open={open} onCancel={onClose} footer={null}>
        <Alert message="没有待订货的商品" type="info" showIcon />
      </Modal>
    );
  }

  const columns = [
    { title: '商品', dataIndex: 'product_name', render: (v, r) => (
        <div>
          <div style={{ fontWeight: 500 }}>{v}</div>
          <Tag color={r.product_type === 'sample' ? 'green' : 'orange'} style={{ marginTop: 2 }}>
            {r.product_type === 'sample' ? '样品' : '订货'}
          </Tag>
        </div>
      ) },
    { title: '型号 / 规格', key: 'spec', render: (_, r) => (
        <div style={{ fontSize: 'var(--font-size-sm)', lineHeight: 1.5 }}>
          {r.product_model ? <div>型号：{r.product_model}</div> : null}
          <div>规格：{r.spec || '-'}</div>
        </div>
      ) },
    { title: '可订', dataIndex: 'maxQty', width: 64, align: 'center' },
    { title: '本次进货数量', key: 'qty', width: 130, render: (_, r) => (
        <InputNumber min={0} max={r.maxQty} value={r.qty}
          onChange={v => updateRow(r.key, 'qty', v == null ? 0 : v)}
          style={{ width: '100%' }} />
      ) },
    { title: '进货单价(¥)', key: 'price', width: 140, render: (_, r) => (
        <InputNumber min={0} prefix="¥" value={r.price}
          onChange={v => updateRow(r.key, 'price', v == null ? 0 : v)}
          style={{ width: '100%' }} placeholder="最新进价" />
      ) },
  ];

  return (
    <Modal className="modal-lg" title="开始进货" open={open} onOk={handleOk} onCancel={onClose}
      destroyOnClose okText="生成订货单">
      <Alert type="info" showIcon style={{ marginBottom: 12 }}
        message="勾选需要进货的商品，填写本次进货数量与最新进货单价。进货单价用于财务核算该订单利润（不再修改商品管理的进价），并可作为付款凭证留存。" />
      <Table rowKey="key" size="small" pagination={false}
        rowSelection={{ selectedRowKeys: selectedKeys, onChange: setSelectedKeys }}
        dataSource={rows} columns={columns} scroll={{ y: 320 }} />
      <div style={{ marginTop: 16 }}>
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          <div>
            <div style={{ marginBottom: 6, color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)' }}>到货仓库</div>
            <Select value={warehouse} style={{ width: 240 }} onChange={setWarehouse}
              options={warehouses.map(w => ({ value: w, label: w }))} />
          </div>
          <div>
            <div style={{ marginBottom: 6, color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)' }}>合并订货分组（同组商品可跨单合并采购，留空则独立订货）</div>
            <Input placeholder="输入分组名，留空则独立订货" value={mergeGroup}
              onChange={e => setMergeGroup(e.target.value)} style={{ maxWidth: 360 }} />
          </div>
        </Space>
      </div>
      <div style={{ marginTop: 16 }}>
        <div style={{ marginBottom: 6, color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)' }}>财务付款凭证（上传后自动压缩至 100KB 以内）</div>
        <VoucherUploader value={paymentVoucher} onChange={setPaymentVoucher} />
      </div>
    </Modal>
  );
}

// ----- 到货弹窗 -----
function ArriveModal({ id, open, onClose, onDone, items }) {
  const handleArrive = async (itemId) => {
    try {
      await api.post(`/orders/${id}/arrive`, {
        allocations: [{ order_item_id: itemId, quantity: items.find(i => i.id === itemId).quantity }],
      });
      message.success('到货处理完成');
      onDone(); onClose();
    } catch (e) { message.error(e.response?.data?.error || '操作失败'); }
  };

  return (
    <Modal className="modal-sm" title="到货录入" open={open} onCancel={onClose} footer={null}>
      {items.length === 0 ? <Alert message="没有待到货的商品" type="info" showIcon /> : (
        <Table dataSource={items} rowKey="id" size="small" pagination={false}
          columns={[
            { title: '商品', dataIndex: 'product_name' },
            { title: '订货量', dataIndex: 'quantity' },
            { title: '已到', dataIndex: 'allocated' },
            { title: '操作', key: 'act', render: (_, r) => (
              <Button type="primary" onClick={() => handleArrive(r.id)}
                disabled={r.allocated >= r.quantity}>确认到货</Button>
            )},
          ]} />
      )}
    </Modal>
  );
}

// ----- 送货弹窗 -----
function DeliverModal({ id, open, onClose, onDone, items, order }) {
  const [form] = Form.useForm();
  const [deliveryType, setDeliveryType] = useState('full');
  const [persons, setPersons] = useState([]);
  // 弹窗打开时拉取配送师傅列表
  useEffect(() => {
    if (open) {
      api.get('/delivery-persons').then(res => {
        setPersons(res.data?.data || []);
      }).catch((err) => { console.error('加载送货人列表失败', err); message.error('加载送货人列表失败'); });
    }
  }, [open]);

  const handleOk = async () => {
    const v = await form.validateFields();
    try {
      const res = await api.post(`/orders/${id}/deliver`, {
        delivery_type: deliveryType,
        delivery_date: v.delivery_date || null,
        delivery_person: v.delivery_person,
        delivery_phone: v.delivery_phone,
        item_ids: deliveryType === 'batch' ? v.item_ids : undefined,
        note: v.note,
      });
      message.success(res.data?.message || '配送已发起，送货单已生成');
      onDone();
      onClose();
    } catch (e) { message.error(e.response?.data?.error || '操作失败'); }
  };

  // 选择配送师傅时自动填充姓名和电话
  const handlePersonSelect = (personId) => {
    if (!personId) {
      form.setFieldsValue({ delivery_person: '', delivery_phone: '' });
      return;
    }
    const p = persons.find(x => x.id === personId);
    if (p) {
      form.setFieldsValue({ delivery_person: p.name, delivery_phone: p.phone || '' });
    }
  };

  if (items.length === 0) {
    return (
      <Modal title="发起送货" open={open} onCancel={onClose} footer={null}>
        <Alert message="没有已到货的商品可配送" type="warning" showIcon />
      </Modal>
    );
  }

  return (
    <Modal className="modal-md" title="发起送货" open={open} onOk={handleOk} onCancel={onClose} destroyOnClose>
      <Form form={form} layout="vertical">
        <Form.Item label="送货模式">
          <Select value={deliveryType} onChange={setDeliveryType} options={[
            { value: 'full', label: '整单送货' }, { value: 'batch', label: '分批送货' }
          ]} />
        </Form.Item>

        {deliveryType === 'batch' && (
          <Form.Item name="item_ids" label="选择配送商品" rules={[{ required: true }]}>
            <Select mode="multiple" placeholder="勾选已到货商品">
              {items.map(it => <Select.Option key={it.id} value={it.id}>{it.product_name} ×{it.quantity}</Select.Option>)}
            </Select>
          </Form.Item>
        )}

        <Row gutter={[16, 16]}>
          <Col span={12}>
            <Form.Item name="delivery_date" label="配送日期">
              <Input type="date" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item label="选择师傅">
              <Select
                allowClear
                showSearch
                placeholder="选择或搜索师傅"
                optionFilterProp="label"
                onChange={handlePersonSelect}
                options={persons.map(p => ({
                  value: p.id,
                  label: `${p.name}${p.phone ? ' · ' + p.phone : ''}`,
                }))}
              />
            </Form.Item>
          </Col>
        </Row>
        <Row gutter={[16, 16]}>
          <Col span={12}>
            <Form.Item name="delivery_person" label="配送师傅" rules={[{ required: true, message: '请输入或选择师傅' }]}>
              <Input placeholder="如：张师傅" maxLength={20} />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="delivery_phone" label="师傅电话">
              <Input placeholder="如：13800138000" maxLength={20} />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item name="note" label="备注"><Input.TextArea rows={2} /></Form.Item>

        <Alert message="以下商品将加入配送" type="info" showIcon style={{ marginBottom: 8 }}
          description={items.map(i => i.product_name).join(', ')} />
        <Alert message="未到货商品禁止加入送货单" type="warning" showIcon />
      </Form>
    </Modal>
  );
}

// ----- 回退弹窗 -----
function RollbackModal({ id, currentStatus, open, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const currentIdx = STATUS_FLOW.indexOf(currentStatus);
  const prevStatus = currentIdx > 0 ? STATUS_FLOW[currentIdx - 1] : null;

  const handleRollback = async () => {
    if (!prevStatus) return message.error('无法回退');
    try {
      const res = await api.post(`/orders/${id}/rollback`, { target_node: prevStatus, reason });
      message.success(res.data?.message || '回退申请已提交');
      onDone(); onClose();
    } catch (e) { message.error(e.response?.data?.error || '操作失败'); }
  };

  return (
    <Modal className="modal-md" title="逐级回退" open={open} onCancel={onClose} onOk={handleRollback} okText="确认回退" okButtonProps={{ danger: true }}>
      {!prevStatus ? (
        <Alert message="当前状态无法回退" type="error" showIcon />
      ) : (
        <>
          <p>当前状态: <Tag>{STATUS_LABEL[currentStatus]}</Tag></p>
          <p>回退至: <Tag color="var(--status-todo)">{STATUS_LABEL[prevStatus]}</Tag></p>
          <Alert message="禁止跨节点回退，仅可回退到上一节点" type="warning" showIcon style={{ marginBottom: 12 }} />
          <Input.TextArea placeholder="回退原因（必填）" rows={3} value={reason} onChange={e => setReason(e.target.value)} />
          <p style={{ marginTop: 8, color: 'var(--color-text-tertiary)', fontSize: 12 }}>注：店长可直接执行，普通员工需提交审批</p>
        </>
      )}
    </Modal>
  );
}

// ----- 特殊放行弹窗 -----
function ReleaseModal({ id, open, onClose, onDone }) {
  const [reason, setReason] = useState('');

  const handleRelease = async () => {
    try {
      const res = await api.post(`/orders/${id}/special-release`, { reason });
      message.success(res.data?.message || '已放行');
      onDone(); onClose();
    } catch (e) { message.error(e.response?.data?.error || '操作失败'); }
  };

  return (
    <Modal className="modal-md" title="特殊尾款放行" open={open} onCancel={onClose} onOk={handleRelease} okText="确认放行">
      <Alert message="标记后解除全部配送限制，可提前送货安装" type="warning" showIcon style={{ marginBottom: 12 }} />
      <Input.TextArea placeholder="放行原因" rows={3} value={reason} onChange={e => setReason(e.target.value)} />
    </Modal>
  );
}
