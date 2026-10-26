// ═══ حل نسخهٔ برنامهٔ درسی — پورت curriculum-resolution.ts (بخش Pure) ═══
package enroll

import (
	"context"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

// ResolvableVersion حداقل شکل نسخهٔ برنامه برای Resolution.
type ResolvableVersion struct {
	ID               int64
	MajorID          int64
	DegreeLevelID    int64
	TrackID          *int64
	VersionCode      string
	Status           string
	EntryYearFrom    int
	EntryYearTo      *int
	EntryTermID      *int64
	TotalRequiredUID int
}

var resolutionStatuses = map[string]bool{"PUBLISHED": true, "ARCHIVED": true}

var statusRank = map[string]int{
	"PUBLISHED": 0, "ARCHIVED": 1, "APPROVED": 2, "REVIEW": 3, "DRAFT": 4,
}

type ParsedVersionCode struct {
	Base     string
	Revision int
}

var versionCodeRe = regexp.MustCompile(`^(.+)-R(\d+)$`)

// ParseVersionCode پورت parseVersionCode.
func ParseVersionCode(code string) ParsedVersionCode {
	trimmed := strings.TrimSpace(code)
	if m := versionCodeRe.FindStringSubmatch(trimmed); m != nil {
		rev, _ := strconv.Atoi(m[2])
		return ParsedVersionCode{Base: strings.TrimSpace(m[1]), Revision: rev}
	}
	return ParsedVersionCode{Base: trimmed, Revision: 0}
}

var digitsRe = regexp.MustCompile(`^\d+$`)

// CompareVersionCodes پورت compareVersionCodes (منفی = a قدیمی‌تر).
func CompareVersionCodes(a, b string) int {
	pa, pb := ParseVersionCode(a), ParseVersionCode(b)
	var baseCmp int
	if digitsRe.MatchString(pa.Base) && digitsRe.MatchString(pb.Base) {
		na, _ := strconv.Atoi(pa.Base)
		nb, _ := strconv.Atoi(pb.Base)
		baseCmp = na - nb
	} else {
		baseCmp = strings.Compare(pa.Base, pb.Base)
	}
	if baseCmp != 0 {
		return baseCmp
	}
	return pa.Revision - pb.Revision
}

// CurriculumContext زمینهٔ حل نسخه.
type CurriculumContext struct {
	MajorID       int64
	DegreeLevelID int64
	TrackID       *int64
	EntryYear     int
	EntryTerm     *int
}

// ResolutionOutcome نتیجهٔ حل.
type ResolutionOutcome struct {
	Version    *ResolvableVersion
	Reason     string
	Candidates []int64
}

// RankVersions پورت rankVersions.
func RankVersions(a, b ResolvableVersion) int {
	if st := statusRank[a.Status] - statusRank[b.Status]; st != 0 {
		return st
	}
	if vc := CompareVersionCodes(b.VersionCode, a.VersionCode); vc != 0 {
		return vc
	}
	if a.EntryYearFrom != b.EntryYearFrom {
		return b.EntryYearFrom - a.EntryYearFrom
	}
	if a.ID > b.ID {
		return -1
	}
	if a.ID < b.ID {
		return 1
	}
	return 0
}

// ResolveApplicableCurriculum پورت resolveApplicableCurriculum.
func ResolveApplicableCurriculum(versions []ResolvableVersion, ctx CurriculumContext) ResolutionOutcome {
	if len(versions) == 0 {
		return ResolutionOutcome{Reason: "NO_VERSIONS"}
	}
	byStatus := []ResolvableVersion{}
	for _, v := range versions {
		if resolutionStatuses[v.Status] {
			byStatus = append(byStatus, v)
		}
	}
	if len(byStatus) == 0 {
		return ResolutionOutcome{Reason: "NO_ACTIVE_STATUS"}
	}
	byMajor := []ResolvableVersion{}
	for _, v := range byStatus {
		if v.MajorID == ctx.MajorID && v.DegreeLevelID == ctx.DegreeLevelID {
			byMajor = append(byMajor, v)
		}
	}
	if len(byMajor) == 0 {
		return ResolutionOutcome{Reason: "NO_MAJOR_OR_DEGREE"}
	}
	exactTrack := []ResolvableVersion{}
	genericTrack := []ResolvableVersion{}
	for _, v := range byMajor {
		if v.TrackID == nil {
			genericTrack = append(genericTrack, v)
		} else if ctx.TrackID != nil && *v.TrackID == *ctx.TrackID {
			exactTrack = append(exactTrack, v)
		}
	}
	byTrack := exactTrack
	if len(byTrack) == 0 {
		byTrack = genericTrack
	}
	if len(byTrack) == 0 {
		return ResolutionOutcome{Reason: "NO_TRACK"}
	}
	inWindow := []ResolvableVersion{}
	for _, v := range byTrack {
		if v.EntryYearFrom <= ctx.EntryYear && (v.EntryYearTo == nil || *v.EntryYearTo >= ctx.EntryYear) {
			inWindow = append(inWindow, v)
		}
	}
	if len(inWindow) == 0 {
		return ResolutionOutcome{Reason: "NO_ENTRY_WINDOW"}
	}
	byTerm := []ResolvableVersion{}
	for _, v := range inWindow {
		if v.EntryTermID == nil || (ctx.EntryTerm != nil && *v.EntryTermID == int64(*ctx.EntryTerm)) {
			byTerm = append(byTerm, v)
		}
	}
	if len(byTerm) == 0 {
		return ResolutionOutcome{Reason: "NO_ENTRY_WINDOW"}
	}
	sorted := make([]ResolvableVersion, len(inWindow))
	copy(sorted, inWindow)
	sort.SliceStable(sorted, func(i, j int) bool { return RankVersions(sorted[i], sorted[j]) < 0 })
	best := sorted[0]
	candidates := make([]int64, len(sorted))
	for i, v := range sorted {
		candidates[i] = v.ID
	}
	return ResolutionOutcome{Version: &best, Reason: "RESOLVED", Candidates: candidates}
}

// ── لایهٔ DB: حل نسخهٔ دانشجو (پورت curriculum-apply.ts) ──

// ResolveStudentCurriculum نسخهٔ قابل اعمال برای دانشجو را از DB تعیین می‌کند.
// فقط نسخه‌های همان رشته واکشی می‌شوند؛ بقیهٔ فیلترها در Resolver خالص است.
func ResolveStudentCurriculum(ctx context.Context, pool *pgxpool.Pool, studentID int64) (*ResolvableVersion, error) {
	var (
		majorID, degreeLevelID *int64
		entryYear              int
		entryTerm              *int
	)
	err := pool.QueryRow(ctx, `
		select "majorId", "degreeLevelId", "entryYear", "entryTerm"
		  from students where id = $1`, studentID).Scan(&majorID, &degreeLevelID, &entryYear, &entryTerm)
	if err != nil {
		return nil, err
	}
	if majorID == nil || degreeLevelID == nil {
		return nil, nil
	}
	rows, err := pool.Query(ctx, `
		select id, "majorId", "degreeLevelId", "trackId", "versionCode", status,
		       "entryYearFrom", "entryYearTo", "entryTermId", coalesce("totalRequiredUnits",0)::int
		  from curriculum_versions where "majorId" = $1`, *majorID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	versions := []ResolvableVersion{}
	for rows.Next() {
		var v ResolvableVersion
		if err := rows.Scan(&v.ID, &v.MajorID, &v.DegreeLevelID, &v.TrackID, &v.VersionCode,
			&v.Status, &v.EntryYearFrom, &v.EntryYearTo, &v.EntryTermID, &v.TotalRequiredUID); err != nil {
			return nil, err
		}
		versions = append(versions, v)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	outcome := ResolveApplicableCurriculum(versions, CurriculumContext{
		MajorID: *majorID, DegreeLevelID: *degreeLevelID, TrackID: nil,
		EntryYear: entryYear, EntryTerm: entryTerm,
	})
	return outcome.Version, nil
}
