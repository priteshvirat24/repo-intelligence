import type { BuildRoadmapItem } from '@repo/shared';

// The work items a build can be authorised for, read defensively from the blueprint: roadmap tasks when the
// blueprint has a roadmap (a list, or { tasks: [...] }), otherwise its to-build items. Keep in step with
// apps/worker/builder/scope.py roadmap_items: the worker resolves the same ids.

function strings(value: unknown, limit = 12, size = 400): string[] {
  const list = typeof value === 'string' ? [value] : Array.isArray(value) ? value : [];
  const out: string[] = [];
  for (const v of list) {
    const text = v && typeof v === 'object' ? (v as any).text || (v as any).description || (v as any).name || (v as any).title : v;
    if (typeof text === 'string' && text.trim()) out.push(text.trim().slice(0, size));
  }
  return out.slice(0, limit);
}

function items(container: unknown): unknown[] {
  if (Array.isArray(container)) return container;
  if (container && typeof container === 'object') {
    for (const key of ['tasks', 'items', 'steps']) {
      const v = (container as any)[key];
      if (Array.isArray(v)) return v;
    }
  }
  return [];
}

export function roadmapItems(blueprint: unknown): BuildRoadmapItem[] {
  const bp: any = blueprint && typeof blueprint === 'object' ? blueprint : {};
  const out: BuildRoadmapItem[] = [];
  items(bp.roadmap).forEach((t: any, i) => {
    if (!t || typeof t !== 'object') return;
    const title = t.title || t.name || t.task;
    if (typeof title !== 'string' || !title.trim()) return;
    out.push({
      id: String(t.id || `roadmap-${i + 1}`).slice(0, 80),
      title: title.trim().slice(0, 200),
      detail: String(t.description || t.detail || '').slice(0, 1200),
      acceptanceCriteria: strings(t.acceptanceCriteria || t.acceptance_criteria || t.acceptance),
      tests: strings(t.testRequirements || t.tests || t.test_requirements),
      requirements: strings(t.requirements || t.requirement, 10, 200),
      source: 'roadmap'
    });
  });
  if (out.length) return out;
  (Array.isArray(bp.toBuild) ? bp.toBuild : []).forEach((t: any, i: number) => {
    if (t && typeof t.title === 'string' && t.title.trim()) {
      out.push({
        id: `build-${i + 1}`,
        title: t.title.trim().slice(0, 200),
        detail: String(t.detail || '').slice(0, 1200),
        acceptanceCriteria: [],
        tests: [],
        requirements: strings(t.requirements, 10, 200),
        source: 'toBuild'
      });
    }
  });
  return out;
}
