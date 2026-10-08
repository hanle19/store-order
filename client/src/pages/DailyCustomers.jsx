import { TABLE_SCROLL_X } from '../components/tableConstants';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, Table, Tag, Button, Select, DatePicker, Space, message, Popconfirm, Grid, Spin, Modal, Input, InputNumber } from 'antd';
import { DeleteOutlined, PhoneOutlined, UserOutlined, EditOutlined, DownloadOutlined } from '@ant-design/icons';
import api from '../api';
import { useAuth } from '../context/AuthContext';
import dayjs from 'dayjs';
import EmptyState from '../components/EmptyState';
import { formatMoneyInt } from '../utils/format';

const { useBreakpoint } = Grid;

const STYLE = {
  primary: 'var(--color-primary)',
  text: 'var(--color-text)',
  textSecondary: 'var(--color-text-secondary)',
  textTertiary: 'var(--color-text-tertiary)',
  cardBg: 'var(--color-bg-white)',
};

const SOURCE_MAP = { '自然进店': '自然进店', '老客户介绍': '老客户介绍', '线上客户': '线上客户', '其它': '其它' };
const SOURCE_OPTIONS = [
  { label: '自然进店', value: '自然进店' },
  { label: '老客户介绍', value: '老客户介绍' },
  { label: '线上客户', value: '线上客户' },
  { label: '其它', value: '其它' },
];
const YES_NO_OPTIONS = [
  { label: '是', value: true },
  { label: '否', value: false },
];

export default function DailyCustomers({ stats }) {
  const { user } = useAuth();
  const role = user?.role || 'sales';
  const screens = useBreakpoint();
  const isMobile = !screens.md;

  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(false);
  // 默认“全部导购”（仅管理员/店长使用，销售角色强制只看自己）
  const [salesId, setSalesId] = useState('');
  // 默认 null = 全部日期（不筛选），DatePicker 可清空
  const [date, setDate] = useState(null);
  const [dealFilter, setDealFilter] = useState('all');
  const [salesOptions, setSalesOptions] = useState(
    (role !== 'sales' && stats)
      ? [{ label: '全部导购', value: '' }, ...stats.per_salesperson.map(p => ({ label: p.display_name, value: p.user_id }))]
      : []
  );

  // 编辑弹窗
  const [editOpen, setEditOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [editForm, setEditForm] = useState({});

  // stats 由父组件 DailyReport 统一请求一次后传入，导购选项直接派生，避免重复请求 /daily/stats
  useEffect(() => {
    if (role !== 'sales' && stats) {
      setSalesOptions([{ label: '全部导购', value: '' }, ...stats.per_salesperson.map(p => ({ label: p.display_name, value: p.user_id }))]);
    }
  }, [stats, role]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      // 日期不传 = 全部历史；选了具体日期才按日期筛选
      if (date) params.report_date = date.format('YYYY-MM-DD');
      // 仅管理员选了具体导购才过滤；选“全部导购”(空)或未选则不按销售过滤
      if (role !== 'sales' && salesId) params.salesperson_id = salesId;
      if (dealFilter !== 'all') params.is_deal = dealFilter;
      const res = await api.get('/daily/customers', { params });
      if (res.data.success) setList(res.data.customers || []);
    } catch (e) { message.error('加载失败'); }
    finally { setLoading(false); }
  }, [date, salesId, dealFilter, role]);
  useEffect(() => { load(); }, [load]);

  const handleDelete = useCallback(async (id) => {
    try {
      await api.delete(`/daily/customers/${id}`);
      message.success('已删除');
      load();
    } catch (e) { message.error('删除失败'); }
  }, [load]);

  // 导出 CSV：用 axios 拿 Blob（自动带 token），本地触发下载
  const handleExport = useCallback(async () => {
    try {
      const params = {};
      if (date) params.report_date = date.format('YYYY-MM-DD');
      if (role !== 'sales' && salesId) params.salesperson_id = salesId;
      if (dealFilter !== 'all') params.is_deal = dealFilter;
      const res = await api.get('/daily/customers/export', { params, responseType: 'blob' });
      const url = window.URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `客资明细_${dayjs().format('YYYYMMDD')}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      message.success('客资明细已导出');
    } catch (e) { message.error('导出失败'); }
  }, [date, salesId, dealFilter, role]);

  // 打开编辑弹窗：用当前行数据填充表单
  const openEdit = (c) => {
    setEditTarget(c);
    setEditForm({
      id: c.id,
      customer_desc: c.customer_desc || '',
      customer_name: c.customer_name || '',
      source: c.source || undefined,
      phone: c.phone || '',
      intention_product: c.intention_product || '',
      is_wechat: c.is_wechat === 1,
      is_douyin_comment: c.is_douyin_comment === 1,
      is_deal: c.is_deal === 1,
      deal_amount: c.is_deal === 1 ? (c.deal_amount || undefined) : undefined,
      not_deal_reason: c.not_deal_reason || '',
    });
    setEditOpen(true);
  };

  const handleEditSave = async () => {
    try {
      const body = { ...editForm };
      const res = await api.put(`/daily/customers/${editForm.id}`, body);
      if (res.data.success) {
        message.success('已保存修改');
        setEditOpen(false);
        load();
      }
    } catch (e) { message.error(e.response?.data?.error || '保存失败'); }
  };

  const columns = useMemo(() => [
    { title: '#', width: 48, align: 'center', render: (_, __, idx) => <b style={{ color: STYLE.primary }}>{idx + 1}</b> },
    { title: '客户情况', dataIndex: 'customer_desc', ellipsis: true, width: 184,
      render: v => v || <span style={{ color: STYLE.textTertiary }}>—</span> },
    { title: '客户名称', dataIndex: 'customer_name', width: 88, ellipsis: true,
      render: v => v || <span style={{ color: STYLE.textTertiary }}>—</span> },
    { title: '来源', dataIndex: 'source', width: 104,
      render: v => v ? <Tag color="blue">{SOURCE_MAP[v] || v}</Tag> : <span style={{ color: STYLE.textTertiary }}>—</span> },
    { title: '电话', dataIndex: 'phone', width: 120, ellipsis: true,
      render: v => v || <span style={{ color: STYLE.textTertiary }}>—</span> },
    { title: '意向产品', dataIndex: 'intention_product', ellipsis: true, width: 112,
      render: v => v || <span style={{ color: STYLE.textTertiary }}>—</span> },
    { title: '成交状态', dataIndex: 'is_deal', width: 88, align: 'center',
      render: (v, r) => v === 1
        ? <Tag color="green">成交 <span className="money">{formatMoneyInt(r.deal_amount)}</span></Tag>
        : <Tag color="orange">{r.not_deal_reason || '未成交'}</Tag>,
    },
    { title: '微信/抖音', width: 96, align: 'center',
      render: (_, r) => (
        <Space size={4}>
          {r.is_wechat === 1 ? <Tag color="green" style={{ margin: 0 }}>微</Tag> : null}
          {r.is_douyin_comment === 1 ? <Tag color="purple" style={{ margin: 0 }}>抖</Tag> : null}
          {(r.is_wechat !== 1 && r.is_douyin_comment !== 1) ? <span style={{ color: STYLE.textTertiary }}>-</span> : null}
        </Space>
      ),
    },
    {
      title: '操作', width: 104, align: 'center',
      render: (_, r) => (
        <Space size={0}>
          <Button type="text" icon={<EditOutlined />} onClick={() => openEdit(r)} />
          <Popconfirm title="删除这条客资？" onConfirm={() => handleDelete(r.id)}>
            <Button danger type="text" icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ], [handleDelete]);

  // 移动端卡片列表（每条客资一张卡，与日报风格一致）
  const renderMobileList = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {list.length === 0 ? (
        <EmptyState title="暂无客资记录" description="今日还没有客资记录，点击「保存这条客资」录入" />
      ) : list.map((c, idx) => (
        <div key={c.id} style={{
          background: STYLE.cardBg, border: `1px solid ${c.is_deal === 1 ? 'var(--color-success)' : 'var(--color-border-light)'}`,
          borderRadius: 8, padding: '10px 14px', boxShadow: 'var(--shadow-sm)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <Tag color="blue" style={{ fontWeight: 700, fontSize: 12, margin: 0 }}>#{idx + 1}</Tag>
            <span style={{ fontWeight: 600, color: STYLE.text, flex: 1 }}>{c.customer_desc || '（无描述）'}</span>
            <Button type="text" icon={<EditOutlined />} onClick={() => openEdit(c)} />
            <Popconfirm title="删除这条客资？" onConfirm={() => handleDelete(c.id)}>
              <Button danger type="text" icon={<DeleteOutlined />} />
            </Popconfirm>
          </div>
          <div style={{ fontSize: 'var(--font-size-sm)', color: STYLE.textSecondary, lineHeight: 1.8 }}>
            {c.customer_name && <span><UserOutlined /> {c.customer_name}　</span>}
            {c.source && <Tag color="blue" style={{ margin: '0 4px' }}>{SOURCE_MAP[c.source] || c.source}</Tag>}
            {c.phone && <span><PhoneOutlined /> {c.phone}　</span>}
            {c.intention_product && <span>意向：<b>{c.intention_product}</b></span>}
            <div style={{ marginTop: 4 }}>
              {c.is_deal === 1
                ? <Tag color="green">✅ 成交 <span className="money">{formatMoneyInt(c.deal_amount)}</span></Tag>
                : <Tag color="orange">❌ 未成交{c.not_deal_reason ? '：' + c.not_deal_reason : ''}</Tag>}
              {c.is_wechat === 1 && <Tag color="green" style={{ marginLeft: 4 }}>微信</Tag>}
              {c.is_douyin_comment === 1 && <Tag color="purple" style={{ marginLeft: 4 }}>抖音</Tag>}
            </div>
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <Card size="small" style={{ borderRadius: 'var(--radius-md)', background: STYLE.cardBg }} title="客户明细"
      extra={<Button icon={<DownloadOutlined />} onClick={handleExport}>导出</Button>}>
      <Space wrap direction={isMobile ? 'vertical' : 'horizontal'} style={{ marginBottom: 12, ...(isMobile ? { width: '100%' } : {}) }}>
        {role !== 'sales' && (
          <Select value={salesId} onChange={setSalesId} style={{ width: isMobile ? '100%' : 140 }} placeholder="选择导购"
            options={salesOptions} />
        )}
        <DatePicker value={date} onChange={d => setDate(d)} allowClear placeholder="全部日期" style={{ width: isMobile ? '100%' : 160 }} />
        <Select value={dealFilter} onChange={setDealFilter} style={{ width: isMobile ? '100%' : undefined }} className={isMobile ? undefined : 'w-sm'}
          options={[{ label: '全部', value: 'all' }, { label: '已成交', value: '1' }, { label: '未成交', value: '0' }]} />
      </Space>
      {isMobile
        ? <Spin spinning={loading}>{renderMobileList()}</Spin>
        : <Table rowKey="id" columns={columns} dataSource={list} loading={loading}
            pagination={false} size="small" scroll={{ x: TABLE_SCROLL_X.compact }} />
      }

      {/* 编辑客资弹窗 */}
      <Modal
        open={editOpen}
        title="编辑客资"
        onCancel={() => setEditOpen(false)}
        onOk={handleEditSave}
        okText="保存"
        cancelText="取消"
        destroyOnClose
        className="modal-md"
      >
        <div className="edit-card">
          <div className="edit-card-title"><UserOutlined /> 客资信息</div>
          <div className="edit-card-body">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 8, alignItems: 'end' }}>
              <div style={{ gridColumn: '1 / -1' }}>
                <div style={{ fontSize: 'var(--font-size-sm)', color: STYLE.textSecondary, marginBottom: 6 }}>客户情况</div>
                <Input.TextArea rows={2} value={editForm.customer_desc || ''} onChange={e => setEditForm(f => ({ ...f, customer_desc: e.target.value }))} style={{ borderRadius: 8 }} />
              </div>
              <div>
                <div style={{ fontSize: 'var(--font-size-sm)', color: STYLE.textSecondary, marginBottom: 6 }}>客户名称</div>
                <Input value={editForm.customer_name || ''} onChange={e => setEditForm(f => ({ ...f, customer_name: e.target.value }))} style={{ borderRadius: 8 }} />
              </div>
              <div>
                <div style={{ fontSize: 'var(--font-size-sm)', color: STYLE.textSecondary, marginBottom: 6 }}>客户来源</div>
                <Select value={editForm.source} onChange={v => setEditForm(f => ({ ...f, source: v }))} options={SOURCE_OPTIONS} placeholder="选择来源" style={{ width: '100%', borderRadius: 8 }} allowClear />
              </div>
              <div>
                <div style={{ fontSize: 'var(--font-size-sm)', color: STYLE.textSecondary, marginBottom: 6 }}>客户电话</div>
                <Input value={editForm.phone || ''} onChange={e => setEditForm(f => ({ ...f, phone: e.target.value }))} style={{ borderRadius: 8 }} />
              </div>
              <div>
                <div style={{ fontSize: 'var(--font-size-sm)', color: STYLE.textSecondary, marginBottom: 6 }}>意向产品</div>
                <Input value={editForm.intention_product || ''} onChange={e => setEditForm(f => ({ ...f, intention_product: e.target.value }))} style={{ borderRadius: 8 }} />
              </div>
              <div>
                <div style={{ fontSize: 'var(--font-size-sm)', color: STYLE.textSecondary, marginBottom: 6 }}>是否成交</div>
                <Select value={editForm.is_deal} onChange={v => setEditForm(f => ({ ...f, is_deal: v }))} options={YES_NO_OPTIONS} placeholder="请选择" style={{ width: '100%', borderRadius: 8 }} />
              </div>
              {editForm.is_deal === true && (
                <div>
                  <div style={{ fontSize: 'var(--font-size-sm)', color: STYLE.textSecondary, marginBottom: 6 }}>订单金额（元）</div>
                  <InputNumber min={0} value={editForm.deal_amount} onChange={v => setEditForm(f => ({ ...f, deal_amount: v }))} style={{ width: '100%', borderRadius: 8 }} prefix="¥" placeholder="成交金额" />
                </div>
              )}
              {editForm.is_deal === false && (
                <div style={{ gridColumn: '1 / -1' }}>
                  <div style={{ fontSize: 'var(--font-size-sm)', color: STYLE.textSecondary, marginBottom: 6 }}>未成交原因</div>
                  <Input.TextArea rows={2} value={editForm.not_deal_reason || ''} onChange={e => setEditForm(f => ({ ...f, not_deal_reason: e.target.value }))} style={{ borderRadius: 8 }} />
                </div>
              )}
              <div>
                <div style={{ fontSize: 'var(--font-size-sm)', color: STYLE.textSecondary, marginBottom: 6 }}>是否留微信</div>
                <Select value={editForm.is_wechat} onChange={v => setEditForm(f => ({ ...f, is_wechat: v }))} options={YES_NO_OPTIONS} placeholder="请选择" style={{ width: '100%', borderRadius: 8 }} />
              </div>
              <div>
                <div style={{ fontSize: 'var(--font-size-sm)', color: STYLE.textSecondary, marginBottom: 6 }}>是否抖音评论</div>
                <Select value={editForm.is_douyin_comment} onChange={v => setEditForm(f => ({ ...f, is_douyin_comment: v }))} options={YES_NO_OPTIONS} placeholder="请选择" style={{ width: '100%', borderRadius: 8 }} />
              </div>
            </div>
          </div>
        </div>
      </Modal>
    </Card>
  );
}
