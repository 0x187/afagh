package graduation

import "testing"

func TestStepsFor(t *testing.T) {
	full := StepsFor(true, true)
	if len(full) != len(WorkflowSteps) {
		t.Fatalf("full steps = %d", len(full))
	}
	noThesis := StepsFor(false, true)
	for _, s := range noThesis {
		if s.Code == "IRANDOC_VERIFICATION" {
			t.Fatalf("IRANDOC must be omitted when thesis not required")
		}
	}
	noSajjad := StepsFor(true, false)
	for _, s := range noSajjad {
		if s.Code == "SAJJAD_REQUEST" {
			t.Fatalf("SAJJAD must be omitted when not required")
		}
	}
	if len(noThesis) != len(WorkflowSteps)-1 || len(noSajjad) != len(WorkflowSteps)-1 {
		t.Fatalf("unexpected filtered counts: %d %d", len(noThesis), len(noSajjad))
	}
}

func TestCanonicalOfSortedAndStable(t *testing.T) {
	a := canonicalOf(map[string]any{"b": 2, "a": "x"})
	b := canonicalOf(map[string]any{"a": "x", "b": 2})
	if a != b {
		t.Fatalf("canonical must be key-order independent: %q vs %q", a, b)
	}
	if a != `{"a":"x","b":2}` {
		t.Fatalf("canonical = %q", a)
	}
}

func TestDegreeHashDeterministic(t *testing.T) {
	snap := map[string]any{"fullName": "علی رضایی", "gpa": 17.2, "passedUnits": 140.0}
	h1 := degreeHash("AF-T2026-AAAA", "CODE", snap, "")
	h2 := degreeHash("AF-T2026-AAAA", "CODE", snap, "")
	if h1 != h2 || len(h1) != 64 {
		t.Fatalf("hash mismatch: %q %q", h1, h2)
	}
	if degreeHash("AF-T2026-AAAA", "CODE", snap, "M1") == h1 {
		t.Fatalf("ministry code must affect hash")
	}
}

func TestMaskNationalAndMoney(t *testing.T) {
	if got := maskNational("3141200123"); got != "314****123" {
		t.Fatalf("mask = %q", got)
	}
	if got := faThousands(1234567); got != "۱٬۲۳۴٬۵۶۷" {
		t.Fatalf("money = %q", got)
	}
}
