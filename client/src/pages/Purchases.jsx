import { TABLE_SCROLL_X } from '../components/tableConstants';
import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Card, Table, Button, Modal, Form, Input, InputNumber, Space, Tag, message, Select, Descriptions, Popconfirm, Pagination, Grid, Tooltip, Collapse, Progress, Badge, Segmented, Empty, Checkbox } from 'antd';
import { PlusOutlined, DeleteOutlined, EditOutlined, SearchOutlined, EyeOutlined, WarningOutlined, CheckCircleOutlined, CarOutlined, UnorderedListOutlined, GroupOutlined, LinkOutlined } from '@ant-design/icons';
import api from '../api';
import PageHeader from '../components/PageHeader';
import ExcelImportExport from '../components/ExcelImportExport';
import FilterBar from '../components/FilterBar';
import EmptyState from '../components/EmptyState';
import VoucherUploader from '../components/VoucherUploader';
import { formatMoneyInt } from '../utils/format';
import { useAuth } from '../context/AuthContext';
import { useWarehouses } from '../context/BrandContext';
import { PURCHASE_STATUS_MAP as STATUS_MAP } from './Purchases.constants.js';

export default function Purchases() {
  const { md } = Grid.useBreakpoint();
  const isMobile = !md;
  const { user } = useAuth();
  const nav = useNavigate();
  const [searchParams] = useSearchParams();
  const userRole = user?.role || '';
  const isAdmin = userRole === 'admin';
  const warehouses = useWarehouses();
  const [purchases, setPurchases] = useState([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [currentPO, setCurrentPO] = useState(null);
  const [allocModal, setAllocModal] = useState(false);
  const [pendingOrders, setPendingOrders] = useState([]);
  const [allocForm] = Form.useForm();
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editForm] = Form.useForm();
  const [editingPO, setEditingPO] = useState(null);

  // 筛选 & 搜索 & 分页
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState(null);
  const [page, setPage] = useState(1);
  const pageSize = 20;

  // 视图模式与分组筛选
  const [viewMode, setViewMode] = useState('group'); // group | flat
  const [orderNoFilter, setOrderNoFilter] = useState('');
  const [onlyUnlinked, setOnlyUnlinked] = useState(false);
  const [overdueDays, setOverdueDays] = useState(15);
  const { Panel } = Collapse;

  // 逐项到货相关
  const [arriveModal, setArriveModal] = useState(false);
  const [arrivingItem, setArrivingItem] = useState(null);
  const [arriveWarehouse, setArriveWarehouse] = useState('');
  const [arriving, setArriving] = useState(false);
  const [arrivalVoucher, setArrivalVoucher] = useState([]);

  // 请求序号：快速切换筛选时，先发出的慢请求回来后不得覆盖后发结果（竞态防护）
  const loadSeq = useRef(0);
  const load = async () => {
    const seq = ++loadSeq.current;
    setLoading(true);
    try {
      const params = {};
      if (statusFilter) params.status = statusFilter;
      const res = await api.get('/purchases', { params });
      if (seq !== loadSeq.current) return;
      setPurchases(res.data);
    }
    catch { if (seq === loadSeq.current) message.error('加载失败'); }
    finally { if (seq === loadSeq.current) setLoading(false); }
  };

  useEffect(() => { load(); setPage(1); }, [statusFilter]);

  // 客户端搜索过滤 + 分页
  const filtered = useMemo(() => {
    let list = purchases;
    if (search) {
      const kw = search.toLowerCase();
      list = list.filter(p =>
        (p.po_no || '').toLowerCase().includes(kw) ||
        (p.supplier || '').toLowerCase().includes(kw) ||
        (p.order_no || '').toLowerCase().includes(kw)
      );
    }
    if (orderNoFilter) {
      const kw = orderNoFilter.toLowerCase();
      list = list.filter(p => (p.order_no || '').toLowerCase().includes(kw));
    }
    if (onlyUnlinked) {
      list = list.filter(p => !p.order_id);
    }
    return list;
  }, [purchases, search, orderNoFilter, onlyUnlinked]);

  const paginated = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page]);

  useEffect(() => { setPage(1); }, [search]);

  const openCreate = () => {
    form.resetFields();
    form.setFieldsValue({ items: [{}] });
    setModalOpen(true);
  };

  // 计算某行的总价
  const calcRowTotal = (index) => {
    const items = form.getFieldValue('items') || [];
    const item = items[index];
    if (!item) return 0;
    const qty = parseFloat(item.quantity) || 0;
    const price = parseFloat(item.unit_price) || 0;
    return (qty * price).toFixed(2);
  };

  const handleCreate = async () => {
    try {
      const values = await form.validateFields();
      setSubmitting(true);
      const payload = {
        ...values,
        payment_voucher: (values.payment_voucher || []).join(','),
      };
      await api.post('/purchases', payload);
      message.success('进货单创建成功');
      setModalOpen(false);
      load();
    } catch (err) {
      if (err.response) message.error(err.response.data?.error || '创建失败');
    } finally {
      setSubmitting(false);
    }
  };

  const viewDetail = async (record) => {
    try {
      const res = await api.get(`/purchases/${record.id}`);
      setCurrentPO(res.data);
      setDetailOpen(true);
    } catch { message.error('加载失败'); }
  };

  // 从销售单跳转过来（?po=ID）自动打开对应订货单详情 —— 销售单↔订货单 双向打通
  useEffect(() => {
    const po = searchParams.get('po');
    if (po) { viewDetail({ id: Number(po) }); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const handleArrive = async (id) => {
    try {
      await api.post(`/purchases/${id}/arrive`);
      message.success('已标记到货');
      load();
    } catch (err) { message.error(err.response?.data?.error || '操作失败'); }
  };

  const openAlloc = async (record) => {
    setCurrentPO(record);
    try {
      const res = await api.get('/purchases/pending-allocations/orders');
      setPendingOrders(res.data);
    } catch { /**/ }
    allocForm.resetFields();
    setAllocModal(true);
  };

  const handleAlloc = async () => {
    try {
      const values = await allocForm.validateFields();
      await api.post(`/purchases/${currentPO.id}/allocate`, values);
      message.success('分配成功');
      setAllocModal(false);
      load();
    } catch (err) {
      if (err.response) message.error(err.response.data?.error || '分配失败');
    }
  };

  const handleDelete = async (id) => {
    try {
      await api.delete(`/purchases/${id}`);
      message.success('进货单已删除');
      load();
    } catch (err) { message.error(err.response?.data?.error || '删除失败'); }
  };

  const openEdit = async (record) => {
    try {
      const res = await api.get(`/purchases/${record.id}`);
      const po = res.data;
      setEditingPO(po);
      editForm.setFieldsValue({
        supplier: po.supplier || '',
        arrival_warehouse: po.arrival_warehouse || '',
        note: po.note || '',
        payment_voucher: po.payment_voucher ? po.payment_voucher.split(',').filter(Boolean) : [],
        items: (po.items || []).map(it => ({
          product_name: it.product_name,
          brand: it.brand || '',
          model: it.model || '',
          spec: it.spec || '',
          unit_price: it.unit_price || 0,
          quantity: it.quantity,
          note: it.note || '',
        })),
      });
      setEditModalOpen(true);
    } catch { message.error('加载失败'); }
  };

  const handleEdit = async () => {
    try {
      const values = await editForm.validateFields();
      setSubmitting(true);
      const payload = {
        ...values,
        payment_voucher: (values.payment_voucher || []).join(','),
      };
      await api.put(`/purchases/${editingPO.id}`, payload);
      message.success('进货单已更新');
      setEditModalOpen(false);
      load();
    } catch (err) {
      if (err.response) message.error(err.response.data?.error || '编辑失败');
    } finally {
      setSubmitting(false);
    }
  };

  // 按商品名+型号分组展示（同型号折叠）
  const groupedItems = useMemo(() => {
    if (!currentPO || !currentPO.items) return [];
    const groups = new Map();
    for (const item of currentPO.items) {
      const key = `${item.product_name}||${item.model || ''}`;
      if (!groups.has(key)) {
        groups.set(key, { product_name: item.product_name, model: item.model, items: [] });
      }
      groups.get(key).items.push(item);
    }
    return Array.from(groups.values());
  }, [currentPO]);

  // 某进货单是否超期未到货（已订货/待进货但超过阈值天数）
  const isOverduePO = (po) => {
    if (!['ordered', 'pending'].includes(po.status)) return false;
    if (!po.created_at) return false;
    const t = new Date(po.created_at.replace(' ', 'T'));
    if (isNaN(t.getTime())) return false;
    return (Date.now() - t.getTime()) / 86400000 > overdueDays;
  };

  // 按销售单(order_id)聚合进货单；无关联订单的归「自主进货」组
  const groups = useMemo(() => {
    const map = new Map();
    for (const p of filtered) {
      const key = p.order_id || '__restock__';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(p);
    }
    const arr = [];
    for (const [k, list] of map) {
      const first = list[0];
      let arrived = 0, total = 0, overdue = false;
      for (const p of list) {
        arrived += Number(p.arrived_qty || 0);
        total += Number(p.total_qty || 0);
        if (isOverduePO(p)) overdue = true;
      }
      arr.push({
        key: k,
        orderId: first.order_id,
        orderNo: first.order_no,
        orderCustomer: first.order_customer,
        orderStatus: first.order_status,
        items: list,
        isRestock: k === '__restock__',
        arrived, total, overdue,
      });
    }
    arr.sort((a, b) => {
      if (a.isRestock && !b.isRestock) return 1;
      if (!a.isRestock && b.isRestock) return -1;
      return (b.orderId || 0) - (a.orderId || 0);
    });
    return arr;
  }, [filtered, overdueDays]);

  // 分组状态：可送货(绿)/超期(红)/全部到货(绿,自主)/部分(默认)
  const computeGroupState = (g) => {
    if (g.isRestock) {
      const allDone = g.items.every(p => p.status === 'arrived');
      return allDone
        ? { kind: 'restock_done', border: 'var(--color-success)', bg: 'var(--color-success-bg)', label: '已全部到货' }
        : { kind: 'normal', border: 'var(--color-border)', bg: 'var(--color-bg)', label: '自主进货' };
    }
    if (['ready', 'balance_paid'].includes(g.orderStatus)) {
      return { kind: 'ready', border: 'var(--color-success)', bg: 'var(--color-success-bg)', label: '✅ 全部到货 · 可送货' };
    }
    if (g.orderStatus === 'completed') {
      return { kind: 'completed', border: 'var(--color-border)', bg: 'var(--color-bg)', label: '已完成送货' };
    }
    if (g.overdue) {
      return { kind: 'overdue', border: 'var(--color-error)', bg: 'rgba(255,77,79,0.06)', label: '⚠ 超期未到货' };
    }
    return { kind: 'partial', border: 'var(--color-border)', bg: 'var(--color-bg)', label: '部分到货' };
  };

  // 打开到货确认弹窗（按组）
  const openArrive = (group) => {
    const unarrived = group.items.filter(it => !it.arrived);
    if (unarrived.length === 0) {
      message.info('该组商品已全部到货');
      return;
    }
    setArrivingItem(group);
    setArriveWarehouse(currentPO?.arrival_warehouse || warehouses[0] || '');
    setArrivalVoucher([]);
    setArriveModal(true);
  };

  // 确认逐项到货
  const confirmArrive = async () => {
    if (!arriveWarehouse) { message.warning('请选择到货仓库'); return; }
    if (!arrivingItem) return;
    setArriving(true);
    try {
      const unarrivedItems = arrivingItem.items.filter(it => !it.arrived);
      for (const item of unarrivedItems) {
        await api.post(`/purchases/${currentPO.id}/items/${item.id}/arrive`, {
          warehouse: arriveWarehouse,
          arrival_voucher: arrivalVoucher.join(','),
        });
      }
      message.success('到货确认成功');
      setArriveModal(false);
      const res = await api.get(`/purchases/${currentPO.id}`);
      setCurrentPO(res.data);
      load();
    } catch (err) {
      message.error(err.response?.data?.error || '操作失败');
    } finally {
      setArriving(false);
    }
  };

  const columns = [
    { title: '进货单号', dataIndex: 'po_no', width: 184, align: 'left',
      render: (v, r) => <a onClick={() => viewDetail(r)} style={{ fontWeight: 600 }}>{v}</a> },
    { title: '关联订单', dataIndex: 'order_no', width: 128, align: 'left',
      render: (v, r) => v
        ? <a onClick={() => nav(`/orders/${r.order_id}`)} style={{ fontWeight: 500 }}><LinkOutlined style={{ marginRight: 4 }} />{v}</a>
        : <span style={{ color: 'var(--color-text-tertiary)' }}>-</span> },
    { title: '到货仓库', dataIndex: 'arrival_warehouse', width: 112, align: 'left',
      render: v => v || <span style={{ color: 'var(--color-text-tertiary)' }}>-</span> },
    { title: '金额', dataIndex: 'total_amount', width: 104, align: 'right',
      render: v => <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>¥{Number(v||0).toLocaleString()}</span> },
    { title: '状态', dataIndex: 'status', width: 88, align: 'center', render: v => {
      const s = STATUS_MAP[v] || { color: 'default', label: v };
      return <Tag color={s.color} style={{ margin: 0, borderRadius: 4, padding: '0 8px', lineHeight: '22px' }}>{s.label}</Tag>;
    }},
    { title: '备注', dataIndex: 'note', width: 128, ellipsis: { showTitle: false }, align: 'left',
      render: v => v ? <Tooltip title={v}><span style={{ color: 'var(--color-text-tertiary)' }}>{v}</span></Tooltip> : '-' },
    { title: '创建时间', dataIndex: 'created_at', width: 120, align: 'center',
      render: v => v ? <span style={{ color: 'var(--color-text-tertiary)' }}>{v.slice(0, 10)}</span> : '-' },
    { title: '操作', key: 'action', width: 184, align: 'center', fixed: 'right', render: (_, r) => {
      const canEdit = ['pending', 'ordered'].includes(r.status) || (r.status === 'arrived' && isAdmin);
      const canDelete = r.status !== 'arrived' || isAdmin;
      return (
        <Space size={4} className="purchases-actions-cell">
          <Button icon={<EyeOutlined />}
            className="app-action-btn"
            onClick={() => viewDetail(r)}
            title="详情" />
          {canEdit && (
            <Button icon={<EditOutlined />}
              className="app-action-btn"
              onClick={() => openEdit(r)}
              title="编辑" />
          )}
          {canDelete && (
            <Popconfirm title="确定删除该进货单？" onConfirm={() => handleDelete(r.id)} okText="确定" cancelText="取消">
              <Button icon={<DeleteOutlined />}
                className="app-action-btn app-action-del"
                title="删除" />
            </Popconfirm>
          )}
        </Space>
      );
    }},
  ];

  return (
    <div>
      <PageHeader title="订货管理" />
      {/* ===== 筛选与操作栏 ===== */}
      <FilterBar>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          {/* 左侧：视图切换 + 搜索控件组 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Segmented
              value={viewMode}
              onChange={setViewMode}
              options={[
                { label: <span><GroupOutlined /> 按销售单分组</span>, value: 'group' },
                { label: <span><UnorderedListOutlined /> 平铺</span>, value: 'flat' },
              ]}
            />
            <Input
              placeholder="搜索进货单号/供应商"
              prefix={<SearchOutlined />}
              value={search}
              onChange={e => setSearch(e.target.value)}
              allowClear
              className="filter-search"
            />
            <Select
              placeholder="状态筛选"
              value={statusFilter}
              onChange={v => setStatusFilter(v || null)}
              allowClear
              className="w-sm"
            >
              {Object.entries(STATUS_MAP).map(([k, v]) => (
                <Select.Option key={k} value={k}>{v.label}</Select.Option>
              ))}
            </Select>
            {viewMode === 'group' && (
              <>
                <Input
                  placeholder="按销售单号筛选"
                  prefix={<LinkOutlined />}
                  value={orderNoFilter}
                  onChange={e => setOrderNoFilter(e.target.value)}
                  allowClear
                  className="w-sm"
                />
                <Checkbox checked={onlyUnlinked} onChange={e => setOnlyUnlinked(e.target.checked)}>只看未关联</Checkbox>
                <Select value={overdueDays} onChange={v => setOverdueDays(v)} className="w-sm">
                  <Select.Option value={7}>超期阈值 7 天</Select.Option>
                  <Select.Option value={15}>超期阈值 15 天</Select.Option>
                  <Select.Option value={30}>超期阈值 30 天</Select.Option>
                </Select>
              </>
            )}
            <ExcelImportExport module="purchases" onImported={load} />
          </div>
          {/* 右侧：新建 */}
          <Button icon={<PlusOutlined />} onClick={openCreate}
            className="purchases-create-btn-pc">
            创建进货单
          </Button>
        </div>
      </FilterBar>

      {/* ===== 数据区：分组 / 平铺 ===== */}
      {viewMode === 'group' ? (
        groups.length === 0 ? (
          <Card size="small" style={{ borderRadius: 8 }}><EmptyState title="暂无进货单" description="切换分组维度或创建进货单录入" /></Card>
        ) : isMobile ? (
          /* 移动端：分组卡片 */
          <div className="po-group-list">
            {groups.map(g => {
              const st = computeGroupState(g);
              const percent = g.total > 0 ? Math.round(g.arrived / g.total * 100) : 0;
              return (
                <Card key={g.key} size="small" className="po-group-card"
                  style={{ marginBottom: 12, borderRadius: 'var(--radius-lg)', borderColor: st.border, background: st.bg }}>
                  <div className="po-group-head">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 700, fontSize: 16 }}>
                        {g.isRestock ? '自主进货' : (g.orderNo
                          ? <a onClick={() => nav(`/orders/${g.orderId}`)} style={{ color: 'inherit' }}><LinkOutlined style={{ marginRight: 4 }} />{g.orderNo}</a>
                          : '销售单')}
                      </span>
                      {!g.isRestock && g.orderCustomer && <Tag color="blue" style={{ margin: 0 }}>{g.orderCustomer}</Tag>}
                      <Tag color={st.kind === 'ready' || st.kind === 'restock_done' ? 'var(--status-done)' : st.kind === 'overdue' ? 'var(--status-cancel)' : 'default'} style={{ margin: 0 }}>{st.label}</Tag>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
                      <Progress percent={percent} style={{ flex: 1, margin: 0 }} status={st.kind === 'overdue' ? 'exception' : 'normal'} />
                      <span style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>到货 {g.arrived}/{g.total}</span>
                    </div>
                  </div>
                  <div className="x-mcard-list" style={{ marginTop: 8 }}>
                    {g.items.map(r => (
                      <div className="x-mcard" key={r.id}>
                        <div className="x-mcard-head">
                          <div className="x-mcard-title">
                            <a onClick={() => viewDetail(r)} style={{ fontWeight: 600 }}>{r.po_no}</a>
                            {(() => {
                              const s = STATUS_MAP[r.status] || { color: 'default', label: r.status };
                              return <Tag color={s.color} style={{ margin: 0, borderRadius: 4, padding: '0 8px', lineHeight: '22px' }}>{s.label}</Tag>;
                            })()}
                          </div>
                          <div className="x-mcard-actions">
                            <Button icon={<EyeOutlined />} onClick={() => viewDetail(r)} title="详情" />
                            {(['pending', 'ordered'].includes(r.status) || (r.status === 'arrived' && isAdmin)) && (
                              <Button icon={<EditOutlined />} onClick={() => openEdit(r)} title="编辑" />
                            )}
                            {(r.status !== 'arrived' || isAdmin) && (
                              <Popconfirm title="确定删除该进货单？" onConfirm={() => handleDelete(r.id)} okText="确定" cancelText="取消">
                                <Button icon={<DeleteOutlined />} title="删除" />
                              </Popconfirm>
                            )}
                          </div>
                        </div>
                        <div className="x-mcard-grid">
                          <div className="x-mcard-field"><span className="x-mcard-label">关联订单</span><span className="x-mcard-value">{r.order_no || '-'}</span></div>
                          <div className="x-mcard-field"><span className="x-mcard-label">到货仓库</span><span className="x-mcard-value">{r.arrival_warehouse || '-'}</span></div>
                          <div className="x-mcard-field"><span className="x-mcard-label">金额</span><span className="x-mcard-value" style={{ fontWeight: 600 }}>¥{Number(r.total_amount || 0).toLocaleString()}</span></div>
                          <div className="x-mcard-field"><span className="x-mcard-label">创建时间</span><span className="x-mcard-value">{r.created_at ? r.created_at.slice(0, 10) : '-'}</span></div>
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              );
            })}
          </div>
        ) : (
          /* 电脑端：Collapse 分组 */
          <Collapse defaultActiveKey={groups.map(g => g.key)} bordered={false} className="po-group-collapse">
            {groups.map(g => {
              const st = computeGroupState(g);
              const percent = g.total > 0 ? Math.round(g.arrived / g.total * 100) : 0;
              const groupColumns = columns.filter(c => c.dataIndex !== 'order_no');
              return (
                <Panel key={g.key} header={(
                  <div className="po-group-head-pc" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingRight: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 700, fontSize: 16 }}>
                        {g.isRestock ? '自主进货' : (g.orderNo
                          ? <a onClick={() => nav(`/orders/${g.orderId}`)} style={{ color: 'inherit' }}><LinkOutlined style={{ marginRight: 4 }} />{g.orderNo}</a>
                          : '销售单')}
                      </span>
                      {!g.isRestock && g.orderCustomer && <Tag color="blue" style={{ margin: 0 }}>{g.orderCustomer}</Tag>}
                      <Tag color={st.kind === 'ready' || st.kind === 'restock_done' ? 'var(--status-done)' : st.kind === 'overdue' ? 'var(--status-cancel)' : 'default'} style={{ margin: 0 }}>{st.label}</Tag>
                      <span style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>共 {g.items.length} 张进货单</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 240 }}>
                      <Progress percent={percent} style={{ flex: 1, margin: 0 }} status={st.kind === 'overdue' ? 'exception' : 'normal'} />
                      <span style={{ fontSize: 12, color: 'var(--color-text-tertiary)', whiteSpace: 'nowrap' }}>到货 {g.arrived}/{g.total}</span>
                    </div>
                  </div>
                )}>
                  <Table
                    dataSource={g.items}
                    columns={groupColumns}
                    rowKey="id"
                    size="middle"
                    className="purchases-list-table"
                    pagination={false}
                    scroll={{ x: TABLE_SCROLL_X.standard }}
                  />
                </Panel>
              );
            })}
          </Collapse>
        )
      ) : (
        /* ---------- 平铺模式（原逻辑） ---------- */
        isMobile ? (
          <div className="x-mcard-list">
            {paginated.map(r => (
              <div className="x-mcard" key={r.id}>
                <div className="x-mcard-head">
                  <div className="x-mcard-title">
                    <a onClick={() => viewDetail(r)} style={{ fontWeight: 600 }}>{r.po_no}</a>
                    {(() => {
                      const s = STATUS_MAP[r.status] || { color: 'default', label: r.status };
                      return <Tag color={s.color} style={{ margin: 0, borderRadius: 4, padding: '0 8px', lineHeight: '22px' }}>{s.label}</Tag>;
                    })()}
                  </div>
                  <div className="x-mcard-actions">
                    <Button icon={<EyeOutlined />} onClick={() => viewDetail(r)} title="详情" />
                    {(['pending', 'ordered'].includes(r.status) || (r.status === 'arrived' && isAdmin)) && (
                      <Button icon={<EditOutlined />} onClick={() => openEdit(r)} title="编辑" />
                    )}
                    {(r.status !== 'arrived' || isAdmin) && (
                      <Popconfirm title="确定删除该进货单？" onConfirm={() => handleDelete(r.id)} okText="确定" cancelText="取消">
                        <Button icon={<DeleteOutlined />} title="删除" />
                      </Popconfirm>
                    )}
                  </div>
                </div>
                <div className="x-mcard-grid">
                  <div className="x-mcard-field"><span className="x-mcard-label">关联订单</span><span className="x-mcard-value">{r.order_no || '-'}</span></div>
                  <div className="x-mcard-field"><span className="x-mcard-label">到货仓库</span><span className="x-mcard-value">{r.arrival_warehouse || '-'}</span></div>
                  <div className="x-mcard-field"><span className="x-mcard-label">金额</span><span className="x-mcard-value" style={{ fontWeight: 600 }}>¥{Number(r.total_amount || 0).toLocaleString()}</span></div>
                  <div className="x-mcard-field"><span className="x-mcard-label">创建时间</span><span className="x-mcard-value">{r.created_at ? r.created_at.slice(0, 10) : '-'}</span></div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Card size="small" style={{ borderRadius: 8, marginBottom: 0 }}
            styles={{ body: { padding: 0 } }}>
            <div className="app-data-table">
              <Table
                dataSource={paginated}
                columns={columns}
                rowKey="id"
                loading={loading}
                locale={{ emptyText: <EmptyState title="暂无进货单" description="点击右上角「创建进货单」录入" /> }}
                scroll={{ x: TABLE_SCROLL_X.standard }}
                size="middle"
                className="purchases-list-table"
                rowClassName={(_, idx) => idx % 2 === 0 ? 'app-row-even' : 'app-row-odd'}
                pagination={false}
              />
            </div>
          </Card>
        )
      )}

      {/* ===== 分页栏（仅平铺模式） ===== */}
      {viewMode === 'flat' && filtered.length > 0 && (
        <div className="app-pagination-bar">
          <span className="app-pagination-total">共 {filtered.length} 条</span>
          <Pagination
            current={page}
            total={filtered.length}
            pageSize={pageSize}
            onChange={setPage}
            showSizeChanger={false}
            size="small"
          />
        </div>
      )}

      {/* 创建进货单 */}
      <Modal className="modal-lg" title="创建进货单" open={modalOpen} onOk={handleCreate} onCancel={() => setModalOpen(false)} confirmLoading={submitting} destroyOnClose>
        <Form form={form} layout="vertical" requiredMark="optional">
          <div className="edit-card">
            <div className="edit-card-title"><CarOutlined /> 基本信息</div>
            <div className="edit-card-body">
              <Form.Item name="supplier" label="供应商" className="form-w-full">
                <Input placeholder="可选" style={{ borderRadius: 8 }} />
              </Form.Item>
            </div>
          </div>
          <div className="edit-card">
            <div className="edit-card-title"><UnorderedListOutlined /> 进货商品</div>
            <div className="edit-card-body">
              <Form.Item label="进货商品" className="form-w-full">
                <Form.List name="items">
                  {(fields, { add, remove }) => (
                    <>
                      {fields.map(({ key, name, ...rest }) => (
                        <div key={key} style={{
                          border: '1px solid var(--color-border)', borderRadius: 8, padding: 16, marginBottom: 8,
                          background: 'var(--color-bg)',
                        }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                            <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--color-text-tertiary)' }}>商品 #{name + 1}</span>
                            {fields.length > 1 && (
                              <Button type="link" danger icon={<DeleteOutlined />} onClick={() => remove(name)}>删除</Button>
                            )}
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8 }}>
                            <Form.Item {...rest} name={[name, 'product_name']} label="进货商品"
                              rules={[{ required: true, message: '请输入商品名称' }]}>
                              <Input placeholder="输入商品名称" style={{ borderRadius: 8 }} />
                            </Form.Item>
                            <Form.Item {...rest} name={[name, 'brand']} label="品牌"><Input placeholder="品牌" style={{ borderRadius: 8 }} /></Form.Item>
                            <Form.Item {...rest} name={[name, 'model']} label="型号"><Input placeholder="型号" style={{ borderRadius: 8 }} /></Form.Item>
                            <Form.Item {...rest} name={[name, 'spec']} label="规格"><Input placeholder="规格" style={{ borderRadius: 8 }} /></Form.Item>
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 2fr', gap: 8, alignItems: 'end' }}>
                            <Form.Item {...rest} name={[name, 'unit_price']} label="进价" rules={[{ required: true }]}>
                              <InputNumber placeholder="进价" min={0} prefix="¥" style={{ width: '100%', borderRadius: 8 }}
                                onChange={() => form.setFieldsValue({ items: form.getFieldValue('items') })}
                              />
                            </Form.Item>
                            <Form.Item {...rest} name={[name, 'quantity']} label="数量" rules={[{ required: true }]}>
                              <InputNumber placeholder="数量" min={1} style={{ width: '100%', borderRadius: 8 }}
                                onChange={() => form.setFieldsValue({ items: form.getFieldValue('items') })}
                              />
                            </Form.Item>
                            <Form.Item label="总价">
                              <Input value={`¥${calcRowTotal(name)}`} disabled style={{ width: '100%', borderRadius: 8 }} />
                            </Form.Item>
                            <Form.Item {...rest} name={[name, 'note']} label="备注"><Input placeholder="备注" style={{ borderRadius: 8 }} /></Form.Item>
                          </div>
                        </div>
                      ))}
                      <Button type="dashed" onClick={() => add()} block icon={<PlusOutlined />}>+ 添加商品</Button>
                    </>
                  )}
                </Form.List>
              </Form.Item>
            </div>
          </div>
          <div className="edit-card">
            <div className="edit-card-title"><EditOutlined /> 备注</div>
            <div className="edit-card-body">
              <Form.Item name="note" label="进货单备注" className="form-w-full">
                <Input.TextArea rows={2} placeholder="整单备注（可选）" style={{ borderRadius: 8 }} />
              </Form.Item>
            </div>
          </div>
          <div className="edit-card">
            <div className="edit-card-title"><LinkOutlined /> 财务付款凭证</div>
            <div className="edit-card-body">
              <Form.Item name="payment_voucher" className="form-w-full" label="上传付款凭证">
                <VoucherUploader />
              </Form.Item>
              <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginTop: -8 }}>上传后自动压缩至 100KB 以内</div>
            </div>
          </div>
        </Form>
      </Modal>

      {/* 编辑进货单 */}
      <Modal className="modal-lg" title={`编辑进货单 ${editingPO?.po_no || ''}`} open={editModalOpen} onOk={handleEdit} onCancel={() => setEditModalOpen(false)} confirmLoading={submitting} destroyOnClose>
        <Form form={editForm} layout="vertical" requiredMark="optional">
          <div className="edit-card">
            <div className="edit-card-title"><CarOutlined /> 基本信息</div>
            <div className="edit-card-body">
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 8 }}>
                <Form.Item name="supplier" label="供应商" className="form-w-full">
                  <Input placeholder="可选" style={{ borderRadius: 8 }} />
                </Form.Item>
                <Form.Item name="arrival_warehouse" label="到货仓库" className="form-w-full">
                  <Select placeholder="选择仓库" allowClear showSearch style={{ borderRadius: 8 }}>
                    {warehouses.map(w => <Select.Option key={w} value={w}>{w}</Select.Option>)}
                  </Select>
                </Form.Item>
              </div>
            </div>
          </div>
          <div className="edit-card">
            <div className="edit-card-title"><UnorderedListOutlined /> 进货商品</div>
            <div className="edit-card-body">
              <Form.Item label="进货商品" className="form-w-full">
                <Form.List name="items">
                  {(fields, { add, remove }) => (
                    <>
                      {fields.map(({ key, name, ...rest }) => (
                        <div key={key} style={{
                          border: '1px solid var(--color-border)', borderRadius: 8, padding: 16, marginBottom: 8,
                          background: 'var(--color-bg)',
                        }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                            <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--color-text-tertiary)' }}>商品 #{name + 1}</span>
                            {fields.length > 1 && (
                              <Button type="link" danger icon={<DeleteOutlined />} onClick={() => remove(name)}>删除</Button>
                            )}
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8 }}>
                            <Form.Item {...rest} name={[name, 'product_name']} label="进货商品" rules={[{ required: true }]}>
                              <Input placeholder="输入商品名称" style={{ borderRadius: 8 }} />
                            </Form.Item>
                            <Form.Item {...rest} name={[name, 'brand']} label="品牌"><Input placeholder="品牌" style={{ borderRadius: 8 }} /></Form.Item>
                            <Form.Item {...rest} name={[name, 'model']} label="型号"><Input placeholder="型号" style={{ borderRadius: 8 }} /></Form.Item>
                            <Form.Item {...rest} name={[name, 'spec']} label="规格"><Input placeholder="规格" style={{ borderRadius: 8 }} /></Form.Item>
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 2fr', gap: 8, alignItems: 'end' }}>
                            <Form.Item {...rest} name={[name, 'unit_price']} label="进价" rules={[{ required: true }]}>
                              <InputNumber placeholder="进价" min={0} prefix="¥" style={{ width: '100%', borderRadius: 8 }} />
                            </Form.Item>
                            <Form.Item {...rest} name={[name, 'quantity']} label="数量" rules={[{ required: true }]}>
                              <InputNumber placeholder="数量" min={1} style={{ width: '100%', borderRadius: 8 }} />
                            </Form.Item>
                            <Form.Item label="总价"><Input disabled style={{ width: '100%', borderRadius: 8 }} /></Form.Item>
                            <Form.Item {...rest} name={[name, 'note']} label="备注"><Input placeholder="备注" style={{ borderRadius: 8 }} /></Form.Item>
                          </div>
                        </div>
                      ))}
                      <Button type="dashed" onClick={() => add()} block icon={<PlusOutlined />}>+ 添加商品</Button>
                    </>
                  )}
                </Form.List>
              </Form.Item>
            </div>
          </div>
          <div className="edit-card">
            <div className="edit-card-title"><EditOutlined /> 备注</div>
            <div className="edit-card-body">
              <Form.Item name="note" label="进货单备注" className="form-w-full">
                <Input.TextArea rows={2} placeholder="整单备注" style={{ borderRadius: 8 }} />
              </Form.Item>
            </div>
          </div>
          <div className="edit-card">
            <div className="edit-card-title"><LinkOutlined /> 财务付款凭证</div>
            <div className="edit-card-body">
              <Form.Item name="payment_voucher" className="form-w-full" label="上传付款凭证">
                <VoucherUploader />
              </Form.Item>
              <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginTop: -8 }}>上传后自动压缩至 100KB 以内</div>
            </div>
          </div>
        </Form>
      </Modal>

      {/* 进货单详情 */}
      <Modal className="modal-md" title={`进货单 ${currentPO?.po_no}`} open={detailOpen} onCancel={() => setDetailOpen(false)} footer={null}>
        {currentPO && (
          <>
            <Descriptions column={2} size="small" bordered style={{ marginBottom: 16 }}>
              <Descriptions.Item label="关联订单">{currentPO.order_no ? <Tag color="blue">{currentPO.order_no}</Tag> : '-'}</Descriptions.Item>
              <Descriptions.Item label="到货仓库">{currentPO.arrival_warehouse || '-'}</Descriptions.Item>
              <Descriptions.Item label="金额"><span className="money">{formatMoneyInt(currentPO.total_amount)}</span></Descriptions.Item>
              <Descriptions.Item label="状态">
              {({ pending: '待进货', ordered: '已订货', arrived: '已到货', cancelled: '已取消' })[currentPO.status] || currentPO.status}
            </Descriptions.Item>
              <Descriptions.Item label="操作人">{currentPO.operator_name || '-'}</Descriptions.Item>
              <Descriptions.Item label="创建时间">{currentPO.created_at}</Descriptions.Item>
              {currentPO.note && <Descriptions.Item label="备注" span={2}>{currentPO.note}</Descriptions.Item>}
              {currentPO.payment_voucher ? (
                <Descriptions.Item label="付款凭证" span={2}>
                  <VoucherUploader value={currentPO.payment_voucher.split(',').filter(Boolean)} onChange={() => {}} disabled />
                </Descriptions.Item>
              ) : null}
            </Descriptions>

            {/* 按商品名称+型号分组展示，每行到货按钮 */}
            <div style={{ marginTop: 8 }}>
              <h4 style={{ marginBottom: 8, fontSize: 14, color: 'var(--color-text-secondary)' }}>商品明细</h4>
              {groupedItems.map((group, idx) => {
                const totalQty = group.items.reduce((s, i) => s + i.quantity, 0);
                const arrivedQty = group.items.filter(i => i.arrived).length;
                const specs = [...new Set(group.items.map(i => i.spec || '-'))].join(', ');
                const allArrived = group.items.every(i => i.arrived);
                const anyArrived = group.items.some(i => i.arrived);
                const arrivalVouchers = group.items
                  .map(i => i.arrival_voucher).filter(Boolean)
                  .join(',').split(',').filter(Boolean);
                return (
                  <div key={idx} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '8px 12px', marginBottom: 6, borderRadius: 6,
                    background: allArrived ? 'var(--color-success-bg)' : anyArrived ? 'var(--color-warning-bg)' : 'var(--color-bg)',
                    border: `1px solid ${allArrived ? 'var(--color-success)' : anyArrived ? 'var(--color-warning)' : 'var(--color-border)'}`,
                  }}>
                    <div style={{ flex: 1, minWidth: 8 }}>
                      <div style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)', color: 'var(--color-text)' }}>
                        {group.product_name}
                        {allArrived ? <Tag color="var(--status-done)" style={{ marginLeft: 6 }}>已到货</Tag> : anyArrived ? <Tag color="var(--status-stock)" style={{ marginLeft: 6 }}>部分到货</Tag> : null}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginTop: 2 }}>
                        型号: {group.model || '-'} | 规格: {specs} | 数量: {totalQty}
                      </div>
                      {arrivalVouchers.length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                          {arrivalVouchers.map((u, k) => (
                            <a key={k} href={u} target="_blank" rel="noreferrer">
                              <img src={u} alt="到货凭证" style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 4, border: '1px solid var(--color-border)' }} />
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                    <Button
                      type={allArrived ? 'default' : 'primary'}
                      size="small"
                      disabled={allArrived}
                      onClick={() => openArrive(group)}
                      loading={arriving && arrivingItem === group}
                    >
                      {allArrived ? '已到货' : '到货'}
                    </Button>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </Modal>

      {/* 到货仓库确认弹窗 */}
      <Modal
        title="物流仓库确认"
        open={arriveModal}
        onOk={confirmArrive}
        onCancel={() => setArriveModal(false)}
        confirmLoading={arriving}
        okText="确认到货"
        cancelText="取消"
      >
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            {arrivingItem?.product_name}
          </div>
          <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
            型号: {arrivingItem?.model || '-'} | 数量: {arrivingItem?.items?.reduce((s, i) => s + i.quantity, 0)}
          </div>
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>到货仓库</label>
          <Select
            value={arriveWarehouse || undefined}
            onChange={setArriveWarehouse}
            placeholder="选择仓库"
            showSearch
            style={{ width: '100%' }}
            notFoundContent={null}
          >
            {warehouses.map(w => <Select.Option key={w} value={w}>{w}</Select.Option>)}
          </Select>
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>到货单凭证</label>
          <VoucherUploader value={arrivalVoucher} onChange={setArrivalVoucher} />
          <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginTop: 4 }}>上传后自动压缩至 100KB 以内</div>
        </div>
      </Modal>

      {/* 分配弹窗 */}
      <Modal className="modal-md" title="分配商品到订单" open={allocModal} onOk={handleAlloc} onCancel={() => setAllocModal(false)}>
        <p style={{ marginBottom: 12, color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)' }}>将进货单中的商品分配到以下待分配的订单项</p>
        <Table dataSource={pendingOrders} columns={[
          { title: '订单号', dataIndex: 'order_no', width: 144 },
          { title: '客户', dataIndex: 'customer_name', width: 80 },
          { title: '商品', dataIndex: 'product_name', width: 120 },
          { title: '待分配', key: 'need', width: 80,
            render: (_, r) => `${r.allocated}/${r.quantity}`
          },
        ]} rowKey="id" size="small" pagination={false} style={{ marginBottom: 16 }} />
        <Form form={allocForm} layout="vertical">
          <Form.List name="allocations">
            {(fields, { add, remove }) => (
              <>
                {fields.map(({ key, name, ...rest }) => (
                  <Space key={key} style={{ display: 'flex', marginBottom: 8 }} align="baseline">
                    <Form.Item {...rest} name={[name, 'purchase_item_id']} label="进货项" rules={[{ required: true }]}>
                      <Select placeholder="选择"  className="w-md">
                        {currentPO?.items?.map(i => <Select.Option key={i.id} value={i.id}>{i.product_name} (剩余:{i.quantity - i.allocated})</Select.Option>)}
                      </Select>
                    </Form.Item>
                    <Form.Item {...rest} name={[name, 'order_item_id']} label="订单项" rules={[{ required: true }]}>
                      <Select placeholder="选择"  className="w-md">
                        {pendingOrders.map(o => <Select.Option key={o.id} value={o.id}>{o.order_no} - {o.product_name} ({o.allocated}/{o.quantity})</Select.Option>)}
                      </Select>
                    </Form.Item>
                    <Form.Item {...rest} name={[name, 'quantity']} label="数量" rules={[{ required: true }]}>
                      <InputNumber min={1} className="w-xs" />
                    </Form.Item>
                    <Button type="link" danger onClick={() => remove(name)}>删除</Button>
                  </Space>
                ))}
                <Button type="dashed" onClick={() => add()} block>+ 添加分配</Button>
              </>
            )}
          </Form.List>
        </Form>
      </Modal>
    </div>
  );
}
