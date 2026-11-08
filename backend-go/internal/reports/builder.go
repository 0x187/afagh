// ═══ Report builder (Wave 2) — port of admin/reports/saved (engine + actions) ═══
//
// Ports engine.ts (SELECT engine over a code-defined catalog) and actions.ts
// (save/list/delete/run of saved reports in the saved_reports table).
//
// Security — the three hard rules from the reference carry over unchanged:
//  1. Every SQL fragment (FROM, columns, GROUP BY, ORDER BY) comes ONLY from the
//     hardcoded catalog below. No user-supplied string ever reaches the SQL text.
//  2. Every filter VALUE is a bound parameter ($n) — never string-concatenated.
//  3. Output column aliases are validated against ^[A-Za-z_][A-Za-z0-9_]{0,62}$
//     and always quoted, so the original column case is preserved
//     (Postgres would otherwise fold studentCode to studentcode).
//
// University scope is fail-closed: without a resolvable active university the
// engine returns an error instead of rows.
package reports

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"backend-go/internal/fa"
	"backend-go/internal/scope"
	"backend-go/internal/session"
)

// builderHardMaxRows is the hard server-side row cap (HARD_MAX_ROWS in engine.ts).
const builderHardMaxRows = 50000

// builderMaxPerPage caps the page size requested by clients.
const builderMaxPerPage = 200

var builderIdentRe = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]{0,62}$`)

// ─────────────────── catalog types (port of catalog/types.ts) ───────────────────

// BuilderOption is a static/dynamic option pair (value → Persian label).
type BuilderOption struct {
	Value string `json:"value"`
	Label string `json:"label"`
}

// builderField is one selectable column of a source (ReportField in the catalog).
type builderField struct {
	key        string
	title      string
	sqlExpr    string   // row-level SQL expression — catalog-only
	aggSql     string   // fixed aggregate expression (e.g. balance) — column is inherently aggregated
	agg        []string // aggregates the user may pick (numeric fields)
	typ        string   // text | number | money | date | datetime | bool
	format     string   // DATE | DATETIME | MONEY | NUMBER
	filterable bool
	ops        []string
	groupable  bool
	options    []BuilderOption
	ref        string // dynamic option source: terms, ledgerTypes, …
	hint       string
}

// builderSource is one reportable table view (ReportSource in the catalog).
type builderSource struct {
	key                string
	title              string
	icon               string
	description        string
	baseFrom           string // fixed FROM + JOINs
	universityColumn   string // fail-closed scope column, e.g. s."universityId"
	universityNullable bool   // scope becomes "(col = $n OR col IS NULL)" for legacy rows
	where              string // always-true condition combined with AND
	fields             []builderField
	groupKeys          []string // natural grouping keys of the source
	roles              []string // roles allowed to use this source (empty = all runners)
	maxRows            int
}

// BuilderSourceFieldMeta is the serializable field descriptor sent to the client.
type BuilderSourceFieldMeta struct {
	Key         string          `json:"key"`
	Title       string          `json:"title"`
	Type        string          `json:"type,omitempty"`
	Format      string          `json:"format,omitempty"`
	Filterable  bool            `json:"filterable"`
	Ops         []string        `json:"ops,omitempty"`
	Groupable   bool            `json:"groupable"`
	Agg         []string        `json:"agg,omitempty"`
	HasFixedAgg bool            `json:"hasFixedAgg"`
	Options     []BuilderOption `json:"options,omitempty"`
	Ref         string          `json:"ref,omitempty"`
	Hint        string          `json:"hint,omitempty"`
}

// BuilderSourceMeta is the serializable source sent to the builder page —
// WITHOUT any SQL fragment (the client never sees expressions).
type BuilderSourceMeta struct {
	Key         string                   `json:"key"`
	Title       string                   `json:"title"`
	Icon        string                   `json:"icon"`
	Description string                   `json:"description,omitempty"`
	Fields      []BuilderSourceFieldMeta `json:"fields"`
}

// ─────────────────── saved report config (port of SavedReportConfig) ───────────────────

// BuilderConfigColumn is one selected column of a saved report.
type BuilderConfigColumn struct {
	Field  string `json:"field"`
	Alias  string `json:"alias,omitempty"`
	Format string `json:"format,omitempty"`
	Agg    string `json:"agg,omitempty"` // sum/avg/min/max/count/count_distinct
}

// BuilderConfigFilter is one condition; Value may be a string or a list of strings.
type BuilderConfigFilter struct {
	Field string `json:"field"`
	Op    string `json:"op"`
	Value any    `json:"value,omitempty"`
}

// BuilderConfigOrder is one ORDER BY entry.
type BuilderConfigOrder struct {
	Field string `json:"field"`
	Dir   string `json:"dir"` // asc | desc
}

// SavedReportConfig is the stored report definition (jsonb in saved_reports.config).
type SavedReportConfig struct {
	Columns []BuilderConfigColumn `json:"columns"`
	Filters []BuilderConfigFilter `json:"filters"`
	GroupBy []string              `json:"groupBy,omitempty"`
	OrderBy []BuilderConfigOrder  `json:"orderBy,omitempty"`
}

// BuilderSaveInput is the save/edit payload.
type BuilderSaveInput struct {
	ID           int64             `json:"id"`
	Name         string            `json:"name"`
	Description  string            `json:"description"`
	SourceKey    string            `json:"sourceKey"`
	Config       SavedReportConfig `json:"config"`
	Visibility   string            `json:"visibility"` // PRIVATE | ROLE | PUBLIC
	AllowedRoles []string          `json:"allowedRoles"`
}

// BuilderResult is one page of engine output (EngineResult in engine.ts).
type BuilderResult struct {
	Columns    []Column         `json:"columns"`
	Rows       []map[string]any `json:"rows"`
	Total      int              `json:"total"`
	Page       int              `json:"page"`
	Per        int              `json:"per"`
	TotalPages int              `json:"totalPages"`
	Notes      []string         `json:"notes,omitempty"`
}

// SavedReportRow is a saved report as seen by the caller (types.ts SavedReportRow).
type SavedReportRow struct {
	ID           int64             `json:"id"`
	Name         string            `json:"name"`
	Description  *string           `json:"description"`
	SourceKey    string            `json:"sourceKey"`
	SourceTitle  string            `json:"sourceTitle"`
	SourceIcon   string            `json:"sourceIcon"`
	Visibility   string            `json:"visibility"`
	AllowedRoles []string          `json:"allowedRoles"`
	OwnerUserID  int64             `json:"ownerUserId"`
	OwnerName    string            `json:"ownerName"`
	IsOwner      bool              `json:"isOwner"`
	CreatedAt    string            `json:"createdAt"`
	UpdatedAt    string            `json:"updatedAt"`
	Config       SavedReportConfig `json:"config"`
}

// BuilderCatalogOptions are the dynamic filter options of the builder page.
type BuilderCatalogOptions struct {
	Terms           []BuilderOption `json:"terms"`
	FinancialTerms  []BuilderOption `json:"financialTerms"`
	DepositTypes    []BuilderOption `json:"depositTypes"`
	LedgerTypes     []BuilderOption `json:"ledgerTypes"`
	PaymentStatuses []BuilderOption `json:"paymentStatuses"`
	Faculties       []BuilderOption `json:"faculties"`
	Majors          []BuilderOption `json:"majors"`
}

// ─────────────────── static option lists (catalog/finance.ts) ───────────────────

// builderLedgerTypes — 17 transaction types of the finance ledger.
var builderLedgerTypes = []BuilderOption{
	{Value: "TUITION_FIXED", Label: "شهریه ثابت"},
	{Value: "TUITION_VARIABLE", Label: "شهریه متغیر"},
	{Value: "TUITION_CHARGE", Label: "شارژ شهریهٔ ترم"},
	{Value: "CHARGE", Label: "شارژ سایر"},
	{Value: "SUBJECT_ADDITIVE", Label: "اضافه‌بارِ درس"},
	{Value: "POS_REFUND", Label: "برگشت وجهِ کارت‌خوان"},
	{Value: "TUITION_ADJUST_DEC", Label: "تعدیل کاهشی شهریه"},
	{Value: "PAYMENT", Label: "پرداخت"},
	{Value: "POS_PAYMENT", Label: "پرداخت کارت‌خوان"},
	{Value: "DISCOUNT_FIXED", Label: "تخفیف ثابت"},
	{Value: "DISCOUNT_VARIABLE", Label: "تخفیف متغیر"},
	{Value: "SUBJECT_DEDUCTIVE", Label: "کسرِ درس"},
	{Value: "SPONSORSHIP", Label: "سازمانِ حامی"},
	{Value: "LOAN", Label: "وام"},
	{Value: "CREDIT", Label: "بستانکاری"},
	{Value: "TUITION_BATES", Label: "بیتسِ قدیمی (اعتبار)"},
	{Value: "TUITION_ADJUST_INC", Label: "تعدیل افزایشی شهریه"},
}

// builderDepositTypes — deposit kinds (extended at runtime with DISTINCT values).
var builderDepositTypes = []BuilderOption{
	{Value: "CASH", Label: "نقدی"},
	{Value: "POS", Label: "کارت‌خوان"},
	{Value: "ONLINE", Label: "درگاه اینترنتی"},
	{Value: "CHEQUE", Label: "چک"},
	{Value: "TRANSFER", Label: "حوالهٔ بانکی"},
	{Value: "LOAN", Label: "وام"},
	{Value: "OTHER", Label: "سایر"},
}

// builderPaymentStatuses — gateway payment statuses.
var builderPaymentStatuses = []BuilderOption{
	{Value: "INITIATED", Label: "آغازشده"},
	{Value: "REDIRECTED", Label: "هدایت‌شده به درگاه"},
	{Value: "VERIFIED", Label: "تأییدشده"},
	{Value: "FAILED", Label: "ناموفق"},
	{Value: "CANCELLED", Label: "لغوشده"},
	{Value: "EXPIRED", Label: "منقضی"},
}

// ─────────────────── the catalog (catalog/finance.ts, code-only) ───────────────────

// Ledger transaction groups — identical to the ready-made financial statement
// report so the builder's balance numbers never diverge from it.
const builderChargeTypes = `('TUITION_FIXED','TUITION_VARIABLE','SUBJECT_ADDITIVE','TUITION_CHARGE','CHARGE','TUITION_ADJUST_DEC')`
const builderDiscTypes = `('DISCOUNT_FIXED','DISCOUNT_VARIABLE','SUBJECT_DEDUCTIVE','TUITION_BATES','TUITION_ADJUST_INC')`
const builderPaidTypes = `('PAYMENT','POS_PAYMENT','LOAN','SPONSORSHIP')`

// builderBalanceLedgerJoin — per-student ledger sums computed BEFORE the join
// (LATERAL) so the balance source yields exactly one row per student.
const builderBalanceLedgerJoin = `LEFT JOIN LATERAL (
      SELECT sl2."studentId" AS "studentId",
        COALESCE(SUM(sl2."amount") FILTER (WHERE sl2."transactionType" IN ` + builderChargeTypes + `), 0)::bigint AS "charge",
        COALESCE(SUM(sl2."amount") FILTER (WHERE sl2."transactionType" IN ` + builderDiscTypes + `), 0)::bigint AS "discount",
        COALESCE(SUM(sl2."amount") FILTER (WHERE sl2."transactionType" IN ` + builderPaidTypes + `), 0)::bigint AS "paid",
        COUNT(sl2.id)::int AS "txnCount"
      FROM student_ledger sl2
      WHERE sl2."studentId" = s.id
        AND (sl2."universityId" = s."universityId" OR sl2."universityId" IS NULL)
      GROUP BY sl2."studentId"
    ) sl ON TRUE`

var builderLedgerFields = []builderField{
	{key: "studentCode", title: "شمارهٔ دانشجویی", sqlExpr: `s."studentCode"`, typ: "text", filterable: true, ops: []string{"eq", "like"}, groupable: true},
	{key: "studentName", title: "نام دانشجو", sqlExpr: `u."firstName" || ' ' || u."lastName"`, typ: "text", filterable: true, ops: []string{"like"}},
	{key: "nationalCode", title: "کد ملی", sqlExpr: `u."nationalCode"`, typ: "text", filterable: true, ops: []string{"eq", "like"}},
	{key: "major", title: "رشته", sqlExpr: `m.name`, typ: "text", filterable: true, ops: []string{"like"}, groupable: true},
	{key: "degree", title: "مقطع", sqlExpr: `d.title`, typ: "text", filterable: true, ops: []string{"like"}, groupable: true},
	{key: "entryYear", title: "سال ورود", sqlExpr: `s."entryYear"`, typ: "number", filterable: true, ops: []string{"eq", "gte", "lte", "between"}, groupable: true},
	{key: "termCode", title: "نیمسال", sqlExpr: `t."termCode"`, typ: "text", filterable: true, ops: []string{"eq", "in"}, ref: "terms", groupable: true},
	{key: "finTermCode", title: "نیمسال مالی", sqlExpr: `ft."termCode"`, typ: "text", filterable: true, ops: []string{"eq", "in"}, ref: "financialTerms", groupable: true},
	{key: "transactionType", title: "نوع تراکنش", sqlExpr: `sl."transactionType"`, typ: "text", filterable: true, ops: []string{"eq", "in"}, ref: "ledgerTypes", groupable: true},
	{key: "amount", title: "مبلغ", sqlExpr: `sl."amount"`, typ: "money", format: "MONEY", filterable: true, ops: []string{"eq", "gt", "gte", "lt", "lte", "between"}, agg: []string{"sum", "avg", "min", "max"}, hint: "قابل تجمیع (جمع/میانگین)"},
	{key: "description", title: "شرح", sqlExpr: `sl.description`, typ: "text", filterable: true, ops: []string{"like"}},
	{key: "depositType", title: "نوع واریز", sqlExpr: `sl."depositType"`, typ: "text", filterable: true, ops: []string{"eq", "in"}, ref: "depositTypes", groupable: true},
	{key: "depositDate", title: "تاریخ واریز", sqlExpr: `sl."depositDate"`, typ: "datetime", format: "DATETIME", filterable: true, ops: []string{"gte", "lte", "between"}},
	{key: "receiptNo", title: "شمارهٔ فیش", sqlExpr: `sl."receiptNo"`, typ: "text", filterable: true, ops: []string{"eq", "like"}},
	{key: "voucherNo", title: "شمارهٔ سند", sqlExpr: `sl."voucherNo"`, typ: "text", filterable: true, ops: []string{"eq", "like"}},
	{key: "payerName", title: "پرداخت‌کننده", sqlExpr: `sl."payerName"`, typ: "text", filterable: true, ops: []string{"like"}},
	{key: "bankName", title: "بانک", sqlExpr: `sl."bankName"`, typ: "text", filterable: true, ops: []string{"like"}, groupable: true},
	{key: "createdAt", title: "تاریخ ثبت", sqlExpr: `sl."createdAt"`, typ: "datetime", format: "DATETIME", filterable: true, ops: []string{"gte", "lte", "between"}},
}

var builderBalanceFields = []builderField{
	{key: "studentCode", title: "شمارهٔ دانشجویی", sqlExpr: `s."studentCode"`, typ: "text", filterable: true, ops: []string{"eq", "like"}, groupable: true},
	{key: "studentName", title: "نام دانشجو", sqlExpr: `u."firstName" || ' ' || u."lastName"`, typ: "text", filterable: true, ops: []string{"like"}, groupable: true},
	{key: "nationalCode", title: "کد ملی", sqlExpr: `u."nationalCode"`, typ: "text", filterable: true, ops: []string{"eq", "like"}},
	{key: "major", title: "رشته", sqlExpr: `m.name`, typ: "text", filterable: true, ops: []string{"like"}, groupable: true},
	{key: "degree", title: "مقطع", sqlExpr: `d.title`, typ: "text", filterable: true, ops: []string{"like"}, groupable: true},
	{key: "entryYear", title: "سال ورود", sqlExpr: `s."entryYear"`, typ: "number", filterable: true, ops: []string{"eq", "gte", "lte", "between"}, groupable: true},
	{key: "charge", title: "بدهی شهریه", sqlExpr: `COALESCE(sl."charge", 0)::bigint`, typ: "money", format: "MONEY", hint: "جمعِ اقلامِ بدهی‌ساز"},
	{key: "discount", title: "تخفیف", sqlExpr: `COALESCE(sl."discount", 0)::bigint`, typ: "money", format: "MONEY", hint: "جمعِ اقلامِ اعتباری"},
	{key: "paid", title: "پرداختی", sqlExpr: `COALESCE(sl."paid", 0)::bigint`, typ: "money", format: "MONEY", hint: "جمعِ پرداخت/وام/حمایت"},
	{key: "balance", title: "ماندهٔ بدهی", sqlExpr: `(COALESCE(sl."charge", 0) - COALESCE(sl."discount", 0) - COALESCE(sl."paid", 0))::bigint`, typ: "money", format: "MONEY", hint: "بدهی − تخفیف − پرداختی"},
	{key: "txnCount", title: "تعداد تراکنش", sqlExpr: `COALESCE(sl."txnCount", 0)::int`, typ: "number", format: "NUMBER"},
}

var builderPaymentFields = []builderField{
	{key: "authority", title: "شناسهٔ پرداخت", sqlExpr: `pt."authority"`, typ: "text", filterable: true, ops: []string{"eq", "like"}},
	{key: "amount", title: "مبلغ", sqlExpr: `pt."amount"`, typ: "money", format: "MONEY", filterable: true, ops: []string{"eq", "gt", "gte", "lt", "lte", "between"}, agg: []string{"sum", "avg", "min", "max"}},
	{key: "status", title: "وضعیت", sqlExpr: `pt."status"`, typ: "text", filterable: true, ops: []string{"eq", "in"}, ref: "paymentStatuses", groupable: true},
	{key: "gatewayStatus", title: "پاسخ درگاه", sqlExpr: `pt."gatewayStatus"`, typ: "text", filterable: true, ops: []string{"like"}},
	{key: "gateway", title: "درگاه", sqlExpr: `g.title`, typ: "text", filterable: true, ops: []string{"like"}, groupable: true},
	{key: "bankRefId", title: "پیگیری بانک", sqlExpr: `pt."bankRefId"`, typ: "text", filterable: true, ops: []string{"like"}},
	{key: "payerName", title: "پرداخت‌کننده", sqlExpr: `pt."payerName"`, typ: "text", filterable: true, ops: []string{"like"}},
	{key: "payerMobile", title: "موبایل پرداخت‌کننده", sqlExpr: `pt."payerMobile"`, typ: "text", filterable: true, ops: []string{"eq", "like"}},
	{key: "studentCode", title: "شمارهٔ دانشجویی", sqlExpr: `s."studentCode"`, typ: "text", filterable: true, ops: []string{"eq", "like"}, groupable: true},
	{key: "studentName", title: "نام دانشجو", sqlExpr: `u."firstName" || ' ' || u."lastName"`, typ: "text", filterable: true, ops: []string{"like"}},
	{key: "nationalCode", title: "کد ملی", sqlExpr: `u."nationalCode"`, typ: "text", filterable: true, ops: []string{"eq", "like"}},
	{key: "major", title: "رشته", sqlExpr: `m.name`, typ: "text", filterable: true, ops: []string{"like"}, groupable: true},
	{key: "termCode", title: "نیمسال", sqlExpr: `t."termCode"`, typ: "text", filterable: true, ops: []string{"eq", "in"}, ref: "terms", groupable: true},
	{key: "description", title: "شرح", sqlExpr: `pt.description`, typ: "text", filterable: true, ops: []string{"like"}},
	{key: "createdAt", title: "زمان ایجاد", sqlExpr: `pt."createdAt"`, typ: "datetime", format: "DATETIME", filterable: true, ops: []string{"gte", "lte", "between"}},
	{key: "verifiedAt", title: "زمان تأیید", sqlExpr: `pt."verifiedAt"`, typ: "datetime", format: "DATETIME", filterable: true, ops: []string{"gte", "lte", "between"}},
}

var builderTariffFields = []builderField{
	{key: "code", title: "کد تعرفه", sqlExpr: `tr.code`, typ: "text", filterable: true, ops: []string{"eq", "like"}},
	{key: "title", title: "عنوان", sqlExpr: `tr.title`, typ: "text", filterable: true, ops: []string{"like"}},
	{key: "degree", title: "مقطع", sqlExpr: `d.title`, typ: "text", filterable: true, ops: []string{"like"}, groupable: true},
	{key: "major", title: "رشته", sqlExpr: `m.name`, typ: "text", filterable: true, ops: []string{"like"}, groupable: true},
	{key: "faculty", title: "دانشکده", sqlExpr: `fc.name`, typ: "text", filterable: true, ops: []string{"like"}, groupable: true},
	{key: "termCode", title: "نیمسال مالی", sqlExpr: `fct."termCode"`, typ: "text", filterable: true, ops: []string{"eq", "in"}, ref: "financialTerms", groupable: true},
	{key: "entryYearFrom", title: "ورودی از", sqlExpr: `tr."entryYearFrom"`, typ: "number", filterable: true, ops: []string{"gte", "lte", "between"}},
	{key: "entryYearTo", title: "ورودی تا", sqlExpr: `tr."entryYearTo"`, typ: "number", filterable: true, ops: []string{"gte", "lte", "between"}},
	{key: "fixed", title: "شهریهٔ ثابت", sqlExpr: `tr."fixedAmount"`, typ: "money", format: "MONEY", filterable: true, ops: []string{"eq", "gt", "lte", "between"}, agg: []string{"sum", "avg", "min", "max"}},
	{key: "theory", title: "نظری / واحد", sqlExpr: `tr."perUnitTheory"`, typ: "money", format: "MONEY", filterable: true, ops: []string{"eq", "gt", "lte"}, agg: []string{"sum", "avg", "min", "max"}},
	{key: "practical", title: "عملی / واحد", sqlExpr: `tr."perUnitPractical"`, typ: "money", format: "MONEY", filterable: true, ops: []string{"eq", "gt", "lte"}, agg: []string{"sum", "avg", "min", "max"}},
	{key: "general", title: "عمومی / واحد", sqlExpr: `tr."perUnitGeneral"`, typ: "money", format: "MONEY", filterable: true, ops: []string{"eq", "gt", "lte"}, agg: []string{"sum", "avg", "min", "max"}},
	{key: "priority", title: "اولویت", sqlExpr: `tr.priority`, typ: "number", filterable: true, ops: []string{"eq", "lte", "gte"}, groupable: true},
	{key: "isActive", title: "وضعیت", sqlExpr: `CASE WHEN tr."isActive" = 1 THEN 'فعال' ELSE 'غیرفعال' END`, typ: "text", filterable: true, ops: []string{"eq"}, groupable: true},
	{key: "note", title: "یادداشت", sqlExpr: `tr.note`, typ: "text", filterable: true, ops: []string{"like"}},
}

var builderSources = []builderSource{
	{
		key:         "finance-ledger",
		title:       "گردش حساب دانشجو",
		icon:        "📒",
		description: "ریزِ تراکنش‌های دفتر مالی: شهریه، پرداخت، تخفیف، وام و…",
		baseFrom: `FROM student_ledger sl
	      JOIN students s ON s.id = sl."studentId"
	      JOIN users u ON u.id = s."userId"
	      LEFT JOIN majors m ON m.id = s."majorId"
	      LEFT JOIN degree_level_configs d ON d.id = s."degreeLevelId"
	      LEFT JOIN academic_terms t ON t.id = sl."termId"
	      LEFT JOIN financial_terms ft ON ft.id = sl."financialTermId"`,
		// Scope by the STUDENT's university (not the ledger column): legacy ledger
		// rows can be NULL or mismatched, but student ownership is always valid.
		universityColumn: `s."universityId"`,
		roles:            []string{"ADMIN", "FINANCE_EXPERT", "FINANCE", "CASHIER", "EDU_EXPERT"},
		fields:           builderLedgerFields,
		maxRows:          20000,
	},
	{
		key:         "finance-balance",
		title:       "صورت‌حساب و ماندهٔ دانشجو",
		icon:        "🧾",
		description: "یک ردیف به‌ازای هر دانشجو: بدهی، تخفیف، پرداختی و مانده",
		baseFrom: `FROM students s
	      JOIN users u ON u.id = s."userId"
	      LEFT JOIN majors m ON m.id = s."majorId"
	      LEFT JOIN degree_level_configs d ON d.id = s."degreeLevelId"
	      ` + builderBalanceLedgerJoin,
		universityColumn: `s."universityId"`,
		roles:            []string{"ADMIN", "FINANCE_EXPERT", "FINANCE", "CASHIER", "EDU_EXPERT"},
		fields:           builderBalanceFields,
		maxRows:          20000,
	},
	{
		key:         "finance-payments",
		title:       "پرداخت‌های درگاه",
		icon:        "💳",
		description: "تراکنش‌های پرداخت اینترنتی: وضعیت، درگاه، پیگیری بانک",
		baseFrom: `FROM payment_transactions pt
	      JOIN students s ON s.id = pt."studentId"
	      JOIN users u ON u.id = s."userId"
	      LEFT JOIN majors m ON m.id = s."majorId"
	      LEFT JOIN payment_gateways g ON g.id = pt."gatewayId"
	      LEFT JOIN academic_terms t ON t.id = pt."termId"`,
		universityColumn: `s."universityId"`,
		roles:            []string{"ADMIN", "FINANCE_EXPERT", "FINANCE", "CASHIER"},
		fields:           builderPaymentFields,
		maxRows:          20000,
	},
	{
		key:         "finance-tariff",
		title:       "تعرفهٔ تحصیلی",
		icon:        "🏷️",
		description: "قواعد نرخ‌گذاری شهریه به‌ازای مقطع/رشته/ورودی",
		baseFrom: `FROM tuition_rules tr
	      LEFT JOIN degree_level_configs d ON d.id = tr."degreeLevelId"
	      LEFT JOIN majors m ON m.id = tr."majorId"
	      LEFT JOIN faculties fc ON fc.id = tr."facultyId"
	      LEFT JOIN financial_terms fct ON fct.id = tr."currentTermId"
	      LEFT JOIN academic_terms at ON at.id = fct."academicTermId"`,
		universityColumn: `tr."universityId"`,
		roles:            []string{"ADMIN", "FINANCE_EXPERT", "FINANCE", "EDU_EXPERT"},
		fields:           builderTariffFields,
		maxRows:          20000,
	},
}

func builderGetSource(key string) *builderSource {
	for i := range builderSources {
		if builderSources[i].key == key {
			return &builderSources[i]
		}
	}
	return nil
}

func builderGetField(source *builderSource, fieldKey string) *builderField {
	for i := range source.fields {
		if source.fields[i].key == fieldKey {
			return &source.fields[i]
		}
	}
	return nil
}

// BuilderSourceMetas serializes the catalog for the builder page — SQL-free.
func BuilderSourceMetas() []BuilderSourceMeta {
	out := make([]BuilderSourceMeta, 0, len(builderSources))
	for i := range builderSources {
		s := &builderSources[i]
		fields := make([]BuilderSourceFieldMeta, 0, len(s.fields))
		for _, f := range s.fields {
			fields = append(fields, BuilderSourceFieldMeta{
				Key: f.key, Title: f.title, Type: f.typ, Format: f.format,
				Filterable: f.filterable, Ops: f.ops, Groupable: f.groupable,
				Agg: f.agg, HasFixedAgg: f.aggSql != "", Options: f.options,
				Ref: f.ref, Hint: f.hint,
			})
		}
		out = append(out, BuilderSourceMeta{
			Key: s.key, Title: s.title, Icon: s.icon, Description: s.description, Fields: fields,
		})
	}
	return out
}

// ─────────────────── SQL assembly helpers ───────────────────

// builderQuery accumulates bound parameters; add returns the next placeholder.
type builderQuery struct{ args []any }

func (q *builderQuery) add(v any) string {
	q.args = append(q.args, v)
	return "$" + strconv.Itoa(len(q.args))
}

// builderSafeIdent is the ONLY place an identifier from our side passes through.
func builderSafeIdent(s string) (string, error) {
	if !builderIdentRe.MatchString(s) {
		return "", fmt.Errorf("شناسهٔ ستون نامعتبر: %s", s)
	}
	return s, nil
}

// builderOpSQL is the closed operator → SQL map (OP_SQL in engine.ts).
var builderOpSQL = map[string]string{
	"eq": "=", "ne": "<>", "gt": ">", "gte": ">=", "lt": "<", "lte": "<=",
	"like": "ILIKE", "in": "IN", "between": "BETWEEN",
	"isnull": "IS NULL", "notnull": "IS NOT NULL",
}

// builderTypedValue converts a raw filter string to a typed bound value + SQL cast,
// so Postgres never has to guess the parameter type.
func builderTypedValue(field *builderField, raw string) (any, string, error) {
	switch field.typ {
	case "number", "money":
		s := fa.ToEnDigits(strings.TrimSpace(raw))
		f, err := strconv.ParseFloat(s, 64)
		if err != nil {
			return nil, "", fmt.Errorf("مقدارِ عددی نامعتبر است: %s", raw)
		}
		return f, "::numeric", nil
	case "date":
		return strings.TrimSpace(raw), "::date", nil
	case "datetime":
		return strings.TrimSpace(raw), "::timestamp", nil
	case "bool":
		v := strings.TrimSpace(raw)
		return v == "true" || v == "1", "::boolean", nil
	default:
		return raw, "", nil
	}
}

// builderFilterValues normalizes a filter value (string or list) to trimmed strings.
func builderFilterValues(v any) []string {
	toString := func(x any) string {
		switch t := x.(type) {
		case nil:
			return ""
		case string:
			return t
		case float64:
			return strconv.FormatFloat(t, 'f', -1, 64)
		case bool:
			if t {
				return "true"
			}
			return "false"
		default:
			return fmt.Sprint(x)
		}
	}
	switch t := v.(type) {
	case nil:
		return nil
	case []any:
		out := make([]string, 0, len(t))
		for _, e := range t {
			out = append(out, strings.TrimSpace(toString(e)))
		}
		return out
	case string:
		return []string{t}
	default:
		return []string{toString(v)}
	}
}

// builderResolvedColumn is a solved output column.
type builderResolvedColumn struct {
	alias   string
	title   string
	expr    string // validated catalog SQL
	rawExpr string
	field   *builderField
	isAgg   bool
	format  string
}

func builderAggTitle(kind string) string {
	switch kind {
	case "sum":
		return "جمع"
	case "avg":
		return "میانگین"
	case "min":
		return "کمینه"
	case "max":
		return "بیشینه"
	case "count":
		return "تعداد"
	case "count_distinct":
		return "تعداد یکتا"
	default:
		return kind
	}
}

// builderBuildAgg builds the aggregate expression for a column.
// count/count_distinct are legal on any row-level column; sum/avg/min/max only
// on numeric fields that list them; fixed-agg columns cannot be re-aggregated.
func builderBuildAgg(kind string, field *builderField) string {
	if field.aggSql != "" {
		return ""
	}
	if kind == "count" {
		return "COUNT(" + field.sqlExpr + ")"
	}
	if kind == "count_distinct" {
		return "COUNT(DISTINCT " + field.sqlExpr + ")"
	}
	allowed := false
	for _, a := range field.agg {
		if a == kind {
			allowed = true
			break
		}
	}
	if !allowed {
		return ""
	}
	switch kind {
	case "sum":
		return "SUM(" + field.sqlExpr + ")"
	case "avg":
		return "AVG(" + field.sqlExpr + ")"
	case "min":
		return "MIN(" + field.sqlExpr + ")"
	case "max":
		return "MAX(" + field.sqlExpr + ")"
	default:
		return ""
	}
}

// builderResolveColumns solves the selected columns (alias, title, expr, isAgg).
func builderResolveColumns(source *builderSource, cfg *SavedReportConfig, notes *[]string) ([]builderResolvedColumn, error) {
	out := []builderResolvedColumn{}
	used := map[string]bool{}
	for _, col := range cfg.Columns {
		field := builderGetField(source, col.Field)
		if field == nil {
			*notes = append(*notes, fmt.Sprintf("ستونِ «%s» در این منبع وجود ندارد و نادیده گرفته شد.", col.Field))
			continue
		}
		exprText := field.sqlExpr
		alias := field.key
		isAgg := false
		if col.Agg != "" {
			built := builderBuildAgg(col.Agg, field)
			if built == "" {
				*notes = append(*notes, fmt.Sprintf("تجمیعِ «%s» روی ستونِ «%s» مجاز نیست و نادیده گرفته شد.", col.Agg, field.title))
				continue
			}
			exprText = built
			isAgg = true
			alias = field.key + "__" + col.Agg
		} else if field.aggSql != "" {
			// inherently aggregated column (e.g. balance)
			exprText = field.aggSql
			isAgg = true
		}
		if used[alias] {
			continue
		}
		used[alias] = true
		safe, err := builderSafeIdent(alias)
		if err != nil {
			return nil, err
		}
		title := strings.TrimSpace(col.Alias)
		if title == "" {
			if col.Agg != "" {
				title = builderAggTitle(col.Agg) + " " + field.title
			} else {
				title = field.title
			}
		}
		format := col.Format
		if format == "" {
			format = field.format
		}
		out = append(out, builderResolvedColumn{
			alias: safe, title: title, expr: exprText, rawExpr: exprText,
			field: field, isAgg: isAgg, format: format,
		})
	}
	return out, nil
}

// builderBuildWhere — university scope (fail-closed) + source condition + user filters.
func builderBuildWhere(source *builderSource, cfg *SavedReportConfig, universityID int64, q *builderQuery, notes *[]string) string {
	uc := source.universityColumn
	conds := []string{}
	if source.universityNullable {
		conds = append(conds, fmt.Sprintf("(%s = %s OR %s IS NULL)", uc, q.add(universityID), uc))
	} else {
		conds = append(conds, fmt.Sprintf("%s = %s", uc, q.add(universityID)))
	}
	if source.where != "" {
		conds = append(conds, source.where)
	}

	for _, f := range cfg.Filters {
		field := builderGetField(source, f.Field)
		if field == nil || !field.filterable {
			continue
		}
		if !hasString(field.ops, f.Op) {
			continue
		}
		opSQL, ok := builderOpSQL[f.Op]
		if !ok {
			continue
		}
		if f.Op == "isnull" {
			conds = append(conds, field.sqlExpr+" IS NULL")
			continue
		}
		if f.Op == "notnull" {
			conds = append(conds, field.sqlExpr+" IS NOT NULL")
			continue
		}
		vals := builderFilterValues(f.Value)
		vals = filterNonEmpty(vals)
		if len(vals) == 0 {
			continue
		}

		// Pre-validate and type ALL values BEFORE binding any of them: a failed
		// parse must never leave orphaned positional parameters in the statement.
		typed := make([]any, 0, len(vals))
		casts := make([]string, len(vals))
		bad := ""
		for i, v := range vals {
			tv, cast, err := builderTypedValue(field, v)
			if err != nil {
				bad = err.Error()
				break
			}
			typed = append(typed, tv)
			casts[i] = cast
		}
		if bad != "" {
			*notes = append(*notes, bad)
			continue
		}
		bind := func(i int) string { return q.add(typed[i]) + casts[i] }

		switch f.Op {
		case "like":
			like := "%" + fa.EscapeLikeChars(fa.ToEnDigits(vals[0])) + "%"
			conds = append(conds, fmt.Sprintf(`%s ILIKE %s ESCAPE '\'`, field.sqlExpr, q.add(like)))
		case "in":
			phs := make([]string, 0, len(typed))
			for i := range typed {
				phs = append(phs, bind(i))
			}
			conds = append(conds, fmt.Sprintf("%s IN (%s)", field.sqlExpr, strings.Join(phs, ", ")))
		case "between":
			if len(typed) < 2 {
				continue
			}
			conds = append(conds, fmt.Sprintf("%s BETWEEN %s AND %s", field.sqlExpr, bind(0), bind(1)))
		default:
			conds = append(conds, fmt.Sprintf("%s %s %s", field.sqlExpr, opSQL, bind(0)))
		}
	}
	return strings.Join(conds, " AND ")
}

// builderBuildGroupBy — natural keys + user groupings + every selected non-agg column.
func builderBuildGroupBy(source *builderSource, cfg *SavedReportConfig, cols []builderResolvedColumn) string {
	parts := []string{}
	seen := map[string]bool{}
	add := func(p string) {
		if p != "" && !seen[p] {
			seen[p] = true
			parts = append(parts, p)
		}
	}
	for _, g := range source.groupKeys {
		add(g)
	}
	for _, g := range cfg.GroupBy {
		if f := builderGetField(source, g); f != nil && f.groupable {
			add(f.sqlExpr)
		}
	}
	for _, c := range cols {
		if !c.isAgg {
			add(c.rawExpr)
		}
	}
	return strings.Join(parts, ", ")
}

// builderBuildOrderBy — only over selected columns or groupable fields;
// falls back to the first selected column for a stable output.
func builderBuildOrderBy(source *builderSource, cfg *SavedReportConfig, cols []builderResolvedColumn) string {
	parts := []string{}
	for _, o := range cfg.OrderBy {
		dir := "ASC"
		if o.Dir == "desc" {
			dir = "DESC"
		}
		matched := false
		for _, c := range cols {
			if c.field.key == o.Field || c.alias == o.Field {
				parts = append(parts, `"`+c.alias+`" `+dir)
				matched = true
				break
			}
		}
		if matched {
			continue
		}
		if f := builderGetField(source, o.Field); f != nil && f.groupable {
			parts = append(parts, f.sqlExpr+" "+dir)
		}
	}
	if len(parts) == 0 && len(cols) > 0 {
		parts = append(parts, `"`+cols[0].alias+`" ASC`)
	}
	return strings.Join(parts, ", ")
}

func hasString(list []string, want string) bool {
	if len(list) == 0 {
		// empty ops list = all operators allowed
		return true
	}
	for _, s := range list {
		if s == want {
			return true
		}
	}
	return false
}

func filterNonEmpty(vals []string) []string {
	out := make([]string, 0, len(vals))
	for _, v := range vals {
		if v != "" {
			out = append(out, v)
		}
	}
	return out
}

// ─────────────────── the engine (runCatalogReport) ───────────────────

// BuilderService is the report-builder engine + saved-reports CRUD.
type BuilderService struct {
	Pool  *pgxpool.Pool
	Scope *scope.Service
}

// NewBuilder constructs the service.
func NewBuilder(pool *pgxpool.Pool, sc *scope.Service) *BuilderService {
	return &BuilderService{Pool: pool, Scope: sc}
}

// universityID resolves the active university — fail-closed (currentUniversityId in actions.ts).
func (b *BuilderService) universityID(ctx context.Context, user *session.User, uniCookie string) (int64, error) {
	uni, err := b.Scope.CurrentUniversity(ctx, user, uniCookie)
	if err != nil || uni.ID <= 0 || uni.Kind == "NONE" {
		return 0, errors.New("دانشگاهِ فعالِ شما مشخص نیست؛ اجرای گزارش ممکن نیست.")
	}
	return uni.ID, nil
}

// UniversityIDForOptions is the exported fail-closed university resolver for handlers
// that only need the university (e.g. to load catalog options).
func (b *BuilderService) UniversityIDForOptions(ctx context.Context, user *session.User, uniCookie string) (int64, error) {
	return b.universityID(ctx, user, uniCookie)
}

// runCatalogReport executes a report from a saved config (engine.ts runCatalogReport).
func (b *BuilderService) runCatalogReport(ctx context.Context, sourceKey string, cfg *SavedReportConfig, universityID int64, page, per int, options map[string][]BuilderOption) (*BuilderResult, error) {
	source := builderGetSource(sourceKey)
	if source == nil {
		return nil, fmt.Errorf("منبعِ ناشناخته: %s", sourceKey)
	}
	notes := []string{}

	cols, err := builderResolveColumns(source, cfg, &notes)
	if err != nil {
		return nil, err
	}
	if len(cols) == 0 {
		return nil, errors.New("هیچ ستونِ معتبری انتخاب نشده است.")
	}

	q := &builderQuery{args: []any{}}
	where := builderBuildWhere(source, cfg, universityID, q, &notes)

	hasAgg := false
	for _, c := range cols {
		if c.isAgg {
			hasAgg = true
			break
		}
	}
	groupBy := ""
	if hasAgg {
		groupBy = builderBuildGroupBy(source, cfg, cols)
	}
	orderBy := builderBuildOrderBy(source, cfg, cols)

	// Aliases are QUOTED so the original column case survives Postgres' folding.
	selectList := make([]string, len(cols))
	for i, c := range cols {
		selectList[i] = c.expr + ` AS "` + c.alias + `"`
	}
	body := "SELECT " + strings.Join(selectList, ", ") + " " + source.baseFrom
	if where != "" {
		body += " WHERE " + where
	}
	if groupBy != "" {
		body += " GROUP BY " + groupBy
	}
	if orderBy != "" {
		body += " ORDER BY " + orderBy
	}

	maxCap := int64(source.maxRows)
	if maxCap <= 0 || maxCap > builderHardMaxRows {
		maxCap = builderHardMaxRows
	}
	if per < 1 {
		per = Per
	}
	if per > builderMaxPerPage {
		per = builderMaxPerPage
	}
	if page < 1 {
		page = 1
	}

	var totalRaw int
	countSQL := "SELECT COUNT(*)::int FROM (" + body + ") t"
	if err := b.Pool.QueryRow(ctx, countSQL, q.args...).Scan(&totalRaw); err != nil {
		return nil, err
	}
	total := int64(totalRaw)
	if total > maxCap {
		total = maxCap
		notes = append(notes, fmt.Sprintf("خروجی به سقفِ %s ردیف محدود شد (کلِ رکوردهای منطبق: %s).",
			faNumInt(maxCap), faNumInt(int64(totalRaw))))
	}
	totalPages := int(math.Max(1, math.Ceil(float64(total)/float64(per))))
	safePage := page
	if safePage > totalPages {
		safePage = totalPages
	}

	dataSQL := body + fmt.Sprintf(" LIMIT $%d OFFSET $%d", len(q.args)+1, len(q.args)+2)
	dataArgs := append(append([]any{}, q.args...), per, (safePage-1)*per)
	rows, err := b.Pool.Query(ctx, dataSQL, dataArgs...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	outRows := scanRows(rows)

	// Persian label mapping for option-backed columns (engine.ts step 6).
	for i := range cols {
		c := &cols[i]
		if c.field.ref == "" {
			continue
		}
		mapping, ok := options[c.field.ref]
		if !ok || len(mapping) == 0 {
			continue
		}
		byValue := map[string]string{}
		for _, o := range mapping {
			byValue[o.Value] = o.Label
		}
		for _, row := range outRows {
			if s, ok := row[c.alias].(string); ok {
				if label, hit := byValue[s]; hit {
					row[c.alias] = label
				}
			}
		}
	}

	outCols := make([]Column, len(cols))
	for i, c := range cols {
		outCols[i] = Column{Key: c.alias, Title: c.title, Format: c.format}
	}
	return &BuilderResult{
		Columns: outCols, Rows: outRows, Total: int(total),
		Page: safePage, Per: per, TotalPages: totalPages, Notes: notes,
	}, nil
}

// ─────────────────── dynamic catalog options (catalogOptions in actions.ts) ───────────────────

// CatalogOptions loads the dynamic filter option lists for the builder page.
func (b *BuilderService) CatalogOptions(ctx context.Context, universityID int64) (*BuilderCatalogOptions, error) {
	opts := &BuilderCatalogOptions{
		Terms: []BuilderOption{}, FinancialTerms: []BuilderOption{},
		DepositTypes: append([]BuilderOption{}, builderDepositTypes...),
		LedgerTypes:  append([]BuilderOption{}, builderLedgerTypes...),
		PaymentStatuses: append([]BuilderOption{}, builderPaymentStatuses...),
		Faculties:    []BuilderOption{}, Majors: []BuilderOption{},
	}
	if rows, err := b.Pool.Query(ctx, `select "termCode", title from academic_terms where "universityId" = $1 order by "termCode" desc limit 60`, universityID); err == nil {
		for rows.Next() {
			var v, l string
			if err := rows.Scan(&v, &l); err == nil {
				opts.Terms = append(opts.Terms, BuilderOption{Value: v, Label: l})
			}
		}
		rows.Close()
	} else {
		return nil, err
	}
	if rows, err := b.Pool.Query(ctx, `select "termCode", title from financial_terms where "universityId" = $1 order by "termCode" desc limit 60`, universityID); err == nil {
		for rows.Next() {
			var v, l string
			if err := rows.Scan(&v, &l); err == nil {
				opts.FinancialTerms = append(opts.FinancialTerms, BuilderOption{Value: v, Label: l})
			}
		}
		rows.Close()
	} else {
		return nil, err
	}
	// Deposit kinds: static list first, then distinct values actually present in
	// this university's ledger (fail-closed: NULL-university rows excluded).
	if rows, err := b.Pool.Query(ctx, `select distinct "depositType" from student_ledger where "depositType" is not null and ("universityId" = $1 or "universityId" is null) limit 40`, universityID); err == nil {
		for rows.Next() {
			var v string
			if err := rows.Scan(&v); err == nil {
				v = strings.TrimSpace(v)
				dup := false
				for _, o := range opts.DepositTypes {
					if o.Value == v {
						dup = true
						break
					}
				}
				if !dup && v != "" {
					opts.DepositTypes = append(opts.DepositTypes, BuilderOption{Value: v, Label: v})
				}
			}
		}
		rows.Close()
	}
	if rows, err := b.Pool.Query(ctx, `select id::text, name from faculties where "universityId" = $1 or "universityId" is null order by name limit 80`, universityID); err == nil {
		for rows.Next() {
			var v, l string
			if err := rows.Scan(&v, &l); err == nil {
				opts.Faculties = append(opts.Faculties, BuilderOption{Value: v, Label: l})
			}
		}
		rows.Close()
	}
	if rows, err := b.Pool.Query(ctx, `select id::text, name from majors where "universityId" = $1 or "universityId" is null order by name limit 200`, universityID); err == nil {
		for rows.Next() {
			var v, l string
			if err := rows.Scan(&v, &l); err == nil {
				opts.Majors = append(opts.Majors, BuilderOption{Value: v, Label: l})
			}
		}
		rows.Close()
	}
	return opts, nil
}

// engineOptions merges the static defaults with the dynamic lists for label mapping.
func engineOptions(dyn *BuilderCatalogOptions) map[string][]BuilderOption {
	if dyn == nil {
		return map[string][]BuilderOption{
			"ledgerTypes": builderLedgerTypes, "depositTypes": builderDepositTypes,
			"paymentStatuses": builderPaymentStatuses,
		}
	}
	return map[string][]BuilderOption{
		"terms":           dyn.Terms,
		"financialTerms":  dyn.FinancialTerms,
		"depositTypes":    dyn.DepositTypes,
		"ledgerTypes":     dyn.LedgerTypes,
		"paymentStatuses": dyn.PaymentStatuses,
		"faculties":       dyn.Faculties,
		"majors":          dyn.Majors,
	}
}

// ─────────────────── saved reports CRUD (actions.ts) ───────────────────

// builderRoles may build/edit saved reports.
var builderRoles = []string{"ADMIN", "EDU_EXPERT", "FINANCE_EXPERT", "FINANCE"}

// runnerRoles may run saved reports.
var runnerRoles = []string{
	"ADMIN", "EDU_EXPERT", "ARCHIVE_EXPERT", "MILITARY_OFFICER",
	"FINANCE_EXPERT", "FINANCE", "CASHIER",
}

func hasAnyRole(user *session.User, roles []string) bool {
	for _, r := range user.Roles {
		for _, want := range roles {
			if r == want {
				return true
			}
		}
	}
	return false
}

// builderCanSee — visibility check (canSee in actions.ts).
func builderCanSee(ownerUserID int64, visibility string, allowedRoles []string, user *session.User) bool {
	if ownerUserID == user.ID {
		return true
	}
	if visibility == "PUBLIC" {
		return true
	}
	if visibility == "ROLE" {
		for _, r := range allowedRoles {
			for _, have := range user.Roles {
				if r == have {
					return true
				}
			}
		}
	}
	return false
}

// builderCanUseSource — source-level role gate (canUseSource in actions.ts).
func builderCanUseSource(sourceKey string, roles []string) bool {
	s := builderGetSource(sourceKey)
	if s == nil {
		return false
	}
	if len(s.roles) == 0 {
		return true
	}
	for _, r := range roles {
		for _, want := range s.roles {
			if r == want {
				return true
			}
		}
	}
	return false
}

const builderSavedSelect = `select r.id, r.name, r.description, r."sourceKey", r.config, r.visibility,
	  r."allowedRoles", r."ownerUserId", r."createdAt", r."updatedAt",
	  coalesce(u."firstName" || ' ' || u."lastName", '—')
	from saved_reports r
	left join users u on u.id = r."ownerUserId"`

func scanSavedReport(rows pgx.Rows, user *session.User) (*SavedReportRow, bool, error) {
	for rows.Next() {
		var r SavedReportRow
		var configBytes, rolesBytes []byte
		var createdAt, updatedAt time.Time
		var desc *string
		if err := rows.Scan(&r.ID, &r.Name, &desc, &r.SourceKey, &configBytes, &r.Visibility,
			&rolesBytes, &r.OwnerUserID, &createdAt, &updatedAt, &r.OwnerName); err != nil {
			return nil, false, err
		}
		r.Description = desc
		r.CreatedAt = createdAt.UTC().Format(time.RFC3339Nano)
		r.UpdatedAt = updatedAt.UTC().Format(time.RFC3339Nano)
		r.Config = SavedReportConfig{}
		if len(configBytes) > 0 {
			if err := json.Unmarshal(configBytes, &r.Config); err != nil {
				r.Config = SavedReportConfig{}
			}
		}
		r.AllowedRoles = []string{}
		if len(rolesBytes) > 0 {
			_ = json.Unmarshal(rolesBytes, &r.AllowedRoles)
		}
		src := builderGetSource(r.SourceKey)
		if src != nil {
			r.SourceTitle = src.title
			r.SourceIcon = src.icon
		} else {
			r.SourceTitle = r.SourceKey
			r.SourceIcon = "📄"
		}
		r.IsOwner = user != nil && r.OwnerUserID == user.ID
		return &r, true, nil
	}
	return nil, false, nil
}

// ListSaved ports listSavedReports — visible saved reports of the caller's university.
func (b *BuilderService) ListSaved(ctx context.Context, user *session.User, uniCookie string) ([]*SavedReportRow, error) {
	uniID, err := b.universityID(ctx, user, uniCookie)
	if err != nil {
		return nil, err
	}
	rows, err := b.Pool.Query(ctx, builderSavedSelect+`
	  where r."universityId" = $1
	  order by r."updatedAt" desc`, uniID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*SavedReportRow{}
	for {
		r, ok, err := scanSavedReport(rows, user)
		if err != nil {
			return nil, err
		}
		if !ok {
			break
		}
		if builderCanSee(r.OwnerUserID, r.Visibility, r.AllowedRoles, user) {
			out = append(out, r)
		}
	}
	return out, nil
}

// getSavedRow loads one saved report with university scope enforced.
func (b *BuilderService) getSavedRow(ctx context.Context, id, uniID int64) (*SavedReportRow, error) {
	rows, err := b.Pool.Query(ctx, builderSavedSelect+`
	  where r.id = $1 and r."universityId" = $2
	  limit 1`, id, uniID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	r, ok, err := scanSavedReport(rows, nil)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, nil
	}
	return r, nil
}

// validateConfig mirrors validateConfig in actions.ts — same rules the engine enforces.
func validateConfig(sourceKey string, cfg *SavedReportConfig) error {
	source := builderGetSource(sourceKey)
	if source == nil {
		return errors.New("منبعِ نامعتبر است.")
	}
	if len(cfg.Columns) == 0 {
		return errors.New("حداقل یک ستون انتخاب کنید.")
	}
	if len(cfg.Columns) > 60 {
		return errors.New("تعداد ستون‌های انتخابی بیش از حد است (سقف ۶۰).")
	}
	for _, c := range cfg.Columns {
		f := builderGetField(source, c.Field)
		if f == nil {
			return fmt.Errorf("ستونِ نامعتبر: %s", c.Field)
		}
		if c.Agg != "" {
			if f.aggSql != "" {
				return fmt.Errorf("ستونِ «%s» محاسبهٔ ثابت دارد؛ تجمیع روی آن مجاز نیست.", f.title)
			}
			counting := c.Agg == "count" || c.Agg == "count_distinct"
			// sum/avg/min/max require the field to explicitly list the aggregate
			// (an empty agg list means numeric aggregates are NOT allowed).
			allowed := false
			for _, a := range f.agg {
				if a == c.Agg {
					allowed = true
					break
				}
			}
			if !counting && !allowed {
				return fmt.Errorf("تجمیعِ «%s» روی «%s» مجاز نیست.", c.Agg, f.title)
			}
		}
	}
	if len(cfg.Filters) > 30 {
		return errors.New("تعداد شرط‌ها بیش از حد است (سقف ۳۰).")
	}
	for _, fl := range cfg.Filters {
		f := builderGetField(source, fl.Field)
		if f == nil {
			return fmt.Errorf("شرطِ نامعتبر: %s", fl.Field)
		}
		if !f.filterable {
			return fmt.Errorf("ستونِ «%s» قابل فیلتر نیست.", f.title)
		}
		if len(f.ops) > 0 && !hasString(f.ops, fl.Op) {
			return fmt.Errorf("عملگرِ «%s» روی «%s» مجاز نیست.", fl.Op, f.title)
		}
	}
	for _, g := range cfg.GroupBy {
		f := builderGetField(source, g)
		if f == nil || !f.groupable {
			return fmt.Errorf("گروه‌بندیِ نامعتبر: %s", g)
		}
	}
	return nil
}

// SaveSaved ports saveSavedReport — create or edit (owner-only edit).
func (b *BuilderService) SaveSaved(ctx context.Context, user *session.User, uniCookie string, in *BuilderSaveInput) (int64, error) {
	uniID, err := b.universityID(ctx, user, uniCookie)
	if err != nil {
		return 0, err
	}
	if !builderCanUseSource(in.SourceKey, user.Roles) {
		return 0, errors.New("به این منبعِ داده دسترسی ندارید.")
	}
	name := strings.TrimSpace(in.Name)
	if name == "" {
		return 0, errors.New("نامِ گزارش را وارد کنید.")
	}
	if len([]rune(name)) > 150 {
		return 0, errors.New("نامِ گزارش حداکثر ۱۵۰ کاراکتر است.")
	}
	if err := validateConfig(in.SourceKey, &in.Config); err != nil {
		return 0, err
	}
	visibility := in.Visibility
	if visibility != "PRIVATE" && visibility != "ROLE" && visibility != "PUBLIC" {
		visibility = "PRIVATE"
	}
	allowedRoles := []string{}
	if visibility == "ROLE" {
		for _, r := range in.AllowedRoles {
			if strings.TrimSpace(r) != "" {
				allowedRoles = append(allowedRoles, r)
			}
		}
	}
	configJSON, err := json.Marshal(in.Config)
	if err != nil {
		return 0, err
	}
	rolesJSON, err := json.Marshal(allowedRoles)
	if err != nil {
		return 0, err
	}
	var desc any
	if strings.TrimSpace(in.Description) == "" {
		desc = nil
	} else {
		desc = strings.TrimSpace(in.Description)
	}

	if in.ID > 0 {
		existing, err := b.getSavedRow(ctx, in.ID, uniID)
		if err != nil {
			return 0, err
		}
		if existing == nil {
			return 0, errors.New("گزارش یافت نشد.")
		}
		if existing.OwnerUserID != user.ID {
			return 0, errors.New("فقط سازندهٔ گزارش می‌تواند آن را ویرایش کند.")
		}
		_, err = b.Pool.Exec(ctx, `update saved_reports set
		  name = $1, description = $2, "sourceKey" = $3, config = $4::jsonb,
		  visibility = $5, "allowedRoles" = $6::jsonb, "updatedAt" = now()
		  where id = $7 and "universityId" = $8`,
			name, desc, in.SourceKey, configJSON, visibility, rolesJSON, in.ID, uniID)
		if err != nil {
			return 0, builderSaveError(err)
		}
		return in.ID, nil
	}

	var newID int64
	err = b.Pool.QueryRow(ctx, `insert into saved_reports
	  ("universityId", name, description, "sourceKey", config, visibility, "allowedRoles", "ownerUserId")
	  values ($1, $2, $3, $4, $5::jsonb, $6, $7::jsonb, $8) returning id`,
		uniID, name, desc, in.SourceKey, configJSON, visibility, rolesJSON, user.ID).Scan(&newID)
	if err != nil {
		return 0, builderSaveError(err)
	}
	return newID, nil
}

// builderSaveError maps the unique-name violation to a Persian message.
func builderSaveError(err error) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.ConstraintName == "uq_saved_reports_uni_name" {
		return errors.New("گزارشی با این نام در همین دانشگاه از قبل وجود دارد.")
	}
	return err
}

// DeleteSaved ports deleteSavedReport — owner-only delete within the university.
func (b *BuilderService) DeleteSaved(ctx context.Context, user *session.User, uniCookie string, id int64) error {
	uniID, err := b.universityID(ctx, user, uniCookie)
	if err != nil {
		return err
	}
	existing, err := b.getSavedRow(ctx, id, uniID)
	if err != nil {
		return err
	}
	if existing == nil {
		return errors.New("گزارش یافت نشد.")
	}
	if existing.OwnerUserID != user.ID {
		return errors.New("فقط سازندهٔ گزارش می‌تواند آن را حذف کند.")
	}
	_, err = b.Pool.Exec(ctx, `delete from saved_reports where id = $1 and "universityId" = $2`, id, uniID)
	return err
}

// RunSaved ports runSavedReportAction — run a saved report with access checks.
func (b *BuilderService) RunSaved(ctx context.Context, user *session.User, uniCookie string, id int64, page int) (*BuilderResult, error) {
	uniID, err := b.universityID(ctx, user, uniCookie)
	if err != nil {
		return nil, err
	}
	r, err := b.getSavedRow(ctx, id, uniID)
	if err != nil {
		return nil, err
	}
	if r == nil {
		return nil, errors.New("گزارش یافت نشد.")
	}
	if !builderCanSee(r.OwnerUserID, r.Visibility, r.AllowedRoles, user) {
		return nil, errors.New("به این گزارش دسترسی ندارید.")
	}
	if !builderCanUseSource(r.SourceKey, user.Roles) {
		return nil, errors.New("به منبعِ دادهٔ این گزارش دسترسی ندارید.")
	}
	opts, err := b.CatalogOptions(ctx, uniID)
	if err != nil {
		return nil, err
	}
	return b.runCatalogReport(ctx, r.SourceKey, &r.Config, uniID, page, Per, engineOptions(opts))
}

// PreviewSaved ports previewReportAction — run an unsaved config from the builder.
func (b *BuilderService) PreviewSaved(ctx context.Context, user *session.User, uniCookie, sourceKey string, cfg *SavedReportConfig, page int) (*BuilderResult, error) {
	uniID, err := b.universityID(ctx, user, uniCookie)
	if err != nil {
		return nil, err
	}
	if !builderCanUseSource(sourceKey, user.Roles) {
		return nil, errors.New("به این منبعِ داده دسترسی ندارید.")
	}
	if err := validateConfig(sourceKey, cfg); err != nil {
		return nil, err
	}
	opts, err := b.CatalogOptions(ctx, uniID)
	if err != nil {
		return nil, err
	}
	return b.runCatalogReport(ctx, sourceKey, cfg, uniID, page, Per, engineOptions(opts))
}
