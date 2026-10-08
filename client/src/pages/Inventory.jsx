import { TABLE_SCROLL_X } from '../components/tableConstants';
import { formatMoneyInt } from '../utils/format';
import { useState, useEffect, useMemo } from 'react';
import { Card, Table, Button, Modal, InputNumber, Input, Tag, Space, message, Pagination, Select, Grid, Drawer, Empty, Tooltip } from 'antd';
import { PlusOutlined, MinusOutlined, SearchOutlined, EyeOutlined, EditOutlined, WarningOutlined } from '@ant-design/icons';
import api from '../api';
import PageHeader from '../components/PageHeader';
import ExcelImportExport from '../components/ExcelImportExport';
import FilterBar from '../components/FilterBar';
import EmptyState from '../components/EmptyState';

const categoryMap = {
  sample: { color: 'blue', text: '样品' },
  gift: { color: 'green', text: '赠品' },
  order: { color: 'orange', text: '订货' },
};

const stockColor = (v, isLow) => isLow ? 'red' : 'green';

export default function Inventory() {
  const { md } = Grid.useBreakpoint();
  const isMobile = !md;
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(false);

  // 出入库 / 盘点 目标（商品或变体）
  const [opModal, setOpModal] = useState(null); // { mode:'in'|'out'|'adjust', kind:'product'|'variant', id, name, current }
  const [quantity, setQuantity] = useState(1);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // 流水抽屉
  const [logs, setLogs] = useState([]);
  const [logsOpen, setLogsOpen] = useState(false);
  const [logsName, setLogsName] = useState('');
  const [logsLoading, setLogsLoading] = useState(false);

  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState(null);
  const [lowOnly, setLowOnly] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = 20;

  // 统计看板
  const stats = useMemo(() => {
    let totalQty = 0, totalAmount = 0, lowCount = 0, inTransit = 0;
    for (const p of list) {
      const vQty = (p.variants || []).reduce((s, v) => s + (v.stock || 0), 0);
      const ownQty = p.stock || 0;
      totalQty += ownQty + vQty;
      totalAmount += (ownQty + vQty) * (p.cost_price || 0);
      if (p.is_low || (p.variants || []).some(v => v.is_low)) lowCount += 1;
      inTransit += (p.in_transit || 0);
    }
    return { totalQty, totalAmount, lowCount, inTransit };
  }, [list]);

  // 筛选
  const filtered = useMemo(() => {
    let l = list;
    if (search) {
      const kw = search.toLowerCase();
      l = l.filter(p =>
        (p.name || '').toLowerCase().includes(kw) ||
        (p.code || '').toLowerCase().includes(kw) ||
        (p.barcode || '').toLowerCase().includes(kw)
      );
    }
    if (catFilter) l = l.filter(p => p.category === catFilter);
    if (lowOnly) l = l.filter(p => p.is_low || (p.variants || []).some(v => v.is_low));
    return l;
  }, [list, search, catFilter, lowOnly]);

  const paginated = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page]);

  useEffect(() => { setPage(1); }, [search, catFilter, lowOnly]);

  const load = async () => {
    setLoading(true);
    try { const res = await api.get('/inventory/all'); setList(res.data || []); }
    catch { message.error('加载失败'); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const openOp = (mode, kind, target) => {
    setOpModal({ mode, kind, id: target.id, name: kind === 'variant' ? `${target.product_name || ''} / ${target.spec}` : target.name, current: target.stock });
    setQuantity(mode === 'adjust' ? (target.stock || 0) : 1);
    setReason('');
    setSubmitting(false);
  };

  const handleSubmitOp = async () => {
    if (!opModal) return;
    setSubmitting(true);
    try {
      const { mode, kind, id } = opModal;
      if (mode === 'adjust') {
        const actual = Number(quantity);
        if (!Number.isFinite(actual) || actual < 0) { message.error('请输入有效数量'); setSubmitting(false); return; }
        const url = kind === 'variant' ? '/inventory/variant/adjust' : '/inventory/adjust';
        const body = kind === 'variant' ? { variant_id: id, actual_quantity: actual } : { product_id: id, actual_quantity: actual };
        await api.post(url, body);
        message.success('盘点已更新');
      } else {
        if (!quantity || quantity <= 0) { message.error('数量无效'); setSubmitting(false); return; }
        const inOut = mode === 'in' ? 'in' : 'out';
        const url = kind === 'variant'
          ? `/inventory/variant/${inOut}`
          : `/inventory/${inOut}`;
        const body = kind === 'variant' ? { variant_id: id, quantity, reason } : { product_id: id, quantity, reason };
        await api.post(url, body);
        message.success(mode === 'in' ? '入库成功' : '出库成功');
      }
      setOpModal(null);
      load();
    } catch (err) { message.error(err.response?.data?.error || '操作失败'); }
    finally { setSubmitting(false); }
  };

  const openLogs = async (p) => {
    setLogsName(p.name);
    setLogsOpen(true);
    setLogsLoading(true);
    try {
      const res = await api.get('/inventory/logs', { params: { product_id: p.id, limit: 100 } });
      setLogs(res.data || []);
    } catch { message.error('加载流水失败'); }
    finally { setLogsLoading(false); }
  };

  const renderStockTag = (v, isLow) => (
    <Tag color={stockColor(v, isLow)} style={{ margin: 0, borderRadius: 4, padding: '0 8px', lineHeight: '22px', fontWeight: 500 }}>
      {v}
    </Tag>
  );

  const renderActions = (r) => {
    if (!r.is_manageable) {
      return (
        <Tooltip title="订货类库存由开单/订货自动驱动，不可手动改">
          <Button icon={<EyeOutlined />} onClick={() => openLogs(r)} title="查看流水" />
        </Tooltip>
      );
    }
    return (
      <Space size={4} className="inventory-actions-cell">
        <Button icon={<PlusOutlined />} className="app-action-btn" onClick={() => openOp('in', 'product', r)} title="入库" />
        <Button icon={<MinusOutlined />} className="app-action-btn app-action-del" onClick={() => openOp('out', 'product', r)} title="出库" />
        <Button icon={<EditOutlined />} onClick={() => openOp('adjust', 'product', r)} title="盘点" />
        <Button icon={<EyeOutlined />} onClick={() => openLogs(r)} title="流水" />
      </Space>
    );
  };

  const variantColumns = [
    { title: '规格', dataIndex: 'spec', key: 'spec', align: 'left', render: v => v || <span style={{ color: 'var(--color-text-tertiary)' }}>-</span> },
    { title: '售价', dataIndex: 'price', key: 'price', width: 88, align: 'right', render: v => <span style={{ fontVariantNumeric: 'tabular-nums' }}>¥{Number(v || 0).toLocaleString()}</span> },
    { title: '库存', dataIndex: 'stock', key: 'stock', width: 80, align: 'center', render: (v, r) => renderStockTag(v, r.is_low) },
    { title: '预警', key: 'warn', width: 72, align: 'center', render: (_, r) => r.is_low ? <Tag color="red" className="stock-pulse" style={{ margin: 0, borderRadius: 4, padding: '0 6px', lineHeight: '20px' }}>预警</Tag> : <span style={{ color: 'var(--color-text-tertiary)' }}>-</span> },
    { title: '操作', key: 'action', width: 152, align: 'center', render: (_, r) => (
      <Space size={4}>
        <Button icon={<PlusOutlined />} className="app-action-btn" onClick={() => openOp('in', 'variant', r)} title="入库" />
        <Button icon={<MinusOutlined />} className="app-action-btn app-action-del" onClick={() => openOp('out', 'variant', r)} title="出库" />
        <Button icon={<EditOutlined />} onClick={() => openOp('adjust', 'variant', r)} title="盘点" />
      </Space>
    ) },
  ];

  const columns = [
    { title: '商品', dataIndex: 'name', key: 'name', width: 200, align: 'left',
      render: (v, r) => (
        <div>
          <span style={{ fontWeight: 500 }}>{v}</span>
          <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>
            {r.code || '-'}{r.barcode ? ` · 条码 ${r.barcode}` : ''}
          </div>
        </div>
      )
    },
    { title: '分类', dataIndex: 'category', key: 'category', width: 80, align: 'center',
      render: c => <Tag color={categoryMap[c]?.color || 'default'} style={{ margin: 0, borderRadius: 4, padding: '0 8px', lineHeight: '22px' }}>{categoryMap[c]?.text || c}</Tag>
    },
    { title: '售价', dataIndex: 'price', key: 'price', width: 88, align: 'right',
      render: v => <span style={{ fontVariantNumeric: 'tabular-nums' }}>¥{Number(v || 0).toLocaleString()}</span>
    },
    { title: '库存', dataIndex: 'stock', key: 'stock', width: 80, align: 'center',
      render: (v, r) => renderStockTag(v, r.is_low)
    },
    { title: '已订未到', dataIndex: 'in_transit', key: 'in_transit', width: 88, align: 'center',
      render: (v, r) => r.in_transit > 0
        ? <Tag color="orange" style={{ margin: 0, borderRadius: 4, padding: '0 8px', lineHeight: '22px' }}>{r.in_transit}</Tag>
        : <span style={{ color: 'var(--color-text-tertiary)' }}>-</span>
    },
    { title: '预警', key: 'warn', width: 72, align: 'center',
      render: (_, r) => r.is_low ? <Tag color="red" className="stock-pulse" style={{ margin: 0, borderRadius: 4, padding: '0 6px', lineHeight: '20px' }}><WarningOutlined /> 预警</Tag> : <span style={{ color: 'var(--color-text-tertiary)' }}>-</span>
    },
    { title: '操作', key: 'action', width: 160, align: 'center', fixed: 'right', render: (_, r) => renderActions(r) },
  ];

  const statCard = (label, value, color, sub) => (
    <Card size="small" style={{ borderRadius: 8, flex: 1, minWidth: 152 }}>
      <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color, marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginTop: 2 }}>{sub}</div>}
    </Card>
  );

  return (
    <div>
      <PageHeader title="库存管理" />
      {/* ===== 统计看板 ===== */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
        {statCard('库存总件数', stats.totalQty.toLocaleString(), 'var(--color-text)', '含各规格')}
        {statCard('库存总金额(进价)', formatMoneyInt(stats.totalAmount), 'var(--color-primary)', '按进价估算')}
        {statCard('低库存款数', stats.lowCount, stats.lowCount > 0 ? 'var(--color-error)' : 'var(--color-text)', `低于安全库存 ${list[0]?.threshold ?? 5}`)}
        {statCard('已订未到(在途)', stats.inTransit.toLocaleString(), 'var(--color-warning)', '订货未到货')}
      </div>

      {/* ===== 筛选与操作栏 ===== */}
      <FilterBar>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Input placeholder="搜索名称/编码/条码" prefix={<SearchOutlined />} value={search} onChange={e => setSearch(e.target.value)} allowClear className="filter-search" />
            <Select placeholder="分类筛选" value={catFilter} onChange={v => setCatFilter(v || null)} allowClear className="w-sm">
              <Select.Option value="sample">样品</Select.Option>
              <Select.Option value="gift">赠品</Select.Option>
              <Select.Option value="order">订货</Select.Option>
            </Select>
            <Button type={lowOnly ? 'primary' : 'default'} icon={<WarningOutlined />} onClick={() => setLowOnly(!lowOnly)} style={{ height: 36 }}>
              仅看预警
            </Button>
            <ExcelImportExport module="inventory" onImported={load} />
          </div>
          <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>
            样品/赠品可手动出入库与盘点；订货类不核减库存，在途(已订未到)随订货订单签收自动变化（只读）
          </div>
        </div>
      </FilterBar>

      {/* ===== 数据区 ===== */}
      {isMobile ? (
        <div className="x-mcard-list">
          {paginated.map(r => (
            <div className="x-mcard" key={r.id}>
              <div className="x-mcard-head">
                <div className="x-mcard-title">
                  <span className="x-mcard-name">{r.name}</span>
                  <Tag color={categoryMap[r.category]?.color || 'default'} style={{ margin: 0 }}>{categoryMap[r.category]?.text || r.category}</Tag>
                </div>
              </div>
              <div className="x-mcard-grid">
                <div className="x-mcard-field"><span className="x-mcard-label">售价</span><span className="x-mcard-value">¥{Number(r.price || 0).toLocaleString()}</span></div>
                <div className="x-mcard-field"><span className="x-mcard-label">库存</span><span className="x-mcard-value">{renderStockTag(r.stock, r.is_low)}</span></div>
                <div className="x-mcard-field"><span className="x-mcard-label">已订未到</span><span className="x-mcard-value">{r.in_transit > 0 ? r.in_transit : '-'}</span></div>
                <div className="x-mcard-field"><span className="x-mcard-label">编码/条码</span><span className="x-mcard-value">{r.code || '-'}{r.barcode ? ` / ${r.barcode}` : ''}</span></div>
              </div>
              <div className="x-mcard-actions" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
                {renderActions(r)}
              </div>
            </div>
          ))}
          {paginated.length === 0 && <EmptyState title="暂无库存数据" description="点击「导入」或手动出入库维护库存" />}
        </div>
      ) : (
        <Card size="small" style={{ borderRadius: 8, marginBottom: 0 }} styles={{ body: { padding: 0 } }}>
          <div className="app-data-table">
            <Table
              dataSource={paginated}
              columns={columns}
              rowKey="id"
              loading={loading}
              locale={{ emptyText: <EmptyState title="暂无库存数据" description="点击「导入」或手动出入库维护库存" /> }}
              scroll={{ x: TABLE_SCROLL_X.compact }}
              size="middle"
              className="inventory-list-table"
              rowClassName={(_, idx) => idx % 2 === 0 ? 'app-row-even' : 'app-row-odd'}
              pagination={false}
              expandable={{
                expandedRowRender: (record) => record.variants && record.variants.length > 0 ? (
                  <Table dataSource={record.variants} columns={variantColumns} rowKey="id" pagination={false} size="small"
                    rowClassName={(_, idx) => idx % 2 === 0 ? 'app-row-even' : 'app-row-odd'} />
                ) : <div style={{ padding: 8, color: 'var(--color-text-tertiary)' }}>无规格</div>,
                rowExpandable: (record) => record.variants && record.variants.length > 0,
                expandRowByClick: true,
              }}
            />
          </div>
        </Card>
      )}

      {/* ===== 分页栏 ===== */}
      {filtered.length > 0 && (
        <div className="app-pagination-bar">
          <span className="app-pagination-total">共 {filtered.length} 条</span>
          <Pagination current={page} total={filtered.length} pageSize={pageSize} onChange={setPage} showSizeChanger={false} size="small" />
        </div>
      )}

      {/* ===== 出入库 / 盘点 弹窗 ===== */}
      <Modal
        title={`${opModal ? (opModal.mode === 'in' ? '入库' : opModal.mode === 'out' ? '出库' : '盘点') : ''} - ${opModal?.name || ''}`}
        open={!!opModal}
        onOk={handleSubmitOp}
        onCancel={() => setOpModal(null)}
        confirmLoading={submitting}
        className="modal-md"
        okText="确定"
        cancelText="取消"
      >
        <div className="edit-card">
          <div className="edit-card-title"><EditOutlined /> 操作信息</div>
          <div className="edit-card-body">
            {opModal?.mode === 'adjust' ? (
              <>
                <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginBottom: 8 }}>当前库存: {opModal.current}</div>
                <InputNumber min={0} value={quantity} onChange={setQuantity} style={{ width: '100%', borderRadius: 8 }} placeholder="实际库存数量" />
                <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginTop: 8 }}>系统将自动计算差异并记为「盘点修正」</div>
              </>
            ) : (
              <>
                <InputNumber min={1} value={quantity} onChange={setQuantity} style={{ width: '100%', borderRadius: 8 }} placeholder="数量" />
                <Input placeholder="备注（可选）" value={reason} onChange={e => setReason(e.target.value)} style={{ borderRadius: 8, marginTop: 8 }} />
              </>
            )}
          </div>
        </div>
      </Modal>

      {/* ===== 库存流水抽屉 ===== */}
      <Drawer title={`库存流水 - ${logsName}`} open={logsOpen} onClose={() => setLogsOpen(false)} width={isMobile ? '100%' : 520}>
        <Table
          dataSource={logs}
          loading={logsLoading}
          rowKey="id"
          pagination={{ pageSize: 10, size: 'small' }}
          size="small"
          columns={[
            { title: '时间', dataIndex: 'created_at', key: 'created_at', width: 144, render: v => (v || '').replace('T', ' ').slice(0, 19) },
            { title: '类型', dataIndex: 'type', key: 'type', width: 72, render: t => <Tag color={t === 'in' ? 'green' : t === 'out' ? 'red' : 'blue'}>{t === 'in' ? '入库' : t === 'out' ? '出库' : '调整'}</Tag> },
            { title: '变动', dataIndex: 'change_amount', key: 'change_amount', width: 72, align: 'right', render: v => <span style={{ color: v >= 0 ? 'var(--color-success)' : 'var(--color-error)', fontVariantNumeric: 'tabular-nums' }}>{v >= 0 ? `+${v}` : v}</span> },
            { title: '结存', dataIndex: 'after_quantity', key: 'after_quantity', width: 72, align: 'right' },
            { title: '原因', dataIndex: 'reason', key: 'reason', render: v => v || '-' },
            { title: '操作人', dataIndex: 'operator_name', key: 'operator_name', width: 88, render: v => v || '系统' },
          ]}
        />
      </Drawer>
    </div>
  );
}
