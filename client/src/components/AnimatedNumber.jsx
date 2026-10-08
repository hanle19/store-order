import React, { useEffect, useRef, useState } from 'react';

// 数字滚动动画：从旧值平滑滚动到目标值（easeOutCubic）。
// - 自动跳过 prefers-reduced-motion（无障碍）
// - value 非数字时直接显示原值（兼容已格式化字符串）
// - format(value) 用于把中间帧数值格式化为展示文案（如千分位 / 货币）
export default function AnimatedNumber({ value, format, prefix, suffix, duration = 900 }) {
  const isNum = typeof value === 'number';
  const [display, setDisplay] = useState(isNum ? value : 0);
  const prevRef = useRef(isNum ? value : 0);

  useEffect(() => {
    if (!isNum) return;
    const prefersReduced =
      window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const from = prevRef.current;
    const to = value;
    if (prefersReduced || from === to) {
      setDisplay(to);
      prevRef.current = to;
      return;
    }
    let raf;
    const start = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(from + (to - from) * eased);
      if (t < 1) raf = requestAnimationFrame(step);
      else prevRef.current = to;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, duration, isNum]);

  const text = isNum ? (format ? format(display) : Math.round(display).toString()) : value;
  return (
    <span>
      {prefix && <span className="stat-card__prefix">{prefix}</span>}
      {text}
      {suffix && <span className="stat-card__suffix">{suffix}</span>}
    </span>
  );
}
