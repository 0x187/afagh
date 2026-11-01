/**
 * گزارش خطای سمت کلاینت به لاگ سرور.
 *
 * چرا: خطاهای رندر کلاینت (مثل TDZ یا خطای کامپوننت) در مرورگر می‌مانند و در
 * `docker logs` دیده نمی‌شوند؛ بدون این مسیر، تنها راه عیب‌یابی، اسکرین‌شاتِ
 * کاربر است که استک ندارد. این مسیر فقط پیام و استک را لاگ می‌کند.
 *
 * امنیت: بدون احراز هویت است (خطا ممکن است قبل از ورود رخ دهد) و هیچ دادهٔ
 * شخصی نمی‌پذیرد؛ طول فیلدها بریده می‌شود تا لاگ با spam پر نشود.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX = 4000;

function clip(v: unknown): string {
  const s = typeof v === 'string' ? v : v == null ? '' : String(v);
  return s.length > MAX ? `${s.slice(0, MAX)}…` : s;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { message?: unknown; stack?: unknown; url?: unknown; where?: unknown };
    console.error(
      JSON.stringify({
        level: 'error',
        app: 'afagh',
        msg: 'client_error',
        mod: 'client-error',
        where: clip(body.where),
        url: clip(body.url),
        message: clip(body.message),
        stack: clip(body.stack),
      }),
    );
  } catch {
    // بدنهٔ نامعتبر — بی‌اهمیت
  }
  return new Response(null, { status: 204 });
}
