// ═══ Equivalent course clusters — actions/equivalence-clusters port ═══
package admin

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"backend-go/internal/session"
)

// EquivCluster cluster.
type EquivCluster struct {
	ID               int64  `json:"id"`
	ClusterTitle     string `json:"clusterTitle"`
	IsGeneralService int    `json:"isGeneralService"`
	UniversityID     *int64 `json:"universityId"`
}

// EquivCourse course for cluster membership.
type EquivCourse struct {
	ID        int64   `json:"id"`
	Code      string  `json:"code"`
	Title     string  `json:"title"`
	Units     float64 `json:"units"`
	ClusterID *int64  `json:"clusterId"`
}

// EquivalenceClustersData page initial payload.
type EquivalenceClustersData struct {
	Clusters []EquivCluster `json:"clusters"`
	Courses  []EquivCourse  `json:"courses"`
}

func validateClusterTitle(raw string) (string, error) {
	title := strings.TrimSpace(raw)
	if title == "" || len([]rune(title)) > 100 {
		return "", errors.New("عنوان خوشه الزامی است (حداکثر ۱۰۰ نویسه).")
	}
	return title, nil
}

func clusterVisible(uniID int64, rowUni *int64) bool {
	return rowUni == nil || *rowUni == uniID
}

// EquivalenceClusters list the university's clusters and courses.
func (s *Service) EquivalenceClusters(ctx context.Context, user *session.User, cookie string) (*EquivalenceClustersData, error) {
	uniID := s.UniversityID(ctx, user, cookie)
	out := &EquivalenceClustersData{Clusters: []EquivCluster{}, Courses: []EquivCourse{}}
	if uniID == nil {
		return out, nil
	}
	rows, err := s.DB.Pool.Query(ctx, `
		select id, "clusterTitle", coalesce("isGeneralService",0), "universityId"
		  from equivalence_clusters
		 where "universityId" = $1 or "universityId" is null
		 order by "clusterTitle"`, *uniID)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var c EquivCluster
		if err := rows.Scan(&c.ID, &c.ClusterTitle, &c.IsGeneralService, &c.UniversityID); err == nil {
			out.Clusters = append(out.Clusters, c)
		}
	}
	rows.Close()
	crows, err := s.DB.Pool.Query(ctx, `
		select id, code, title, coalesce(units,0)::float8, "clusterId"
		  from courses where "universityId" = $1 order by code`, *uniID)
	if err != nil {
		return nil, err
	}
	for crows.Next() {
		var c EquivCourse
		if err := crows.Scan(&c.ID, &c.Code, &c.Title, &c.Units, &c.ClusterID); err == nil {
			out.Courses = append(out.Courses, c)
		}
	}
	crows.Close()
	return out, nil
}

// CreateEquivCluster create a cluster.
func (s *Service) CreateEquivCluster(ctx context.Context, user *session.User, cookie, title string, general bool) (int64, error) {
	uniID := s.UniversityID(ctx, user, cookie)
	if uniID == nil {
		return 0, errors.New("دانشگاه فعال نامشخص است.")
	}
	t, err := validateClusterTitle(title)
	if err != nil {
		return 0, err
	}
	var dup int
	if err := s.DB.Pool.QueryRow(ctx, `
		select 1 from equivalence_clusters
		 where "clusterTitle" = $1 and ("universityId" = $2 or "universityId" is null) limit 1`, t, *uniID).Scan(&dup); err == nil {
		return 0, errors.New("خوشه‌ای با همین عنوان از قبل وجود دارد.")
	}
	generalInt := 0
	if general {
		generalInt = 1
	}
	tx, err := s.DB.Pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)
	var id int64
	if err := tx.QueryRow(ctx, `
		insert into equivalence_clusters ("clusterTitle","isGeneralService","universityId")
		values ($1,$2,$3) returning id`, t, generalInt, *uniID).Scan(&id); err != nil {
		return 0, err
	}
	if err := s.writeAdminAuditTx(ctx, tx, user.ID, "EQUIV_CLUSTER_CREATED", "equivalence_clusters", id,
		fmt.Sprintf(`{"clusterTitle":%s}`, jsonQuote(t))); err != nil {
		return 0, err
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return id, nil
}

// UpdateEquivCluster edit a cluster.
func (s *Service) UpdateEquivCluster(ctx context.Context, user *session.User, cookie string, id int64, title *string, general *bool) error {
	uniID := s.UniversityID(ctx, user, cookie)
	if uniID == nil {
		return errors.New("دانشگاه فعال نامشخص است.")
	}
	var rowUni *int64
	if err := s.DB.Pool.QueryRow(ctx, `select "universityId" from equivalence_clusters where id = $1`, id).Scan(&rowUni); err != nil {
		return errors.New("خوشه یافت نشد.")
	}
	if !clusterVisible(*uniID, rowUni) {
		return errors.New("این خوشه در دامنهٔ دانشگاه شما نیست.")
	}
	sets := []string{}
	args := []any{}
	if title != nil {
		t, err := validateClusterTitle(*title)
		if err != nil {
			return err
		}
		var dup int
		if err := s.DB.Pool.QueryRow(ctx, `
			select 1 from equivalence_clusters
			 where "clusterTitle" = $1 and id <> $2 and ("universityId" = $3 or "universityId" is null) limit 1`,
			t, id, *uniID).Scan(&dup); err == nil {
			return errors.New("خوشه‌ای با همین عنوان از قبل وجود دارد.")
		}
		args = append(args, t)
		sets = append(sets, `"clusterTitle" = $`+fmt.Sprint(len(args)))
	}
	if general != nil {
		v := 0
		if *general {
			v = 1
		}
		args = append(args, v)
		sets = append(sets, `"isGeneralService" = $`+fmt.Sprint(len(args)))
	}
	if len(sets) == 0 {
		return nil
	}
	args = append(args, id)
	tx, err := s.DB.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `update equivalence_clusters set `+strings.Join(sets, ", ")+` where id = $`+fmt.Sprint(len(args)), args...); err != nil {
		return err
	}
	if err := s.writeAdminAuditTx(ctx, tx, user.ID, "EQUIV_CLUSTER_UPDATED", "equivalence_clusters", id,
		`{"fields":`+jsonQuote(strings.Join(sets, ","))+`}`); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// DeleteEquivCluster delete a cluster and detach its courses.
func (s *Service) DeleteEquivCluster(ctx context.Context, user *session.User, cookie string, id int64) error {
	uniID := s.UniversityID(ctx, user, cookie)
	if uniID == nil {
		return errors.New("دانشگاه فعال نامشخص است.")
	}
	var rowUni *int64
	var title string
	if err := s.DB.Pool.QueryRow(ctx, `select "universityId", "clusterTitle" from equivalence_clusters where id = $1`, id).Scan(&rowUni, &title); err != nil {
		return errors.New("خوشه یافت نشد.")
	}
	if !clusterVisible(*uniID, rowUni) {
		return errors.New("این خوشه در دامنهٔ دانشگاه شما نیست.")
	}
	tx, err := s.DB.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	tag, err := tx.Exec(ctx, `update courses set "clusterId" = null where "clusterId" = $1 and "universityId" = $2`, id, *uniID)
	if err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `delete from equivalence_clusters where id = $1`, id); err != nil {
		return err
	}
	details := fmt.Sprintf(`{"clusterTitle":%s,"detached":%d}`, jsonQuote(title), tag.RowsAffected())
	if err := s.writeAdminAuditTx(ctx, tx, user.ID, "EQUIV_CLUSTER_DELETED", "equivalence_clusters", id, details); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// SetEquivClusterMembers set cluster members (detach the rest).
func (s *Service) SetEquivClusterMembers(ctx context.Context, user *session.User, cookie string, clusterID int64, courseIDs []int64) error {
	uniID := s.UniversityID(ctx, user, cookie)
	if uniID == nil {
		return errors.New("دانشگاه فعال نامشخص است.")
	}
	var rowUni *int64
	if err := s.DB.Pool.QueryRow(ctx, `select "universityId" from equivalence_clusters where id = $1`, clusterID).Scan(&rowUni); err != nil {
		return errors.New("خوشه یافت نشد.")
	}
	if !clusterVisible(*uniID, rowUni) {
		return errors.New("این خوشه در دامنهٔ دانشگاه شما نیست.")
	}
	ids := uniquePositiveIDs(courseIDs)
	if len(ids) > 0 {
		var count int
		if err := s.DB.Pool.QueryRow(ctx, `
			select count(*)::int from courses where id = any($1) and "universityId" = $2`, ids, *uniID).Scan(&count); err != nil {
			return err
		}
		if count != len(ids) {
			return errors.New("برخی دروس انتخاب‌شده در دامنهٔ دانشگاه شما نیستند.")
		}
	}
	tx, err := s.DB.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if len(ids) > 0 {
		if _, err := tx.Exec(ctx, `
			update courses set "clusterId" = null
			 where "clusterId" = $1 and "universityId" = $2 and not (id = any($3))`, clusterID, *uniID, ids); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `update courses set "clusterId" = $1 where id = any($2)`, clusterID, ids); err != nil {
			return err
		}
	} else {
		if _, err := tx.Exec(ctx, `update courses set "clusterId" = null where "clusterId" = $1 and "universityId" = $2`, clusterID, *uniID); err != nil {
			return err
		}
	}
	if err := s.writeAdminAuditTx(ctx, tx, user.ID, "EQUIV_CLUSTER_MEMBERS_SET", "equivalence_clusters", clusterID,
		fmt.Sprintf(`{"courseIds":%s}`, jsonIntArray(ids))); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
