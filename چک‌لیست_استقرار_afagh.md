# چک‌لیست قبل از استقرار (Deployment Checklist) — پروژه afagh

## قبل از git push

- [ ] `git status` تمیز است (هیچ تغییر uncommitted نیست)
- [ ] تغییرات روی شاخه موقت (feature branch) تست شده‌اند، نه مستقیماً روی `FINAL`
- [ ] دیتابیس قبل از هر استقرار بکاپ گرفته شده است (`pg_dump -Fc`)
- [ ] migration دیتابیس فقط additive است (Add Column)، نه حذف یا تغییر جدولی که دادهٔ قبلی داشته باشد
- [ ] تغییرات در کد روی دیتابیس تست اجرا شده‌اند (در محیط dev)

## استقرار روی سرور (debian / Tailscale)

- [ ] به سرور وصل شوید: `ssh root@100.70.187.120`
- [ ] کد را بگیرید و به آخرین FINAL بازگردانید:
  ```bash
  cd /root/afagh/afagh-next
  git fetch origin FINAL
  git reset --hard origin/FINAL
  ```
- [ ] 이미지와 migration را بسازید:
  ```bash
  cd /root/afagh
  docker compose up -d --build app
  ```
- [ ] اگر migration با خطا روبرو شد → استقرار را متوقف کنید و دیتابیس را از بکاپ قبلی بازگردانید
- [ ] فقط سرویس اپ را ری‌استارت کنید (اگر migration موفقیت‌آمیز بود):
  ```bash
  docker compose up -d --no-deps --force-recreate app
  ```
- [ ] کانتینر app healthy است:
  ```bash
  docker inspect afagh_app --format '{{.State.Health.Status}}'
  ```
- [ ] سرور پاسخ می‌دهد:
  ```bash
  curl -s -o /dev/null -w '%{http_code}' http://localhost:8080/
  ```

##rollback در صورت مشکل

- [ ] دیتابیس را از بکاپ قبلی بازگردانید:
  ```bash
  pg_restore -U <user> -d <db> -1 /root/backups/pre-*.dump
  ```
- [ ] کد را به کامیت قبلی برگردانید:
  ```bash
  git reset --hard <commit قبلی>
  docker compose up -d --build app
  docker compose up -d --no-deps --force-recreate app
  ```

## بعد از استقرار موفق

- [ ] لاگ‌های app را بررسی کنید (خطای بحرانی نباشد)
- [ ] migration با موفقیت تمام شده باشد (`docker logs afagh_migrator --tail 5`)
- [ ] دیتابیس ستون‌های جدید را داشته باشد (مثلاً `admissionSource` در `students`)

## نکات فنی

- رمزهای حساس (رمز دیتابیس، کلید BBB، رمز کوکی) را در `.env.prod` در سرور نگه دارید
- قبل از هر استقرار، `.env.prod` را بکاپ بگیرید
- کش Docker (build cache) می‌تواند فضای زیادی اشغال کند: `docker builder prune -af`

---

تاریخ ایجاد: ۱۴۰۵/۰۸/۱۰
نویسنده: OpenCode