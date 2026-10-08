import React from 'react';
import { InboxOutlined } from '@ant-design/icons';

/**
 * 业务化空状态。统一替代散落的 <Empty> 与各页自绘空态。
 * - icon：可传任意图标；默认 InboxOutlined
 * - title/description：语义化文案
 * - action：可放置"新建/刷新"等引导按钮
 */
export default function EmptyState({ icon, title = '暂无数据', description, action }) {
  return (
    <div className="app-empty-state">
      <div className="app-empty-state__icon">{icon || <InboxOutlined />}</div>
      <div className="app-empty-state__title">{title}</div>
      {description && <div className="app-empty-state__desc">{description}</div>}
      {action && <div className="app-empty-state__action">{action}</div>}
    </div>
  );
}
