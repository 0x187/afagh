import crypto from 'crypto';
import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { db } from '@/db';
import { hashPassword } from '@/lib/auth';
import { getCurrentUniversity } from '@/lib/university-scope';
import { createLogger, maskSecrets } from '@/lib/logger';
import { isEntryMethod, type EntryMethod } from '@/lib/entry-methods';
import {
  DEFAULT_FORMULA,
  applyFormula,
  validateFormula,
  degreeCodeFor,
} from '@/lib/student-id-formula';
import { pickExistingProfile } from '@/lib/admissions-dedupe';
import {
  admissions_staging,
  degree_level_configs,
  educational_regulations,
  majors,
  sanjesh_mappings,
  student_id_formulas,
  students,
  users,
} from '@/db/schema';

// خطاهای خام Postgres می‌توانند مقدار نقض‌شده (کد ملی) را در پیام داشته باشند؛
// پس همهٔ خطاها از لاگر ماسک‌دار عبور می‌کنند.
const log = createLogger({ mod: 'admissions' });

// ============================================================================
// نمونه داده‌های نگاشت اولیه سازمان سنجش (Default Sanjesh Mappings)
// شامل رشته‌های رایج مهندسی، علوم پایه، انسانی، هنر، کشاورزی، دامپزشکی و پزشکی
// ============================================================================

export const DEFAULT_SANJESH_MAPPINGS = [
  // مهندسی کامپیوتر و علوم کامپیوتر
  { sanjeshCode: '11204', majorName: 'مهندسی کامپیوتر - نرم‌افزار', majorCode: '412', quota: 'منطقه ۱' },
  { sanjeshCode: '11205', majorName: 'مهندسی کامپیوتر - هوش مصنوعی', majorCode: '414', quota: 'منطقه ۲' },
  { sanjeshCode: '11206', majorName: 'مهندسی کامپیوتر - سخت‌افزار', majorCode: '413', quota: 'منطقه ۱' },
  { sanjeshCode: '11207', majorName: 'مهندسی کامپیوتر - شبکه‌ها', majorCode: '415', quota: 'منطقه ۳' },
  { sanjeshCode: '11402', majorName: 'علوم کامپیوتر', majorCode: '201', quota: 'منطقه ۳' },
  { sanjeshCode: '11403', majorName: 'علوم کامپیوتر - سخت‌افزار', majorCode: '202', quota: 'منطقه ۲' },

  // مهندسی برق
  { sanjeshCode: '11301', majorName: 'مهندسی برق - مخابرات', majorCode: '310', quota: 'منطقه ۱' },
  { sanjeshCode: '11302', majorName: 'مهندسی برق - الکترونیک', majorCode: '311', quota: 'منطقه ۱' },
  { sanjeshCode: '11303', majorName: 'مهندسی برق - قدرت', majorCode: '312', quota: 'منطقه ۲' },
  { sanjeshCode: '11304', majorName: 'مهندسی برق - کنترل', majorCode: '313', quota: 'منطقه ۳' },

  // مهندسی مکانیک
  { sanjeshCode: '11601', majorName: 'مهندسی مکانیک -’état جامدات', majorCode: '510', quota: 'منطقه ۱' },
  { sanjeshCode: '11602', majorName: 'مهندسی مکانیک - سوخت و احتراق', majorCode: '511', quota: 'منطقه ۲' },
  { sanjeshCode: '11603', majorName: 'مهندسی مکانیک - تبدیل انرژی', majorCode: '512', quota: 'منطقه ۳' },
  { sanjeshCode: '11604', majorName: 'مهندسی مکانیک - ساخت و تولید', majorCode: '513', quota: 'منطقه ۱' },

  // مهندسی عمران
  { sanjeshCode: '11701', majorName: 'مهندسی عمران - سازه', majorCode: '610', quota: 'منطقه ۱' },
  { sanjeshCode: '11702', majorName: 'مهندسی عمران - خاک وFoundation', majorCode: '611', quota: 'منطقه ۲' },
  { sanjeshCode: '11703', majorName: 'مهندسی عمران - 교통 و راه', majorCode: '612', quota: 'منطقه ۳' },
  { sanjeshCode: '11704', majorName: 'مهندسی عمران - آب و محیط زیست', majorCode: '613', quota: 'منطقه ۱' },

  // مهندسی شیمی و نفت
  { sanjeshCode: '11801', majorName: 'مهندسی شیمی', majorCode: '710', quota: 'منطقه ۱' },
  { sanjeshCode: '11802', majorName: 'مهندسی نفت - کاوش', majorCode: '720', quota: 'منطقه ۲' },
  { sanjeshCode: '11803', majorName: 'مهندسی نفت - بهره‌برداری', majorCode: '721', quota: 'منطقه ۳' },
  { sanjeshCode: '11804', majorName: 'مهندسی پتروشیمی', majorCode: '730', quota: 'منطقه ۱' },

  // مهندسی صنایع و مدیریت
  { sanjeshCode: '11901', majorName: 'مهندسی صنایع', majorCode: '810', quota: 'منطقه ۱' },
  { sanjeshCode: '11902', majorName: 'مهندسی سیستم‌های صنعتی', majorCode: '811', quota: 'منطقه ۲' },
  { sanjeshCode: '11505', majorName: 'مدیریت کسب و کار (MBA)', majorCode: '601', quota: 'سهمیه آزاد' },
  { sanjeshCode: '11506', majorName: 'مدیریت فناوری اطلاعات', majorCode: '602', quota: 'سهمیه آزاد' },
  { sanjeshCode: '11507', majorName: 'مدیریت صنعتی', majorCode: '603', quota: 'سهمیه آزاد' },

  // معماری و شهرسازی
  { sanjeshCode: '12001', majorName: 'معماری', majorCode: '910', quota: 'منطقه ۱' },
  { sanjeshCode: '12002', majorName: 'شهرسازی', majorCode: '920', quota: 'منطقه ۲' },
  { sanjeshCode: '12003', majorName: 'معماری منظر', majorCode: '930', quota: 'منطقه ۳' },

  // علوم پایه
  { sanjeshCode: '12101', majorName: 'ریاضی - محض', majorCode: '101', quota: 'منطقه ۱' },
  { sanjeshCode: '12102', majorName: 'ریاضی - کاربردی', majorCode: '102', quota: 'منطقه ۲' },
  { sanjeshCode: '12103', majorName: 'فیزیک - محض', majorCode: '111', quota: 'منطقه ۱' },
  { sanjeshCode: '12104', majorName: 'فیزیک - کاربردی', majorCode: '112', quota: 'منطقه ۲' },
  { sanjeshCode: '12105', majorName: 'شیمی - محض', majorCode: '121', quota: 'منطقه ۱' },
  { sanjeshCode: '12106', majorName: 'شیمی - کاربردی', majorCode: '122', quota: 'منطقه ۲' },
  { sanjeshCode: '12107', majorName: 'زیست‌شناسی', majorCode: '131', quota: 'منطقه ۱' },
  { sanjeshCode: '12108', majorName: 'علوم زمین', majorCode: '141', quota: 'منطقه ۳' },

  // علوم انسانی و اجتماعی
  { sanjeshCode: '12201', majorName: 'روانشناسی', majorCode: '2001', quota: 'منطقه ۱' },
  { sanjeshCode: '12202', majorName: 'مشاوره', majorCode: '2002', quota: 'منطقه ۲' },
  { sanjeshCode: '12203', majorName: 'علوم اجتماعی', majorCode: '2010', quota: 'منطقه ۱' },
  { sanjeshCode: '12204', majorName: 'جامعه‌شناسی', majorCode: '2011', quota: 'منطقه ۲' },
  { sanjeshCode: '12205', majorName: 'حقوق و علوم سیاسی', majorCode: '2020', quota: 'منطقه ۱' },
  { sanjeshCode: '12206', majorName: 'مدیریت عمومی', majorCode: '2030', quota: 'منطقه ۲' },
  { sanjeshCode: '12207', majorName: 'اقتصاد', majorCode: '2040', quota: 'منطقه ۱' },
  { sanjeshCode: '12208', majorName: 'حسابداری', majorCode: '2050', quota: 'منطقه ۳' },

  // هنر و معماری داخلی
  { sanjeshCode: '12301', majorName: 'طراحی گرافیک', majorCode: '3010', quota: 'منطقه ۱' },
  { sanjeshCode: '12302', majorName: 'طراحی صنعتی', majorCode: '3011', quota: 'منطقه ۲' },
  { sanjeshCode: '12303', majorName: 'معماری داخلی', majorCode: '3020', quota: 'منطقه ۱' },
  { sanjeshCode: '12304', majorName: 'نقاشی', majorCode: '3030', quota: 'منطقه ۳' },
  { sanjeshCode: '12305', majorName: 'موسیقی', majorCode: '3040', quota: 'منطقه ۱' },

  // کشاورزی و منابع طبیعی
  { sanjeshCode: '12401', majorName: 'علوم باغبانی', majorCode: '4010', quota: 'منطقه ۱' },
  { sanjeshCode: '12402', majorName: 'علوم земین و آب', majorCode: '4020', quota: 'منطقه ۲' },
  { sanjeshCode: '12403', majorName: 'جنگلداری', majorCode: '4030', quota: 'منطقه ۳' },
  { sanjeshCode: '12404', majorName: 'منابع طبیعی - محیط زیست', majorCode: '4040', quota: 'منطقه ۱' },
  { sanjeshCode: '12405', majorName: 'مهندسی آبخیزداری', majorCode: '4050', quota: 'منطقه ۲' },

  // دامپزشکی
  { sanjeshCode: '12501', majorName: 'دامپزشکی', majorCode: '5010', quota: 'منطقه ۱' },

  // پزشکی و پاراپزشکی
  { sanjeshCode: '12601', majorName: 'پزشکی عمومی', majorCode: '6010', quota: 'منطقه ۱' },
  { sanjeshCode: '12602', majorName: 'دندان‌پزشکی', majorCode: '6020', quota: 'منطقه ۱' },
  { sanjeshCode: '12603', majorName: 'داروسازی', majorCode: '6030', quota: 'منطقه ۲' },
  { sanjeshCode: '12604', majorName: 'پرستاری', majorCode: '6040', quota: 'منطقه ۱' },
  { sanjeshCode: '12605', majorName: 'فیزيوتراپی', majorCode: '6050', quota: 'منطقه ۲' },
  { sanjeshCode: '12606', majorName: 'تکنولوژی آزمایشگاه', majorCode: '6060', quota: 'منطقه ۳' },
  { sanjeshCode: '12607', majorName: 'رادیولوژی', majorCode: '6070', quota: 'منطقه ۳' },
  { sanjeshCode: '12608', majorName: 'انestesی', majorCode: '6080', quota: 'منطقه ۲' },

  // سهمیه‌های خاص
  { sanjeshCode: '99001', majorName: 'سهمیه ایثارگران', majorCode: '9901', quota: 'سهمیه ایثارگران' },
  { sanjeshCode: '99002', majorName: 'سهمیه جانبازان', majorCode: '9902', quota: 'سهمیه جانبازان' },
  { sanjeshCode: '99003', majorName: 'سهمیه آزاد', majorCode: '9903', quota: 'سهمیه آزاد' },
  { sanjeshCode: '99004', majorName: 'سهمیه Arbeiter', majorCode: '9904', quota: 'سهمیه کارگری' },
  { sanjeshCode: '99005', majorName: 'سهمیه Nomadic', majorCode: '9905', quota: 'سهمیه عشایری' },
];

/**
 * همگام‌سازی ردیف‌های صف با جدول نگاشت.
 *
 * چرا لازم است: نگاشت یک کد رشته در `sanjesh_mappings` ذخیره می‌شود و اکشن
 * تلاش می‌کند ردیف‌های staging را هم RESOLVED کند. اما اگر آن به‌روزرسانی به
 * هر دلیلی نگیرد (نسخهٔ قدیمیِ کد، ردیفی که کدش فقط در profileJson است،
 * قطع اتصال)، جدول برابری «✓ نگاشت شد» نشان می‌دهد ولی ردیف‌ها همچنان
 * «نیازمند نگاشت» می‌مانند — دقیقاً همان ناهماهنگیِ گیج‌کننده.
 *
 * این تابع idempotent است و در بارگذاری صفحه اجرا می‌شود؛ فقط ردیف‌های
 * PENDING_MAPPING را لمس می‌کند و هیچ نگاشت تازه‌ای نمی‌سازد.
 */
export async function resyncStagingMappings(): Promise<number> {
  try {
    const res: any = await db.execute(sql`
      UPDATE admissions_staging s
      SET "mappedMajorId" = m."internalMajorId",
          status = 'RESOLVED'
      FROM sanjesh_mappings m
      WHERE s.status = 'PENDING_MAPPING'
        AND m."internalMajorId" IS NOT NULL
        AND (m."universityId" IS NULL OR m."universityId" = s."universityId")
        AND (
          (CASE WHEN s."rawSanjeshData" LIKE '{%'
                THEN s."rawSanjeshData"::jsonb ->> 'sanjeshCode' END) = m."sanjeshCode"
          OR
          (CASE WHEN s."profileJson" LIKE '{%'
                THEN COALESCE(
                  s."profileJson"::jsonb #>> '{fields,fieldPlaceCode}',
                  s."profileJson"::jsonb #>> '{fields,fieldCode}'
                ) END) = m."sanjeshCode"
        )
    `);
    return Number(res?.rowCount ?? res?.rows?.[0]?.count ?? 0);
  } catch (err) {
    log.error('staging_mapping_resync_failed', { err });
    return 0;
  }
}

export async function ensureDefaultSanjeshMappings() {
  try {
    const existing = await db.select().from(sanjesh_mappings);
    if (existing.length === 0) {
      const allMajors = await db.select().from(majors);
      for (const sm of DEFAULT_SANJESH_MAPPINGS) {
        const major = allMajors.find(m => m.name.includes(sm.majorName.split(' - ')[0]));
        if (!major) {
          // به‌جای نسبت دادن بی‌صدا به «اولین رشتهٔ دیتابیس» (که می‌تواند رشتهٔ کاملاً
          // نامرتبط باشد)، از ایجاد نگاشت صرف‌نظر می‌کنیم و هشدار می‌دهیم؛
          // رکوردهای سنجشِ بدون نگاشت با وضعیت PENDING_MAPPING می‌مانند و
          // کارشناس بعداً می‌تواند به‌صورت دستی نگاشت کند.
          log.warn('sanjesh_mapping_missing', { majorName: sm.majorName, sanjeshCode: sm.sanjeshCode });
          continue;
        }
        await db.insert(sanjesh_mappings).values({
          sanjeshCode: sm.sanjeshCode,
          internalMajorId: major.id,
          sanjeshQuota: sm.quota,
          internalQuotaCode: 1,
        });
      }
    }
  } catch (err) {
    log.error('sanjesh_mappings_failed', { err });
  }
}

// ============================================================================
// موتور فرمول‌ساز پویای شماره دانشجویی (Dynamic Student ID Generator)
// ============================================================================

/**
 * تولید شمارهٔ دانشجویی با افزایش اتمیک شمارنده (atomic SQL increment).
 *
 * برخلاف الگوی قبلی «read → compute → write» که در همزمانی دو پذیرش،
 * شمارهٔ تکراری تولید می‌کرد، این‌جا افزایش شمارنده در یک UPDATE اتمیک
 * (درون یک تراکنش) انجام می‌شود؛ بنابراین دو تراکنش هم‌زمان هرگز یک شماره
 * نمی‌گیرند. رقابت «ایجاد ردیف فرمول» هم با unique constraint روی
 * degreeLevelId + onConflictDoNothing حل شده است.
 *
 * برای شرکت‌پذیری در تراکنشِ فراخوان (مثلاً importStagedToStudents)،
 * پارامتر اختیاری `q` می‌پذیرد؛ در غیر این صورت از `db` استفاده می‌کند.
 */
async function maxSeqForDegree(q: any, degreeLevelId: number): Promise<number> {
  // بیشینهٔ سریالِ در استفاده برای این مقطع (همهٔ دانشگاه‌ها).
  // عرض سریال در همهٔ فرمول‌های فعلی ۳ رقم است (آخرین ۳ رقم کد).
  const res: any = await q.execute(sql`
    SELECT COALESCE(MAX(right("studentCode", 3)::int), 0) AS m
    FROM students
    WHERE "degreeLevelId" = ${degreeLevelId}
      AND "studentCode" ~ '^[0-9]+$'
      AND length("studentCode") >= 3
  `);
  const row = (res?.rows ?? res)?.[0];
  return Number(row?.m ?? 0);
}

async function maxSeqForMajor(q: any, majorId: number, codePrefix?: string): Promise<number> {
  // بیشینهٔ سریالِ در استفاده. اگر codePrefix داده شود فقط کدهای هم‌پیشوند
  // (همان سال و همان رشته) لحاظ می‌شوند تا شماره‌گذاری هر سال مستقل باشد.
  const res: any = codePrefix
    ? await q.execute(sql`
        SELECT COALESCE(MAX(right("studentCode", 3)::int), 0) AS m
        FROM students
        WHERE "studentCode" LIKE ${codePrefix + '%'}
          AND "studentCode" ~ '^[0-9]+$'
          AND length("studentCode") >= 3
      `)
    : await q.execute(sql`
        SELECT COALESCE(MAX(right("studentCode", 3)::int), 0) AS m
        FROM students
        WHERE "majorId" = ${majorId}
          AND "studentCode" ~ '^[0-9]+$'
          AND length("studentCode") >= 3
      `);
  const row = (res?.rows ?? res)?.[0];
  return Number(row?.m ?? 0);
}

/**
 * تولید کد در یک سریال مشخص — برای شماره‌گذاری «به‌ازای هر رشته» با شروعِ
 * دستی (مثلاً «از ۰۰۱ شروع کن» یا «از ۶۰۱ شروع کن»).
 * اگر کد تکراری باشد سریال بالا می‌رود؛ در سرریز عرض {Seq} خودترمیم می‌شود.
 */
async function assignCodeAtSeq(
  q: any,
  args: {
    formula: string;
    degreeLevelId: number;
    entryYear: number;
    majorCode?: string;
    quotaCode?: number;
    universityId: number | null;
    startSeq: number;
    extra?: Record<string, string>;
  },
): Promise<{ code: string; seq: number; formula: string }> {
  const [level] = await q
    .select({ code: degree_level_configs.code })
    .from(degree_level_configs)
    .where(eq(degree_level_configs.id, args.degreeLevelId))
    .limit(1);

  let formula = args.formula;
  let seq = Math.max(0, Math.floor(args.startSeq));

  // فرمول مالِ کارشناس است. اگر عرضِ {Seq} جا نکند، ما آن را **عوض نمی‌کنیم**؛
  // با پیام روشن متوقف می‌شویم تا خودش عرض را در «فرمول‌ساز» اصلاح کند.
  const seqWidth = Number(formula.match(/\{Seq:(\d+)\}/)?.[1] ?? 0);
  if (seqWidth <= 0) {
    throw new Error(
      'فرمول این مقطع متغیر {Seq} ندارد، پس شمارهٔ یکتا تولید نمی‌شود. ' +
        'در «فرمول‌ساز» یک {Seq:n} به فرمول اضافه کنید.',
    );
  }
  const seqMax = Math.pow(10, seqWidth) - 1;

  for (let i = 0; i < 5000; i++) {
    if (seq > seqMax) {
      throw new Error(
        `سریال این مقطع به ${seq} رسید ولی عرض {Seq:${seqWidth}} حداکثر ${seqMax} را می‌پذیرد. ` +
          `در «فرمول‌ساز» عرض را به {Seq:${seqWidth + 1}} تغییر دهید (یا شمارهٔ شروع را کمتر بگیرید).`,
      );
    }

    const code = renderStudentCode(formula, {
      entryYear: args.entryYear,
      degreeCode: level?.code,
      majorCode: args.majorCode,
      seq,
      quotaCode: args.quotaCode,
      extra: args.extra,
    });

    const clashScope = args.universityId != null
      ? or(eq(students.universityId, args.universityId), isNull(students.universityId))
      : isNull(students.universityId);
    const [clash] = await q
      .select({ id: students.id })
      .from(students)
      .where(and(clashScope, eq(students.studentCode, code)))
      .limit(1);

    if (!clash) return { code, seq, formula };
    seq++;
  }

  throw new Error('تولید شمارهٔ یکتا برای این رشته ممکن نشد.');
}

export async function generateStudentId(
  params: {
    degreeLevelId: number;
    entryYear: number;
    majorCode?: string;
    quotaCode?: number;
    universityId?: number;
    /** کفِ سریال برای همگام‌سازی شمارنده با دادهٔ موجود */
    minSeq?: number;
  },
  q: any = db,
): Promise<string> {
  const [level] = await q
    .select()
    .from(degree_level_configs)
    .where(eq(degree_level_configs.id, params.degreeLevelId))
    .limit(1);

  // فرمول را کارشناس تعریف می‌کند. اینجا هیچ فرمول پیش‌فرضی جایگزین نمی‌شود
  // و هیچ ردیفی خودکار ساخته نمی‌شود — اگر تعریف نشده باشد، صریح خطا می‌دهیم.
  const [formulaRow] = await q
    .select()
    .from(student_id_formulas)
    .where(eq(student_id_formulas.degreeLevelId, params.degreeLevelId))
    .limit(1);

  if (!formulaRow?.formula) {
    throw new Error(
      `برای مقطع «${level?.title ?? params.degreeLevelId}» فرمول شمارهٔ دانشجویی تعریف نشده است. ` +
        'در تب «فرمول‌ساز» تعریف کنید.',
    );
  }
  const formulaErrors = validateFormula(formulaRow.formula);
  if (formulaErrors.length > 0) {
    throw new Error(`فرمول شمارهٔ دانشجویی این مقطع معتبر نیست: ${formulaErrors.join(' ؛ ')}`);
  }
  const currentFormula = formulaRow.formula;

  // همگام‌سازی کف: اگر شمارنده از دادهٔ موجود عقب است (مثلاً ۰ در حالی که
  // صدها شماره صادر شده)، به کف می‌رسانیم تا از شماره‌های موجود جلو بزنیم.
  const floor = params.minSeq ?? 0;
  if ((formulaRow.currentSequence ?? 0) < floor) {
    await q
      .update(student_id_formulas)
      .set({ currentSequence: floor })
      .where(eq(student_id_formulas.id, formulaRow.id));
    formulaRow.currentSequence = floor;
  }

  // حلقهٔ تولید با تضمین یکتایی: اگر کد با شمارهٔ موجود تداخل داشت، سریال
  // بعدی امتحان می‌شود. اگر ظرفیت عرض {Seq} پر شود، عرض یک رقم زیاد می‌شود
  // (خودترمیمی) تا پذیرش هرگز قفل نشود.
  for (let attempt = 0; attempt < 5000; attempt++) {
    const [upd] = await q
      .update(student_id_formulas)
      .set({ currentSequence: sql`${student_id_formulas.currentSequence} + 1` })
      .where(eq(student_id_formulas.id, formulaRow.id))
      .returning({ seq: student_id_formulas.currentSequence });
    const seq = upd ? upd.seq : (formulaRow.currentSequence ?? 0) + 1;
    formulaRow.currentSequence = seq;

    let seqWidth = Number(currentFormula.match(/\{Seq:(\d+)\}/)?.[1] ?? 0);
    let seqMax = seqWidth > 0 ? Math.pow(10, seqWidth) - 1 : Infinity;

    // عرض {Seq} را خودمان زیاد نمی‌کنیم؛ فرمول مالِ کارشناس است.
    if (seqWidth > 0 && seq > seqMax) {
      throw new Error(
        `سریال این مقطع به ${seq} رسید ولی عرض {Seq:${seqWidth}} حداکثر ${seqMax} را می‌پذیرد. ` +
          `در «فرمول‌ساز» عرض را به {Seq:${seqWidth + 1}} تغییر دهید.`,
      );
    }

    const code = renderStudentCode(currentFormula, {
      entryYear: params.entryYear,
      degreeCode: level?.code,
      majorCode: params.majorCode,
      seq,
      quotaCode: params.quotaCode,
    });

    // تداخل فقط در محدودهٔ همین دانشگاه (یا رکوردهای بدون دانشگاه) معنا دارد.
    const clashScope = params.universityId != null
      ? or(eq(students.universityId, params.universityId), isNull(students.universityId))
      : isNull(students.universityId);
    const [clash] = await q
      .select({ id: students.id })
      .from(students)
      .where(and(clashScope, eq(students.studentCode, code)))
      .limit(1);

    if (!clash) return code;

    if (seqWidth === 0) {
      throw new Error('فرمول بدون {Seq} شمارهٔ یکتا تولید نمی‌کند؛ یک متغیر {Seq:n} اضافه کنید.');
    }
    // تداخل → سریال بعدی در تکرار بعدی
  }

  throw new Error('تولید شمارهٔ یکتا ممکن نشد (تعداد تلاش بیش از حد).');
}

/**
 * تابع میانجی سازگار با checkFormulaUniqueness — شماره را با موتور اشتراکی
 * می‌سازد. کد مقطع (BS/MS/PHD) را به رقم تبدیل می‌کند.
 */
export function renderStudentCode(
  formula: string,
  v: {
    entryYear: number;
    degreeCode?: string | null;
    majorCode?: string;
    seq: number;
    quotaCode?: number;
    /** متغیرهای تکمیلی از دادهٔ سنجش (جنسیت، استان، بومی‌گری، دیپلم، ترم) */
    extra?: Record<string, string>;
  },
): string {
  const vars: Record<string, string> = {
    Year: String(v.entryYear),
    DegreeCode: degreeCodeFor(v.degreeCode),
    MajorCode: v.majorCode || '412',
    Seq: String(v.seq ?? 0),
    QuotaCode: String(v.quotaCode ?? 1),
    UniversityCode: '',
    ...(v.extra ?? {}),
  };
  return applyFormula(formula, vars).result;
}

/**
 * بررسی یکتایی فرمول پیش از ذخیره: برای همهٔ رشته‌های این مقطع و ترتیب‌های آیندهٔ (از fromSeq تا ۹۹۹)
 * شماره‌ها را می‌سازد و با شمارهٔ دانشجویی‌های موجود همین دانشگاه و با یکدیگر مقایسه می‌کند.
 */
export async function checkFormulaUniqueness(
  formula: string,
  degreeLevelId: number,
  universityId: number,
  entryYear = 1405,
  fromSeq = 1,
): Promise<{ ok: boolean; error?: string; checked: number; collisions: string[] }> {
  if (!/\{Seq:\d+\}/.test(formula)) {
    return { ok: false, error: 'فرمول باید متغیر {Seq} (شماره ترتیب) داشته باشد.', checked: 0, collisions: [] };
  }

  const [level] = await db
    .select({ code: degree_level_configs.code })
    .from(degree_level_configs)
    .where(eq(degree_level_configs.id, degreeLevelId))
    .limit(1);

  const majorRows = await db
    .select({ majorCode: majors.majorCode })
    .from(majors)
    .where(eq(majors.degreeLevelId, degreeLevelId));
  const majorCodes = [...new Set(majorRows.map(m => m.majorCode || '412'))];
  if (majorCodes.length === 0) majorCodes.push('412');

  const existingRows = await db
    .select({ code: students.studentCode })
    .from(students)
    .where(or(eq(students.universityId, universityId), isNull(students.universityId)));
  const existing = new Set(existingRows.map(r => r.code));

  const seen = new Map<string, string>();
  const collisions: string[] = [];
  let checked = 0;
  for (const mc of majorCodes) {
    for (let seq = fromSeq; seq <= 999; seq++) {
      const code = renderStudentCode(formula, { entryYear, degreeCode: level?.code, majorCode: mc, seq });
      if (code.length > 14) {
        return { ok: false, error: `طول شماره «${code}» بیشتر از ۱۴ کاراکتر است.`, checked, collisions };
      }
      checked++;
      const key = `${mc}#${seq}`;
      const prev = seen.get(code);
      if (prev !== undefined && prev !== key) {
        collisions.push(`${code} (${prev} و ${key})`);
      }
      seen.set(code, key);
      if (existing.has(code)) collisions.push(`${code} (قبلاً برای دانشجوی موجود صادر شده)`);
      if (collisions.length >= 20) break;
    }
    if (collisions.length >= 20) break;
  }

  if (collisions.length > 0) {
    return {
      ok: false,
      error: `فرمول یکتا نیست. نمونه تداخل‌ها: ${collisions.slice(0, 5).join('، ')}`,
      checked,
      collisions,
    };
  }
  return { ok: true, checked, collisions };
}

// ============================================================================
// پارسر فایل متنی سازمان سنجش و بارگذاری در Staging (Sanjesh Text File Parser)
// ============================================================================

export interface StagingParsedRow {
  nationalCode: string;
  firstName: string;
  lastName: string;
  sanjeshCode: string;
  quota: string;
  mobile?: string;
  rank?: number;
  examType?: string;
  degreeLevel?: string;
  majorGroup?: string;
  universityCode?: string;
}

const NATIONAL_CODE_RE = /^\d{10}$/;

/** نمایش ماسک‌شدهٔ کد ملی در لاگ/خروجی تشخیصی — هرگز خام لاگ نکنید */
const maskNc = (nc: string) => {
  const s = String(nc ?? '');
  return s.length <= 4 ? '[REDACTED]' : `${s.slice(0, 3)}*******${s.slice(-1)}`;
};

export async function parseAndStageSanjeshData(rawText: string, entryYear = 1405) {
  await ensureDefaultSanjeshMappings();

  const lines = rawText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const mappings = await db.select().from(sanjesh_mappings);
  const allMajors = await db.select().from(majors);
  const [defaultLevel] = await db.select().from(degree_level_configs).limit(1);

  // کد ملی‌هایی که قبلاً stage شده‌اند — جلوگیری از ورود تکراری (idempotent)
  const existingCodes = new Set(
    (await db.select({ nationalCode: admissions_staging.nationalCode }).from(admissions_staging)).map(r => r.nationalCode),
  );

  const stagedResults: any[] = [];
  let skippedInvalid = 0;
  let skippedDuplicates = 0;

  for (const line of lines) {
    // پشتیبانی از فرمت‌های کاما، تب، پایپ، یا فاصله‌های متعدد
    const parts = line.split(/[,;\t|]|\s{2,}/).map(p => p.trim()).filter(p => p.length > 0);
    if (parts.length < 4) continue;

    // انعطاف‌پذیری در موقعیت ستون‌ها: حداقل ۴ ستون اول ثابت، بقیه اختیاری
    const nationalCode = parts[0];
    const firstName = parts[1];
    const lastName = parts[2];
    const sanjeshCode = parts[3];
    const quota = parts[4] || 'سهمیه عادی';
    const mobile = parts[5];
    const rank = parts[6] ? Number(parts[6]) : undefined;
    const examType = parts[7];
    const degreeLevel = parts[8];
    const majorGroup = parts[9];
    const universityCode = parts[10];

    // ── اعتبارسنجی کد ملی: ۱۰ رقم — خطوط نامعتبر بی‌صدا وارد سیستم نمی‌شوند ──
    if (!NATIONAL_CODE_RE.test(nationalCode)) {
      log.warn('sanjesh_invalid_national_code', { nationalCode: maskNc(nationalCode) });
      skippedInvalid++;
      continue;
    }
    // ── کد ملی تکراری (قبلاً stage شده) — بدون ساخت رکورد موازی ──
    if (existingCodes.has(nationalCode)) {
      skippedDuplicates++;
      continue;
    }
    existingCodes.add(nationalCode);

    // تطبیق با جدول نگاشت کدهای سنجش
    const match = mappings.find(m => m.sanjeshCode === sanjeshCode);
    const mappedMajorId = match ? match.internalMajorId : null;
    const status = mappedMajorId ? 'RESOLVED' : 'PENDING_MAPPING';

    const [staged] = await db
      .insert(admissions_staging)
      .values({
        nationalCode,
        fullName: `${firstName} ${lastName}`,
        rawSanjeshData: JSON.stringify({
          firstName,
          lastName,
          sanjeshCode,
          quota,
          rank,
          mobile: mobile || undefined,
          examType,
          degreeLevel,
          majorGroup,
          universityCode,
        }),
        mappedMajorId,
        entryYear,
        degreeLevelId: defaultLevel?.id || 1,
        quotaType: quota || 'NORMAL',
        mobile: mobile || null,
        status,
        onboardingStatus: 'IMPORTED',
      })
      .returning();

    stagedResults.push({
      id: staged.id,
      nationalCode,
      fullName: `${firstName} ${lastName}`,
      sanjeshCode,
      status,
      mappedMajorName: mappedMajorId ? allMajors.find(m => m.id === mappedMajorId)?.name : null,
    });
  }

  if (skippedInvalid || skippedDuplicates) {
    log.warn('sanjesh_parse_skipped', { skippedInvalid, skippedDuplicates });
  }
  return stagedResults;
}

// ============================================================================
// تبدیل رکوردهای Staging به دانشجو و کاربر نهایی (Batch Import to Users & Students)
// ============================================================================

/**
 * تبدیل رکوردهای staging به کاربر + دانشجو.
 *
 * هر رکورد در یک **تراکنش مستقل** پردازش می‌شود: ایجاد کاربر، تولید شمارهٔ
 * دانشجویی، ایجاد پرونده و به‌روزرسانی staging یا کاملاً موفق است یا کاملاً
 * برمی‌گردد — کاربر بدون پروندهٔ دانشجویی (یا شمارهٔ سوزانده‌شده) باقی نمی‌ماند.
 * شکست یک رکورد، بقیهٔ رکوردهای دسته را از کار نمی‌اندازد و در خروجی گزارش می‌شود.
 */
export async function assignStudentNumbers(
  stagingIds: number[],
  opts: { entryMethod: EntryMethod; starts?: Record<number, number> },
) {
  if (!isEntryMethod(opts.entryMethod)) throw new Error('روش ورود نامعتبر یا انتخاب‌نشده است.');
  const stagedRows = await db
    .select()
    .from(admissions_staging)
    .where(inArray(admissions_staging.id, stagingIds));

  const [defaultReg] = await db.select().from(educational_regulations).limit(1);
  const importedResults: any[] = [];
  const failures: { stagingId: number; error: string }[] = [];
  // شمارندهٔ سریال به‌ازای هر رشته (شروعِ دستی یا ادامهٔ بیشینهٔ موجود)
  const nextSeqByMajor = new Map<string, number>();
  // کشِ فرمول به‌ازای هر مقطع (یک‌بار خوانده می‌شود)
  const formulaCache = new Map<number, string>();
  // کشِ کد مقطع (BS/MS/PHD) برای ساخت پیشوند سال‌محور
  const degreeCodeCache = new Map<number, string | null>();

  for (const row of stagedRows) {
    if (!row.mappedMajorId || row.status !== 'RESOLVED') continue;
    // کپی محلی بعد از گارد — narrowing درون closure تراکنش از بین می‌رود
    const mappedMajorId = row.mappedMajorId;
    const entryYear = row.entryYear || 1405;
    const quotaType = row.quotaType || 'NORMAL';
    const nationalCode = row.nationalCode;
    const universityId = row.universityId ?? 0;

    let parsed: any = {};
    try {
      if (row.rawSanjeshData) parsed = JSON.parse(row.rawSanjeshData);
    } catch (_) {}

    // متغیرهای تکمیلی فرمول از دادهٔ سنجش — فقط اگر واقعاً موجود باشند
    // (مقدار خالی در applyFormula خطا می‌دهد، نه صفر جعلی).
    let pf: Record<string, string> = {};
    try {
      if (row.profileJson) pf = JSON.parse(row.profileJson)?.fields ?? {};
    } catch (_) {}
    const quotaTitle = String(parsed?.quota ?? '');
    const extraVars: Record<string, string> = {
      Gender: pf.gender ?? '',
      Province: pf.provinceCurrentCode ?? '',
      DiplomaCode: pf.diplomaCode ?? '',
      TermCode: '1',
      Settlement: quotaTitle ? (quotaTitle.includes('بومي') || quotaTitle.includes('بومی') ? '1' : '2') : '',
    };

    try {
      const result = await db.transaction(async tx => {
        // ۱. بررسی یا ایجاد کاربر پلی‌مورفیک (Unified User) — در سطح دانشگاه
        let [user] = await tx
          .select()
          .from(users)
          .where(and(eq(users.nationalCode, nationalCode), eq(users.universityId, universityId)))
          .limit(1);

        if (!user) {
          // رمز پیش‌فرض با همان موتور امنیتی سراسری (scrypt + salt تصادفی) —
          // نه sha256 خام؛ و فلگ «تغییر اجباری رمز» برای اولین ورود ست می‌شود.
          const tempPassword = crypto.randomBytes(9).toString('base64url').slice(0, 12);
            const passwordHash = await hashPassword(tempPassword);
          [user] = await tx
            .insert(users)
            .values({
              nationalCode,
              firstName: parsed.firstName || row.fullName?.split(' ')[0] || 'دانشجو',
              lastName: parsed.lastName || row.fullName?.split(' ').slice(1).join(' ') || 'پذیرفته‌شده',
              mobile: row.mobile || parsed.mobile || null,
              passwordHash,
              isActive: 1,
              mustChangePassword: 1,
              universityId,
            })
            .returning();
        }

        // ۲. هر پذیرش یک پروندهٔ تازه با شماره دانشجویی جدید می‌گیرد؛ پرونده‌های قبلی دست‌نخورده می‌مانند.
        //    پروندهٔ فعال با همان رشته و ورودی فقط با تصمیم صریح ادمین روی همان ردیف (ALLOW_DUPLICATE) ثبت می‌شود.
        if (row.decisionNote === 'REPLACED') {
          // جایگزین: پروندهٔ فعال قبلی را غیرفعال می‌کنیم، ثبت‌نام‌های قبلی دست‌نخورده می‌مانند
          await tx
            .update(students)
            .set({ status: 'REPLACED' })
            .where(and(
              eq(students.userId, user.id),
              eq(students.majorId, mappedMajorId),
              eq(students.entryYear, entryYear),
              eq(students.status, 'ACTIVE'),
            ));
        } else if (row.decisionNote !== 'ALLOW_DUPLICATE') {
          // تطبیق فقط بر «شناسهٔ رشته» کافی نیست: در جدول majors چند رکورد با نام
          // یکسان ولی شناسه/کد متفاوت وجود دارد (مثلاً حسابداری با کد ۲۲ و ۹۲۲).
          // اگر فقط شناسه را بسنجیم، برای دانشجوی موجود یک پروندهٔ دومِ هم‌نام ساخته
          // می‌شود. پس همان سالِ ورود + رشتهٔ فعال + نام یکسان هم «تکراری» است.
          const [stagingMajorRow] = await tx
            .select({ name: majors.name })
            .from(majors)
            .where(eq(majors.id, mappedMajorId))
            .limit(1);

          const candidates = await tx
            .select({
              id: students.id,
              studentCode: students.studentCode,
              majorId: students.majorId,
              majorName: majors.name,
            })
            .from(students)
            .leftJoin(majors, eq(majors.id, students.majorId))
            .where(and(
              eq(students.userId, user.id),
              eq(students.entryYear, entryYear),
              eq(students.status, 'ACTIVE'),
            ));

          const match = pickExistingProfile(candidates, {
            majorId: mappedMajorId,
            majorName: stagingMajorRow?.name ?? null,
          });

          if (match) {
            const dup = match.profile;
            // انتقال دوبارهٔ همان فایل (یا ردیفی که قبلاً منتقل شده) نباید خطا بدهد و
            // نباید شمارهٔ دانشجویی تکراری بسازد. ردیف صف را به همان پروندهٔ موجود
            // «وصل» می‌کنیم و بیرون می‌رویم — عملیات idempotent است.
            // برای ثبت عمدیِ پروندهٔ دوم، ادمین باید ALLOW_DUPLICATE را روی ردیف بگذارد.
            await tx
              .update(admissions_staging)
              .set({
                status: 'NUMBER_ASSIGNED',
                studentId: dup.id,
                userId: user.id,
                assignedStudentCode: dup.studentCode,
                onboardingStatus: 'NUMBER_ASSIGNED',
              })
              .where(eq(admissions_staging.id, row.id));
            return {
              studentCode: dup.studentCode,
              userId: user.id,
              firstName: user.firstName,
              lastName: user.lastName,
              linked: true,
              linkReason: match.reason,
            };
          }
        }

        // ۳. مقطع از خود رشته گرفته می‌شود؛ سپس شمارهٔ دانشجویی «به‌ازای هر رشته»
        //    با «شمارهٔ شروع» دستی (اگر داده شده) یا ادامهٔ بیشینهٔ موجودِ همان رشته.
        const [major] = await tx.select().from(majors).where(eq(majors.id, mappedMajorId)).limit(1);
        const degreeLevelId = major?.degreeLevelId ?? row.degreeLevelId ?? null;
        if (!degreeLevelId) throw new Error('مقطع این رشته مشخص نیست.');

        let formula = formulaCache.get(degreeLevelId);
        if (formula === undefined) {
          const [fr] = await tx
            .select({ formula: student_id_formulas.formula })
            .from(student_id_formulas)
            .where(eq(student_id_formulas.degreeLevelId, degreeLevelId))
            .limit(1);
          // فرمول را کارشناس تعریف می‌کند. اگر نبود یا معتبر نبود، ما به‌جای او
          // تصمیم نمی‌گیریم و فرمول پیش‌فرض را جایگزین نمی‌کنیم.
          if (!fr?.formula) {
            throw new Error(
              `برای مقطع «${major?.degreeLevelId ?? degreeLevelId}» فرمول شمارهٔ دانشجویی تعریف نشده است. ` +
                'در تب «فرمول‌ساز» آن را تعریف کنید.',
            );
          }
          const errs = validateFormula(fr.formula);
          if (errs.length > 0) {
            throw new Error(`فرمول شمارهٔ دانشجویی این مقطع معتبر نیست: ${errs.join(' ؛ ')}`);
          }
          formula = fr.formula;
          formulaCache.set(degreeLevelId, formula);
        }

        const seqKey = `${row.universityId ?? 'null'}#${mappedMajorId}`;
        let startSeq = nextSeqByMajor.get(seqKey);
        if (startSeq === undefined) {
          const explicit = opts.starts?.[mappedMajorId];
          if (explicit != null && explicit > 0) {
            startSeq = Math.floor(explicit);
          } else {
            // ادامه از بیشینهٔ همان سال+رشته: پیشوند کد (بدون سریال) را می‌سازیم.
            let degreeCode = degreeCodeCache.get(degreeLevelId);
            if (degreeCode === undefined) {
              const [lvl] = await tx
                .select({ code: degree_level_configs.code })
                .from(degree_level_configs)
                .where(eq(degree_level_configs.id, degreeLevelId))
                .limit(1);
              degreeCode = lvl?.code ?? null;
              degreeCodeCache.set(degreeLevelId, degreeCode);
            }
            const mCode = major?.majorCode || '412';
            const w = Number(formula.match(/\{Seq:(\d+)\}/)?.[1] ?? 3) || 3;
            const sample = renderStudentCode(formula, { entryYear, degreeCode, majorCode: mCode, seq: 0, extra: extraVars });
            const prefix = sample.slice(0, Math.max(0, sample.length - w));
            startSeq = (await maxSeqForMajor(tx, mappedMajorId, prefix)) + 1;
          }
        }
        const assigned = await assignCodeAtSeq(tx, {
          formula,
          degreeLevelId,
          entryYear,
          majorCode: major?.majorCode || '412',
          universityId: row.universityId ?? null,
          startSeq,
          extra: extraVars,
        });
        nextSeqByMajor.set(seqKey, assigned.seq + 1);
        formulaCache.set(degreeLevelId, assigned.formula);
        const studentCode = assigned.code;

        // ۴. ایجاد پروندهٔ دانشجویی با منبع و روش ورود
        const fromSanjesh = row.fileId != null;
        const [newStudent] = await tx
          .insert(students)
          .values({
            userId: user.id,
            studentCode,
            universityId: row.universityId ?? null,
            majorId: mappedMajorId,
            degreeLevelId,
            regulationId: defaultReg?.id || 1,
            entryYear,
            entryTerm: 1,
            status: 'ACTIVE',
            quotaType,
            currentTermNo: 1,
            acceptanceType: opts.entryMethod,
            admissionSource: fromSanjesh ? 'SANJESH' : 'MANUAL',
            sanjeshFileId: row.fileId ?? null,
            sanjeshRowNo: row.rowNo ?? null,
            manualReason: fromSanjesh ? null : 'ثبت از متن دستی (بدون فایل سنجش)',
          })
          .returning();
        const studentId = newStudent.id;

        // ۵. به‌روزرسانی وضعیت در Staging (فقط شماره صادر شده، ثبت قطعی نشده)
        await tx
          .update(admissions_staging)
          .set({
            status: 'NUMBER_ASSIGNED',
            studentId,
            userId: user.id,
            assignedStudentCode: studentCode,
            onboardingStatus: 'NUMBER_ASSIGNED',
          })
          .where(eq(admissions_staging.id, row.id));

        return { studentCode, userId: user.id, firstName: user.firstName, lastName: user.lastName, linked: false, linkReason: null };
      });

      importedResults.push({
        stagingId: row.id,
        studentCode: result.studentCode,
        fullName: `${result.firstName} ${result.lastName}`,
        nationalCode: row.nationalCode,
        linked: result.linked === true,
        linkReason: result.linkReason ?? null,
      });
    } catch (err: any) {
      // رکورد ناموفق به‌طور کامل rollback شد — بقیهٔ دسته ادامه می‌یابد.
      // err ممکن است پیام unique-violation با کد ملی خام داشته باشد؛ هم لاگ و
      // هم متن برگشتی به UI از فیلتر maskSecrets عبور می‌کند.
      const rawMessage = err instanceof Error
        ? err.message
        : (err?.message ?? (typeof err === 'string' ? err : 'خطای ناشناخته'));
      log.error('staging_import_failed', { stagingId: row.id, err });
      failures.push({ stagingId: row.id, error: String(maskSecrets(rawMessage)) });
    }
  }

  return { imported: importedResults, failures };
}

/**
 * مرحلهٔ دوم: ثبت قطعی ردیف‌هایی که شماره دانشجویی آنان صادر شده است.
 * فقط وضعیت staging را از NUMBER_ASSIGNED به IMPORTED می‌برد.
 */
export async function finalRegisterStudents(stagingIds: number[]) {
  const stagedRows = await db
    .select()
    .from(admissions_staging)
    .where(inArray(admissions_staging.id, stagingIds));

  const importedResults: any[] = [];
  const failures: { stagingId: number; error: string }[] = [];

  for (const row of stagedRows) {
    if (!row.studentId || row.status !== 'NUMBER_ASSIGNED') continue;
    try {
      await db
        .update(admissions_staging)
        .set({ status: 'IMPORTED', onboardingStatus: 'COMPLETED' })
        .where(eq(admissions_staging.id, row.id));
      importedResults.push({ stagingId: row.id, studentCode: null, fullName: row.fullName, nationalCode: row.nationalCode });
    } catch (err: any) {
      const rawMessage = err instanceof Error
        ? err.message
        : (err?.message ?? 'خطای ناشناخته');
      failures.push({ stagingId: row.id, error: String(maskSecrets(rawMessage)) });
    }
  }

  return { imported: importedResults, failures };
}

// ============================================================================
// ثبت‌نام دستی، انتقالی و اتباع خارجی (Manual & Alternative Admissions)
// ============================================================================

export async function registerManualStudent(params: {
  nationalCode: string;
  firstName: string;
  lastName: string;
  mobile: string;
  majorId: number;
  degreeLevelId: number;
  entryYear?: number;
  entryTerm?: number;
  quotaType?: string;
  admissionType?: 'NORMAL' | 'TRANSFER' | 'INTERNATIONAL' | 'FREE_COURSE';
  manualReason?: string;
  universityId?: number;
}) {
  const entryYear = params.entryYear || 1405;

  return db.transaction(async tx => {
    const [defaultReg] = await tx.select().from(educational_regulations).limit(1);
    
    // Get universityId from params or current user's university
    const universityId = params.universityId ?? (await getCurrentUniversity())?.id ?? 1;

    // ۱. ایجاد یا یافتن کاربر یکپارچه — در سطح دانشگاه
    let [user] = await tx
      .select()
      .from(users)
      .where(and(eq(users.nationalCode, params.nationalCode), eq(users.universityId, universityId)))
      .limit(1);

    if (!user) {
      const tempPassword = crypto.randomBytes(9).toString('base64url').slice(0, 12);
            const passwordHash = await hashPassword(tempPassword);
      [user] = await tx
        .insert(users)
        .values({
          nationalCode: params.nationalCode,
          firstName: params.firstName,
          lastName: params.lastName,
          mobile: params.mobile,
          passwordHash,
          isActive: 1,
          mustChangePassword: 1,
          universityId,
        })
        .returning();
    }

    // ۲. تولید شمارهٔ دانشجویی با فرمول پویا (اتمیک — داخل همان تراکنش)
    const [major] = await tx.select().from(majors).where(eq(majors.id, params.majorId)).limit(1);
    const seqFloor = await maxSeqForDegree(tx, params.degreeLevelId);
    const studentCode = await generateStudentId(
      {
        degreeLevelId: params.degreeLevelId,
        entryYear,
        majorCode: major?.majorCode || '412',
        universityId,
        minSeq: seqFloor,
      },
      tx,
    );

    // ۳. ایجاد پروندهٔ دانشجویی
    const [newStudent] = await tx
      .insert(students)
      .values({
        userId: user.id,
        studentCode,
        universityId,
        majorId: params.majorId,
        degreeLevelId: params.degreeLevelId,
        regulationId: defaultReg?.id || 1,
        entryYear,
        entryTerm: params.entryTerm || 1,
        status: 'ACTIVE',
        quotaType: params.quotaType || 'NORMAL',
        currentTermNo: 1,
        admissionSource: 'MANUAL',
        manualReason: params.manualReason || 'ثبت دستی (بدون فایل سنجش)',
        acceptanceType: ({ TRANSFER: 'انتقالی', INTERNATIONAL: 'اتباع خارجی', FREE_COURSE: 'دوره آزاد' } as Record<string, string>)[params.admissionType ?? ''] ?? null,
      })
      .returning();

    return {
      studentId: newStudent.id,
      userId: user.id,
      studentCode,
      fullName: `${user.firstName} ${user.lastName}`,
    };
  });
}

/**
 * مرحلهٔ تصمیم: برای ردیف‌های آمادهٔ انتقال، پرونده‌های دانشجویی موجودِ همان کد ملی را برمی‌گرداند.
 * `sameMajorYearActive` = آیا پرونده‌ای فعال با همان رشته و ورودیِ این پذیرش وجود دارد (تکراری احتمالی).
 */
export async function findExistingRecordsForStaging(universityId: number | null) {
  const rows = await db
    .select({
      id: admissions_staging.id,
      nationalCode: admissions_staging.nationalCode,
      fullName: admissions_staging.fullName,
      mappedMajorId: admissions_staging.mappedMajorId,
      entryYear: admissions_staging.entryYear,
      decisionNote: admissions_staging.decisionNote,
      status: admissions_staging.status,
    })
    .from(admissions_staging)
    .where(inArray(admissions_staging.status, ['RESOLVED', 'REJECTED']));

  const ncs = [...new Set(rows.map(r => r.nationalCode))];
  if (ncs.length === 0) return [];

  const found = await db
    .select({
      nationalCode: users.nationalCode,
      studentCode: students.studentCode,
      majorId: students.majorId,
      majorName: majors.name,
      entryYear: students.entryYear,
      entryTerm: students.entryTerm,
      status: students.status,
      admissionSource: students.admissionSource,
      acceptanceType: students.acceptanceType,
    })
    .from(students)
    .innerJoin(users, eq(users.id, students.userId))
    .leftJoin(majors, eq(majors.id, students.majorId))
    .where(and(
      inArray(users.nationalCode, ncs),
      universityId != null ? eq(users.universityId, universityId) : sql`true`,
    ));

  const byNc = new Map<string, typeof found>();
  for (const f of found) {
    const list = byNc.get(f.nationalCode) ?? [];
    list.push(f);
    byNc.set(f.nationalCode, list);
  }

  return rows
    .map(r => {
      const existing = byNc.get(r.nationalCode) ?? [];
      const entryYear = r.entryYear || 1405;
      return {
        stagingId: r.id,
        nationalCode: r.nationalCode,
        fullName: r.fullName,
        newMajorId: r.mappedMajorId,
        newEntryYear: entryYear,
        decision: r.status === 'REJECTED'
          ? 'REJECT'
          : r.decisionNote === 'ALLOW_DUPLICATE' ? 'ALLOW_DUPLICATE' : null,
        sameMajorYearActive: existing.some(
          e => e.majorId === r.mappedMajorId && e.entryYear === entryYear && e.status === 'ACTIVE',
        ),
        existing,
      };
    })
    .filter(x => x.existing.length > 0);
}
