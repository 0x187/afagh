// ═══ تخفیف و پوشش بنیاد — پورت discounts.ts و sponsorships.ts ═══
package finance

// DiscountLike ردیف تخفیف.
type DiscountLike struct {
	ID         int64
	Kind       string // PERCENT | FIXED
	Percent    any
	Amount     any
	AppliesTo  *string // FIXED | VARIABLE | BOTH
	MaxPercent any
	Title      *string
}

// AppliedAmount مبلغ اعمال‌شده (با termId اختیاری برای کارنامه).
type AppliedAmount struct {
	ID     int64
	Title  *string
	Amount float64
	TermID *int64
}

// DiscountBase پورت discountBase بر اساس قلمروی اثر.
func DiscountBase(appliesTo *string, fixedTuition, variableTuition float64) float64 {
	scope := ""
	if appliesTo != nil {
		scope = *appliesTo
	}
	switch scope {
	case "FIXED":
		return ToNum(fixedTuition)
	case "VARIABLE":
		return ToNum(variableTuition)
	}
	return ToNum(fixedTuition) + ToNum(variableTuition)
}

// EffectivePercent پورت effectivePercent با سقف مجاز نوع تخفیف.
func EffectivePercent(d DiscountLike) float64 {
	cap := 100.0
	if d.MaxPercent != nil && d.MaxPercent != "" {
		cap = mathMax0(ToNum(d.MaxPercent))
	}
	p := mathMax0(ToNum(d.Percent))
	if p > cap {
		return cap
	}
	return p
}

func mathMax0(v float64) float64 {
	if v < 0 {
		return 0
	}
	return v
}

// DiscountAmount مبلغ یک تخفیف پیش از سقف «بیش از کل شهریه نشود».
func DiscountAmount(d DiscountLike, fixedTuition, variableTuition float64) float64 {
	if d.Kind == "PERCENT" {
		base := DiscountBase(d.AppliesTo, fixedTuition, variableTuition)
		return ToRial((base * EffectivePercent(d)) / 100)
	}
	return ToRial(mathMax0(ToNum(d.Amount)))
}

// DiscountOutcome نتیجهٔ اعمال زنجیرهٔ تخفیف‌ها.
type DiscountOutcome struct {
	Total   float64
	Net     float64
	Applied []AppliedAmount
}

// ApplyDiscounts پورت applyDiscounts — ترتیب ورودی مؤثر است.
func ApplyDiscounts(list []DiscountLike, fixedTuition, variableTuition float64) DiscountOutcome {
	gross := ToNum(fixedTuition) + ToNum(variableTuition)
	remaining := gross
	applied := []AppliedAmount{}
	for _, d := range list {
		amount := DiscountAmount(d, fixedTuition, variableTuition)
		if amount > remaining {
			amount = remaining
		}
		if amount < 0 {
			amount = 0
		}
		remaining -= amount
		applied = append(applied, AppliedAmount{ID: d.ID, Title: d.Title, Amount: amount})
	}
	return DiscountOutcome{Total: gross - remaining, Net: remaining, Applied: applied}
}

// SponsorshipLike ردیف پوشش بنیاد.
type SponsorshipLike struct {
	ID           int64
	CoverageKind string // PERCENT | FIXED
	Percent      any
	Amount       any
	Title        *string
}

// SponsorshipOutcome نتیجهٔ پوشش.
type SponsorshipOutcome struct {
	Total        float64
	StudentShare float64
	Applied      []AppliedAmount
}

// ApplySponsorships پورت applySponsorships — روی خالصِ پس از تخفیف.
func ApplySponsorships(list []SponsorshipLike, netTuition float64) SponsorshipOutcome {
	net := mathMax0(ToNum(netTuition))
	remaining := net
	applied := []AppliedAmount{}
	for _, s := range list {
		var amount float64
		if s.CoverageKind == "PERCENT" {
			p := ToNum(s.Percent)
			if p < 0 {
				p = 0
			}
			if p > 100 {
				p = 100
			}
			amount = ToRial((net * p) / 100)
		} else {
			amount = ToRial(mathMax0(ToNum(s.Amount)))
		}
		if amount > remaining {
			amount = remaining
		}
		if amount < 0 {
			amount = 0
		}
		remaining -= amount
		applied = append(applied, AppliedAmount{ID: s.ID, Title: s.Title, Amount: amount})
	}
	return SponsorshipOutcome{Total: net - remaining, StudentShare: remaining, Applied: applied}
}

// ─────────────────────────── تعدیلات ترم ───────────────────────────

// TermCharge بدهی ثبت‌شدهٔ ترم.
type TermCharge struct {
	TermID  int64
	Charges float64
}

// DiscountRowLike تخفیف با دامنهٔ ترم (nil = همهٔ ترم‌ها).
type DiscountRowLike struct {
	ID      int64
	TermID  *int64
	Kind    string
	Percent any
	Amount  any
	Title   *string
}

// SponsorRowLike پوشش با دامنهٔ ترم (nil = همهٔ ترم‌ها).
type SponsorRowLike struct {
	ID           int64
	TermID       *int64
	CoverageKind string
	Percent      any
	Amount       any
	Title        *string
}

// TermAdjustment تعدیلات یک ترم.
type TermAdjustment struct {
	TermID        int64
	Charges       float64
	Discounts     float64
	Sponsorships  float64
	StudentShare  float64
	DiscountLines []AppliedAmount
	SponsorLines  []AppliedAmount
}

// ComputeTermAdjustments پورت computeTermAdjustments: تخفیف روی شهریهٔ ترم،
// سپس پوشش روی خالص؛ تخفیفِ بدون ترم روی تک‌تک ترم‌ها اثر دارد.
func ComputeTermAdjustments(termCharges []TermCharge, discounts []DiscountRowLike, sponsorships []SponsorRowLike) []TermAdjustment {
	out := []TermAdjustment{}
	for _, tc := range termCharges {
		charges := mathMax0(ToNum(tc.Charges))

		activeDiscounts := []DiscountLike{}
		for _, d := range discounts {
			if d.TermID != nil && *d.TermID != tc.TermID {
				continue
			}
			both := "BOTH"
			activeDiscounts = append(activeDiscounts, DiscountLike{
				ID: d.ID, Kind: d.Kind, Percent: d.Percent, Amount: d.Amount,
				AppliesTo: &both, Title: d.Title,
			})
		}
		disc := ApplyDiscounts(activeDiscounts, charges, 0)

		activeSponsors := []SponsorshipLike{}
		for _, s := range sponsorships {
			if s.TermID != nil && *s.TermID != tc.TermID {
				continue
			}
			activeSponsors = append(activeSponsors, SponsorshipLike{
				ID: s.ID, CoverageKind: s.CoverageKind, Percent: s.Percent,
				Amount: s.Amount, Title: s.Title,
			})
		}
		spon := ApplySponsorships(activeSponsors, disc.Net)

		out = append(out, TermAdjustment{
			TermID: tc.TermID, Charges: charges,
			Discounts: disc.Total, Sponsorships: spon.Total, StudentShare: spon.StudentShare,
			DiscountLines: disc.Applied, SponsorLines: spon.Applied,
		})
	}
	return out
}
