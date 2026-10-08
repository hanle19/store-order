import React from 'react';
import { Skeleton } from 'antd';

/**
 * 页面级骨架屏。用于路由懒加载占位（App.jsx 的 Suspense fallback），
 * 比单纯的"加载中…"文字更贴近真实布局，减少内容跳动。
 */
export default function PageSkeleton({ cards = 4 }) {
  return (
    <div className="app-page-skeleton">
      <Skeleton.Input active style={{ width: 200, height: 26 }} className="app-page-skeleton__title" />
      <div className="app-page-skeleton__grid">
        {Array.from({ length: cards }).map((_, i) => (
          <div className="app-page-skeleton__card" key={i}>
            <Skeleton active paragraph={{ rows: 2 }} title={false} />
          </div>
        ))}
      </div>
      <div className="app-page-skeleton__card">
        <Skeleton active paragraph={{ rows: 6 }} />
      </div>
    </div>
  );
}
