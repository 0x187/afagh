import { and, count, desc, eq, or, sql } from 'drizzle-orm';
import { db } from '@/db';
import { degree_level_configs, majors, student_cards, students, users } from '@/db/schema';
import { requireRole } from '@/lib/auth';
import { escapeLikeChars, normalizeFa, normCol, toEnDigits } from '@/lib/persian-search';
import { getNumber, getSetting } from '@/lib/settings';
import { getCurrentUniversity } from '@/lib/university-scope';
import StudentCardsClient from './StudentCardsClient';

export const dynamic = 'force-dynamic';

const PER_PAGE = 50;

const fa = (n: unknown) => String(n ?? '—').replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);

/**
 * صدور و مدیریت کارت دانشجویی.
 *
 * این صفحه تنها مسیر صدور رکورد در `student_cards` است؛ همان جدولی که گیت
 * حراست (`/id/[token]`) از آن استعلام می‌گیرد. پیش‌تر هیچ مسیر صدوری وجود
 * نداشت و گیت با دادهٔ ساختگی پاسخ می‌داد.
 *
 * ⚠️ تاریخچهٔ کارایی (باگ ۵۰۴ تولید — ۱۸ اکتبر ۲۰۲۶):
 * بدهی هر دانشجو با یک **زیرکوئری همبسته** روی `student_ledger` حساب می‌شد و
 * همهٔ ۴۸٬۳۶۱ دانشجو یک‌جا به کلاینت می‌رفت. با ۳۴۳٬۰۹۷ ردیف دفتر مالی و
 * نبودِ ایندکس روی `student_ledger("studentId")`، کوئری از ۱۸۰ ثانیه هم رد
 * می‌شد و پروکسی ۵۰۴ می‌داد. اصلاحِ آن زمان: تجمیع **یک‌بارهٔ** دفتر مالی
 * (GROUP BY) + جستجو و صفحه‌بندی سمت سرور (همان الگوی `/admin/students`).
 *
 * ⚠️ اصلاحِ دوم (۳ نوامبر ۲۰۲۶) — چرا دوباره به زیرکوئریِ همبسته برگشتیم:
 * آن «تجمیعِ یک‌باره» با صفحه‌بندی ترکیب نشد. `left join (select ... group by
 * "studentId")` یک جدولِ مشتق‌شده است و PostgreSQL نمی‌تواند `limit 10` را به
 * داخلش هل بدهد؛ پس برای نمایشِ **۱۰ ردیف**، کلِ ۳۴۳٬۰۹۷ ردیفِ دفترِ همهٔ
 * دانشگاه‌ها جمع می‌خورد. در پروفایلِ واقعی:
 *      769.290 ms  execute ... left join (select ... group by ...) debt_agg ...
 * نکتهٔ کلیدی: زیرکوئریِ همبسته آن‌موقع ۱۸۰ ثانیه بود چون **ایندکس نداشت**.
 * حالا `idx_student_ledger_student("studentId")` وجود دارد (در patches.sql و
 * pg-hardening)، پس همان زیرکوئری بعد از `limit 10` فقط ۱۰ بار اجرا می‌شود و
 * هر بار یک پیمایشِ ایندکس است. یعنی فرمِ همبسته امروز درست است — به شرطِ
 * وجودِ آن ایندکس. اگر روزی ایندکس حذف شد، این کوئری دوباره فاجعه می‌شود.
 */
export default async function AdminStudentCardsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  await requireRole(['ADMIN', 'EDU_EXPERT']);

  const sp = await searchParams;
  const q = (sp.q || '').trim().slice(0, 60);
  const page = Math.max(1, parseInt(sp.page || '1', 10) || 1);

  const currentUniversity = await getCurrentUniversity();
  const currentUniversityId = currentUniversity?.id ?? null;

  // ── بدهی هر دانشجو ──
  // ⚠ اینجا قبلاً یک زیرکوئریِ تجمیعی به‌عنوان جدولِ مشتق‌شده جوین می‌شد:
  //     left join (select "studentId", sum(...) as debt
  //                from "student_ledger" group by "studentId") debt_agg ...
  //   مشکل: PostgreSQL نمی‌تواند `limit 10` را به داخلِ یک زیرکوئریِ GROUP BY
  //   هل بدهد، پس **کلِ دفترِ مالیِ همهٔ دانشگاه‌ها** را برای همهٔ دانشجویان
  //   جمع می‌زد و بعد فقط ۱۰ ردیف برمی‌داشت. در پروفایلِ واقعی:
  //       769.290 ms  execute ... left join (select ... group by ...) ...
  //   حالا به یک زیرکوئریِ همبسته در لیستِ SELECT تبدیل شده؛ چون بعد از
  //   `order by ... limit 10` ارزیابی می‌شود، فقط برای همان ۱۰ دانشجوی بازگشتی
  //   اجرا می‌گردد و هر اجرا یک پیمایشِ ایندکس روی
  //   idx_student_ledger_student(studentId) است.
  const debtOf = (studentIdCol: typeof students.id) => sql<string>`coalesce((
    select sum(case when l."transactionType" in ('TUITION_CHARGE','CHARGE')
                    then l."amount" else -l."amount" end)
      from "student_ledger" l
     where l."studentId" = ${studentIdCol}
  ), 0)`;

  // ── جستجو + محدودیت دانشگاه (هم‌راستا با /admin/students: ادمین محدود فقط دانشگاه خودش را می‌بیند) ──
  const conds: unknown[] = [];
  if (currentUniversityId) conds.push(eq(students.universityId, currentUniversityId));
  if (q) {
    conds.push(
      or(
        sql`${students.studentCode} ILIKE ${`%${escapeLikeChars(toEnDigits(q))}%`} ESCAPE '\\'`,
        sql`${users.nationalCode} ILIKE ${`%${escapeLikeChars(toEnDigits(q))}%`} ESCAPE '\\'`,
        sql`${normCol(users.firstName)} ILIKE ${`%${escapeLikeChars(normalizeFa(q))}%`} ESCAPE '\\'`,
        sql`${normCol(users.lastName)} ILIKE ${`%${escapeLikeChars(normalizeFa(q))}%`} ESCAPE '\\'`,
      )!,
    );
  }
  const where = conds.length ? and(...(conds as Parameters<typeof and>)) : undefined;

  // ── سه چیزِ مستقل موازی می‌آیند (قبلاً پشتِ سرِ هم بودند) ──
  //   · شمارشِ کل برای صفحه‌بندی (rows به safePage وابسته است، پس زودتر لازم است)
  //   · آمارِ کلیِ کارت‌ها
  //   · تنظیمات (اعتبارِ روز و وجودِ رازِ توکن)
  const [countRow, statsRes, validDays, secretValue] = await Promise.all([
    db
      .select({ n: count() })
      .from(students)
      .innerJoin(users, eq(users.id, students.userId))
      .where(where as never),
    db.execute(sql`
      select
        (select count(*) from students)::int as total,
        (select count(*) from student_cards)::int as issued,
        (select count(*) from (
           select "studentId" from student_ledger
            group by "studentId"
           having sum(case when "transactionType" in ('TUITION_CHARGE','CHARGE') then amount else -amount end) > 0
         ) d)::int as blocked,
        (select count(*) from student_cards
          where "expiresAt" < now() or "printStatus" in ('REVOKED','LOST'))::int as expired
    `),
    getNumber('STUDENT_CARD_VALID_DAYS', 365),
    getSetting('TICKET_TOKEN_SECRET'),
  ]);

  const total = Number(countRow[0]?.n ?? 0);
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));
  const safePage = Math.min(page, totalPages);

  const rows = await db
    .select({
      studentId: students.id,
      studentCode: students.studentCode,
      fullName: sql<string>`${users.firstName} || ' ' || ${users.lastName}`,
      nationalCode: users.nationalCode,
      status: students.status,
      entryYear: students.entryYear,
      majorName: majors.name,
      degreeLevel: degree_level_configs.title,
      cardId: student_cards.id,
      secureToken: student_cards.secureToken,
      printStatus: student_cards.printStatus,
      rfidSerialNumber: student_cards.rfidSerialNumber,
      issuedAt: student_cards.issuedAt,
      expiresAt: student_cards.expiresAt,
      debt: debtOf(students.id),
    })
    .from(students)
    .innerJoin(users, eq(users.id, students.userId))
    .leftJoin(student_cards, eq(student_cards.studentId, students.id))
    .leftJoin(majors, eq(majors.id, students.majorId))
    .leftJoin(degree_level_configs, eq(degree_level_configs.id, students.degreeLevelId))
    .where(where as never)
    .orderBy(desc(students.id))
    .limit(PER_PAGE)
    .offset((safePage - 1) * PER_PAGE);

  // ── آمار کلی (مستقل از صفحه و جستجو) — در Promise.all بالا آمده ──
  const stats = (statsRes.rows?.[0] ?? { total: 0, issued: 0, blocked: 0, expired: 0 }) as {
    total: number; issued: number; blocked: number; expired: number;
  };

  const secretSet = secretValue.trim().length > 0;

  return (
    <div className="space-y-4" dir="rtl">
      <div className="card !p-4 bg-white border-slate-300 shadow-sm">
        <h1 className="text-base font-extrabold text-slate-900">🪪 صدور و مدیریت کارت دانشجویی</h1>
        <p className="text-xs text-slate-500 mt-0.5">
          توکن امنیتی چاپ‌شده روی کارت، همان چیزی است که گیت حراست در <span className="font-mono">/id/[token]</span> استعلام می‌کند.
        </p>
        <div className="mt-2 flex flex-wrap gap-2 text-2xs font-bold">
          <span className="rounded-lg bg-indigo-50 px-2 py-1 text-indigo-900 border border-indigo-200">
            اعتبار پیش‌فرض کارت: {fa(validDays)} روز (از تنظیمات سامانه)
          </span>
          <span className={`rounded-lg px-2 py-1 border ${secretSet ? 'bg-emerald-50 text-emerald-900 border-emerald-200' : 'bg-rose-50 text-rose-900 border-rose-300'}`}>
            {secretSet ? '✓ کلید امضای توکن (TICKET_TOKEN_SECRET) تنظیم شده' : '⚠️ کلید امضای توکن تنظیم نشده — کارت ورود به جلسه صادر نمی‌شود'}
          </span>
        </div>
      </div>

      <StudentCardsClient
        q={q}
        page={safePage}
        totalPages={totalPages}
        total={total}
        perPage={PER_PAGE}
        stats={stats}
        rows={rows.map(r => ({
          studentId: r.studentId,
          studentCode: r.studentCode,
          fullName: r.fullName,
          nationalCode: r.nationalCode,
          status: r.status,
          entryYear: r.entryYear,
          majorName: r.majorName,
          degreeLevel: r.degreeLevel,
          card: r.cardId
            ? {
                id: r.cardId,
                token: r.secureToken ?? '',
                printStatus: r.printStatus ?? 'PENDING',
                rfidSerialNumber: r.rfidSerialNumber,
                issuedAt: r.issuedAt ? new Date(r.issuedAt).toLocaleDateString('fa-IR') : null,
                expiresAt: r.expiresAt ? new Date(r.expiresAt).toLocaleDateString('fa-IR') : null,
                expired: !!r.expiresAt && new Date(r.expiresAt).getTime() < Date.now(),
              }
            : null,
          debt: Math.max(0, Math.round(Number(r.debt ?? 0))),
        }))}
      />
    </div>
  );
}
