/**
 * ژنراتور DDL کامل برای پشتیبانِ Disaster Recovery.
 *
 * چرا این فایل جدا و بدون `'use server'` است؟
 *   ۱) دامپ فعلی فقط `information_schema.columns` را مینوشت ⇒ data-only بود و
 *      روی دیتابیس خالی حتی `CREATE SEQUENCE` هم نداشت (تست سخت PGlite قرمز شد).
 *   ۲) این ماژول خالص است: تنها به یک تابع `query` وابسته است، بنابراین هم در
 *      `pg.PoolClient` پروداکشن و هم در PGliteِ تست قابل اجراست (بدون Next.js).
 *
 * ترتیب emit در `openSignedDumpStream`:
 *   pre  → پاکسازی، نقشها، schemaها، extensionها، enumها، sequenceها، جدولها
 *   data → INSERTها (وسط؛ موقعی که هنوز constraint/RLS فعالبندی نشده)
 *   post → OWNED BY، constraintها، indexها، RLS/policyها، view/function/trigger،
 *          GRANTها، setvalها
 *
 * تمام DDL از توابع رسمی کاتالوگ (`pg_get_constraintdef`, `pg_get_indexdef`,
 * `pg_get_expr`, `format_type`, …) گرفته میشود و پیش از آن `search_path=''`
 * ست میگردد تا نامها حتماً schema-qualified باشند؛ یعنی فایل خروجی به ترتیبِ
 * `search_path` مقصد وابسته نیست. خروجی SQL ساده است (نه psql meta-command)
 * ⇒ هم `psql` و هم درایور `pg` آن را اجرا میکنند.
 */

export type CatalogQuery = (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>;

export const BACKUP_FORMAT = 'afagh-dr/1';
export const DR_MODE_MARKER = '-- AFAGH_BACKUP_MODE=dr-schema';

/** بکاپِ موقت/پشتیبانِ خام PII عمداً وارد پشتیبان DR نمیشود (حاوی دادهٔ هویتی خام است). */
export const EXCLUDED_SCHEMAS = ['pii_backups'] as const;

export interface DataTable {
  schema: string;
  name: string;
  /** نام ستونها به ترتیب تعریفشده (برای `INSERT INTO ... (cols)`). */
  insertColumns: string[];
  /** ستونهای identity که هنگام درج نیازمند `OVERRIDING SYSTEM VALUE`اند. */
  hasIdentityAlways: boolean;
}

export interface BackupManifest {
  format: string;
  serverVersion: string;
  schemas: string[];
  excludedSchemas: string[];
  tables: number;
  sequences: number;
  indexes: number;
  constraints: number;
  policies: number;
  rlsTables: number;
  functions: number;
  views: number;
  triggers: number;
  grants: number;
  drizzleMigrations: number;
  redacted: boolean;
  /** فقط نام متغیرها — هیچ مقدار محرمانهای وارد فایل بکاپ نمیشود. */
  requiredEnv: string[];
  restoreCommand: string;
}

export interface SchemaDump {
  /** قبل از INSERTها. */
  pre: string;
  /** بعد از INSERTها. */
  post: string;
  manifest: Omit<BackupManifest, 'format' | 'serverVersion' | 'redacted' | 'requiredEnv' | 'restoreCommand' | 'excludedSchemas'> & {
    excludedSchemas: string[];
  };
  dataTables: DataTable[];
}

const qi = (s: string): string => '"' + String(s).replace(/"/g, '""') + '"';
const ql = (s: string): string => "'" + String(s).replace(/'/g, "''") + "'";
const qn = (schema: string, name: string): string => `${qi(schema)}.${qi(name)}`;

/** لیست env فقط «کلید» است؛ مقدار هرگز در بکاپ نوشته نمیشود. */
export const REQUIRED_ENV_KEYS = [
  'DATABASE_URL',
  'DATABASE_URL_APP',
  'DATABASE_URL_BACKUP',
  'POSTGRES_PASSWORD',
  'AFAGH_APP_DB_PASSWORD',
  'AFAGH_BACKUP_DB_PASSWORD',
  'AFAGH_PII_KEY',
  'AFAGH_BACKUP_SIGNING_KEY',
  'REDIS_URL',
  'REDIS_PASSWORD',
  'S3_ENDPOINT',
  'S3_PORT',
  'S3_BUCKET',
  'S3_ACCESS_KEY',
  'S3_SECRET_KEY',
  'MINIO_ROOT_USER',
  'MINIO_ROOT_PASSWORD',
  'APP_PORT',
  'APP_BIND',
] as const;

export const RESTORE_COMMAND = 'gunzip -c backup.sql.gz | psql -U afagh -d afagh_db';

/**
 * ساخت تمام DDL در همان تراکنش/اسنپشاتی که INSERTها از آن خوانده میشوند.
 * بنابراین schema و داده دقیقاً متعلق به یک لحظهاند (برخلاف pg_dump جداگانه).
 */
export async function buildSchemaDump(q: CatalogQuery): Promise<SchemaDump> {
  const ver = await q("SELECT current_setting('server_version') AS v");
  const serverVersion = String(ver.rows[0]?.v ?? '');

  const sch = await q(
    `SELECT nspname FROM pg_namespace
     WHERE nspname !~ '^pg_' AND nspname <> 'information_schema'
       AND nspname <> ALL ($1::text[])
     ORDER BY nspname`,
    [[...EXCLUDED_SCHEMAS]],
  );
  const schemas: string[] = sch.rows.map(r => String(r.nspname));
  if (!schemas.includes('public')) schemas.push('public');
  schemas.sort();
  const IN = schemas.map(ql).join(', ');

  // توابع pg_get_* بر اساس search_path جاری نامها را کوتاه میکنند. خالی کردن آن
  // باعث میشود نامها همیشه schema-qualified تولید شوند و در مقصد هم بدرستی اجرا گردند.
  await q("SELECT pg_catalog.set_config('search_path', '', false)");

  const pre: string[] = [];
  const post: string[] = [];

  pre.push(
    'SET client_encoding = \'UTF8\';',
    'SET standard_conforming_strings = on;',
    'SET check_function_bodies = false;',
    "SELECT pg_catalog.set_config('search_path', '', false);",
    'SET row_security = off;',
    '',
  );

  // ── ۱. نقشها ────────────────────────────────────────────────────────────
  // GRANTها و policyها به `afagh_app` ارجاع میدهند؛ روی دیتابیس تازه نقش وجود
  // ندارد. ساخت شرطی + تحمل کمبود مجوز ⇒ restore روی نصب تمیز هم نمی‌شکند.
  const rolesRes = await q("SELECT rolname FROM pg_roles WHERE rolname !~ '^pg_' ORDER BY rolname");
  const roles: string[] = rolesRes.rows.map(r => String(r.rolname));
  if (roles.length) {
    const blocks = roles.map(r =>
      `  BEGIN\n` +
      `    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${ql(r)}) THEN\n` +
      `      CREATE ROLE ${qi(r)};\n` +
      `    END IF;\n` +
      `  EXCEPTION WHEN insufficient_privilege THEN\n` +
      `    RAISE NOTICE ${ql(`نقش ${r} ساخته نشد (کمبود مجوز) — GRANTها ممکن است رد شوند.`)};\n` +
      `  END;`,
    ).join('\n');
    pre.push(`DO $afagh_roles$\nBEGIN\n${blocks}\nEND\n$afagh_roles$;`, '');
  }

  // ── ۲. پاکسازی و ساخت schemaها ────────────────────────────────────────────
  // DR یعنی «دیتابیس مقصد دقیقاً همان لحظه» ⇒ اسکیمای قبلی باید برود. این تنها
  // بخش مخرب فایل است و عمداً در بالاترین سطر و با توضیح آمده است.
  pre.push('-- ⚠ پاکسازی کامل اسکیمای مقصد (بازیابی Disaster Recovery).');
  for (const s of schemas) pre.push(`DROP SCHEMA IF EXISTS ${qi(s)} CASCADE;`);
  const nsRes = await q(
    `SELECT n.nspname, pg_get_userbyid(n.nspowner) AS owner,
            x.grantee AS grantee_oid, pg_get_userbyid(x.grantee) AS grantee_name,
            x.privilege_type AS priv
     FROM pg_namespace n
     CROSS JOIN LATERAL aclexplode(n.nspacl) x
     WHERE n.nspname IN (${IN}) AND n.nspacl IS NOT NULL`,
  );
  const schemaOwners = new Map<string, string>();
  const nspOwnerRes = await q(
    `SELECT nspname, pg_get_userbyid(nspowner) AS owner FROM pg_namespace WHERE nspname IN (${IN})`,
  );
  for (const r of nspOwnerRes.rows) schemaOwners.set(String(r.nspname), String(r.owner));
  for (const s of schemas) pre.push(`CREATE SCHEMA ${qi(s)};`);
  pre.push('');
  for (const [s, owner] of schemaOwners) {
    if (owner && roles.includes(owner)) pre.push(`ALTER SCHEMA ${qi(s)} OWNER TO ${qi(owner)};`);
  }
  const nspGrants = groupGrants(nsRes.rows, r => ({ schema: String(r.nspname), name: '', kind: 'schema' }));
  for (const g of nspGrants) {
    pre.push(`GRANT ${g.privs.join(', ')} ON SCHEMA ${qi(g.schema)} TO ${g.grantee === 'PUBLIC' ? 'PUBLIC' : qi(g.grantee)};`);
  }
  pre.push('');

  // ── ۳. extensionها و enumها ───────────────────────────────────────────────
  const extRes = await q(
    `SELECT e.extname, ns.nspname AS schema FROM pg_extension e
     JOIN pg_namespace ns ON ns.oid = e.extnamespace
     WHERE e.extname <> 'plpgsql' ORDER BY 1`,
  );
  for (const r of extRes.rows) {
    pre.push(`CREATE EXTENSION IF NOT EXISTS ${qi(String(r.extname))} WITH SCHEMA ${qi(String(r.schema))};`);
  }
  const enumRes = await q(
    `SELECT n.nspname AS schema, t.typname AS name,
            array_agg(e.enumlabel ORDER BY e.enumsortorder) AS labels
     FROM pg_type t
     JOIN pg_namespace n ON n.oid = t.typnamespace
     JOIN pg_enum e ON e.enumtypid = t.oid
     WHERE n.nspname IN (${IN}) AND t.typtype = 'e'
     GROUP BY n.nspname, t.typname ORDER BY 1, 2`,
  );
  for (const r of enumRes.rows) {
    const labels: string[] = Array.isArray(r.labels) ? r.labels : [];
    pre.push(`CREATE TYPE ${qn(String(r.schema), String(r.name))} AS ENUM (${labels.map(ql).join(', ')});`);
  }
  pre.push('');

  // ── ۴. sequenceها (پیش از جدولها چون DEFAULTها به آنها ارجاع میدهند) ───────
  const seqRes = await q(
    `SELECT n.nspname AS schema, c.relname AS name,
            format_type(s.seqtypid, NULL) AS typ,
            s.seqstart, s.seqincrement, s.seqmin, s.seqmax, s.seqcache, s.seqcycle,
            v.last_value
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     JOIN pg_sequence s ON s.seqrelid = c.oid
     LEFT JOIN pg_sequences v ON v.schemaname = n.nspname AND v.sequencename = c.relname
     WHERE c.relkind = 'S' AND n.nspname IN (${IN})
     ORDER BY n.nspname, c.relname`,
  );
  const seqRows = seqRes.rows;
  for (const r of seqRows) {
    pre.push(
      `CREATE SEQUENCE ${qn(String(r.schema), String(r.name))} AS ${r.typ}` +
      ` START WITH ${r.seqstart} INCREMENT BY ${r.seqincrement}` +
      ` MINVALUE ${r.seqmin} MAXVALUE ${r.seqmax} CACHE ${r.seqcache}` +
      ` ${r.seqcycle ? 'CYCLE' : 'NO CYCLE'};`,
    );
  }
  pre.push('');

  // ── ۵. جدولها (ستونها + DEFAULT؛ بدون constraint/index/RLS) ───────────────
  const tblRes = await q(
    `SELECT c.oid, n.nspname AS schema, c.relname AS name,
            c.relrowsecurity AS rls, c.relforcerowsecurity AS force_rls
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind IN ('r','p') AND n.nspname IN (${IN})
     ORDER BY n.nspname, c.relname`,
  );
  const dataTables: DataTable[] = [];
  let rlsTables = 0;
  for (const t of tblRes.rows) {
    const schema = String(t.schema);
    const name = String(t.name);
    const colsRes = await q(
      `SELECT a.attname, format_type(a.atttypid, a.atttypmod) AS typ,
              a.attnotnull, pg_get_expr(ad.adbin, ad.adrelid) AS def,
              a.attidentity, a.attgenerated, co.collname AS collation,
              cn.nspname AS collation_schema
       FROM pg_attribute a
       LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
       LEFT JOIN pg_collation co ON co.oid = a.attcollation
       LEFT JOIN pg_namespace cn ON cn.oid = co.collnamespace
       WHERE a.attrelid = $1::oid AND a.attnum > 0 AND NOT a.attisdropped
       ORDER BY a.attnum`,
      [t.oid],
    );
    const cols = colsRes.rows;
    if (!cols.length) continue;
    const defs = cols.map((c: any) => {
      let line = `  ${qi(String(c.attname))} ${c.typ}`;
      if (c.collation && c.collation !== 'default') {
        line += ` COLLATE ${qn(String(c.collation_schema), String(c.collation))}`;
      }
      if (c.attidentity) {
        line += ` GENERATED ${c.attidentity === 'a' ? 'ALWAYS' : 'BY DEFAULT'} AS IDENTITY`;
      } else if (c.attgenerated === 's' && c.def) {
        line += ` GENERATED ALWAYS AS (${c.def}) STORED`;
      } else if (c.def) {
        line += ` DEFAULT ${c.def}`;
      }
      if (c.attnotnull) line += ' NOT NULL';
      return line;
    });
    pre.push(`CREATE TABLE ${qn(schema, name)} (\n${defs.join(',\n')}\n);`, '');

    const insertColumns = cols
      .filter((c: any) => !c.attgenerated)
      .map((c: any) => String(c.attname));
    dataTables.push({
      schema, name, insertColumns,
      hasIdentityAlways: cols.some((c: any) => c.attidentity === 'a'),
    });
    if (t.rls || t.force_rls) {
      rlsTables++;
      post.push(`ALTER TABLE ${qn(schema, name)} ENABLE ROW LEVEL SECURITY;`);
      if (t.force_rls) post.push(`ALTER TABLE ${qn(schema, name)} FORCE ROW LEVEL SECURITY;`);
    }
  }

  // ── ۶. ownershipـ sequenceها (بعد از ساخت جدولها) ──────────────────────────
  const ownedRes = await q(
    `SELECT ns.nspname AS seq_schema, s.relname AS seq_name,
            tn.nspname AS tbl_schema, t.relname AS tbl_name, a.attname AS col
     FROM pg_depend d
     JOIN pg_class s ON s.oid = d.objid AND s.relkind = 'S'
     JOIN pg_namespace ns ON ns.oid = s.relnamespace
     JOIN pg_class t ON t.oid = d.refobjid
     JOIN pg_namespace tn ON tn.oid = t.relnamespace
     JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = d.refobjsubid
     WHERE d.classid = 'pg_class'::regclass AND d.refclassid = 'pg_class'::regclass
       AND d.deptype IN ('a','i') AND ns.nspname IN (${IN}) AND tn.nspname IN (${IN})`,
  );
  for (const r of ownedRes.rows) {
    post.push(
      `ALTER SEQUENCE ${qn(String(r.seq_schema), String(r.seq_name))}` +
      ` OWNED BY ${qn(String(r.tbl_schema), String(r.tbl_name))}.${qi(String(r.col))};`,
    );
  }
  post.push('');

  // ── ۷. constraintها (بعد از داده ⇒ ترتیب جدولها مهم نیست) ──────────────────
  const conRes = await q(
    `SELECT n.nspname AS schema, c.relname AS table_name, con.conname AS name,
            pg_get_constraintdef(con.oid) AS def, con.convalidated
     FROM pg_constraint con
     JOIN pg_class c ON c.oid = con.conrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname IN (${IN}) AND con.contype IN ('p','u','f','c','x')
     -- قیود یکتا/PK باید پیش از FKها ساخته شوند، وگرنه FK به جدولی ارجاع
     -- میدهد که هنوز کلید یکتایش ساخته نشده (تست سخت دقیقاً همین را گرفت).
     ORDER BY CASE con.contype
                WHEN 'p' THEN 0 WHEN 'u' THEN 1 WHEN 'x' THEN 2
                WHEN 'c' THEN 3 ELSE 4 END,
              n.nspname, c.relname, con.conname`,
  );
  for (const r of conRes.rows) {
    post.push(
      `ALTER TABLE ONLY ${qn(String(r.schema), String(r.table_name))}` +
      ` ADD CONSTRAINT ${qi(String(r.name))} ${r.def}` +
      `${r.convalidated === false ? ' NOT VALID' : ''};`,
    );
  }
  post.push('');

  // ── ۸. indexها (آنهایی که پشتوانهٔ constraint نیستند) ─────────────────────
  const idxRes = await q(
    `SELECT pg_get_indexdef(i.indexrelid) AS def
     FROM pg_index i
     JOIN pg_class c ON c.oid = i.indexrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname IN (${IN}) AND i.indisvalid
       AND NOT EXISTS (SELECT 1 FROM pg_constraint co WHERE co.conindid = i.indexrelid)
     ORDER BY 1`,
  );
  for (const r of idxRes.rows) post.push(`${r.def};`);
  post.push('');

  // ── ۹. policyها ───────────────────────────────────────────────────────────
  const polRes = await q(
    `SELECT n.nspname AS schema, c.relname AS table_name, p.polname AS name,
            p.polcmd, p.polpermissive,
            pg_get_expr(p.polqual, p.polrelid) AS qual,
            pg_get_expr(p.polwithcheck, p.polrelid) AS with_check,
            ARRAY(SELECT CASE WHEN u = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(u) END
                  FROM unnest(p.polroles) u ORDER BY u) AS roles
     FROM pg_policy p
     JOIN pg_class c ON c.oid = p.polrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname IN (${IN})
     ORDER BY n.nspname, c.relname, p.polname`,
  );
  const CMD: Record<string, string> = { '*': 'ALL', r: 'SELECT', a: 'INSERT', w: 'UPDATE', d: 'DELETE' };
  for (const r of polRes.rows) {
    const rs: string[] = Array.isArray(r.roles) ? r.roles : [];
    const to = rs.length ? rs.map(x => (x === 'PUBLIC' ? 'PUBLIC' : qi(x))).join(', ') : 'PUBLIC';
    let line = `CREATE POLICY ${qi(String(r.name))} ON ${qn(String(r.schema), String(r.table_name))}`;
    line += ` AS ${r.polpermissive ? 'PERMISSIVE' : 'RESTRICTIVE'}`;
    line += ` FOR ${CMD[String(r.polcmd)] ?? 'ALL'} TO ${to}`;
    if (r.qual) line += ` USING (${r.qual})`;
    if (r.with_check) line += ` WITH CHECK (${r.with_check})`;
    post.push(`${line};`);
  }
  post.push('');

  // ── ۱۰. viewها / functionها / triggerها ───────────────────────────────────
  const viewRes = await q(
    `SELECT n.nspname AS schema, c.relname AS name, c.relkind,
            pg_get_viewdef(c.oid, true) AS def
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind IN ('v','m') AND n.nspname IN (${IN}) ORDER BY 1, 2`,
  );
  for (const r of viewRes.rows) {
    post.push(
      `${r.relkind === 'm' ? 'CREATE MATERIALIZED VIEW' : 'CREATE VIEW'} ` +
      `${qn(String(r.schema), String(r.name))} AS\n${r.def}` +
      `${r.relkind === 'm' ? '\nWITH NO DATA' : ''};`,
    );
  }
  const fnRes = await q(
    `SELECT pg_get_functiondef(p.oid) AS def
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname IN (${IN}) AND p.prokind IN ('f','p','w') ORDER BY 1`,
  );
  for (const r of fnRes.rows) post.push(`${r.def};`);
  const trgRes = await q(
    `SELECT pg_get_triggerdef(t.oid) AS def
     FROM pg_trigger t
     JOIN pg_class c ON c.oid = t.tgrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE NOT t.tgisinternal AND n.nspname IN (${IN}) ORDER BY 1`,
  );
  for (const r of trgRes.rows) post.push(`${r.def};`);
  post.push('');

  // ── ۱۱. GRANTها ──────────────────────────────────────────────────────────
  // فقط ACLهای صریح (`relacl IS NOT NULL`)؛ ACL پیشفرض وابسته به مالک مقصد است و
  // صادر کردنش روی sequenceها دستورات نامعتبر تولید میکند.
  const relGrantsRes = await q(
    `SELECT n.nspname AS schema, c.relname AS name, c.relkind,
            x.grantee AS grantee_oid, pg_get_userbyid(x.grantee) AS grantee_name,
            x.privilege_type AS priv
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     CROSS JOIN LATERAL aclexplode(c.relacl) x
     WHERE n.nspname IN (${IN}) AND c.relacl IS NOT NULL
       AND c.relkind IN ('r','p','v','m','S')`,
  );
  let grants = 0;
  for (const g of groupGrants(relGrantsRes.rows, r => ({ schema: String(r.schema), name: String(r.name), kind: String(r.relkind) }))) {
    const target = g.kind === 'S' ? 'SEQUENCE' : 'TABLE';
    post.push(
      `GRANT ${g.privs.join(', ')} ON ${target} ${qn(g.schema, g.name)}` +
      ` TO ${g.grantee === 'PUBLIC' ? 'PUBLIC' : qi(g.grantee)};`,
    );
    grants++;
  }
  const colGrantsRes = await q(
    `SELECT n.nspname AS schema, c.relname AS name, a.attname AS col,
            x.grantee AS grantee_oid, pg_get_userbyid(x.grantee) AS grantee_name,
            x.privilege_type AS priv
     FROM pg_attribute a
     JOIN pg_class c ON c.oid = a.attrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
     CROSS JOIN LATERAL aclexplode(a.attacl) x
     WHERE n.nspname IN (${IN}) AND a.attacl IS NOT NULL AND a.attnum > 0`,
  );
  for (const g of groupGrants(colGrantsRes.rows, r => ({ schema: String(r.schema), name: String(r.name), kind: 'c', col: String(r.col) }))) {
    post.push(
      `GRANT ${g.privs.join(', ')}(${qi(g.col)}) ON TABLE ${qn(g.schema, g.name)}` +
      ` TO ${g.grantee === 'PUBLIC' ? 'PUBLIC' : qi(g.grantee)};`,
    );
    grants++;
  }
  const defAclRes = await q(
    `SELECT pg_get_userbyid(d.defaclrole) AS owner, ns.nspname AS schema,
            d.defaclobjtype AS objtype,
            x.grantee AS grantee_oid, pg_get_userbyid(x.grantee) AS grantee_name,
            x.privilege_type AS priv
     FROM pg_default_acl d
     LEFT JOIN pg_namespace ns ON ns.oid = d.defaclnamespace
     CROSS JOIN LATERAL aclexplode(d.defaclacl) x`,
  );
  const OBJ: Record<string, string> = { r: 'TABLES', S: 'SEQUENCES', f: 'FUNCTIONS', T: 'TYPES', n: 'SCHEMAS' };
  for (const g of groupGrants(defAclRes.rows, r => ({ schema: r.schema ? String(r.schema) : '', name: '', kind: `d:${r.objtype}:${r.owner}` }))) {
    const parts = g.kind.split(':');
    const objtype = parts[1];
    const owner = parts.slice(2).join(':');
    const obj = OBJ[objtype] ?? 'TABLES';
    post.push(
      `ALTER DEFAULT PRIVILEGES FOR ROLE ${qi(owner)}` +
      `${g.schema ? ` IN SCHEMA ${qi(g.schema)}` : ''}` +
      ` GRANT ${g.privs.join(', ')} ON ${obj} TO ${g.grantee === 'PUBLIC' ? 'PUBLIC' : qi(g.grantee)};`,
    );
    grants++;
  }
  for (const g of nspGrants) grants++;
  post.push('');

  // ── ۱۲. مقدار sequenceها (بعد از INSERTها، وگرنه ردیف بعدی تکراری میشود) ───
  for (const r of seqRows) {
    // `pg_sequences.last_value` برای sequence ای که هرگز استفاده نشده NULL است
    // ⇒ همان معنای is_called=false را دارد (کاتالوگ is_called ندارد).
    const unused = r.last_value === null || r.last_value === undefined;
    const val = unused ? r.seqstart : r.last_value;
    const called = !unused;
    post.push(
      `SELECT pg_catalog.setval(${ql(`${r.schema}.${r.name}`)}, ${val}, ${called ? 'true' : 'false'});`,
    );
  }
  post.push('');

  let drizzleMigrations = 0;
  try {
    const dm = await q('SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations');
    drizzleMigrations = Number(dm.rows[0]?.n ?? 0);
  } catch { /* اسکیمای drizzle ممکن است در نصبهای قدیمی نباشد */ }

  return {
    pre: pre.join('\n'),
    post: post.join('\n'),
    manifest: {
      schemas,
      excludedSchemas: [...EXCLUDED_SCHEMAS],
      tables: tblRes.rows.length,
      sequences: seqRows.length,
      indexes: idxRes.rows.length,
      constraints: conRes.rows.length,
      policies: polRes.rows.length,
      rlsTables,
      functions: fnRes.rows.length,
      views: viewRes.rows.length,
      triggers: trgRes.rows.length,
      grants,
      drizzleMigrations,
    },
    dataTables,
  };
}

type GrantKey = { schema: string; name: string; kind: string; col?: string };

function groupGrants(rows: any[], keyOf: (r: any) => GrantKey): {
  schema: string; name: string; kind: string; col: string; grantee: string; privs: string[];
}[] {
  const map = new Map<string, { schema: string; name: string; kind: string; col: string; grantee: string; privs: Set<string> }>();
  for (const r of rows) {
    const k = keyOf(r);
    const grantee = String(r.grantee_oid) === '0' ? 'PUBLIC' : String(r.grantee_name ?? '');
    if (!grantee) continue;
    const id = `${k.schema}|${k.name}|${k.kind}|${k.col ?? ''}|${grantee}`;
    let g = map.get(id);
    if (!g) {
      g = { schema: k.schema, name: k.name, kind: k.kind, col: k.col ?? '', grantee, privs: new Set() };
      map.set(id, g);
    }
    g.privs.add(String(r.priv));
  }
  return [...map.values()].map(g => ({ ...g, privs: [...g.privs].sort() }));
}

/** متن راهنمای بازیابی که در هدر فایل SQL و در بستهٔ MinIO تکرار میشود. */
export function restoreGuide(): string {
  return [
    'راهنمای بازیابی کامل (Disaster Recovery):',
    '  ۱) یک دیتابیس کاملاً تازه بسازید؛ این فایل اسکیمای public/drizzle را پاک و بازسازی میکند.',
    `  ۲) ${RESTORE_COMMAND}`,
    '  ۳) مقادیر .env (بهویژه AFAGH_PII_KEY و کلید امضا) را از خزانهٔ اسرار سازمان برگردانید.',
    '  ۴) بستهٔ minio-*.zip را در باکت آرشیو استخراج کنید و اپ/مهاجر را بالا بیاورید.',
    '  ۵) درستی امضا پیش از بازیابی: node scripts/verify-db-backup.mjs backup.sql.gz',
    'توجه: اسکیمای pii_backups (پشتیبانهای موقت حاوی PII خام) عمداً خارج از بکاپ است.',
    'توجه: مقادیر محرمانه (گذرواژهها، توکنها، OTP) در حالت پیشفرض [REDACTED]اند؛',
    '      برای لاگین پس از بازیابی، رمزها را reset کنید یا بکاپ «کامل» تهیه نمایید.',
  ].join('\n');
}
