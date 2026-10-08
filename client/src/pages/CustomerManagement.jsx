import { TABLE_SCROLL_X } from '../components/tableConstants';
import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Card, Table, Tag, Button, Select, Input, Space, message, Popconfirm, Grid, Spin,
  Modal, Form, InputNumber, DatePicker, Drawer, Descriptions, Timeline, Badge, Divider, Tooltip, Tabs,
  Upload, Checkbox, Alert, Progress, Row, Col
} from 'antd';
import {
  PlusOutlined, SearchOutlined, EditOutlined, DeleteOutlined, EyeOutlined,
  PhoneOutlined, UserOutlined, CalendarOutlined, BellOutlined, WechatOutlined,
  UploadOutlined, InboxOutlined, BarChartOutlined, SwapOutlined, SendOutlined
} from '@ant-design/icons';
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip as RTooltip,
  ResponsiveContainer, LineChart, Line, Legend
} from 'recharts';
import api from '../api';
import { useStore } from '../context/StoreContext';
import PageHeader from '../components/PageHeader';
import FilterBar from '../components/FilterBar';
import EmptyState from '../components/EmptyState';
import { useAuth } from '../context/AuthContext';
import { ANALYTICS_PALETTE } from './Dashboard.tokens';
import dayjs from 'dayjs';
import { formatMoneyInt } from '../utils/format';

const { useBreakpoint } = Grid;

const STATUS_OPTIONS = [
  { value: 'new', label: '新客' },
  { value: 'following', label: '跟进中' },
  { value: 'intention', label: '意向' },
  { value: 'deal', label: '已成交' },
  { value: 'lost', label: '已流失' },
];
const STATUS_LABEL = { new: '新客', following: '跟进中', intention: '意向', deal: '已成交', lost: '已流失' };
const STATUS_COLOR = { new: 'var(--status-todo)', following: 'var(--status-stock)', intention: 'var(--status-deliver)', deal: 'var(--status-done)', lost: 'var(--status-cancel)' };
const LEVEL_COLOR = { A: 'red', B: 'orange', C: 'default' };
const SOURCE_OPTIONS = [
  { value: '自然进店', label: '自然进店' },
  { value: '老客户介绍', label: '老客户介绍' },
  { value: '线上客户', label: '线上客户' },
  { value: '其它', label: '其它' },
];
const METHOD_OPTIONS = [
  { value: '电话', label: '电话' },
  { value: '微信', label: '微信' },
  { value: '到店', label: '到店' },
  { value: '抖音', label: '抖音' },
  { value: '其它', label: '其它' },
];
const RESULT_OPTIONS = [
  { value: '继续跟进', label: '继续跟进' },
  { value: '成交', label: '成交' },
  { value: '放弃', label: '放弃' },
];

const PIE_COLORS = ANALYTICS_PALETTE();
const STYLE = {
  primary: 'var(--color-primary)',
  text: 'var(--color-text)',
  textSecondary: 'var(--color-text-secondary)',
  textTertiary: 'var(--color-text-tertiary)',
  cardBg: 'var(--color-bg-white)',
};

export default function CustomerManagement() {
  const { user } = useAuth();
  const role = user?.role || 'sales';
  const isAdmin = role === 'admin' || role === 'boss';
  const screens = useBreakpoint();
  const isMobile = !screens.md;
  const { storeId, getStoreParam } = useStore();

  const [list, setList] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = 15;

  const [search, setSearch] = useState('');
  const [source, setSource] = useState('');
  const [status, setStatus] = useState('');
  const [level, setLevel] = useState('');
  const [ownerId, setOwnerId] = useState('');
  // 增强筛选
  const [budgetMin, setBudgetMin] = useState('');
  const [budgetMax, setBudgetMax] = useState('');
  const [noWechat, setNoWechat] = useState(false);
  const [noDouyin, setNoDouyin] = useState(false);
  const [birthdayMonth, setBirthdayMonth] = useState('');
  const [noFollowupDays, setNoFollowupDays] = useState('');
  const [salesOptions, setSalesOptions] = useState([]);

  const [reminders, setReminders] = useState([]);
  const [reminderOpen, setReminderOpen] = useState(false);
  const [ops, setOps] = useState(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();
  const [avatarPreview, setAvatarPreview] = useState('');
  const [dupInfo, setDupInfo] = useState(null);
  const [uploading, setUploading] = useState(false);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [current, setCurrent] = useState(null);
  const [followups, setFollowups] = useState([]);
  const [followupForm] = Form.useForm();
  const [addingFollowup, setAddingFollowup] = useState(false);
  const [linkedOrders, setLinkedOrders] = useState([]);

  // 数据看板
  const [statsOpen, setStatsOpen] = useState(false);
  const [stats, setStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(false);

  // 批量分配
  const [rowKeys, setRowKeys] = useState([]);
  const [reassignOpen, setReassignOpen] = useState(false);
  const [reassignTarget, setReassignTarget] = useState(undefined);

  // 导入
  const [importOpen, setImportOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);

  const today = dayjs().format('YYYY-MM-DD');

  // 加载导购列表（经理/管理员用于归属筛选）
  useEffect(() => {
    if (role === 'sales') return;
    api.get('/users/salespersons').then(r => {
      const users = Array.isArray(r.data) ? r.data : (r.data?.users || []);
      setSalesOptions(users.map(u => ({ label: u.display_name || u.username, value: u.id })));
    }).catch(() => message.error('加载导购列表失败'));
  }, [role]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = {
        page, pageSize, search, source, status, level,
        budget_min: budgetMin, budget_max: budgetMax,
        no_wechat: noWechat ? '1' : '', no_douyin: noDouyin ? '1' : '',
        birthday_month: birthdayMonth, no_followup_days: noFollowupDays,
      };
      if (role !== 'sales' && ownerId) params.owner_id = ownerId;
      const sid = getStoreParam(); if (sid) params.store_id = sid;
      const res = await api.get('/customers', { params });
      if (res.data.success) {
        setList(res.data.customers || []);
        setTotal(res.data.total || 0);
      }
    } catch (e) { message.error('加载失败'); }
    finally { setLoading(false); }
  }, [page, pageSize, search, source, status, level, budgetMin, budgetMax, noWechat, noDouyin, birthdayMonth, noFollowupDays, ownerId, role, storeId]);

  const loadReminders = useCallback(async () => {
    try {
      const res = await api.get('/customers/operations/summary');
      if (res.data.success) setOps(res.data);
    } catch (e) { /* ignore */ }
  }, []);

  const loadStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const res = await api.get('/customers/stats');
      if (res.data.success) setStats(res.data);
    } catch (e) { /* ignore */ }
    finally { setStatsLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadReminders(); }, [loadReminders]);

  // 重置分页当筛选变化时
  const resetPage = () => setPage(1);

  // ===== 查重（建档/编辑时实时提示） =====
  const checkDup = useCallback(async (phone) => {
    if (!phone) { setDupInfo(null); return; }
    try {
      const r = await api.get('/customers/check-duplicate', { params: { phone, exclude_id: editing ? editing.id : '' } });
      if (r.data.success && r.data.exists) setDupInfo(r.data.customer);
      else setDupInfo(null);
    } catch (e) { setDupInfo(null); }
  }, [editing]);

  // ===== 新建 / 编辑客户 =====
  const openCreate = () => {
    setEditing(null);
    setDupInfo(null);
    setAvatarPreview('');
    form.resetFields();
    form.setFieldsValue({
      gender: '', source: '', level: 'C', status: 'new',
      is_wechat: false, is_douyin: false, budget: 0, avatar: '',
      owner_id: role === 'sales' ? user?.id : undefined,
    });
    setModalOpen(true);
  };
  const openEdit = (c) => {
    setEditing(c);
    setDupInfo(null);
    setAvatarPreview(c.avatar || '');
    form.setFieldsValue({
      ...c,
      is_wechat: !!c.is_wechat, is_douyin: !!c.is_douyin,
      budget: c.budget || 0,
      birthday: c.birthday ? dayjs(c.birthday) : null,
      owner_id: c.owner_id || undefined,
    });
    setModalOpen(true);
  };

  const beforeAvatarUpload = (file) => {
    const fd = new FormData();
    fd.append('image', file);
    setUploading(true);
    api.post('/upload/image', fd).then(r => {
      if (r.data.url) {
        form.setFieldsValue({ avatar: r.data.url });
        setAvatarPreview(r.data.url);
        message.success('头像已上传');
      }
    }).catch(() => message.error('上传失败')).finally(() => setUploading(false));
    return false;
  };

  const handleSave = async () => {
    try {
      const v = await form.validateFields();
      setSaving(true);
      const body = {
        ...v,
        is_wechat: v.is_wechat ? 1 : 0,
        is_douyin: v.is_douyin ? 1 : 0,
        budget: v.budget || 0,
        birthday: v.birthday ? v.birthday.format('YYYY-MM-DD') : '',
        avatar: v.avatar || '',
      };
      if (role === 'sales') body.owner_id = user?.id;
      let res;
      if (editing) res = await api.put(`/customers/${editing.id}`, body);
      else res = await api.post('/customers', body);
      if (res.data.success) {
        message.success(editing ? '已更新' : '客户已建档');
        setModalOpen(false);
        load(); loadReminders();
      }
    } catch (e) {
      if (e.response?.data?.error) message.error(e.response.data.error);
      else if (!e.errorFields) message.error('保存失败');
    } finally { setSaving(false); }
  };

  const handleDelete = async (c) => {
    try {
      await api.delete(`/customers/${c.id}`);
      message.success('已删除');
      load(); loadReminders();
    } catch (e) { message.error('删除失败'); }
  };

  // ===== 详情抽屉 + 跟进时间线 + 关联订单 =====
  const openDetail = async (c) => {
    setDrawerOpen(true);
    setCurrent(c);
    setFollowups([]);
    setLinkedOrders([]);
    try {
      const res = await api.get(`/customers/${c.id}`);
      if (res.data.success) {
        setCurrent(res.data.customer);
        setFollowups(res.data.followups || []);
      }
      const ord = await api.get(`/customers/${c.id}/orders`);
      if (ord.data.success) setLinkedOrders(ord.data.orders || []);
    } catch (e) { message.error('加载详情失败'); }
  };

  const handleAddFollowup = async () => {
    try {
      const v = await followupForm.validateFields();
      setAddingFollowup(true);
      const body = {
        followup_date: v.followup_date ? v.followup_date.format('YYYY-MM-DD') : today,
        method: v.method || '',
        content: v.content || '',
        next_followup_date: v.next_followup_date ? v.next_followup_date.format('YYYY-MM-DD') : '',
        result: v.result || '',
      };
      const res = await api.post(`/customers/${current.id}/followups`, body);
      if (res.data.success) {
        message.success('跟进已记录');
        followupForm.resetFields();
        followupForm.setFieldsValue({ followup_date: dayjs(), method: '电话', result: '继续跟进' });
        const d = await api.get(`/customers/${current.id}`);
        if (d.data.success) { setCurrent(d.data.customer); setFollowups(d.data.followups || []); }
        load(); loadReminders();
      }
    } catch (e) {
      if (e.response?.data?.error) message.error(e.response.data.error);
      else if (!e.errorFields) message.error('保存失败');
    } finally { setAddingFollowup(false); }
  };

  const handleDeleteFollowup = async (fid) => {
    try {
      await api.delete(`/customers/${current.id}/followups/${fid}`);
      message.success('已删除');
      const d = await api.get(`/customers/${current.id}`);
      if (d.data.success) { setCurrent(d.data.customer); setFollowups(d.data.followups || []); }
      load(); loadReminders();
    } catch (e) { message.error('删除失败'); }
  };

  // 快捷状态推进
  const handleAdvance = async (targetStatus) => {
    try {
      const res = await api.post(`/customers/${current.id}/advance`, { status: targetStatus });
      if (res.data.success) {
        setCurrent(res.data.customer);
        message.success('状态已更新');
        load(); loadReminders();
      }
    } catch (e) { message.error(e.response?.data?.error || '操作失败'); }
  };

  // 流失挽回（列表卡片按钮）
  const handleReactivate = async (c) => {
    try {
      const res = await api.post(`/customers/${c.id}/advance`, { status: 'following' });
      if (res.data.success) {
        message.success('已重新激活');
        loadReminders();
        if (current && current.id === c.id) setCurrent(res.data.customer);
      }
    } catch (e) { message.error('操作失败'); }
  };

  // ===== 批量分配 / 移交 =====
  const handleReassign = async () => {
    if (!reassignTarget) { message.warning('请选择目标导购'); return; }
    try {
      const res = await api.post('/customers/reassign', { ids: rowKeys, owner_id: reassignTarget });
      if (res.data.success) {
        message.success(res.data.message);
        setReassignOpen(false);
        setRowKeys([]);
        load(); loadReminders();
      }
    } catch (e) { message.error(e.response?.data?.error || '分配失败'); }
  };

  // ===== 批量导入 CSV =====
  const beforeImportUpload = (file) => {
    setImporting(true);
    setImportResult(null);
    const fd = new FormData();
    fd.append('file', file);
    api.post('/customers/import', fd).then(r => {
      if (r.data.success) {
        setImportResult(r.data);
        message.success(r.data.message);
        load(); loadReminders();
      }
    }).catch(e => message.error(e.response?.data?.error || '导入失败')).finally(() => setImporting(false));
    return false;
  };

  // ===== 推送跟进待办到企微（管理员/店长） =====
  const handlePushReminders = async () => {
    try {
      const res = await api.post('/customers/push-reminders');
      if (res.data.success) {
        if (res.data.pushed) message.success('已推送到企业微信群');
        else message.info('未推送：' + (res.data.reason || '无需推送'));
      }
    } catch (e) { message.error(e.response?.data?.error || '推送失败'); }
  };

  const opsCounts = ops?.counts || { today: 0, overdue: 0, dormant: 0, birthday: 0, holiday: 0, deal_callback: 0, lost: 0, total: 0 };

  const columns = useMemo(() => [
    {
      title: '客户', dataIndex: 'name', width: 160, fixed: 'left',
      render: (v, r) => (
        <div>
          <div style={{ fontWeight: 600, color: STYLE.text }}>{v || <span style={{ color: STYLE.textTertiary }}>(未命名)</span>}</div>
          {r.phone && <div style={{ fontSize: 12, color: STYLE.textTertiary }}><PhoneOutlined /> {r.phone}</div>}
        </div>
      ),
    },
    {
      title: '来源', dataIndex: 'source', width: 104,
      render: v => v ? <Tag color="blue">{v}</Tag> : <span style={{ color: STYLE.textTertiary }}>—</span>,
    },
    {
      title: '等级', dataIndex: 'level', width: 72, align: 'center',
      render: v => <Tag color={LEVEL_COLOR[v] || 'default'} style={{ fontWeight: 700 }}>{v || 'C'}</Tag>,
    },
    {
      title: '状态', dataIndex: 'status', width: 88, align: 'center',
      render: v => <Tag color={STATUS_COLOR[v] || 'default'}>{STATUS_LABEL[v] || v}</Tag>,
    },
    {
      title: '意向产品', dataIndex: 'intention_product', width: 128, ellipsis: true,
      render: v => v || <span style={{ color: STYLE.textTertiary }}>—</span>,
    },
    {
      title: '预算', dataIndex: 'budget', width: 104, align: 'right',
      render: v => v ? <span className="money">{formatMoneyInt(v)}</span> : <span style={{ color: STYLE.textTertiary }}>—</span>,
    },
    ...(role !== 'sales' ? [{
      title: '归属', dataIndex: 'owner_name', width: 88,
      render: v => v || <span style={{ color: STYLE.textTertiary }}>—</span>,
    }] : []),
    {
      title: '最近跟进', dataIndex: 'last_followup_date', width: 112,
      render: v => v || <span style={{ color: STYLE.textTertiary }}>—</span>,
    },
    {
      title: '下次跟进', dataIndex: 'next_followup_date', width: 112,
      render: (v, r) => {
        if (!v) return <span style={{ color: STYLE.textTertiary }}>—</span>;
        const over = v < today && r.status !== 'deal' && r.status !== 'lost';
        return <span style={{ color: over ? 'var(--color-error)' : STYLE.text, fontWeight: over ? 600 : 400 }}>{v}</span>;
      },
    },
    {
      title: '操作', width: 112, align: 'center', fixed: 'right',
      render: (_, r) => (
        <Space size={2}>
          <Tooltip title="查看 / 跟进"><Button type="text" icon={<EyeOutlined />} onClick={() => openDetail(r)} /></Tooltip>
          <Tooltip title="编辑"><Button type="text" icon={<EditOutlined />} onClick={() => openEdit(r)} /></Tooltip>
          <Popconfirm title="删除该客户？" onConfirm={() => handleDelete(r)}>
            <Tooltip title="删除"><Button type="text" danger icon={<DeleteOutlined />} /></Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ], [role, today]);

  const rowSelection = isAdmin ? {
    selectedRowKeys: rowKeys,
    onChange: (keys) => setRowKeys(keys),
  } : undefined;

  // 运营提醒分区通用渲染
  const chips = (rows, labelFn, emptyText, extra) => {
    if (!rows || rows.length === 0) {
      return <div style={{ color: STYLE.textTertiary, padding: '8px 0' }}>{emptyText}</div>;
    }
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, paddingTop: 4 }}>
        {rows.map(r => (
          <div
            key={r.id}
            onClick={() => openDetail(r)}
            style={{
              cursor: 'pointer',
              background: 'rgba(168,140,120,0.08)',
              border: '1px solid rgba(168,140,120,0.25)',
              borderRadius: 10, padding: '8px 12px', minWidth: 152,
            }}
          >
            <div style={{ fontWeight: 600, color: STYLE.text }}>{r.name || '（未命名）'}</div>
            <div style={{ fontSize: 12, color: STYLE.textSecondary, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <span>{labelFn(r)}{role !== 'sales' && r.owner_name ? ` · ${r.owner_name}` : ''}</span>
              {extra && extra(r)}
            </div>
          </div>
        ))}
      </div>
    );
  };

  const statusPieData = stats ? stats.status_dist.map(s => ({ name: STATUS_LABEL[s.status] || s.status, value: s.c })) : [];
  const sourcePieData = stats ? stats.source_dist.map(s => ({ name: s.source || '未填', value: s.c })) : [];
  const monthData = stats ? stats.month_trend.map(m => ({ name: m.ym, value: m.c })) : [];
  const bySalesData = stats ? stats.by_sales.map(s => ({ name: s.name, 客户: s.total, 成交: s.deals })) : [];

  return (
    <div className="cm-page-wrapper">
      <PageHeader title="客户管理" />
      {/* ===== 数据看板 ===== */}
      {statsOpen && (
        <Card size="small" className="cm-stats-card" style={{ borderRadius: 16, marginBottom: 16, border: 'none' }}
          title={<Space><BarChartOutlined style={{ color: STYLE.primary }} /><span style={{ fontWeight: 600 }}>客户数据看板</span></Space>}>
          {statsLoading || !stats ? <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div> : (
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 16 }}>
              <div>
                <div style={{ fontSize: 'var(--font-size-sm)', color: STYLE.textSecondary, marginBottom: 8 }}>客户状态分布（共 {stats.total} 位）</div>
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie data={statusPieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
                      {statusPieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                    </Pie>
                    <RTooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div>
                <div style={{ fontSize: 'var(--font-size-sm)', color: STYLE.textSecondary, marginBottom: 8 }}>来源分布</div>
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie data={sourcePieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
                      {sourcePieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                    </Pie>
                    <RTooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div>
                <div style={{ fontSize: 'var(--font-size-sm)', color: STYLE.textSecondary, marginBottom: 8 }}>近 6 月新增客户趋势</div>
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={monthData}>
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                    <RTooltip />
                    <Line type="monotone" dataKey="value" name="新增" stroke="var(--color-primary)" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div>
                <div style={{ fontSize: 'var(--font-size-sm)', color: STYLE.textSecondary, marginBottom: 8 }}>各导购客户数 / 成交数</div>
                {bySalesData.length ? (
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={bySalesData}>
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                      <RTooltip />
                      <Legend />
                      <Bar dataKey="客户" fill="var(--color-primary)" />
                      <Bar dataKey="成交" fill="var(--color-primary)" />
                    </BarChart>
                  </ResponsiveContainer>
                ) : <EmptyState title="仅本人数据" description="当前导购暂无客户统计" />}
              </div>
            </div>
          )}
        </Card>
      )}

      {/* ===== 运营提醒 ===== */}
      <Card
        size="small"
        className="cm-reminder-card"
        style={{ borderRadius: 16, marginBottom: 16, border: 'none' }}
        title={
          <Space>
            <BellOutlined style={{ color: STYLE.primary }} />
            <span style={{ fontWeight: 600 }}>运营提醒</span>
            {opsCounts.total > 0 && <Badge count={opsCounts.total} style={{ backgroundColor: STYLE.primary }} />}
          </Space>
        }
      >
        {!ops ? (
          <Spin size="small" />
        ) : (
          <Tabs
            size="small"
            defaultActiveKey="today"
            items={[
              { key: 'today', label: `今日 (${ops.counts.today})`, children: chips(ops.today, () => '今天跟进', '今日无待跟进 🎉') },
              { key: 'overdue', label: <span style={{ color: 'var(--color-error)' }}>逾期 ({ops.counts.overdue})</span>, children: chips(ops.overdue, (r) => `已逾期 ${r.next_followup_date}`, '无逾期客户') },
              { key: 'dormant', label: `沉睡 (${ops.counts.dormant})`, children: chips(ops.dormant, (r) => `沉睡 ${r.days_since} 天未跟进`, '无沉睡客户') },
              { key: 'birthday', label: `生日 (${ops.counts.birthday})`, children: chips(ops.birthday, (r) => `${r.days_left} 天后生日 (${r.birthday ? r.birthday.slice(5) : ''})`, '近 7 天无生日客户') },
              { key: 'holiday', label: `节日 (${ops.counts.holiday})`, children: chips(ops.holiday, (r) => `${r.days_left} 天后 ${r.name}`, '近 7 天无节日') },
              { key: 'deal', label: `回访 (${ops.counts.deal_callback})`, children: chips(ops.deal_callback, (r) => `成交回访 · ${r.next_followup_date}`, '无待回访成交客户') },
              { key: 'lost', label: `流失挽回 (${ops.counts.lost})`, children: chips(ops.lost, (r) => `流失 ${r.days_lost || 0} 天`, '无流失客户', (r) => <Button type="link" style={{ padding: 0, fontSize: 12 }} onClick={(e) => { e.stopPropagation(); handleReactivate(r); }}>重新激活</Button>) },
            ]}
          />
        )}
      </Card>

      {/* ===== 工具栏 ===== */}
      <FilterBar style={{ marginBottom: 16 }}>
        <div className="orders-filter-inner">
          <Space wrap>
            <Input allowClear prefix={<SearchOutlined />} placeholder="搜索姓名 / 电话" value={search} onChange={e => { setSearch(e.target.value); resetPage(); }} className="filter-search" />
            <Select allowClear placeholder="来源" value={source} onChange={v => { setSource(v || ''); resetPage(); }} className="w-sm" options={SOURCE_OPTIONS} />
            <Select allowClear placeholder="状态" value={status} onChange={v => { setStatus(v || ''); resetPage(); }} className="w-sm" options={STATUS_OPTIONS} />
            <Select allowClear placeholder="等级" value={level} onChange={v => { setLevel(v || ''); resetPage(); }} className="w-sm" options={[{ value: 'A', label: 'A' }, { value: 'B', label: 'B' }, { value: 'C', label: 'C' }]} />
            {role !== 'sales' && (
              <Select allowClear placeholder="归属导购" value={ownerId} onChange={v => { setOwnerId(v || ''); resetPage(); }} className="w-sm" options={salesOptions} />
            )}
          </Space>
          <Space wrap>
            <Button icon={<BarChartOutlined />} onClick={() => { setStatsOpen(o => !o); if (!stats && !statsOpen) loadStats(); }}>{statsOpen ? '收起看板' : '数据看板'}</Button>
            <Button icon={<UploadOutlined />} onClick={() => { setImportResult(null); setImportOpen(true); }}>导入</Button>
            {isAdmin && <Button icon={<SendOutlined />} onClick={handlePushReminders}>推送企微</Button>}
            {isAdmin && rowKeys.length > 0 && (
              <Button icon={<SwapOutlined />} type="primary" onClick={() => setReassignOpen(true)}>批量分配 ({rowKeys.length})</Button>
            )}
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建客户</Button>
          </Space>
        </div>
        {/* 增强筛选 */}
        <Divider style={{ margin: '16px 0 8px' }} />
        <div className="orders-filter-inner">
          <Space wrap>
            <span style={{ fontSize: 12, color: STYLE.textSecondary }}>预算</span>
            <InputNumber placeholder="≥" min={0} value={budgetMin || undefined} onChange={v => { setBudgetMin(v ?? ''); resetPage(); }} className="w-xs" prefix="¥" />
            <InputNumber placeholder="≤" min={0} value={budgetMax || undefined} onChange={v => { setBudgetMax(v ?? ''); resetPage(); }} className="w-xs" prefix="¥" />
            <Checkbox checked={noWechat} onChange={e => { setNoWechat(e.target.checked); resetPage(); }}>仅无微信</Checkbox>
            <Checkbox checked={noDouyin} onChange={e => { setNoDouyin(e.target.checked); resetPage(); }}>仅无抖音</Checkbox>
            <Select allowClear placeholder="生日月" value={birthdayMonth || undefined} onChange={v => { setBirthdayMonth(v || ''); resetPage(); }} className="w-sm" options={Array.from({ length: 12 }, (_, i) => { const m = String(i + 1).padStart(2, '0'); return { value: m, label: `${m}月` }; })} />
            <InputNumber placeholder="超N天无跟进" min={1} value={noFollowupDays || undefined} onChange={v => { setNoFollowupDays(v ?? ''); resetPage(); }} className="w-sm" />
          </Space>
        </div>
      </FilterBar>

      {/* ===== 客户列表 ===== */}
      <Card size="small" style={{ borderRadius: 16, border: 'none' }}>
        <Table
          rowKey="id" columns={columns} dataSource={list} loading={loading} locale={{ emptyText: <EmptyState title="暂无客户" description="点击「新建客户」开始建档" /> }}
          scroll={{ x: TABLE_SCROLL_X.compact }} rowSelection={rowSelection}
          pagination={{ current: page, pageSize, total, onChange: p => setPage(p), showTotal: t => `共 ${t} 位客户` }}
          size="middle"
        />
      </Card>

      {/* ===== 新建 / 编辑客户弹窗 ===== */}
      <Modal
        title={editing ? '编辑客户' : '新建客户'}
        open={modalOpen} onCancel={() => setModalOpen(false)} onOk={handleSave}
        confirmLoading={saving} className="modal-md"
        okText="保存" cancelText="取消"
        destroyOnClose
      >
        <Form form={form} layout="vertical" requiredMark="optional">
          {dupInfo && (
            <Alert type="warning" showIcon style={{ marginBottom: 16 }}
              message={`系统中已存在该电话的客户：「${dupInfo.name}」(${dupInfo.phone})，请确认是否重复建档`}
              action={<Button type="link" onClick={() => { setModalOpen(false); openDetail(dupInfo); }}>查看</Button>} />
          )}
          <Row gutter={[16, 16]}>
            <Col xs={24} xl={16}>
              {/* ── 基本资料 ── */}
              <div className="edit-card">
                <div className="edit-card-title"><UserOutlined /> 基本资料</div>
                <div className="edit-card-body">
                  <Row gutter={[16, 16]}>
                    <Col xs={24} md={12}>
                      <Form.Item name="name" label="客户姓名" rules={[{ required: true, message: '请输入客户姓名' }]} className="form-w-full">
                        <Input placeholder="客户姓名" style={{ borderRadius: 8 }} />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                      <Form.Item name="phone" label="电话" className="form-w-full">
                        <Input placeholder="手机号" onChange={e => checkDup(e.target.value)} style={{ borderRadius: 8 }} />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                      <Form.Item name="gender" label="性别" className="form-w-full">
                        <Select placeholder="选择" allowClear options={[{ value: '男', label: '男' }, { value: '女', label: '女' }]} style={{ borderRadius: 8 }} />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                      <Form.Item name="birthday" label="生日" className="form-w-full">
                        <DatePicker style={{ width: '100%', borderRadius: 8 }} placeholder="选择生日" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                      <Form.Item name="source" label="来源" className="form-w-full">
                        <Select placeholder="选择来源" allowClear options={SOURCE_OPTIONS} style={{ borderRadius: 8 }} />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                      <Form.Item name="intention_product" label="意向产品" className="form-w-full">
                        <Input placeholder="如：乳胶床垫、实木床" style={{ borderRadius: 8 }} />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                      <Form.Item name="budget" label="预算（元）" className="form-w-full">
                        <InputNumber min={0} prefix="¥" style={{ width: '100%', borderRadius: 8 }} placeholder="预算金额" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                      <Form.Item name="address" label="住址 / 小区" className="form-w-full">
                        <Input placeholder="住址或小区" style={{ borderRadius: 8 }} />
                      </Form.Item>
                    </Col>
                  </Row>
                </div>
              </div>

              {/* ── 等级与状态 ── */}
              <div className="edit-card">
                <div className="edit-card-title"><UserOutlined /> 等级与状态</div>
                <div className="edit-card-body">
                  <Row gutter={[16, 16]}>
                    <Col xs={24} md={12}>
                      <Form.Item name="level" label="客户等级" className="form-w-full">
                        <Select options={[{ value: 'A', label: 'A（高价值）' }, { value: 'B', label: 'B（中等）' }, { value: 'C', label: 'C（一般）' }]} style={{ borderRadius: 8 }} />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                      <Form.Item name="status" label="客户状态" className="form-w-full">
                        <Select options={STATUS_OPTIONS} style={{ borderRadius: 8 }} />
                      </Form.Item>
                    </Col>
                    {role !== 'sales' && (
                      <Col xs={24} md={12}>
                        <Form.Item name="owner_id" label="归属导购" className="form-w-full">
                          <Select placeholder="选择导购" allowClear options={salesOptions} style={{ borderRadius: 8 }} />
                        </Form.Item>
                      </Col>
                    )}
                  </Row>
                </div>
              </div>
            </Col>

            <Col xs={24} xl={8}>
              {/* ── 跟进标签与素材 ── */}
              <div className="edit-card">
                <div className="edit-card-title"><UserOutlined /> 跟进标签</div>
                <div className="edit-card-body">
                  <Form.Item name="is_wechat" label="留微信" valuePropName="checked" className="form-w-full">
                    <Select options={[{ value: true, label: '是' }, { value: false, label: '否' }]} style={{ width: '100%', borderRadius: 8 }} />
                  </Form.Item>
                  <Form.Item name="is_douyin" label="抖音" valuePropName="checked" className="form-w-full">
                    <Select options={[{ value: true, label: '是' }, { value: false, label: '否' }]} style={{ width: '100%', borderRadius: 8 }} />
                  </Form.Item>
                  <Form.Item label="头像" className="form-w-full">
                    <Upload listType="picture-card" showUploadList={false} beforeUpload={beforeAvatarUpload} accept="image/*">
                      <div style={{ width: 64, height: 64, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                        {avatarPreview ? <img src={avatarPreview} alt="头像" style={{ width: 64, height: 60, objectFit: 'cover', borderRadius: 8 }} /> : <InboxOutlined style={{ fontSize: 20 }} />}
                        <div style={{ fontSize: 11, color: STYLE.textTertiary }}>{uploading ? '上传中' : '头像'}</div>
                      </div>
                    </Upload>
                  </Form.Item>
                  <Form.Item name="avatar" noStyle><Input type="hidden" /></Form.Item>
                </div>
              </div>

              {/* ── 备注 ── */}
              <div className="edit-card">
                <div className="edit-card-title"><UserOutlined /> 备注</div>
                <div className="edit-card-body">
                  <Form.Item name="note" className="form-w-full">
                    <Input.TextArea rows={3} placeholder="客户特征、偏好、家庭情况等" style={{ borderRadius: 8 }} />
                  </Form.Item>
                </div>
              </div>
            </Col>
          </Row>
        </Form>
      </Modal>

      {/* ===== 客户详情抽屉 ===== */}
      <Drawer
        title={current ? `客户详情 · ${current.name || '（未命名）'}` : '客户详情'}
        open={drawerOpen} onClose={() => setDrawerOpen(false)}
        width={isMobile ? '100%' : 560}
        extra={current && <Button icon={<EditOutlined />} onClick={() => { setDrawerOpen(false); openEdit(current); }}>编辑</Button>}
      >
        {current && (
          <Tabs defaultActiveKey="info" items={[
            {
              key: 'info', label: '详情',
              children: (
                <>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12 }}>
                    {current.avatar ? <img src={current.avatar} alt="头像" style={{ width: 56, height: 56, borderRadius: 10, objectFit: 'cover' }} /> : <UserOutlined style={{ fontSize: 40, color: STYLE.primary }} />}
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 16 }}>{current.name || '（未命名）'}</div>
                      <div style={{ fontSize: 12, color: STYLE.textSecondary }}>{current.phone || '无电话'}</div>
                    </div>
                  </div>
                  {/* 快捷状态推进 */}
                  <Space wrap style={{ marginBottom: 12 }}>
                    {current.status !== 'intention' && <Button onClick={() => handleAdvance('intention')}>标记意向</Button>}
                    {current.status !== 'deal' && <Button type="primary" onClick={() => handleAdvance('deal')}>标记成交</Button>}
                    {current.status !== 'lost' && <Button danger onClick={() => handleAdvance('lost')}>标记流失</Button>}
                    {current.status === 'lost' && <Button onClick={() => handleAdvance('following')}>重新激活</Button>}
                  </Space>
                  <Descriptions column={isMobile ? 1 : 2} size="small" bordered>
                    <Descriptions.Item label="电话">{current.phone || '—'}</Descriptions.Item>
                    <Descriptions.Item label="性别">{current.gender || '—'}</Descriptions.Item>
                    <Descriptions.Item label="来源">{current.source || '—'}</Descriptions.Item>
                    <Descriptions.Item label="等级"><Tag color={LEVEL_COLOR[current.level] || 'default'}>{current.level || 'C'}</Tag></Descriptions.Item>
                    <Descriptions.Item label="状态"><Tag color={STATUS_COLOR[current.status] || 'default'}>{STATUS_LABEL[current.status] || current.status}</Tag></Descriptions.Item>
                    <Descriptions.Item label="生日">{current.birthday || '—'}</Descriptions.Item>
                    <Descriptions.Item label="意向产品" span={2}>{current.intention_product || '—'}</Descriptions.Item>
                    <Descriptions.Item label="预算">{current.budget ? <span className="money">{formatMoneyInt(current.budget)}</span> : '—'}</Descriptions.Item>
                    <Descriptions.Item label="住址">{current.address || '—'}</Descriptions.Item>
                    <Descriptions.Item label="最近跟进">{current.last_followup_date || '—'}</Descriptions.Item>
                    <Descriptions.Item label="下次跟进">
                      {current.next_followup_date
                        ? <span style={{ color: (current.next_followup_date < today && current.status !== 'deal' && current.status !== 'lost') ? 'var(--color-error)' : STYLE.text, fontWeight: 600 }}>{current.next_followup_date}</span>
                        : '—'}
                    </Descriptions.Item>
                    {role !== 'sales' && <Descriptions.Item label="归属导购">{current.owner_name || '—'}</Descriptions.Item>}
                    <Descriptions.Item label="微信/抖音" span={2}>
                      <Space>
                        {current.is_wechat ? <Tag color="green">微信</Tag> : null}
                        {current.is_douyin ? <Tag color="purple">抖音</Tag> : null}
                        {!current.is_wechat && !current.is_douyin && <span style={{ color: STYLE.textTertiary }}>—</span>}
                      </Space>
                    </Descriptions.Item>
                    <Descriptions.Item label="备注" span={2}>{current.note || '—'}</Descriptions.Item>
                  </Descriptions>
                </>
              ),
            },
            {
              key: 'orders', label: `关联订单 (${linkedOrders.length})`,
              children: linkedOrders.length === 0 ? <EmptyState title="暂无关联订单" description="该客户还没有关联订单" />
                : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {linkedOrders.map(o => (
                      <div key={o.id} style={{ border: '1px solid rgba(168,140,120,0.2)', borderRadius: 10, padding: 10 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ fontWeight: 600 }}>{o.order_no}</span>
                          <Tag color={o.status === 'completed' ? 'var(--status-done)' : 'var(--status-deliver)'}>{o.status_label}</Tag>
                        </div>
                        <div style={{ fontSize: 12, color: STYLE.textSecondary, marginTop: 4 }}>
                          {o.created_at ? o.created_at.slice(0, 10) : ''} ｜ 实收 <span className="money">{formatMoneyInt(o.actual_amount)}</span> ｜ {o.salesperson_name || '—'}
                        </div>
                      </div>
                    ))}
                  </div>
                ),
            },
            {
              key: 'follow', label: '跟进记录',
              children: (
                <>
                  <Card size="small" style={{ borderRadius: 12, marginBottom: 16, background: 'var(--color-bg)' }}>
                    <Form form={followupForm} layout="vertical" initialValues={{ followup_date: dayjs(), method: '电话', result: '继续跟进' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 10 }}>
                        <Form.Item name="followup_date" label="跟进日期"><DatePicker style={{ width: '100%' }} /></Form.Item>
                        <Form.Item name="method" label="跟进方式"><Select options={METHOD_OPTIONS} /></Form.Item>
                        <Form.Item name="next_followup_date" label="下次跟进日期"><DatePicker style={{ width: '100%' }} /></Form.Item>
                        <Form.Item name="result" label="跟进结果"><Select options={RESULT_OPTIONS} /></Form.Item>
                      </div>
                      <Form.Item name="content" label="跟进内容"><Input.TextArea rows={2} placeholder="聊了什么、客户反馈、下一步动作…" /></Form.Item>
                      <Button type="primary" block icon={<CalendarOutlined />} loading={addingFollowup} onClick={handleAddFollowup}>记录这次跟进</Button>
                    </Form>
                  </Card>
                  {followups.length === 0 ? (
                    <EmptyState title="暂无跟进记录" description="为该客户添加第一条跟进记录" />
                  ) : (
                    <Timeline items={followups.map(f => ({
                      color: f.result === '成交' ? 'var(--status-done)' : (f.result === '放弃' ? 'var(--status-cancel)' : 'var(--status-todo)'),
                      children: (
                        <div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontWeight: 600 }}>{f.followup_date} · {f.method}</span>
                            <Space size={4}>
                              <Tag color={f.result === '成交' ? 'var(--status-done)' : (f.result === '放弃' ? 'var(--status-cancel)' : 'var(--status-todo)')}>{f.result}</Tag>
                              <Popconfirm title="删除这条跟进？" onConfirm={() => handleDeleteFollowup(f.id)}>
                                <Button type="text" danger icon={<DeleteOutlined />} />
                              </Popconfirm>
                            </Space>
                          </div>
                          {f.content && <div style={{ fontSize: 'var(--font-size-sm)', color: STYLE.textSecondary, marginTop: 2, whiteSpace: 'pre-wrap' }}>{f.content}</div>}
                          {f.next_followup_date && <div style={{ fontSize: 12, color: STYLE.textTertiary, marginTop: 2 }}>下次跟进：{f.next_followup_date}</div>}
                        </div>
                      ),
                    }))} />
                  )}
                </>
              ),
            },
          ]} />
        )}
      </Drawer>

      {/* ===== 批量分配弹窗 ===== */}
      <Modal title="批量分配 / 移交" open={reassignOpen} onCancel={() => setReassignOpen(false)} onOk={handleReassign} confirmLoading={false} okText="确认分配" cancelText="取消" className="modal-md">
        <p style={{ color: STYLE.textSecondary }}>将选中的 {rowKeys.length} 位客户分配给：</p>
        <Select style={{ width: '100%' }} placeholder="选择目标导购" value={reassignTarget} onChange={v => setReassignTarget(v)} options={salesOptions} />
      </Modal>

      {/* ===== 导入弹窗 ===== */}
      <Modal title="批量导入客户（CSV）" open={importOpen} onCancel={() => setImportOpen(false)} footer={null} className="modal-md">
        <p style={{ color: STYLE.textSecondary, fontSize: 'var(--font-size-sm)' }}>
          支持表头：姓名、电话、性别、生日、来源、意向产品、预算、地址、等级、状态、备注（中文或英文均可）。相同电话/姓名将自动跳过。
        </p>
        <Upload.Dragger accept=".csv,text/csv" beforeUpload={beforeImportUpload} showUploadList={false} disabled={importing}>
          <p className="ant-upload-drag-icon"><InboxOutlined /></p>
          <p className="ant-upload-text">{importing ? '导入中…' : '点击或拖拽 CSV 文件到此'}</p>
        </Upload.Dragger>
        {importResult && (
          <div style={{ marginTop: 16 }}>
            <Alert type="success" showIcon message={importResult.message} />
            {importResult.errors && importResult.errors.length > 0 && (
              <div style={{ marginTop: 8, fontSize: 12, color: STYLE.textSecondary }}>
                {importResult.errors.slice(0, 5).map((e, i) => <div key={i}>· {e}</div>)}
                {importResult.errors.length > 5 && <div>…等 {importResult.errors.length} 条</div>}
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
