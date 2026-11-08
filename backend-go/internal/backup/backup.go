// ═══ Backup / Disaster Recovery — port of afagh-next backup feature ═══
//
// Port of the Next.js backup stack (src/lib/backup-signing.ts, backup-schema.ts,
// backup-dump.ts, backup-job-store.ts and the admin/settings backup actions):
//
//   - Streaming SQL dump: one REPEATABLE READ READ ONLY snapshot transaction,
//     full DDL from the Postgres catalogs, then per-table server-side cursors
//     (DECLARE/FETCH) whose rows are INSERT literals built by Postgres itself
//     (quote_nullable), gzip (level 1) straight to /tmp/backups/<jobId>.sql.gz.
//     No pg_dump binary is needed (the Go container has none).
//   - HMAC-SHA256 signature, computed incrementally on the same bytes written
//     to the file, with a key derived from AFAGH_PII_KEY (or an explicit
//     AFAGH_BACKUP_SIGNING_KEY). Byte-compatible with the reference format:
//     <body>\n-- AFAGH_BACKUP_SIGNATURE=<hex64>\n
//     so the existing verify/restore scripts keep working.
//   - Background jobs with jobId + in-memory registry (single binary, so no
//     Redis layer like the Next version; jobs are lost on restart but the
//     files on disk survive).
//   - MinIO file backup: recursive object listing + per-object GET streamed
//     into a .tar.gz bundle (next to the SQL dump).
//
// Honesty note on the output: the dump emits plain, ordered SQL (DDL pre,
// INSERT data, constraints/indexes/RLS/grants/setval post). It is restored
// with `gunzip -c file.sql.gz | psql -U afagh -d afagh_db` — no psql
// meta-commands, no custom binary format.
package backup

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"hash"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

// ── Constants (identical to the reference for file-format compatibility) ──

const (
	// Format is the dump format marker written into the manifest.
	Format = "afagh-dr/1"
	// DrModeMarker marks a full structural (DR) dump.
	DrModeMarker = "-- AFAGH_BACKUP_MODE=dr-schema"
	// SignatureMarker precedes the hex signature on the last line of the file.
	SignatureMarker = "-- AFAGH_BACKUP_SIGNATURE="
	// SigningDomain separates the derived key from the raw PII key.
	SigningDomain = "afagh/backup/signature/v1"
	// RestoreCommand is the documented psql restore pipeline.
	RestoreCommand = "gunzip -c backup.sql.gz | psql -U afagh -d afagh_db"

	// piiKeyEnv / signingKeyEnv hold the signing key sources. Only the names
	// are duplicated here; the value is never logged or written to a dump.
	piiKeyEnv     = "AFAGH_PII_KEY"
	signingKeyEnv = "AFAGH_BACKUP_SIGNING_KEY"

	// fetchSize rows per FETCH — fewer round-trips on the ~1GB production DB.
	fetchSize = 2000
	// jobTTL: how long finished/failed jobs stay in the in-memory registry.
	jobTTL = 6 * time.Hour
	// fileTTL: dump files older than this are deleted on the next start.
	fileTTL = 24 * time.Hour

	// Redacted replaces live secrets in the default (sanitized) dump.
	Redacted = "[REDACTED]"
	// RedactedJSON is the jsonb-safe replacement value.
	RedactedJSON = `{"redacted":true}`

	// backupPrefix holds backups inside the archive bucket; it is skipped when
	// bundling objects (otherwise backups would include themselves).
	backupPrefix = "afagh-backup/"
)

// ExcludedSchemas never enter a dump (raw-PII temp backups).
var ExcludedSchemas = []string{"pii_backups"}

// RestoreGuide is the Persian recovery checklist written into the dump header.
var RestoreGuide = []string{
	"راهنمای بازیابی کامل (Disaster Recovery):",
	"  ۱) یک دیتابیس کاملاً تازه بسازید؛ این فایل اسکیمای public/drizzle را پاک و بازسازی میکند.",
	"  ۲) " + RestoreCommand,
	"  ۳) مقادیر .env (بهویژه AFAGH_PII_KEY و AFAGH_BACKUP_SIGNING_KEY) را از خزانهٔ اسرار سازمان برگردانید.",
	"  ۴) بستهٔ files-*.tar.gz را در باکت آرشیو (MinIO) استخراج کنید و اپ/مهاجر را بالا بیاورید.",
	"  ۵) درستی امضا پیش از بازیابی را از پنل (دکمهٔ تأیید امضا) یا با اسکریپت verify بررسی کنید.",
	"توجه: اسکیمای pii_backups (پشتیبانهای موقت حاوی PII خام) عمداً خارج از بکاپ است.",
	"توجه: هش رمزهای عبور حفظ میشود ⇒ پس از بازیابی لاگین کاربران برقرار است.",
	"      رازهای زنده (توکنها، OTP، کلید درگاهها، PAN کارت) در حالت پیشفرض [REDACTED]اند؛",
	"      برای بازیابی صددرصدی آنها بکاپ «کامل» تهیه کنید.",
}

// ── Signing keys ────────────────────────────────────────────────────────────

// SigningKeys returns every valid signing key of this deployment, best first:
// an explicit AFAGH_BACKUP_SIGNING_KEY wins over the key derived from
// AFAGH_PII_KEY (HMAC-SHA256 with domain separation, same derivation as the
// reference). Old dumps stay verifiable across key rotation because callers
// verifying signatures try all candidates. nil = nothing configured.
func SigningKeys() [][]byte {
	var out [][]byte
	if k := strings.TrimSpace(os.Getenv(signingKeyEnv)); len(k) >= 32 && !strings.HasPrefix(k, "CHANGE_ME_") {
		out = append(out, []byte(k))
	}
	if p := strings.TrimSpace(os.Getenv(piiKeyEnv)); len(p) >= 32 {
		mac := hmac.New(sha256.New, []byte(p))
		_, _ = mac.Write([]byte(SigningDomain))
		derived := mac.Sum(nil)
		dup := false
		for _, k := range out {
			if bytes.Equal(k, derived) {
				dup = true
			}
		}
		if !dup {
			out = append(out, derived)
		}
	}
	return out
}

// signingKey is the primary (first) key — used for signing.
func signingKey() ([]byte, error) {
	keys := SigningKeys()
	if len(keys) == 0 {
		return nil, ErrNoSigningKey
	}
	return keys[0], nil
}

// Sentinel verification errors — messages are Persian and go to the UI as-is.
var (
	ErrNoSigningKey     = errors.New("کلید امضای پشتیبان تنظیم نشده است؛ بازیابی امن غیرفعال است.")
	ErrBadID            = errors.New("شناسهٔ کار نامعتبر است.")
	ErrNotFound         = errors.New("کار پشتیبانگیری یافت نشد یا منقضی شده است؛ دوباره تلاش کنید.")
	ErrNotReady         = errors.New("پشتیبان هنوز آماده نیست؛ تا پایان کار منتظر بمانید.")
	ErrMissingSignature = errors.New("پشتیبان امضای معتبر ندارد؛ بازیابی فایلهای قدیمی و امضانشده مجاز نیست.")
	ErrBadSignature     = errors.New("امضای پشتیبان معتبر نیست؛ هیچ دستوری اجرا نشد.")
)

// ── Job registry ────────────────────────────────────────────────────────────

// Status / Kind of a background backup job.
type Status string

const (
	StatusRunning Status = "running"
	StatusDone    Status = "done"
	StatusFailed  Status = "failed"
)

// Kind distinguishes SQL dumps from object bundles.
type Kind string

const (
	KindDatabase Kind = "db"
	KindFiles    Kind = "files"
)

// Job is the public (copied) view of a background job.
type Job struct {
	ID             string    `json:"id"`
	Kind           Kind      `json:"kind"`
	StartedAt      time.Time `json:"startedAt"`
	IncludeSecrets bool      `json:"includeSecrets"`
	Status         Status    `json:"status"`

	// Database dumps.
	Tables     int `json:"tables,omitempty"`
	TablesDone int `json:"tablesDone,omitempty"`

	// MinIO object bundles.
	Objects     int `json:"objects,omitempty"`
	ObjectsDone int `json:"objectsDone,omitempty"`

	Size      int64  `json:"size,omitempty"`
	Sha256    string `json:"sha256,omitempty"`
	Signature string `json:"signature,omitempty"`
	Error     string `json:"error,omitempty"`

	// File is the on-disk artifact path; internal, never serialized to the UI.
	File string `json:"-"`
}

// Service owns the job registry, dump directory and the optional MinIO client
// configuration. Build it once per process and pass it to httpapi.BackupAPI.
type Service struct {
	Pool *pgxpool.Pool

	// Dir stores the .sql.gz / .tar.gz artifacts (default /tmp/backups).
	Dir string

	// MinIO/S3 configuration for the file (object bundle) backup. Mirrors the
	// envs used by internal/archive: S3_ENDPOINT / S3_BUCKET / S3_ACCESS_KEY /
	// S3_SECRET_KEY. Leave empty to disable file backups.
	S3Endpoint  string
	S3Bucket    string
	S3AccessKey string
	S3SecretKey string

	mu   sync.Mutex
	jobs map[string]*Job
}

// New creates a backup service. dir falls back to /tmp/backups.
func New(pool *pgxpool.Pool, dir string) *Service {
	if strings.TrimSpace(dir) == "" {
		dir = "/tmp/backups"
	}
	return &Service{Pool: pool, Dir: dir, jobs: make(map[string]*Job)}
}

var jobIDRe = regexp.MustCompile(`^[a-f0-9]{32}$`)

// newJob registers a fresh running job and prunes expired ones.
func (s *Service) newJob(kind Kind, includeSecrets bool) (*Job, error) {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return nil, err
	}
	id := hex.EncodeToString(buf)
	if err := os.MkdirAll(s.Dir, 0o700); err != nil {
		return nil, fmt.Errorf("ساخت پوشۀ پشتیبان ناموفق بود: %w", err)
	}
	s.pruneLocked()
	job := &Job{
		ID:             id,
		Kind:           kind,
		StartedAt:      time.Now(),
		IncludeSecrets: includeSecrets,
		Status:         StatusRunning,
	}
	s.jobs[id] = job
	s.removeOldFiles()
	return job, nil
}

func (s *Service) pruneLocked() {
	now := time.Now()
	for id, j := range s.jobs {
		if now.Sub(j.StartedAt) > jobTTL {
			delete(s.jobs, id)
		}
	}
}

// removeOldFiles deletes artifacts older than fileTTL (best effort).
func (s *Service) removeOldFiles() {
	entries, err := os.ReadDir(s.Dir)
	if err != nil {
		return
	}
	cutoff := time.Now().Add(-fileTTL)
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		name := e.Name()
		if !(strings.HasSuffix(name, ".sql.gz") || strings.HasSuffix(name, ".tar.gz")) {
			continue
		}
		if info, err := e.Info(); err == nil && info.ModTime().Before(cutoff) {
			_ = os.Remove(filepath.Join(s.Dir, name))
		}
	}
}

// JobStatus returns a copy of one job, or ErrNotFound / ErrBadID.
func (s *Service) JobStatus(jobID string) (*Job, error) {
	if !jobIDRe.MatchString(jobID) {
		return nil, ErrBadID
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	j, ok := s.jobs[jobID]
	if !ok {
		return nil, ErrNotFound
	}
	cp := *j
	return &cp, nil
}

// ListJobs returns all known jobs, newest first.
func (s *Service) ListJobs() []Job {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]Job, 0, len(s.jobs))
	for _, j := range s.jobs {
		out = append(out, *j)
	}
	sort.Slice(out, func(i, k int) bool { return out[i].StartedAt.After(out[k].StartedAt) })
	return out
}

// Options for StartDump.
type Options struct {
	// IncludeFiles additionally launches a companion MinIO object bundle job;
	// its id is returned by StartDump as the second value.
	IncludeFiles bool
	// IncludeSecrets disables secret redaction (full backup).
	IncludeSecrets bool
}

// Default is the process-wide service used by the package-level convenience
// functions (StartDump, JobStatus, …). The HTTP layer wires a *Service from
// the app graph instead; both paths share the same API.
var Default = New(nil, "")

// StartDump launches the database dump in a background goroutine (detached
// from the request context) and returns the jobId immediately. When
// opts.IncludeFiles is set it also starts a MinIO bundle job and returns that
// id as the second value ("" when skipped). Package-level form: the pool is
// remembered on Default so callers do not need to hold a Service.
func StartDump(ctx context.Context, pool *pgxpool.Pool, opts Options) (string, string, error) {
	Default.mu.Lock()
	if Default.Pool == nil {
		Default.Pool = pool
	}
	Default.mu.Unlock()
	return Default.StartDump(ctx, opts)
}

// StartDump (method form) — see the package-level function of the same name.
func (s *Service) StartDump(ctx context.Context, opts Options) (string, string, error) {
	job, err := s.newJob(KindDatabase, opts.IncludeSecrets)
	if err != nil {
		return "", "", err
	}
	var filesID string
	if opts.IncludeFiles {
		if fid, ferr := s.StartFileBackup(ctx); ferr == nil {
			filesID = fid
		}
	}
	go s.runDump(job)
	_ = ctx // work is detached via context.WithoutCancel inside runDump
	return job.ID, filesID, nil
}

// StartFileBackup launches only the MinIO object bundle job.
func (s *Service) StartFileBackup(_ context.Context) (string, error) {
	job, err := s.newJob(KindFiles, false)
	if err != nil {
		return "", err
	}
	go s.runFiles(job)
	return job.ID, nil
}

// Package-level delegation to Default (see StartDump).
func StartFileBackup(ctx context.Context) (string, error) { return Default.StartFileBackup(ctx) }

// Package-level delegation to Default.
func JobStatus(jobID string) (*Job, error) { return Default.JobStatus(jobID) }

// Package-level delegation to Default.
func ListJobs() []Job { return Default.ListJobs() }

func (s *Service) fail(job *Job, err error) {
	s.mu.Lock()
	job.Status = StatusFailed
	job.Error = err.Error()
	s.mu.Unlock()
}

func (s *Service) finish(job *Job, path string, size int64, sum, sig string) {
	s.mu.Lock()
	job.Status = StatusDone
	job.File = path
	job.Size = size
	job.Sha256 = sum
	job.Signature = sig
	s.mu.Unlock()
}

// ── Signed body writer (port of SignedBodyWriter) ───────────────────────────

// signedWriter hashes and writes the dump body incrementally, holding back the
// trailing newline run so the final file is exactly:
//
//	<body without trailing newlines>\n-- AFAGH_BACKUP_SIGNATURE=<hex>\n
//
// This keeps the bytes identical to the reference writer (verify regex safe).
type signedWriter struct {
	w       io.Writer
	mac     hash.Hash
	pending []byte
}

func newSignedWriter(w io.Writer, key []byte) *signedWriter {
	return &signedWriter{w: w, mac: hmac.New(sha256.New, key)}
}

func (sw *signedWriter) push(b []byte) error {
	sw.pending = append(sw.pending, b...)
	end := len(sw.pending)
	for end > 0 && (sw.pending[end-1] == '\n' || sw.pending[end-1] == '\r') {
		end--
	}
	if end > 0 {
		body := sw.pending[:end]
		if _, err := sw.w.Write(body); err != nil {
			return err
		}
		_, _ = sw.mac.Write(body)
	}
	tail := make([]byte, len(sw.pending)-end)
	copy(tail, sw.pending[end:])
	sw.pending = tail
	return nil
}

// finish discards the held trailing newlines and appends the signature line.
func (sw *signedWriter) finish() (string, error) {
	line := "\n" + SignatureMarker + hex.EncodeToString(sw.mac.Sum(nil)) + "\n"
	if _, err := io.WriteString(sw.w, line); err != nil {
		return "", err
	}
	return strings.TrimSpace(line[1:]), nil
}

// ── SQL helpers ─────────────────────────────────────────────────────────────

// quoteIdent / quoteLiteral — names and literals never come from user input,
// only from the catalogs, but they are still quoted defensively.
func qi(s string) string { return `"` + strings.ReplaceAll(s, `"`, `""`) + `"` }
func ql(s string) string { return `'` + strings.ReplaceAll(s, `'`, `''`) + `'` }

// ── Redaction rules (port of backup-dump.ts RULES) ──────────────────────────
//
// users.passwordHash is deliberately NOT redacted: without it nobody can log
// in after a DR restore. Live, abusable secrets (tokens, OTPs, gateway keys,
// card PANs) are redacted instead; a "full" backup skips all rules.

type redactRule struct {
	column      string
	replacement string
	needs       []string
	cond        string // empty = always
}

var redactRules = map[string][]redactRule{
	"system_settings": {
		{column: "value", replacement: ql(Redacted), needs: []string{"key"}, cond: `"key" ~* 'SECRET|TOKEN|KEY|PASSWORD'`},
	},
	"notification_deliveries": {
		{column: "body", replacement: ql(Redacted), needs: []string{"eventCode"}, cond: `"eventCode" ~* 'OTP'`},
	},
	"notifications": {
		{column: "payload", replacement: ql(Redacted), needs: []string{"eventCode"}, cond: `"eventCode" ~* 'OTP'`},
	},
	"verification_otps": {
		{column: "otpCode", replacement: ql(Redacted)},
		{column: "otpHash", replacement: ql(Redacted)},
	},
	"instructor_deliveries": {
		{column: "pickupToken", replacement: ql(Redacted)},
	},
	"student_cards": {
		{column: "secureToken", replacement: ql(Redacted)},
	},
	"integrations_config": {
		{column: "authCredentials", replacement: ql(Redacted)},
	},
	"api_audit_logs": {
		{column: "requestPayload", replacement: ql(Redacted)},
	},
	"grade_submission_otps": {{column: "otpHash", replacement: ql(Redacted)}},
	"signature_otps":        {{column: "otpHash", replacement: ql(Redacted)}},
	"doc_sign_otps":         {{column: "otpHash", replacement: ql(Redacted)}},
	"document_signatures":   {{column: "otpUsed", replacement: ql(Redacted)}},
	"messenger_link_tokens": {
		{column: "tokenHash", replacement: ql(Redacted)},
		{column: "codeHash", replacement: ql(Redacted)},
	},
	"samin_connections": {
		{column: "clientSecretEnc", replacement: ql(Redacted)},
		{column: "passwordEnc", replacement: ql(Redacted)},
		{column: "tokenEnc", replacement: ql(Redacted)},
	},
	"payment_gateways": {{column: "config", replacement: ql(RedactedJSON)}},
	"pos_terminals":    {{column: "config", replacement: ql(RedactedJSON)}},
	"payment_transactions": {
		// authority is uniquely indexed ⇒ per-row value, not a constant.
		{column: "authority", replacement: `'[REDACTED]#' || "id"::text`, needs: []string{"id"}, cond: "true"},
		{column: "bankRefId", replacement: ql(Redacted)},
		{column: "cardPan", replacement: ql(Redacted)},
		{column: "payerMobile", replacement: ql(Redacted)},
		{column: "payerEmail", replacement: ql(Redacted)},
	},
}

// buildRowLiteralSQL builds the SQL expression that turns a row into
// `(v1, v2, …)` using Postgres-side quote_nullable (port of buildRowLiteralSql).
func buildRowLiteralSQL(schema, table string, columns []string, redact bool) string {
	var rules []redactRule
	if redact && schema == "public" {
		rules = redactRules[table]
	}
	parts := make([]string, 0, len(columns))
	for _, col := range columns {
		var rule *redactRule
		for i := range rules {
			r := &rules[i]
			if r.column != col {
				continue
			}
			ok := true
			for _, n := range r.needs {
				if !contains(columns, n) {
					ok = false
					break
				}
			}
			if ok {
				rule = r
				break
			}
		}
		plain := "quote_nullable(" + qi(col) + "::text)"
		if rule == nil {
			parts = append(parts, plain)
			continue
		}
		replacement := "(" + rule.replacement + ")::text"
		if rule.cond == "" {
			parts = append(parts, "quote_nullable("+replacement+")")
			continue
		}
		parts = append(parts,
			"quote_nullable(CASE WHEN "+rule.cond+" THEN "+replacement+" ELSE "+qi(col)+"::text END)")
	}
	if len(parts) == 0 {
		return "'()'"
	}
	return `'(' || ` + strings.Join(parts, ` || ', ' || `) + ` || ')'`
}

func contains(list []string, v string) bool {
	for _, s := range list {
		if s == v {
			return true
		}
	}
	return false
}

func insertHead(schema, table string, columns []string, identityAlways bool) string {
	cols := make([]string, len(columns))
	for i, c := range columns {
		cols[i] = qi(c)
	}
	head := "INSERT INTO " + qi(schema) + "." + qi(table) + " (" + strings.Join(cols, ", ") + ") "
	if identityAlways {
		head += "OVERRIDING SYSTEM VALUE "
	}
	return head + "VALUES\n"
}

// ── Catalog snapshot (port of backup-schema.ts buildSchemaDump) ─────────────

type dataTable struct {
	schema         string
	name           string
	insertColumns  []string
	identityAlways bool
}

type aclRow struct {
	schema, name, kind, col string
	granteeOID              int64
	grantee                 string
	priv                    string
}

type groupedGrant struct {
	schema, name, kind, col, grantee string
	privs                            []string
}

func groupGrants(rows []aclRow) []groupedGrant {
	type key struct{ schema, name, kind, col, grantee string }
	less := func(a, b key) bool {
		if a.schema != b.schema {
			return a.schema < b.schema
		}
		if a.name != b.name {
			return a.name < b.name
		}
		if a.kind != b.kind {
			return a.kind < b.kind
		}
		if a.col != b.col {
			return a.col < b.col
		}
		return a.grantee < b.grantee
	}
	m := map[key]*groupedGrant{}
	var order []key
	for _, r := range rows {
		g := r.grantee
		if r.granteeOID == 0 {
			g = "PUBLIC"
		}
		if g == "" {
			continue
		}
		k := key{r.schema, r.name, r.kind, r.col, g}
		gg, ok := m[k]
		if !ok {
			gg = &groupedGrant{schema: r.schema, name: r.name, kind: r.kind, col: r.col, grantee: g}
			m[k] = gg
			order = append(order, k)
		}
		gg.privs = append(gg.privs, r.priv)
	}
	sort.Slice(order, func(i, j int) bool { return less(order[i], order[j]) })
	out := make([]groupedGrant, 0, len(order))
	for _, k := range order {
		gg := m[k]
		sort.Strings(gg.privs)
		out = append(out, *gg)
	}
	return out
}

func granteeSQL(g string) string {
	if g == "PUBLIC" {
		return "PUBLIC"
	}
	return qi(g)
}

// ── The dump itself ─────────────────────────────────────────────────────────

func (s *Service) runDump(job *Job) {
	defer func() {
		if r := recover(); r != nil {
			s.fail(job, fmt.Errorf("دامپ ناموفق بود: %v", r))
		}
	}()
	ctx := context.WithoutCancel(context.Background())

	conn, err := s.Pool.Acquire(ctx)
	if err != nil {
		s.fail(job, fmt.Errorf("اتصال به دیتابیس ناموفق بود: %w", err))
		return
	}
	defer conn.Release()

	// Snapshot transaction: DDL and data come from exactly one instant.
	if _, err := conn.Exec(ctx, "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"); err != nil {
		s.fail(job, fmt.Errorf("شروع تراکنش اسنپشات ناموفق بود: %w", err))
		return
	}
	committed := false
	defer func() {
		if !committed {
			_, _ = conn.Exec(context.WithoutCancel(context.Background()), "ROLLBACK")
		}
	}()
	// Empty search_path ⇒ pg_get_* always emit schema-qualified names.
	if _, err := conn.Exec(ctx, "SELECT pg_catalog.set_config('search_path', '', false)"); err != nil {
		s.fail(job, err)
		return
	}

	pre, post, dataTables, manifest, err := buildDumpParts(ctx, conn)
	if err != nil {
		s.fail(job, err)
		return
	}
	s.mu.Lock()
	job.Tables = len(dataTables)
	s.mu.Unlock()

	// Output chain: signedWriter → gzip(level 1) → sha256 → temp file.
	key, err := signingKey()
	if err != nil {
		s.fail(job, err)
		return
	}
	path := filepath.Join(s.Dir, job.ID+".sql.gz")
	tmp := path + ".part"
	f, err := os.Create(tmp)
	if err != nil {
		s.fail(job, err)
		return
	}
	sum := sha256.New()
	gz, err := gzip.NewWriterLevel(io.MultiWriter(f, sum), gzip.BestSpeed)
	if err != nil {
		_ = f.Close()
		s.fail(job, err)
		return
	}
	sw := newSignedWriter(gz, key)
	var signature string

	writeErr := func() error {
		now := time.Now().UTC().Format(time.RFC3339)
		meta := map[string]any{
			"format": Format, "generatedAt": now, "manifest": manifest,
			"excludedSchemas": ExcludedSchemas,
			"redacted":        !job.IncludeSecrets, "restoreCommand": RestoreCommand,
		}
		metaJSON, _ := json.Marshal(meta)
		lines := []string{
			"-- ═══ پشتیبان آفاق — " + now + " ═══\n",
			DrModeMarker + "\n",
			"-- AFAGH_BACKUP_REDACTED=" + map[bool]string{true: "true", false: "false"}[!job.IncludeSecrets] + "\n",
			"-- AFAGH_BACKUP_MANIFEST=" + string(metaJSON) + "\n",
		}
		for _, l := range lines {
			if err := sw.push([]byte(l)); err != nil {
				return err
			}
		}
		for _, g := range RestoreGuide {
			if err := sw.push([]byte("-- " + g + "\n")); err != nil {
				return err
			}
		}
		if err := sw.push([]byte("\n-- ═══ بخش ۱/۳: ساختار (اسکیما، sequenceها، جدولها) ═══\n\n")); err != nil {
			return err
		}
		if err := sw.push([]byte(pre)); err != nil {
			return err
		}
		if err := sw.push([]byte("\n-- ═══ بخش ۲/۳: دادهها ═══\n\n")); err != nil {
			return err
		}
		for i, t := range dataTables {
			if err := s.dumpTableData(ctx, conn, sw, t, job.IncludeSecrets); err != nil {
				return err
			}
			s.mu.Lock()
			job.TablesDone = i + 1
			s.mu.Unlock()
		}
		if err := sw.push([]byte("\n-- ═══ بخش ۳/۳: قیود، ایندکسها، RLS، GRANTها، setval ═══\n\n")); err != nil {
			return err
		}
		if err := sw.push([]byte(post)); err != nil {
			return err
		}
		sig, err := sw.finish()
		if err != nil {
			return err
		}
		signature = sig
		return nil
	}()

	if err := gz.Close(); err != nil && writeErr == nil {
		writeErr = err
	}
	if err := f.Sync(); err != nil && writeErr == nil {
		writeErr = err
	}
	if err := f.Close(); err != nil && writeErr == nil {
		writeErr = err
	}
	if writeErr != nil {
		_ = os.Remove(tmp)
		s.fail(job, writeErr)
		return
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		s.fail(job, err)
		return
	}
	if _, err := conn.Exec(ctx, "COMMIT"); err == nil {
		committed = true
	}
	info, _ := os.Stat(path)
	var size int64
	if info != nil {
		size = info.Size()
	}
	s.finish(job, path, size, hex.EncodeToString(sum.Sum(nil)), signature)
}

// dumpTableData streams one table through a server-side cursor.
func (s *Service) dumpTableData(ctx context.Context, conn *pgxpool.Conn, sw *signedWriter, t dataTable, redact bool) error {
	tableRef := qi(t.schema) + "." + qi(t.name)
	expr := buildRowLiteralSQL(t.schema, t.name, t.insertColumns, redact)
	if _, err := conn.Exec(ctx,
		fmt.Sprintf(`DECLARE afagh_bk_cursor CURSOR FOR SELECT %s AS "__afagh_row_literal" FROM %s`, expr, tableRef)); err != nil {
		return fmt.Errorf("declare cursor %s: %w", t.name, err)
	}
	head := insertHead(t.schema, t.name, t.insertColumns, t.identityAlways)
	for {
		rows, err := conn.Query(ctx, fmt.Sprintf(`FETCH %d FROM afagh_bk_cursor`, fetchSize))
		if err != nil {
			_, _ = conn.Exec(ctx, "CLOSE afagh_bk_cursor")
			return fmt.Errorf("fetch %s: %w", t.name, err)
		}
		vals := make([]string, 0, fetchSize)
		for rows.Next() {
			var v string
			if err := rows.Scan(&v); err != nil {
				rows.Close()
				_, _ = conn.Exec(ctx, "CLOSE afagh_bk_cursor")
				return err
			}
			vals = append(vals, v)
		}
		rows.Err()
		rows.Close()
		if len(vals) == 0 {
			break
		}
		if err := sw.push([]byte(head + strings.Join(vals, ",\n") + ";\n")); err != nil {
			_, _ = conn.Exec(ctx, "CLOSE afagh_bk_cursor")
			return err
		}
	}
	_, _ = conn.Exec(ctx, "CLOSE afagh_bk_cursor")
	return nil
}

// buildDumpParts renders the pre (structure) and post (constraints/…) sections
// from the catalogs, plus the list of data tables. Direct port of
// buildSchemaDump; column/ACL grants of rarely used shapes are included, and
// anything unsupported is listed in the manifest for honesty.
func buildDumpParts(ctx context.Context, conn *pgxpool.Conn) (
	pre, post string, dataTables []dataTable, manifest map[string]any, err error,
) {
	q := func(sql string, args ...any) (pgx.Rows, error) { return conn.Query(ctx, sql, args...) }

	var preLines, postLines []string

	// Server version.
	var serverVersion string
	if err := conn.QueryRow(ctx, "SELECT current_setting('server_version')").Scan(&serverVersion); err != nil {
		return "", "", nil, nil, err
	}

	// Schemas.
	var schemas []string
	{
		rows, err := q(`SELECT nspname FROM pg_namespace
			WHERE nspname !~ '^pg_' AND nspname <> 'information_schema'
			  AND nspname <> ALL ($1::text[]) ORDER BY nspname`, ExcludedSchemas)
		if err != nil {
			return "", "", nil, nil, err
		}
		for rows.Next() {
			var n string
			if serr := rows.Scan(&n); serr != nil {
				rows.Close()
				return "", "", nil, nil, serr
			}
			schemas = append(schemas, n)
		}
		rows.Close()
		if !contains(schemas, "public") {
			schemas = append(schemas, "public")
		}
		sort.Strings(schemas)
	}
	in := make([]string, len(schemas))
	for i, s := range schemas {
		in[i] = ql(s)
	}
	inSQL := strings.Join(in, ", ")

	preLines = append(preLines,
		"SET client_encoding = 'UTF8';",
		"SET standard_conforming_strings = on;",
		"SET check_function_bodies = false;",
		"SELECT pg_catalog.set_config('search_path', '', false);",
		"SET row_security = off;",
		"")

	// 1. Roles — GRANTs/policies reference roles that may not exist on a clean
	// target, so create them conditionally and tolerate missing privileges.
	var roles []string
	{
		rows, err := q("SELECT rolname FROM pg_roles WHERE rolname !~ '^pg_' ORDER BY rolname")
		if err != nil {
			return "", "", nil, nil, err
		}
		for rows.Next() {
			var n string
			if serr := rows.Scan(&n); serr != nil {
				rows.Close()
				return "", "", nil, nil, serr
			}
			roles = append(roles, n)
		}
		rows.Close()
	}
	if len(roles) > 0 {
		var blocks []string
		for _, r := range roles {
			blocks = append(blocks,
				"  BEGIN\n"+
					"    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = "+ql(r)+") THEN\n"+
					"      CREATE ROLE "+qi(r)+";\n"+
					"    END IF;\n"+
					"  EXCEPTION WHEN insufficient_privilege THEN\n"+
					"    RAISE NOTICE "+ql("نقش "+r+" ساخته نشد (کمبود مجوز) — GRANTها ممکن است رد شوند.")+";\n"+
					"  END;")
		}
		preLines = append(preLines, "DO $afagh_roles$\nBEGIN\n"+strings.Join(blocks, "\n")+"\nEND\n$afagh_roles$;", "")
	}

	// 2. Drop + recreate schemas (the only destructive part of a DR restore).
	preLines = append(preLines, "-- ⚠ پاکسازی کامل اسکیمای مقصد (بازیابی Disaster Recovery).")
	for _, sc := range schemas {
		preLines = append(preLines, "DROP SCHEMA IF EXISTS "+qi(sc)+" CASCADE;")
	}
	var schemaACL []aclRow
	{
		rows, err := q(fmt.Sprintf(`SELECT n.nspname, x.grantee::bigint, pg_get_userbyid(x.grantee)::text, x.privilege_type
			FROM pg_namespace n CROSS JOIN LATERAL aclexplode(n.nspacl) x
			WHERE n.nspname IN (%s) AND n.nspacl IS NOT NULL`, inSQL))
		if err != nil {
			return "", "", nil, nil, err
		}
		for rows.Next() {
			var r aclRow
			r.kind = "schema"
			if serr := rows.Scan(&r.schema, &r.granteeOID, &r.grantee, &r.priv); serr != nil {
				rows.Close()
				return "", "", nil, nil, serr
			}
			schemaACL = append(schemaACL, r)
		}
		rows.Close()
	}
	owners := map[string]string{}
	{
		rows, err := q(fmt.Sprintf(
			"SELECT nspname, pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname IN (%s)", inSQL))
		if err != nil {
			return "", "", nil, nil, err
		}
		for rows.Next() {
			var n, o string
			if serr := rows.Scan(&n, &o); serr != nil {
				rows.Close()
				return "", "", nil, nil, serr
			}
			owners[n] = o
		}
		rows.Close()
	}
	for _, sc := range schemas {
		preLines = append(preLines, "CREATE SCHEMA "+qi(sc)+";")
	}
	preLines = append(preLines, "")
	for sc, owner := range owners {
		if owner != "" && contains(roles, owner) {
			preLines = append(preLines, "ALTER SCHEMA "+qi(sc)+" OWNER TO "+qi(owner)+";")
		}
	}
	for _, g := range groupGrants(schemaACL) {
		preLines = append(preLines,
			"GRANT "+strings.Join(g.privs, ", ")+" ON SCHEMA "+qi(g.schema)+" TO "+granteeSQL(g.grantee)+";")
	}
	preLines = append(preLines, "")

	// 3. Extensions + enums.
	{
		rows, err := q(`SELECT e.extname, ns.nspname FROM pg_extension e
			JOIN pg_namespace ns ON ns.oid = e.extnamespace WHERE e.extname <> 'plpgsql' ORDER BY 1`)
		if err != nil {
			return "", "", nil, nil, err
		}
		for rows.Next() {
			var name, sc string
			if serr := rows.Scan(&name, &sc); serr != nil {
				rows.Close()
				return "", "", nil, nil, serr
			}
			preLines = append(preLines, "CREATE EXTENSION IF NOT EXISTS "+qi(name)+" WITH SCHEMA "+qi(sc)+";")
		}
		rows.Close()
	}
	{
		rows, err := q(fmt.Sprintf(`SELECT n.nspname, t.typname, array_agg(e.enumlabel::text ORDER BY e.enumsortorder)
			FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
			JOIN pg_enum e ON e.enumtypid = t.oid
			WHERE n.nspname IN (%s) AND t.typtype = 'e'
			GROUP BY n.nspname, t.typname ORDER BY 1, 2`, inSQL))
		if err != nil {
			return "", "", nil, nil, err
		}
		for rows.Next() {
			var sc, name string
			var labels []string
			if serr := rows.Scan(&sc, &name, &labels); serr != nil {
				rows.Close()
				return "", "", nil, nil, serr
			}
			preLines = append(preLines,
				"CREATE TYPE "+qi(sc)+"."+qi(name)+" AS ENUM ("+joinQL(labels)+");")
		}
		rows.Close()
	}
	preLines = append(preLines, "")

	// 4. Sequences (before tables: defaults reference them).
	type seqRow struct {
		schema, name, typ           string
		start, inc, min, max, cache int64
		cycle                       bool
		lastValue                   *int64
	}
	var seqs []seqRow
	{
		rows, err := q(fmt.Sprintf(`SELECT n.nspname, c.relname, format_type(s.seqtypid, NULL),
			s.seqstart, s.seqincrement, s.seqmin, s.seqmax, s.seqcache, s.seqcycle, v.last_value
			FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
			JOIN pg_sequence s ON s.seqrelid = c.oid
			LEFT JOIN pg_sequences v ON v.schemaname = n.nspname AND v.sequencename = c.relname
			WHERE c.relkind = 'S' AND n.nspname IN (%s) ORDER BY n.nspname, c.relname`, inSQL))
		if err != nil {
			return "", "", nil, nil, err
		}
		for rows.Next() {
			var r seqRow
			if serr := rows.Scan(&r.schema, &r.name, &r.typ, &r.start, &r.inc, &r.min, &r.max, &r.cache, &r.cycle, &r.lastValue); serr != nil {
				rows.Close()
				return "", "", nil, nil, serr
			}
			seqs = append(seqs, r)
		}
		rows.Close()
	}
	for _, r := range seqs {
		preLines = append(preLines, fmt.Sprintf(
			"CREATE SEQUENCE %s.%s AS %s START WITH %d INCREMENT BY %d MINVALUE %d MAXVALUE %d CACHE %d %s;",
			qi(r.schema), qi(r.name), r.typ, r.start, r.inc, r.min, r.max, r.cache,
			map[bool]string{true: "CYCLE", false: "NO CYCLE"}[r.cycle]))
	}
	preLines = append(preLines, "")

	// 5. Tables + columns (no constraints/indexes/RLS yet).
	// Catalog oids are never selected raw: this pgx version refuses to scan
	// the `oid`/`name` types into Go scalars, so lookups go by schema+name.
	type tblRow struct {
		schema   string
		name     string
		rls      bool
		forceRLS bool
	}
	var tables []tblRow
	rlsTables := 0
	{
		rows, err := q(fmt.Sprintf(`SELECT n.nspname, c.relname, c.relrowsecurity, c.relforcerowsecurity
			FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
			WHERE c.relkind IN ('r','p') AND n.nspname IN (%s) ORDER BY n.nspname, c.relname`, inSQL))
		if err != nil {
			return "", "", nil, nil, err
		}
		for rows.Next() {
			var t tblRow
			if err := rows.Scan(&t.schema, &t.name, &t.rls, &t.forceRLS); err != nil {
				rows.Close()
				return "", "", nil, nil, fmt.Errorf("scan table: %w", err)
			}
			tables = append(tables, t)
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return "", "", nil, nil, err
		}
		rows.Close()
	}
	for _, t := range tables {
		type colRow struct {
			attname, typ          string
			notNull               bool
			def, identity, gen    *string
			collation, collSchema *string
		}
		var cols []colRow
		rows, err := q(`SELECT a.attname, format_type(a.atttypid, a.atttypmod), a.attnotnull,
			pg_get_expr(ad.adbin, ad.adrelid), a.attidentity::text, a.attgenerated::text,
			co.collname, cn.nspname
			FROM pg_attribute a
			JOIN pg_class c ON c.oid = a.attrelid
			JOIN pg_namespace n ON n.oid = c.relnamespace
			LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
			LEFT JOIN pg_collation co ON co.oid = a.attcollation
			LEFT JOIN pg_namespace cn ON cn.oid = co.collnamespace
			WHERE n.nspname = $1 AND c.relname = $2 AND a.attnum > 0 AND NOT a.attisdropped
			ORDER BY a.attnum`, t.schema, t.name)
		if err != nil {
			return "", "", nil, nil, err
		}
		for rows.Next() {
			var c colRow
			if err := rows.Scan(&c.attname, &c.typ, &c.notNull, &c.def, &c.identity, &c.gen, &c.collation, &c.collSchema); err != nil {
				rows.Close()
				return "", "", nil, nil, fmt.Errorf("scan column %s.%s: %w", t.schema, t.name, err)
			}
			cols = append(cols, c)
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return "", "", nil, nil, err
		}
		rows.Close()
		if len(cols) == 0 {
			continue
		}
		defs := make([]string, 0, len(cols))
		insertCols := make([]string, 0, len(cols))
		identityAlways := false
		for _, c := range cols {
			line := "  " + qi(c.attname) + " " + c.typ
			if c.collation != nil && *c.collation != "default" {
				line += " COLLATE " + qi(deref(c.collSchema)) + "." + qi(*c.collation)
			}
			switch {
			case c.identity != nil && *c.identity != "":
				line += " GENERATED " + map[string]string{"a": "ALWAYS", "d": "BY DEFAULT"}[*c.identity] + " AS IDENTITY"
				if *c.identity == "a" {
					identityAlways = true
				}
			case c.gen != nil && *c.gen == "s" && c.def != nil:
				line += " GENERATED ALWAYS AS (" + *c.def + ") STORED"
			case c.def != nil:
				line += " DEFAULT " + *c.def
			}
			if c.notNull {
				line += " NOT NULL"
			}
			defs = append(defs, line)
			if c.gen == nil || *c.gen == "" {
				insertCols = append(insertCols, c.attname)
			}
		}
		preLines = append(preLines,
			"CREATE TABLE "+qi(t.schema)+"."+qi(t.name)+" (\n"+strings.Join(defs, ",\n")+"\n);", "")
		dataTables = append(dataTables, dataTable{
			schema: t.schema, name: t.name, insertColumns: insertCols, identityAlways: identityAlways,
		})
		if t.rls || t.forceRLS {
			rlsTables++
			postLines = append(postLines, "ALTER TABLE "+qi(t.schema)+"."+qi(t.name)+" ENABLE ROW LEVEL SECURITY;")
			if t.forceRLS {
				postLines = append(postLines, "ALTER TABLE "+qi(t.schema)+"."+qi(t.name)+" FORCE ROW LEVEL SECURITY;")
			}
		}
	}

	// 6. Sequence ownership.
	{
		rows, err := q(fmt.Sprintf(`SELECT ns.nspname, s.relname, tn.nspname, t.relname, a.attname
			FROM pg_depend d JOIN pg_class s ON s.oid = d.objid AND s.relkind = 'S'
			JOIN pg_namespace ns ON ns.oid = s.relnamespace
			JOIN pg_class t ON t.oid = d.refobjid
			JOIN pg_namespace tn ON tn.oid = t.relnamespace
			JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = d.refobjsubid
			WHERE d.classid = 'pg_class'::regclass AND d.refclassid = 'pg_class'::regclass
			  AND d.deptype IN ('a','i') AND ns.nspname IN (%s) AND tn.nspname IN (%s)`, inSQL, inSQL))
		if err != nil {
			return "", "", nil, nil, err
		}
		for rows.Next() {
			var ss, sn, ts, tn, col string
			if serr := rows.Scan(&ss, &sn, &ts, &tn, &col); serr != nil {
				rows.Close()
				return "", "", nil, nil, serr
			}
			postLines = append(postLines,
				"ALTER SEQUENCE "+qi(ss)+"."+qi(sn)+" OWNED BY "+qi(ts)+"."+qi(tn)+"."+qi(col)+";")
		}
		rows.Close()
	}
	postLines = append(postLines, "")

	// 7. Constraints — unique/PK before FK (otherwise FK targets lack keys).
	constraintCount := 0
	{
		rows, err := q(fmt.Sprintf(`SELECT n.nspname, c.relname, con.conname, pg_get_constraintdef(con.oid), con.convalidated
			FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid
			JOIN pg_namespace n ON n.oid = c.relnamespace
			WHERE n.nspname IN (%s) AND con.contype IN ('p','u','f','c','x')
			ORDER BY CASE con.contype WHEN 'p' THEN 0 WHEN 'u' THEN 1 WHEN 'x' THEN 2 WHEN 'c' THEN 3 ELSE 4 END,
			  n.nspname, c.relname, con.conname`, inSQL))
		if err != nil {
			return "", "", nil, nil, err
		}
		for rows.Next() {
			var sc, tbl, name, def string
			var validated bool
			if serr := rows.Scan(&sc, &tbl, &name, &def, &validated); serr != nil {
				rows.Close()
				return "", "", nil, nil, serr
			}
			suffix := ""
			if !validated {
				suffix = " NOT VALID"
			}
			postLines = append(postLines,
				"ALTER TABLE ONLY "+qi(sc)+"."+qi(tbl)+" ADD CONSTRAINT "+qi(name)+" "+def+suffix+";")
			constraintCount++
		}
		rows.Close()
	}
	postLines = append(postLines, "")

	// 8. Indexes not backing constraints.
	indexCount := 0
	{
		rows, err := q(fmt.Sprintf(`SELECT pg_get_indexdef(i.indexrelid) FROM pg_index i
			JOIN pg_class c ON c.oid = i.indexrelid JOIN pg_namespace n ON n.oid = c.relnamespace
			WHERE n.nspname IN (%s) AND i.indisvalid
			  AND NOT EXISTS (SELECT 1 FROM pg_constraint co WHERE co.conindid = i.indexrelid)
			ORDER BY 1`, inSQL))
		if err != nil {
			return "", "", nil, nil, err
		}
		for rows.Next() {
			var def string
			if serr := rows.Scan(&def); serr != nil {
				rows.Close()
				return "", "", nil, nil, serr
			}
			postLines = append(postLines, def+";")
			indexCount++
		}
		rows.Close()
	}
	postLines = append(postLines, "")

	// 9. RLS policies.
	policyCount := 0
	{
		rows, err := q(fmt.Sprintf(`SELECT n.nspname, c.relname, p.polname, p.polcmd, p.polpermissive,
			pg_get_expr(p.polqual, p.polrelid), pg_get_expr(p.polwithcheck, p.polrelid),
			(ARRAY(SELECT CASE WHEN u = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(u) END FROM unnest(p.polroles) u ORDER BY u))::text[]
			FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
			JOIN pg_namespace n ON n.oid = c.relnamespace
			WHERE n.nspname IN (%s) ORDER BY n.nspname, c.relname, p.polname`, inSQL))
		if err != nil {
			return "", "", nil, nil, err
		}
		cmd := map[string]string{"*": "ALL", "r": "SELECT", "a": "INSERT", "w": "UPDATE", "d": "DELETE"}
		for rows.Next() {
			var sc, tbl, name, polcmd string
			var permissive bool
			var qual, withCheck *string
			var rolesList []string
			if serr := rows.Scan(&sc, &tbl, &name, &polcmd, &permissive, &qual, &withCheck, &rolesList); serr != nil {
				rows.Close()
				return "", "", nil, nil, serr
			}
			to := "PUBLIC"
			if len(rolesList) > 0 {
				tos := make([]string, 0, len(rolesList))
				for _, r := range rolesList {
					tos = append(tos, granteeSQL(r))
				}
				to = strings.Join(tos, ", ")
			}
			line := "CREATE POLICY " + qi(name) + " ON " + qi(sc) + "." + qi(tbl) +
				" AS " + map[bool]string{true: "PERMISSIVE", false: "RESTRICTIVE"}[permissive] +
				" FOR " + orDefault(cmd[polcmd], "ALL") + " TO " + to
			if qual != nil {
				line += " USING (" + *qual + ")"
			}
			if withCheck != nil {
				line += " WITH CHECK (" + *withCheck + ")"
			}
			postLines = append(postLines, line+";")
			policyCount++
		}
		rows.Close()
	}
	postLines = append(postLines, "")

	// 10. Views / functions / triggers.
	viewCount, funcCount, trigCount := 0, 0, 0
	{
		rows, err := q(fmt.Sprintf(`SELECT n.nspname, c.relname, c.relkind, pg_get_viewdef(c.oid, true)
			FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
			WHERE c.relkind IN ('v','m') AND n.nspname IN (%s) ORDER BY 1, 2`, inSQL))
		if err != nil {
			return "", "", nil, nil, err
		}
		for rows.Next() {
			var sc, name, kind, def string
			if serr := rows.Scan(&sc, &name, &kind, &def); serr != nil {
				rows.Close()
				return "", "", nil, nil, serr
			}
			kindWord := "CREATE VIEW"
			tail := ""
			if kind == "m" {
				kindWord = "CREATE MATERIALIZED VIEW"
				tail = "\nWITH NO DATA"
			}
			postLines = append(postLines, kindWord+" "+qi(sc)+"."+qi(name)+" AS\n"+def+tail+";")
			viewCount++
		}
		rows.Close()
	}
	{
		rows, err := q(fmt.Sprintf(`SELECT pg_get_functiondef(p.oid) FROM pg_proc p
			JOIN pg_namespace n ON n.oid = p.pronamespace
			WHERE n.nspname IN (%s) AND p.prokind IN ('f','p','w') ORDER BY 1`, inSQL))
		if err != nil {
			return "", "", nil, nil, err
		}
		for rows.Next() {
			var def string
			if serr := rows.Scan(&def); serr != nil {
				rows.Close()
				return "", "", nil, nil, serr
			}
			postLines = append(postLines, def+";")
			funcCount++
		}
		rows.Close()
	}
	{
		rows, err := q(fmt.Sprintf(`SELECT pg_get_triggerdef(t.oid) FROM pg_trigger t
			JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
			WHERE NOT t.tgisinternal AND n.nspname IN (%s) ORDER BY 1`, inSQL))
		if err != nil {
			return "", "", nil, nil, err
		}
		for rows.Next() {
			var def string
			if serr := rows.Scan(&def); serr != nil {
				rows.Close()
				return "", "", nil, nil, serr
			}
			postLines = append(postLines, def+";")
			trigCount++
		}
		rows.Close()
	}
	postLines = append(postLines, "")

	// 11. Explicit table + column grants.
	grantCount := 0
	var relACL []aclRow
	{
		rows, err := q(fmt.Sprintf(`SELECT n.nspname, c.relname, c.relkind, x.grantee::bigint, pg_get_userbyid(x.grantee)::text, x.privilege_type
			FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
			CROSS JOIN LATERAL aclexplode(c.relacl) x
			WHERE n.nspname IN (%s) AND c.relacl IS NOT NULL AND c.relkind IN ('r','p','v','m','S')`, inSQL))
		if err != nil {
			return "", "", nil, nil, err
		}
		for rows.Next() {
			var r aclRow
			if serr := rows.Scan(&r.schema, &r.name, &r.kind, &r.granteeOID, &r.grantee, &r.priv); serr != nil {
				rows.Close()
				return "", "", nil, nil, serr
			}
			relACL = append(relACL, r)
		}
		rows.Close()
	}
	for _, g := range groupGrants(relACL) {
		target := map[string]string{"S": "SEQUENCE"}[g.kind]
		if target == "" {
			target = "TABLE"
		}
		postLines = append(postLines,
			"GRANT "+strings.Join(g.privs, ", ")+" ON "+target+" "+qi(g.schema)+"."+qi(g.name)+
				" TO "+granteeSQL(g.grantee)+";")
		grantCount++
	}
	var colACL []aclRow
	{
		rows, err := q(fmt.Sprintf(`SELECT n.nspname, c.relname, a.attname, x.grantee::bigint, pg_get_userbyid(x.grantee)::text, x.privilege_type
			FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
			JOIN pg_namespace n ON n.oid = c.relnamespace
			CROSS JOIN LATERAL aclexplode(a.attacl) x
			WHERE n.nspname IN (%s) AND a.attacl IS NOT NULL AND a.attnum > 0`, inSQL))
		if err != nil {
			return "", "", nil, nil, err
		}
		for rows.Next() {
			var r aclRow
			r.kind = "c"
			if serr := rows.Scan(&r.schema, &r.name, &r.col, &r.granteeOID, &r.grantee, &r.priv); serr != nil {
				rows.Close()
				return "", "", nil, nil, serr
			}
			colACL = append(colACL, r)
		}
		rows.Close()
	}
	for _, g := range groupGrants(colACL) {
		postLines = append(postLines,
			"GRANT "+strings.Join(g.privs, ", ")+"("+qi(g.col)+") ON TABLE "+qi(g.schema)+"."+qi(g.name)+
				" TO "+granteeSQL(g.grantee)+";")
		grantCount++
	}
	// Default ACLs (ALTER DEFAULT PRIVILEGES).
	{
		rows, err := q(`SELECT pg_get_userbyid(d.defaclrole)::text, ns.nspname, d.defaclobjtype, x.grantee::bigint,
			pg_get_userbyid(x.grantee)::text, x.privilege_type
			FROM pg_default_acl d LEFT JOIN pg_namespace ns ON ns.oid = d.defaclnamespace
			CROSS JOIN LATERAL aclexplode(d.defaclacl) x`)
		if err != nil {
			return "", "", nil, nil, err
		}
		obj := map[string]string{"r": "TABLES", "S": "SEQUENCES", "f": "FUNCTIONS", "T": "TYPES", "n": "SCHEMAS"}
		for rows.Next() {
			var owner, objType string
			var sc *string
			var granteeOID int64
			var grantee, priv string
			if serr := rows.Scan(&owner, &sc, &objType, &granteeOID, &grantee, &priv); serr != nil {
				rows.Close()
				return "", "", nil, nil, serr
			}
			inSchema := ""
			if sc != nil && *sc != "" {
				inSchema = " IN SCHEMA " + qi(*sc)
			}
			postLines = append(postLines,
				"ALTER DEFAULT PRIVILEGES FOR ROLE "+qi(owner)+inSchema+
					" GRANT "+priv+" ON "+orDefault(obj[objType], "TABLES")+" TO "+granteeSQL(mapOIDGrantee(granteeOID, grantee))+";")
			grantCount++
		}
		rows.Close()
	}
	postLines = append(postLines, "")

	// 12. Sequence values (after INSERTs, otherwise the next row duplicates).
	for _, r := range seqs {
		unused := r.lastValue == nil
		val := r.start
		if !unused {
			val = *r.lastValue
		}
		postLines = append(postLines, fmt.Sprintf(
			"SELECT pg_catalog.setval(%s, %d, %s);",
			ql(r.schema+"."+r.name), val, map[bool]string{true: "false", false: "true"}[unused]))
	}
	postLines = append(postLines, "")

	// drizzle migrations count (optional schema). A failed statement aborts
	// the snapshot transaction, so the probe is guarded by a savepoint and
	// rolled back when the schema does not exist (installations migrated by
	// other tools).
	drizzleMigrations := 0
	{
		if _, serr := conn.Exec(ctx, "SAVEPOINT afagh_drizzle_probe"); serr == nil {
			rows, qerr := q("SELECT count(*)::int FROM drizzle.__drizzle_migrations")
			if qerr == nil {
				if rows.Next() {
					var n int
					if serr := rows.Scan(&n); serr != nil {
						rows.Close()
						_, _ = conn.Exec(ctx, "ROLLBACK TO SAVEPOINT afagh_drizzle_probe")
						return "", "", nil, nil, serr
					}
					drizzleMigrations = n
				}
				rows.Close()
				_, _ = conn.Exec(ctx, "RELEASE SAVEPOINT afagh_drizzle_probe")
			} else {
				_, _ = conn.Exec(ctx, "ROLLBACK TO SAVEPOINT afagh_drizzle_probe")
			}
		}
	}

	manifest = map[string]any{
		"serverVersion":     serverVersion,
		"schemas":           schemas,
		"tables":            len(tables),
		"sequences":         len(seqs),
		"indexes":           indexCount,
		"constraints":       constraintCount,
		"policies":          policyCount,
		"rlsTables":         rlsTables,
		"functions":         funcCount,
		"views":             viewCount,
		"triggers":          trigCount,
		"grants":            grantCount,
		"drizzleMigrations": drizzleMigrations,
	}
	return strings.Join(preLines, "\n"), strings.Join(postLines, "\n"), dataTables, manifest, nil
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func joinQL(list []string) string {
	parts := make([]string, len(list))
	for i, s := range list {
		parts[i] = ql(s)
	}
	return strings.Join(parts, ", ")
}

func orDefault(v, def string) string {
	if v == "" {
		return def
	}
	return v
}

func mapOIDGrantee(oid int64, name string) string {
	if oid == 0 {
		return "PUBLIC"
	}
	return name
}

// ── Download / verification ─────────────────────────────────────────────────

// ReadDumpFile opens the artifact of a finished job for streaming download.
// Returns the file, a suggested filename and its size.
func (s *Service) ReadDumpFile(jobID string) (*os.File, string, int64, error) {
	job, err := s.JobStatus(jobID)
	if err != nil {
		return nil, "", 0, err
	}
	if job.Status != StatusDone || job.File == "" {
		return nil, "", 0, ErrNotReady
	}
	f, err := os.Open(job.File)
	if err != nil {
		return nil, "", 0, fmt.Errorf("فایل پشتیبان یافت نشد: %w", err)
	}
	info, err := f.Stat()
	if err != nil {
		_ = f.Close()
		return nil, "", 0, err
	}
	name := "afagh-backup-" + job.StartedAt.UTC().Format("2006-01-02T15-04-05") + "-" + job.ID[:8]
	if job.Kind == KindFiles {
		name += ".tar.gz"
	} else {
		name += ".sql.gz"
	}
	return f, name, info.Size(), nil
}

// tailKeep must exceed the signature marker line (≈95 bytes).
const tailKeep = 256

var signatureTailRe = regexp.MustCompile(`\n-- AFAGH_BACKUP_SIGNATURE=([0-9a-f]{64})\r?\n?$`)

// VerifyDump recomputes the HMAC of a stored dump over its decompressed bytes
// and compares it with the embedded signature (all valid keys accepted, so key
// rotation never invalidates archived backups). Persian sentinel errors are
// returned on any mismatch.
func (s *Service) VerifyDump(jobID string) error {
	job, err := s.JobStatus(jobID)
	if err != nil {
		return err
	}
	if job.Status != StatusDone || job.File == "" {
		return ErrNotReady
	}
	f, err := os.Open(job.File)
	if err != nil {
		return fmt.Errorf("فایل پشتیبان یافت نشد: %w", err)
	}
	defer f.Close()

	keys := SigningKeys()
	if len(keys) == 0 {
		return ErrNoSigningKey
	}
	macs := make([]hash.Hash, len(keys))
	for i, k := range keys {
		macs[i] = hmac.New(sha256.New, k)
	}

	gz, err := gzip.NewReader(f)
	if err != nil {
		return fmt.Errorf("باز کردن فایل فشرده ناموفق بود: %w", err)
	}
	defer gz.Close()

	var tail []byte
	buf := make([]byte, 64*1024)
	for {
		n, rerr := gz.Read(buf)
		if n > 0 {
			tail = append(tail, buf[:n]...)
			if len(tail) > tailKeep {
				keep := tail[len(tail)-tailKeep:]
				feed := tail[:len(tail)-tailKeep]
				for _, m := range macs {
					_, _ = m.Write(feed)
				}
				tail = append([]byte(nil), keep...)
			}
		}
		if rerr == io.EOF {
			break
		}
		if rerr != nil {
			return fmt.Errorf("خواندن فایل ناموفق بود: %w", rerr)
		}
	}

	m := signatureTailRe.FindSubmatch(tail)
	if m == nil {
		return ErrMissingSignature
	}
	body := tail[:len(tail)-len(m[0])]
	for _, mac := range macs {
		_, _ = mac.Write(body)
	}
	supplied, _ := hex.DecodeString(string(m[1]))
	for _, mac := range macs {
		if hmac.Equal(mac.Sum(nil), supplied) {
			return nil
		}
	}
	return ErrBadSignature
}

// ── MinIO object bundle ─────────────────────────────────────────────────────

func (s *Service) minioClient() (*minio.Client, string, error) {
	endpoint := strings.TrimSpace(s.S3Endpoint)
	bucket := strings.TrimSpace(s.S3Bucket)
	if endpoint == "" || bucket == "" {
		return nil, "", errors.New("آرشیو (MinIO) پیکربندی نشده است.")
	}
	secure := false
	host := endpoint
	if u, err := url.Parse(endpoint); err == nil && u.Host != "" {
		host = u.Host
		secure = u.Scheme == "https"
	}
	cl, err := minio.New(host, &minio.Options{
		Creds:  credentials.NewStaticV4(s.S3AccessKey, s.S3SecretKey, ""),
		Secure: secure,
	})
	if err != nil {
		return nil, "", err
	}
	return cl, bucket, nil
}

func (s *Service) runFiles(job *Job) {
	defer func() {
		if r := recover(); r != nil {
			s.fail(job, fmt.Errorf("بکاپ فایلها ناموفق بود: %v", r))
		}
	}()
	ctx := context.WithoutCancel(context.Background())

	cl, bucket, err := s.minioClient()
	if err != nil {
		s.fail(job, err)
		return
	}

	// Recursive listing; backups themselves are excluded (no recursion).
	var keys []string
	for obj := range cl.ListObjects(ctx, bucket, minio.ListObjectsOptions{Recursive: true}) {
		if obj.Err != nil {
			// A missing bucket or connectivity problem must fail loudly — an
			// empty bundle would silently pass as a "successful" backup.
			s.fail(job, fmt.Errorf("فهرستبرداری از آرشیو ناموفق بود: %w", obj.Err))
			return
		}
		if obj.Key == "" || strings.HasPrefix(obj.Key, backupPrefix) {
			continue
		}
		keys = append(keys, obj.Key)
	}
	sort.Strings(keys)
	s.mu.Lock()
	job.Objects = len(keys)
	s.mu.Unlock()

	path := filepath.Join(s.Dir, job.ID+".files.tar.gz")
	tmp := path + ".part"
	f, err := os.Create(tmp)
	if err != nil {
		s.fail(job, err)
		return
	}
	sum := sha256.New()
	gz, err := gzip.NewWriterLevel(io.MultiWriter(f, sum), gzip.BestSpeed)
	if err != nil {
		_ = f.Close()
		s.fail(job, err)
		return
	}
	tw := tar.NewWriter(gz)

	var writeErr error
	done := 0
	for _, key := range keys {
		obj, err := cl.GetObject(ctx, bucket, key, minio.GetObjectOptions{})
		if err != nil {
			writeErr = err
			break
		}
		info, err := obj.Stat()
		if err != nil {
			_ = obj.Close()
			writeErr = err
			break
		}
		size := info.Size
		if size < 0 {
			size = 0
		}
		modTime := info.LastModified
		if modTime.IsZero() {
			modTime = time.Now()
		}
		if err := tw.WriteHeader(&tar.Header{
			Name:     key,
			Mode:     0o644,
			Size:     size,
			ModTime:  modTime,
			Typeflag: tar.TypeReg,
		}); err != nil {
			_ = obj.Close()
			writeErr = err
			break
		}
		if _, err := io.Copy(tw, obj); err != nil {
			_ = obj.Close()
			writeErr = err
			break
		}
		_ = obj.Close()
		done++
		s.mu.Lock()
		job.ObjectsDone = done
		s.mu.Unlock()
	}
	// A manifest is written even when the listing failed midway so the bundle
	// stays self-describing.
	if writeErr == nil {
		type fileManifest struct {
			Format      string   `json:"format"`
			GeneratedAt string   `json:"generatedAt"`
			Bucket      string   `json:"bucket"`
			Objects     int      `json:"objects"`
			Skipped     []string `json:"skipped"`
		}
		skipped := []string{"env values are intentionally not included; restore them from the organization secret vault"}
		mb, _ := json.MarshalIndent(fileManifest{
			Format: Format, GeneratedAt: time.Now().UTC().Format(time.RFC3339),
			Bucket: bucket, Objects: len(keys), Skipped: skipped,
		}, "", "  ")
		_ = tw.WriteHeader(&tar.Header{Name: "MANIFEST.json", Mode: 0o644, Size: int64(len(mb)), ModTime: time.Now(), Typeflag: tar.TypeReg})
		_, writeErr = tw.Write(mb)
	}
	if err := tw.Close(); err != nil && writeErr == nil {
		writeErr = err
	}
	if err := gz.Close(); err != nil && writeErr == nil {
		writeErr = err
	}
	if err := f.Sync(); err != nil && writeErr == nil {
		writeErr = err
	}
	if err := f.Close(); err != nil && writeErr == nil {
		writeErr = err
	}
	if writeErr != nil {
		_ = os.Remove(tmp)
		s.fail(job, writeErr)
		return
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		s.fail(job, err)
		return
	}
	info, _ := os.Stat(path)
	var size int64
	if info != nil {
		size = info.Size()
	}
	s.finish(job, path, size, hex.EncodeToString(sum.Sum(nil)), "")
}
