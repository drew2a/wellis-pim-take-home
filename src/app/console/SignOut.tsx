'use client';

// Signing out is a cookie that expires now (ADR-0021 item 2), so this posts and reloads.
import { useRouter } from 'next/navigation';
import { useState, type ReactElement } from 'react';

import { RailButton } from '@/ui';

export function SignOut(): ReactElement {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <RailButton
      busy={busy}
      onClick={() => {
        setBusy(true);
        void fetch('/api/console/session', { method: 'DELETE' }).finally(() => {
          router.push('/login');
          router.refresh();
        });
      }}
    >
      Sign out
    </RailButton>
  );
}
