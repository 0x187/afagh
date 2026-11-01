// ═══ Notification templates + test message — port of admin/templates ═══
package admin

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"

	"backend-go/internal/messaging"
	"backend-go/internal/session"
)

// TemplateVars a template variable.
type TemplateVars struct {
	Tag         string `json:"tag"`
	Label       string `json:"label"`
	SampleValue string `json:"sampleValue"`
}

// SavedTemplateRow a saved template.
type SavedTemplateRow struct {
	EventCode    string         `json:"eventCode"`
	Title        string         `json:"title"`
	TemplateText string         `json:"templateText"`
	Variables    []TemplateVars `json:"variables"`
	Channels     string         `json:"channels"`
	IsActive     bool           `json:"isActive"`
}

var testableChannels = map[string]bool{
	"SMS": true, "BALE": true, "EITAA": true, "TELEGRAM": true, "SOROUSH": true, "IGAP": true,
}

var asciiDigitRe = regexp.MustCompile(`[۰-۹٠-٩]`)

func toAsciiDigits(s string) string {
	fa := "۰۱۲۳۴۵۶۷۸۹"
	ar := "٠١٢٣٤٥٦٧٨٩"
	return asciiDigitRe.ReplaceAllStringFunc(s, func(d string) string {
		if i := strings.IndexRune(fa, []rune(d)[0]); i >= 0 {
			return fmt.Sprint(i)
		}
		if i := strings.IndexRune(ar, []rune(d)[0]); i >= 0 {
			return fmt.Sprint(i)
		}
		return d
	})
}

// ListNotificationTemplates list of templates (port of listNotificationTemplates).
func (s *Service) ListNotificationTemplates(ctx context.Context) ([]SavedTemplateRow, error) {
	rows, err := s.DB.Pool.Query(ctx, `
		select "eventCode", coalesce(title,''), "templateText", coalesce(variables,'[]'),
		       coalesce(channels, coalesce(channel,'SMS')), coalesce("isActive",1)
		  from notification_templates order by "eventCode"`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []SavedTemplateRow{}
	for rows.Next() {
		var r SavedTemplateRow
		var rawVars string
		var active int
		if err := rows.Scan(&r.EventCode, &r.Title, &r.TemplateText, &rawVars, &r.Channels, &active); err != nil {
			continue
		}
		r.IsActive = active == 1
		r.Variables = []TemplateVars{}
		var parsed []TemplateVars
		if json.Unmarshal([]byte(rawVars), &parsed) == nil {
			for _, v := range parsed {
				if v.Tag != "" {
					r.Variables = append(r.Variables, v)
				}
			}
		}
		if r.Title == "" {
			r.Title = r.EventCode
		}
		if r.Channels == "" {
			r.Channels = "SMS"
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// SaveNotificationTemplate save template (port of saveNotificationTemplate).
func (s *Service) SaveNotificationTemplate(ctx context.Context, in SavedTemplateRow) error {
	eventCode := strings.TrimSpace(in.EventCode)
	if len([]rune(eventCode)) > 60 {
		eventCode = string([]rune(eventCode)[:60])
	}
	if eventCode == "" {
		return errors.New("کد رویداد لازم است.")
	}
	if strings.TrimSpace(in.TemplateText) == "" {
		return errors.New("متن قالب خالی است.")
	}
	title := strings.TrimSpace(in.Title)
	if title == "" {
		title = eventCode
	}
	if len([]rune(title)) > 150 {
		title = string([]rune(title)[:150])
	}
	vars := []TemplateVars{}
	for _, v := range in.Variables {
		tag := strings.TrimSpace(v.Tag)
		if tag == "" {
			continue
		}
		if len(vars) >= 40 {
			break
		}
		if len([]rune(tag)) > 60 {
			tag = string([]rune(tag)[:60])
		}
		label := v.Label
		if len([]rune(label)) > 100 {
			label = string([]rune(label)[:100])
		}
		sample := v.SampleValue
		if len([]rune(sample)) > 200 {
			sample = string([]rune(sample)[:200])
		}
		vars = append(vars, TemplateVars{Tag: tag, Label: label, SampleValue: sample})
	}
	rawVars, _ := json.Marshal(vars)
	channels := in.Channels
	if strings.TrimSpace(channels) == "" {
		channels = "SMS"
	}
	active := 0
	if in.IsActive {
		active = 1
	}
	_, err := s.DB.Pool.Exec(ctx, `
		insert into notification_templates ("eventCode", title, "templateText", variables, channels, "isActive", "updatedAt")
		values ($1,$2,$3,$4,$5,$6,now())
		on conflict ("eventCode") do update set
		  title = excluded.title, "templateText" = excluded."templateText",
		  variables = excluded.variables, channels = excluded.channels,
		  "isActive" = excluded."isActive", "updatedAt" = now()`,
		eventCode, title, in.TemplateText, string(rawVars), channels, active)
	return err
}

// SendTemplateTestMessage live test of a channel with a user ID (port of sendTemplateTestMessage).
func (s *Service) SendTemplateTestMessage(ctx context.Context, pool *pgxpool.Pool, user *session.User, msgSvc *messaging.Service, channel, identifier string) (string, error) {
	_ = user
	if !testableChannels[channel] {
		return "", errors.New("کانال نامعتبر است.")
	}
	raw := toAsciiDigits(identifier)
	raw = strings.NewReplacer(" ", "", "-", "", "@", "").Replace(strings.TrimSpace(raw))
	if raw == "" {
		return "", errors.New("کد پرسنلی، شمارهٔ دانشجویی یا موبایل را وارد کنید.")
	}
	isDigits := true
	for _, r := range raw {
		if r < '0' || r > '9' {
			isDigits = false
			break
		}
	}
	if !isDigits {
		return "", errors.New("شناسه باید عدد باشد (کد پرسنلی، شمارهٔ دانشجویی یا موبایل).")
	}

	type hit struct {
		id          int64
		first, last *string
		code        *string
	}
	tryUsers := func(rows func() ([][]any, error), label string) (string, error) {
		grid, err := rows()
		if err != nil {
			return "", nil
		}
		lastSkip := ""
		for _, g := range grid {
			u := hit{id: g[0].(int64), first: g[1].(*string), last: g[2].(*string), code: g[3].(*string)}
			who := strings.TrimSpace(ptrStr(u.first) + " " + ptrStr(u.last))
			if who == "" {
				who = fmt.Sprintf("حساب %d", u.id)
			}
			res := msgSvc.SendTestMessage(ctx, u.id, channel)
			if res.Status == "SENT" {
				return fmt.Sprintf("پیام آزمایشی از طریق %s به %s (%s) ارسال شد.", channelFA(channel), who, label), nil
			}
			lastSkip = who + ": " + res.Status
			if res.Error != nil {
				lastSkip = who + ": " + *res.Error
			}
		}
		if lastSkip != "" {
			return "", errors.New("ارسال آزمایشی ناموفق بود — " + lastSkip)
		}
		return "", nil
	}

	// ① personnel code
	if msg, err := tryUsers(func() ([][]any, error) {
		rows, err := pool.Query(ctx, `select u.id, u."firstName", u."lastName", st."staffCode"
			from staff st join users u on u.id = st."userId" where st."staffCode" = $1 order by u.id`, raw)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		out := [][]any{}
		for rows.Next() {
			var id int64
			var a, b, c *string
			if rows.Scan(&id, &a, &b, &c) == nil {
				out = append(out, []any{id, a, b, c})
			}
		}
		return out, nil
	}, "کد پرسنلی"); msg != "" || err != nil {
		return msg, err
	}

	// ② student number
	if msg, err := tryUsers(func() ([][]any, error) {
		rows, err := pool.Query(ctx, `select u.id, u."firstName", u."lastName", st."studentCode"
			from students st join users u on u.id = st."userId" where st."studentCode" = $1 order by u.id`, raw)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		out := [][]any{}
		for rows.Next() {
			var id int64
			var a, b, c *string
			if rows.Scan(&id, &a, &b, &c) == nil {
				out = append(out, []any{id, a, b, c})
			}
		}
		return out, nil
	}, "شمارهٔ دانشجویی"); msg != "" || err != nil {
		return msg, err
	}

	// ③ mobile
	if len(raw) == 11 && strings.HasPrefix(raw, "09") {
		if msg, err := tryUsers(func() ([][]any, error) {
			rows, err := pool.Query(ctx, `select id, "firstName", "lastName", mobile from users where mobile = $1 order by id`, raw)
			if err != nil {
				return nil, err
			}
			defer rows.Close()
			out := [][]any{}
			for rows.Next() {
				var id int64
				var a, b, c *string
				if rows.Scan(&id, &a, &b, &c) == nil {
					out = append(out, []any{id, a, b, c})
				}
			}
			return out, nil
		}, "موبایل"); msg != "" || err != nil {
			return msg, err
		}
	}

	// ④ national code
	if len(raw) == 10 {
		if msg, err := tryUsers(func() ([][]any, error) {
			rows, err := pool.Query(ctx, `select id, "firstName", "lastName", "nationalCode" from users where "nationalCode" = $1 order by id`, raw)
			if err != nil {
				return nil, err
			}
			defer rows.Close()
			out := [][]any{}
			for rows.Next() {
				var id int64
				var a, b, c *string
				if rows.Scan(&id, &a, &b, &c) == nil {
					out = append(out, []any{id, a, b, c})
				}
			}
			return out, nil
		}, "کد ملی"); msg != "" || err != nil {
			return msg, err
		}
	}

	// ⑤ direct chatId — only for messengers; SMS has no direct chat
	if channel != "SMS" && len(raw) >= 3 && len(raw) <= 15 {
		res := msgSvc.SendMessengerDirect(ctx, channel, raw)
		if res.Status == "SENT" {
			return fmt.Sprintf("پیام آزمایشی از طریق %s به شناسهٔ چت ارسال شد.", channelFA(channel)), nil
		}
		errText := res.Status
		if res.Error != nil {
			errText = *res.Error
		}
		return "", fmt.Errorf("ارسال مستقیم به کانال ناموفق بود — %s", errText)
	}
	return "", fmt.Errorf("هیچ کاربری با «%s» پیدا نشد — کد پرسنلی، شمارهٔ دانشجویی، موبایل یا کد ملی را بررسی کنید.", raw)
}

func ptrStr(v *string) string {
	if v == nil {
		return ""
	}
	return *v
}

func channelFA(ch string) string {
	m := map[string]string{
		"SMS": "پیامک SMS", "BALE": "پیام‌رسان بله", "EITAA": "پیام‌رسان ایتا",
		"TELEGRAM": "تلگرام", "SOROUSH": "سروش", "IGAP": "ای‌گپ",
	}
	if v, ok := m[ch]; ok {
		return v
	}
	return ch
}
