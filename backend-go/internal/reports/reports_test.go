package reports

import (
	"testing"
	"time"
)

func TestFormatCellMoneyAndNumber(t *testing.T) {
	if got := FormatCell(1234567.6, "MONEY"); got != "۱,۲۳۴,۵۶۸ ریال" {
		t.Fatalf("money = %q", got)
	}
	if got := FormatCell(-1500, "MONEY"); got != "-۱,۵۰۰ ریال" {
		t.Fatalf("negative money = %q", got)
	}
	if got := FormatCell(12.5, "NUMBER"); got != "۱۳" {
		t.Fatalf("number = %q", got)
	}
	if got := FormatCell(nil, "MONEY"); got != "—" {
		t.Fatalf("nil = %q", got)
	}
}

func TestFormatCellJalali(t *testing.T) {
	// Gregorian date must be converted to Jalali.
	ts := time.Date(2026, 10, 30, 12, 0, 0, 0, time.UTC)
	if got := FormatCell(ts.Format(time.RFC3339), "DATE"); got != "۱۴۰۵/۰۸/۰۸" {
		t.Fatalf("date = %q", got)
	}
	// A date that is already Jalali stays untouched (with Persian digits).
	if got := FormatCell("1405/08/08", "DATE"); got != "۱۴۰۵/۰۸/۰۸" {
		t.Fatalf("jalali passthrough = %q", got)
	}
}

func TestCSVGuard(t *testing.T) {
	if got := csvGuard("=SUM(A1)"); got != "'=SUM(A1)" {
		t.Fatalf("formula guard = %q", got)
	}
	if got := csvGuard("  +1"); got != "'  +1" {
		t.Fatalf("trimmed formula guard = %q", got)
	}
	if got := csvGuard("سلام"); got != "سلام" {
		t.Fatalf("plain = %q", got)
	}
}

func TestFormatCellPointers(t *testing.T) {
	s := "مهندسی کامپیوتر"
	if got := FormatCell(&s, ""); got != "مهندسی کامپیوتر" {
		t.Fatalf("string pointer = %q", got)
	}
	n := 1403
	if got := FormatCell(&n, "NUMBER"); got != "۱,۴۰۳" {
		t.Fatalf("int pointer = %q", got)
	}
	var nilStr *string
	if got := FormatCell(nilStr, ""); got != "—" {
		t.Fatalf("nil pointer = %q", got)
	}
}

func TestPageOfClamps(t *testing.T) {
	all := make([]map[string]any, 120)
	res := pageOf([]Column{{Key: "a", Title: "الف"}}, all, 99, "s")
	if res.Page != 3 || res.TotalPages != 3 || len(res.Rows) != 20 {
		t.Fatalf("unexpected page: %+v len=%d", res, len(res.Rows))
	}
	res = pageOf([]Column{}, nil, 0, "")
	if res.Page != 1 || res.TotalPages != 1 || len(res.Rows) != 0 {
		t.Fatalf("empty page: %+v", res)
	}
}
