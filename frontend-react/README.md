# فرانت React آفاق (frontend-react)

بازنویسی فرانت سامانهٔ جامع آفاق به‌صورت SPA — فاز ۰ (زیرساخت + سیستم دیزاین).

- Vite + React 19 + TypeScript
- Tailwind CSS v4 + کامپوننت‌های سبک shadcn/ui (توکن‌های معنایی — هیچ Tailwind خام در صفحات)
- RTL + فونت وزیرمتن (سلف‌هاست) + دارک‌مود با همان کلید `theme` سامانهٔ فعلی
- react-router v7 با `basename=/app`، TanStack Query برای وضعیت سرور
- PWA: manifest + service worker محافظه‌کار (پورت sw.js فعلی)

## سیستم دیزاین

تک‌منبع حقیقت توکن‌ها: `src/index.css` (پالت slate + indigo برگرفته از globals.css فعلی، به‌صورت
توکن‌های معنایی background/card/primary/muted/…). کامپوننت‌های پایه در `src/components/ui/`:
Button، Card، Input، Label، Badge، Skeleton — همهٔ صفحات فقط با این‌ها ساخته می‌شوند.

## اجرا

نصب/بیلد داخل کانتینر node:22 انجام می‌شود (بدون نصب Node روی میزبان):

```bash
# نصب (یک‌بار):
docker run --rm --user $(id -u):$(id -g) -e HOME=/tmp \
  -v "$PWD":/w -v afagh_npm_cache:/tmp/.npm -e npm_config_cache=/tmp/.npm \
  -w /w node:22-bookworm-slim npm install --no-audit --no-fund

# dev (پروکسی /api/v2 به سرویس Go روی 8090):
docker run --rm --user $(id -u):$(id -g) -e HOME=/tmp -p 5173:5173 \
  -v "$PWD":/w -v afagh_npm_cache:/tmp/.npm -e npm_config_cache=/tmp/.npm \
  -w /w node:22-bookworm-slim npm run dev

# typecheck + build:
docker run --rm --user $(id -u):$(id -g) -e HOME=/tmp \
  -v "$PWD":/w -v afagh_npm_cache:/tmp/.npm -e npm_config_cache=/tmp/.npm \
  -w /w node:22-bookworm-slim npm run build
```

سرویس Go در dev با `AFAGH_SPA_UPSTREAM=http://127.0.0.1:5173` یا با `AFAGH_SPA_DIST=dist` (بیلد‌شده) SPA را زیر `/app` سرو می‌کند.
