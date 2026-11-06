import { eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { degree_level_configs, students, universities, users } from '@/db/schema';
import { jalaliDateOf } from '@/lib/scheduling-core';
import { execFirstRow } from '@/lib/db-result';
import { mapMilitarySamaToMinistry, resolveCityMinistry, resolveCityMinistryByCode } from '@/lib/shared-coding';

/** تاریخ میلادی دیتابیس → شمسی 'YYYY/MM/DD' برای ثمین (نمونهٔ سند: 1381/02/06) */
function toJalaliDay(v: unknown): string {
  if (!v) return '';
  try {
    const d = v instanceof Date ? v : new Date(String(v));
    if (isNaN(d.getTime())) return '';
    return jalaliDateOf(d);
  } catch {
    return '';
  }
}

/** سال ورودی عددی → بازهٔ سال تحصیلی «1398-1399» (نمونهٔ سند) */
function toEduYear(v: unknown): string {
  const s = String(v ?? '').trim();
  if (/^\d{4}$/.test(s)) return `${s}-${Number(s) + 1}`;
  return s;
}

/** کد ملیت ثمین — در دیتا فقط خالی/0/120001 هست (همه ایرانی) */
function mapNationality(v: unknown): string {
  const s = String(v ?? '').trim();
  if (!s || s === '0') return '120001';
  return s;
}

/**
 * تبدیل رکورد داخلی (users+students) به payload ثمین entity 1000
 * مطابق APIM_SAORG_Samin_Student_WebServices_V0.6 صفحه ۸-۹
 */
export type SaminStudentPayload = Record<string, unknown>;

/** db.execute در node-postgres آبجکت Result می‌دهد نه آرایه — نرمال‌سازی مشترک */
async function firstRow<T>(q: Promise<unknown>): Promise<T | undefined> {
  return execFirstRow<T>(await q);
}

/**
 * ردیفِ منبعِ ثمین — خروجی `SELECT u.*, s.*` از JOIN «students + users».
 *
 * چرا این اینترفیس: پیش‌تر ردیف با `firstRow<SaminSourceRow>` خوانده می‌شد و هر دسترسی
 * `row.field` نوشته می‌شد (۷۶ مورد). یعنی هر غلط تایپی در نام ستون
 * فقط در زمان اجرا و به‌صورت مقدار `undefined` در payload ثمین ظاهر می‌شد —
 * بدترین حالت، چون سرویس بیرونی ممکن است آن را بپذیرد و داده ناقص ثبت شود.
 *
 * ستون‌ها عمداً nullable هستند (کوئری خام است و DB می‌تواند NULL بدهد)؛
 * تبدیل به رشته/عدد در محل استفاده انجام می‌شود، نه با `as any`.
 */
interface SaminSourceRow {
  // ── شناسه‌ها (alias های کوئری) ──
  uid: number;
  sid: number;
  // ── users ──
  nationalCode: string | null;
  /** بعضی ردیف‌های قدیمی کد ملی را با حرف بزرگ ذخیره کرده‌اند */
  NationalCode?: string | null;
  firstName: string | null;
  lastName: string | null;
  firstNameEn: string | null;
  lastNameEn: string | null;
  fatherName: string | null;
  gender: string | null;
  nationality: string | null;
  religion: string | null;
  birthDate: Date | string | null;
  birthCertNo: string | null;
  birthCertSeries: string | null;
  placeOfBirth: string | null;
  placeOfIssue: string | null;
  birthPlaceCode: string | null;
  issuePlaceCode: string | null;
  passportNumber: string | null;
  address: string | null;
  postalCode: string | null;
  email: string | null;
  mobile: string | null;
  isAlive: number | null;
  // ── students ──
  studentCode: string | null;
  status: string | null;
  degreeLevelId: number | null;
  universityId: number | null;
  senderUniversityCode: string | null;
  nativeType: string | null;
  ethnicity: string | null;
  militaryStatus: string | null;
  totalAverage: string | number | null;
  entryYear: string | number | null;
  entryTerm: string | number | null;
  graduateDate: string | null;
  eduEndYear: string | number | null;
  eduEndSemester: string | number | null;
  sanjeshFileNumber: string | null;
  sanjeshApplicantNumber: string | null;
  saminPersonPk: string | null;
  saminStudentPk: string | null;
  saminFieldCode: string | null;
  saminLocalFieldCode: string | null;
  saminIsVerified: number | null;
  saminVerifyCheckDate: Date | string | null;
  saminDescription: string | null;
  acceptanceAllocation: string | null;
  acceptanceType: string | null;
  studyingMode: string | null;
  trainingMethod: string | null;
  isaarCode: string | null;
  totalTakenUnits: number | null;
  totalPassedUnits: number | null;
  totalFailedUnits: number | null;
}

export async function buildSaminPayloadForStudent(studentId: number): Promise<SaminStudentPayload | null> {
  const row = await firstRow<SaminSourceRow>(db.execute(sql`
    SELECT u.*, s.*,
      s.id as sid, u.id as uid
    FROM students s
    JOIN users u ON u.id = s."userId"
    WHERE s.id = ${studentId}
  `));

  if (!row) return null;

  // محل‌ها از geo حل می‌شوند: اول کد ثبت‌شده، بعد عنوان؛ آدرس هم بهترین‌تلاش
  const birthGeo =
    (await resolveCityMinistryByCode(row.birthPlaceCode).catch(() => null)) ??
    (await resolveCityMinistry(row.placeOfBirth).catch(() => null));
  const issueGeo =
    (await resolveCityMinistryByCode(row.issuePlaceCode).catch(() => null)) ??
    (await resolveCityMinistry(row.placeOfIssue).catch(() => null));
  const addrGeo = await resolveCityMinistry(row.address).catch(() => null);

  // نگاشت ۱:۱ — فیلدهای الزامی ثمین باید پر باشند
  const nationalCode = row.nationalCode || row.NationalCode;
  const studentCode = row.studentCode;

  // کد استاندارد مقطع (level نمونهٔ سند: 210004) + کد ثمین دانشگاه
  let levelCode = '';
  const degId = Number(row.degreeLevelId || 0);
  if (degId) {
    const deg = await db
      .select({ sc: degree_level_configs.standardCode })
      .from(degree_level_configs)
      .where(eq(degree_level_configs.id, degId))
      .limit(1)
      .catch(() => [] as { sc: string | null }[]);
    levelCode = deg[0]?.sc || '';
  }
  let uniSaminCode = '';
  const uniId = Number(row.universityId || 0);
  if (uniId) {
    const uni = await db
      .select({ sc: universities.saminCode })
      .from(universities)
      .where(eq(universities.id, uniId))
      .limit(1)
      .catch(() => [] as { sc: string | null }[]);
    uniSaminCode = uni[0]?.sc || '';
  }
  const senderUni = row.senderUniversityCode || uniSaminCode || 'AFAGH';

  return {
    national_code: nationalCode,
    person_pk_in_source: row.saminPersonPk || String(row.uid),
    passport_number: row.passportNumber || '',
    student_pk_in_source: row.saminStudentPk || String(row.sid),
    student_code: studentCode,
    sender_university: senderUni,
    university: senderUni,
    first_name: row.firstName,
    last_name: row.lastName,
    first_name_en: row.firstNameEn || '',
    last_name_en: row.lastNameEn || '',
    iden_number: row.birthCertNo || '',
    iden_classified_number: row.birthCertSeries || '',
    iden_serial_number: '',
    birth_place: birthGeo?.cityCode || '',
    iden_issue_place: issueGeo?.cityCode || '',
    birth_date: toJalaliDay(row.birthDate),
    nationality: mapNationality(row.nationality),
    temp_certificate_code: '',
    final_certificate_code: '',
    military_edu_exemption_code: '',
    address: row.address || '',
    graduate_state: mapGraduateState(row.status),
    native_type: row.nativeType || '',
    ethnicity: row.ethnicity || '',
    military: mapMilitarySamaToMinistry(row.militaryStatus) || '',
    father_name: row.fatherName || '',
    gender: mapGender(row.gender),
    religion: row.religion || '',
    marriage_status: '',
    address_country: '120001',
    address_province: addrGeo?.provinceCode || '',
    address_city: addrGeo?.cityCode || '',
    postalcode: row.postalCode || '',
    email: row.email || '',
    mobile: row.mobile || '',
    total_average: row.totalAverage || '',
    edu_start_year: toEduYear(row.entryYear),
    edu_start_semester: String(row.entryTerm || '1'),
    graduate_date: row.graduateDate || '',
    graduate_certificate_level: '',
    edu_end_year: toEduYear(row.eduEndYear),
    edu_end_semester: row.eduEndSemester ? String(row.eduEndSemester) : '',
    faculty_pardis: '',
    faculty_daneshkadeh: '',
    faculty_group: '',
    faculty_pardis_title: '',
    faculty_daneshkadeh_title: '',
    faculty_group_title: '',
    scholarship: '',
    sanjesh_file_number: row.sanjeshFileNumber || '',
    sanjesh_applicant_number: row.sanjeshApplicantNumber || '',
    field: row.saminFieldCode || '',
    local_field: row.saminLocalFieldCode || '',
    level: levelCode,
    acceptance_allocation: row.acceptanceAllocation || '',
    acceptance_type: row.acceptanceType || '',
    studying_mode: row.studyingMode || '',
    training_method: row.trainingMethod || '',
    isaar_code: row.isaarCode || '',
    totaltakenunits_count: row.totalTakenUnits ? String(row.totalTakenUnits) : '',
    totalpassedunits_count: row.totalPassedUnits ? String(row.totalPassedUnits) : '',
    totalfailedunits_count: row.totalFailedUnits ? String(row.totalFailedUnits) : '',
    is_alive: String(row.isAlive ?? 1),
    birth_place_title: row.placeOfBirth || '',
    iden_issue_place_title: row.placeOfIssue || '',
    is_verified: row.saminIsVerified ? '1' : '',
    verify_check_date: toJalaliDay(row.saminVerifyCheckDate),
    description: row.saminDescription || '',
  };
}

function mapGraduateState(s: string | null | undefined): string {
  const m: Record<string, string> = { ACTIVE: '0', GRADUATED: '1', EXPELLED: '2', SUSPENDED: '3' };
  return m[s ?? ''] || '0';
}
function mapGender(g: string | null | undefined): string {
  if (!g) return '1';
  const m: Record<string, string> = { MALE: '1', FEMALE: '2' };
  return m[g.toUpperCase()] || '1';
}

/**
 * پیلود موجودیت «فرد» (entity_code 2001) — نمونهٔ cURL سند V0.2.
 * قبل از دانشجو (1000) ارسال می‌شود؛ person_pk_in_source همان uid است.
 */
export async function buildSaminPersonPayloadForStudent(
  studentId: number,
): Promise<Record<string, unknown> | null> {
  const row = await firstRow<SaminSourceRow>(db.execute(sql`
    SELECT u.*,
      s.id as sid, u.id as uid
    FROM students s
    JOIN users u ON u.id = s."userId"
    WHERE s.id = ${studentId}
  `));
  if (!row) return null;

  const birthGeo =
    (await resolveCityMinistryByCode(row.birthPlaceCode).catch(() => null)) ??
    (await resolveCityMinistry(row.placeOfBirth).catch(() => null));
  const issueGeo =
    (await resolveCityMinistryByCode(row.issuePlaceCode).catch(() => null)) ??
    (await resolveCityMinistry(row.placeOfIssue).catch(() => null));

  return {
    identity_code: row.nationalCode || '',
    source_id: row.saminPersonPk || String(row.uid),
    identity_type: 'student',
    first_name: row.firstName,
    last_name: row.lastName,
    first_name_en: row.firstNameEn || '',
    last_name_en: row.lastNameEn || '',
    faragir_naja_code: '',
    birth_date: toJalaliDay(row.birthDate),
    father_name: row.fatherName || '',
    passport_number: row.passportNumber || '',
    iden_number: row.birthCertNo || '',
    iden_classified_number: row.birthCertSeries || '',
    iden_serial_number: '',
    iden_issue_place_title: row.placeOfIssue || '',
    iden_issue_place_code: issueGeo?.cityCode || '',
    birth_place_code: birthGeo?.cityCode || '',
    gender: mapGender(row.gender),
    nationality: mapNationality(row.nationality),
    citizenship: '',
    is_alive: String(row.isAlive ?? 1),
    is_verified: row.saminIsVerified ? '1' : '',
    is_active: '',
  };
}
