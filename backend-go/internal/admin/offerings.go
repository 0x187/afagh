// ═══ ارائه‌ها و پنجرهٔ انتخاب واحد (ادمین) ═══
package admin

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"backend-go/internal/jalali"
	"backend-go/internal/session"
)

// Option گزینه.
type Option struct {
	ID    int64  `json:"id"`
	Title string `json:"title"`
}

// AdminOffering ردیف ارائه.
type AdminOffering struct {
	ID                  int64   `json:"id"`
	Code                string  `json:"code"`
	Title               string  `json:"title"`
	Group               int     `json:"group"`
	Capacity            int     `json:"capacity"`
	Enrolled            int     `json:"enrolled"`
	TargetDegreeLevelID *int64  `json:"targetDegreeLevelId"`
	TargetMajorID       *int64  `json:"targetMajorId"`
	EntryYearStart      *int    `json:"entryYearStart"`
	EntryYearEnd        *int    `json:"entryYearEnd"`
	OfferingType        *string `json:"offeringType"`
	TargetLabel         string  `json:"targetLabel"`
}

// WindowStatus وضعیت پنجره.
type WindowStatus struct {
	Open  bool    `json:"open"`
	State string  `json:"state"`
	Label string  `json:"label"`
	Start *string `json:"start"`
	End   *string `json:"end"`
}

// AdminOfferingsData پاسخ.
type AdminOfferingsData struct {
	Term      TermInfo        `json:"term"`
	Window    WindowStatus    `json:"window"`
	Offerings []AdminOffering `json:"offerings"`
	Degrees   []Option        `json:"degrees"`
	Majors    []Option        `json:"majors"`
}

// AdminTerm ترم جاری.
type AdminTerm struct {
	ID     *int64 `json:"id"`
	Title  string `json:"title"`
	Code   string `json:"termCode"`
	IsOpen bool   `json:"isEnrollmentOpen"`
}

// was TermInfo name conflict: use AdminTerm alias
type TermInfo = AdminTerm

func faDT(t *time.Time) string {
	if t == nil {
		return "—"
	}
	d := jalali.ToJalaliFromTime(*t)
	return jalali.FaDigits(fmt.Sprintf("%04d/%02d/%02d %02d:%02d", d.Y, d.M, d.D, t.Hour(), t.Minute()))
}

func windowOf(term *AdminTerm, flag int, start, end *time.Time, now time.Time) WindowStatus {
	if term == nil || term.ID == nil {
		return WindowStatus{State: "NO_TERM", Label: "ترم جاری تعریف نشده است."}
	}
	w := WindowStatus{Start: timeISO(start), End: timeISO(end)}
	if flag == 0 {
		w.State = "CLOSED"
		w.Label = "پنجرهٔ انتخاب واحد توسط مدیر بسته است."
		return w
	}
	if start != nil && now.Before(*start) {
		w.State = "BEFORE"
		w.Label = "پنجرهٔ انتخاب واحد از " + faDT(start) + " باز می‌شود."
		return w
	}
	if end != nil && now.After(*end) {
		w.State = "AFTER"
		w.Label = "پنجرهٔ انتخاب واحد در " + faDT(end) + " بسته شد."
		return w
	}
	w.Open = true
	w.State = "OPEN"
	if end != nil {
		w.Label = "پنجرهٔ انتخاب واحد باز است — تا " + faDT(end)
	} else {
		w.Label = "پنجرهٔ انتخاب واحد باز است."
	}
	return w
}

func timeISO(t *time.Time) *string {
	if t == nil {
		return nil
	}
	v := t.Format(time.RFC3339)
	return &v
}

// GetOfferings پورت admin/offerings.
func (s *Service) GetOfferings(ctx context.Context, user *session.User, uniCookie string) (*AdminOfferingsData, error) {
	uniID := s.UniversityID(ctx, user, uniCookie)
	resp := &AdminOfferingsData{Offerings: []AdminOffering{}, Degrees: []Option{}, Majors: []Option{}}
	if uniID == nil {
		resp.Window = WindowStatus{State: "NO_TERM", Label: "دانشگاه فعال مشخص نیست."}
		return resp, nil
	}
	var (
		termID      int64
		title, code string
		flag        int
		start, end  *time.Time
	)
	if err := s.DB.Pool.QueryRow(ctx, `
		select id, title, "termCode", coalesce("isEnrollmentOpen",0), "enrollmentStartDate", "enrollmentEndDate"
		  from academic_terms where "isCurrent" = 1 and "universityId" = $1 order by id desc limit 1`, *uniID).
		Scan(&termID, &title, &code, &flag, &start, &end); err != nil {
		resp.Window = WindowStatus{State: "NO_TERM", Label: "ترم جاری تعریف نشده است."}
		return resp, nil
	}
	resp.Term = AdminTerm{ID: &termID, Title: title, Code: code, IsOpen: flag != 0}
	resp.Window = windowOf(&resp.Term, flag, start, end, time.Now())

	rows, err := s.DB.Pool.Query(ctx, `
		select o.id, c.code, c.title, coalesce(o."groupNumber",0), o.capacity, coalesce(o."enrolledCount",0),
		       o."targetDegreeLevelId", o."targetMajorId", o."entryYearStart", o."entryYearEnd", o."offeringType"
		  from course_offerings o join courses c on c.id = o."courseId"
		 where o."termId" = $1 and o."isActive" = 1
		 order by c.code`, termID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var o AdminOffering
		if err := rows.Scan(&o.ID, &o.Code, &o.Title, &o.Group, &o.Capacity, &o.Enrolled,
			&o.TargetDegreeLevelID, &o.TargetMajorID, &o.EntryYearStart, &o.EntryYearEnd, &o.OfferingType); err == nil {
			resp.Offerings = append(resp.Offerings, o)
		}
	}
	rows.Close()

	drows, err := s.DB.Pool.Query(ctx, `select id, title from degree_level_configs order by id`)
	if err == nil {
		for drows.Next() {
			var d Option
			if err := drows.Scan(&d.ID, &d.Title); err == nil {
				resp.Degrees = append(resp.Degrees, d)
			}
		}
		drows.Close()
	}
	mrows, err := s.DB.Pool.Query(ctx, `select id, name from majors where "universityId" = $1 order by name`, *uniID)
	if err == nil {
		for mrows.Next() {
			var m Option
			if err := mrows.Scan(&m.ID, &m.Title); err == nil {
				resp.Majors = append(resp.Majors, m)
			}
		}
		mrows.Close()
	}

	// برچسب هدف‌گیری.
	degTitle := map[int64]string{}
	for _, d := range resp.Degrees {
		degTitle[d.ID] = d.Title
	}
	majorTitle := map[int64]string{}
	for _, m := range resp.Majors {
		majorTitle[m.ID] = m.Title
	}
	for i := range resp.Offerings {
		o := &resp.Offerings[i]
		parts := []string{}
		if o.TargetDegreeLevelID != nil {
			parts = append(parts, degTitle[*o.TargetDegreeLevelID])
		}
		if o.TargetMajorID != nil {
			parts = append(parts, "رشتهٔ "+majorTitle[*o.TargetMajorID])
		}
		if o.EntryYearStart != nil || o.EntryYearEnd != nil {
			startYear := "•"
			if o.EntryYearStart != nil {
				startYear = itoa(int64(*o.EntryYearStart))
			}
			endYear := "•"
			if o.EntryYearEnd != nil {
				endYear = itoa(int64(*o.EntryYearEnd))
			}
			parts = append(parts, "ورودی "+startYear+" تا "+endYear)
		}
		if len(parts) == 0 {
			o.TargetLabel = "همه"
		} else {
			o.TargetLabel = strings.Join(parts, " · ")
		}
	}
	return resp, nil
}

// SaveWindow پورت saveWindowAction.
func (s *Service) SaveWindow(ctx context.Context, user *session.User, uniCookie string, termID int64, open bool, startInput, endInput string) error {
	uniID := s.UniversityID(ctx, user, uniCookie)
	if uniID == nil {
		return errors.New("دانشگاه فعال مشخص نیست.")
	}
	var termUni *int64
	if err := s.DB.Pool.QueryRow(ctx, `select "universityId" from academic_terms where id = $1`, termID).Scan(&termUni); err != nil {
		return errors.New("ترم یافت نشد.")
	}
	if termUni != nil && *termUni != *uniID {
		return errors.New("این ترم متعلق به دانشگاه فعال نیست.")
	}
	var start, end *time.Time
	if strings.TrimSpace(startInput) != "" {
		if t, err := parseLocalInput(startInput); err == nil {
			start = &t
		}
	}
	if strings.TrimSpace(endInput) != "" {
		if t, err := parseLocalInput(endInput); err == nil {
			end = &t
		}
	}
	flag := 0
	if open {
		flag = 1
	}
	_, err := s.DB.Pool.Exec(ctx, `
		update academic_terms set "isEnrollmentOpen" = $1, "enrollmentStartDate" = $2,
		       "enrollmentEndDate" = $3 where id = $4`, flag, start, end, termID)
	return err
}

func parseLocalInput(v string) (time.Time, error) {
	v = strings.TrimSpace(v)
	for _, layout := range []string{"2006-01-02T15:04", "2006-01-02T15:04:05", time.RFC3339} {
		if t, err := time.ParseInLocation(layout, v, time.Local); err == nil {
			return t, nil
		}
	}
	return time.Time{}, errors.New("قالب زمان نامعتبر است.")
}

// SaveTargeting پورت saveTargetingAction.
func (s *Service) SaveTargeting(ctx context.Context, user *session.User, uniCookie string, offeringID int64, degree, major *int64, ys, ye *int) error {
	uniID := s.UniversityID(ctx, user, uniCookie)
	if uniID == nil {
		return errors.New("دانشگاه فعال مشخص نیست.")
	}
	if ys != nil && ye != nil && *ys > *ye {
		return errors.New("بازهٔ سال ورودی نامعتبر است.")
	}
	var offUni *int64
	if err := s.DB.Pool.QueryRow(ctx, `select "universityId" from course_offerings where id = $1`, offeringID).Scan(&offUni); err != nil {
		return errors.New("ارائه یافت نشد.")
	}
	if offUni != nil && *offUni != *uniID {
		return errors.New("این ارائه متعلق به دانشگاه فعال نیست.")
	}
	_, err := s.DB.Pool.Exec(ctx, `
		update course_offerings set "targetDegreeLevelId" = $1, "targetMajorId" = $2,
		       "entryYearStart" = $3, "entryYearEnd" = $4 where id = $5`,
		degree, major, ys, ye, offeringID)
	return err
}

// SaveOfferingType پورت saveOfferingTypeAction.
func (s *Service) SaveOfferingType(ctx context.Context, user *session.User, uniCookie string, offeringID int64, offeringType string) error {
	uniID := s.UniversityID(ctx, user, uniCookie)
	if uniID == nil {
		return errors.New("دانشگاه فعال مشخص نیست.")
	}
	t := strings.ToUpper(strings.TrimSpace(offeringType))
	if t != "NORMAL" && t != "SUMMER" && t != "DIRECTED_READING" {
		return errors.New("نوع ارائه نامعتبر است.")
	}
	var offUni *int64
	if err := s.DB.Pool.QueryRow(ctx, `select "universityId" from course_offerings where id = $1`, offeringID).Scan(&offUni); err != nil {
		return errors.New("ارائه یافت نشد.")
	}
	if offUni != nil && *offUni != *uniID {
		return errors.New("این ارائه متعلق به دانشگاه فعال نیست.")
	}
	_, err := s.DB.Pool.Exec(ctx, `update course_offerings set "offeringType" = $1 where id = $2`, t, offeringID)
	return err
}
