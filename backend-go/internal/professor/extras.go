// ═══ برنامه، قرارداد، اسناد، پیام کلاسی و ساعات حضور استاد ═══
package professor

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"backend-go/internal/jalali"
	"backend-go/internal/otp"
)

// ScheduleResponse پاسخ برنامه استاد.
type ScheduleResponse struct {
	Professor ProfessorInfo `json:"professor"`
	Term      TermInfo      `json:"term"`
	Rows      []ScheduleRow `json:"rows"`
}

// GetSchedule پورت professor/schedule.
func (s *Service) GetSchedule(ctx context.Context, userID int64, cookie *int64) (*ScheduleResponse, error) {
	st, err := s.ResolveStaff(ctx, userID)
	if err != nil {
		return nil, err
	}
	if st == nil {
		return nil, errNoStaff
	}
	term := s.ResolveTerm(ctx, st.UniversityID, cookie)
	resp := &ScheduleResponse{Professor: s.professorInfo(ctx, st), Term: term, Rows: []ScheduleRow{}}
	if term.ID != nil {
		rows, err := s.ScheduleRows(ctx, st.ID, *term.ID, st.UniversityID)
		if err != nil {
			return nil, err
		}
		resp.Rows = rows
	}
	return resp, nil
}

// ───────────────────────── قرارداد ─────────────────────────

// ContractLine خط قرارداد.
type ContractLine struct {
	OfferingID     int64   `json:"offeringId"`
	Code           string  `json:"code"`
	Title          string  `json:"title"`
	GroupNumber    int     `json:"groupNumber"`
	TheoryUnits    float64 `json:"theoryUnits"`
	PracticalUnits float64 `json:"practicalUnits"`
	WeeklyHours    float64 `json:"weeklyHours"`
	TermTotalHours float64 `json:"termTotalHours"`
}

// ContractView قرارداد قابل نمایش/امضا.
type ContractView struct {
	ContractNo           string         `json:"contractNo"`
	ContractDate         string         `json:"contractDate"`
	TermTitle            string         `json:"termTitle"`
	ProfessorName        string         `json:"professorName"`
	NationalCode         string         `json:"nationalCode"`
	StaffCode            string         `json:"staffCode"`
	BankAccountNo        string         `json:"bankAccountNo"`
	StaffType            string         `json:"staffType"`
	AcademicRank         string         `json:"academicRank"`
	Degree               string         `json:"degree"`
	DepartmentName       string         `json:"departmentName"`
	CooperationType      string         `json:"cooperationType"`
	HourlyRate           float64        `json:"hourlyRate"`
	MinutesPerUnit       float64        `json:"minutesPerUnit"`
	Lines                []ContractLine `json:"lines"`
	TotalTermHours       float64        `json:"totalTermHours"`
	TotalUnits           float64        `json:"totalUnits"`
	GrossAmount          float64        `json:"grossAmount"`
	TaxRatePercent       float64        `json:"taxRatePercent"`
	TaxDeduction         float64        `json:"taxDeduction"`
	InsuranceRatePercent float64        `json:"insuranceRatePercent"`
	InsuranceDeduction   float64        `json:"insuranceDeduction"`
	NetAmount            float64        `json:"netAmount"`
	MidtermPayment       float64        `json:"midtermPayment"`
	FinalPayment         float64        `json:"finalPayment"`
	SignatureStatus      string         `json:"signatureStatus"`
	SignedAt             *string        `json:"signedAt"`
	DigitalHash          *string        `json:"digitalHash"`
	DocumentID           *int64         `json:"documentId"`
}

// ContractResponse پاسخ صفحهٔ قرارداد.
type ContractResponse struct {
	Professor  ProfessorInfo  `json:"professor"`
	Term       TermInfo       `json:"term"`
	University UniversityInfo `json:"university"`
	Contract   *ContractView  `json:"contract"`
	Message    *string        `json:"message"`
	DemoOTP    *string        `json:"demoOtp,omitempty"`
}

const termWeeks = 16.0

func round2(v float64) float64 { return math.Round(v*100) / 100 }

func (s *Service) contractSettings(ctx context.Context) (hourly, tax, insurance, minutesPerUnit float64) {
	hourly = 850000
	tax = 10
	insurance = 7
	if s.Settings != nil {
		hourly = s.Settings.GetNumber(ctx, "HOURLY_RATE_TMN", 850000)
		tax = s.Settings.GetNumber(ctx, "CONTRACT_TAX_PERCENT", 10)
		insurance = s.Settings.GetNumber(ctx, "CONTRACT_INSURANCE_PERCENT", 7)
		minutesPerUnit = s.Settings.GetNumber(ctx, "CONTRACT_MINUTES_PER_UNIT", 0)
	}
	return
}

type offerForContract struct {
	ID             int64
	Code           string
	Title          string
	Units          float64
	TheoryUnits    float64
	PracticalUnits float64
	Group          int
	OfferingType   string
	SharedKey      *string
}

// buildContractView پورت buildContractDraft + attachProfessorIdentity.
func (s *Service) buildContractView(ctx context.Context, st *Staff, termID int64) (*ContractView, error) {
	var termTitle, termCode string
	if err := s.DB.Pool.QueryRow(ctx, `select title, "termCode" from academic_terms where id = $1`, termID).
		Scan(&termTitle, &termCode); err != nil {
		return nil, err
	}
	hourly, tax, insurance, minutesPerUnit := s.contractSettings(ctx)

	rows, err := s.DB.Pool.Query(ctx, `
		select o.id, c.code, c.title, c.units, coalesce(c."theoreticalUnits",0),
		       coalesce(c."practicalUnits",0), coalesce(o."groupNumber",0),
		       coalesce(o."offeringType",'NORMAL'), o."sharedScheduleGroupKey"
		  from course_offerings o join courses c on c.id = o."courseId"
		 where o."professorId" = $1 and o."termId" = $2 and o."isActive" = 1
		 order by c.title`, st.ID, termID)
	if err != nil {
		return nil, err
	}
	offers := []offerForContract{}
	for rows.Next() {
		var o offerForContract
		if err := rows.Scan(&o.ID, &o.Code, &o.Title, &o.Units, &o.TheoryUnits,
			&o.PracticalUnits, &o.Group, &o.OfferingType, &o.SharedKey); err == nil {
			offers = append(offers, o)
		}
	}
	rows.Close()

	// جلسات کلاس هر ارائه.
	classSlots := map[int64][]slot{}
	srows, err := s.DB.Pool.Query(ctx, `
		select sc."offeringId", sc."dayOfWeek", sc."startTime"::text, sc."endTime"::text,
		       coalesce(sc."roomId",0)
		  from schedules sc
		  join course_offerings o on o.id = sc."offeringId"
		 where o."professorId" = $1 and o."termId" = $2 and sc."scheduleType" = 'CLASS'`, st.ID, termID)
	if err == nil {
		for srows.Next() {
			var oid int64
			var day *int
			var start, end string
			var room int64
			if err := srows.Scan(&oid, &day, &start, &end, &room); err == nil {
				classSlots[oid] = append(classSlots[oid], slot{Day: day, Start: start, End: end, Room: itoa64(room)})
			}
		}
		srows.Close()
	}

	directed := []offerForContract{}
	teachable := []offerForContract{}
	for _, o := range offers {
		if strings.EqualFold(o.OfferingType, "DIRECTED_READING") {
			directed = append(directed, o)
			continue
		}
		teachable = append(teachable, o)
	}
	// گروه‌بندی ادغامی.
	sort.SliceStable(teachable, func(i, j int) bool { return teachable[i].ID < teachable[j].ID })
	groups := []mergedGroup{}
	byKey := map[string]int{}
	for _, o := range teachable {
		key := mergedGroupKey(o.SharedKey, classSlots[o.ID])
		if key == "" {
			groups = append(groups, mergedGroup{PrimaryID: o.ID})
			continue
		}
		idx, ok := byKey[key]
		if !ok {
			idx = len(groups)
			byKey[key] = idx
			groups = append(groups, mergedGroup{Key: key, PrimaryID: o.ID})
		}
		_ = idx
	}
	// بازسازی با نگه‌داشتن اعضا به‌صورت offerForContract.
	type offerGroup struct {
		Key     string
		Members []offerForContract
	}
	ogroups := []offerGroup{}
	obyKey := map[string]int{}
	for _, o := range teachable {
		key := mergedGroupKey(o.SharedKey, classSlots[o.ID])
		if key == "" {
			ogroups = append(ogroups, offerGroup{Members: []offerForContract{o}})
			continue
		}
		idx, ok := obyKey[key]
		if !ok {
			idx = len(ogroups)
			obyKey[key] = idx
			ogroups = append(ogroups, offerGroup{Key: key})
		}
		ogroups[idx].Members = append(ogroups[idx].Members, o)
	}
	lines := []ContractLine{}
	for _, g := range ogroups {
		primary := g.Members[0]
		for _, m := range g.Members {
			if m.ID < primary.ID {
				primary = m
			}
		}
		codes := []string{}
		for _, m := range g.Members {
			codes = append(codes, m.Code)
		}
		weekly := 0.0
		for _, sl := range classSlots[primary.ID] {
			weekly += hoursBetween(sl.Start, sl.End)
		}
		weeklyHours := 0.0
		if minutesPerUnit > 0 {
			weeklyHours = (primary.Units * minutesPerUnit) / 60
		} else {
			weeklyHours = math.Max(weekly, math.Max(primary.Units, 1))
		}
		title := primary.Title
		if len(g.Members) > 1 {
			title = mergedDisplayTitle(primary.Title, codes)
		}
		lines = append(lines, ContractLine{
			OfferingID: primary.ID, Code: strings.Join(uniqueStrings(codes), " / "), Title: title,
			GroupNumber: primary.Group, TheoryUnits: primary.TheoryUnits, PracticalUnits: primary.PracticalUnits,
			WeeklyHours: round2(weeklyHours), TermTotalHours: round2(weeklyHours * termWeeks),
		})
	}
	for _, d := range directed {
		lines = append(lines, ContractLine{
			OfferingID: d.ID, Code: d.Code, Title: d.Title + " (معرفی به استاد)",
			GroupNumber: d.Group,
		})
	}

	totalTermHours := 0.0
	totalUnits := 0.0
	for _, l := range lines {
		totalTermHours += l.TermTotalHours
		totalUnits += l.TheoryUnits + l.PracticalUnits
	}
	gross := math.Round(totalTermHours * hourly)
	taxDeduction := math.Round(gross * tax / 100)
	insuranceDeduction := math.Round(gross * insurance / 100)
	net := gross - taxDeduction - insuranceDeduction

	var departmentName string
	if st.DepartmentID != nil {
		_ = s.DB.Pool.QueryRow(ctx, `select name from departments where id = $1`, *st.DepartmentID).Scan(&departmentName)
	}
	var nationalCode string
	_ = s.DB.Pool.QueryRow(ctx, `select "nationalCode" from users where id = $1`, st.UserID).Scan(&nationalCode)
	digits := onlyDigits(st.StaffCode)
	tail := digits
	if len(tail) > 4 {
		tail = tail[len(tail)-4:]
	}
	contractNo := "CON-" + termCode + "-" + tail

	hourlyRate := hourly
	return &ContractView{
		ContractNo: contractNo, ContractDate: faDateToday(), TermTitle: termTitle,
		ProfessorName: st.Name, NationalCode: nationalCode, StaffCode: st.StaffCode,
		BankAccountNo: s.staffString(ctx, st.ID, "bankAccountNo"), StaffType: s.staffString(ctx, st.ID, "staffType"),
		AcademicRank: s.staffString(ctx, st.ID, "academicRank"), Degree: s.staffString(ctx, st.ID, "degree"),
		DepartmentName: departmentName, CooperationType: firstNonEmptyString(st.CooperationType, "حق‌التدریس"),
		HourlyRate: hourlyRate, MinutesPerUnit: minutesPerUnit, Lines: lines,
		TotalTermHours: round2(totalTermHours), TotalUnits: round2(totalUnits),
		GrossAmount: gross, TaxRatePercent: tax, TaxDeduction: taxDeduction,
		InsuranceRatePercent: insurance, InsuranceDeduction: insuranceDeduction,
		NetAmount: net, MidtermPayment: math.Round(net / 2), FinalPayment: net - math.Round(net/2),
		SignatureStatus: "PENDING",
	}, nil
}

func hoursBetween(start, end string) float64 {
	toMin := func(v string) (int, bool) {
		var h, m int
		if _, err := fmt.Sscanf(v, "%d:%d", &h, &m); err != nil {
			return 0, false
		}
		return h*60 + m, true
	}
	s1, ok1 := toMin(start)
	s2, ok2 := toMin(end)
	if !ok1 || !ok2 || s2 <= s1 {
		return 0
	}
	return float64(s2-s1) / 60
}

func onlyDigits(v string) string {
	out := []rune{}
	for _, r := range v {
		if r >= '0' && r <= '9' {
			out = append(out, r)
		}
	}
	return string(out)
}

func (s *Service) staffString(ctx context.Context, staffID int64, column string) string {
	var v *string
	// ستون از فهرست ثابت داخلی می‌آید (نه ورودی کاربر).
	_ = s.DB.Pool.QueryRow(ctx, `select `+column+` from staff where id = $1`, staffID).Scan(&v)
	if v == nil {
		return ""
	}
	return *v
}

func firstNonEmptyString(v *string, fallback string) string {
	if v != nil && strings.TrimSpace(*v) != "" {
		return *v
	}
	return fallback
}

func faDateToday() string {
	return jalaliDateNow()
}

// canonicalJSON ترتیب کلیدها را برای هش پایدار یکسان می‌کند.
func canonicalJSON(v any) string {
	raw, err := json.Marshal(v)
	if err != nil {
		return "{}"
	}
	var generic any
	if err := json.Unmarshal(raw, &generic); err != nil {
		return string(raw)
	}
	normalized := normalizeCanonical(generic)
	out, err := json.Marshal(normalized)
	if err != nil {
		return string(raw)
	}
	return string(out)
}

func normalizeCanonical(v any) any {
	switch t := v.(type) {
	case []any:
		out := make([]any, len(t))
		for i, item := range t {
			out[i] = normalizeCanonical(item)
		}
		return out
	case map[string]any:
		out := map[string]any{}
		for k, val := range t {
			if val == nil {
				continue
			}
			out[k] = normalizeCanonical(val)
		}
		return out
	}
	return v
}

func sha256Hex(v string) string {
	sum := sha256.Sum256([]byte(v))
	return hex.EncodeToString(sum[:])
}

// GetContract پورت professor/contract/page.tsx.
func (s *Service) GetContract(ctx context.Context, userID int64, cookie *int64) (*ContractResponse, error) {
	st, err := s.ResolveStaff(ctx, userID)
	if err != nil {
		return nil, err
	}
	if st == nil {
		return nil, errNoStaff
	}
	term := s.ResolveTerm(ctx, st.UniversityID, cookie)
	resp := &ContractResponse{
		Professor: s.professorInfo(ctx, st), Term: term,
		University: s.universityInfo(ctx, st.UniversityID),
	}
	if term.ID == nil {
		msg := "نیمسال تحصیلی جاری برای دانشگاه شما تعیین نشده است."
		resp.Message = &msg
		return resp, nil
	}
	contract, err := s.buildContractView(ctx, st, *term.ID)
	if err != nil {
		return nil, err
	}
	if contract == nil {
		return resp, nil
	}
	if len(contract.Lines) == 0 {
		msg := "در این نیمسال درسی به شما تخصیص نیافته است؛ تا زمانی که جدول دروس خالی باشد مبلغ و ساعات قرارداد قابل محاسبه نیست."
		resp.Message = &msg
		return resp, nil
	}

	// سند موجود.
	var (
		docID    int64
		status   string
		hash     string
		signedAt *time.Time
	)
	err = s.DB.Pool.QueryRow(ctx, `
		select id, "signatureStatus", coalesce("documentHash",''), "signedAt"
		  from electronic_documents
		 where "staffId" = $1 and "termId" = $2 and "docType" = 'TEACHING_CONTRACT'
		 limit 1`, st.ID, *term.ID).Scan(&docID, &status, &hash, &signedAt)
	if err == nil && status == "SIGNED" {
		contract.SignatureStatus = "SIGNED"
		h := hash
		contract.DigitalHash = &h
		contract.DocumentID = &docID
		if signedAt != nil {
			iso := signedAt.Format("2006-01-02T15:04:05.000Z")
			contract.SignedAt = &iso
		}
		resp.Contract = contract
		return resp, nil
	}

	// ساخت/بروزرسانی سند PENDING (idempotent).
	snapshot := canonicalJSON(contract)
	hashValue := sha256Hex(snapshot)
	if err == nil {
		_, _ = s.DB.Pool.Exec(ctx, `
			update electronic_documents set "documentSnapshot" = $1, "documentHash" = $2 where id = $3`,
			snapshot, hashValue, docID)
	} else {
		var contractRowID int64
		err = s.DB.Pool.QueryRow(ctx, `
			insert into professor_term_contracts ("staffId","termId","contractType","taxRate")
			values ($1,$2,'HOUR_RATE',$3) returning id`, st.ID, *term.ID, fmt.Sprintf("%g", contract.TaxRatePercent)).Scan(&contractRowID)
		if err != nil {
			msg := "دادهٔ قرارداد قابل ساخت نیست."
			resp.Message = &msg
			return resp, nil
		}
		err = s.DB.Pool.QueryRow(ctx, `
			insert into electronic_documents ("contractId","staffId","termId","docType",title,"documentSnapshot","documentHash","signatureStatus")
			values ($1,$2,$3,'TEACHING_CONTRACT',$4,$5,$6,'PENDING') returning id`,
			contractRowID, st.ID, *term.ID, "قرارداد تدریس — "+contract.TermTitle+" — "+st.Name,
			snapshot, hashValue).Scan(&docID)
		if err != nil {
			msg := "ثبت سند قرارداد ناموفق بود."
			resp.Message = &msg
			return resp, nil
		}
	}
	contract.SignatureStatus = "PENDING"
	contract.DigitalHash = &hashValue
	contract.DocumentID = &docID
	resp.Contract = contract
	return resp, nil
}

// SendContractOTP صدور کد امضای قرارداد.
func (s *Service) SendContractOTP(ctx context.Context, userID, documentID int64) (string, error) {
	st, err := s.ResolveStaff(ctx, userID)
	if err != nil || st == nil {
		return "", errNoStaff
	}
	var owner int64
	var status string
	if err := s.DB.Pool.QueryRow(ctx, `select "staffId", "signatureStatus" from electronic_documents where id = $1`, documentID).
		Scan(&owner, &status); err != nil || owner != st.ID {
		return "", errors.New("سند یافت نشد.")
	}
	if status == "SIGNED" {
		return "", errors.New("این سند قبلاً امضا شده است.")
	}
	// سقف ۳ کد در ۱۵ دقیقه.
	var recent int
	_ = s.DB.Pool.QueryRow(ctx, `
		select count(*) from signature_otps where "staffId" = $1 and purpose = 'CONTRACT_SIGN'
		   and "refId" = $2 and "createdAt" > now() - interval '15 minutes'`, st.ID, documentID).Scan(&recent)
	if recent >= 3 {
		return "", errors.New("تعداد درخواست کد بیش از حد مجاز است. چند دقیقهٔ دیگر دوباره تلاش کنید.")
	}
	pepper, err := otp.Pepper(s.Production)
	if err != nil {
		return "", err
	}
	code, err := otp.NewCode()
	if err != nil {
		return "", err
	}
	hash := otp.Digest(pepper, code, fmt.Sprintf("contract:%d:%d", st.ID, documentID))
	_, _ = s.DB.Pool.Exec(ctx, `
		delete from signature_otps where "staffId" = $1 and purpose = 'CONTRACT_SIGN'
		   and "refId" = $2 and "isUsed" = 0`, st.ID, documentID)
	_, err = s.DB.Pool.Exec(ctx, `
		insert into signature_otps ("staffId", purpose, "refId", "otpHash", "expiresAt")
		values ($1,'CONTRACT_SIGN',$2,$3, now() + interval '5 minutes')`, st.ID, documentID, hash)
	if err != nil {
		return "", err
	}
	_, _ = s.DB.Pool.Exec(ctx, `
		insert into notifications ("userId","eventCode",payload) values ($1,'SIGN_OTP_SENT',$2)`,
		userID, `{"documentId":`+itoa64(documentID)+`}`)
	if s.Production {
		return "", nil
	}
	return code, nil
}

// SignContract تأیید OTP و امضا.
func (s *Service) SignContract(ctx context.Context, userID, documentID int64, code, ip, userAgent string) error {
	st, err := s.ResolveStaff(ctx, userID)
	if err != nil || st == nil {
		return errNoStaff
	}
	var owner int64
	var status, title string
	if err := s.DB.Pool.QueryRow(ctx, `select "staffId","signatureStatus",title from electronic_documents where id = $1`, documentID).
		Scan(&owner, &status, &title); err != nil || owner != st.ID {
		return errors.New("سند یافت نشد.")
	}
	if status == "SIGNED" {
		return errors.New("این سند قبلاً امضا شده است.")
	}
	var rowID int64
	var hash string
	var expiresAt time.Time
	var isUsed, attempts int
	var lockedAt *time.Time
	err = s.DB.Pool.QueryRow(ctx, `
		select id, "otpHash", "expiresAt", coalesce("isUsed",0), coalesce(attempts,0), "lockedAt"
		  from signature_otps
		 where "staffId" = $1 and purpose = 'CONTRACT_SIGN' and "refId" = $2 and coalesce("isUsed",0) = 0
		 order by id desc limit 1`, st.ID, documentID).
		Scan(&rowID, &hash, &expiresAt, &isUsed, &attempts, &lockedAt)
	if err != nil {
		return errors.New("کد تأییدی فعالی وجود ندارد؛ دوباره درخواست کد بدهید.")
	}
	if expiresAt.Before(time.Now()) {
		return errors.New("کد منقضی شده است؛ کد جدید بگیرید.")
	}
	if lockedAt != nil {
		return errors.New("به دلیل تلاش‌های ناموفق، درخواست امضا قفل شده است.")
	}
	pepper, err := otp.Pepper(s.Production)
	if err != nil {
		return err
	}
	inputHash := otp.Digest(pepper, code, fmt.Sprintf("contract:%d:%d", st.ID, documentID))
	if !otp.Equal(inputHash, hash) && !otp.Equal(otp.LegacyDigest(code), hash) {
		attempts++
		var locked any
		if attempts >= 5 {
			locked = time.Now()
		}
		_, _ = s.DB.Pool.Exec(ctx, `update signature_otps set attempts = $1, "lockedAt" = $2 where id = $3`, attempts, locked, rowID)
		return fmt.Errorf("کد تأیید نادرست است. (تلاش %d از ۵)", attempts)
	}

	tx, err := s.DB.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	now := time.Now()
	if _, err := tx.Exec(ctx, `update signature_otps set "isUsed" = 1 where id = $1`, rowID); err != nil {
		return err
	}
	masked := "***"
	runes := []rune(strings.TrimSpace(code))
	if len(runes) >= 2 {
		masked = "***" + string(runes[len(runes)-2:])
	}
	if _, err := tx.Exec(ctx, `
		insert into document_signatures ("documentId","staffId","signedAt","ipAddress","userAgent","otpUsed")
		values ($1,$2,$3,$4,$5,$6)`, documentID, st.ID, now, ip, userAgent, masked); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		update electronic_documents set "signatureStatus" = 'SIGNED', "signedAt" = $1 where id = $2`, now, documentID); err != nil {
		return err
	}
	if err := writeAudit(ctx, tx, userID, documentID, ip, userAgent, now); err != nil {
		return err
	}
	_, _ = tx.Exec(ctx, `
		insert into notifications ("userId","eventCode",payload) values ($1,'DOC_SIGNED',$2)`,
		st.UserID, `{"documentId":`+itoa64(documentID)+`,"title":`+jsonString(title)+`}`)
	return tx.Commit(ctx)
}

func jalaliDateNow() string {
	d := jalali.ToJalaliFromTime(time.Now())
	return jalali.FaDigits(fmt.Sprintf("%04d/%02d/%02d", d.Y, d.M, d.D))
}

func jsonString(v string) string {
	raw, _ := json.Marshal(v)
	return string(raw)
}

func writeAudit(ctx context.Context, tx pgx.Tx, actorUserID, documentID int64, ip, ua string, now time.Time) error {
	var prev string
	_ = tx.QueryRow(ctx, `select coalesce(hash,'') from audit_logs order by id desc limit 1`).Scan(&prev)
	iso := now.UTC().Format("2006-01-02T15:04:05.000Z")
	hash := sha256Hex(prev + "|ELECTRONIC_SIGN|" + itoa64(documentID) + "|" + iso)
	details, _ := json.Marshal(map[string]string{"ip": ip, "ua": truncate(ua, 120)})
	_, err := tx.Exec(ctx, `
		insert into audit_logs ("actorUserId", action, "entityType", "entityId", details, "prevHash", hash, "ipAddress")
		values ($1,'ELECTRONIC_SIGN','electronic_documents',$2,$3,$4,$5,$6)`,
		actorUserID, documentID, string(details), prev, hash, ip)
	return err
}

func truncate(v string, n int) string {
	r := []rune(v)
	if len(r) <= n {
		return v
	}
	return string(r[:n])
}
