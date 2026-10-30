// ═══ کرون هشدارهای زمان‌بندی‌شده — پورت runPendingWarnings ═══
package cron

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"backend-go/internal/messaging"
)

var warnTypeLabel = map[string]string{
	"TUITION_DEADLINE": "یادآوری شهریه",
	"LOW_ATTENDANCE":   "هشدار غیبت",
	"MISSING_DOCS":     "نقص مدارک",
	"EXAM_REMINDER":    "یادآوری امتحان",
	"ENROLL_DEADLINE":  "مهلت انتخاب واحد",
	"CUSTOM":           "دلخواه",
}

var warnValidChannels = map[string]bool{
	"INAPP": true, "SMS": true, "TELEGRAM": true, "BALE": true,
	"EITAA": true, "SOROUSH": true, "IGAP": true,
}

// schedWarnChannels کانال‌های مجاز از SCHED_WARN_CHANNELS؛ خالی = همهٔ فعال‌ها.
func (e *Engine) schedWarnChannels(ctx context.Context) []string {
	raw, _ := e.Settings.Get(ctx, "SCHED_WARN_CHANNELS")
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	out := []string{}
	for _, c := range strings.Split(raw, ",") {
		c = strings.ToUpper(strings.TrimSpace(c))
		if warnValidChannels[c] {
			out = append(out, c)
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func (e *Engine) notifyUserChannels(ctx context.Context, userID int64, eventCode, text string, channels []string) {
	if userID <= 0 {
		return
	}
	payload, _ := json.Marshal(map[string]string{"text": text})
	_, _ = e.Pool.Exec(ctx, `insert into notifications ("userId","eventCode",payload) values ($1,$2,$3)`,
		userID, eventCode, string(payload))
	messaging.NotifyExternalDefaultChannels(ctx, userID, eventCode, text, channels)
}

// runScheduledWarnings ارسال ردیف‌های pending با sendAt <= اکنون (حداکثر ۵۰۰).
// ضدتکرار: فقط بعد از ارسال موفق status=sent می‌شود؛ خطا ردیف را pending
// نگه می‌دارد تا دور بعد دوباره تلاش شود (همان رفتار TS).
func (e *Engine) runScheduledWarnings(ctx context.Context) (map[string]any, error) {
	type warnRow struct {
		ID          int64
		StudentID   int64
		WarningType *string
		Title       *string
		Message     *string
		UserID      *int64
		FirstName   *string
		LastName    *string
	}
	rows, err := e.Pool.Query(ctx, `
		select w.id, w."studentId", w."warningType", w.title, w.message, s."userId",
		       u."firstName", u."lastName"
		  from scheduled_warnings w
		  join students s on s.id = w."studentId"
		  left join users u on u.id = s."userId"
		 where w.status = 'pending' and w."sendAt" <= now()
		 order by w."sendAt"
		 limit 500`)
	if err != nil {
		return nil, err
	}
	list := []warnRow{}
	for rows.Next() {
		var w warnRow
		if err := rows.Scan(&w.ID, &w.StudentID, &w.WarningType, &w.Title, &w.Message,
			&w.UserID, &w.FirstName, &w.LastName); err == nil {
			list = append(list, w)
		}
	}
	rows.Close()
	if len(list) == 0 {
		return map[string]any{"due": 0, "sent": 0, "skipped": 0, "failed": 0}, nil
	}
	channels := e.schedWarnChannels(ctx)
	sent, skipped, failed := 0, 0, 0
	now := time.Now().UTC()
	for _, w := range list {
		if w.UserID == nil || *w.UserID <= 0 {
			// دانشجو بدون کاربر متصل — لغو تا هر دور دوباره تلاش نشود.
			_, _ = e.Pool.Exec(ctx, `update scheduled_warnings set status = 'cancelled', "sentAt" = $2 where id = $1`, w.ID, now)
			skipped++
			continue
		}
		wtype := "CUSTOM"
		if w.WarningType != nil && strings.TrimSpace(*w.WarningType) != "" {
			wtype = strings.ToUpper(strings.TrimSpace(*w.WarningType))
		}
		title := ""
		if w.Title != nil {
			title = strings.TrimSpace(*w.Title)
		}
		if title == "" {
			if label, ok := warnTypeLabel[wtype]; ok {
				title = label
			} else {
				title = wtype
			}
		}
		body := title
		if w.Message != nil && strings.TrimSpace(*w.Message) != "" {
			body += "\n" + strings.TrimSpace(*w.Message)
		}
		eventType := wtype
		if len(eventType) > 20 {
			eventType = eventType[:20]
		}
		e.notifyUserChannels(ctx, *w.UserID, "SCHED_WARN_"+eventType, body, channels)
		if _, err := e.Pool.Exec(ctx, `update scheduled_warnings set status = 'sent', "sentAt" = now() where id = $1`, w.ID); err != nil {
			failed++
			continue
		}
		sent++
	}
	return map[string]any{"due": len(list), "sent": sent, "skipped": skipped, "failed": failed}, nil
}
