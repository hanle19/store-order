import { useEffect, useRef } from 'react';

// 喜庆红金调色板
const COLORS = [
  '#FFD700', '#FFC400', '#FFB300', // 金 / 暖金
  '#E60012', '#C8102E', '#B22222', // 中国红 / 深红
  '#FFE08A', '#FFFFFF',            // 浅金 / 白（点缀）
];

const CONFETTI_EVENT = 'confetti:fire';

// 任意页面一行即可触发：fireConfetti()
export function fireConfetti() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CONFETTI_EVENT));
}

// 全局礼花特效：零依赖 Canvas 粒子，监听 window 事件触发，自动清理
export default function Confetti() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const resize = () => {
      canvas.width = Math.floor(window.innerWidth * dpr);
      canvas.height = Math.floor(window.innerHeight * dpr);
      canvas.style.width = window.innerWidth + 'px';
      canvas.style.height = window.innerHeight + 'px';
    };
    resize();
    window.addEventListener('resize', resize);

    // 无障碍：系统开启「减少动态效果」时跳过特效
    const prefersReduced =
      window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let particles = [];
    let raf = null;
    let running = false;

    const launch = () => {
      if (prefersReduced) return;
      const W = canvas.width;
      const H = canvas.height;
      // 发射源：左下、右下礼炮（接近垂直向上大范围喷射，覆盖上半屏及中央）、顶部中央（向下洒落覆盖中下）
      const sources = [
        { x: W * 0.08, y: H * 0.98, angle: -Math.PI / 2.3, spread: 1.0 },
        { x: W * 0.92, y: H * 0.98, angle: -Math.PI * (1 - 1 / 2.3), spread: 1.0 },
        { x: W * 0.5, y: H * 0.05, angle: Math.PI / 2, spread: 1.7 },
      ];
      const per = 110;
      sources.forEach((s) => {
        for (let i = 0; i < per; i++) {
          const a = s.angle + (Math.random() - 0.5) * s.spread;
          const speed = (15 + Math.random() * 15) * dpr;
          particles.push({
            x: s.x,
            y: s.y,
            vx: Math.cos(a) * speed,
            vy: Math.sin(a) * speed,
            size: (8 + Math.random() * 8) * dpr,
            color: COLORS[(Math.random() * COLORS.length) | 0],
            rot: Math.random() * Math.PI * 2,
            vr: (Math.random() - 0.5) * 0.3,
            life: 1,
            decay: 0.004 + Math.random() * 0.004,
            shape: Math.random() > 0.4 ? 'rect' : 'circle',
          });
        }
      });
      if (!running) {
        running = true;
        loop();
      }
    };

    const loop = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const gravity = 0.22 * dpr;
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.vy += gravity;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr;
        p.life -= p.decay;
        if (p.life <= 0 || p.y > canvas.height + 40) {
          particles.splice(i, 1);
          continue;
        }
        ctx.save();
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        if (p.shape === 'rect') {
          ctx.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.66);
        } else {
          ctx.beginPath();
          ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
      if (particles.length > 0) {
        raf = requestAnimationFrame(loop);
      } else {
        running = false;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    };

    const onFire = () => launch();
    window.addEventListener(CONFETTI_EVENT, onFire);

    return () => {
      window.removeEventListener(CONFETTI_EVENT, onFire);
      window.removeEventListener('resize', resize);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 9999,
      }}
    />
  );
}
