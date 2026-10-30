package bi

import (
	"math"
	"testing"
)

func TestRound2(t *testing.T) {
	v := 3.14159
	if got := round2(&v); got == nil || *got != 3.14 {
		t.Fatalf("round2 = %v", got)
	}
	nan := math.NaN()
	if got := round2(&nan); got != nil {
		t.Fatalf("NaN must be nil, got %v", *got)
	}
	if got := round2(nil); got != nil {
		t.Fatalf("nil must be nil, got %v", *got)
	}
}

func TestItoa(t *testing.T) {
	if itoa(0) != "0" || itoa(-42) != "-42" || itoa(14032) != "14032" {
		t.Fatalf("itoa mismatch: %q %q %q", itoa(0), itoa(-42), itoa(14032))
	}
}
