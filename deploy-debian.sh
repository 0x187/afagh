#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════
#  استقرار سامانه جامع آفاق روی Debian 13 (Trixie) — تماماً با Docker
#      • نصب Docker Engine + Compose plugin از مخزن رسمی داکر
#      • ساخت ایمیج Next.js و اجرای آن روی پورت ۸۰۸۰
#      • PostgreSQL + Redis + MinIO داخل کانتینر (فقط روی 127.0.0.1)
#      • ساخت جدول‌ها، ایندکس‌ها و RLS به‌صورت خودکار (سرویس migrator)
#
#  اجرا:   sudo ./deploy-debian.sh [سوییچ‌ها]
#
#  سوییچ‌ها:
#      --port N          پورت لیسن روی هاست (پیش‌فرض ۸۰۸۰)
#      --base-url URL    نشانی عمومی سامانه (مبنای QR و لینک‌های استعلام)
#      --fresh           حذف کانتینرها و کل دادهٔ قبلی و استقرار از صفر
#      --no-build        بدون ساخت مجدد ایمیج‌ها
#      --update          گرفتن آخرین تغییرات گیت، بیلد مجدد و ری‌استارت
#      --with-demo-data  انتقال دادهٔ نمونهٔ فاز صفر به PostgreSQL (در صورت وجود)
#      --skip-docker-install   نصب داکر را رد کن (از قبل نصب است)
# ════════════════════════════════════════════════════════════════════
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$PWD"
COMPOSE_FILE="$ROOT/docker-compose.yml"
PROJECT="afagh"

G='\033[32m'; R='\033[31m'; Y='\033[33m'; C='\033[36m'; B='\033[1m'; N='\033[0m'
step() { echo -e "\n${C}═══ $1 ═══${N}"; }
ok()   { echo -e "  ${G}[OK]${N}   $1"; }
warn() { echo -e "  ${Y}[!]${N}    $1"; }
die()  { echo -e "  ${R}[X]${N}    $1" >&2; exit 1; }

APP_PORT_ARG=""; BASE_URL_ARG=""; FRESH=0; NO_BUILD=0; UPDATE=0; WITH_DEMO=0; SKIP_DOCKER=0
while [ $# -gt 0 ]; do
  case "$1" in
    --port) APP_PORT_ARG="${2:-}"; shift 2 ;;
    --base-url) BASE_URL_ARG="${2:-}"; shift 2 ;;
    --fresh) FRESH=1; shift ;;
    --no-build) NO_BUILD=1; shift ;;
    --update) UPDATE=1; shift ;;
    --with-demo-data) WITH_DEMO=1; shift ;;
    --skip-docker-install) SKIP_DOCKER=1; shift ;;
    -h|--help) sed -n '2,25p' "$0"; exit 0 ;;
    *) die "سوییچ ناشناخته: $1" ;;
  esac
done

[ "$(id -u)" -eq 0 ] || die "این اسکریپت باید با root اجرا شود:  sudo ./deploy-debian.sh"

echo -e "\n${B}════════ استقرار سامانه جامع آفاق (Debian + Docker) ════════${N}"

# ── ۰) بررسی سیستم ────────────────────────────────────────────────
step "۰/۸ بررسی سیستم"
. /etc/os-release 2>/dev/null || die "/etc/os-release پیدا نشد — این اسکریپت مخصوص Debian است"
CODENAME="${VERSION_CODENAME:-trixie}"
if [ "${ID:-}" != "debian" ]; then
  warn "توزیع شما ${PRETTY_NAME:-نامشخص} است (اسکریپت برای Debian 13 نوشته شده) — ادامه می‌دهیم"
else
  case "${VERSION_ID:-}" in
    13*) ok "Debian 13 (${CODENAME})" ;;
    *)   warn "Debian ${VERSION_ID:-?} (${CODENAME}) — تست‌شده روی ۱۳، ادامه می‌دهیم" ;;
  esac
fi
ok "معماری: $(dpkg --print-architecture)  |  حافظه: $(free -h | awk '/Mem:/{print $2}')"

# بیلد Next.js حافظه‌بر است؛ روی سرورهای کوچک بدون swap، کرنل پروسهٔ بیلد را
# می‌کشد و داکر «exit code: 137» می‌دهد. اسکریپت مشترک، swap را idempotent
# می‌سازد و سقف هیپ پیشنهادی را چاپ می‌کند.
if ! bash "$ROOT/scripts/ensure-build-memory.sh"; then
  warn "تأمین حافظهٔ بیلد ناموفق بود — اگر بیلد با exit code: 137 شکست خورد، NODE_MAX_OLD_SPACE را کم کنید"
fi
MEM_MB=$(free -m | awk '/Mem:/{print $2}')
# سقف هیپ بیلد متناسب با حافظهٔ سرور
if [ "${MEM_MB:-0}" -lt 1500 ]; then export NODE_MAX_OLD_SPACE=1024
elif [ "${MEM_MB:-0}" -lt 2500 ]; then export NODE_MAX_OLD_SPACE=1536
elif [ "${MEM_MB:-0}" -lt 4000 ]; then export NODE_MAX_OLD_SPACE=2048
fi
AVAIL_GB=$(df -BG --output=avail "$ROOT" | tail -1 | tr -dc '0-9')
[ "${AVAIL_GB:-0}" -ge 5 ] || warn "فضای دیسک کم است (${AVAIL_GB}GB) — بیلد ایمیج حدود ۳ گیگ می‌خواهد"

# ── ۱) نصب Docker ────────────────────────────────────────────────
step "۱/۸ Docker Engine + Compose plugin"
if [ "$SKIP_DOCKER" = "1" ]; then
  warn "رد شد (--skip-docker-install)"
elif command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  ok "از قبل نصب است: $(docker --version | cut -d, -f1)"
else
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl gnupg git >/dev/null
  install -m 0755 -d /etc/apt/keyrings
  if [ ! -f /etc/apt/keyrings/docker.asc ]; then
    curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc
  fi
  # اگر مخزن داکر هنوز برای این کدنیم آماده نباشد، به bookworm برمی‌گردیم
  DOCKER_CODENAME="$CODENAME"
  if ! curl -fsI "https://download.docker.com/linux/debian/dists/${CODENAME}/Release" >/dev/null 2>&1; then
    warn "مخزن داکر برای ${CODENAME} موجود نیست — از bookworm استفاده می‌شود"
    DOCKER_CODENAME="bookworm"
  fi
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian ${DOCKER_CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin >/dev/null \
    || die "نصب Docker ناموفق بود"
  systemctl enable --now docker >/dev/null 2>&1 || true
  ok "نصب شد: $(docker --version | cut -d, -f1)"
fi
docker info >/dev/null 2>&1 || die "دیمن داکر اجرا نمی‌شود — systemctl start docker"

# ── ۲) به‌روزرسانی کد (اختیاری) ──────────────────────────────────
if [ "$UPDATE" = "1" ]; then
  step "به‌روزرسانی کد از گیت"
  BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
  [ -n "$BRANCH" ] || die "این پوشه مخزن گیت نیست"
  git pull --ff-only origin "$BRANCH" || die "git pull ناموفق بود"
  ok "کد به‌روز شد (شاخهٔ $BRANCH)"
fi

# ── ۳) فایل تنظیمات و رمزها ──────────────────────────────────────
step "۲/۸ تنظیمات و رمزهای پروداکشن"
ENV_FILE="$ROOT/.env"
rnd() { tr -dc 'A-Za-z0-9' </dev/urandom | head -c "${1:-28}"; }
if [ ! -f "$ENV_FILE" ]; then
  PGPW="$(rnd 32)"; APPDBPW="$(rnd 32)"; MINIOPW="$(rnd 32)"; REDISPW="$(rnd 32)"; SIGNKEY="$(rnd 64)"
  HOST_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
  cat > "$ENV_FILE" <<EOF
# ساخته‌شده توسط deploy-debian.sh در $(date '+%Y-%m-%d %H:%M') — این فایل را جای امنی نگه دارید
# فاز ۲: اپ به‌طور پیش‌فرض فقط روی loopback منتشر می‌شود (پشت Caddy/پروکسی).
# برای انتشار عمومیِ صریح: APP_BIND=0.0.0.0
APP_BIND=127.0.0.1
APP_PORT=8080
POSTGRES_PASSWORD=$PGPW
# P0-3: رمز نقش محدود afagh_app — قبلاً اصلاً تولید نمی‌شد و compose به
# پیش‌فرض ناامن «afagh-app-pass» می‌افتاد. hardening.mjs همین مقدار را روی نقش اعمال می‌کند.
AFAGH_APP_DB_PASSWORD=$APPDBPW
# فاز ۲: Redis با AUTH بالا می‌آید (پیش‌تر بدون رمز بود) — compose آن را اجباری می‌کند.
REDIS_PASSWORD=$REDISPW
# کلید اختصاصی امضای بکاپ SQL (گردشش آرشیو قدیمی را بیاعتبار نمیکند)
AFAGH_BACKUP_SIGNING_KEY=$SIGNKEY
PG_HOST_PORT=5432
REDIS_HOST_PORT=6379
MINIO_ROOT_USER=afagh
MINIO_ROOT_PASSWORD=$MINIOPW
MINIO_HOST_PORT=9000
MINIO_CONSOLE_PORT=9001
S3_BUCKET=afagh-archive

# نشانی عمومی سامانه — مبنای QR کارت آزمون، لینک استعلام مدرک و بازگشت از درگاه پرداخت
AFAGH_PUBLIC_BASE_URL=${BASE_URL_ARG:-http://${HOST_IP:-localhost}:${APP_PORT_ARG:-8080}}

# سایر سرویس‌ها (BBB، Moodle، پیامک، درگاه پرداخت، استعلام‌ها) را می‌توانید همین‌جا
# تعریف کنید یا بعد از نصب از پنل مدیر ← «پیکربندی سامانه» وارد کنید.
EOF
  chmod 600 "$ENV_FILE"
  ok "‎.env ساخته شد با رمزهای تصادفی (chmod 600)"
else
  ok "‎.env موجود بود — دست‌نخورده ماند"
  # P0-3: backfill برای استقرارهای قدیمی که AFAGH_APP_DB_PASSWORD ندارند
  # (قبلاً این متغیر تولید نمی‌شد و اتصال app-role به پیش‌فرض ناامن می‌افتاد)
  if ! grep -q '^AFAGH_APP_DB_PASSWORD=' "$ENV_FILE" || [ -z "$(grep '^AFAGH_APP_DB_PASSWORD=' "$ENV_FILE" | cut -d= -f2-)" ]; then
    APPDBPW="$(rnd 32)"
    if grep -q '^AFAGH_APP_DB_PASSWORD=' "$ENV_FILE"; then
      sed -i "s/^AFAGH_APP_DB_PASSWORD=.*/AFAGH_APP_DB_PASSWORD=$APPDBPW/" "$ENV_FILE"
    else
      echo "AFAGH_APP_DB_PASSWORD=$APPDBPW" >> "$ENV_FILE"
    fi
    chmod 600 "$ENV_FILE"
    ok "AFAGH_APP_DB_PASSWORD تصادفی ساخته و به .env اضافه شد"
  fi
  # فاز ۲: backfill برای استقرارهای قدیمی که REDIS_PASSWORD ندارند
  # (compose حالا Redis را با «--requirepass» بالا می‌آورد و بدون رمز بالا نمی‌آید)
  if ! grep -q '^REDIS_PASSWORD=' "$ENV_FILE" || [ -z "$(grep '^REDIS_PASSWORD=' "$ENV_FILE" | cut -d= -f2-)" ]; then
    REDISPW="$(rnd 32)"
    if grep -q '^REDIS_PASSWORD=' "$ENV_FILE"; then
      sed -i "s/^REDIS_PASSWORD=.*/REDIS_PASSWORD=$REDISPW/" "$ENV_FILE"
    else
      echo "REDIS_PASSWORD=$REDISPW" >> "$ENV_FILE"
    fi
    chmod 600 "$ENV_FILE"
    ok "REDIS_PASSWORD تصادفی ساخته و به .env اضافه شد"
  fi
  # بکاپ DR: کلید اختصاصی امضا. استقرارهای قدیمی آن را ندارند؛ بکاپهایشان
  # با کلید مشتقازPII امضا شدهاند و تأییدکننده هر دو کلید را امتحان میکند،
  # پس backfill کردن اینجا هیچ آرشیوی را بیاعتبار نمیکند.
  if ! grep -q '^AFAGH_BACKUP_SIGNING_KEY=' "$ENV_FILE" || [ -z "$(grep '^AFAGH_BACKUP_SIGNING_KEY=' "$ENV_FILE" | cut -d= -f2-)" ]; then
    SIGNKEY="$(rnd 64)"
    if grep -q '^AFAGH_BACKUP_SIGNING_KEY=' "$ENV_FILE"; then
      sed -i "s/^AFAGH_BACKUP_SIGNING_KEY=.*/AFAGH_BACKUP_SIGNING_KEY=$SIGNKEY/" "$ENV_FILE"
    else
      echo "AFAGH_BACKUP_SIGNING_KEY=$SIGNKEY" >> "$ENV_FILE"
    fi
    chmod 600 "$ENV_FILE"
    ok "AFAGH_BACKUP_SIGNING_KEY تصادفی ساخته و به .env اضافه شد"
  fi
fi
if [ -n "$APP_PORT_ARG" ]; then
  sed -i "s/^APP_PORT=.*/APP_PORT=$APP_PORT_ARG/" "$ENV_FILE"
  ok "پورت اپ روی $APP_PORT_ARG تنظیم شد"
fi
if [ -n "$BASE_URL_ARG" ]; then
  if grep -q '^AFAGH_PUBLIC_BASE_URL=' "$ENV_FILE"; then
    sed -i "s|^AFAGH_PUBLIC_BASE_URL=.*|AFAGH_PUBLIC_BASE_URL=$BASE_URL_ARG|" "$ENV_FILE"
  else
    echo "AFAGH_PUBLIC_BASE_URL=$BASE_URL_ARG" >> "$ENV_FILE"
  fi
  ok "نشانی عمومی سامانه: $BASE_URL_ARG"
fi
set -a; . "$ENV_FILE"; set +a

# فاز ۲ / سازگاری عقب‌رو: در .envهای قدیمی مقدار APP_PORT به شکل «host:port» بود
#   (مستند در INSTALL.md: APP_PORT=127.0.0.1:8080). حالا bind و port جدا شده‌اند؛ اگر
#   مقدار شامل «:» بود آن را به APP_BIND و APP_PORT عددی تقسیم می‌کنیم تا همهٔ
#   بررسی‌های پایین‌دست (ss/curl/URL) با پورت عددی کار کنند.
case "${APP_PORT:-}" in
  *:*)
    APP_BIND="${APP_PORT%%:*}"
    APP_PORT="${APP_PORT##*:}"
    ;;
esac
APP_BIND="${APP_BIND:-127.0.0.1}"
APP_PORT="${APP_PORT:-8080}"
export APP_BIND APP_PORT

# P0-3: fail-fast روی سکرت‌های ناامن — این اسکریپت فقط پروداکشن است (root + Debian)،
# پس هیچ بهانه‌ای برای مقادیر پیش‌فرض/نمونه پذیرفته نیست.
weak_secret() { # $1=value — خروجی ۰ یعنی ضعیف/نمونه
  case "$1" in
    ""|afagh|afagh-app-pass|afagh_app|afagh-app-password|afagh-secret|postgres|password|password123|123456|secret|minioadmin|admin|admin123|test|CHANGE_ME*|change_me*|changeme*|replace_me*|todo*) return 0 ;;
    *) return 1 ;;
  esac
}
repeat_secret() { # $1=value — چهار تکرار پشت‌سرهم («aaaa») = ضعیف
  echo "$1" | grep -Eq '(.)\1{3,}'
}
weak_secret "${POSTGRES_PASSWORD:-}" && die "POSTGRES_PASSWORD ناامن است — در .env مقدار تصادفی قوی بگذارید یا .env را حذف کنید تا دوباره ساخته شود"
weak_secret "${AFAGH_APP_DB_PASSWORD:-}" && die "AFAGH_APP_DB_PASSWORD ناامن است — در .env مقدار تصادفی قوی بگذارید یا .env را حذف کنید تا دوباره ساخته شود"
weak_secret "${MINIO_ROOT_PASSWORD:-}" && die "MINIO_ROOT_PASSWORD ناامن است — در .env مقدار تصادفی قوی بگذارید یا .env را حذف کنید تا دوباره ساخته شود"
weak_secret "${REDIS_PASSWORD:-}" && die "REDIS_PASSWORD ناامن است — در .env مقدار تصادفی قوی بگذارید یا .env را حذف کنید تا دوباره ساخته شود"
# P0-1: حداقل طول‌ها با سیاست repo یکی است (scripts/lib/secret-policy.mjs):
#   رمزهای دیتابیس ≥۲۴ · رمز MinIO ≥۱۶ — و هیچ‌کدام نباید تکرار چهارتایی داشته باشند.
[ "${#POSTGRES_PASSWORD}" -ge 24 ] || die "POSTGRES_PASSWORD کوتاه است (حداقل ۲۴ کاراکتر؛ make env یا رمز تصادفی)"
[ "${#AFAGH_APP_DB_PASSWORD}" -ge 24 ] || die "AFAGH_APP_DB_PASSWORD کوتاه است (حداقل ۲۴ کاراکتر — رمز نقش afagh_app که به RLS گره خورده)"
[ "${#MINIO_ROOT_PASSWORD}" -ge 16 ] || die "MINIO_ROOT_PASSWORD کوتاه است (حداقل ۱۶ کاراکتر)"
[ "${#REDIS_PASSWORD}" -ge 24 ] || die "REDIS_PASSWORD کوتاه است (حداقل ۲۴ کاراکتر — رمز Redis که compose اجباری‌اش می‌کند)"
# کلید امضای بکاپ: اختیاری (خالی ⇒ مشتق از PII_KEY)، ولی اگر ست شد باید قوی باشد.
if [ -n "${AFAGH_BACKUP_SIGNING_KEY:-}" ]; then
  [ "${#AFAGH_BACKUP_SIGNING_KEY}" -ge 32 ] || die "AFAGH_BACKUP_SIGNING_KEY کوتاه است (حداقل ۳۲ کاراکتر تصادفی)"
  case "$AFAGH_BACKUP_SIGNING_KEY" in
    CHANGE_ME_*) die "AFAGH_BACKUP_SIGNING_KEY هنوز مقدار نمونه است — مقدار تصادفی بگذارید" ;;
  esac
fi
for pair in "POSTGRES_PASSWORD:${POSTGRES_PASSWORD}" "AFAGH_APP_DB_PASSWORD:${AFAGH_APP_DB_PASSWORD}" "MINIO_ROOT_PASSWORD:${MINIO_ROOT_PASSWORD}" "REDIS_PASSWORD:${REDIS_PASSWORD}"; do
  repeat_secret "${pair#*:}" && die "${pair%%:*} تکرار چهارتایی کاراکتر دارد — رمز تصادفی بسازید (rnd در همین اسکریپت)"
done
ok "سکرت‌ها با سیاست پروداکشن بررسی شدند (طول، عدم نمونه، عدم پیش‌فرض ضعیف)"

if ss -ltn "sport = :$APP_PORT" 2>/dev/null | grep -q LISTEN; then
  warn "پورت $APP_PORT روی هاست اشغال است — اگر مربوط به همین سامانه نیست، آزادش کنید"
fi

dc() { docker compose -p "$PROJECT" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"; }

# ── ۴) بیلد و اجرا ───────────────────────────────────────────────
step "۳/۸ ساخت ایمیج‌ها و اجرای سرویس‌ها"
if [ "$FRESH" = "1" ]; then
  warn "حالت --fresh: حذف کانتینرها و کل داده"
  dc down -v --remove-orphans >/dev/null 2>&1 || true
fi
if [ "$NO_BUILD" = "1" ]; then
  warn "بدون بیلد (--no-build)"
else
  echo "  … بیلد ایمیج‌ها (بار اول ۳ تا ۱۰ دقیقه؛ سقف هیپ: ${NODE_MAX_OLD_SPACE:-2048}MB)"
  dc build || die "ساخت ایمیج ناموفق بود"
  ok "ایمیج‌ها ساخته شدند"
fi
dc up -d || die "بالا آوردن سرویس‌ها ناموفق بود"
ok "سرویس‌ها اجرا شدند (پروژهٔ docker: $PROJECT)"

# ── ۵) انتظار برای آماده شدن ─────────────────────────────────────
step "۴/۸ بررسی سلامت سرویس‌ها"
printf "  … PostgreSQL"
for _ in $(seq 1 60); do docker exec afagh_pg pg_isready -U afagh -d afagh_db >/dev/null 2>&1 && break; printf "."; sleep 2; done; echo ""
docker exec afagh_pg pg_isready -U afagh -d afagh_db >/dev/null 2>&1 && ok "PostgreSQL سالم" || die "PostgreSQL بالا نیامد — dc logs postgres"
docker exec afagh_redis redis-cli ping >/dev/null 2>&1 && ok "Redis سالم" || warn "Redis پاسخ نداد"

MIG_EXIT=$(docker inspect -f '{{.State.ExitCode}}' afagh_migrator 2>/dev/null || echo "?")
if [ "$MIG_EXIT" = "0" ]; then ok "جدول‌ها + ایندکس‌ها + RLS اعمال شد (migrator)"
else warn "سرویس migrator با کد $MIG_EXIT تمام شد — بررسی: docker logs afagh_migrator"; fi

printf "  … سرویس وب"
APP_OK=0
for _ in $(seq 1 60); do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${APP_PORT}/login" || true)
  [ "$CODE" = "200" ] && { APP_OK=1; break; }
  printf "."; sleep 2
done; echo ""
[ "$APP_OK" = "1" ] && ok "سامانه روی پورت ${APP_PORT} پاسخ می‌دهد (HTTP 200)" || die "سامانه بالا نیامد — docker logs afagh_app"

# ── ۵-ب) P0-2: راستی‌آزمایی همان پشتیبانی که پیش از مهاجرت ساخته شد ──
printf "  … بررسی سلامت پشتیبان"
BK_LINE=$(dc run --rm --no-deps -e AFAGH_BACKUP_DIR=/backups migrator node scripts/verify-backup.mjs 2>&1 | tail -1) || true
echo ""
if [ -n "$BK_LINE" ]; then ok "$BK_LINE"; else warn "پشتیبان راستی‌آزمایی نشد — دستی: make verify-backup"; fi

# ── ۵-پ) P0-4: حساب مدیر اولیه با رمز تصادفی (دیگر رمز ثابت چاپ نمی‌شود) ──
step "۵/۸ حساب مدیر اولیه (P0-4)"
ADMIN_NC="${ADMIN_NATIONAL_CODE:-1000000001}"
CRED_FILE="$ROOT/bootstrap-credential.txt"
HAS_ADMIN=$(docker exec afagh_pg psql -U afagh -d afagh_db -tAc \
  "select 1 from users u join user_roles ur on ur.\"userId\"=u.id join roles r on r.id=ur.\"roleId\" where r.code='ADMIN' limit 1" 2>/dev/null || echo "")
if [ -n "$HAS_ADMIN" ]; then
  ok "حساب مدیر از قبل وجود دارد — رمز تازه‌ای ساخته نشد (برای چرخش: make admin)"
else
  umask 077
  if dc run --rm --no-deps migrator node scripts/create-admin.mjs --national-code "$ADMIN_NC" --show > "$CRED_FILE" 2>/dev/null; then
    chmod 600 "$CRED_FILE"
    ok "حساب مدیر اولیه ساخته شد · رمز فقط در فایل $CRED_FILE (chmod 600) — در ترمینال چاپ نشد"
  else
    rm -f "$CRED_FILE"; warn "ساخت حساب مدیر ناموفق بود — دستی: make admin"
  fi
fi

# ── ۶) دادهٔ نمونه (اختیاری) ─────────────────────────────────────
step "۶/۸ دادهٔ نمونه"
if [ "$WITH_DEMO" = "1" ]; then
  if [ -f "$ROOT/afagh-erp/data/afagh.db" ]; then
    docker run --rm --network "${PROJECT}_default" \
      -e DATABASE_URL="postgres://afagh:${POSTGRES_PASSWORD}@postgres:5432/afagh_db" \
      -e SQLITE_SOURCE=/data/afagh.db \
      -v "$ROOT/afagh-erp/data/afagh.db:/data/afagh.db:ro" \
      afagh-migrator:latest sh -c "node scripts/migrate-sqlite-to-pg.mjs" \
      && ok "دادهٔ نمونه منتقل شد" || warn "انتقال دادهٔ نمونه ناموفق بود"
  else
    warn "فایل afagh-erp/data/afagh.db موجود نیست — از آن صرف‌نظر شد"
  fi
else
  warn "رد شد (برای انتقال دادهٔ نمونه: --with-demo-data)"
fi

# ── ۷) فایروال و جمع‌بندی ────────────────────────────────────────
step "۷/۸ فایروال"
# فاز ۲: فقط وقتی پورت روی همهٔ اینترفیس‌ها (عمومی) منتشر شده، ufw را باز می‌کنیم.
#   با پیش‌فرض loopback (127.0.0.1) پورت از اینترنت بسته است و باید از Caddy/HTTPS استفاده کرد.
case "${APP_BIND:-127.0.0.1}" in
  0.0.0.0|::|"")
    if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
      ufw allow "${APP_PORT}/tcp" >/dev/null 2>&1 && ok "پورت ${APP_PORT} در ufw باز شد" || warn "باز کردن پورت در ufw ناموفق بود"
    else
      warn "ufw فعال نیست — اگر فایروال دیگری دارید، پورت ${APP_PORT} را باز کنید"
    fi
    ;;
  *)
    warn "پورت فقط روی ${APP_BIND} منتشر شد — از اینترنت بسته است (برای HTTPS از Caddy استفاده کنید)"
    ;;
esac

step "۸/۸ استقرار کامل شد"
IP=$(hostname -I 2>/dev/null | awk '{print $1}')
# فاز ۲: سطر «دسترسی» بر اساس APP_BIND ساخته می‌شود (loopback در برابر انتشار عمومی).
case "${APP_BIND:-127.0.0.1}" in
  127.0.0.1|localhost|::1)
    REACH_LINE="      http://localhost:${APP_PORT}        (فقط روی همین سرور — از اینترنت بسته است)
      برای دسترسی عمومی، DOMAIN را در .env بگذارید و HTTPS را بالا بیاورید: make up-https"
    ;;
  *)
    REACH_LINE="      http://${IP:-SERVER_IP}:${APP_PORT}        (و http://localhost:${APP_PORT} روی خود سرور)"
    ;;
esac
cat <<EOF

  ${B}سامانه در دسترس است:${N}
${REACH_LINE}

  ${B}ورود اولیه (بدون رمز ثابت):${N}
      کد ملی مدیر: ${ADMIN_NC}  →  /admin
      رمز: در فایل bootstrap-credential.txt کنار همین اسکریپت
             sudo cat $ROOT/bootstrap-credential.txt
      در اولین ورود، تغییر رمز اجباری است؛ پس از آن این فایل را پاک کنید:
             sudo rm $ROOT/bootstrap-credential.txt
      (حساب‌های دمو با رمز 123456 در ایمیج تولید قفل‌اند؛ برای جعبهٔ نمایشی:
             در .env  AFAGH_DEMO_LOCK=0 و AFAGH_DEMO_MODE=1 و سپس make build)

  ${B}پیکربندی سرویس‌های بیرونی:${N}
      پنل مدیر ← «⚙️ پیکربندی سامانه» — نشانی و کلید BigBlueButton/Moodle، پیامک،
      درگاه پرداخت و سرویس‌های استعلام بدون نیاز به ری‌استارت از وب تنظیم می‌شوند.
      (همان مقادیر را می‌توانید در فایل .env هم به‌عنوان پیش‌فرض بگذارید.)

  ${B}مدیریت:${N}
      وضعیت      : make ps            (یا docker compose ps)
      لاگ زنده   : make logs
      ری‌استارت   : make restart
      توقف       : make down
      به‌روزرسانی : sudo ./deploy-debian.sh --update   (یا make update)
      پشتیبان PG : make backup         → volume afagh_backups (ماندگار + sha256)
      آزمون بازیابی: make drill        → بازگردانی در دیتابیس موقت + مقایسه
      خروج از سرور : make copy-backups-to-host DEST=/mnt/nas/afagh
      چرخش رمز مدیر: make admin
      HTTPS دامنه: DOMAIN را در .env بگذارید و make up-https
      همهٔ میان‌بُرها: make help

  رمزهای تولیدشده در فایل ${B}.env${N} کنار همین اسکریپت است (chmod 600) — از آن نسخهٔ پشتیبان بگیرید.
  دیتابیس/Redis/MinIO فقط روی 127.0.0.1 باز شده‌اند و از بیرون سرور در دسترس نیستند.

EOF
