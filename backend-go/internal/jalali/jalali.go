// ═══ تقویم جلالی — پورت calendar.ts (همان الگوریتم jalaali-js، بدون ICU) ═══
package jalali

import (
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"
)

// MinYear / MaxYear بازهٔ پشتیبانی جدول شکست.
const (
	MinYear = -61
	MaxYear = 3177
)

var jalaliBreaks = []int{-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178}

func div(a, b int) int { return a / b }
func mod(a, b int) int { return a - (a/b)*b }

// Date تاریخ شمسی.
type Date struct {
	Y, M, D int
}

// GregorianDate تاریخ میلادی.
type GregorianDate struct {
	Y, M, D int
}

type jalCalResult struct {
	leap  int
	gy    int
	march int
}

func jalCal(jy int) (jalCalResult, error) {
	gy := jy + 621
	if jy < MinYear || jy > MaxYear {
		return jalCalResult{}, fmt.Errorf("سال جلالی خارج از بازهٔ پشتیبانی: %d", jy)
	}
	leapJ := -14
	jp := jalaliBreaks[0]
	jump := 0
	for i := 1; i < len(jalaliBreaks); i++ {
		jm := jalaliBreaks[i]
		jump = jm - jp
		if jy < jm {
			break
		}
		leapJ = leapJ + div(jump, 33)*8 + div(mod(jump, 33), 4)
		jp = jm
	}
	n := jy - jp
	leapJ = leapJ + div(n, 33)*8 + div(mod(n, 33)+3, 4)
	if mod(jump, 33) == 4 && jump-n == 4 {
		leapJ++
	}
	leapG := div(gy, 4) - div((div(gy, 100)+1)*3, 4) - 150
	march := 20 + leapJ - leapG
	leap := mod(mod(n+1, 33)-1, 4)
	if leap == -1 {
		leap = 4
	}
	return jalCalResult{leap: leap, gy: gy, march: march}, nil
}

// G2D روز جولیان از تاریخ میلادی.
func G2D(gy, gm, gd int) int {
	d := div((gy+div(gm-8, 6)+100100)*1461, 4) +
		div(153*mod(gm+9, 12)+2, 5) +
		gd - 34840408
	d = d - div(div(gy+100100+div(gm-8, 6), 100)*3, 4) + 752
	return d
}

// D2G تاریخ میلادی از روز جولیان.
func D2G(jdn int) GregorianDate {
	j := 4*jdn + 139361631
	j = j + div(div(4*jdn+183187720, 146097)*3, 4)*4 - 3908
	i := div(mod(j, 1461), 4)*5 + 308
	gd := div(mod(i, 153), 5) + 1
	gm := mod(div(i, 153), 12) + 1
	gy := div(j, 1461) - 100100 + div(8-gm, 6)
	return GregorianDate{Y: gy, M: gm, D: gd}
}

// J2D روز جولیان از تاریخ جلالی.
func J2D(jy, jm, jd int) (int, error) {
	r, err := jalCal(jy)
	if err != nil {
		return 0, err
	}
	return G2D(r.gy, 3, r.march) + (jm-1)*31 - div(jm, 7)*(jm-7) + jd - 1, nil
}

// D2J تاریخ جلالی از روز جولیان.
func D2J(jdn int) Date {
	gy := D2G(jdn).Y
	jy := gy - 621
	r, err := jalCal(jy)
	if err != nil {
		jy--
		r, _ = jalCal(jy)
	}
	jdn1f := G2D(gy, 3, r.march)
	k := jdn - jdn1f
	if k >= 0 {
		if k <= 185 {
			return Date{Y: jy, M: 1 + div(k, 31), D: mod(k, 31) + 1}
		}
		k -= 186
	} else {
		jy--
		k += 179
		if r.leap == 1 {
			k++
		}
	}
	return Date{Y: jy, M: 7 + div(k, 30), D: mod(k, 30) + 1}
}

// ToJalali میلادی → جلالی.
func ToJalali(gy, gm, gd int) Date { return D2J(G2D(gy, gm, gd)) }

// ToJalaliFromTime میلادی → جلالی از time.Time (منطقهٔ محلی زمان).
func ToJalaliFromTime(t time.Time) Date {
	y, m, d := t.Date()
	return ToJalali(y, int(m), d)
}

// ToGregorian جلالی → میلادی.
func ToGregorian(jy, jm, jd int) GregorianDate {
	jdn, err := J2D(jy, jm, jd)
	if err != nil {
		return GregorianDate{}
	}
	return D2G(jdn)
}

// MonthLength طول ماه جلالی.
func MonthLength(jy, jm int) int {
	if jm <= 6 {
		return 31
	}
	if jm <= 11 {
		return 30
	}
	r, err := jalCal(jy)
	if err != nil {
		return 29
	}
	if r.leap == 0 {
		return 30
	}
	return 29
}

// IsLeap آیا سال جلالی کبیسه است؟
func IsLeap(jy int) bool {
	r, err := jalCal(jy)
	return err == nil && r.leap == 0
}

var faDigitRunes = []rune{'۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'}

// FaDigits ارقام لاتین → فارسی (نمایش).
func FaDigits(input string) string {
	var b strings.Builder
	b.Grow(len(input))
	for _, r := range input {
		if r >= '0' && r <= '9' {
			b.WriteRune(faDigitRunes[r-'0'])
		} else {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// GroupThousands «۱٬۲۳۴٬۵۶۷» — گردشده با جداکنندهٔ فارسی.
func GroupThousands(n float64) string {
	neg := n < 0
	if neg {
		n = -n
	}
	digits := strconv.FormatInt(int64(math.Round(n)), 10)
	var out strings.Builder
	for i, d := range digits {
		if i > 0 && (len(digits)-i)%3 == 0 {
			out.WriteRune('٬')
		}
		out.WriteRune(d)
	}
	s := FaDigits(out.String())
	if neg {
		return "-" + s
	}
	return s
}

// ToShamsi پورت toShamsi: ورودیِ از قبل شمسی دست‌نخورده؛ وگرنه ISO → «۱۴۰۵/۰۸/۰۴».
func ToShamsi(s string) string {
	if s == "" {
		return "—"
	}
	if strings.HasPrefix(s, "13") || strings.HasPrefix(s, "14") ||
		strings.HasPrefix(s, "۱۳") || strings.HasPrefix(s, "۱۴") {
		return s
	}
	layouts := []string{
		time.RFC3339, "2006-01-02T15:04:05", "2006-01-02 15:04:05", "2006-01-02", time.RFC1123,
	}
	var t time.Time
	var parsed bool
	for _, layout := range layouts {
		if v, err := time.Parse(layout, s); err == nil {
			t = v
			parsed = true
			break
		}
	}
	if !parsed {
		return s
	}
	j := ToJalaliFromTime(t)
	return FaDigits(fmt.Sprintf("%04d/%02d/%02d", j.Y, j.M, j.D))
}
