import { CheckCircle2, ExternalLink, XCircle, TriangleAlert } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { apiGet, type HealthResponse, type SessionUser } from '@/lib/api';
import { faDigits } from '@/lib/fa';
import { useSession } from '@/lib/session';

// ═══ خانهٔ فاز ۰ — اثبات اتصال سالم هر دو سمت ═══
// معیار پایان فاز ۰: این صفحه با سشن مشترک (لاگین از UI قدیم) نام کاربر و
// نقش‌ها را از بکند Go نشان می‌دهد و سلامت زیرساخت را گزارش می‌کند.
// در فاز ۱ این صفحه جای داشبورد واقعی هر نقش را می‌گیرد.

function CheckBadge({ label, status }: { label: string; status: string }) {
  if (status === 'ok') {
    return (
      <Badge variant="success" className="gap-1">
        <CheckCircle2 aria-hidden /> {label}
      </Badge>
    );
  }
  if (status === 'down') {
    return (
      <Badge variant="destructive" className="gap-1">
        <XCircle aria-hidden /> {label}
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="gap-1">
      {label} — پیکربندی نشده
    </Badge>
  );
}

function HealthCard() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['health'],
    queryFn: () => apiGet<HealthResponse>('/health'),
    refetchInterval: 30_000,
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          سلامت سرویس جدید
          {data ? (
            <Badge variant={data.ok ? 'success' : 'destructive'}>
              {data.ok ? 'سالم' : 'ناسالم'}
            </Badge>
          ) : null}
        </CardTitle>
        <CardDescription>
          بررسی سه زیرساخت از <code dir="ltr" className="text-xs">/api/v2/health</code> — هر ۳۰ ثانیه تازه می‌شود
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        {isLoading ? (
          <>
            <Skeleton className="h-6 w-24" />
            <Skeleton className="h-6 w-24" />
            <Skeleton className="h-6 w-24" />
          </>
        ) : isError || !data ? (
          <CheckBadge label="سرویس" status="down" />
        ) : (
          <>
            <CheckBadge label="دیتابیس" status={data.checks.db} />
            <CheckBadge label="Redis" status={data.checks.redis} />
            <CheckBadge label="MinIO" status={data.checks.minio} />
            <Badge variant="outline" className="gap-1 font-mono">
              نسخه: {data.version}
            </Badge>
          </>
        )}
      </CardContent>
    </Card>
  );
}

const ROLE_TITLES: Record<string, string> = {
  ADMIN: 'مدیر سامانه',
  STUDENT: 'دانشجو',
  PROFESSOR: 'استاد',
  DEP_HEAD: 'مدیر گروه',
  EDU_EXPERT: 'کارشناس آموزش',
  VICE_EDU: 'معاون آموزشی',
  FINANCE_EXPERT: 'کارشناس مالی',
  PROCTOR: 'مراقب امتحان',
};

export function Home() {
  const { data, isLoading } = useSession();
  const user: SessionUser | null = data?.user ?? null;

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>نشست جاری — از بکند Go با همان کوکی سامانهٔ فعلی</CardTitle>
          <CardDescription>
            اگر از سامانهٔ فعلی (Next.js) وارد شده باشید، همین‌جا بدون ورود مجدد شناخته می‌شوید.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-6 w-32" />
            </div>
          ) : user ? (
            <div className="flex flex-col gap-3">
              <div className="text-lg font-bold">{user.name}</div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-muted-foreground">نقش‌ها:</span>
                {user.roles.map((r) => (
                  <Badge key={r} variant="accent">
                    {ROLE_TITLES[r] ?? r}
                  </Badge>
                ))}
              </div>
              <div className="text-sm text-muted-foreground">
                شناسهٔ کاربر: {faDigits(user.id)}
                {user.universityId ? ` — دانشگاه: ${faDigits(user.universityId)}` : ''}
              </div>
            </div>
          ) : data?.pendingPasswordChange ? (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2 text-warning">
                <TriangleAlert aria-hidden />
                <span className="font-medium">رمز پیش‌فرض حساب باید عوض شود.</span>
              </div>
              <a href="/change-password" className="text-primary underline-offset-4 hover:underline text-sm">
                رفتن به صفحهٔ تغییر رمز (سامانهٔ فعلی)
              </a>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <span className="text-sm text-muted-foreground">وارد سامانه نشده‌اید.</span>
              <a href="/login" className="text-primary underline-offset-4 hover:underline text-sm">
                ورود به سامانه (صفحهٔ فعلی — تا فاز ۱)
              </a>
            </div>
          )}
        </CardContent>
      </Card>

      <HealthCard />

      <Card>
        <CardHeader>
          <CardTitle>حالت انتقال (Strangler)</CardTitle>
          <CardDescription>
            این صفحه زیر پیشوند <code dir="ltr" className="text-xs">/app</code> از سرویس Go سرو می‌شود؛
            بقیهٔ مسیرها هنوز از Next.js می‌آیند. با پیشرفت فازها، مسیرها یکی‌یکی به این UI منتقل می‌شوند.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <a
            href="/"
            className="inline-flex items-center gap-1 text-sm text-primary underline-offset-4 hover:underline"
          >
            <ExternalLink className="size-4" aria-hidden />
            رفتن به رابط کاربری فعلی
          </a>
        </CardContent>
      </Card>
    </div>
  );
}
