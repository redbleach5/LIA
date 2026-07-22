'use client';

// ============================================================================
// AvatarGlowControl — slider для glow intensity в WOW mode
//   • Управляет CSS-переменной --lia-avatar-glow-intensity на <html>
//   • Persist в localStorage
//   • Применяется к: avatar glow, emotion aura, ambient orbs
//   • Виден только когда активна тема 'wow'
// ============================================================================

import { useEffect, useState } from 'react';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { useTheme } from './theme-provider';
import { Sparkles } from 'lucide-react';

const GLOW_KEY = 'lia-avatar-glow-intensity';
const GLOW_DEFAULT = 60;  // 0-100, по умолчанию 60%

export function AvatarGlowControl() {
  const { theme } = useTheme();
  // SSR-safe default — restore from localStorage after mount
  const [intensity, setIntensity] = useState<number>(GLOW_DEFAULT);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(GLOW_KEY);
      if (saved !== null) {
        const val = Number.parseInt(saved, 10);
        if (!Number.isNaN(val) && val >= 0 && val <= 100) {
          setIntensity(val);
        }
      }
    } catch { /* */ }
    setReady(true);
  }, []);

  // Apply to CSS variable + persist
  useEffect(() => {
    if (!ready) return;
    const root = document.documentElement;
    const normalized = intensity / 100;
    root.style.setProperty('--lia-avatar-glow-intensity', normalized.toString());
    try { localStorage.setItem(GLOW_KEY, intensity.toString()); } catch { /* */ }
  }, [intensity, ready]);

  // Только в WOW mode — в classic/quiet glow отключён
  if (theme !== 'wow') return null;

  return (
    <div className="space-y-2 p-3 rounded-md border border-accent/20 bg-accent/5">
      <div className="flex items-center gap-2">
        <Sparkles className="w-3.5 h-3.5 text-accent shrink-0" />
        <Label className="text-xs font-medium text-foreground flex-1">
          Эффект свечения (WOW)
        </Label>
        <span className="text-[10px] font-mono text-text-dim tabular-nums">
          {intensity}%
        </span>
      </div>
      <Slider
        value={[intensity]}
        onValueChange={(v) => setIntensity(v[0] ?? GLOW_DEFAULT)}
        min={0}
        max={100}
        step={5}
        className="w-full"
      />
      <p className="text-[10px] text-text-dim leading-snug">
        Интенсивность ambient orbs, свечения аватара и эмоциональной ауры.
        {' '}
        <button
          type="button"
          onClick={() => setIntensity(GLOW_DEFAULT)}
          className="text-accent hover:underline"
        >
          Сбросить к {GLOW_DEFAULT}%
        </button>
      </p>
    </div>
  );
}
