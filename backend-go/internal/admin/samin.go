// ═══ هاب «ثمین» — ارسال دادهٔ دانشجویان به سازمان امور دانشجویان ═══
//
//	پورت admin/samin + lib/samin/*:
//	  • crypto.ts → رمزنگاری AES-256-GCM با پاکت v1:iv:tag:data (مثل pii)؛
//	    رمزگشایی پاکت قدیمی بدون نسخه (iv:tag:data) هم پذیرفته می‌شود
//	  • client.ts → توکن OAuth (grant_type=password) با کش حافظه + bulk_import_data
//	    + trace_bulk_import_data + get_changeslog
//	  • samin-mapper.ts → ساخت payload entity 1000 از students+users
//	  • actions.ts → enqueue از students، send صف، trace، ارسال نمونهٔ فارغ‌التحصیل
package admin

import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"backend-go/internal/jalali"
	"backend-go/internal/session"
)

// ═══════════════ رمزنگاری (پورت lib/samin/crypto.ts) ═══════════════

const (
	SaminKeyEnv         = "SAMIN_MASTER_KEY"
	saminEnvelopeV1     = "v1"
	saminIVBytes        = 12
	saminDevFallback    = "afagh-dev-samin-key-not-for-production"
	saminPassphraseSalt = "afagh:samin:v1"
)

var saminHex64 = regexp.MustCompile(`^[0-9a-fA-F]{64}$`)

// saminKeyBuf کلید ۳۲ بایتی: hex64 → خام؛ وگرنه SHA-256 روی رشته (پورت keyBuf).
func saminKeyBuf() ([]byte, error) {
	raw := strings.TrimSpace(os.Getenv(SaminKeyEnv))
	if raw == "" {
		raw = saminDevFallback
	}
	if saminHex64.MatchString(raw) {
		return hex.DecodeString(raw)
	}
	sum := sha256.Sum256([]byte(raw))
	return sum[:], nil
}

// SaminEncryptSecret رمزگذاری با پاکت v1:iv:tag:data.
func SaminEncryptSecret(plain string) (string, error) {
	if plain == "" {
		return "", nil
	}
	key, err := saminKeyBuf()
	if err != nil {
		return "", err
	}
	iv := make([]byte, saminIVBytes)
	if _, err := rand.Read(iv); err != nil {
		return "", err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	enc := gcm.Seal(nil, iv, []byte(plain), nil)
	tag := enc[len(enc)-16:]
	data := enc[:len(enc)-16]
	return fmt.Sprintf("%s:%s:%s:%s", saminEnvelopeV1, hex.EncodeToString(iv),
		hex.EncodeToString(tag), hex.EncodeToString(data)), nil
}

// SaminDecryptSecret رمزگشایی — پاکت v1:iv:tag:data و شکل قدیمی iv:tag:data.
func SaminDecryptSecret(enc string) string {
	if enc == "" || !strings.Contains(enc, ":") {
		return enc
	}
	parts := strings.Split(enc, ":")
	var ivHex, tagHex, dataHex string
	switch len(parts) {
	case 4: // v1:iv:tag:data
		ivHex, tagHex, dataHex = parts[1], parts[2], parts[3]
	case 3: // iv:tag:data (پاکت نسخهٔ Next)
		ivHex, tagHex, dataHex = parts[0], parts[1], parts[2]
	default:
		return enc
	}
	key, err := saminKeyBuf()
	if err != nil {
		return ""
	}
	iv, err1 := hex.DecodeString(ivHex)
	tag, err2 := hex.DecodeString(tagHex)
	data, err3 := hex.DecodeString(dataHex)
	if err1 != nil || err2 != nil || err3 != nil {
		return enc
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return ""
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return ""
	}
	dec, err := gcm.Open(nil, iv, append(data, tag...), nil)
	if err != nil {
		return ""
	}
	return string(dec)
}

// ═══════════════ کلاینت ثمین (پورت lib/samin/client.ts) ═══════════════

type saminConn struct {
	APIBaseURL      string
	AuthBaseURL     string
	ClientID        *string
	ClientSecretEnc *string
	Username        *string
	PasswordEnc     *string
	TokenEnc        *string
	TokenExpiresAt  *time.Time
}

func (s *Service) saminConnection(ctx context.Context, universityID int64) (*saminConn, error) {
	var c saminConn
	err := s.DB.Pool.QueryRow(ctx, `
		select coalesce("apiBaseUrl",'https://apim.saorg.ir'), coalesce("authBaseUrl",'https://apiauth.saorg.ir/oauth2/token'),
		       "clientId", "clientSecretEnc", "username", "passwordEnc", "tokenEnc", "tokenExpiresAt"
		  from samin_connections where "universityId" = $1`, universityID).
		Scan(&c.APIBaseURL, &c.AuthBaseURL, &c.ClientID, &c.ClientSecretEnc, &c.Username, &c.PasswordEnc, &c.TokenEnc, &c.TokenExpiresAt)
	if err != nil {
		return nil, errors.New("اتصال ثمین برای این دانشگاه تنظیم نشده است")
	}
	return &c, nil
}

// saminHostsAllowed میزبان‌های مجاز رسمی سامان + اعلام صریح از ENV (ضد SSRF).
func saminHostsAllowed() map[string]bool {
	hosts := map[string]bool{
		"apim.saorg.ir": true, "apiauth.saorg.ir": true, "saorg.ir": true,
	}
	for _, h := range strings.Split(os.Getenv("AFAGH_SSRF_ALLOW_HOSTS"), ",") {
		if h = strings.TrimSpace(strings.ToLower(h)); h != "" {
			hosts[h] = true
		}
	}
	return hosts
}

// saminGuardURL اعتبارسنجی نشانی مقصد — پیش‌فرض فقط میزبان‌های رسمی سامان.
func saminGuardURL(raw string) (string, error) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" {
		return "", errors.New("نشانی سرویس ثمین نامعتبر است.")
	}
	host := strings.ToLower(u.Hostname())
	if !saminHostsAllowed()[host] {
		return "", errors.New("میزبان سرویس ثمین در فهرست مجاز نیست (AFAGH_SSRF_ALLOW_HOSTS).")
	}
	return u.String(), nil
}

var saminHTTPClient = &http.Client{Timeout: 45 * time.Second}

// saminTokenCache کش توکن ۵ دقیقه‌ای در حافظهٔ پروسه.
var (
	saminTokenMu    sync.Mutex
	saminTokenCache = map[int64]saminTokenEntry{}
)

type saminTokenEntry struct {
	token string
	exp   time.Time
}

// SaminGetToken توکن per-university (پورت getSaminToken).
func (s *Service) SaminGetToken(ctx context.Context, universityID int64) (string, error) {
	saminTokenMu.Lock()
	if c, ok := saminTokenCache[universityID]; ok && c.exp.After(time.Now().Add(time.Minute)) {
		saminTokenMu.Unlock()
		return c.token, nil
	}
	saminTokenMu.Unlock()

	conn, err := s.saminConnection(ctx, universityID)
	if err != nil {
		return "", err
	}
	// اگر توکن رمز شده و هنوز معتبر است، همان را برگردان
	if conn.TokenEnc != nil && *conn.TokenEnc != "" && conn.TokenExpiresAt != nil &&
		conn.TokenExpiresAt.After(time.Now().Add(time.Minute)) {
		tok := SaminDecryptSecret(*conn.TokenEnc)
		if tok != "" {
			saminTokenMu.Lock()
			saminTokenCache[universityID] = saminTokenEntry{token: tok, exp: *conn.TokenExpiresAt}
			saminTokenMu.Unlock()
			return tok, nil
		}
	}
	if conn.ClientID == nil || *conn.ClientID == "" {
		return "", errors.New("اتصال ثمین برای این دانشگاه تنظیم نشده است")
	}
	secret := SaminDecryptSecret(orStr(conn.ClientSecretEnc))
	pwd := SaminDecryptSecret(orStr(conn.PasswordEnc))

	// احراز هویت ثمین: Basic(clientId:secret) + grant_type=password
	authURL, err := saminGuardURL(conn.AuthBaseURL)
	if err != nil {
		return "", err
	}
	form := url.Values{}
	form.Set("grant_type", "password")
	form.Set("username", orStr(conn.Username))
	form.Set("password", pwd)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, authURL, strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	req.SetBasicAuth(*conn.ClientID, secret)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	res, err := saminHTTPClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("اتصال به سرویس احراز هویت ثمین ناموفق بود: %w", err)
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if res.StatusCode != http.StatusOK {
		return "", fmt.Errorf("دریافت توکن ثمین شکست (%d): %.300s", res.StatusCode, string(body))
	}
	var j struct {
		AccessToken string `json:"access_token"`
		Token       string `json:"token"`
		ExpiresIn   int64  `json:"expires_in"`
	}
	if err := json.Unmarshal(body, &j); err != nil {
		return "", errors.New("پاسخ احراز هویت ثمین نامعتبر است.")
	}
	access := j.AccessToken
	if access == "" {
		access = j.Token
	}
	if access == "" {
		return "", errors.New("توکن ثمین خالی برگشت")
	}
	expiresIn := j.ExpiresIn
	if expiresIn <= 0 {
		expiresIn = 3600
	}
	exp := time.Now().Add(time.Duration(expiresIn) * time.Second)
	// ذخیرهٔ رمز شده
	encTok, err := SaminEncryptSecret(access)
	if err == nil && encTok != "" {
		_, _ = s.DB.Pool.Exec(ctx, `
			update samin_connections set "tokenEnc" = $2, "tokenExpiresAt" = $3, "updatedAt" = now() where "universityId" = $1`,
			universityID, encTok, exp)
	}
	saminTokenMu.Lock()
	saminTokenCache[universityID] = saminTokenEntry{token: access, exp: exp}
	saminTokenMu.Unlock()
	return access, nil
}

func orStr(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

// saminDerefStr نسخهٔ امن dereference برای فیلدهای nullable.
func saminDerefStr(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

func derefI64(p *int64) any {
	if p == nil {
		return ""
	}
	return *p
}

func jsonMarshal(v any) ([]byte, error) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		return nil, err
	}
	return bytes.TrimRight(buf.Bytes(), "\n"), nil
}

func jsonUnmarshal(data []byte, v any) error {
	return json.Unmarshal(data, v)
}

// SaminBulkImport ارسال دسته‌ای (پورت saminBulkImport).
func (s *Service) SaminBulkImport(ctx context.Context, universityID int64, entityCode string, dataObject []map[string]any) (map[string]any, error) {
	conn, err := s.saminConnection(ctx, universityID)
	if err != nil {
		return nil, err
	}
	token, err := s.SaminGetToken(ctx, universityID)
	if err != nil {
		return nil, err
	}
	apiURL, err := saminGuardURL(strings.TrimRight(conn.APIBaseURL, "/") + "/api/mdm/import_data/bulk_import_data/")
	if err != nil {
		return nil, err
	}
	payload := map[string]any{
		"importdata": map[string]any{
			"data": dataObject, "entity_code": entityCode, "import_type_code": "0",
		},
	}
	body, err := jsonMarshal(payload)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, apiURL, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	res, err := saminHTTPClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("ارسال به ثمین ناموفق بود: %w", err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	var j map[string]any
	if err := jsonUnmarshal(raw, &j); err != nil {
		j = map[string]any{"raw": string(raw)}
	}
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("bulk_import_data %d: %.500s", res.StatusCode, string(raw))
	}
	// لاگ محلی
	traceID := saminTraceID(j)
	status := saminStrOf(j["import_data_status"], j["status"], "PENDING")
	_, _ = s.DB.Pool.Exec(ctx, `
		insert into samin_sync_logs ("universityId","entityCode","traceId","status","summaryResult","rawResponse")
		values ($1,$2,$3,$4,$5,$6)`, universityID, entityCode, traceID, status, raw, string(raw))
	return j, nil
}

// SaminTrace رهگیری ارسال (پورت saminTrace).
func (s *Service) SaminTrace(ctx context.Context, universityID, traceID int64) (map[string]any, error) {
	conn, err := s.saminConnection(ctx, universityID)
	if err != nil {
		return nil, err
	}
	token, err := s.SaminGetToken(ctx, universityID)
	if err != nil {
		return nil, err
	}
	apiURL, err := saminGuardURL(strings.TrimRight(conn.APIBaseURL, "/") +
		"/api/mdm/import_data/trace_bulk_import_data?trace_id=" + strconv.FormatInt(traceID, 10))
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, apiURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	res, err := saminHTTPClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("رهگیری ثمین ناموفق بود: %w", err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	var j map[string]any
	if err := jsonUnmarshal(raw, &j); err != nil {
		j = map[string]any{"raw": string(raw)}
	}
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("trace %d: %.500s", res.StatusCode, string(raw))
	}
	return j, nil
}

func saminTraceID(j map[string]any) any {
	for _, k := range []string{"trace_id", "traceId"} {
		if v, ok := j[k]; ok && v != nil {
			return v
		}
	}
	return nil
}

func saminStrOf(vals ...any) string {
	for _, v := range vals {
		if s, ok := v.(string); ok && s != "" {
			return s
		}
	}
	return ""
}

// ═══════════════ ساخت payload (پورت samin-mapper.ts) ═══════════════

// saminJalaliDay تاریخ میلادی دیتابیس → شمسی YYYY/MM/DD (پورت toJalaliDay).
func saminJalaliDay(v *time.Time) string {
	if v == nil || v.IsZero() {
		return ""
	}
	j := jalali.ToJalaliFromTime(*v)
	return fmt.Sprintf("%04d/%02d/%02d", j.Y, j.M, j.D)
}

// saminEduYear سال ورودی عددی → بازهٔ سال تحصیلی «1398-1399».
func saminEduYear(v any) string {
	s := strings.TrimSpace(fmt.Sprint(v))
	if regexp.MustCompile(`^\d{4}$`).MatchString(s) {
		if y, err := strconv.Atoi(s); err == nil {
			return fmt.Sprintf("%d-%d", y, y+1)
		}
	}
	return s
}

// saminMapNationality کد ملیت ثمین — خالی/0 → ایران (120001).
func saminMapNationality(v any) string {
	s := strings.TrimSpace(fmt.Sprint(v))
	if s == "" || s == "0" || s == "<nil>" {
		return "120001"
	}
	return s
}

func saminMapGraduateState(s any) string {
	m := map[string]string{"ACTIVE": "0", "GRADUATED": "1", "EXPELLED": "2", "SUSPENDED": "3"}
	if v, ok := m[strings.TrimSpace(fmt.Sprint(s))]; ok {
		return v
	}
	return "0"
}

func saminMapGender(g any) string {
	m := map[string]string{"MALE": "1", "FEMALE": "2"}
	v := strings.ToUpper(strings.TrimSpace(fmt.Sprint(g)))
	if v == "" || v == "<NIL>" {
		return "1"
	}
	if x, ok := m[v]; ok {
		return x
	}
	return "1"
}

// saminResolveCityMinistryByCode کد وزارت شهر ۶ رقمی → (شهر، استان) (پورت resolveCityMinistryByCode).
func (s *Service) saminResolveCityMinistryByCode(ctx context.Context, code any) (cityCode, provinceCode string) {
	c := strings.TrimSpace(fmt.Sprint(code))
	if c == "" || c == "<nil>" {
		return "", ""
	}
	rows, err := s.DB.Pool.Query(ctx, `
		select c."ministryCode", p."ministryCode"
		  from geo_cities c join geo_provinces p on p.code = c."provinceCode"
		 where c."ministryCode" = $1 limit 2`, c)
	if err != nil {
		return "", ""
	}
	defer rows.Close()
	var cities, provinces []string
	for rows.Next() {
		var cc, pc *string
		if rows.Scan(&cc, &pc) == nil && cc != nil && *cc != "" && pc != nil && *pc != "" {
			cities = append(cities, *cc)
			provinces = append(provinces, *pc)
		}
	}
	if len(cities) != 1 {
		return "", ""
	}
	return cities[0], provinces[0]
}

// saminResolveCityMinistry عنوان شهر → (شهر، استان) — فقط تطابق یگانه (پورت resolveCityMinistry).
func (s *Service) saminResolveCityMinistry(ctx context.Context, title any) (cityCode, provinceCode string) {
	t := saminNormalizeFaTitle(title)
	if t == "" {
		return "", ""
	}
	rows, err := s.DB.Pool.Query(ctx, `
		select c.title, c."ministryCode", p."ministryCode"
		  from geo_cities c join geo_provinces p on p.code = c."provinceCode"`)
	if err != nil {
		return "", ""
	}
	defer rows.Close()
	seen := map[string]bool{}
	var cc, pc string
	for rows.Next() {
		var title2 string
		var c2, p2 *string
		if rows.Scan(&title2, &c2, &p2) == nil && c2 != nil && *c2 != "" && p2 != nil && *p2 != "" &&
			saminNormalizeFaTitle(title2) == t {
			key := *p2 + "::" + *c2
			if !seen[key] {
				seen[key] = true
				cc, pc = *c2, *p2
			}
		}
	}
	if len(seen) != 1 {
		return "", ""
	}
	return cc, pc
}

func saminNormalizeFaTitle(v any) string {
	s := fmt.Sprint(v)
	if s == "<nil>" {
		return ""
	}
	s = strings.NewReplacer("ي", "ی", "ك", "ک", "ة", "ه").Replace(s)
	return strings.Join(strings.Fields(s), " ")
}

// SaminBuildStudentPayload ساخت payload ثمین entity 1000 (پورت buildSaminPayloadForStudent).
// توجه: ستون militaryStatus در دیتابیس فعلی وجود ندارد → مقدار خالی می‌ماند.
func (s *Service) SaminBuildStudentPayload(ctx context.Context, studentID int64) (map[string]any, error) {
	var (
		uNationalCode, uPassport, uFirstName, uLastName, uFirstNameEn, uLastNameEn *string
		uBirthCertNo, uBirthCertSeries                                             *string
		uBirthPlaceCode, uPlaceOfBirth, uIssuePlaceCode, uPlaceOfIssue             *string
		uBirthDate                                                                 *time.Time
		uNationality, uReligion                                                    *string
		uAddress, uPostalCode, uEmail, uMobile, uFatherName, uGender               *string
		uIsAlive                                                                   *int
		uSaminPersonPk                                                             *string
		uSaminIsVerified                                                           *int
		uSaminVerifyCheckDate                                                      *time.Time
	)
	var (
		sStudentCode                                                                       *string
		sUniversityID, sDegreeLevelID                                                      *int64
		sStatus, sNativeType, sEthnicity                                                   *string
		sSenderUniCode, sSaminStudentPk                                                    *string
		sSaminFieldCode, sSaminLocalFieldCode                                              *string
		sAcceptanceAllocation, sAcceptanceType, sStudyingMode, sTrainingMethod, sIsaarCode *string
		sTotalAverage                                                                      *string
		sEntryYear, sEntryTerm, sEduEndYear, sEduEndSemester                               *int64
		sGraduateDate                                                                      *string
		sTotalTaken, sTotalPassed, sTotalFailed                                            *int64
		sSaminDescription                                                                  *string
	)
	err := s.DB.Pool.QueryRow(ctx, `
		select
		  u."nationalCode", u."passportNumber", u."firstName", u."lastName", u."firstNameEn", u."lastNameEn",
		  u."birthCertNo", u."birthCertSeries", u."birthPlaceCode", u."placeOfBirth", u."issuePlaceCode", u."placeOfIssue",
		  u."birthDate", u."nationality", u."religion", u."address", u."postalCode", u."email", u."mobile",
		  u."fatherName", u."gender", u."isAlive", u."saminPersonPk", u."saminIsVerified", u."saminVerifyCheckDate",
		  s."studentCode", s."universityId", s."degreeLevelId", s.status, s."nativeType", s.ethnicity,
		  s."senderUniversityCode", s."saminStudentPk", s."saminFieldCode", s."saminLocalFieldCode",
		  s."acceptanceAllocation", s."acceptanceType", s."studyingMode", s."trainingMethod", s."isaarCode",
		  s."totalAverage"::text, s."entryYear", s."entryTerm", s."eduEndYear", s."eduEndSemester", s."graduateDate",
		  s."totalTakenUnits", s."totalPassedUnits", s."totalFailedUnits", s."saminDescription"
		from students s join users u on u.id = s."userId"
		where s.id = $1`, studentID).Scan(
		&uNationalCode, &uPassport, &uFirstName, &uLastName, &uFirstNameEn, &uLastNameEn,
		&uBirthCertNo, &uBirthCertSeries, &uBirthPlaceCode, &uPlaceOfBirth, &uIssuePlaceCode, &uPlaceOfIssue,
		&uBirthDate, &uNationality, &uReligion, &uAddress, &uPostalCode, &uEmail, &uMobile,
		&uFatherName, &uGender, &uIsAlive, &uSaminPersonPk, &uSaminIsVerified, &uSaminVerifyCheckDate,
		&sStudentCode, &sUniversityID, &sDegreeLevelID, &sStatus, &sNativeType, &sEthnicity,
		&sSenderUniCode, &sSaminStudentPk, &sSaminFieldCode, &sSaminLocalFieldCode,
		&sAcceptanceAllocation, &sAcceptanceType, &sStudyingMode, &sTrainingMethod, &sIsaarCode,
		&sTotalAverage, &sEntryYear, &sEntryTerm, &sEduEndYear, &sEduEndSemester, &sGraduateDate,
		&sTotalTaken, &sTotalPassed, &sTotalFailed, &sSaminDescription)
	if err != nil {
		return nil, err
	}

	// محل‌ها از geo حل می‌شوند: اول کد ثبت‌شده، بعد عنوان
	birthCity, _ := s.saminResolveCityMinistryByCode(ctx, uBirthPlaceCode)
	if birthCity == "" {
		birthCity, _ = s.saminResolveCityMinistry(ctx, uPlaceOfBirth)
	}
	issueCity, _ := s.saminResolveCityMinistryByCode(ctx, uIssuePlaceCode)
	if issueCity == "" {
		issueCity, _ = s.saminResolveCityMinistry(ctx, uPlaceOfIssue)
	}
	addrCity, addrProv := s.saminResolveCityMinistry(ctx, uAddress)

	// کد استاندارد مقطع + کد ثمین دانشگاه
	levelCode := ""
	if sDegreeLevelID != nil && *sDegreeLevelID > 0 {
		var sc *string
		if s.DB.Pool.QueryRow(ctx, `select "standardCode" from degree_level_configs where id = $1`, *sDegreeLevelID).Scan(&sc) == nil && sc != nil {
			levelCode = *sc
		}
	}
	senderUni := ""
	if sUniversityID != nil && *sUniversityID > 0 {
		var sc *string
		if s.DB.Pool.QueryRow(ctx, `select "saminCode" from universities where id = $1`, *sUniversityID).Scan(&sc) == nil && sc != nil {
			senderUni = *sc
		}
	}
	if senderUni == "" {
		senderUni = "AFAGH"
	}
	if sSenderUniCode != nil && *sSenderUniCode != "" {
		senderUni = *sSenderUniCode
	}

	isAlive := "1"
	if uIsAlive != nil {
		isAlive = strconv.Itoa(*uIsAlive)
	}
	isVerified := ""
	if uSaminIsVerified != nil && *uSaminIsVerified != 0 {
		isVerified = "1"
	}
	entryTerm := "1"
	if sEntryTerm != nil && *sEntryTerm > 0 {
		entryTerm = strconv.FormatInt(*sEntryTerm, 10)
	}

	return map[string]any{
		"national_code":               orStr(uNationalCode),
		"person_pk_in_source":         orStr(uSaminPersonPk) + fallbackPk(orStr(uSaminPersonPk), studentID),
		"passport_number":             orStr(uPassport),
		"student_pk_in_source":        fallbackPk(orStr(sSaminStudentPk), studentID),
		"student_code":                orStr(sStudentCode),
		"sender_university":           senderUni,
		"university":                  senderUni,
		"first_name":                  orStr(uFirstName),
		"last_name":                   orStr(uLastName),
		"first_name_en":               orStr(uFirstNameEn),
		"last_name_en":                orStr(uLastNameEn),
		"iden_number":                 orStr(uBirthCertNo),
		"iden_classified_number":      orStr(uBirthCertSeries),
		"iden_serial_number":          "",
		"birth_place":                 birthCity,
		"iden_issue_place":            issueCity,
		"birth_date":                  saminJalaliDay(uBirthDate),
		"nationality":                 saminMapNationality(saminDerefStr(uNationality)),
		"temp_certificate_code":       "",
		"final_certificate_code":      "",
		"military_edu_exemption_code": "",
		"address":                     orStr(uAddress),
		"graduate_state":              saminMapGraduateState(saminDerefStr(sStatus)),
		"native_type":                 orStr(sNativeType),
		"ethnicity":                   orStr(sEthnicity),
		"military":                    "",
		"father_name":                 orStr(uFatherName),
		"gender":                      saminMapGender(saminDerefStr(uGender)),
		"religion":                    orStr(uReligion),
		"marriage_status":             "",
		"address_country":             "120001",
		"address_province":            addrProv,
		"address_city":                addrCity,
		"postalcode":                  orStr(uPostalCode),
		"email":                       orStr(uEmail),
		"mobile":                      orStr(uMobile),
		"total_average":               orStr(sTotalAverage),
		"edu_start_year":              saminEduYear(derefI64(sEntryYear)),
		"edu_start_semester":          entryTerm,
		"graduate_date":               orStr(sGraduateDate),
		"graduate_certificate_level":  "",
		"edu_end_year":                saminEduYear(derefI64(sEduEndYear)),
		"edu_end_semester":            intOrEmpty(sEduEndSemester),
		"faculty_pardis":              "",
		"faculty_daneshkadeh":         "",
		"faculty_group":               "",
		"faculty_pardis_title":        "",
		"faculty_daneshkadeh_title":   "",
		"faculty_group_title":         "",
		"scholarship":                 "",
		"sanjesh_file_number":         "",
		"sanjesh_applicant_number":    "",
		"field":                       orStr(sSaminFieldCode),
		"local_field":                 orStr(sSaminLocalFieldCode),
		"level":                       levelCode,
		"acceptance_allocation":       orStr(sAcceptanceAllocation),
		"acceptance_type":             orStr(sAcceptanceType),
		"studying_mode":               orStr(sStudyingMode),
		"training_method":             orStr(sTrainingMethod),
		"isaar_code":                  orStr(sIsaarCode),
		"totaltakenunits_count":       int64OrEmpty(sTotalTaken),
		"totalpassedunits_count":      int64OrEmpty(sTotalPassed),
		"totalfailedunits_count":      int64OrEmpty(sTotalFailed),
		"is_alive":                    isAlive,
		"birth_place_title":           orStr(uPlaceOfBirth),
		"iden_issue_place_title":      orStr(uPlaceOfIssue),
		"is_verified":                 isVerified,
		"verify_check_date":           saminJalaliDay(uSaminVerifyCheckDate),
		"description":                 orStr(sSaminDescription),
	}, nil
}

// fallbackPk اگر کلید مبدأ خالی بود، شناسهٔ داخلی.
func fallbackPk(pk string, id int64) string {
	if pk != "" {
		return ""
	}
	return strconv.FormatInt(id, 10)
}

func intOrEmpty(v *int64) string {
	if v == nil || *v == 0 {
		return ""
	}
	return strconv.FormatInt(*v, 10)
}

func int64OrEmpty(v *int64) string {
	if v == nil || *v == 0 {
		return ""
	}
	return strconv.FormatInt(*v, 10)
}

// ═══════════════ کنش‌ها (پورت actions.ts) ═══════════════

// SaminEnqueue ساخت صف ثمین از دانشجویان یک دانشگاه (پورت enqueueForSamin).
func (s *Service) SaminEnqueue(ctx context.Context, universityID int64) (inserted, skipped int, err error) {
	rows, err := s.DB.Pool.Query(ctx, `select id from students where "universityId" = $1 limit 5000`, universityID)
	if err != nil {
		return 0, 0, err
	}
	var ids []int64
	for rows.Next() {
		var id int64
		if rows.Scan(&id) == nil {
			ids = append(ids, id)
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, 0, err
	}
	for _, sid := range ids {
		payload, perr := s.SaminBuildStudentPayload(ctx, sid)
		if perr != nil || payload == nil {
			skipped++
			continue
		}
		pk := saminStrOf(payload["person_pk_in_source"])
		if pk == "" {
			pk = strconv.FormatInt(sid, 10)
		}
		var dupID int64
		if e := s.DB.Pool.QueryRow(ctx, `
			select id from samin_staging where "universityId" = $1 and "entityCode" = '1000' and "personPkInSource" = $2 limit 1`,
			universityID, pk).Scan(&dupID); e == nil && dupID > 0 {
			skipped++
			continue
		}
		raw, _ := jsonMarshal(payload)
		if _, ierr := s.DB.Pool.Exec(ctx, `
			insert into samin_staging ("universityId","entityCode","personPkInSource","studentPkInSource",payload,status)
			values ($1,'1000',$2,$3,$4,'PENDING') on conflict do nothing`,
			universityID, pk, saminStrOf(payload["student_pk_in_source"]), raw); ierr == nil {
			inserted++
		} else {
			skipped++
		}
	}
	return inserted, skipped, nil
}

// SaminSendRows ارسال صف PENDING به ثمین و علامت SENT (پورت sendToSamin).
func (s *Service) SaminSendRows(ctx context.Context, universityID int64, entityCode string) (map[string]any, error) {
	rows, err := s.DB.Pool.Query(ctx, `
		select id, payload::text from samin_staging
		 where "universityId" = $1 and "entityCode" = $2 and status = 'PENDING' limit 50`, universityID, entityCode)
	if err != nil {
		return nil, err
	}
	type stagedRow struct {
		id      int64
		payload map[string]any
	}
	var batch []stagedRow
	for rows.Next() {
		var r stagedRow
		var raw []byte
		if rows.Scan(&r.id, &raw) == nil {
			var p map[string]any
			if jsonUnmarshal(raw, &p) == nil {
				r.payload = p
				batch = append(batch, r)
			}
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(batch) == 0 {
		return nil, errors.New("صفی برای ارسال نیست — ابتدا آماده‌سازی را بزنید")
	}
	dataObject := make([]map[string]any, 0, len(batch))
	for _, r := range batch {
		dataObject = append(dataObject, r.payload)
	}
	res, err := s.SaminBulkImport(ctx, universityID, entityCode, dataObject)
	if err != nil {
		return nil, err
	}
	traceID := traceAsInt64(res)
	for _, r := range batch {
		_, _ = s.DB.Pool.Exec(ctx, `
			update samin_staging set status = 'SENT', "traceId" = $2, "sentAt" = now() where id = $1`, r.id, traceID)
	}
	return res, nil
}

func traceAsInt64(res map[string]any) any {
	for _, k := range []string{"trace_id", "traceId"} {
		switch v := res[k].(type) {
		case float64:
			return int64(v)
		case string:
			if n, err := strconv.ParseInt(v, 10, 64); err == nil && n > 0 {
				return n
			}
		}
	}
	return nil
}

// SaminSendSampleGraduates ارسال «نمونه» — چند فارغ‌التحصیل مشخص (پورت sendSampleGraduatesToSamin).
func (s *Service) SaminSendSampleGraduates(ctx context.Context, universityID int64, count int) (map[string]any, error) {
	if count < 1 {
		count = 2
	}
	if count > 10 {
		count = 10
	}
	rows, err := s.DB.Pool.Query(ctx, `
		select id from students where "universityId" = $1 and status = 'GRADUATED' order by id limit $2`,
		universityID, count)
	if err != nil {
		return nil, err
	}
	var ids []int64
	for rows.Next() {
		var id int64
		if rows.Scan(&id) == nil {
			ids = append(ids, id)
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(ids) == 0 {
		return nil, errors.New("برای این مؤسسه دانش‌آموخته‌ای با وضعیت «فارغ‌التحصیل» پیدا نشد.")
	}
	type sampleRow struct {
		pk        string
		studentPk string
		payload   map[string]any
	}
	var batch []sampleRow
	for _, sid := range ids {
		payload, perr := s.SaminBuildStudentPayload(ctx, sid)
		if perr != nil || payload == nil {
			continue
		}
		pk := saminStrOf(payload["person_pk_in_source"])
		if pk == "" {
			pk = strconv.FormatInt(sid, 10)
		}
		spk := saminStrOf(payload["student_pk_in_source"])
		if spk == "" {
			spk = strconv.FormatInt(sid, 10)
		}
		batch = append(batch, sampleRow{pk: pk, studentPk: spk, payload: payload})
	}
	if len(batch) == 0 {
		return nil, errors.New("ساخت payload برای نمونه‌ها ناموفق بود (دادهٔ دانشجو ناقص است).")
	}
	// ثبت در همان صف تا در صفحه قابل رصد باشد (تکراری‌ها بی‌اثر)
	for _, b := range batch {
		raw, _ := jsonMarshal(b.payload)
		_, _ = s.DB.Pool.Exec(ctx, `
			insert into samin_staging ("universityId","entityCode","personPkInSource","studentPkInSource",payload,status)
			values ($1,'1000',$2,$3,$4,'PENDING') on conflict do nothing`, universityID, b.pk, b.studentPk, raw)
	}
	dataObject := make([]map[string]any, 0, len(batch))
	for _, b := range batch {
		dataObject = append(dataObject, b.payload)
	}
	res, err := s.SaminBulkImport(ctx, universityID, "1000", dataObject)
	if err != nil {
		return nil, err
	}
	traceID := traceAsInt64(res)
	for _, b := range batch {
		_, _ = s.DB.Pool.Exec(ctx, `
			update samin_staging set status = 'SENT', "traceId" = $3, "sentAt" = now()
			 where "universityId" = $1 and "entityCode" = '1000' and "personPkInSource" = $2`,
			universityID, b.pk, traceID)
	}
	out := map[string]any{"sent": len(batch)}
	for k, v := range res {
		out[k] = v
	}
	return out, nil
}

// SaminOverview دادهٔ صفحهٔ هاب ثمین.
func (s *Service) SaminOverview(ctx context.Context, user *session.User, uniCookie, uniCode string) (map[string]any, error) {
	out := map[string]any{}

	unis := []map[string]any{}
	ur, err := s.DB.Pool.Query(ctx, `select id, code, title from universities order by code`)
	if err != nil {
		return nil, err
	}
	for ur.Next() {
		var id int64
		var code, title string
		if ur.Scan(&id, &code, &title) == nil {
			unis = append(unis, map[string]any{"id": id, "code": code, "title": title})
		}
	}
	ur.Close()
	out["universities"] = unis

	// دانشگاه فعال: پارامتر uni، بعد کوکی، بعد اولین دانشگاه
	var active map[string]any
	if activeID := s.UniversityID(ctx, user, uniCookie); activeID != nil && uniCode == "" {
		for _, u := range unis {
			if u["id"].(int64) == *activeID {
				active = u
			}
		}
	}
	if active == nil {
		for _, u := range unis {
			if uniCode != "" && u["code"] == uniCode {
				active = u
			}
		}
	}
	if active == nil && len(unis) > 0 {
		active = unis[0]
	}
	out["activeUniversity"] = active

	queueByUni := map[string]int{}
	qr, err := s.DB.Pool.Query(ctx, `
		select "universityId", count(*)::int from samin_staging group by 1`)
	if err == nil {
		for qr.Next() {
			var uni int64
			var n int
			if qr.Scan(&uni, &n) == nil {
				queueByUni[strconv.FormatInt(uni, 10)] = n
			}
		}
		qr.Close()
	}
	out["queueByUniversity"] = queueByUni

	if active != nil {
		aid := active["id"].(int64)
		staging := []map[string]any{}
		sr, err := s.DB.Pool.Query(ctx, `
			select id, "entityCode", "personPkInSource", status, "traceId", "errorMessage", "createdAt"::text
			  from samin_staging where "universityId" = $1 order by "createdAt" desc limit 50`, aid)
		if err == nil {
			for sr.Next() {
				var id int64
				var entityCode, status string
				var pk, errMsg *string
				var traceID *int64
				var createdAt *string
				if sr.Scan(&id, &entityCode, &pk, &status, &traceID, &errMsg, &createdAt) == nil {
					staging = append(staging, map[string]any{"id": id, "entityCode": entityCode,
						"personPkInSource": pk, "status": status, "traceId": traceID, "errorMessage": errMsg, "createdAt": createdAt})
				}
			}
			sr.Close()
		}
		out["staging"] = staging

		logs := []map[string]any{}
		lr, err := s.DB.Pool.Query(ctx, `
			select id, "entityCode", "traceId", status, "summaryResult"::text, "createdAt"::text
			  from samin_sync_logs where "universityId" = $1 order by "createdAt" desc limit 20`, aid)
		if err == nil {
			for lr.Next() {
				var id int64
				var entityCode, status string
				var traceID *int64
				var summary *string
				var createdAt *string
				if lr.Scan(&id, &entityCode, &traceID, &status, &summary, &createdAt) == nil {
					logs = append(logs, map[string]any{"id": id, "entityCode": entityCode,
						"traceId": traceID, "status": status, "summaryResult": summary, "createdAt": createdAt})
				}
			}
			lr.Close()
		}
		out["logs"] = logs
	}
	return out, nil
}
