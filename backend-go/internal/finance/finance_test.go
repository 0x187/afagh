package finance

import (
	"strings"
	"testing"
	"time"
)

func i64p(v int64) *int64 { return &v }
func ip(v int) *int       { return &v }
func sp(v string) *string { return &v }

func TestToNumStrict(t *testing.T) {
	cases := []struct {
		in   any
		want float64
	}{
		{12.5, 12.5}, {"12.5", 12.5}, {"+3", 3}, {".5", 0.5}, {"1e5", 0}, {"123abc", 0},
		{"۱۲۳", 0}, {"", 0}, {nil, 0}, {"abc", 0},
	}
	for _, c := range cases {
		if got := ToNum(c.in); got != c.want {
			t.Fatalf("ToNum(%v)=%v want %v", c.in, got, c.want)
		}
	}
	if ToRial(1234.6) != 1235 || ToRial(-0.4) != 0 {
		t.Fatal("toRial نادرست")
	}
}

func TestLedgerBalance(t *testing.T) {
	rows := []LedgerBalanceRow{
		{TransactionType: sp("TUITION_FIXED"), Amount: "1000"},
		{TransactionType: sp("TUITION_VARIABLE"), Amount: 500},
		{TransactionType: sp("PAYMENT"), Amount: "700"},
		{TransactionType: sp("POS_PAYMENT"), Amount: 100},
		{TransactionType: sp("UNKNOWN_TYPE"), Amount: 9999},
		{TransactionType: sp("TUITION_ADJUST_DEC"), Amount: 50},
	}
	// بدهی: 1000+500+50 = 1550، اعتبار: 700+100 = 800
	if got := LedgerBalance(rows); got != 750 {
		t.Fatalf("تراز=%v want 750", got)
	}
	// ردیف برگشتی (مبلغ منفی) اعتبار همان نوع را کم می‌کند
	if got := LedgerBalance([]LedgerBalanceRow{{TransactionType: sp("POS_PAYMENT"), Amount: -200}}); got != 200 {
		t.Fatalf("برگشت POS=%v", got)
	}
}

func TestDiscounts(t *testing.T) {
	both := "BOTH"
	out := ApplyDiscounts([]DiscountLike{
		{ID: 1, Kind: "PERCENT", Percent: 10, AppliesTo: &both, Title: sp("تخفیف الف")},
		{ID: 2, Kind: "FIXED", Amount: 500, AppliesTo: &both},
	}, 10000, 0)
	if out.Total != 1500 || out.Net != 8500 {
		t.Fatalf("تخفیف‌ها: %+v", out)
	}
	if out.Applied[0].Amount != 1000 || out.Applied[1].Amount != 500 {
		t.Fatalf("خطوط تخفیف: %+v", out.Applied)
	}

	// سقف درصد نوع تخفیف
	capped := EffectivePercent(DiscountLike{Kind: "PERCENT", Percent: 50, MaxPercent: 20})
	if capped != 20 {
		t.Fatalf("سقف درصد: %v", capped)
	}
	// جمع تخفیف از کل شهریه بیشتر نمی‌شود
	over := ApplyDiscounts([]DiscountLike{
		{ID: 1, Kind: "FIXED", Amount: 8000},
		{ID: 2, Kind: "FIXED", Amount: 5000},
	}, 10000, 0)
	if over.Total != 10000 || over.Net != 0 || over.Applied[1].Amount != 2000 {
		t.Fatalf("سقف کل: %+v", over)
	}
}

func TestSponsorships(t *testing.T) {
	out := ApplySponsorships([]SponsorshipLike{
		{ID: 1, CoverageKind: "PERCENT", Percent: 50, Title: sp("بنیاد")},
		{ID: 2, CoverageKind: "FIXED", Amount: 1000},
	}, 10000)
	if out.Total != 6000 || out.StudentShare != 4000 {
		t.Fatalf("پوشش: %+v", out)
	}
	if out.Applied[0].Amount != 5000 || out.Applied[1].Amount != 1000 {
		t.Fatalf("خطوط پوشش: %+v", out.Applied)
	}
	// پوشش روی خالص، نه ناخالص
	disc := ApplyDiscounts([]DiscountLike{{ID: 1, Kind: "FIXED", Amount: 2000}}, 10000, 0)
	spon := ApplySponsorships([]SponsorshipLike{{ID: 2, CoverageKind: "PERCENT", Percent: 50}}, disc.Net)
	if spon.Total != 4000 || spon.StudentShare != 4000 {
		t.Fatalf("پوشش روی خالص: %+v", spon)
	}
}

func TestTermAdjustments(t *testing.T) {
	adj := ComputeTermAdjustments(
		[]TermCharge{{TermID: 1, Charges: 10000}, {TermID: 2, Charges: 5000}},
		[]DiscountRowLike{
			{ID: 1, TermID: i64p(1), Kind: "FIXED", Amount: 1000},
			{ID: 2, TermID: nil, Kind: "PERCENT", Percent: 10}, // روی همهٔ ترم‌ها
		},
		[]SponsorRowLike{{ID: 3, TermID: nil, CoverageKind: "FIXED", Amount: 500}},
	)
	if len(adj) != 2 {
		t.Fatalf("تعدیلات: %+v", adj)
	}
	// ترم ۱: تخفیف ۱۰۰۰ + ۱۰٪(۱۰۰۰) = ۲۰۰۰، پوشش ۵۰۰ → سهم ۷۵۰۰
	if adj[0].Discounts != 2000 || adj[0].Sponsorships != 500 || adj[0].StudentShare != 7500 {
		t.Fatalf("ترم ۱: %+v", adj[0])
	}
	// ترم ۲: تخفیف ۱۰٪ = ۵۰۰، پوشش ۵۰۰ → سهم ۴۰۰۰
	if adj[1].Discounts != 500 || adj[1].Sponsorships != 500 || adj[1].StudentShare != 4000 {
		t.Fatalf("ترم ۲: %+v", adj[1])
	}
}

func TestBuildTranscript(t *testing.T) {
	stmts := BuildTranscript(TranscriptInput{
		Ledger: []LedgerTxn{
			{ID: 1, TermID: i64p(2), TransactionType: sp("TUITION_CHARGE"), Amount: 10000, Description: sp("شهریه ترم ۲")},
			{ID: 2, TermID: i64p(2), TransactionType: sp("PAYMENT"), Amount: 3000},
			{ID: 3, TermID: i64p(1), TransactionType: sp("TUITION_CHARGE"), Amount: 8000},
			{ID: 4, TermID: nil, TransactionType: sp("CHARGE"), Amount: 500},
		},
		Discounts:    []AppliedAmount{{ID: 1, TermID: i64p(1), Amount: 2500, Title: sp("تخفیف")}},
		Sponsorships: []AppliedAmount{{ID: 2, TermID: nil, Amount: 1000}},
		Cheques: []ChequeRow{
			{ID: 1, TermID: i64p(2), ChequeNo: sp("123"), Amount: 2000, Status: sp("CLEARED")},
			{ID: 2, TermID: i64p(2), Amount: 1000, Status: sp("PENDING")},
			{ID: 3, TermID: i64p(2), Amount: 500, Status: sp("BOUNCED")},
		},
		Loans: []LoanRow{
			{ID: 1, TermID: i64p(2), Amount: 1500, Status: sp("ACTIVE")},
			{ID: 2, TermID: i64p(2), Amount: 900, Status: sp("SETTLED")},
		},
		TermTitles: map[string]string{"1": "نیمسال اول ۱۴۰۳", "2": "نیمسال دوم ۱۴۰۳"},
		TermCodes:  map[string]string{"1": "14031", "2": "14032"},
	})
	if len(stmts) != 3 {
		t.Fatalf("تعداد سطرها: %d", len(stmts))
	}
	// ترتیب زمانی: 14031 → 14032 → بدون ترم
	if stmts[0].TermID != 1 || stmts[1].TermID != 2 || stmts[2].TermID != 0 {
		t.Fatalf("ترتیب ترم‌ها: %d,%d,%d", stmts[0].TermID, stmts[1].TermID, stmts[2].TermID)
	}
	// ترم ۲: شارژ ۱۰۰۰۰، پرداخت ۳۰۰۰، چک وصول ۲۰۰۰، وام ۱۵۰۰
	// (پوشش ۱۰۰۰ بدون ترم روی هر ترم اعمال می‌شود)
	s2 := stmts[1]
	if s2.Charges != 10000 || s2.Payments != 3000 || s2.ChequesCleared != 2000 ||
		s2.ChequesPending != 1000 || s2.ChequesBounced != 500 || s2.Loans != 1500 {
		t.Fatalf("ترم ۲: %+v", s2)
	}
	if s2.Sponsorships != 1000 || s2.NetPayable != 9000 || s2.Balance != 9000-3000-2000-1500 {
		t.Fatalf("مانده ترم ۲: %+v", s2)
	}
	// ترم ۱: شارژ ۸۰۰۰، تخفیف ۲۵۰۰، پوشش ۱۰۰۰ → خالص ۴۵۰۰
	s1 := stmts[0]
	if s1.Discounts != 2500 || s1.Sponsorships != 1000 || s1.NetPayable != 4500 || s1.Balance != 4500 {
		t.Fatalf("ترم ۱: %+v", s1)
	}
	// بدون ترم: ۵۰۰ شارژ − ۱۰۰۰ پوشش → سقف پوشش ۵۰۰، خالص ۰
	s0 := stmts[2]
	if s0.TermTitle != "بدون ترم" || s0.NetPayable != 0 || s0.Balance != 0 {
		t.Fatalf("بدون ترم: %+v", s0)
	}

	tot := TranscriptTotalsOf(stmts)
	if tot.Charges != 18500 || tot.Balance != s1.Balance+s2.Balance+s0.Balance {
		t.Fatalf("جمع: %+v", tot)
	}

	// رویدادها بر اساس تاریخ مرتب‌اند (nil اول) و sign درست است
	for _, ev := range s2.Events {
		if ev.Kind == "CHARGE" && ev.Sign != -1 {
			t.Fatalf("sign شارژ: %+v", ev)
		}
	}
}

func TestChequeReminders(t *testing.T) {
	now := int64(1_700_000_000_000) // ms
	dueSoon := time.UnixMilli(now + 3*dayMs)
	pastDue := time.UnixMilli(now - 2*dayMs)
	cases := []struct {
		name   string
		row    ChequeReminderRow
		remind bool
		days   int
		over   bool
	}{
		{"در افق", ChequeReminderRow{Status: sp("PENDING"), DueDate: dueSoon}, true, 3, false},
		{"گذشته", ChequeReminderRow{Status: sp("PENDING"), DueDate: pastDue}, true, -2, true},
		{"وصول‌شده", ChequeReminderRow{Status: sp("CLEARED"), DueDate: dueSoon}, false, 0, false},
		{"یادآوری‌شده", ChequeReminderRow{Status: sp("PENDING"), DueDate: dueSoon, RemindedAt: "2026-01-01T00:00:00Z"}, false, 0, false},
		{"بدون سررسید", ChequeReminderRow{Status: sp("PENDING")}, false, 0, false},
	}
	for _, c := range cases {
		d := ChequeNeedsReminder(c.row, now, 7)
		if d.Remind != c.remind {
			t.Fatalf("%s: remind=%v", c.name, d.Remind)
		}
		if d.DaysLeft != nil && *d.DaysLeft != c.days {
			t.Fatalf("%s: days=%d want %d", c.name, *d.DaysLeft, c.days)
		}
		if d.Overdue != c.over {
			t.Fatalf("%s: overdue=%v", c.name, d.Overdue)
		}
	}

	txt := BuildChequeReminderText(ReminderTextInput{ChequeNo: sp("123"), Amount: 5000000, BankName: sp("ملت")}, ip(1), false)
	if !strings.Contains(txt, "فردا") || !strings.Contains(txt, "۵٬۰۰۰٬۰۰۰") || !strings.Contains(txt, "بانک ملت") {
		t.Fatalf("متن یادآوری: %s", txt)
	}
	overdue := BuildChequeReminderText(ReminderTextInput{Amount: 1000}, ip(-2), true)
	if !strings.Contains(overdue, "از سررسید گذشته") {
		t.Fatalf("متن گذشته: %s", overdue)
	}
}

func TestFormulas(t *testing.T) {
	d1 := int64(1)
	active := 1
	formulas := []FormulaLike{
		{ID: 1, DegreeLevelID: &d1, FixedAmount: 1000, PerUnitTheory: 100, PerUnitPractical: 120, PerUnitGeneral: 80, IsActive: &active},
		{ID: 2, DegreeLevelID: &d1, MajorID: i64p(5), FixedAmount: 2000, PerUnitTheory: 200, IsActive: &active},
	}
	best := PickFormula(formulas, FormulaContext{DegreeLevelID: &d1, MajorID: i64p(5)})
	if best == nil || best.ID != 2 {
		t.Fatalf("فرمول خاص‌تر: %+v", best)
	}
	inactive := 0
	if FormulaMatches(FormulaLike{IsActive: &inactive}, FormulaContext{}) {
		t.Fatal("فرمول غیرفعال نباید تطبیق دهد")
	}
	if FormulaMatches(formulas[0], FormulaContext{DegreeLevelID: i64p(2)}) {
		t.Fatal("مقطع متفاوت نباید تطبیق دهد")
	}
}

func TestBucketsAndAllocation(t *testing.T) {
	// عمومی با املای عربی «عمومي» باید عمومی تشخیص داده شود
	general := BucketCourseUnits(3, 3, 0, sp("عمومي"))
	if general.General != 3 || general.Theory != 0 || general.Practical != 0 {
		t.Fatalf("درس عمومی: %+v", general)
	}
	split := BucketCourseUnits(3, 2, 1, sp("تخصصی"))
	if split.Practical != 1 || split.Theory != 2 || split.General != 0 {
		t.Fatalf("تفکیک واحد: %+v", split)
	}
	// بدون ستون‌های تفکیک: همه به نظری
	all := BucketCourseUnits(3, nil, nil, nil)
	if all.Theory != 3 {
		t.Fatalf("بدون تفکیک: %+v", all)
	}

	shares := AllocateWeightedShares([]float64{1, 1, 1}, 100)
	sum := 0.0
	for _, s := range shares {
		sum += s
	}
	if sum != 100 {
		t.Fatalf("جمع سهم‌ها: %v", sum)
	}
	if shares[0] != 34 || shares[1] != 33 || shares[2] != 33 {
		t.Fatalf("باقی‌ماندهٔ بزرگ‌تر: %v", shares)
	}
	if got := AllocateWeightedShares([]float64{0, 0}, 5); got[0] != 3 || got[1] != 2 {
		t.Fatalf("تقسیم مساوی: %v", got)
	}
	if got := AllocateWeightedShares(nil, 10); got != nil {
		t.Fatal("ورودی خالی باید nil بدهد")
	}

	rates := FormulaRates{FixedAmount: 1000, PerUnitTheory: 100, PerUnitPractical: 120, PerUnitGeneral: 80}
	tb := TuitionFromFormula(rates, UnitBuckets{Theory: 2, Practical: 1, General: 0})
	if tb.Fixed != 1000 || tb.Variable != 320 || tb.Total != 1320 {
		t.Fatalf("شهریهٔ فرمول: %+v", tb)
	}
}
