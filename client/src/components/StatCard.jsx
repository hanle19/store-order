import React from 'react';
import { Skeleton } from 'antd';
import AnimatedNumber from './AnimatedNumber';

/**
 * 工作台数据指标卡（图2风格）。
 * - 左侧图标圆圈
 * - 右上趋势角标
 * - 主数字 + 单位横向排列
 * - 下方辅助说明
 */
export default function StatCard({
  title, value, raw, format, prefix, suffix, sub, icon, color = 'var(--color-primary)',
  trend, loading, style, hero,
}) {
  const useAnim = typeof raw === 'number';
  const cls = `stat-card${hero ? ' stat-card--hero' : ''}`;
  if (loading) {
    return (
      <div className={cls} style={style}>
        <Skeleton active paragraph={{ rows: 2 }} title={false} />
      </div>
    );
  }
  return (
    <div className={cls} style={style}>
      <div className="stat-card__inner">
        <span className="stat-card__icon" style={{ color, background: `${color}1A` }}>{icon}</span>
        <div className="stat-card__body">
          <div className="stat-card__top">
            <span className="stat-card__title">{title}</span>
            {trend && <span className="stat-card__trend">{trend}</span>}
          </div>
          <div className="stat-card__value" style={{ color }}>
            {useAnim
              ? <AnimatedNumber value={raw} format={format} prefix={prefix} suffix={suffix} />
              : (<>
                  {prefix && <span className="stat-card__prefix">{prefix}</span>}
                  {value}
                  {suffix && <span className="stat-card__suffix">{suffix}</span>}
                </>)}
          </div>
          {sub && <div className="stat-card__sub">{sub}</div>}
        </div>
      </div>
    </div>
  );
}
