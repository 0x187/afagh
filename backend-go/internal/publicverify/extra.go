// ═══ استعلام کارت دانشجویی، مدرک و گواهینامهٔ دورهٔ آزاد ═══
package publicverify

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"strings"
	"time"

	"backend-go/internal/finance"
	"backend-go/internal/jalali"
)

// StudentCardVerdict نتیجهٔ استعلام کارت دانشجویی.
type StudentCardVerdict struct {
	Verdict      string   `json:"verdict"` // VALID | REVOKED | LOST | EXPIRED | INACTIVE | BLOCKED | NOT_FOUND
	Allowed      bool     `json:"allowed"`
	Reason       string   `json:"reason"`
	StudentCode  string   `json:"studentCode"`
	FullName     string   `json:"fullName"`
	NationalMask string   `json:"nationalIdMasked"`
	StatusLabel  string   `json:"statusLabel"`
	MajorName    *string  `json:"majorName"`
	DegreeLevel  *string  `json:"degreeLevel"`
	EntryYear    *int     `json:"entranceYear"`
	Debt         float64  `json:"debt"`
	RFID         *string  `json:"rfidSerialNumber"`
	PrintStatus  *string  `json:"printStatus"`
	IssuedAt     *string  `json:"issuedAt"`
	ExpiresAt    *string  `json:"expiresAt"`
}

// VerifyStudentCard پورت verifyStudentCard (توکن خام کارت — نه T1).
func (s *Service) VerifyStudentCard(ctx context.Context, rawToken string) *StudentCardVerdict {
	token := strings.TrimSpace(rawToken)
	out := &StudentCardVerdict{Verdict: "NOT_FOUND", Reason: "کارتی با این شناسه در سامانه ثبت نشده است."}
	if token == "" {
		return out
	}
	var studentID int64
	var studentCode, firstName, lastName string
	var nationalCode *string
	var status string
	var majorName, degreeTitle *string
	var entryYear *int
	var printStatus, rfid *string
	var issuedAt, expiresAt *string
	err := s.Pool.QueryRow(ctx, `
		select st.id, st."studentCode", coalesce(u."firstName",''), coalesce(u."lastName",''), u."nationalCode",
		       coalesce(st.status,'ACTIVE'), m.name, d.title, st."entryYear",
		       sc."printStatus", sc."rfidSerialNumber",
		       sc."issuedAt"::text, sc."expiresAt"::text
		  from student_cards sc
		  join students st on st.id = sc."studentId"
		  join users u on u.id = st."userId"
		  left join majors m on m.id = st."majorId"
		  left join degree_level_configs d on d.id = st."degreeLevelId"
		 where sc."secureToken" = $1 limit 1`, token).
		Scan(&studentID, &studentCode, &firstName, &lastName, &nationalCode, &status, &majorName, &degreeTitle,
			&entryYear, &printStatus, &rfid, &issuedAt, &expiresAt)
	if err != nil {
		return out
	}

	// بدهی از تراز کانونی دفتر مالی.
	debt := 0.0
	rows, err := s.Pool.Query(ctx, `select "transactionType", amount::float8 from student_ledger where "studentId" = $1`, studentID)
	if err == nil {
		ledger := []finance.LedgerBalanceRow{}
		for rows.Next() {
			var typ *string
			var amount float64
			if err := rows.Scan(&typ, &amount); err == nil {
				ledger = append(ledger, finance.LedgerBalanceRow{TransactionType: typ, Amount: amount})
			}
		}
		rows.Close()
		debt = math.Max(0, math.Round(finance.LedgerBalance(ledger)))
	}

	out.StudentCode = studentCode
	out.FullName = strings.TrimSpace(firstName + " " + lastName)
	out.NationalMask = MaskNationalCode(nationalCode)
	out.StatusLabel = status
	out.MajorName = majorName
	out.DegreeLevel = degreeTitle
	out.EntryYear = entryYear
	out.Debt = debt
	out.RFID = rfid
	out.PrintStatus = printStatus
	out.IssuedAt = datePart(issuedAt)
	out.ExpiresAt = datePart(expiresAt)

	ps := ""
	if printStatus != nil {
		ps = *printStatus
	}
	switch {
	case ps == "REVOKED":
		out.Verdict, out.Allowed, out.Reason = "REVOKED", false, "کارت باطل شده است (اعلام سرقت/تعویض)."
	case ps == "LOST":
		out.Verdict, out.Allowed, out.Reason = "LOST", false, "کارت مفقودی اعلام شده است."
	case expiresAt != nil && len(*expiresAt) >= 10 && (*expiresAt)[:10] < time.Now().Format("2006-01-02"):
		out.Verdict, out.Allowed, out.Reason = "EXPIRED", false, "تاریخ انقضای کارت گذشته است؛ نیاز به تمدید دارد."
	case status != "ACTIVE":
		out.Verdict, out.Allowed, out.Reason = "INACTIVE", false, fmt.Sprintf("وضعیت تحصیلی دانشجو «%s» است.", status)
	case debt > 0:
		out.Verdict, out.Allowed = "BLOCKED", false
		out.Reason = "مسدودی مالی — بدهی " + faNumber(debt) + " ریال."
	default:
		out.Verdict, out.Allowed, out.Reason = "VALID", true, "کارت معتبر است — ورود مجاز."
	}
	return out
}

func datePart(v *string) *string {
	if v == nil || len(*v) < 10 {
		return nil
	}
	d := (*v)[:10]
	return &d
}

func faNumber(v float64) string {
	return jalali.FaDigits(fmt.Sprintf("%d", int64(v)))
}

// DegreeVerdict نتیجهٔ استعلام مدرک.
type DegreeVerdict struct {
	Found       bool            `json:"found"`
	Valid       bool            `json:"valid"`
	Revoked     bool            `json:"revoked"`
	RevokeReason *string        `json:"revokeReason"`
	SerialNo    string          `json:"serialNo"`
	DegreeType  string          `json:"degreeType"`
	MinistryCode *string        `json:"ministryVerificationCode"`
	IssuedAt    *string         `json:"issuedAt"`
	Snapshot    json.RawMessage `json:"snapshot"`
}

// VerifyDegree پورت verifyDegree — بازمحاسبهٔ هش سند با canonical JSON.
func (s *Service) VerifyDegree(ctx context.Context, rawCode string) *DegreeVerdict {
	code := strings.ToUpper(strings.TrimSpace(rawCode))
	out := &DegreeVerdict{}
	if code == "" {
		return out
	}
	var serialNo, degreeType, documentHash string
	var ministry *string
	var issuedAt *string
	var revokedAt *string
	var revokeReason *string
	var snapshot []byte
	err := s.Pool.QueryRow(ctx, `
		select "serialNo", "degreeType", "documentHash", "ministryVerificationCode",
		       "issuedAt"::text, "revokedAt"::text, "revokeReason", coalesce("snapshot"::text,'{}')
		  from issued_degrees where upper("verifyCode") = $1 limit 1`, code).
		Scan(&serialNo, &degreeType, &documentHash, &ministry, &issuedAt, &revokedAt, &revokeReason, &snapshot)
	if err != nil {
		return out
	}
	out.Found = true
	out.SerialNo = serialNo
	out.DegreeType = degreeType
	out.MinistryCode = ministry
	out.IssuedAt = datePart(issuedAt)
	out.Revoked = revokedAt != nil && *revokedAt != ""
	out.RevokeReason = revokeReason
	canon, err := canonicalJSON(snapshot)
	if err != nil {
		canon = "{}"
	}
	ministryVal := ""
	if ministry != nil {
		ministryVal = *ministry
	}
	h := sha256.Sum256([]byte(serialNo + "|" + code + "|" + canon + "|" + ministryVal))
	out.Valid = !out.Revoked && hex.EncodeToString(h[:]) == documentHash
	out.Snapshot = json.RawMessage(snapshot)
	return out
}

// canonicalJSON پورت canonical: کلیدهای شیء مرتب، بدون فاصله، بدون escape HTML.
func canonicalJSON(raw []byte) (string, error) {
	var v any
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	if err := dec.Decode(&v); err != nil {
		return "", err
	}
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		return "", err
	}
	return strings.TrimRight(buf.String(), "\n"), nil
}

// CertificateVerdict نتیجهٔ استعلام گواهینامهٔ دورهٔ آزاد.
type CertificateVerdict struct {
	Verdict           string  `json:"verdict"` // VALID | REVOKED | TAMPERED | NOT_FOUND
	CertificateNumber string  `json:"certificateNumber"`
	FullNameFa        *string `json:"fullNameFa"`
	FullNameEn        *string `json:"fullNameEn"`
	CourseTitleFa     *string `json:"courseTitleFa"`
	CourseTitleEn     *string `json:"courseTitleEn"`
	InstructorName    *string `json:"instructorName"`
	TotalHours        *int    `json:"courseHours"`
	Grade             float64 `json:"grade"`
	GradeStatus       string  `json:"gradeStatus"`
	IssueDate         *string `json:"issueDate"`
	NationalMask      string  `json:"nationalIdMasked"`
	Message           string  `json:"message"`
}

func gradeLabel(v float64) string {
	switch {
	case v >= 17:
		return "عالی"
	case v >= 15:
		return "خیلی خوب"
	case v >= 13:
		return "خوب"
	case v >= 10:
		return "قابل قبول"
	default:
		return "نیازمند تقویت"
	}
}

// VerifyCertificate پورت verifyCertificate — اثر انگشت sha256(شماره|یادگیرنده|دوره|نمره|ساعت|تاریخ).
func (s *Service) VerifyCertificate(ctx context.Context, rawCode string) *CertificateVerdict {
	code := strings.ToUpper(strings.TrimSpace(rawCode))
	out := &CertificateVerdict{Verdict: "NOT_FOUND", Message: "گواهینامه‌ای با این شماره در سوابق یافت نشد."}
	if code == "" {
		return out
	}
	var certNo, verificationHash string
	var fullNameFa, fullNameEn, courseFa, courseEn *string
	var instructorName *string
	var grade *float64
	var totalHours *int
	var issueDate *string
	var isRevoked *int
	var learnerID, courseID int64
	var nationalID *string
	err := s.Pool.QueryRow(ctx, `
		select c."certificateNumber", coalesce(c."verificationHash",''), c."fullNameFa", c."fullNameEn",
		       c."courseTitleFa", c."courseTitleEn", co."instructorName",
		       c.grade::float8, c."totalHours", c."issueDate"::text, c."isRevoked",
		       c."learnerId", c."courseId", l."nationalId"
		  from short_term_certificates c
		  join short_term_learners l on l.id = c."learnerId"
		  join short_term_courses co on co.id = c."courseId"
		 where upper(c."certificateNumber") = $1 limit 1`, code).
		Scan(&certNo, &verificationHash, &fullNameFa, &fullNameEn, &courseFa, &courseEn, &instructorName,
			&grade, &totalHours, &issueDate, &isRevoked, &learnerID, &courseID, &nationalID)
	if err != nil {
		return out
	}
	gradeVal := 0.0
	if grade != nil {
		gradeVal = math.Round(*grade*100) / 100
	}
	hours := 0
	if totalHours != nil {
		hours = *totalHours
	}
	issueStr := ""
	if issueDate != nil {
		issueStr = strings.TrimSpace(*issueDate)
	}
	fingerprint := sha256.Sum256([]byte(fmt.Sprintf("%s|%d|%d|%.2f|%d|%s", strings.ToUpper(strings.TrimSpace(certNo)), learnerID, courseID, gradeVal, hours, issueStr)))
	out.CertificateNumber = certNo
	out.FullNameFa = fullNameFa
	out.FullNameEn = fullNameEn
	out.CourseTitleFa = courseFa
	out.CourseTitleEn = courseEn
	out.InstructorName = instructorName
	out.TotalHours = totalHours
	out.Grade = gradeVal
	out.GradeStatus = gradeLabel(gradeVal)
	out.IssueDate = issueDate
	out.NationalMask = MaskNationalCode(nationalID)
	if hex.EncodeToString(fingerprint[:]) != verificationHash {
		out.Verdict = "TAMPERED"
		out.Message = "اثر انگشت امنیتی گواهینامه با محتوای آن هم‌خوانی ندارد — احتمال دستکاری در سوابق."
		return out
	}
	if isRevoked != nil && *isRevoked == 1 {
		out.Verdict = "REVOKED"
		out.Message = "این گواهینامه توسط اداره کل آموزش باطل شده است."
		return out
	}
	out.Verdict = "VALID"
	out.Message = "گواهینامه معتبر است و در سوابق دانشگاه آفاق ثبت شده است."
	return out
}
