// ═══ Workflow event bus — port of workflow-events.ts + workflow-handlers.ts ═══
//
// The BPM engine only moves the state and records the event *inside* the transaction;
// the business effect of each process runs in the owner module's "handler" (after commit).
package workflow

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"

	"backend-go/internal/tuition"
)

// Handler is an event handler.
type Handler struct {
	Name        string
	ProcessCode string
	Events      []string
	Run         func(ctx context.Context, ev Event) error
}

// Event is an event.
type Event struct {
	ID                int64
	RequestID         int64
	TrackingCode      string
	StudentID         int64
	ProcessCode       string
	EventCode         string
	FormData          map[string]any
	CertificateNumber *string
}

func (e *Engine) handlersFor(processCode, eventCode string) []Handler {
	out := []Handler{}
	for _, h := range e.Handlers {
		if h.ProcessCode != processCode {
			continue
		}
		for _, ev := range h.Events {
			if ev == eventCode {
				out = append(out, h)
				break
			}
		}
	}
	return out
}

func parsePayload(raw *string) map[string]any {
	out := map[string]any{}
	if raw == nil || strings.TrimSpace(*raw) == "" {
		return out
	}
	var v any
	if err := json.Unmarshal([]byte(*raw), &v); err != nil {
		return out
	}
	if m, ok := v.(map[string]any); ok {
		if fd, ok := m["formData"].(map[string]any); ok {
			return fd
		}
		return m
	}
	return out
}

func formDataRaw(raw *string) map[string]any {
	out := map[string]any{}
	if raw == nil || strings.TrimSpace(*raw) == "" {
		return out
	}
	var m map[string]any
	if err := json.Unmarshal([]byte(*raw), &m); err == nil && m != nil {
		return m
	}
	return out
}

// fireEvent records PENDING for every matching handler — inside the workflow transaction.
func (e *Engine) fireEvent(ctx context.Context, tx pgx.Tx, requestID int64, processCode, eventCode string, formData *string) {
	if processCode == "" {
		return
	}
	handlers := e.handlersFor(processCode, eventCode)
	if len(handlers) == 0 {
		return
	}
	payload, _ := json.Marshal(map[string]any{"eventCode": eventCode, "formData": formDataRaw(formData)})
	for _, h := range handlers {
		_, _ = tx.Exec(ctx, `
			insert into workflow_events ("requestId","processCode","eventCode",handler,payload,status,attempts)
			values ($1,$2,$3,$4,$5,'PENDING',0)`,
			requestID, processCode, eventCode, h.Name, string(payload))
	}
}

type dispatchMeta struct {
	processCode       string
	eventCode         string
	stepTitle         *string
	actorRole         string
	note              string
	certificateNumber *string
}

// DispatchAfterCommit processes a request's PENDING events — after commit.
func (e *Engine) DispatchAfterCommit(ctx context.Context, requestID int64, intent *dispatchIntent) DispatchStats {
	stats := DispatchStats{}
	var trackingCode string
	var studentID int64
	var certificateNumber *string
	_ = e.Pool.QueryRow(ctx, `
		select coalesce("trackingCode",''), "studentId", "certificateNumber"
		  from student_requests where id = $1`, requestID).Scan(&trackingCode, &studentID, &certificateNumber)

	rows, err := e.Pool.Query(ctx, `
		select id, "processCode", "eventCode", handler, payload
		  from workflow_events
		 where "requestId" = $1 and status = 'PENDING' order by id`, requestID)
	if err != nil {
		return stats
	}
	type pendingRow struct {
		ID          int64
		ProcessCode string
		EventCode   string
		Handler     string
		Payload     *string
	}
	pending := []pendingRow{}
	for rows.Next() {
		var p pendingRow
		if err := rows.Scan(&p.ID, &p.ProcessCode, &p.EventCode, &p.Handler, &p.Payload); err == nil {
			pending = append(pending, p)
		}
	}
	rows.Close()

	for _, row := range pending {
		var handler *Handler
		for i := range e.Handlers {
			h := &e.Handlers[i]
			if h.Name == row.Handler && h.ProcessCode == row.ProcessCode {
				handler = h
				break
			}
		}
		if handler == nil {
			_, _ = e.Pool.Exec(ctx, `
				update workflow_events set status = 'SKIPPED', error = 'هندلری برای این رویداد ثبت نشده است.',
				  attempts = attempts + 1, "processedAt" = now() where id = $1`, row.ID)
			stats.Skipped++
			continue
		}
		ev := Event{
			ID: row.ID, RequestID: requestID, TrackingCode: trackingCode, StudentID: studentID,
			ProcessCode: row.ProcessCode, EventCode: row.EventCode,
			FormData: parsePayload(row.Payload), CertificateNumber: certificateNumber,
		}
		if err := safeRun(ctx, *handler, ev); err != nil {
			_, _ = e.Pool.Exec(ctx, `
				update workflow_events set status = 'FAILED', error = $2,
				  attempts = attempts + 1, "processedAt" = now() where id = $1`, row.ID, truncRunes(err.Error(), 500))
			stats.Failed++
			continue
		}
		_, _ = e.Pool.Exec(ctx, `
			update workflow_events set status = 'PROCESSED', error = null,
			  attempts = attempts + 1, "processedAt" = now() where id = $1`, row.ID)
		stats.Processed++
	}

	// Optional webhook — no effect on the workflow.
	e.postWebhook(ctx, requestID, trackingCode, studentID, intent, certificateNumber)
	return stats
}

func safeRun(ctx context.Context, h Handler, ev Event) (err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("panic: %v", r)
		}
	}()
	return h.Run(ctx, ev)
}

func (e *Engine) postWebhook(ctx context.Context, requestID int64, trackingCode string, studentID int64, intent *dispatchIntent, certificateNumber *string) {
	if e.Settings == nil || intent == nil {
		return
	}
	url, _ := e.Settings.Get(ctx, "WORKFLOW_WEBHOOK_URL")
	url = strings.TrimSpace(url)
	if url == "" {
		return
	}
	cert := ""
	if certificateNumber != nil {
		cert = *certificateNumber
	}
	body, _ := json.Marshal(map[string]any{
		"eventCode": intent.eventCode, "processCode": intent.processCode,
		"trackingCode": trackingCode, "requestId": requestID,
		"studentId": studentID, "certificateNumber": cert,
	})
	postWebhookSafe(url, body)
}

// EventRow is an event for inbox display.
type EventRow struct {
	ID          int64   `json:"id"`
	EventCode   string  `json:"eventCode"`
	Handler     string  `json:"handler"`
	Status      string  `json:"status"`
	Error       *string `json:"error"`
	Attempts    int     `json:"attempts"`
	FiredAt     *string `json:"firedAt"`
	ProcessedAt *string `json:"processedAt"`
}

// EventsForRequest is a case's events.
func (e *Engine) EventsForRequest(ctx context.Context, requestID int64) ([]EventRow, error) {
	rows, err := e.Pool.Query(ctx, `
		select id, coalesce("eventCode",''), coalesce(handler,''), coalesce(status,'PENDING'),
		       error, coalesce(attempts,0), "firedAt"::text, "processedAt"::text
		  from workflow_events where "requestId" = $1 order by id`, requestID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []EventRow{}
	for rows.Next() {
		var r EventRow
		if err := rows.Scan(&r.ID, &r.EventCode, &r.Handler, &r.Status, &r.Error, &r.Attempts, &r.FiredAt, &r.ProcessedAt); err == nil {
			out = append(out, r)
		}
	}
	return out, nil
}

// RetryResult is the result of re-running events.
type RetryResult struct {
	Retried int `json:"retried"`
	OK      int `json:"ok"`
	Failed  int `json:"failed"`
}

// RetryPendingWorkflowEvents re-runs FAILED/SKIPPED events (up to limit).
func (e *Engine) RetryPendingWorkflowEvents(ctx context.Context, limit int) (*RetryResult, error) {
	if limit <= 0 || limit > 500 {
		limit = 50
	}
	rows, err := e.Pool.Query(ctx, `
		select id, "requestId", coalesce("processCode",''), coalesce("eventCode",'')
		  from workflow_events where status in ('FAILED','SKIPPED') order by id limit $1`, limit)
	if err != nil {
		return nil, err
	}
	type rrow struct {
		ID          int64
		RequestID   int64
		ProcessCode string
		EventCode   string
	}
	list := []rrow{}
	for rows.Next() {
		var r rrow
		if err := rows.Scan(&r.ID, &r.RequestID, &r.ProcessCode, &r.EventCode); err == nil {
			list = append(list, r)
		}
	}
	rows.Close()

	res := &RetryResult{}
	seen := map[int64]bool{}
	for _, r := range list {
		if seen[r.RequestID] {
			continue
		}
		seen[r.RequestID] = true
		_, _ = e.Pool.Exec(ctx, `update workflow_events set status = 'PENDING', error = null where id = $1`, r.ID)
		stats := e.DispatchAfterCommit(ctx, r.RequestID, &dispatchIntent{processCode: r.ProcessCode, eventCode: r.EventCode})
		res.OK += stats.Processed
		res.Failed += stats.Failed
	}
	res.Retried = len(list)
	return res, nil
}

// ─────────────────── Standard handlers (port of workflow-handlers.ts) ───────────────────

// RegisterDefaultHandlers registers the standard handlers; tuitionEng for the
// COURSE_TRANSFER path (equivalency registration + tuition charge).
func (e *Engine) RegisterDefaultHandlers(tuitionEng *tuition.Engine) {
	// Major change — updates the student's major after final approval.
	e.Handlers = append(e.Handlers, Handler{
		Name: "MAJOR_CHANGE_APPLY", ProcessCode: "MAJOR_CHANGE",
		Events: []string{"WORKFLOW_FINAL_APPROVED"},
		Run: func(ctx context.Context, ev Event) error {
			targetMajor := toInt64(ev.FormData["targetMajorId"])
			termID := toInt64(ev.FormData["termId"])
			if targetMajor == 0 || termID == 0 {
				return fmt.Errorf("targetMajorId یا termId در فرم وجود ندارد.")
			}
			var exists bool
			if err := e.Pool.QueryRow(ctx, `select exists(select 1 from majors where id = $1)`, targetMajor).Scan(&exists); err != nil || !exists {
				return fmt.Errorf("رشته مقصد یافت نشد.")
			}
			_, err := e.Pool.Exec(ctx, `update students set "majorId" = $2 where id = $1`, ev.StudentID, targetMajor)
			return err
		},
	})

	// Unit matching — records the course in the transcript via the education engine.
	e.Handlers = append(e.Handlers, Handler{
		Name: "COURSE_TRANSFER_ENROLL", ProcessCode: "COURSE_TRANSFER",
		Events: []string{"WORKFLOW_FINAL_APPROVED"},
		Run: func(ctx context.Context, ev Event) error {
			if tuitionEng == nil {
				return fmt.Errorf("موتور شهریه در دسترس نیست.")
			}
			var uniID *int64
			if err := e.Pool.QueryRow(ctx, `select "universityId" from students where id = $1`, ev.StudentID).Scan(&uniID); err != nil || uniID == nil {
				return fmt.Errorf("دانشگاه دانشجو مشخص نیست؛ ثبت تطبیق واحد انجام نشد.")
			}
			items, _ := ev.FormData["items"].([]any)
			if len(items) > 0 {
				return e.applyEquivalenceBatch(ctx, tuitionEng, ev, *uniID, items)
			}
			return e.applySingleTransfer(ctx, tuitionEng, ev, *uniID)
		},
	})

	// Logs the proposal's final approval (no business effect).
	e.Handlers = append(e.Handlers, Handler{
		Name: "PROPOSAL_TRACKING_LOG", ProcessCode: "PROPOSAL_TRACKING",
		Events: []string{"WORKFLOW_FINAL_APPROVED"},
		Run:    func(ctx context.Context, ev Event) error { return nil },
	})
}

func toInt64(v any) int64 {
	switch n := v.(type) {
	case float64:
		return int64(n)
	case int64:
		return n
	case int:
		return int64(n)
	case json.Number:
		i, _ := n.Int64()
		return i
	case string:
		var i int64
		fmt.Sscanf(strings.TrimSpace(n), "%d", &i)
		return i
	}
	return 0
}

func toFloat(v any) (float64, bool) {
	switch n := v.(type) {
	case float64:
		return n, true
	case int:
		return float64(n), true
	case int64:
		return float64(n), true
	case json.Number:
		f, err := n.Float64()
		return f, err == nil
	case string:
		var f float64
		_, err := fmt.Sscanf(strings.TrimSpace(n), "%g", &f)
		return f, err == nil
	}
	return 0, false
}

// applySingleTransfer is a port of applyCourseTransfer (single-course path).
func (e *Engine) applySingleTransfer(ctx context.Context, tuitionEng *tuition.Engine, ev Event, uniID int64) error {
	code := strings.TrimSpace(fmt.Sprint(ev.FormData["targetCourseCode"]))
	if code == "" {
		return fmt.Errorf("کد درس مقصد در فرم تطبیق واحد وارد نشده است.")
	}
	var courseID int64
	var courseTitle string
	err := e.Pool.QueryRow(ctx, `
		select id, title from courses
		 where code = $1 and ("universityId" = $2 or "universityId" is null) limit 1`, code, uniID).
		Scan(&courseID, &courseTitle)
	if err != nil {
		return fmt.Errorf("درس مقصد با کد «%s» در چارت دانشگاه تعریف نشده است.", code)
	}
	var termID int64
	if err := e.Pool.QueryRow(ctx, `
		select id from academic_terms where "isCurrent" = 1 and "universityId" = $1 limit 1`, uniID).Scan(&termID); err != nil {
		return fmt.Errorf("ترم جاری دانشگاه مشخص نیست؛ ثبت درس تطبیق‌شده ممکن نشد.")
	}
	grade, _ := toFloat(ev.FormData["sourceGrade"])
	const equivMinGrade = 12.0
	if _, ok := ev.FormData["sourceGrade"]; ok && grade < equivMinGrade {
		return fmt.Errorf("بر اساس آیین‌نامه، فقط نمرات %v و بالاتر قابل معادل‌سازی است (نمرهٔ واردشده: %v).", equivMinGrade, grade)
	}
	// Register in the TRANSFER offering
	var offeringID int64
	err = e.Pool.QueryRow(ctx, `
		select id from course_offerings where "courseId" = $1 and "termId" = $2 and "offeringType" = 'TRANSFER' limit 1`,
		courseID, termID).Scan(&offeringID)
	createdOffering := false
	if err != nil {
		err = e.Pool.QueryRow(ctx, `
			insert into course_offerings ("termId","courseId","groupNumber",capacity,"enrolledCount","offeringType","isActive")
			values ($1,$2,900,500,0,'TRANSFER',1) returning id`, termID, courseID).Scan(&offeringID)
		if err != nil {
			_ = e.Pool.QueryRow(ctx, `
				select id from course_offerings where "courseId" = $1 and "termId" = $2 and "offeringType" = 'TRANSFER' limit 1`,
				courseID, termID).Scan(&offeringID)
		}
		createdOffering = true
	}
	gradeStatus := "FINALIZED"
	var existingID int64
	err = e.Pool.QueryRow(ctx, `select id from enrollments where "studentId" = $1 and "offeringId" = $2 limit 1`,
		ev.StudentID, offeringID).Scan(&existingID)
	gradeStr := strconvF(grade)
	if err == nil {
		if _, uerr := e.Pool.Exec(ctx, `
			update enrollments set status = 'REGISTERED', "workflowRequestId" = $2, "gradeValue" = $3, "gradeStatus" = $4
			 where id = $1`, existingID, ev.RequestID, gradeStr, gradeStatus); uerr != nil {
			return uerr
		}
	} else {
		if _, ierr := e.Pool.Exec(ctx, `
			insert into enrollments ("studentId","offeringId","isDirectedReading",status,"workflowRequestId","gradeValue","gradeStatus")
			values ($1,$2,0,'REGISTERED',$3,$4,$5)`, ev.StudentID, offeringID, ev.RequestID, gradeStr, gradeStatus); ierr != nil {
			return ierr
		}
	}
	if createdOffering {
		_, _ = e.Pool.Exec(ctx, `
			update course_offerings set "enrolledCount" = (select count(*)::int from enrollments where "offeringId" = $1 and status <> 'DROPPED')
			 where id = $1`, offeringID)
	}
	_ = courseTitle
	return nil
}

// applyEquivalenceBatch is a port of applyEquivalenceBatch — one equivalency term per 20 units.
func (e *Engine) applyEquivalenceBatch(ctx context.Context, tuitionEng *tuition.Engine, ev Event, uniID int64, items []any) error {
	const equivMinGrade = 12.0
	const equivTermUnits = 20.0

	type ready struct {
		CourseID int64
		Title    string
		Grade    float64
		Units    float64
	}
	readyList := []ready{}
	for _, raw := range items {
		it, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		grade, _ := toFloat(it["sourceGrade"])
		if grade < equivMinGrade {
			continue
		}
		code := strings.TrimSpace(fmt.Sprint(it["targetCourseCode"]))
		var courseID int64
		var title string
		var courseUnits float64
		err := e.Pool.QueryRow(ctx, `
			select id, title, units::float8 from courses
			 where code = $1 and ("universityId" = $2 or "universityId" is null) limit 1`, code, uniID).
			Scan(&courseID, &title, &courseUnits)
		if err != nil {
			continue
		}
		units, ok := toFloat(it["sourceUnits"])
		if !ok || units <= 0 {
			units = courseUnits
		}
		readyList = append(readyList, ready{CourseID: courseID, Title: title, Grade: grade, Units: units})
	}
	if len(readyList) == 0 {
		return fmt.Errorf("هیچ درس واجد شرایطی برای معادل‌سازی یافت نشد.")
	}
	// Batches every 20 units into one equivalency term.
	chunks := [][]ready{}
	cur := []ready{}
	curUnits := 0.0
	for _, r := range readyList {
		if curUnits+r.Units > equivTermUnits && len(cur) > 0 {
			chunks = append(chunks, cur)
			cur = []ready{}
			curUnits = 0
		}
		cur = append(cur, r)
		curUnits += r.Units
	}
	if len(cur) > 0 {
		chunks = append(chunks, cur)
	}

	for i, chunk := range chunks {
		termCode := fmt.Sprintf("00EQ%d", i+1)
		term, err := tuitionEng.EnsureEquivalenceTerm(ctx, uniID, termCode, fmt.Sprintf("معادل‌سازی — نوبت %d", i+1))
		if err != nil || term == nil {
			continue
		}
		tx, err := e.Pool.Begin(ctx)
		if err != nil {
			return err
		}
		var wfReq *int64
		rid := ev.RequestID
		wfReq = &rid
		for _, r := range chunk {
			if _, err := tuitionEng.ApplyEquivalenceRegistration(ctx, tx, ev.StudentID, term.ID, r.CourseID, r.Grade, wfReq); err != nil {
				_ = tx.Rollback(ctx)
				return err
			}
		}
		if err := tx.Commit(ctx); err != nil {
			return err
		}
		// Charges the equivalency tuition — a missing rule must not break equivalency.
		mode := tuitionEng.GetEquivFixedMode(ctx)
		includeFixed := tuition.ShouldChargeFixed(mode, i == 0)
		_, _, _ = tuitionEng.ChargeTermTuition(ctx, ev.StudentID, term.ID, includeFixed)
	}
	return nil
}

func strconvF(v float64) string { return fmt.Sprintf("%g", v) }
