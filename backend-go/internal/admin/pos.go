// ═══ POS terminals and transactions — port of lib/pos-actions.ts ═══
package admin

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"backend-go/internal/session"
)

// ═══ Ported safety principles ═══
//   • Amount: positive integer rials only, up to 10,000,000,000 (safeRials)
//   • Transaction type is not accepted from the client — a sale is always SALE
//   • Payment remains PENDING until bank verification and is not recorded in the financial ledger
//   • Void: row lock, 24-hour window, separation of duties, reversal linked to the original

const posMaxRials = 10_000_000_000

var posVoidSeniorRoles = map[string]bool{"ADMIN": true, "FINANCE_EXPERT": true, "FINANCE": true}

// PosTerminal: POS terminal.
type PosTerminal struct {
	ID          int64   `json:"id"`
	Code        string  `json:"code"`
	Title       string  `json:"title"`
	Location    *string `json:"location"`
	GatewayID   *int64  `json:"gatewayId"`
	TerminalNo  *string `json:"terminalId"`
	MerchantID  *string `json:"merchantId"`
	IsActive    bool    `json:"isActive"`
	SortOrder   *int    `json:"sortOrder"`
	Note        *string `json:"note"`
}

// PosTxn: POS transaction.
type PosTxn struct {
	ID            int64    `json:"id"`
	Stan          string   `json:"stan"`
	Rrn           *string  `json:"rrn"`
	Amount        float64  `json:"amount"`
	TxnType       string   `json:"txnType"`
	EntryMode     string   `json:"entryMode"`
	Status        string   `json:"status"`
	ResponseCode  *string  `json:"responseCode"`
	CardPan       *string  `json:"cardPan"`
	Cardholder    *string  `json:"cardholderName"`
	CreatedAt     *string  `json:"createdAt"`
	TerminalCode  string   `json:"terminalCode"`
	TerminalTitle string   `json:"terminalTitle"`
	StudentCode   string   `json:"studentCode"`
	StudentName   string   `json:"studentName"`
}

// GetPosTerminals port of getPosTerminals.
func (s *Service) GetPosTerminals(ctx context.Context, user *session.User, uniCookie string) ([]PosTerminal, error) {
	uniID := s.UniversityID(ctx, user, uniCookie)
	out := []PosTerminal{}
	if uniID == nil {
		return out, nil
	}
	rows, err := s.DB.Pool.Query(ctx, `
		select id, code, title, location, "gatewayId", "terminal_id", "merchant_id", "isActive", "sortOrder", note
		  from pos_terminals
		 where "universityId" = $1 and "isActive" = 1
		 order by "sortOrder"`, *uniID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var t PosTerminal
		var active *int
		if err := rows.Scan(&t.ID, &t.Code, &t.Title, &t.Location, &t.GatewayID, &t.TerminalNo, &t.MerchantID, &active, &t.SortOrder, &t.Note); err == nil {
			t.IsActive = active != nil && *active == 1
			out = append(out, t)
		}
	}
	return out, nil
}

// GetPosTransactions port of getPosTransactions.
func (s *Service) GetPosTransactions(ctx context.Context, user *session.User, uniCookie, studentCode, status string, limit int) ([]PosTxn, error) {
	uniID := s.UniversityID(ctx, user, uniCookie)
	out := []PosTxn{}
	if uniID == nil {
		return out, nil
	}
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	args := []any{*uniID}
	extra := ""
	if studentCode = strings.TrimSpace(studentCode); studentCode != "" {
		extra += ` and st."studentCode" = $2`
		args = append(args, studentCode)
	}
	if status = strings.TrimSpace(status); status != "" {
		args = append(args, status)
		extra += fmt.Sprintf(` and pt.status = $%d`, len(args))
	}
	args = append(args, limit)
	rows, err := s.DB.Pool.Query(ctx, `
		select pt.id, pt.stan, pt.rrn, pt.amount::float8, pt.txn_type, pt.entry_mode, pt.status,
		       pt.response_code, pt.card_pan, pt.cardholder_name, pt."createdAt"::text,
		       t.code, t.title, st."studentCode",
		       coalesce(u."firstName" || ' ' || u."lastName",'')
		  from pos_transactions pt
		  join pos_terminals t on t.id = pt."terminalId"
		  join students st on st.id = pt."studentId"
		  join users u on u.id = st."userId"
		 where pt."universityId" = $1`+extra+`
		 order by pt."createdAt" desc
		 limit $`+fmt.Sprintf("%d", len(args)), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var t PosTxn
		if err := rows.Scan(&t.ID, &t.Stan, &t.Rrn, &t.Amount, &t.TxnType, &t.EntryMode, &t.Status,
			&t.ResponseCode, &t.CardPan, &t.Cardholder, &t.CreatedAt,
			&t.TerminalCode, &t.TerminalTitle, &t.StudentCode, &t.StudentName); err == nil {
			t.StudentName = strings.TrimSpace(t.StudentName)
			out = append(out, t)
		}
	}
	return out, nil
}

// PosSaleInput: sale recording input.
type PosSaleInput struct {
	TerminalCode     string  `json:"terminalCode"`
	StudentCode      string  `json:"studentCode"`
	Amount           float64 `json:"amount"`
	Stan             string  `json:"stan"`
	Rrn              string  `json:"rrn"`
	AuthorizationRef string  `json:"authorizationRef"`
	EntryMode        string  `json:"entryMode"`
	CardPan          string  `json:"cardPan"`
	CardholderName   string  `json:"cardholderName"`
	Description      string  `json:"description"`
}

// RecordPosSale port of recordPosSale — PENDING sale without a financial ledger entry.
func (s *Service) RecordPosSale(ctx context.Context, user *session.User, uniCookie string, in PosSaleInput) (*PosTxn, error) {
	uniID := s.UniversityID(ctx, user, uniCookie)
	if uniID == nil {
		return nil, errors.New("دانشگاه فعال یافت نشد")
	}
	if in.Amount <= 0 || in.Amount > posMaxRials || in.Amount != float64(int64(in.Amount)) {
		return nil, errors.New("مبلغ نامعتبر است؛ مبلغ باید عدد صحیح مثبت (ریال) و حداکثر ۱۰٬۰۰۰٬۰۰۰٬۰۰۰ باشد")
	}
	stan := strings.TrimSpace(in.Stan)
	if stan == "" {
		return nil, errors.New("STAN تراکنش الزامی است")
	}
	authRef := strings.TrimSpace(in.AuthorizationRef)
	if len(authRef) < 6 || len(authRef) > 40 {
		return nil, errors.New("شناسهٔ مجوز بانکی (authorizationRef) الزامی است و باید ۶ تا ۴۰ نویسه باشد")
	}
	terminal, err := s.getPosTerminal(ctx, *uniID, in.TerminalCode)
	if err != nil {
		return nil, err
	}
	var studentID int64
	var studentCode string
	err = s.DB.Pool.QueryRow(ctx, `
		select id, "studentCode" from students
		 where "studentCode" = $1 and "universityId" = $2 limit 1`, strings.TrimSpace(in.StudentCode), *uniID).
		Scan(&studentID, &studentCode)
	if err != nil {
		return nil, errors.New("دانشجو با این شماره دانشجویی یافت نشد")
	}
	// Active fiscal term ← current academic term
	var financialTermID *int64
	var ftID int64
	if err := s.DB.Pool.QueryRow(ctx, `
		select id from financial_terms where "universityId" = $1 and "isActive" = 1
		 order by "sortOrder" asc nulls last limit 1`, *uniID).Scan(&ftID); err == nil {
		financialTermID = &ftID
	}
	var termID *int64
	var atID int64
	if err := s.DB.Pool.QueryRow(ctx, `
		select id from academic_terms where "universityId" = $1 and "isCurrent" = 1 limit 1`, *uniID).Scan(&atID); err == nil {
		termID = &atID
	}

	tx, err := s.DB.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	var existing int64
	if err := tx.QueryRow(ctx, `select id from pos_transactions where "terminalId" = $1 and stan = $2 limit 1`, terminal.ID, stan).
		Scan(&existing); err == nil {
		return nil, fmt.Errorf("تراکنش با STAN %s روی این ترمینال قبلاً ثبت شده", stan)
	}
	entryMode := in.EntryMode
	switch entryMode {
	case "CHIP", "CONTACTLESS", "MAGSTRIPE", "FALLBACK", "MANUAL":
	default:
		entryMode = "MANUAL"
	}
	desc := strings.TrimSpace(in.Description)
	if desc == "" {
		desc = "پرداخت POS - " + terminal.Title
	}
	var id int64
	err = tx.QueryRow(ctx, `
		insert into pos_transactions ("universityId","studentId","termId","financialTermId","terminalId",
		  stan, rrn, amount, txn_type, entry_mode, status, response_code, response_message,
		  card_pan, cardholder_name, operator_id, note)
		values ($1,$2,$3,$4,$5,$6,$7,$8,'SALE',$9,'PENDING',null,'PENDING_VERIFICATION',$10,$11,$12,$13)
		returning id`,
		*uniID, studentID, termID, financialTermID, terminal.ID, stan, nullIfEmpty(in.Rrn),
		fmtNum(in.Amount), entryMode, maskPan(in.CardPan), nullIfEmpty(in.CardholderName),
		user.ID, desc+authSuffix(authRef)).Scan(&id)
	if err != nil {
		if strings.Contains(err.Error(), "duplicate key") || strings.Contains(err.Error(), "uq_pos_txn") {
			return nil, errors.New("تراکنش تکراری است؛ این STAN روی این ترمینال قبلاً ثبت شده است")
		}
		return nil, errors.New("خطا در ثبت پرداخت POS")
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &PosTxn{
		ID: id, Stan: stan, Rrn: nullIfEmpty(in.Rrn), Amount: in.Amount, TxnType: "SALE",
		EntryMode: entryMode, Status: "PENDING", TerminalCode: terminal.Code, TerminalTitle: terminal.Title,
		StudentCode: studentCode, CardPan: strPtr(maskPan(in.CardPan)), Cardholder: nullIfEmpty(in.CardholderName),
	}, nil
}

func authSuffix(authRef string) string { return " | AUTH:" + authRef }

func nullIfEmpty(v string) *string {
	if t := strings.TrimSpace(v); t != "" {
		return &t
	}
	return nil
}

func strPtr(v string) *string { return &v }

// maskPan: mask the card number — first six and last four digits.
func maskPan(pan string) string {
	digits := make([]rune, 0, len(pan))
	for _, r := range pan {
		if r >= '0' && r <= '9' {
			digits = append(digits, r)
		}
	}
	if len(digits) < 10 {
		return "****"
	}
	return string(digits[:6]) + "******" + string(digits[len(digits)-4:])
}

func (s *Service) getPosTerminal(ctx context.Context, uniID int64, code string) (*PosTerminal, error) {
	var t PosTerminal
	var active *int
	err := s.DB.Pool.QueryRow(ctx, `
		select id, code, title, location, "gatewayId", "terminal_id", "merchant_id", "isActive", "sortOrder", note
		  from pos_terminals
		 where "universityId" = $1 and code = $2 and "isActive" = 1 limit 1`, uniID, strings.TrimSpace(code)).
		Scan(&t.ID, &t.Code, &t.Title, &t.Location, &t.GatewayID, &t.TerminalNo, &t.MerchantID, &active, &t.SortOrder, &t.Note)
	if err != nil {
		return nil, errors.New("ترمینال POS یافت نشد یا غیرفعال است")
	}
	t.IsActive = active != nil && *active == 1
	return &t, nil
}

// voidStan: unique identifier of the void transaction.
func voidStan(stan string) string {
	b := make([]byte, 4)
	_, _ = rand.Read(b)
	suffix := hex.EncodeToString(b)
	out := stan + "V" + suffix
	if len(out) > 20 {
		out = out[:20]
	}
	return out
}

// VoidPosTransaction port of voidPosTransaction — void with financial ledger reversal.
func (s *Service) VoidPosTransaction(ctx context.Context, user *session.User, uniCookie, terminalCode, stan, reason string) error {
	uniID := s.UniversityID(ctx, user, uniCookie)
	if uniID == nil {
		return errors.New("دانشگاه فعال یافت نشد")
	}
	cleanReason := strings.TrimSpace(reason)
	if cleanReason == "" {
		return errors.New("دلیل ویدی الزامی است")
	}
	terminal, err := s.getPosTerminal(ctx, *uniID, terminalCode)
	if err != nil {
		return err
	}
	senior := false
	for _, r := range user.Roles {
		if posVoidSeniorRoles[r] {
			senior = true
			break
		}
	}

	tx, err := s.DB.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var txnID, studentID int64
	var termIDVal, financialTermIDVal int64
	var origAmount float64
	var operatorIDVal int64
	var entryMode, cardPan string
	var cardholder *string
	var rrn *string
	var createdAt time.Time
	err = tx.QueryRow(ctx, `
		select id, "studentId", coalesce("termId",0), coalesce("financialTermId",0),
		       amount::float8, coalesce(operator_id,0),
		       entry_mode, card_pan, cardholder_name, rrn, "createdAt"
		  from pos_transactions
		 where "terminalId" = $1 and stan = $2 and status = 'APPROVED'
		 for update`, terminal.ID, strings.TrimSpace(stan)).
		Scan(&txnID, &studentID, &termIDVal, &financialTermIDVal, &origAmount, &operatorIDVal,
			&entryMode, &cardPan, &cardholder, &rrn, &createdAt)
	if err != nil {
		return fmt.Errorf("تراکنش اصلی یافت نشد یا قبلاً وید شده: %w", err)
	}
	var termID, financialTermID *int64
	if termIDVal > 0 {
		termID = &termIDVal
	}
	if financialTermIDVal > 0 {
		financialTermID = &financialTermIDVal
	}
	var operatorID *int64
	if operatorIDVal > 0 {
		operatorID = &operatorIDVal
	}
	isSameOperator := operatorID != nil && *operatorID == user.ID
	if isSameOperator && !senior {
		return errors.New("ویدی توسط همان صندوق‌دارِ عامل به‌تنهایی مجاز نیست؛ تأیید دوم (کاربر دیگر یا نقش مالی ارشد) لازم است")
	}
	if time.Since(createdAt) > 24*time.Hour && !senior {
		return errors.New("مهلت ویدی (۲۴ ساعت) گذشته است؛ ویدی دیرهنگام فقط با نقش مالی ارشد ممکن است")
	}
	if origAmount <= 0 {
		return errors.New("مبلغ تراکنش اصلی نامعتبر است؛ ویدی ممکن نیست")
	}

	var voidID int64
	if err := tx.QueryRow(ctx, `
		insert into pos_transactions ("universityId","studentId","termId","financialTermId","terminalId",
		  stan, rrn, amount, txn_type, entry_mode, status, response_code, response_message,
		  card_pan, cardholder_name, operator_id, note)
		values ($1,$2,$3,$4,$5,$6,$7,$8,'VOID',$9,'APPROVED','00','VOIDED',$10,$11,$12,$13)
		returning id`,
		*uniID, studentID, termID, financialTermID, terminal.ID, voidStan(stan), rrn, fmtNum(origAmount),
		entryMode, cardPan, cardholder, user.ID, "ویدی تراکنش "+stan+" - "+cleanReason).Scan(&voidID); err != nil {
		return errors.New("خطا در ویدی تراکنش POS")
	}

	// Primary financial ledger row: ledgerTxnId, otherwise look up by referenceId
	var originalLedgerID *int64
	var ledgerTxnID *int64
	_ = tx.QueryRow(ctx, `select "ledgerTxnId" from pos_transactions where id = $1`, txnID).Scan(&ledgerTxnID)
	if ledgerTxnID != nil {
		var id int64
		if err := tx.QueryRow(ctx, `select id from student_ledger where id = $1 and "studentId" = $2`, *ledgerTxnID, studentID).Scan(&id); err == nil {
			originalLedgerID = &id
		}
	}
	if originalLedgerID == nil {
		var id int64
		if err := tx.QueryRow(ctx, `
			select id from student_ledger
			 where "referenceId" = $1 and "transactionType" = 'POS_PAYMENT' and "studentId" = $2 limit 1`, txnID, studentID).Scan(&id); err == nil {
			originalLedgerID = &id
		}
	}
	if originalLedgerID == nil {
		return errors.New("ردیف اصلی دفتر مالی برای این تراکنش یافت نشد؛ ویدی ممکن نیست")
	}

	// Financial ledger reversal — negative amount with the same type, referenceId to the original
	var dup int64
	_ = tx.QueryRow(ctx, `
		select count(*) from student_ledger where "referenceId" = $1 and amount::numeric < 0`, *originalLedgerID).Scan(&dup)
	var origLedgerAmount float64
	_ = tx.QueryRow(ctx, `select amount::numeric::float8 from student_ledger where id = $1 for update`, *originalLedgerID).Scan(&origLedgerAmount)
	if origLedgerAmount <= 0 || origAmount > origLedgerAmount {
		return errors.New("مبلغ برگشتی از ماندهٔ قابل‌برگشت بیشتر است")
	}
	var revID int64
	err = tx.QueryRow(ctx, `
		insert into student_ledger ("studentId","termId","transactionType",amount,description,"referenceId","universityId")
		values ($1,$2,'POS_PAYMENT',$3,$4,$5,$6) returning id`,
		studentID, termID, fmtNum(-origAmount),
		"برگشتی POS_PAYMENT — ردیف اصلی #"+fmt.Sprint(*originalLedgerID)+" — "+"ویدی پرداخت POS - تراکنش اصلی STAN:"+stan+" - "+cleanReason,
		*originalLedgerID, *uniID).Scan(&revID)
	if err != nil {
		return errors.New("خطا در برگشتی دفتر مالی؛ ویدی برگشت داده شد")
	}
	if _, err := tx.Exec(ctx, `update pos_transactions set status = 'VOIDED', note = coalesce(note,'') || ' | VOIDED: ' || $2 where id = $1`, txnID, cleanReason); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `update pos_transactions set "ledgerTxnId" = $2 where id = $1`, voidID, revID); err != nil {
		return err
	}
	details := fmt.Sprintf(`{"studentId":%d,"amount":%s,"originalLedgerId":%d,"voidTxnId":%d}`, studentID, fmtNum(-origAmount), *originalLedgerID, voidID)
	if err := s.writeAdminAuditTx(ctx, tx, user.ID, "FINANCE_LEDGER_POS_PAYMENT_REVERSAL", "student_ledger", revID, details); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// writeAdminAuditTx: transactional version of the hash-chain audit.
func (s *Service) writeAdminAuditTx(ctx context.Context, tx pgx.Tx, actorUserID int64, action, entityType string, entityID int64, details string) error {
	var prev string
	if err := tx.QueryRow(ctx, `select coalesce(hash,'') from audit_logs order by id desc limit 1 for update`).Scan(&prev); err != nil && err != pgx.ErrNoRows {
		prev = ""
	}
	h := sha256.Sum256([]byte(prev + "|" + action + "|" + entityType + "|" + strconv.FormatInt(entityID, 10) + "|" + details))
	hash := hex.EncodeToString(h[:])
	_, err := tx.Exec(ctx, `
		insert into audit_logs ("actorUserId", action, "entityType", "entityId", details, "prevHash", hash)
		values ($1,$2,$3,$4,$5,$6,$7)`,
		actorUserID, action, entityType, entityID, details, prev, hash)
	return err
}
