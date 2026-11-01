package fa

import "testing"

// Port of the escape-like/persian-search tests (afagh-next/tests/).
func TestEscapeLikeChars(t *testing.T) {
	cases := map[string]string{
		"100%": "100\\%", "a_b": "a\\_b", "a\\b": "a\\\\b",
		"%_\\": "\\%\\_\\\\", "%%": "\\%\\%", "سلام": "سلام", "": "",
	}
	for in, want := range cases {
		if got := EscapeLikeChars(in); got != want {
			t.Fatalf("EscapeLikeChars(%q)=%q want %q", in, got, want)
		}
	}
}

func TestFaLIkePattern(t *testing.T) {
	cases := map[string]string{
		"50%_": "%50\\%\\_%", "كتاب": "%کتاب%", "": "%%", "  سلام  ": "%سلام%",
	}
	for in, want := range cases {
		if got := FaLikePattern(in); got != want {
			t.Fatalf("FaLikePattern(%q)=%q want %q", in, got, want)
		}
	}
}

func TestNormalizeFa(t *testing.T) {
	cases := map[string]string{
		"ي": "ی", "ك": "ک", "ة": "ه", "ؤ": "و", "ئ": "ی",
		"أحمد": "احمد", "إ": "ا", "آ": "ا",
		"كتاب‌ها": "کتاب ها", "مـدرسه": "مدرسه", "مُعلّم": "معلم",
		"  a   b  ": "a b", "": "",
	}
	for in, want := range cases {
		if got := NormalizeFa(in); got != want {
			t.Fatalf("NormalizeFa(%q)=%q want %q", in, got, want)
		}
	}
}

func TestToEnDigits(t *testing.T) {
	cases := map[string]string{
		"۰۱۲۳۴۵۶۷۸۹": "0123456789",
		"٠١٢٣٤٥٦٧٨٩": "0123456789",
		"SA۰۱۲۵":     "SA0125",
		"abc":        "abc",
		"":           "",
	}
	for in, want := range cases {
		if got := ToEnDigits(in); got != want {
			t.Fatalf("ToEnDigits(%q)=%q want %q", in, got, want)
		}
	}
}

func TestFaIncludes(t *testing.T) {
	cases := []struct {
		h, n string
		want bool
	}{
		{"كتاب فارسی", "کتاب", true},
		{"سیب", "", true},
		{"SA۰۱۲۵", "0125", true},
		{"مدرسه", "ة", true},
		{"abc", "xyz", false},
		{"", "x", false},
		{"x", "", true},
	}
	for _, c := range cases {
		if got := FaIncludes(c.h, c.n); got != c.want {
			t.Fatalf("FaIncludes(%q,%q)=%v want %v", c.h, c.n, got, c.want)
		}
	}
}
