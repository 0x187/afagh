// ═══ کلاینت قالب‌های اعلان ═══
import { apiGet, apiPost } from './api';

export type TemplateVars = { tag: string; label: string; sampleValue: string };
export type SavedTemplateRow = {
  eventCode: string; title: string; templateText: string;
  variables: TemplateVars[]; channels: string; isActive: boolean;
};

export async function listTemplates(): Promise<SavedTemplateRow[]> {
  const res = await apiGet<{ ok: boolean; data: { templates: SavedTemplateRow[] } }>('/admin/templates');
  return res.data.templates;
}

export async function saveTemplate(input: SavedTemplateRow): Promise<void> {
  await apiPost('/admin/templates', input);
}

export async function sendTemplateTest(channel: string, identifier: string): Promise<string> {
  const res = await apiPost<{ ok: boolean; data: { message: string } }>('/admin/templates/test', { channel, identifier });
  return res.data.message;
}
