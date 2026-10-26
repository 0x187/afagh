// ═══ خط لولهٔ ثبت نهایی — پورت enroll-engine/submit.ts (سند §۱۰۰۸) ═══
package enroll

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"

	"backend-go/internal/finance"
)

// SoftError خطای نرمِ یک ارائه.
type SoftError struct {
	OfferingID int64  `json:"offeringId"`
	Msg        string `json:"msg"`
}

// DroppedCart ردیف حذف‌شده از سبد.
type DroppedCart struct {
	OfferingID int64  `json:"offeringId"`
	Title      string `json:"title"`
	Reason     string `json:"reason"`
}

// SubmitResult نتیجهٔ ثبت.
type SubmitResult struct {
	OK          bool          `json:"ok"`
	Registered  []string      `json:"registered"`
	Waitlisted  []string      `json:"waitlisted"`
	HardErrors  []string      `json:"hardErrors"`
	SoftErrors  []SoftError   `json:"softErrors"`
	DroppedCart []DroppedCart `json:"droppedCart"`
}

func newSubmitResult() SubmitResult {
	return SubmitResult{
		OK: true, Registered: []string{}, Waitlisted: []string{},
		HardErrors: []string{}, SoftErrors: []SoftError{}, DroppedCart: []DroppedCart{},
	}
}

func (r *SubmitResult) hard(msg string) {
	r.OK = false
	r.HardErrors = append(r.HardErrors, msg)
}

type submitOffering struct {
	ID                  int64
	CourseID            int64
	Code                string
	Title               string
	Units               float64
	Capacity            int
	Enrolled            int
	WaitCap             int
	TargetDegreeLevelID *int64
	TargetMajorID       *int64
	EntryYearStart      *int
	EntryYearEnd        *int
	OfferingType        string
}

type scheduleRow struct {
	OfferingID   int64
	ScheduleType string
	DayOfWeek    *int
	ExamDate     *string
	StartTime    string
	EndTime      string
}

func examOverlaps(a, b scheduleRow) bool {
	if a.ExamDate == nil || b.ExamDate == nil || *a.ExamDate != *b.ExamDate {
		return false
	}
	return clock5(a.StartTime) < clock5(b.EndTime) && clock5(b.StartTime) < clock5(a.EndTime)
}

// ProcessQueuedSubmit پورت processQueuedSubmit.
func (s *Service) ProcessQueuedSubmit(ctx context.Context, userID, studentID int64, acceptSameDayRisk bool) SubmitResult {
	out := newSubmitResult()
	pool := s.DB.Pool

	// ── دانشجو و مرز دانشگاه ──
	var (
		stuUniversity *int64
		degreeLevelID *int64
		majorID       *int64
		entryYear     int
		stuStatus     string
	)
	err := pool.QueryRow(ctx, `
		select "universityId", "degreeLevelId", "majorId", "entryYear", status
		  from students where id = $1`, studentID).
		Scan(&stuUniversity, &degreeLevelID, &majorID, &entryYear, &stuStatus)
	if errors.Is(err, pgx.ErrNoRows) {
		out.hard("پروندهٔ دانشجویی یافت نشد.")
		return out
	}
	if err != nil {
		out.hard("خطای داخلی سرور.")
		return out
	}

	// ── ترم جاری همان دانشگاه (fail-closed) ──
	var (
		termID           int64
		termCode         string
		isEnrollmentOpen int
	)
	if stuUniversity == nil {
		out.hard("پنجرهٔ انتخاب واحد بسته است.")
		return out
	}
	err = pool.QueryRow(ctx, `
		select id, "termCode", coalesce("isEnrollmentOpen",0)
		  from academic_terms
		 where "isCurrent" = 1 and "universityId" = $1
		 order by id desc limit 1`, *stuUniversity).
		Scan(&termID, &termCode, &isEnrollmentOpen)
	if err != nil || isEnrollmentOpen == 0 {
		out.hard("پنجرهٔ انتخاب واحد بسته است.")
		return out
	}

	// ── فعال‌سازی ترم (اختیاری) ──
	if s.Settings.GetBool(ctx, "ENFORCE_TERM_ACTIVATION") {
		var statusCode *string
		_ = pool.QueryRow(ctx, `
			select "statusCode" from student_term_states
			 where "studentId" = $1 and "termId" = $2 limit 1`, studentID, termID).Scan(&statusCode)
		if statusCode == nil || *statusCode != "ACTIVE" {
			out.HardErrors = append(out.HardErrors, "ابتدا باید برای این ترم «فعال‌سازی» شوید (با آموزش/کارشناس هماهنگ کنید).")
		}
	}

	// ── فیلتر ۱: وضعیت دانشجو ──
	if stuStatus != "ACTIVE" {
		if stuStatus == "BLOCKED_COMMISSION" {
			out.hard("حساب شما توسط کمیسیون موارد خاص مسدود است.")
		} else {
			out.hard("وضعیت دانشجو برای انتخاب واحد فعال نیست (" + stuStatus + ").")
		}
	}

	// ── فیلتر ۱: تسویهٔ مالی ──
	clearanceTermID := termID
	var finAcademicTermID *int64
	err = pool.QueryRow(ctx, `
		select "academicTermId" from financial_terms
		 where "universityId" = $1 and "isActive" = 1
		 order by "sortOrder" asc nulls last limit 1`, *stuUniversity).Scan(&finAcademicTermID)
	if err == nil && finAcademicTermID != nil {
		clearanceTermID = *finAcademicTermID
	}
	var isCleared int
	hasClearance := true
	if err := pool.QueryRow(ctx, `
		select coalesce("isCleared",0) from financial_clearances
		 where "studentId" = $1 and "termId" = $2 limit 1`, studentID, clearanceTermID).Scan(&isCleared); err != nil {
		hasClearance = false
	}
	debtThreshold := 0.0
	if raw, _ := s.Settings.Get(ctx, "ENROLLMENT_DEBT_THRESHOLD"); strings.TrimSpace(raw) != "" {
		if v, err := parseFloat(strings.TrimSpace(raw)); err == nil && v > 0 {
			debtThreshold = v
		}
	}
	balance := s.ledgerBalance(ctx, studentID)
	if !hasClearance || isCleared == 0 {
		out.hard("تسویه‌حساب مالی این ترم ثبت نشده است. برای انتخاب واحد باید بدهکاری‌تان تسویه شود.")
	} else if balance > debtThreshold {
		out.hard(fmt.Sprintf("مانده بدهکاری شما (%s ریال) بیش از حد مجاز (%s ریال) است. ابتدا بدهکاری را کاهش دهید.",
			faGroup(balance), faGroup(debtThreshold)))
	}

	// ── سبد ──
	cartRows, err := pool.Query(ctx, `select "offeringId" from cart_items where "studentId" = $1`, studentID)
	if err != nil {
		out.hard("خطای داخلی سرور.")
		return out
	}
	ids := []int64{}
	for cartRows.Next() {
		var id int64
		if err := cartRows.Scan(&id); err == nil {
			ids = append(ids, id)
		}
	}
	cartRows.Close()
	if len(ids) == 0 {
		out.hard("سبد خالی است.")
		return out
	}

	offs, err := s.loadSubmitOfferings(ctx, ids, termID, *stuUniversity)
	if err != nil {
		out.hard("خطای داخلی سرور.")
		return out
	}

	// ── H2: ردیف‌های کهنه حذف می‌شوند، ثبت متوقف نمی‌شود ──
	stale := []int64{}
	for _, id := range ids {
		found := false
		for _, o := range offs {
			if o.ID == id {
				found = true
				break
			}
		}
		if !found {
			stale = append(stale, id)
		}
	}
	if len(stale) > 0 {
		rows, err := pool.Query(ctx, `
			select o.id, c.title, o."termId", o."isActive", o."universityId"
			  from course_offerings o join courses c on c.id = o."courseId"
			 where o.id = any($1)`, stale)
		if err == nil {
			for rows.Next() {
				var (
					id, tID    int64
					title      string
					isActive   int
					university *int64
				)
				if err := rows.Scan(&id, &title, &tID, &isActive, &university); err == nil {
					reason := "به دانشگاه شما تعلق ندارد"
					if isActive != 1 {
						reason = "ارائه غیرفعال شده است"
					} else if tID != termID {
						reason = "به نیمسال جاری تعلق ندارد"
					}
					out.DroppedCart = append(out.DroppedCart, DroppedCart{OfferingID: id, Title: title, Reason: reason})
				}
			}
			rows.Close()
		}
		s.dropCartRows(ctx, studentID, stale)
	}

	// ── فیلتر ۰ب: هدف‌گیری ──
	scope := StudentScope{DegreeLevelID: degreeLevelID, MajorID: majorID, EntryYear: entryYear}
	visible := []submitOffering{}
	offTarget := []submitOffering{}
	for _, o := range offs {
		if OfferingVisible(Targeting{
			TargetDegreeLevelID: o.TargetDegreeLevelID, TargetMajorID: o.TargetMajorID,
			EntryYearStart: o.EntryYearStart, EntryYearEnd: o.EntryYearEnd,
		}, scope) {
			visible = append(visible, o)
		} else {
			offTarget = append(offTarget, o)
		}
	}
	if len(offTarget) > 0 {
		dropIDs := []int64{}
		for _, o := range offTarget {
			out.DroppedCart = append(out.DroppedCart, DroppedCart{
				OfferingID: o.ID, Title: o.Title, Reason: "مقطع/رشته/سال ورودی با هدف ارائه مطابقت ندارد",
			})
			dropIDs = append(dropIDs, o.ID)
		}
		s.dropCartRows(ctx, studentID, dropIDs)
	}
	activeOffs := visible
	if len(activeOffs) == 0 {
		out.hard("هیچ درس قابل ثبت در سبد شما برای این نیمسال نمانده است — ردیف‌های نامرتبط یا غیرفعال از سبد حذف شدند.")
		return out
	}

	// ── دروس ثبت‌شدهٔ فعلی ──
	type currentRow struct {
		OfferingID int64
		CourseID   int64
		Units      float64
	}
	current := []currentRow{}
	rows, err := pool.Query(ctx, `
		select e."offeringId", o."courseId", c.units
		  from enrollments e
		  join course_offerings o on o.id = e."offeringId"
		  join courses c on c.id = o."courseId"
		 where e."studentId" = $1 and o."termId" = $2
		   and e.status in ('REGISTERED','PENDING_COUNCIL')`, studentID, termID)
	if err != nil {
		out.hard("خطای داخلی سرور.")
		return out
	}
	for rows.Next() {
		var c currentRow
		if err := rows.Scan(&c.OfferingID, &c.CourseID, &c.Units); err == nil {
			current = append(current, c)
		}
	}
	rows.Close()
	already := map[int64]bool{}
	takenCourseIDs := map[int64]bool{}
	for _, c := range current {
		already[c.OfferingID] = true
		takenCourseIDs[c.CourseID] = true
	}

	// ── درخواست‌های باز (صندلی رزرو و واحد) ──
	pendingBypassUnits := 0.0
	pendingBypassIDs := map[int64]bool{}
	if brows, err := pool.Query(ctx, `
		select b."offeringId", c.units
		  from enroll_bypass_requests b
		  join course_offerings o on o.id = b."offeringId"
		  join courses c on c.id = o."courseId"
		 where b."studentId" = $1 and o."termId" = $2
		   and b.status in ('PENDING_MANAGER','ESCALATED_EXPERT')`, studentID, termID); err == nil {
		for brows.Next() {
			var oid int64
			var units float64
			if err := brows.Scan(&oid, &units); err == nil {
				pendingBypassUnits += units
				pendingBypassIDs[oid] = true
			}
		}
		brows.Close()
	}

	// ── فیلتر ۲ب: تکرار درس ──
	for _, o := range activeOffs {
		if already[o.ID] {
			continue
		}
		if takenCourseIDs[o.CourseID] {
			out.hard("درس «" + o.Title + "» قبلاً در این ترم (در گروهی دیگر) برای شما ثبت شده است.")
		}
	}

	// ── فیلتر ۳: سقف واحد ──
	allowedMax := float64(MaxUnits)
	if summary, err := EvaluateStudentRegulationStatus(ctx, pool, studentID, &termID); err == nil {
		allowedMax = summary.EffectiveMaxUnits
	}
	currentUnits := pendingBypassUnits
	for _, c := range current {
		currentUnits += c.Units
	}
	newUnits := 0.0
	for _, o := range activeOffs {
		if !already[o.ID] && !pendingBypassIDs[o.ID] {
			newUnits += o.Units
		}
	}
	if currentUnits+newUnits > allowedMax {
		out.hard(fmt.Sprintf("سقف مجاز انتخاب واحد طبق آیین‌نامه آموزشی (%s واحد) رعایت نشده است (ثبت‌شده: %s + جدید: %s = مجموع %s واحد).",
			faNum(allowedMax), faNum(currentUnits), faNum(newUnits), faNum(currentUnits+newUnits)))
	}

	// ── فیلتر ۵: تداخل کلاس/امتحان ──
	cartSchedules := s.loadSchedules(ctx, ids)
	regIDs := []int64{}
	for id := range already {
		regIDs = append(regIDs, id)
	}
	regSchedules := s.loadSchedules(ctx, regIDs)
	cartSet := map[int64]bool{}
	for _, id := range ids {
		cartSet[id] = true
	}
	classClash := map[int64]bool{}
	for _, a := range cartSchedules {
		if strings.ToUpper(a.ScheduleType) == "EXAM" {
			continue
		}
		for _, b := range append(append([]scheduleRow{}, cartSchedules...), regSchedules...) {
			if strings.ToUpper(b.ScheduleType) == "EXAM" {
				continue
			}
			if a.OfferingID == b.OfferingID || a.DayOfWeek == nil || b.DayOfWeek == nil || *a.DayOfWeek != *b.DayOfWeek {
				continue
			}
			if timeOverlap(a.StartTime, a.EndTime, b.StartTime, b.EndTime) {
				classClash[a.OfferingID] = true
				if cartSet[b.OfferingID] {
					classClash[b.OfferingID] = true
				}
			}
		}
	}
	examHard := map[int64]bool{}
	examSoft := map[int64]bool{}
	examDateOf := map[int64]string{}
	allExam := []scheduleRow{}
	for _, sc := range append(append([]scheduleRow{}, cartSchedules...), regSchedules...) {
		if strings.ToUpper(sc.ScheduleType) == "EXAM" {
			allExam = append(allExam, sc)
		}
	}
	for _, a := range cartSchedules {
		if strings.ToUpper(a.ScheduleType) != "EXAM" {
			continue
		}
		if a.ExamDate != nil {
			examDateOf[a.OfferingID] = *a.ExamDate
		}
		for _, b := range allExam {
			if a.OfferingID == b.OfferingID || a.ExamDate == nil || b.ExamDate == nil || *a.ExamDate != *b.ExamDate {
				continue
			}
			if examOverlaps(a, b) {
				examHard[a.OfferingID] = true
				if cartSet[b.OfferingID] {
					examHard[b.OfferingID] = true
				}
			} else {
				examSoft[a.OfferingID] = true
				if cartSet[b.OfferingID] {
					examSoft[b.OfferingID] = true
				}
			}
		}
	}
	for _, o := range activeOffs {
		if already[o.ID] {
			continue
		}
		if classClash[o.ID] {
			out.SoftErrors = append(out.SoftErrors, SoftError{OfferingID: o.ID, Msg: "تداخل زمانی: «" + o.Title + "» با کلاس دیگر."})
		} else if examHard[o.ID] {
			date := examDateOf[o.ID]
			if date == "" {
				date = "تاریخ"
			}
			out.hard("تداخل قطعی امتحان: «" + o.Title + "» با درس دیگری در " + date + " و همان ساعت امتحان دارد.")
		} else if examSoft[o.ID] && !acceptSameDayRisk {
			out.SoftErrors = append(out.SoftErrors, SoftError{
				OfferingID: o.ID,
				Msg:        "تداخل نرم امتحان: «" + o.Title + "» با امتحان دیگر در " + examDateOf[o.ID] + " (ساعت متفاوت). برای ثبت، تأییدیهٔ دیجیتال عواقب لازم است.",
			})
		}
	}

	// ── فیلتر ۴: پیش‌نیاز ──
	prereq, err := BuildPrereqContext(ctx, pool, studentID)
	if err == nil {
		for _, o := range activeOffs {
			if already[o.ID] {
				continue
			}
			rule := prereq.RuleByCourse[o.CourseID]
			if rule == nil {
				continue
			}
			ok, missingCodes := EvaluateLogicTree(rule, prereq.Passed)
			if !ok {
				names := []string{}
				for _, c := range missingCodes {
					if t, ok := prereq.Titles[c]; ok && t != "" {
						names = append(names, t)
					} else {
						names = append(names, c)
					}
				}
				out.SoftErrors = append(out.SoftErrors, SoftError{
					OfferingID: o.ID,
					Msg:        "عدم پیش‌نیاز: «" + o.Title + "» نیازمند گذرانده‌شدن «" + strings.Join(names, "، ") + "» است.",
				})
			}
		}
	}

	if len(out.HardErrors) > 0 {
		out.OK = false
		return out
	}

	// درخواست باز → ثبت دستی انجام نمی‌شود.
	for _, o := range activeOffs {
		if pendingBypassIDs[o.ID] {
			out.SoftErrors = append(out.SoftErrors, SoftError{
				OfferingID: o.ID,
				Msg:        "برای درس «" + o.Title + "» درخواست باز بدون رعایت محدودیت دارید؛ پس از تصمیم مدیر گروه یا کارشناس آموزش به‌صورت خودکار ثبت می‌شود.",
			})
		}
	}

	// ── ظرفیت ──
	s.WR.WarmupCapacities(ctx, false)
	softSet := map[int64]bool{}
	for _, se := range out.SoftErrors {
		softSet[se.OfferingID] = true
	}
	plans := []*submitPlan{}
	for _, o := range activeOffs {
		if already[o.ID] || softSet[o.ID] {
			continue
		}
		plans = append(plans, &submitPlan{o: o})
	}
	codes := make([]int, len(plans))
	for i, p := range plans {
		codes[i] = s.WR.AtomicSeat(ctx, p.o.ID)
	}
	fallbackIDs := []int64{}
	for i, p := range plans {
		if codes[i] == 1 {
			p.gotSeat = true
			p.redisSeatTaken = true
		} else if codes[i] == -2 {
			fallbackIDs = append(fallbackIDs, p.o.ID)
		}
	}
	fresh := s.readFreshCapacities(ctx, fallbackIDs)
	for _, p := range plans {
		if p.gotSeat || p.o.WaitCap <= 0 {
			continue
		}
		if f, ok := fresh[p.o.ID]; ok && f.enrolled < f.capacity {
			p.gotSeat = true
		}
	}
	for _, p := range plans {
		if !p.gotSeat && p.o.WaitCap > 0 {
			p.waitlisted = true
			p.wlPos = s.WR.NextWaitlistPosition(ctx, p.o.ID)
		}
	}
	claimIDs := []int64{}
	for _, p := range plans {
		if !p.waitlisted {
			claimIDs = append(claimIDs, p.o.ID)
		}
	}
	claimed := s.claimSeats(ctx, claimIDs)
	for _, p := range plans {
		if p.waitlisted || claimed[p.o.ID] {
			continue
		}
		if p.redisSeatTaken {
			s.WR.ReleaseSeat(ctx, p.o.ID)
		}
		if p.o.WaitCap > 0 {
			p.waitlisted = true
			p.wlPos = s.WR.NextWaitlistPosition(ctx, p.o.ID)
		} else {
			p.excluded = true
			p.failMessage = "ظرفیت «" + p.o.Title + "» تکمیل است."
		}
	}

	// ── تراکنش نهایی با RLS و قفل مشاوره‌ای ──
	var txErr error
	err = s.DB.WithUserRls(ctx, userID, s.Production, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `select pg_advisory_xact_lock(hashtext('enroll:' || $1))`, fmt.Sprintf("%d", studentID)); err != nil {
			return err
		}
		var balanceNow float64
		ledgerRows, err := tx.Query(ctx, `select "transactionType", amount::float8 from student_ledger where "studentId" = $1`, studentID)
		if err != nil {
			return err
		}
		ledger := []finance.LedgerBalanceRow{}
		for ledgerRows.Next() {
			var r finance.LedgerBalanceRow
			if err := ledgerRows.Scan(&r.TransactionType, &r.Amount); err == nil {
				ledger = append(ledger, r)
			}
		}
		ledgerRows.Close()
		balanceNow = finance.LedgerBalance(ledger)
		if balanceNow > debtThreshold {
			return fmt.Errorf("مانده بدهکاری شما (%s ریال) بیش از حد مجاز (%s ریال) است. ابتدا بدهکاری را کاهش دهید.",
				faGroup(balanceNow), faGroup(debtThreshold))
		}

		var takenUnits float64
		urows, err := tx.Query(ctx, `
			select c.units from enrollments e
			  join course_offerings co on co.id = e."offeringId"
			  join courses c on c.id = co."courseId"
			 where e."studentId" = $1 and co."termId" = $2
			   and e.status in ('REGISTERED','PENDING_COUNCIL')`, studentID, termID)
		if err != nil {
			return err
		}
		for urows.Next() {
			var u float64
			if err := urows.Scan(&u); err == nil {
				takenUnits += u
			}
		}
		urows.Close()
		var pendingUnitsNow float64
		prows, err := tx.Query(ctx, `
			select c.units from enroll_bypass_requests b
			  join course_offerings co on co.id = b."offeringId"
			  join courses c on c.id = co."courseId"
			 where b."studentId" = $1 and co."termId" = $2
			   and b.status in ('PENDING_MANAGER','ESCALATED_EXPERT')`, studentID, termID)
		if err == nil {
			for prows.Next() {
				var u float64
				if err := prows.Scan(&u); err == nil {
					pendingUnitsNow += u
				}
			}
			prows.Close()
		}
		if takenUnits+pendingUnitsNow+newUnits > allowedMax {
			return fmt.Errorf("سقف مجاز انتخاب واحد طبق آیین‌نامه آموزشی (%s واحد) رعایت نشده است (ثبت‌شدهٔ هم‌زمان: %s + جدید: %s).",
				faNum(allowedMax), faNum(takenUnits+pendingUnitsNow), faNum(newUnits))
		}

		for _, p := range plans {
			if p.excluded {
				continue
			}
			status := "REGISTERED"
			var wlPos *int
			if p.waitlisted {
				status = "WAITLISTED"
				wlPos = p.wlPos
			}
			accepted := 0
			if acceptSameDayRisk && examSoft[p.o.ID] {
				accepted = 1
			}
			if _, err := tx.Exec(ctx, `
				insert into enrollments ("studentId", "offeringId", status, "waitlistPosition", "hasAcceptedSameDayExam")
				values ($1,$2,$3,$4,$5)
				on conflict ("studentId","offeringId") do update
				   set status = excluded.status,
				       "waitlistPosition" = excluded."waitlistPosition",
				       "hasAcceptedSameDayExam" = excluded."hasAcceptedSameDayExam"`,
				studentID, p.o.ID, status, wlPos, accepted); err != nil {
				p.failMessage = "خطا در ثبت «" + p.o.Title + "»: " + err.Error()
			}
		}
		winners := []int64{}
		for _, p := range plans {
			if !p.excluded && p.failMessage == "" {
				winners = append(winners, p.o.ID)
			}
		}
		if len(winners) > 0 {
			if _, err := tx.Exec(ctx, `delete from cart_items where "studentId" = $1 and "offeringId" = any($2)`, studentID, winners); err != nil {
				return err
			}
		}
		payload := map[string]any{
			"registered": titleList(plans, false),
			"waitlisted": titleList(plans, true),
		}
		payloadJSON, _ := jsonMarshal(payload)
		if _, err := tx.Exec(ctx, `
			insert into notifications ("userId", "eventCode", payload)
			values ($1, 'ENROLLMENT_DONE', $2)`, userID, payloadJSON); err != nil {
			// اعلان نباید ثبت را بشکند (در نسخهٔ TS هم خطای آن نادیده گرفته می‌شد).
			_ = err
		}
		return nil
	})
	if err != nil {
		txErr = err
	}
	if txErr != nil {
		msg := txErr.Error()
		for _, p := range plans {
			if !p.excluded && p.failMessage == "" {
				p.failMessage = "خطا در ثبت «" + p.o.Title + "»: " + msg
			}
		}
	}
	// جبران صندلی‌ها برای شکست‌ها.
	for _, p := range plans {
		if p.failMessage != "" && !p.excluded && !p.waitlisted {
			s.compensateSeat(ctx, p.o.ID)
			if p.redisSeatTaken {
				s.WR.ReleaseSeat(ctx, p.o.ID)
			}
		}
	}
	for _, p := range plans {
		if p.failMessage != "" {
			out.hard(p.failMessage)
			continue
		}
		if p.waitlisted {
			out.Waitlisted = append(out.Waitlisted, p.o.Title)
		} else {
			out.Registered = append(out.Registered, p.o.Title)
		}
	}
	return out
}
