'use client';

import React from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/useAuthStore';
import DashboardLayout from '@/components/layout/DashboardLayout';
import MeasurementDashboard from '@/progress_features/frontend/components/MeasurementDashboard.jsx';
import ProgressCharts from '@/progress_features/frontend/components/ProgressCharts.jsx';
import ReportDownload from '@/progress_features/frontend/components/ReportDownload.jsx';

export default function ProgressFeaturesPage() {
  const { role, profile } = useAuthStore();
  const router = useRouter();
  const params = useParams();
  const clientId = params.clientId;

  return (
    <DashboardLayout role={role} profile={profile}>
      <div className="space-y-6">
        <div>
          <h1 className="font-heading text-[28px]" style={{ color: 'var(--ink)' }}>
            Quantitative Progress
          </h1>
          <p className="text-sm font-medium mt-1" style={{ color: 'var(--ink-muted)' }}>
            Attendance, task completion, and performance metrics for this client.
          </p>
        </div>

        <MeasurementDashboard clientId={clientId} />
        <ProgressCharts clientId={clientId} />
        <ReportDownload clientId={clientId} />
      </div>
    </DashboardLayout>
  );
}
