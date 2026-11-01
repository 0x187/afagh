// ═══ instructor exam payments — port of payroll/exam-payments ═══
package payroll

import (
	"context"
	"errors"
	"strconv"
	"strings"
)

// ExamPaymentRow is an exam payment row.
type ExamPaymentRow struct {
	ID                int64   `json:"id"`
	StaffID           int64   `json:"staffId"`
	TermID            int64   `json:"termId"`
	Source            string  `json:"source"`
	SessionCount      int     `json:"sessionCount"`
	UnitCount         float64 `json:"unitCount"`
	Amount            float64 `json:"amount"`
	DecreeID          *int64  `json:"decreeId"`
	CreatedAt         *string `json:"createdAt"`
	StaffCode         *string `json:"staffCode"`
	StaffName         string  `json:"staffName"`
	ArchiveDeliveries int     `json:"archiveDeliveries"`
	ArchivePending    int     `json:"archivePending"`
}

// NotReadyRow: an instructor whose papers have not returned to the archive.
type NotReadyRow struct {
	StaffID   int64   `json:"staffId"`
	StaffCode *string `json:"staffCode"`
	Name      string  `json:"name"`
	Pending   int     `json:"pending"`
	Payments  int     `json:"payments"`
}

// ListExamPayments lists a term's payments with archive status.
func (e *Engine) ListExamPayments(ctx context.Context, termID int64, universityID *int64) ([]ExamPaymentRow, error) {
	args := []any{termID}
	where := ` where ep."termId" = $1`
	if universityID != nil {
		args = append(args, *universityID)
		where += ` and ep."universityId" = $2`
	}
	rows, err := e.Pool.Query(ctx, `
		select ep.id, ep."staffId", ep."termId", ep.source, coalesce(ep."sessionCount",0),
		       ep."unitCount"::float8, ep.amount::float8, ep."decreeId", ep."createdAt"::text,
		       st."staffCode", coalesce(u."firstName" || ' ' || u."lastName",''),
		       (select count(*)::int from instructor_deliveries d
		          join course_offerings o on o.id = d."courseOfferingId"
		         where d."instructorId" = ep."staffId" and o."termId" = $1),
		       (select count(*)::int from instructor_deliveries d
		          join course_offerings o on o.id = d."courseOfferingId"
		         where d."instructorId" = ep."staffId" and o."termId" = $1
		           and coalesce(d."papersReturnedToArchive",0) = 0)
		  from exam_payments ep
		  join staff st on st.id = ep."staffId"
		  join users u on u.id = st."userId"`+where+`
		 order by ep."createdAt" desc limit 200`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ExamPaymentRow{}
	for rows.Next() {
		var r ExamPaymentRow
		if err := rows.Scan(&r.ID, &r.StaffID, &r.TermID, &r.Source, &r.SessionCount,
			&r.UnitCount, &r.Amount, &r.DecreeID, &r.CreatedAt, &r.StaffCode, &r.StaffName,
			&r.ArchiveDeliveries, &r.ArchivePending); err == nil {
			r.StaffName = strings.TrimSpace(r.StaffName)
			if r.StaffName == "" {
				r.StaffName = "—"
			}
			out = append(out, r)
		}
	}
	return out, nil
}

// NotReadyForTerm: instructors whose papers have not returned to the archive (payment condition).
func (e *Engine) NotReadyForTerm(ctx context.Context, termID int64) ([]NotReadyRow, error) {
	rows, err := e.Pool.Query(ctx, `
		select st.id, st."staffCode", coalesce(u."firstName" || ' ' || u."lastName",''),
		       count(*)::int as pending,
		       coalesce((select count(*) from exam_payments ep where ep."staffId" = st.id and ep."termId" = $1),0)::int as payments
		  from instructor_deliveries d
		  join course_offerings o on o.id = d."courseOfferingId"
		  join staff st on st.id = d."instructorId"
		  left join users u on u.id = st."userId"
		 where o."termId" = $1 and coalesce(d."papersReturnedToArchive",0) = 0
		 group by st.id, st."staffCode", u."firstName", u."lastName"
		 order by pending desc limit 20`, termID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []NotReadyRow{}
	for rows.Next() {
		var r NotReadyRow
		if err := rows.Scan(&r.StaffID, &r.StaffCode, &r.Name, &r.Pending, &r.Payments); err == nil {
			r.Name = strings.TrimSpace(r.Name)
			out = append(out, r)
		}
	}
	return out, nil
}

// CreateExamPaymentInput is the payment registration input.
type CreateExamPaymentInput struct {
	StaffID      int64
	TermID       int64
	Source       string
	SessionCount int
	UnitCount    float64
	Amount       float64
	UniversityID *int64
	CreatedBy    int64
}

// CreateExamPayment ports createAction (source INVIGILATION|CORRECTION|EXEC).
func (e *Engine) CreateExamPayment(ctx context.Context, in CreateExamPaymentInput) (int64, error) {
	src := strings.ToUpper(strings.TrimSpace(in.Source))
	if src != "INVIGILATION" && src != "CORRECTION" && src != "EXEC" {
		return 0, errors.New("منبع نامعتبر است.")
	}
	if in.Amount < 0 {
		return 0, errors.New("مبلغ نامعتبر است.")
	}
	sessions := in.SessionCount
	if sessions < 0 {
		sessions = 0
	}
	units := in.UnitCount
	if units < 0 {
		units = 0
	}
	var id int64
	if err := e.Pool.QueryRow(ctx, `
		insert into exam_payments ("staffId","termId",source,"sessionCount","unitCount",amount,"createdBy","universityId")
		values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
		in.StaffID, in.TermID, src, sessions, strconv.FormatFloat(units, 'f', -1, 64), strconv.FormatFloat(in.Amount, 'f', -1, 64), in.CreatedBy, in.UniversityID).Scan(&id); err != nil {
		return 0, err
	}
	return id, nil
}

// DeleteExamPayment deletes a payment.
func (e *Engine) DeleteExamPayment(ctx context.Context, id int64) error {
	_, err := e.Pool.Exec(ctx, `delete from exam_payments where id = $1`, id)
	return err
}
