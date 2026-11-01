// ═══ safe teaching-fee formula evaluator — port of lib/payroll-formula.ts ═══
//
// Variables: TH lecture hours, PH practical hours, WH workshop hours, UN course units,
// ST student count, RT rate, CF collective multiplier, BS base amount, HR hours.
// legacy Sama letters (N A W U C R K F H) are accepted as aliases.
//
// eval is deliberately not used: a small recursive parser understands only numbers, allowed variables and
// the operators + - * / ( ); anything else is an error.
package payroll

import (
	"fmt"
	"strings"
	"unicode"
)

// aliasToCanon: canonical name ← legacy aliases.
var aliasToCanon = map[string]string{
	"TH": "TH", "PH": "PH", "WH": "WH", "UN": "UN", "ST": "ST",
	"RT": "RT", "CF": "CF", "BS": "BS", "HR": "HR",
	"N": "TH", "A": "PH", "W": "WH", "U": "UN", "C": "ST",
	"R": "RT", "K": "CF", "F": "BS", "H": "HR",
}

// FormulaVars are the allowed formula variables.
type FormulaVars map[string]float64

type tokKind int

const (
	tokNum tokKind = iota
	tokVar
	tokOp
	tokLP
	tokRP
)

type tok struct {
	kind tokKind
	v    string
	num  float64
}

func tokenize(src string) ([]tok, error) {
	toks := []tok{}
	i := 0
	for i < len(src) {
		ch := src[i]
		if ch == ' ' || ch == '\t' || ch == '\n' || ch == '\r' {
			i++
			continue
		}
		if (ch >= '0' && ch <= '9') || ch == '.' {
			j := i
			for j < len(src) && ((src[j] >= '0' && src[j] <= '9') || src[j] == '.') {
				j++
			}
			var v float64
			if _, err := fmt.Sscanf(src[i:j], "%g", &v); err != nil {
				return nil, fmt.Errorf("عدد نامعتبر در فرمول")
			}
			toks = append(toks, tok{kind: tokNum, num: v})
			i = j
			continue
		}
		if (ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z') || ch == '_' {
			j := i
			for j < len(src) && (unicode.IsLetter(rune(src[j])) || src[j] == '_') {
				j++
			}
			name := strings.ToUpper(src[i:j])
			canon, ok := aliasToCanon[name]
			if !ok {
				return nil, fmt.Errorf("متغیر ناشناخته: %s (مجاز: TH PH WH UN ST RT CF BS HR)", src[i:j])
			}
			toks = append(toks, tok{kind: tokVar, v: canon})
			i = j
			continue
		}
		if ch == '+' || ch == '-' || ch == '*' || ch == '/' {
			toks = append(toks, tok{kind: tokOp, v: string(ch)})
			i++
			continue
		}
		if ch == '(' {
			toks = append(toks, tok{kind: tokLP})
			i++
			continue
		}
		if ch == ')' {
			toks = append(toks, tok{kind: tokRP})
			i++
			continue
		}
		return nil, fmt.Errorf("نویسهٔ نامعتبر در فرمول: %c", ch)
	}
	return toks, nil
}

// parser: recursive parser: expr := term (('+'|'-') term)* ; term := factor (('*'|'/') factor)*
type parser struct {
	toks []tok
	pos  int
	vars FormulaVars
}

func (p *parser) peek() *tok {
	if p.pos < len(p.toks) {
		return &p.toks[p.pos]
	}
	return nil
}

func (p *parser) next() *tok {
	t := p.peek()
	if t != nil {
		p.pos++
	}
	return t
}

func (p *parser) expr() (float64, error) {
	v, err := p.term()
	if err != nil {
		return 0, err
	}
	for {
		t := p.peek()
		if t != nil && t.kind == tokOp && (t.v == "+" || t.v == "-") {
			p.next()
			r, err := p.term()
			if err != nil {
				return 0, err
			}
			if t.v == "+" {
				v += r
			} else {
				v -= r
			}
		} else {
			return v, nil
		}
	}
}

func (p *parser) term() (float64, error) {
	v, err := p.factor()
	if err != nil {
		return 0, err
	}
	for {
		t := p.peek()
		if t != nil && t.kind == tokOp && (t.v == "*" || t.v == "/") {
			p.next()
			r, err := p.factor()
			if err != nil {
				return 0, err
			}
			if t.v == "/" {
				if r == 0 {
					return 0, fmt.Errorf("تقسیم بر صفر در فرمول")
				}
				v /= r
			} else {
				v *= r
			}
		} else {
			return v, nil
		}
	}
}

func (p *parser) factor() (float64, error) {
	t := p.next()
	if t == nil {
		return 0, fmt.Errorf("پایان ناگهانی فرمول")
	}
	switch t.kind {
	case tokNum:
		return t.num, nil
	case tokVar:
		return p.vars[t.v], nil
	case tokLP:
		v, err := p.expr()
		if err != nil {
			return 0, err
		}
		c := p.next()
		if c == nil || c.kind != tokRP {
			return 0, fmt.Errorf("پرانتز بسته نشده در فرمول")
		}
		return v, nil
	case tokOp:
		if t.v == "-" {
			v, err := p.factor()
			return -v, err
		}
		if t.v == "+" {
			return p.factor()
		}
	}
	return 0, fmt.Errorf("ساختار نامعتبر در فرمول")
}

// ValidateFormula validation at save time — the error is returned as a Persian message.
func ValidateFormula(src string) string {
	if strings.TrimSpace(src) == "" {
		return "فرمول خالی است"
	}
	if len(src) > 500 {
		return "فرمول بیش از حد طولانی است"
	}
	toks, err := tokenize(src)
	if err != nil {
		return err.Error()
	}
	p := &parser{toks: toks, vars: FormulaVars{"TH": 2, "PH": 2, "WH": 0, "UN": 3, "ST": 20, "RT": 100000, "CF": 1, "BS": 500000, "HR": 2}}
	v, err := p.expr()
	if err != nil {
		return err.Error()
	}
	if p.pos < len(toks) {
		return "عبارت اضافی در پایان فرمول"
	}
	if v != v || v > 1.7976931348623157e308 || v < -1.7976931348623157e308 {
		return "نتیجهٔ فرمول عدد معتبر نیست"
	}
	return ""
}

// EvalFormula evaluation — assumes the formula was validated earlier; error = fail-closed.
func EvalFormula(src string, vars FormulaVars) (float64, error) {
	toks, err := tokenize(src)
	if err != nil {
		return 0, err
	}
	p := &parser{toks: toks, vars: vars}
	v, err := p.expr()
	if err != nil {
		return 0, err
	}
	if p.pos < len(toks) {
		return 0, fmt.Errorf("عبارت اضافی در پایان فرمول")
	}
	if v != v {
		return 0, fmt.Errorf("نتیجهٔ فرمول عدد معتبر نیست")
	}
	return v, nil
}

// FormulaVarHelp variable guide for display in the form.
var FormulaVarHelp = []struct{ V, Fa, Old string }{
	{"TH", "ساعت نظری هفتگی", "N"},
	{"PH", "ساعت عملی هفتگی (واحد×۲)", "A"},
	{"WH", "ساعت کارگاهی هفتگی", "W"},
	{"UN", "تعداد واحد درس", "U"},
	{"ST", "تعداد دانشجو", "C"},
	{"RT", "نرخ حق‌التدریس (ریال)", "R"},
	{"CF", "ضریب جمعی کلاس", "K"},
	{"BS", "مبلغ مبنای سطر", "F"},
	{"HR", "ساعت به‌ازای دانشجو", "H"},
}
