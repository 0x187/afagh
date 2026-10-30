// ═══ توکن‌های اتصال پیام‌رسان — پورت lib/messenger-link-tokens.ts ═══
//
//	جریان: کاربر وارد پورتال می‌شود → MintLinkToken (کد انسانی + دیپ‌لینک)
//	→ در بات /start <token> می‌فرستد (poll worker ثبت PENDING می‌کند)
//	→ کاربر در پورتال ConfirmLinkToken را می‌زند → verifiedAt=now.
//	کد/توکن خام هرگز ذخیره نمی‌شود؛ فقط sha256 آن‌ها. پیام خطا برای همهٔ
//	شکست‌های تأیید واحد و عمومی است (ضد شمارش).
package messaging

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"fmt"
	"os"
	"regexp"
	"strings"
	"sync"
	"time"

	"backend-go/internal/logger"
	"backend-go/internal/ratelimit"
)

const (
	// LinkTTLMin اعتبار کد اتصال (دقیقه).
	LinkTTLMin = 10
	// LinkMaxAttempts سقف تلاش ناموفق تأیید به‌ازای هر توکن.
	LinkMaxAttempts = 5
)

// codeAlphabet الفبای بدون ابهام (بدون 0/O و 1/I) برای کد انسانی.
const codeAlphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"
const codeLen = 8

// LinkGenericError پیام خطای واحد و عمومی برای همهٔ شکست‌های توکن (ضد شمارش).
const LinkGenericError = "کد اتصال نامعتبر است یا منقضی شده. از پورتال یک کد تازه بگیرید."

var linkLog = logger.For("messenger-link")

// ═══ کانال‌ها و پیکربندی API هر پیام‌رسان (پورت MESSENGER_CONFIGS) ═══

// messengerLinkCfg پیکربندی کامل یک پیام‌رسان — ENV هر کلید از SETTING_DEFS.
type messengerLinkCfg struct {
	TokenKey        string
	TokenEnv        string
	BaseKey         string
	BaseEnv         string
	DefaultBase     string
	Style           string // BOT | EITAA
	EnabledKey      string
	EnabledEnv      string
	DeepLinkPrefix  string
	UsernameKey     string
	UsernameEnv     string
	UsernameDefault string
}

var messengerLinkConfigs = map[string]messengerLinkCfg{
	"TELEGRAM": {TokenKey: "TELEGRAM_TOKEN", TokenEnv: "TELEGRAM_BOT_TOKEN",
		BaseKey: "TELEGRAM_API_BASE", BaseEnv: "TELEGRAM_API_BASE", DefaultBase: "https://api.telegram.org",
		Style: "BOT", EnabledKey: "TELEGRAM_BOT_ENABLED", EnabledEnv: "TELEGRAM_BOT_ENABLED",
		DeepLinkPrefix: "https://t.me/", UsernameKey: "TELEGRAM_BOT_USERNAME", UsernameEnv: "TELEGRAM_BOT_USERNAME"},
	"BALE": {TokenKey: "BALE_TOKEN", TokenEnv: "BALE_BOT_TOKEN",
		BaseKey: "BALE_API_BASE", BaseEnv: "BALE_API_BASE", DefaultBase: "https://tapi.bale.ai",
		Style: "BOT", EnabledKey: "BALE_BOT_ENABLED", EnabledEnv: "BALE_BOT_ENABLED",
		DeepLinkPrefix: "https://ble.ir/", UsernameKey: "BALE_BOT_USERNAME", UsernameEnv: "BALE_BOT_USERNAME"},
	"SOROUSH": {TokenKey: "SOROUSH_TOKEN", TokenEnv: "SOROUSH_BOT_TOKEN",
		BaseKey: "SOROUSH_API_BASE", BaseEnv: "SOROUSH_API_BASE", DefaultBase: "https://api.splus.ir",
		Style: "BOT", EnabledKey: "SOROUSH_BOT_ENABLED", EnabledEnv: "SOROUSH_BOT_ENABLED",
		DeepLinkPrefix: "", UsernameKey: "SOROUSH_BOT_USERNAME", UsernameEnv: "SOROUSH_BOT_USERNAME", UsernameDefault: "afaghbot"},
	"EITAA": {TokenKey: "EITAA_TOKEN", TokenEnv: "EITAA_BOT_TOKEN",
		BaseKey: "EITAA_API_BASE", BaseEnv: "EITAA_API_BASE", DefaultBase: "https://eitaayar.ir/api",
		Style: "EITAA", EnabledKey: "EITAA_BOT_ENABLED", EnabledEnv: "EITAA_BOT_ENABLED",
		DeepLinkPrefix: "https://eitaa.com/", UsernameKey: "EITAA_BOT_USERNAME", UsernameEnv: "EITAA_BOT_USERNAME"},
	"IGAP": {TokenKey: "IGAP_TOKEN", TokenEnv: "IGAP_BOT_TOKEN",
		BaseKey: "IGAP_API_BASE", BaseEnv: "IGAP_API_BASE", DefaultBase: "https://igap.ai/api",
		Style: "BOT", EnabledKey: "IGAP_BOT_ENABLED", EnabledEnv: "IGAP_BOT_ENABLED",
		DeepLinkPrefix: "", UsernameKey: "", UsernameEnv: ""},
}

// PollChannels کانال‌هایی که poll worker (getUpdates) پشتیبانی می‌کند.
var PollChannels = []string{"BALE", "EITAA", "SOROUSH"}

// LinkableChannels کانال‌هایی که اتصال جدید برایشان باز است.
// ای‌گپ: poll اثبات‌نشده — اتصال جدید فریز است.
var LinkableChannels = []string{"TELEGRAM", "BALE", "EITAA", "SOROUSH"}

// IsLinkable آیا اتصال این کانال باز است؟
func IsLinkable(channel string) bool {
	for _, c := range LinkableChannels {
		if c == channel {
			return true
		}
	}
	return false
}

// IsPollChannel آیا این کانال poll می‌شود؟
func IsPollChannel(channel string) bool {
	for _, c := range PollChannels {
		if c == channel {
			return true
		}
	}
	return false
}

// IsMessengerChannel آیا این کلید یکی از پنج پیام‌رسان است؟
func IsMessengerChannel(channel string) bool {
	_, ok := messengerLinkConfigs[channel]
	return ok
}

func freezeMessage(channel string) string {
	return "اتصال جدید " + channel + " در حال حاضر فعال نیست. اعلان‌ها را از پیامک یا پیام‌رسان دیگری دنبال کنید."
}

// ═══ خواندن کلیدهای تنظیمی افزوده ═══
//
// این کلیدها (توکن بات‌ها، رازهای کرون افزوده، متن تبریک‌ها) هنوز در
// PhaseOneDefs تعریف نشده‌اند؛ همان اولویت سامانه پیاده می‌شود:
// ۱) جدول system_settings  ۲) ENV  ۳) پیش‌فرض — با کش ۱۵ثانیه‌ای همان Store.
// وقتی کلیدها به PhaseOneDefs اضافه شوند، Settings.Get همان نتیجه را می‌دهد.

var rawMu sync.Mutex
var rawCache map[string]string
var rawCacheAt time.Time

func (s *Service) rawRows(ctx context.Context) map[string]string {
	rawMu.Lock()
	defer rawMu.Unlock()
	if rawCache != nil && time.Since(rawCacheAt) < 15*time.Second {
		return rawCache
	}
	rows := map[string]string{}
	if s.Pool != nil {
		r, err := s.Pool.Query(ctx, `select "key", value from system_settings`)
		if err == nil {
			for r.Next() {
				var k, v string
				if r.Scan(&k, &v) == nil {
					rows[k] = v
				}
			}
			r.Close()
		}
	}
	rawCache = rows
	rawCacheAt = time.Now()
	return rows
}

// rawSetting خواندن یک کلید با اولویت DB → ENV → پیش‌فرض.
func (s *Service) rawSetting(ctx context.Context, key, env, fallback string) string {
	rows := s.rawRows(ctx)
	if v := strings.TrimSpace(rows[key]); v != "" {
		return v
	}
	if v := strings.TrimSpace(os.Getenv(env)); v != "" {
		return v
	}
	return fallback
}

// SettingRaw نسخهٔ بسته‌خارجی برای کرون‌های افزوده و هندلرهای httpapi.
func SettingRaw(ctx context.Context, s *Service, key, env, fallback string) string {
	return s.rawSetting(ctx, key, env, fallback)
}

// ═══ محدودیت نرخ ═══

var linkLimiter *ratelimit.Limiter

// SetRateLimiter محدودکنندهٔ نرخ را به بستهٔ messaging می‌دهد (از main).
func SetRateLimiter(l *ratelimit.Limiter) { linkLimiter = l }

// linkAllowed همان rateLimit() کلاینت: خطای زیرساخت → باز بگذار (fallback درون‌حافظه خودش داخل Limiter است).
func linkAllowed(key string, limit, windowSec int) bool {
	if linkLimiter == nil {
		return true
	}
	ok, _, err := linkLimiter.Allow(context.Background(), key, limit, windowSec)
	if err != nil {
		return true
	}
	return ok
}

// ═══ ابزارهای هش/کد ═══

func sha256Hex(v string) string {
	h := sha256.Sum256([]byte(v))
	return hex.EncodeToString(h[:])
}

func randomCode() string {
	buf := make([]byte, codeLen)
	_, _ = rand.Read(buf)
	out := make([]byte, codeLen)
	for i, b := range buf {
		out[i] = codeAlphabet[int(b)%len(codeAlphabet)]
	}
	return string(out)
}

// timingEqHex مقایسهٔ زمان‌ثابت دو رشتهٔ هش.
func timingEqHex(aHex, bHex string) bool {
	a, err1 := hex.DecodeString(aHex)
	b, err2 := hex.DecodeString(bHex)
	if err1 != nil || err2 != nil || len(a) != len(b) {
		return false
	}
	return subtle.ConstantTimeCompare(a, b) == 1
}

// ═══ صدور توکن ═══

// MintResult نتیجهٔ صدور کد اتصال.
type MintResult struct {
	OK          bool      `json:"ok"`
	Code        string    `json:"code,omitempty"`
	Token       string    `json:"token,omitempty"`
	DeepLink    *string   `json:"deepLink"`
	PairingText string    `json:"pairingText,omitempty"`
	ExpiresAt   time.Time `json:"expiresAt,omitempty"`
	Error       string    `json:"error,omitempty"`
}

// MintLinkToken صدور کد اتصال برای یک کانال (پورت mintLinkTokenFor).
func (s *Service) MintLinkToken(ctx context.Context, userID int64, channel string) MintResult {
	if !IsLinkable(channel) {
		return MintResult{Error: freezeMessage(channel)}
	}
	if !linkAllowed(fmt.Sprintf("msg-link-mint:%d", userID), 5, 3600) {
		return MintResult{Error: "تعداد درخواست کد اتصال بیش از حد مجاز است. ساعتی دیگر دوباره تلاش کنید."}
	}

	tokBuf := make([]byte, 24)
	_, _ = rand.Read(tokBuf)
	token := hex.EncodeToString(tokBuf) // ۴۸ رقم
	code := randomCode()
	expiresAt := time.Now().Add(LinkTTLMin * time.Minute)

	if _, err := s.Pool.Exec(ctx, `
		insert into messenger_link_tokens ("userId", channel, "tokenHash", "codeHash", "pendingChatId", "expiresAt", "usedAt", attempts)
		values ($1,$2,$3,$4,null,$5,null,0)`,
		userID, channel, sha256Hex(token), sha256Hex(code), expiresAt); err != nil {
		return MintResult{Error: LinkGenericError}
	}

	// دیپ‌لینک فقط وقتی نام‌کاربری بات تنظیم شده؛ وگرنه دستور متنی.
	cfg := messengerLinkConfigs[channel]
	deepLink := ""
	if cfg.UsernameKey != "" && cfg.DeepLinkPrefix != "" {
		username := strings.TrimPrefix(s.rawSetting(ctx, cfg.UsernameKey, cfg.UsernameEnv, cfg.UsernameDefault), "@")
		if username != "" {
			deepLink = cfg.DeepLinkPrefix + username + "?start=" + token
		}
	}
	var dl *string
	if deepLink != "" {
		dl = &deepLink
	}

	linkLog.Info("link_token_minted", logger.Fields{
		"channel": channel, "userId": userID, "tokenHash": sha256Hex(token)[:12],
	})
	return MintResult{OK: true, Code: code, Token: token, DeepLink: dl,
		PairingText: "/start " + code, ExpiresAt: expiresAt}
}

// ═══ ثبت پیام جفت‌سازی (/start <param> از بات) ═══
//
//	param بلند = توکن کامل دیپ‌لینک؛ ۸ رقمی = کد انسانی. فقط هش‌ها لاگ می‌شوند.
//
//	INVARIANT (امنیتی): این تابع فقط یک «سرنخِ تأییدنشده» (pendingChatId)
//	روی ردیف توکن می‌نویسد — هرگز مقصد تحویل اعلان (notification_channels)
//	را نمی‌سازد یا تغییر نمی‌دهد. مقصد تحویل فقط در ConfirmLinkToken و فقط
//	با نشست احرازهویتیِ پورتال ثبت می‌شود.

var startCmdRe = regexp.MustCompile(`^/start(?:@\S+)?\s*(\S+)?\s*$`)
var bareCodeRe = regexp.MustCompile(`^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$`)

// HandlePairingText پورت handlePairingText — پاسخ بات را برمی‌گرداند ("" = بی‌پاسخ).
func (s *Service) HandlePairingText(ctx context.Context, channel, chatID, text, limiterKey string) string {
	// سقف تلاش جفت‌سازی — پیش‌فرض سطل (کانال، چت) برای poll (مبدأ مطمئن:
	// chatId را خودِ API پلتفرم با توکن بات داده). فراخوانِ وب‌هوک باید
	// limiterKey = IPِ مورداعتماد پروکسی بدهد.
	bucket := fmt.Sprintf("msg-link-pair:%s:%s", channel, chatID)
	if limiterKey != "" {
		bucket = "msg-link-pair:ip:" + limiterKey
	}
	if !linkAllowed(bucket, 20, 600) {
		return LinkGenericError
	}

	param := ""
	if m := startCmdRe.FindStringSubmatch(text); m != nil {
		param = strings.TrimSpace(m[1])
	}
	// بله گاهی فقط /start را تحویل می‌دهد یا کاربر فقط کد خالی می‌فرستد —
	// کد ۸ رقمی تکی هم پذیرفته می‌شود.
	if param == "" && bareCodeRe.MatchString(strings.TrimSpace(text)) {
		param = strings.TrimSpace(text)
	}
	if param == "" {
		return "برای اتصال حساب، از داخل پورتال «کد اتصال» بگیرید و اینجا ارسال کنید:\n/start CODE"
	}

	digest := sha256Hex(param)
	var id int64
	var tokenHash, codeHash string
	err := s.Pool.QueryRow(ctx, `
		select id, "tokenHash", "codeHash" from messenger_link_tokens
		 where channel = $1 and "usedAt" is null and "expiresAt" > now()
		   and ("tokenHash" = $2 or "codeHash" = $2)
		 limit 1`, channel, digest).Scan(&id, &tokenHash, &codeHash)
	// مقایسهٔ ثابت‌زمان روی هر دو ستون هش (دفاع در عمق — WHERE بالا هم دقیق است)
	if err != nil || !(timingEqHex(tokenHash, digest) || timingEqHex(codeHash, digest)) {
		// تطبیق ناموفق: ردیفی برای سوزاندن attempts وجود ندارد — attempts فقط
		// در شکست‌های confirm (منتسب به ردیف مشخص) می‌سوزد، نه اینجا.
		linkLog.Warn("pairing_no_match", logger.Fields{"channel": channel, "paramHash": digest[:12]})
		return LinkGenericError
	}

	// تطبیق موفق: فقط سرنخ pending ثبت می‌شود — attempts سوزانده نمی‌شود تا
	// ارسالِ دوبارهٔ کد درست (یا replay) کاربر را قفل نکند.
	if _, err := s.Pool.Exec(ctx, `update messenger_link_tokens set "pendingChatId" = $2 where id = $1`, id, chatID); err != nil {
		return LinkGenericError
	}
	linkLog.Info("pairing_recorded", logger.Fields{"channel": channel, "tokenId": id, "tokenHash": tokenHash[:12]})
	return "کد دریافت شد. ✅\nبه پورتال برگردید — اتصال به‌صورت خودکار تأیید می‌شود."
}

// ═══ بررسی وضعیت جفت‌سازی (برای تأیید خودکار سمت کلاینت) ═══
// فقط می‌خواند؛ شمارش تلاش را نمی‌سوزاند و حالت token را تغییر نمی‌دهد.

// PairingStatus وضعیت جفت‌سازی یک کد.
type PairingStatus struct {
	OK      bool   `json:"ok"`
	Paired  bool   `json:"paired,omitempty"`
	Channel string `json:"channel,omitempty"`
	Error   string `json:"error,omitempty"`
}

// CheckPairingStatus پورت checkPairingStatus.
func (s *Service) CheckPairingStatus(ctx context.Context, userID int64, rawCode string) PairingStatus {
	if !linkAllowed(fmt.Sprintf("msg-link-status:%d", userID), 30, 600) {
		return PairingStatus{Error: LinkGenericError}
	}
	param := strings.TrimSpace(rawCode)
	if param == "" {
		return PairingStatus{Error: LinkGenericError}
	}
	digest := sha256Hex(param)
	var id int64
	var channel, tokenHash, codeHash string
	var pendingChatID *string
	var expiresAt time.Time
	var usedAt *time.Time
	err := s.Pool.QueryRow(ctx, `
		select id, channel, "tokenHash", "codeHash", "pendingChatId", "expiresAt", "usedAt"
		  from messenger_link_tokens
		 where "userId" = $1 and ("tokenHash" = $2 or "codeHash" = $2)
		 limit 1`, userID, digest).
		Scan(&id, &channel, &tokenHash, &codeHash, &pendingChatID, &expiresAt, &usedAt)
	if err != nil || !(timingEqHex(tokenHash, digest) || timingEqHex(codeHash, digest)) {
		return PairingStatus{Error: LinkGenericError}
	}
	if usedAt != nil {
		return PairingStatus{OK: true, Paired: true, Channel: channel}
	}
	if !time.Now().Before(expiresAt) {
		return PairingStatus{Error: LinkGenericError}
	}
	return PairingStatus{OK: true, Paired: pendingChatID != nil && *pendingChatID != "", Channel: channel}
}

// ═══ تأیید نهایی از پورتال ═══

// LinkConfirmResult نتیجهٔ تأیید نهایی اتصال.
type LinkConfirmResult struct {
	OK      bool   `json:"ok"`
	Channel string `json:"channel,omitempty"`
	Error   string `json:"error,omitempty"`
}

// ConfirmLinkToken پورت confirmLinkToken — نشست احرازهویتی پورتال الزامی است
// (هندلر httpapi کاربر را از سشن می‌گیرد) و userId همیشه کاربرِ نشست است.
func (s *Service) ConfirmLinkToken(ctx context.Context, userID int64, rawTokenOrCode string) LinkConfirmResult {
	param := strings.TrimSpace(rawTokenOrCode)
	if param == "" {
		return LinkConfirmResult{Error: LinkGenericError}
	}
	if !linkAllowed(fmt.Sprintf("msg-link-confirm:%d", userID), 10, 600) {
		return LinkConfirmResult{Error: LinkGenericError}
	}

	digest := sha256Hex(param)
	var id int64
	var channel, tokenHash, codeHash string
	var pendingChatID *string
	var expiresAt time.Time
	var usedAt *time.Time
	var attempts int
	err := s.Pool.QueryRow(ctx, `
		select id, channel, "tokenHash", "codeHash", "pendingChatId", "expiresAt", "usedAt", attempts
		  from messenger_link_tokens
		 where "userId" = $1 and ("tokenHash" = $2 or "codeHash" = $2)
		 limit 1`, userID, digest).
		Scan(&id, &channel, &tokenHash, &codeHash, &pendingChatID, &expiresAt, &usedAt, &attempts)

	// attempts فقط روی شکستِ منتسب به ردیف مشخص می‌سوزد — هرگز روی موفقیت،
	// تا replay کد درست پس از اتصال، کاربر را قفل نکند.
	fail := func(why string, withRow bool) LinkConfirmResult {
		if withRow {
			_, _ = s.Pool.Exec(ctx, `update messenger_link_tokens set attempts = attempts + 1 where id = $1`, id)
		}
		linkLog.Warn("link_confirm_failed", logger.Fields{"userId": userID, "why": why, "tokenHash": digest[:12]})
		return LinkConfirmResult{Error: LinkGenericError}
	}

	if err != nil {
		return fail("no_match", false)
	}
	if !(timingEqHex(tokenHash, digest) || timingEqHex(codeHash, digest)) {
		return fail("no_match", false)
	}
	if usedAt != nil {
		return fail("reused", true)
	}
	if !time.Now().Before(expiresAt) {
		return fail("expired", true)
	}
	if attempts >= LinkMaxAttempts {
		return fail("attempts", true)
	}
	if pendingChatID == nil || *pendingChatID == "" {
		// هنوز پیام /start از بات نرسیده — شمارش تلاش منظور می‌شود.
		return fail("no_pairing", true)
	}

	chatID := *pendingChatID
	if _, err := s.Pool.Exec(ctx, `update messenger_link_tokens set "usedAt" = now() where id = $1`, id); err != nil {
		return fail("persist", true)
	}
	if _, err := s.Pool.Exec(ctx, `
		insert into notification_channels ("userId", channel, address, "isActive", "verifiedAt")
		values ($1,$2,$3,1,now())
		on conflict ("userId", channel) do update set address = excluded.address, "isActive" = 1, "verifiedAt" = now()`,
		userID, channel, chatID); err != nil {
		return fail("persist_channel", true)
	}

	linkLog.Info("link_confirmed", logger.Fields{"channel": channel, "userId": userID, "tokenHash": tokenHash[:12]})
	return LinkConfirmResult{OK: true, Channel: channel}
}

// ═══ پاکسازی روزانهٔ توکن‌های مصرف‌شده/منقضی ═══
// حذف: usedAt NOT NULL (مصرف‌شده) یا منقضی‌شدهٔ بیش از یک روز.
// از کرون روزانه صدا زده می‌شود: /api/v2/cron/messenger-link-purge

// PurgeExpiredLinkTokens پورت purgeExpiredLinkTokens — تعداد حذف‌شده‌ها.
func (s *Service) PurgeExpiredLinkTokens(ctx context.Context) (int64, error) {
	tag, err := s.Pool.Exec(ctx, `
		delete from messenger_link_tokens
		 where "usedAt" is not null or "expiresAt" < now() - interval '1 day'`)
	if err != nil {
		return 0, err
	}
	linkLog.Info("link_tokens_purged", logger.Fields{"deleted": tag.RowsAffected()})
	return tag.RowsAffected(), nil
}
