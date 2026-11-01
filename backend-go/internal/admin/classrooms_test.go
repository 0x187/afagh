package admin

import "testing"

func TestSameClassroomUni(t *testing.T) {
	one, two := int64(1), int64(2)
	cases := []struct {
		name string
		a, b *int64
		want bool
	}{
		{"both nil", nil, nil, true},
		{"left nil", nil, &one, false},
		{"right nil", &one, nil, false},
		{"equal", &one, &one, true},
		{"different", &one, &two, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := sameClassroomUni(tc.a, tc.b); got != tc.want {
				t.Fatalf("sameClassroomUni() = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestValidateAdminClassroomInput(t *testing.T) {
	rows := 5
	tooRows := maxSeatDimension + 1
	negativeRows := -1
	cases := []struct {
		name    string
		in      AdminClassroomInput
		wantErr bool
	}{
		{"valid", AdminClassroomInput{Name: "کلاس ۱۰۱", Capacity: 30, Rows: &rows}, false},
		{"empty name", AdminClassroomInput{Capacity: 30}, true},
		{"zero capacity", AdminClassroomInput{Name: "کلاس", Capacity: 0}, true},
		{"negative capacity", AdminClassroomInput{Name: "کلاس", Capacity: -1}, true},
		{"capacity too large", AdminClassroomInput{Name: "کلاس", Capacity: maxClassroomCapacity + 1}, true},
		{"negative rows", AdminClassroomInput{Name: "کلاس", Capacity: 10, Rows: &negativeRows}, true},
		{"rows too large", AdminClassroomInput{Name: "کلاس", Capacity: 10, Rows: &tooRows}, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := validateAdminClassroomInput(tc.in)
			if (err != nil) != tc.wantErr {
				t.Fatalf("validateAdminClassroomInput() error = %v, wantErr %v", err, tc.wantErr)
			}
		})
	}
}
