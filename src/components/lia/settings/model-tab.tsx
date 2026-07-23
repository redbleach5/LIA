'use client';

// ============================================================================
// ModelTab — настройки Ollama (chat / agent / embed).
// ============================================================================

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Check, Loader2, AlertCircle, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { isOllamaLoopbackUrl, normalizeOllamaBaseUrl } from '@/lib/ollama-base-url';
import type { Settings } from './types';
import { describeEmbedModel } from './describe-embed-model';
import { LIA_APP_EVENTS, dispatchLiaAppEvent } from '@/lib/lia-app-events';

/** Embed / retrieval models must not appear in the chat picker. */
const EMBED_MODEL_RE = /embed|nomic|minilm|e5-/i;
const LOCAL_OLLAMA_URL = 'http://127.0.0.1:11434';

function formatSettingsError(data: { error?: string; details?: Array<{ path?: string; message?: string }> }, status: number): string {
  if (data.error === 'validation failed' && Array.isArray(data.details) && data.details.length > 0) {
    return data.details
      .map((d) => (d.path ? `${d.path}: ${d.message ?? ''}` : (d.message ?? 'invalid')))
      .join('; ');
  }
  return data.error || `HTTP ${status}`;
}

type ModelTabProps = {
  settings: Settings;
  baseUrl: string;
  model: string;
  agentModel: string;
  embedModel: string;
  setBaseUrl: (v: string) => void;
  setModel: (v: string) => void;
  setAgentModel: (v: string) => void;
  setEmbedModel: (v: string) => void;
  onSaved: () => Promise<void>;
};

export function ModelTab({
  settings,
  baseUrl,
  model,
  agentModel,
  embedModel,
  setBaseUrl,
  setModel,
  setAgentModel,
  setEmbedModel,
  onSaved,
}: ModelTabProps) {
  const [saving, setSaving] = useState(false);

  const chatModels = settings.availableModels.filter((m) => !EMBED_MODEL_RE.test(m));
  const effectiveBase = normalizeOllamaBaseUrl(baseUrl) ?? baseUrl;
  const isRemote = Boolean(effectiveBase) && !isOllamaLoopbackUrl(effectiveBase);

  const persist = async (overrides: {
    model?: string;
    agentModel?: string;
    embedModel?: string;
    baseUrl?: string;
  } = {}, opts?: { quietSuccess?: boolean; connectionCheck?: boolean }) => {
    setSaving(true);
    try {
      const nextModel = overrides.model ?? model;
      const nextAgent = overrides.agentModel ?? agentModel;
      const nextEmbed = overrides.embedModel ?? embedModel;
      const rawBase = overrides.baseUrl ?? baseUrl;
      const normalizedBase = rawBase.trim()
        ? (normalizeOllamaBaseUrl(rawBase) ?? rawBase.trim())
        : '';

      if (rawBase.trim() && !normalizeOllamaBaseUrl(rawBase)) {
        throw new Error('Некорректный хост Ollama. Пример: 192.168.1.50 или http://192.168.1.50:11434');
      }

      if (normalizedBase && normalizedBase !== baseUrl) {
        setBaseUrl(normalizedBase);
      }

      const body = {
        baseUrl: normalizedBase || undefined,
        model: nextModel,
        agentModel: nextAgent,
        embedModel: nextEmbed === 'auto' ? '' : nextEmbed,
      };

      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({})) as {
        error?: string;
        details?: Array<{ path?: string; message?: string }>;
        ollamaOk?: boolean;
        ollamaError?: string;
        model?: string;
        baseUrl?: string;
      };
      if (!res.ok) {
        throw new Error(formatSettingsError(data, res.status));
      }

      if (data.baseUrl) setBaseUrl(data.baseUrl);

      if (opts?.connectionCheck) {
        if (data.ollamaOk) {
          toast.success(`Ollama на связи · ${data.baseUrl || normalizedBase}`);
        } else {
          toast.warning(`Нет ответа от Ollama: ${data.ollamaError ?? 'unknown'}`);
        }
      } else if (!opts?.quietSuccess) {
        if (data.ollamaOk) {
          toast.success(`Сохранено · чат: ${data.model || nextModel}`);
        } else {
          toast.warning(`Модель записана, но Ollama не отвечает: ${data.ollamaError ?? 'unknown'}`);
        }
      } else {
        toast.success(`Модель: ${data.model || nextModel}`);
      }
      await onSaved();
      dispatchLiaAppEvent(LIA_APP_EVENTS.settingsChanged);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`Не удалось сохранить: ${msg}`);
      throw e;
    } finally {
      setSaving(false);
    }
  };

  const saveModel = async () => {
    try {
      await persist();
    } catch {
      /* toast already shown */
    }
  };

  const checkConnection = async () => {
    try {
      await persist({}, { connectionCheck: true });
    } catch {
      /* toast already shown */
    }
  };

  const useLocalHost = () => {
    setBaseUrl(LOCAL_OLLAMA_URL);
  };

  const onHostBlur = () => {
    const normalized = normalizeOllamaBaseUrl(baseUrl);
    if (normalized && normalized !== baseUrl) setBaseUrl(normalized);
  };

  const pickChatModel = async (name: string) => {
    if (name === model) return;
    setModel(name);
    try {
      await persist({ model: name }, { quietSuccess: true });
    } catch {
      /* toast already shown */
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-border bg-surface/40 px-3 py-2 text-xs">
        <span className="text-text-dim">Сейчас в чате: </span>
        <span className="font-mono text-foreground">{model || '—'}</span>
        <span className="text-text-dim"> · Ollama{isRemote ? ' (удалённый)' : ''}</span>
      </div>

      {/* Ollama host — local or remote GPU box */}
      <div className="space-y-1.5 rounded-md border border-border bg-surface/40 p-3">
        <Label htmlFor="baseUrl" className="text-xs">Хост Ollama</Label>
        <p className="text-[10px] text-text-dim leading-relaxed">
          Лия на ноутбуке, модели на ПК с видеокартой — укажи IP этого ПК
          (например <span className="font-mono">192.168.1.50</span>).
          На том компьютере Ollama должна слушать сеть:
          <span className="font-mono"> OLLAMA_HOST=0.0.0.0 ollama serve</span>.
          Хост и модели сохраняются в настройках приложения (не в .env).
        </p>
        <Input
          id="baseUrl"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          onBlur={onHostBlur}
          placeholder="192.168.1.50 или http://192.168.1.50:11434"
          className="text-sm font-mono"
          autoComplete="off"
          spellCheck={false}
        />
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-[11px] px-2"
            disabled={saving || baseUrl === LOCAL_OLLAMA_URL}
            onClick={useLocalHost}
          >
            Этот компьютер
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-[11px] px-2"
            disabled={saving || !baseUrl.trim()}
            onClick={() => void checkConnection()}
          >
            {saving ? (
              <Loader2 className="w-3 h-3 mr-1 animate-spin" />
            ) : (
              <RefreshCw className="w-3 h-3 mr-1" />
            )}
            Проверить связь
          </Button>
        </div>
        {isRemote && (
          <p className="text-[10px] text-text-dim">
            Для бюджета VRAM на удалённой карте задай в .env{' '}
            <span className="font-mono">LIA_INFERENCE_VRAM_GB</span> (ГБ видеокарты ПК).
          </p>
        )}
      </div>

      {/* Ollama health status */}
      <div className={cn(
        'rounded-md border p-3 text-xs flex items-center gap-2',
        settings.ollamaOk
          ? 'border-success/40 bg-success/5 text-success'
          : 'border-warning/40 bg-warning/5 text-warning',
      )}>
        <div className={cn(
          'w-2 h-2 rounded-full',
          settings.ollamaOk ? 'bg-success' : 'bg-warning',
        )} />
        <span className="flex-1">
          {settings.ollamaOk
            ? `На связи${isRemote ? ` · ${effectiveBase}` : ''} · моделей для чата: ${chatModels.length}`
            : isRemote
              ? `Нет связи с ${effectiveBase || 'удалённым хостом'}. Проверь IP, firewall и OLLAMA_HOST=0.0.0.0.`
              : 'Пока не удалось подключиться. Проверь, что Ollama запущена на этом компьютере.'}
        </span>
      </div>

      {/* Chat model — primary companion choice */}
      <div className="space-y-1.5">
        <Label className="text-xs">Модель для разговора</Label>
        <p className="text-[10px] text-text-dim">Клик по модели сразу сохраняет выбор</p>
        {chatModels.length === 0 ? (
          <p className="text-xs text-text-dim">
            Нет доступных моделей. В Ollama скачай, например, qwen3:8b
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-1.5 max-h-48 overflow-y-auto">
            {chatModels.map(m => (
              <button
                type="button"
                key={m}
                disabled={saving}
                onClick={() => void pickChatModel(m)}
                className={cn(
                  'text-left text-xs px-2 py-1.5 rounded border transition-colors',
                  model === m
                    ? 'border-accent bg-accent/10 text-accent'
                    : 'border-border hover:border-accent/50',
                  saving && 'opacity-60',
                )}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="truncate">{m}</span>
                  {model === m && <Check className="w-3 h-3 shrink-0" />}
                </div>
              </button>
            ))}
          </div>
        )}
        <Input
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder="qwen3:8b"
          className="text-sm mt-1"
        />
        <p className="text-[10px] text-text-dim">
          Ручной ввод — нажми «Сохранить» ниже
        </p>
      </div>

      <Button onClick={() => void saveModel()} disabled={saving} className="w-full" size="sm">
        {saving ? <Loader2 className="w-3 h-3 mr-1.5 animate-spin" /> : null}
        Сохранить
      </Button>

      <details className="rounded-md border border-border bg-surface/40 p-3">
        <summary className="text-xs font-medium cursor-pointer text-foreground">
          Агент и память
        </summary>
        <div className="mt-3 space-y-4">
      {/* Agent model */}
      <div className="space-y-1.5">
        <Label className="text-xs">
          Модель для агента
          <span className="text-text-dim font-normal ml-1.5">
            — длинные задачи с tools (не Reasoning Distilled)
          </span>
        </Label>
        <p className="text-[10px] text-text-dim leading-snug -mt-0.5 mb-1">
          Для Агента нужна модель с tools; Reasoning Distilled — для обычного диалога.
        </p>
        <div className="grid grid-cols-2 gap-1.5 max-h-40 overflow-y-auto">
          <button
            type="button"
            onClick={() => setAgentModel('')}
            className={cn(
              'text-left text-xs px-2 py-1.5 rounded border transition-colors col-span-2',
              agentModel === ''
                ? 'border-accent bg-accent/10 text-accent'
                : 'border-border hover:border-accent/50',
            )}
          >
            <div className="flex items-center justify-between gap-1">
              <span>Как у чата</span>
              {agentModel === '' && <Check className="w-3 h-3 shrink-0" />}
            </div>
            <div className="text-[10px] text-text-dim mt-0.5">
              Сейчас: {settings.agentModelEffective || model || '—'}
            </div>
          </button>
          {chatModels.map(m => (
              <button
                key={`agent-${m}`}
                type="button"
                onClick={() => setAgentModel(m)}
                className={cn(
                  'text-left text-xs px-2 py-1.5 rounded border transition-colors',
                  agentModel === m
                    ? 'border-accent bg-accent/10 text-accent'
                    : 'border-border hover:border-accent/50',
                )}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="truncate font-mono">{m}</span>
                  {agentModel === m && <Check className="w-3 h-3 shrink-0" />}
                </div>
              </button>
            ))}
        </div>
        <Input
          value={agentModel}
          onChange={(e) => setAgentModel(e.target.value)}
          placeholder="пусто = как у чата, напр. qwen3:8b"
          className="text-sm font-mono mt-1"
        />
      </div>

      {/* Embed model */}
      <div className="space-y-1.5">
        <Label className="text-xs">
          Модель для памяти
          <span className="text-text-dim font-normal ml-1.5">
            — запоминает смысл разговоров (через Ollama)
          </span>
        </Label>

        <button
          type="button"
          onClick={() => setEmbedModel('auto')}
          className={cn(
            'w-full text-left text-xs px-2 py-1.5 rounded border transition-colors flex items-start gap-2',
            embedModel === 'auto'
              ? 'border-accent bg-accent/10 text-accent'
              : 'border-border hover:border-accent/50',
          )}
        >
          <div className="flex-1">
            <div className="flex items-center justify-between gap-1">
              <span className="font-medium">Авто</span>
              {embedModel === 'auto' && <Check className="w-3 h-3 shrink-0" />}
            </div>
            <div className="text-[10px] text-text-dim mt-0.5">
              Лия сама выберет подходящую модель из доступных
            </div>
          </div>
        </button>

        {settings.availableEmbedModels.length > 0 ? (
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {settings.availableEmbedModels.map(m => (
              <button
                type="button"
                key={m}
                onClick={() => setEmbedModel(m)}
                className={cn(
                  'w-full text-left text-xs px-2 py-1.5 rounded border transition-colors',
                  embedModel === m
                    ? 'border-accent bg-accent/10 text-accent'
                    : 'border-border hover:border-accent/50',
                )}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="truncate font-mono">{m}</span>
                  {embedModel === m && <Check className="w-3 h-3 shrink-0" />}
                </div>
                <div className="text-[10px] text-text-dim mt-0.5">
                  {describeEmbedModel(m)}
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="rounded border border-warning/40 bg-warning/5 p-2 text-[11px] text-warning flex items-start gap-2">
            <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>
              Не найдено моделей для памяти. Скачай в Ollama:
              <code className="font-mono ml-1">nomic-embed-text</code>,
              <code className="font-mono ml-1">bge-m3</code>.
            </span>
          </div>
        )}

        <details className="mt-1">
          <summary className="text-[10px] text-text-dim cursor-pointer hover:text-foreground">
            Указать вручную
          </summary>
          <Input
            value={embedModel === 'auto' ? '' : embedModel}
            onChange={(e) => setEmbedModel(e.target.value || 'auto')}
            placeholder="например, bge-m3:latest"
            className="text-sm font-mono mt-1"
          />
        </details>
      </div>

        </div>
      </details>

      <McpSettingsBlock />
    </div>
  );
}

function McpSettingsBlock() {
  const [servers, setServers] = useState<Array<{ id: string; name: string; enabled: boolean }>>([]);
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
    try {
      const res = await fetch('/api/agent/mcp');
      if (!res.ok) return;
      const data = await res.json();
      setServers(data.servers ?? []);
    } catch { /* ignore */ }
  };

  useEffect(() => {
    void refresh();
  }, []);

  return (
    <details className="mt-3 rounded border border-border/60 p-2">
      <summary className="text-xs font-medium cursor-pointer">MCP (бонус)</summary>
      <p className="text-[10px] text-text-dim mt-1 mb-2">
        Mock MCP tools для агента. Env <code className="font-mono">LIA_MCP_ENABLED=1</code> или тоггл ниже.
        Выключение не ломает агент.
      </p>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="text-[10px] h-7 mb-2"
        disabled={loading}
        onClick={async () => {
          setLoading(true);
          await refresh();
          setLoading(false);
        }}
      >
        {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
        <span className="ml-1">Обновить</span>
      </Button>
      <div className="space-y-1">
        {servers.map((s) => (
          <label key={s.id} className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={s.enabled}
              onChange={async (e) => {
                await fetch('/api/agent/mcp', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ id: s.id, enabled: e.target.checked }),
                });
                await refresh();
              }}
            />
            <span>{s.name}</span>
            <span className="font-mono text-text-dim text-[10px]">{s.id}</span>
          </label>
        ))}
        {servers.length === 0 && (
          <p className="text-[10px] text-text-dim">Нет серверов — нажми «Обновить».</p>
        )}
      </div>
    </details>
  );
}
