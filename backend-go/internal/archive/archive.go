// ═══ Object archive (MinIO/S3) — for request attachments and documents ═══
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

// Store provides access to the archive bucket.
type Store struct {
	Client *minio.Client
	Bucket string
}

// New creates a connection from the S3 configuration.
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

// Put stores an object with its content type.
func (s *Store) Put(ctx context.Context, key, mime string, data []byte) error {
	if s == nil || s.Client == nil {
		return errors.New("آرشیو پیکربندی نشده است.")
	}
	_, err := s.Client.PutObject(ctx, s.Bucket, key, bytes.NewReader(data), int64(len(data)),
		minio.PutObjectOptions{ContentType: mime})
	return err
}

// Get reads an object (key) from the bucket.
func (s *Store) Get(ctx context.Context, key string) ([]byte, string, error) {
	if s == nil || s.Client == nil {
		return nil, "", errors.New("آرشیو پیکربندی نشده است.")
	}
	obj, err := s.Client.GetObject(ctx, s.Bucket, key, minio.GetObjectOptions{})
	if err != nil {
		return nil, "", err
	}
	defer obj.Close()
	info, err := obj.Stat()
	if err != nil {
		return nil, "", err
	}
	buf := bytes.NewBuffer(nil)
	if _, err := buf.ReadFrom(obj); err != nil {
		return nil, "", err
	}
	return buf.Bytes(), info.ContentType, nil
}
