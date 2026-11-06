/**
 * ══════════════════════════════════════════════════════════════════════
 *  موتور اجرای گزارش‌های ذخیره‌شده (Report Engine)
 * ══════════════════════════════════════════════════════════════════════
 *  از یک «پیکربندی ذخیره‌شده» + «کاتالوگ» یک کوئری SQL می‌سازد و اجرا می‌کند.
 *
 *  🔒 امنیت — سه قاعدهٔ سخت:
 *   ۱) هر عبارتِ SQL (FROM، ستون‌ها، GROUP BY، ORDER BY) **فقط** از کاتالوگِ
 *      کد می‌آید. هیچ رشته‌ای از کاربر به SQL راه نمی‌کند.
 *   ۲) هر **مقدار**ِ فیلتر به‌صورت bind parameter می‌رود (نه الحاق رشته).
 *   ۳) نامِ ستون‌های خروجی (alias) با یک الگوی سختِ `^[A-Za-z_][A-Za-z0-9_]*$`
 *      اعتبارسنجی می‌شود.
 *  ⇒ با حذف قاعدهٔ ۱ و ۳ (یعنی اگر کاتالوگ به‌جای کد از دیتابیس می‌آمد)
 *    تزریق SQL ممکن می‌شد. چون کاتالوگ کدی است، سطح حمله صفر است.
 *
 *  اسکوپِ دانشگاه: fail-closed — بدون دانشگاهِ معتبر هیچ ردیفی برنمی‌گردد.
 */

import { sql, type SQL } from 'drizzle-orm';
import { db } from '@/db';
import { escapeLikeChars, toEnDigits } from '@/lib/persian-search';
import { formatReportCell } from '@/lib/report-format';
import type { ReportColumn, ReportResult } from '../report-helpers';
import {
  getField,
  getSource,
  type AggKind,
  type FilterOp,
  type OptionRef,
  type ReportField,
  type ReportSource,
  type SavedReportConfig,
} from '../catalog';
import { DEPOSIT_TYPES, LEDGER_TYPES, PAYMENT_STATUSES } from '../catalog/finance';

export const PER = 50;

/** سقفِ سختِ ردیف — محافظِ سرور در برابر گزارش‌های سنگین */
export const HARD_MAX_ROWS = 50_000;

/** گزینه‌های پویا که موتور برای نمایشِ فارسیِ مقادیر لازم دارد */
export type OptionMaps = Partial<Record<OptionRef, { value: string; label: string }[]>>;

const DEFAULT_OPTIONS: OptionMaps = {
  ledgerTypes: LEDGER_TYPES,
  depositTypes: DEPOSIT_TYPES,
  paymentStatuses: PAYMENT_STATUSES,
};

// ── نگاشتِ عملگر → SQL (فهرست بسته) ──
const OP_SQL: Record<FilterOp, string> = {
  eq: '=', ne: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=',
  like: 'ILIKE', in: 'IN', between: 'BETWEEN', isnull: 'IS NULL', notnull: 'IS NOT NULL',
};

/** عملگرهایی که مقدار می‌خواهند */
const NEEDS_VALUE: FilterOp[] = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'like', 'in', 'between'];

/** اعتبارسنجیِ شناسه (alias) — تنها جایی که یک شناسه از سمت ما می‌آید */
function safeIdent(s: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(s)) {
    throw new Error(`شناسهٔ ستون نامعتبر: ${s}`);
  }
  return s;
}

/** ساختِ پارامترِ مقدار با نوعِ درست (تا Postgres مجبور به حدس نباشد) */
function valueParam(field: ReportField, raw: unknown): SQL {
  switch (field.type) {
    case 'number':
    case 'money':
      return sql`${Number(raw)}::numeric`;
    case 'date':
      return sql`${String(raw)}::date`;
    case 'datetime':
      return sql`${String(raw)}::timestamp`;
    case 'bool':
      return sql`${raw === true || raw === 'true' || raw === '1'}::boolean`;
    default:
      return sql`${String(raw)}`;
  }
}

/** ستونِ نمایشیِ حل‌شده */
type ResolvedColumn = {
  alias: string;
  title: string;
  expr: SQL;
  rawExpr: string;
  field: ReportField;
  isAgg: boolean;
  format?: ReportColumn['format'];
};

export type RunOptions = {
  universityId: number;
  page?: number;
  per?: number;
  options?: OptionMaps;
};

export type EngineResult = ReportResult & {
  /** پیام‌های اطلاعی (مثل بریده‌شدنِ خروجی) */
  notes?: string[];
};

/**
 * اجرای گزارش از روی پیکربندی.
 * @throws اگر منبع یا ستون‌ها نامعتبر باشند (fail-closed)
 */
export async function runCatalogReport(
  sourceKey: string,
  config: SavedReportConfig,
  opts: RunOptions,
): Promise<EngineResult> {
  const source = getSource(sourceKey);
  if (!source) throw new Error(`منبعِ ناشناخته: ${sourceKey}`);

  const options = { ...DEFAULT_OPTIONS, ...(opts.options ?? {}) };
  const notes: string[] = [];

  // ── ۱) حلِ ستون‌ها ──
  const columns = resolveColumns(source, config, notes);
  if (!columns.length) throw new Error('هیچ ستونِ معتبری انتخاب نشده است.');

  // ── ۲) شرط‌ها ──
  const where = buildWhere(source, config, opts.universityId);

  // ── ۳) گروه‌بندی ──
  const hasAgg = columns.some(c => c.isAgg);
  let groupBy: SQL | null = null;
  if (hasAgg) {
    const parts: string[] = [];
    // کلیدهای طبیعیِ منبع (مثل s.id برای «یک ردیف به‌ازای هر دانشجو»)
    for (const g of source.groupKeys ?? []) parts.push(g);
    // گروه‌بندیِ انتخابیِ کاربر
    for (const g of config.groupBy ?? []) {
      const f = getField(source, g);
      if (f && f.groupable) parts.push(f.sql);
    }
    // هر ستونِ غیرتجمیعیِ انتخاب‌شده هم باید در GROUP BY باشد
    for (const c of columns) if (!c.isAgg) parts.push(c.rawExpr);
    const uniq = [...new Set(parts)];
    if (uniq.length) groupBy = sql`GROUP BY ${sql.join(uniq.map(p => sql.raw(p)), sql`, `)}`;
  }

  // ── ۴) ترتیب ──
  const orderBy = buildOrderBy(source, config, columns);

  // ── ۵) اجرا ──
  // 🔒 شناسه‌ها داخل گیومه: Postgres شناسهٔ بدون گیومه را به حروف کوچک می‌برد
  //    (studentCode → studentcode) و آن‌وقت کلیدِ ردیف با کلیدِ ستون ناهماهنگ
  //    می‌شود (عنوانِ فارسی، قالبِ مبلغ و خروجی CSV همه «—» می‌شدند).
  //    safeIdent قبلاً تضمین کرده که نام فقط از [A-Za-z0-9_] تشکیل شده است.
  const selectList = sql.join(columns.map(c => sql`${c.expr} AS ${sql.identifier(c.alias)}`), sql`, `);
  // بدنهٔ کوئری: «SELECT <ستون‌ها> <FROM> <WHERE> <GROUP BY> <ORDER BY>»
  // (همین بدنه هم برای شمارش داخل پرانتز و هم برای دادهٔ صفحه استفاده می‌شود)
  const body = sql`SELECT ${selectList} ${sql.raw(source.baseFrom)} ${where} ${groupBy ?? sql``} ${orderBy}`;

  const cap = Math.min(source.maxRows ?? HARD_MAX_ROWS, HARD_MAX_ROWS);
  const per = Math.max(1, Math.min(opts.per ?? PER, 200));
  const page = Math.max(1, opts.page ?? 1);

  const cnt = await db.execute<{ n: string }>(
    sql`SELECT COUNT(*)::int AS n FROM (${body}) t`,
  );
  const totalRaw = Number(cnt.rows[0]?.n ?? 0);
  const total = Math.min(totalRaw, cap);
  if (totalRaw > cap) {
    notes.push(`خروجی به سقفِ ${cap.toLocaleString('fa-IR')} ردیف محدود شد (کلِ رکوردهای منطبق: ${totalRaw.toLocaleString('fa-IR')}).`);
  }
  const totalPages = Math.max(1, Math.ceil(total / per));
  const safePage = Math.min(page, totalPages);

  const data = await db.execute<Record<string, unknown>>(
    sql`${body} LIMIT ${per} OFFSET ${(safePage - 1) * per}`,
  );

  // ── ۶) برچسبِ فارسیِ مقادیرِ انتخابی ──
  const rows = data.rows.map(r => {
    const out: Record<string, unknown> = { ...r };
    for (const c of columns) {
      const map = options[c.field.ref as OptionRef];
      if (!map || !c.field.ref) continue;
      const hit = map.find(o => o.value === String(r[c.alias]));
      if (hit) out[c.alias] = hit.label;
    }
    return out;
  });

  const reportColumns: ReportColumn[] = columns.map(c => ({ key: c.alias, title: c.title, format: c.format }));

  return {
    columns: reportColumns,
    rows,
    total,
    page: safePage,
    per,
    totalPages,
    notes: notes.length ? notes : undefined,
  };
}

/** حلِ ستون‌های انتخاب‌شده: alias، عنوان، عبارت SQL و اینکه تجمیعی هست یا نه */
function resolveColumns(source: ReportSource, config: SavedReportConfig, notes: string[]): ResolvedColumn[] {
  const out: ResolvedColumn[] = [];
  const used = new Set<string>();

  for (const col of config.columns ?? []) {
    const field = getField(source, col.field);
    if (!field) {
      notes.push(`ستونِ «${col.field}» در این منبع وجود ندارد و نادیده گرفته شد.`);
      continue;
    }

    let isAgg = false;
    let exprText = field.sql;
    let alias = field.key;

    if (col.agg) {
      // تجمیعِ صریحِ انتخابیِ کاربر روی این ستون
      const built = buildAgg(col.agg, field);
      if (!built) {
        notes.push(`تجمیعِ «${col.agg}» روی ستونِ «${field.title}» مجاز نیست و نادیده گرفته شد.`);
        continue;
      }
      exprText = built;
      isAgg = true;
      alias = `${field.key}__${col.agg}`;
    } else if (field.aggSql) {
      // ستونی که ذاتاً تجمیعی است (مثل «ماندهٔ بدهی»)
      exprText = field.aggSql;
      isAgg = true;
    }

    if (used.has(alias)) continue; // ستونِ تکراری
    used.add(alias);

    out.push({
      alias: safeIdent(alias),
      title: col.alias?.trim() || (col.agg ? `${aggTitle(col.agg)} ${field.title}` : field.title),
      expr: sql.raw(exprText),
      rawExpr: exprText,
      field,
      isAgg,
      format: col.format ?? field.format,
    });
  }
  return out;
}

/**
 * ساختِ عبارتِ تجمیع برای یک ستون.
 *
 * قاعده:
 *  • `count` / `count_distinct` روی هر ستونِ **سطح‌ردیف** مجازند (شمارشِ
 *    مقدارهای غیر-NULL) — به همین دلیل در `agg` هر فیلد لازم نیست تکرار شوند.
 *  • `sum`/`avg`/`min`/`max` فقط اگر فیلد در فهرستِ `agg` خودش آن‌ها را داشته باشد
 *    (یعنی عددی باشد).
 *  • فیلدهایی که `aggSql` دارند (مثل «ماندهٔ بدهی») خودشان یک محاسبهٔ ثابت‌اند؛
 *    جمع/میانگینِ ساده روی عبارتِ پایه‌شان گمراه‌کننده است، پس رد می‌شوند.
 */
function buildAgg(kind: AggKind, field: ReportField): string | null {
  if (field.aggSql) return null; // محاسبهٔ ثابت — قابل تجمیع روی عبارتِ پایه نیست
  if (kind === 'count') return `COUNT(${field.sql})`;
  if (kind === 'count_distinct') return `COUNT(DISTINCT ${field.sql})`;
  if (!field.agg?.includes(kind)) return null;
  switch (kind) {
    case 'sum': return `SUM(${field.sql})`;
    case 'avg': return `AVG(${field.sql})`;
    case 'min': return `MIN(${field.sql})`;
    case 'max': return `MAX(${field.sql})`;
    default: return null;
  }
}

function aggTitle(kind: AggKind): string {
  switch (kind) {
    case 'sum': return 'جمع';
    case 'avg': return 'میانگین';
    case 'min': return 'کمینه';
    case 'max': return 'بیشینه';
    case 'count': return 'تعداد';
    case 'count_distinct': return 'تعداد یکتا';
    default: return kind;
  }
}

/** WHERE: اسکوپِ دانشگاه + شرطِ ثابتِ منبع + فیلترهای کاربر */
function buildWhere(source: ReportSource, config: SavedReportConfig, universityId: number): SQL {
  const conds: SQL[] = [];

  // اسکوپِ دانشگاه (fail-closed) — جدول‌های nullable الگوی «یا NULL» دارند
  const uc = sql.raw(source.universityColumn);
  conds.push(
    source.universityNullable
      ? sql`(${uc} = ${universityId} OR ${uc} IS NULL)`
      : sql`${uc} = ${universityId}`,
  );

  if (source.where) conds.push(sql.raw(source.where));

  for (const f of config.filters ?? []) {
    const field = getField(source, f.field);
    if (!field) continue;
    if (!field.filterable) continue;
    if (field.ops && !field.ops.includes(f.op)) continue;
    if (!OP_SQL[f.op]) continue;

    const expr = sql.raw(field.sql);

    if (f.op === 'isnull') { conds.push(sql`${expr} IS NULL`); continue; }
    if (f.op === 'notnull') { conds.push(sql`${expr} IS NOT NULL`); continue; }
    if (!NEEDS_VALUE.includes(f.op)) continue;

    // مقدار: نرمال‌سازیِ ارقامِ فارسی + پاک‌سازی
    const raw = Array.isArray(f.value) ? f.value : [String(f.value ?? '')];
    const vals = raw.map(v => String(v ?? '').trim()).filter(v => v !== '');
    if (!vals.length) continue;

    switch (f.op) {
      case 'like': {
        const like = `%${escapeLikeChars(toEnDigits(vals[0]))}%`;
        conds.push(sql`${expr} ILIKE ${like} ESCAPE '\\'`);
        break;
      }
      case 'in': {
        conds.push(sql`${expr} IN (${sql.join(vals.map(v => valueParam(field, v)), sql`, `)})`);
        break;
      }
      case 'between': {
        if (vals.length < 2) break;
        conds.push(sql`${expr} BETWEEN ${valueParam(field, vals[0])} AND ${valueParam(field, vals[1])}`);
        break;
      }
      default: {
        conds.push(sql`${expr} ${sql.raw(OP_SQL[f.op])} ${valueParam(field, vals[0])}`);
      }
    }
  }

  if (!conds.length) return sql``;
  return sql`WHERE ${sql.join(conds, sql` AND `)}`;
}

/** ORDER BY — فقط روی ستون‌های انتخاب‌شده یا فیلدهای گروه‌بندی‌پذیر */
function buildOrderBy(source: ReportSource, config: SavedReportConfig, columns: ResolvedColumn[]): SQL {
  const order = config.orderBy ?? [];
  const parts: SQL[] = [];

  for (const o of order) {
    const col = columns.find(c => c.field.key === o.field || c.alias === o.field);
    if (col) {
      parts.push(sql`${sql.identifier(col.alias)} ${sql.raw(o.dir === 'desc' ? 'DESC' : 'ASC')}`);
      continue;
    }
    const f = getField(source, o.field);
    if (f && f.groupable) {
      parts.push(sql`${sql.raw(f.sql)} ${sql.raw(o.dir === 'desc' ? 'DESC' : 'ASC')}`);
    }
  }

  // بدون ترتیبِ صریح: روی اولین ستون مرتب کن تا خروجی پایدار باشد
  if (!parts.length && columns.length) {
    parts.push(sql`${sql.identifier(columns[0].alias)} ASC`);
  }
  if (!parts.length) return sql``;
  return sql`ORDER BY ${sql.join(parts, sql`, `)}`;
}

/**
 * خروجیِ اکسل/CSV — همهٔ صفحه‌ها را پیمایش می‌کند.
 * (همان الگوی exportReport در reports/actions.ts: قالب‌بندیِ سمت سرور +
 *  گاردِ تزریقِ فرمولِ CSV)
 */
export async function exportCatalogReport(
  sourceKey: string,
  config: SavedReportConfig,
  opts: RunOptions & { maxRows?: number },
): Promise<{ header: string[]; lines: string[][] }> {
  const cap = Math.min(opts.maxRows ?? 5000, HARD_MAX_ROWS);
  const per = 200;
  const header: string[] = [];
  const lines: string[][] = [];

  // 🔒 گارد تزریق فرمول CSV: مقادیری که با = + - @ | یا تب/CR شروع شوند
  //    با «'» خنثی می‌شوند (همان کاری که exportReport می‌کند).
  const esc = (v: string) => (/^[=+\-@|\t\r]/.test(v.trimStart()) ? `'${v}` : v);

  let page = 1;
  let total = 0;
  do {
    const r = await runCatalogReport(sourceKey, config, { ...opts, page, per });
    if (!header.length) header.push(...r.columns.map(c => esc(c.title)));
    for (const row of r.rows) {
      lines.push(r.columns.map(c => esc(formatReportCell(row[c.key], c.format))));
      total++;
    }
    page++;
    if (total >= cap) break;
    if (page > r.totalPages) break;
  } while (true);

  return { header, lines };
}
