import 'server-only';
import { db } from '@/db';
import { samin_connections, samin_staging, samin_sync_logs, universities } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { decryptSecret } from './crypto';

// توکن per-university — کش 5 دقیقه‌ای در حافظه (برای جلوگیری از احراز هویت مکرر)
const tokenCache = new Map<number, { token: string; exp: number }>();

type SaminBulkPayload = {
  data_object: unknown[];
  entity_code: string;
  import_type_code: string;
};

export async function getSaminToken(universityId: number): Promise<string> {
  const cached = tokenCache.get(universityId);
  if (cached && cached.exp > Date.now() + 60_000) return cached.token;

  const [conn] = await db.select().from(samin_connections).where(eq(samin_connections.universityId, universityId)).limit(1);
  if (!conn || !conn.clientId) throw new Error('اتصال ثمین برای این دانشگاه تنظیم نشده است');
  const [uni] = await db.select().from(universities).where(eq(universities.id, universityId)).limit(1);

  // اگر توکن رمز شده و هنوز معتبر است، همان را برگردان
  if (conn.tokenEnc && conn.tokenExpiresAt) {
    const exp = new Date(conn.tokenExpiresAt).getTime();
    if (exp > Date.now() + 60_000) {
      const tok = decryptSecret(conn.tokenEnc);
      tokenCache.set(universityId, { token: tok, exp });
      return tok;
    }
  }

  const secret = decryptSecret(conn.clientSecretEnc || '');
  const pwd = decryptSecret(conn.passwordEnc || '');

  // احراز هویت ثمین: Basic(clientId:secret) + grant_type=password
  const basic = Buffer.from(`${conn.clientId}:${secret}`).toString('base64');
  const res = await saminFetch(conn.authBaseUrl, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      grant_type: 'password',
      username: conn.username || '',
      password: pwd,
    }),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`دریافت توکن ثمین شکست (${res.status}): ${txt.slice(0, 300)}`);
  }
  const j: any = await res.json();
  const access = j.access_token || j.token || '';
  const expiresIn = Number(j.expires_in || 3600);
  if (!access) throw new Error('توکن ثمین خالی برگشت');

  const expMs = Date.now() + expiresIn * 1000;
  // ذخیرهٔ رمز شده
  const { encryptSecret } = await import('./crypto');
  await db.update(samin_connections).set({
    tokenEnc: encryptSecret(access),
    tokenExpiresAt: new Date(expMs),
    updatedAt: new Date(),
  }).where(eq(samin_connections.universityId, universityId));

  tokenCache.set(universityId, { token: access, exp: expMs });
  return access;
}

/**
 * 🔒 fetch امن برای سرویس ثمین.
 *
 * `authBaseUrl` / `apiBaseUrl` را کارشناس هنگام ثبت «اتصال ثمین» وارد می‌کند،
 * پس نشانیِ دلخواه است و بدون گارد می‌شد مسیر SSRF بود (خواندن متادیتای
 * ابریِ 169.254.169.254 یا درخواست به شبکهٔ داخلی — آن هم با هدر
 * Authorization که توکن/گذرواژهٔ سرویس را به مقصد مهاجم می‌برد).
 *
 * پیش‌فرض فقط میزبان‌های رسمی سامان (`SAMIN_HOSTS`) است؛ برای سرویس
 * خودمیزبان، میزبان باید صریحاً در `AFAGH_SSRF_ALLOW_HOSTS` اعلام شود.
 */
async function saminFetch(url: string, init?: RequestInit): Promise<Response> {
  const { ssrfFetch, SAMIN_HOSTS } = await import('@/lib/ssrf-guard');
  return ssrfFetch(url, init, { allowedHosts: [...SAMIN_HOSTS] });
}

/**
 * شکل پاسخ `bulk_import_data`.
 * فیلدهای `traceId`/`status` در بعضی نسخه‌های سرویس ثمین با نام دیگری
 * برمی‌گردند؛ اینجا اختیاری اعلام شده‌اند تا رابط کاربری بتواند هر دو را بخواند
 * بدون `as any`.
 */
export type SaminBulkResult = {
  response_code: number;
  import_data_status: string;
  trace_id: number;
  traceId?: number;
  status?: string;
};

export async function saminBulkImport(universityId: number, payload: SaminBulkPayload): Promise<SaminBulkResult> {
  const [conn] = await db.select().from(samin_connections).where(eq(samin_connections.universityId, universityId)).limit(1);
  if (!conn) throw new Error('اتصال ثمین یافت نشد');
  const token = await getSaminToken(universityId);
  const url = `${conn.apiBaseUrl.replace(/\/+$/, '')}/api/mdm/import_data/bulk_import_data/`;

  const res = await saminFetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ importdata: { data: payload.data_object, entity_code: payload.entity_code, import_type_code: payload.import_type_code } }),
  });

  const j: any = await res.json().catch(async () => ({ raw: await res.text() }));
  if (!res.ok) throw new Error(`bulk_import_data ${res.status}: ${JSON.stringify(j).slice(0, 500)}`);

  // لاگ محلی
  await db.insert(samin_sync_logs).values({
    universityId,
    entityCode: payload.entity_code,
    traceId: j.trace_id ?? j.traceId ?? null,
    status: j.import_data_status || 'PENDING',
    summaryResult: j as any,
    rawResponse: JSON.stringify(j),
  });

  return j;
}

export async function saminTrace(universityId: number, traceId: number): Promise<any> {
  const [conn] = await db.select().from(samin_connections).where(eq(samin_connections.universityId, universityId)).limit(1);
  if (!conn) throw new Error('اتصال ثمین یافت نشد');
  const token = await getSaminToken(universityId);
  const url = `${conn.apiBaseUrl.replace(/\/+$/, '')}/api/mdm/import_data/trace_bulk_import_data?trace_id=${traceId}`;

  const res = await saminFetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const j = await res.json().catch(async () => ({ raw: await res.text() }));
  if (!res.ok) throw new Error(`trace ${res.status}: ${JSON.stringify(j).slice(0, 500)}`);
  return j;
}

export async function saminGetChangesLog(universityId: number, entityCode: string, traceId?: number): Promise<any> {
  const [conn] = await db.select().from(samin_connections).where(eq(samin_connections.universityId, universityId)).limit(1);
  if (!conn) throw new Error('اتصال ثمین یافت نشد');
  const token = await getSaminToken(universityId);
  const p = new URLSearchParams({ entity_code: entityCode });
  if (traceId) p.set('trace_id', String(traceId));
  const url = `${conn.apiBaseUrl.replace(/\/+$/, '')}/api/mdm/log/get_changeslog?${p}`;

  const res = await saminFetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const j = await res.json().catch(async () => ({ raw: await res.text() }));
  if (!res.ok) throw new Error(`get_changeslog ${res.status}: ${JSON.stringify(j).slice(0, 500)}`);
  return j;
}

export async function enqueueSaminPayload(universityId: number, entityCode: string, personPk: string, payload: unknown) {
  await db.insert(samin_staging).values({
    universityId,
    entityCode,
    personPkInSource: personPk,
    payload: payload as any,
    status: 'PENDING',
  }).onConflictDoNothing();
}
