// ═══ ابزار عدد/تاریخ مالی — پورت numbers.ts ═══
package finance

import (
	"math"
	"regexp"
	"strconv"
	"strings"
	"time"
)

var decimalRe = regexp.MustCompile(`^[+-]?(\d+(\.\d*)?|\.\d+)$`)

// ToNum تبدیل سخت‌گیرانهٔ numeric/رشته/تهی به عدد — نما/هگز/حروف/ارقام فارسی → ۰.
// تهی/NaN → ۰ (سازگاری با جمع‌های legacy).
func ToNum(value any) float64 {
	switch v := value.(type) {
	case nil:
		return 0
	case float64:
		if math.IsNaN(v) || math.IsInf(v, 0) {
			return 0
		}
		return v
	case float32:
		f := float64(v)
		if math.IsNaN(f) || math.IsInf(f, 0) {
			return 0
		}
		return f
	case int:
		return float64(v)
	case int64:
		return float64(v)
	case string:
		s := strings.TrimSpace(v)
		if s == "" || !decimalRe.MatchString(s) {
			return 0
		}
		n, err := strconv.ParseFloat(s, 64)
		if err != nil || math.IsNaN(n) || math.IsInf(n, 0) {
			return 0
		}
		return n
	}
	return 0
}

// ToRial گرد کردن به ریال (بدون کسری).
func ToRial(value float64) float64 {
	if math.IsNaN(value) || math.IsInf(value, 0) {
		return 0
	}
	return math.Round(value)
}

// ToMs پورت toMs: رشته/زمان → میلی‌ثانیه epoch؛ تهی/نامعتبر → nil.
func ToMs(value any) *int64 {
	switch v := value.(type) {
	case nil:
		return nil
	case time.Time:
		ms := v.UnixMilli()
		return &ms
	case *time.Time:
		if v == nil {
			return nil
		}
		ms := v.UnixMilli()
		return &ms
	case string:
		s := strings.TrimSpace(v)
		if s == "" {
			return nil
		}
		layouts := []string{
			time.RFC3339, "2006-01-02T15:04:05", "2006-01-02 15:04:05", "2006-01-02", time.RFC1123,
		}
		for _, layout := range layouts {
			if t, err := time.Parse(layout, s); err == nil {
				ms := t.UnixMilli()
				return &ms
			}
		}
		return nil
	}
	return nil
}
