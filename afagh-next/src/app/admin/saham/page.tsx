import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { requireRole } from '@/lib/auth';
import SahamClient from './SahamClient';

export const dynamic = 'force-dynamic';

export interface SahamStat {
  universityId: number;
  code: string;
  title: string;
  isDissolved: boolean;
  students: number;
  graduates: number;
  instructors: number;
  sahamCodeCount: number;
  /** درصد پر بودن ستون‌های تازهٔ سهام (چک سلامت بک‌فیل) */
  fill: {
    studyType: number;
    teachingMode: number;
    maritalStatus: number;
    birthProvince: number;
    residenceProvince: number;
  };
}

export interface SahamFilterLookups {
  statuses: { universityId: number; status: string; n: number }[];
  majors: { universityId: number; id: number; name: string; facultyId: number | null }[];
  faculties: { universityId: number; id: number; name: string }[];
  terms: { universityId: number; id: number; termCode: string; title: string; isCurrent: number }[];
  entryYears: { universityId: number; min: number | null; max: number | null }[];
}

export default async function SahamPage() {
  await requireRole(['ADMIN']);

  const stats = (await db.execute<{
    id: number; code: string; title: string; kind: string;
    students: number; graduates: number; instructors: number; sahamCodes: number;
    studyType: number; teachingMode: number; maritalStatus: number;
    birthProvince: number; residenceProvince: number;
  } & Record<string, unknown>>(sql`
    SELECT u.id, u.code, u.title, u.kind,
      (SELECT count(*)::int FROM students s WHERE s."universityId" = u.id) AS "students",
      (SELECT count(*)::int FROM students s WHERE s."universityId" = u.id AND s.status = 'GRADUATED') AS "graduates",
      (SELECT count(*)::int FROM staff st WHERE st."universityId" = u.id) AS "instructors",
      (SELECT count(*)::int FROM saham_institute_codes c
        WHERE c."universityId" = u.id AND c."isActive" = 1)          AS "sahamCodes",
      (SELECT count(*)::int FROM students s WHERE s."universityId" = u.id AND s."studyType"     IS NOT NULL) AS "studyType",
      (SELECT count(*)::int FROM students s WHERE s."universityId" = u.id AND s."teachingMode"  IS NOT NULL) AS "teachingMode",
      (SELECT count(*)::int FROM students s WHERE s."universityId" = u.id AND s."maritalStatus" IS NOT NULL) AS "maritalStatus",
      (SELECT count(*)::int FROM students s WHERE s."universityId" = u.id AND s."birthProvince"  IS NOT NULL) AS "birthProvince",
      (SELECT count(*)::int FROM students s WHERE s."universityId" = u.id AND s."residenceProvince" IS NOT NULL) AS "residenceProvince"
    FROM universities u
    WHERE u."isActive" = 1
    ORDER BY u.id
  `)).rows.map(r => ({
    universityId: r.id,
    code: r.code,
    title: r.title,
    isDissolved: r.kind === 'DISSOLVED',
    students: r.students,
    graduates: r.graduates,
    instructors: r.instructors,
    sahamCodeCount: r.sahamCodes,
    fill: {
      studyType: r.studyType,
      teachingMode: r.teachingMode,
      maritalStatus: r.maritalStatus,
      birthProvince: r.birthProvince,
      residenceProvince: r.residenceProvince,
    },
  }));

  // لوک‌آپ‌های فیلتر (سبک: فقط id/عنوان)
  const [statusRows, majorRows, facultyRows, termRows, yearRows] = await Promise.all([
    db.execute<{ universityId: number; status: string; n: number } & Record<string, unknown>>(sql`
      SELECT s."universityId", s.status, count(*)::int AS n
      FROM students s GROUP BY 1, 2 ORDER BY 1, 3 DESC`),
    db.execute<{ universityId: number; id: number; name: string; facultyId: number | null } & Record<string, unknown>>(sql`
      SELECT m."universityId", m.id, m."name", m."facultyId" FROM majors m ORDER BY m."universityId", m."name"`),
    db.execute<{ universityId: number; id: number; name: string } & Record<string, unknown>>(sql`
      SELECT f."universityId", f.id, f."name" FROM faculties f ORDER BY f."universityId", f."name"`),
    db.execute<{ universityId: number; id: number; termCode: string; title: string; isCurrent: number } & Record<string, unknown>>(sql`
      SELECT t."universityId", t.id, t."termCode", t.title, t."isCurrent"
      FROM academic_terms t ORDER BY t."universityId", COALESCE(t."sortOrder", 0) DESC LIMIT 200`),
    db.execute<{ universityId: number; min: number | null; max: number | null } & Record<string, unknown>>(sql`
      SELECT s."universityId", min(s."entryYear") AS min, max(s."entryYear") AS max
      FROM students s GROUP BY 1`),
  ]);

  const lookups: SahamFilterLookups = {
    statuses: statusRows.rows,
    majors: majorRows.rows,
    faculties: facultyRows.rows,
    terms: termRows.rows,
    entryYears: yearRows.rows,
  };

  const totalStudents = stats.reduce((a, s) => a + s.students, 0);
  const totalGraduates = stats.reduce((a, s) => a + s.graduates, 0);
  const totalInstructors = stats.reduce((a, s) => a + s.instructors, 0);

  return (
    <div className="space-y-4">
      <div className="card">
        <h2 className="font-bold">📤 گزارش سالانهٔ سهام (سامانهٔ آماری مؤسسات آموزش عالی)</h2>
        <p className="mt-1 text-xs leading-6 text-slate-500">
          سهام هر سال فایل اکسل با <b>سرستون ثابت</b> می‌گیرد و مقادیرش <b>متنی</b> است؛ داده‌های
          نامعتبر را به‌عنوان «نام مطابقت نداشت» به شما برمی‌گرداند. خروجی این صفحه دقیقاً همان قالب رسمی
          است: کد ۱۲ رقمی واحد و شماره‌ها به‌صورت متن.
          <br />
          هر سه گزارش فعال است: <b>دانشجویان</b> (۵۲ ستون)، <b>دانش‌آموختگان</b> (۴۳ ستون + شیت نظام وظیفه)،{' '}
          <b>آموزشگران</b> (۳۷ ستون — اساتید دارای ارائه در نیمسال انتخابی).
          اول فیلتر بزنید و «پیش‌نمایش تعداد» را ببینید؛ خروجی هر فایل سقف ۵٬۰۰۰ ردیف دارد.
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <div className="card !p-3 text-center">
          <div className="text-2xl font-black text-slate-700">{totalStudents.toLocaleString('fa-IR')}</div>
          <div className="text-2xs text-slate-500">دانشجو (همهٔ وضعیت‌ها)</div>
        </div>
        <div className="card !p-3 text-center">
          <div className="text-2xl font-black text-slate-700">{totalGraduates.toLocaleString('fa-IR')}</div>
          <div className="text-2xs text-slate-500">دانش‌آموخته</div>
        </div>
        <div className="card !p-3 text-center">
          <div className="text-2xl font-black text-slate-700">{totalInstructors.toLocaleString('fa-IR')}</div>
          <div className="text-2xs text-slate-500">استاد (کل)</div>
        </div>
        <div className="card !p-3 text-center">
          <div className="text-2xl font-black text-slate-700">{stats.filter(s => s.sahamCodeCount > 0).length.toLocaleString('fa-IR')}</div>
          <div className="text-2xs text-slate-500">دانشگاه دارای کد سهام</div>
        </div>
      </div>

      <SahamClient stats={stats} lookups={lookups} />
    </div>
  );
}
