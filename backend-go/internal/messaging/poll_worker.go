// ═══ Poll worker جفت‌سازی توکن — پورت lib/messenger-poll-worker.ts ═══
//
//	وب‌هوک inbound وجود ندارد؛ این worker با getUpdates (long-poll ۲۵ ثانیه)
//	فقط پیام‌های /start <token> را می‌خواند و chatId را PENDING ثبت می‌کند.
//	به هر پیام دیگری، پاسخ آموزشی ثابت (send-only) می‌دهد.
//
//	قفل Redis تک‌نمونه‌ای بودن را تضمین می‌کند؛ اجرای هم‌زمان چند نمونه امن است
//	(بقیه منتظر می‌مانند یا بی‌درنگ برمی‌گردند). آفست هر کانال در
//	messenger_poll_offsets نگه داشته می‌شود و فقط پس از موفقیت جلو می‌رود
//	(at-least-once).
package messaging

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"

	"backend-go/internal/logger"
)

const (
	longPollSec    = 25
	lockTTLSec     = 25
	heartbeatEvery = 10 * time.Second
	lockWaitEvery  = 5 * time.Second
	backoffStart   = time.Second
	backoffCap     = 60 * time.Second
)

var pollLog = logger.For("messenger-poll")

// ═══ آپدیت ورودی (زیرمجموعهٔ لازم از ساختار getUpdates) ═══

type messengerUpdate struct {
	UpdateID int64 `json:"update_id"`
	Message  *struct {
		Chat *struct {
			ID   any    `json:"id"` // عدد یا رشته — بسته به پلتفرم
			Type string `json:"type"`
		} `json:"chat"`
		Text string `json:"text"`
	} `json:"message"`
}

func chatIDString(v any) string {
	switch t := v.(type) {
	case float64:
		return strconv.FormatInt(int64(t), 10)
	case string:
		return t
	case nil:
		return ""
	default:
		return fmt.Sprint(t)
	}
}

// ═══ آفست poll (جدول messenger_poll_offsets) ═══

func (s *Service) loadOffset(ctx context.Context, channel string) int64 {
	var offset int64
	_ = s.Pool.QueryRow(ctx, `select offset from messenger_poll_offsets where channel = $1 limit 1`, channel).Scan(&offset)
	return offset
}

func (s *Service) saveOffset(ctx context.Context, channel string, offset int64) {
	_, _ = s.Pool.Exec(ctx, `
		insert into messenger_poll_offsets (channel, offset, "updatedAt")
		values ($1,$2,now())
		on conflict (channel) do update set offset = excluded.offset, "updatedAt" = now()`,
		channel, offset)
}

// ═══ فراخوانی getUpdates ═══

// botConfig توکن/نشانی API کانال از تنظیمات (DB → ENV → پیش‌فرض).
func (s *Service) botConfig(ctx context.Context, channel string) (token, base, style string) {
	cfg := messengerLinkConfigs[channel]
	token = s.rawSetting(ctx, cfg.TokenKey, cfg.TokenEnv, "")
	base = strings.TrimRight(s.rawSetting(ctx, cfg.BaseKey, cfg.BaseEnv, cfg.DefaultBase), "/")
	return token, base, cfg.Style
}

// sendBotMessage ارسال مستقیم به chatId (پورت sendMessage در messenger-bot.ts —
// فقط-ارسال، بدون ثبت تحویل؛ متن با parse_mode HTML).
func (s *Service) sendBotMessage(ctx context.Context, channel, chatID, text string) bool {
	token, base, style := s.botConfig(ctx, channel)
	if token == "" || strings.TrimSpace(chatID) == "" {
		return false
	}
	url := base + "/bot" + token + "/sendMessage"
	if style == "EITAA" {
		url = base + "/" + token + "/sendMessage"
	}
	payload, _ := json.Marshal(map[string]any{"chat_id": chatID, "text": text, "parse_mode": "HTML"})
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		return false
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
	if err != nil {
		pollLog.Error("messenger_send_failed", logger.Fields{"channel": channel, "error": err.Error()})
		return false
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 1024))
	return resp.StatusCode >= 200 && resp.StatusCode < 300
}

func (s *Service) fetchUpdates(ctx context.Context, channel string, offset int64) ([]messengerUpdate, error) {
	token, base, style := s.botConfig(ctx, channel)
	if token == "" {
		return nil, errors.New("getUpdates_no_token")
	}
	url := base + "/bot" + token + "/getUpdates"
	if style == "EITAA" {
		url = base + "/" + token + "/getUpdates"
	}
	payload, _ := json.Marshal(map[string]any{
		"offset": offset, "timeout": longPollSec, "allowed_updates": []string{"message"},
	})
	ctx, cancel := context.WithTimeout(ctx, time.Duration(longPollSec+10)*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := (&http.Client{Timeout: time.Duration(longPollSec+10) * time.Second}).Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	// 409 یعنی یک getUpdates دیگر هم‌زمان فعال است (نمونهٔ قدیمی در حال خاموشی
	// یا تست دستی) — با خطای مشخص لاگ می‌شود تا با قطعی واقعی اشتباه نشود.
	if resp.StatusCode == http.StatusConflict {
		return nil, errors.New("getUpdates_http409_conflict")
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("getUpdates_http%d", resp.StatusCode)
	}
	var data struct {
		OK     *bool             `json:"ok"`
		Result []messengerUpdate `json:"result"`
	}
	if err := json.Unmarshal(body, &data); err != nil {
		return nil, err
	}
	if data.Result == nil {
		data.Result = []messengerUpdate{}
	}
	return data.Result, nil
}

// ═══ پردازش یک آپدیت — فقط-ارسال ═══
//
//	inbound پیش‌فرض خاموش است (پرچم *_BOT_ENABLED، fail-closed). در صورت
//	روشن‌بودن صریح پرچم، فقط جفت‌سازی توکن (/start <token>) پذیرفته می‌شود.
//	هیچ دستور تعاملی، هیچ رمزی، هیچ وضعیت مکالمه‌ای.
//
//	INVARIANT (امنیتی — معماری poll-worker): این مسیر inbound به‌تنهایی
//	هیچ مقصد تحویلی را برقرار/جابه‌جا نمی‌کند. تنها اثرِ آن، ثبتِ سرنخِ
//	تأییدنشدهٔ pendingChatId از راه HandlePairingText است؛ نوشتنِ
//	notification_channels فقط در ConfirmLinkToken انجام می‌شود.
func (s *Service) handleOne(ctx context.Context, channel string, u messengerUpdate) error {
	msg := u.Message
	if msg == nil || msg.Chat == nil || msg.Chat.Type != "private" {
		return nil
	}
	chatID := chatIDString(msg.Chat.ID)
	if chatID == "" {
		return nil
	}
	text := strings.TrimSpace(msg.Text)
	if text == "" {
		return nil
	}

	// poll worker خودش مبدأ مطمئن است (توکن بات) — سطل per-chat می‌ماند.
	if reply := s.HandlePairingText(ctx, channel, chatID, text, ""); reply != "" {
		s.sendBotMessage(ctx, channel, chatID, reply)
		return nil
	}
	portal := ""
	if s.Settings != nil {
		if v, err := s.Settings.Get(ctx, "PUBLIC_BASE_URL"); err == nil {
			portal = strings.TrimRight(strings.TrimSpace(v), "/")
		}
	}
	reply := "این بات فقط اعلان خودکار می‌فرستد و به پیام‌ها پاسخ نمی‌دهد."
	if portal != "" {
		reply += "\nبرای اتصال حساب و پیگیری امور، به پورتال مراجعه کنید:\n" + portal
	}
	s.sendBotMessage(ctx, channel, chatID, reply)
	return nil
}

// ═══ حلقهٔ polling با قفل Redis ═══

type pollRun struct {
	stop chan struct{}
	done chan struct{}
}

var (
	pollMu   sync.Mutex
	pollRuns = map[string]*pollRun{}
)

// StartPolling شروع long-poll برای یک کانال (BALE/EITAA/SOROUSH).
// قفل Redis تک‌نمونه‌ای: اگر نمونهٔ دیگری زنده باشد، این فراخوانی منتظر می‌ماند
// تا قفل آزاد شود (همان رفتار حلقهٔ retry در TS).
func (s *Service) StartPolling(rdb *redis.Client, channel string) (bool, string) {
	if !IsPollChannel(channel) {
		return false, fmt.Sprintf("poll برای %s پشتیبانی نمی‌شود (فقط BALE، EITAA، SOROUSH).", channel)
	}
	if rdb == nil {
		return false, "برای poll worker به Redis نیاز است (REDIS_URL)."
	}
	pollMu.Lock()
	if _, running := pollRuns[channel]; running {
		pollMu.Unlock()
		return true, ""
	}
	run := &pollRun{stop: make(chan struct{}), done: make(chan struct{})}
	pollRuns[channel] = run
	pollMu.Unlock()

	go s.pollLoop(rdb, channel, run)
	return true, ""
}

// StopPolling توقف حلقهٔ کانال (اگر در حال اجرا باشد).
func StopPolling(channel string) {
	pollMu.Lock()
	run, ok := pollRuns[channel]
	pollMu.Unlock()
	if ok {
		close(run.stop)
		<-run.done
	}
}

func (s *Service) pollLoop(rdb *redis.Client, channel string, run *pollRun) {
	defer close(run.done)
	ctx := context.Background()
	instanceID := fmt.Sprintf("%d:%d", os.Getpid(), time.Now().UnixNano())
	lockKey := "poll:lock:" + channel

	// قفل ممکن است از پروسهٔ قبلیِ مرده مانده باشد (TTL تا ۲۵ ثانیه)؛
	// تسلیم نمی‌شویم — تا آزاد شدن، هر ۵ ثانیه retry می‌کنیم.
	acquired := false
	for !acquired {
		select {
		case <-run.stop:
			pollMu.Lock()
			delete(pollRuns, channel)
			pollMu.Unlock()
			return
		case <-time.After(lockWaitEvery):
		}
		ok, err := rdb.SetNX(ctx, lockKey, instanceID, lockTTLSec*time.Second).Result()
		if err == nil && ok {
			acquired = true
		} else {
			pollLog.Info("poll_lock_wait", logger.Fields{"channel": channel})
		}
	}

	// ضربان: تمدید قفل؛ اگر قفل به دیگری رسید، توقف.
	heartbeat := time.NewTicker(heartbeatEvery)
	stopped := false
	go func() {
		defer heartbeat.Stop()
		for range heartbeat.C {
			select {
			case <-run.stop:
				return
			default:
			}
			v, err := rdb.Get(ctx, lockKey).Result()
			if err == nil && v == instanceID {
				_ = rdb.Expire(ctx, lockKey, lockTTLSec*time.Second).Err()
			} else if !stopped {
				pollLog.Warn("poll_lock_lost", logger.Fields{"channel": channel})
				select {
				case <-run.stop:
				default:
					close(run.stop)
				}
				return
			}
		}
	}()
	defer func() {
		stopped = true
		pollMu.Lock()
		delete(pollRuns, channel)
		pollMu.Unlock()
		// آزادسازی قفل فقط اگر مالِ این نمونه باشد.
		if v, err := rdb.Get(ctx, lockKey).Result(); err == nil && v == instanceID {
			_ = rdb.Del(ctx, lockKey).Err()
		}
		pollLog.Info("poll_stopped", logger.Fields{"channel": channel})
	}()

	offset := s.loadOffset(ctx, channel)
	backoff := backoffStart
	pollLog.Info("poll_started", logger.Fields{"channel": channel, "offset": offset})

	for {
		select {
		case <-run.stop:
			return
		default:
		}
		if v, err := rdb.Get(ctx, lockKey).Result(); err != nil || v != instanceID {
			pollLog.Warn("poll_lock_lost", logger.Fields{"channel": channel})
			return
		}

		updates, err := s.fetchUpdates(ctx, channel, offset)
		if err != nil {
			pollLog.Warn("poll_backoff", logger.Fields{"channel": channel, "waitMs": backoff.Milliseconds(), "error": err.Error()})
			select {
			case <-run.stop:
				return
			case <-time.After(backoff):
			}
			backoff = min(backoff*2, backoffCap)
			continue
		}

		for _, u := range updates {
			if err := s.handleOne(ctx, channel, u); err != nil {
				pollLog.Error("poll_update_failed", logger.Fields{"channel": channel, "update_id": u.UpdateID, "error": err.Error()})
				continue
			}
			// آفست فقط پس از موفقیت جلو می‌رود — شکست، آپدیت را برای دور
			// بعد نگه می‌دارد و هرگز بی‌صدا رد نمی‌شود (at-least-once).
			if u.UpdateID+1 > offset {
				offset = u.UpdateID + 1
			}
		}
		if len(updates) > 0 {
			s.saveOffset(ctx, channel, offset)
		}
		backoff = backoffStart // موفقیت → ریست
	}
}

// StartAllPolling شروع همهٔ کانال‌های poll — کانال بدون توکن، یک‌بار info
// می‌خورد و رد می‌شود (نه warn هر دقیقه). از main یک‌بار در شروع صدا زده می‌شود.
func (s *Service) StartAllPolling(rdb *redis.Client) {
	if rdb == nil {
		pollLog.Info("poll_disabled_no_redis", nil)
		return
	}
	for _, ch := range PollChannels {
		if token, _, _ := s.botConfig(context.Background(), ch); token == "" {
			pollLog.Info("poll_skipped_no_token", logger.Fields{"channel": ch})
			continue
		}
		if ok, errMsg := s.StartPolling(rdb, ch); !ok {
			pollLog.Warn("poll_start_rejected", logger.Fields{"channel": ch, "error": errMsg})
		}
	}
}
