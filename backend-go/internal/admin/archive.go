// ═══ بایگانی الکترونیک مدارک — پورت admin/archive + api/archive ═══
package admin

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"backend-go/internal/archive"
	"backend-go/internal/safeinput"
	"backend-go/internal/session"
)

// ArchiveDoc ردیف سند بایگانی.
type ArchiveDoc struct {
	ID          int64   `json:"id"`
	FileName    string  `json:"fileName"`
	MimeType    *string `json:"mimeType"`
	Status      string  `json:"status"`
	Reason      *string `json:"reason"`
	UploadedAt  *string `json:"uploadedAt"`
	Student     string  `json:"student"`
	NationalCode *string `json:"nationalCode"`
	Category    string  `json:"category"`
	DocType     string  `json:"type"`
}

// ArchiveListResponse پاسخ فهرست.
type ArchiveListResponse struct {
	Rows       []ArchiveDoc    `json:"rows"`
	Categories []OptionItem    `json:"categories"`
	Types      []ArchiveType   `json:"types"`
}

// ArchiveType نوع سند با دسته.
type ArchiveType struct {
	ID         int64   `json:"id"`
	Title      string  `json:"title"`
	CategoryID *int64  `json:"categoryId"`
}

// ListArchiveDocuments پورت صفحهٔ admin/archive.
func (s *Service) ListArchiveDocuments(ctx context.Context, user *session.User, uniCookie string) (*ArchiveListResponse, error) {
	uniID := s.UniversityID(ctx, user, uniCookie)
	resp := &ArchiveListResponse{Rows: []ArchiveDoc{}, Categories: []OptionItem{}, Types: []ArchiveType{}}
	if uniID == nil {
		return resp, nil
	}
	rows, err := s.DB.Pool.Query(ctx, `
		select d.id, coalesce(d."fileName",''), d."mimeType", coalesce(d."verificationStatus",'PENDING'),
		       d."rejectionReason", d."uploadedAt"::text,
		       coalesce(u."firstName" || ' ' || u."lastName",''), u."nationalCode",
		       coalesce(cat.title,'—'), coalesce(dt.title,'—')
		  from student_documents d
		  join users u on u.id = d."personUserId"
		  left join document_categories cat on cat.id = d."categoryId"
		  left join document_types dt on dt.id = d."typeId"
		 where (d."universityId" = $1 or d."universityId" is null)
		 order by d.id desc`, *uniID)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var d ArchiveDoc
		if err := rows.Scan(&d.ID, &d.FileName, &d.MimeType, &d.Status, &d.Reason, &d.UploadedAt,
			&d.Student, &d.NationalCode, &d.Category, &d.DocType); err == nil {
			d.Student = strings.TrimSpace(d.Student)
			resp.Rows = append(resp.Rows, d)
		}
	}
	rows.Close()

	crows, err := s.DB.Pool.Query(ctx, `
		select id, title from document_categories
		 where ("universityId" = $1 or "universityId" is null) order by title`, *uniID)
	if err == nil {
		for crows.Next() {
			var c OptionItem
			if err := crows.Scan(&c.ID, &c.Title); err == nil {
				resp.Categories = append(resp.Categories, c)
			}
		}
		crows.Close()
	}
	trows, err := s.DB.Pool.Query(ctx, `
		select id, title, "categoryId" from document_types
		 where ("universityId" = $1 or "universityId" is null) order by title`, *uniID)
	if err == nil {
		for trows.Next() {
			var t ArchiveType
			if err := trows.Scan(&t.ID, &t.Title, &t.CategoryID); err == nil {
				resp.Types = append(resp.Types, t)
			}
		}
		trows.Close()
	}
	return resp, nil
}

// VerifyArchiveDoc تأیید/رد مدرک + ممیزی زنجیره‌هش.
func (s *Service) VerifyArchiveDoc(ctx context.Context, user *session.User, uniCookie string, docID int64, decision, reason string) error {
	uniID := s.UniversityID(ctx, user, uniCookie)
	if uniID == nil {
		return errors.New("دانشگاه فعال نامشخص است")
	}
	dec := "VERIFIED"
	if decision == "REJECTED" {
		dec = "REJECTED"
	}
	var reasonVal *string
	if dec == "REJECTED" && strings.TrimSpace(reason) != "" {
		r := truncateRunes(reason, 500)
		reasonVal = &r
	}
	var docUni *int64
	if err := s.DB.Pool.QueryRow(ctx, `select "universityId" from student_documents where id = $1`, docID).Scan(&docUni); err != nil {
		return errors.New("سند یافت نشد")
	}
	if docUni != nil && *docUni != *uniID {
		return errors.New("سند متعلق به دانشگاه دیگری است")
	}
	tag, err := s.DB.Pool.Exec(ctx, `
		update student_documents set "verificationStatus" = $2, "verifiedBy" = $3, "rejectionReason" = $4
		 where id = $1 and ("universityId" = $5 or "universityId" is null)`,
		docID, dec, user.ID, reasonVal, *uniID)
	if err != nil || tag.RowsAffected() == 0 {
		return errors.New("سند یافت نشد")
	}
	details := fmt.Sprintf(`{"reason":%q}`, truncateRunes(reason, 500))
	if reasonVal == nil {
		details = `{"reason":null}`
	}
	return s.writeAdminAudit(ctx, user.ID, "ARCHIVE_DOC_"+dec, "student_documents", docID, details)
}

func truncateRunes(v string, n int) string {
	r := []rune(v)
	if len(r) <= n {
		return v
	}
	return string(r[:n])
}

// ArchiveUploadInput ورودی بارگذاری سند.
type ArchiveUploadInput struct {
	FileName      string
	ClaimedType   string
	Data          []byte
	StudentUserID int64
	CategoryID    int64
	TypeID        *int64
}

// UploadArchiveDocument پورت api/admin/archive/upload — فقط URL و هش در DB.
func (s *Service) UploadArchiveDocument(ctx context.Context, user *session.User, uniCookie string, store *archive.Store, in ArchiveUploadInput) (int64, error) {
	privileged := false
	for _, r := range user.Roles {
		if r == "ADMIN" || r == "ARCHIVE_EXPERT" {
			privileged = true
		}
	}
	if !privileged && in.StudentUserID != user.ID {
		return 0, errors.New("دسترسی غیرمجاز")
	}
	if store == nil {
		return 0, errors.New("آرشیو پیکربندی نشده است.")
	}
	var targetUni *int64
	if err := s.DB.Pool.QueryRow(ctx, `select "universityId" from users where id = $1`, in.StudentUserID).Scan(&targetUni); err != nil {
		return 0, errors.New("کاربر یافت نشد")
	}
	var docUni *int64
	if privileged {
		uniID := s.UniversityID(ctx, user, uniCookie)
		if uniID == nil {
			return 0, errors.New("دانشگاه فعال نامشخص است")
		}
		if targetUni != nil && *targetUni != *uniID {
			return 0, errors.New("کاربر متعلق به دانشگاه دیگری است")
		}
		if targetUni != nil {
			docUni = targetUni
		} else {
			docUni = uniID
		}
	}
	check := safeinput.CheckUpload(in.FileName, in.ClaimedType, in.Data)
	if !check.OK {
		return 0, errors.New(check.Error)
	}
	typeID := in.CategoryID
	if in.TypeID != nil && *in.TypeID > 0 {
		typeID = *in.TypeID
	}
	randBuf := make([]byte, 8)
	_, _ = rand.Read(randBuf)
	key := fmt.Sprintf("archive/%d/%d-%d-%s.%s", in.StudentUserID, typeID, time.Now().UnixMilli(), hex.EncodeToString(randBuf), check.Ext)
	if err := store.Put(ctx, key, check.Mime, in.Data); err != nil {
		return 0, errors.New("ذخیرهٔ فایل در بایگانی ناموفق بود")
	}
	var id int64
	if err := s.DB.Pool.QueryRow(ctx, `
		insert into student_documents ("universityId","personUserId","categoryId","typeId","fileName","fileUrl","mimeType")
		values ($1,$2,$3,$4,$5,$6,$7) returning id`,
		docUni, in.StudentUserID, in.CategoryID, in.TypeID, in.FileName, key, check.Mime).Scan(&id); err != nil {
		return 0, errors.New("ثبت سند ناموفق بود")
	}
	h := sha256.Sum256(in.Data)
	details := fmt.Sprintf(`{"key":%q,"size":%d,"sha256":%q}`, key, len(in.Data), hex.EncodeToString(h[:])[:16])
	_ = s.writeAdminAudit(ctx, user.ID, "ARCHIVE_FILE_STORED", "student_documents", id, details)
	return id, nil
}

// ArchiveDocForDownload اطلاعات لازم برای سرو فایل.
type ArchiveDocForDownload struct {
	ID           int64
	FileName     string
	MimeType     string
	Key          string
	PersonUserID int64
	UniversityID *int64
}

// GetArchiveDocForDownload بررسی دسترسی و برگرداندن شیء.
func (s *Service) GetArchiveDocForDownload(ctx context.Context, user *session.User, uniCookie string, docID int64) (*ArchiveDocForDownload, error) {
	var d ArchiveDocForDownload
	var mime, key *string
	err := s.DB.Pool.QueryRow(ctx, `
		select id, coalesce("fileName",''), "mimeType", "fileUrl", "personUserId", "universityId"
		  from student_documents where id = $1`, docID).
		Scan(&d.ID, &d.FileName, &mime, &key, &d.PersonUserID, &d.UniversityID)
	if err != nil {
		return nil, errors.New("سند یافت نشد")
	}
	privileged := false
	for _, r := range user.Roles {
		if r == "ADMIN" || r == "ARCHIVE_EXPERT" {
			privileged = true
		}
	}
	if !privileged && d.PersonUserID != user.ID {
		return nil, errors.New("دسترسی غیرمجاز")
	}
	if privileged && d.PersonUserID != user.ID {
		uniID := s.UniversityID(ctx, user, uniCookie)
		if uniID == nil {
			return nil, errors.New("دانشگاه فعال نامشخص است")
		}
		if d.UniversityID == nil {
			// سند بدون دانشگاه: فقط حساب پلتفرمی (نقش ADMIN با دسترسی سراسری)
			allowed := false
			for _, r := range user.Roles {
				if r == "ADMIN" {
					allowed = true
				}
			}
			if !allowed {
				return nil, errors.New("دسترسی غیرمجاز")
			}
		} else if *d.UniversityID != *uniID {
			return nil, errors.New("دسترسی غیرمجاز")
		}
	}
	if key != nil {
		d.Key = *key
	}
	if mime != nil {
		d.MimeType = *mime
	}
	return &d, nil
}
