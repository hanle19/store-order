import { useState, useEffect, useRef, Component, useCallback } from 'react';
import { formatMoneyInt } from '../utils/format';
import { Card, Tabs, DatePicker, Select, InputNumber, Input, Button, Space, Tag, message, Modal, Switch, Spin, Divider, Grid } from 'antd';
import EmptyState from '../components/EmptyState';
import { SaveOutlined, CheckCircleOutlined, PictureOutlined, PlusOutlined, FileTextOutlined, UserOutlined, PhoneOutlined } from '@ant-design/icons';
import { toPng } from 'html-to-image';
import api from '../api';
import PageHeader from '../components/PageHeader';
import { useAuth } from '../context/AuthContext';
import dayjs from 'dayjs';
import DailyCustomers from './DailyCustomers';
import DailyBoard from './DailyBoard';
import DailyFieldConfig from './DailyFieldConfig';
import DailyLongImage from './DailyLongImage';

const { useBreakpoint } = Grid;

const STYLE = {
  primary: 'var(--color-primary)',
  text: 'var(--color-text)',
  textSecondary: 'var(--color-text-secondary)',
  textTertiary: 'var(--color-text-tertiary)',
  border: 'var(--color-border)',
  borderLight: 'var(--color-border-light)',
  cardBg: 'var(--color-bg-white)',
};

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

// 长图预览缩放：PC 端原始尺寸；手机端铺满屏宽（导出 PNG 仍是 720 清晰）
const getLongImageScale = (isMobile) => {
  if (!isMobile) return 1;
  const w = typeof window !== 'undefined' ? window.innerWidth : 375;
  // 手机端用 96% 屏宽，留一点边距美观
  return Math.min(1, (w * 0.96) / 720);
};

// 防止单个 Tab 内容渲染崩溃拖垮整页；出错时显示具体信息而非白屏
class TabErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err, info) { console.error('[DailyReport Tab] render error:', err, info); }
  render() {
    if (this.state.err) {
      return (
        <div style={{
          margin: '12px 0', padding: '14px 16px', borderRadius: 8,
          background: 'var(--color-error-bg)', border: '1px solid var(--color-error)', color: 'var(--color-error)', fontSize: 'var(--font-size-sm)',
        }}>
          该模块加载出错：{String(this.state.err.message || this.state.err)}
          <div style={{ marginTop: 6, color: 'var(--color-error)' }}>请刷新页面或联系管理员。错误已记录到控制台。</div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function DailyReport() {
  const { user } = useAuth();
  const role = user?.role || 'sales';
  const screens = useBreakpoint();
  const isMobile = !screens.md;

  const [date, setDate] = useState(dayjs());
  // admin/老板进入日报默认锁定到第一个导购（否则查不到任何日报、退回重填按钮永不出现）；
  // 后续可在 Select 切到「全部导购」看汇总（该视图无单一 report，属正常）
  const [salesId, setSalesId] = useState('');
  const [report, setReport] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [fieldConfig, setFieldConfig] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  // 日报看板/客户明细所需的统计数据：由父组件统一请求一次后下传，避免子组件重复请求 /daily/stats
  const [stats, setStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [salesOptions, setSalesOptions] = useState([]);
  const [activeTab, setActiveTab] = useState('fill');
  // 历史日报（独立导购筛选，默认全部导购；避免被日报填写的当前导购锁定）
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historySalesId, setHistorySalesId] = useState('');

  // 今日工作表单
  const [form, setForm] = useState({});
  // 客资录入表单
  const [custForm, setCustForm] = useState({ is_deal: false });

  const [imgData, setImgData] = useState(null);
  const [imgOpen, setImgOpen] = useState(false);
  const [imgLoading, setImgLoading] = useState(false);
  const imgRef = useRef(null);

  const isSubmitted = report?.status === 'submitted';

  // 加载日报数据
  const loadAll = async () => {
    const controller = new AbortController();
    loadAll._ctrl = controller;
    setLoading(true);
    try {
      const params = { report_date: date.format('YYYY-MM-DD') };
      if (role !== 'sales') params.salesperson_id = salesId;
      const res = await api.get('/daily/report', { params, signal: controller.signal });
      if (res.data.success) {
        setReport(res.data.report);
        setCustomers(res.data.customers || []);
        setFieldConfig(res.data.field_config || []);
      }
    } catch (e) {
      if (e.name === 'CanceledError' || e.code === 'ERR_CANCELED') return; // 切换竞态，静默
      message.error('加载失败');
    }
    finally { setLoading(false); }
  };
  useEffect(() => {
    if (loadAll._ctrl) loadAll._ctrl.abort();
    loadAll();
  }, [date, salesId]);

  // 销售员列表（admin/boss 从 stats 取）：统一请求一次 /daily/stats，结果下传给 DailyBoard / DailyCustomers
  const loadStats = useCallback(async (y, m) => {
    setStatsLoading(true);
    try {
      const res = await api.get(`/daily/stats?year=${y}&month=${m}`);
      if (res.data.success) {
        setStats(res.data);
        if (role !== 'sales') {
          const per = res.data.per_salesperson || [];
          // 第一个选项为「全部导购」(value='')，其后为各导购；默认选中第一个导购
          setSalesOptions([{ label: '全部导购', value: '' }, ...per.map(p => ({ label: p.display_name, value: p.user_id }))]);
          if (!salesId && per.length) setSalesId(per[0].user_id);
        }
      }
    } catch (e) { /* ignore */ }
    finally { setStatsLoading(false); }
  }, [role]);

  useEffect(() => {
    if (role === 'sales') return;   // 导购无看板 / 客户明细 Tab，无需拉取 stats
    const y = dayjs().year(), m = dayjs().month() + 1;
    loadStats(y, m);
  }, [loadStats]);

  const reportFields = fieldConfig.filter(f => f.scope === 'report').sort((a, b) => a.sort_order - b.sort_order);

  // 表单回填（今日工作字段）
  useEffect(() => {
    if (!reportFields.length) return;
    const f = {};
    reportFields.forEach(fi => {
      f[fi.field_key] = report ? (report[fi.field_key] ?? (fi.field_type === 'number' ? 0 : '')) : (fi.field_type === 'number' ? 0 : '');
    });
    setForm(f);
  }, [report, fieldConfig]);

  const setField = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const setCust = (k, v) => setCustForm(p => ({ ...p, [k]: v }));

  // 保存草稿（仅保存今日工作）
  const handleSaveDraft = async () => {
    setSaving(true);
    try {
      const body = { report_date: date.format('YYYY-MM-DD'), ...form };
      if (role !== 'sales') body.salesperson_id = salesId;
      const res = await api.post('/daily/report', body);
      if (res.data.success) { setReport(res.data.report); message.success('已保存草稿'); }
    } catch (e) { message.error(e.response?.data?.error || '保存失败'); }
    finally { setSaving(false); }
  };

  // 打开长图预览
  const openLongImage = async () => {
    setImgLoading(true); setImgOpen(true);
    try {
      const params = { report_date: date.format('YYYY-MM-DD') };
      if (role !== 'sales') params.salesperson_id = salesId;
      const res = await api.get('/daily/long-image-data', { params });
      if (res.data.success) setImgData(res.data);
    } catch (e) { message.error('长图数据加载失败'); }
    finally { setImgLoading(false); }
  };

  // 闭店提交（先保存今日工作，再提交，自动聚合汇总）
  const handleSubmit = async () => {
    try {
      const body = { report_date: date.format('YYYY-MM-DD'), ...form };
      if (role !== 'sales') body.salesperson_id = salesId;
      let rep = report;
      if (!rep || rep.status !== 'submitted') {
        const res = await api.post('/daily/report', body);
        rep = res.data.report;
        setReport(rep);
      }
      if (rep.status === 'submitted') { message.info('当日日报已提交'); openLongImage(); return; }
      const sub = await api.post(`/daily/report/${rep.id}/submit`);
      if (sub.data.success) {
        setReport(sub.data.report);
        message.success('闭店提交成功');
        // 管理员/店长闭店后，企业微信推送结果提示（导购无此提示）
        const wx = sub.data.wecom;
        if (role !== 'sales' && wx) {
          if (wx.pushed) message.success('已推送至企业微信');
          else if (wx.skipped) message.info('今日企业微信日报已推送，未重复发送');
        }
        // 打开长图预览；若已配置企微且为管理员/店长，自动将长图推送到群（失败不阻断）
        openLongImage();
        if (role !== 'sales') {
          pushLongImageToWecom().catch(() => { /* 静默 */ });
        }
      }
    } catch (e) { message.error(e.response?.data?.error || '提交失败'); }
  };

  // 保存图片（移动端兼容版）
  // 关键：必须截图「原地真实渲染的节点」（imgRef.current，即预览里的 DailyLongImage），
  // 绝不能截图离屏节点（left:-10000 那种定位）——移动端 WebView 会跳过离屏节点
  // 绘制 → 截出空白图。html-to-image 只克隆传入的目标节点，不受父级 scale 缩放影响，
  // 因此即便预览被 scale 缩小，导出的 PNG 仍是 720px 清晰原图。
  const handleSaveImage = async () => {
    const node = imgRef.current;
    if (!node) return;
    try {
      setImgLoading(true);
      const w = node.offsetWidth || 720;
      const h = Math.max(node.scrollHeight, node.offsetHeight) || 0;
      const dataUrl = await toPng(node, {
        pixelRatio: 2,
        backgroundColor: 'var(--color-bg-white)',
        cacheBust: true,
        width: w,
        height: h,
        style: { transform: 'none', transformOrigin: 'top left', margin: 0 },
      });
      // 下载
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `销售日报_${imgData?.report_date || ''}_${imgData?.salesperson_name || ''}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      message.success('图片已保存，可转发到微信群');
    } catch (e) {
      console.error('长图生成失败', e);
      message.error('生成图片失败');
    } finally {
      setImgLoading(false);
    }
  };

  // 关闭长图弹窗时释放 imgData，避免大对象常驻内存
  const closeLongImage = () => {
    setImgOpen(false);
    setImgData(null);
  };

  // 退回重填：管理员/店长将已提交日报解锁为草稿
  const handleUnsubmit = async () => {
    if (!report) return;
    try {
      const res = await api.post(`/daily/report/${report.id}/unsubmit`);
      if (res.data.success) {
        setReport(res.data.report);
        message.success('已退回，可重新编辑');
      }
    } catch (e) { message.error(e.response?.data?.error || '退回失败'); }
  };

  // 将当前长图生成 PNG base64 并推送至企业微信群（仅管理员/店长、已配置 webhook 时）
  const pushLongImageToWecom = async () => {
    const node = imgRef.current;
    if (!node || !imgData) return;
    const w = node.offsetWidth || 720;
    const h = Math.max(node.scrollHeight, node.offsetHeight) || 0;
    const dataUrl = await toPng(node, {
      pixelRatio: 2,
      backgroundColor: 'var(--color-bg-white)',
      cacheBust: true,
      width: w,
      height: h,
      style: { transform: 'none', transformOrigin: 'top left', margin: 0 },
    });
    const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');
    const res = await api.post('/wecom/push-longimage', { image: base64 });
    if (res.data.success) message.success('长图已推送到企业微信群');
  };

  // 添加一条客资
  const handleAddCustomer = async () => {
    try {
      const body = { report_date: date.format('YYYY-MM-DD'), ...custForm };
      if (role !== 'sales') body.salesperson_id = salesId;
      const res = await api.post('/daily/customers', body);
      if (res.data.success) {
        message.success('客资已保存');
        setCustForm({ is_deal: false });
        // 同步沉淀到客户主档（用于跨日跟进跟踪），失败不阻断日报录入
        api.post('/customers/link-daily', {
          report_date: date.format('YYYY-MM-DD'),
          salesperson_id: role !== 'sales' ? salesId : user?.id,
          customer_name: custForm.customer_name,
          customer_desc: custForm.customer_desc,
          source: custForm.source,
          phone: custForm.phone,
          intention_product: custForm.intention_product,
          is_wechat: custForm.is_wechat,
          is_douyin: custForm.is_douyin,
          is_deal: custForm.is_deal,
          deal_amount: custForm.deal_amount,
          not_deal_reason: custForm.not_deal_reason,
        }).catch((err) => { console.error('更新客户失败', err); message.error(err.response?.data?.error || '更新客户失败'); });
        // 刷新客资列表
        const rp = await api.get('/daily/report', {
          params: { report_date: date.format('YYYY-MM-DD'), ...(role !== 'sales' ? { salesperson_id: salesId } : {}) }
        });
        if (rp.data.success) setCustomers(rp.data.customers || []);
      }
    } catch (e) { message.error('保存失败'); }
  };

  // 删除客资
  const handleDeleteCustomer = async (id) => {
    try {
      await api.delete(`/daily/customers/${id}`);
      setCustomers(cs => cs.filter(c => c.id !== id));
      message.success('已删除');
    } catch (e) { message.error('删除失败'); }
  };

  // ========== 历史日报加载 ==========
  useEffect(() => {
    if (role === 'sales') return;
    if (activeTab !== 'history') return;
    let alive = true;
    setHistoryLoading(true);
    api.get('/daily/history', { params: role !== 'sales' && historySalesId ? { salesperson_id: historySalesId } : {} })
      .then(res => { if (alive && res.data.success) setHistory(res.data.reports || []); })
      .catch((err) => { console.error('加载历史记录失败', err); message.error('加载历史日报失败'); })
      .finally(() => { if (alive) setHistoryLoading(false); });
    return () => { alive = false; };
  }, [activeTab, role, historySalesId]);

  // ========== 渲染：历史日报列表 ==========
  const renderHistoryTab = () => (
    <Card size="small" style={{ borderRadius: 10, background: STYLE.cardBg }} title="历史已提交日报"
      extra={role !== 'sales' && (
        <Select value={historySalesId} onChange={setHistorySalesId}  placeholder="全部导购"
          options={salesOptions} className="w-sm" />
      )}>
      <Spin spinning={historyLoading}>
        {history.length === 0 ? (
          <EmptyState title="暂无历史日报" description="该导购暂无已提交日报" />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {history.map(h => (
              <div key={h.id} style={{
                background: STYLE.cardBg, border: `1px solid var(--color-border-light)`, borderRadius: 8,
                padding: '16px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10,
                boxShadow: 'var(--shadow-sm)', cursor: 'pointer',
              }} onClick={() => { setDate(dayjs(h.report_date)); setActiveTab('fill'); }}>
                <span style={{ fontWeight: 600, color: STYLE.text }}>{h.report_date}</span>
                <Tag color="green" style={{ margin: 0 }}>成交 {h.deal_count || 0} 单</Tag>
                <span style={{ color: STYLE.textSecondary }}>成交额 ¥{(h.deal_amount || 0).toLocaleString()}</span>
                <span style={{ color: STYLE.textSecondary, marginLeft: 'auto' }}>接待 {h.reception_count || 0}</span>
                <Button type="link" style={{ marginLeft: 8 }}>查看 →</Button>
              </div>
            ))}
          </div>
        )}
      </Spin>
    </Card>
  );

  // ========== 渲染：今日工作填写区 ==========
  const renderWorkSection = () => {
    const numberFields = reportFields.filter(f => f.field_type === 'number');
    const textFields = reportFields.filter(f => f.field_type !== 'number');
    return (
      <Card size="small" style={{ borderRadius: 10, background: STYLE.cardBg, marginBottom: 16, boxShadow: 'var(--shadow-sm)' }}>
        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 16, color: STYLE.text, display: 'flex', alignItems: 'center', gap: 6 }}>
          <FileTextOutlined /> 今日工作
        </div>
        {/* 数字指标：一行均匀排列 */}
        {numberFields.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : `repeat(${numberFields.length}, 1fr)`, gap: 16, marginBottom: textFields.length ? 16 : 0 }}>
            {numberFields.map(f => (
              <div key={f.field_key}>
                <div style={{ fontSize: 'var(--font-size-sm)', color: STYLE.textSecondary, marginBottom: 6 }}>{f.field_label}</div>
                <InputNumber min={0} value={form[f.field_key]} onChange={v => setField(f.field_key, v || 0)}
                  disabled={isSubmitted} style={{ width: '100%' }} />
              </div>
            ))}
          </div>
        )}
        {/* 文本小结：各占一半 */}
        {textFields.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, 1fr)', gap: 16 }}>
            {textFields.map(f => (
              <div key={f.field_key}>
                <div style={{ fontSize: 'var(--font-size-sm)', color: STYLE.textSecondary, marginBottom: 6 }}>{f.field_label}</div>
                <Input.TextArea rows={2} value={form[f.field_key]} onChange={e => setField(f.field_key, e.target.value)}
                  disabled={isSubmitted} placeholder={`填写${f.field_label}`} style={{ resize: 'vertical' }} />
              </div>
            ))}
          </div>
        )}
      </Card>
    );
  };

  // ========== 渲染：客资录入区 ==========
  const renderCustomerForm = () => (
    <Card size="small" style={{ borderRadius: 10, background: STYLE.cardBg, marginBottom: 16, boxShadow: 'var(--shadow-sm)' }}>
      <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 16, color: STYLE.text, display: 'flex', alignItems: 'center', gap: 6 }}>
        <UserOutlined /> 录入客资
      </div>

      {/* ① 客户情况 */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 500, color: STYLE.textSecondary, marginBottom: 8 }}>客户情况</div>
        <Input.TextArea rows={2} value={custForm.customer_desc || ''} onChange={e => setCust('customer_desc', e.target.value)}
          disabled={isSubmitted} placeholder="描述客户情况，如：年轻带的小孩刚定了定制过来看家具" style={{ resize: 'vertical' }} />
      </div>

      {/* ② 基础信息：名称 / 来源 / 电话 / 意向产品 / 是否成交 */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 500, color: STYLE.textSecondary, marginBottom: 8 }}>基础信息</div>
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(5, 1fr)', gap: 16, alignItems: 'end' }}>
          <div>
            <div style={{ fontSize: 'var(--font-size-sm)', color: STYLE.textSecondary, marginBottom: 6 }}>客户名称</div>
            <Input value={custForm.customer_name || ''} onChange={e => setCust('customer_name', e.target.value)}
              disabled={isSubmitted} placeholder="客户姓名" />
          </div>
          <div>
            <div style={{ fontSize: 'var(--font-size-sm)', color: STYLE.textSecondary, marginBottom: 6 }}>客户来源</div>
            <Select value={custForm.source || undefined} onChange={v => setCust('source', v)}
              disabled={isSubmitted} options={SOURCE_OPTIONS} placeholder="选择来源" style={{ width: '100%' }} allowClear />
          </div>
          <div>
            <div style={{ fontSize: 'var(--font-size-sm)', color: STYLE.textSecondary, marginBottom: 6 }}>客户电话</div>
            <Input value={custForm.phone || ''} onChange={e => setCust('phone', e.target.value)}
              disabled={isSubmitted} placeholder="手机号" />
          </div>
          <div>
            <div style={{ fontSize: 'var(--font-size-sm)', color: STYLE.textSecondary, marginBottom: 6 }}>客户意向产品</div>
            <Input value={custForm.intention_product || ''} onChange={e => setCust('intention_product', e.target.value)}
              disabled={isSubmitted} placeholder="如：乳胶床垫、实木床" />
          </div>
          <div>
            <div style={{ fontSize: 'var(--font-size-sm)', color: STYLE.textSecondary, marginBottom: 6 }}>是否成交</div>
            <Select value={custForm.is_deal === true ? true : (custForm.is_deal === false ? false : undefined)}
              onChange={v => setCust('is_deal', v)} disabled={isSubmitted}
              options={[{ label: '是', value: true }, { label: '否', value: false }]}
              placeholder="请选择" style={{ width: '100%' }} />
          </div>
        </div>
      </div>

      {/* ③ 条件字段：成交金额 / 未成交原因 */}
      {custForm.is_deal !== undefined && custForm.is_deal !== null && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 500, color: STYLE.textSecondary, marginBottom: 8 }}>
            {custForm.is_deal === true ? '成交信息' : '未成交原因'}
          </div>
          {custForm.is_deal === true && (
            <InputNumber min={0} value={custForm.deal_amount || undefined}
              onChange={v => setCust('deal_amount', v)} disabled={isSubmitted}
              placeholder="成交金额" style={{ width: '100%' }} prefix="¥" />
          )}
          {custForm.is_deal === false && (
            <Input.TextArea rows={2} value={custForm.not_deal_reason || ''} onChange={e => setCust('not_deal_reason', e.target.value)}
              disabled={isSubmitted} placeholder="记录未成交原因" style={{ resize: 'vertical' }} />
          )}
        </div>
      )}

      {/* ④ 跟进标签与操作 */}
      <div>
        <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 500, color: STYLE.textSecondary, marginBottom: 8 }}>跟进与操作</div>
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)', gap: 16, alignItems: 'end' }}>
          <div>
            <div style={{ fontSize: 'var(--font-size-sm)', color: STYLE.textSecondary, marginBottom: 6 }}>是否留微信</div>
            <Select value={custForm.is_wechat === true ? true : (custForm.is_wechat === false ? false : undefined)}
              onChange={v => setCust('is_wechat', v)} disabled={isSubmitted}
              options={YES_NO_OPTIONS} placeholder="请选择" style={{ width: '100%' }} />
          </div>
          <div>
            <div style={{ fontSize: 'var(--font-size-sm)', color: STYLE.textSecondary, marginBottom: 6 }}>是否抖音评论</div>
            <Select value={custForm.is_douyin_comment === true ? true : (custForm.is_douyin_comment === false ? false : undefined)}
              onChange={v => setCust('is_douyin_comment', v)} disabled={isSubmitted}
              options={YES_NO_OPTIONS} placeholder="请选择" style={{ width: '100%' }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <Button type="primary" block={isMobile} icon={<PlusOutlined />} onClick={handleAddCustomer} disabled={isSubmitted}>
              保存这条客资
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );

  // ========== 渲染：已录客资列表 ==========
  const renderCustomerList = () => {
    const sourceLabel = (s) => SOURCE_OPTIONS.find(o => o.value === s)?.label || s || '未填';
    return (
      <div>
        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 10, color: STYLE.text }}>
          今日已录客资（{customers.length} 组）— 序号自动排列
        </div>
        {customers.length === 0 ? (
          <EmptyState title="今日还没有客资记录" description="点击「保存这条客资」录入今日客资" />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {customers.map((c, idx) => (
              <div key={c.id} style={{
                background: STYLE.cardBg, border: `1px solid ${c.is_deal === 1 ? 'var(--color-success)' : 'var(--color-border-light)'}`,
                borderRadius: 8, padding: '10px 14px', display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap',
                boxShadow: 'var(--shadow-sm)',
              }}>
                <Tag color="blue" style={{ fontWeight: 700, fontSize: 12 }}>#{idx + 1}</Tag>
                <div style={{ flex: 1, minWidth: 200, lineHeight: 1.7, fontSize: 'var(--font-size-sm)' }}>
                  <span style={{ fontWeight: 600, color: STYLE.text }}>{c.customer_desc || '（无描述）'}</span>
                  {c.customer_name && <span style={{ marginLeft: 8, color: STYLE.textSecondary }}>{c.customer_name}</span>}
                  <Tag color="blue" style={{ marginLeft: 6 }}>{sourceLabel(c.source)}</Tag>
                  {c.intention_product && <span style={{ color: STYLE.textSecondary }}>意向：<b>{c.intention_product}</b></span>}
                  {c.phone && <span style={{ color: STYLE.textSecondary, marginLeft: 4 }}><PhoneOutlined /> {c.phone}</span>}
                  {c.is_wechat === 1 && <Tag color="green">微信</Tag>}
                  {c.is_douyin_comment === 1 && <Tag color="purple">抖音</Tag>}
                </div>
                <Tag color={c.is_deal === 1 ? 'green' : 'orange'} style={{ alignSelf: 'flex-start' }}>
                  {c.is_deal === 1 ? `✅ 成交 ${formatMoneyInt(c.deal_amount)}` : `❌ 未成交${c.not_deal_reason ? ': ' + c.not_deal_reason : ''}`}
                </Tag>
                <Button danger type="text" style={{ marginLeft: 'auto' }} onClick={() => handleDeleteCustomer(c.id)} disabled={isSubmitted}>删除</Button>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  // ========== 主 Tab 内容 ==========
  const renderFillTab = () => (
    <Spin spinning={loading}>
      {isSubmitted && (
        <div style={{ background: 'var(--color-success-bg)', border: '1px solid rgba(56,158,13,0.3)', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 'var(--font-size-sm)', color: 'var(--color-success)', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
          <span>当日日报已于 {report.updated_at?.slice(0, 16)} 闭店提交，内容已锁定。可查看或重新生成长图。</span>
          {role !== 'sales' && (
            <Button danger onClick={handleUnsubmit} style={{ marginLeft: 'auto' }}>退回重填</Button>
          )}
        </div>
      )}

      {/* 顶部操作栏 */}
      <div style={{
        display: 'flex', flexDirection: isMobile ? 'column' : 'row',
        gap: 16, marginBottom: 16, alignItems: isMobile ? 'stretch' : 'flex-end',
      }}>
        <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: 16, flex: 1 }}>
          <div>
            <div style={{ fontSize: 'var(--font-size-sm)', color: STYLE.textTertiary, marginBottom: 4 }}>日报日期</div>
            <DatePicker value={date} onChange={d => d && setDate(d)} disabledDate={d => d && d.isAfter(dayjs(), 'day')} style={{ width: isMobile ? '100%' : 180 }} />
          </div>
          {role !== 'sales' && (
            <div>
              <div style={{ fontSize: 'var(--font-size-sm)', color: STYLE.textTertiary, marginBottom: 4 }}>导购</div>
              <Select value={salesId} onChange={setSalesId} style={{ width: isMobile ? '100%' : 160 }}
                options={salesOptions} placeholder="全部导购" />
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, width: isMobile ? '100%' : 'auto' }}>
          <Button icon={<SaveOutlined />} loading={saving} onClick={handleSaveDraft} disabled={isSubmitted} block={isMobile}>保存草稿</Button>
          <Button type="primary" icon={<CheckCircleOutlined />} onClick={handleSubmit} disabled={isSubmitted} block={isMobile}>闭店提交</Button>
        </div>
      </div>

      {/* 今日工作 */}
      {renderWorkSection()}

      {/* 客资录入 */}
      {renderCustomerForm()}

      {/* 已录客资列表 */}
      {renderCustomerList()}

      {/* 长图预览按钮 */}
      <div style={{ marginTop: 20, textAlign: isMobile ? 'center' : 'center' }}>
        <Button type="primary" icon={<PictureOutlined />} onClick={openLongImage} block={isMobile}>预览 / 生成长图</Button>
      </div>
    </Spin>
  );

  const tabItems = [
    { key: 'fill', label: '日报填写' },
  ];
  // 导购仅可见「日报填写」；老板/管理员可看客户明细与数据看板
  if (role !== 'sales') {
    tabItems.push(
      { key: 'customers', label: '客户明细' },
      { key: 'board', label: '数据看板' },
      { key: 'history', label: '历史日报' },
    );
  }
  if (role === 'admin') tabItems.push({ key: 'config', label: '字段设置' });

  const longScale = getLongImageScale(isMobile);

  return (
    <div style={{ padding: isMobile ? '16px 16px 8px' : 0 }}>
      <PageHeader title="销售日报" />
      <Tabs activeKey={activeTab} onChange={setActiveTab} items={tabItems} />

      {/* 各 Tab 内容独立渲染：避开受控 Tabs 对 children element 引用的不稳定处理 */}
      <div style={{ marginTop: 16 }}>
        <TabErrorBoundary>
          {activeTab === 'fill' && renderFillTab()}
        </TabErrorBoundary>
        {role !== 'sales' && (
          <TabErrorBoundary>
            {activeTab === 'customers' && <DailyCustomers stats={stats} />}
          </TabErrorBoundary>
        )}
        {role !== 'sales' && (
          <TabErrorBoundary>
            {activeTab === 'board' && <DailyBoard stats={stats} onStatsChange={loadStats} statsLoading={statsLoading} />}
          </TabErrorBoundary>
        )}
        {role !== 'sales' && (
          <TabErrorBoundary>
            {activeTab === 'history' && renderHistoryTab()}
          </TabErrorBoundary>
        )}
        {role === 'admin' && (
          <TabErrorBoundary>
            {activeTab === 'config' && <DailyFieldConfig />}
          </TabErrorBoundary>
        )}
      </div>

      {/* ===== 长图预览：手机端沉浸式全屏 / PC 端居中弹窗 ===== */}
      <Modal
        open={imgOpen}
        title={null}
        closable={!isMobile}
        footer={null}
        className="modal-lg"
        style={{
          top: isMobile ? 0 : 72,
          maxWidth: '100vw',
          paddingBottom: isMobile ? 0 : undefined,
        }}
        onCancel={closeLongImage}
        centered={!isMobile}
        styles={{
          body: {
            padding: isMobile ? '12px 0 0' : 16,
            ...(isMobile ? { height: 'calc(100vh)', overflowY: 'auto', WebkitOverflowScrolling: 'touch' } : {}),
          },
          content: {
            borderRadius: isMobile ? 0 : undefined,
            ...(isMobile ? { minHeight: '100vh', maxHeight: '100vh', overflow: 'hidden' } : {}),
          },
          mask: { background: isMobile ? 'rgba(0,0,0,0.65)' : undefined },
        }}
      >
        <Spin spinning={imgLoading}>
          {!imgData
            ? <EmptyState title="暂无数据" description="暂无可预览的长图" />
            : (
              <>
                {/* 长图内容区 */}
                <div style={{
                  display: 'flex',
                  justifyContent: 'center',
                  paddingBottom: isMobile ? 80 : 0,
                }}>
                  <div style={{
                    transform: `scale(${longScale})`,
                    transformOrigin: 'top center',
                    flex: '0 0 auto',
                  }}>
                    <DailyLongImage ref={imgRef} data={imgData} />
                  </div>
                </div>

                {/* PC 端提示文字 + 按钮 */}
                {!isMobile && (
                  <>
                    <div style={{ fontSize: 12, color: STYLE.textTertiary, marginTop: 12, textAlign: 'center' }}>
                      点击「保存图片」下载 PNG，转发到门店微信群。
                    </div>
                    <div style={{ textAlign: 'center', marginTop: 12 }}>
                      <Space>
                        <Button onClick={closeLongImage}>关闭</Button>
                        <Button type="primary" icon={<PictureOutlined />} loading={imgLoading} onClick={handleSaveImage}>保存图片</Button>
                      </Space>
                    </div>
                  </>
                )}

                {/* 手机端固定底部操作栏 */}
                {isMobile && (
                  <div style={{
                    position: 'sticky',
                    bottom: 0,
                    left: 0,
                    right: 0,
                    background: 'var(--color-bg-white)',
                    borderTop: '1px solid var(--color-border-light)',
                    padding: '12px 16px',
                    display: 'flex',
                    gap: 12,
                    zIndex: 10,
                    margin: 0,
                    // 安全区域适配（iPhone 刘海/底部横条）
                    paddingBottom: 'max(12px, env(safe-area-inset-bottom))',
                  }}>
                    <Button block onClick={closeLongImage}>
                      关闭预览
                    </Button>
                    <Button type="primary" block icon={<PictureOutlined />}
                      loading={imgLoading} onClick={handleSaveImage}
                    >
                      保存图片
                    </Button>
                  </div>
                )}

                {/* 离屏导出节点已移除：截图改用预览里的原地节点（imgRef），避免离屏定位导致 WebView 截空白 */}
              </>
            )
          }
        </Spin>
      </Modal>
    </div>
  );
}
