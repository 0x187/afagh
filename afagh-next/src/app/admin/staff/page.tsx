import Link from 'next/link';
import { randomBytes } from 'node:crypto';
import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import { departments, roles, staff, user_roles, users } from '@/db/schema';
import { getSessionUser, hashPassword, requireRole } from '@/lib/auth';
import { clearPermissionCache } from '@/lib/permissions-enforcer';
import StaffTable from './StaffTable';

export const dynamic = 'force-dynamic';

async function toggleHeadAction(fd: FormData) {
  'use server';
  await requireRole(['ADMIN']);
  const userId = Number(fd.get('userId'));
  const assign = fd.get('assign') === '1';
  const { getCurrentUniversity } = await import('@/lib/university-scope');
  const uni = await getCurrentUniversity().catch(() => null);
  const [head] = await db.select().from(roles).where(eq(roles.code, 'DEP_HEAD')).limit(1);
  if (!head) return;
  // کاربر باید متعلق به همین دانشگاه (یا سراسری) باشد
  if (uni) {
    const [u] = await db.select({ universityId: users.universityId }).from(users).where(eq(users.id, userId)).limit(1);
    if (!u) return;
    if (u.universityId !== null && u.universityId !== uni.id) return;
  }
  if (assign) {
    const has = await db.select().from(user_roles).where(eq(user_roles.userId, userId));
    if (!has.some(h => h.roleId === head.id)) await db.insert(user_roles).values({ userId, roleId: head.id });
  } else {
    // ⚠️ اینجا حتماً باید هر دو شرط باشد. نسخهٔ قبلی فقط `userId` را شرط
    //    می‌گذاشت و با یک کلیک «گرفتن نقش»، *همهٔ* نقش‌های آن شخص — از جمله
    //    «استاد» — پاک می‌شد و کاربر از سامانه بیرون می‌افتاد.
    await db.delete(user_roles).where(and(eq(user_roles.userId, userId), eq(user_roles.roleId, head.id)));
    // گروه‌هایی که این شخص مدیرشان بود بی‌مدیر می‌مانند، وگرنه نقش دوباره
    // برمی‌گردد و وضعیت ناسازگار می‌شود.
    const [st] = await db.select({ id: staff.id }).from(staff).where(eq(staff.userId, userId)).limit(1);
    if (st) await db.update(departments).set({ headStaffId: null }).where(eq(departments.headStaffId, st.id));
  }
  clearPermissionCache();
  revalidatePath('/admin/staff');
  revalidatePath('/admin/departments');
}

/** تنظیم نقش‌های یک کاربر (کارشناس/استاد) — فقط ADMIN؛ پنل → استاد و کارکنان → «نقش‌ها» */
async function saveUserRolesAction(userId: number, roleIds: number[]): Promise<{ ok: boolean; error?: string; added?: number; removed?: number }> {
  'use server';
  try {
    await requireRole(['ADMIN']);
  } catch {
    return { ok: false, error: 'فقط مدیر سیستم (ADMIN) می‌تواند نقش‌ها را تغییر دهد.' };
  }
  if (!userId || !Number.isInteger(userId)) return { ok: false, error: 'کاربر نامعتبر است.' };
  const me = await getSessionUser();
  const want = new Set(roleIds.map(Number).filter(Number.isInteger));
  const have = new Set((await db.select({ roleId: user_roles.roleId }).from(user_roles).where(eq(user_roles.userId, userId))).map(x => x.roleId));
  // 🔒 گارد قفل‌شدن: مدیر ارشد نباید نقش ADMIN خودش را بردارد
  if (want.size < have.size) {
    const [adm] = await db.select({ id: roles.id }).from(roles).where(eq(roles.code, 'ADMIN')).limit(1);
    if (adm && me?.id === userId && have.has(adm.id) && !want.has(adm.id)) {
      return { ok: false, error: 'نقش «مدیر ارشد» را نمی‌توان از خودتان برداشت (خطر قفل‌شدن سامانه).' };
    }
  }
  let added = 0;
  let removed = 0;
  for (const rid of [...want]) {
    if (!have.has(rid)) {
      await db.insert(user_roles).values({ userId, roleId: rid }).onConflictDoNothing().catch(() => {});
      added++;
    }
  }
  for (const rid of [...have]) {
    if (!want.has(rid)) {
      await db.delete(user_roles).where(and(eq(user_roles.userId, userId), eq(user_roles.roleId, rid)));
      removed++;
    }
  }
  clearPermissionCache();
  revalidatePath('/admin/staff');
  return { ok: true, added, removed };
}

/**
 * فعال/غیرفعال کردن پروندهٔ پرسنلی — فقط روی جدول staff، نه حساب کاربر.
 *
 * چرا جدا از users.isActive: پروندهٔ استاد ممکن است سال‌ها نگه داشته شود (برای
 * سوابق تدریس، امضای اسناد، گزارش‌ها) اما نباید در فهرست‌ها و انتخاب استاد جلو بیاید.
 * با خاموش‌کردن پرونده، استاد از «انتخاب استاد» و گزارش‌های عملیاتی حذف می‌شود،
 * ولی سابقهٔ ترم‌های گذشته دست‌نخورده می‌ماند.
 */
async function toggleStaffActiveAction(fd: FormData) {
  'use server';
  await requireRole(['ADMIN']);
  const staffId = Number(fd.get('staffId'));
  const next = Number(fd.get('next')) === 1 ? 1 : 0;
  if (!Number.isInteger(staffId) || staffId <= 0) return;

  const { getCurrentUniversity } = await import('@/lib/university-scope');
  const uni = await getCurrentUniversity().catch(() => null);
  const [row] = await db.select({ id: staff.id, userId: staff.userId }).from(staff)
    .where(eq(staff.id, staffId)).limit(1);
  if (!row) return;
  // فقط مدیرِ همان دانشگاه اجازه دارد (پرونده‌های سراسری = بدون دانشگاه)
  if (uni) {
    const [s] = await db.select({ universityId: staff.universityId }).from(staff).where(eq(staff.id, staffId)).limit(1);
    if (s && s.universityId !== null && s.universityId !== uni.id) return;
  }

  await db.update(staff).set({ isActive: next }).where(eq(staff.id, staffId));

  // اگر دارد گروه‌ای را مدیریت می‌کند، خاموش‌کردنش مدیر گروه را بی‌مدیر می‌گذارد؛
  // هشدار را لاگ می‌کنیم تا مدیر بداند و جایگزین بگذارد.
  if (next === 0) {
    const led = await db.select({ id: departments.id }).from(departments).where(eq(departments.headStaffId, staffId));
    if (led.length) {
      console.warn(`[admin/staff] پروندهٔ ${staffId} خاموش شد ولی ${led.length} گروه را اداره می‌کند — مدیر گروه باید جایگزین شود.`);
    }
  }
  revalidatePath('/admin/staff');
}

/** فعال/غیرفعال گروهی: خاموش‌کردن چند استاد بر پایهٔ گروه (کم‌کردن حجم داده) */
async function bulkSetStaffActiveAction(fd: FormData) {
  'use server';
  await requireRole(['ADMIN']);
  const ids = String(fd.get('staffIds') || '').split(',').map(Number).filter(n => Number.isInteger(n) && n > 0);
  const next = Number(fd.get('next')) === 1 ? 1 : 0;
  if (!ids.length) return;
  // سقف ۵۰۰ تایکه تا یک درخواست، دیتابیس را قفل نکند
  await db.update(staff).set({ isActive: next }).where(inArray(staff.id, ids.slice(0, 500)));
  revalidatePath('/admin/staff');
}

/** ثبت حساب کاربری جدید «کارشناس/کارمند» (نه استاد و نه دانشجو) — فقط ADMIN */
async function createStaffExpertAction(input: {
  nationalCode: string; firstName: string; lastName: string;
  fatherName?: string; birthCertNo?: string; gender?: string; mobile?: string;
  email?: string; staffCode?: string; departmentId?: number | null; staffType?: string;
}): Promise<{ ok: boolean; error?: string; userId?: number; password?: string }> {
  'use server';
  try {
    await requireRole(['ADMIN']);
  } catch {
    return { ok: false, error: 'فقط مدیر سیستم (ADMIN) می‌تواند حساب ایجاد کند.' };
  }
  const nc = String(input.nationalCode || '').trim();
  const fn = String(input.firstName || '').trim();
  const ln = String(input.lastName || '').trim();
  const sc = String(input.staffCode || '').trim() || nc;
  if (!nc || !fn || !ln) return { ok: false, error: 'کد ملی، نام و نام خانوادگی الزامی است.' };
  if (!/^\d{10}$/.test(nc)) return { ok: false, error: 'کد ملی باید ۱۰ رقم باشد.' };
  try {
    const { getCurrentUniversity } = await import('@/lib/university-scope');
    const uni = await getCurrentUniversity().catch(() => null);
    const dupNc = uni
      ? await db.select({ id: users.id }).from(users).where(and(eq(users.nationalCode, nc), eq(users.universityId, uni.id))).limit(1)
      : await db.select({ id: users.id }).from(users).where(eq(users.nationalCode, nc)).limit(1);
    if (dupNc.length) return { ok: false, error: 'کاربری با این کد ملی از قبل وجود دارد.' };
    const dupSc = uni
      ? await db.select({ id: staff.id }).from(staff).where(and(eq(staff.staffCode, sc), eq(staff.universityId, uni.id))).limit(1)
      : await db.select({ id: staff.id }).from(staff).where(eq(staff.staffCode, sc)).limit(1);
    if (dupSc.length) return { ok: false, error: 'کد پرسنلی تکراری است.' };
    // 🔐 رمز یکبارمصرف تصادفی — دیگر رمز اولیه از کد ملی ساخته نمی‌شود (کد ملی قابل‌حدس است)
    const tempPassword = randomBytes(12).toString('base64url').slice(0, 16);
    const passwordHash = await hashPassword(tempPassword);
    const [u] = await db.insert(users).values({
      nationalCode: nc, firstName: fn, lastName: ln,
      fatherName: String(input.fatherName || '').trim() || null,
      birthCertNo: String(input.birthCertNo || '').trim() || null,
      gender: String(input.gender || '').trim() || null,
      mobile: String(input.mobile || '').trim() || null,
      email: String(input.email || '').trim() || null,
      passwordHash, isActive: 1, mustChangePassword: 1,
      universityId: uni?.id ?? null,
    }).returning({ id: users.id });
    await db.insert(staff).values({
      userId: u.id, staffCode: sc,
      staffType: String(input.staffType || '').trim() || 'اداری',
      departmentId: input.departmentId || null,
      universityId: uni?.id ?? null,
    }).onConflictDoNothing();
    const stType = String(input.staffType || '').trim();
    if (stType.includes('هیئت') || stType.includes('مربی') || stType.includes('استاد')) {
      const [prof] = await db.select({ id: roles.id }).from(roles).where(eq(roles.code, 'PROFESSOR')).limit(1);
      if (prof) {
        await db.insert(user_roles).values({ userId: u.id, roleId: prof.id }).onConflictDoNothing();
        clearPermissionCache();
      }
    }
    revalidatePath('/admin/staff');
    // ⚠️ رمز یکبارمصرف فقط همین یک‌بار بازگردانده می‌شود؛ در دیتابیس فقط هش ذخیره می‌شود
    return { ok: true, userId: u.id, password: tempPassword };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : 'ثبت نشد.' };
  }
}

export default async function StaffPage() {
  await requireRole(['ADMIN']);
  const { getCurrentUniversity } = await import('@/lib/university-scope');

  // ── فاز ۱: این سه به هم وابسته نیستند ──
  // قبلاً پشتِ سرِ هم اجرا می‌شدند و تأخیرشان جمع می‌شد (۷ رفت‌وبرگشتِ سریالی
  // در کلِ صفحه). فقط `urRows` واقعاً به `rows` وابسته است.
  const [uni, headRow, roleRows] = await Promise.all([
    getCurrentUniversity().catch(() => null),
    db.select().from(roles).where(eq(roles.code, 'DEP_HEAD')).limit(1),
    db.select({ id: roles.id, code: roles.code, title: roles.title, isSystem: roles.isSystem }).from(roles).orderBy(roles.id),
  ]);
  const [head] = headRow;
  const uw = uni ? eq(staff.universityId, uni.id) : undefined;

  // ── فاز ۲: هر سه فقط به `uni` نیاز دارند ──
  const [rows, headRoles, led, depts] = await Promise.all([
    db
      .select({ staffId: staff.id, userId: users.id, code: users.nationalCode, name: users.firstName, family: users.lastName, staffCode: staff.staffCode, dept: departments.name, rank: staff.academicRank, type: staff.staffType, active: staff.isActive, userActive: users.isActive })
      .from(staff)
      .innerJoin(users, eq(users.id, staff.userId))
      .leftJoin(departments, eq(departments.id, staff.departmentId))
      .where(uw)
      .orderBy(staff.id),
    head ? db.select().from(user_roles).where(eq(user_roles.roleId, head.id)) : Promise.resolve<{ userId: number }[]>([]),
    db
      .select({ userId: staff.userId, deptName: departments.name })
      .from(departments)
      .innerJoin(staff, eq(staff.id, departments.headStaffId))
      .where(uni ? or(eq(departments.universityId, uni.id), isNull(departments.universityId)) : undefined),
    db.select({ id: departments.id, name: departments.name }).from(departments).where(uni ? eq(departments.universityId, uni.id) : undefined).orderBy(departments.name),
  ]);

  const heads = new Set(headRoles.map(h => h.userId));

  // کدام گروه‌ها را هر نفر اداره می‌کند (یک نفر می‌تواند مدیر چند گروه باشد،
  // مثلاً گروه تخصصی خودش + گروه دروس عمومی)
  const ledBy = new Map<number, string[]>();
  for (const l of led) {
    if (l.userId == null) continue;
    ledBy.set(l.userId, [...(ledBy.get(l.userId) ?? []), l.deptName]);
  }

  // ── فاز ۳: نقشِ فعلی کارکنان (وابسته به `rows`) ──
  const userIds = rows.map(r => r.userId).filter(Number.isInteger);
  const urRows = userIds.length ? await db.select().from(user_roles).where(inArray(user_roles.userId, userIds)) : [];
  const userRoleIds: Record<number, number[]> = {};
  for (const r of rows) userRoleIds[r.userId] = [];
  for (const ur of urRows) (userRoleIds[ur.userId] ??= []).push(ur.roleId);

  return (
    <div className="card">
      <h2 className="mb-1 font-bold">استاد و کارکنان</h2>
      <p className="mb-2 text-xs leading-6 text-slate-500">
        مدیر گروه به پنل مدیر گروه می‌رسد و دروس و ارائه‌های گروه‌های زیر نظر خودش را مدیریت می‌کند. اگر استاد باشد،
        هر دو کارتابل برایش یکی می‌شود و از سربرگ بین‌شان جابه‌جا می‌شود.
      </p>
      <p className="mb-3 rounded-lg bg-indigo-50 p-2.5 text-xs leading-6 text-indigo-900">
        💡 برای <b>تعریف گروه آموزشی</b> و <b>انتخاب مدیر برای هر گروه</b> (از جمله گروه دروس عمومی و مشترک) به{' '}
        <Link href="/admin/departments" className="font-bold underline">گروه‌های آموزشی و مدیران گروه</Link> بروید.
        کلید زیر فقط نقش را دستی می‌دهد یا می‌گیرد. برای تعریف نقش (کد/عنوان/مجوزها) به{' '}
        <Link href="/admin/permissions" className="font-bold underline">مدیریت سطوح دسترسی و نقش‌ها</Link> بروید.
      </p>
      <StaffTable
        rows={rows}
        headUserIds={[...heads]}
        ledBy={Object.fromEntries(ledBy)}
        toggleAction={toggleHeadAction}
        toggleActiveAction={toggleStaffActiveAction}
        bulkActiveAction={bulkSetStaffActiveAction}
        rolesAll={roleRows}
        userRoleIds={userRoleIds}
        saveRolesAction={saveUserRolesAction}
        createAction={createStaffExpertAction}
        departments={depts}
      />
    </div>
  );
}
