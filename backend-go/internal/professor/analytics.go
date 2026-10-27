// ═══ ارزشیابی و عملکرد استاد — پورت professor/evaluation و professor/performance ═══
package professor

import (
	"context"
	"math"
	"sort"
	"strings"
	"time"
	"unicode"
)

// EvalAxis محور رادار.
type EvalAxis struct {
	Label     string   `json:"label"`
	Mine      *float64 `json:"mine"`
	Dept      *float64 `json:"dept"`
	Responses int      `json:"responses"`
}

// EvalTrend نقطهٔ روند.
type EvalTrend struct {
	Period string   `json:"period"`
	Term   string   `json:"term"`
	Score  *float64 `json:"score"`
}

// EvalWord واژهٔ پرتکرار.
type EvalWord struct {
	Word  string `json:"word"`
	Count int    `json:"count"`
}

// EvaluationResponse پاسخ کارنامهٔ ارزشیابی.
type EvaluationResponse struct {
	Name        string      `json:"name"`
	Rank        *string     `json:"rank"`
	Department  *string     `json:"department"`
	Term        string      `json:"term"`
	Period      *string     `json:"period"`
	Score       *float64    `json:"score"`
	DeptAvg     *float64    `json:"deptAvg"`
	Respondents int         `json:"respondents"`
	Threshold   float64     `json:"threshold"`
	Flagged     bool        `json:"flagged"`
	Axes        []EvalAxis  `json:"axes"`
	Trend       []EvalTrend `json:"trend"`
	Words       []EvalWord  `json:"words"`
}

func round2p(v *float64) *float64 {
	if v == nil {
		return nil
	}
	r := math.Round(*v*100) / 100
	return &r
}

// GetEvaluation پورت professorPanel.
func (s *Service) GetEvaluation(ctx context.Context, userID int64, cookie *int64) (*EvaluationResponse, error) {
	st, err := s.ResolveStaff(ctx, userID)
	if err != nil {
		return nil, err
	}
	if st == nil {
		return nil, errNoStaff
	}
	term := s.ResolveTerm(ctx, st.UniversityID, cookie)
	resp := &EvaluationResponse{
		Name: st.Name, Axes: []EvalAxis{}, Trend: []EvalTrend{}, Words: []EvalWord{},
		Term: term.Title, Threshold: 3.5,
	}
	if st.AcademicRank != nil {
		resp.Rank = st.AcademicRank
	}
	if st.DepartmentID != nil {
		var dep string
		if err := s.DB.Pool.QueryRow(ctx, `select name from departments where id = $1`, *st.DepartmentID).Scan(&dep); err == nil {
			resp.Department = &dep
		}
	}
	if s.Settings != nil {
		resp.Threshold = s.Settings.GetNumber(ctx, "EVAL_FLAG_THRESHOLD", 3.5)
	}
	if term.ID == nil {
		return resp, nil
	}

	// دورهٔ ارزشیابی.
	var periodID int64
	var periodTitle string
	q := `select id, title from evaluation_periods where "isActive" = 1`
	args := []any{}
	idx := 1
	q += ` and ("termId" = $1 or "termId" is null)`
	args = append(args, *term.ID)
	idx++
	if st.UniversityID != nil {
		q += ` and ("universityId" = $2 or "universityId" is null)`
		args = append(args, *st.UniversityID)
		idx++
	}
	q += ` order by id desc limit 1`
	if err := s.DB.Pool.QueryRow(ctx, q, args...).Scan(&periodID, &periodTitle); err != nil {
		// بدون دورهٔ فعال: آخرین دورهٔ همین ترم.
		_ = s.DB.Pool.QueryRow(ctx, `
			select id, title from evaluation_periods where "termId" = $1 order by id desc limit 1`, *term.ID).
			Scan(&periodID, &periodTitle)
	}
	if periodID == 0 {
		return resp, nil
	}
	resp.Period = &periodTitle

	ownership := `(o."professorId" = $1 or exists (
		select 1 from offering_professors op where op."offeringId" = o.id and op."staffId" = $1))`

	// محورها.
	arows, err := s.DB.Pool.Query(ctx, `
		select q."axisLabel" as label,
		       count(*) filter (where `+ownership+`)::int as mine_n,
		       avg(qo."scoreValue") filter (where `+ownership+`)::float8 as mine,
		       avg(qo."scoreValue") filter (where o."professorId" in (
		           select s2.id from staff s2 where s2."departmentId" = $2))::float8 as dept
		  from evaluation_responses r
		  join course_offerings o on o.id = r."offeringId"
		  join evaluation_questions q on q.id = r."questionId"
		  join evaluation_forms f on f.id = q."formId"
		  join question_options qo on qo.id = r."selectedOptionId"
		 where o."termId" = $3 and r."periodId" = $4
		   and f."targetType" = 'PROFESSOR' and q."questionType" = 'SINGLE_CHOICE'
		   and q."axisLabel" is not null and r."selectedOptionId" is not null
		 group by q."axisLabel" order by q."axisLabel"`, st.ID, st.DepartmentID, *term.ID, periodID)
	if err == nil {
		for arows.Next() {
			var a EvalAxis
			if err := arows.Scan(&a.Label, &a.Responses, &a.Mine, &a.Dept); err == nil {
				a.Mine = round2p(a.Mine)
				a.Dept = round2p(a.Dept)
				resp.Axes = append(resp.Axes, a)
			}
		}
		arows.Close()
	}

	// نمرهٔ وزنی من/گروه + پاسخ‌دهندگان.
	var mineScore, deptScore *float64
	var respondents int
	_ = s.DB.Pool.QueryRow(ctx, `
		select (sum(qo."scoreValue" * q.weight) / nullif(sum(q.weight),0))::float8,
		       count(distinct r.id)
		  from evaluation_responses r
		  join course_offerings o on o.id = r."offeringId"
		  join evaluation_questions q on q.id = r."questionId"
		  join evaluation_forms f on f.id = q."formId"
		  join question_options qo on qo.id = r."selectedOptionId"
		 where o."termId" = $2 and r."periodId" = $3 and r."selectedOptionId" is not null
		   and f."targetType" = 'PROFESSOR' and `+ownership,
		st.ID, *term.ID, periodID).Scan(&mineScore, &respondents)
	resp.Score = round2p(mineScore)
	resp.Respondents = respondents
	if st.DepartmentID != nil {
		_ = s.DB.Pool.QueryRow(ctx, `
			select avg(x.s)::float8 from (
			  select o."professorId" as pid,
			         sum(qo."scoreValue" * q.weight) / nullif(sum(q.weight),0) as s
			    from evaluation_responses r
			    join course_offerings o on o.id = r."offeringId"
			    join evaluation_questions q on q.id = r."questionId"
			    join evaluation_forms f on f.id = q."formId"
			    join question_options qo on qo.id = r."selectedOptionId"
			   where o."termId" = $2 and r."periodId" = $3 and o."professorId" in (
			         select s2.id from staff s2 where s2."departmentId" = $1)
			     and f."targetType" = 'PROFESSOR' and r."selectedOptionId" is not null
			   group by o."professorId") x`,
			*st.DepartmentID, *term.ID, periodID).Scan(&deptScore)
	}
	resp.DeptAvg = round2p(deptScore)
	if resp.Score != nil {
		resp.Flagged = *resp.Score < resp.Threshold
	}

	// روند چند دورهٔ اخیر.
	trows, err := s.DB.Pool.Query(ctx, `
		select p.title, coalesce(t.title,'—'),
		       (sum(qo."scoreValue" * q.weight) / nullif(sum(q.weight),0))::float8 as s
		  from evaluation_responses r
		  join course_offerings o on o.id = r."offeringId"
		  join evaluation_questions q on q.id = r."questionId"
		  join evaluation_forms f on f.id = q."formId"
		  join question_options qo on qo.id = r."selectedOptionId"
		  join evaluation_periods p on p.id = r."periodId"
		  left join academic_terms t on t.id = p."termId"
		 where `+ownership+` and f."targetType" = 'PROFESSOR'
		   and r."selectedOptionId" is not null
		 group by p.id, p.title, t.title
		 order by p.id asc limit 12`, st.ID)
	if err == nil {
		for trows.Next() {
			var trend EvalTrend
			if err := trows.Scan(&trend.Period, &trend.Term, &trend.Score); err == nil {
				trend.Score = round2p(trend.Score)
				if trend.Score != nil {
					resp.Trend = append(resp.Trend, trend)
				}
			}
		}
		trows.Close()
	}

	// واژه‌های پرتکرار از پاسخ‌های تشریحی.
	stopwords := map[string]bool{}
	if s.Settings != nil {
		if raw, err := s.Settings.Get(ctx, "BI_STOPWORDS"); err == nil {
			for _, w := range strings.Split(raw, ",") {
				stopwords[strings.TrimSpace(w)] = true
			}
		}
	}
	if len(stopwords) == 0 {
		for _, w := range []string{"و", "به", "از", "که", "در", "این", "آن", "با", "را", "برای", "است", "بود", "شد", "هم", "نیز", "تا", "یا", "اما", "خیلی", "بسیار", "بر", "دارد", "می", "های", "یک", "دو", "سه", "من", "او", "ما", "شما", "باید", "نمی", "کلاس", "استاد", "درس"} {
			stopwords[w] = true
		}
	}
	freq := map[string]int{}
	wrows, err := s.DB.Pool.Query(ctx, `
		select coalesce(r."textAnswer",'')
		  from evaluation_responses r
		  join course_offerings o on o.id = r."offeringId"
		  join evaluation_questions q on q.id = r."questionId"
		  join evaluation_forms f on f.id = q."formId"
		 where o."termId" = $2 and r."periodId" = $3 and `+ownership+`
		   and f."targetType" = 'PROFESSOR' and r."textAnswer" is not null`, st.ID, *term.ID, periodID)
	if err == nil {
		for wrows.Next() {
			var text string
			if err := wrows.Scan(&text); err != nil {
				continue
			}
			for _, token := range tokenize(text) {
				if len([]rune(token)) < 3 || stopwords[token] {
					continue
				}
				freq[token]++
			}
		}
		wrows.Close()
	}
	words := []EvalWord{}
	for w, c := range freq {
		words = append(words, EvalWord{Word: w, Count: c})
	}
	sort.Slice(words, func(i, j int) bool {
		if words[i].Count != words[j].Count {
			return words[i].Count > words[j].Count
		}
		return words[i].Word < words[j].Word
	})
	if len(words) > 20 {
		words = words[:20]
	}
	resp.Words = words
	return resp, nil
}

func tokenize(text string) []string {
	out := []string{}
	var b strings.Builder
	for _, r := range text {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			b.WriteRune(r)
		} else if b.Len() > 0 {
			out = append(out, b.String())
			b.Reset()
		}
	}
	if b.Len() > 0 {
		out = append(out, b.String())
	}
	return out
}

// PerformanceResponse پاسخ کارنامهٔ عملکرد.
type PerformanceResponse struct {
	StaffCode    string  `json:"staffCode"`
	FullName     string  `json:"fullName"`
	AcademicRank *string `json:"academicRank"`
	Department   *string `json:"departmentName"`
	Term         string  `json:"term"`
	Teaching     struct {
		Offerings int      `json:"offerings"`
		Students  int      `json:"students"`
		Courses   []string `json:"courses"`
	} `json:"teaching"`
	Sessions struct {
		Held       int      `json:"held"`
		Absent     int      `json:"absent"`
		MakeUp     int      `json:"makeUp"`
		Scheduled  int      `json:"scheduled"`
		HeldRate   *float64 `json:"heldRate"`
		HoldTarget float64  `json:"holdTarget"`
	} `json:"sessions"`
	Grades struct {
		Entered           int      `json:"entered"`
		Pending           int      `json:"pending"`
		Total             int      `json:"total"`
		CompletionPercent *float64 `json:"completionPercent"`
		Deadline          *string  `json:"deadline"`
		AppealsOpen       int      `json:"appealsOpen"`
	} `json:"grades"`
	Evaluation struct {
		Score       *float64 `json:"score"`
		Respondents int      `json:"respondents"`
		DeptAvg     *float64 `json:"deptAvg"`
		EvalTarget  float64  `json:"evalTarget"`
	} `json:"evaluation"`
	Peers struct {
		Count        int      `json:"count"`
		EvalRank     *int     `json:"evalRank"`
		AvgEvalScore *float64 `json:"avgEvalScore"`
	} `json:"peers"`
	Desk struct {
		ResolvedThisMonth int      `json:"resolvedThisMonth"`
		OpenQueue         int      `json:"openQueue"`
		MttrHours         *float64 `json:"mttrHours"`
		SLAOnTimePercent  *float64 `json:"slaOnTimePercent"`
		SLAbreached       int      `json:"slaBreached"`
	} `json:"desk"`
	Badge struct {
		Title string `json:"title"`
		Level string `json:"level"`
	} `json:"badge"`
	Incentive struct {
		Eligible bool     `json:"eligible"`
		Percent  float64  `json:"percent"`
		Reasons  []string `json:"reasons"`
	} `json:"incentive"`
}

// GetPerformance پورت getProfessorPerformance.
func (s *Service) GetPerformance(ctx context.Context, userID int64, cookie *int64) (*PerformanceResponse, error) {
	st, err := s.ResolveStaff(ctx, userID)
	if err != nil {
		return nil, err
	}
	if st == nil {
		return nil, errNoStaff
	}
	term := s.ResolveTerm(ctx, st.UniversityID, cookie)
	resp := &PerformanceResponse{StaffCode: st.StaffCode, FullName: st.Name, Term: term.Title}
	resp.AcademicRank = st.AcademicRank
	if st.DepartmentID != nil {
		var dep string
		if err := s.DB.Pool.QueryRow(ctx, `select name from departments where id = $1`, *st.DepartmentID).Scan(&dep); err == nil {
			resp.Department = &dep
		}
	}
	if s.Settings != nil {
		resp.Sessions.HoldTarget = s.Settings.GetNumber(ctx, "PERF_SESSION_HOLD_TARGET", 90)
		resp.Evaluation.EvalTarget = s.Settings.GetNumber(ctx, "PERF_EVAL_TARGET", 4)
		resp.Incentive.Percent = s.Settings.GetNumber(ctx, "PERF_INCENTIVE_PERCENT", 10)
	}
	resp.Incentive.Reasons = []string{}
	if term.ID == nil {
		return resp, nil
	}
	ownership := `(o."professorId" = $1 or exists (
		select 1 from offering_professors op where op."offeringId" = o.id and op."staffId" = $1))`

	// بار تدریس.
	_ = s.DB.Pool.QueryRow(ctx, `
		select count(distinct o.id)::int,
		       coalesce(sum(e.n),0)::int
		  from course_offerings o
		  left join (select "offeringId", count(*)::int as n from enrollments
		              where status <> 'DROPPED' group by "offeringId") e on e."offeringId" = o.id
		 where o."termId" = $2 and o."isActive" = 1 and `+ownership,
		st.ID, *term.ID).Scan(&resp.Teaching.Offerings, &resp.Teaching.Students)
	crows, err := s.DB.Pool.Query(ctx, `
		select distinct c.code from course_offerings o join courses c on c.id = o."courseId"
		 where o."termId" = $2 and `+ownership+` order by c.code`, st.ID, *term.ID)
	if err == nil {
		for crows.Next() {
			var code string
			if err := crows.Scan(&code); err == nil {
				resp.Teaching.Courses = append(resp.Teaching.Courses, code)
			}
		}
		crows.Close()
	}
	if resp.Teaching.Courses == nil {
		resp.Teaching.Courses = []string{}
	}

	// جلسات.
	srows, err := s.DB.Pool.Query(ctx, `
		select coalesce(cs.status,''), count(*)::int, coalesce(sum(coalesce(cs."isMakeUpSession",0)),0)::int
		  from class_sessions cs
		  join course_offerings o on o.id = cs."offeringId"
		 where o."termId" = $2 and `+ownership+`
		 group by cs.status`, st.ID, *term.ID)
	if err == nil {
		makeUp := 0
		for srows.Next() {
			var status string
			var n, mk int
			if err := srows.Scan(&status, &n, &mk); err == nil {
				resp.Sessions.Scheduled += n
				makeUp += mk
				switch status {
				case "HELD":
					resp.Sessions.Held += n
				case "ABSENT":
					resp.Sessions.Absent += n
				}
			}
		}
		srows.Close()
		resp.Sessions.MakeUp = makeUp
		if resp.Sessions.Scheduled > 0 {
			v := math.Round(float64(resp.Sessions.Held)/float64(resp.Sessions.Scheduled)*1000) / 10
			resp.Sessions.HeldRate = &v
		}
	}

	// وضعیت نمرات.
	_ = s.DB.Pool.QueryRow(ctx, `
		select count(*) filter (where e."gradeStatus" = 'FINALIZED')::int,
		       count(*) filter (where e."gradeValue" is null)::int,
		       count(*)::int
		  from enrollments e
		  join course_offerings o on o.id = e."offeringId"
		 where o."termId" = $2 and e.status <> 'DROPPED' and `+ownership,
		st.ID, *term.ID).Scan(&resp.Grades.Entered, &resp.Grades.Pending, &resp.Grades.Total)
	if resp.Grades.Total > 0 {
		v := math.Round(float64(resp.Grades.Entered)/float64(resp.Grades.Total)*1000) / 10
		resp.Grades.CompletionPercent = &v
	}
	resp.Grades.Deadline = term.GradeDeadline
	_ = s.DB.Pool.QueryRow(ctx, `
		select count(*)::int from grade_appeals a
		  join enrollments e on e.id = a."enrollmentId"
		  join course_offerings o on o.id = e."offeringId"
		 where o."termId" = $2 and coalesce(a.status,'OPEN') = 'OPEN' and `+ownership,
		st.ID, *term.ID).Scan(&resp.Grades.AppealsOpen)

	// ارزشیابی.
	eval, err := s.GetEvaluation(ctx, userID, cookie)
	if err == nil && eval != nil {
		resp.Evaluation.Score = eval.Score
		resp.Evaluation.Respondents = eval.Respondents
		resp.Evaluation.DeptAvg = eval.DeptAvg
	}

	// همکاران: استادان دارای کلاس در ترم با نمرهٔ ارزشیابی.
	type peerRow struct {
		StaffID int64
		Score   *float64
	}
	peers := []peerRow{}
	prows, err := s.DB.Pool.Query(ctx, `
		select pid, (sum(s * w) / nullif(sum(w),0))::float8 as score from (
		  select o."professorId" as pid, qo."scoreValue" as s, q.weight as w
		    from evaluation_responses r
		    join course_offerings o on o.id = r."offeringId"
		    join evaluation_questions q on q.id = r."questionId"
		    join evaluation_forms f on f.id = q."formId"
		    join question_options qo on qo.id = r."selectedOptionId"
		   where o."termId" = $1 and f."targetType" = 'PROFESSOR'
		     and r."selectedOptionId" is not null and o."professorId" is not null
		) x group by pid`, *term.ID)
	if err == nil {
		for prows.Next() {
			var p peerRow
			if err := prows.Scan(&p.StaffID, &p.Score); err == nil {
				peers = append(peers, p)
			}
		}
		prows.Close()
	}
	resp.Peers.Count = len(peers)
	if len(peers) > 0 {
		sum := 0.0
		n := 0
		rank := 1
		myScore := resp.Evaluation.Score
		for _, p := range peers {
			if p.Score != nil {
				sum += *p.Score
				n++
				if myScore != nil && *p.Score > *myScore {
					rank++
				}
			}
		}
		if n > 0 {
			v := math.Round(sum/float64(n)*100) / 100
			resp.Peers.AvgEvalScore = &v
		}
		if myScore != nil {
			r := rank
			resp.Peers.EvalRank = &r
		}
	}

	// میز خدمت: پرونده‌های ارجاع‌شده به این استاد.
	now := time.Now()
	monthStart := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.Local)
	_ = s.DB.Pool.QueryRow(ctx, `
		select count(*) filter (where "completedAt" >= $2)::int,
		       count(*) filter (where "completedAt" is null)::int,
		       avg("durationMinutes") filter (where "completedAt" is not null)::float8,
		       count(*) filter (where "slaStatus" = 'BREACHED')::int
		  from request_step_logs where "actorStaffId" = $1`, st.ID, monthStart).
		Scan(&resp.Desk.ResolvedThisMonth, &resp.Desk.OpenQueue, &resp.Desk.MttrHours, &resp.Desk.SLAbreached)
	if resp.Desk.MttrHours != nil {
		v := math.Round(*resp.Desk.MttrHours/60*10) / 10
		resp.Desk.MttrHours = &v
	}
	var onTime, totalStep int
	_ = s.DB.Pool.QueryRow(ctx, `
		select count(*) filter (where "slaStatus" = 'ON_TIME')::int, count(*)::int
		  from request_step_logs where "actorStaffId" = $1 and "completedAt" is not null`, st.ID).Scan(&onTime, &totalStep)
	if totalStep > 0 {
		v := math.Round(float64(onTime)/float64(totalStep)*1000) / 10
		resp.Desk.SLAOnTimePercent = &v
	}

	// نشان و مشوق.
	score := resp.Evaluation.Score
	switch {
	case score != nil && *score >= 4.5:
		resp.Badge.Level, resp.Badge.Title = "DIAMOND", "الماس"
	case score != nil && *score >= 4:
		resp.Badge.Level, resp.Badge.Title = "GOLD", "طلایی"
	case score != nil && *score >= 3.5:
		resp.Badge.Level, resp.Badge.Title = "SILVER", "نقره‌ای"
	default:
		resp.Badge.Level, resp.Badge.Title = "BRONZE", "برنزی"
	}
	eligible := score != nil && *score >= resp.Evaluation.EvalTarget &&
		resp.Sessions.HeldRate != nil && *resp.Sessions.HeldRate >= resp.Sessions.HoldTarget &&
		resp.Grades.CompletionPercent != nil && *resp.Grades.CompletionPercent >= 100
	resp.Incentive.Eligible = eligible
	if score == nil {
		resp.Incentive.Reasons = append(resp.Incentive.Reasons, "ارزشیابی ثبت‌شده‌ای ندارید.")
	} else if *score < resp.Evaluation.EvalTarget {
		resp.Incentive.Reasons = append(resp.Incentive.Reasons, "نمرهٔ ارزشیابی کمتر از هدف است.")
	}
	if resp.Sessions.HeldRate != nil && *resp.Sessions.HeldRate < resp.Sessions.HoldTarget {
		resp.Incentive.Reasons = append(resp.Incentive.Reasons, "درصد برگزاری جلسات کمتر از هدف است.")
	}
	if resp.Grades.CompletionPercent == nil || *resp.Grades.CompletionPercent < 100 {
		resp.Incentive.Reasons = append(resp.Incentive.Reasons, "همهٔ نمرات وارد/نهایی نشده‌اند.")
	}
	return resp, nil
}
