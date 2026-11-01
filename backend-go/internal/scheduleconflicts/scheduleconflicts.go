// ═══ Real weekly-schedule conflict detection — port of schedule-conflicts-core.ts ═══
//
// A reportable conflict = two different offerings on the same day with a time overlap that
// is not a 'merged session'. A merged class (same non-SOLO key, or exactly identical time and hall)
// is not a conflict; but two different instructors in the same hall at the same time are still
// a hall conflict. Pure and testable.
package scheduleconflicts

import (
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
)

// DayNamesFa is the day names (Saturday=0).
var DayNamesFa = []string{"شنبه", "یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنج‌شنبه", "جمعه"}

// NearSessionToleranceMin is the 'one session' tolerance for merge suggestions.
const NearSessionToleranceMin = 20

// ConflictSlot is one weekly schedule row (schedules with scheduleType='CLASS').
type ConflictSlot struct {
	ScheduleID             int64
	OfferingID             int64
	DayOfWeek              *int
	StartTime              string
	EndTime                string
	RoomID                 *int64
	RoomName               *string
	ProfessorID            *int64
	ProfessorName          *string
	CourseCode             string
	CourseTitle            string
	GroupNumber            int
	EnrolledCount          int
	SharedScheduleGroupKey *string
}

// ConflictPair is one real conflict.
type ConflictPair struct {
	Kind           string // PROFESSOR | ROOM
	EntityID       int64
	EntityName     string
	DayOfWeek      int
	DayName        string
	A              ConflictSlot
	B              ConflictSlot
	OverlapMinutes int
	OverlapFrom    int
	OverlapTo      int
	LikelyMerged   bool
	Fingerprint    string
}

// ToMinutesPtr converts 'HH:MM' -> minutes; a bad value -> nil (same as toMinutes in this file).
func ToMinutesPtr(v string) *int {
	s := strings.TrimSpace(v)
	parts := strings.SplitN(s, ":", 2)
	if len(parts) != 2 || len(parts[0]) == 0 || len(parts[0]) > 2 || len(parts[1]) < 1 {
		return nil
	}
	h, err1 := strconv.Atoi(parts[0])
	m, err2 := strconv.Atoi(parts[1][:2])
	if err1 != nil || err2 != nil || h > 23 || m > 59 {
		return nil
	}
	v2 := h*60 + m
	return &v2
}

// MinutesToHm converts minutes -> 'HH:MM'.
func MinutesToHm(v int) string {
	return fmt.Sprintf("%02d:%02d", v/60, v%60)
}

// OverlapMinutes is the length of the intersection of two intervals (0 = no overlap).
func OverlapMinutes(aStart, aEnd, bStart, bEnd int) int {
	from := aStart
	if bStart > from {
		from = bStart
	}
	to := aEnd
	if bEnd < to {
		to = bEnd
	}
	if to > from {
		return to - from
	}
	return 0
}

// SharedMergeKey کلید ادغام معتبر — SOLO- یعنی عمداً جدا.
func SharedMergeKey(v *string) *string {
	if v == nil {
		return nil
	}
	k := strings.TrimSpace(*v)
	if k == "" || strings.HasPrefix(k, "SOLO-") {
		return nil
	}
	return &k
}

// IsExplicitlySplit آیا ارائه عمداً جدا شده است؟
func IsExplicitlySplit(v *string) bool {
	return v != nil && strings.HasPrefix(strings.TrimSpace(*v), "SOLO-")
}

// IsMergedPair آیا دو اسلات «یک جلسهٔ ادغامی» هستند؟ (تداخل نیستند)
func IsMergedPair(a, b ConflictSlot) bool {
	ka := SharedMergeKey(a.SharedScheduleGroupKey)
	kb := SharedMergeKey(b.SharedScheduleGroupKey)
	if ka != nil && kb != nil && *ka == *kb {
		return true
	}
	if IsExplicitlySplit(a.SharedScheduleGroupKey) || IsExplicitlySplit(b.SharedScheduleGroupKey) {
		return false
	}
	if a.StartTime != b.StartTime || a.EndTime != b.EndTime {
		return false
	}
	// سالن NULL یعنی «نامشخص» و مانع ادغام نیست.
	if a.RoomID == nil || b.RoomID == nil {
		return true
	}
	return *a.RoomID == *b.RoomID
}

// IsNearMergedPair آیا «به‌احتمال زیاد یک جلسه» هستند؟ (پیشنهاد ادغام)
func IsNearMergedPair(a, b ConflictSlot) bool {
	if IsExplicitlySplit(a.SharedScheduleGroupKey) || IsExplicitlySplit(b.SharedScheduleGroupKey) {
		return false
	}
	if a.ProfessorID == nil || b.ProfessorID == nil {
		return false
	}
	if *a.ProfessorID != *b.ProfessorID {
		return false
	}
	if IsMergedPair(a, b) {
		return true
	}
	if a.RoomID != nil && b.RoomID != nil && *a.RoomID != *b.RoomID {
		return false
	}
	aS, aE := ToMinutesPtr(a.StartTime), ToMinutesPtr(a.EndTime)
	bS, bE := ToMinutesPtr(b.StartTime), ToMinutesPtr(b.EndTime)
	if aS == nil || aE == nil || bS == nil || bE == nil {
		return false
	}
	return abs(*aS-*bS) <= NearSessionToleranceMin && abs(*aE-*bE) <= NearSessionToleranceMin
}

func abs(n int) int {
	if n < 0 {
		return -n
	}
	return n
}

// ConflictFingerprint اثرانگشت پایدار یک تداخل.
func ConflictFingerprint(kind string, entityID int64, dayOfWeek int, aScheduleID, bScheduleID int64) string {
	lo, hi := aScheduleID, bScheduleID
	if lo > hi {
		lo, hi = hi, lo
	}
	return fmt.Sprintf("%s:%d:%d:%d:%d", kind, entityID, dayOfWeek, lo, hi)
}

// ConflictScanResult نتیجهٔ اسکن.
type ConflictScanResult struct {
	Pairs          []ConflictPair
	RawOverlaps    int
	MergedSkipped  int
	SlotsScanned   int
	DuplicateSlots int
}

// DedupeSlots حذف ردیف‌های تکراری (کلید: ارائه+روز+ساعت+سالن).
func DedupeSlots(slots []ConflictSlot) ([]ConflictSlot, int) {
	seen := map[string]bool{}
	out := []ConflictSlot{}
	for _, s := range slots {
		day := "n"
		if s.DayOfWeek != nil {
			day = strconv.Itoa(*s.DayOfWeek)
		}
		room := "n"
		if s.RoomID != nil {
			room = strconv.FormatInt(*s.RoomID, 10)
		}
		key := fmt.Sprintf("%d|%s|%s|%s|%s", s.OfferingID, day, s.StartTime, s.EndTime, room)
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, s)
	}
	return out, len(slots) - len(out)
}

// DetectScheduleConflicts اسکن کامل یک ترم — فقط تداخل‌های واقعی.
func DetectScheduleConflicts(rawSlots []ConflictSlot) ConflictScanResult {
	slots, removed := DedupeSlots(rawSlots)
	pairs := []ConflictPair{}
	mergedSkipped := 0
	rawOverlaps := 0

	byDay := map[int][]ConflictSlot{}
	for _, s := range slots {
		if s.DayOfWeek == nil || *s.DayOfWeek < 0 || *s.DayOfWeek > 6 {
			continue
		}
		byDay[*s.DayOfWeek] = append(byDay[*s.DayOfWeek], s)
	}

	for day, list := range byDay {
		for i := 0; i < len(list); i++ {
			for j := i + 1; j < len(list); j++ {
				a := list[i]
				b := list[j]
				if a.OfferingID == b.OfferingID {
					continue
				}
				sameProfessor := a.ProfessorID != nil && b.ProfessorID != nil && *a.ProfessorID == *b.ProfessorID
				sameRoom := a.RoomID != nil && b.RoomID != nil && *a.RoomID == *b.RoomID
				if !sameProfessor && !sameRoom {
					continue
				}
				aS, aE := ToMinutesPtr(a.StartTime), ToMinutesPtr(a.EndTime)
				bS, bE := ToMinutesPtr(b.StartTime), ToMinutesPtr(b.EndTime)
				if aS == nil || aE == nil || bS == nil || bE == nil {
					continue
				}
				if *aE <= *aS || *bE <= *bS {
					continue
				}
				ov := OverlapMinutes(*aS, *aE, *bS, *bE)
				if ov <= 0 {
					continue
				}
				rawOverlaps++

				merged := IsMergedPair(a, b)
				differentTeachers := a.ProfessorID != nil && b.ProfessorID != nil && *a.ProfessorID != *b.ProfessorID
				professorConflict := sameProfessor && !merged
				roomConflict := sameRoom && (!merged || differentTeachers)
				if !professorConflict && !roomConflict {
					if merged {
						mergedSkipped++
					}
					continue
				}

				push := func(kind string, entityID int64, entityName string) {
					dayName := fmt.Sprintf("روز %d", day)
					if day < len(DayNamesFa) {
						dayName = DayNamesFa[day]
					}
					from := *aS
					if *bS > from {
						from = *bS
					}
					to := *aE
					if *bE < to {
						to = *bE
					}
					pairs = append(pairs, ConflictPair{
						Kind: kind, EntityID: entityID, EntityName: entityName,
						DayOfWeek: day, DayName: dayName,
						A: a, B: b,
						OverlapMinutes: ov, OverlapFrom: from, OverlapTo: to,
						LikelyMerged: IsNearMergedPair(a, b),
						Fingerprint:  ConflictFingerprint(kind, entityID, day, a.ScheduleID, b.ScheduleID),
					})
				}
				if professorConflict {
					name := fmt.Sprintf("استاد %d", *a.ProfessorID)
					if a.ProfessorName != nil {
						name = *a.ProfessorName
					}
					push("PROFESSOR", *a.ProfessorID, name)
				}
				if roomConflict {
					name := fmt.Sprintf("کلاس %d", *a.RoomID)
					if a.RoomName != nil {
						name = *a.RoomName
					}
					push("ROOM", *a.RoomID, name)
				}
			}
		}
	}

	sort.SliceStable(pairs, func(i, j int) bool {
		x, y := pairs[i], pairs[j]
		if x.Kind != y.Kind {
			return x.Kind == "PROFESSOR"
		}
		if x.EntityName != y.EntityName {
			return x.EntityName < y.EntityName
		}
		if x.DayOfWeek != y.DayOfWeek {
			return x.DayOfWeek < y.DayOfWeek
		}
		return x.OverlapFrom < y.OverlapFrom
	})

	return ConflictScanResult{
		Pairs: pairs, MergedSkipped: mergedSkipped, RawOverlaps: rawOverlaps,
		SlotsScanned: len(slots), DuplicateSlots: removed,
	}
}

// ConflictSummary خلاصهٔ بالای صفحه.
type ConflictSummary struct {
	Professor           int
	Room                int
	ProfessorEntities   int
	RoomEntities        int
	StudentsAtRisk      int
	WorstOverlapMinutes int
}

// SummarizeConflicts پورت summarizeConflicts.
func SummarizeConflicts(pairs []ConflictPair) ConflictSummary {
	profs := map[int64]bool{}
	rooms := map[int64]bool{}
	studentsAtRisk := 0
	worst := 0
	professor := 0
	room := 0
	seenPair := map[string]bool{}
	for _, p := range pairs {
		if p.Kind == "PROFESSOR" {
			professor++
			profs[p.EntityID] = true
		} else {
			room++
			rooms[p.EntityID] = true
		}
		if p.OverlapMinutes > worst {
			worst = p.OverlapMinutes
		}
		key := fmt.Sprintf("%d:%d", p.A.OfferingID, p.B.OfferingID)
		if !seenPair[key] {
			seenPair[key] = true
			studentsAtRisk += p.A.EnrolledCount + p.B.EnrolledCount
		}
	}
	return ConflictSummary{
		Professor: professor, Room: room,
		ProfessorEntities: len(profs), RoomEntities: len(rooms),
		StudentsAtRisk: studentsAtRisk, WorstOverlapMinutes: worst,
	}
}

// ConflictEntityGroup فهرست یکتا برای نمایش «کدام استادها/سالن‌ها درگیرند».
type ConflictEntityGroup struct {
	Kind       string
	EntityID   int64
	EntityName string
	Items      []ConflictPair
}

// GroupConflictsByEntity پورت groupConflictsByEntity.
func GroupConflictsByEntity(pairs []ConflictPair) []ConflictEntityGroup {
	order := []string{}
	byKey := map[string]*ConflictEntityGroup{}
	for _, p := range pairs {
		key := fmt.Sprintf("%s:%d", p.Kind, p.EntityID)
		cur, ok := byKey[key]
		if !ok {
			cur = &ConflictEntityGroup{Kind: p.Kind, EntityID: p.EntityID, EntityName: p.EntityName}
			byKey[key] = cur
			order = append(order, key)
		}
		cur.Items = append(cur.Items, p)
	}
	out := make([]ConflictEntityGroup, 0, len(order))
	for _, k := range order {
		out = append(out, *byKey[k])
	}
	sort.SliceStable(out, func(i, j int) bool {
		x, y := out[i], out[j]
		if x.Kind != y.Kind {
			return x.Kind == "PROFESSOR"
		}
		if len(x.Items) != len(y.Items) {
			return len(x.Items) > len(y.Items)
		}
		return x.EntityName < y.EntityName
	})
	return out
}

// ConflictEntity موجودیت درگیر.
type ConflictEntity struct {
	Kind string
	ID   int64
	Name string
}

// ConflictGroup یک «مسئله» — چند جفت هم‌زمان.
type ConflictGroup struct {
	Key            string
	Kind           string // PROFESSOR | ROOM | MIXED
	Kinds          []string
	Entities       []ConflictEntity
	EntityName     string
	DayOfWeek      int
	DayName        string
	WindowFrom     int
	WindowTo       int
	OverlapMinutes int
	OverlapFrom    int
	OverlapTo      int
	Slots          []ConflictSlot
	Pairs          []ConflictPair
	LikelyMerged   bool
	Students       int
	Reviewed       bool
}

// GroupConflictPairs پورت groupConflictPairs — union-find بر پایهٔ موجودیت
// مشترک یا اسلات مشترک.
func GroupConflictPairs(pairs []ConflictPair, isReviewed func(ConflictPair) bool) []ConflictGroup {
	n := len(pairs)
	if n == 0 {
		return nil
	}
	parent := make([]int, n)
	for i := range parent {
		parent[i] = i
	}
	var find func(int) int
	find = func(x int) int {
		for parent[x] != x {
			parent[x] = parent[parent[x]]
			x = parent[x]
		}
		return x
	}
	union := func(x, y int) {
		rx, ry := find(x), find(y)
		if rx != ry {
			parent[ry] = rx
		}
	}
	windowsOverlap := func(p, q ConflictPair) bool {
		return p.OverlapFrom < q.OverlapTo && q.OverlapFrom < p.OverlapTo
	}
	sharesSlot := func(p, q ConflictPair) bool {
		return p.A.OfferingID == q.A.OfferingID || p.A.OfferingID == q.B.OfferingID ||
			p.B.OfferingID == q.A.OfferingID || p.B.OfferingID == q.B.OfferingID
	}
	for i := 0; i < n; i++ {
		for j := i + 1; j < n; j++ {
			p, q := pairs[i], pairs[j]
			if p.DayOfWeek != q.DayOfWeek || !windowsOverlap(p, q) {
				continue
			}
			sameEntity := p.Kind == q.Kind && p.EntityID == q.EntityID
			if sameEntity || sharesSlot(p, q) {
				union(i, j)
			}
		}
	}
	byRoot := map[int][]int{}
	order := []int{}
	for i := 0; i < n; i++ {
		r := find(i)
		if _, ok := byRoot[r]; !ok {
			order = append(order, r)
		}
		byRoot[r] = append(byRoot[r], i)
	}

	out := []ConflictGroup{}
	for _, root := range order {
		cluster := make([]ConflictPair, 0, len(byRoot[root]))
		for _, i := range byRoot[root] {
			cluster = append(cluster, pairs[i])
		}
		slotMap := map[int64]ConflictSlot{}
		entityMap := map[string]ConflictEntity{}
		for _, p := range cluster {
			slotMap[p.A.OfferingID] = p.A
			slotMap[p.B.OfferingID] = p.B
			entityMap[fmt.Sprintf("%s:%d", p.Kind, p.EntityID)] = ConflictEntity{Kind: p.Kind, ID: p.EntityID, Name: p.EntityName}
		}
		slots := make([]ConflictSlot, 0, len(slotMap))
		for _, s := range slotMap {
			slots = append(slots, s)
		}
		sort.SliceStable(slots, func(i, j int) bool { return slots[i].CourseCode < slots[j].CourseCode })
		entities := make([]ConflictEntity, 0, len(entityMap))
		for _, e := range entityMap {
			entities = append(entities, e)
		}
		sort.SliceStable(entities, func(i, j int) bool {
			if entities[i].Kind != entities[j].Kind {
				return entities[i].Kind == "PROFESSOR"
			}
			return entities[i].Name < entities[j].Name
		})

		windowFrom := math.MaxInt
		windowTo := 0
		overlapMinutes := 0
		overlapFrom := math.MaxInt
		overlapTo := 0
		students := 0
		for _, s := range slots {
			if st := ToMinutesPtr(s.StartTime); st != nil && *st < windowFrom {
				windowFrom = *st
			}
			if en := ToMinutesPtr(s.EndTime); en != nil && *en > windowTo {
				windowTo = *en
			}
			students += s.EnrolledCount
		}
		for _, p := range cluster {
			if p.OverlapMinutes > overlapMinutes {
				overlapMinutes = p.OverlapMinutes
			}
			if p.OverlapFrom < overlapFrom {
				overlapFrom = p.OverlapFrom
			}
			if p.OverlapTo > overlapTo {
				overlapTo = p.OverlapTo
			}
		}
		if windowFrom == math.MaxInt {
			windowFrom = 0
		}
		kinds := []string{}
		seenKind := map[string]bool{}
		for _, e := range entities {
			if !seenKind[e.Kind] {
				seenKind[e.Kind] = true
				kinds = append(kinds, e.Kind)
			}
		}
		sort.SliceStable(kinds, func(i, j int) bool {
			if kinds[i] == kinds[j] {
				return false
			}
			return kinds[i] == "PROFESSOR"
		})
		first := cluster[0]
		// کلید نمایشی پایدار: روز:از:تا:موجودیت‌ها
		key := fmt.Sprintf("%d:%d:%d:", first.DayOfWeek, overlapFrom, overlapTo)
		parts := make([]string, 0, len(entities))
		for _, e := range entities {
			parts = append(parts, fmt.Sprintf("%c%d", e.Kind[0], e.ID))
		}
		key += strings.Join(parts, "+")

		kind := "MIXED"
		if len(kinds) == 1 {
			kind = kinds[0]
		}
		likelyMerged := true
		for _, p := range cluster {
			if !p.LikelyMerged {
				likelyMerged = false
				break
			}
		}
		reviewed := false
		if isReviewed != nil {
			reviewed = true
			for _, p := range cluster {
				if !isReviewed(p) {
					reviewed = false
					break
				}
			}
		}
		names := make([]string, 0, len(entities))
		for _, e := range entities {
			names = append(names, e.Name)
		}
		out = append(out, ConflictGroup{
			Key: key, Kind: kind, Kinds: kinds, Entities: entities,
			EntityName: strings.Join(names, "، "),
			DayOfWeek:  first.DayOfWeek, DayName: first.DayName,
			WindowFrom: windowFrom, WindowTo: windowTo,
			OverlapMinutes: overlapMinutes, OverlapFrom: overlapFrom, OverlapTo: overlapTo,
			Slots: slots, Pairs: cluster,
			LikelyMerged: likelyMerged, Students: students, Reviewed: reviewed,
		})
	}

	sort.SliceStable(out, func(i, j int) bool {
		x, y := out[i], out[j]
		if len(x.Slots) != len(y.Slots) {
			return len(x.Slots) > len(y.Slots)
		}
		if x.Kind != y.Kind {
			// PROFESSOR قبل، سپس ROOM، سپس MIXED
			rank := func(k string) int {
				switch k {
				case "PROFESSOR":
					return 0
				case "ROOM":
					return 1
				}
				return 2
			}
			return rank(x.Kind) < rank(y.Kind)
		}
		if x.EntityName != y.EntityName {
			return x.EntityName < y.EntityName
		}
		if x.DayOfWeek != y.DayOfWeek {
			return x.DayOfWeek < y.DayOfWeek
		}
		return x.OverlapFrom < y.OverlapFrom
	})
	return out
}

// ConflictReasonLabels برچسب‌های فارسی دلیل «بررسی شد».
var ConflictReasonLabels = map[string]string{
	"MERGED_OK": "کلاس ادغامی است (یک جلسهٔ واقعی)",
	"PROF_OK":   "استاد هماهنگ است (حضور نوبتی/تفکیک جلسه)",
	"ROOM_OK":   "سالن اشتراکی/بزرگ — اشکالی ندارد",
	"WILL_FIX":  "نیاز به اصلاح برنامه (فعلاً پذیرفته شده)",
	"OTHER":     "سایر موارد",
}

// ConflictReasonCodes کدهای مجاز دلیل.
var ConflictReasonCodes = func() []string {
	return []string{"MERGED_OK", "PROF_OK", "ROOM_OK", "WILL_FIX", "OTHER"}
}()
