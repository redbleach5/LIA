'use client';

// ============================================================================
// AboutTab — ваш профиль для Лии + информация о продукте.
// ============================================================================

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

type AboutTabProps = {
  userDisplayName: string;
  setUserDisplayName: (v: string) => void;
  onProfileSaved: () => Promise<void>;
};

export function AboutTab({
  userDisplayName,
  setUserDisplayName,
  onProfileSaved,
}: AboutTabProps) {
  const [saving, setSaving] = useState(false);

  const saveProfile = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userDisplayName: userDisplayName.trim() }),
      });
      const data = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      toast.success('Имя сохранено — Лия будет обращаться к вам так');
      await onProfileSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось сохранить');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-border bg-surface/50 p-4 space-y-3">
        <div>
          <Label htmlFor="user-display-name" className="text-xs">
            Как вас зовут
          </Label>
          <p className="text-[10px] text-muted-foreground mt-0.5 mb-2">
            Попадает в память Лии (user.name). Можно также написать в чате «меня зовут …».
          </p>
          <div className="flex gap-2">
            <Input
              id="user-display-name"
              value={userDisplayName}
              onChange={(e) => setUserDisplayName(e.target.value)}
              placeholder="Имя или как обращаться"
              maxLength={80}
              className="text-sm"
            />
            <Button
              type="button"
              size="sm"
              onClick={() => void saveProfile()}
              disabled={saving}
              className="shrink-0"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Сохранить'}
            </Button>
          </div>
        </div>
      </div>

      <div className="rounded-md border border-border bg-surface/50 p-4 space-y-2">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-md bg-accent flex items-center justify-center">
            <span className="text-base font-bold text-accent-foreground">Л</span>
          </div>
          <div>
            <div className="text-sm font-medium font-display">Лия</div>
            <div className="text-[10px] text-text-dim">тёплый собеседник и помощник</div>
          </div>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Лия — персональный компаньон. Разговоры остаются на этом компьютере.
          Она запоминает важное, ищет информацию, помогает с делами и подстраивает
          стиль общения под вас.
        </p>
      </div>

      <details className="rounded-md border border-border bg-surface/50 p-3 text-[11px] text-muted-foreground group">
        <summary className="font-medium text-foreground cursor-pointer list-none flex items-center justify-between">
          Технические детали
          <span className="text-text-dim group-open:hidden">показать</span>
          <span className="text-text-dim hidden group-open:inline">скрыть</span>
        </summary>
        <p className="mt-2 leading-relaxed">
          Next.js, React, локальный движок Ollama, память на SQLite.
          3D-образ — по желанию. База знаний ищет и по смыслу, и по словам.
        </p>
      </details>

      <details className="rounded-md border border-dashed border-border bg-surface/30 p-3 text-[11px] text-muted-foreground group">
        <summary className="font-medium text-foreground cursor-pointer list-none">
          Для разработчика
        </summary>
        <p className="mt-2 leading-relaxed">
          Логи: <code className="text-[10px]">bun run logs:errors:win</code>, диагностика:{' '}
          <code className="text-[10px]">bun run diagnose</code>.
        </p>
      </details>
    </div>
  );
}
