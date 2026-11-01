// ═══ Submission/capacity helpers ═══
package enroll

import (
	"context"
	"encoding/json"
	"math"
	"strconv"
	"strings"
)

// loadSubmitOfferings fetches cart offerings constrained by term/university/active.
func (s *Service) loadSubmitOfferings(ctx context.Context, ids []int64, termID, universityID int64) ([]submitOffering, error) {
	rows, err := s.DB.Pool.Query(ctx, `
		select o.id, o."courseId", c.code, c.title, c.units, o.capacity,
		       o."enrolledCount", coalesce(o."waitlistCapacity",0),
		       o."targetDegreeLevelId", o."targetMajorId", o."entryYearStart", o."entryYearEnd",
		       coalesce(o."offeringType",'')
		  from course_offerings o
		  join courses c on c.id = o."courseId"
		 where o.id = any($1) and o."termId" = $2 and o."isActive" = 1 and o."universityId" = $3`,
		ids, termID, universityID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []submitOffering{}
	for rows.Next() {
		var o submitOffering
		if err := rows.Scan(&o.ID, &o.CourseID, &o.Code, &o.Title, &o.Units, &o.Capacity,
			&o.Enrolled, &o.WaitCap, &o.TargetDegreeLevelID, &o.TargetMajorID,
			&o.EntryYearStart, &o.EntryYearEnd, &o.OfferingType); err != nil {
			return nil, err
		}
		out = append(out, o)
	}
	return out, rows.Err()
}

// loadSchedules class/exam sessions of the offerings.
func (s *Service) loadSchedules(ctx context.Context, offeringIDs []int64) []scheduleRow {
	if len(offeringIDs) == 0 {
		return nil
	}
	rows, err := s.DB.Pool.Query(ctx, `
		select "offeringId", "scheduleType", "dayOfWeek", "examDate"::text,
		       "startTime"::text, "endTime"::text
		  from schedules where "offeringId" = any($1)`, offeringIDs)
	if err != nil {
		return nil
	}
	defer rows.Close()
	out := []scheduleRow{}
	for rows.Next() {
		var sc scheduleRow
		if err := rows.Scan(&sc.OfferingID, &sc.ScheduleType, &sc.DayOfWeek, &sc.ExamDate, &sc.StartTime, &sc.EndTime); err == nil {
			out = append(out, sc)
		}
	}
	return out
}

// dropCartRows best-effort removal of stale/out-of-target rows.
func (s *Service) dropCartRows(ctx context.Context, studentID int64, offeringIDs []int64) {
	if len(offeringIDs) == 0 {
		return
	}
	_, _ = s.DB.Pool.Exec(ctx, `delete from cart_items where "studentId" = $1 and "offeringId" = any($2)`, studentID, offeringIDs)
}

type capacityInfo struct {
	enrolled int
	capacity int
}

func (s *Service) readFreshCapacities(ctx context.Context, ids []int64) map[int64]capacityInfo {
	out := map[int64]capacityInfo{}
	if len(ids) == 0 {
		return out
	}
	rows, err := s.DB.Pool.Query(ctx, `
		select id, "enrolledCount", capacity from course_offerings where id = any($1)`, ids)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var id int64
		var c capacityInfo
		if err := rows.Scan(&id, &c.enrolled, &c.capacity); err == nil {
			out[id] = c
		}
	}
	return out
}

// claimSeats port of claimSeatsBatch: atomic capacity increment conditioned on available space.
func (s *Service) claimSeats(ctx context.Context, ids []int64) map[int64]bool {
	out := map[int64]bool{}
	if len(ids) == 0 {
		return out
	}
	rows, err := s.DB.Pool.Query(ctx, `
		update course_offerings set "enrolledCount" = "enrolledCount" + 1
		 where id = any($1) and "enrolledCount" < capacity
		 returning id`, ids)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err == nil {
			out[id] = true
		}
	}
	return out
}

// compensateSeat port of compensateSeatDb.
func (s *Service) compensateSeat(ctx context.Context, id int64) {
	_, _ = s.DB.Pool.Exec(ctx, `update course_offerings set "enrolledCount" = greatest("enrolledCount" - 1, 0) where id = $1`, id)
}

func parseFloat(s string) (float64, error) { return strconv.ParseFloat(strings.TrimSpace(s), 64) }

func jsonMarshal(v any) (string, error) {
	raw, err := json.Marshal(v)
	return string(raw), err
}

// faNum simple Persian number (no separators) — for error messages.
func faNum(v float64) string {
	if v == math.Trunc(v) {
		return faGroup(v)
	}
	return faGroup(v)
}

// faGroup thousands separator with Persian digits.
func faGroup(v float64) string {
	neg := v < 0
	if neg {
		v = -v
	}
	n := int64(math.Round(v))
	digits := strconv.FormatInt(n, 10)
	fa := map[rune]rune{'0': '۰', '1': '۱', '2': '۲', '3': '۳', '4': '۴', '5': '۵', '6': '۶', '7': '۷', '8': '۸', '9': '۹'}
	out := []rune{}
	for i, ch := range digits {
		if i > 0 && (len(digits)-i)%3 == 0 {
			out = append(out, '٬')
		}
		if r, ok := fa[ch]; ok {
			ch = r
		}
		out = append(out, ch)
	}
	if neg {
		return "−" + string(out)
	}
	return string(out)
}

// titleList for the notification payload.
func titleList(plans []*submitPlan, waitlisted bool) []string {
	out := []string{}
	for _, p := range plans {
		if p.failMessage != "" || p.excluded {
			continue
		}
		if p.waitlisted == waitlisted {
			out = append(out, p.o.Title)
		}
	}
	return out
}

// submitPlan an offering's schedule in the submission.
type submitPlan struct {
	o              submitOffering
	gotSeat        bool
	redisSeatTaken bool
	waitlisted     bool
	wlPos          *int
	excluded       bool
	failMessage    string
}
