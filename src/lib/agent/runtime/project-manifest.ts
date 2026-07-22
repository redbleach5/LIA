// ============================================================================
// lia.project.json — schema + parse/serialize (client + server safe).
// ============================================================================

import { z } from 'zod';
import type { ProjectDesign } from './types';
import { PROJECT_KINDS, PREVIEW_TYPES } from './types';

export const PROJECT_MANIFEST_FILENAME = 'lia.project.json';

export const projectDesignSchema = z.object({
  name: z.string().min(1).max(80),
  kind: z.enum(PROJECT_KINDS),
  stack: z.array(z.string().min(1).max(40)).min(1).max(12),
  tree: z
    .array(
      z.object({
        path: z.string().min(1).max(200),
        role: z.string().min(1).max(120),
      }),
    )
    .min(1)
    .max(40),
  scripts: z
    .object({
      install: z.string().min(1).max(300).optional(),
      dev: z.string().min(1).max(300).optional(),
      build: z.string().min(1).max(300).optional(),
      start: z.string().min(1).max(300).optional(),
    })
    .default({}),
  preview: z.object({
    type: z.enum(PREVIEW_TYPES),
    port: z.number().int().min(1024).max(65535).optional(),
    url: z.string().max(300).optional(),
  }),
  entry: z.string().max(200).optional(),
  acceptance: z.string().min(1).max(500),
  createdBy: z.literal('lia').default('lia'),
});

export type ProjectDesignInput = z.input<typeof projectDesignSchema>;

export function parseProjectDesign(raw: unknown):
  | { ok: true; design: ProjectDesign }
  | { ok: false; error: string } {
  const parsed = projectDesignSchema.safeParse(raw);
  if (!parsed.success) {
    const msg = parsed.error.issues.slice(0, 3).map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
    return { ok: false, error: msg || 'invalid design' };
  }
  const design = parsed.data as ProjectDesign;
  if (design.preview.type === 'iframe' && !design.preview.port) {
    return { ok: false, error: 'preview.port required when preview.type is iframe' };
  }
  if (!design.scripts.dev && !design.scripts.start) {
    return { ok: false, error: 'scripts.dev or scripts.start required' };
  }
  return { ok: true, design };
}

export function parseProjectDesignJson(text: string):
  | { ok: true; design: ProjectDesign }
  | { ok: false; error: string } {
  try {
    return parseProjectDesign(JSON.parse(text) as unknown);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'invalid JSON' };
  }
}

export function serializeProjectDesign(design: ProjectDesign): string {
  return `${JSON.stringify(design, null, 2)}\n`;
}

/** Local preview URL for iframe (localhost only). */
export function previewUrlForDesign(design: ProjectDesign): string | null {
  if (design.preview.type !== 'iframe' || !design.preview.port) return null;
  if (design.preview.url?.startsWith('http://127.0.0.1') || design.preview.url?.startsWith('http://localhost')) {
    return design.preview.url;
  }
  return `http://127.0.0.1:${design.preview.port}`;
}
