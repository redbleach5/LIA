// ============================================================================
// Heuristic Design Gate — stack + structure before write_file.
// ============================================================================

import type { ProjectDesign, ProjectKind } from './types';

function slugifyName(goal: string): string {
  const raw = goal
    .toLowerCase()
    .replace(/[^a-zа-яё0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return raw || 'artifact';
}

function detectKind(goal: string): ProjectKind {
  const g = goal.toLowerCase();
  if (/игр[уыа]|game|тетрис|tetris|змейк|snake|arkanoid|platformer/.test(g)) return 'game';
  if (/cli\b|утилит|командн|terminal\b|скрипт\s+для\s+терминал/.test(g)) return 'cli';
  if (/api\b|endpoint|сервер|express|fastapi|flask/.test(g) && !/сайт|лендинг|страниц/.test(g)) {
    return 'api';
  }
  if (/python|\.py\b|pygame|скрипт/.test(g) && !/сайт|html|react|vite/.test(g)) return 'script';
  return 'web';
}

const DEFAULT_PORT = 5173;

/**
 * Infer a sensible ProjectDesign from the user goal.
 * Used as Design Gate auto-accept for simple create tasks.
 */
export function inferProjectDesign(goal: string): ProjectDesign {
  const kind = detectKind(goal);
  const name = slugifyName(goal);
  const g = goal.toLowerCase();

  if (kind === 'game' || (kind === 'web' && !/react|vite|next|vue|svelte/.test(g))) {
    const wantsCanvas = kind === 'game' || /canvas|анимац/.test(g);
    return {
      name,
      kind,
      stack: wantsCanvas ? ['html', 'css', 'javascript', 'canvas'] : ['html', 'css', 'javascript'],
      tree: [
        { path: 'index.html', role: 'страница / точка входа' },
        { path: 'style.css', role: 'стили' },
        { path: 'script.js', role: 'логика' },
        { path: 'lia.project.json', role: 'манифест Create Runtime' },
      ],
      scripts: {
        // npx serve — long-running static host for preview
        dev: `npx --yes serve -l ${DEFAULT_PORT}`,
        start: `npx --yes serve -l ${DEFAULT_PORT}`,
      },
      preview: { type: 'iframe', port: DEFAULT_PORT },
      entry: 'index.html',
      acceptance: 'Preview открывается на localhost, страница без JS-ошибок в консоли, основной сценарий работает.',
      createdBy: 'lia',
    };
  }

  if (kind === 'web' && /react|vite|next/.test(g)) {
    return {
      name,
      kind: 'web',
      stack: ['vite', 'react', 'typescript'],
      tree: [
        { path: 'package.json', role: 'зависимости и scripts' },
        { path: 'index.html', role: 'HTML shell' },
        { path: 'src/main.tsx', role: 'точка входа' },
        { path: 'src/App.tsx', role: 'UI' },
        { path: 'lia.project.json', role: 'манифест Create Runtime' },
      ],
      scripts: {
        install: 'npm install',
        dev: `npx --yes vite --host 127.0.0.1 --port ${DEFAULT_PORT}`,
        start: `npx --yes vite --host 127.0.0.1 --port ${DEFAULT_PORT}`,
      },
      preview: { type: 'iframe', port: DEFAULT_PORT },
      entry: 'src/App.tsx',
      acceptance: 'Dev-сервер отвечает на порту, UI рендерится без ошибок сборки.',
      createdBy: 'lia',
    };
  }

  if (kind === 'api') {
    return {
      name,
      kind: 'api',
      stack: ['node', 'http'],
      tree: [
        { path: 'server.js', role: 'HTTP API' },
        { path: 'package.json', role: 'скрипты запуска' },
        { path: 'lia.project.json', role: 'манифест Create Runtime' },
      ],
      scripts: {
        start: `node server.js`,
        dev: `node server.js`,
      },
      preview: { type: 'terminal', port: DEFAULT_PORT },
      entry: 'server.js',
      acceptance: 'Сервер слушает порт; GET health/root возвращает 200.',
      createdBy: 'lia',
    };
  }

  // cli / script — Python by default on Windows-friendly path
  const pyMain = /javascript|node|\.js\b/.test(g) ? 'main.js' : 'main.py';
  const isJs = pyMain.endsWith('.js');
  return {
    name,
    kind: kind === 'cli' ? 'cli' : 'script',
    stack: isJs ? ['node'] : ['python'],
    tree: [
      { path: pyMain, role: 'точка входа' },
      { path: 'lia.project.json', role: 'манифест Create Runtime' },
    ],
    scripts: {
      start: isJs ? `node ${pyMain}` : `python ${pyMain}`,
      dev: isJs ? `node ${pyMain}` : `python ${pyMain}`,
    },
    preview: { type: 'terminal' },
    entry: pyMain,
    acceptance: 'Скрипт завершается с кодом 0 (или показывает ожидаемый вывод в терминале).',
    createdBy: 'lia',
  };
}

/** True when design expects a managed runtime verify before ГОТОВО. */
export function designNeedsRuntimeVerify(design: ProjectDesign): boolean {
  return design.preview.type === 'iframe' || design.preview.type === 'terminal';
}
