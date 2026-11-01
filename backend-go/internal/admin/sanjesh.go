// ═══ Importing the previous field from the Sanjesh fixed-width file — port of admin/sanjesh-import ═══
package admin

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"backend-go/internal/session"
)

// SanjeshColumn definition of one fixed-width file column.
type SanjeshColumn struct {
	Name   string `json:"name"`
	Start  int    `json:"start"`
	Length int    `json:"length"`
	Target string `json:"target"`
}

// ParseSanjeshColumns validates the JSON structure.
func ParseSanjeshColumns(raw string) ([]SanjeshColumn, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, errors.New("ساختار ستون‌ها (JSON) را وارد کنید.")
	}
	var cols []SanjeshColumn
	if err := json.Unmarshal([]byte(raw), &cols); err != nil || cols == nil {
		return nil, errors.New("ساختار JSON نامعتبر است.")
	}
	for _, c := range cols {
		if strings.TrimSpace(c.Name) == "" || c.Start < 0 || c.Length <= 0 || c.Length > 500 {
			return nil, errors.New("ساختار ستون‌ها نامعتبر است (نام/شروع/طول).")
		}
		switch c.Target {
		case "", "skip", "nationalCode", "studentCode", "previousMajorCode", "previousMajorTitle", "entryYear":
		default:
			return nil, errors.New("فیلد مقصد نامعتبر در ساختار ستون‌ها.")
		}
	}
	if len(cols) > 200 {
		return nil, errors.New("تعداد ستون‌ها بیش از حد مجاز است.")
	}
	return cols, nil
}

// SanjeshRow one parsed record.
type SanjeshRow map[string]string

// ParseFixedWidthText port of parseFixedWidthText.
func ParseFixedWidthText(text string, cols []SanjeshColumn) []SanjeshRow {
	out := []SanjeshRow{}
	for _, line := range strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n") {
		if strings.TrimSpace(line) == "" {
			continue
		}
		if isSeparatorLine(line) {
			continue
		}
		runes := []rune(line)
		row := SanjeshRow{}
		for _, c := range cols {
			start := c.Start
			end := start + c.Length
			var raw string
			if start < len(runes) {
				if end > len(runes) {
					end = len(runes)
				}
				raw = string(runes[start:end])
			}
			val := strings.TrimSpace(raw)
			row[c.Name] = val
			if c.Target != "" && c.Target != "skip" {
				row["__"+c.Target] = val
			}
		}
		out = append(out, row)
	}
	return out
}

func isSeparatorLine(s string) bool {
	s = strings.TrimSpace(s)
	if s == "" {
		return false
	}
	for _, r := range s {
		if r != '-' && r != '=' {
			return false
		}
	}
	return true
}

// NormalizeNationalCode ASCII digits only and the last 10 digits.
func NormalizeNationalCode(v string) *string {
	var b strings.Builder
	for _, r := range v {
		if r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}
	digits := b.String()
	if len(digits) == 10 {
		return &digits
	}
	if len(digits) > 10 {
		last := digits[len(digits)-10:]
		return &last
	}
	return nil
}

// SuggestRelation suggests the relation of the previous field to the new field.
func SuggestRelation(prevCode, newMajorCode *string) *string {
	if prevCode == nil {
		return nil
	}
	rel := "UNRELATED"
	if newMajorCode != nil && *prevCode == *newMajorCode {
		rel = "RELATED"
	} else if newMajorCode != nil && len(*prevCode) >= 3 && len(*newMajorCode) >= 3 && (*prevCode)[:3] == (*newMajorCode)[:3] {
		rel = "PARTIAL"
	}
	return &rel
}

// SanjeshCommitResult commit result.
type SanjeshCommitResult struct {
	Updated  int `json:"updated"`
	NotFound int `json:"notFound"`
	Total    int `json:"total"`
}

// CommitSanjesh port of commitSanjeshAction — updating students' previous field.
func (s *Service) CommitSanjesh(ctx context.Context, user *session.User, rows []SanjeshRow) (*SanjeshCommitResult, error) {
	type majorRef struct {
		ID   int64
		Code string
	}
	all := []majorRef{}
	mrows, err := s.DB.Pool.Query(ctx, `select id, "majorCode" from majors`)
	if err != nil {
		return nil, err
	}
	for mrows.Next() {
		var m majorRef
		if err := mrows.Scan(&m.ID, &m.Code); err == nil {
			all = append(all, m)
		}
	}
	mrows.Close()
	codeByID := map[int64]string{}
	for _, m := range all {
		codeByID[m.ID] = m.Code
	}

	res := &SanjeshCommitResult{Total: len(rows)}
	for _, row := range rows {
		nc := NormalizeNationalCode(row["__nationalCode"])
		sc := strings.TrimSpace(row["__studentCode"])
		var studentID int64
		var majorID *int64
		found := false
		if sc != "" {
			err := s.DB.Pool.QueryRow(ctx, `select id, "majorId" from students where "studentCode" = $1 limit 1`, sc).Scan(&studentID, &majorID)
			found = err == nil
		} else if nc != nil {
			err := s.DB.Pool.QueryRow(ctx, `
				select st.id, st."majorId" from students st
				  join users u on u.id = st."userId"
				 where u."nationalCode" = $1 limit 1`, *nc).Scan(&studentID, &majorID)
			found = err == nil
		}
		if !found {
			res.NotFound++
			continue
		}
		var prevCode, prevTitle *string
		if v := strings.TrimSpace(row["__previousMajorCode"]); v != "" {
			prevCode = &v
		}
		if v := strings.TrimSpace(row["__previousMajorTitle"]); v != "" {
			prevTitle = &v
		}
		var newMajorCode *string
		if majorID != nil {
			if code, ok := codeByID[*majorID]; ok {
				newMajorCode = &code
			}
		}
		relation := SuggestRelation(prevCode, newMajorCode)
		if _, err := s.DB.Pool.Exec(ctx, `
			update students set "previousMajorCode" = $2, "previousMajorTitle" = $3, "previousMajorRelation" = $4
			 where id = $1`, studentID, prevCode, prevTitle, relation); err != nil {
			return res, err
		}
		res.Updated++
	}
	return res, nil
}

// SanjeshFileLimit maximum input file size (bytes).
const SanjeshFileLimit = 20 << 20
