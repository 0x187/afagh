import { NextRequest, NextResponse } from 'next/server';
import { commit, ENTITIES, type Entity } from '@/lib/migration/engine';
import { parseTabular } from '@/lib/migration/tabular';
import { chooseTable } from '@/lib/migration/fields';
import { readUpload, requireMigrationAdmin } from '@/lib/migration/http';
import { assertSameOrigin } from '@/lib/security';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const _csrf = assertSameOrigin(req);
  if (_csrf) return _csrf;
  const auth = await requireMigrationAdmin();
  if ('res' in auth) return auth.res;

  const form = await req.formData();
  const entity = String(form.get('entity') || '') as Entity;
  const sourceCode = (String(form.get('sourceCode') || 'LEGACY').trim() || 'LEGACY').toUpperCase();
  const file = form.get('file') as File | null;
  // ترجیح کاربر در گام «بررسی ستون‌ها»: کدام شیت و کدام ستون یعنی چه
  const sheetWanted = String(form.get('sheet') || '').trim() || null;
  const columnMapRaw = String(form.get('columnMap') || '').trim() || null;
  // جایگزینی کد قدیمی با کد جدید (میز تطبیق کدها) — به‌صورت پیش‌فرض روشن
  const rewriteCodes = String(form.get('rewriteCodes') ?? '1') !== '0';
  // دانشگاه مقصد (سامانهٔ چنددانشگاهی): اگر ارسال شده باشد، رشته‌ها/دانشجویان
  // ساخته‌شده به همین دانشگاه می‌چسبند و تطبیق رشته فقط داخل آن انجام می‌شود.
  const universityId = Number(form.get('universityId')) || null;
  if (!ENTITIES.some(e => e.id === entity)) return NextResponse.json({ error: 'نوع داده نامعتبر' }, { status: 400 });
  if (!file) return NextResponse.json({ error: 'فایلی ارسال نشد' }, { status: 400 });

  try {
    const tables = parseTabular(file.name, await readUpload(file));
    if (!tables.length) return NextResponse.json({ error: 'در فایل هیچ جدولی پیدا نشد.' }, { status: 400 });
    const picked = chooseTable(tables, entity, sheetWanted, columnMapRaw);
    if (picked.error) return NextResponse.json({ error: picked.error }, { status: 400 });
    const report = await commit(auth.user.id, entity, [picked.table], file.name, sourceCode, rewriteCodes, universityId);
    return NextResponse.json({ ...report, sheet: picked.table.sheet, sheets: tables.map(t => t.sheet) });
  } catch (e) {
    // پیام گویا: علتِ واقعی خطا (متن پستگرس + نام قید) به کاربر نشان داده می‌شود
    const err = e as Error & { cause?: { message?: string; detail?: string; constraint?: string } };
    const parts = [
      err.message,
      err.cause?.message,
      err.cause?.detail,
      err.cause?.constraint ? `قید: ${err.cause.constraint}` : '',
    ].filter(Boolean);
    const detailMsg = parts.join(' — ');
    console.error('[api] migration/commit failed:', detailMsg);
    return NextResponse.json({ error: `خطای مهاجرت: ${detailMsg}` }, { status: 500 });
  }
}
