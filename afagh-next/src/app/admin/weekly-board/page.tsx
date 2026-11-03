import { and, asc, desc, eq, inArray, ne, or, sql } from 'drizzle-orm';
import { db } from '@/db';
import {
  academic_terms, classrooms, course_offerings, courses, departments, enrollments, faculties,
  majors, offering_professors, schedules, staff, students, users,
} from '@/db/schema';
import { cookies } from 'next/headers';
import { requireRole } from '@/lib/auth';
import { getCurrentUniversity } from '@/lib/university-scope';
import { currentExpertFilters } from '@/lib/expert-scope';
import { getSetting, getBool } from '@/lib/settings';
import { groupIntoMerged, mergedGroupKey, professorCalendarEntryKey, type ProfessorCalendarWeekType } from '@/lib/professor-calendar-layout';
import ProfessorCalendarGrid, { type ProfessorCalendarEntry } from '@/app/professor/professor-calendar-grid';
import DoorSignPrint, { type DoorSignDetail } from './door-sign-print';
import DoorSignDetailSelect, { DOOR_DETAIL_COOKIE } from './DoorSignDetailSelect';
import FilterSelect from './FilterSelect';
import PrintButton from './PrintButton';
import pkg from '../../../../package.json';
const APP_VERSION = (pkg as { version?: string }).version ?? '1.0.0';

export const dynamic = 'force-dynamic';

const faDigits = (s: string | number) => String(s).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);

/** گزینه‌های ساعتِ محور زمان پوستر سردر */
const FROM_HOURS = Array.from({ length: 21 }, (_, i) => i); // ۰..۲۰
const TO_HOURS = Array.from({ length: 24 }, (_, i) => i + 1); // ۱..۲۴

/** ساعتِ معتبر برای محور زمان: عددِ صحیحِ ۰..۲۴ (وگرنه null) */
function parseHourParam(v: unknown): number | null {
  const n = Number(String(v ?? '').trim());
  return Number.isInteger(n) && n >= 0 && n <= 24 ? n : null;
}

/**
 * بازهٔ محور زمانِ پوستر سردر.
 * پیش‌فرض از تنظیمات دانشگاه (WEEKLY_BOARD_HOUR_FROM/TO) می‌آید و پارامترهای
 * ?from=&to= اورراید‌اش می‌کنند — چون بعضی دانشگاه‌ها کلاس‌ها را ۸→۱۸ (یا
 * ۷→۱۶) دارند و نیمهٔ شبِ پوستر فقط فضای خالی است. بازهٔ نامعتبر (کمتر از یک
 * ساعت یا بیشتر از ۱۸ ساعت) → پیش‌فرضِ خودِ تنظیمات.
 */
function resolveHourAxis(
  fromRaw: unknown, toRaw: unknown,
  defFromRaw: unknown, defToRaw: unknown,
): { from: number; to: number } {
  const f0 = parseHourParam(defFromRaw) ?? 8;
  const t0 = parseHourParam(defToRaw) ?? 20;
  const f = parseHourParam(fromRaw) ?? f0;
  const t = parseHourParam(toRaw) ?? t0;
  if (t - f < 1 || t - f > 18) return { from: f0, to: t0 };
  return { from: f, to: t };
}

/** پیشوند هوشمند: اگر مقدار خودش با همان عنوان شروع شود، تکرار نمی‌شود
 * («دانشگاه دانشگاه آفاق» و «نیمسال نیمسال اول» پیش می‌آید چون عنوان رکوردها پیشوند دارد) */
const withPrefix = (prefix: string, value: unknown) => {
  const v = String(value ?? '').trim();
  if (!v) return '';
  return v.startsWith(prefix) || v.includes(prefix) ? v : `${prefix} ${v}`;
};

function metaParts(parts: (string | null | undefined)[]): string {
  return parts.filter(Boolean).join(' · ');
}

/**
 * سربرگ سردر — عین کارتابل استاد/دانشجو:
 *   · روی صفحه: یک سطر فشرده (`print:hidden`)
 *   · در چاپ: جعبهٔ سربرگ کوچک `prof-week-print-head` (تک‌سطر، فونت کم)
 * بنابراین بالای جدول هرگز سه سطر شلوغ نمی‌شود.
 */
function BoardHeader({ logoUrl, title, meta }: {
  logoUrl: string | null;
  title: string;
  meta: string;
}) {
  return (
    <>
      {/* چاپ: تک‌سطر داخل جعبهٔ سربرگ استاندارد */}
      <div className="prof-week-print-head hidden print:block">
        <div style={{ display: 'flex', alignItems: 'center', gap: '4mm' }}>
          {logoUrl && (
            <img src={logoUrl} alt="" width={53} height={53} style={{ height: '11mm', width: 'auto', display: 'block' }} />
          )}
          <div style={{ minWidth: 0 }}>
            <div className="font-extrabold truncate">{title}</div>
            <div className="truncate">{meta}</div>
          </div>
        </div>
      </div>

      {/* صفحه: یک سطر، بدون شلوغی */}
      <div className="print:hidden flex items-center gap-2 pb-2 mb-1 border-b border-slate-200 overflow-hidden">
        {logoUrl && <img src={logoUrl} alt="ارم دانشگاه" className="h-8 w-8 shrink-0 object-contain" />}
        <h2 className="text-sm font-black text-slate-900 truncate shrink-0 max-w-[46%]">{title}</h2>
        <span className="text-slate-300 shrink-0">|</span>
        <p className="text-2xs font-bold text-slate-500 truncate">{meta}</p>
      </div>
    </>
  );
}

type BoardRow = {
  offeringId: number; groupNumber: number; enrolledCount: number | null; capacity: number | null;
  courseCode: string | null; courseTitle: string | null;
  courseNature: string | null; courseType: string | null;
  scheduleType: string | null;
  dayOfWeek: number | null; startTime: string | null; endTime: string | null;
  roomId: number | null; roomName: string | null; buildingName: string | null;
  profFirstName: string | null; profLastName: string | null;
  profRank: string | null; profGender: string | null; profLegacyTitle: string | null;
  deptId: number | null; sharedKey: string | null;
};

const normFa = (s: unknown) => String(s ?? '').replace(/ي/g, 'ی').replace(/ك/g, 'ک');
/** ارقام فارسی/عربی به انگلیسی — برای جست‌وجوی کد استاد/شماره دانشجویی */
const faToEn = (s: unknown) => String(s ?? '').replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).trim();

/**
 * گروه‌های «علوم انسانی» که لقب «مهندس» برای مربیانشان نامناسب است.
 * در سردر کلاس‌ها برای این گروه‌ها فقط «آقای/خانم + نام» می‌آید، نه «مهندس».
 * الگو عمداً گروه‌های فنی/مهندسی (کامپیوتر، برق، مکانیک، عمران، صنایع، …) را دربر نمی‌گیرد.
 */
const HUMANITIES_DEPT_PATTERN =
  /(حقوق|مدیریت|روانشناسی|حسابداری|مدارک|علوم انسانی|ادبیات|زبان|هنر|طراحی صنعتی|معماری|جغرافیا|اقتصاد|جامعه|تربیت بدنی|علوم تربیتی|سیاست|روابط بین الملل|فلسفه|دیریت|کتابداری|بین الملل)/;

/** آیا این ردیف به گروه علوم انسانی تعلق دارد؟ (نام گروه از طریق deptId نگاشت می‌شود) */
function isHumanitiesDept(deptName: string | null | undefined): boolean {
  return HUMANITIES_DEPT_PATTERN.test(normFa(deptName ?? ''));
}

/** نام نمایشی استاد با لقب احترام: استادیار و بالاتر «دکتر» + جناب آقای/سرکار خانم (اختیاری) */
function profDisplay(
  m: Pick<BoardRow, 'profFirstName' | 'profLastName' | 'profRank' | 'profGender' | 'profLegacyTitle'>,
  showTitle: boolean, showFirst: boolean, shortHonor = false, allowEngineer = true,
  showGenderHonor = true,
): string {
  const first = (m.profFirstName || '').trim();
  const last = (m.profLastName || '').trim();
  if (!showTitle) return [showFirst ? first : '', last].filter(Boolean).join(' ');
  const rank = normFa(m.profRank);
  const isDoctor = rank.includes('دانشیار') || rank.includes('استاد');
  const isEngineer = allowEngineer && !isDoctor && rank.includes('مربی');
  const degree = isDoctor ? 'دکتر' : isEngineer ? 'مهندس' : '';
  let honor = '';
  if (showGenderHonor) {
    const female = m.profGender === 'FEMALE' || (!m.profGender && normFa(m.profLegacyTitle).includes('خانم'));
    const male = m.profGender === 'MALE' || (!m.profGender && normFa(m.profLegacyTitle).includes('آقا'));
    // تفاوتِ گزینهٔ «کوتاه» (آقای/خانم) و «کامل» (جناب آقای/سرکار خانم) — قبلاً
    // پارامترِ `shortHonor` اصلاً استفاده نمی‌شد و دو گزینه یکسان بودند.
    honor = female ? (shortHonor ? 'خانم' : 'سرکار خانم')
      : male ? (shortHonor ? 'آقای' : 'جناب آقای')
        : '';
  }
  return [honor, degree, showFirst ? first : '', last].filter(Boolean).join(' ');
}

/** نگاشت scheduleType به نوع هفتهٔ تقویم (مثل کارتابل استاد/دانشجو): CLASS/ALL→هر هفته، EVEN→زوج، ODD→فرد، BOTH→زوج و فرد */
function mapBoardWeekType(scheduleType: string | null | undefined): ProfessorCalendarWeekType {
  const v = String(scheduleType ?? '').toUpperCase();
  if (v === 'EVEN') return 'EVEN';
  if (v === 'ODD') return 'ODD';
  if (v === 'BOTH') return 'BOTH';
  return 'ALL';
}

/** رنگ‌بندی بلوک مثل کارتابل استاد: عملی (کارگاهی/آزمایشگاهی) کهربایی، بقیه نیلی */
function mapBoardCourseType(courseNature: string | null | undefined, courseType: string | null | undefined): string {
  const v = `${courseNature ?? ''} ${courseType ?? ''}`;
  if (v.includes('عملی') || v.includes('کارگاه') || v.includes('آزمایش')) return 'عملی';
  return String(courseType || courseNature || 'تخصصی');
}

export type BoardCalendarEntry = ProfessorCalendarEntry & {
  sharedScheduleGroupKey: string | null;
  roomKey: string | number | null;
};

/**
 * ساخت ورودی‌های گرید تقویمی (همان فرمت کارتابل استاد/دانشجو) از سانس‌های سردر.
 * ادغامی‌ها مثل برنامهٔ استاد/دانشجو یک بلوک واحد می‌شوند: کدها با « / »،
 * عناوین با « / »، استادان با «،»، گروه‌ها با «،»، ثبت‌نامی جمع و ظرفیت ماکزیمم.
 */
function buildBoardCalendarEntries(
  list: BoardRow[],
  showTitle: boolean, showFirst: boolean, shortHonor = false,
  deptNameById: Map<number, string> = new Map(),
  noEngineerTitle = false,
  /** نام استادان همکار هر ارائه (وقتی استاد اصلی خالی است) — offeringId → فهرست به ترتیب staffId */
  coTeachers: Map<number, ({ staffId: number } & Pick<BoardRow, 'profFirstName' | 'profLastName' | 'profRank' | 'profGender' | 'profLegacyTitle'>)[]> = new Map(),
  showGenderHonor = true,
): { entries: BoardCalendarEntry[]; skipped: number } {
  const profOf = (m: BoardRow, slotRank: Map<number, string[]>) => {
    const main = profDisplay(
      m, showTitle, showFirst, shortHonor,
      !noEngineerTitle && !isHumanitiesDept(deptNameById.get(m.deptId ?? -1)),
      showGenderHonor,
    );
    if (main) return main;
    // استاد اصلی ثبت نشده → استادی که در همین سانس درس دارد:
    // رتبهٔ زمانی سانس (روز+ساعت+زوج/فرد) میان سانس‌های همان ارائه ↔ همان رتبه در فهرست همکاران.
    // (مثلاً استاد اول ساعت ۸، استاد دوم ساعت ۱۰ — یا یکی زوج و دیگری فرد — همان که در برنامهٔ درسی ثبت است.)
    const teachers = coTeachers.get(m.offeringId) ?? [];
    if (!teachers.length) return '';
    const slots = slotRank.get(m.offeringId) ?? [];
    const key = `${m.dayOfWeek}|${String(m.startTime ?? '').slice(0, 5)}|${mapBoardWeekType(m.scheduleType)}`;
    const rank = slots.indexOf(key);
    const pick = teachers[rank >= 0 ? rank % teachers.length : 0];
    return profDisplay(pick, showTitle, showFirst, shortHonor,
      !noEngineerTitle && !isHumanitiesDept(deptNameById.get(m.deptId ?? -1)),
      showGenderHonor,
    );
  };
  // سانس‌های متمایز هر ارائه به ترتیب زمانی (مبنای تطبیق استاد↔سانس) — با تفکیک زوج/فرد
  const slotRank = (() => {
    const map = new Map<number, string[]>();
    for (const r of list) {
      const k = `${r.dayOfWeek}|${String(r.startTime ?? '').slice(0, 5)}|${mapBoardWeekType(r.scheduleType)}`;
      const arr = map.get(r.offeringId) ?? [];
      if (!arr.includes(k)) arr.push(k);
      map.set(r.offeringId, arr);
    }
    for (const arr of map.values()) arr.sort();
    return map;
  })();
  type Raw = BoardRow & { uid: number };
  const groups = groupIntoMerged<Raw>(
    list.map((r, i) => ({ ...r, uid: i })),
    (m) => m.offeringId * 100000 + m.uid,
    (m) => {
      const shared = String(m.sharedKey ?? '').trim();
      const slot = mergedGroupKey(null, {
        dayOfWeek: m.dayOfWeek,
        startTime: m.startTime,
        endTime: m.endTime,
        roomKey: m.roomId ?? m.roomName ?? null,
      });
      // مرج دستی (M-...) در همه‌جا — برد، چاپ، کارتابل — بر سانس خودکار اولویت دارد؛
      // SOLO- یعنی شکستن مرج → رفتار مثل خودکار (تک‌تک).
      if (shared && !shared.startsWith('SOLO-')) return `K:${shared}`;
      return slot;
    },
  );
  const entries: BoardCalendarEntry[] = [];
  let skipped = 0;
  for (const g of groups) {
    if (!g.merged) {
      const m = g.members[0];
      const d = m.dayOfWeek == null ? null : Number(m.dayOfWeek);
      const st = String(m.startTime ?? '').slice(0, 5);
      const en = String(m.endTime ?? '').slice(0, 5);
      if (d == null || !Number.isInteger(d) || d < 0 || d > 6 || !st || !en || en <= st) { skipped += 1; continue; }
      const weekType = mapBoardWeekType(m.scheduleType);
      const row = { id: m.offeringId, dayOfWeek: d, startTime: st, endTime: en, weekType };
      entries.push({
        key: professorCalendarEntryKey(row),
        id: m.offeringId,
        code: String(m.courseCode ?? ''),
        title: String(m.courseTitle ?? ''),
        groupNumber: m.groupNumber,
        groupLabel: String(m.groupNumber),
        dayOfWeek: d,
        startTime: st,
        endTime: en,
        roomName: m.roomName ?? '',
        buildingName: m.buildingName ?? '',
        weekType,
        courseType: mapBoardCourseType(m.courseNature, m.courseType),
        professorName: profOf(m, slotRank),
        enrolledCount: m.enrolledCount ?? null,
        capacity: m.capacity ?? null,
        merged: false,
        sharedScheduleGroupKey: String(m.sharedKey ?? '').trim() || null,
        roomKey: m.roomId ?? m.roomName ?? null,
      });
      continue;
    }
    // گروه ادغامی: هویت مشترک (کدها/عناوین/گروه‌ها) در همهٔ سانس‌ها؛
    // هر سانس متمایز یک بلوک جدا در گرید و چاپ — همه با بج 🔗
    const codes = [...new Set(g.members.map(m => String(m.courseCode ?? '').trim()).filter(Boolean))];
    const titles = [...new Set(g.members.map(m => String(m.courseTitle ?? '').trim()).filter(Boolean))];
    const groupNums = [...new Set(g.members.map(m => m.groupNumber))].sort((a, b) => a - b);
    const byId = new Map<number, Raw>();
    for (const m of g.members) if (!byId.has(m.offeringId)) byId.set(m.offeringId, m);
    const uniqOfferings = [...byId.values()];
    const bySlot = new Map<string, Raw[]>();
    for (const m of g.members) {
      const sk = `${m.dayOfWeek}|${String(m.startTime ?? '').slice(0, 5)}|${String(m.endTime ?? '').slice(0, 5)}|${mapBoardWeekType(m.scheduleType)}`;
      const arr = bySlot.get(sk) ?? [];
      arr.push(m);
      bySlot.set(sk, arr);
    }
    for (const slotMembers of bySlot.values()) {
      const primary = slotMembers.find(m => m.offeringId * 100000 + m.uid === g.primaryId) ?? slotMembers[0];
      const d = primary.dayOfWeek == null ? null : Number(primary.dayOfWeek);
      const st = String(primary.startTime ?? '').slice(0, 5);
      const en = String(primary.endTime ?? '').slice(0, 5);
      if (d == null || !Number.isInteger(d) || d < 0 || d > 6 || !st || !en || en <= st) { skipped += slotMembers.length; continue; }
      const weekType = mapBoardWeekType(primary.scheduleType);
      const row = { id: primary.offeringId, dayOfWeek: d, startTime: st, endTime: en, weekType };
      const slotIds = new Set(slotMembers.map(m => m.offeringId));
      const enrolled = uniqOfferings.filter(m => slotIds.has(m.offeringId)).reduce((s, m) => s + (Number(m.enrolledCount) || 0), 0);
      const caps = uniqOfferings.filter(m => slotIds.has(m.offeringId)).map(m => Number(m.capacity)).filter(n => Number.isFinite(n) && n > 0);
      const profs = [...new Set(slotMembers.map(m => profOf(m, slotRank)).filter(Boolean))];
      // ادغامی: فقط یک نام درس (اولین عنوان یکتا) تا در چاپ جا شود — بج 🔗 جداگانه هست.
      const uniqTitles = [...new Set(titles)];
      const titleLabel = uniqTitles[0] ?? String(primary.courseTitle ?? '');
      entries.push({
        key: professorCalendarEntryKey(row),
        id: primary.offeringId,
        code: codes.length > 0 ? codes.join(' / ') : String(primary.courseCode ?? ''),
        title: titleLabel,
        groupNumber: primary.groupNumber,
        groupLabel: groupNums.map(n => String(n)).join('، '),
        dayOfWeek: d,
        startTime: st,
        endTime: en,
        roomName: primary.roomName ?? '',
        buildingName: primary.buildingName ?? '',
        weekType,
        courseType: mapBoardCourseType(primary.courseNature, primary.courseType),
        professorName: profs.join('، '),
        enrolledCount: enrolled,
        capacity: caps.length > 0 ? Math.max(...caps) : primary.capacity ?? null,
        merged: true,
        sharedScheduleGroupKey: String(primary.sharedKey ?? '').trim() || null,
        roomKey: primary.roomId ?? primary.roomName ?? null,
      });
    }
  }
  return { entries, skipped };
}

export default async function WeeklyBoardPage({ searchParams }: {
  searchParams: Promise<{ term?: string; faculty?: string; dept?: string; room?: string; tab?: string; q?: string; code?: string; title?: string; gender?: string; count?: string; mono?: string; print?: string; model?: string; from?: string; to?: string; d?: string }>;
}) {
  const user = await requireRole(['ADMIN', 'EDU_EXPERT']);
  const uni = await getCurrentUniversity().catch(() => null);
  const sp = await searchParams;
  const tab = sp.tab === 'prof' || sp.tab === 'student' ? sp.tab : 'board';
  const q = faToEn(sp.q);
  // کد درس در سردر کلاس‌ها پیش‌فرض خاموش است (خوانایی بالاتر)؛ با ?code=1 روشن می‌شود.
  const showCode = sp.code === '1';
  // تعداد دانشجو در چاپ: انتخابی کاربر (پیش‌فرض خاموش تا چاپ شلوغ نشود)؛ با ?count=1 روشن می‌شود.
  const printCount = sp.count === '1';
  const mono = sp.mono === '1';
  const model = sp.model === 'B' ? 'B' : 'A';
  /* حالتِ جزئیاتِ کارتِ سردر — سه حالتِ صریح (درخواست کاربر):
       ۱) فقط نام درس (+ زوج/فرد)      → ?d=1
       ۲) نام درس + استاد              → ?d=2
       ۳) نام درس + استاد + ساعت        → پیش‌فرض (همان رفتارِ قبلی)
     «زوج/فرد» در هر سه حالت چاپ می‌شود و به این انتخاب ربطی ندارد.

     ⚠️ چرا کوکی هم خوانده می‌شود: انتخاب در URL می‌ماند، ولی مسیرهای چاپی
     (`?print=door`، تبِ دیگر، پنجرهٔ چاپِ تازه، آدرسِ ذخیره‌شده) پارامتر `d`
     را با خود نمی‌برند و به پیش‌فرض برمی‌گشتند — یعنی «حالت در چاپ اعمال
     نمی‌شد». حالا اگر `d` در آدرس نبود، آخرین انتخابِ کاربر از کوکی می‌آید. */
  const dRaw = sp.d ?? (await cookies()).get(DOOR_DETAIL_COOKIE)?.value ?? '';
  const detail: DoorSignDetail = dRaw === '1' ? 'title' : dRaw === '2' ? 'prof' : 'full';
  // فقط کلاس‌های «فعال» در انتخاب‌گر می‌آیند. فعال/غیرفعال‌کردن کلاس ربطی به سردر
  // کلاسی ندارد و جای آن صفحهٔ تنظیمات است (بخش «داده‌های پایه»).
  const termId = Number(sp.term) || 0;
  const facultyId = Number(sp.faculty) || 0;
  const deptId = Number(sp.dept) || 0;
  const roomId = Number(sp.room) || 0;

  // کلیدهای نمایش نام استاد (تنظیمات مدیر) — مبنای حالت «تنظیم سامانه»
  const [cfgShowTitle, showFirst, cfgShortHonor, cfgShowGender, cfgHourFrom, cfgHourTo] = await Promise.all([
    getBool('WEEKLY_BOARD_PROF_TITLE').catch(() => true),
    getBool('WEEKLY_BOARD_SHOW_FIRSTNAME').catch(() => true),
    getBool('WEEKLY_BOARD_SHORT_HONORIFIC').catch(() => false),
    getBool('WEEKLY_BOARD_GENDER_HONORIFIC').catch(() => false),
    getSetting('WEEKLY_BOARD_HOUR_FROM').catch(() => ''),
    getSetting('WEEKLY_BOARD_HOUR_TO').catch(() => ''),
  ]);
  // بازهٔ ساعتِ پوستر سردر: پیش‌فرضِ دانشگاه از تنظیمات، اورراید با ?from=&to=
  const hourAxis = resolveHourAxis(sp.from, sp.to, cfgHourFrom, cfgHourTo);

  // ── عنوان استاد: کاملاً اختیاری ──
  //   system      → پیرو تنظیمات «پیکربندی سامانه»
  //   full        → آقای/خانم + دکتر + (مهندس برای گروه‌های فنی)
  //   academic    → فقط مرتبه علمی (دکتر/مهندس) بدون پیشوند جنسیتی
  //   no-engineer → آقای/خانم + دکتر، ولی مربی‌ها «بدون مهندس»
  //   plain       → فقط نام و نام خانوادگی
  const titleParam = sp.title ?? '';
  const genderParam = sp.gender ?? '';
  const profTitleMode: 'system' | 'full' | 'academic' | 'no-engineer' | 'plain' =
    titleParam === '1' ? 'full'
      : titleParam === 'academic' ? 'academic'
        : titleParam === '0' ? 'no-engineer'
          : titleParam === 'name' ? 'plain'
            : 'system';
  const showTitle = profTitleMode === 'plain' ? false
    : profTitleMode === 'system' ? cfgShowTitle
      : true;
  const noEngineerTitle = profTitleMode === 'no-engineer';
  // پیشوند جنسیتی: academic در فیلتر «عنوان» یعنی صریحاً بدون آقا/خانم
  const showGenderHonor = profTitleMode === 'academic' ? false
    : genderParam === '0' || genderParam === 'none' ? false
      : genderParam === 'full' || genderParam === '1' || genderParam === 'short' ? true
        : cfgShowGender;
  const shortHonor = genderParam === 'short' ? true
    : genderParam === 'full' || genderParam === '1' ? false
      : cfgShortHonor;

  const terms = await db.select({ id: academic_terms.id, title: academic_terms.title, isCurrent: academic_terms.isCurrent })
    .from(academic_terms)
    .where(uni ? eq(academic_terms.universityId, uni.id) : undefined)
    .orderBy(desc(academic_terms.id));
  const term = terms.find(t => t.id === termId) ?? terms.find(t => t.isCurrent === 1) ?? terms[0] ?? null;

  // نام استادان همکار هر ارائهٔ ترم، مرتب به ترتیب staffId (مبنای تطبیق با ترتیب سانس‌ها)
  // fallback وقتی استاد اصلی خالی است — چاپ «استاد:» خالی نماند.
  const coTeachers: Map<number, ({ staffId: number } & Pick<BoardRow, 'profFirstName' | 'profLastName' | 'profRank' | 'profGender' | 'profLegacyTitle'>)[]> =
    term
      ? await db
          .select({
            offeringId: offering_professors.offeringId,
            staffId: offering_professors.staffId,
            firstName: users.firstName,
            lastName: users.lastName,
            rank: staff.academicRank,
            gender: users.gender,
            legacyTitle: staff.title,
          })
          .from(offering_professors)
          .innerJoin(course_offerings, eq(course_offerings.id, offering_professors.offeringId))
          .innerJoin(staff, eq(staff.id, offering_professors.staffId))
          .innerJoin(users, eq(users.id, staff.userId))
          .where(and(eq(course_offerings.termId, term.id), eq(course_offerings.isActive, 1)))
          .then(coRows => {
            const map = new Map<number, ({ staffId: number } & Pick<BoardRow, 'profFirstName' | 'profLastName' | 'profRank' | 'profGender' | 'profLegacyTitle'>)[]>();
            for (const r of coRows) {
              const arr = map.get(r.offeringId) ?? [];
              arr.push({
                staffId: r.staffId,
                profFirstName: r.firstName ?? null,
                profLastName: r.lastName ?? null,
                profRank: r.rank ?? null,
                profGender: r.gender ?? null,
                profLegacyTitle: r.legacyTitle ?? null,
              });
              map.set(r.offeringId, arr);
            }
            for (const arr of map.values()) arr.sort((a, b) => a.staffId - b.staffId);
            return map;
          })
      : new Map();

  const facRows = await db.select({ id: faculties.id, name: faculties.name }).from(faculties)
    .where(uni ? eq(faculties.universityId, uni.id) : undefined)
    .orderBy(asc(faculties.name));
  // حذف تکراری‌های هم‌نام مهاجرت سما (دو ردیف یک نام) — کمترین id می‌ماند
  const facs = facRows.filter((f, i, a) => a.findIndex(x => x.name.trim() === f.name.trim()) === i);
  const facIds = new Set(facs.map(f => f.id));
  const depts = (await db.select({ id: departments.id, name: departments.name, facultyId: departments.facultyId }).from(departments)
    .where(uni ? eq(departments.universityId, uni.id) : undefined)
    .orderBy(asc(departments.name)))
    .filter(d => facIds.size === 0 || facIds.has(d.facultyId));
  const rooms = await (async () => {
    if (!term) return [];
    // فقط کلاس‌هایی که در همین ترم سانس دارند (خالی‌ها نه) + احترام به فیلتر دانشکده **و گروه**
    // NOTE: مبنا همهٔ سانس‌های کلاسی است (CLASS/EVEN/ODD/BOTH) نه فقط CLASS — وگرنه
    // کلاس‌هایی که فقط سانس زوج/فرد دارند از فهرست پوستر جا می‌مانند.
    //
    // اتصالِ درستِ کلاس→دانشکده: فیلترِ دانشکده فهرستِ کلاس‌ها را بر اساس
    // `classrooms."facultyId"` (مالکِ فیزیکیِ اتاق) محدود می‌کند، نه بر اساسِ اینکه
    // کدام درسِ آن دانشکده را میزبانی می‌کند — این همان اشکالی بود که کاربر گزارش
    // کرد («مشکلت از اتصال کلاسها به دانشکده هاست»). فیلترِ گروه همچنان بر اساسِ
    // رشتهٔ درس (courses."departmentId") اعمال می‌شود چون گروه مالکِ اتاق نیست.
    // گروهِ انتخاب‌شده باید متعلق به همین دانشگاه/دانشکده باشد؛ وگرنه fail-closed.
    if (deptId && !depts.some(d => d.id === deptId)) return [];
    const rows0 = await db.select({ id: classrooms.id, name: classrooms.name, buildingName: classrooms.buildingName, floor: classrooms.floor, capacity: classrooms.capacity, facultyId: classrooms.facultyId })
      .from(classrooms)
      .where(and(
        uni ? eq(classrooms.universityId, uni.id) : undefined,
        eq(classrooms.isActive, 1),
        facultyId ? eq(classrooms.facultyId, facultyId) : undefined,
        sql`EXISTS (SELECT 1 FROM schedules s
          JOIN course_offerings o ON o.id = s."offeringId"
          JOIN courses c ON c.id = o."courseId"
          WHERE s."roomId" = classrooms.id AND s."scheduleType" <> 'EXAM'
            AND o."termId" = ${term.id} AND o."isActive" = 1
            ${deptId ? sql`AND c."departmentId" = ${deptId}` : sql``})`,
      ))
      .orderBy(asc(classrooms.id));
    // ادغام هم‌نام‌های مهاجرت سما (دو ردیف یک نام، بدون ساختمان): یک گزینه، همهٔ idها
    const key = (r: { name: string; buildingName: string | null }) =>
      normFa(r.name).trim() + '|' + normFa(r.buildingName).trim();
    const out: (typeof rows0[number] & { aliasIds: number[] })[] = [];
    for (const r of rows0) {
      const k = key(r);
      const ex = out.find(x => key(x) === k);
      if (ex) ex.aliasIds.push(r.id);
      else out.push({ ...r, aliasIds: [r.id] });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name, 'fa'));
  })();
  const selRoom = rooms.find(r => r.id === roomId || r.aliasIds.includes(roomId)) ?? null;
  // اگر `room` در آدرس مانده ولی در فهرستِ فیلترشده نیست (کاربر دانشکده/گروه را
  // عوض کرده)، آن را «همهٔ کلاس‌ها» می‌گیریم. پیش‌تر این حالت تابلوی خالی می‌داد
  // و کاربر فکر می‌کرد فیلتر خراب است. مرزِ دانشگاه و دامنهٔ نقش همچنان با
  // `scopeConds` اعمال است، پس این کار هیچ داده‌ای را باز نمی‌کند.
  const effRoomId = selRoom?.id ?? 0;

  // ستون‌های مشترک هر سه تب (تابلوی کلاس‌ها / برنامه استاد / برنامه دانشجو)
  const boardSelect = {
    offeringId: course_offerings.id,
    groupNumber: course_offerings.groupNumber,
    enrolledCount: course_offerings.enrolledCount,
    capacity: course_offerings.capacity,
    courseCode: courses.code,
    courseTitle: courses.title,
    courseNature: courses.courseNature,
    courseType: courses.courseType,
    scheduleType: schedules.scheduleType,
    dayOfWeek: schedules.dayOfWeek,
    startTime: schedules.startTime,
    endTime: schedules.endTime,
    roomId: schedules.roomId,
    roomName: classrooms.name,
    buildingName: classrooms.buildingName,
    profFirstName: users.firstName,
    profLastName: users.lastName,
    profRank: staff.academicRank,
    profGender: users.gender,
    profLegacyTitle: staff.title,
    deptId: courses.departmentId,
    sharedKey: course_offerings.sharedScheduleGroupKey,
  };

  const rows = term && tab === 'board'
    ? await db
        .select(boardSelect)
        .from(schedules)
        .innerJoin(course_offerings, eq(course_offerings.id, schedules.offeringId))
        .innerJoin(courses, eq(courses.id, course_offerings.courseId))
        .leftJoin(staff, eq(staff.id, course_offerings.professorId))
        .leftJoin(users, eq(users.id, staff.userId))
        .leftJoin(classrooms, eq(classrooms.id, schedules.roomId))
        .where(and(
          ne(schedules.scheduleType, 'EXAM'),
          eq(course_offerings.termId, term.id),
          eq(course_offerings.isActive, 1),
          ...(selRoom ? [inArray(schedules.roomId, selRoom.aliasIds)] : []),
          // وقتی کلاس (پوستر درب) انتخاب شده، فیلترِ نمایشیِ دانشکده/گروه اعمال
          // نمی‌شود؛ پوسترِ یک اتاقِ فیزیکی باید همهٔ کلاس‌های آن اتاق را نشان
          // دهد (کلاس‌ها از دانشکده‌های مختلف در یک اتاقِ مشترک برگزار می‌شوند).
          // مرزِ دانشگاه و دامنهٔ نقش (EDU_EXPERT) همچنان در `roleScopeConds` اعمال است.
          ...(selRoom ? [] : await viewScopeConds(deptId, facultyId, uni?.id ?? null)),
          ...await roleScopeConds(user.roles, uni?.id ?? null),
        ))
        .orderBy(asc(courses.title), asc(course_offerings.groupNumber))
    : [];

  // ورودی‌های گرید تقویمی با همان فرمت کارتابل استاد/دانشجو (تک‌صفحهٔ افقی + بج ادغامی + بج زوج/فرد)
  const { entries: boardEntries, skipped: boardSkipped } = buildBoardCalendarEntries(rows, showTitle, showFirst, shortHonor, new Map(depts.map(d => [d.id, d.name] as const)), noEngineerTitle, coTeachers, showGenderHonor);
  const boardOfferingCount = new Set(rows.map(r => r.offeringId)).size;
  const boardMergedCount = boardEntries.filter(e => e.merged).length;

  // ── تب‌های برنامهٔ استاد / دانشجو (جست‌وجو با کد استادی / شماره دانشجویی) ──
  type PersonInfo = { kind: 'prof' | 'student'; name: string; code: string; extra: string };
  let personInfo: PersonInfo | null = null;
  let personSearched = false;
  let personRows: BoardRow[] = [];
  if ((tab === 'prof' || tab === 'student') && q && term) {
    personSearched = true;
    const scope = await roleScopeConds(user.roles, uni?.id ?? null);
    if (tab === 'prof') {
      const [p] = await db.select({
        id: staff.id, staffCode: staff.staffCode,
        firstName: users.firstName, lastName: users.lastName,
        rank: staff.academicRank, gender: users.gender, legacyTitle: staff.title,
        deptName: departments.name,
      }).from(staff)
        .innerJoin(users, eq(users.id, staff.userId))
        .leftJoin(departments, eq(departments.id, staff.departmentId))
        .where(and(eq(staff.staffCode, q), uni ? eq(users.universityId, uni.id) : undefined))
        .limit(1);
      if (p) {
        personInfo = {
          kind: 'prof', code: p.staffCode,
          name: profDisplay({ profFirstName: p.firstName, profLastName: p.lastName, profRank: p.rank, profGender: p.gender, profLegacyTitle: p.legacyTitle }, showTitle, showFirst, shortHonor, !noEngineerTitle, showGenderHonor),
          extra: p.deptName || '',
        };
        const coIds = (await db.select({ offeringId: offering_professors.offeringId })
          .from(offering_professors).where(eq(offering_professors.staffId, p.id))).map(r => r.offeringId);
        personRows = await db.select(boardSelect)
          .from(schedules)
          .innerJoin(course_offerings, eq(course_offerings.id, schedules.offeringId))
          .innerJoin(courses, eq(courses.id, course_offerings.courseId))
          .leftJoin(staff, eq(staff.id, course_offerings.professorId))
          .leftJoin(users, eq(users.id, staff.userId))
          .leftJoin(classrooms, eq(classrooms.id, schedules.roomId))
          .where(and(
            ne(schedules.scheduleType, 'EXAM'),
            eq(course_offerings.termId, term.id),
            eq(course_offerings.isActive, 1),
            coIds.length
              ? or(eq(course_offerings.professorId, p.id), inArray(course_offerings.id, coIds))
              : eq(course_offerings.professorId, p.id),
            ...scope,
          ))
          .orderBy(asc(courses.title), asc(course_offerings.groupNumber));
      }
    } else {
      const [s] = await db.select({
        id: students.id, code: students.studentCode,
        firstName: users.firstName, lastName: users.lastName, majorName: majors.name,
      }).from(students)
        .innerJoin(users, eq(users.id, students.userId))
        .leftJoin(majors, eq(majors.id, students.majorId))
        .where(and(eq(students.studentCode, q), uni ? eq(students.universityId, uni.id) : undefined))
        .limit(1);
      if (s) {
        personInfo = {
          kind: 'student', code: s.code,
          name: `${s.firstName || ''} ${s.lastName || ''}`.trim() || '—',
          extra: s.majorName || '',
        };
        const offIds = (await db.select({ offeringId: enrollments.offeringId })
          .from(enrollments)
          .innerJoin(course_offerings, eq(course_offerings.id, enrollments.offeringId))
          .where(and(
            eq(enrollments.studentId, s.id),
            eq(course_offerings.termId, term.id),
            inArray(enrollments.status, ['REGISTERED', 'FINALIZED', 'WAITLISTED', 'PENDING_COUNCIL']),
          ))).map(r => r.offeringId);
        if (offIds.length) {
          personRows = await db.select(boardSelect)
            .from(schedules)
            .innerJoin(course_offerings, eq(course_offerings.id, schedules.offeringId))
            .innerJoin(courses, eq(courses.id, course_offerings.courseId))
            .leftJoin(staff, eq(staff.id, course_offerings.professorId))
            .leftJoin(users, eq(users.id, staff.userId))
            .leftJoin(classrooms, eq(classrooms.id, schedules.roomId))
            .where(and(
              ne(schedules.scheduleType, 'EXAM'),
              inArray(course_offerings.id, offIds),
              eq(course_offerings.isActive, 1),
              ...scope,
            ))
            .orderBy(asc(courses.title), asc(course_offerings.groupNumber));
        }
      }
    }
  }
  const { entries: personEntries, skipped: personSkipped } = buildBoardCalendarEntries(personRows, showTitle, showFirst, shortHonor, new Map(depts.map(d => [d.id, d.name] as const)), noEngineerTitle, new Map(), showGenderHonor);

  const poster = selRoom ?? null;

  // ── سربرگ چاپ: دانشکده • نیمسال • کلاس ──
  // پوستر درب همیشه تک‌دانشکده است: دانشکدهٔ انتخابی، وگرنه دانشکدهٔ خود کلاس،
  // وگرنه پرتکرارترین دانشکدهٔ سانس‌ها (هرگز فهرست چندتایی).
  const facName = (id: number | null | undefined) => facs.find(f => f.id === id)?.name ?? '';
  const deptFac = new Map(depts.map(d => [d.id, d.facultyId] as const));
  const modeFaculty = (() => {
    const cnt = new Map<string, number>();
    for (const m of rows) {
      const n = facName(deptFac.get(m.deptId ?? -1));
      if (n) cnt.set(n, (cnt.get(n) ?? 0) + 1);
    }
    let best = '', bestN = 0;
    for (const [n, c] of cnt) if (c > bestN) { best = n; bestN = c; }
    return best;
  })();
  const headerFaculty = facultyId
    ? facName(facultyId)
    : poster
      ? (poster.facultyId ? facName(poster.facultyId) : modeFaculty)
      : (() => {
          const names = [...new Set(rows.map(m => facName(deptFac.get(m.deptId ?? -1))).filter(Boolean))];
          return names.length <= 2 ? names.join('، ') : `${names.slice(0, 2).join('، ')} و …`;
        })();

  const headerDept = deptId ? depts.find(d => d.id === deptId)?.name ?? '' : '';

  // ارم دانشگاه (الگوی سراسری اسناد: logoUrl دانشگاه، وگرنه UNIVERSITY_LOGO)
  const logoUrl = uni?.logoUrl || (await getSetting('UNIVERSITY_LOGO').catch(() => '')) || null;

  /**
   * برگهٔ چاپِ جدا برای سردر کلاسی.
   *
   * چرا: تابلوی هفتگی و سردر کلاسی دو سندِ متفاوت‌اند (یکی برنامهٔ ما برای
   * بایگانی، دیگری پوسترِ درِ کلاس). وقتی هر دو روی یک صفحه بودند، چاپِ هرکدام
   * دیگری را هم می‌کشید و چیدمان به‌هم می‌ریخت. با `?print=door` این صفحه فقط
   * و فقط پوستر را برمی‌گرداند؛ نه تب، نه نوار فیلتر، نه چیز دیگر.
   * آدرسِ آماده: /admin/weekly-board?room=<id>&print=door[&mono=1]
   */
  if (sp.print === 'door' && term && selRoom) {
    return (
      <DoorSignPrint
        entries={boardEntries}
        logoUrl={logoUrl}
        room={selRoom}
        termTitle={term.title}
        headerFaculty={headerFaculty}
        headerDept={headerDept}
        appVersion={APP_VERSION}
        universityName={uni?.title ?? null}
        mono={mono}
        model={model}
        startHour={hourAxis.from}
        endHour={hourAxis.to}
        detail={detail}
        showCode={showCode}
        printCount={printCount}
      />
    );
  }

  return (
    <div className="space-y-4" dir="rtl">
      {/* تب‌ها: تابلوی کلاس‌ها / برنامهٔ استاد / برنامهٔ دانشجو */}
      <div className="wb-chrome card flex flex-wrap gap-2 print:hidden">
        {([['board', '🗓 تابلوی کلاس‌ها'], ['prof', '👨‍🏫 برنامهٔ استاد'], ['student', '🎓 برنامهٔ دانشجو']] as const).map(([v, t]) => (
          <a
            key={v}
            href={`/admin/weekly-board?term=${term?.id ?? ''}&tab=${v}${showCode ? '&code=1' : ''}${titleParam ? `&title=${titleParam}` : ''}${genderParam ? `&gender=${genderParam}` : ''}${printCount ? '&count=1' : ''}${model === 'B' ? '&model=B' : ''}${detail === 'title' ? '&d=1' : detail === 'prof' ? '&d=2' : ''}&from=${hourAxis.from}&to=${hourAxis.to}`}
            className={`rounded-xl px-4 py-2 text-sm font-black ${tab === v ? 'bg-teal-800 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
          >
            {t}
          </a>
        ))}
      </div>

      {tab === 'board' ? (
      <>
      <form method="get" className="wb-chrome card flex flex-wrap items-end gap-3 print:hidden">
        <label className="text-xs font-bold">ترم
          <FilterSelect name="term" defaultValue={term?.id} resets={['room']} className="block mt-1 border border-slate-300 rounded-xl px-3 py-2 text-sm bg-white">
            {terms.map(t => <option key={t.id} value={t.id}>{t.title}{t.isCurrent === 1 ? ' (جاری)' : ''}</option>)}
          </FilterSelect>
        </label>
        <label className="text-xs font-bold">دانشکده
          <FilterSelect name="faculty" defaultValue={facultyId || ''} resets={['room']} className="block mt-1 border border-slate-300 rounded-xl px-3 py-2 text-sm bg-white">
            <option value="">همه</option>
            {facs.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
          </FilterSelect>
        </label>
        <label className="text-xs font-bold">گروه
          <FilterSelect name="dept" defaultValue={deptId || ''} resets={['room']} className="block mt-1 border border-slate-300 rounded-xl px-3 py-2 text-sm bg-white">
            <option value="">همه</option>
            {depts.filter(d => !facultyId || d.facultyId === facultyId).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </FilterSelect>
        </label>
        <label className="text-xs font-bold">🚪 کلاس (پوستر درب)
          <FilterSelect name="room" defaultValue={effRoomId || ''} className="block mt-1 border border-teal-500 rounded-xl px-3 py-2 text-sm bg-teal-50 font-black">
            <option value="">همهٔ کلاس‌ها (تابلوی کلی)</option>
            {rooms.map(r => <option key={r.id} value={r.id}>{r.name}{r.buildingName ? ` — ${r.buildingName}` : ''}</option>)}
          </FilterSelect>
        </label>
        <label className="text-xs font-bold">عنوان استاد
          <FilterSelect name="title" defaultValue={titleParam} className="block mt-1 border border-slate-300 rounded-xl px-3 py-2 text-sm bg-white">
            <option value="">پیرو تنظیم سامانه</option>
            <option value="academic">فقط مرتبه علمی (دکتر/مهندس) — کم‌جا</option>
            <option value="1">با عنوان کامل (آقای دکتر …)</option>
            <option value="0">مربی‌ها بدون «مهندس»</option>
            <option value="name">فقط نام (بدون عنوان)</option>
          </FilterSelect>
        </label>
        <label className="text-xs font-bold">پیشوند آقا / خانم
          <FilterSelect name="gender" defaultValue={genderParam} className="block mt-1 border border-slate-300 rounded-xl px-3 py-2 text-sm bg-white">
            <option value="">پیرو تنظیم سامانه</option>
            <option value="0">بدون آقا/خانم (کم‌جا — ویژهٔ چاپ)</option>
            <option value="short">کوتاه (آقای / خانم) ✓ پیش‌فرض</option>
            <option value="full">کامل (جناب آقای / سرکار خانم)</option>
          </FilterSelect>
        </label>
        <label className="text-xs font-bold">کد درس
          <FilterSelect name="code" defaultValue={showCode ? '1' : ''} className="block mt-1 border border-slate-300 rounded-xl px-3 py-2 text-sm bg-white">
            <option value="">بدون کد (خواناتر)</option>
            <option value="1">نمایش کد درس</option>
          </FilterSelect>
        </label>
        <label className="text-xs font-bold">تعداد دانشجو در چاپ
          <FilterSelect name="count" defaultValue={printCount ? '1' : ''} className="block mt-1 border border-slate-300 rounded-xl px-3 py-2 text-sm bg-white">
            <option value="">بدون تعداد (کم‌جا)</option>
            <option value="1">نمایش تعداد (👥 n/ظرفیت)</option>
          </FilterSelect>
        </label>
        <label className="text-xs font-bold">حالت چاپ
          <FilterSelect name="mono" defaultValue={mono ? '1' : ''} className="block mt-1 border border-slate-300 rounded-xl px-3 py-2 text-sm bg-white">
            <option value="">رنگی</option>
            <option value="1">سیاه‌سفید (عملی = خط‌چین)</option>
          </FilterSelect>
        </label>
        <label className="text-xs font-bold">چیدمان سردر
          <FilterSelect name="model" defaultValue={model} className="block mt-1 border border-slate-300 rounded-xl px-3 py-2 text-sm bg-white">
            <option value="A">مدل الف — روزها ستون (پیش‌فرض)</option>
            <option value="B">مدل ب — روزها سطر (زمان ستون)</option>
          </FilterSelect>
        </label>
        <DoorSignDetailSelect value={detail === 'title' ? '1' : detail === 'prof' ? '2' : ''} />
        <label className="text-xs font-bold">محور زمان از
          <FilterSelect name="from" defaultValue={String(hourAxis.from)} className="block mt-1 border border-slate-300 rounded-xl px-3 py-2 text-sm bg-white">
            {FROM_HOURS.map(h => <option key={h} value={h}>{faDigits(h)}:۰۰</option>)}
          </FilterSelect>
        </label>
        <label className="text-xs font-bold">تا
          <FilterSelect name="to" defaultValue={String(hourAxis.to)} className="block mt-1 border border-slate-300 rounded-xl px-3 py-2 text-sm bg-white">
            {TO_HOURS.map(h => <option key={h} value={h}>{h === 24 ? '۲۴:۰۰' : `${faDigits(h)}:۰۰`}</option>)}
          </FilterSelect>
        </label>
        <PrintButton />
      </form>

      {/* سردر کلاسی: با انتخاب کلاس، همین صفحه فقط پوستر را نشان می‌دهد و
          دکمهٔ «🖨️ چاپ سردر» (همان دکمهٔ همیشگیِ نوار فیلتر) آن را در یک برگ
          A4 افقی چاپ می‌کند. دکمهٔ جداگانه‌ای لازم نیست. */}
      {term && poster ? (
        <DoorSignPrint
          entries={boardEntries}
          logoUrl={logoUrl}
          room={poster}
          termTitle={term.title}
          headerFaculty={headerFaculty}
          headerDept={headerDept}
          appVersion={APP_VERSION}
          universityName={uni?.title ?? null}
          mono={mono}
          model={model}
          startHour={hourAxis.from}
          endHour={hourAxis.to}
          detail={detail}
          showCode={showCode}
          printCount={printCount}
        />
      ) : term && (
        <div className="print-area prof-week-print rounded-2xl border border-slate-300 bg-white p-4 space-y-3" dir="rtl">
          <style>{'@media print { @page { size: A4 landscape; margin: 8mm 7mm; } @page wb-a4 { size: A4 landscape; margin: 8mm 7mm; } .prof-week-print { page: wb-a4; position: static !important; } }'}</style>
          <BoardHeader
            logoUrl={logoUrl}
            title={`برنامهٔ هفتگی کلاس‌ها — ${term.title}`}
            meta={metaParts([
              withPrefix('دانشگاه', uni?.title ?? ''),
              headerFaculty ? withPrefix('دانشکدهٔ', headerFaculty) : null,
              headerDept ? `گروه ${headerDept}` : null,
              `${faDigits(boardOfferingCount)} کلاس · ${faDigits(boardEntries.length)} بلوک${boardMergedCount > 0 ? ` (${faDigits(boardMergedCount)} ادغامی 🔗)` : ''}`,
            ])}
          />
          {boardEntries.length === 0 ? (
            <div className="text-center p-6 bg-slate-50 rounded-2xl border border-dashed border-slate-300 text-xs font-bold text-slate-500 leading-6">
              در دامنهٔ انتخابی سانس کلاسی برای نمایش در جدول هفتگی وجود ندارد.
              {boardSkipped > 0 ? ` (${faDigits(boardSkipped)} سانس بدون روز/ساعت معتبر از جدول کنار گذاشته شد.)` : ''}
            </div>
          ) : (
            <ProfessorCalendarGrid entries={boardEntries} placeMode="professor" showCode={showCode} printCount={printCount} />
          )}
          {boardSkipped > 0 && boardEntries.length > 0 && (
            <p className="print:hidden text-2xs font-bold text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
              ⏰ {faDigits(boardSkipped)} سانس بدون روز/ساعت معتبر در جدول نمایش داده نمی‌شود.
            </p>
          )}
        </div>
      )}
      </>
      ) : (
      <>
      <form method="get" className="wb-chrome card flex flex-wrap items-end gap-3 print:hidden">
        <input type="hidden" name="tab" value={tab} />
        <input type="hidden" name="term" value={term?.id ?? ''} />
        <input type="hidden" name="title" value={titleParam} />
        <input type="hidden" name="gender" value={genderParam} />
        <label className="text-xs font-bold">{tab === 'prof' ? 'کد استادی' : 'شماره دانشجویی'}
          <input name="q" defaultValue={q} dir="ltr" placeholder={tab === 'prof' ? 'مثل ۱۰۰۱' : 'مثل ۴۰۲…'} className="block mt-1 border border-slate-300 rounded-xl px-3 py-2 text-sm bg-white font-mono" />
        </label>
        <button className="rounded-xl bg-indigo-700 px-5 py-2 text-white font-black text-sm">جست‌وجو</button>
        <PrintButton />
      </form>

      {term && personSearched && personInfo && (
        <div className="print-area prof-week-print rounded-2xl border border-slate-300 bg-white p-4 space-y-3" dir="rtl">
          <style>{'@media print { @page { size: A4 landscape; margin: 8mm 7mm; } @page wb-a4 { size: A4 landscape; margin: 8mm 7mm; } .prof-week-print { page: wb-a4; position: static !important; } }'}</style>
          <BoardHeader
            logoUrl={logoUrl}
            title={`${personInfo.kind === 'prof' ? '👨‍🏫 برنامهٔ هفتگی استاد' : '🎓 برنامهٔ هفتگی دانشجو'} — ${personInfo.name}`}
            meta={metaParts([
              `${personInfo.kind === 'prof' ? 'کد استادی' : 'شماره دانشجویی'} ${faDigits(personInfo.code)}`,
              personInfo.extra || null,
              withPrefix('نیمسال', term.title),
              withPrefix('دانشگاه', uni?.title ?? ''),
            ])}
          />
          {personEntries.length === 0 ? (
            <div className="text-center p-6 bg-slate-50 rounded-2xl border border-dashed border-slate-300 text-xs font-bold text-slate-500 leading-6">
              سانس کلاسی برای نمایش در جدول هفتگی وجود ندارد.
            </div>
          ) : (
            <ProfessorCalendarGrid entries={personEntries} />
          )}
          {personSkipped > 0 && personEntries.length > 0 && (
            <p className="print:hidden text-2xs font-bold text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
              ⏰ {faDigits(personSkipped)} سانس بدون روز/ساعت معتبر در جدول نمایش داده نمی‌شود.
            </p>
          )}
        </div>
      )}
      {term && personSearched && !personInfo && (
        <div className="card p-6 text-center text-sm font-bold text-rose-700">
          {tab === 'prof' ? 'استادی با این کد در این دانشگاه یافت نشد.' : 'دانشجویی با این شماره در این دانشگاه یافت نشد.'}
        </div>
      )}
      {term && !personSearched && (
        <div className="card p-6 text-center text-sm text-slate-500">
          {tab === 'prof' ? 'کد استادی را وارد و جست‌وجو کنید تا برنامهٔ هفتگی تدریس نمایش داده شود.' : 'شماره دانشجویی را وارد و جست‌وجو کنید تا برنامهٔ هفتگی کلاس‌ها نمایش داده شود.'}
        </div>
      )}
      </>
      )}
    </div>
  );
}

/**
 * فیلترِ نمایشیِ دانشکده/گروه — فقط وقتی کلاسی (پوستر درب) انتخاب نشده اعمال
 * می‌شود. چون پوسترِ یک اتاقِ فیزیکی باید همهٔ کلاس‌های آن اتاق را نشان دهد،
 * حتی اگر کلاس‌ها از دانشکده‌های دیگر باشند (اتاق‌های مشترکِ دانشگاه).
 */
async function viewScopeConds(deptId: number, facultyId: number, uniId: number | null): Promise<any[]> {
  const c: any[] = [];
  if (deptId) {
    // اعتبارسنجی گروه در برابر دانشگاه جاری — نامعتبر/بیگانه → هیچ (fail-closed)
    const [d] = await db.select({ id: departments.id, universityId: departments.universityId }).from(departments).where(eq(departments.id, deptId)).limit(1);
    if (!d || (uniId && d.universityId && d.universityId !== uniId)) c.push(sql`1=0`);
    else c.push(eq(courses.departmentId, deptId));
  } else if (facultyId) {
    const [fc] = await db.select({ id: faculties.id, universityId: faculties.universityId }).from(faculties).where(eq(faculties.id, facultyId)).limit(1);
    if (!fc || (uniId && fc.universityId && fc.universityId !== uniId)) {
      c.push(sql`1=0`);
    } else {
      const ids = (await db.select({ id: departments.id }).from(departments).where(eq(departments.facultyId, facultyId))).map(r => r.id);
      // fail-closed: دانشکدهٔ بدون گروه یعنی «هیچ» — نه «همه» (باگ نمایش همهٔ دانشکده‌ها)
      c.push(ids.length ? inArray(courses.departmentId, ids) : sql`1=0`);
    }
  }
  return c;
}

/**
 * مرزِ امنیت/دسترسی بر پایهٔ نقش (EDU_EXPERT) — همیشه اعمال می‌شود، چه کلاسی
 * انتخاب شده باشد چه نه. فیلترِ دانشگده/گروهِ کارشناس را اعمال می‌کند تا داده‌ای
 * خارج از دامنهٔ او نشت نکند.
 */
async function roleScopeConds(roles: string[], uniId: number | null): Promise<any[]> {
  const c: any[] = [];
  if (roles.includes('EDU_EXPERT')) {
    const eff = await currentExpertFilters().catch(() => null);
    // تقاطع دانشگاهی: دامنهٔ کارشناس باید دانشگاه جاری را پوشش دهد
    if (eff?.universityIds && (!uniId || !eff.universityIds.includes(uniId))) c.push(sql`1=0`);
    if (eff?.departmentIds) c.push(inArray(courses.departmentId, eff.departmentIds));
    else if (eff?.facultyIds) {
      const ids = (await db.select({ id: departments.id }).from(departments).where(inArray(departments.facultyId, eff.facultyIds))).map(r => r.id);
      c.push(ids.length ? inArray(courses.departmentId, ids) : sql`1=0`);
    } else if (eff?.majorIds) {
      // رشته‌های مجاز کارشناس → گروه‌های آن‌ها (نگاشت رشته→گروه)
      const mrows = await db.select({ departmentId: majors.departmentId }).from(majors).where(inArray(majors.id, eff.majorIds)).limit(5000);
      const ds = [...new Set(mrows.map(r => r.departmentId).filter((n): n is number => typeof n === 'number'))];
      c.push(ds.length ? inArray(courses.departmentId, ds) : sql`1=0`);
    }
  }
  return c;
}
