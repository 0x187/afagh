// ═══ ارسال اعلان چندکاناله — پورت lib/messaging.ts ═══
//
//	پیام درون‌سامانه‌ای را هر ماژول خودش درج می‌کند؛ این سرویس کانال‌های
//	بیرونی (پیامک/پیام‌رسان) را می‌فرستد و هر تلاش را در notification_deliveries
//	ثبت می‌کند. هیچ نشانی/کلیدی سخت‌کد نیست — همه از تنظیمات خوانده می‌شود.
package messaging

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"backend-go/internal/settings"
)

// Service سرویس ارسال.
type Service struct {
	Pool     *pgxpool.Pool
	Settings *settings.Store
}

// New ساخت سرویس.
func New(pool *pgxpool.Pool, settingsStore *settings.Store) *Service {
	return &Service{Pool: pool, Settings: settingsStore}
}

// DeliveryResult نتیجهٔ یک کانال.
type DeliveryResult struct {
	Channel     string  `json:"channel"`
	Target      *string `json:"target"`
	Status      string  `json:"status"` // SENT | FAILED | SKIPPED
	Error       *string `json:"error,omitempty"`
	ProviderRef *string `json:"providerRef,omitempty"`
	DurationMs  int     `json:"durationMs,omitempty"`
}

var channelLabels = map[string]string{
	"INAPP": "پیام درون‌سامانه", "SMS": "پیامک", "TELEGRAM": "تلگرام",
	"BALE": "بله", "EITAA": "ایتا", "SOROUSH": "سروش", "IGAP": "ای‌گپ",
}

var validChannels = map[string]bool{
	"INAPP": true, "SMS": true, "TELEGRAM": true, "BALE": true, "EITAA": true, "SOROUSH": true, "IGAP": true,
}

// IsOtpEvent رویدادهای حامل کد یک‌بارمصرف — متن هرگز ذخیره/لاگ نمی‌شود.
func IsOtpEvent(eventCode string) bool {
	return strings.Contains(strings.ToUpper(eventCode), "OTP")
}

func (s *Service) timeoutMs() time.Duration {
	sec := s.Settings.GetNumber(context.Background(), "API_TIMEOUT_SECONDS", 10)
	if sec <= 0 {
		sec = 10
	}
	return time.Duration(sec * float64(time.Second))
}

func (s *Service) setting(ctx context.Context, key string) string {
	v, err := s.Settings.Get(ctx, key)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(v)
}

// httpPostJSON ارسال POST و بازگرداندن متن پاسخ (با محدودیت حجم).
func (s *Service) httpPost(ctx context.Context, urlStr, contentType string, body []byte, headers map[string]string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, s.timeoutMs())
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, urlStr, bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", contentType)
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	client := &http.Client{Timeout: s.timeoutMs()}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	out, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("HTTP %d: %s", resp.StatusCode, truncate(string(out), 160))
	}
	return string(out), nil
}

func truncate(v string, n int) string {
	if len(v) <= n {
		return v
	}
	return v[:n]
}

// addressFor نشانی کاربر در یک کانال (جدول اختصاصی ← موبایل پروفایل برای پیامک).
func (s *Service) addressFor(ctx context.Context, userID int64, channel string) *string {
	var address *string
	var active *int
	err := s.Pool.QueryRow(ctx, `
		select address, "isActive" from notification_channels
		 where "userId" = $1 and channel = $2 limit 1`, userID, channel).Scan(&address, &active)
	if err == nil && address != nil && active != nil && *active == 1 && *address != "" {
		return address
	}
	if channel == "SMS" {
		var mobile *string
		if err := s.Pool.QueryRow(ctx, `select mobile from users where id = $1`, userID).Scan(&mobile); err == nil {
			return mobile
		}
	}
	return nil
}

// activeChannels فهرست کانال‌های فعال از NOTIFY_CHANNELS.
func (s *Service) activeChannels(ctx context.Context) []string {
	raw := s.setting(ctx, "NOTIFY_CHANNELS")
	if raw == "" {
		raw = "INAPP"
	}
	out := []string{}
	for _, c := range strings.Split(raw, ",") {
		c = strings.ToUpper(strings.TrimSpace(c))
		if validChannels[c] {
			out = append(out, c)
		}
	}
	if len(out) == 0 {
		return []string{"INAPP"}
	}
	return out
}

// SendSMS پورت sendSms — سرویس‌دهنده از تنظیمات (KAVENEGAR/SMSIR/FARAPAYAMAK/CUSTOM).
func (s *Service) SendSMS(ctx context.Context, to, text string) DeliveryResult {
	started := time.Now()
	provider := strings.ToUpper(s.setting(ctx, "SMS_PROVIDER"))
	key := s.setting(ctx, "SMS_API_KEY")
	sender := s.setting(ctx, "SMS_SENDER")
	base := strings.TrimRight(s.setting(ctx, "SMS_BASE_URL"), "/")

	if provider == "" {
		return DeliveryResult{Channel: "SMS", Target: ptr(to), Status: "SKIPPED", Error: ptr("سرویس‌دهندهٔ پیامک تنظیم نشده است.")}
	}
	if strings.TrimSpace(to) == "" {
		return DeliveryResult{Channel: "SMS", Status: "SKIPPED", Error: ptr("شمارهٔ موبایل کاربر ثبت نشده است.")}
	}
	ref := ""
	var err error
	switch provider {
	case "KAVENEGAR":
		root := base
		if root == "" {
			root = "https://api.kavenegar.com"
		}
		form := url.Values{"receptor": {to}, "sender": {sender}, "message": {text}}
		ref, err = s.httpPost(ctx, root+"/v1/"+url.PathEscape(key)+"/sms/send.json",
			"application/x-www-form-urlencoded", []byte(form.Encode()), nil)
	case "SMSIR":
		root := base
		if root == "" {
			root = "https://api.sms.ir"
		}
		payload, _ := json.Marshal(map[string]any{"lineNumber": sender, "messageText": text, "mobiles": []string{to}})
		ref, err = s.httpPost(ctx, root+"/v1/send/bulk", "application/json", payload,
			map[string]string{"x-api-key": key, "accept": "application/json"})
	case "FARAPAYAMAK":
		root := base
		if root == "" {
			root = "https://rest.payamak-panel.com"
		}
		payload, _ := json.Marshal(map[string]any{"username": sender, "password": key, "to": to, "from": sender, "text": text})
		ref, err = s.httpPost(ctx, root+"/api/SendSMS/SendSMS", "application/json", payload, nil)
	default:
		if base == "" {
			err = errors.New("برای سرویس دلخواه، «نشانی سرویس پیامک» را با جای‌گاه‌های {to} و {text} پر کنید.")
			break
		}
		u := strings.NewReplacer(
			"{to}", url.QueryEscape(to),
			"{text}", url.QueryEscape(text),
			"{sender}", url.QueryEscape(sender),
			"{key}", url.QueryEscape(key),
		).Replace(base)
		ref, err = s.httpPost(ctx, u, "application/json", nil, nil)
	}
	ref = truncate(ref, 100)
	duration := int(time.Since(started).Milliseconds())
	if err != nil {
		return DeliveryResult{Channel: "SMS", Target: ptr(to), Status: "FAILED", Error: ptr(err.Error()), DurationMs: duration}
	}
	return DeliveryResult{Channel: "SMS", Target: ptr(to), Status: "SENT", ProviderRef: ptr(ref), DurationMs: duration}
}

// messengerConfig پیکربندی هر پیام‌رسان.
func (s *Service) messengerConfig(ctx context.Context, channel string) (token, base, style string) {
	switch channel {
	case "TELEGRAM":
		base = s.setting(ctx, "TELEGRAM_API_BASE")
		if base == "" {
			base = "https://api.telegram.org"
		}
		return s.setting(ctx, "TELEGRAM_TOKEN"), base, "BOT"
	case "BALE":
		base = s.setting(ctx, "BALE_API_BASE")
		if base == "" {
			base = "https://tapi.bale.ai"
		}
		return s.setting(ctx, "BALE_TOKEN"), base, "BOT"
	case "SOROUSH":
		base = s.setting(ctx, "SOROUSH_API_BASE")
		if base == "" {
			base = "https://api.splus.ir"
		}
		return s.setting(ctx, "SOROUSH_TOKEN"), base, "BOT"
	case "IGAP":
		base = s.setting(ctx, "IGAP_API_BASE")
		if base == "" {
			base = "https://igap.ai/api"
		}
		return s.setting(ctx, "IGAP_TOKEN"), base, "BOT"
	default: // EITAA
		base = s.setting(ctx, "EITAA_API_BASE")
		if base == "" {
			base = "https://eitaayar.ir/api"
		}
		return s.setting(ctx, "EITAA_TOKEN"), base, "EITAA"
	}
}

// SendMessenger پورت sendMessenger.
func (s *Service) SendMessenger(ctx context.Context, channel, chatID, text string) DeliveryResult {
	started := time.Now()
	token, base, style := s.messengerConfig(ctx, channel)
	label := channelLabels[channel]
	if label == "" {
		label = channel
	}
	if token == "" {
		return DeliveryResult{Channel: channel, Target: ptr(chatID), Status: "SKIPPED", Error: ptr("توکن ربات " + label + " تنظیم نشده است.")}
	}
	if strings.TrimSpace(chatID) == "" {
		return DeliveryResult{Channel: channel, Status: "SKIPPED", Error: ptr("شناسهٔ کاربر در این پیام‌رسان ثبت نشده است.")}
	}
	root := strings.TrimRight(base, "/")
	urlStr := root + "/bot" + token + "/sendMessage"
	if style == "EITAA" {
		urlStr = root + "/" + token + "/sendMessage"
	}
	payload, _ := json.Marshal(map[string]any{"chat_id": chatID, "text": text})
	ref, err := s.httpPost(ctx, urlStr, "application/json", payload, nil)
	duration := int(time.Since(started).Milliseconds())
	if err != nil {
		return DeliveryResult{Channel: channel, Target: ptr(chatID), Status: "FAILED", Error: ptr(err.Error()), DurationMs: duration}
	}
	return DeliveryResult{Channel: channel, Target: ptr(chatID), Status: "SENT", ProviderRef: ptr(truncate(ref, 100)), DurationMs: duration}
}

// NotifyExternal ارسال بیرونی یک رویداد (پیامک/پیام‌رسان) + ثبت تحویل‌ها.
// پیام درون‌سامانه را فراخوان درج کرده است؛ این‌جا فقط کانال‌های بیرونی.
func (s *Service) NotifyExternal(ctx context.Context, userID int64, eventCode, text string) {
	s.NotifyExternalWithChannels(ctx, userID, eventCode, text, nil)
}

// NotifyExternalWithChannels همان NotifyExternal با محدودسازی اختیاری کانال‌ها
// (SCHED_WARN_CHANNELS). لیست خالی/nil یعنی «همهٔ کانال‌های فعال».
func (s *Service) NotifyExternalWithChannels(ctx context.Context, userID int64, eventCode, text string, channels []string) {
	if s == nil || userID <= 0 {
		return
	}
	if !s.Settings.GetBool(ctx, "NOTIFY_ENABLED") {
		return
	}
	signature := s.setting(ctx, "NOTIFY_SIGNATURE")
	body := text
	if signature != "" {
		body = text + "\n" + signature
	}
	storedBody := truncate(body, 1000)
	if IsOtpEvent(eventCode) {
		storedBody = "[REDACTED]"
	}
	var notificationID *int64
	var id int64
	if err := s.Pool.QueryRow(ctx, `
		select id from notifications where "userId" = $1 and "eventCode" = $2 order by id desc limit 1`, userID, eventCode).Scan(&id); err == nil {
		notificationID = &id
	}
	active := s.activeChannels(ctx)
	if len(channels) > 0 {
		allowed := map[string]bool{}
		for _, c := range channels {
			c = strings.ToUpper(strings.TrimSpace(c))
			if validChannels[c] {
				allowed[c] = true
			}
		}
		filtered := []string{}
		for _, c := range active {
			if allowed[c] {
				filtered = append(filtered, c)
			}
		}
		active = filtered
	}
	results := []DeliveryResult{}
	for _, ch := range active {
		if ch == "INAPP" {
			continue
		}
		target := s.addressFor(ctx, userID, ch)
		var r DeliveryResult
		if target == nil {
			r = DeliveryResult{Channel: ch, Status: "SKIPPED", Error: ptr("نشانی کاربر در این کانال ثبت نشده است.")}
		} else if ch == "SMS" {
			r = s.SendSMS(ctx, *target, body)
		} else {
			r = s.SendMessenger(ctx, ch, *target, body)
		}
		results = append(results, r)
	}
	for _, r := range results {
		_, _ = s.Pool.Exec(ctx, `
			insert into notification_deliveries ("userId","notificationId","eventCode",channel,target,status,"providerRef",error,body,"durationMs")
			values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
			userID, notificationID, eventCode, r.Channel, r.Target, r.Status, r.ProviderRef, r.Error, storedBody, r.DurationMs)
	}
}

// ListUserChannels نشانی‌های ثبت‌شدهٔ کاربر.
func (s *Service) ListUserChannels(ctx context.Context, userID int64) ([]map[string]any, error) {
	rows, err := s.Pool.Query(ctx, `
		select channel, address, "isActive" from notification_channels where "userId" = $1 order by channel`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var ch, address string
		var active *int
		if err := rows.Scan(&ch, &address, &active); err == nil {
			on := active != nil && *active == 1
			out = append(out, map[string]any{"channel": ch, "address": address, "isActive": on, "label": channelLabels[ch]})
		}
	}
	return out, nil
}

// SaveUserChannel ثبت/حذف نشانی کاربر با اعتبارسنجی موبایل.
func (s *Service) SaveUserChannel(ctx context.Context, userID int64, channel, address string) error {
	value := strings.TrimSpace(address)
	if value == "" {
		_, err := s.Pool.Exec(ctx, `delete from notification_channels where "userId" = $1 and channel = $2`, userID, channel)
		return err
	}
	if channel == "SMS" {
		if len(value) != 11 || !strings.HasPrefix(value, "09") {
			return errors.New("شمارهٔ موبایل باید ۱۱ رقم و با ۰۹ آغاز شود.")
		}
		for _, r := range value {
			if r < '0' || r > '9' {
				return errors.New("شمارهٔ موبایل باید ۱۱ رقم و با ۰۹ آغاز شود.")
			}
		}
	}
	_, err := s.Pool.Exec(ctx, `
		insert into notification_channels ("userId", channel, address, "isActive")
		values ($1,$2,$3,1)
		on conflict ("userId", channel) do update set address = excluded.address, "isActive" = 1`,
		userID, channel, value)
	return err
}

func ptr[T any](v T) *T { return &v }

// Default سرویس سراسری — main یک‌بار مقدار می‌دهد تا ماژول‌ها بدون وابستگی
// ساختاری، ارسال بیرونی را صدا بزنند.
var Default *Service

// NotifyExternalDefault ارسال بیرونی با سرویس سراسری (no-op اگر تنظیم نشده باشد).
func NotifyExternalDefault(ctx context.Context, userID int64, eventCode, text string) {
	if Default == nil || userID <= 0 {
		return
	}
	Default.NotifyExternal(ctx, userID, eventCode, text)
}

// NotifyExternalDefaultChannels ارسال با محدودسازی کانال‌ها.
func NotifyExternalDefaultChannels(ctx context.Context, userID int64, eventCode, text string, channels []string) {
	if Default == nil || userID <= 0 {
		return
	}
	Default.NotifyExternalWithChannels(ctx, userID, eventCode, text, channels)
}
