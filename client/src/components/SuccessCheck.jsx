import React from 'react';

// 送达/签收成功动画：描边圆环 + 对勾（stroke-dashoffset 动画）。
// 纯 SVG + CSS，主题跟随 IDE 主题（暗色浅色均按主题变量着色）。
export default function SuccessCheck({ size = 72 }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '12px 0' }}>
      <svg className="success-check" viewBox="0 0 52 52" width={size} height={size} role="img" aria-label="签收成功">
        <circle className="success-check__circle" cx="26" cy="26" r="23" fill="none" />
        <path className="success-check__tick" d="M15 27 L23 35 L38 17" fill="none" />
      </svg>
      <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-success)' }}>已签收</div>
    </div>
  );
}
