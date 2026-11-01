package admin

import "testing"

func TestMigSafeColumn(t *testing.T) {
	valid := []string{"id", "universityId", "created_at", "A1", "_private"}
	for _, name := range valid {
		if !migSafeColumn(name) {
			t.Fatalf("migSafeColumn(%q) = false, want true", name)
		}
	}
	invalid := []string{"", "1id", "a-b", `x" = 1; --`, "نام", "a b"}
	for _, name := range invalid {
		if migSafeColumn(name) {
			t.Fatalf("migSafeColumn(%q) = true, want false", name)
		}
	}
}
