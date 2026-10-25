'use client';

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { clearApiCache } from '@/lib/api';
import { clearPracticeData } from '@/hooks/usePracticeData';

/**
 * The sidebar's Refresh button. Drops every cached response (apiFetchCached
 * and the shared practice data), then remounts the current page, so it loads
 * its data again exactly as on a first visit. No page needs wiring: pages
 * load in their own component, which sits under this provider (root layout).
 * Sign-in and theme live above it and stay as they are. Filters kept in the
 * URL survive; unsaved form input on the page does not.
 */
const PageRefreshContext = createContext<{ refresh: () => void; refreshing: boolean }>({
  refresh: () => {},
  refreshing: false,
});

export function PageRefreshProvider({ children }: { children: React.ReactNode }) {
  const [key, setKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => () => clearTimeout(timer.current), []);

  const refresh = useCallback(() => {
    clearApiCache();
    clearPracticeData();
    setKey((k) => k + 1);
    // One turn of the icon, so the click visibly did something.
    setRefreshing(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setRefreshing(false), 700);
  }, []);

  return (
    <PageRefreshContext.Provider value={{ refresh, refreshing }}>
      <React.Fragment key={key}>{children}</React.Fragment>
    </PageRefreshContext.Provider>
  );
}

export const usePageRefresh = () => useContext(PageRefreshContext);
