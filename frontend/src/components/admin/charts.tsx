'use client';

// Single-series charts for the admin portal (Chart.js). One series per chart:
// the title names it, so there is no legend box. Colors come from the
// --viz-series / --viz-grid tokens (validated for both themes) and are re-read
// when the theme changes. Every chart has a "Table" toggle with the same data.

import React, { useEffect, useMemo, useState } from 'react';
import {
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Filler,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
  type ChartOptions,
} from 'chart.js';
import { Bar, Line } from 'react-chartjs-2';
import { useTheme } from '@/components/ThemeProvider';
import { CARD, cx } from '@/components/admin/kit';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Filler, Tooltip);

export interface Point {
  label: string;
  value: number;
}

function useVizColors() {
  const { theme } = useTheme();
  const [c, setC] = useState({ series: '#B8662A', grid: 'rgba(44,31,14,0.08)', text: '#8B7355', surface: '#FCF8F1' });
  useEffect(() => {
    // Read after the theme class has been applied to <html>.
    const id = requestAnimationFrame(() => {
      const css = getComputedStyle(document.documentElement);
      const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
      setC({
        series: v('--viz-series', '#B8662A'),
        grid: v('--viz-grid', 'rgba(44,31,14,0.08)'),
        text: v('--ink-muted', '#8B7355'),
        surface: theme === 'dark' ? '#1A2824' : '#FCF8F1',
      });
    });
    return () => cancelAnimationFrame(id);
  }, [theme]);
  return c;
}

const compact = (n: number) =>
  Math.abs(n) >= 1000 ? new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 }).format(n) : String(n);

export function ChartCard({
  title,
  subtitle,
  data,
  kind = 'line',
  format = (n) => n.toLocaleString('en-IN'),
  height = 220,
  horizontal,
}: {
  title: string;
  subtitle?: string;
  data: Point[];
  kind?: 'line' | 'bar';
  format?: (n: number) => string;
  height?: number;
  /** Horizontal bars (category comparisons with long labels). */
  horizontal?: boolean;
}) {
  const [asTable, setAsTable] = useState(false);
  const colors = useVizColors();
  const total = data.reduce((s, p) => s + p.value, 0);

  const options = useMemo<ChartOptions<'line' | 'bar'>>(() => {
    const valueAxis = {
      beginAtZero: true,
      border: { display: false },
      grid: { color: colors.grid, lineWidth: 1 },
      ticks: { color: colors.text, font: { size: 11 }, maxTicksLimit: 5, callback: (v: any) => compact(Number(v)) },
    };
    const categoryAxis = {
      border: { display: false },
      grid: { display: false },
      ticks: { color: colors.text, font: { size: 11 }, maxRotation: 0, autoSkip: true, maxTicksLimit: horizontal ? 20 : 8 },
    };
    return {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: horizontal ? 'y' : 'x',
      animation: { duration: 250 },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          displayColors: false,
          padding: 10,
          callbacks: { label: (ctx: any) => format(Number(horizontal ? ctx.parsed.x : ctx.parsed.y)) },
        },
      },
      scales: horizontal ? { x: valueAxis, y: categoryAxis } : { x: categoryAxis, y: valueAxis },
    } as ChartOptions<'line' | 'bar'>;
  }, [colors, format, horizontal]);

  const chartData = {
    labels: data.map((d) => d.label),
    datasets: [
      kind === 'line'
        ? {
            data: data.map((d) => d.value),
            borderColor: colors.series,
            backgroundColor: hexToRgba(colors.series, 0.1),
            fill: true,
            borderWidth: 2,
            tension: 0.25,
            pointRadius: data.length <= 1 ? 4 : 0,
            pointHoverRadius: 5,
            pointBackgroundColor: colors.series,
            pointBorderColor: colors.surface,
            pointBorderWidth: 2,
          }
        : {
            data: data.map((d) => d.value),
            backgroundColor: colors.series,
            hoverBackgroundColor: colors.series,
            borderRadius: 4,
            borderSkipped: 'start' as const,
            maxBarThickness: 24,
          },
    ],
  };

  return (
    <div className={cx(CARD, 'p-4')}>
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>{title}</h3>
          {subtitle && <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>{subtitle}</p>}
        </div>
        <button onClick={() => setAsTable((t) => !t)} className="rounded-lg px-2 py-1 text-xs font-semibold" style={{ color: 'var(--ink-muted)', border: '1px solid var(--glass-border)' }} aria-pressed={asTable}>
          {asTable ? 'Chart' : 'Table'}
        </button>
      </div>
      {data.length === 0 || (total === 0 && !asTable) ? (
        <div className="flex items-center justify-center text-sm" style={{ height, color: 'var(--ink-muted)' }}>No data for this period.</div>
      ) : asTable ? (
        <div className="overflow-y-auto" style={{ maxHeight: height }}>
          <table className="w-full text-sm">
            <tbody>
              {data.map((d) => (
                <tr key={d.label} style={{ borderBottom: '1px solid var(--glass-border)' }}>
                  <td className="py-1.5" style={{ color: 'var(--ink-muted)' }}>{d.label}</td>
                  <td className="py-1.5 text-right font-semibold" style={{ color: 'var(--ink)' }}>{format(d.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ height }} role="img" aria-label={`${title}: ${data.map((d) => `${d.label} ${format(d.value)}`).join(', ')}`}>
          {kind === 'line' ? <Line data={chartData as any} options={options as any} /> : <Bar data={chartData as any} options={options as any} />}
        </div>
      )}
    </div>
  );
}

function hexToRgba(hex: string, alpha: number) {
  const m = hex.replace('#', '').match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return hex;
  return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${alpha})`;
}
