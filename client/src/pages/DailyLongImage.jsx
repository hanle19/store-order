import { forwardRef } from 'react';
import dayjs from 'dayjs';
import { formatMoneyInt } from '../utils/format';

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

// 长图渲染：品牌化重设计（暖棕主色 / 克制高级配色）
// forwardRef 暴露根节点，供父组件用 html-to-image 截图
const DailyLongImage = forwardRef(({ data }, ref) => {
  if (!data) return null;

  const {
    store_name, salesperson_name, report_date, report,
    customers = [],
    summary = {},
  } = data;

  // === 品牌色板（与系统 --color-primary: #A88C78 一致）===
  const BROWN = '#A88C78';        // 主色
  const BROWN_DARK = '#8A7058';   // 头部渐变深端
  const INK = '#4A3B2E';          // 主文字 / 数字
  const INK_SOFT = '#6B5B4B';    // 次级文字
  const MUTE = '#9C8E80';         // 辅助文字 / 标签
  const LINE = '#ECE5DC';          // 暖色细线
  const TINT = '#F6F1EA';         // 浅棕底（标签/卡片底）
  const PAGE = '#FBF9F6';          // 页面暖白底
  const SAGE_BG = '#EDF3E8';      // 成交 pill 底
  const SAGE_TX = '#6B8E4E';      // 成交 pill 字
  const NEU_BG = '#F2EEE9';       // 未成交 pill 底
  const NEU_TX = '#9C8E80';       // 未成交 pill 字
  const PLAN_BG = '#F1F5F0';      // 明日计划底（极淡 sage）
  const PLAN_ACC = '#8AA678';      // 明日计划点缀

  // 格式化日期 "2026-07-21 星期六"
  const fmtDate = () => {
    if (!report_date) return '';
    const d = dayjs(report_date);
    return `${d.format('YYYY-MM-DD')} 星期${WEEKDAYS[d.day()]}`;
  };

  const getVal = (key) => (report ? (report[key] ?? '') : '');
  const sourceLabel = (s) => s || '未填';

  // 今日汇总指标（5 项）
  const metrics = [
    { key: 'reception_count', label: '接待组数', value: summary.reception_count || 0 },
    { key: 'deal_count', label: '成交单数', value: summary.deal_count || 0 },
    { key: 'deal_amount', label: '成交金额', value: summary.deal_amount || 0, prefix: '¥', accent: true },
    { key: 'phone_count', label: '留电话数', value: summary.phone_count || 0 },
    { key: 'wechat_count', label: '加微信数', value: summary.wechat_count || 0 },
  ];
  const fmtNum = (m) => {
    const v = typeof m.value === 'number' ? m.value : 0;
    return m.prefix ? `${m.prefix}${v.toLocaleString()}` : v.toLocaleString();
  };

  // 章节标题：细线点缀 + 粗体，替代原来的彩色药丸
  const SectionTitle = ({ text, accent = BROWN }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ width: 8, height: 16, borderRadius: 2, background: accent, display: 'inline-block' }} />
      <span style={{ fontSize: 16, fontWeight: 700, color: INK, letterSpacing: 1 }}>{text}</span>
    </div>
  );

  // 浅棕小标签
  const Tag = ({ children }) => (
    <span style={{
      color: BROWN, background: TINT, padding: '2px 9px', borderRadius: 6,
      fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap',
    }}>{children}</span>
  );

  return (
    <div ref={ref} style={{
      width: 720, background: PAGE, color: INK,
      fontFamily: "'PingFang SC','Microsoft YaHei','Helvetica Neue',sans-serif",
      boxSizing: 'border-box', padding: 0,
    }}>

      {/* ========== 头部 ========== */}
      <div style={{
        background: `linear-gradient(135deg, ${BROWN} 0%, ${BROWN_DARK} 100%)`,
        color: '#fff', padding: '32px 32px 26px', textAlign: 'center',
      }}>
        <div style={{ fontSize: 27, fontWeight: 700, letterSpacing: 6 }}>{store_name || '我的门店'}</div>
        <div style={{ fontSize: 14, marginTop: 9, opacity: 0.92, letterSpacing: 3 }}>每日销售日报</div>
        <div style={{ fontSize: 'var(--font-size-sm)', marginTop: 13, opacity: 0.85, fontWeight: 400 }}>
          {fmtDate()}　｜　{salesperson_name}
        </div>
      </div>

      {/* ========== 今日汇总 ========== */}
      <div style={{ padding: '22px 24px 6px' }}>
        <SectionTitle text="今日汇总" />
        <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          {metrics.slice(0, 3).map((m, i) => (
            <div key={i} style={{
              background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12,
              padding: '16px 10px', textAlign: 'center',
            }}>
              <div style={{
                fontSize: 25, fontWeight: 800, color: INK, lineHeight: 1.15,
                fontVariantNumeric: 'tabular-nums',
              }}>{fmtNum(m)}</div>
              <div style={{ fontSize: 12.5, color: MUTE, marginTop: 7, letterSpacing: 1 }}>{m.label}</div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
          {metrics.slice(3).map((m, i) => (
            <div key={i} style={{
              background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12,
              padding: '16px 10px', textAlign: 'center',
            }}>
              <div style={{
                fontSize: m.accent ? 26 : 25, fontWeight: 800,
                color: m.accent ? BROWN : INK, lineHeight: 1.15,
                fontVariantNumeric: 'tabular-nums',
              }}>{fmtNum(m)}</div>
              <div style={{ fontSize: 12.5, color: MUTE, marginTop: 7, letterSpacing: 1 }}>{m.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ========== 客户明细 ========== */}
      <div style={{ padding: '14px 24px 6px' }}>
        <SectionTitle text={`客户明细（${customers.length} 组）`} />
        {customers.length === 0 ? (
          <div style={{ color: MUTE, fontSize: 14, padding: '14px 2px' }}>今日无客资记录</div>
        ) : (
          <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {customers.map((c, idx) => (
              <div key={c.id} style={{
                background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12,
                padding: '14px 16px',
              }}>
                {/* 序号 + 客户情况（首行，不再换行割裂） */}
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <div style={{
                    flex: '0 0 auto', width: 24, height: 24, borderRadius: '50%',
                    background: BROWN, color: '#fff', fontSize: 'var(--font-size-sm)', fontWeight: 700,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 1,
                  }}>{idx + 1}</div>
                  <div style={{ flex: 1, fontSize: 15, fontWeight: 600, color: INK, lineHeight: 1.6 }}>
                    {c.customer_desc || '（无描述）'}
                  </div>
                </div>
                {/* 客户名称 · 来源 · 意向（统一缩进对齐） */}
                <div style={{ marginTop: 8, paddingLeft: 34, fontSize: 'var(--font-size-sm)', color: INK_SOFT, lineHeight: 1.8 }}>
                  {c.customer_name && <span style={{ fontWeight: 500, color: INK }}>{c.customer_name}</span>}
                  <span style={{ marginLeft: c.customer_name ? 8 : 0 }}><Tag>【{sourceLabel(c.source)}】</Tag></span>
                  {c.intention_product && <span style={{ marginLeft: 8 }}>意向：{c.intention_product}</span>}
                </div>
                {/* 联系方式 + 成交状态（流式排布，自动换行不割裂） */}
                <div style={{ marginTop: 8, paddingLeft: 34, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 10px', fontSize: 'var(--font-size-sm)' }}>
                  {c.phone && <span style={{ color: INK_SOFT }}>电话 {c.phone}</span>}
                  {c.is_wechat === 1 && <Tag>微信</Tag>}
                  {c.is_douyin_comment === 1 && <Tag>抖音</Tag>}
                  <span style={{
                    marginLeft: 'auto', fontWeight: 600,
                    color: c.is_deal === 1 ? SAGE_TX : NEU_TX,
                    background: c.is_deal === 1 ? SAGE_BG : NEU_BG,
                    padding: '3px 11px', borderRadius: 6, fontSize: 12.5, whiteSpace: 'nowrap',
                  }}>
                    {c.is_deal === 1
                      ? `已成交 ${formatMoneyInt(c.deal_amount)}`
                      : (c.not_deal_reason ? `未成交 · ${c.not_deal_reason}` : '未成交')}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ========== 今日工作问题 ========== */}
      <div style={{ padding: '14px 24px 6px' }}>
        <SectionTitle text="今日工作问题" />
        <div style={{
          marginTop: 12, background: '#F8F3ED', borderRadius: 12,
          padding: '13px 16px', fontSize: 14, lineHeight: 1.8, color: INK, whiteSpace: 'pre-wrap',
          border: `1px solid ${LINE}`,
        }}>
          {getVal('work_issue') || '—'}
        </div>
      </div>

      {/* ========== 明日工作计划 ========== */}
      <div style={{ padding: '14px 24px 6px' }}>
        <SectionTitle text="明日工作计划" accent={PLAN_ACC} />
        <div style={{
          marginTop: 12, background: PLAN_BG, borderRadius: 12,
          padding: '13px 16px', fontSize: 14, lineHeight: 1.8, color: INK, whiteSpace: 'pre-wrap',
          border: `1px solid ${LINE}`,
        }}>
          {getVal('tomorrow_plan') || '—'}
        </div>
      </div>

      {/* ========== 页脚 ========== */}
      <div style={{
        padding: '18px 32px 20px', textAlign: 'center', fontSize: 12, color: MUTE,
        borderTop: `1px solid ${LINE}`, marginTop: 18,
      }}>
        生成时间：{dayjs().format('YYYY-MM-DD HH:mm')}　·　由门店系统生成
      </div>
    </div>
  );
});

DailyLongImage.displayName = 'DailyLongImage';
export default DailyLongImage;
