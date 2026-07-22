'use client';

// ============================================================================
// SettingsDialog — главное окно настроек.
// ============================================================================
//
// Тонкая обёртка: управляет open/close, loading, form state, refresh.
// Вся логика табов вынесена в отдельные компоненты:
//   - settings/model-tab.tsx    — ModelTab
//   - settings/avatar-tab.tsx   — AvatarTab
//   - settings/about-tab.tsx    — AboutTab
//
// Разделение god-component (1228 строк) на таб-компоненты + shared helpers
// было сделано в Phase 2.4 для улучшения поддерживаемости.

import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Settings as SettingsIcon,
  MessageSquare,
  User,
  Info,
  BookOpen,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  DEFAULT_AVATAR_CONFIG,
  parseAvatarConfig,
  type AvatarConfig,
} from '@/lib/avatar-config';
import { ModelTab } from './settings/model-tab';
import { AvatarTab } from './settings/avatar-tab';
import { KbTab } from './settings/kb-tab';
import { AboutTab } from './settings/about-tab';
import type { Settings } from './settings/types';

export function SettingsDialog({ initialOpen = false }: { initialOpen?: boolean }) {
  const [open, setOpen] = useState(initialOpen);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(false);

  // Form state — общее для ModelTab и AvatarTab.
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [agentModel, setAgentModel] = useState('');
  const [embedModel, setEmbedModel] = useState('auto');
  const [activeVrm, setActiveVrm] = useState<string | null>(null);
  const [avatarConfig, setAvatarConfig] = useState<AvatarConfig>(DEFAULT_AVATAR_CONFIG);
  const [userDisplayName, setUserDisplayName] = useState('');

  const refresh = async (opts?: { quiet?: boolean }) => {
    const quiet = Boolean(opts?.quiet && settings);
    if (!quiet) setLoading(true);
    try {
      const settingsRes = await fetch('/api/settings');
      const settingsData = await settingsRes.json();
      setSettings(settingsData);
      setBaseUrl(settingsData.baseUrl ?? '');
      setModel(settingsData.model ?? '');
      setAgentModel(settingsData.agentModel ?? '');
      setEmbedModel(settingsData.embedModel ?? 'auto');
      setActiveVrm(settingsData.activeVrm);
      setAvatarConfig(settingsData.avatarConfig
        ? parseAvatarConfig(JSON.stringify(settingsData.avatarConfig))
        : DEFAULT_AVATAR_CONFIG);
      setUserDisplayName(settingsData.userDisplayName ?? '');
    } catch {
      toast.error('Не удалось загрузить настройки');
    } finally {
      if (!quiet) setLoading(false);
    }
  };

  useEffect(() => {
    if (open) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh on open only
  }, [open]);

  // Banner / gear can reopen settings after first mount.
  // Lazy wrapper only mounts us once; without this, lia-open-settings is a no-op.
  useEffect(() => {
    const openSettings = () => setOpen(true);
    window.addEventListener('lia-open-settings', openSettings);
    return () => window.removeEventListener('lia-open-settings', openSettings);
  }, []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="lia-icon-btn"
          title="Настройки"
          aria-label="Открыть настройки"
        >
          <SettingsIcon className="w-3.5 h-3.5" />
        </button>
      </DialogTrigger>
      <DialogContent
        className={cn(
          'w-full max-w-[calc(100%-1.5rem)] sm:max-w-3xl',
          'bg-popover border-border gap-3',
          'max-h-[min(90vh,820px)] overflow-x-hidden overflow-y-auto',
        )}
      >
        <DialogHeader className="pr-8">
          <DialogTitle>Настройки</DialogTitle>
          <DialogDescription className="sr-only">
            Модель, внешний вид, база знаний и сведения о Лии
          </DialogDescription>
        </DialogHeader>

        {loading && !settings && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-accent" />
          </div>
        )}

        {settings && (
          <Tabs defaultValue="model" className="w-full min-w-0 gap-3">
            <TabsList className="grid w-full grid-cols-4 h-auto gap-0.5 p-1">
              <TabsTrigger value="model" className="text-[11px] sm:text-xs gap-1.5 px-1.5 py-1.5 h-auto">
                <MessageSquare className="w-3 h-3 shrink-0" />
                <span>Модель</span>
              </TabsTrigger>
              <TabsTrigger value="avatar" className="text-[11px] sm:text-xs gap-1.5 px-1.5 py-1.5 h-auto">
                <User className="w-3 h-3 shrink-0" />
                <span>Вид</span>
              </TabsTrigger>
              <TabsTrigger value="kb" className="text-[11px] sm:text-xs gap-1.5 px-1.5 py-1.5 h-auto">
                <BookOpen className="w-3 h-3 shrink-0" />
                <span>База</span>
              </TabsTrigger>
              <TabsTrigger value="about" className="text-[11px] sm:text-xs gap-1.5 px-1.5 py-1.5 h-auto">
                <Info className="w-3 h-3 shrink-0" />
                <span>О Лии</span>
              </TabsTrigger>
            </TabsList>

            <TabsContent value="model" className="mt-0 flex-none">
              <ModelTab
                settings={settings}
                baseUrl={baseUrl}
                model={model}
                agentModel={agentModel}
                embedModel={embedModel}
                setBaseUrl={setBaseUrl}
                setModel={setModel}
                setAgentModel={setAgentModel}
                setEmbedModel={setEmbedModel}
                onSaved={() => refresh({ quiet: true })}
              />
            </TabsContent>

            <TabsContent value="avatar" className="mt-0 flex-none">
              <AvatarTab
                settings={settings}
                activeVrm={activeVrm}
                avatarConfig={avatarConfig}
                setActiveVrm={setActiveVrm}
                setAvatarConfig={setAvatarConfig}
                onSaved={() => refresh({ quiet: true })}
                onUploadComplete={() => refresh({ quiet: true })}
              />
            </TabsContent>

            <TabsContent value="kb" className="mt-0 flex-none">
              <KbTab onRefresh={refresh} />
            </TabsContent>

            <TabsContent value="about" className="mt-0 flex-none">
              <AboutTab
                userDisplayName={userDisplayName}
                setUserDisplayName={setUserDisplayName}
                onProfileSaved={() => refresh({ quiet: true })}
              />
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}
