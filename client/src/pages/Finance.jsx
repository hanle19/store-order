import { TABLE_SCROLL_X } from '../components/tableConstants';
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Row, Col, Card, Table, Tag, Button, Modal, Form, Input, InputNumber,
  Select, Space, Empty, Statistic, Grid, Popconfirm, message, DatePicker, Progress,
} from 'antd';
import {
  DollarOutlined, ShoppingCartOutlined, PieChartOutlined,
  PlusOutlined, EditOutlined, DeleteOutlined, RiseOutlined,
  WalletOutlined, CrownOutlined, ImportOutlined, FallOutlined,
  AimOutlined, FundOutlined, AccountBookOutlined, WarningOutlined,
} from '@ant-design/icons';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, BarChart, Bar, Line, ComposedChart,
  PieChart, Pie, Cell,
} from 'recharts';
import dayjs from 'dayjs';
import api from '../api';
import { useStore } from '../context/StoreContext';
import PageHeader from '../components/PageHeader';
import ExcelImportExport from '../components/ExcelImportExport';
import { FINANCE_THEME as C, FINANCE_STATUS_MAP as statusMap, FINANCE_COST_CATEGORY_MAP as costCategoryMap } from './Finance.constants.js';

const { useBreakpoint } = Grid;

export default function Finance() {
  const [summary, setSummary] = useState(null);
  const [dailyTrend, setDailyTrend] = useState([]);
  const [orderProfits, setOrderProfits] = useState([]);
  const [cashflow, setCashflow] = useState(null);
  const [costBreakdown, setCostBreakdown] = useState(null);
  const [yearly, setYearly] = useState(null);
  const [receivables, setReceivables] = useState(null);
  const [ledger, setLedger] = useState({ returns: [], aftersales: [] });
  const [loading, setLoading] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState(dayjs());
  const [costModalOpen, setCostModalOpen] = useState(false);
  const [editingCost, setEditingCost] = useState(null);
  const [costForm] = Form.useForm();
  const [activeTab, setActiveTab] = useState('summary');
  const screens = useBreakpoint();
  const isMobile = !screens.lg;
  const { storeId, getStoreParam } = useStore();

  // 请求序号：快速切换月份/门店时，先发出的一组请求回来后不得覆盖后发结果（竞态防护）
  const financeReqSeq = useRef(0);
  const loadData = useCallback(async () => {
    const seq = ++financeReqSeq.current;
    setLoading(true);
    try {
      const params = { year: selectedMonth.year(), month: selectedMonth.month() + 1 };
      const sid = getStoreParam();
      if (sid) params.store_id = sid;
      const yParams = { year: selectedMonth.year() };
      if (sid) yParams.store_id = sid;
      const [sumRes, trendRes, profitRes, cfRes, cbRes, ysRes, rcRes, lgRes] = await Promise.all([
        api.get('/finance/monthly-summary', { params }),
        api.get('/finance/daily-trend', { params }),
        api.get('/finance/order-profits', { params }),
        api.get('/finance/cashflow', { params }),
        api.get('/finance/cost-breakdown', { params }),
        api.get('/finance/yearly-summary', { params: yParams }),
        api.get('/finance/receivables'),
        api.get('/finance/aftersales-ledger', { params }),
      ]);
      if (seq !== financeReqSeq.current) return; // 已有更新的请求，丢弃本次结果
      setSummary(sumRes.data);
      setDailyTrend(trendRes.data);
      setOrderProfits(profitRes.data);
      setCashflow(cfRes.data);
      setCostBreakdown(cbRes.data);
      setYearly(ysRes.data);
      setReceivables(rcRes.data);
      setLedger(lgRes.data);
    } catch (err) {
      if (seq !== financeReqSeq.current) return;
      console.error('加载财务数据失败:', err);
      message.error('加载财务数据失败');
    } finally {
      if (seq === financeReqSeq.current) setLoading(false);
    }
  }, [selectedMonth, storeId]);

  useEffect(() => { loadData(); }, [loadData]);

  const fmtMoney = (v) => {
    const n = parseFloat(v) || 0;
    return n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  // 其他成本操作
  const handleSaveCost = async () => {
    try {
      const values = await costForm.validateFields();
      const payload = {
        ...values,
        year: selectedMonth.year(),
        month: selectedMonth.month() + 1,
        amount: parseFloat(values.amount),
      };
      if (editingCost) {
        await api.put(`/finance/other-costs/${editingCost.id}`, payload);
        message.success('修改成功');
      } else {
        await api.post('/finance/other-costs', payload);
        message.success('添加成功');
      }
      setCostModalOpen(false);
      setEditingCost(null);
      costForm.resetFields();
      loadData();
    } catch (err) {
      if (err.errorFields) return;
      message.error('操作失败');
    }
  };

  const handleDeleteCost = async (id) => {
    try {
      await api.delete(`/finance/other-costs/${id}`);
      message.success('删除成功');
      loadData();
    } catch (err) {
      message.error('删除失败');
    }
  };

  const openEditCost = (record) => {
    setEditingCost(record);
    costForm.setFieldsValue(record);
    setCostModalOpen(true);
  };

  const openAddCost = () => {
    setEditingCost(null);
    costForm.resetFields();
    costForm.setFieldsValue({ category: 'other' });
    setCostModalOpen(true);
  };

  const profitColor = (summary?.profit || 0) >= 0 ? C.success : C.danger;
  const marginColor = (summary?.profit_margin || 0) >= 0 ? C.success : C.danger;
  const cashColor = (cashflow?.net_cashflow || 0) >= 0 ? C.success : C.danger;

  // 汇总卡片（6 张）
  const summaryCards = summary && cashflow ? [
    {
      title: '销售收入',
      value: summary.revenue,
      icon: <DollarOutlined />,
      color: C.primary,
      bg: C.tintPrimary,
      sub: `${summary.order_count} 笔订单`,
    },
    {
      title: '货物成本',
      value: summary.goods_cost,
      icon: <ShoppingCartOutlined />,
      color: C.warning,
      bg: C.tintWarning,
      sub: '商品进价合计',
    },
    {
      title: '其他成本',
      value: summary.other_costs_total,
      icon: <WalletOutlined />,
      color: C.info,
      bg: C.tintInfo,
      sub: `${summary.other_costs_count} 项支出`,
    },
    {
      title: '净利润',
      value: summary.profit,
      icon: <CrownOutlined />,
      color: profitColor,
      bg: profitColor === C.success ? C.tintSuccessBg : C.tintDangerBg,
      sub: `利润率 ${summary.profit_margin.toFixed(1)}%`,
      isProfit: true,
    },
    {
      title: '亏损额',
      value: summary.loss_amount || 0,
      icon: <WarningOutlined />,
      color: (summary.loss_amount || 0) > 0 ? C.danger : C.textLight,
      bg: (summary.loss_amount || 0) > 0 ? C.tintDangerBg : C.tintPrimary,
      sub: '低于保本价销售的部分',
    },
    {
      title: '采购进货额',
      value: summary.purchase_expense,
      icon: <ImportOutlined />,
      color: C.info,
      bg: C.tintInfo,
      sub: '进货发生额(账面)',
    },
    {
      title: '净现金流',
      value: cashflow.net_cashflow,
      icon: <FallOutlined />,
      color: cashColor,
      bg: cashColor === C.success ? C.tintSuccessBg : C.tintDangerBg,
      sub: '收款-进货-其他',
    },
  ] : [];

  // 图表数据 - 只显示有数据的日期
  const chartData = dailyTrend.filter(d => d.revenue > 0 || d.other_cost > 0 || d.order_count > 0);
  const cashChartData = cashflow?.daily.filter(d => d.collected > 0 || d.purchase_expense > 0 || d.other_cost > 0) || [];
  const pieData = (costBreakdown?.items || []).map(it => ({
    name: (costCategoryMap[it.category] || costCategoryMap.other).label,
    value: it.total,
    color: (costCategoryMap[it.category] || costCategoryMap.other).color,
  }));

  const tabItems = [
    { key: 'summary', label: '财务总览' },
    { key: 'cashflow', label: '现金流' },
    { key: 'daily', label: '每日趋势' },
    { key: 'orders', label: '订单利润' },
    { key: 'costs', label: '其他成本' },
    { key: 'yearly', label: '年度汇总' },
    { key: 'receivables', label: '应收账款' },
  ];

  // 其他成本表格列
  const costColumns = [
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
      render: (v) => <span style={{ fontWeight: 500 }}>{v}</span>,
    },
    {
      title: '类别',
      dataIndex: 'category',
      key: 'category',
      width: 104,
      render: (v) => {
        const cat = costCategoryMap[v] || costCategoryMap.other;
        return <Tag color={cat.color} style={{ border: 'none' }}>{cat.label}</Tag>;
      },
    },
    {
      title: '金额',
      dataIndex: 'amount',
      key: 'amount',
      width: 120,
      align: 'right',
      render: (v) => <span style={{ fontWeight: 600, color: C.danger }}>¥{fmtMoney(v)}</span>,
    },
    {
      title: '备注',
      dataIndex: 'note',
      key: 'note',
      ellipsis: true,
      render: (v) => v || '-',
    },
    {
      title: '操作',
      key: 'action',
      width: 120,
      render: (_, record) => (
        <Space size="small">
          <Button type="text" icon={<EditOutlined />} onClick={() => openEditCost(record)} />
          <Popconfirm title="确认删除？" onConfirm={() => handleDeleteCost(record.id)} okText="确认" cancelText="取消">
            <Button type="text" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  // 订单利润表格列
  const orderColumns = [
    {
      title: '订单号',
      dataIndex: 'order_no',
      key: 'order_no',
      width: 152,
      render: (v) => <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{v}</span>,
    },
    {
      title: '客户',
      dataIndex: 'customer_name',
      key: 'customer_name',
      width: 104,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 88,
      render: (v) => {
        const s = statusMap[v] || { color: 'default', text: v };
        return <Tag color={s.color} style={{ fontSize: 11 }}>{s.text}</Tag>;
      },
    },
    {
      title: '销售额',
      dataIndex: 'revenue',
      key: 'revenue',
      width: 112,
      align: 'right',
      render: (v) => <span style={{ fontWeight: 500 }}>¥{fmtMoney(v)}</span>,
    },
    {
      title: '货物成本',
      dataIndex: 'goods_cost',
      key: 'goods_cost',
      width: 112,
      align: 'right',
      render: (v) => <span style={{ color: C.textLight }}>¥{fmtMoney(v)}</span>,
    },
    {
      title: '利润',
      dataIndex: 'profit',
      key: 'profit',
      width: 112,
      align: 'right',
      render: (v) => (
        <span style={{ fontWeight: 600, color: v >= 0 ? C.success : C.danger }}>
          ¥{fmtMoney(v)}
        </span>
      ),
    },
    {
      title: '利润率',
      dataIndex: 'profit_margin',
      key: 'profit_margin',
      width: 88,
      align: 'right',
      render: (v) => (
        <span style={{ fontWeight: 500, color: v >= 0 ? C.success : C.danger }}>
          {v.toFixed(1)}%
        </span>
      ),
    },
    {
      title: '下单时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 152,
      render: (v) => <span style={{ fontSize: 12, color: C.textLight }}>{v}</span>,
    },
  ];

  // 退换/售后对账明细列
  const ledgerReturnColumns = [
    { title: '订单号', dataIndex: 'order_no', key: 'order_no', width: 140, render: (v) => <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{v}</span> },
    { title: '客户', dataIndex: 'customer_name', key: 'customer_name', width: 96 },
    { title: '类型', dataIndex: 'type', key: 'type', width: 72, render: (v) => <Tag color={v === 'return' ? 'orange' : 'blue'} style={{ fontSize: 11 }}>{v === 'return' ? '退货' : '换货'}</Tag> },
    {
      title: '金额', key: 'amount', width: 120, align: 'right',
      render: (_, r) => r.type === 'return'
        ? <span style={{ fontWeight: 500, color: C.danger }}>退款 ¥{fmtMoney(r.refund_amount)}</span>
        : <span style={{ fontWeight: 500 }}>差价 ¥{fmtMoney(r.diff_amount)}</span>,
    },
    { title: '经办', dataIndex: 'operator_name', key: 'operator_name', width: 88, render: (v) => v || '-' },
    { title: '完成时间', dataIndex: 'completed_at', key: 'completed_at', width: 152, render: (v) => <span style={{ fontSize: 12, color: C.textLight }}>{v || '-'}</span> },
  ];
  const ledgerAftersalesColumns = [
    { title: '订单号', dataIndex: 'order_no', key: 'order_no', width: 140, render: (v) => v ? <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{v}</span> : '-' },
    { title: '客户', dataIndex: 'customer_name', key: 'customer_name', width: 96, render: (v) => v || '-' },
    { title: '类型', dataIndex: 'type', key: 'type', width: 80, render: (v) => ({ repair: '维修', parts: '补件', complaint: '投诉', other: '其他' }[v] || v) },
    { title: '事项', dataIndex: 'title', key: 'title', ellipsis: true },
    { title: '费用', dataIndex: 'cost', key: 'cost', width: 104, align: 'right', render: (v) => <span style={{ fontWeight: 500, color: C.danger }}>¥{fmtMoney(v)}</span> },
    { title: '创建人', dataIndex: 'created_by_name', key: 'created_by_name', width: 88, render: (v) => v || '-' },
    { title: '关闭时间', dataIndex: 'closed_at', key: 'closed_at', width: 152, render: (v) => <span style={{ fontSize: 12, color: C.textLight }}>{v || '-'}</span> },
  ];

  // 每日明细表格列
  const dailyColumns = [
    {
      title: '日期',
      dataIndex: 'date',
      key: 'date',
      width: 120,
      render: (v) => <span style={{ fontWeight: 500 }}>{v}</span>,
    },
    {
      title: '订单数',
      dataIndex: 'order_count',
      key: 'order_count',
      width: 80,
      align: 'center',
    },
    {
      title: '销售收入',
      dataIndex: 'revenue',
      key: 'revenue',
      width: 120,
      align: 'right',
      render: (v) => <span style={{ fontWeight: 500, color: C.primary }}>¥{fmtMoney(v)}</span>,
    },
    {
      title: '货物成本',
      dataIndex: 'goods_cost',
      key: 'goods_cost',
      width: 120,
      align: 'right',
      render: (v) => <span style={{ color: C.warning }}>¥{fmtMoney(v)}</span>,
    },
    {
      title: '其他成本',
      dataIndex: 'other_cost',
      key: 'other_cost',
      width: 120,
      align: 'right',
      render: (v) => <span style={{ color: C.info }}>¥{fmtMoney(v)}</span>,
    },
    {
      title: '日利润',
      dataIndex: 'profit',
      key: 'profit',
      width: 120,
      align: 'right',
      render: (v) => (
        <span style={{ fontWeight: 600, color: v >= 0 ? C.success : C.danger }}>¥{fmtMoney(v)}</span>
      ),
    },
    {
      title: '利润率',
      dataIndex: 'profit_margin',
      key: 'profit_margin',
      width: 88,
      align: 'right',
      render: (v) => (
        <span style={{ color: v >= 0 ? C.success : C.danger }}>{v.toFixed(1)}%</span>
      ),
    },
    {
      title: '累计利润',
      dataIndex: 'cumulative_profit',
      key: 'cumulative_profit',
      width: 120,
      align: 'right',
      render: (v) => (
        <span style={{ fontWeight: 600, color: v >= 0 ? C.success : C.danger }}>
          ¥{fmtMoney(v)}
        </span>
      ),
    },
  ];

  // 应收账款表格列
  const receivableColumns = [
    {
      title: '订单号',
      dataIndex: 'order_no',
      key: 'order_no',
      width: 152,
      render: (v) => <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{v}</span>,
    },
    {
      title: '客户',
      dataIndex: 'customer_name',
      key: 'customer_name',
      width: 104,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 88,
      render: (v) => {
        const s = statusMap[v] || { color: 'default', text: v };
        return <Tag color={s.color} style={{ fontSize: 11 }}>{s.text}</Tag>;
      },
    },
    {
      title: '应收',
      dataIndex: 'receivable',
      key: 'receivable',
      width: 120,
      align: 'right',
      render: (v) => <span style={{ fontWeight: 600, color: C.danger }}>¥{fmtMoney(v)}</span>,
    },
    {
      title: '已收',
      dataIndex: 'paid',
      key: 'paid',
      width: 120,
      align: 'right',
      render: (v) => <span style={{ color: C.textLight }}>¥{fmtMoney(v)}</span>,
    },
    {
      title: '下单时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 152,
      render: (v) => <span style={{ fontSize: 12, color: C.textLight }}>{v}</span>,
    },
    {
      title: '账龄',
      key: 'overdue',
      width: 112,
      align: 'center',
      render: (_, r) => r.overdue
        ? <Tag color="red" icon={<WarningOutlined />}>{r.days_since}天</Tag>
        : <Tag color="default">{r.days_since}天</Tag>,
    },
  ];

  // 移动端卡片渲染
  const renderDailyMobile = (list) => (
    <div className="x-mcard-list">
      {list.map((d) => (
        <div className="x-mcard" key={d.day}>
          <div className="x-mcard-head">
            <span className="x-mcard-name">{d.day}日</span>
            <span style={{ fontWeight: 600, color: d.profit >= 0 ? C.success : C.danger }}>
              ¥{fmtMoney(d.profit)}
            </span>
          </div>
          <div className="x-mcard-grid">
            <div className="x-mcard-field"><span className="x-mcard-label">订单数</span><span className="x-mcard-value">{d.order_count}</span></div>
            <div className="x-mcard-field"><span className="x-mcard-label">销售收入</span><span className="x-mcard-value" style={{ color: C.primary }}>¥{fmtMoney(d.revenue)}</span></div>
            <div className="x-mcard-field"><span className="x-mcard-label">货物成本</span><span className="x-mcard-value" style={{ color: C.warning }}>¥{fmtMoney(d.goods_cost)}</span></div>
            <div className="x-mcard-field"><span className="x-mcard-label">其他成本</span><span className="x-mcard-value" style={{ color: C.info }}>¥{fmtMoney(d.other_cost)}</span></div>
            <div className="x-mcard-field"><span className="x-mcard-label">利润率</span><span className="x-mcard-value" style={{ color: d.profit_margin >= 0 ? C.success : C.danger }}>{d.profit_margin.toFixed(1)}%</span></div>
            <div className="x-mcard-field"><span className="x-mcard-label">累计利润</span><span className="x-mcard-value" style={{ color: d.cumulative_profit >= 0 ? C.success : C.danger }}>¥{fmtMoney(d.cumulative_profit)}</span></div>
          </div>
        </div>
      ))}
    </div>
  );

  const renderCashMobile = (list) => (
    <div className="x-mcard-list">
      {list.map((d) => (
        <div className="x-mcard" key={d.day}>
          <div className="x-mcard-head">
            <span className="x-mcard-name">{d.day}日</span>
            <span style={{ fontWeight: 600, color: d.net >= 0 ? C.success : C.danger }}>¥{fmtMoney(d.net)}</span>
          </div>
          <div className="x-mcard-grid">
            <div className="x-mcard-field"><span className="x-mcard-label">收款</span><span className="x-mcard-value" style={{ color: C.success }}>¥{fmtMoney(d.collected)}</span></div>
            <div className="x-mcard-field"><span className="x-mcard-label">进货</span><span className="x-mcard-value" style={{ color: C.info }}>¥{fmtMoney(d.purchase_expense)}</span></div>
            <div className="x-mcard-field"><span className="x-mcard-label">其他</span><span className="x-mcard-value" style={{ color: C.warning }}>¥{fmtMoney(d.other_cost)}</span></div>
          </div>
        </div>
      ))}
    </div>
  );

  const renderOrdersMobile = (list) => (
    <div className="x-mcard-list">
      {list.map((o) => {
        const s = statusMap[o.status] || { color: 'default', text: o.status };
        return (
          <div className="x-mcard" key={o.id}>
            <div className="x-mcard-head">
              <span className="x-mcard-name" style={{ fontFamily: 'monospace', fontSize: 'var(--font-size-sm)' }}>{o.order_no}</span>
              <Tag color={s.color} style={{ fontSize: 11 }}>{s.text}</Tag>
            </div>
            <div className="x-mcard-grid">
              <div className="x-mcard-field"><span className="x-mcard-label">客户</span><span className="x-mcard-value">{o.customer_name}</span></div>
              <div className="x-mcard-field"><span className="x-mcard-label">销售额</span><span className="x-mcard-value">¥{fmtMoney(o.revenue)}</span></div>
              <div className="x-mcard-field"><span className="x-mcard-label">货物成本</span><span className="x-mcard-value" style={{ color: C.textLight }}>¥{fmtMoney(o.goods_cost)}</span></div>
              <div className="x-mcard-field"><span className="x-mcard-label">利润</span><span className="x-mcard-value" style={{ color: o.profit >= 0 ? C.success : C.danger }}>¥{fmtMoney(o.profit)}</span></div>
              <div className="x-mcard-field"><span className="x-mcard-label">利润率</span><span className="x-mcard-value" style={{ color: o.profit_margin >= 0 ? C.success : C.danger }}>{o.profit_margin.toFixed(1)}%</span></div>
              <div className="x-mcard-field"><span className="x-mcard-label">下单时间</span><span className="x-mcard-value" style={{ fontSize: 'var(--font-size-sm)', color: C.textLight }}>{o.created_at}</span></div>
            </div>
          </div>
        );
      })}
    </div>
  );

  const renderReceivablesMobile = (list) => (
    <div className="x-mcard-list">
      {list.map((o) => {
        const s = statusMap[o.status] || { color: 'default', text: o.status };
        return (
          <div className="x-mcard" key={o.id}>
            <div className="x-mcard-head">
              <span className="x-mcard-name" style={{ fontFamily: 'monospace', fontSize: 'var(--font-size-sm)' }}>{o.order_no}</span>
              {o.overdue
                ? <Tag color="red" icon={<WarningOutlined />}>{o.days_since}天</Tag>
                : <Tag color="default">{o.days_since}天</Tag>}
            </div>
            <div className="x-mcard-grid">
              <div className="x-mcard-field"><span className="x-mcard-label">客户</span><span className="x-mcard-value">{o.customer_name}</span></div>
              <div className="x-mcard-field"><span className="x-mcard-label">应收</span><span className="x-mcard-value" style={{ fontWeight: 600, color: C.danger }}>¥{fmtMoney(o.receivable)}</span></div>
              <div className="x-mcard-field"><span className="x-mcard-label">已收</span><span className="x-mcard-value" style={{ color: C.textLight }}>¥{fmtMoney(o.paid)}</span></div>
              <div className="x-mcard-field" style={{ gridColumn: '1 / -1' }}><span className="x-mcard-label">状态</span><span className="x-mcard-value"><Tag color={s.color} style={{ fontSize: 11 }}>{s.text}</Tag></span></div>
            </div>
          </div>
        );
      })}
    </div>
  );

  const renderCostsMobile = (list) => {
    const total = list.reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0);
    return (
      <>
        <div className="x-mcard-list">
          {list.map((c) => {
            const cat = costCategoryMap[c.category] || costCategoryMap.other;
            return (
              <div className="x-mcard" key={c.id}>
                <div className="x-mcard-head">
                  <span className="x-mcard-name">{c.name}</span>
                  <Tag color={cat.color} style={{ border: 'none' }}>{cat.label}</Tag>
                </div>
                <div className="x-mcard-grid">
                  <div className="x-mcard-field"><span className="x-mcard-label">金额</span><span className="x-mcard-value" style={{ fontWeight: 600, color: C.danger }}>¥{fmtMoney(c.amount)}</span></div>
                  <div className="x-mcard-field" style={{ gridColumn: '1 / -1' }}><span className="x-mcard-label">备注</span><span className="x-mcard-value">{c.note || '-'}</span></div>
                </div>
                <div className="x-mcard-foot">
                  <Button block onClick={() => openEditCost(c)} icon={<EditOutlined />}>编辑</Button>
                  <Popconfirm title="确认删除？" onConfirm={() => handleDeleteCost(c.id)} okText="确认" cancelText="取消">
                    <Button block danger icon={<DeleteOutlined />}>删除</Button>
                  </Popconfirm>
                </div>
              </div>
            );
          })}
        </div>
        {list.length > 0 && (
          <div style={{ marginTop: 12, textAlign: 'right', fontSize: 15, fontWeight: 700, color: C.danger }}>
            合计 ¥{fmtMoney(total)}
          </div>
        )}
      </>
    );
  };

  return (
    <div style={{ padding: isMobile ? 12 : 0 }}>
      <PageHeader title="财务管理" subtitle={`${selectedMonth.year()}年${selectedMonth.month() + 1}月 经营账`} />
      {/* 顶部：月份选择 + 标签切换 + Excel */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: 16, flexWrap: 'wrap', gap: 12,
      }}>
        <DatePicker
          picker="month"
          value={selectedMonth}
          onChange={(v) => v && setSelectedMonth(v)}
          format="YYYY年MM月"
          style={{ width: isMobile ? '100%' : 180 }}
          allowClear={false}
        />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 4, background: 'var(--color-bg-white)', padding: 4, borderRadius: 8, border: `1px solid ${C.border}`, flexWrap: 'wrap' }}>
            {tabItems.map(item => (
              <div
                key={item.key}
                onClick={() => setActiveTab(item.key)}
                style={{
                  padding: '6px 14px',
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontSize: 'var(--font-size-sm)',
                  fontWeight: activeTab === item.key ? 600 : 400,
                  color: activeTab === item.key ? '#fff' : C.textLight,
                  background: activeTab === item.key ? C.primary : 'transparent',
                  transition: 'all 0.25s ease',
                  whiteSpace: 'nowrap',
                }}
              >
                {item.label}
              </div>
            ))}
          </div>
          <ExcelImportExport module="finance" params={{ year: selectedMonth.year(), month: selectedMonth.month() + 1 }} onImported={loadData} compact />
        </div>
      </div>

      {/* 财务总览 - 始终显示汇总卡片 */}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        {summaryCards.map((card, idx) => (
          <Col xs={12} sm={12} md={8} key={idx}>
            <Card
              loading={loading}
              style={{
                borderRadius: C.radius,
                border: 'none',
                boxShadow: C.cardShadow,
                overflow: 'hidden',
                position: 'relative',
              }}
              bodyStyle={{ padding: '16px 20px' }}
            >
              <div style={{
                position: 'absolute', top: 0, left: 0, right: 0, height: 3,
                background: card.color,
              }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontSize: 'var(--font-size-sm)', color: C.textLight, marginBottom: 8 }}>{card.title}</div>
                  <div style={{
                    fontSize: isMobile ? 18 : 24,
                    fontWeight: 700,
                    color: card.color,
                    lineHeight: 1.2,
                  }}>
                    ¥{fmtMoney(card.value)}
                  </div>
                  <div style={{ fontSize: 12, color: C.textLight, marginTop: 6 }}>{card.sub}</div>
                </div>
                <div style={{
                  width: 40, height: 40, borderRadius: 10,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: card.bg, fontSize: 18, color: card.color,
                }}>
                  {card.icon}
                </div>
              </div>
            </Card>
          </Col>
        ))}
      </Row>

      {/* 利润率 + 目标达成率 进度条 */}
      {summary && (
        <Row gutter={[16, 16]} style={{ marginBottom: 16 }} align="stretch">
          <Col xs={24} md={12} style={{ display: 'flex' }}>
            <Card
              style={{ borderRadius: C.radius, border: 'none', boxShadow: C.cardShadow, width: '100%', display: 'flex', flexDirection: 'column' }}
              bodyStyle={{ padding: '16px 24px', display: 'flex', flexDirection: 'column', flex: 1 }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 500, color: C.text }}>
                  <RiseOutlined style={{ marginRight: 8, color: marginColor }} />
                  本月利润率
                </span>
                <span style={{ fontSize: 20, fontWeight: 700, color: marginColor }}>{summary.profit_margin.toFixed(1)}%</span>
              </div>
              <div style={{ height: 8, borderRadius: 4, background: C.sidebar, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${Math.min(Math.max(summary.profit_margin, 0), 100)}%`, background: `linear-gradient(90deg, ${C.primary}, ${marginColor})`, borderRadius: 4, transition: 'width 0.6s ease' }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 'auto', paddingTop: 8, fontSize: 12, color: C.textLight }}>
                <span>利润 = 销售 ¥{fmtMoney(summary.revenue)} - 成本 ¥{fmtMoney(summary.total_cost)}</span>
                <span>净利润 ¥{fmtMoney(summary.profit)}</span>
              </div>
            </Card>
          </Col>
          <Col xs={24} md={12} style={{ display: 'flex' }}>
            <Card
              style={{ borderRadius: C.radius, border: 'none', boxShadow: C.cardShadow, width: '100%', display: 'flex', flexDirection: 'column' }}
              bodyStyle={{ padding: '16px 24px', display: 'flex', flexDirection: 'column', flex: 1 }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 500, color: C.text }}>
                  <AimOutlined style={{ marginRight: 8, color: C.primary }} />
                  月度销售目标达成率
                </span>
                {summary.target_amount > 0 ? (
                  <span style={{ fontSize: 20, fontWeight: 700, color: (summary.target_achievement || 0) >= 100 ? C.success : C.warning }}>
                    {summary.target_achievement.toFixed(1)}%
                  </span>
                ) : (
                  <span style={{ fontSize: 14, color: C.textLight }}>未设目标</span>
                )}
              </div>
              {summary.target_amount > 0 ? (
                <>
                  <Progress
                    percent={Math.min(summary.target_achievement || 0, 100)}
                    showInfo={false}
                    strokeColor={(summary.target_achievement || 0) >= 100 ? C.success : C.primary}
                    trailColor={C.sidebar}
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 'auto', paddingTop: 8, fontSize: 12, color: C.textLight }}>
                    <span>实际销售 ¥{fmtMoney(summary.revenue)}</span>
                    <span>目标 ¥{fmtMoney(summary.target_amount)}</span>
                  </div>
                </>
              ) : (
                <>
                  <div style={{ height: 8, borderRadius: 4, background: C.sidebar }} />
                  <div style={{ marginTop: 'auto', paddingTop: 8, fontSize: 12, color: C.textLight }}>
                    可在「设置-月度目标」中设置销售目标
                  </div>
                </>
              )}
            </Card>
          </Col>
        </Row>
      )}

      {/* 财务总览 - 每日利润趋势图 */}
      {activeTab === 'summary' && (
        <Card
          title="每日利润趋势"
          style={{ borderRadius: C.radius, border: 'none', boxShadow: C.cardShadow, marginBottom: 16 }}
          headStyle={{ borderBottom: `1px solid ${C.border}`, fontSize: 15, fontWeight: 600 }}
          bodyStyle={{ padding: '16px 12px' }}
        >
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={isMobile ? 260 : 340}>
              <ComposedChart data={chartData}>
                <defs>
                  <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={C.primary} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={C.primary} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="colorProfit" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={C.success} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={C.success} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                <XAxis dataKey="day" tick={{ fontSize: 12, fill: C.textLight }} tickFormatter={(v) => `${v}日`} />
                <YAxis tick={{ fontSize: 12, fill: C.textLight }} />
                <Tooltip
                  contentStyle={{ borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 'var(--font-size-sm)', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}
                  formatter={(value, name) => {
                    const labels = { revenue: '销售收入', goods_cost: '货物成本', profit: '日利润', cumulative_profit: '累计利润', other_cost: '其他成本' };
                    return [`¥${fmtMoney(value)}`, labels[name] || name];
                  }}
                  labelFormatter={(v) => `${selectedMonth.format('YYYY年MM月')}${v}日`}
                />
                <Legend formatter={(v) => { const labels = { revenue: '销售收入', goods_cost: '货物成本', profit: '日利润', cumulative_profit: '累计利润' }; return labels[v] || v; }} />
                <Area type="monotone" dataKey="revenue" stroke={C.primary} fill="url(#colorRevenue)" strokeWidth={2} />
                <Area type="monotone" dataKey="profit" stroke={C.success} fill="url(#colorProfit)" strokeWidth={2} />
                <Line type="monotone" dataKey="cumulative_profit" stroke={C.info} strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <Empty description="本月暂无销售数据" style={{ padding: 40 }} />
          )}
        </Card>
      )}

      {/* 现金流 Tab */}
      {activeTab === 'cashflow' && cashflow && (
        <>
          <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
            {[
              { title: '本期收款', value: cashflow.collected, icon: <DollarOutlined />, color: C.success, bg: C.tintSuccessBg, sub: '实收金额' },
              { title: '进货支出', value: cashflow.purchase_expense, icon: <ImportOutlined />, color: C.info, bg: C.tintInfo, sub: '进货发生额(账面)' },
              { title: '其他支出', value: cashflow.other_cost, icon: <WalletOutlined />, color: C.warning, bg: C.tintWarning, sub: '其他成本' },
              { title: '净现金流', value: cashflow.net_cashflow, icon: <FundOutlined />, color: cashColor, bg: cashColor === C.success ? C.tintSuccessBg : C.tintDangerBg, sub: '收款-进货-其他' },
            ].map((c, i) => (
              <Col xs={12} sm={12} md={6} key={i}>
                <Card style={{ borderRadius: C.radius, border: 'none', boxShadow: C.cardShadow, position: 'relative', overflow: 'hidden' }} bodyStyle={{ padding: '16px 20px' }}>
                  <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: c.color }} />
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <div style={{ fontSize: 'var(--font-size-sm)', color: C.textLight, marginBottom: 8 }}>{c.title}</div>
                      <div style={{ fontSize: isMobile ? 18 : 24, fontWeight: 700, color: c.color }}>¥{fmtMoney(c.value)}</div>
                      <div style={{ fontSize: 12, color: C.textLight, marginTop: 6 }}>{c.sub}</div>
                    </div>
                    <div style={{ width: 40, height: 40, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', background: c.bg, fontSize: 18, color: c.color }}>{c.icon}</div>
                  </div>
                </Card>
              </Col>
            ))}
          </Row>
          <Card title="每日现金流趋势" style={{ borderRadius: C.radius, border: 'none', boxShadow: C.cardShadow, marginBottom: 16 }} headStyle={{ borderBottom: `1px solid ${C.border}`, fontSize: 15, fontWeight: 600 }} bodyStyle={{ padding: '16px 12px' }}>
            {cashChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={isMobile ? 260 : 340}>
                <ComposedChart data={cashChartData}>
                  <defs>
                    <linearGradient id="cashCollected" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={C.success} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={C.success} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                  <XAxis dataKey="day" tick={{ fontSize: 12, fill: C.textLight }} tickFormatter={(v) => `${v}日`} />
                  <YAxis tick={{ fontSize: 12, fill: C.textLight }} />
                  <Tooltip contentStyle={{ borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 'var(--font-size-sm)', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }} formatter={(value, name) => { const l = { collected: '收款', purchase_expense: '进货', other_cost: '其他', net: '净额' }; return [`¥${fmtMoney(value)}`, l[name] || name]; }} labelFormatter={(v) => `${selectedMonth.format('YYYY年MM月')}${v}日`} />
                  <Legend formatter={(v) => { const l = { collected: '收款', purchase_expense: '进货支出', net: '净现金流' }; return l[v] || v; }} />
                  <Area type="monotone" dataKey="collected" stroke={C.success} fill="url(#cashCollected)" strokeWidth={2} />
                  <Line type="monotone" dataKey="net" stroke={cashColor} strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            ) : (
              <Empty description="本月暂无现金流数据" style={{ padding: 40 }} />
            )}
          </Card>
        </>
      )}

      {/* 每日利润明细 */}
      {activeTab === 'daily' && (
        <Card title="每日利润明细" style={{ borderRadius: C.radius, border: 'none', boxShadow: C.cardShadow, marginBottom: 16 }} headStyle={{ borderBottom: `1px solid ${C.border}`, fontSize: 15, fontWeight: 600 }} bodyStyle={{ padding: isMobile ? 12 : 0 }}>
          {isMobile ? (
            renderDailyMobile(dailyTrend.filter(d => d.revenue > 0 || d.other_cost > 0 || d.order_count > 0))
          ) : (
            <Table columns={dailyColumns} dataSource={dailyTrend.filter(d => d.revenue > 0 || d.other_cost > 0 || d.order_count > 0)} rowKey="day" size="small" loading={loading} pagination={false} scroll={{ x: TABLE_SCROLL_X.compact }} locale={{ emptyText: <Empty description="本月暂无数据" /> }} />
          )}
        </Card>
      )}

      {/* 订单利润明细 */}
      {activeTab === 'orders' && (
        <Card title={`订单利润明细（${orderProfits.length} 笔）`} style={{ borderRadius: C.radius, border: 'none', boxShadow: C.cardShadow, marginBottom: 16 }} headStyle={{ borderBottom: `1px solid ${C.border}`, fontSize: 15, fontWeight: 600 }} bodyStyle={{ padding: isMobile ? 12 : 0 }}>
          {isMobile ? (
            renderOrdersMobile(orderProfits)
          ) : (
            <Table columns={orderColumns} dataSource={orderProfits} rowKey="id" size="small" loading={loading} pagination={{ pageSize: 20, showSizeChanger: false }} scroll={{ x: TABLE_SCROLL_X.compact }} locale={{ emptyText: <Empty description="本月暂无订单" /> }} />
          )}
        </Card>
      )}

      {/* 退换/售后对账明细 */}
      {activeTab === 'orders' && (
        <Card title={`退换/售后对账明细（退换 ${ledger.returns.length} 单 · 售后 ${ledger.aftersales.length} 单）`} style={{ borderRadius: C.radius, border: 'none', boxShadow: C.cardShadow, marginBottom: 16 }} headStyle={{ borderBottom: `1px solid ${C.border}`, fontSize: 15, fontWeight: 600 }} bodyStyle={{ padding: isMobile ? 12 : 0 }}>
          <Table
            columns={ledgerReturnColumns} dataSource={ledger.returns} rowKey="id" size="small" loading={loading}
            pagination={false} scroll={{ x: TABLE_SCROLL_X.compact }} locale={{ emptyText: <Empty description="本月暂无退换单" /> }}
            expandable={{
              expandedRowRender: (r) => (
                <div style={{ fontSize: 12, color: C.textLight }}>
                  {r.items.map((it, i) => (
                    <div key={i} style={{ padding: '2px 0' }}>
                      {it.action === 'exchange_in'
                        ? `换出新品：${it.new_product_name || '-'}${it.new_spec ? ` / ${it.new_spec}` : ''} ×${it.quantity}，单价 ¥${fmtMoney(it.unit_price)}，成本 ¥${fmtMoney(it.cost_price)}`
                        : `${it.action === 'return_in' ? '退回入库' : '旧品退库'}：${it.product_name}${it.spec ? ` / ${it.spec}` : ''} ×${it.quantity}，单价 ¥${fmtMoney(it.unit_price)}，成本 ¥${fmtMoney(it.cost_price)}`}
                    </div>
                  ))}
                  {r.reason && <div style={{ padding: '2px 0' }}>原因：{r.reason}</div>}
                </div>
              ),
              rowExpandable: (r) => (r.items && r.items.length > 0) || !!r.reason,
            }}
          />
          <div style={{ padding: '12px 16px 4px', fontSize: 'var(--font-size-sm)', fontWeight: 600, color: C.textLight }}>售后工单</div>
          <Table
            columns={ledgerAftersalesColumns} dataSource={ledger.aftersales} rowKey="id" size="small" loading={loading}
            pagination={false} scroll={{ x: TABLE_SCROLL_X.compact }} locale={{ emptyText: <Empty description="本月暂无售后工单" /> }}
          />
        </Card>
      )}

      {/* 其他成本 + 结构饼图 */}
      {activeTab === 'costs' && (
        <>
          <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
            <Col xs={24} md={10}>
              <Card title="成本结构占比" style={{ borderRadius: C.radius, border: 'none', boxShadow: C.cardShadow, height: '100%' }} headStyle={{ borderBottom: `1px solid ${C.border}`, fontSize: 15, fontWeight: 600 }} bodyStyle={{ padding: '16px 12px' }}>
                {pieData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={isMobile ? 240 : 300}>
                    <PieChart>
                      <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={isMobile ? 90 : 110} label={(e) => `${e.name} ${e.value ? (e.value/ (costBreakdown.total||1) *100).toFixed(0) : 0}%`} labelLine={false}>
                        {pieData.map((d, i) => <Cell key={i} fill={d.color} />)}
                      </Pie>
                      <Tooltip formatter={(v) => `¥${fmtMoney(v)}`} />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <Empty description="本月暂无其他成本" style={{ padding: 40 }} />
                )}
              </Card>
            </Col>
            <Col xs={24} md={14}>
              <Card
                title={
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>其他成本管理</span>
                    <Button type="primary" icon={<PlusOutlined />} onClick={openAddCost} style={{ background: C.primary, border: 'none', borderRadius: 6 }}>添加成本</Button>
                  </div>
                }
                style={{ borderRadius: C.radius, border: 'none', boxShadow: C.cardShadow, height: '100%' }}
                headStyle={{ borderBottom: `1px solid ${C.border}`, fontSize: 15, fontWeight: 600 }}
                bodyStyle={{ padding: isMobile ? 12 : 0 }}
              >
                {isMobile ? (
                  renderCostsMobile(summary?.other_costs || [])
                ) : (
                  <Table
                    columns={costColumns}
                    dataSource={summary?.other_costs || []}
                    rowKey="id"
                    size="small"
                    loading={loading}
                    pagination={false}
                    scroll={{ x: TABLE_SCROLL_X.compact }}
                    locale={{ emptyText: <Empty description="暂无其他成本，点击右上角添加" /> }}
                    summary={(data) => {
                      if (!data || data.length === 0) return null;
                      const total = data.reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0);
                      return (
                        <Table.Summary fixed>
                          <Table.Summary.Row>
                            <Table.Summary.Cell index={0} colSpan={2}><span style={{ fontWeight: 600 }}>合计</span></Table.Summary.Cell>
                            <Table.Summary.Cell index={2} align="right"><span style={{ fontWeight: 700, color: C.danger, fontSize: 15 }}>¥{fmtMoney(total)}</span></Table.Summary.Cell>
                            <Table.Summary.Cell index={3} colSpan={2} />
                          </Table.Summary.Row>
                        </Table.Summary>
                      );
                    }}
                  />
                )}
              </Card>
            </Col>
          </Row>
        </>
      )}

      {/* 年度汇总 */}
      {activeTab === 'yearly' && yearly && (
        <>
          <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
            {[
              { title: '全年销售额', value: yearly.totals.revenue, icon: <DollarOutlined />, color: C.primary, bg: C.tintPrimary },
              { title: '全年利润', value: yearly.totals.profit, icon: <CrownOutlined />, color: yearly.totals.profit >= 0 ? C.success : C.danger, bg: yearly.totals.profit >= 0 ? C.tintSuccessBg : C.tintDangerBg },
              { title: '全年进货额', value: yearly.totals.purchase_expense, icon: <ImportOutlined />, color: C.info, bg: C.tintInfo },
              { title: '全年其他成本', value: yearly.totals.other_cost, icon: <WalletOutlined />, color: C.warning, bg: C.tintWarning },
            ].map((c, i) => (
              <Col xs={12} sm={12} md={6} key={i}>
                <Card style={{ borderRadius: C.radius, border: 'none', boxShadow: C.cardShadow, position: 'relative', overflow: 'hidden' }} bodyStyle={{ padding: '16px 20px' }}>
                  <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: c.color }} />
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <div style={{ fontSize: 'var(--font-size-sm)', color: C.textLight, marginBottom: 8 }}>{c.title}</div>
                      <div style={{ fontSize: isMobile ? 18 : 24, fontWeight: 700, color: c.color }}>¥{fmtMoney(c.value)}</div>
                    </div>
                    <div style={{ width: 40, height: 40, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', background: c.bg, fontSize: 18, color: c.color }}>{c.icon}</div>
                  </div>
                </Card>
              </Col>
            ))}
          </Row>
          <Card title={`${yearly.year} 年月度趋势`} style={{ borderRadius: C.radius, border: 'none', boxShadow: C.cardShadow, marginBottom: 16 }} headStyle={{ borderBottom: `1px solid ${C.border}`, fontSize: 15, fontWeight: 600 }} bodyStyle={{ padding: '16px 12px' }}>
            <ResponsiveContainer width="100%" height={isMobile ? 300 : 360}>
              <ComposedChart data={yearly.months}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                <XAxis dataKey="label" tick={{ fontSize: 12, fill: C.textLight }} />
                <YAxis tick={{ fontSize: 12, fill: C.textLight }} />
                <Tooltip contentStyle={{ borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 'var(--font-size-sm)', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }} formatter={(value, name) => { const l = { revenue: '销售额', profit: '利润', purchase_expense: '进货额' }; return [`¥${fmtMoney(value)}`, l[name] || name]; }} />
                <Legend formatter={(v) => { const l = { revenue: '销售额', profit: '利润', purchase_expense: '进货额' }; return l[v] || v; }} />
                <Bar dataKey="revenue" fill={C.primary} radius={[4, 4, 0, 0]} />
                <Bar dataKey="purchase_expense" fill={C.info} radius={[4, 4, 0, 0]} />
                <Line type="monotone" dataKey="profit" stroke={C.success} strokeWidth={2} dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </Card>
        </>
      )}

      {/* 应收账款 */}
      {activeTab === 'receivables' && receivables && (
        <>
          <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
            <Col xs={24} md={8}>
              <Card style={{ borderRadius: C.radius, border: 'none', boxShadow: C.cardShadow, position: 'relative', overflow: 'hidden' }} bodyStyle={{ padding: '16px 20px' }}>
                <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: C.danger }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontSize: 'var(--font-size-sm)', color: C.textLight, marginBottom: 8 }}>应收总额</div>
                    <div style={{ fontSize: isMobile ? 20 : 26, fontWeight: 700, color: C.danger }}>¥{fmtMoney(receivables.summary.total_receivable)}</div>
                    <div style={{ fontSize: 12, color: C.textLight, marginTop: 6 }}>{receivables.summary.count} 笔未结清</div>
                  </div>
                  <div style={{ width: 40, height: 40, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', background: C.tintDangerBg, fontSize: 18, color: C.danger }}><AccountBookOutlined /></div>
                </div>
              </Card>
            </Col>
            <Col xs={24} md={8}>
              <Card style={{ borderRadius: C.radius, border: 'none', boxShadow: C.cardShadow, position: 'relative', overflow: 'hidden' }} bodyStyle={{ padding: '16px 20px' }}>
                <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: C.danger }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontSize: 'var(--font-size-sm)', color: C.textLight, marginBottom: 8 }}>逾期金额（&gt;30天）</div>
                    <div style={{ fontSize: isMobile ? 20 : 26, fontWeight: 700, color: C.danger }}>¥{fmtMoney(receivables.summary.overdue_amount)}</div>
                    <div style={{ fontSize: 12, color: C.textLight, marginTop: 6 }}>{receivables.summary.overdue_count} 笔逾期</div>
                  </div>
                  <div style={{ width: 40, height: 40, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', background: C.tintDangerBg, fontSize: 18, color: C.danger }}><WarningOutlined /></div>
                </div>
              </Card>
            </Col>
            <Col xs={24} md={8}>
              <Card style={{ borderRadius: C.radius, border: 'none', boxShadow: C.cardShadow, position: 'relative', overflow: 'hidden' }} bodyStyle={{ padding: '16px 20px' }}>
                <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: C.success }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontSize: 'var(--font-size-sm)', color: C.textLight, marginBottom: 8 }}>正常未收</div>
                    <div style={{ fontSize: isMobile ? 20 : 26, fontWeight: 700, color: C.success }}>¥{fmtMoney(receivables.summary.total_receivable - receivables.summary.overdue_amount)}</div>
                    <div style={{ fontSize: 12, color: C.textLight, marginTop: 6 }}>未逾期部分</div>
                  </div>
                  <div style={{ width: 40, height: 40, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', background: C.tintSuccessBg, fontSize: 18, color: C.success }}><FundOutlined /></div>
                </div>
              </Card>
            </Col>
          </Row>
          <Card title={`应收账款明细（${receivables.list.length} 笔）`} style={{ borderRadius: C.radius, border: 'none', boxShadow: C.cardShadow, marginBottom: 16 }} headStyle={{ borderBottom: `1px solid ${C.border}`, fontSize: 15, fontWeight: 600 }} bodyStyle={{ padding: isMobile ? 12 : 0 }}>
            {isMobile ? (
              renderReceivablesMobile(receivables.list)
            ) : (
              <Table columns={receivableColumns} dataSource={receivables.list} rowKey="id" size="small" loading={loading} pagination={{ pageSize: 20, showSizeChanger: false }} scroll={{ x: TABLE_SCROLL_X.compact }} locale={{ emptyText: <Empty description="暂无应收账款" /> }} />
            )}
          </Card>
        </>
      )}

      {/* 添加/编辑其他成本弹窗 */}
      <Modal
        title={editingCost ? '编辑成本' : '添加成本'}
        open={costModalOpen}
        onOk={handleSaveCost}
        onCancel={() => { setCostModalOpen(false); setEditingCost(null); costForm.resetFields(); }}
        okText="保存"
        cancelText="取消"
        width={isMobile ? '90%' : 460}
        okButtonProps={{ style: { background: C.primary, border: 'none' } }}
      >
        <Form form={costForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="name" label="成本名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input placeholder="如：房租、工资、水电费" />
          </Form.Item>
          <Row gutter={[16, 16]}>
            <Col span={12}>
              <Form.Item name="amount" label="金额" rules={[{ required: true, message: '请输入金额' }]}>
                <InputNumber min={0} prefix="¥" style={{ width: '100%' }} placeholder="0.00" formatter={(v) => v ? v.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',') : ''} parser={(v) => v.replace(/¥\s?|(,*)/g, '')} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="category" label="类别">
                <Select>
                  {Object.entries(costCategoryMap).map(([key, val]) => (
                    <Select.Option key={key} value={key}>{val.label}</Select.Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="note" label="备注">
            <Input.TextArea rows={2} placeholder="可选" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
