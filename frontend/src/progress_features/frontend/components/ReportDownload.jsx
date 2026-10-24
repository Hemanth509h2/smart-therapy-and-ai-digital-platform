'use client';

import React, { useState } from 'react';
import { apiErrorMessage, caughtErrorMessage } from '@/lib/apiError';
import { toast } from '@/components/practice/ui';

export default function ReportDownload({ clientId }) {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState(null);

  const handleDownload = async () => {
    setDownloading(true);
    setError(null);
    try {
      const res = await fetch(`/api/progress-features/reports/${clientId}`);
      if (!res.ok) throw new Error(await apiErrorMessage(res, 'download the progress report'));
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `progress-report-${clientId}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast('The progress report was downloaded.');
    } catch (e) {
      setError(caughtErrorMessage(e, 'download the progress report'));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="flex flex-col items-start gap-2">
      <button
        onClick={handleDownload}
        disabled={downloading}
        className="rounded-full px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
        style={{ background: 'var(--c-accent)' }}
      >
        {downloading ? 'Generating PDF…' : 'Download Progress Report (PDF)'}
      </button>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
