'use client';

import React, { useMemo, useState } from 'react';
import type { ProgressMetric } from '@/lib/progressApi';

const CARD =
  'rounded-[14px] border-[0.5px] border-[var(--glass-border)] shadow-[var(--glass-shadow)] bg-[var(--glass-bg)] dark:bg-[#16221e]';

const COLORS = ['#c8602a', '#6a8f6b', '#8a6dbf', '#3f8fc4', '#c4573f'];

interface Props {
  metrics: ProgressMetric[];
  /** Called with the currently visible metricType when the user switches tabs. */
  onMetricTypeChange?: (metricType: string) => void;
}

function formatLabel(metricType: string) {
  return metricType
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export default function ProgressChart({ metrics, onMetricTypeChange }: Props) {
  const metricTypes = useMemo(
    () => Array.from(new Set(metrics.map((m) => m.metricType))),
    [metrics]
  );
  const [active, setActive] = useState<string>(metricTypes[0] || '');

  const series = useMemo(
    () =>
      metrics
        .filter((m) => m.metricType === (active || metricTypes[0]))
        .sort((a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime()),
    [metrics, active, metricTypes]
  );

  if (metrics.length === 0) {
    return (
      <div className={`${CARD} flex flex-col items-center justify-center gap-2 p-10 text-center`}>
        <div className="text-4xl">📈</div>
        <p className="font-heading text-lg" style={{ color: 'var(--ink)' }}>
          No progress data yet
        </p>
        <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>
          Metrics you log for this client will appear here as a chart.
        </p>
      </div>
    );
  }

  const width = 640;
  const height = 260;
  const padding = { top: 20, right: 20, bottom: 30, left: 40 };
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;

  const values = series.map((s) => s.value);
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const range = maxV - minV || 1;

  const points = series.map((s, i) => {
    const x = padding.left + (innerW * i) / Math.max(series.length - 1, 1);
    const y = padding.top + innerH - ((s.value - minV) / range) * innerH;
    return { x, y, value: s.value, date: s.recordedAt };
  });

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  const color = COLORS[metricTypes.indexOf(active || metricTypes[0]) % COLORS.length];

  return (
    <div className={`${CARD} p-6`}>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h3 className="font-heading text-lg" style={{ color: 'var(--ink)' }}>
          Progress Over Time
        </h3>
        <div className="flex gap-1.5 flex-wrap">
          {metricTypes.map((mt) => (
            <button
              key={mt}
              onClick={() => {
                setActive(mt);
                onMetricTypeChange?.(mt);
              }}
              className="rounded-full px-3 py-1 text-xs font-semibold transition-colors"
              style={{
                background: mt === (active || metricTypes[0]) ? 'var(--c-accent)' : 'var(--c-accent-bg)',
                color: mt === (active || metricTypes[0]) ? '#fff' : 'var(--c-accent)',
              }}
            >
              {formatLabel(mt)}
            </button>
          ))}
        </div>
      </div>

      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto" role="img" aria-label="Progress chart">
        {/* Horizontal gridlines */}
        {[0, 0.25, 0.5, 0.75, 1].map((f) => {
          const y = padding.top + innerH * f;
          const val = (maxV - range * f).toFixed(1);
          return (
            <g key={f}>
              <line
                x1={padding.left}
                x2={width - padding.right}
                y1={y}
                y2={y}
                stroke="var(--glass-border)"
                strokeWidth={1}
              />
              <text x={padding.left - 8} y={y + 3} textAnchor="end" fontSize="10" fill="var(--ink-muted)">
                {val}
              </text>
            </g>
          );
        })}

        {/* Line */}
        <path d={pathD} fill="none" stroke={color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />

        {/* Points */}
        {points.map((p, i) => (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r={4} fill={color} stroke="var(--glass-bg)" strokeWidth={1.5} />
            <title>
              {new Date(p.date).toLocaleDateString()}: {p.value}
            </title>
          </g>
        ))}

        {/* X-axis date labels (first, middle, last) */}
        {[0, Math.floor((points.length - 1) / 2), points.length - 1]
          .filter((v, i, arr) => arr.indexOf(v) === i)
          .map((idx) => {
            const p = points[idx];
            if (!p) return null;
            return (
              <text
                key={idx}
                x={p.x}
                y={height - padding.bottom + 16}
                textAnchor="middle"
                fontSize="10"
                fill="var(--ink-muted)"
              >
                {new Date(p.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
              </text>
            );
          })}
      </svg>
    </div>
  );
}
