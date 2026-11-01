import crypto from 'crypto';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/db';
import { hashPassword } from '@/lib/auth';
import { getCurrentUniversity } from '@/lib/university-scope';
import { createLogger, maskSecrets } from '@/lib/logger';
import { isEntryMethod, type EntryMethod } from '@/lib/entry-methods';
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
export async function generateStudentId(
  params: {
    degreeLevelId: number;
    entryYear: number;
    majorCode?: string;
    quotaCode?: number;
  },
  q: any = db,
): Promise<string> {
  const [level] = await q
    .select()
    .from(degree_level_configs)
    .where(eq(degree_level_configs.id, params.degreeLevelId))
    .limit(1);

  // واکشی فرمول تعریف‌شده یا ایجاد فرمول پیش‌فرض
  const [formulaRow] = await q
    .select()
    .from(student_id_formulas)
    .where(eq(student_id_formulas.degreeLevelId, params.degreeLevelId))
    .limit(1);

  const formula = formulaRow?.formula || '{Year:2}{DegreeCode:1}{MajorCode:3}{Seq:3}';
  let nextSeq: number;

  if (formulaRow) {
    // ── افزایش اتمیک: UPDATE ... RETURNING در یک دستور — بدون race ──
    const [upd] = await q
      .update(student_id_formulas)
      .set({ currentSequence: sql`${student_id_formulas.currentSequence} + 1` })
      .where(eq(student_id_formulas.id, formulaRow.id))
      .returning({ seq: student_id_formulas.currentSequence });
    nextSeq = upd ? upd.seq : (formulaRow.currentSequence ?? 0) + 1;
  } else {
    const [ins] = await q
      .insert(student_id_formulas)
      .values({
        degreeLevelId: params.degreeLevelId,
        entryYear: params.entryYear,
        formula,
        currentSequence: 1,
      })
      .onConflictDoNothing({ target: student_id_formulas.degreeLevelId })
      .returning({ seq: student_id_formulas.currentSequence });
    if (ins) {
      nextSeq = ins.seq;
    } else {
      // رقابت: ردیف فرمول توسط تراکنش دیگر ساخته شد → همان مسیر اتمیک
      const [row2] = await q
        .select()
        .from(student_id_formulas)
        .where(eq(student_id_formulas.degreeLevelId, params.degreeLevelId))
        .limit(1);
      if (!row2) throw new Error('ایجاد فرمول شمارهٔ دانشجویی ممکن نشد.');
      const [upd] = await q
        .update(student_id_formulas)
        .set({ currentSequence: sql`${student_id_formulas.currentSequence} + 1` })
        .where(eq(student_id_formulas.id, row2.id))
        .returning({ seq: student_id_formulas.currentSequence });
      nextSeq = upd ? upd.seq : (row2.currentSequence ?? 0) + 1;
    }
  }

  // استخراج متغیرها
  const year2 = String(params.entryYear).slice(-2); // مثلاً 05 برای 1405
  const degreeDigit = level?.code === 'BS' ? '1' : level?.code === 'MS' ? '2' : level?.code === 'PHD' ? '3' : '1';
  const major3 = (params.majorCode || '412').padStart(3, '0').slice(-3);
  const seq3 = String(nextSeq).padStart(3, '0');
  const quota1 = String(params.quotaCode || 1);

  // جایگذاری متغیرها در الگوی فرمول
  let generated = formula
    .replace('{Year:2}', year2)
    .replace('{DegreeCode:1}', degreeDigit)
    .replace('{MajorCode:3}', major3)
    .replace('{Seq:3}', seq3)
    .replace('{QuotaCode:1}', quota1);

  // در صورتی که فرمول متغیرهای پیش‌فرض نداشت
  if (!generated || generated === formula) {
    generated = `${year2}${degreeDigit}${major3}${seq3}`;
  }

  return generated;
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
export async function importStagedToStudents(
  stagingIds: number[],
  opts: { entryMethod: EntryMethod; allowDuplicates?: boolean },
) {
  if (!isEntryMethod(opts.entryMethod)) throw new Error('روش ورود نامعتبر یا انتخاب‌نشده است.');
  const stagedRows = await db
    .select()
    .from(admissions_staging)
    .where(inArray(admissions_staging.id, stagingIds));

  const [defaultReg] = await db.select().from(educational_regulations).limit(1);
  const importedResults: any[] = [];
  const failures: { stagingId: number; error: string }[] = [];

  for (const row of stagedRows) {
    if (!row.mappedMajorId || row.status !== 'RESOLVED') continue;
    // کپی محلی بعد از گارد — narrowing درون closure تراکنش از بین می‌رود
    const mappedMajorId = row.mappedMajorId;
    const degreeLevelId = row.degreeLevelId || 1;
    const entryYear = row.entryYear || 1405;
    const quotaType = row.quotaType || 'NORMAL';
    const nationalCode = row.nationalCode;
    const universityId = row.universityId ?? 0;

    let parsed: any = {};
    try {
      if (row.rawSanjeshData) parsed = JSON.parse(row.rawSanjeshData);
    } catch (_) {}

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
        //    پروندهٔ فعال با همان رشته و ورودی فقط با تأیید صریح ادمین (allowDuplicates) ثبت می‌شود.
        if (!opts.allowDuplicates) {
          const [dup] = await tx
            .select({ studentCode: students.studentCode })
            .from(students)
            .where(and(
              eq(students.userId, user.id),
              eq(students.majorId, mappedMajorId),
              eq(students.entryYear, entryYear),
              eq(students.status, 'ACTIVE'),
            ))
            .limit(1);
          if (dup) {
            throw new Error(`پروندهٔ فعال با همین رشته و ورودی وجود دارد (شماره ${dup.studentCode}). برای ثبت تکراری، تأیید صریح لازم است.`);
          }
        }

        // ۳. تولید شمارهٔ دانشجویی پویا (اتمیک — داخل همین تراکنش)
        const [major] = await tx.select().from(majors).where(eq(majors.id, mappedMajorId)).limit(1);
        const studentCode = await generateStudentId(
          { degreeLevelId, entryYear, majorCode: major?.majorCode || '412' },
          tx,
        );

        // ۴. ایجاد پروندهٔ دانشجویی با منبع و روش ورود
        const fromSanjesh = row.fileId != null;
        const [newStudent] = await tx
          .insert(students)
          .values({
            userId: user.id,
            studentCode,
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

        // ۵. به‌روزرسانی وضعیت در Staging
        await tx
          .update(admissions_staging)
          .set({
            status: 'IMPORTED',
            studentId,
            userId: user.id,
            onboardingStatus: 'COMPLETED',
          })
          .where(eq(admissions_staging.id, row.id));

        return { studentCode, userId: user.id, firstName: user.firstName, lastName: user.lastName };
      });

      importedResults.push({
        stagingId: row.id,
        studentCode: result.studentCode,
        fullName: `${result.firstName} ${result.lastName}`,
        nationalCode: row.nationalCode,
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
    const studentCode = await generateStudentId(
      {
        degreeLevelId: params.degreeLevelId,
        entryYear,
        majorCode: major?.majorCode || '412',
      },
      tx,
    );

    // ۳. ایجاد پروندهٔ دانشجویی
    const [newStudent] = await tx
      .insert(students)
      .values({
        userId: user.id,
        studentCode,
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
