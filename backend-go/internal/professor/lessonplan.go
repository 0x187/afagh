// ═══ طرح درس استاد — پورت professor/lesson-plan ═══
package professor

import (
	"context"
	"errors"
	"fmt"
	"strings"
)

// PlanSession جلسهٔ طرح درس.
type PlanSession struct {
	ID          int64   `json:"id"`
	SessionNo   int     `json:"sessionNo"`
	SessionKind string  `json:"sessionKind"`
	Topic       string  `json:"topic"`
	Details     *string `json:"details"`
	WeightID    *int64  `json:"weightId"`
}

// PlanWeight وزن ارزشیابی.
type PlanWeight struct {
	ID      int64   `json:"id"`
	Title   string  `json:"title"`
	Percent float64 `json:"percent"`
}

// PlanData طرح درس.
type PlanData struct {
	ID            int64   `json:"id"`
	CourseMode    string  `json:"courseMode"`
	TotalSessions int     `json:"totalSessions"`
	Objectives    string  `json:"objectives"`
	Resources     string  `json:"resources"`
	Status        string  `json:"status"`
	SubmittedAt   *string `json:"submittedAt"`
}

// ProfessorPlanResponse پاسخ ویرایشگر.
type ProfessorPlanResponse struct {
	OfferingID        int64         `json:"offeringId"`
	CourseTitle       string        `json:"courseTitle"`
	CourseModeDefault string        `json:"courseModeDefault"`
	Required          bool          `json:"required"`
	Notice            *string       `json:"notice"`
	IsOwner           bool          `json:"isOwner"`
	Plan              *PlanData     `json:"plan"`
	Sessions          []PlanSession `json:"sessions"`
	Weights           []PlanWeight  `json:"weights"`
}

// GetProfessorPlan پورت getMyPlan.
func (s *Service) GetProfessorPlan(ctx context.Context, userID, offeringID int64) (*ProfessorPlanResponse, error) {
	st, err := s.ResolveStaff(ctx, userID)
	if err != nil {
		return nil, err
	}
	if st == nil {
		return nil, errNoStaff
	}
	var (
		title          string
		nature         *string
		theoryUnits    *float64
		practicalUnits *float64
		professorID    *int64
		universityID   *int64
	)
	err = s.DB.Pool.QueryRow(ctx, `
		select c.title, c."courseNature", c."theoreticalUnits", c."practicalUnits",
		       o."professorId", o."universityId"
		  from course_offerings o join courses c on c.id = o."courseId"
		 where o.id = $1`, offeringID).
		Scan(&title, &nature, &theoryUnits, &practicalUnits, &professorID, &universityID)
	if err != nil {
		return nil, errors.New("ارائهٔ درس یافت نشد.")
	}
	resp := &ProfessorPlanResponse{
		OfferingID: offeringID, CourseTitle: title,
		CourseModeDefault: defaultCourseMode(nature, theoryUnits, practicalUnits),
		IsOwner:           professorID != nil && *professorID == st.ID,
		Sessions:          []PlanSession{}, Weights: []PlanWeight{},
	}
	if universityID != nil {
		var required int
		var notice *string
		if err := s.DB.Pool.QueryRow(ctx, `
			select coalesce("isRequired",0), notice from lesson_plan_settings where "universityId" = $1 limit 1`,
			*universityID).Scan(&required, &notice); err == nil {
			resp.Required = required != 0
			resp.Notice = notice
		}
	}

	var planID int64
	var courseMode, objectives, resources, status string
	var total int
	var submittedAt *string
	err = s.DB.Pool.QueryRow(ctx, `
		select id, coalesce("courseMode",''), coalesce("totalSessions",0),
		       coalesce(objectives,''), coalesce(resources,''), coalesce(status,'DRAFT'),
		       "submittedAt"::text
		  from lesson_plans where "offeringId" = $1 limit 1`, offeringID).
		Scan(&planID, &courseMode, &total, &objectives, &resources, &status, &submittedAt)
	if err != nil {
		return resp, nil
	}
	if strings.TrimSpace(courseMode) == "" {
		courseMode = resp.CourseModeDefault
	}
	resp.Plan = &PlanData{
		ID: planID, CourseMode: courseMode, TotalSessions: total,
		Objectives: objectives, Resources: resources, Status: status, SubmittedAt: submittedAt,
	}
	srows, err := s.DB.Pool.Query(ctx, `
		select id, "sessionNo", coalesce("sessionKind",'THEORY'), coalesce(topic,''), details, "weightId"
		  from lesson_plan_sessions where "planId" = $1 order by "sessionNo"`, planID)
	if err == nil {
		for srows.Next() {
			var ps PlanSession
			if err := srows.Scan(&ps.ID, &ps.SessionNo, &ps.SessionKind, &ps.Topic, &ps.Details, &ps.WeightID); err == nil {
				resp.Sessions = append(resp.Sessions, ps)
			}
		}
		srows.Close()
	}
	wrows, err := s.DB.Pool.Query(ctx, `
		select id, title, percent from lesson_plan_weights where "planId" = $1 order by "sortOrder", id`, planID)
	if err == nil {
		for wrows.Next() {
			var w PlanWeight
			if err := wrows.Scan(&w.ID, &w.Title, &w.Percent); err == nil {
				resp.Weights = append(resp.Weights, w)
			}
		}
		wrows.Close()
	}
	return resp, nil
}

func defaultCourseMode(nature *string, theory, practical *float64) string {
	n := ""
	if nature != nil {
		n = *nature
	}
	hasTheory := strings.Contains(n, "نظری") || (theory != nil && *theory > 0)
	hasPractical := strings.Contains(n, "عملی") || strings.Contains(n, "آزمایش") || strings.Contains(n, "کارگاه") ||
		(practical != nil && *practical > 0)
	if hasTheory && hasPractical {
		return "COMBINED"
	}
	if hasPractical {
		return "PRACTICAL"
	}
	return "THEORY"
}

// SavePlanInput ورودی ذخیره.
type SavePlanInput struct {
	CourseMode    string             `json:"courseMode"`
	TotalSessions int                `json:"totalSessions"`
	Objectives    string             `json:"objectives"`
	Resources     string             `json:"resources"`
	Status        string             `json:"status"`
	Sessions      []PlanSessionInput `json:"sessions"`
	Weights       []PlanWeightInput  `json:"weights"`
}

// PlanSessionInput جلسهٔ ورودی.
type PlanSessionInput struct {
	SessionNo   int    `json:"sessionNo"`
	SessionKind string `json:"sessionKind"`
	Topic       string `json:"topic"`
	Details     string `json:"details"`
	WeightID    *int64 `json:"weightId"`
}

// PlanWeightInput وزن ورودی.
type PlanWeightInput struct {
	Title   string  `json:"title"`
	Percent float64 `json:"percent"`
}

// SaveProfessorPlan پورت saveLessonPlan.
func (s *Service) SaveProfessorPlan(ctx context.Context, userID, offeringID int64, input SavePlanInput) error {
	st, err := s.ResolveStaff(ctx, userID)
	if err != nil || st == nil {
		return errNoStaff
	}
	var professorID *int64
	var universityID *int64
	if err := s.DB.Pool.QueryRow(ctx, `select "professorId", "universityId" from course_offerings where id = $1`, offeringID).
		Scan(&professorID, &universityID); err != nil {
		return errors.New("ارائهٔ درس یافت نشد.")
	}
	if professorID == nil || *professorID != st.ID {
		return errors.New("شما استاد مسئول این درس نیستید.")
	}
	switch input.CourseMode {
	case "THEORY", "PRACTICAL", "COMBINED":
	default:
		return errors.New("حالت درس نامعتبر است.")
	}
	if input.TotalSessions < 1 || input.TotalSessions > 32 {
		return errors.New("تعداد جلسات باید عددی بین ۱ تا ۳۲ باشد.")
	}
	if input.Status != "DRAFT" && input.Status != "SUBMITTED" {
		return errors.New("وضعیت طرح درس نامعتبر است.")
	}
	if len([]rune(input.Objectives)) > 10000 || len([]rune(input.Resources)) > 10000 {
		return errors.New("متن اهداف یا منابع بیش از حد طولانی است.")
	}
	if len(input.Sessions) != input.TotalSessions {
		return fmt.Errorf("تعداد جلسات ارسالی (%d) با تعداد اعلام‌شده (%d) هم‌خوان نیست.", len(input.Sessions), input.TotalSessions)
	}
	seen := map[int]bool{}
	for _, ss := range input.Sessions {
		if ss.SessionNo < 1 || ss.SessionNo > input.TotalSessions || seen[ss.SessionNo] {
			return errors.New("شمارهٔ جلسات باید دقیقاً اعداد ۱ تا تعداد جلسات، بدون تکرار باشد.")
		}
		seen[ss.SessionNo] = true
		switch ss.SessionKind {
		case "THEORY", "PRACTICAL", "COMBINED":
		default:
			ss.SessionKind = "THEORY"
		}
	}

	tx, err := s.DB.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	var planID int64
	err = tx.QueryRow(ctx, `select id from lesson_plans where "offeringId" = $1 limit 1`, offeringID).Scan(&planID)
	if err != nil {
		err = tx.QueryRow(ctx, `
			insert into lesson_plans ("offeringId","courseMode","totalSessions",objectives,resources,status,"submittedAt","universityId")
			values ($1,$2,$3,$4,$5,$6::text,case when $6::text = 'SUBMITTED' then now() else null end,$7)
			returning id`,
			offeringID, input.CourseMode, input.TotalSessions, input.Objectives, input.Resources, input.Status, universityID).Scan(&planID)
		if err != nil {
			return err
		}
	} else {
		if _, err := tx.Exec(ctx, `
			update lesson_plans set "courseMode" = $1, "totalSessions" = $2, objectives = $3,
			       resources = $4, status = $5::text,
			       "submittedAt" = case when $5::text = 'SUBMITTED' then now() else "submittedAt" end,
			       "updatedAt" = now()
			 where id = $6`,
			input.CourseMode, input.TotalSessions, input.Objectives, input.Resources, input.Status, planID); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(ctx, `delete from lesson_plan_sessions where "planId" = $1`, planID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `delete from lesson_plan_weights where "planId" = $1`, planID); err != nil {
		return err
	}
	// وزن‌ها اول تا شناسه داشته باشیم.
	weightIDs := make([]int64, len(input.Weights))
	for i, w := range input.Weights {
		title := strings.TrimSpace(w.Title)
		if title == "" {
			title = fmt.Sprintf("مؤلفهٔ %d", i+1)
		}
		if w.Percent < 0 || w.Percent > 100 {
			return errors.New("درصد وزن‌ها باید بین ۰ تا ۱۰۰ باشد.")
		}
		var id int64
		if err := tx.QueryRow(ctx, `
			insert into lesson_plan_weights ("planId",title,percent,"sortOrder","universityId")
			values ($1,$2,$3,$4,$5) returning id`, planID, title, w.Percent, (i+1)*10, universityID).Scan(&id); err != nil {
			return err
		}
		weightIDs[i] = id
	}
	for _, ss := range input.Sessions {
		kind := ss.SessionKind
		if kind != "THEORY" && kind != "PRACTICAL" && kind != "COMBINED" {
			kind = "THEORY"
		}
		var weightID *int64
		if ss.WeightID != nil {
			// فقط وزن‌های همین طرح.
			for _, id := range weightIDs {
				if id == *ss.WeightID {
					v := id
					weightID = &v
				}
			}
		}
		var details *string
		if strings.TrimSpace(ss.Details) != "" {
			v := strings.TrimSpace(ss.Details)
			details = &v
		}
		if _, err := tx.Exec(ctx, `
			insert into lesson_plan_sessions ("planId","sessionNo","sessionKind",topic,details,"weightId","universityId")
			values ($1,$2,$3,$4,$5,$6,$7)`,
			planID, ss.SessionNo, kind, strings.TrimSpace(ss.Topic), details, weightID, universityID); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}
