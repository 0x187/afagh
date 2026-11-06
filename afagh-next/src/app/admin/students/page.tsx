import { and, count, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import { degree_level_configs, departments, educational_regulations, faculties, legacy_code_maps, majors, roles, staff, students, universities, user_roles, users } from '@/db/schema';
import type { RegulationPick } from './types';
import { currentExpertFilters, scopedMajorIds } from '@/lib/expert-scope';
import { getCurrentUniversity } from '@/lib/university-scope';
import { escapeLikeChars, normalizeFa, normCol, toEnDigits } from '@/lib/persian-search';
import { getSetting } from '@/lib/settings';
import StudentsManagerClient from './StudentsManagerClient';

export const dynamic = 'force-dynamic';

const PER_PAGE = 50;

// ═══════════════════════════════════════════════════════════════════════
//  فیلتر کد ملی (دادهٔ حساس) — هرگز در URL، تاریخچهٔ مرورگر یا Referer
//  قرار نمی‌گیرد. مقدار آن در کوکی HttpOnlyِ نشست نگه‌داری می‌شود تا
//  فیلتر سمت سرور همچنان کار کند و با رفرش/جابه‌جایی کلاینتی از بین نرود.
//  سایر فیلترهای غیرحساس مثل قبل در query string می‌مانند.
// ═══════════════════════════════════════════════════════════════════════
const NC_FILTER_COOKIE = 'afagh_students_nc_filter';
const NC_COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/admin/students',
};

async function setStudentNationalCodeFilter(code: string) {
  'use server';
  // اکشن سروری نیز مثل خود صفحه محافظت می‌شود (فقط ارقام فارسی/عربی/لاتین)
  const { requireRoleOrPermission } = await import('@/lib/permissions-enforcer');
  await requireRoleOrPermission(
    ['ADMIN', 'EDU_EXPERT', 'ARCHIVE_EXPERT', 'MILITARY_OFFICER', 'GRADUATEAFFAIRS'],
    ['students:view_dossier'],
  );
  const store = await cookies();
  const clean = String(code ?? '').replace(/[^\d۰-۹٠-٩]/g, '').slice(0, 20);
  if (clean) store.set(NC_FILTER_COOKIE, clean, NC_COOKIE_OPTS);
  // حذف با همان pathی که ست شده انجام می‌شود تا کوکی واقعاً پاک شود
  else store.set(NC_FILTER_COOKIE, '', { ...NC_COOKIE_OPTS, maxAge: 0 });
  revalidatePath('/admin/students');
}

export default async function AdminStudentsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; status?: string; degree?: string; sort?: string; f_code?: string; f_name?: string; f_major?: string; f_year?: string; university?: string }>;
}) {
  const { requireRoleOrPermission } = await import('@/lib/permissions-enforcer');
  const user = await requireRoleOrPermission(
    ['ADMIN', 'EDU_EXPERT', 'ARCHIVE_EXPERT', 'MILITARY_OFFICER', 'GRADUATEAFFAIRS'],
    ['students:view_dossier'],
  );
  const canEditGrades = user.roles.some(r => r === 'ADMIN' || r === 'GRADUATEAFFAIRS');
  const sp = await searchParams;
  const cookieStore = await cookies();

  // ── فهرست دانشگاه‌ها ──
  let allUniversities: { id: number; code: string; title: string; kind: string; saminCode: string | null }[] = [];
  try {
    allUniversities = await db.select().from(universities).where(eq(universities.isActive, 1)).orderBy(universities.id);
  } catch { /* جدول universities ممکن است هنوز ساخته نشده باشد */ }
  // اولویت قطعی: کوکی دانشگاه فعال (سوییچر سراسری)
  const currentUniversity = await getCurrentUniversity();
  const currentUniversityId = currentUniversity?.id ?? null;

  const q = (sp.q || '').trim().slice(0, 60);
  const page = Math.max(1, parseInt(sp.page || '1', 10) || 1);
  const statusFilter = (sp.status || 'ALL').toUpperCase();
  const degreeFilter = parseInt(sp.degree || '0', 10) || 0;
  const sortRaw = (sp.sort || '').trim();
  const fCode = (sp.f_code || '').trim().slice(0, 20);
  const fName = (sp.f_name || '').trim().slice(0, 60);
  // کد ملی فقط از کوکی HttpOnly خوانده می‌شود؛ پارامتر URL آن حذف شده است
  const fNc = (cookieStore.get(NC_FILTER_COOKIE)?.value ?? '').trim().slice(0, 20);
  const fMajor = (sp.f_major || '').trim().slice(0, 60);
  const fYear = (sp.f_year || '').trim().slice(0, 4);

  // ── فیلترهای مشترک ──
  const conds = [];
  if (currentUniversityId) conds.push(eq(students.universityId, currentUniversityId));
  // دامنهٔ کارشناس آموزش: فقط دانشجویانِ رشته‌های مجازش
  if (user.roles.includes('EDU_EXPERT')) {
    const _eff = await currentExpertFilters().catch(() => null);
    const _maj = await scopedMajorIds(_eff, currentUniversityId).catch(() => null);
    if (_maj) conds.push(inArray(students.majorId, _maj));
  }
  if (statusFilter !== 'ALL') conds.push(eq(students.status, statusFilter));
  if (degreeFilter > 0) conds.push(eq(students.degreeLevelId, degreeFilter));
  if (q) {
    // شناسه‌ها (کد ملی/دانشجویی) در DB انگلیسی‌اند؛ ارقام فارسی ورودی ادمین
    // نرمال می‌شود تا «SA۰۱۲۵…» هم ردیف «SA0125…» را پیدا کند. حروف (SA/…) دست‌نخورده می‌مانند.
    // 🔒 ٪ _ \ ورودی با escapeLikeChars خنثی می‌شوند (با ESCAPE '\') تا wildcard تزریقی معنا نگیرد.
    const like = `%${escapeLikeChars(toEnDigits(q))}%`;
    const faLike = `%${escapeLikeChars(normalizeFa(q))}%`;
    conds.push(
      or(
        sql`${students.studentCode} ILIKE ${like} ESCAPE '\\'`,
        sql`${users.nationalCode} ILIKE ${like} ESCAPE '\\'`,
        sql`${normCol(users.firstName)} ILIKE ${faLike} ESCAPE '\\'`,
        sql`${normCol(users.lastName)} ILIKE ${faLike} ESCAPE '\\'`,
      )!,
    );
  }
  if (fCode) conds.push(sql`${students.studentCode} ILIKE ${`%${escapeLikeChars(fCode)}%`} ESCAPE '\\'`);
  if (fName) {
    const faLike = `%${escapeLikeChars(normalizeFa(fName))}%`;
    conds.push(or(sql`${normCol(users.firstName)} ILIKE ${faLike} ESCAPE '\\'`, sql`${normCol(users.lastName)} ILIKE ${faLike} ESCAPE '\\'`)!);
  }
  if (fNc) conds.push(sql`${users.nationalCode} ILIKE ${`%${escapeLikeChars(toEnDigits(fNc))}%`} ESCAPE '\\'`);
  if (fMajor) conds.push(sql`${normCol(majors.name)} ILIKE ${`%${escapeLikeChars(normalizeFa(fMajor))}%`} ESCAPE '\\'`);
  if (/^\d{4}$/.test(fYear)) conds.push(eq(students.entryYear, Number(fYear)));
  const where = conds.length ? and(...conds) : undefined;

  // ── مرتب‌سازی ستونی (پیش‌فرض: جدیدترین) ──
  const SORTABLE: Record<string, 'studentCode' | 'name' | 'nc' | 'major' | 'degree' | 'year' | 'status'> = {
    studentCode: 'studentCode', name: 'name', nc: 'nc', major: 'major', degree: 'degree', year: 'year', status: 'status',
  };
  const [sortKeyRaw, sortDirRaw] = sortRaw.split(':');
  const sortKey = SORTABLE[sortKeyRaw] ?? null;
  const sortDir = sortDirRaw === 'desc' ? 'desc' : 'asc';
  const orderBy = !sortKey
    ? [desc(students.id)]
    : sortKey === 'studentCode' ? (sortDir === 'asc' ? [students.studentCode] : [desc(students.studentCode)])
    : sortKey === 'name' ? (sortDir === 'asc' ? [users.lastName, users.firstName] : [desc(users.lastName), desc(users.firstName)])
    : sortKey === 'nc' ? (sortDir === 'asc' ? [users.nationalCode] : [desc(users.nationalCode)])
    : sortKey === 'major' ? (sortDir === 'asc' ? [majors.name] : [desc(majors.name)])
    : sortKey === 'degree' ? (sortDir === 'asc' ? [degree_level_configs.title] : [desc(degree_level_configs.title)])
    : sortKey === 'year' ? (sortDir === 'asc' ? [students.entryYear] : [desc(students.entryYear)])
    : (sortDir === 'asc' ? [students.status] : [desc(students.status)]);

  // ── تعداد کل + یک صفحه (صفحه‌بندی سمت سرور — ۳۲هزار رکورد یکجا لود نمی‌شود) ──
  const baseQuery = db
    .select({
      id: students.id,
      studentCode: students.studentCode,
      entryYear: students.entryYear,
      entryTerm: students.entryTerm,
      status: students.status,
      samaStatusCode: students.samaStatusCode,
      quotaType: students.quotaType,
      currentTermNo: students.currentTermNo,
      nationalCode: users.nationalCode,
      firstName: users.firstName,
      lastName: users.lastName,
      mobile: users.mobile,
      fatherName: users.fatherName,
      birthCertNo: users.birthCertNo,
      birthDate: users.birthDate,
      gender: users.gender,
      userIsActive: users.isActive,
      userId: users.id,
      placeOfBirth: users.placeOfBirth,
      placeOfIssue: users.placeOfIssue,
      nationality: users.nationality,
      photoKey: users.photoKey,
      firstNameEn: users.firstNameEn,
      lastNameEn: users.lastNameEn,
      passportNumber: users.passportNumber,
      email: users.email,
      postalCode: users.postalCode,
      address: users.address,
      // ── پروندهٔ تکمیلی سما ──
      advisorCode: students.advisorCode,
      documentStatus: students.documentStatus,
      scholarshipType: students.scholarshipType,
      militaryStatus: students.militaryStatus,
      militaryExemptionNo: students.militaryExemptionNo,
      homeTell: students.homeTell,
      studentCardStatus: students.studentCardStatus,
      archiveNo: students.archiveNo,
      parvandehNo: students.parvandehNo,
      dormName: students.dormName,
      dormRoom: students.dormRoom,
      hasDorm: students.hasDorm,
      guardianJobTitle: students.guardianJobTitle,
      guardianPhone: students.guardianPhone,
      guardianAddress: students.guardianAddress,
      guardianEmail: students.guardianEmail,
      diplomaType: students.diplomaType,
      diplomaPlace: students.diplomaPlace,
      diplomaYear: students.diplomaYear,
      diplomaGrade: students.diplomaGrade,
      pishdPlace: students.pishdPlace,
      pishdYear: students.pishdYear,
      pishdGrade: students.pishdGrade,
      tuitionType: students.tuitionType,
      tuitionPayer: students.tuitionPayer,
      englishExamType: students.englishExamType,
      englishScore: students.englishScore,
      insertDate: students.insertDate,
      insertTime: students.insertTime,
      certIssued3m: students.certIssued3m,
      documentDeficiency: students.documentDeficiency,
      unitsRemaining: students.unitsRemaining,
      eqSemesters: students.eqSemesters,
      acceptanceType: students.acceptanceType,
      acceptanceAllocation: students.acceptanceAllocation,
      studyingMode: students.studyingMode,
      trainingMethod: students.trainingMethod,
      graduateDate: students.graduateDate,
      universityId: students.universityId,
      senderUniversityCode: students.senderUniversityCode,
      facultyName: faculties.name,
      majorName: majors.name,
      majorCode: majors.majorCode,
      degreeLevel: degree_level_configs.title,
      degreeCode: degree_level_configs.code,
      degreeLevelId: degree_level_configs.id,
      regulationId: students.regulationId,
      regulationTitle: educational_regulations.title,
    })
    .from(students)
    .innerJoin(users, eq(users.id, students.userId))
    .leftJoin(majors, eq(majors.id, students.majorId))
    .leftJoin(faculties, eq(faculties.id, majors.facultyId))
    .leftJoin(degree_level_configs, eq(degree_level_configs.id, students.degreeLevelId))
    .leftJoin(educational_regulations, eq(educational_regulations.id, students.regulationId));

  // ── تعداد کل: فقط join هایی که فیلتر واقعاً استفاده می‌کند (سرعت بارگذاری) ──
  // قبل از این، count همیشه users (۳۷هزار ردیف) را join می‌کرد حتی بدون فیلتر نام/کدملی؛
  // و با فیلتر f_major حتی خطا می‌داد چون majors در count join نشده بود.
  const countNeedUsers = Boolean(q || fName || fNc);
  const countNeedMajors = Boolean(fMajor);
  const countBase = db.select({ n: count() }).from(students);
  const countRow = countNeedUsers
    ? countNeedMajors
      ? await countBase.innerJoin(users, eq(users.id, students.userId)).leftJoin(majors, eq(majors.id, students.majorId)).where(where as never)
      : await countBase.innerJoin(users, eq(users.id, students.userId)).where(where as never)
    : countNeedMajors
      ? await countBase.leftJoin(majors, eq(majors.id, students.majorId)).where(where as never)
      : await countBase.where(where as never);
  const total = Number(countRow[0]?.n ?? 0);
  const totalPages = Math.max(1, Math.ceil(Number(total) / PER_PAGE));
  const safePage = Math.min(page, totalPages);

  const studentRows = where
    ? await baseQuery.where(where as never).orderBy(...(orderBy as never[])).limit(PER_PAGE).offset((safePage - 1) * PER_PAGE)
    : await baseQuery.orderBy(...(orderBy as never[])).limit(PER_PAGE).offset((safePage - 1) * PER_PAGE);

  // ── فهرست آیین‌نامه‌ها برای تغییر آیین‌نامه دانشجو در پرونده ──
  let regulationPicks: RegulationPick[] = [];
  try {
    const regs = await db
      .select({ id: educational_regulations.id, title: educational_regulations.title, degreeLevelId: educational_regulations.degreeLevelId })
      .from(educational_regulations)
      .orderBy(educational_regulations.effectiveFromYear, educational_regulations.id);
    regulationPicks = regs.map(r => ({ id: r.id, title: r.title, degreeLevelId: r.degreeLevelId }));
  } catch { /* جدول خالی */ }

  // ── گزینه‌های فیلتر: مقاطع + شمارش وضعیت‌ها (محدود به دانشگاه جاری — قبلاً همهٔ دانشگاه‌ها را یکی می‌کرد) ──
  const degrees = await db
    .select({ id: degree_level_configs.id, title: degree_level_configs.title })
    .from(degree_level_configs)
    .orderBy(degree_level_configs.id);
  // ── محل تولد/صدور از geo (سراسری) — عنوان‌های یکتا با کد وزارت غیرخالی ──
  let geoPlaces: { title: string; ministryCode: string | null }[] = [];
  try {
    const { getGeoCities } = await import('@/lib/geo-coding');
    const seen = new Set<string>();
    for (const c of await getGeoCities()) {
      if (!c.title || seen.has(c.title)) continue;
      seen.add(c.title);
      if (c.ministryCode) geoPlaces.push({ title: c.title, ministryCode: c.ministryCode });
    }
  } catch { /* جدول خالی */ }
  const statusCounts = await db
    .select({ status: students.status, n: count() })
    .from(students)
    .where(currentUniversityId ? eq(students.universityId, currentUniversityId) : undefined)
    .groupBy(students.status)
    .orderBy(sql`${count()} DESC`);

  // ── برچسب کدهای سما (نحوه ورود/نوع دوره/سهمیه) از میز تطبیق برای کارنامه ──
  const codeMaps = await db
    .select({ domain: legacy_code_maps.domain, code: legacy_code_maps.legacyCode, target: legacy_code_maps.targetCode, title: legacy_code_maps.legacyTitle })
    .from(legacy_code_maps)
    .where(sql`${legacy_code_maps.domain} IN ('ACCEPT_TYPE','PERIOD_TYPE','QUOTA')`);
  const codeLabels: { accept: Record<string, string>; acceptByTarget: Record<string, string>; period: Record<string, string>; quota: Record<string, string> } = { accept: {}, acceptByTarget: {}, period: {}, quota: {} };
  for (const r of codeMaps) {
    if (!r.code || !r.title) continue;
    if (r.domain === 'ACCEPT_TYPE') {
      codeLabels.accept[r.code] = r.title;
      if (r.target) codeLabels.acceptByTarget[r.target] = r.title;
    }
    else if (r.domain === 'PERIOD_TYPE') codeLabels.period[r.code] = r.title;
    else if (r.domain === 'QUOTA') codeLabels.quota[r.code] = r.title;
  }

  // خواندن اساتید و پرسنل با رتبه علمی و مدرک — پایه و نوع همکاری از سما
  // گروه/دانشکده/رشته/دانشگاه مستقیم از دیتابیس (نه placeholder)
  // ⚠ فهرست استادان/پرسنل عمداً اینجا خوانده **نمی‌شود**.
  //   قبلاً همین‌جا برای ~۱۴۰۰ استاد × ۳۵ فیلد کوئری می‌خورد و به کلاینت
  //   می‌رفت → HTML ۱.۶۶MB و رندر ۶۷۳ms. حالا با اکشن
  //   `loadStaffListAction` فقط هنگام باز کردن تب «استادان» واکشی می‌شود.
  //   (کوئری و مپینگ در `staff-data.ts` — یک منبع واحد.)

const [head] = await db.select().from(roles).where(eq(roles.code, 'DEP_HEAD')).limit(1);
  const roleRows = await db.select({ id: roles.id, code: roles.code, title: roles.title, isSystem: roles.isSystem }).from(roles).orderBy(roles.id);

  return (
    <div className="space-y-4">
      <div className="card !p-4 bg-white border-slate-300 shadow-sm flex items-center justify-between">
        <div>
          <h1 className="text-base font-extrabold text-slate-900">🎓 سامانه جامع مدیریت پذیرش و پرونده تحصیلی/پرسنلی</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {Number(total).toLocaleString('fa-IR')} پرونده دانشجویی — جست‌وجو و صفحه‌بندی سمت سرور
          </p>
        </div>
      </div>

      <StudentsManagerClient
        key={currentUniversity?.code ?? 'AFAGH'}
        setNationalCodeFilter={setStudentNationalCodeFilter}
        logoUrl={currentUniversity?.logoUrl || (await getSetting('UNIVERSITY_LOGO').catch(() => ''))}
        codeLabels={codeLabels}
        regulations={regulationPicks}
        students={studentRows.map(s => ({
          id: s.id,
          studentCode: s.studentCode,
          nationalCode: s.nationalCode,
          firstName: s.firstName,
          lastName: s.lastName,
          mobile: s.mobile || '—',
          entryYear: s.entryYear,
          entryTerm: s.entryTerm || 1,
          status: s.status,
          samaStatusCode: s.samaStatusCode,
          quotaType: s.quotaType || 'NORMAL',
          currentTermNo: s.currentTermNo || 1,
          fatherName: s.fatherName || '—',
          birthCertNo: s.birthCertNo || '—',
          birthDate: s.birthDate instanceof Date ? s.birthDate.toISOString().slice(0, 10) : (s.birthDate ? String(s.birthDate).slice(0, 10) : null),
          gender: (s as unknown as { gender?: string | null }).gender ?? null,
          isActive: (s as unknown as { userIsActive?: number | null }).userIsActive ?? 1,
          userId: (s as unknown as { userId?: number | null }).userId ?? null,
          placeOfBirth: s.placeOfBirth || '—',
          placeOfIssue: s.placeOfIssue || '—',
          nationality: s.nationality || '120001',
          photoKey: s.photoKey,
          acceptanceType: s.acceptanceType,
          acceptanceAllocation: s.acceptanceAllocation,
          studyingMode: s.studyingMode,
          trainingMethod: s.trainingMethod,
          graduateDate: s.graduateDate,
          universityId: s.universityId,
          senderUniversityCode: s.senderUniversityCode,
          firstNameEn: s.firstNameEn || '—',
          lastNameEn: s.lastNameEn || '—',
          passportNumber: s.passportNumber || '—',
          email: s.email || null,
          postalCode: s.postalCode || null,
          address: s.address || null,
          advisorCode: s.advisorCode || null,
          documentStatus: s.documentStatus || null,
          scholarshipType: s.scholarshipType || null,
          militaryStatus: s.militaryStatus || null,
          militaryExemptionNo: s.militaryExemptionNo || null,
          studentCardStatus: s.studentCardStatus || null,
          archiveNo: s.archiveNo || null,
          parvandehNo: s.parvandehNo || null,
          dormName: s.dormName || null,
          dormRoom: s.dormRoom || null,
          hasDorm: s.hasDorm ?? null,
          guardianJobTitle: s.guardianJobTitle || null,
          guardianPhone: s.guardianPhone || null,
          guardianAddress: s.guardianAddress || null,
          guardianEmail: s.guardianEmail || null,
          diplomaType: s.diplomaType || null,
          diplomaPlace: s.diplomaPlace || null,
          diplomaYear: s.diplomaYear || null,
          diplomaGrade: s.diplomaGrade || null,
          pishdPlace: s.pishdPlace || null,
          pishdYear: s.pishdYear || null,
          pishdGrade: s.pishdGrade || null,
          tuitionType: s.tuitionType || null,
          tuitionPayer: s.tuitionPayer ?? null,
          englishExamType: s.englishExamType || null,
          englishScore: s.englishScore || null,
          insertDate: s.insertDate || null,
          insertTime: s.insertTime || null,
          certIssued3m: s.certIssued3m ?? null,
          documentDeficiency: s.documentDeficiency || null,
          unitsRemaining: s.unitsRemaining ?? null,
          eqSemesters: s.eqSemesters ?? null,
          facultyName: s.facultyName || '—',
          majorName: s.majorName || '—',
          majorCode: s.majorCode || '—',
          degreeLevel: s.degreeLevel || '—',
          degreeLevelId: s.degreeLevelId ?? 0,
          degreeCode: s.degreeCode || '—',
          regulationId: s.regulationId,
          regulationTitle: s.regulationTitle || '—',
          role: 'دانشجو',
        }))}
        pagination={{ total: Number(total), page: safePage, per: PER_PAGE, totalPages, q, status: statusFilter, degree: degreeFilter, sort: sortKey ? `${sortKey}:${sortDir}` : '', f_code: fCode, f_name: fName, f_nc: fNc, f_major: fMajor, f_year: fYear, university: currentUniversity?.code ?? 'AFAGH' }}
        degrees={degrees}
        geoPlaces={geoPlaces}
        statusCounts={statusCounts.map(r => ({ status: r.status, n: Number(r.n) }))}
        staffList={undefined}
        canEditGrades={canEditGrades}
        rolesAll={roleRows}
        userRoleIds={undefined}
        universities={allUniversities.map(u => ({ id: u.id, code: u.code, title: u.title, kind: u.kind, saminCode: u.saminCode }))}
        currentUniversityCode={currentUniversity?.code ?? 'AFAGH'}
      />
    </div>
  );
}
