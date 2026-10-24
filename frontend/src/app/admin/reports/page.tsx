'use client';

import React, { useState } from 'react';
import { Download, FileText } from 'lucide-react';
import { AdminPage, Btn, Card, Field, Input, Section, useAdmin } from '@/components/admin/kit';
import { toast } from '@/components/practice/ui';
import { adminFetch, downloadCsv } from '@/lib/adminApi';
import { caughtErrorMessage } from '@/lib/apiError';

type CsvType = 'therapists' | 'clients' | 'sessions' | 'usage' | 'audit';

const CSV_REPORTS: { type: CsvType; title: string; body: string; dated: string }[] = [
  { type: 'therapists', title: 'Professionals', body: 'Name, email, status, specialty, client and session counts, current plan.', dated: 'joined' },
  { type: 'clients', title: 'Clients', body: 'Masked names only (e.g. "R*** S."), professional, session count. No contact details or diagnoses.', dated: 'joined' },
  { type: 'sessions', title: 'Sessions', body: 'Professional, masked client, status, schedule and duration.', dated: 'scheduled' },
  { type: 'usage', title: 'Usage events', body: 'AI analyses, transcription and module launches per professional.', dated: 'logged' },
  { type: 'audit', title: 'Audit log', body: 'Every admin change and client-detail reveal, with before/after.', dated: 'logged' },
];

interface Monthly {
  month: string;
  generatedAt: string;
  people: { therapists: number; newTherapists: number; activeTherapists: number; clients: number; newClients: number };
  sessions: { scheduled: number; cancelled: number; held: number; hours: number; byStatus: { status: string; count: number }[] };
  usage: { aiAnalyses: number; transcriptSegments: number; moduleLaunches: number; topModules: { name: string; launches: number }[] };
  billing?: { subscribed: number; newTerms: number; listMrr: number; planMix: { plan: string; count: number }[] };
}

const thisMonth = () => new Date().toISOString().slice(0, 7);

export default function AdminReportsPage() {
  const { can } = useAdmin();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [month, setMonth] = useState(thisMonth());
  const [busy, setBusy] = useState<string | null>(null);

  const exportCsv = async (type: CsvType) => {
    setBusy(type);
    try {
      const qs = new URLSearchParams({ type });
      if (from) qs.set('from', from);
      if (to) qs.set('to', to);
      const { rows } = await adminFetch<{ rows: Record<string, unknown>[] }>(`/api/admin/reports?${qs}`, {
        action: 'export this report',
      });
      if (!rows.length) {
        toast('Nothing to export for these dates.', 'info');
        return;
      }
      const keys = Object.keys(rows[0]);
      const suffix = from || to ? `${from || 'start'}_to_${to || 'today'}` : new Date().toISOString().slice(0, 10);
      downloadCsv(`staad-${type}-${suffix}`, rows, keys.map((k) => ({ header: k, value: (r: Record<string, unknown>) => r[k] })));
      toast(`Exported ${rows.length} rows${rows.length >= 20000 ? ' (limit reached — narrow the dates)' : ''}.`);
    } catch (e) {
      toast(caughtErrorMessage(e, 'export this report'), 'error');
    } finally {
      setBusy(null);
    }
  };

  const monthlyPdf = async () => {
    setBusy('monthly');
    try {
      const r = await adminFetch<Monthly>(`/api/admin/reports?type=monthly&month=${month}`, {
        action: 'build the monthly report',
      });
      const { default: jsPDF } = await import('jspdf');
      const { default: autoTable } = await import('jspdf-autotable');
      const doc = new jsPDF();
      const label = new Date(`${r.month}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
      const head = { fillColor: [74, 124, 111] as [number, number, number] };
      const nextY = () => ((doc as any).lastAutoTable?.finalY ?? 30) + 10;
      const n = (x: number) => x.toLocaleString('en-IN');

      doc.setFontSize(18);
      doc.text(`STAAD monthly report — ${label}`, 14, 18);
      doc.setFontSize(9);
      doc.text(`Generated ${new Date(r.generatedAt).toLocaleString('en-IN')}`, 14, 25);

      autoTable(doc, {
        startY: 32,
        head: [['People', '']],
        body: [
          ['Professionals (end of month)', n(r.people.therapists)],
          ['New professionals', n(r.people.newTherapists)],
          ['Professionals with sessions', n(r.people.activeTherapists)],
          ['Clients (end of month)', n(r.people.clients)],
          ['New clients', n(r.people.newClients)],
        ],
        headStyles: head,
        columnStyles: { 1: { halign: 'right' } },
      });
      autoTable(doc, {
        startY: nextY(),
        head: [['Sessions', '']],
        body: [
          ['Scheduled (not cancelled)', n(r.sessions.scheduled)],
          ['Cancelled', n(r.sessions.cancelled)],
          ['Held (started and ended)', n(r.sessions.held)],
          ['Hours of therapy held', n(r.sessions.hours)],
        ],
        headStyles: head,
        columnStyles: { 1: { halign: 'right' } },
      });
      autoTable(doc, {
        startY: nextY(),
        head: [['Usage', '']],
        body: [
          ['AI analyses', n(r.usage.aiAnalyses)],
          ['Transcript segments', n(r.usage.transcriptSegments)],
          ['Module launches', n(r.usage.moduleLaunches)],
        ],
        headStyles: head,
        columnStyles: { 1: { halign: 'right' } },
      });
      if (r.usage.topModules.length) {
        autoTable(doc, {
          startY: nextY(),
          head: [['Top modules', 'Launches']],
          body: r.usage.topModules.map((m) => [m.name, n(m.launches)]),
          headStyles: head,
          columnStyles: { 1: { halign: 'right' } },
        });
      }
      if (r.billing) {
        autoTable(doc, {
          startY: nextY(),
          head: [['Plans', '']],
          body: [
            ['Professionals on a plan (end of month)', n(r.billing.subscribed)],
            ['New plan terms', n(r.billing.newTerms)],
            ['Monthly list value (INR)', n(r.billing.listMrr)],
            ...r.billing.planMix.map((p) => [`  ${p.plan}`, n(p.count)]),
          ],
          headStyles: head,
          columnStyles: { 1: { halign: 'right' } },
        });
      }
      doc.save(`staad-monthly-report-${r.month}.pdf`);
      toast(`Monthly report for ${label} downloaded.`);
    } catch (e) {
      toast(caughtErrorMessage(e, 'build the monthly report'), 'error');
    } finally {
      setBusy(null);
    }
  };

  const reports = CSV_REPORTS.filter((x) => x.type !== 'audit' || can('audit.read'));

  return (
    <AdminPage title="Reports & exports" description="One-click CSV exports and the monthly business report." permission="people.read">
      <Section title="Monthly report" description="Key numbers for one calendar month, as a PDF.">
        <Card className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <Field label="Month">
            <Input type="month" value={month} max={thisMonth()} onChange={(e) => setMonth(e.target.value || thisMonth())} style={{ width: 180 }} />
          </Field>
          <Btn icon={<FileText className="h-4 w-4" />} onClick={monthlyPdf} loading={busy === 'monthly'}>Download PDF</Btn>
        </Card>
      </Section>

      <Section title="CSV exports" description="Leave the dates empty to export everything (up to 20,000 rows per file).">
        <Card className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <Field label="From">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 170 }} />
          </Field>
          <Field label="To">
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 170 }} />
          </Field>
          {(from || to) && <Btn variant="ghost" onClick={() => { setFrom(''); setTo(''); }}>Clear dates</Btn>}
        </Card>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {reports.map((x) => (
            <Card key={x.type} className="flex flex-col gap-3">
              <div>
                <h3 className="font-semibold" style={{ color: 'var(--ink)' }}>{x.title}</h3>
                <p className="mt-1 text-sm" style={{ color: 'var(--ink-muted)' }}>{x.body}</p>
                <p className="mt-1 text-xs" style={{ color: 'var(--ink-muted)' }}>Dates filter by when {x.type === 'sessions' ? 'the session was' : 'it was'} {x.dated}.</p>
              </div>
              <Btn className="mt-auto self-start" variant="ghost" icon={<Download className="h-4 w-4" />} onClick={() => exportCsv(x.type)} loading={busy === x.type}>
                Download CSV
              </Btn>
            </Card>
          ))}
        </div>
      </Section>
    </AdminPage>
  );
}
