/**
 * ════════════════════════════════════════════════════════════════════════
 *  گاردِ Disaster Recovery — src/lib/backup-schema.ts + backup-dump.ts
 *
 *  تست سخت کشف کرد که دامپ قبلی data-only است: روی Postgres خالی شکست میخورد
 *  (`relation …_id_seq does not exist`) و حتی با حذف DEFAULTها هیچ PK/FK/INDEX/
 *  RLS/SEQUENCEـای برنمیگردد. این تست یک اسکیمای مصنوعی اما کامل میسازد،
 *  ژنراتور DDL را روی آن اجرا میکند، سپس «pre + INSERTها + post» را روی یک
 *  PGlite کاملاً تازه restore میکند و کاتالوگ دو دیتابیس را مقایسه مینماید.
 *
 *  همچنین لیترالسازی سمتسرور را برای jsonb/array/bytea/بکاسلش/تاریخ و ردکشن
 *  رازها بررسی میکند (String(v) قبلاً jsonb را [object Object] میکرد).
 * ════════════════════════════════════════════════════════════════════════
 */
import { PGlite } from '@electric-sql/pglite';
import { buildSchemaDump, type CatalogQuery } from '../src/lib/backup-schema';
import { buildRowLiteralSql, insertHead } from '../src/lib/backup-dump';

let pass = 0;
let fail = 0;
const ok = (c: boolean, m: string): void => {
  if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); }
};
const eq = (a: unknown, b: unknown, m: string): void => ok(a === b, `${m} (${String(a)} === ${String(b)})`);

const SETUP = `
CREATE ROLE afagh_app;
CREATE TYPE public.mood AS ENUM ('happy', 'sad');
CREATE SCHEMA drizzle;

CREATE TABLE public.departments (
  id serial PRIMARY KEY,
  name varchar(50) NOT NULL UNIQUE,
  meta jsonb,
  tags text[],
  raw bytea,
  note text,
  created_at timestamptz DEFAULT now()
);
CREATE TABLE public.people (
  id serial PRIMARY KEY,
  dept_id integer NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  score numeric(10,2) DEFAULT 0,
  active boolean DEFAULT true,
  extra jsonb,
  mood public.mood DEFAULT 'happy',
  CONSTRAINT people_score_nonneg CHECK (score >= 0)
);
CREATE INDEX idx_people_name ON public.people (full_name);
CREATE UNIQUE INDEX uq_people_active ON public.people (full_name) WHERE active;
ALTER TABLE public.people ENABLE ROW LEVEL SECURITY;
CREATE POLICY people_self ON public.people FOR SELECT TO afagh_app USING (id > 0);
GRANT SELECT ON public.people TO afagh_app;
GRANT UPDATE (full_name) ON public.people TO afagh_app;
GRANT USAGE, SELECT ON SEQUENCE public.people_id_seq TO afagh_app;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT ON TABLES TO afagh_app;

CREATE FUNCTION public.fa_norm(t text) RETURNS text LANGUAGE sql IMMUTABLE
  AS $fn$ SELECT trim(t) $fn$;
CREATE VIEW public.v_people AS SELECT id, full_name FROM public.people;

CREATE TABLE public.system_settings (key varchar(80) PRIMARY KEY, value text);
CREATE TABLE public.payment_gateways (id serial PRIMARY KEY, config jsonb);

CREATE TABLE drizzle.__drizzle_migrations (
  id serial PRIMARY KEY, hash text NOT NULL, created_at bigint NOT NULL
);

INSERT INTO public.departments (name, meta, tags, raw, note)
VALUES ('فنی', '{"k":"v"}', '{a,b,c}', decode('deadbeef','hex'), E'back\\\\slash');
INSERT INTO public.people (dept_id, full_name, score, active, extra, mood)
VALUES (1, 'علی رضایی', 12.50, true, '{"arr":[1,2]}', 'happy');
INSERT INTO public.people (dept_id, full_name, score, active, extra, mood)
VALUES (1, 'مریم', 0, false, NULL, 'sad');
INSERT INTO public.system_settings (key, value) VALUES ('SITE_TITLE', 'آفاق');
INSERT INTO public.system_settings (key, value) VALUES ('API_SECRET_KEY', 'بسیار-محرمانه');
INSERT INTO public.payment_gateways (config) VALUES ('{"merchantId":"secret"}');
INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
VALUES ('abc', 1795700000000), ('def', 1795600000000);
`;

function adapter(db: PGlite): CatalogQuery {
  return async (sql, params = []) => {
    const r = await db.query(sql, params as any[]);
    return { rows: r.rows as any[] };
  };
}

async function counts(db: PGlite): Promise<Record<string, number>> {
  const q = adapter(db);
  const one = async (label: string, sql: string): Promise<number> => {
    const r = await q(sql);
    return Number(r.rows[0].n);
  };
  return {
    tables: await one('tables', "SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','drizzle') AND c.relkind='r'"),
    sequences: await one('sequences', "SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','drizzle') AND c.relkind='S'"),
    indexes: await one('indexes', "SELECT count(*)::int AS n FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','drizzle')"),
    constraints: await one('constraints', "SELECT count(*)::int AS n FROM pg_constraint con JOIN pg_namespace n ON n.oid=con.connamespace WHERE n.nspname IN ('public','drizzle') AND con.contype <> 'n'"),
    policies: await one('policies', "SELECT count(*)::int AS n FROM pg_policy"),
    rls: await one('rls', "SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity"),
    functions: await one('functions', "SELECT count(*)::int AS n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f'"),
    views: await one('views', "SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='v'"),
    types: await one('types', "SELECT count(*)::int AS n FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typtype='e'"),
  };
}

async function main(): Promise<void> {
  const src = new PGlite();
  await src.waitReady;
  await src.exec(SETUP);

  const dump = await buildSchemaDump(adapter(src));
  console.log('\n=== ژنراتور DDL ===');
  ok(dump.pre.includes('CREATE SEQUENCE'), 'pre حاوی CREATE SEQUENCE است');
  ok(!dump.pre.includes('ADD CONSTRAINT'), 'pre قیود را بعد از داده نمیاندازد');
  ok(dump.post.includes('ADD CONSTRAINT'), 'post حاوی ADD CONSTRAINT است');
  ok(dump.post.includes('ENABLE ROW LEVEL SECURITY'), 'post حاوی RLS است');
  ok(dump.post.includes('CREATE POLICY'), 'post حاوی POLICY است');
  ok(dump.post.includes('CREATE INDEX'), 'post حاوی CREATE INDEX است');
  ok(dump.post.includes('setval'), 'post حاوی setval است');
  ok(dump.post.includes('GRANT'), 'post حاوی GRANT است');
  ok(dump.dataTables.some(t => t.schema === 'drizzle'), 'جدول drizzle در فهرست دادهها هست');
  eq(dump.manifest.tables, 5, 'manifest.tables');
  eq(dump.manifest.sequences, 4, 'manifest.sequences');
  eq(dump.manifest.policies, 1, 'manifest.policies');
  eq(dump.manifest.drizzleMigrations, 2, 'manifest.drizzleMigrations');

  // ── تولید INSERTها دقیقاً مثل openSignedDumpStream ──
  let dataSql = '';
  for (const t of dump.dataTables) {
    const expr = buildRowLiteralSql(t.schema, t.name, t.insertColumns, true);
    const r = await src.query(
      `SELECT ${expr} AS lit FROM "${t.schema}"."${t.name}"`,
    );
    const rows = (r.rows as any[]).map(x => String(x.lit));
    if (rows.length) dataSql += insertHead(t.schema, t.name, t.insertColumns, t.hasIdentityAlways) + rows.join(',\n') + ';\n';
  }
  console.log('\n=== لیترالها و ردکشن ===');
  ok(dataSql.includes("'[REDACTED]'") && !dataSql.includes('بسیار-محرمانه'), 'system_settings: راز ردکشن شد');
  ok(dataSql.includes("'آفاق'"), 'system_settings: مقدار عادی حفظ شد');
  ok(dataSql.includes('"redacted":true') && !dataSql.includes('merchantId'), 'jsonb payment_gateways: جایگزین JSON معتبر');
  ok(dataSql.includes('{"k": "v"}'), 'jsonb معمولی سالم ماند');
  ok(dataSql.includes("'{a,b,c}'"), 'آرایه به لیترال Postgres تبدیل شد');
  ok(dataSql.includes('\\xdeadbeef'), 'bytea به فرمت هگز سالم ماند');

  const fullExpr = buildRowLiteralSql('public', 'system_settings', ['key', 'value'], false);
  const fullRows = await src.query(`SELECT ${fullExpr} AS lit FROM public.system_settings`);
  ok((fullRows.rows as any[]).some(r => String(r.lit).includes('بسیار-محرمانه')), 'حالت includeSecrets ردکشن نمیکند');

  // ── restore روی دیتابیس کاملاً خالی ──
  const dst = new PGlite();
  await dst.waitReady;
  let restoreOk = true;
  let restoreErr = '';
  try {
    await dst.exec(dump.pre + '\n' + dataSql + '\n' + dump.post);
  } catch (e) {
    restoreOk = false;
    restoreErr = String((e as Error).message).split('\n').slice(0, 3).join(' | ');
  }
  console.log('\n=== restore روی Postgres خالی ===');
  ok(restoreOk, `RESTORE_RESULT=OK ${restoreOk ? '' : '→ ' + restoreErr}`);

  if (restoreOk) {
    const a = await counts(src);
    const b = await counts(dst);
    for (const k of Object.keys(a)) eq(b[k], a[k], `کاتالوگ ${k}`);

    const dept = await dst.query('SELECT name, meta, tags, raw, note FROM public.departments');
    const d = (dept.rows as any[])[0];
    eq(d.name, 'فنی', 'دادهٔ فارسی');
    ok(JSON.stringify(d.meta) === JSON.stringify({ k: 'v' }), 'دادهٔ jsonb');
    ok(JSON.stringify(d.tags) === JSON.stringify(['a', 'b', 'c']), 'دادهٔ آرایه');
    ok(Buffer.from(d.raw).toString('hex') === 'deadbeef', 'دادهٔ bytea');
    ok(String(d.note).includes('back\\slash'), 'بکاسلش');

    const people = await dst.query('SELECT count(*)::int AS n FROM public.people');
    eq((people.rows as any[])[0].n, 2, 'تعداد ردیفهای people');
    const dm = await dst.query('SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations');
    eq((dm.rows as any[])[0].n, 2, 'تاریخچۀ مهاجرتها برگشت');

    let nextOk = false;
    try {
      const nx = await dst.query("SELECT nextval('public.people_id_seq') AS n");
      nextOk = Number((nx.rows as any[])[0].n) > 2;
    } catch { /* عمداً خالی */ }
    ok(nextOk, 'sequence بعد از restore ردیف تکراری نمیدهد');

    const fn = await dst.query("SELECT public.fa_norm('  x  ') AS v");
    eq((fn.rows as any[])[0].v, 'x', 'تابع برگشت');
    const vw = await dst.query('SELECT count(*)::int AS n FROM public.v_people');
    eq((vw.rows as any[])[0].n, 2, 'view برگشت');
  }
  await src.close();
  await dst.close();

  console.log(`\n${pass} قبول / ${fail} رد`);
  if (fail) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
