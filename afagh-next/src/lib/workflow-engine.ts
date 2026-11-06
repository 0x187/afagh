import crypto from 'crypto';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '@/db';
import {
  academic_terms,
  course_offerings,
  enrollments,
  notifications,
  process_definitions,
  process_steps,
  request_parallel_checkpoints,
  request_step_logs,
  student_ledger,
  student_requests,
  students,
} from '@/db/schema';
import { getFiscalYear, getSetting } from '@/lib/settings';
import { dispatchWorkflowEvent, fireWorkflowEvent, type WorkflowEventCode } from '@/lib/workflow-events';
import { notifyUserMultichannel } from '@/lib/messaging';
import { createLogger } from '@/lib/logger';
import { ledgerBalance } from '@/lib/ledger-balance';
// import با اثر جانبی عمدی: بارگذاری این فایل، هندلرهای رویداد را رجیستر می‌کند
import '@/lib/workflow-handlers';

// ══════════════════════════════════════════════════════════════════════
//  موتور گردش کار (BPM) — نسخهٔ تراکنشی
//
//  سه اصل حاکم بر این فایل:
//   ۱) اتمیک بودن: هر تصمیم روی پرونده (تأیید/رد/ارجاع/تسویهٔ موازی) در یک
//      `db.transaction` انجام می‌شود؛ یا همهٔ نوشتن‌ها می‌نشینند یا هیچ‌کدام.
//      پیش از این، لاگ مرحله و وضعیت درخواست در دو کوئری جدا نوشته می‌شد و
//      خاموش‌شدن سرویس بین آن دو، پروندهٔ ناقص به جا می‌گذاشت.
//   ۲) همزمانی: سطر پرونده با `for update` قفل می‌شود تا دو کارشناس (یا cron
//      و کارشناس) همزمان یک مرحله را دوبار پیش نبرند؛ پروندهٔ مختومه هم
//      idempotent برخورد می‌شود.
//   ۳) جداسازی دغدغه‌ها: موتور فقط وضعیت جابه‌جا می‌کند و در لحظهٔ تصمیم
//      «رویداد» شلیک می‌کند. اثر تجاری (مثلاً ثبت درس تطبیق‌شده) در ماژول
//      صاحب اثر اجرا می‌شود — فایل workflow-handlers.ts.
// ══════════════════════════════════════════════════════════════════════

const log = createLogger({ mod: 'workflow.engine' });

export type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
/** هر مجری کوئری — اتصال معمولی یا تراکنش */
export type DbLike = DbTx | typeof db;

/** اجرا در تراکنش — اگر از بیرون تراکنشی داده شد، در همان ادامه می‌یابد (بدون تودرتو) */
async function inTx<T>(tx: DbTx | undefined, fn: (t: DbTx) => Promise<T>): Promise<T> {
  if (tx) return fn(tx);
  return db.transaction(fn);
}

/** وضعیت‌های پایانی — پرونده در این حالت‌ها دیگر پیش نمی‌رود */
const TERMINAL_STATUSES = ['APPROVED', 'REJECTED', 'CANCELLED'];

/** وضعیت‌های باز (در جریان) */
const OPEN_STATUSES = ['SUBMITTED', 'IN_REVIEW', 'RETURNED'];

/** تراز مالی دانشجو — واگذار به تراز کانونی (واژگان یکتا).
 *  قرارداد علامت کانونی (ledger-balance.ts): مثبت = بدهی دانشجو،
 *  صفر/منفی = تسویه یا بستانکار (بستانکار به‌صورت منفی نمایش داده می‌شود). */
export async function studentLedgerBalance(tx: DbTx | undefined, studentId: number): Promise<number> {
  const t = tx ?? db;
  const rows = await t
    .select({ transactionType: student_ledger.transactionType, amount: student_ledger.amount })
    .from(student_ledger)
    .where(eq(student_ledger.studentId, studentId));
  return ledgerBalance(rows);
}

/**
 * کد رهگیری یکتا.
 * پیش از این «سال ثابت ۱۴۰۵ + عدد تصادفی ۵ رقمی» بود؛ یعنی هم سال هاردکد بود
 * و هم با حدود ۳۸۰ درخواست احتمال برخورد به ۵۰٪ می‌رسید (تصادف تولد) و درج با
 * خطای یکتایی می‌شکست. حالا: سال از تنظیمات/تقویم، شماره از ترتیب واقعی
 * پرونده‌ها، و در نهایت تلاش مجدد در صورت برخورد.
 */
async function nextTrackingCode(tx: DbTx, prefix: string, year: string): Promise<string> {
  // 🎯 بازبینی ۵ (جای بهبود ۱): شماره از «دنبالهٔ دیتابیس» گرفته می‌شود، نه count+حلقهٔ ۵۰تایی.
  // nextval در چند نسخهٔ همزمان سرور بی‌رقابت است؛ هیچ برخوردی رخ نمی‌دهد و همیشه یکتا می‌ماند
  // (حتی اگر دو درخواست همزمان در دو سرور ثبت شوند). دنباله در apply-patches ساخته و
  // بر اساس رکوردهای موجود پس‌زمینه‌سازی (setval) می‌شود؛ مصرف یک جای خالی در تراکنشِ
  // برگشت‌خورده طبیعی است (شماره‌های پرشی — همان رفتار استاندارد sequences).
  try {
    const res = await tx.execute(sql`select nextval('tracking_code_seq')::text as n`);
    const n = Number(res.rows[0]?.n);
    if (Number.isFinite(n) && n > 0) return `${prefix}-${year}-${String(n).padStart(5, '0')}`;
  } catch (err) {
    // دنباله هنوز در دیتابیس نیست (محیط توسعهٔ بدون apply-patches) → fallback امن
    log.warn('tracking_seq_missing', { err: (err as Error).message });
  }
  const [row] = await tx
    .select({ n: sql<string>`count(*)` })
    .from(student_requests)
    .where(sql`${student_requests.trackingCode} like ${'%' + year + '%'}`);
  const base = Number(row?.n ?? 0) + 1;
  for (let i = 0; i < 50; i++) {
    const code = `${prefix}-${year}-${String(base + i).padStart(5, '0')}`;
    const [dup] = await tx.select({ id: student_requests.id }).from(student_requests).where(eq(student_requests.trackingCode, code)).limit(1);
    if (!dup) return code;
  }
  return `${prefix}-${year}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

/** اعلان درون‌سامانه‌ای — داخل تراکنش (بدون تماس شبکه) */
async function inboxNotify(tx: DbTx, userId: number, eventCode: string, text: string) {
  await tx.insert(notifications).values({ userId, eventCode, payload: JSON.stringify({ text }) });
}

/** اعلان چندکاناله — *خارج* از تراکنش؛ شکست پیامک هرگز پرونده را برنمی‌گرداند */
async function safeMultichannel(userId: number | null | undefined, eventCode: string, text: string) {
  if (!userId) return;
  try {
    await notifyUserMultichannel({ userId, eventCode, text });
  } catch (err) {
    log.warn('notify_failed', { eventCode, userId, err: (err as Error).message });
  }
}

// ============================================================================
// عملیات آماده‌سازی و راه‌اندازی فرآیندها در پایگاه داده
// ============================================================================

// 🎯 بازبینی ۵ (جای بهبود ۲): کش محلیِ ماژول (processCache) حذف شد.
// در استقرار چند-نمونه‌ای (چند سرور/پاد)، هر نمونه کش خودش را داشت و پس از ویرایش
// تعریف فرآیندها در یک نمونه، بقیه تا ۳۰ ثانیه تعریف کهنه را می‌دیدند (ناهماهنگی).
// بها: یک SELECT کوچک روی process_definitions (چند ردیف) به ازای هر فراخوانی؛
// درستی بر بهینه‌سازیِ زودرس اولویت دارد. اگر پروفایل‌گیری بعداً نشان داد،
// همان‌جا سراغ Redis/کش مشترک می‌رویم — نه در لایهٔ ماژول. (invalidProcessCache
// هم حذف شد؛ فراخوانی‌اش از پنل مدیر — actions.ts — پاکسازی شد.)

/**
 * اطمینان از وجود فرآیندهای پیش‌فرض.
 * به‌جای ۲ کوئری به ازای هر فرایند، یک واکشی جمعی + نوشتن فقط در صورت نیاز؛
 * کل عملیات هم در یک تراکنش است تا نیمه‌کاره نماند.
 */
export async function ensureDefaultProcesses(_force = false) {
  // بدون کش: همیشه اعتبارسنجی/همگام‌سازی — در چند سرور سازگار است (بازبینی ۵)
  try {
    const existingDefs = await db
      .select({
        id: process_definitions.id,
        code: process_definitions.code,
        title: process_definitions.title,
        feeAmount: process_definitions.feeAmount,
        formSchema: process_definitions.formSchema,
      })
      .from(process_definitions);
    const byCode = new Map(existingDefs.map(d => [d.code, d]));

    const needWrite = BUILTIN_PROCESSES.some(p => {
      const d = byCode.get(p.code);
      return !d
        || d.title !== p.title
        || Number(d.feeAmount ?? 0) !== p.feeAmount
        || String(d.formSchema ?? '') !== JSON.stringify(p.formSchema);
    });

    if (needWrite || !existingDefs.length) {
      await db.transaction(async tx => {
        for (const p of BUILTIN_PROCESSES) {
          const existing = byCode.get(p.code);
          const payload = {
            title: p.title,
            category: p.category,
            description: p.description,
            outputTemplate: p.outputTemplate,
            feeAmount: p.feeAmount,
            formSchema: JSON.stringify(p.formSchema),
            isActive: 1,
          };
          let processId = existing?.id;
          if (!existing) {
            const [inserted] = await tx
              .insert(process_definitions)
              .values({ code: p.code, ...payload })
              .onConflictDoNothing()
              .returning({ id: process_definitions.id });
            processId = inserted?.id ?? (await tx.select({ id: process_definitions.id }).from(process_definitions).where(eq(process_definitions.code, p.code)).limit(1))[0]?.id;
          } else {
            await tx.update(process_definitions).set(payload).where(eq(process_definitions.id, existing.id));
          }
          if (!processId) continue;

          const stepsCount = await tx
            .select({ n: sql<string>`count(*)` })
            .from(process_steps)
            .where(eq(process_steps.processId, processId));
          if (Number(stepsCount[0]?.n ?? 0) > 0) continue;

          await tx.insert(process_steps).values(
            p.steps.map(s => ({
              processId: processId as number,
              stepOrder: s.stepOrder,
              title: s.title,
              stepType: s.stepType,
              roleCode: s.roleCode,
              slaHours: s.slaHours,
              timeoutAction: s.timeoutAction,
              timeoutEscalateToRole: s.timeoutEscalateToRole,
            })),
          );
        }
      });
    }

  } catch (err) {
    log.error('ensure_default_processes_failed', { err: (err as Error).message });
  }
}

// ============================================================================
// ثبت درخواست جدید توسط دانشجو (Submit Student Request) — اتمی
// ============================================================================

export type SubmitResultRow = typeof student_requests.$inferSelect;

export async function submitStudentRequest(params: {
  studentId: number;
  userId: number;
  processCode: string;
  formData: Record<string, any>;
}): Promise<SubmitResultRow> {
  await ensureDefaultProcesses();

  const [proc] = await db
    .select()
    .from(process_definitions)
    .where(eq(process_definitions.code, params.processCode))
    .limit(1);
  if (!proc) throw new Error('فرآیند مورد نظر یافت نشد.');

  const steps = await db
    .select()
    .from(process_steps)
    .where(eq(process_steps.processId, proc.id))
    .orderBy(process_steps.stepOrder);
  if (steps.length === 0) throw new Error('مراحل این فرآیند هنوز پیکربندی نشده است.');

  const firstStep = steps[0];
  const [year, prefix] = await Promise.all([getFiscalYear(), getSetting('REQ_TRACKING_PREFIX')]);

  const { created } = await db.transaction(async tx => {
    const trackingCode = await nextTrackingCode(tx, prefix, year);
    const now = new Date();

    // ── گواهی اشتغال به تحصیل: احراز خودکار (ثبت‌نام ترم جاری + تراز مالی صفر/مثبت) ──
    if (params.processCode === 'ENROLLMENT_CERT') {
      const [currentTerm] = await tx.select({ id: academic_terms.id }).from(academic_terms).where(eq(academic_terms.isCurrent, 1)).limit(1);

      let hasEnrollment = false;
      if (currentTerm) {
        const [cnt] = await tx
          .select({ n: sql<string>`count(*)` })
          .from(enrollments)
          .innerJoin(course_offerings, eq(course_offerings.id, enrollments.offeringId))
          .where(and(
            eq(enrollments.studentId, params.studentId),
            eq(course_offerings.termId, currentTerm.id),
            inArray(enrollments.status, ['REGISTERED', 'FINALIZED']),
          ));
        hasEnrollment = Number(cnt?.n ?? 0) > 0;
      }

      // تراز مالی با SUM در خود پایگاه داده — نه حلقه روی ردیف‌ها در Node
      const balance = await studentLedgerBalance(tx, params.studentId);
      // قرارداد کانونی: مثبت = بدهی (مسدود)، صفر/منفی = تسویه/بستانکار (آزاد)
      const autoApprove = hasEnrollment && balance <= 0;

      const digitalHash = crypto
        .createHash('sha256')
        .update(`${trackingCode}:${params.studentId}:${now.toISOString()}:AFAGH_CERT`)
        .digest('hex');
      const certNumber = trackingCode.replace(new RegExp('^' + prefix), 'CERT');
      const formDataJson = JSON.stringify(params.formData);
      if (formDataJson.length > 100 * 1024) throw new Error('اطلاعات فرم بیش از حد بزرگ است.');

      const [row] = await tx
        .insert(student_requests)
        .values({
          trackingCode,
          studentId: params.studentId,
          processId: proc.id,
          currentStepId: firstStep.id,
          formData: formDataJson,
          status: autoApprove ? 'APPROVED' : 'IN_REVIEW',
          digitalStampHash: digitalHash,
          certificateNumber: certNumber,
          issuedAt: autoApprove ? now : null,
          updatedAt: now,
        })
        .returning();

      await tx.insert(request_step_logs).values({
        requestId: row.id,
        stepId: firstStep.id,
        assignedAt: now,
        completedAt: autoApprove ? now : null,
        actorRole: 'SYSTEM_BOT',
        action: autoApprove ? 'APPROVE' : 'SUBMIT',
        note: autoApprove
          ? `احراز صلاحیت خودکار: ثبت‌نام ترم جاری و تراز مالی (${balance.toLocaleString('fa-IR')} ریال) تأیید و گواهی صادر شد.`
          : `عدم احراز شرایط خودکار (${hasEnrollment ? 'ثبت‌نام ترم جاری دارد' : 'بدون انتخاب واحد در ترم جاری'}؛ تراز مالی ${balance.toLocaleString('fa-IR')} ریال) — در انتظار بررسی کارشناس آموزش.`,
        slaStatus: 'ON_TIME',
      });

      // ثبت هزینهٔ فرایند در دفتر مالی دانشجو — داخل همان تراکنش
      const fee = Number(proc.feeAmount ?? 0);
      if (fee > 0) {
        await tx.insert(student_ledger).values({
          studentId: params.studentId,
          termId: currentTerm?.id ?? null,
          transactionType: 'CHARGE',
          amount: String(fee),
          description: `هزینهٔ فرایند «${proc.title}» — ${trackingCode}`,
        });
      }

      const text = autoApprove
        ? `گواهی اشتغال به تحصیل شما به شماره ${certNumber} صادر شد و آماده دریافت/چاپ است.`
        : `درخواست گواهی اشتغال به تحصیل شما با کد رهگیری ${trackingCode} ثبت و جهت بررسی ارسال گردید.`;
      await inboxNotify(tx, params.userId, 'REQUEST_SUBMITTED', text);

      return { created: row };
    }

    // ── تسویه حساب فارغ‌التحصیلی: دروازهٔ موازی ──
    if (params.processCode === 'GRADUATION_CHECKOUT') {
      const [row] = await tx
        .insert(student_requests)
        .values({
          trackingCode,
          studentId: params.studentId,
          processId: proc.id,
          currentStepId: firstStep.id,
          formData: JSON.stringify(params.formData),
          status: 'IN_REVIEW',
          updatedAt: now,
        })
        .returning();

      const checkpoints = [
        { code: 'FINANCE', title: 'امور مالی و شهریه (عدم بدهی)' },
        { code: 'LIBRARY', title: 'کتابخانه مرکزی (عدم امانت کتاب)' },
        { code: 'WELFARE_FUND', title: 'صندوق رفاه دانشجویان (تسویه وام)' },
        { code: 'LABORATORY', title: 'آزمایشگاه‌ها و کارگاه‌های تخصصی' },
        { code: 'DORMITORY', title: 'امور خوابگاه‌ها و اسکان' },
      ];
      // درج دسته‌جمعی — یک کوئری به‌جای پنج کوئری
      await tx.insert(request_parallel_checkpoints).values(
        checkpoints.map(cp => ({ requestId: row.id, departmentCode: cp.code, departmentTitle: cp.title, isCleared: 0 })),
      );

      await tx.insert(request_step_logs).values({
        requestId: row.id,
        stepId: firstStep.id,
        assignedAt: now,
        actorRole: 'MULTI_CHECKPOINT',
        action: 'SUBMIT',
        note: 'پرونده تسویه حساب موازی تشکیل شد و برای واحدهای پنج‌گانه ارسال گردید.',
        slaStatus: 'ON_TIME',
      });

      const text = `پروندهٔ تسویه حساب فارغ‌التحصیلی شما با کد رهگیری ${trackingCode} تشکیل و به‌صورت موازی برای پنج واحد ارسال شد.`;
      await inboxNotify(tx, params.userId, 'REQUEST_SUBMITTED', text);
      return { created: row };
    }

    // ── سایر فرآیندهای عمومی ──
    const [row] = await tx
      .insert(student_requests)
      .values({
        trackingCode,
        studentId: params.studentId,
        processId: proc.id,
        currentStepId: firstStep.id,
        formData: JSON.stringify(params.formData),
        status: 'SUBMITTED',
        updatedAt: now,
      })
      .returning();

    await tx.insert(request_step_logs).values({
      requestId: row.id,
      stepId: firstStep.id,
      assignedAt: now,
      actorRole: firstStep.roleCode || 'USER',
      action: 'SUBMIT',
      note: `درخواست با موفقیت ثبت و به کارتابل ${firstStep.title} ارجاع داده شد.`,
      slaStatus: 'ON_TIME',
    });

    // هزینهٔ فرایند (در صورت تعریف) در همان تراکنش به دفتر مالی می‌نشیند
    const fee = Number(proc.feeAmount ?? 0);
    if (fee > 0) {
      const [currentTerm] = await tx.select({ id: academic_terms.id }).from(academic_terms).where(eq(academic_terms.isCurrent, 1)).limit(1);
      await tx.insert(student_ledger).values({
        studentId: params.studentId,
        termId: currentTerm?.id ?? null,
        transactionType: 'CHARGE',
        amount: String(fee),
        description: `هزینهٔ فرایند «${proc.title}» — ${trackingCode}`,
      });
    }

    const text = `درخواست «${proc.title}» با کد رهگیری ${trackingCode} ثبت و به کارتابل ${firstStep.title} ارجاع شد.`;
    await inboxNotify(tx, params.userId, 'REQUEST_SUBMITTED', text);
    return { created: row };
  });

  // نکته: اعلان درون‌سامانه‌ای داخل همان تراکنش نوشته شد. عمداً اینجا
  // notifyUserMultichannel صدا زده نمی‌شود، چون آن تابع هم یک ردیف در
  // notifications می‌نویسد و اعلان دوبار ثبت می‌شد.
  return created;
}

// ============================================================================
// تعاریف پیش‌فرض فرآیندهای گردش کار (Built-in Dynamic BPM Process Templates)
// ============================================================================

export interface FormFieldSchema {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'number' | 'select' | 'date' | 'file';
  required?: boolean;
  placeholder?: string;
  options?: { value: string; label: string }[];
  helperText?: string;
  defaultValue?: string | number;
}

export interface ProcessTemplate {
  code: string;
  title: string;
  category: string;
  description: string;
  outputTemplate: string;
  feeAmount: number;
  formSchema: FormFieldSchema[];
  steps: {
    stepOrder: number;
    title: string;
    stepType: 'USER' | 'AUTO_INTEGRATION' | 'PARALLEL_GATEWAY';
    roleCode: string;
    slaHours: number;
    timeoutAction: 'ESCALATE' | 'AUTO_APPROVE' | 'AUTO_REJECT' | 'NOTIFY';
    timeoutEscalateToRole?: string;
  }[];
}

export const BUILTIN_PROCESSES: ProcessTemplate[] = [
  {
    code: 'ENROLLMENT_CERT',
    title: 'گواهی اشتغال به تحصیل رسمی',
    category: 'گواهی و مدارک',
    description: 'صدور آنی و هوشمند گواهی اشتغال به تحصیل با مهر و بارکد رهگیری امنیتی وزارت علوم بدون نیاز به مراجعه حضوری.',
    outputTemplate: 'ENROLLMENT_CERT',
    feeAmount: 0,
    formSchema: [
      {
        key: 'recipientOrg',
        label: 'نام ارگان / سازمان مقصد',
        type: 'text',
        required: true,
        placeholder: 'مثال: سازمان نظام وظیفه عمومی، شهرداری تهران، بانک ملی و...',
        helperText: 'نام دقیق دستگاه یا ارگانی که گواهی برای آن صادر می‌شود را وارد کنید.',
      },
      {
        key: 'purpose',
        label: 'علت و هدف درخواست',
        type: 'select',
        required: true,
        options: [
          { value: 'MILITARY', label: 'ارائه به حوزه نظام وظیفه (معافیت تحصیلی)' },
          { value: 'INSURANCE', label: 'ارائه به سازمان تأمین اجتماعی / بیمه درمانی' },
          { value: 'EMPLOYMENT', label: 'ارائه به محل کار / تسهیلات استخدامی' },
          { value: 'BANK', label: 'ارائه به بانک و موسسات مالی' },
          { value: 'OTHER', label: 'سایر مراجع اداری و رسمی' },
        ],
      },
      {
        key: 'includeTermSchedule',
        label: 'درج جدول برنامه هفتگی ترم جاری',
        type: 'select',
        options: [
          { value: 'YES', label: 'بله، جدول دروس ترم جاری اضافه شود' },
          { value: 'NO', label: 'خیر، تنها متن گواهی کفایت می‌کند' },
        ],
      },
    ],
    steps: [
      {
        stepOrder: 1,
        title: 'اعتبارسنجی خودکار وضعیت ثبت‌نام و تسویه مالی',
        stepType: 'AUTO_INTEGRATION',
        roleCode: 'SYSTEM_BOT',
        slaHours: 1,
        timeoutAction: 'AUTO_APPROVE',
      },
      {
        stepOrder: 2,
        title: 'صدور و الصاق امضای دیجیتال اداره کل آموزش',
        stepType: 'USER',
        roleCode: 'EDU_EXPERT',
        slaHours: 24,
        timeoutAction: 'AUTO_APPROVE',
      },
    ],
  },
  {
    code: 'VALID_TRANSCRIPT',
    title: 'درخواست کارنامه معتبر (با رمز تایید QR)',
    category: 'گواهی و مدارک',
    description: 'درخواست کارنامهٔ تحصیلی دارای اعتبار اداری و رمز تایید (QR) پس از تأیید کارشناس آموزش. کارنامهٔ مشاهده‌ای پرتال فاقد اعتبار (غیرقابل استناد) است.',
    outputTemplate: 'VALID_TRANSCRIPT',
    feeAmount: 0,
    formSchema: [
      {
        key: 'recipientOrg',
        label: 'نام ارگان / موسسه مقصد (اختیاری)',
        type: 'text',
        placeholder: 'مثال: سازمان سنجش، وزارت علوم، کارفرما',
        helperText: 'در صورت نیاز به درج نام مقصد در مکاتبات کارشناسی وارد کنید.',
      },
      {
        key: 'purpose',
        label: 'علت درخواست',
        type: 'select',
        required: true,
        options: [
          { value: 'OFFICIAL', label: 'نیاز به کارنامهٔ معتبر اداری (ارائه به مراجع رسمی)' },
          { value: 'EMPLOYMENT', label: 'ارائه به محل کار / تسهیلات' },
          { value: 'CONTINUE', label: 'ادامه تحصیل در دانشگاه دیگر' },
          { value: 'OTHER', label: 'سایر' },
        ],
      },
    ],
    steps: [
      {
        stepOrder: 1,
        title: 'بررسی و تأیید صدور کارنامهٔ معتبر توسط کارشناس آموزش',
        stepType: 'USER',
        roleCode: 'EDU_EXPERT',
        slaHours: 48,
        timeoutAction: 'NOTIFY',
      },
    ],
  },
  {
    code: 'FINANCE_STATEMENT',
    title: 'تأیید کارنامهٔ مالی برای چاپ معتبر (QR)',
    category: 'گواهی و مدارک',
    description: 'کارنامهٔ مالی مشاهده‌ای پرتال فاقد اعتبار اداری است. با تأیید کارشناس امور مالی، نسخهٔ دارای رمز استعلام (QR) برای چاپ معتبر فعال می‌شود.',
    outputTemplate: 'FINANCE_STATEMENT',
    feeAmount: 0,
    formSchema: [
      {
        key: 'recipientOrg',
        label: 'نام ارگان / موسسه مقصد (اختیاری)',
        type: 'text',
        placeholder: 'مثال: سفارت، دادگاه، کارفرما، بانک',
        helperText: 'در صورت نیاز به درج نام مقصد در سند، وارد کنید.',
      },
      {
        key: 'purpose',
        label: 'علت درخواست تأیید',
        type: 'select',
        required: true,
        options: [
          { value: 'OFFICIAL', label: 'ارائه به مراجع رسمی و اداری' },
          { value: 'EMPLOYMENT', label: 'ارائه به کارفرما / تسهیلات' },
          { value: 'BANK', label: 'ارائه به بانک / موسسه مالی' },
          { value: 'OTHER', label: 'سایر' },
        ],
      },
      {
        key: 'note',
        label: 'توضیحات (اختیاری)',
        type: 'textarea',
        placeholder: 'هر توضیحی که کارشناس مالی لازم بداند...',
      },
    ],
    steps: [
      {
        stepOrder: 1,
        title: 'بررسی وضعیت مالی و تأیید صدور کارنامهٔ معتبر توسط کارشناس امور مالی',
        stepType: 'USER',
        roleCode: 'FINANCE_EXPERT',
        slaHours: 48,
        timeoutAction: 'NOTIFY',
      },
    ],
  },
  {
    code: 'COURSE_TRANSFER',
    title: 'تطبیق واحد و معادل‌سازی دروس',
    category: 'آموزش و سرفصل',
    description: 'معادل‌سازی دروس گذرانده‌شده در دانشگاه‌ها و موسسات آموزش عالی معتبر قبلی و ثبت نمره در کارنامه آفاق.',
    outputTemplate: 'TRANSFER_REPORT',
    feeAmount: 50000,
    formSchema: [
      {
        key: 'previousUniversity',
        label: 'نام دانشگاه یا موسسه قبلی',
        type: 'text',
        required: true,
        placeholder: 'مثال: دانشگاه صنعتی شریف / دانشگاه تهران',
      },
      {
        key: 'sourceCourseTitle',
        label: 'عنوان دقیق درس گذرانده‌شده',
        type: 'text',
        required: true,
        placeholder: 'مثال: ریاضی عمومی ۱',
      },
      {
        key: 'sourceGrade',
        label: 'نمره اخذشده (از ۲۰)',
        type: 'number',
        required: true,
        placeholder: 'مثال: ۱۷.۵',
      },
      {
        key: 'sourceUnits',
        label: 'تعداد واحد گذرانده',
        type: 'number',
        required: true,
        placeholder: 'مثال: ۳',
      },
      {
        key: 'targetCourseCode',
        label: 'کد درس مقصد در چارت دانشگاه آفاق',
        type: 'text',
        required: true,
        placeholder: 'مثال: CS101',
      },
      {
        key: 'syllabusNote',
        label: 'توضیحات و هم‌پوشانی سرفصل',
        type: 'textarea',
        placeholder: 'سرفصل‌ها و توضیحات مدرس درس قبلی را در صورت لزوم شرح دهید...',
      },
    ],
    steps: [
      {
        stepOrder: 1,
        title: 'بررسی علمی و انطباق سرفصل توسط مدیر گروه تخصصی',
        stepType: 'USER',
        roleCode: 'DEPARTMENT_HEAD',
        slaHours: 48,
        timeoutAction: 'ESCALATE',
        timeoutEscalateToRole: 'VICE_CHANCELLOR',
      },
      {
        stepOrder: 2,
        title: 'تأیید نهایی، صدور ابلاغیه و ثبت سیستمی در کارنامه کل',
        stepType: 'USER',
        roleCode: 'EDU_EXPERT',
        slaHours: 24,
        timeoutAction: 'AUTO_APPROVE',
      },
    ],
  },
  {
    code: 'THESIS_DEFENSE',
    title: 'درخواست تعیین وقت و مجوز دفاع پایان‌نامه',
    category: 'تحصیلات تکمیلی و پژوهش',
    description: 'فرآیند احراز شرایط پژوهشی، تایید استاد راهنما، سالن و داوران جهت برگزاری جلسه دفاع پایان‌نامه کارشناسی ارشد.',
    outputTemplate: 'DEFENSE_MINUTES',
    feeAmount: 0,
    formSchema: [
      {
        key: 'thesisTitleFa',
        label: 'عنوان کامل پایان‌نامه (فارسی)',
        type: 'text',
        required: true,
        placeholder: 'مثال: ارزیابی کارایی الگوریتم‌های یادگیری ماشین در سامانه‌های توزیع‌شده...',
      },
      {
        key: 'thesisTitleEn',
        label: 'عنوان کامل پایان‌نامه (انگلیسی)',
        type: 'text',
        required: true,
        placeholder: 'Evaluation of ML Algorithms in Distributed...',
      },
      {
        key: 'supervisorName',
        label: 'استاد راهنمای اول',
        type: 'text',
        required: true,
        placeholder: 'مثال: دکتر جمیل احمدی',
      },
      {
        key: 'advisorName',
        label: 'استاد مشاور (در صورت وجود)',
        type: 'text',
        placeholder: 'مثال: دکتر سهراب علوی',
      },
      {
        key: 'proposedDate',
        label: 'تاریخ پیشنهادی برگزاری دفاع',
        type: 'date',
        required: true,
      },
      {
        key: 'abstractText',
        label: 'چکیده پایان‌نامه',
        type: 'textarea',
        required: true,
        placeholder: 'خلاصه دستاوردها و روش پژوهش را در حداکثر ۲۰۰ کلمه بنویسید...',
      },
    ],
    steps: [
      {
        stepOrder: 1,
        title: 'تأیید کفایت علمی و آمادگی دفاع توسط استاد راهنما',
        stepType: 'USER',
        roleCode: 'SUPERVISOR',
        slaHours: 48,
        timeoutAction: 'ESCALATE',
        timeoutEscalateToRole: 'DEPARTMENT_HEAD',
      },
      {
        stepOrder: 2,
        title: 'بررسی اتمام دروس تئوری و شرط معدل کل توسط کارشناس ارشد',
        stepType: 'USER',
        roleCode: 'EDU_EXPERT',
        slaHours: 24,
        timeoutAction: 'ESCALATE',
        timeoutEscalateToRole: 'VICE_CHANCELLOR',
      },
      {
        stepOrder: 3,
        title: 'تخصیص هیئت داوران، سالن و صدور آگهی دفاع رسمی',
        stepType: 'USER',
        roleCode: 'VICE_CHANCELLOR',
        slaHours: 48,
        timeoutAction: 'NOTIFY',
      },
    ],
  },
  {
    code: 'GRADUATION_CHECKOUT',
    title: 'تسویه حساب جامع فارغ‌التحصیلی',
    category: 'دانش‌آموختگان و فراغت',
    description: 'تسویه حساب همزمان و موازی با بخش‌های مالی، کتابخانه، صندوق رفاه و آزمایشگاه‌ها جهت صدور مدرک موقت و دانشنامه.',
    outputTemplate: 'CHECKOUT_CLEARANCE',
    feeAmount: 120000,
    formSchema: [
      {
        key: 'destinationAddress',
        label: 'آدرس پستی جهت ارسال مدارک',
        type: 'textarea',
        required: true,
        placeholder: 'نشانی دقیق پستی به همراه کد پستی ۱۰ رقمی...',
      },
      {
        key: 'postalCode',
        label: 'کد پستی ۱۰ رقمی',
        type: 'text',
        required: true,
        placeholder: 'مثال: ۱۲۳۴۵۶۷۸۹۰',
      },
      {
        key: 'mobileContact',
        label: 'شماره همراه در دسترس',
        type: 'text',
        required: true,
        placeholder: '۰۹۱۲XXXXXXX',
      },
    ],
    steps: [
      {
        stepOrder: 1,
        title: 'تسویه حساب موازی چندگانه (امور مالی، کتابخانه، رفاه، کارگاه)',
        stepType: 'PARALLEL_GATEWAY',
        roleCode: 'MULTI_CHECKPOINT',
        slaHours: 72,
        timeoutAction: 'NOTIFY',
      },
      {
        stepOrder: 2,
        title: 'تأیید نهایی، ابطال کارت و صدور گواهی موقت فارغ‌التحصیلی',
        stepType: 'USER',
        roleCode: 'GRADUATION_EXPERT',
        slaHours: 48,
        timeoutAction: 'ESCALATE',
        timeoutEscalateToRole: 'EDU_EXPERT',
      },
    ],
  },
  {
    code: 'EMERGENCY_DROP',
    title: 'درخواست حذف اضطراری تک‌درس',
    category: 'آموزش و سرفصل',
    description: 'حذف یک عنوان درسی تئوری در بازه اضطراری پایان ترم با رعایت حداقل حدنصاب واحدهای ترم (۱۲ واحد).',
    outputTemplate: 'DROP_REPORT',
    feeAmount: 0,
    formSchema: [
      {
        key: 'courseToDrop',
        label: 'نام و کد درس مورد نظر جهت حذف',
        type: 'text',
        required: true,
        placeholder: 'مثال: ساختمان داده‌ها (CS204)',
      },
      {
        key: 'remainingUnits',
        label: 'تعداد واحدهای باقی‌مانده پس از حذف',
        type: 'number',
        required: true,
        placeholder: 'حداقل ۱۲ واحد',
      },
      {
        key: 'dropReason',
        label: 'علت حذف اضطراری',
        type: 'textarea',
        required: true,
        placeholder: 'دلایل آموزشی یا شغلی/پزشکی خود را توضیح دهید...',
      },
    ],
    steps: [
      {
        stepOrder: 1,
        title: 'موافقت و امضای الکترونیک استاد درس',
        stepType: 'USER',
        roleCode: 'PROFESSOR',
        slaHours: 48,
        timeoutAction: 'AUTO_APPROVE',
      },
      {
        stepOrder: 2,
        title: 'تأیید مدیر گروه و بررسی سقف حداقل واحدها',
        stepType: 'USER',
        roleCode: 'DEPARTMENT_HEAD',
        slaHours: 24,
        timeoutAction: 'AUTO_APPROVE',
      },
    ],
  },
];

// ============================================================================
// پیشبرد گام گردش کار (Advance Workflow Step) — اتمی + قفل سطری
// ============================================================================

export type AdvanceResult = {
  status:
    | 'REJECTED'
    | 'RETURNED'
    | 'ESCALATED'
    | 'MOVED_TO_NEXT_STEP'
    | 'APPROVED_FINAL'
    | 'ALREADY_FINAL'
    | 'UNCHANGED';
  nextStepTitle?: string;
  targetRole?: string;
  certificateNumber?: string;
  events?: { processed: number; failed: number; skipped: number };
};

export async function advanceWorkflowStep(params: {
  requestId: number;
  actorStaffId?: number;
  actorRole: string;
  action: 'APPROVE' | 'REJECT' | 'RETURN_FOR_REVISION' | 'ESCALATE';
  note?: string;
  /** اگر از داخل تراکنش دیگری (مثلاً تسویهٔ موازی) صدا زده شود، همان اتصال استفاده می‌شود */
  tx?: DbTx;
}): Promise<AdvanceResult> {
  const now = new Date();

  const { result, dispatch } = await inTx(params.tx, async tx => {
    // قفل سطری: دو اقدام همزمان روی یک پرونده پشت سر هم صف می‌شوند
    const [req] = await tx
      .select()
      .from(student_requests)
      .where(eq(student_requests.id, params.requestId))
      .for('update');
    if (!req) throw new Error('درخواست یافت نشد.');

    // idempotent: پروندهٔ مختومه دیگر پیش نمی‌رود (کلیک دوباره / cron موازی)
    if (TERMINAL_STATUSES.includes(req.status)) {
      return { result: { status: 'ALREADY_FINAL' as const } as AdvanceResult, dispatch: null };
    }

    const [currentStep] = req.currentStepId
      ? await tx.select().from(process_steps).where(eq(process_steps.id, req.currentStepId)).limit(1)
      : [undefined];

    const allSteps = await tx
      .select()
      .from(process_steps)
      .where(eq(process_steps.processId, req.processId))
      .orderBy(process_steps.stepOrder);

    // بازترین لاگ این پرونده (مبنای محاسبهٔ مدت توقف و SLA)
    const [lastLog] = await tx
      .select()
      .from(request_step_logs)
      .where(and(eq(request_step_logs.requestId, req.id), isNull(request_step_logs.completedAt)))
      .orderBy(desc(request_step_logs.id), desc(request_step_logs.assignedAt))
      .limit(1);

    const durationMin = lastLog?.assignedAt
      ? Math.max(0, Math.round((now.getTime() - new Date(lastLog.assignedAt).getTime()) / 60000))
      : 0;

    // بستن لاگ مرحلهٔ جاری — در همان تراکنشی که وضعیت عوض می‌شود
    if (lastLog) {
      const isSlaBreached = currentStep?.slaHours ? durationMin > currentStep.slaHours * 60 : false;
      await tx
        .update(request_step_logs)
        .set({
          completedAt: now,
          actorStaffId: params.actorStaffId ?? null,
          actorRole: params.actorRole,
          action: params.action,
          note: params.note || (params.action === 'APPROVE' ? 'تایید شد' : 'رد شد'),
          durationMinutes: durationMin,
          slaStatus: isSlaBreached ? 'SLA_BREACHED' : 'ON_TIME',
        })
        .where(eq(request_step_logs.id, lastLog.id));
    }

    const [stu] = await tx.select().from(students).where(eq(students.id, req.studentId)).limit(1);

    // ── ۱. رد درخواست ──
    if (params.action === 'REJECT') {
      await tx.update(student_requests).set({ status: 'REJECTED', updatedAt: now }).where(eq(student_requests.id, req.id));
      const text = `درخواست شما با کد رهگیری ${req.trackingCode} رد شد. دلیل: ${params.note || 'عدم احراز شرایط'}`;
      const processCode = (await processCodeOf(tx, req.processId)) ?? '';
      await fireWorkflowEvent(tx, { requestId: req.id, processCode, eventCode: 'WORKFLOW_REJECTED', formDataRaw: req.formData });
      return {
        result: { status: 'REJECTED' as const },
        dispatch: {
          processCode,
          eventCode: 'WORKFLOW_REJECTED' as WorkflowEventCode,
          stepTitle: currentStep?.title ?? null,
          notify: stu ? { userId: stu.userId, eventCode: 'REQUEST_REJECTED', text } : null,
        },
      };
    }

    // ── ۲. بازگشت برای اصلاح ──
    if (params.action === 'RETURN_FOR_REVISION') {
      await tx.update(student_requests).set({ status: 'RETURNED', updatedAt: now }).where(eq(student_requests.id, req.id));
      const text = `درخواست ${req.trackingCode} جهت اصلاح مدارک به شما بازگردانده شد: ${params.note || 'لطفاً فرم را ویرایش کنید.'}`;
      const processCode = (await processCodeOf(tx, req.processId)) ?? '';
      await fireWorkflowEvent(tx, { requestId: req.id, processCode, eventCode: 'WORKFLOW_RETURNED', formDataRaw: req.formData });
      return {
        result: { status: 'RETURNED' as const },
        dispatch: {
          processCode,
          eventCode: 'WORKFLOW_RETURNED' as WorkflowEventCode,
          stepTitle: currentStep?.title ?? null,
          notify: stu ? { userId: stu.userId, eventCode: 'REQUEST_RETURNED', text } : null,
        },
      };
    }

    // ── ۳. ارجاع / تشدید ──
    if (params.action === 'ESCALATE') {
      const nextRole = currentStep?.timeoutEscalateToRole || 'VICE_CHANCELLOR';
      // ایدمپوتنت: اگر همین مرحله پیش‌تر ارجاع شده، ارجاع دوباره ثبت نمی‌شود
      // (دو cron همزمان یا کلیک دوبارهٔ کارشناس نباید پرونده را اسپم کنند)
      if (lastLog?.action === 'ESCALATE') {
        return { result: { status: 'ESCALATED' as const, targetRole: lastLog.actorRole || nextRole }, dispatch: null };
      }
      await tx.update(student_requests).set({ status: 'IN_REVIEW', updatedAt: now }).where(eq(student_requests.id, req.id));
      await tx.insert(request_step_logs).values({
        requestId: req.id,
        stepId: currentStep?.id || allSteps[0]?.id,
        assignedAt: now,
        actorRole: nextRole,
        action: 'ESCALATE',
        note: `ارجاع مدیریتی پرونده به ${nextRole}: ${params.note || 'به دلیل عدم اقدام در مهلت یا نیاز به تصمیم مقام بالاتر'}`,
        slaStatus: 'ESCALATED',
      });
      return { result: { status: 'ESCALATED' as const, targetRole: nextRole }, dispatch: null };
    }

    // ── ۴. تأیید مرحله ──
    const currentOrder = currentStep?.stepOrder || 1;
    const nextStep = allSteps.find(s => s.stepOrder > currentOrder);
    const processCode = (await processCodeOf(tx, req.processId)) ?? '';

    if (nextStep) {
      await tx
        .update(student_requests)
        .set({ currentStepId: nextStep.id, status: 'IN_REVIEW', updatedAt: now })
        .where(eq(student_requests.id, req.id));
      await tx.insert(request_step_logs).values({
        requestId: req.id,
        stepId: nextStep.id,
        assignedAt: now,
        actorRole: nextStep.roleCode || 'USER',
        action: 'ASSIGN',
        note: `پرونده به مرحله «${nextStep.title}» ارجاع داده شد.`,
        slaStatus: 'ON_TIME',
      });
      await fireWorkflowEvent(tx, { requestId: req.id, processCode, eventCode: 'WORKFLOW_STEP_MOVED', formDataRaw: req.formData });
      return { result: { status: 'MOVED_TO_NEXT_STEP' as const, nextStepTitle: nextStep.title }, dispatch: null };
    }

    // آخرین مرحله → تأیید نهایی و اختتام پرونده
    const digitalHash = crypto
      .createHash('sha256')
      .update(`${req.trackingCode}:${req.studentId}:${now.toISOString()}:AFAGH_FINAL`)
      .digest('hex');
    const certNumber = req.certificateNumber || `DOC-${req.trackingCode}`;

    await tx
      .update(student_requests)
      .set({
        status: 'APPROVED',
        digitalStampHash: digitalHash,
        certificateNumber: certNumber,
        issuedAt: now,
        updatedAt: now,
      })
      .where(eq(student_requests.id, req.id));

    // رویداد «تأیید نهایی» — *داخل* تراکنش ثبت می‌شود (PENDING)،
    // اجرای اثر تجاری پس از commit توسط هندلرِ ماژول صاحب اثر انجام می‌شود.
    await fireWorkflowEvent(tx, { requestId: req.id, processCode, eventCode: 'WORKFLOW_FINAL_APPROVED', formDataRaw: req.formData });

    const text = `درخواست شما با کد رهگیری ${req.trackingCode} به طور کامل تایید و نهایی گردید.`;

    return {
      result: { status: 'APPROVED_FINAL' as const, certificateNumber: certNumber },
      dispatch: {
        processCode,
        eventCode: 'WORKFLOW_FINAL_APPROVED' as WorkflowEventCode,
        stepTitle: currentStep?.title ?? null,
        certificateNumber: certNumber,
        notify: stu ? { userId: stu.userId, eventCode: 'REQUEST_APPROVED', text } : null,
      },
    };
  });

  // ── پس از commit: هندلرهای رویداد + اعلان بیرونی ──
  if (dispatch) {
    const events = await dispatchWorkflowEvent(params.requestId, {
      processCode: dispatch.processCode,
      eventCode: dispatch.eventCode,
      stepTitle: dispatch.stepTitle ?? null,
      actorRole: params.actorRole,
      note: params.note ?? null,
      certificateNumber: dispatch.certificateNumber ?? null,
      firedAt: now,
    }).catch(err => {
      log.error('workflow_dispatch_failed', { requestId: params.requestId, err: (err as Error).message });
      return { processed: 0, failed: 0, skipped: 0 };
    });
    (result as AdvanceResult).events = events;
    if (dispatch.notify) await safeMultichannel(dispatch.notify.userId, dispatch.notify.eventCode, dispatch.notify.text);
  }

  return result;
}

/** کد فرایند یک پرونده (برای شلیک رویداد) */
async function processCodeOf(tx: DbTx, processId: number): Promise<string | null> {
  const [row] = await tx
    .select({ code: process_definitions.code })
    .from(process_definitions)
    .where(eq(process_definitions.id, processId))
    .limit(1);
  return row?.code ?? null;
}

// ============================================================================
// تسویه حساب موازی (Parallel Gateway) — اتمی
// ============================================================================

export async function clearParallelCheckpoint(params: {
  checkpointId: number;
  clearedByStaffId?: number;
  notes?: string;
}): Promise<{ ok: boolean; allCleared: boolean; advanced?: AdvanceResult }> {
  const now = new Date();

  const { allCleared, advanced } = await db.transaction(async tx => {
    const [cp] = await tx
      .select()
      .from(request_parallel_checkpoints)
      .where(eq(request_parallel_checkpoints.id, params.checkpointId))
      .for('update');
    if (!cp) throw new Error('چک‌پوینت تسویه یافت نشد.');

    // قفل پرونده → دو واحد نمی‌توانند همزمان «آخرین تسویه» باشند
    const [req] = await tx
      .select({ id: student_requests.id, status: student_requests.status })
      .from(student_requests)
      .where(eq(student_requests.id, cp.requestId))
      .for('update');
    if (!req) throw new Error('درخواست مرتبط با چک‌پوینت یافت نشد.');

    await tx
      .update(request_parallel_checkpoints)
      .set({
        isCleared: 1,
        clearedByStaffId: params.clearedByStaffId ?? null,
        clearedAt: now,
        notes: params.notes || 'تسویه حساب تایید گردید.',
      })
      .where(eq(request_parallel_checkpoints.id, cp.id));

    // بررسی مانده‌ها با تابع تجمعی SQL (یک کوئری، بدون بارگذاری ردیف‌ها)
    const [agg] = await tx
      .select({
        total: sql<string>`count(*)`,
        cleared: sql<string>`sum(case when ${request_parallel_checkpoints.isCleared} = 1 then 1 else 0 end)`,
      })
      .from(request_parallel_checkpoints)
      .where(eq(request_parallel_checkpoints.requestId, cp.requestId));

    const total = Number(agg?.total ?? 0);
    const cleared = Number(agg?.cleared ?? 0);
    const done = total > 0 && cleared >= total;

    let advancedRes: AdvanceResult | undefined;
    if (done) {
      // پیشبرد در همان تراکنش (نه تراکنش تودرتو) تا یا همه‌چیز بنشیند یا هیچ‌چیز
      advancedRes = await advanceWorkflowStep({
        requestId: cp.requestId,
        actorStaffId: params.clearedByStaffId,
        actorRole: 'MULTI_CHECKPOINT',
        action: 'APPROVE',
        note: 'تمامی بخش‌های موازی تسویه حساب، تأیید شدند.',
        tx,
      });
    }

    return { allCleared: done, advanced: advancedRes };
  });

  return { ok: true, allCleared, advanced };
}

// ============================================================================
// موتور SLA — یک کوئری جمعی + قفل مشورتی (بدون اجرای موازی cron)
// ============================================================================

export type SlaTimeoutItem = {
  requestId: number;
  trackingCode: string;
  stepTitle: string;
  actionTaken: string;
};

export async function checkAndTriggerSlaTimeouts(): Promise<SlaTimeoutItem[]> {
  const lockKey = 'afagh:workflow:sla';
  const lockRes = await db.execute(sql`select pg_try_advisory_lock(hashtext(${lockKey})) as got`);
  const got = Boolean((lockRes.rows?.[0] as { got?: boolean } | undefined)?.got);

  if (!got) {
    log.info('sla_job_skipped', { reason: 'another_run_in_progress' });
    return [];
  }

  try {
    // همهٔ پرونده‌های باز + گام جاری + بازترین لاگ — در یک کوئری JOIN
    const rows = await db.execute(sql`
      select r.id as "requestId", r."trackingCode" as "trackingCode",
             s.id as "stepId", s.title as "stepTitle", s."slaHours" as "slaHours",
             s."timeoutAction" as "timeoutAction", s."timeoutEscalateToRole" as "escalateTo",
             l."assignedAt" as "assignedAt"
      from student_requests r
      join process_steps s on s.id = r."currentStepId"
      join lateral (
        select l2."assignedAt"
        from request_step_logs l2
        where l2."requestId" = r.id and l2."completedAt" is null
        order by l2.id desc limit 1
      ) l on true
      where r.status in ('SUBMITTED', 'IN_REVIEW', 'RETURNED')
        and s."slaHours" is not null
        and s."slaHours" > 0
        and l."assignedAt" is not null
        and l."assignedAt" < (now() - (s."slaHours" || ' hours')::interval)
      order by r.id
    `);

    const due = (rows.rows ?? []) as {
      requestId: number;
      trackingCode: string;
      stepId: number;
      stepTitle: string;
      slaHours: number;
      timeoutAction: string | null;
      escalateTo: string | null;
      assignedAt: string | Date;
    }[];

    const results: SlaTimeoutItem[] = [];
    for (const r of due) {
      const action = (r.timeoutAction || '').toUpperCase();
      let taken: 'ESCALATE' | 'APPROVE' | 'REJECT' | null = null;
      let label = '';

      if (action === 'ESCALATE') {
        taken = 'ESCALATE';
        label = `ESCALATE TO ${r.escalateTo || 'VICE_CHANCELLOR'}`;
      } else if (action === 'AUTO_APPROVE') {
        taken = 'APPROVE';
        label = 'AUTO_APPROVE';
      } else if (action === 'AUTO_REJECT') {
        taken = 'REJECT';
        label = 'AUTO_REJECT';
      }
      if (!taken) continue;

      try {
        await advanceWorkflowStep({
          requestId: r.requestId,
          actorRole: 'SYSTEM_SLA_ENGINE',
          action: taken,
          note: taken === 'ESCALATE'
            ? `انقضای مهلت پاسخگویی (${r.slaHours} ساعت) — ارجاع خودکار سیستمی به ${r.escalateTo || 'VICE_CHANCELLOR'}`
            : taken === 'APPROVE'
              ? `انقضای مهلت قانونی مرحله (${r.slaHours} ساعت) — تایید خودکار و عبور از مرحله به استناد آیین‌نامه تسریع امور`
              : `انقضای مهلت قانونی مرحله (${r.slaHours} ساعت) — بسته‌شدن خودکار پرونده به دلیل عدم ارائه مدارک در مهلت`,
        });
        results.push({ requestId: r.requestId, trackingCode: r.trackingCode, stepTitle: r.stepTitle, actionTaken: label });
      } catch (err) {
        log.error('sla_action_failed', { requestId: r.requestId, err: (err as Error).message });
      }
    }

    return results;
  } finally {
    await db.execute(sql`select pg_advisory_unlock(hashtext(${lockKey}))`).catch(() => undefined);
  }
}

// ============================================================================
// ثبت نظرسنجی و امتیاز رضایت دانشجو (CSAT)
// ============================================================================

export async function submitRequestSatisfaction(params: {
  requestId: number;
  score: number;
  feedback?: string;
  /**
   * 🔒 مالکیت: اگر داده شود، فقط درخواست همین دانشجو به‌روز می‌شود.
   * پیش‌تر هر دانشجو می‌توانست با یک `requestId` دلخواه، امتیاز/بازخورد
   * درخواست دانشجوی دیگر را بازنویسی کند (IDOR).
   */
  studentId?: number;
}): Promise<{ ok: boolean }> {
  const score = Math.max(1, Math.min(5, Math.round(Number(params.score) || 0)));
  const [row] = await db
    .update(student_requests)
    .set({ satisfactionScore: score, feedbackText: params.feedback || null, updatedAt: new Date() })
    .where(params.studentId
      ? and(eq(student_requests.id, params.requestId), eq(student_requests.studentId, params.studentId))
      : eq(student_requests.id, params.requestId))
    .returning({ id: student_requests.id });
  if (!row) throw new Error('درخواست یافت نشد.');
  return { ok: true };
}

// ============================================================================
// وضعیت پرونده — برای کارتابل و صفحهٔ رهگیری دانشجو
// ============================================================================

export async function getRequestDetail(requestId: number) {
  const [req] = await db
    .select()
    .from(student_requests)
    .where(eq(student_requests.id, requestId))
    .limit(1);
  if (!req) return null;

  const [logs, checkpoints, processCode] = await Promise.all([
    db.select().from(request_step_logs).where(eq(request_step_logs.requestId, requestId)).orderBy(request_step_logs.id),
    db.select().from(request_parallel_checkpoints).where(eq(request_parallel_checkpoints.requestId, requestId)),
    processCodeOf(db as unknown as DbTx, req.processId),
  ]);

  return {
    ...req,
    processCode,
    isOpen: OPEN_STATUSES.includes(req.status),
    isTerminal: TERMINAL_STATUSES.includes(req.status),
    logs,
    checkpoints,
  };
}
