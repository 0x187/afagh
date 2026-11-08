// ═══ Virtual classes admin (BigBlueButton report + sync) ═══
//
// Port of afagh-next/src/app/admin/virtual-classes/{page.tsx,actions.ts} which
// itself re-exports the professor actions (listVirtualClassroomsAdminAction /
// syncVirtualClassStatusAction / syncBbbRecordingsAction). The student side
// already lives in internal/student (ListVirtualClasses / JoinVirtualClass).
//
// The BBB HTTP calls (isMeetingRunning / getMeetingInfo / getRecordings) are
// implemented here with the same checksum scheme as afagh-next/src/lib/bbb-api
// (config from settings: BBB_URL + BBB_SECRET, optional BBB_CHECKSUM_ALGO).
package admin

import (
	"context"
	"crypto/sha1"
	"crypto/sha256"
	"crypto/sha512"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"backend-go/internal/session"
)

// VirtualClassAdminRow is one row of the admin online-classes report
// (AdminVirtualRow port).
type VirtualClassAdminRow struct {
	ID               int64   `json:"id"`
	MeetingID        string  `json:"meetingId"`
	Name             string  `json:"name"`
	IsRunning        bool    `json:"isRunning"`
	ParticipantCount int     `json:"participantCount"`
	LastSyncedAt     *string `json:"lastSyncedAt"`
	LastRunningAt    *string `json:"lastRunningAt"`
	RecordingsCount  int     `json:"recordingsCount"`
	CourseCode       *string `json:"courseCode"`
	CourseTitle      string  `json:"courseTitle"`
	ProfessorName    string  `json:"professorName"`
	TermTitle        *string `json:"termTitle"`
	GroupNumber      int     `json:"groupNumber"`
	EnrolledCount    int     `json:"enrolledCount"`
	UniversityID     *int64  `json:"universityId"`
}

// ListVirtualClassroomsAdmin ports listVirtualClassroomsAdminAction —
// every defined online class with its offering/course/professor/term context.
// University scope follows the standard admin idiom: a nil university context
// (platform view) sees all rows, a set context only its own university.
func (s *Service) ListVirtualClassroomsAdmin(ctx context.Context, user *session.User, cookie string, termID *int64) ([]VirtualClassAdminRow, error) {
	uniID := s.UniversityID(ctx, user, cookie)
	rows, err := s.DB.Pool.Query(ctx, `
		select vc.id, vc."bbbMeetingId", vc."meetingName",
		       coalesce(vc."isRunning",0) <> 0,
		       coalesce(vc."currentAttendanceCount",0),
		       vc."lastSyncedAt"::text, vc."lastRunningAt"::text,
		       (select count(*)::int from virtual_class_recordings vr where vr."classroomId" = vc.id),
		       c.code, c.title,
		       coalesce(u."firstName" || ' ' || u."lastName", ''),
		       t.title, coalesce(o."groupNumber",0),
		       coalesce(o."enrolledCount",0),
		       vc."universityId"
		  from virtual_classrooms vc
		  join course_offerings o on o.id = vc."courseOfferingId"
		  join courses c on c.id = o."courseId"
		  left join staff st on st.id = o."professorId"
		  left join users u on u.id = st."userId"
		  left join academic_terms t on t.id = o."termId"
		 where ($1::int is null or o."termId" = $1::int)
		   and ($2::int is null or vc."universityId" = $2::int)
		 order by o."termId" desc nulls last, c.code, coalesce(o."groupNumber",0)`,
		termID, uniID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []VirtualClassAdminRow{}
	for rows.Next() {
		var r VirtualClassAdminRow
		if err := rows.Scan(&r.ID, &r.MeetingID, &r.Name, &r.IsRunning, &r.ParticipantCount,
			&r.LastSyncedAt, &r.LastRunningAt, &r.RecordingsCount,
			&r.CourseCode, &r.CourseTitle, &r.ProfessorName, &r.TermTitle,
			&r.GroupNumber, &r.EnrolledCount, &r.UniversityID); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// VirtualClassTerm is a term option of the report filter.
type VirtualClassTerm struct {
	ID       int64  `json:"id"`
	Title    string `json:"title"`
	TermCode string `json:"termCode"`
}

// ListVirtualClassTerms ports the page.tsx term picker load.
func (s *Service) ListVirtualClassTerms(ctx context.Context, user *session.User, cookie string) ([]VirtualClassTerm, error) {
	uniID := s.UniversityID(ctx, user, cookie)
	rows, err := s.DB.Pool.Query(ctx, `
		select id, title, coalesce("termCode",'') from academic_terms
		 where ($1::int is null or "universityId" = $1::int)
		 order by id desc limit 50`, uniID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []VirtualClassTerm{}
	for rows.Next() {
		var t VirtualClassTerm
		if err := rows.Scan(&t.ID, &t.Title, &t.TermCode); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// ── BBB API client (port of bbb-api.ts) ──

// vcBbbChecksum signs a BBB request with the configured algorithm
// (BBB 2.7+ defaults to SHA256; SHA1 covers old installs).
func vcBbbChecksum(algo, callName, query, secret string) string {
	raw := callName + query + secret
	switch strings.ToUpper(algo) {
	case "SHA1":
		sum := sha1.Sum([]byte(raw))
		return hex.EncodeToString(sum[:])
	case "SHA512":
		sum := sha512.Sum512([]byte(raw))
		return hex.EncodeToString(sum[:])
	default:
		sum := sha256.Sum256([]byte(raw))
		return hex.EncodeToString(sum[:])
	}
}

// vcBbbCall performs one BBB API call and returns the raw XML response.
func (s *Service) vcBbbCall(ctx context.Context, name string, params map[string]string) (string, error) {
	if s.Store == nil {
		return "", errors.New("سرویس کلاس مجازی پیکربندی نشده است.")
	}
	base, err := s.Store.Get(ctx, "BBB_URL")
	if err != nil || strings.TrimSpace(base) == "" {
		return "", errors.New("سرویس کلاس مجازی پیکربندی نشده است — پنل مدیر ← پیکربندی سامانه ← کلاس مجازی")
	}
	secret, err := s.Store.Get(ctx, "BBB_SECRET")
	if err != nil {
		secret = ""
	}
	algo := "SHA256"
	if v, err := s.Store.Get(ctx, "BBB_CHECKSUM_ALGO"); err == nil {
		algo = strings.TrimSpace(v)
	}

	values := url.Values{}
	for k, v := range params {
		values.Set(k, v)
	}
	qs := values.Encode()
	full := strings.TrimRight(base, "/") + "/" + name + "?" + qs + "&checksum=" + vcBbbChecksum(algo, name, qs, secret)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, full, nil)
	if err != nil {
		return "", errors.New("ساخت درخواست بیگ‌بلوباتن ناموفق بود.")
	}
	client := &http.Client{Timeout: 8 * time.Second}
	res, err := client.Do(req)
	if err != nil {
		return "", errors.New("ارتباط با سرور بیگ‌بلوباتن برقرار نشد.")
	}
	defer res.Body.Close()
	body, err := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if err != nil {
		return "", errors.New("خواندن پاسخ بیگ‌بلوباتن ناموفق بود.")
	}
	xml := string(body)
	if !strings.Contains(xml, "<returncode>SUCCESS</returncode>") {
		msg := ""
		if m := regexp.MustCompile(`<message>([^<]*)</message>`).FindStringSubmatch(xml); len(m) > 1 {
			msg = m[1]
		}
		if msg == "" {
			msg = "پاسخ نامعتبر از سرور بیگ‌بلوباتن"
		}
		return xml, errors.New(msg)
	}
	return xml, nil
}

// vcBbbStatus ports getBbbStatus: is the meeting running and how many participants.
func (s *Service) vcBbbStatus(ctx context.Context, meetingID string) (bool, int, error) {
	xml, err := s.vcBbbCall(ctx, "isMeetingRunning", map[string]string{"meetingID": meetingID})
	if err != nil {
		return false, 0, err
	}
	if !strings.Contains(xml, "<running>true</running>") {
		return false, 0, nil
	}
	info, err := s.vcBbbCall(ctx, "getMeetingInfo", map[string]string{"meetingID": meetingID})
	if err != nil {
		return true, 0, nil
	}
	count := 0
	if m := regexp.MustCompile(`<participantCount>(\d+)</participantCount>`).FindStringSubmatch(info); len(m) > 1 {
		count, _ = strconv.Atoi(m[1])
	}
	return true, count, nil
}

// vcBbbRecording is one getRecordings entry (BbbRecording port).
type vcBbbRecording struct {
	RecordID        string
	Name            string
	StartTime       time.Time
	DurationMinutes int
	PlaybackURL     string
}

// vcBbbRecordings ports getBbbRecordings (only the fields the insert needs).
func (s *Service) vcBbbRecordings(ctx context.Context, meetingID string) ([]vcBbbRecording, error) {
	xml, err := s.vcBbbCall(ctx, "getRecordings", map[string]string{"meetingID": meetingID})
	if err != nil {
		return nil, err
	}
	out := []vcBbbRecording{}
	blocks := regexp.MustCompile(`(?s)<recording>(.*?)</recording>`).FindAllStringSubmatch(xml, -1)
	for _, b := range blocks {
		body := b[1]
		recID := ""
		if m := regexp.MustCompile(`<recordID>([^<]+)</recordID>`).FindStringSubmatch(body); len(m) > 1 {
			recID = strings.TrimSpace(m[1])
		}
		if recID == "" {
			continue
		}
		name := meetingID
		if m := regexp.MustCompile(`<name>([^<]*)</name>`).FindStringSubmatch(body); len(m) > 1 {
			name = strings.TrimSpace(m[1])
		}
		var start time.Time
		if m := regexp.MustCompile(`<startTime>(\d+)</startTime>`).FindStringSubmatch(body); len(m) > 1 {
			if ms, err := strconv.ParseInt(m[1], 10, 64); err == nil && ms > 0 {
				start = time.UnixMilli(ms)
			}
		}
		var end int64
		if m := regexp.MustCompile(`<endTime>(\d+)</endTime>`).FindStringSubmatch(body); len(m) > 1 {
			end, _ = strconv.ParseInt(m[1], 10, 64)
		}
		var startMs int64
		if !start.IsZero() {
			startMs = start.UnixMilli()
		}
		dur := 90
		if end > startMs && end-startMs > 0 {
			dur = int((end - startMs) / 60000)
		}
		if dur <= 0 {
			dur = 90
		}
		playback := ""
		if m := regexp.MustCompile(`(?s)<format>.*?<url>([^<]+)</url>`).FindStringSubmatch(body); len(m) > 1 {
			playback = strings.TrimSpace(m[1])
		}
		out = append(out, vcBbbRecording{
			RecordID: recID, Name: name, StartTime: start,
			DurationMinutes: dur, PlaybackURL: playback,
		})
	}
	return out, nil
}

// ── Sync operations ──

// SyncVirtualClassStatus ports syncVirtualClassStatusAction — refresh
// isRunning/participantCount from the BBB server for one classroom (or all).
// Returns the number of classrooms successfully synced.
func (s *Service) SyncVirtualClassStatus(ctx context.Context, user *session.User, cookie string, classroomID *int64) (int, error) {
	uniID := s.UniversityID(ctx, user, cookie)
	rows, err := s.DB.Pool.Query(ctx, `
		select vc.id, vc."bbbMeetingId"
		  from virtual_classrooms vc
		  join course_offerings o on o.id = vc."courseOfferingId"
		 where ($1::int is null or vc.id = $1::int)
		   and ($2::int is null or vc."universityId" = $2::int)`,
		classroomID, uniID)
	if err != nil {
		return 0, err
	}
	type cr struct {
		id        int64
		meetingID string
	}
	list := []cr{}
	for rows.Next() {
		var c cr
		if err := rows.Scan(&c.id, &c.meetingID); err != nil {
			rows.Close()
			return 0, err
		}
		list = append(list, c)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, err
	}

	updated := 0
	var lastErr error
	for _, c := range list {
		running, count, err := s.vcBbbStatus(ctx, c.meetingID)
		if err != nil {
			lastErr = err
			continue
		}
		_, err = s.DB.Pool.Exec(ctx, `
			update virtual_classrooms
			   set "isRunning" = $2, "currentAttendanceCount" = $3, "lastSyncedAt" = now(),
			       "lastRunningAt" = case when $2 then now() else "lastRunningAt" end
			 where id = $1`, c.id, boolInt(running), count)
		if err == nil {
			updated++
		}
	}
	if updated == 0 && lastErr != nil && len(list) > 0 {
		return 0, lastErr
	}
	return updated, nil
}

// SyncBbbRecordings ports syncBbbRecordingsAction — pull getRecordings for one
// classroom (or all) and insert recordings not stored yet. Returns the number
// of classrooms visited and the number of new recordings inserted.
func (s *Service) SyncBbbRecordings(ctx context.Context, user *session.User, cookie string, classroomID *int64) (classrooms, added int, err error) {
	uniID := s.UniversityID(ctx, user, cookie)
	rows, err := s.DB.Pool.Query(ctx, `
		select vc.id, vc."bbbMeetingId", vc."universityId"
		  from virtual_classrooms vc
		  join course_offerings o on o.id = vc."courseOfferingId"
		 where ($1::int is null or vc.id = $1::int)
		   and ($2::int is null or vc."universityId" = $2::int)`,
		classroomID, uniID)
	if err != nil {
		return 0, 0, err
	}
	type cr struct {
		id        int64
		meetingID string
		uniID     *int64
	}
	list := []cr{}
	for rows.Next() {
		var c cr
		if err := rows.Scan(&c.id, &c.meetingID, &c.uniID); err != nil {
			rows.Close()
			return 0, 0, err
		}
		list = append(list, c)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, 0, err
	}

	var lastErr error
	for _, c := range list {
		recs, err := s.vcBbbRecordings(ctx, c.meetingID)
		if err != nil {
			lastErr = err
			continue
		}
		classrooms++
		known := map[string]bool{}
		krows, err := s.DB.Pool.Query(ctx,
			`select "recordingUrl" from virtual_class_recordings where "classroomId" = $1`, c.id)
		if err == nil {
			for krows.Next() {
				var u string
				if krows.Scan(&u) == nil {
					known[u] = true
				}
			}
			krows.Close()
		}
		for _, r := range recs {
			if r.PlaybackURL == "" || known[r.PlaybackURL] {
				continue
			}
			var recordedAt any
			if r.StartTime.IsZero() {
				recordedAt = time.Now()
			} else {
				recordedAt = r.StartTime
			}
			if _, err := s.DB.Pool.Exec(ctx, `
				insert into virtual_class_recordings
				       ("classroomId","sessionTitle","recordingUrl","durationMinutes","recordedAt","viewsCount","universityId")
				values ($1,$2,$3,$4,$5,0,$6)`,
				c.id, r.Name, r.PlaybackURL, r.DurationMinutes, recordedAt, c.uniID); err != nil {
				lastErr = err
				continue
			}
			added++
		}
	}
	if classrooms == 0 && lastErr != nil && len(list) > 0 {
		return 0, 0, lastErr
	}
	return classrooms, added, nil
}
