// ═══ shared session — faithful port from afagh-next/src/lib/auth.ts ═══
//
// the contract is deliberately identical to Next.js so that in the strangler pattern both services
// work on one sessions table and one cookie:
//   - token: 64 hex characters (32 random bytes); only its sha256 is stored in the DB.
//   - cookie: legacy name "token" + dual-read of the new name "__Host-afagh_session"
//     behind the AFAGH_SESSION_COOKIE_PREFIX=host gate (reads from the new name take priority).
//   - absolute session cap in the DB (expiresAt) — no sliding renewal.
//   - inactive user ⇒ delete the session and immediately invalidate all channels.
//   - mustChangePassword ⇒ session valid only for the change-password/logout flow.
package session

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// cookie names — the same constants as auth.ts.
const (
	CookieName     = "token"
	CookieNameHost = "__Host-afagh_session"
)

// HostPrefixEnabled migration gate to the __Host- cookie name — same as hostSessionCookieEnabled.
func HostPrefixEnabled() bool {
	return strings.ToLower(strings.TrimSpace(os.Getenv("AFAGH_SESSION_COOKIE_PREFIX"))) == "host"
}

// ReadToken reads the session token from the cookie map — DUAL-READ with the new name taking priority.
func ReadToken(cookies map[string]string) string {
	if HostPrefixEnabled() {
		if t := cookies[CookieNameHost]; t != "" {
			return t
		}
	}
	return cookies[CookieName]
}

// Sha256Hex hashes the token before comparing/storing — same as sha256() in auth.ts.
func Sha256Hex(t string) string {
	sum := sha256.Sum256([]byte(t))
	return hex.EncodeToString(sum[:])
}

// User same as SessionUser in auth.ts.
type User struct {
	ID                 int64    `json:"id"`
	Name               string   `json:"name"`
	Roles              []string `json:"roles"`
	MustChangePassword bool     `json:"mustChangePassword"`
	UniversityID       *int64   `json:"universityId"`
}

// Store session lookup on the owner pool — same db path as getSessionUser.
type Store struct {
	pool *pgxpool.Pool
}

func NewStore(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

// Get line-by-line port of getSessionUser:
//  1. join sessions→users→user_roles→roles on the hashed token with a future expiry
//  2. no rows ⇒ nil (no session)
//  3. isActive != 1 ⇒ delete the session + nil (immediate invalidation of all channels)
//  4. mustChangePassword == 1 and !allowPending ⇒ nil (guards see no session)
//  5. roles without duplicates (multiple user_roles rows for one role)
func (s *Store) Get(ctx context.Context, rawToken string, allowPendingPasswordChange bool) (*User, error) {
	tokenHash := Sha256Hex(rawToken)
	rows, err := s.pool.Query(ctx, `
		select u.id, u."firstName", u."lastName", r.code,
		       u."mustChangePassword", u."isActive", u."universityId"
		from sessions s
		join users u on u.id = s."userId"
		left join user_roles ur on ur."userId" = u.id
		left join roles r on r.id = ur."roleId"
		where s.token = $1 and s."expiresAt" > now()
	`, tokenHash)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	type rowT struct {
		id                  int64
		firstName, lastName string
		role                *string
		mustChangePassword  int
		isActive            int
		universityID        *int64
	}
	var rowsData []rowT
	for rows.Next() {
		var r rowT
		if err := rows.Scan(&r.id, &r.firstName, &r.lastName, &r.role,
			&r.mustChangePassword, &r.isActive, &r.universityID); err != nil {
			return nil, err
		}
		rowsData = append(rowsData, r)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(rowsData) == 0 {
		return nil, nil
	}
	first := rowsData[0]

	// ⛔ full user deactivation: the session is invalid regardless.
	if first.isActive != 1 {
		if _, err := s.pool.Exec(ctx, `delete from sessions where token = $1`, tokenHash); err != nil {
			return nil, err
		}
		return nil, nil
	}
	// 🔒 forced password change: until the password is changed, no general guard sees a valid session.
	if first.mustChangePassword == 1 && !allowPendingPasswordChange {
		return nil, nil
	}

	roles := make([]string, 0, len(rowsData))
	seen := make(map[string]struct{}, len(rowsData))
	for _, r := range rowsData {
		if r.role == nil || *r.role == "" {
			continue
		}
		if _, dup := seen[*r.role]; dup {
			continue
		}
		seen[*r.role] = struct{}{}
		roles = append(roles, *r.role)
	}
	return &User{
		ID:                 first.id,
		Name:               strings.TrimSpace(first.firstName + " " + first.lastName),
		Roles:              roles,
		MustChangePassword: first.mustChangePassword == 1,
		UniversityID:       first.universityID,
	}, nil
}

// PurgeExpired periodic cleanup of expired sessions — internal helper; Next does this
// at login time (issueSessionFor); here only for the long-lived service.
func (s *Store) PurgeExpired(ctx context.Context) (int64, error) {
	tag, err := s.pool.Exec(ctx, `delete from sessions where "expiresAt" < $1`, time.Now())
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

// ConstantTimeEmpty constant-time comparison of the token length — a valid token is exactly 64 hex chars.
// (similar to the cookie shape check in src/proxy.ts; ensures malformed tokens are rejected early
// without leaking timing information.)
func ValidTokenShape(t string) bool {
	if len(t) != 64 {
		return false
	}
	if _, err := hex.DecodeString(t); err != nil {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(t), []byte(t)) == 1
}
