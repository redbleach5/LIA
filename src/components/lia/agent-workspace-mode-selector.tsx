'use client';

import {
  WORKSPACE_MODE_INPUTS,
  WORKSPACE_MODE_LABELS,
  WORKSPACE_MODE_DESCRIPTIONS,
  type WorkspaceModeInput,
} from '@/lib/agent/workspace-modes';
import { useChatStore } from '@/stores/chat-store';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { BookOpen, Eye, Pencil, Sparkles, Check, ChevronDown } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

const ICONS: Record<WorkspaceModeInput, LucideIcon> = {
  auto: Sparkles,
  read: BookOpen,
  explore: Eye,
  edit: Pencil,
};

type Props = {
  disabled?: boolean;
  className?: string;
};

/** Read / Explore / Edit — рядом с ChatModeSelector, только в режиме Агент. */
export function AgentWorkspaceModeSelector({ disabled, className }: Props) {
  const mode = useChatStore(s => s.agentWorkspaceMode);
  const setMode = useChatStore(s => s.setAgentWorkspaceMode);
  const ActiveIcon = ICONS[mode] ?? Sparkles;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button
          type="button"
          title={WORKSPACE_MODE_DESCRIPTIONS[mode]}
          aria-label={`Режим агента: ${WORKSPACE_MODE_LABELS[mode]}`}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium',
            'text-muted-foreground hover:text-foreground hover:bg-surface-2/80',
            'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
            'disabled:pointer-events-none disabled:opacity-50',
            className,
          )}
        >
          <ActiveIcon className="w-3.5 h-3.5 shrink-0 text-accent" />
          <span>{WORKSPACE_MODE_LABELS[mode]}</span>
          <ChevronDown className="w-3 h-3 opacity-50" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64 p-1">
        {WORKSPACE_MODE_INPUTS.map((id) => {
          const Icon = ICONS[id];
          const isActive = mode === id;
          return (
            <DropdownMenuItem
              key={id}
              onSelect={() => setMode(id)}
              className="flex items-start gap-2.5 px-2.5 py-2 cursor-pointer"
            >
              <Icon className={cn('w-3.5 h-3.5 mt-0.5 shrink-0', isActive ? 'text-accent' : 'text-muted-foreground')} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium">{WORKSPACE_MODE_LABELS[id]}</span>
                  {isActive && <Check className="w-3 h-3 text-accent shrink-0" />}
                </div>
                <p className="text-[10px] leading-snug text-muted-foreground mt-0.5">
                  {WORKSPACE_MODE_DESCRIPTIONS[id]}
                </p>
              </div>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
