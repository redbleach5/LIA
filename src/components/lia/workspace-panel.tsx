'use client';

// Workspace Panel — файловый браузер рабочей директории агента (fsScope).
//
// fsScope задачи: внешний проект, sandbox или (явно) корень Lia.
// Sandbox — под agent-workspaces/.
// Пользователь может открыть файл и увидеть содержимое.
// Обновляется при step_end / polling.

import { useState, useEffect, useCallback, useRef } from 'react';
import { File, Folder, FolderOpen, RefreshCw, ChevronRight, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useChatStore } from '@/stores/chat-store';

type TreeNode = {
  name: string;
  path: string;
  type: 'dir' | 'file';
  size?: number;
  children?: TreeNode[];
};

type WorkspaceKind = 'project' | 'sandbox' | 'custom' | null;

export function WorkspacePanel({ taskId }: { taskId: string | null }) {
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [hasWorkspace, setHasWorkspace] = useState(false);
  const [kind, setKind] = useState<WorkspaceKind>(null);
  const [label, setLabel] = useState<string | null>(null);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());

  const activeTaskStatus = useChatStore(s => s.activeTaskStatus);
  const abortRef = useRef<AbortController | null>(null);
  const selectedFileRef = useRef<string | null>(null);
  useEffect(() => { selectedFileRef.current = selectedFile; }, [selectedFile]);

  const refresh = useCallback(async () => {
    if (!taskId) return;
    if (abortRef.current) abortRef.current.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    setLoading(true);
    try {
      const res = await fetch(`/api/agent/${taskId}/workspace`, { signal: ac.signal });
      if (!res.ok) return;
      const data = await res.json();
      setTree(data.tree ?? []);
      setHasWorkspace(data.hasWorkspace ?? false);
      setKind(data.kind ?? null);
      setLabel(typeof data.label === 'string' ? data.label : null);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        /* non-fatal */
      }
    } finally {
      if (!ac.signal.aborted) setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    refresh();
    return () => {
      if (abortRef.current) abortRef.current.abort();
    };
  }, [refresh]);

  useEffect(() => {
    if (!taskId) return;
    const isTerminal = activeTaskStatus === 'done'
      || activeTaskStatus === 'failed'
      || activeTaskStatus === 'cancelled';
    if (isTerminal) return;

    const interval = setInterval(refresh, 8000);
    return () => clearInterval(interval);
  }, [taskId, refresh, activeTaskStatus]);

  const lastStepCount = useChatStore(s => s.activeTaskSteps.length);
  const fileChangeCount = useChatStore(s => s.activeTaskFileChanges.length);
  useEffect(() => {
    if (lastStepCount > 0 || fileChangeCount > 0) refresh();
  }, [lastStepCount, fileChangeCount, refresh]);

  // Phase 6: open file from FileChangesPanel click
  useEffect(() => {
    const handler = (e: Event) => {
      const path = (e as CustomEvent<{ path?: string }>).detail?.path;
      if (path && taskId) {
        const parts = path.replace(/\\/g, '/').split('/');
        setExpandedDirs((prev) => {
          const next = new Set(prev);
          let acc = '';
          for (let i = 0; i < parts.length - 1; i++) {
            acc = acc ? `${acc}/${parts[i]}` : parts[i];
            next.add(acc);
          }
          return next;
        });
        void loadFile(path);
      }
    };
    window.addEventListener('lia-open-workspace-file', handler);
    return () => window.removeEventListener('lia-open-workspace-file', handler);
  }, [taskId]);

  const [fileLoading, setFileLoading] = useState(false);
  const loadFile = async (filePath: string) => {
    if (!taskId) return;
    setSelectedFile(filePath);
    setFileLoading(true);
    try {
      const res = await fetch(`/api/agent/${taskId}/workspace?file=${encodeURIComponent(filePath)}`);
      if (!res.ok) return;
      const data = await res.json();
      setFileContent(data.fileContent);
    } catch {
      setFileContent(null);
    } finally {
      setFileLoading(false);
    }
  };

  const toggleDir = (path: string) => {
    setExpandedDirs(prev => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  if (!taskId) {
    return (
      <div className="px-3 py-4 text-center space-y-1.5">
        <p className="text-[11px] text-foreground">Нет workspace</p>
        <p className="text-[10px] text-text-dim leading-snug">
          Привяжи папку или документ в шапке чата, затем запусти агента — здесь появится дерево файлов.
        </p>
      </div>
    );
  }

  if (!hasWorkspace) {
    return (
      <div className="px-3 py-4 text-center space-y-1.5">
        <p className="text-[11px] text-foreground">Нет рабочей директории</p>
        <p className="text-[10px] text-text-dim leading-snug">
          {kind === 'sandbox'
            ? 'Sandbox пуст или ещё не создан. Для правок в проекте привяжи папку в шапке чата.'
            : 'Нет workspace — привяжи папку или документ в шапке чата (или подтверди sandbox в режиме Правка).'}
        </p>
      </div>
    );
  }

  const title = kind === 'project'
    ? 'Проект'
    : kind === 'sandbox'
      ? 'Песочница'
      : 'Рабочая папка';
  const subtitle = kind === 'project'
    ? (label ? `корень · ${label}` : 'корень репозитория')
    : kind === 'sandbox'
      ? 'пустой write-sandbox (не исходники)'
      : (label ?? undefined);

  const renderTree = (nodes: TreeNode[], level: number = 0): React.ReactNode => {
    return nodes.map(node => {
      const indent = level * 12;
      const isExpanded = expandedDirs.has(node.path);

      if (node.type === 'dir') {
        return (
          <div key={node.path}>
            <button
              onClick={() => toggleDir(node.path)}
              className="w-full flex items-center gap-1 px-2 py-0.5 hover:bg-surface-2 rounded text-[11px] text-muted-foreground transition-colors"
              style={{ paddingLeft: indent + 8 }}
            >
              {isExpanded
                ? <ChevronDown className="w-3 h-3 shrink-0" />
                : <ChevronRight className="w-3 h-3 shrink-0" />
              }
              {isExpanded
                ? <FolderOpen className="w-3.5 h-3.5 shrink-0 text-accent" />
                : <Folder className="w-3.5 h-3.5 shrink-0 text-accent" />
              }
              <span className="truncate">{node.name}</span>
            </button>
            {isExpanded && node.children && renderTree(node.children, level + 1)}
          </div>
        );
      }

      return (
        <button
          key={node.path}
          onClick={() => loadFile(node.path)}
          className={cn(
            'w-full flex items-center gap-1 px-2 py-0.5 hover:bg-surface-2 rounded text-[11px] transition-colors',
            selectedFile === node.path ? 'bg-accent/10 text-accent' : 'text-muted-foreground',
          )}
          style={{ paddingLeft: indent + 20 }}
        >
          <File className="w-3.5 h-3.5 shrink-0 opacity-60" />
          <span className="truncate">{node.name}</span>
          {node.size !== undefined && (
            <span className="text-[9px] text-text-dim ml-auto">
              {node.size < 1024 ? `${node.size}B` : `${(node.size / 1024).toFixed(1)}K`}
            </span>
          )}
        </button>
      );
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between px-1 gap-2">
        <div className="min-w-0">
          <h3 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {title}
          </h3>
          {subtitle && (
            <p className="text-[9px] text-text-dim truncate" title={subtitle}>
              {subtitle}
            </p>
          )}
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          className="p-1 rounded hover:bg-surface-2 text-text-dim hover:text-foreground transition-colors shrink-0"
          title="Обновить"
        >
          <RefreshCw className={cn('w-3 h-3', loading && 'animate-spin')} />
        </button>
      </div>

      {tree.length === 0 ? (
        <div className="text-[10px] text-text-dim italic px-2 py-2">
          {loading
            ? 'Загрузка...'
            : kind === 'sandbox'
              ? 'Песочница пуста — агент ещё не создал файлы'
              : 'Дерево пусто или недоступно'}
        </div>
      ) : (
        <div className="max-h-48 overflow-y-auto rounded border border-border">
          {renderTree(tree)}
        </div>
      )}

      {selectedFile && (
        <div className="space-y-1">
          <div className="text-[10px] text-text-dim px-1 truncate">
            {selectedFile}
          </div>
          {fileLoading ? (
            <div className="flex items-center justify-center py-4">
              <RefreshCw className="w-3 h-3 animate-spin text-accent" />
            </div>
          ) : fileContent !== null ? (
            <pre className="max-h-64 overflow-auto rounded border border-border bg-background p-2 text-[10px] font-mono leading-relaxed">
              <code>{fileContent}</code>
            </pre>
          ) : null}
        </div>
      )}
    </div>
  );
}
