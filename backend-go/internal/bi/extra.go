// ═══ BI additions: cache status, word cloud, professor panel and full rebuild — port of bi-engine ═══
package bi

import (
	"context"
	"errors"
	"math"
	"strings"
	"time"
)

// CacheEntry is a cache status row.
type CacheEntry struct {
	Key        string `json:"key"`
	Type       string `json:"type"`
	Rows       *int   `json:"rows"`
	DurationMs *int   `json:"durationMs"`
	ComputedAt string `json:"computedAt"`
	AgeSeconds int    `json:"ageSeconds"`
	Fresh      bool   `json:"fresh"`
}

// InvalidateBiCache clears the cache of one report (or all) — port of invalidateBiCache.
func (s *Service) InvalidateBiCache(ctx context.Context, prefix string) error {
	if prefix == "" {
		_, err := s.Pool.Exec(ctx, `delete from analytics_snapshots`)
		return err
	}
	_, err := s.Pool.Exec(ctx, `delete from analytics_snapshots where "cacheKey" like $1`, prefix+"%")
	return err
}

// CacheStatus reports cache status — port of cacheStatus.
func (s *Service) CacheStatus(ctx context.Context) ([]CacheEntry, error) {
	ttl := s.cacheTTL(ctx)
	rows, err := s.Pool.Query(ctx, `
		select "cacheKey", coalesce("reportType",''), "rowCount", "durationMs", "computedAt"
		  from analytics_snapshots order by "cacheKey" limit 100`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []CacheEntry{}
	now := time.Now()
	for rows.Next() {
		var e CacheEntry
		var computed time.Time
		if err := rows.Scan(&e.Key, &e.Type, &e.Rows, &e.DurationMs, &computed); err != nil {
			return nil, err
		}
		e.AgeSeconds = int(math.Max(0, math.Round(now.Sub(computed).Seconds())))
		e.Fresh = ttl > 0 && float64(e.AgeSeconds) <= ttl
		e.ComputedAt = computed.UTC().Format(time.RFC3339)
		out = append(out, e)
	}
	return out, rows.Err()
}

// WordItem is a word in the word cloud.
type WordItem struct {
	W string `json:"w"`
	C int    `json:"c"`
}

// WordCloudResult is the word cloud result.
type WordCloudResult struct {
	Words    []WordItem `json:"words"`
	Comments int        `json:"comments"`
	CachedAt *string    `json:"cachedAt"`
}

func (s *Service) settingStr(ctx context.Context, key string) string {
	if getter, ok := s.Settings.(interface {
		Get(context.Context, string) (string, error)
	}); ok {
		if v, err := getter.Get(ctx, key); err == nil {
			return v
		}
	}
	return ""
}

// WordCloud ports wordCloud — all text analysis in PostgreSQL.
func (s *Service) WordCloud(ctx context.Context, staffID int64, force bool) (*WordCloudResult, error) {
	key := "bi:wordcloud:staff:" + itoa(staffID)
	var cached struct {
		Words    []WordItem `json:"words"`
		Comments int        `json:"comments"`
	}
	if !force {
		if age, ok := s.readCache(ctx, key, &cached); ok {
			when := time.Now().Add(-time.Duration(derefInt(age)) * time.Second).UTC().Format(time.RFC3339)
			if cached.Words == nil {
				cached.Words = []WordItem{}
			}
			return &WordCloudResult{Words: cached.Words, Comments: cached.Comments, CachedAt: &when}, nil
		}
	}
	limit := 18
	minLen := 3
	if s.Settings != nil {
		limit = int(s.Settings.GetNumber(ctx, "BI_WORDCLOUD_LIMIT", 18))
		minLen = int(s.Settings.GetNumber(ctx, "BI_WORDCLOUD_MIN_LEN", 3))
	}
	if limit < 1 {
		limit = 18
	}
	if minLen < 1 {
		minLen = 3
	}
	stops := []string{}
	for _, w := range strings.Split(s.settingStr(ctx, "BI_STOPWORDS"), ",") {
		if t := strings.TrimSpace(w); t != "" {
			stops = append(stops, t)
		}
	}
	rows, err := s.Pool.Query(ctx, `
		with `+ownershipCTE+`,
		comments as (
		  select r.id as response_id, r."textAnswer" as body
		    from evaluation_responses r
		    join ownership ow on ow.offering_id = r."offeringId"
		    join evaluation_questions q on q.id = r."questionId"
		    join evaluation_forms f on f.id = q."formId"
		   where ow.staff_id = $1
		     and f."targetType" = 'PROFESSOR'
		     and q."questionType" = 'TEXT'
		     and coalesce(r."textAnswer", '') <> ''
		),
		tokens as (
		  select response_id,
		         btrim(translate(w, 'يك', 'یک'), E'\u200C') as word
		    from comments,
		         lateral regexp_split_to_table(body, E'[^\u0600-\u06FF\u200C]+') as w
		)
		select word, count(*)::int as c
		  from tokens
		 where length(word) >= $2
		   and word <> all(string_to_array($3, E'\u0001'))
		 group by word
		 order by count(*) desc, word
		 limit $4`, staffID, minLen, strings.Join(stops, "\u0001"), limit)
	if err != nil {
		return nil, err
	}
	words := []WordItem{}
	for rows.Next() {
		var w WordItem
		if err := rows.Scan(&w.W, &w.C); err != nil {
			rows.Close()
			return nil, err
		}
		words = append(words, w)
	}
	rows.Close()

	var comments int
	_ = s.Pool.QueryRow(ctx, `
		with `+ownershipCTE+`
		select count(*)::int from evaluation_responses r
		  join ownership ow on ow.offering_id = r."offeringId"
		  join evaluation_questions q on q.id = r."questionId"
		  join evaluation_forms f on f.id = q."formId"
		 where ow.staff_id = $1 and f."targetType" = 'PROFESSOR'
		   and q."questionType" = 'TEXT' and coalesce(r."textAnswer", '') <> ''`, staffID).Scan(&comments)

	s.writeCache(ctx, key, "WORDCLOUD", map[string]any{"words": words, "comments": comments}, len(words))
	now := time.Now().UTC().Format(time.RFC3339)
	return &WordCloudResult{Words: words, Comments: comments, CachedAt: &now}, nil
}

func derefInt(v *int) int {
	if v == nil {
		return 0
	}
	return *v
}

// RadarAxis is an axis of the professor panel radar.
type RadarAxis struct {
	Label     string   `json:"label"`
	Mine      *float64 `json:"mine"`
	Dept      *float64 `json:"dept"`
	Responses int      `json:"responses"`
}

// ProfessorPanel is the professor's dedicated panel.
type ProfessorPanel struct {
	StaffID     int64        `json:"staffId"`
	Name        string       `json:"name"`
	Rank        *string      `json:"rank"`
	Department  *string      `json:"department"`
	Term        string       `json:"term"`
	Period      *string      `json:"period"`
	Axes        []RadarAxis  `json:"axes"`
	Trend       []TrendPoint `json:"trend"`
	Words       []WordItem   `json:"words"`
	Score       *float64     `json:"score"`
	DeptAvg     *float64     `json:"deptAvg"`
	Respondents int          `json:"respondents"`
	Threshold   float64      `json:"threshold"`
	Flagged     bool         `json:"flagged"`
}

// ProfessorPanel ports professorPanel.
func (s *Service) ProfessorPanel(ctx context.Context, staffID int64) (*ProfessorPanel, error) {
	term := s.currentTerm(ctx)
	if term == nil {
		return nil, errors.New("ترم جاری مشخص نیست.")
	}
	var (
		name        string
		rank        *string
		department  *string
		departmentI *int64
	)
	err := s.Pool.QueryRow(ctx, `
		select (u."firstName" || ' ' || u."lastName"), s."academicRank", d.name, s."departmentId"
		  from staff s join users u on u.id = s."userId"
		  left join departments d on d.id = s."departmentId"
		 where s.id = $1 limit 1`, staffID).Scan(&name, &rank, &department, &departmentI)
	if err != nil {
		return nil, errors.New("استاد یافت نشد.")
	}
	threshold := 3.5
	trendCount := 3
	if s.Settings != nil {
		threshold = s.Settings.GetNumber(ctx, "EVAL_FLAG_THRESHOLD", 3.5)
		trendCount = int(s.Settings.GetNumber(ctx, "EVAL_TREND_TERMS", 3))
	}
	if trendCount < 1 {
		trendCount = 3
	}
	termID := term.ID
	period := s.activePeriod(ctx, &termID)
	respondents := map[int64]int{}
	if period != nil {
		respondents = s.respondentsByStaff(ctx, period.ID, termID)
	}
	words, err := s.WordCloud(ctx, staffID, false)
	if err != nil {
		return nil, err
	}
	scores := s.allStaffPeriodScores(ctx)

	periodCond := "true"
	args := []any{termID, staffID, departmentI}
	if period != nil {
		periodCond = `r."periodId" = $4`
		args = append(args, period.ID)
	}
	axRows, err := s.Pool.Query(ctx, `
		with `+ownershipCTE+`
		select q."axisLabel" as label,
		       count(*) filter (where ow.staff_id = $2)::int as mine_n,
		       avg(qo."scoreValue") filter (where ow.staff_id = $2)::float8 as mine,
		       avg(qo."scoreValue") filter (where o."professorId" in (select s2.id from staff s2 where s2."departmentId" = $3))::float8 as dept
		  from evaluation_responses r
		  join course_offerings o on o.id = r."offeringId"
		  join ownership ow on ow.offering_id = r."offeringId"
		  join evaluation_questions q on q.id = r."questionId"
		  join evaluation_forms f on f.id = q."formId"
		  join question_options qo on qo.id = r."selectedOptionId"
		 where o."termId" = $1
		   and `+periodCond+`
		   and f."targetType" = 'PROFESSOR'
		   and q."questionType" = 'SINGLE_CHOICE'
		   and q."axisLabel" is not null
		   and r."selectedOptionId" is not null
		 group by q."axisLabel"
		 order by q."axisLabel"`, args...)
	if err != nil {
		return nil, err
	}
	axes := []RadarAxis{}
	for axRows.Next() {
		var label *string
		var mineN int
		var mine, dept *float64
		if err := axRows.Scan(&label, &mineN, &mine, &dept); err != nil {
			axRows.Close()
			return nil, err
		}
		if label == nil {
			continue
		}
		axes = append(axes, RadarAxis{Label: *label, Mine: round2(mine), Dept: round2(dept), Responses: mineN})
	}
	axRows.Close()

	trend := []TrendPoint{}
	for _, sc := range scores {
		if sc.StaffID != staffID {
			continue
		}
		score := round2(sc.Score)
		if score == nil {
			continue
		}
		termTitle := "—"
		if sc.TermTitle != nil && *sc.TermTitle != "" {
			termTitle = *sc.TermTitle
		}
		trend = append(trend, TrendPoint{Period: sc.PeriodTitle, Term: termTitle, TermID: sc.TermID, Score: score})
	}
	if len(trend) > trendCount {
		trend = trend[len(trend)-trendCount:]
	}
	var score *float64
	if len(trend) > 0 {
		score = trend[len(trend)-1].Score
	}
	deptVals := []float64{}
	for _, a := range axes {
		if a.Dept != nil {
			deptVals = append(deptVals, *a.Dept)
		}
	}
	var deptAvg *float64
	if len(deptVals) > 0 {
		sum := 0.0
		for _, v := range deptVals {
			sum += v
		}
		v := sum / float64(len(deptVals))
		deptAvg = round2(&v)
	}
	var periodTitle *string
	if period != nil {
		p := period.Title
		periodTitle = &p
	}
	return &ProfessorPanel{
		StaffID: staffID, Name: name, Rank: rank, Department: department,
		Term: term.Title, Period: periodTitle, Axes: axes, Trend: trend,
		Words: words.Words, Score: score, DeptAvg: deptAvg,
		Respondents: respondents[staffID], Threshold: threshold,
		Flagged: score != nil && *score < threshold,
	}, nil
}

// BiSummary is the global summary for dashboard cards.
type BiSummary struct {
	Term             string         `json:"term"`
	Period           *string        `json:"period"`
	FlaggedCount     int            `json:"flaggedCount"`
	AvgScore         *float64       `json:"avgScore"`
	TotalRespondents int            `json:"totalRespondents"`
	StaffCount       int            `json:"staffCount"`
	RoomsCount       int            `json:"roomsCount"`
	NeedsRepairCount int            `json:"needsRepairCount"`
	WorstStaff       *ManagementRow `json:"worstStaff"`
	WorstRoom        *FacilityRow   `json:"worstRoom"`
	CachedAt         *string        `json:"cachedAt"`
}

// Summary ports biSummary.
func (s *Service) Summary(ctx context.Context) *BiSummary {
	ov := s.ManagementOverview(ctx)
	fac := s.FacilitiesReport(ctx)
	out := &BiSummary{
		Term: ov.Term, Period: ov.Period, FlaggedCount: ov.FlaggedCount,
		AvgScore: ov.AvgScore, TotalRespondents: ov.TotalRespondents,
		StaffCount: len(ov.List), RoomsCount: len(fac.Rooms),
		NeedsRepairCount: fac.NeedsRepairCount, CachedAt: ov.CachedAt,
	}
	if len(ov.List) > 0 {
		out.WorstStaff = &ov.List[0]
	}
	if len(fac.Rooms) > 0 {
		out.WorstRoom = &fac.Rooms[0]
	}
	return out
}

// RefreshResult is the result of a full rebuild.
type RefreshResult struct {
	TermID     int64 `json:"termId"`
	Staff      int   `json:"staff"`
	Rooms      int   `json:"rooms"`
	WordClouds int   `json:"wordClouds"`
	DurationMs int64 `json:"durationMs"`
}

// RefreshAllCaches ports refreshAllBiCaches — rebuilds dashboards + the word cloud of all professors.
func (s *Service) RefreshAllCaches(ctx context.Context, termID *int64) (*RefreshResult, error) {
	var term *termRow
	if termID != nil {
		var t termRow
		if err := s.Pool.QueryRow(ctx, `select id, title from academic_terms where id = $1`, *termID).Scan(&t.ID, &t.Title); err == nil {
			term = &t
		}
	} else {
		term = s.currentTerm(ctx)
	}
	if term == nil {
		return nil, errors.New("ترم جاری مشخص نیست.")
	}
	started := time.Now()
	ov := s.ManagementOverviewForce(ctx)
	fac := s.FacilitiesReportForce(ctx)
	staff := s.teachingStaff(ctx, term.ID)
	clouds := 0
	for _, st := range staff {
		if _, err := s.WordCloud(ctx, st.StaffID, true); err == nil {
			clouds++
		}
	}
	return &RefreshResult{
		TermID: term.ID, Staff: len(ov.List), Rooms: len(fac.Rooms),
		WordClouds: clouds, DurationMs: time.Since(started).Milliseconds(),
	}, nil
}
