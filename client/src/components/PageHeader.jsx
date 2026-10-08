import React from 'react';

/**
 * 统一桌面端页面标题栏（规范展示页标准件）
 * - 标题 20px / 600，副标题 13px 弱色
 * - 操作区（extra）与标题基线对齐、右对齐、可换行
 * - 统一 margin-bottom 20px，与下方内容/工具条形成稳定纵向节奏
 * - 通过 CSS 变量与 .page-header 类统一，禁止在各页面手写不同标题样式
 */
export default function PageHeader({ title, subtitle, icon, extra, footer, className = '' }) {
  return (
    <div className={`page-header ${className}`}>
      <div className="page-header__main">
        {icon && <span className="page-header__icon">{icon}</span>}
        <div className="page-header__titles">
          <h2 className="page-header__title">{title}</h2>
          {subtitle && <div className="page-header__subtitle">{subtitle}</div>}
        </div>
      </div>
      {extra && <div className="page-header__extra">{extra}</div>}
      {footer && <div className="page-header__footer">{footer}</div>}
    </div>
  );
}
