// ═══ ادغام دروس (گروه‌بندی برنامهٔ هفتگی) — پورت api/admin/offering-merge ═══
package admin

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"

	"backend-go/internal/session"
)

// MergeMember عضو یک گروه ادغام.
type MergeMember struct {
	OfferingID    int64   `json:"offeringId"`
	CourseCode    string  `json:"courseCode"`
	CourseTitle   string  `json:"courseTitle"`
	GroupNumber   int     `json:"groupNumber"`
	EnrolledCount int     `json:"enrolledCount"`
	ProfessorName *string `json:"professorName"`
	MergeKey      *string `json:"mergeKey"`
	Slots         string  `json:"slots"`
}

// MergeGroup گروه ادغام.
type MergeGroup struct {
	Key           *string       `json:"key"`
	Merged        bool          `json:"merged"`
	Source        string        `json:"source"`
	TotalEnrolled int           `json:"totalEnrolled"`
	Members       []MergeMember `json:"members"`
}

var mergeDaysFa = []string{"شنبه", "یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه"}

func normMergeTime(v string) string {
	v = strings.TrimSpace(v)
	if len(v) >= 5 {
		return v[:5]
	}
	return v
}

func autoMergeKey(slots []mergeSlot) string {
	parts := []string{}
	seen := map[string]bool{}
	for _, s := range slots {
		if s.Day == nil {
			continue
		}
		st, en := normMergeTime(s.Start), normMergeTime(s.End)
		if st == "" || en == "" {
			continue
		}
		p := strconv.Itoa(*s.Day) + "|" + st + "|" + en + "|-"
		if !seen[p] {
			seen[p] = true
			parts = append(parts, p)
		}
	}
	if len(parts) == 0 {
		return ""
	}
	sort.Strings(parts)
	return "S:" + strings.Join(parts, ";")
}

type mergeSlot struct {
	Day   *int
	Start string
	End   string
}

// CourseMergeGroups فهرست گروه‌های ادغام یک ترم.
func (s *Service) CourseMergeGroups(ctx context.Context, user *session.User, cookie string, termID int64) ([]MergeGroup, error) {
	uniID := s.UniversityID(ctx, user, cookie)
	if uniID == nil {
		return nil, errors.New("دانشگاه فعال نامشخص است.")
	}
	if termID <= 0 {
		return nil, errors.New("نیمسال نامعتبر است.")
	}
	type offering struct {
		ID            int64
		Code, Title   string
		GroupNumber   int
		EnrolledCount int
		MergeKey      *string
		ProfessorName *string
	}
	rows, err := s.DB.Pool.Query(ctx, `
		select o.id, c.code, c.title, coalesce(o."groupNumber",0), coalesce(o."enrolledCount",0),
		       o."sharedScheduleGroupKey", (u."firstName" || ' ' || u."lastName")
		  from course_offerings o
		  join courses c on c.id = o."courseId"
		  left join staff st on st.id = o."professorId"
		  left join users u on u.id = st."userId"
		 where o."termId" = $1 and coalesce(o."isActive",1) = 1 and o."universityId" = $2
		 order by c.title, o."groupNumber"`, termID, *uniID)
	if err != nil {
		return nil, err
	}
	offerings := []offering{}
	for rows.Next() {
		var o offering
		if err := rows.Scan(&o.ID, &o.Code, &o.Title, &o.GroupNumber, &o.EnrolledCount, &o.MergeKey, &o.ProfessorName); err == nil {
			offerings = append(offerings, o)
		}
	}
	rows.Close()

	slotsByOffering := map[int64][]mergeSlot{}
	srows, err := s.DB.Pool.Query(ctx, `
		select sr."offeringId", sr."dayOfWeek", to_char(sr."startTime",'HH24:MI'), to_char(sr."endTime",'HH24:MI')
		  from schedules sr
		  join course_offerings o on o.id = sr."offeringId"
		 where o."termId" = $1 and sr."scheduleType" = 'CLASS'`, termID)
	if err == nil {
		for srows.Next() {
			var oid int64
			var day *int
			var start, end *string
			if err := srows.Scan(&oid, &day, &start, &end); err == nil {
				st, en := "", ""
				if start != nil {
					st = *start
				}
				if end != nil {
					en = *end
				}
				slotsByOffering[oid] = append(slotsByOffering[oid], mergeSlot{Day: day, Start: st, End: en})
			}
		}
		srows.Close()
	}

	slotText := func(id int64) string {
		list := slotsByOffering[id]
		if len(list) == 0 {
			return "—"
		}
		parts := []string{}
		for _, sl := range list {
			d := "?"
			if sl.Day != nil && *sl.Day >= 0 && *sl.Day < 7 {
				d = mergeDaysFa[*sl.Day]
			}
			st, en := normMergeTime(sl.Start), normMergeTime(sl.End)
			if st != "" && en != "" {
				parts = append(parts, d+" "+st+"–"+en)
			} else {
				parts = append(parts, d)
			}
		}
		return strings.Join(parts, "، ")
	}

	keyOf := func(o offering) string {
		manual := ""
		if o.MergeKey != nil {
			manual = strings.TrimSpace(*o.MergeKey)
		}
		if manual != "" && !strings.HasPrefix(manual, "SOLO-") {
			return "K:" + manual
		}
		if strings.HasPrefix(manual, "SOLO-") {
			return "SOLO:" + strconv.FormatInt(o.ID, 10)
		}
		return autoMergeKey(slotsByOffering[o.ID])
	}

	out := []MergeGroup{}
	indexByKey := map[string]int{}
	for _, o := range offerings {
		key := keyOf(o)
		member := MergeMember{
			OfferingID: o.ID, CourseCode: o.Code, CourseTitle: o.Title,
			GroupNumber: o.GroupNumber, EnrolledCount: o.EnrolledCount,
			ProfessorName: o.ProfessorName, MergeKey: o.MergeKey,
			Slots: slotText(o.ID),
		}
		if key == "" {
			out = append(out, MergeGroup{Source: "solo", Members: []MergeMember{member}, TotalEnrolled: o.EnrolledCount})
			continue
		}
		if idx, ok := indexByKey[key]; ok {
			out[idx].Members = append(out[idx].Members, member)
			out[idx].TotalEnrolled += o.EnrolledCount
			out[idx].Merged = len(out[idx].Members) > 1
			continue
		}
		k := key
		source := "auto"
		if strings.HasPrefix(key, "K:") {
			source = "manual"
		} else if strings.HasPrefix(key, "SOLO:") {
			source = "split"
		}
		indexByKey[key] = len(out)
		out = append(out, MergeGroup{Key: &k, Source: source, Members: []MergeMember{member}, TotalEnrolled: o.EnrolledCount})
	}
	return out, nil
}

// UpdateCourseMerge ادغام/جداکردن/بازگشت به خودکار.
func (s *Service) UpdateCourseMerge(ctx context.Context, user *session.User, cookie string, offeringIDs []int64, mode string) error {
	uniID := s.UniversityID(ctx, user, cookie)
	if uniID == nil {
		return errors.New("دانشگاه فعال نامشخص است.")
	}
	if mode != "merge" && mode != "split" && mode != "auto" {
		return errors.New("حالت نامعتبر است.")
	}
	ids := uniquePositiveIDs(offeringIDs)
	if len(ids) == 0 || len(ids) > 100 {
		return errors.New("invalid_body")
	}
	args := []any{ids, *uniID}
	rows, err := s.DB.Pool.Query(ctx, `
		select id, "termId" from course_offerings where id = any($1) and "universityId" = $2`, args...)
	if err != nil {
		return err
	}
	found := map[int64]int64{}
	for rows.Next() {
		var id, termID int64
		if err := rows.Scan(&id, &termID); err == nil {
			found[id] = termID
		}
	}
	rows.Close()
	if len(found) != len(ids) {
		return errors.New("offering_not_found")
	}
	var termID int64
	for _, t := range found {
		if termID == 0 {
			termID = t
		} else if termID != t {
			return errors.New("mixed_terms")
		}
	}
	minID := ids[0]
	for _, id := range ids {
		if id < minID {
			minID = id
		}
	}
	keys := map[int64]any{}
	switch mode {
	case "merge":
		k := fmt.Sprintf("M-%d-%d", termID, minID)
		for _, id := range ids {
			keys[id] = k
		}
	case "split":
		for _, id := range ids {
			keys[id] = "SOLO-" + strconv.FormatInt(id, 10)
		}
	default:
		for _, id := range ids {
			keys[id] = nil
		}
	}
	tx, err := s.DB.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	for id, key := range keys {
		if _, err := tx.Exec(ctx, `update course_offerings set "sharedScheduleGroupKey" = $2 where id = $1`, id, key); err != nil {
			return err
		}
	}
	details := fmt.Sprintf(`{"mode":%s,"offeringIds":%s,"termId":%d}`, jsonQuote(mode), jsonIntArray(ids), termID)
	if err := s.writeAdminAuditTx(ctx, tx, user.ID, "OFFERING_MERGE_UPDATED", "course_offering", minID, details); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func uniquePositiveIDs(ids []int64) []int64 {
	seen := map[int64]bool{}
	out := []int64{}
	for _, id := range ids {
		if id > 0 && !seen[id] {
			seen[id] = true
			out = append(out, id)
		}
	}
	return out
}

func jsonIntArray(ids []int64) string {
	parts := make([]string, len(ids))
	for i, id := range ids {
		parts[i] = strconv.FormatInt(id, 10)
	}
	return "[" + strings.Join(parts, ",") + "]"
}
