import React from 'react';

/**
 * 统一筛选工具条容器。替代原先 orders/products/purchases/inventory 各不相同的筛选卡，
 * 视觉与间距基线统一（见 ui.css .app-filter-bar）。内部筛选控件（Input/Select/Button…）
 * 由各页面自行放置，本组件只负责外壳，避免改动任何筛选逻辑。
 */
export default function FilterBar({ children, className = '', style, ...rest }) {
  return (
    <div className={`app-filter-bar ${className}`} style={style} {...rest}>
      {children}
    </div>
  );
}
