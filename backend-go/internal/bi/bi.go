// ═══ موتور هوش تجاری ارزشیابی (BI) — پورت lib/bi-engine.ts ═══
//
// فقط دو گزارش مدیریتی که مرکز گزارش‌ها لازم دارد: نمای کلی کیفیت تدریس و
// تحلیل امکانات. همهٔ کوئری‌ها تجمیعی و بدون N+1 هستند و نتیجه در
// analytics_snapshots کش می‌شود (همان کلیدها و همان TTL سامانهٔ فعلی).
package bi

import (
	"context"
	"encoding/json"
	"math"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Settings حداقل وابستگی تنظیمات.
type Settings interface {
	GetNumber(ctx context.Context, key string, fallback float64) float64
}

// Service موتور BI.
type Service struct {
	Pool     *pgxpool.Pool
	Settings Settings
}

// New ساخت موتور.
func New(pool *pgxpool.Pool, settings Settings) *Service {
	return &Service{Pool: pool, Settings: settings}
}

// TrendPoint یک نقطهٔ روند.
type TrendPoint struct {
	Period string   `json:"period"`
	Term   string   `json:"term"`
	TermID *int64   `json:"termId"`
	Score  *float64 `json:"score"`
}

// ManagementRow سطر ماتریس مدیریتی.
type ManagementRow struct {
	StaffID     int64        `json:"staffId"`
	Name        string       `json:"name"`
	Rank        *string      `json:"rank"`
	Department  *string      `json:"department"`
	Score       float64      `json:"score"`
	PrevScore   *float64     `json:"prevScore"`
	Delta       *float64     `json:"delta"`
	Respondents int          `json:"respondents"`
	Offerings   int          `json:"offerings"`
	Flagged     bool         `json:"flagged"`
	Trend       []TrendPoint `json:"trend"`
}

// ManagementOverview نمای کلی مدیریتی.
type ManagementOverview struct {
	Term             string          `json:"term"`
	Period           *string         `json:"period"`
	Threshold        float64         `json:"threshold"`
	FlaggedCount     int             `json:"flaggedCount"`
	AvgScore         *float64        `json:"avgScore"`
	TotalRespondents int             `json:"totalRespondents"`
	List             []ManagementRow `json:"list"`
	CachedAt         *string         `json:"cachedAt"`
	CacheAgeSeconds  *int            `json:"cacheAgeSeconds"`
}

// FacilityAxis یک محور امکانات.
type FacilityAxis struct {
	Label     string  `json:"label"`
	Score     float64 `json:"score"`
	Responses int     `json:"responses"`
}

// FacilityRow یک کلاس در گزارش امکانات.
type FacilityRow struct {
	RoomID      int64          `json:"roomId"`
	Room        string         `json:"room"`
	Building    *string        `json:"building"`
	Type        *string        `json:"type"`
	Axes        []FacilityAxis `json:"axes"`
	WorstAxis   string         `json:"worstAxis"`
	WorstScore  float64        `json:"worstScore"`
	NeedsRepair bool           `json:"needsRepair"`
	Courses     []string       `json:"courses"`
	Responses   int            `json:"responses"`
}

// FacilitiesReport گزارش امکانات.
type FacilitiesReport struct {
	Term             string        `json:"term"`
	Period           *string       `json:"period"`
	RepairThreshold  float64       `json:"repairThreshold"`
	NeedsRepairCount int           `json:"needsRepairCount"`
	Rooms            []FacilityRow `json:"rooms"`
	CachedAt         *string       `json:"cachedAt"`
	CacheAgeSeconds  *int          `json:"cacheAgeSeconds"`
}

const ownershipCTE = `
	ownership as (
		select o.id as offering_id, o."professorId" as staff_id
		  from course_offerings o where o."professorId" is not null
		union
		select op."offeringId", op."staffId"
		  from offering_professors op where op.role = 'MAIN_LECTURER'
	)`

type termRow struct {
	ID    int64
	Title string
}

func (s *Service) currentTerm(ctx context.Context) *termRow {
	var t termRow
	if err := s.Pool.QueryRow(ctx, `select id, title from academic_terms where "isCurrent" = 1 limit 1`).Scan(&t.ID, &t.Title); err != nil {
		return nil
	}
	return &t
}

func (s *Service) activePeriod(ctx context.Context, termID *int64) *struct {
	ID    int64
	Title string
} {
	var id int64
	var title string
	var err error
	if termID != nil {
		err = s.Pool.QueryRow(ctx, `
			select id, title from evaluation_periods
			 where "termId" = $1
			 order by "isActive" desc, id desc limit 1`, *termID).Scan(&id, &title)
		if err == nil {
			return &struct {
				ID    int64
				Title string
			}{ID: id, Title: title}
		}
	}
	if err := s.Pool.QueryRow(ctx, `
		select id, title from evaluation_periods
		 order by "isActive" desc, id desc limit 1`).Scan(&id, &title); err != nil {
		return nil
	}
	return &struct {
		ID    int64
		Title string
	}{ID: id, Title: title}
}

func round2(v *float64) *float64 {
	if v == nil || math.IsNaN(*v) || math.IsInf(*v, 0) {
		return nil
	}
	r := math.Round(*v*100) / 100
	return &r
}

// ─────────────────── کش ───────────────────

func (s *Service) cacheTTL(ctx context.Context) float64 {
	if s.Settings == nil {
		return 300
	}
	return s.Settings.GetNumber(ctx, "BI_CACHE_TTL_SECONDS", 300)
}

func (s *Service) readCache(ctx context.Context, key string, out any) (ageSeconds *int, ok bool) {
	ttl := s.cacheTTL(ctx)
	var payload string
	var computedAt time.Time
	if err := s.Pool.QueryRow(ctx, `
		select payload, "computedAt" from analytics_snapshots where "cacheKey" = $1 limit 1`, key).
		Scan(&payload, &computedAt); err != nil {
		return nil, false
	}
	age := int(math.Max(0, math.Round(time.Since(computedAt).Seconds())))
	if ttl > 0 && float64(age) > ttl {
		return &age, false
	}
	if err := json.Unmarshal([]byte(payload), out); err != nil {
		return &age, false
	}
	return &age, true
}

func (s *Service) writeCache(ctx context.Context, key, reportType string, payload any, rowCount int) {
	ttl := s.cacheTTL(ctx)
	raw, err := json.Marshal(payload)
	if err != nil {
		return
	}
	var expires any
	if ttl > 0 {
		expires = time.Now().Add(time.Duration(ttl) * time.Second)
	}
	_, _ = s.Pool.Exec(ctx, `
		insert into analytics_snapshots ("cacheKey","reportType",payload,"rowCount","durationMs","computedAt","expiresAt")
		values ($1,$2,$3,$4,0,now(),$5)
		on conflict ("cacheKey") do update set
		  payload = excluded.payload, "rowCount" = excluded."rowCount",
		  "computedAt" = now(), "expiresAt" = excluded."expiresAt"`,
		key, reportType, string(raw), rowCount, expires)
}

// ─────────────────── نمرهٔ وزنی همهٔ اساتید ───────────────────

type staffPeriodScore struct {
	StaffID     int64
	PeriodID    int64
	PeriodTitle string
	TermTitle   *string
	TermID      *int64
	StartDate   *time.Time
	Score       *float64
}

func (s *Service) allStaffPeriodScores(ctx context.Context) []staffPeriodScore {
	rows, err := s.Pool.Query(ctx, `
		with `+ownershipCTE+`,
		resp as (
		  select r."periodId" as period_id, ow.staff_id, r."questionId" as question_id,
		         avg(qo."scoreValue")::float8 as s
		    from evaluation_responses r
		    join ownership ow on ow.offering_id = r."offeringId"
		    join question_options qo on qo.id = r."selectedOptionId"
		   where r."selectedOptionId" is not null
		   group by r."periodId", ow.staff_id, r."questionId"
		)
		select resp.staff_id, resp.period_id, p.title, t.title, t.id, t."startDate",
		       (sum(resp.s * q.weight) / nullif(sum(q.weight), 0))::float8
		  from resp
		  join evaluation_questions q on q.id = resp.question_id
		  join evaluation_forms f on f.id = q."formId"
		  join evaluation_periods p on p.id = resp.period_id
		  left join academic_terms t on t.id = p."termId"
		 where f."targetType" = 'PROFESSOR'
		 group by resp.staff_id, resp.period_id, p.title, t.title, t.id, t."startDate"
		 order by resp.staff_id, t."startDate" nulls first, resp.period_id`)
	if err != nil {
		return nil
	}
	defer rows.Close()
	out := []staffPeriodScore{}
	for rows.Next() {
		var r staffPeriodScore
		if err := rows.Scan(&r.StaffID, &r.PeriodID, &r.PeriodTitle, &r.TermTitle, &r.TermID, &r.StartDate, &r.Score); err == nil {
			out = append(out, r)
		}
	}
	return out
}

func (s *Service) respondentsByStaff(ctx context.Context, periodID, termID int64) map[int64]int {
	out := map[int64]int{}
	rows, err := s.Pool.Query(ctx, `
		with `+ownershipCTE+`
		select ow.staff_id, count(distinct r.id)::int
		  from evaluation_responses r
		  join ownership ow on ow.offering_id = r."offeringId"
		  join course_offerings o on o.id = r."offeringId"
		  join evaluation_questions q on q.id = r."questionId"
		  join evaluation_forms f on f.id = q."formId"
		 where r."periodId" = $1 and o."termId" = $2
		   and f."targetType" = 'PROFESSOR' and q."questionType" = 'SINGLE_CHOICE'
		 group by ow.staff_id`, periodID, termID)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var staffID int64
		var n int
		if err := rows.Scan(&staffID, &n); err == nil {
			out[staffID] = n
		}
	}
	return out
}

func (s *Service) offeringsByStaff(ctx context.Context, termID int64) map[int64]int {
	out := map[int64]int{}
	rows, err := s.Pool.Query(ctx, `
		with `+ownershipCTE+`
		select ow.staff_id, count(distinct ow.offering_id)::int
		  from ownership ow
		  join course_offerings o on o.id = ow.offering_id
		 where o."termId" = $1 and o."isActive" = 1
		 group by ow.staff_id`, termID)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var staffID int64
		var n int
		if err := rows.Scan(&staffID, &n); err == nil {
			out[staffID] = n
		}
	}
	return out
}

type teachingStaffRow struct {
	StaffID    int64
	Name       string
	Rank       *string
	Department *string
}

func (s *Service) teachingStaff(ctx context.Context, termID int64) []teachingStaffRow {
	rows, err := s.Pool.Query(ctx, `
		with `+ownershipCTE+`
		select distinct s.id,
		       (u."firstName" || ' ' || u."lastName") as name,
		       s."academicRank" as rank,
		       d.name as department
		  from ownership ow
		  join staff s on s.id = ow.staff_id
		  join users u on u.id = s."userId"
		  left join departments d on d.id = s."departmentId"
		  join course_offerings o on o.id = ow.offering_id and o."termId" = $1
		 order by s.id`, termID)
	if err != nil {
		return nil
	}
	defer rows.Close()
	out := []teachingStaffRow{}
	for rows.Next() {
		var r teachingStaffRow
		if err := rows.Scan(&r.StaffID, &r.Name, &r.Rank, &r.Department); err == nil {
			out = append(out, r)
		}
	}
	return out
}

// ManagementOverview پورت managementOverview — بدترین رکورد اول (با کش).
func (s *Service) ManagementOverview(ctx context.Context) *ManagementOverview {
	return s.managementOverview(ctx, false)
}

// ManagementOverviewForce محاسبهٔ دوباره بدون خواندن کش.
func (s *Service) ManagementOverviewForce(ctx context.Context) *ManagementOverview {
	return s.managementOverview(ctx, true)
}

func (s *Service) managementOverview(ctx context.Context, force bool) *ManagementOverview {
	term := s.currentTerm(ctx)
	if term == nil {
		return &ManagementOverview{
			Term: "—", Threshold: 3.5, List: []ManagementRow{},
		}
	}
	key := "bi:overview:term:" + itoa(term.ID)
	var cached ManagementOverview
	if age, ok := s.readCache(ctx, key, &cached); ok && !force {
		cached.CacheAgeSeconds = age
		if cached.List == nil {
			cached.List = []ManagementRow{}
		}
		return &cached
	}

	threshold := 3.5
	trendCount := 3.0
	if s.Settings != nil {
		threshold = s.Settings.GetNumber(ctx, "EVAL_FLAG_THRESHOLD", 3.5)
		trendCount = s.Settings.GetNumber(ctx, "EVAL_TREND_TERMS", 3)
	}
	termID := term.ID
	period := s.activePeriod(ctx, &termID)
	staffList := s.teachingStaff(ctx, termID)
	scores := s.allStaffPeriodScores(ctx)
	respondents := map[int64]int{}
	if period != nil {
		respondents = s.respondentsByStaff(ctx, period.ID, termID)
	}
	offerings := s.offeringsByStaff(ctx, termID)

	byStaff := map[int64][]staffPeriodScore{}
	for _, sc := range scores {
		byStaff[sc.StaffID] = append(byStaff[sc.StaffID], sc)
	}
	limit := int(math.Max(1, trendCount))
	list := []ManagementRow{}
	for _, st := range staffList {
		all := byStaff[st.StaffID]
		if len(all) == 0 {
			continue
		}
		hist := all
		if len(hist) > limit {
			hist = hist[len(hist)-limit:]
		}
		trend := []TrendPoint{}
		for _, sc := range hist {
			r := round2(sc.Score)
			if r == nil {
				continue
			}
			termTitle := "—"
			if sc.TermTitle != nil && *sc.TermTitle != "" {
				termTitle = *sc.TermTitle
			}
			trend = append(trend, TrendPoint{Period: sc.PeriodTitle, Term: termTitle, TermID: sc.TermID, Score: r})
		}
		if len(trend) == 0 {
			continue
		}
		score := trend[len(trend)-1].Score
		var prev *float64
		if len(trend) > 1 {
			prev = trend[len(trend)-2].Score
		}
		var delta *float64
		if prev != nil && score != nil {
			d := math.Round((*score-*prev)*100) / 100
			delta = &d
		}
		list = append(list, ManagementRow{
			StaffID: st.StaffID, Name: st.Name, Rank: st.Rank, Department: st.Department,
			Score: *score, PrevScore: prev, Delta: delta,
			Respondents: respondents[st.StaffID], Offerings: offerings[st.StaffID],
			Flagged: *score < threshold, Trend: trend,
		})
	}
	sort.SliceStable(list, func(i, j int) bool { return list[i].Score < list[j].Score })

	var sum float64
	for _, r := range list {
		sum += r.Score
	}
	var avg *float64
	if len(list) > 0 {
		avgVal := sum / float64(len(list))
		avg = round2(&avgVal)
	}
	flagged := 0
	totalRespondents := 0
	for _, r := range list {
		if r.Flagged {
			flagged++
		}
		totalRespondents += r.Respondents
	}
	var periodTitle *string
	if period != nil {
		p := period.Title
		periodTitle = &p
	}
	now := time.Now().UTC().Format(time.RFC3339)
	report := &ManagementOverview{
		Term: term.Title, Period: periodTitle, Threshold: threshold,
		FlaggedCount: flagged, AvgScore: avg, TotalRespondents: totalRespondents,
		List: list, CachedAt: &now,
	}
	s.writeCache(ctx, key, "MANAGEMENT_OVERVIEW", report, len(list))
	return report
}

// FacilitiesReport پورت facilitiesReport (با کش).
func (s *Service) FacilitiesReport(ctx context.Context) *FacilitiesReport {
	return s.facilitiesReport(ctx, false)
}

// FacilitiesReportForce محاسبهٔ دوباره بدون خواندن کش.
func (s *Service) FacilitiesReportForce(ctx context.Context) *FacilitiesReport {
	return s.facilitiesReport(ctx, true)
}

func (s *Service) facilitiesReport(ctx context.Context, force bool) *FacilitiesReport {
	term := s.currentTerm(ctx)
	if term == nil {
		report := &FacilitiesReport{Term: "—", RepairThreshold: 3, Rooms: []FacilityRow{}}
		return report
	}
	key := "bi:facilities:term:" + itoa(term.ID)
	var cached FacilitiesReport
	if age, ok := s.readCache(ctx, key, &cached); ok && !force {
		cached.CacheAgeSeconds = age
		if cached.Rooms == nil {
			cached.Rooms = []FacilityRow{}
		}
		return &cached
	}

	repairThreshold := 3.0
	if s.Settings != nil {
		repairThreshold = s.Settings.GetNumber(ctx, "EVAL_FACILITY_REPAIR_THRESHOLD", 3)
	}
	termID := term.ID
	period := s.activePeriod(ctx, &termID)
	var periodID any
	if period != nil {
		periodID = period.ID
	}

	coursesRes, _ := s.Pool.Query(ctx, `
		select sc."roomId", string_agg(distinct c.code, ',') as codes
		  from schedules sc
		  join course_offerings o on o.id = sc."offeringId"
		  join courses c on c.id = o."courseId"
		 where sc."scheduleType" = 'CLASS' and sc."roomId" is not null and o."termId" = $1
		 group by sc."roomId"`, termID)
	coursesByRoom := map[int64][]string{}
	if coursesRes != nil {
		for coursesRes.Next() {
			var roomID int64
			var codes *string
			if err := coursesRes.Scan(&roomID, &codes); err == nil && codes != nil {
				parts := []string{}
				for _, p := range strings.Split(*codes, ",") {
					if p != "" {
						parts = append(parts, p)
					}
				}
				coursesByRoom[roomID] = parts
			}
		}
		coursesRes.Close()
	}

	axesRows, err := s.Pool.Query(ctx, `
		with room_offering as (
		  select distinct sc."roomId" as room_id, sc."offeringId" as offering_id
		    from schedules sc
		    join course_offerings o on o.id = sc."offeringId"
		   where sc."scheduleType" = 'CLASS' and sc."roomId" is not null and o."termId" = $1
		)
		select cr.id, cr.name, cr."buildingName", cr."roomType",
		       q."axisLabel", avg(qo."scoreValue")::float8, count(*)::int
		  from evaluation_responses r
		  join room_offering ro on ro.offering_id = r."offeringId"
		  join classrooms cr on cr.id = ro.room_id
		  join evaluation_questions q on q.id = r."questionId"
		  join evaluation_forms f on f.id = q."formId"
		  join question_options qo on qo.id = r."selectedOptionId"
		 where f."targetType" = 'FACILITY'
		   and ($2::int is null or r."periodId" = $2)
		   and q."axisLabel" is not null
		   and r."selectedOptionId" is not null
		 group by cr.id, cr.name, cr."buildingName", cr."roomType", q."axisLabel"`,
		termID, periodID)
	if err != nil {
		return &FacilitiesReport{Term: term.Title, RepairThreshold: repairThreshold, Rooms: []FacilityRow{}}
	}

	rooms := map[int64]*FacilityRow{}
	order := []int64{}
	for axesRows.Next() {
		var roomID int64
		var room string
		var building, roomType, label *string
		var score float64
		var n int
		if err := axesRows.Scan(&roomID, &room, &building, &roomType, &label, &score, &n); err != nil {
			continue
		}
		row := rooms[roomID]
		if row == nil {
			row = &FacilityRow{
				RoomID: roomID, Room: room, Building: building, Type: roomType,
				Axes: []FacilityAxis{}, WorstAxis: "—",
				Courses: coursesByRoom[roomID],
			}
			if row.Courses == nil {
				row.Courses = []string{}
			}
			rooms[roomID] = row
			order = append(order, roomID)
		}
		lbl := "—"
		if label != nil && *label != "" {
			lbl = *label
		}
		r := round2(&score)
		if r == nil {
			zero := 0.0
			r = &zero
		}
		row.Axes = append(row.Axes, FacilityAxis{Label: lbl, Score: *r, Responses: n})
		row.Responses += n
	}
	axesRows.Close()

	out := make([]FacilityRow, 0, len(rooms))
	for _, id := range order {
		row := rooms[id]
		worst := row.Axes[0]
		for _, a := range row.Axes[1:] {
			if a.Score < worst.Score {
				worst = a
			}
		}
		row.WorstAxis = worst.Label
		row.WorstScore = worst.Score
		for _, a := range row.Axes {
			if a.Score < repairThreshold {
				row.NeedsRepair = true
				break
			}
		}
		out = append(out, *row)
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].WorstScore < out[j].WorstScore })
	needsRepair := 0
	for _, r := range out {
		if r.NeedsRepair {
			needsRepair++
		}
	}
	var periodTitle *string
	if period != nil {
		p := period.Title
		periodTitle = &p
	}
	now := time.Now().UTC().Format(time.RFC3339)
	report := &FacilitiesReport{
		Term: term.Title, Period: periodTitle, RepairThreshold: repairThreshold,
		NeedsRepairCount: needsRepair, Rooms: out, CachedAt: &now,
	}
	s.writeCache(ctx, key, "FACILITIES", report, len(out))
	return report
}

func itoa(v int64) string {
	if v == 0 {
		return "0"
	}
	neg := v < 0
	if neg {
		v = -v
	}
	buf := [20]byte{}
	i := len(buf)
	for v > 0 {
		i--
		buf[i] = byte('0' + v%10)
		v /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}
