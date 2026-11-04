'use client';

import { Btn } from '@/components/staad/parts';

// Reopens the cookie banner (CookieConsent listens for this event) so anyone
// can change their analytics choice later, as easily as they made it.
export default function CookieSettingsButton() {
  return (
    <Btn variant="ghost" onClick={() => window.dispatchEvent(new Event('staad:cookie-settings'))}>
      Cookie settings
    </Btn>
  );
}
