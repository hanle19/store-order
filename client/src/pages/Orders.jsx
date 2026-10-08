import { TABLE_SCROLL_X } from '../components/tableConstants';
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Table, Tag, Button, Select, Input, Space, Modal, Form, InputNumber,
  DatePicker, Popconfirm, message, Segmented, Calendar,
  Drawer, Row, Col, Typography, Grid, Pagination
} from 'antd';
import {
  PlusOutlined, SearchOutlined, DeleteOutlined, EditOutlined, EyeOutlined,
  UnorderedListOutlined, AppstoreOutlined, CalendarOutlined,
  ShoppingCartOutlined, UserOutlined, PhoneOutlined, EnvironmentOutlined,
  ClockCircleOutlined, DollarOutlined, FileTextOutlined,
  GiftOutlined, ExperimentOutlined, CheckCircleOutlined, CrownOutlined, DownOutlined
} from '@ant-design/icons';
import dayjs from 'dayjs';
import api from '../api';
import { useStore } from '../context/StoreContext';
import { formatMoney, formatMoneyInt } from '../utils/format';
import ExcelImportExport from '../components/ExcelImportExport';
import PageHeader from '../components/PageHeader';
import FilterBar from '../components/FilterBar';
import EmptyState from '../components/EmptyState';
import { useTheme } from '../context/ThemeContext';
import { fireConfetti } from '../components/Confetti';
import { ORDER_STATUS_MAP as STATUS_MAP } from './Orders.constants.js';

const { useBreakpoint } = Grid;
const { Text, Title } = Typography;

// 状态强调色直接取 STATUS_MAP 的语义令牌（var(--status-*)），不再以颜色字符串当枚举键
const VIEWS = [
  { value: 'list', icon: <UnorderedListOutlined />, label: '列表' },
  { value: 'card', icon: <AppstoreOutlined />, label: '卡片' },
  { value: 'calendar', icon: <CalendarOutlined />, label: '日历' },
];

export default function Orders() {
  const [orders, setOrders] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState(null);
  const [search, setSearch] = useState('');
  const [view, setView] = useState('list');
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingOrder, setEditingOrder] = useState(null);
  const [salespersons, setSalespersons] = useState([]);
  const [searchParams, setSearchParams] = useSearchParams();
  const [salespersonFilter, setSalespersonFilter] = useState(searchParams.get('salesperson_id') || null);
  const screens = useBreakpoint();
  const isMobile = !screens.md;
  const { storeId, getStoreParam } = useStore();

  useEffect(() => {
    api.get('/users/salespersons').then(r => setSalespersons(r.data || [])).catch((err) => { console.error('加载导购列表失败', err); message.error('加载导购列表失败'); });
  }, []);

  // 请求序号：快速切换筛选时，先发出的慢请求回来后不得覆盖后发请求的结果（竞态防护）
  const ordersReqSeq = useRef(0);
  // override：允许用「即将生效但尚未进入 state」的关键词立即查询
  // （点 × 清空搜索时 search 还是旧值，必须显式传空串）
  const fetchOrders = useCallback(async (override) => {
    const seq = ++ordersReqSeq.current;
    const kw = override !== undefined ? override : search;
    setLoading(true);
    try {
      const params = { page, page_size: 20 };
      if (statusFilter) params.status = statusFilter;
      if (kw) params.customer = kw;
      if (salespersonFilter) params.salesperson_id = salespersonFilter;
      const sid = getStoreParam(); if (sid) params.store_id = sid;
      const res = await api.get('/orders', { params });
      if (seq !== ordersReqSeq.current) return; // 已有更新的请求，丢弃本次结果
      setOrders(res.data.data || []);
      setTotal(res.data.total || 0);
    } catch (e) {
      if (seq !== ordersReqSeq.current) return;
      message.error('加载订单失败');
    } finally {
      if (seq === ordersReqSeq.current) setLoading(false);
    }
  }, [page, statusFilter, search, salespersonFilter, storeId]);

  useEffect(() => { fetchOrders(); }, [page, statusFilter, salespersonFilter, storeId]);

  const handleDelete = useCallback(async (id) => {
    try {
      await api.delete(`/orders/${id}`);
      message.success('已删除');
      fetchOrders();
    } catch (e) { message.error(e.response?.data?.error || '删除失败'); }
  }, [fetchOrders]);

  const handleCreate = () => {
    setEditingOrder(null);
    setEditModalOpen(true);
  };

  const handleEdit = useCallback(async (order) => {
    try {
      message.loading({ content: '加载订单详情...', key: 'editLoad' });
      const res = await api.get(`/orders/${order.id}`);
      message.destroy('editLoad');
      setEditingOrder(res.data);
      setEditModalOpen(true);
    } catch (e) {
      message.destroy('editLoad');
      message.error('加载订单详情失败');
    }
  }, []);

  const handleSave = async (values) => {
    try {
      const payload = { ...values };
      if (editingOrder) {
        await api.put(`/orders/${editingOrder.id}`, payload);
        message.success('订单已更新');
      } else {
        await api.post('/orders', payload);
        message.success('下单成功');
        fireConfetti();
      }
      setEditModalOpen(false);
      fetchOrders();
    } catch (e) { message.error(e.response?.data?.error || '操作失败'); }
  };

  // 日历视图数据
  const calendarOrders = useMemo(() => {
    const map = {};
    for (const o of orders) {
      if (o.delivery_date) {
        const key = o.delivery_date.slice(0, 10);
        if (!map[key]) map[key] = [];
        map[key].push(o);
      }
    }
    return map;
  }, [orders]);

  const nav = useNavigate();

  // ----- 列表视图 -----
  const listColumns = useMemo(() => [
    { title: '订单号', dataIndex: 'order_no', width: 152, align: 'left', render: (v, r) => (
      <a onClick={() => nav(`/orders/${r.id}`)} style={{ fontWeight: 600 }}>{v}</a>
    )},
    { title: '客户', dataIndex: 'customer_name', width: 120, ellipsis: true, align: 'left', render: v => <span style={{ fontWeight: 500 }}>{v}</span> },
    { title: '商品', key: 'goods', width: 220, ellipsis: true, align: 'left', render: (_, r) => {
      const items = r.items || [];
      if (items.length === 0) return <span style={{ color: 'var(--color-text-tertiary)' }}>—</span>;
      const first = items[0];
      return (
        <span style={{ fontWeight: 500, color: 'var(--color-text)' }}
          title={items.map(it => `${it.product_name || '未命名'}${it.product_model ? ' ' + it.product_model : ''}${it.spec ? '·' + it.spec : ''} ×${it.quantity}`).join('\n')}>
          {first.product_name || '未命名'}
          <span style={{ color: 'var(--color-text-tertiary)', fontWeight: 400, marginLeft: 4 }}>×{first.quantity}</span>
          {items.length > 1 && <span style={{ color: 'var(--color-primary)', fontWeight: 500, marginLeft: 4, fontSize: 12 }}>等{items.length}件 ▾</span>}
        </span>
      );
    }},
    { title: '电话', dataIndex: 'customer_phone', width: 120, ellipsis: true, align: 'left',
      responsive: isMobile ? ['md'] : undefined,
      render: v => v || '-' },
    { title: '金额', dataIndex: 'actual_amount', width: 104, align: 'right',
      render: (v, r) => <span className="money" style={{ fontWeight: 700, color: 'var(--color-primary-deep)', fontSize: 14 }}>¥{(Number(r.actual_amount ?? r.total_amount ?? 0)).toLocaleString()}</span> },
    { title: '定金', dataIndex: 'deposit_amount', width: 88, align: 'right',
      responsive: isMobile ? ['md'] : undefined,
      render: (v, r) => r.payment_method === 'full'
        ? <Tag color="var(--status-paid)" style={{ margin: 0, borderRadius: 'var(--radius-md)', padding: '2px 10px', lineHeight: '22px', fontWeight: 550, fontSize: 12 }}>全款</Tag>
        : <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--color-text-secondary)' }}>¥{(v||0).toLocaleString()}</span> },
    { title: '状态', dataIndex: 'status', width: 104, align: 'center', render: v => {
      const s = STATUS_MAP[v] || { color: 'default', label: v };
      return <Tag key={v} className="status-tag-pop" color={s.color} style={{ margin: 0, borderRadius: 'var(--radius-md)', padding: '2px 10px', lineHeight: '22px', fontWeight: 550, fontSize: 12 }}>{s.label}</Tag>;
    }},
    { title: '导购', dataIndex: 'salesperson_name', width: 72, ellipsis: true, align: 'center',
      responsive: isMobile ? ['md'] : undefined },
    { title: '时间', dataIndex: 'created_at', width: 104, align: 'center',
      responsive: isMobile ? ['md'] : undefined,
      render: v => v ? <span style={{ color: 'var(--color-text-tertiary)' }}>{v.slice(0, 10)}</span> : '-' },
    { title: '操作', key: 'actions', width: 144, align: 'center', fixed: isMobile ? false : 'right', render: (_, r) => (
      <Space size={isMobile ? 8 : 8} className="orders-actions-cell">
        <Button icon={<EyeOutlined />}
          className="orders-action-btn orders-action-view"
          onClick={() => nav(`/orders/${r.id}`)} />
        <Button icon={<EditOutlined />}
          className="orders-action-btn orders-action-edit"
          onClick={() => handleEdit(r)} />
        <Popconfirm title="确认删除？" onConfirm={() => handleDelete(r.id)}>
          <Button icon={<DeleteOutlined />}
            className="orders-action-btn orders-action-del"
            disabled={!['completed','cancelled'].includes(r.status)} />
        </Popconfirm>
      </Space>
    )},
  ], [nav, isMobile, handleEdit, handleDelete]);
  // 移动端仅显示核心列
  const mobileColumns = useMemo(() => (
    isMobile
      ? listColumns.filter(c => c.responsive === undefined || (Array.isArray(c.responsive) && !c.responsive.includes('md')))
      : listColumns
  ), [isMobile, listColumns]);

  return (
    <div className="orders-page-wrapper">
      <PageHeader title="订单管理" />
      {/* 筛选工具栏 */}
      <FilterBar>
        <div className="orders-filter-inner">
          <Space wrap>
            <Input allowClear prefix={<SearchOutlined />} placeholder="搜索客户 / 电话" value={search}
              onChange={e => {
                const v = e.target.value;
                setSearch(v);
                // 点 × 清空时立即刷新：清空不会触发 onPressEnter，
                // 否则列表会一直停留在上一次的搜索结果上
                if (!v) {
                  if (page !== 1) setPage(1); // 回到第一页会触发 useEffect 自动刷新
                  else fetchOrders('');
                }
              }}
              onPressEnter={() => fetchOrders()} className="filter-search" />
            <Select allowClear placeholder="全部状态" value={statusFilter} onChange={v => setStatusFilter(v)} className="w-sm" options={Object.entries(STATUS_MAP).map(([k, v]) => ({ value: k, label: v.label }))} />
            <Select
              allowClear placeholder="全部导购" value={salespersonFilter}
              onChange={v => {
                setSalespersonFilter(v);
                setPage(1);
                if (v) {
                  setSearchParams({ salesperson_id: String(v) });
                } else {
                  setSearchParams({});
                }
              }}
              className="w-sm"
              options={salespersons.map(u => ({ value: String(u.id), label: u.display_name }))}
            />
          </Space>
          <Space wrap>
            <Segmented options={VIEWS} value={view} onChange={v => setView(v)} className="orders-view-segmented-pc" />
            <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate} className="orders-create-btn-pc">新建订单</Button>
            <ExcelImportExport module="orders" compact />
          </Space>
        </div>
      </FilterBar>

      {view === 'card' && <CardView orders={orders} nav={nav} isMobile={isMobile} />}
      {view === 'calendar' && <CalendarView isMobile={isMobile} calendarOrders={calendarOrders} nav={nav} />}
      {view === 'list' && (
        <div className="orders-table-wrap">
          <Table rowKey="id" loading={loading} locale={{ emptyText: <EmptyState title="暂无订单" description="点击右上角「新建订单」开始录单" /> }} dataSource={orders} columns={mobileColumns} pagination={false} scroll={{ x: TABLE_SCROLL_X.fit }} size={isMobile ? 'small' : 'middle'} className="orders-pc-table" rowClassName={(record, index) => index % 2 === 0 ? 'orders-row-even' : 'orders-row-odd'} expandable={{ expandedRowRender: expandedOrderItems, rowExpandable: r => (r.items || []).length > 0 }} />
        </div>
      )}

      <div className="orders-pagination-bar">
        <span className="orders-pagination-total">共 <strong>{total}</strong> 条订单</span>
        <Pagination current={page} total={total} pageSize={20} onChange={p => setPage(p)} showSizeChanger={false} />
      </div>

      <EditModal open={editModalOpen} order={editingOrder} onCancel={() => setEditModalOpen(false)} onSave={handleSave} />
    </div>
  );
}


// ----- 当日订单明细列表（日历点击弹窗内）-----
function DayOrderList({ orders, nav }) {
  if (!orders || orders.length === 0) {
    return <EmptyState title="当日无订单" description="点击其他日期查看当日订单明细" />;
  }
  return (
    <div className="cal-day-list">
      {orders.map(o => {
        const s = STATUS_MAP[o.status] || { color: 'default', label: o.status || '—' };
        return (
          <div
            key={o.id}
            className="cal-day-item"
            onClick={() => nav(`/orders/${o.id}`)}
          >
            <span className="cal-day-status" style={{ background: s.color }} />
            <div className="cal-day-info">
              <div className="cal-day-row1">
                <span className="cal-day-no">{o.order_no}</span>
                <Tag color={s.color} style={{ margin: 0, borderRadius: 100, padding: '1px 10px', fontSize: 12 }}>
                  {s.label}
                </Tag>
              </div>
              <div className="cal-day-row2">
                <span className="cal-day-name">{o.customer_name}</span>
                {o.customer_phone && <span className="cal-day-phone">{o.customer_phone}</span>}
              </div>
              {o.items && o.items.length > 0 && (
                <div className="cal-day-items">
                  {o.items.slice(0, 4).map((it, i) => (
                    <span key={i} className="cal-day-item-tag">{it.product_name}×{it.quantity}</span>
                  ))}
                  {o.items.length > 4 && <span className="cal-day-item-more">+{o.items.length - 4}</span>}
                </div>
              )}
            </div>
            <div className="cal-day-amount"><span className="money">¥{(Number(o.actual_amount ?? o.total_amount ?? 0)).toLocaleString()}</span></div>
          </div>
        );
      })}
    </div>
  );
}

// ----- 编辑/新建弹窗 -----
function EditModal({ open, order, onCancel, onSave }) {
  const [form] = Form.useForm();
  const [salespersons, setSalespersons] = useState([]);
  const [customerOptions, setCustomerOptions] = useState([]);
  const [customerLoading, setCustomerLoading] = useState(false);
  const [custValue, setCustValue] = useState(undefined);
  const [custId, setCustId] = useState('');
  const isMobile = !Grid.useBreakpoint().md;

  // 优惠券与最终价手改状态
  const [couponInput, setCouponInput] = useState('');
  const [couponInfo, setCouponInfo] = useState(null); // { valid, discount_amount, code }
  const [externalCoupon, setExternalCoupon] = useState(0); // 外部/平台券核销额
  const [amountManual, setAmountManual] = useState(false); // 实收金额是否人工修改
  const [extReduce, setExtReduce] = useState(true); // 系统开关：外部券是否计入核减
  const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

  // 从 CRM 客户主档搜索关联（自动回填姓名/电话 + 写入 customer_id）
  const searchCustomers = useCallback((kw) => {
    if (!kw || kw.trim().length < 1) { setCustomerOptions([]); return; }
    setCustomerLoading(true);
    api.get('/customers', { params: { search: kw.trim(), pageSize: 20 } })
      .then(r => {
        const list = (r.data.customers || []).map(c => ({
          value: c.id,
          label: `${c.name}${c.phone ? ' · ' + c.phone : ''}`,
          name: c.name,
          phone: c.phone || '',
        }));
        setCustomerOptions(list);
      })
      .catch(() => setCustomerOptions([]))
      .finally(() => setCustomerLoading(false));
  }, []);

  const handleCustomerSelect = (value, option) => {
    setCustId(value);
    setCustValue(option.label);
    form.setFieldsValue({ customer_name: option.name, customer_phone: option.phone, customer_id: value });
  };

  const handleCustomerClear = () => {
    setCustId('');
    setCustValue(undefined);
    form.setFieldsValue({ customer_id: '' });
  };

  useEffect(() => {
    api.get('/users/salespersons').then(r => setSalespersons(r.data || [])).catch((err) => { console.error('加载导购列表失败', err); message.error('加载导购列表失败'); });
  }, []);

  // 读取系统开关：外部/平台券是否计入实收核减（用于前端预览与后端保持一致）
  useEffect(() => {
    api.get('/config').then(r => {
      if (r.data && r.data.external_coupon_reduce !== undefined) {
        setExtReduce(r.data.external_coupon_reduce === '1' || r.data.external_coupon_reduce === true || r.data.external_coupon_reduce === 1);
      }
    }).catch((err) => { console.error('读取系统配置失败', err); message.error('读取系统配置失败'); });
  }, []);

  useEffect(() => {
    if (order) {
      // 从完整详情中提取 items（order_items）用于表单回填
      const formItems = (order.items || []).map(it => ({
        product_name: it.product_name || '',
        product_model: it.product_model || '',
        spec: it.spec || '',
        product_type: it.product_type || 'order',
        quantity: it.quantity || 1,
        unit_price: it.unit_price || 0,
      }));
      const cid = order.customer_id || '';
      setCustId(cid);
      setCustValue(order.customer_name ? `已关联：${order.customer_name}` : undefined);
      // 优惠券回填
      setCouponInput(order.coupon_code || '');
      setCouponInfo(order.coupon_code ? { valid: true, discount_amount: Number(order.coupon_discount) || 0, code: order.coupon_code } : null);
      setExternalCoupon(Number(order.external_coupon_amount) || 0);
      setAmountManual(!!order.amount_manual); // 曾人工改价则保留手改值
      form.setFieldsValue({
        customer_name: order.customer_name,
        customer_phone: order.customer_phone,
        customer_address: order.customer_address,
        customer_id: cid,
        salesperson_id: order.salesperson_id,
        salesperson_name: order.salesperson_name,
        payment_method: order.payment_method,
        delivery_date: order.delivery_date ? dayjs(order.delivery_date) : null,
        discount: order.discount || 0,
        deposit_amount: order.deposit_amount || 0,
        actual_amount: order.actual_amount || order.total_amount || 0,
        note: order.note || '',
        items: formItems.length > 0 ? formItems : [{ product_type: 'order', quantity: 1, unit_price: 0 }],
      });
    } else {
      form.resetFields();
      setCustId('');
      setCustValue(undefined);
      setCouponInput('');
      setCouponInfo(null);
      setExternalCoupon(0);
      setAmountManual(false);
      form.setFieldsValue({ payment_method: 'deposit', items: [{ product_type: 'order', quantity: 1, unit_price: 0 }] });
    }
  }, [order, open]);

  const handleSalespersonChange = (value) => {
    const user = salespersons.find(u => u.id === value);
    form.setFieldsValue({ salesperson_name: user ? user.display_name : '' });
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      const disc = values.discount || 0;
      const itemsTotal = (values.items || []).reduce((s, it) => s + (it.unit_price || 0) * (it.quantity || 1), 0);
      const total = Math.max(0, itemsTotal - disc);
      // 自动核减后的收款额（与后端口径一致）；券码仅当核销成功才带上
      const auto = round2(Math.max(0, total - couponDiscount - (extReduce ? externalCoupon : 0)));
      // 仅当未人工改价时，用自动核减值覆盖，保证后端按"未修改"处理
      const finalActual = amountManual ? (Number(values.actual_amount) || auto) : auto;
      await onSave({
        ...values,
        total_amount: total,
        actual_amount: finalActual,
        amount_manual: amountManual,
        coupon_code: couponInfo?.valid ? String(couponInput).trim().toUpperCase() : '',
        external_coupon_amount: externalCoupon,
        delivery_date: values.delivery_date ? values.delivery_date.format('YYYY-MM-DD') : null,
      });
    } catch (e) { /* validation error, ignore */ }
  };

  const items = Form.useWatch('items', form) || [];
  const discount = Form.useWatch('discount', form) || 0;
  const itemsTotal = items.reduce((s, it) => s + (it.unit_price || 0) * (it.quantity || 1), 0);
  const orderTotal = Math.max(0, itemsTotal - discount);
  const isFull = Form.useWatch('payment_method', form) === 'full';
  const couponDiscount = couponInfo?.valid ? (Number(couponInfo.discount_amount) || 0) : 0;
  // 自动核减后的应收（不含人工改价）
  const autoActual = round2(Math.max(0, orderTotal - couponDiscount - (extReduce ? externalCoupon : 0)));

  // 券核销：调后端 verify（防前端造假），实时显示可减额
  const verifyCouponCode = async () => {
    const code = String(couponInput || '').trim();
    if (!code) { message.warning('请输入券码'); return; }
    try {
      const r = await api.post('/coupons/verify', {
        code,
        order_amount: orderTotal,
        product_ids: (items || []).map(i => i.product_id).filter(Boolean),
      });
      if (r.data && r.data.valid) {
        setCouponInfo({ valid: true, discount_amount: r.data.discount_amount, code: r.data.code || code.toUpperCase() });
        setCouponInput((r.data.code || code).toUpperCase());
        message.success(`券核销成功，可减 ¥${r.data.discount_amount}`);
      } else {
        setCouponInfo({ valid: false, msg: r.data?.msg || '券不可用' });
        message.error(r.data?.msg || '券不可用');
      }
    } catch { message.error('核销失败，请重试'); }
  };

  // 未人工改价时，自动把实收金额同步为核减后的应收
  useEffect(() => {
    if (!amountManual) form.setFieldsValue({ actual_amount: autoActual });
  }, [autoActual, amountManual, form]);

  return (
    <Modal title={order ? '编辑订单' : '新建订单'} open={open} onCancel={onCancel}
      className="modal-md" onOk={handleSubmit} okText="保存" cancelText="取消"
      style={{ top: 20 }} destroyOnClose>
      <Form form={form} layout="vertical" requiredMark="optional">
        {/* ── 客户信息 ── */}
        <div className="edit-card">
          <div className="edit-card-title"><UserOutlined /> 客户信息</div>
          <div className="edit-card-body">
            <Form.Item label="关联 CRM 客户（选填，自动回填姓名/电话）" className="form-w-full">
              <Select
                showSearch
                allowClear
                placeholder="搜索姓名 / 电话并关联，订单将写入客户主档"
                loading={customerLoading}
                value={custValue}
                filterOption={false}
                notFoundContent={customerLoading ? '搜索中...' : '无匹配客户'}
                options={customerOptions}
                onSearch={searchCustomers}
                onSelect={handleCustomerSelect}
                onChange={(v) => { if (!v) handleCustomerClear(); }}
                style={{ width: '100%', borderRadius: 'var(--radius-md)' }}
              />
            </Form.Item>
            <Form.Item name="customer_id" noStyle><Input type="hidden" /></Form.Item>
            <Row gutter={[16, 16]}>
              <Col xs={24} md={8}><Form.Item name="customer_name" label="客户姓名" rules={[{ required: true }]} className="form-w-full"><Input style={{ borderRadius: 'var(--radius-md)' }} /></Form.Item></Col>
              <Col xs={24} md={8}><Form.Item name="customer_phone" label="电话" className="form-w-full"><Input style={{ borderRadius: 'var(--radius-md)' }} /></Form.Item></Col>
              <Col xs={24} md={8}><Form.Item name="customer_address" label="地址" className="form-w-full"><Input style={{ borderRadius: 'var(--radius-md)' }} /></Form.Item></Col>
            </Row>
            <Row gutter={[16, 16]}>
              <Col xs={24} md={8}>
                <Form.Item name="salesperson_id" label="导购" className="form-w-full">
                  <Select placeholder="选择导购" allowClear showSearch optionFilterProp="label" onChange={handleSalespersonChange} style={{ borderRadius: 'var(--radius-md)' }}>
                    {salespersons.map(u => <Select.Option key={u.id} value={u.id} label={u.display_name}>{u.display_name}</Select.Option>)}
                  </Select>
                </Form.Item>
                <Form.Item name="salesperson_name" noStyle><Input type="hidden" /></Form.Item>
              </Col>
              <Col xs={24} md={8}>
                <Form.Item name="payment_method" label="付款方式" className="form-w-full">
                  <Select options={[{ value: 'deposit', label: '定金' }, { value: 'full', label: '全款' }]} style={{ borderRadius: 'var(--radius-md)' }} />
                </Form.Item>
              </Col>
              <Col xs={24} md={8}>
                <Form.Item name="delivery_date" label="送货日期" className="form-w-full"><DatePicker style={{ width: '100%', borderRadius: 'var(--radius-md)' }} /></Form.Item></Col>
            </Row>
          </div>
        </div>

        {/* ── 商品明细 ── */}
        <div className="edit-card">
          <div className="edit-card-title"><ShoppingCartOutlined /> 商品明细</div>
          <div className="edit-card-body">
            <Form.List name="items">
              {(fields, { add, remove }) => (
                <>
                  {fields.map(({ key, name, ...rest }) => (
                    isMobile ? (
                      <div key={key} style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 8, marginBottom: 8, background: 'var(--color-bg-white)' }}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                          <Form.Item {...rest} name={[name, 'product_name']} noStyle rules={[{ required: true, message: '必填' }]} style={{ flex: 1, margin: 0 }}>
                            <Input placeholder="商品名" style={{ borderRadius: 'var(--radius-md)' }} />
                          </Form.Item>
                          <Button danger type="text" onClick={() => remove(name)} style={{ flexShrink: 0, padding: '0 4px' }}>删除</Button>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                          <Form.Item {...rest} name={[name, 'product_model']} noStyle><Input placeholder="型号" style={{ borderRadius: 'var(--radius-md)' }} /></Form.Item>
                          <Form.Item {...rest} name={[name, 'spec']} noStyle><Input placeholder="规格" style={{ borderRadius: 'var(--radius-md)' }} /></Form.Item>
                          <Form.Item {...rest} name={[name, 'product_type']} noStyle initialValue="order">
                            <Select style={{ borderRadius: 'var(--radius-md)' }} options={[{ value: 'sample', label: '样品' }, { value: 'order', label: '订货' }, { value: 'gift', label: '赠品' }]} />
                          </Form.Item>
                          <Form.Item {...rest} name={[name, 'quantity']} noStyle initialValue={1}><InputNumber min={1} style={{ width: '100%', borderRadius: 'var(--radius-md)' }} /></Form.Item>
                          <Form.Item {...rest} name={[name, 'unit_price']} noStyle initialValue={0}><InputNumber min={0} prefix="¥" style={{ width: '100%', borderRadius: 'var(--radius-md)' }} /></Form.Item>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-tertiary)', whiteSpace: 'nowrap' }}>
                            小计 <span className="money">{formatMoneyInt((items[name]?.unit_price || 0) * (items[name]?.quantity || 1))}</span>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <Row key={key} gutter={[16, 16]} align="middle" style={{ marginBottom: 8 }}>
                        <Col span={6}><Form.Item {...rest} name={[name, 'product_name']} noStyle rules={[{ required: true, message: '必填' }]}><Input placeholder="商品名" style={{ borderRadius: 'var(--radius-md)' }} /></Form.Item></Col>
                        <Col span={4}><Form.Item {...rest} name={[name, 'product_model']} noStyle><Input placeholder="型号" style={{ borderRadius: 'var(--radius-md)' }} /></Form.Item></Col>
                        <Col span={3}><Form.Item {...rest} name={[name, 'spec']} noStyle><Input placeholder="规格" style={{ borderRadius: 'var(--radius-md)' }} /></Form.Item></Col>
                        <Col span={3}>
                          <Form.Item {...rest} name={[name, 'product_type']} noStyle initialValue="order">
                            <Select style={{ borderRadius: 'var(--radius-md)' }} options={[
                              { value: 'sample', label: '样品' }, { value: 'order', label: '订货' }, { value: 'gift', label: '赠品' }
                            ]} />
                          </Form.Item>
                        </Col>
                        <Col span={2}><Form.Item {...rest} name={[name, 'quantity']} noStyle initialValue={1}><InputNumber min={1} style={{ width: '100%', borderRadius: 'var(--radius-md)' }} /></Form.Item></Col>
                        <Col span={3}><Form.Item {...rest} name={[name, 'unit_price']} noStyle initialValue={0}><InputNumber min={0} prefix="¥" style={{ width: '100%', borderRadius: 'var(--radius-md)' }} /></Form.Item></Col>
                        <Col span={2}><Text type="secondary" style={{ fontSize: 'var(--font-size-sm)' }}><span className="money">{formatMoneyInt((items[name]?.unit_price || 0) * (items[name]?.quantity || 1))}</span></Text></Col>
                        <Col span={1}><Button danger type="text" onClick={() => remove(name)} style={{ padding: 0, minWidth: 24 }}>×</Button></Col>
                      </Row>
                    )
                  ))}
                  <Button type="dashed" onClick={() => add({ product_type: 'order', quantity: 1, unit_price: 0 })} block>+ 添加商品</Button>
                </>
              )}
            </Form.List>
          </div>
        </div>

        {/* ── 优惠核销 ── */}
        <div className="edit-card">
          <div className="edit-card-title"><DollarOutlined /> 优惠核销</div>
          <div className="edit-card-body">
            <Row gutter={[16, 16]} align="middle">
              <Col xs={24} md={14}>
                <div style={{ display: 'flex', gap: 8 }}>
                  <Input
                    placeholder="输入门店券码（如 PPAXF6YJ）"
                    value={couponInput}
                    onChange={(e) => { setCouponInput(e.target.value); setCouponInfo(null); }}
                    onPressEnter={verifyCouponCode}
                    style={{ borderRadius: 'var(--radius-md)' }}
                  />
                  <Button onClick={verifyCouponCode}>核销</Button>
                </div>
                {couponInfo?.valid && (
                  <Tag color="var(--status-paid)" style={{ marginTop: 8, borderRadius: 4 }}>
                    门店券 {couponInfo.code} 可减 ¥{couponDiscount}
                  </Tag>
                )}
                {couponInfo && !couponInfo.valid && (
                  <span style={{ color: 'var(--color-error)', fontSize: 'var(--font-size-sm)', marginLeft: 8 }}>{couponInfo.msg}</span>
                )}
              </Col>
              <Col xs={24} md={10}>
                <Form.Item label="外部/平台券核销额" className="form-w-full" style={{ marginBottom: 0 }}>
                  <InputNumber
                    min={0}
                    prefix="¥"
                    value={externalCoupon}
                    onChange={(v) => setExternalCoupon(Number(v) || 0)}
                    style={{ width: '100%', borderRadius: 'var(--radius-md)' }}
                  />
                </Form.Item>
              </Col>
            </Row>
            <div className="edit-note" style={{ marginTop: 10 }}>
              门店券减额直接计入实收（门店让利）；外部/平台券是否计入核减由系统开关控制（当前：{extReduce ? '计入' : '仅记录不核减'}）。
            </div>
          </div>
        </div>

        {/* ── 金额与备注 ── */}
        <div className="edit-card">
          <div className="edit-card-title"><ShoppingCartOutlined /> 金额与备注</div>
          <div className="edit-card-body">
            <Row gutter={[16, 16]}>
              <Col xs={12} md={6}><Form.Item name="discount" label="折扣" className="form-w-full"><InputNumber min={0} prefix="¥" style={{ width: '100%', borderRadius: 'var(--radius-md)' }} /></Form.Item></Col>
              <Col xs={12} md={6}><Form.Item label="订单总价" className="form-w-full"><Input value={formatMoney(orderTotal)} disabled style={{ borderRadius: 'var(--radius-md)' }} /></Form.Item></Col>
              <Col xs={12} md={6}><Form.Item name="actual_amount" label="实收金额" className="form-w-full" extra={amountManual ? '已人工改价，以手填值为准' : undefined}><InputNumber min={0} prefix="¥" onChange={() => setAmountManual(true)} style={{ width: '100%', borderRadius: 'var(--radius-md)' }} /></Form.Item></Col>
              <Col xs={12} md={6}><Form.Item name="deposit_amount" label={isFull ? '全款金额' : '定金金额'} className="form-w-full"><InputNumber min={0} prefix="¥" style={{ width: '100%', borderRadius: 'var(--radius-md)' }} /></Form.Item></Col>
            </Row>
            <div className="edit-note" style={{ marginTop: 2, marginBottom: 8 }}>
              自动核减后应收：<b><span className="money">{formatMoney(autoActual)}</span></b>（商品合计 <span className="money">{formatMoney(orderTotal)}</span> − 门店券 ¥{couponDiscount}{extReduce ? ` − 平台券 ¥${externalCoupon}` : ''}）。如需调整最终价，直接修改上方"实收金额"即视为人工改价。
            </div>
            <Form.Item name="note" label="备注" className="form-w-full">
              <Input style={{ borderRadius: 'var(--radius-md)' }} />
            </Form.Item>
          </div>
        </div>
      </Form>
    </Modal>
  );
}


// ===== 模块级子组件（从 Orders 内提取，引用稳定，避免每次父渲染重建）=====
  

  const productIcon = (type) => {
    switch (type) {
      case 'order': return <ShoppingCartOutlined />;
      case 'sample': return <ExperimentOutlined />;
      case 'gift': return <GiftOutlined />;
      default: return <ShoppingCartOutlined />;
    }
  };
  const productLabel = (type) => {
    switch (type) {
      case 'order': return '订货';
      case 'sample': return '样品';
      case 'gift': return '赠品';
      default: return type;
    }
  };
  const productTagColor = (type, isDark) => {
    const darkBg = 'rgba(255,255,255,0.08)';
    const darkBorder = 'rgba(255,255,255,0.18)';
    switch (type) {
      case 'order': return { bg: isDark ? darkBg : '#FFF7E6', border: isDark ? darkBorder : '#FFD591', text: '#D48806' };
      case 'sample': return { bg: isDark ? darkBg : '#F0F5FF', border: isDark ? darkBorder : '#ADC6FF', text: '#2F54EB' };
      case 'gift': return { bg: isDark ? darkBg : '#FFF0F6', border: isDark ? darkBorder : '#FFADD2', text: '#C41D7F' };
      default: return { bg: isDark ? darkBg : '#FAFAFA', border: isDark ? darkBorder : '#D9D9D9', text: isDark ? 'var(--color-text-secondary)' : '#666' };
    }
  };

// 订单列表展开行：完整商品明细（商品/型号/规格/类型/数量/单价/小计）
const TypeTag = ({ type }) => {
  const { isDark } = useTheme();
  const tc = productTagColor(type, isDark);
  return (
    <span style={{ fontSize: 12, fontWeight: 600, padding: '2px 10px', borderRadius: 100, background: tc.bg, color: tc.text, border: `1px solid ${tc.border}`, whiteSpace: 'nowrap' }}>
      {productLabel(type)}
    </span>
  );
};

const orderItemsColumns = [
  { title: '商品', dataIndex: 'product_name', key: 'product_name', width: 160, ellipsis: true, render: v => <span style={{ fontWeight: 500 }}>{v || '未命名'}</span> },
  { title: '型号', dataIndex: 'product_model', key: 'product_model', width: 130, ellipsis: true, render: v => v || '—' },
  { title: '规格', dataIndex: 'spec', key: 'spec', width: 120, ellipsis: true, render: v => v || '—' },
  { title: '类型', key: 'product_type', width: 84, align: 'center', render: (_, it) => <TypeTag type={it.product_type} /> },
  { title: '数量', dataIndex: 'quantity', key: 'quantity', width: 72, align: 'right', render: v => <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>×{v}</span> },
  { title: '单价', dataIndex: 'unit_price', key: 'unit_price', width: 96, align: 'right', render: v => <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--color-text-secondary)' }}>¥{(Number(v) || 0).toLocaleString()}</span> },
  { title: '小计', dataIndex: 'total_price', key: 'total_price', width: 100, align: 'right', render: v => <span className="money" style={{ fontWeight: 600, color: 'var(--color-primary-deep)' }}>¥{(Number(v) || 0).toLocaleString()}</span> },
];

const expandedOrderItems = (record) => {
  const items = record.items || [];
  if (items.length === 0) {
    return <div style={{ padding: '10px 16px', color: 'var(--color-text-tertiary)', fontSize: 'var(--font-size-sm)' }}>该订单暂无商品明细</div>;
  }
  return (
    <Table
      rowKey="id"
      size="small"
      pagination={false}
      columns={orderItemsColumns}
      dataSource={items}
      className="orders-expand-table"
      scroll={{ x: TABLE_SCROLL_X.fit }}
    />
  );
};

const CardView = ({ orders, nav, isMobile }) => {
  const { isDark } = useTheme();
  const [showCompleted, setShowCompleted] = useState(false);
  const completed = orders.filter(o => o.status === 'completed');
  const active = orders.filter(o => o.status !== 'completed');

  // 单张订单卡片（与改造前一致）
  const renderCard = (o) => {
    const s = STATUS_MAP[o.status] || { color: 'default', label: o.status || '未知' };
    const badgeBg = isDark ? 'rgba(255,255,255,0.08)' : (s.bg || '#fafafa');
    const items = o.items || [];
    const accent = s.color;
    return (
      <div
        key={o.id}
        className="order-card-xhs"
        onClick={() => nav(`/orders/${o.id}`)}
        style={{
          background: badgeBg,
          borderRadius: 16,
          overflow: 'hidden',
          boxShadow: `0 1px 3px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.03), inset 4px 0 0 ${accent}`,
          cursor: 'pointer',
          transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
          border: `1px solid ${s.color === 'default' ? 'var(--color-border-light)' : 'transparent'}`,
        }}
        onMouseEnter={e => {
          if (!isMobile) {
            e.currentTarget.style.transform = 'translateY(-2px)';
            e.currentTarget.style.boxShadow = `0 4px 10px rgba(0,0,0,0.06), 0 8px 24px rgba(0,0,0,0.04), inset 4px 0 0 ${accent}`;
          }
        }}
        onMouseLeave={e => {
          e.currentTarget.style.transform = 'translateY(0)';
          e.currentTarget.style.boxShadow = `0 1px 3px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.03), inset 4px 0 0 ${accent}`;
        }}
      >
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: isMobile ? '14px 16px 10px' : '16px 20px 12px',
          background: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.55)',
          borderBottom: '1px solid rgba(0,0,0,0.06)',
        }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)', fontWeight: 500, letterSpacing: 0.5, textTransform: 'uppercase' }}>NO.</span>
            <span style={{ fontSize: isMobile ? 15 : 16, fontWeight: 700, color: 'var(--color-text)', fontFamily: '"SF Mono", "JetBrains Mono", "Fira Code", "Consolas", monospace', letterSpacing: -0.5 }}>{o.order_no}</span>
          </div>
          <span style={{
            fontSize: 11, fontWeight: 600, padding: '3px 10px',
            borderRadius: 100, background: badgeBg,
            color: s.color === 'default' ? (isDark ? 'var(--color-text-secondary)' : '#666') : s.color,
            border: `1px solid ${s.color === 'default' ? '#d9d9d9' : s.color}`,
          }}>{s.label}</span>
        </div>

        <div style={{
          padding: isMobile ? '8px 16px' : '10px 20px',
          display: 'flex', flexWrap: 'wrap', alignItems: 'center',
          gap: isMobile ? 12 : 16,
          borderBottom: items.length > 0 ? '1px dashed rgba(0,0,0,0.08)' : '1px solid transparent',
        }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 'var(--font-size-sm)', color: 'var(--color-text)' }}>
            <UserOutlined style={{ color: 'var(--color-text-tertiary)', fontSize: 12 }} />
            <span style={{ fontWeight: 600 }}>{o.customer_name || '—'}</span>
          </span>
          {o.customer_phone && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
              <PhoneOutlined style={{ color: 'var(--color-text-tertiary)', fontSize: 12 }} />
              <span style={{ fontFamily: '"SF Mono","JetBrains Mono",monospace', fontSize: 12 }}>{o.customer_phone}</span>
            </span>
          )}
          {o.customer_address && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--color-text-tertiary)', flexBasis: '100%', marginTop: -4 }}>
              <EnvironmentOutlined style={{ fontSize: 11 }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: isMobile ? 200 : 280 }}>{o.customer_address}</span>
            </span>
          )}
        </div>

        {items.length > 0 && (
          <div style={{ padding: isMobile ? '8px 16px 6px' : '10px 20px 8px' }}>
            <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', fontWeight: 500, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 4, letterSpacing: 0.5 }}>
              <ShoppingCartOutlined style={{ fontSize: 10 }} /> 货品明细 · {items.length} 件
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {items.map((it, idx) => {
                const tc = productTagColor(it.product_type, isDark);
                return (
                  <div key={it.id || idx} style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: isMobile ? '6px 10px' : '6px 12px',
                    background: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.65)',
                    borderRadius: 10,
                    transition: 'background 0.15s ease',
                  }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 100, whiteSpace: 'nowrap', background: tc.bg, color: tc.text, border: `1px solid ${tc.border}` }}>
                      {productIcon(it.product_type)}
                      {isMobile ? '' : ` ${productLabel(it.product_type)}`}
                    </span>
                    <span style={{ flex: 1, fontSize: isMobile ? 12 : 13, fontWeight: 500, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {it.product_name || '未命名'}
                      {it.product_model ? <span style={{ color: 'var(--color-text-tertiary)', fontSize: 11, marginLeft: 4 }}>{it.product_model}</span> : ''}
                      {it.spec ? <span style={{ color: 'var(--color-text-tertiary)', fontSize: 11, marginLeft: 2 }}>·{it.spec}</span> : ''}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>×{it.quantity}</span>
                    <span style={{ fontSize: isMobile ? 13 : 14, fontWeight: 600, color: 'var(--color-text)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>¥{(it.unit_price || 0).toFixed(0)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="orders-card-grid">
      {active.map(renderCard)}
      {completed.length > 0 && (
        <div
          key="__completed_agg"
          className="order-card-collapsed"
          onClick={() => setShowCompleted(v => !v)}
          title={showCompleted ? '点击收起' : '点击展开'}
        >
          <CheckCircleOutlined style={{ fontSize: 16 }} />
          <span style={{ fontWeight: 700 }}>已完成 {completed.length} 单</span>
          <span className="occ-hint">{showCompleted ? '点击收起' : '点击查看'}</span>
          <DownOutlined style={{ transform: showCompleted ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s ease' }} />
        </div>
      )}
      {showCompleted && completed.map(renderCard)}
    </div>
  );
};

const CalendarView = ({ isMobile, calendarOrders, nav }) => {
    const [calendarDate, setCalendarDate] = useState(dayjs());
    const [calDayModalOpen, setCalDayModalOpen] = useState(false);
    const [calDayDate, setCalDayDate] = useState('');
    const [calDayOrders, setCalDayOrders] = useState([]);

    const showDayOrders = (key, list) => {
      setCalDayDate(key);
      setCalDayOrders(list);
      setCalDayModalOpen(true);
    };

    const maxShow = isMobile ? 2 : 4;

    const fullCellRender = (date) => {
      const key = date.format('YYYY-MM-DD');
      const list = calendarOrders[key] || [];
      const isToday = date.isSame(dayjs(), 'day');
      const isSelected = key === calDayDate;
      const isCurrentMonth = date.month() === calendarDate.month();
      const hasOrders = list.length > 0;

      return (
        <div
          className={`cal-cell${hasOrders ? ' cal-has-orders' : ''}${isSelected ? ' cal-selected' : ''}${isToday ? ' cal-today' : ''}${!isCurrentMonth ? ' cal-other' : ''}`}
          onClick={() => { if (hasOrders || true) showDayOrders(key, list); }}
        >
          <div className="cal-day-num">{date.date()}</div>
          {hasOrders && (
            <>
              <span className="cal-dot" />
              <div className="cal-orders">
                {list.slice(0, maxShow).map(o => {
                  const s = STATUS_MAP[o.status] || { color: 'default' };
                  return (
                    <div
                      key={o.id}
                      className="cal-order-line"
                      onClick={e => { e.stopPropagation(); nav(`/orders/${o.id}`); }}
                      title={`${o.order_no} ${o.customer_name}`}
                    >
                      <span className="cal-status-bar" style={{ background: s.color }} />
                      <span className="cal-order-no">{o.order_no.slice(-6)}</span>
                      <span className="cal-customer">{o.customer_name}</span>
                    </div>
                  );
                })}
                {list.length > maxShow && (
                  <div className="cal-more" onClick={e => { e.stopPropagation(); showDayOrders(key, list); }}>
                    +{list.length - maxShow} 更多
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      );
    };

    return (
      <>
        <div className="calendar-wrap">
          <Calendar
            value={calendarDate}
            onChange={setCalendarDate}
            fullCellRender={fullCellRender}
          />
        </div>

        {/* 当日订单明细弹窗 */}
        {calDayModalOpen && (
          isMobile ? (
            <Drawer
              title={<span style={{ fontSize: 16, fontWeight: 600 }}>{calDayDate} · {calDayOrders.length} 笔订单</span>}
              placement="bottom"
              height="72vh"
              open={calDayModalOpen}
              onClose={() => setCalDayModalOpen(false)}
              className="cal-day-drawer"
              closeIcon={<span style={{ fontSize: 18 }}>✕</span>}
            >
              <DayOrderList orders={calDayOrders} nav={nav} />
            </Drawer>
          ) : (
            <Modal
              title={<span style={{ fontSize: 17, fontWeight: 600 }}>{calDayDate} · {calDayOrders.length} 笔订单</span>}
              open={calDayModalOpen}
              onCancel={() => setCalDayModalOpen(false)}
              footer={null}
              className="cal-day-modal modal-md"
            >
              <DayOrderList orders={calDayOrders} nav={nav} />
            </Modal>
          )
        )}
      </>
    );
  };

