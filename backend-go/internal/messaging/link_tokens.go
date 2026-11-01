// ═══ Messenger link tokens — port of lib/messenger-link-tokens.ts ═══
//
//	Flow: user signs in to the portal → MintLinkToken (human code + deep link)
//	→ sends /start <token> in the bot (the poll worker records PENDING)
//	→ the user clicks ConfirmLinkToken in the portal → verifiedAt=now.
//	The raw code/token is never stored; only their sha256. The error message for all
//	verification failures is single and generic (anti-enumeration).
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
	// LinkTTLMin link code validity (minutes).
	LinkTTLMin = 10
	// LinkMaxAttempts max failed verification attempts per token.
	LinkMaxAttempts = 5
)

// codeAlphabet unambiguous alphabet (no 0/O or 1/I) for the human code.
const codeAlphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"
const codeLen = 8

// LinkGenericError single generic error message for all token failures (anti-enumeration).
const LinkGenericError = "کد اتصال نامعتبر است یا منقضی شده. از پورتال یک کد تازه بگیرید."

var linkLog = logger.For("messenger-link")

// ═══ Channels and per-messenger API configuration (port of MESSENGER_CONFIGS) ═══

// messengerLinkCfg full configuration of a messenger — each key's ENV from SETTING_DEFS.
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

// PollChannels channels supported by the poll worker (getUpdates).
var PollChannels = []string{"BALE", "EITAA", "SOROUSH"}

// LinkableChannels channels for which new linking is open.
// iGap: poll unproven — new linking is frozen.
var LinkableChannels = []string{"TELEGRAM", "BALE", "EITAA", "SOROUSH"}

// IsLinkable whether linking is open for this channel.
func IsLinkable(channel string) bool {
	for _, c := range LinkableChannels {
		if c == channel {
			return true
		}
	}
	return false
}

// IsPollChannel whether this channel is polled.
func IsPollChannel(channel string) bool {
	for _, c := range PollChannels {
		if c == channel {
			return true
		}
	}
	return false
}

// IsMessengerChannel whether this key is one of the five messengers.
func IsMessengerChannel(channel string) bool {
	_, ok := messengerLinkConfigs[channel]
	return ok
}

func freezeMessage(channel string) string {
	return "اتصال جدید " + channel + " در حال حاضر فعال نیست. اعلان‌ها را از پیامک یا پیام‌رسان دیگری دنبال کنید."
}

// ═══ Reading additional setting keys ═══
//
// These keys (bot tokens, additional cron secrets, congratulation texts) are not yet
// defined in PhaseOneDefs; the same system precedence is implemented:
// 1) system_settings table  2) ENV  3) default — with the same Store's 15-second cache.
// Once the keys are added to PhaseOneDefs, Settings.Get returns the same result.

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

// rawSetting reads a key with precedence DB → ENV → default.
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

// SettingRaw is the out-of-package version for additional crons and httpapi handlers.
func SettingRaw(ctx context.Context, s *Service, key, env, fallback string) string {
	return s.rawSetting(ctx, key, env, fallback)
}

// ═══ Rate limiting ═══

var linkLimiter *ratelimit.Limiter

// SetRateLimiter supplies the rate limiter to the messaging package (from main).
func SetRateLimiter(l *ratelimit.Limiter) { linkLimiter = l }

// linkAllowed is the same as the client's rateLimit(): infrastructure error → allow (its in-memory fallback is inside Limiter).
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

// ═══ Hash/code utilities ═══

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

// timingEqHex constant-time comparison of two hash strings.
func timingEqHex(aHex, bHex string) bool {
	a, err1 := hex.DecodeString(aHex)
	b, err2 := hex.DecodeString(bHex)
	if err1 != nil || err2 != nil || len(a) != len(b) {
		return false
	}
	return subtle.ConstantTimeCompare(a, b) == 1
}

// ═══ Token minting ═══

// MintResult is the result of minting a link code.
type MintResult struct {
	OK          bool      `json:"ok"`
	Code        string    `json:"code,omitempty"`
	Token       string    `json:"token,omitempty"`
	DeepLink    *string   `json:"deepLink"`
	PairingText string    `json:"pairingText,omitempty"`
	ExpiresAt   time.Time `json:"expiresAt,omitempty"`
	Error       string    `json:"error,omitempty"`
}

// MintLinkToken mints a link code for a channel (port of mintLinkTokenFor).
func (s *Service) MintLinkToken(ctx context.Context, userID int64, channel string) MintResult {
	if !IsLinkable(channel) {
		return MintResult{Error: freezeMessage(channel)}
	}
	if !linkAllowed(fmt.Sprintf("msg-link-mint:%d", userID), 5, 3600) {
		return MintResult{Error: "تعداد درخواست کد اتصال بیش از حد مجاز است. ساعتی دیگر دوباره تلاش کنید."}
	}

	tokBuf := make([]byte, 24)
	_, _ = rand.Read(tokBuf)
	token := hex.EncodeToString(tokBuf) // 48 digits
	code := randomCode()
	expiresAt := time.Now().Add(LinkTTLMin * time.Minute)

	if _, err := s.Pool.Exec(ctx, `
		insert into messenger_link_tokens ("userId", channel, "tokenHash", "codeHash", "pendingChatId", "expiresAt", "usedAt", attempts)
		values ($1,$2,$3,$4,null,$5,null,0)`,
		userID, channel, sha256Hex(token), sha256Hex(code), expiresAt); err != nil {
		return MintResult{Error: LinkGenericError}
	}

	// Deep link only when a bot username is configured; otherwise a text command.
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

// ═══ Pairing message recording (/start <param> from the bot) ═══
//
//	Long param = full deep-link token; 8-digit = human code. Only hashes are logged.
//
//	INVARIANT (security): this function only writes an "unverified hint" (pendingChatId)
//	onto the token row — it never creates or changes a notification delivery destination (notification_channels)
//	the delivery destination is registered only in ConfirmLinkToken and only
//	with an authenticated portal session.

var startCmdRe = regexp.MustCompile(`^/start(?:@\S+)?\s*(\S+)?\s*$`)
var bareCodeRe = regexp.MustCompile(`^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$`)

// HandlePairingText is the port of handlePairingText — it returns the bot reply ("" = no reply).
func (s *Service) HandlePairingText(ctx context.Context, channel, chatID, text, limiterKey string) string {
	// Pairing attempt limit — default bucket (channel, chat) for poll (trusted source:
	// the chatId is provided by the platform API itself with the bot token). A webhook caller must
	// pass limiterKey = the proxy-trusted IP.
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
	// Bale sometimes delivers only /start, or the user sends only the bare code —
	// a standalone 8-digit code is also accepted.
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
	// Constant-time comparison on both hash columns (defense in depth — the WHERE above is exact too)
	if err != nil || !(timingEqHex(tokenHash, digest) || timingEqHex(codeHash, digest)) {
		// No match: there is no row to burn attempts on — attempts are burned only
		// on confirm failures (attributed to a specific row), not here.
		linkLog.Warn("pairing_no_match", logger.Fields{"channel": channel, "paramHash": digest[:12]})
		return LinkGenericError
	}

	// Match: only the pending hint is recorded — attempts are not burned so that
	// re-sending the correct code (or a replay) does not lock the user out.
	if _, err := s.Pool.Exec(ctx, `update messenger_link_tokens set "pendingChatId" = $2 where id = $1`, id, chatID); err != nil {
		return LinkGenericError
	}
	linkLog.Info("pairing_recorded", logger.Fields{"channel": channel, "tokenId": id, "tokenHash": tokenHash[:12]})
	return "کد دریافت شد. ✅\nبه پورتال برگردید — اتصال به‌صورت خودکار تأیید می‌شود."
}

// ═══ Pairing status check (for client-side auto-confirmation) ═══
// Read-only; it does not burn the attempt counter or change the token state.

// PairingStatus pairing status of a code.
type PairingStatus struct {
	OK      bool   `json:"ok"`
	Paired  bool   `json:"paired,omitempty"`
	Channel string `json:"channel,omitempty"`
	Error   string `json:"error,omitempty"`
}

// CheckPairingStatus is the port of checkPairingStatus.
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

// ═══ Final confirmation from the portal ═══

// LinkConfirmResult final link confirmation result.
type LinkConfirmResult struct {
	OK      bool   `json:"ok"`
	Channel string `json:"channel,omitempty"`
	Error   string `json:"error,omitempty"`
}

// ConfirmLinkToken is the port of confirmLinkToken — an authenticated portal session is required
// (the httpapi handler takes the user from the session) and userId is always the session user.
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

	// attempts burn only on a failure attributed to a specific row — never on success,
	// so replaying the correct code after linking does not lock the user out.
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
		// The /start message has not arrived from the bot yet — the attempt counter still applies.
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

// ═══ Daily purge of used/expired tokens ═══
// Delete: usedAt NOT NULL (used) or expired more than one day ago.
// Called from the daily cron: /api/v2/cron/messenger-link-purge

// PurgeExpiredLinkTokens is the port of purgeExpiredLinkTokens — number of deleted rows.
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
