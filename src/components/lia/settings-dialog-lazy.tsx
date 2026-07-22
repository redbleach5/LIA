'use client';

// ============================================================================
// SettingsDialogLazy — code-splitting обёртка для SettingsDialog.
// ============================================================================

import dynamic from 'next/dynamic';
import { Settings as SettingsIcon } from 'lucide-react';
import { useEffect, useState } from 'react';

const SettingsDialog = dynamic(
  () => import('@/components/lia/settings-dialog').then(m => ({ default: m.SettingsDialog })),
  {
    ssr: false,
    loading: () => (
      <button
        className="p-2 rounded-md hover:bg-surface-2 transition-colors text-muted-foreground"
        disabled
      >
        <SettingsIcon className="w-4 h-4 animate-pulse" />
      </button>
    ),
  },
);

export function SettingsDialogLazy() {
  const [hasOpened, setHasOpened] = useState(false);

  // Banner / other chrome can request settings without a second click.
  useEffect(() => {
    const open = () => setHasOpened(true);
    window.addEventListener('lia-open-settings', open);
    return () => window.removeEventListener('lia-open-settings', open);
  }, []);

  if (!hasOpened) {
    return (
      <button
        onClick={() => setHasOpened(true)}
        className="p-2 rounded-md hover:bg-surface-2 transition-colors text-muted-foreground hover:text-foreground"
        title="Настройки"
        aria-label="Открыть настройки"
      >
        <SettingsIcon className="w-4 h-4" />
      </button>
    );
  }

  return <SettingsDialog initialOpen={true} />;
}
