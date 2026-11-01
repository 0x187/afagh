// ═══ Thesis defense scheduling desk — admin/defense-scheduling port ═══
package admin

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"backend-go/internal/session"
)

// DefenseJury jury member names.
type DefenseJury struct {
	Chair      *string `json:"chair"`
	Supervisor *string `json:"supervisor"`
	Internal   *string `json:"internal"`
	External   *string `json:"external"`
}

// DefensePoolPreview preview of the selected pool.
type DefensePoolPreview struct {
	ID             int64   `json:"id"`
	DepartmentCode string  `json:"departmentCode"`
	RoomName       *string `json:"roomName"`
	Chair          *string `json:"chair"`
	Internal       *string `json:"internal"`
	External       *string `json:"external"`
}

// DefenseBoardRow defense case row.
type DefenseBoardRow struct {
	AuditID               int64               `json:"auditId"`
	ThesisProgressID      int64               `json:"thesisProgressId"`
	WorkflowStatus        string              `json:"workflowStatus"`
	ProposalStatus        *string             `json:"proposalStatus"`
	ProposalSimilarity    *float64            `json:"proposalSimilarity"`
	IrandocUploadStatus   *string             `json:"irandocUploadStatus"`
	IrandocUploadTracking *string             `json:"irandocUploadTracking"`
	DefenseRequestStatus  *string             `json:"defenseRequestStatus"`
	DefenseScheduledAt    *string             `json:"defenseScheduledAt"`
	DefenseConductedAt    *string             `json:"defenseConductedAt"`
	DefenseResult         *string             `json:"defenseResult"`
	DefenseNote           *string             `json:"defenseNote"`
	FinalIrandocStatus    *string             `json:"finalIrandocStatus"`
	NextProgressReportDue *string             `json:"nextProgressReportDue"`
	TitleFa               *string             `json:"titleFa"`
	SupervisorID          *int64              `json:"supervisorId"`
	SupervisorName        *string             `json:"supervisorName"`
	SupervisorUserID      *int64              `json:"supervisorUserId"`
	StudentID             int64               `json:"studentId"`
	StudentCode           string              `json:"studentCode"`
	FullName              string              `json:"fullName"`
	MajorName             *string             `json:"majorName"`
	MajorID               *int64              `json:"majorId"`
	RoomName              *string             `json:"roomName"`
	SessionStatus         *string             `json:"sessionStatus"`
	SessionResult         *string             `json:"sessionResult"`
	Jury                  DefenseJury         `json:"jury"`
	Pool                  *DefensePoolPreview `json:"pool"`
}

// DefenseBoardGroup group by proposal status.
type DefenseBoardGroup struct {
	Status string            `json:"status"`
	Rows   []DefenseBoardRow `json:"rows"`
}

// DefensePoolRow jury pool.
type DefensePoolRow struct {
	ID             int64   `json:"id"`
	DepartmentCode string  `json:"departmentCode"`
	MajorID        *int64  `json:"majorId"`
	MajorName      *string `json:"majorName"`
	ChairID        *int64  `json:"chairId"`
	InternalIDs    []int64 `json:"internalIds"`
	ExternalIDs    []int64 `json:"externalIds"`
	RoomID         *int64  `json:"roomId"`
	RoomName       *string `json:"roomName"`
	IsActive       bool    `json:"isActive"`
}

// DefenseBoard desk response.
type DefenseBoard struct {
	Groups        []DefenseBoardGroup `json:"groups"`
	Pools         []DefensePoolRow    `json:"pools"`
	Rooms         []map[string]any    `json:"rooms"`
	StaffOptions  []map[string]any    `json:"staffOptions"`
	Majors        []map[string]any    `json:"majors"`
	Departments   []map[string]any    `json:"departments"`
	CurrentUserID int64               `json:"currentUserId"`
	CanManage     bool                `json:"canManage"`
}

var defenseExpertRoles = map[string]bool{"ADMIN": true, "EDU_EXPERT": true, "GRADUATION_EXPERT": true}
var defenseBoardRoles = map[string]bool{"ADMIN": true, "EDU_EXPERT": true, "GRADUATION_EXPERT": true, "DEP_HEAD": true, "PROFESSOR": true}

func defenseCanManage(user *session.User) bool {
	for _, r := range user.Roles {
		if defenseExpertRoles[r] {
			return true
		}
	}
	return false
}

func defenseAllowed(user *session.User) bool {
	for _, r := range user.Roles {
		if defenseBoardRoles[r] {
			return true
		}
	}
	return false
}

func tsPtr(t *time.Time) *string {
	if t == nil {
		return nil
	}
	v := t.UTC().Format(time.RFC3339)
	return &v
}

// DefenseBoardData defense desk load.
func (s *Service) DefenseBoardData(ctx context.Context, user *session.User, cookie string) (*DefenseBoard, error) {
	if !defenseAllowed(user) {
		return nil, errors.New("دسترسی ندارید.")
	}
	uniID := s.UniversityID(ctx, user, cookie)
	if uniID == nil {
		return nil, errors.New("دانشگاه فعال نامشخص است.")
	}
	canManage := defenseCanManage(user)

	type staffRow struct {
		ID     int64
		UserID int64
		Name   string
		Rank   string
	}
	staffRows := []staffRow{}
	staffByID := map[int64]staffRow{}
	if rows, err := s.DB.Pool.Query(ctx, `
		select st.id, st."userId", (u."firstName" || ' ' || u."lastName"),
		       coalesce(st."academicRank", st."staffType", '')
		  from staff st join users u on u.id = st."userId"
		 where st."universityId" = $1 or st."universityId" is null order by u."lastName"`, *uniID); err == nil {
		for rows.Next() {
			var r staffRow
			if err := rows.Scan(&r.ID, &r.UserID, &r.Name, &r.Rank); err == nil {
				staffRows = append(staffRows, r)
				staffByID[r.ID] = r
			}
		}
		rows.Close()
	}
	nameOf := func(id *int64) *string {
		if id == nil {
			return nil
		}
		if r, ok := staffByID[*id]; ok {
			v := r.Name
			return &v
		}
		return nil
	}
	roomRows := []map[string]any{}
	roomName := map[int64]string{}
	if rows, err := s.DB.Pool.Query(ctx, `
		select id, name, coalesce(capacity,0) from classrooms
		 where "universityId" = $1 or "universityId" is null order by name`, *uniID); err == nil {
		for rows.Next() {
			var id int64
			var name string
			var cap int
			if err := rows.Scan(&id, &name, &cap); err == nil {
				roomName[id] = name
				roomRows = append(roomRows, map[string]any{"id": id, "name": name, "capacity": cap})
			}
		}
		rows.Close()
	}
	roomOf := func(id *int64) *string {
		if id == nil {
			return nil
		}
		if v, ok := roomName[*id]; ok {
			return &v
		}
		return nil
	}
	majorRows := []map[string]any{}
	majorName := map[int64]string{}
	if rows, err := s.DB.Pool.Query(ctx, `
		select id, name from majors where "universityId" = $1 or "universityId" is null order by name`, *uniID); err == nil {
		for rows.Next() {
			var id int64
			var name string
			if err := rows.Scan(&id, &name); err == nil {
				majorName[id] = name
				majorRows = append(majorRows, map[string]any{"id": id, "name": name})
			}
		}
		rows.Close()
	}
	majorNameOf := func(id *int64) *string {
		if id == nil {
			return nil
		}
		if v, ok := majorName[*id]; ok {
			return &v
		}
		return nil
	}
	deptRows := []map[string]any{}
	if rows, err := s.DB.Pool.Query(ctx, `
		select "departmentCode", name from departments
		 where ("universityId" = $1 or "universityId" is null) and "departmentCode" is not null
		 order by name`, *uniID); err == nil {
		for rows.Next() {
			var code, name string
			if err := rows.Scan(&code, &name); err == nil {
				deptRows = append(deptRows, map[string]any{"code": code, "name": name})
			}
		}
		rows.Close()
	}

	// Pools
	pools := []DefensePoolRow{}
	prs, err := s.DB.Pool.Query(ctx, `
		select id, "departmentCode", "majorId", "chairId", "internalIds", "externalIds", "roomId", coalesce("isActive",1)
		  from defense_jury_pools where "universityId" = $1 or "universityId" is null order by id`, *uniID)
	if err != nil {
		return nil, err
	}
	for prs.Next() {
		var p DefensePoolRow
		var active int
		if err := prs.Scan(&p.ID, &p.DepartmentCode, &p.MajorID, &p.ChairID, &p.InternalIDs, &p.ExternalIDs, &p.RoomID, &active); err == nil {
			p.IsActive = active != 0
			p.MajorName = majorNameOf(p.MajorID)
			p.RoomName = roomOf(p.RoomID)
			if p.InternalIDs == nil {
				p.InternalIDs = []int64{}
			}
			if p.ExternalIDs == nil {
				p.ExternalIDs = []int64{}
			}
			pools = append(pools, p)
		}
	}
	prs.Close()
	pickPool := func(majorID *int64) *DefensePoolRow {
		active := []DefensePoolRow{}
		for _, p := range pools {
			if p.IsActive {
				active = append(active, p)
			}
		}
		best := func(list []DefensePoolRow) *DefensePoolRow {
			for i := range list {
				if list[i].RoomID != nil {
					return &list[i]
				}
			}
			if len(list) > 0 {
				return &list[0]
			}
			return nil
		}
		if majorID != nil {
			scoped := []DefensePoolRow{}
			for _, p := range active {
				if p.MajorID != nil && *p.MajorID == *majorID {
					scoped = append(scoped, p)
				}
			}
			if b := best(scoped); b != nil {
				return b
			}
		}
		generic := []DefensePoolRow{}
		for _, p := range active {
			if p.MajorID == nil {
				generic = append(generic, p)
			}
		}
		return best(generic)
	}

	// Case rows
	type tpRow struct {
		AuditID, TPID, StudentID int64
		Workflow                 string
		ProposalStatus           *string
		ProposalSimilarity       *float64
		IrandocUploadStatus      *string
		IrandocTracking          *string
		DefenseRequestStatus     *string
		DefenseScheduledAt       *time.Time
		DefenseConductedAt       *time.Time
		DefenseResult            *string
		DefenseNote              *string
		FinalIrandocStatus       *string
		NextReportDue            *time.Time
		TitleFa                  *string
		SupervisorID             *int64
		DefenseRoomID            *int64
		StudentCode, First, Last string
		MajorID                  *int64
	}
	list := []tpRow{}
	rows, err := s.DB.Pool.Query(ctx, `
		select a.id, tp.id, tp."studentId", a."workflowStatus",
		       tp."proposalStatus", tp."proposalSimilarity"::float8, tp."irandocUploadStatus",
		       tp."irandocUploadTracking", tp."defenseRequestStatus", tp."defenseScheduledAt",
		       tp."defenseConductedAt", tp."defenseResult", tp."defenseNote", tp."finalIrandocStatus",
		       tp."nextProgressReportDue", tp."titleFa", tp."supervisorId", tp."defenseRoomId",
		       st."studentCode", coalesce(su."firstName",''), coalesce(su."lastName",''), st."majorId"
		  from thesis_progress tp
		  join graduation_audits a on a.id = tp."auditId"
		  join students st on st.id = tp."studentId"
		  join users su on su.id = st."userId"
		 where (coalesce(tp."proposalStatus",'NOT_STARTED') <> 'NOT_STARTED'
		        or coalesce(tp."defenseRequestStatus",'NOT_REQUESTED') <> 'NOT_REQUESTED')
		   and (st."universityId" = $1 or st."universityId" is null)
		 order by tp."updatedAt" desc`, *uniID)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var r tpRow
		if err := rows.Scan(&r.AuditID, &r.TPID, &r.StudentID, &r.Workflow,
			&r.ProposalStatus, &r.ProposalSimilarity, &r.IrandocUploadStatus,
			&r.IrandocTracking, &r.DefenseRequestStatus, &r.DefenseScheduledAt,
			&r.DefenseConductedAt, &r.DefenseResult, &r.DefenseNote, &r.FinalIrandocStatus,
			&r.NextReportDue, &r.TitleFa, &r.SupervisorID, &r.DefenseRoomID,
			&r.StudentCode, &r.First, &r.Last, &r.MajorID); err == nil {
			list = append(list, r)
		}
	}
	rows.Close()

	// Sessions
	type sess struct {
		TPID                          int64
		RoomID, ChairID, SupervisorID *int64
		InternalID, ExternalID        *int64
		Status, Result                *string
	}
	sessions := map[int64]sess{}
	if len(list) > 0 {
		ids := []int64{}
		for _, r := range list {
			ids = append(ids, r.TPID)
		}
		srs, err := s.DB.Pool.Query(ctx, `
			select "thesisProgressId", "roomId", "chairId", "supervisorId", "internalId", "externalId", status, result
			  from defense_sessions where "thesisProgressId" = any($1)`, ids)
		if err == nil {
			for srs.Next() {
				var x sess
				if err := srs.Scan(&x.TPID, &x.RoomID, &x.ChairID, &x.SupervisorID, &x.InternalID, &x.ExternalID, &x.Status, &x.Result); err == nil {
					sessions[x.TPID] = x
				}
			}
			srs.Close()
		}
	}

	boardRows := []DefenseBoardRow{}
	for _, r := range list {
		sess := sessions[r.TPID]
		var supUserID *int64
		if r.SupervisorID != nil {
			if st, ok := staffByID[*r.SupervisorID]; ok {
				v := st.UserID
				supUserID = &v
			}
		}
		pool := pickPool(r.MajorID)
		roomID := r.DefenseRoomID
		if roomID == nil && sess.RoomID != nil {
			roomID = sess.RoomID
		}
		row := DefenseBoardRow{
			AuditID: r.AuditID, ThesisProgressID: r.TPID, WorkflowStatus: r.Workflow,
			ProposalStatus: r.ProposalStatus, ProposalSimilarity: r.ProposalSimilarity,
			IrandocUploadStatus: r.IrandocUploadStatus, IrandocUploadTracking: r.IrandocTracking,
			DefenseRequestStatus: r.DefenseRequestStatus,
			DefenseScheduledAt:   tsPtr(r.DefenseScheduledAt), DefenseConductedAt: tsPtr(r.DefenseConductedAt),
			DefenseResult: r.DefenseResult, DefenseNote: r.DefenseNote,
			FinalIrandocStatus: r.FinalIrandocStatus, NextProgressReportDue: tsPtr(r.NextReportDue),
			TitleFa: r.TitleFa, SupervisorID: r.SupervisorID, SupervisorName: nameOf(r.SupervisorID),
			SupervisorUserID: supUserID, StudentID: r.StudentID, StudentCode: r.StudentCode,
			FullName: strings.TrimSpace(r.First + " " + r.Last), MajorName: majorNameOf(r.MajorID),
			MajorID: r.MajorID, RoomName: roomOf(roomID), SessionStatus: sess.Status, SessionResult: sess.Result,
			Jury: DefenseJury{
				Chair: nameOf(sess.ChairID), Supervisor: nameOf(sess.SupervisorID),
				Internal: nameOf(sess.InternalID), External: nameOf(sess.ExternalID),
			},
		}
		if pool != nil {
			var firstInternal, firstExternal *int64
			if len(pool.InternalIDs) > 0 {
				v := pool.InternalIDs[0]
				firstInternal = &v
			}
			if len(pool.ExternalIDs) > 0 {
				v := pool.ExternalIDs[0]
				firstExternal = &v
			}
			row.Pool = &DefensePoolPreview{
				ID: pool.ID, DepartmentCode: pool.DepartmentCode, RoomName: pool.RoomName,
				Chair: nameOf(pool.ChairID), Internal: nameOf(firstInternal), External: nameOf(firstExternal),
			}
		}
		boardRows = append(boardRows, row)
	}
	visible := boardRows
	if !canManage {
		filtered := []DefenseBoardRow{}
		for _, r := range boardRows {
			if r.SupervisorUserID != nil && *r.SupervisorUserID == user.ID {
				filtered = append(filtered, r)
			}
		}
		visible = filtered
	}
	order := []string{"SIMILARITY_PASSED", "SIMILARITY_HIGH", "EXPERT_REVIEW", "REJECTED", "PRIOR_REJECTED", "APPROVED"}
	orderOf := func(s string) int {
		for i, v := range order {
			if v == s {
				return i
			}
		}
		return len(order)
	}
	byStatus := map[string][]DefenseBoardRow{}
	for _, r := range visible {
		key := "NOT_STARTED"
		if r.ProposalStatus != nil {
			key = *r.ProposalStatus
		}
		byStatus[key] = append(byStatus[key], r)
	}
	keys := []string{}
	for k := range byStatus {
		keys = append(keys, k)
	}
	sort.SliceStable(keys, func(i, j int) bool {
		oi, oj := orderOf(keys[i]), orderOf(keys[j])
		if oi != oj {
			return oi < oj
		}
		return keys[i] < keys[j]
	})
	groups := []DefenseBoardGroup{}
	for _, k := range keys {
		groups = append(groups, DefenseBoardGroup{Status: k, Rows: byStatus[k]})
	}

	board := &DefenseBoard{Groups: groups, Pools: []DefensePoolRow{}, Rooms: []map[string]any{},
		StaffOptions: []map[string]any{}, Majors: []map[string]any{}, Departments: []map[string]any{},
		CurrentUserID: user.ID, CanManage: canManage}
	if canManage {
		board.Pools = pools
		board.Rooms = roomRows
		board.Majors = majorRows
		board.Departments = deptRows
		for _, st := range staffRows {
			board.StaffOptions = append(board.StaffOptions, map[string]any{"id": st.ID, "name": st.Name, "rank": st.Rank})
		}
	}
	return board, nil
}

func (s *Service) defenseAuditInUni(ctx context.Context, user *session.User, cookie string, auditID int64) error {
	uniID := s.UniversityID(ctx, user, cookie)
	if uniID == nil {
		return errors.New("دانشگاه فعال نامشخص است.")
	}
	var auditUni, stuUni *int64
	if err := s.DB.Pool.QueryRow(ctx, `
		select a."universityId", st."universityId" from graduation_audits a
		  left join students st on st.id = a."studentId" where a.id = $1`, auditID).Scan(&auditUni, &stuUni); err != nil {
		return errors.New("پرونده یافت نشد.")
	}
	owner := auditUni
	if owner == nil {
		owner = stuUni
	}
	if owner != nil && *owner != *uniID {
		return errors.New("پرونده متعلق به دانشگاه دیگری است.")
	}
	return nil
}

// ApproveProposal approve the proposal + record the IranDoc upload tracking code.
func (s *Service) ApproveProposal(ctx context.Context, user *session.User, cookie string, auditID int64, tracking string) error {
	if err := s.defenseAuditInUni(ctx, user, cookie, auditID); err != nil {
		return err
	}
	code := strings.TrimSpace(tracking)
	if len([]rune(code)) < 4 {
		return errors.New("کد رهگیری ایرانداک را کامل وارد کنید.")
	}
	var status *string
	if err := s.DB.Pool.QueryRow(ctx, `select "proposalStatus" from thesis_progress where "auditId" = $1 limit 1`, auditID).Scan(&status); err != nil {
		return errors.New("پروندهٔ پایان‌نامه یافت نشد.")
	}
	if status == nil || (*status != "SIMILARITY_PASSED" && *status != "EXPERT_REVIEW") {
		return errors.New("پروپوزال در وضعیت قابل تأیید نیست")
	}
	_, err := s.DB.Pool.Exec(ctx, `
		update thesis_progress set "proposalStatus" = 'APPROVED', "proposalApprovedAt" = now(),
		       "proposalApprovedBy" = $2, "irandocUploadTracking" = $3,
		       "irandocUploadStatus" = 'UPLOADED', "irandocUploadedAt" = now(), "updatedAt" = now()
		 where "auditId" = $1`, auditID, user.ID, code)
	return err
}

// SupervisorApproveDefense supervisor approves/rejects the defense request.
func (s *Service) SupervisorApproveDefense(ctx context.Context, user *session.User, cookie string, auditID int64, approved bool) error {
	if err := s.defenseAuditInUni(ctx, user, cookie, auditID); err != nil {
		return err
	}
	var staffID int64
	if err := s.DB.Pool.QueryRow(ctx, `select id from staff where "userId" = $1 limit 1`, user.ID).Scan(&staffID); err != nil {
		return errors.New("پروندهٔ کارکنانی برای این حساب یافت نشد؛ تأیید دفاع فقط از سوی استاد راهنما ممکن است.")
	}
	var supervisorID *int64
	var status *string
	if err := s.DB.Pool.QueryRow(ctx, `select "supervisorId", "defenseRequestStatus" from thesis_progress where "auditId" = $1 limit 1`, auditID).
		Scan(&supervisorID, &status); err != nil {
		return errors.New("پروندهٔ پایان‌نامه یافت نشد.")
	}
	if status == nil || *status != "SUPERVISOR_REVIEW" {
		return errors.New("درخواست دفاع در مرحله بررسی راهنما نیست")
	}
	if supervisorID == nil || *supervisorID != staffID {
		return errors.New("تنها استاد راهنما می‌تواند تأیید کند")
	}
	next := "SUPERVISOR_REJECTED"
	if approved {
		next = "EXPERT_REVIEW"
	}
	_, err := s.DB.Pool.Exec(ctx, `
		update thesis_progress set "defenseRequestStatus" = $2, "updatedAt" = now() where "auditId" = $1`, auditID, next)
	return err
}

// ScheduleDefenseTime set the defense time with automatic pool/room selection.
func (s *Service) ScheduleDefenseTime(ctx context.Context, user *session.User, cookie string, auditID int64, at time.Time) error {
	if err := s.defenseAuditInUni(ctx, user, cookie, auditID); err != nil {
		return err
	}
	if at.Before(time.Now().Add(-time.Minute)) {
		return errors.New("زمان دفاع نمی‌تواند در گذشته باشد.")
	}
	uniID := s.UniversityID(ctx, user, cookie)
	if uniID == nil {
		return errors.New("دانشگاه فعال نامشخص است.")
	}
	var status *string
	var studentID int64
	var supervisorID *int64
	var tpID int64
	var majorID *int64
	if err := s.DB.Pool.QueryRow(ctx, `
		select tp.id, tp."studentId", tp."supervisorId", tp."defenseRequestStatus", st."majorId"
		  from thesis_progress tp join students st on st.id = tp."studentId"
		 where tp."auditId" = $1 limit 1`, auditID).
		Scan(&tpID, &studentID, &supervisorID, &status, &majorID); err != nil {
		return errors.New("پروندهٔ پایان‌نامه یافت نشد.")
	}
	if status == nil || *status != "EXPERT_REVIEW" {
		return errors.New("درخواست دفاع در مرحله بررسی کارشناس نیست")
	}
	// Pool
	type pool struct {
		ID                  int64
		ChairID, RoomID     *int64
		InternalIDs, Extern []int64
	}
	pick := func() *pool {
		rows, err := s.DB.Pool.Query(ctx, `
			select id, "chairId", "roomId", "internalIds", "externalIds" from defense_jury_pools
			 where coalesce("isActive",1) = 1 and ("universityId" = $1 or "universityId" is null)`, *uniID)
		if err != nil {
			return nil
		}
		defer rows.Close()
		all := []pool{}
		for rows.Next() {
			var p pool
			if err := rows.Scan(&p.ID, &p.ChairID, &p.RoomID, &p.InternalIDs, &p.Extern); err == nil {
				all = append(all, p)
			}
		}
		for _, p := range all {
			if p.RoomID != nil && majorID != nil {
				var mid *int64
				_ = s.DB.Pool.QueryRow(ctx, `select "majorId" from defense_jury_pools where id = $1`, p.ID).Scan(&mid)
				if mid != nil && *mid == *majorID {
					return &p
				}
			}
		}
		for _, p := range all {
			if p.RoomID != nil {
				return &p
			}
		}
		if len(all) > 0 {
			return &all[0]
		}
		return nil
	}
	p := pick()
	var roomID *int64
	if p != nil && p.RoomID != nil {
		var exists int
		if err := s.DB.Pool.QueryRow(ctx, `select 1 from classrooms where id = $1`, *p.RoomID).Scan(&exists); err == nil {
			roomID = p.RoomID
		}
	}
	if roomID == nil {
		var facultyID *int64
		if majorID != nil {
			_ = s.DB.Pool.QueryRow(ctx, `select "facultyId" from majors where id = $1`, *majorID).Scan(&facultyID)
		}
		if facultyID != nil {
			_ = s.DB.Pool.QueryRow(ctx, `
				select id from classrooms where "facultyId" = $1 order by capacity desc, name limit 1`, *facultyID).Scan(&roomID)
		}
		if roomID == nil {
			_ = s.DB.Pool.QueryRow(ctx, `
				select id from classrooms where "facultyId" is null order by capacity desc, name limit 1`).Scan(&roomID)
		}
		if roomID == nil {
			_ = s.DB.Pool.QueryRow(ctx, `select id from classrooms order by capacity desc, name limit 1`).Scan(&roomID)
		}
	}
	var chairID, internalID, externalID *int64
	if p != nil {
		chairID = p.ChairID
		if len(p.InternalIDs) > 0 {
			v := p.InternalIDs[0]
			internalID = &v
		}
		if len(p.Extern) > 0 {
			v := p.Extern[0]
			externalID = &v
		}
	}
	tx, err := s.DB.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `
		update thesis_progress set "defenseRequestStatus" = 'SCHEDULED', "defenseScheduledAt" = $2,
		       "defenseRoomId" = $3, "juryChairId" = $4, "jurySupervisorId" = $5,
		       "juryInternalId" = $6, "juryExternalId" = $7, "updatedAt" = now()
		 where "auditId" = $1`, auditID, at.UTC(), roomID, chairID, supervisorID, internalID, externalID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		insert into defense_sessions ("thesisProgressId","studentId","scheduledAt","roomId","chairId",
		  "supervisorId","internalId","externalId",status,"universityId")
		values ($1,$2,$3,$4,$5,$6,$7,$8,'SCHEDULED',$9)
		on conflict ("thesisProgressId") do update set "scheduledAt" = excluded."scheduledAt",
		  "roomId" = excluded."roomId", "chairId" = excluded."chairId",
		  "supervisorId" = excluded."supervisorId", "internalId" = excluded."internalId",
		  "externalId" = excluded."externalId", status = 'SCHEDULED'`,
		tpID, studentID, at.UTC(), roomID, chairID, supervisorID, internalID, externalID, *uniID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// RecordDefenseResult record the defense result.
func (s *Service) RecordDefenseResult(ctx context.Context, user *session.User, cookie string, auditID int64, result, minutes string, at time.Time) error {
	if err := s.defenseAuditInUni(ctx, user, cookie, auditID); err != nil {
		return err
	}
	if result != "PASSED" && result != "FAILED" && result != "CONDITIONAL" {
		return errors.New("نتیجهٔ دفاع نامعتبر است.")
	}
	var tpID int64
	if err := s.DB.Pool.QueryRow(ctx, `select id from thesis_progress where "auditId" = $1 limit 1`, auditID).Scan(&tpID); err != nil {
		return errors.New("پروندهٔ پایان‌نامه یافت نشد.")
	}
	status := "PASSED"
	if result != "PASSED" {
		status = "FAILED"
	}
	var note any
	if strings.TrimSpace(minutes) != "" {
		note = strings.TrimSpace(minutes)
	}
	tx, err := s.DB.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `
		update thesis_progress set "defenseRequestStatus" = $2, "defenseConductedAt" = $3,
		       "defenseResult" = $4, "defenseNote" = $5, "updatedAt" = now() where id = $1`,
		tpID, status, at.UTC(), result, note); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		update defense_sessions set status = 'CONDUCTED', result = $2, minutes = $3
		 where "thesisProgressId" = $1`, tpID, result, note); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// DefensePoolInput jury pool input.
type DefensePoolInput struct {
	ID             *int64 `json:"id"`
	DepartmentCode string `json:"departmentCode"`
	MajorID        *int64 `json:"majorId"`
	ChairID        *int64 `json:"chairId"`
	InternalIDs    string `json:"internalIds"`
	ExternalIDs    string `json:"externalIds"`
	RoomID         *int64 `json:"roomId"`
	IsActive       *bool  `json:"isActive"`
}

func csvIDs(v string) []int64 {
	out := []int64{}
	seen := map[int64]bool{}
	for _, part := range strings.FieldsFunc(v, func(r rune) bool {
		return r == ',' || r == '،' || r == ' ' || r == '\t' || r == '\n'
	}) {
		if n, err := strconv.ParseInt(part, 10, 64); err == nil && n > 0 && !seen[n] {
			seen[n] = true
			out = append(out, n)
		}
	}
	return out
}

// SaveDefensePool create/edit a jury pool.
func (s *Service) SaveDefensePool(ctx context.Context, user *session.User, cookie string, in DefensePoolInput) error {
	uniID := s.UniversityID(ctx, user, cookie)
	if uniID == nil {
		return errors.New("دانشگاه فعال نامشخص است.")
	}
	code := strings.ToUpper(strings.TrimSpace(in.DepartmentCode))
	if code == "" || len([]rune(code)) > 40 {
		return errors.New("کد دپارتمان الزامی است (حداکثر ۴۰ نویسه).")
	}
	active := 1
	if in.IsActive != nil && !*in.IsActive {
		active = 0
	}
	if in.ID != nil && *in.ID > 0 {
		var rowUni *int64
		if err := s.DB.Pool.QueryRow(ctx, `select "universityId" from defense_jury_pools where id = $1`, *in.ID).Scan(&rowUni); err != nil {
			return errors.New("استخر یافت نشد.")
		}
		if rowUni != nil && *rowUni != *uniID {
			return errors.New("استخر متعلق به دانشگاه دیگری است.")
		}
		_, err := s.DB.Pool.Exec(ctx, `
			update defense_jury_pools set "departmentCode" = $2, "majorId" = $3, "chairId" = $4,
			       "internalIds" = $5, "externalIds" = $6, "roomId" = $7, "isActive" = $8
			 where id = $1`,
			*in.ID, code, in.MajorID, in.ChairID, csvIDs(in.InternalIDs), csvIDs(in.ExternalIDs), in.RoomID, active)
		return err
	}
	_, err := s.DB.Pool.Exec(ctx, `
		insert into defense_jury_pools ("universityId","departmentCode","majorId","chairId","internalIds","externalIds","roomId","isActive")
		values ($1,$2,$3,$4,$5,$6,$7,$8)`,
		*uniID, code, in.MajorID, in.ChairID, csvIDs(in.InternalIDs), csvIDs(in.ExternalIDs), in.RoomID, active)
	return err
}

// ToggleDefensePool enable/disable a pool.
func (s *Service) ToggleDefensePool(ctx context.Context, user *session.User, cookie string, id int64, active bool) error {
	uniID := s.UniversityID(ctx, user, cookie)
	if uniID == nil {
		return errors.New("دانشگاه فعال نامشخص است.")
	}
	var rowUni *int64
	if err := s.DB.Pool.QueryRow(ctx, `select "universityId" from defense_jury_pools where id = $1`, id).Scan(&rowUni); err != nil {
		return errors.New("استخر یافت نشد.")
	}
	if rowUni != nil && *rowUni != *uniID {
		return errors.New("استخر متعلق به دانشگاه دیگری است.")
	}
	v := 0
	if active {
		v = 1
	}
	_, err := s.DB.Pool.Exec(ctx, `update defense_jury_pools set "isActive" = $2 where id = $1`, id, v)
	return err
}

var _ = fmt.Sprint
