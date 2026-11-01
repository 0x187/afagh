// ═══ Token pairing poll worker — port of lib/messenger-poll-worker.ts ═══
//
//	There is no inbound webhook; this worker uses getUpdates (25-second long-poll)
//	and reads only /start <token> messages, recording the chatId as PENDING.
//	It replies to any other message with a fixed instructional (send-only) response.
//
//	The Redis lock guarantees single-instance operation; running several instances concurrently is safe
//	(the rest wait or return immediately). Each channel's offset is kept in
//	messenger_poll_offsets and advances only after success
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

// ═══ Incoming update (minimal subset of the getUpdates structure) ═══

type messengerUpdate struct {
	UpdateID int64 `json:"update_id"`
	Message  *struct {
		Chat *struct {
			ID   any    `json:"id"` // number or string — depending on the platform
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

// ═══ Poll offset (messenger_poll_offsets table) ═══

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

// ═══ getUpdates call ═══

// botConfig returns the channel token/API address from settings (DB → ENV → default).
func (s *Service) botConfig(ctx context.Context, channel string) (token, base, style string) {
	cfg := messengerLinkConfigs[channel]
	token = s.rawSetting(ctx, cfg.TokenKey, cfg.TokenEnv, "")
	base = strings.TrimRight(s.rawSetting(ctx, cfg.BaseKey, cfg.BaseEnv, cfg.DefaultBase), "/")
	return token, base, cfg.Style
}

// sendBotMessage sends directly to a chatId (port of sendMessage in messenger-bot.ts —
// send-only, without delivery recording; text with parse_mode HTML).
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
	// 409 means another getUpdates is active concurrently (an old instance shutting down
	// or a manual test) — logged with a distinct error so it is not mistaken for a real outage.
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

// ═══ Processing one update — send-only ═══
//
//	inbound is disabled by default (*_BOT_ENABLED flag, fail-closed). If the flag is
//	explicitly enabled, only token pairing (/start <token>) is accepted.
//	No interactive commands, no codes, no conversation state.
//
//	INVARIANT (security — poll-worker architecture): this inbound path alone
//	establishes/moves no delivery destination. Its only effect is recording the
//	unverified pendingChatId hint via HandlePairingText; writing to
//	notification_channels happens only in ConfirmLinkToken.
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

	// the poll worker is itself a trusted source (bot token) — the per-chat bucket remains.
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

// ═══ Polling loop with Redis lock ═══

type pollRun struct {
	stop chan struct{}
	done chan struct{}
}

var (
	pollMu   sync.Mutex
	pollRuns = map[string]*pollRun{}
)

// StartPolling starts long-polling for a channel (BALE/EITAA/SOROUSH).
// Redis single-instance lock: if another instance is alive, this call waits
// until the lock is released (same retry-loop behavior as TS).
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

// StopPolling stops the channel loop (if running).
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

	// the lock may be left over from a dead previous process (TTL up to 25 seconds);
	// we don't give up — retry every 5 seconds until it is released.
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

	// Heartbeat: renew the lock; if the lock went to someone else, stop.
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
		// release the lock only if it belongs to this instance.
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
			// the offset advances only after success — a failure keeps the update for the next
			// round and is never silently dropped (at-least-once).
			if u.UpdateID+1 > offset {
				offset = u.UpdateID + 1
			}
		}
		if len(updates) > 0 {
			s.saveOffset(ctx, channel, offset)
		}
		backoff = backoffStart // success → reset
	}
}

// StartAllPolling starts all poll channels — a channel without a token gets one info
// log and is skipped (not a warn every minute). Called once from main at startup.
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
