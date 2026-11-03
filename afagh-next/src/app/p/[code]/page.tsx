import React from 'react';
import Link from 'next/link';
import { and, eq, inArray, ne } from 'drizzle-orm';
import { db } from '@/db';
import {
  classrooms,
  offering_professors,
  professor_class_attendance,
  schedules,
  universities,
} from '@/db/schema';
import { getSessionUser, getStaffByUser } from '@/lib/auth';
import { faDigits } from '@/lib/calendar';
import { currentTermFor } from '@/lib/terms';
import {
  checkinState,
  checkinWindowLabel,
  iranDowFromJalali,
  parseRoomCode,
  tehranNow,
} from '@/lib/room-checkin';
import { listSessionsInRoom, listUpcomingSessionsInRoom, listWeeklySessionsInRoom } from '@/lib/room-session-lookup';
import { canControlRoom, getRecorderPolicy, listMergedTodaySessionsForRooms } from '@/lib/attendance-control';
import { mergeBadgeText, mergeMemberTitles } from '@/lib/merged-class-core';
import { recordRoomAttendance } from './actions';

export const dynamic = 'force-dynamic';

const MSG: Record<string, string> = {
  ok: 'حضور شما با موفقیت ثبت شد.',
  okctrl: 'حضور استاد برای این جلسه ثبت شد.',
  okmerged: 'این کلاس ادغامی بود؛ حضور روی همهٔ کلاس‌های ادغامی ثبت شد.',
  okctrlmerged: 'این کلاس ادغامی بود؛ حضور استاد روی همهٔ کلاس‌های ادغامی ثبت شد.',
  already: 'حضور برای این جلسه قبلاً ثبت شده است.',
};

const ERR: Record<string, string> = {
  badroom: 'کد این QR معتبر نیست. لطفاً QR سردر کلاس را دوباره اسکن کنید.',
  nosession: 'جلسهٔ معتبری برای ثبت حضور یافت نشد.',
  notstaff: 'این صفحه مخصوص استادان و کنترل‌کنندگان حضور است. با حساب مناسب وارد شوید.',
  wrongroom: 'این جلسه در این اتاق برگزار نمی‌شود.',
  notoday: 'این جلسه امروز برگزار نمی‌شود.',
  window: 'اکنون خارج از بازهٔ مجاز ثبت حضور است.',
  notyours: 'شما استاد این درس نیستید و کنترل‌کنندهٔ این اتاق هم نیستید.',
  wronguni: 'این اتاق به دانشگاه دیگری تعلق دارد.',
  profblocked: 'بر اساس تنظیم سامانه، ثبت حضور در این دانشگاه فقط توسط کنترل‌کنندهٔ حضور و غیاب انجام می‌شود.',
  ctrlblocked: 'بر اساس تنظیم سامانه، ثبت حضور فقط توسط خودِ استاد انجام می‌شود.',
  noprof: 'برای این جلسه استادی ثبت نشده است؛ ابتدا استاد درس را در سامانه مشخص کنید.',
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-100 font-sans flex flex-col items-center justify-center py-8 px-4" dir="rtl">
      <div className="w-full max-w-md space-y-3">{children}</div>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-3xl shadow-xl border border-slate-200 p-6 space-y-4">{children}</div>
  );
}

function Notice({ kind, text }: { kind: 'ok' | 'err' | 'info'; text: string }) {
  const tone =
    kind === 'ok'
      ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
      : kind === 'err'
        ? 'bg-rose-50 border-rose-200 text-rose-800'
        : 'bg-amber-50 border-amber-200 text-amber-800';
  return (
    <div className={`rounded-2xl border px-4 py-3 text-xs font-bold leading-6 ${tone}`}>{text}</div>
  );
}

export default async function RoomCheckinPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ msg?: string; err?: string }>;
}) {
  const { code } = await params;
  const sp = await searchParams;
  const roomId = parseRoomCode(code);

  const msg = sp.msg ? MSG[sp.msg] : null;
  const err = sp.err ? ERR[sp.err] ?? 'خطای نامشخص رخ داد.' : null;

  if (!roomId) {
    return (
      <Shell>
        <Card>
          <h1 className="text-lg font-black text-slate-900 text-center">QR نامعتبر</h1>
          <Notice kind="err" text={ERR.badroom} />
        </Card>
      </Shell>
    );
  }

  const [room] = await db
    .select({
      id: classrooms.id,
      name: classrooms.name,
      buildingName: classrooms.buildingName,
      floor: classrooms.floor,
      isActive: classrooms.isActive,
      universityId: classrooms.universityId,
    })
    .from(classrooms)
    .where(eq(classrooms.id, roomId))
    .limit(1);

  if (!room) {
    return (
      <Shell>
        <Card>
          <h1 className="text-lg font-black text-slate-900 text-center">اتاق یافت نشد</h1>
          <Notice kind="err" text="این اتاق در سامانه ثبت نشده است. با ادارهٔ آموزش تماس بگیرید." />
        </Card>
      </Shell>
    );
  }

  const uniTitle = room.universityId
    ? (await db
        .select({ title: universities.title })
        .from(universities)
        .where(eq(universities.id, room.universityId))
        .limit(1))[0]?.title ?? null
    : null;

  const roomLine = [room.buildingName, room.floor].filter(Boolean).join(' · ');

  const header = (
    <div className="text-center space-y-1">
      <div className="w-14 h-14 bg-gradient-to-tr from-indigo-950 to-indigo-800 rounded-2xl flex items-center justify-center mx-auto shadow-lg text-white font-black text-xl border-2 border-amber-400">
        آ
      </div>
      <div className="text-2xs font-bold text-slate-500">{uniTitle ?? 'سامانه جامع آفاق'}</div>
      <h1 className="text-xl font-black text-slate-900">ثبت حضور استاد</h1>
      <div className="text-xs font-bold text-slate-600">
        اتاق {faDigits(room.name)}
        {roomLine ? <span className="text-slate-400"> — {faDigits(roomLine)}</span> : null}
      </div>
      {room.isActive === 0 ? (
        <div className="text-3xs font-bold text-amber-700">این اتاق در سامانه غیرفعال است.</div>
      ) : null}
    </div>
  );

  const user = await getSessionUser();
  if (!user) {
    return (
      <Shell>
        <Card>
          {header}
          <Notice kind="info" text="برای ثبت حضور باید با حساب استاد وارد سامانه شوید." />
          <Link
            href={`/login?next=${encodeURIComponent(`/p/room-${roomId}`)}`}
            className="block w-full py-3 rounded-2xl bg-indigo-900 hover:bg-indigo-950 text-white font-black text-xs text-center shadow-md transition"
          >
            ورود به سامانه
          </Link>
        </Card>
      </Shell>
    );
  }

  const me = await getStaffByUser(user.id);
  if (!me) {
    return (
      <Shell>
        <Card>
          {header}
          <Notice kind="err" text="برای این حساب پروندهٔ هیئت علمی ثبت نشده است؛ این صفحه مخصوص استادان است." />
        </Card>
      </Shell>
    );
  }

  // مرزِ بین‌دانشگاهی: QRِ یک اتاق نباید برنامهٔ اتاقِ دانشگاه دیگر را نشان دهد.
  // شناسهٔ اتاق عددی و ترتیبی است، پس بدون این گارد با حدسِ شماره می‌شد
  // برنامهٔ کلاس‌های دانشگاه دیگر را دید. (نوشتن از قبل با مالکیتِ ارائه بسته است.)
  const myUni = me.universityId ?? user.universityId ?? null;
  if (myUni != null && room.universityId != null && myUni !== room.universityId) {
    return (
      <Shell>
        <Card>
          {header}
          <Notice kind="err" text="این اتاق به دانشگاه دیگری تعلق دارد و در دسترس حساب شما نیست." />
        </Card>
      </Shell>
    );
  }

  const now = tehranNow();

  // اتاق از برنامهٔ هفتگی حل می‌شود، نه از class_sessions.roomId (که تقریباً همیشه خالی است).
  const todayRows = await listSessionsInRoom(roomId, now.jalali);

  // استادِ مشترک: مالکِ ارائه نیست ولی در offering_professors ثبت شده است.
  const notMine = todayRows.filter(r => r.professorId !== me.id);
  let sharedOfferingIds = new Set<number>();
  if (notMine.length > 0) {
    const shared = await db
      .select({ offeringId: offering_professors.offeringId })
      .from(offering_professors)
      .where(and(
        eq(offering_professors.staffId, me.id),
        inArray(offering_professors.offeringId, [...new Set(notMine.map(r => r.offeringId))]),
      ));
    sharedOfferingIds = new Set(shared.map(s => s.offeringId));
  }

  const mine = todayRows
    .filter(r => r.professorId === me.id || sharedOfferingIds.has(r.offeringId))
    .map(r => ({
      ...r,
      state: checkinState(r.startTime, r.endTime, now.minutes),
      window: checkinWindowLabel(r.startTime, r.endTime),
    }));

  const mineIds = mine.map(m => m.id);
  const recordedRows = mineIds.length
    ? await db
        .select({
          sessionId: professor_class_attendance.sessionId,
          recordedAt: professor_class_attendance.recordedAt,
          verificationMethod: professor_class_attendance.verificationMethod,
        })
        .from(professor_class_attendance)
        .where(and(
          inArray(professor_class_attendance.sessionId, mineIds),
          eq(professor_class_attendance.staffId, me.id),
        ))
    : [];
  const recordedBy = new Map(recordedRows.map(r => [r.sessionId, r]));

  const withRecord = mine.map(m => ({ ...m, recorded: recordedBy.get(m.id) ?? null }));
  const focus =
    withRecord.find(m => m.state === 'OPEN' && !m.recorded) ??
    withRecord.find(m => m.state === 'OPEN') ??
    withRecord.find(m => m.state === 'BEFORE') ??
    withRecord[withRecord.length - 1] ??
    null;

  /* ── کنترلِ حضور: چه کسی حق ثبت دارد؟ ────────────────────────────────
     مدیر سامانه با تنظیمِ ATTENDANCE_RECORDER_MODE تعیین می‌کند که خودِ استاد
     ثبت کند، یا کنترل‌کنندهٔ حضور و غیاب، یا هر دو. دامنهٔ کنترل‌کننده با
     canControlRoom حل می‌شود (اتاق → استثنای درس → دانشکده/دانشگاه). */
  const policy = await getRecorderPolicy().catch(() => ({
    mode: 'BOTH' as const,
    professorAllowed: true,
    controllerAllowed: true,
    roomScoped: true,
  }));
  const control = await canControlRoom(user.id, roomId).catch(() => ({
    allowed: false,
    source: null as null,
    roles: [] as string[],
  }));
  const ctrlCan = control.allowed && policy.controllerAllowed;

  // جلساتِ امروزِ همین اتاق با وضعیتِ ثبتِ هرکدام — برای کارتابلِ کنترل‌کننده.
  // (یک اتاق است، پس همان کوئریِ دسته‌ای ارزان تمام می‌شود.)
  //
  // گروه‌بندیِ «کلاس ادغامی»: اگر در یک ساعت چند عرضه با یک استاد در این اتاق
  // برگزار شوند (مثلاً «ریاضی» و «ریاضی ۱»)، فقط یک ردیف با نشان 🔗 دیده
  // می‌شود و ثبتِ آن روی همهٔ اعضا اعمال می‌شود.
  const roomTodayGroups = await listMergedTodaySessionsForRooms([roomId], now.jalali).catch(() => []);
  const roomToday = roomTodayGroups.flatMap(g => g.members);
  const anyBySlot = new Map(roomToday.map(r => [`${r.offeringId}|${r.startTime}`, r]));
  const ctrlGroups = ctrlCan ? roomTodayGroups : [];
  const ctrlDone = ctrlGroups.filter(g => g.members[0]?.recordedAt != null).length;

  // اگر کلاسِ «تمرکز»ِ استاد ادغامی است (چند عرضه در یک جلسه)، بج 🔗 نشان بده
  // تا بداند یک ثبت روی همهٔ کلاس‌هایش اعمال می‌شود.
  const focusGroup = focus
    ? roomTodayGroups.find(g => g.memberSessionIds.includes(focus.id)) ?? null
    : null;
  const focusMemberTitles = focusGroup ? mergeMemberTitles(focusGroup.members) : '';

  const ctrlCard = ctrlCan ? (
    <Card>
      <details open>
        <summary className="cursor-pointer list-none flex items-center justify-between gap-2">
          <span className="text-sm font-black text-slate-900">کنترل حضور و غیاب این اتاق</span>
          <span className={`text-3xs font-black rounded-full px-2 py-0.5 ${
            ctrlGroups.length > 0 && ctrlDone === ctrlGroups.length
              ? 'bg-emerald-100 text-emerald-800'
              : 'bg-amber-100 text-amber-800'
          }`}>
            {faDigits(ctrlDone)} از {faDigits(ctrlGroups.length)} کلاس
          </span>
        </summary>

        {ctrlGroups.length === 0 ? (
          <div className="mt-3">
            <Notice kind="info" text="امروز جلسه‌ای در این اتاق برگزار نمی‌شود." />
          </div>
        ) : (
          <div className="mt-3 space-y-1.5">
            {ctrlGroups.map(g => {
              const r = g.members[0];
              const st = checkinState(r.startTime, r.endTime, now.minutes);
              const memberTitles = mergeMemberTitles(g.members);
              return (
                <div
                  key={r.sessionId}
                  className={`rounded-2xl border px-3 py-2 flex items-center gap-2 ${
                    r.recordedAt ? 'border-emerald-200 bg-emerald-50/60' : 'border-slate-200 bg-white'
                  }`}
                >
                  <div className="text-3xs font-bold text-slate-500 w-12 shrink-0 leading-4" dir="ltr">
                    {faDigits(r.startTime)}
                    <br />
                    {faDigits(r.endTime)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-2xs font-black text-slate-800 truncate">{r.courseTitle}</span>
                      {g.merged ? (
                        <span
                          title={`این کلاس از ${g.members.length} عرضه تشکیل شده: ${memberTitles}`}
                          className="shrink-0 text-[9px] font-black rounded-full px-1.5 py-0.5 bg-violet-100 text-violet-800 border border-violet-200"
                        >
                          🔗 {mergeBadgeText(g.members.length)}
                        </span>
                      ) : null}
                    </div>
                    <div className="text-3xs font-bold text-slate-500 truncate">
                      {r.professorName} · گروه {faDigits(r.groupNumber)}
                    </div>
                    {g.merged && memberTitles ? (
                      <div className="text-[9px] font-bold text-violet-700/80 truncate" title={memberTitles}>
                        {memberTitles}
                      </div>
                    ) : null}
                  </div>

                  {r.recordedAt ? (
                    <span className="text-[9px] font-black text-emerald-800 bg-emerald-100 border border-emerald-200 rounded-lg px-2 py-1 shrink-0">
                      ثبت شد
                    </span>
                  ) : st === 'OPEN' ? (
                    <form action={recordRoomAttendance} className="shrink-0">
                      <input type="hidden" name="code" value={`room-${roomId}`} />
                      <input type="hidden" name="sessionId" value={r.sessionId} />
                      <button
                        type="submit"
                        className="text-[9px] font-black text-white bg-indigo-700 hover:bg-indigo-800 rounded-lg px-2.5 py-1.5 shadow-sm"
                      >
                        ثبت حضور
                      </button>
                    </form>
                  ) : st === 'BEFORE' ? (
                    <span className="text-[9px] font-bold text-slate-400 shrink-0">هنوز باز نشده</span>
                  ) : (
                    <span className="text-[9px] font-bold text-slate-400 shrink-0">گذشته</span>
                  )}
                </div>
              );
            })}
            <div className="text-[9px] font-bold text-slate-400 pt-1">
              ثبت به نامِ استادِ هر جلسه انجام می‌شود و نام شما به‌عنوان ثبت‌کننده در سابقه می‌ماند.
              {' '}کلاس‌های ادغامی با یک ثبت روی همهٔ عرضه‌ها اعمال می‌شوند.
            </div>
          </div>
        )}
      </details>
    </Card>
  ) : null;

  // اگر امروز کلاسی در این اتاق نداریم، نزدیک‌ترین جلساتِ آیندهٔ همین استاد را نشان بده.
  let upcoming: { id: number; sessionDate: string; startTime: string; endTime: string; courseTitle: string; courseCode: string }[] = [];
  if (!focus) {
    const nextRows = await listUpcomingSessionsInRoom(roomId, now.jalali, 30);

    const nextNotMine = nextRows.filter(r => r.professorId !== me.id);
    let nextShared = new Set<number>();
    if (nextNotMine.length > 0) {
      const shared = await db
        .select({ offeringId: offering_professors.offeringId })
        .from(offering_professors)
        .where(and(
          eq(offering_professors.staffId, me.id),
          inArray(offering_professors.offeringId, [...new Set(nextNotMine.map(r => r.offeringId))]),
        ));
      nextShared = new Set(shared.map(s => s.offeringId));
    }

    upcoming = nextRows
      .filter(r => r.professorId === me.id || nextShared.has(r.offeringId))
      .slice(0, 3);
  }

  const timeLabel = (start: string, end: string) =>
    `${faDigits(start)} تا ${faDigits(end)}`;

  /* ── برنامهٔ هفتگیِ اتاق ──────────────────────────────────────────────
     همان چیزی که روی پوسترِ سردر چاپ شده. چرا لازم است: تا امروز اگر استاد
     «امروز» در این اتاق کلاس نداشت، صفحه فقط می‌گفت «کلاسی ثبت نشده» و او
     نمی‌دانست کِی باید بیاید. حالا کل هفته را می‌بیند و ردیف‌های امروزِ خودش
     دکمهٔ ثبت حضور دارند. منبع همان `schedules` است، پس با تابلو واگرا نمی‌شود. */
  const term = await currentTermFor(room.universityId).catch(() => null);
  const weekly = await listWeeklySessionsInRoom(roomId, term?.id ?? null);
  const todayDow = iranDowFromJalali(now.jalali);

  /* اتاق‌های هم‌نام: در دادهٔ واقعی دو رکورد با نامِ «كلاس 4 عمومي» وجود دارد
     (یکی ۱۶۱ سانس، دیگری صفر). اگر QRِ رکوردِ خالی روی درب چاپ شده باشد،
     استاد بن‌بست می‌خورد و فکر می‌کند سامانه خراب است. پس هم‌نام‌های دارای
     برنامه را پیشنهاد می‌دهیم. */
  const twinRooms = weekly.length === 0
    ? await (async () => {
        const same = await db
          .select({ id: classrooms.id })
          .from(classrooms)
          .where(and(eq(classrooms.name, room.name), ne(classrooms.id, room.id), eq(classrooms.isActive, 1)))
          .catch(() => []);
        if (!same.length) return [] as { id: number; slots: number }[];
        const rows = await db
          .select({ roomId: schedules.roomId })
          .from(schedules)
          .where(and(
            inArray(schedules.roomId, same.map(s => s.id)),
            eq(schedules.scheduleType, 'CLASS'),
          ))
          .catch(() => []);
        const counts = new Map<number, number>();
        for (const r of rows) {
          if (r.roomId == null) continue;
          counts.set(r.roomId, (counts.get(r.roomId) ?? 0) + 1);
        }
        return same
          .map(s => ({ id: s.id, slots: counts.get(s.id) ?? 0 }))
          .filter(s => s.slots > 0)
          .sort((a, b) => b.slots - a.slots);
      })()
    : [];

  // استادِ مشترک در همهٔ روزها، نه فقط امروز
  const weeklyOfferingIds = [...new Set(weekly.map(w => w.offeringId))];
  const myShared = new Set<number>();
  if (weeklyOfferingIds.length) {
    const sharedAll = await db
      .select({ offeringId: offering_professors.offeringId })
      .from(offering_professors)
      .where(and(
        eq(offering_professors.staffId, me.id),
        inArray(offering_professors.offeringId, weeklyOfferingIds),
      ));
    for (const s of sharedAll) myShared.add(s.offeringId);
  }
  const isMySlot = (w: { professorId: number | null; offeringId: number }) =>
    w.professorId === me.id || myShared.has(w.offeringId);

  // کلیدِ اتصالِ اسلاتِ هفتگی به جلسهٔ امروز: همان درس + همان ساعتِ شروع
  const todayBySlot = new Map<string, (typeof withRecord)[number]>();
  for (const m of withRecord) todayBySlot.set(`${m.offeringId}|${m.startTime}`, m);

  const DAY_NAMES = ['شنبه', 'یک‌شنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنج‌شنبه', 'جمعه'];
  const byDay = new Map<number, typeof weekly>();
  for (const w of weekly) {
    const list = byDay.get(w.dayOfWeek) ?? [];
    list.push(w);
    byDay.set(w.dayOfWeek, list);
  }
  // ترتیبِ هفته از شنبه؛ روزِ امروز هم اگر خالی بود نشان داده می‌شود تا معلوم باشد.
  const weekDays = [0, 1, 2, 3, 4, 5, 6].filter(d => byDay.has(d) || d === todayDow);

  const weeklyCard = (
    <Card>
      <details open>
        <summary className="cursor-pointer list-none flex items-center justify-between gap-2">
          <span className="text-sm font-black text-slate-900">برنامهٔ هفتگی این اتاق</span>
          <span className="text-3xs font-bold text-slate-500">
            {faDigits(weekly.length)} سانس در هفته
          </span>
        </summary>

        {weekly.length === 0 ? (
          <div className="mt-3 space-y-2">
            <Notice kind="info" text="برای این اتاق در ترم جاری برنامه‌ای ثبت نشده است." />
            {twinRooms.length > 0 ? (
              <div className="space-y-1.5">
                <div className="text-3xs font-black text-slate-700">
                  این نام برای چند اتاق ثبت شده؛ این اتاق‌های هم‌نام برنامه دارند:
                </div>
                {twinRooms.map(t => (
                  <Link
                    key={t.id}
                    href={`/p/room-${t.id}`}
                    className="flex items-center justify-between rounded-2xl border border-indigo-200 bg-indigo-50 px-3 py-2"
                  >
                    <span className="text-2xs font-black text-indigo-900">
                      اتاق {faDigits(room.name)} — رکورد #{faDigits(t.id)}
                    </span>
                    <span className="text-3xs font-bold text-indigo-700">{faDigits(t.slots)} سانس ←</span>
                  </Link>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="mt-3 space-y-4">
            {weekDays.map(d => {
              const slots = byDay.get(d) ?? [];
              const isToday = d === todayDow;
              return (
                <div key={d}>
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className={`text-2xs font-black ${isToday ? 'text-indigo-800' : 'text-slate-700'}`}>
                      {DAY_NAMES[d]}
                    </span>
                    {isToday ? (
                      <span className="text-[9px] font-black bg-indigo-100 text-indigo-800 rounded-full px-2 py-0.5">
                        امروز
                      </span>
                    ) : null}
                    <span className="flex-1 h-px bg-slate-100" />
                  </div>

                  {slots.length === 0 ? (
                    <div className="text-3xs font-bold text-slate-400 py-1">کلاسی نیست</div>
                  ) : (
                    <div className="space-y-1.5">
                      {slots.map(s => {
                        const mine = isMySlot(s);
                        const slotKey = `${s.offeringId}|${s.startTime}`;
                        const recMine = isToday ? todayBySlot.get(slotKey) : undefined;
                        const recAny = isToday ? anyBySlot.get(slotKey) : undefined;
                        const state = isToday ? checkinState(s.startTime, s.endTime, now.minutes) : null;
                        // چه کسی می‌تواند این سانس را ثبت کند؟ خودِ استاد (اگر تنظیم اجازه دهد)
                        // یا کنترل‌کنندهٔ مجازِ اتاق. اگر هیچ‌کدام، فقط برچسبِ وضعیت می‌آید.
                        const canRecord = (policy.professorAllowed && mine) || ctrlCan;
                        const recorded = mine ? !!recMine?.recorded : recAny?.recordedAt != null;
                        const recordSessionId = recAny?.sessionId ?? recMine?.id ?? 0;
                        return (
                          <div
                            key={s.scheduleId}
                            className={`rounded-2xl border px-3 py-2 flex items-center gap-2 ${
                              isToday && mine
                                ? 'border-indigo-300 bg-indigo-50/60'
                                : mine
                                  ? 'border-slate-200 bg-slate-50'
                                  : 'border-slate-200 bg-white'
                            }`}
                          >
                            <div className="text-3xs font-bold text-slate-500 w-12 shrink-0 leading-4" dir="ltr">
                              {faDigits(s.startTime)}
                              <br />
                              {faDigits(s.endTime)}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="text-2xs font-black text-slate-800 truncate">{s.courseTitle}</div>
                              <div className="text-3xs font-bold text-slate-500 truncate">
                                {s.professorName} · گروه {faDigits(s.groupNumber)}
                              </div>
                            </div>

                            {isToday && canRecord ? (
                              recorded ? (
                                <span className="text-[9px] font-black text-emerald-800 bg-emerald-100 border border-emerald-200 rounded-lg px-2 py-1 shrink-0">
                                  ثبت شد
                                </span>
                              ) : recordSessionId > 0 && state === 'OPEN' ? (
                                <form action={recordRoomAttendance} className="shrink-0">
                                  <input type="hidden" name="code" value={`room-${roomId}`} />
                                  <input type="hidden" name="sessionId" value={recordSessionId} />
                                  <button
                                    type="submit"
                                    className="text-[9px] font-black text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg px-2.5 py-1.5 shadow-sm"
                                  >
                                    ثبت حضور
                                  </button>
                                </form>
                              ) : state === 'BEFORE' ? (
                                <span className="text-[9px] font-bold text-slate-400 shrink-0">هنوز باز نشده</span>
                              ) : state === 'CLOSED' ? (
                                <span className="text-[9px] font-bold text-slate-400 shrink-0">گذشته</span>
                              ) : (
                                /* اسلاتِ امروز هست ولی جلسه‌ای در class_sessions ساخته نشده —
                                   دکمه نشان نمی‌دهیم تا خطای «جلسه یافت نشد» نگیرد. */
                                <span className="text-[9px] font-bold text-amber-700 shrink-0">جلسه ثبت نشده</span>
                              )
                            ) : mine ? (
                              <span className="text-[9px] font-bold text-slate-400 shrink-0">در روز جلسه</span>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </details>
    </Card>
  );

  return (
    <Shell>
      <Card>
        {header}

        {msg ? <Notice kind="ok" text={msg} /> : null}
        {err ? <Notice kind="err" text={err} /> : null}

        {!focus ? (
          <>
            {!ctrlCan ? (
              <Notice kind="info" text="امروز برای شما در این اتاق کلاسی ثبت نشده است." />
            ) : null}
            {upcoming.length > 0 ? (
              <div className="space-y-2">
                <div className="text-2xs font-black text-slate-700">جلسات بعدی شما در این اتاق</div>
                {upcoming.map(u => (
                  <div key={u.id} className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2">
                    <div className="text-xs font-black text-slate-800">{u.courseTitle}</div>
                    <div className="text-3xs font-bold text-slate-500 mt-0.5" dir="ltr">
                      {faDigits(u.courseCode)} · {faDigits(u.sessionDate)} · {timeLabel(u.startTime, u.endTime)}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </>
        ) : (
          <>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-1">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-sm font-black text-slate-900 truncate">{focus.courseTitle}</span>
                {focusGroup?.merged ? (
                  <span
                    title={`این کلاس از ${focusGroup.members.length} عرضه تشکیل شده: ${focusMemberTitles}`}
                    className="shrink-0 text-[9px] font-black rounded-full px-1.5 py-0.5 bg-violet-100 text-violet-800 border border-violet-200"
                  >
                    🔗 {mergeBadgeText(focusGroup.members.length)}
                  </span>
                ) : null}
              </div>
              <div className="text-2xs font-bold text-slate-500" dir="ltr">
                {faDigits(focus.courseCode)} · گروه {faDigits(focus.groupNumber)}
              </div>
              <div className="text-2xs font-bold text-slate-600">
                {timeLabel(focus.startTime, focus.endTime)}
              </div>
              {focusGroup?.merged && focusMemberTitles ? (
                <div className="text-3xs font-bold text-violet-700/80" title={focusMemberTitles}>
                  کلاس ادغامی: {focusMemberTitles}
                </div>
              ) : null}
            </div>

            {focus.recorded ? (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-center space-y-1">
                <div className="text-2xl">✅</div>
                <div className="text-xs font-black text-emerald-800">حضور شما ثبت شده است</div>
                {focus.recorded.recordedAt ? (
                  <div className="text-3xs font-bold text-emerald-700">
                    زمان ثبت: {faDigits(new Date(focus.recorded.recordedAt).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' }))}
                  </div>
                ) : null}
              </div>
            ) : focus.state === 'OPEN' && policy.professorAllowed ? (
              <form action={recordRoomAttendance} className="space-y-2">
                <input type="hidden" name="code" value={`room-${roomId}`} />
                <input type="hidden" name="sessionId" value={focus.id} />
                <button
                  type="submit"
                  className="w-full py-4 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-sm shadow-md transition"
                >
                  ثبت حضور من
                </button>
                {focus.window ? (
                  <div className="text-3xs font-bold text-slate-500 text-center">
                    بازهٔ مجاز ثبت: {faDigits(focus.window.from)} تا {faDigits(focus.window.to)}
                  </div>
                ) : null}
              </form>
            ) : focus.state === 'OPEN' ? (
              /* حالتِ «فقط کنترل‌کننده»: استاد نباید دکمهٔ ثبت ببیند. */
              <Notice kind="info" text={ERR.profblocked} />
            ) : focus.state === 'BEFORE' ? (
              <Notice
                kind="info"
                text={focus.window
                  ? `پنجرهٔ ثبت حضور از ساعت ${faDigits(focus.window.from)} باز می‌شود.`
                  : 'پنجرهٔ ثبت حضور هنوز باز نشده است.'}
              />
            ) : (
              <Notice kind="err" text="زمان مجاز ثبت حضور این جلسه گذشته است. در صورت نیاز با ادارهٔ آموزش تماس بگیرید." />
            )}
          </>
        )}

        <div className="text-3xs font-bold text-slate-400 text-center pt-2 border-t border-slate-100">
          {faDigits(now.jalali)} · این صفحه فقط برای ثبت حضورِ کلاس است
          {ctrlCan ? ' (شما به‌عنوان کنترل‌کنندهٔ حضور این اتاق شناخته شدید).' : ' (استاد یا کنترل‌کنندهٔ حضور).'}
        </div>
      </Card>

      {ctrlCard}
      {weeklyCard}
    </Shell>
  );
}
