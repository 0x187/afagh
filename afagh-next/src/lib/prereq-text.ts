// ════════════════════════════════════════════════════════════════════════
//  تجزیهٔ متنِ «پیش‌نیاز / هم‌نیاز / دروس هم‌ارز» از فایل سیستم قدیمی.
//
//  چرا: در سامانهٔ قدیمی این سه ستون داخل «جدول دروس» بود و در مهاجرت
//  به کل نادیده گرفته شد (مهاجرت فقط کد/نام/واحد/نوع/مقطع/گروه را می‌خواند).
//  نتیجه: `course_rules` خالی ماند و هیچ هشدار پیش‌نیازی روی چارت دیده نشد.
//  این ماژول خالص است تا هم مهاجرت و هم تست واحد از آن استفاده کنند.
// ════════════════════════════════════════════════════════════════════════

export interface LogicLeaf { course: string }
export interface LogicGroup { operator: 'AND' | 'OR'; conditions: (LogicLeaf | LogicGroup)[] }
export type ParsedLogic = LogicGroup;

const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';

/** یکسان‌سازی: ارقام فارسی/عربی → لاتین، حروف عربی → فارسی، فاصله‌های عجیب */
export function normalizeRequisiteText(raw: string | null | undefined): string {
  let s = String(raw ?? '');
  s = s.replace(/[۰-۹]/g, d => String(FA_DIGITS.indexOf(d)));
  s = s.replace(/[٠-٩]/g, d => String(AR_DIGITS.indexOf(d)));
  s = s.replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/\u200c/g, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

/** عبارت‌هایی که یعنی «پیش‌نیازی ندارد» */
const EMPTY_TOKENS = ['', '-', '—', '–', 'ندارد', 'هیچ', 'بدون پیش نیاز', 'بدون پیش‌نیاز', 'ندارد.', '0'];

/** برچسب‌های ابتدای سلول که باید حذف شوند («پیش‌نیاز: …») */
const LABEL_RE = /^\s*(پیش\s*نیاز|پیشنیاز|هم\s*نیاز|همنیاز|هم\s*ارز|همارز|معادل|دروس\s*معادل|prereq(?:uisite)?s?|co-?req(?:uisite)?s?|equivalent)\s*[:：\-–]?\s*/i;

/**
 * جداکننده‌های عملگر — قرارداد واقعی «جدول دروس» سما:
 *
 *   `|`  → **یا (OR)**   ← دو درسِ هم‌ارز؛ هر کدام کافی است (مثال واقعی: `14|12`)
 *   `&`  → **و (AND)**    ← هر دو لازم است (مثال واقعی: `(27003|17003)&27002`)
 *   پرانتز → گروه‌بندی
 *
 * پیش‌تر `|` به‌اشتباه AND خوانده می‌شد و نتیجه این بود که درس هم‌ارز
 * به‌جای «یکی کافی است»، «هر دو لازم است» ثبت می‌شد.
 */
const OR_WORD_RE = /\s+(?:یا|or)\s+/gi;
const AND_WORD_RE = /\s+(?:و|and)\s+/gi;

/** یک عملوند: کد درس (حروف لاتین اختیاری + ۲..۶ رقم) */
const OPERAND_RE = /^[A-Za-z]{0,6}\d{2,6}$/;

/**
 * متن پیش‌نیاز/هم‌نیاز → درخت منطقی (همان ساختار course_rules.logicTree).
 *  • `|` و «یا» → OR
 *  • `&` و «،» و `,` و `+` و «و» → AND
 *  • پرانتز → گروه‌بندی
 *  • اگر کدی پیدا نشود → null (یعنی قاعده‌ای ثبت نشود)
 */
export function parseRequisiteText(text: string | null | undefined): ParsedLogic | null {
  const raw = normalizeRequisiteText(text).replace(LABEL_RE, '');
  if (EMPTY_TOKENS.includes(raw.toLowerCase())) return null;

  // یکسان‌سازی عملگرها روی متن
  const s = raw
    .replace(/\|\|/g, '|')
    .replace(/&&/g, '&')
    .replace(OR_WORD_RE, ' | ')
    .replace(AND_WORD_RE, ' & ')
    .replace(/[،,؛;+]/g, ' & ');

  // توکن‌سازی: فقط کدها و عملگرها (متن آزاد نادیده گرفته می‌شود)
  const tokens: string[] = [];
  const re = /([A-Za-z]{0,6}\d{2,6})|([|&()])/g;
  for (const m of s.matchAll(re)) {
    if (m[1]) tokens.push(m[1].toUpperCase());
    else if (m[2]) tokens.push(m[2]);
  }
  if (tokens.length === 0) return null;

  let i = 0;
  type PNode = LogicLeaf | ParsedLogic;
  const peek = () => tokens[i];
  const isOperand = (t: string | undefined) => !!t && t !== '|' && t !== '&' && t !== '(' && t !== ')';

  /** OR پایین‌ترین اولویت را دارد: A&B|C = (A&B)|C */
  function parseOr(): PNode | null {
    const parts: PNode[] = [];
    const first = parseAnd();
    if (!first) return null;
    parts.push(first);
    while (peek() === '|') {
      i++;
      const nxt = parseAnd();
      if (!nxt) break;
      parts.push(nxt);
    }
    return parts.length === 1 ? parts[0] : normalizeGroup('OR', parts);
  }

  function parseAnd(): PNode | null {
    const parts: PNode[] = [];
    const first = parseAtom();
    if (!first) return null;
    parts.push(first);
    // عملگر صریح `&` یا عملوندِ چسبیده (مثل «CM101 CM102») هر دو AND هستند
    while (peek() === '&' || isOperand(peek()) || peek() === '(') {
      if (peek() === '&') i++;
      const nxt = parseAtom();
      if (!nxt) break;
      parts.push(nxt);
    }
    return parts.length === 1 ? parts[0] : normalizeGroup('AND', parts);
  }

  function parseAtom(): PNode | null {
    const t = peek();
    if (t === '(') {
      i++;
      const inner = parseOr();
      if (peek() === ')') i++;
      return inner;
    }
    if (isOperand(t)) {
      i++;
      return { course: t as string };
    }
    return null;
  }

  const tree = parseOr();
  if (!tree) return null;
  // درسِ تنها → قالب سادهٔ AND (سازگار با داده و بک‌اند قبلی)
  const root: ParsedLogic = 'course' in tree ? { operator: 'AND', conditions: [tree] } : tree;
  if (root.conditions.length === 0) return null;
  return dedupe(root);
}

/** ادغام گروه‌های هم‌نوع و حذف تکرار */
function normalizeGroup(operator: 'AND' | 'OR', nodes: (LogicLeaf | ParsedLogic)[]): ParsedLogic {
  const flat: ParsedLogic['conditions'] = [];
  for (const n of nodes) {
    if ('operator' in n && n.operator === operator) flat.push(...(n as ParsedLogic).conditions);
    else flat.push(n);
  }
  return { operator, conditions: flat };
}

/** حذف کدهای تکراری در هر گروه */
function dedupe(node: ParsedLogic): ParsedLogic {
  const seen = new Set<string>();
  const conditions: ParsedLogic['conditions'] = [];
  for (const c of node.conditions) {
    if ('operator' in c) { conditions.push(dedupe(c as ParsedLogic)); continue; }
    const code = (c as LogicLeaf).course;
    if (seen.has(code)) continue;
    seen.add(code);
    conditions.push(c);
  }
  return { operator: node.operator, conditions };
}

/**
 * استخراج کدهای درس از یک متن آزاد.
 * الگو: حروف لاتین اختیاری + ۲ تا ۶ رقم؛ طول کل دست‌کم ۳ (تا «۱۲» اشتباهی کد نشود).
 */
export function extractCourseCodes(text: string | null | undefined): string[] {
  const s = normalizeRequisiteText(text);
  if (!s) return [];
  const out: string[] = [];
  const re = /[A-Za-z]{0,6}\d{2,6}/g;
  for (const m of s.matchAll(re)) {
    const code = m[0].toUpperCase();
    if (code.replace(/\D/g, '').length < 2) continue;
    if (!out.includes(code)) out.push(code);
  }
  return out;
}

/** متن «دروس هم‌ارز» → فهرست کدها (بدون خودِ درس) */
export function parseEquivalentCodes(text: string | null | undefined, selfCode?: string | null): string[] {
  const codes = extractCourseCodes(text);
  const self = (selfCode ?? '').toUpperCase().trim();
  return self ? codes.filter(c => c !== self) : codes;
}

/** آیا این متن اصلاً حاوی کد درس است؟ (برای هشدار «ستون بود ولی خالی/بی‌کد») */
export function hasAnyCourseCode(text: string | null | undefined): boolean {
  return extractCourseCodes(text).length > 0;
}
