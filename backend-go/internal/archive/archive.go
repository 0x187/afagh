// ═══ آرشیو شیء (MinIO/S3) — برای پیوست درخواست‌ها و اسناد ═══
package archive

import (
	"bytes"
	"context"
	"errors"
	"net/url"
	"strings"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

// Store دسترسی به باکت آرشیو.
type Store struct {
	Client *minio.Client
	Bucket string
}

// New ساخت اتصال از پیکربندی S3.
func New(endpoint, access, secret, bucket string) (*Store, error) {
	endpoint = strings.TrimSpace(endpoint)
	bucket = strings.TrimSpace(bucket)
	if endpoint == "" || bucket == "" {
		return nil, errors.New("آرشیو پیکربندی نشده است.")
	}
	secure := false
	host := endpoint
	if u, err := url.Parse(endpoint); err == nil && u.Host != "" {
		host = u.Host
		secure = u.Scheme == "https"
	}
	client, err := minio.New(host, &minio.Options{
		Creds:  credentials.NewStaticV4(access, secret, ""),
		Secure: secure,
	})
	if err != nil {
		return nil, err
	}
	return &Store{Client: client, Bucket: bucket}, nil
}

// Put ذخیرهٔ شیء با نوع محتوا.
func (s *Store) Put(ctx context.Context, key, mime string, data []byte) error {
	if s == nil || s.Client == nil {
		return errors.New("آرشیو پیکربندی نشده است.")
	}
	_, err := s.Client.PutObject(ctx, s.Bucket, key, bytes.NewReader(data), int64(len(data)),
		minio.PutObjectOptions{ContentType: mime})
	return err
}
