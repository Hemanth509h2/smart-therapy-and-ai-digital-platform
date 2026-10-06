'use client';

import React, { useState } from 'react';
import type { ProgressMetric, ProgressReport, ProgressNote } from '@/lib/progressApi';

const CARD =
  'rounded-[14px] border-[0.5px] border-[var(--glass-border)] shadow-[var(--glass-shadow)] bg-[var(--glass-bg)] dark:bg-[#16221e]';

interface Props {
  clientName: string;
  metrics: ProgressMetric[];
  reports: ProgressReport[];
  notes: ProgressNote[];
}

// Defensive field access — adjust if your ProgressNote model uses different names
const noteText = (n: any) => n.content ?? n.note ?? n.text ?? '';
const noteDate = (n: any) => n.createdAt ?? n.recordedAt ?? n.date;
const noteAuthor = (n: any) => n.authorName ?? n.therapistName ?? '';

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function ExportProgressReport({ clientName, metrics, reports, notes }: Props) {
  const [exporting, setExporting] = useState<'csv' | 'pdf' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const esc = (c: string) => `"${String(c).replace(/"/g, '""')}"`;

  const handleCsvExport = () => {
    setExporting('csv');
    setError(null);
    try {
      const lines: string[] = [];

      lines.push('METRICS');
      lines.push(['Date', 'Metric Type', 'Value', 'Unit', 'Notes'].map(esc).join(','));
      metrics.forEach((m) => {
        lines.push(
          [
            new Date(m.recordedAt).toISOString(),
            m.metricType,
            String(m.value),
            m.unit || '',
            (m.notes || '').replace(/[\r\n,]+/g, ' '),
          ]
            .map(esc)
            .join(',')
        );
      });

      lines.push('');
      lines.push('THERAPIST NOTES');
      lines.push(['Date', 'Author', 'Note'].map(esc).join(','));
      notes.forEach((n) => {
        lines.push(
          [
            noteDate(n) ? new Date(noteDate(n)).toISOString() : '',
            noteAuthor(n),
            noteText(n).replace(/[\r\n]+/g, ' '),
          ]
            .map(esc)
            .join(',')
        );
      });

      downloadBlob(
        `${clientName.replace(/\s+/g, '_')}_progress.csv`,
        new Blob([lines.join('\n')], { type: 'text/csv' })
      );
    } catch (e: any) {
      console.error('CSV export failed:', e);
      setError(e.message || 'CSV export failed');
    } finally {
      setExporting(null);
    }
  };

  const handlePdfExport = async () => {
    setExporting('pdf');
    setError(null);
    try {
      // Loaded dynamically so it's only pulled into the client bundle when used.
      const { default: jsPDF } = await import('jspdf');
      const { default: autoTable } = await import('jspdf-autotable');

      const doc = new jsPDF();
      doc.setFontSize(16);
      doc.text(`Progress Report — ${clientName}`, 14, 18);
      doc.setFontSize(10);
      doc.text(`Generated ${new Date().toLocaleDateString()}`, 14, 25);

      let cursorY = 34;

      reports.forEach((r) => {
        doc.setFontSize(12);
        doc.text(`${r.title} (${r.status})`, 14, cursorY);
        cursorY += 6;
        doc.setFontSize(9);
        const period = `${new Date(r.periodStart).toLocaleDateString()} – ${new Date(
          r.periodEnd
        ).toLocaleDateString()}`;
        doc.text(period, 14, cursorY);
        cursorY += 6;
        const summaryLines = doc.splitTextToSize(r.summary, 180);
        doc.text(summaryLines, 14, cursorY);
        cursorY += summaryLines.length * 5 + 6;
      });

      // Metrics table (v5 syntax: autoTable(doc, options), not doc.autoTable(options))
      autoTable(doc, {
        startY: cursorY,
        head: [['Date', 'Metric', 'Value', 'Unit', 'Notes']],
        body: metrics.map((m) => [
          new Date(m.recordedAt).toLocaleDateString(),
          m.metricType,
          String(m.value),
          m.unit || '-',
          m.notes || '-',
        ]),
        styles: { fontSize: 8 },
        headStyles: { fillColor: [200, 96, 42] },
      });

      // Therapist notes table, positioned below whatever the metrics table ended at
      if (notes.length > 0) {
        const afterMetrics = (doc as any).lastAutoTable?.finalY ?? cursorY;
        doc.setFontSize(12);
        doc.text('Therapist Notes', 14, afterMetrics + 12);

        autoTable(doc, {
          startY: afterMetrics + 16,
          head: [['Date', 'Author', 'Note']],
          body: notes.map((n) => [
            noteDate(n) ? new Date(noteDate(n)).toLocaleDateString() : '-',
            noteAuthor(n) || '-',
            noteText(n) || '-',
          ]),
          styles: { fontSize: 8, cellWidth: 'wrap' },
          columnStyles: { 2: { cellWidth: 110 } },
          headStyles: { fillColor: [200, 96, 42] },
        });
      }

      doc.save(`${clientName.replace(/\s+/g, '_')}_progress_report.pdf`);
    } catch (e: any) {
      console.error('PDF export failed:', e);
      setError(e.message || 'PDF export failed');
    } finally {
      setExporting(null);
    }
  };

  const nothingToExport = metrics.length === 0 && reports.length === 0 && notes.length === 0;

  return (
    <div className={`${CARD} p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4`}>
      <div>
        <h3 className="font-heading text-lg" style={{ color: 'var(--ink)' }}>
          Export Report
        </h3>
        <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>
          Download this client's metrics, notes, and reports to share or archive.
        </p>
        {error && <p className="text-sm mt-2 text-red-600">{error}</p>}
      </div>
      <div className="flex gap-2">
        <button
          onClick={handleCsvExport}
          disabled={exporting !== null || (metrics.length === 0 && notes.length === 0)}
          className="rounded-full px-4 py-2 text-xs font-semibold disabled:opacity-50"
          style={{ background: 'var(--c-accent-bg)', color: 'var(--c-accent)' }}
        >
          {exporting === 'csv' ? 'Exporting…' : 'Download CSV'}
        </button>
        <button
          onClick={handlePdfExport}
          disabled={exporting !== null || nothingToExport}
          className="rounded-full px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
          style={{ background: 'var(--c-accent)' }}
        >
          {exporting === 'pdf' ? 'Exporting…' : 'Download PDF'}
        </button>
      </div>
    </div>
  );
}