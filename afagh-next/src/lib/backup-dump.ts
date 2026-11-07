/**
 * ساخت لیترال ردیفها «سمت سرور» برای دامپ SQL.
 *
 * نسخهٔ پیشین `sqlLiteral()` مقادیر پارسشدهٔ درایور `pg` را با `String(v)` به SQL
 * تبدیل میکرد: jsonb میشد `[object Object]`، آرایه میشد `1,2,3`، و بکاسلشها زیر
 * `standard_conforming_strings=on` دوبار میشدند. یعنی دامپ از لحاظ داده ناقص بود،
 * حتی پیش از آنکه سرور DDL کامل بدهد.
 *
 * اینجا Postgres خودش لیترال را میسازد: `col::text` خروجی متنی نوع را میدهد و
 * `quote_nullable()` آن را بهشکل امن نقلقول میکند (شامل `E'…'` برای بکاسلش).
 * هنگام INSERT، لیترال unknown به نوع ستون مقصد coercion میشود ⇒ jsonb/array/
 * bytea/timestamp/boolean/numeric همگی بایتدقیق برمیگردند.
 *
 * ماژول خالص است (بدون `'use server'`) تا مستقل تست شود.
 */

export const REDACTED = '[REDACTED]';
/** جایگزین امن برای ستونهای jsonb: رشتهٔ [REDACTED] برای jsonb نامعتبر است. */
export const REDACTED_JSON = '{"redacted":true}';

type Rule = {
  column: string;
  /** جایگزینی ثابت یا عبارت SQL (همیشه باید text تولید کند). */
  replacement: string;
  /** شرط اعمال ردکشن + ستونهایی که شرط به آنها نیاز دارد. */
  when?: { needs: string[]; sql: string };
};

const qi = (s: string): string => '"' + String(s).replace(/"/g, '""') + '"';
const ql = (s: string): string => "'" + String(s).replace(/'/g, "''") + "'";

const OTP = { needs: ['eventCode'], sql: `"eventCode" ~* 'OTP'` };
const SECRET_KEY = { needs: ['key'], sql: `"key" ~* 'SECRET|TOKEN|KEY|PASSWORD'` };

/** همان قواعد `redactRow()` قدیمی، ترجمهشده به عبارت SQL. */
const RULES: Record<string, Rule[]> = {
  system_settings: [
    { column: 'value', when: SECRET_KEY, replacement: ql(REDACTED) },
  ],
  users: [
    { column: 'passwordHash', replacement: ql(REDACTED) },
  ],
  notification_deliveries: [
    { column: 'body', when: OTP, replacement: ql(REDACTED) },
  ],
  notifications: [
    { column: 'payload', when: OTP, replacement: ql(REDACTED) },
  ],
  verification_otps: [
    { column: 'otpCode', replacement: ql(REDACTED) },
    { column: 'otpHash', replacement: ql(REDACTED) },
  ],
  instructor_deliveries: [
    { column: 'pickupToken', replacement: ql(REDACTED) },
  ],
  student_cards: [
    { column: 'secureToken', replacement: ql(REDACTED) },
  ],
  integrations_config: [
    { column: 'authCredentials', replacement: ql(REDACTED) },
  ],
  api_audit_logs: [
    { column: 'requestPayload', replacement: ql(REDACTED) },
  ],
  grade_submission_otps: [{ column: 'otpHash', replacement: ql(REDACTED) }],
  signature_otps: [{ column: 'otpHash', replacement: ql(REDACTED) }],
  doc_sign_otps: [{ column: 'otpHash', replacement: ql(REDACTED) }],
  document_signatures: [{ column: 'otpUsed', replacement: ql(REDACTED) }],
  messenger_link_tokens: [
    { column: 'tokenHash', replacement: ql(REDACTED) },
    { column: 'codeHash', replacement: ql(REDACTED) },
    { column: 'pendingChatId', replacement: ql(REDACTED) },
  ],
  samin_connections: [
    { column: 'clientSecretEnc', replacement: ql(REDACTED) },
    { column: 'passwordEnc', replacement: ql(REDACTED) },
    { column: 'tokenEnc', replacement: ql(REDACTED) },
  ],
  payment_gateways: [{ column: 'config', replacement: ql(REDACTED_JSON) }],
  pos_terminals: [{ column: 'config', replacement: ql(REDACTED_JSON) }],
  payment_transactions: [
    // authority در ایندکس یکتاست ⇒ مقدار یکتای هر ردیف، نه ثابت (وگرنه درج تکراری).
    { column: 'authority', replacement: `'[REDACTED]#' || "id"::text`, when: { needs: ['id'], sql: 'true' } },
    { column: 'bankRefId', replacement: ql(REDACTED) },
    { column: 'cardPan', replacement: ql(REDACTED) },
    { column: 'payerMobile', replacement: ql(REDACTED) },
    { column: 'payerEmail', replacement: ql(REDACTED) },
  ],
};

/**
 * عبارتی که یک ردیف را به `(v1, v2, …)` تبدیل میکند.
 * `redact=false` ⇒ هیچ سانیتایزهای اعمال نمیشود (بکاپ کامل/DR با رازها).
 */
export function buildRowLiteralSql(schema: string, table: string, columns: string[], redact = true): string {
  const rules = redact && schema === 'public' ? (RULES[table] ?? []) : [];
  const parts = columns.map(col => {
    const rule = rules.find(r => {
      if (r.column !== col) return false;
      if (!r.when) return true;
      return r.when.needs.every(n => columns.includes(n));
    });
    const plain = `quote_nullable(${qi(col)}::text)`;
    if (!rule) return plain;
    const replacement = `(${rule.replacement})::text`;
    if (!rule.when) return `quote_nullable(${replacement})`;
    return `quote_nullable(CASE WHEN ${rule.when.sql} THEN ${replacement} ELSE ${qi(col)}::text END)`;
  });
  if (!parts.length) return `'()'`;
  return `'(' || ${parts.join(" || ', ' || ")} || ')'`;
}

/** سرآیند INSERT برای یک جدول (شامل ستونها؛ ستونهای generated حذف شدهاند). */
export function insertHead(schema: string, table: string, columns: string[], hasIdentityAlways = false): string {
  const cols = columns.map(qi).join(', ');
  return `INSERT INTO ${qi(schema)}.${qi(table)} (${cols}) ` +
    `${hasIdentityAlways ? 'OVERRIDING SYSTEM VALUE ' : ''}VALUES\n`;
}
