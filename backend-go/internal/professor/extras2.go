// ═══ Electronic documents, class message and professor availability ═══
package professor

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"backend-go/internal/messaging"
	"backend-go/internal/otp"
)

// ProfDocument is the professor's electronic document.
type ProfDocument struct {
	ID              int64   `json:"id"`
	DocType         string  `json:"docType"`
	Title           string  `json:"title"`
	SignatureStatus string  `json:"signatureStatus"`
	TermID          *int64  `json:"termId"`
	CreatedAt       *string `json:"createdAt"`
	SignedAt        *string `json:"signedAt"`
	DocumentHash    *string `json:"documentHash"`
}

// ListDocuments ports professor/documents.
func (s *Service) ListDocuments(ctx context.Context, userID int64) ([]ProfDocument, error) {
	st, err := s.ResolveStaff(ctx, userID)
	if err != nil {
		return nil, err
	}
	if st == nil {
		return nil, errNoStaff
	}
	rows, err := s.DB.Pool.Query(ctx, `
		select id, "docType", title, coalesce("signatureStatus",'PENDING'), "termId",
		       "createdAt"::text, "signedAt"::text, "documentHash"
		  from electronic_documents where "staffId" = $1 order by id desc`, st.ID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ProfDocument{}
	for rows.Next() {
		var d ProfDocument
		if err := rows.Scan(&d.ID, &d.DocType, &d.Title, &d.SignatureStatus, &d.TermID,
			&d.CreatedAt, &d.SignedAt, &d.DocumentHash); err == nil {
			out = append(out, d)
		}
	}
	return out, rows.Err()
}

// DocumentDetail is the document + snapshot.
type DocumentDetail struct {
	Document ProfDocument    `json:"document"`
	Snapshot json.RawMessage `json:"snapshot"`
	Valid    bool            `json:"snapshotValid"`
}

// GetDocument ports professor/documents/[id].
func (s *Service) GetDocument(ctx context.Context, userID, documentID int64) (*DocumentDetail, error) {
	st, err := s.ResolveStaff(ctx, userID)
	if err != nil {
		return nil, err
	}
	if st == nil {
		return nil, errNoStaff
	}
	var (
		d        ProfDocument
		snapshot *string
	)
	err = s.DB.Pool.QueryRow(ctx, `
		select id, "docType", title, coalesce("signatureStatus",'PENDING'), "termId",
		       "createdAt"::text, "signedAt"::text, "documentHash", "documentSnapshot"
		  from electronic_documents where id = $1 and "staffId" = $2`, documentID, st.ID).
		Scan(&d.ID, &d.DocType, &d.Title, &d.SignatureStatus, &d.TermID, &d.CreatedAt,
			&d.SignedAt, &d.DocumentHash, &snapshot)
	if err != nil {
		return nil, errors.New("سند یافت نشد.")
	}
	detail := &DocumentDetail{Document: d, Snapshot: json.RawMessage("{}")}
	if snapshot != nil && json.Valid([]byte(*snapshot)) {
		detail.Snapshot = json.RawMessage(*snapshot)
		detail.Valid = true
	}
	return detail, nil
}

// SendDocumentOTP issues the document signing code (limit 3 per 15 minutes).
func (s *Service) SendDocumentOTP(ctx context.Context, userID, documentID int64) (string, error) {
	st, err := s.ResolveStaff(ctx, userID)
	if err != nil || st == nil {
		return "", errNoStaff
	}
	var status string
	if err := s.DB.Pool.QueryRow(ctx, `select coalesce("signatureStatus",'PENDING') from electronic_documents where id = $1 and "staffId" = $2`, documentID, st.ID).Scan(&status); err != nil {
		return "", errors.New("سند یافت نشد.")
	}
	if status == "SIGNED" {
		return "", errors.New("این سند قبلاً امضا شده است.")
	}
	var recent int
	_ = s.DB.Pool.QueryRow(ctx, `
		select count(*) from doc_sign_otps where "staffId" = $1 and "documentId" = $2
		   and "createdAt" > now() - interval '15 minutes'`, st.ID, documentID).Scan(&recent)
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
	hash := otp.Digest(pepper, code, fmt.Sprintf("doc:%d", documentID))
	if _, err := s.DB.Pool.Exec(ctx, `
		insert into doc_sign_otps ("staffId","documentId","otpHash","expiresAt")
		values ($1,$2,$3, now() + interval '120 seconds')`, st.ID, documentID, hash); err != nil {
		return "", err
	}
	_, _ = s.DB.Pool.Exec(ctx, `
		insert into notifications ("userId","eventCode",payload) values ($1,'SIGN_OTP_SENT',$2)`,
		st.UserID, `{"documentId":`+itoa64(documentID)+`}`)
	messaging.NotifyExternalDefault(ctx, st.UserID, "SIGN_OTP_SENT", "کد تأیید امضای الکترونیکی سند")
	if s.Production {
		return "", nil
	}
	return code, nil
}

// VerifyDocumentSign verifies the OTP and signs the document.
func (s *Service) VerifyDocumentSign(ctx context.Context, userID, documentID int64, code, ip, userAgent string) error {
	st, err := s.ResolveStaff(ctx, userID)
	if err != nil || st == nil {
		return errNoStaff
	}
	var owner int64
	var status, title string
	if err := s.DB.Pool.QueryRow(ctx, `select "staffId", coalesce("signatureStatus",'PENDING'), title from electronic_documents where id = $1`, documentID).
		Scan(&owner, &status, &title); err != nil || owner != st.ID {
		return errors.New("سند یافت نشد.")
	}
	if status == "SIGNED" {
		return errors.New("این سند قبلاً امضا شده است.")
	}
	var (
		rowID     int64
		hash      string
		expiresAt time.Time
		isUsed    int
		attempts  int
		lockedAt  *time.Time
	)
	err = s.DB.Pool.QueryRow(ctx, `
		select id, "otpHash", "expiresAt", coalesce("isUsed",0), coalesce(attempts,0), "lockedAt"
		  from doc_sign_otps where "documentId" = $1 and "staffId" = $2
		 order by id desc limit 1`, documentID, st.ID).
		Scan(&rowID, &hash, &expiresAt, &isUsed, &attempts, &lockedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return errors.New("ابتدا کد تأیید را درخواست کنید.")
		}
		return err
	}
	if isUsed != 0 {
		return errors.New("این کد مصرف شده است؛ دوباره درخواست دهید.")
	}
	if lockedAt != nil {
		return errors.New("به دلیل تلاش‌های ناموفق، کد قفل شد. کد جدید بگیرید.")
	}
	if expiresAt.Before(time.Now()) {
		return errors.New("کد منقضی شد؛ دوباره درخواست دهید.")
	}
	pepper, err := otp.Pepper(s.Production)
	if err != nil {
		return err
	}
	if !otp.Equal(otp.Digest(pepper, code, fmt.Sprintf("doc:%d", documentID)), hash) {
		attempts++
		var locked any
		if attempts >= 5 {
			locked = time.Now()
		}
		_, _ = s.DB.Pool.Exec(ctx, `update doc_sign_otps set attempts = $1, "lockedAt" = $2 where id = $3`, attempts, locked, rowID)
		if attempts >= 5 {
			return errors.New("تلاش‌ها بیش از حد مجاز — کد قفل شد.")
		}
		return fmt.Errorf("کد نادرست است (%d/5).", attempts)
	}

	tx, err := s.DB.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	now := time.Now()
	if _, err := tx.Exec(ctx, `update doc_sign_otps set "isUsed" = 1 where id = $1`, rowID); err != nil {
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
	messaging.NotifyExternalDefault(ctx, st.UserID, "DOC_SIGNED", "سند «"+title+"» با امضای الکترونیکی ثبت شد.")
	return tx.Commit(ctx)
}

// ───────────────────────── Message to class ─────────────────────────

// MyClass is the professor's class.
type MyClass struct {
	OfferingID int64  `json:"offeringId"`
	TermTitle  string `json:"termTitle"`
	Label      string `json:"label"`
	Enrolled   int    `json:"enrolled"`
}

// MyMsgRecord is a message record.
type MyMsgRecord struct {
	EventCode string  `json:"eventCode"`
	SentAt    *string `json:"sentAt"`
	Body      string  `json:"body"`
	Total     int     `json:"total"`
}

// ClassMsgReport is the send report.
type ClassMsgReport struct {
	Total          int            `json:"total"`
	Inbox          int            `json:"inbox"`
	Sent           []ChannelCount `json:"sent"`
	NoAddress      []ChannelCount `json:"noAddress"`
	FailedRequests int            `json:"failedRequests"`
}

// ChannelCount is the count for one channel.
type ChannelCount struct {
	Channel string `json:"channel"`
	N       int    `json:"n"`
}

// BroadcastResponse is classes + records.
type BroadcastResponse struct {
	Classes []MyClass     `json:"classes"`
	History []MyMsgRecord `json:"history"`
}

// GetBroadcast ports getMyClasses + listMyClassMessages.
func (s *Service) GetBroadcast(ctx context.Context, userID int64) (*BroadcastResponse, error) {
	st, err := s.ResolveStaff(ctx, userID)
	if err != nil {
		return nil, err
	}
	if st == nil {
		return nil, errNoStaff
	}
	classes, err := s.myClasses(ctx, st.ID)
	if err != nil {
		return nil, err
	}
	history := []MyMsgRecord{}
	rows, err := s.DB.Pool.Query(ctx, `
		select "eventCode", min("createdAt")::text,
		       (array_agg(body order by id))[1], count(distinct "userId")
		  from notification_deliveries
		 where "eventCode" like $1
		 group by "eventCode"
		 order by min(id) desc limit 20`, fmt.Sprintf("PROFMSG_%d_%%", st.ID))
	if err == nil {
		for rows.Next() {
			var h MyMsgRecord
			var body *string
			if err := rows.Scan(&h.EventCode, &h.SentAt, &body, &h.Total); err == nil {
				if body != nil && len(*body) > 300 {
					b := (*body)[:300]
					h.Body = b
				} else if body != nil {
					h.Body = *body
				}
				history = append(history, h)
			}
		}
		rows.Close()
	}
	return &BroadcastResponse{Classes: classes, History: history}, nil
}

func (s *Service) myClasses(ctx context.Context, staffID int64) ([]MyClass, error) {
	rows, err := s.DB.Pool.Query(ctx, `
		select o.id, o."termId", coalesce(o."groupNumber",1), coalesce(o."enrolledCount",0),
		       c.code, c.title, coalesce(t.title,'')
		  from course_offerings o
		  join courses c on c.id = o."courseId"
		  left join academic_terms t on t.id = o."termId"
		 where (o."professorId" = $1 or exists (
		         select 1 from offering_professors op where op."offeringId" = o.id and op."staffId" = $1))
		 order by o."termId" desc, c.title asc limit 500`, staffID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	type row struct {
		item   MyClass
		termID int64
	}
	list := []row{}
	for rows.Next() {
		var r row
		var group int
		var code, title, termTitle string
		if err := rows.Scan(&r.item.OfferingID, &r.termID, &group, &r.item.Enrolled, &code, &title, &termTitle); err != nil {
			continue
		}
		r.item.Label = fmt.Sprintf("%s %s — گروه %d", code, title, group)
		r.item.TermTitle = termTitle
		list = append(list, r)
	}
	// Only the last three terms.
	termIDs := []int64{}
	seenTerm := map[int64]bool{}
	for _, r := range list {
		if !seenTerm[r.termID] {
			seenTerm[r.termID] = true
			termIDs = append(termIDs, r.termID)
		}
	}
	allowed := map[int64]bool{}
	for i, id := range termIDs {
		if i >= 3 {
			break
		}
		allowed[id] = true
	}
	out := []MyClass{}
	for _, r := range list {
		if allowed[r.termID] {
			out = append(out, r.item)
		}
	}
	return out, nil
}

// ClassMessageResult is the send result.
type ClassMessageResult struct {
	OK     bool            `json:"ok"`
	Report *ClassMsgReport `json:"report,omitempty"`
	Error  string          `json:"error,omitempty"`
}

// PreviewClass ports previewMyClass.
func (s *Service) PreviewClass(ctx context.Context, userID, offeringID int64) (int, error) {
	st, err := s.ResolveStaff(ctx, userID)
	if err != nil || st == nil {
		return 0, errNoStaff
	}
	var count int
	err = s.DB.Pool.QueryRow(ctx, `
		select count(*) from enrollments e
		  join students s on s.id = e."studentId"
		  join users u on u.id = s."userId"
		 where e."offeringId" = $1 and s.status = 'ACTIVE' and coalesce(u."isActive",1) = 1`, offeringID).Scan(&count)
	return count, err
}

var profSendable = map[string]bool{"INAPP": true, "SOROUSH": true, "BALE": true, "EITAA": true}

// SendClassMessage ports sendMyClassMessage (in-app delivery; external channel in phase 10).
func (s *Service) SendClassMessage(ctx context.Context, userID, offeringID int64, channels []string, text string) ClassMessageResult {
	st, err := s.ResolveStaff(ctx, userID)
	if err != nil || st == nil {
		return ClassMessageResult{Error: "پروندهٔ هیئت علمی یافت نشد."}
	}
	classes, err := s.myClasses(ctx, st.ID)
	if err != nil {
		return ClassMessageResult{Error: "خطای داخلی سرور."}
	}
	mine := false
	for _, c := range classes {
		if c.OfferingID == offeringID {
			mine = true
		}
	}
	if !mine {
		return ClassMessageResult{Error: "این کلاس مال شما نیست."}
	}
	body := strings.TrimSpace(text)
	if len([]rune(body)) < 3 {
		return ClassMessageResult{Error: "متن پیام خیلی کوتاه است."}
	}
	if len([]rune(body)) > 2000 {
		return ClassMessageResult{Error: "متن پیام حداکثر ۲۰۰۰ نویسه."}
	}
	validChannels := []string{}
	for _, c := range channels {
		c = strings.ToUpper(strings.TrimSpace(c))
		if profSendable[c] {
			validChannels = append(validChannels, c)
		}
	}
	if len(validChannels) == 0 {
		return ClassMessageResult{Error: "حداقل یک کانال انتخاب کنید."}
	}
	rows, err := s.DB.Pool.Query(ctx, `
		select u.id from enrollments e
		  join students s on s.id = e."studentId"
		  join users u on u.id = s."userId"
		 where e."offeringId" = $1 and s.status = 'ACTIVE' and coalesce(u."isActive",1) = 1
		 limit 5000`, offeringID)
	if err != nil {
		return ClassMessageResult{Error: "خطای داخلی سرور."}
	}
	userIDs := []int64{}
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err == nil {
			userIDs = append(userIDs, id)
		}
	}
	rows.Close()
	if len(userIDs) == 0 {
		return ClassMessageResult{Error: "در این کلاس دانشجوی فعالی ثبت‌نام نکرده است."}
	}

	eventCode := fmt.Sprintf("PROFMSG_%d_%d", st.ID, time.Now().UnixMilli())
	inbox := 0
	sentBy := map[string]int{}
	for _, uid := range userIDs {
		payload, _ := json.Marshal(map[string]string{"text": body})
		var notificationID int64
		err := s.DB.Pool.QueryRow(ctx, `
			insert into notifications ("userId","eventCode",payload) values ($1,$2,$3) returning id`,
			uid, eventCode, string(payload)).Scan(&notificationID)
		if err != nil {
			continue
		}
		messaging.NotifyExternalDefault(ctx, uid, eventCode, body)
		inbox++
		for _, ch := range validChannels {
			if ch != "INAPP" {
				// External channel: the user's address is verified and sent in phase 10; recorded as SKIPPED here.
				_, _ = s.DB.Pool.Exec(ctx, `
					insert into notification_deliveries ("userId","notificationId","eventCode",channel,status,body)
					values ($1,$2,$3,$4,'SKIPPED',$5)`, uid, notificationID, eventCode, ch, body)
				continue
			}
			_, _ = s.DB.Pool.Exec(ctx, `
				insert into notification_deliveries ("userId","notificationId","eventCode",channel,status,body)
				values ($1,$2,$3,'INAPP','SENT',$4)`, uid, notificationID, eventCode, body)
			sentBy["INAPP"]++
		}
	}
	sent := []ChannelCount{}
	for ch, n := range sentBy {
		sent = append(sent, ChannelCount{Channel: ch, N: n})
	}
	return ClassMessageResult{OK: true, Report: &ClassMsgReport{
		Total: len(userIDs), Inbox: inbox, Sent: sent, NoAddress: []ChannelCount{}, FailedRequests: len(userIDs) - inbox,
	}}
}

// ───────────────────────── Availability ─────────────────────────

// AvailabilityCell is a matrix cell.
type AvailabilityCell struct {
	DayIndex  int    `json:"dayIndex"`
	SlotIndex int    `json:"slotIndex"`
	Status    string `json:"status"`
}

var slotTimes = map[int][2]string{
	1: {"08:00", "10:00"},
	2: {"10:00", "12:00"},
	4: {"13:30", "15:30"},
	5: {"15:30", "17:30"},
	6: {"17:30", "19:30"},
}

// AvailabilityResponse is the availability response.
type AvailabilityResponse struct {
	Professor      ProfessorInfo      `json:"professor"`
	Term           TermInfo           `json:"term"`
	Cells          []AvailabilityCell `json:"cells"`
	Notes          string             `json:"notes"`
	MaxWeeklyUnits float64            `json:"maxWeeklyUnits"`
}

// GetAvailability ports loadAvailabilityAction.
func (s *Service) GetAvailability(ctx context.Context, userID int64, cookie *int64) (*AvailabilityResponse, error) {
	st, err := s.ResolveStaff(ctx, userID)
	if err != nil {
		return nil, err
	}
	if st == nil {
		return nil, errNoStaff
	}
	term := s.ResolveTerm(ctx, st.UniversityID, cookie)
	resp := &AvailabilityResponse{Professor: s.professorInfo(ctx, st), Term: term, Cells: []AvailabilityCell{}}
	if term.ID == nil {
		return resp, nil
	}
	_ = s.DB.Pool.QueryRow(ctx, `
		select coalesce("baseDutyUnits",0) from professor_term_contracts
		 where "staffId" = $1 and "termId" = $2 limit 1`, st.ID, *term.ID).Scan(&resp.MaxWeeklyUnits)

	rows, err := s.DB.Pool.Query(ctx, `
		select "dayOfWeek", "startTime"::text, "endTime"::text, coalesce(status,'AVAIL')
		  from professor_availabilities where "staffId" = $1 and "termId" = $2`, st.ID, *term.ID)
	if err != nil {
		return nil, err
	}
	cellMap := map[[2]int]string{}
	for rows.Next() {
		var day *int
		var start, end, status string
		if err := rows.Scan(&day, &start, &end, &status); err != nil {
			continue
		}
		if day == nil {
			continue
		}
		for slot, times := range slotTimes {
			if times[0] == start[:minInt(5, len(start))] && times[1] == end[:minInt(5, len(end))] {
				cellMap[[2]int{*day, slot}] = status
			}
		}
	}
	rows.Close()
	for d := 0; d < 7; d++ {
		for slot := 1; slot <= 6; slot++ {
			if slot == 3 {
				continue
			}
			status, ok := cellMap[[2]int{d, slot}]
			if !ok {
				status = "UNAVAIL"
			}
			resp.Cells = append(resp.Cells, AvailabilityCell{DayIndex: d, SlotIndex: slot, Status: status})
		}
	}
	_ = s.DB.Pool.QueryRow(ctx, `
		select coalesce(note,'') from professor_availability_notes
		 where "staffId" = $1 and "termId" = $2 limit 1`, st.ID, *term.ID).Scan(&resp.Notes)
	return resp, nil
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// SaveAvailability ports saveAvailabilityAction.
func (s *Service) SaveAvailability(ctx context.Context, userID, termID int64, cells []AvailabilityCell, notes string) error {
	st, err := s.ResolveStaff(ctx, userID)
	if err != nil || st == nil {
		return errNoStaff
	}
	if termID <= 0 {
		return errors.New("ترم نامعتبر است.")
	}
	for _, c := range cells {
		if c.DayIndex < 0 || c.DayIndex > 6 || c.SlotIndex < 1 || c.SlotIndex > 6 ||
			(c.Status != "PREF" && c.Status != "AVAIL" && c.Status != "UNAVAIL") {
			return errors.New("سلول‌های نامعتبر در ماتریس.")
		}
	}
	tx, err := s.DB.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	if _, err := tx.Exec(ctx, `delete from professor_availabilities where "staffId" = $1 and "termId" = $2`, st.ID, termID); err != nil {
		return err
	}
	for _, c := range cells {
		if c.Status == "UNAVAIL" {
			continue
		}
		times, ok := slotTimes[c.SlotIndex]
		if !ok {
			continue
		}
		if _, err := tx.Exec(ctx, `
			insert into professor_availabilities ("staffId","termId","dayOfWeek","startTime","endTime",status)
			values ($1,$2,$3,$4,$5,$6)`, st.ID, termID, c.DayIndex, times[0], times[1], c.Status); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(ctx, `
		insert into professor_availability_notes ("staffId","termId",note,"updatedAt")
		values ($1,$2,$3,now())
		on conflict ("staffId","termId") do update set note = excluded.note, "updatedAt" = now()`,
		st.ID, termID, strings.TrimSpace(notes)); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
