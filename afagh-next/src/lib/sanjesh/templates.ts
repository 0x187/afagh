/**
 * قالب‌های ساختار فایل‌های سازمان سنجش
 * -------------------------------------
 * هر قالب، ستون‌های **بسط‌یافته** فایل را توصیف می‌کند (نه ردیف‌های PDF).
 * قاعدهٔ بسط: ردیفی از ساختار که `N` زیرفیلد دارد، در فایل `N` ستون مستقل اشغال می‌کند
 * (مثلاً «نمره خام دروس ۲۱ درس» → ۲۱ ستون).
 *
 * منبع: PDFهای رسمی ساختار + اعتبارسنجی روی فایل‌های واقعی.
 * سه قالب دارای نمونهٔ واقعی، ستون‌به‌ستون با طول اعلامی مطابقت داده شده‌اند.
 *
 * ⚠ قاعدهٔ سخت: `targetField` در هر قالب باید **یکتا** باشد. اگر دو ستون به یک
 * فیلد نگاشت شوند، مقدار اولی بی‌صدا با دومی بازنویسی می‌شود.
 * گیت: `tests/sanjesh-templates.test.ts`
 */

/** کلید فیلد مقصد — یکسان در همهٔ قالب‌ها تا `dataJson` هم‌شکل بماند. */
export type SanjeshTargetField =
  // هویت داوطلب
  | 'uniqueId'
  | 'fileNo'
  | 'applicantNo'
  | 'firstName'
  | 'lastName'
  | 'fatherName'
  | 'gender'
  | 'birthDate'
  | 'idNumber'
  | 'nationalCode'
  // رشته و محل قبولی
  | 'fieldCode'
  | 'fieldTitle'
  | 'fieldPlaceCode'
  | 'fieldPlaceTitle'
  | 'majorCode'
  | 'majorTitle'
  | 'orientationCode'
  | 'orientationTitle'
  | 'universityCode'
  | 'universityTitle'
  | 'degreeCode'
  | 'fieldGroup'
  // فارغ‌التحصیلی قبلی
  | 'graduatedMajorCode'
  | 'graduatedMajorTitle'
  | 'graduatedPlaceCode'
  | 'graduatedPlaceTitle'
  | 'degreeUniversityCode'
  | 'degreeUniversityTitle'
  | 'degreeDate'
  // سهمیه
  | 'quotaFinalCode'
  | 'quotaFinalTitle'
  | 'quotaAdmitCode'
  | 'quotaAdmitTitle'
  | 'quotaRegCode'
  | 'quotaRegTitle'
  | 'nativeFlag'
  | 'nativeProvinceCode'
  // جغرافیا
  | 'districtBirthCode'
  | 'cityBirthCode'
  | 'cityBirthTitle'
  | 'provinceBirthCode'
  | 'districtDiplomaCode'
  | 'cityDiplomaCode'
  | 'provinceDiplomaCode'
  | 'provinceDiplomaTitle'
  | 'districtPrev1Code'
  | 'cityPrev1Code'
  | 'provincePrev1Code'
  | 'districtPrev2Code'
  | 'cityPrev2Code'
  | 'provincePrev2Code'
  | 'districtResidenceCode'
  | 'cityResidenceCode'
  | 'cityResidenceTitle'
  | 'provinceResidenceCode'
  | 'provinceResidenceTitle'
  | 'cityCurrentCode'
  | 'cityCurrentTitle'
  | 'provinceCurrentCode'
  | 'provinceCurrentTitle'
  // تحصیلات و آزمون
  | 'diplomaCode'
  | 'diplomaTypeCode'
  | 'diplomaYear'
  | 'diplomaGpa'
  | 'associateGpa'
  | 'bachelorGpa'
  | 'preUniversityTypeCode'
  | 'preUniversityYear'
  | 'educationSystemCode'
  | 'courseCode'
  | 'courseTitle'
  | 'semesterCode'
  | 'totalScore'
  | 'totalRank'
  | 'nationalRank'
  | 'quotaRank'
  | 'orientationRank'
  | 'priority'
  | 'examStatus'
  | 'admitStatus'
  | 'acceptedWithoutExam'
  | 'militaryStatusCode'
  | 'employmentStatusCode'
  | 'graduatedAssociate'
  | 'graduatedBachelor'
  | 'graduatedMaster'
  | 'topStudent'
  | 'hasQuotaThreshold'
  | 'behyar'
  | 'teacher'
  | 'leftHanded'
  | 'gpaMismatch'
  // ایثارگری و سلامت
  | 'veteranTypeCode'
  | 'veteranOrgTitle'
  | 'veteranMonths'
  | 'disabilityCode'
  | 'disabilityTitle'
  | 'disabilitySeverityCode'
  | 'foreignerCode'
  | 'foreignerRef'
  | 'foreignerTitle'
  | 'religionCode'
  | 'religionTitle'
  | 'languageCode'
  | 'languageTitle'
  | 'defectCode'
  | 'commitmentCode'
  | 'healthCommitmentCode'
  // تماس و نشانی
  | 'phone'
  | 'mobile'
  | 'postalCode'
  | 'email'
  | 'address'
  // سوابق قبولی قبلی
  | 'previousFieldRow'
  | 'previousFieldGroup'
  | 'previousFieldCode'
  | 'academicRecordRef'
  | 'cancelFormReceived'
  // نمرات خام (بسط‌یافته)
  | `rawScore${number}`;

export interface SanjeshColumn {
  /** شمارهٔ ستون در فایل — از ۱ */
  colIndex: number;
  /** عنوان فارسی طبق ساختار رسمی */
  sanjeshTitle: string;
  /** طول اعلامی در ساختار (فقط برای اعتبارسنجی و نمایش نمونه) */
  charCount: number;
  /** فیلد مقصد در `dataJson` */
  targetField: SanjeshTargetField;
}

export interface SanjeshDecodeEntry {
  /** مقداری که در فایل می‌آید (کد یا عنوان) */
  value: string;
  /** عنوان فارسی متناظر */
  label: string;
  /** مقدار داخلی آفاق در صورت وجود */
  internalValue?: string;
}

export type SanjeshDecodeTable = Record<string, SanjeshDecodeEntry[]>;

export interface SanjeshExpandedRow {
  pdfRow: number;
  title: string;
  columns: number;
  charCount: number;
}

export interface SanjeshTemplate {
  /** کلید یکتا؛ در دیتابیس به‌عنوان `sanjesh_files.templateKey` ذخیره می‌شود */
  key: string;
  /** عنوان نمایشی */
  title: string;
  /** نوع آزمون */
  examKind: 'FANI' | 'ARSHAD' | 'K2K' | 'SARASARI';
  /** سال آزمون (شمسی) */
  examYear: number;
  /** تعداد ستون‌های بسط‌یافته */
  columnCount: number;
  /** تعداد ردیف‌های ساختار PDF (برای توضیح در UI) */
  pdfRowCount: number;
  /** ردیف‌هایی که بسط خورده‌اند — فقط جهت نمایش توضیح */
  expandedRows: SanjeshExpandedRow[];
  columns: SanjeshColumn[];
  decodeTables: SanjeshDecodeTable;
  /** آیا با فایل واقعی اعتبارسنجی شده است */
  verifiedWithRealFile: boolean;
}

/* ------------------------------------------------------------------ */
/* دیکدهای مشترک                                                      */
/* ------------------------------------------------------------------ */

const GENDER: SanjeshDecodeEntry[] = [
  { value: '1', label: 'زن', internalValue: 'FEMALE' },
  { value: '2', label: 'مرد', internalValue: 'MALE' },
  { value: 'زن', label: 'زن', internalValue: 'FEMALE' },
  { value: 'مرد', label: 'مرد', internalValue: 'MALE' },
];

const RELIGION: SanjeshDecodeEntry[] = [
  { value: '1', label: 'اسلام' },
  { value: '2', label: 'مسیحی' },
  { value: '3', label: 'کلیمی' },
  { value: '4', label: 'زرتشتی' },
];

const FOREIGNER: SanjeshDecodeEntry[] = [
  { value: '0', label: 'غیراتباع' },
  { value: '1', label: 'افغانستان' },
  { value: '2', label: 'پاکستان' },
  { value: '3', label: 'ترکیه' },
  { value: '4', label: 'عراق' },
  { value: '5', label: 'لبنان' },
  { value: '6', label: 'هند' },
  { value: '7', label: 'سایر کشورها' },
];

const DISABILITY: SanjeshDecodeEntry[] = [
  { value: '0', label: 'بدون معلولیت' },
  { value: '1', label: 'بینایی' },
  { value: '2', label: 'شنوایی' },
  { value: '3', label: 'جسمی و حرکتی' },
  { value: '4', label: 'آسیب گفتار و زبان' },
  { value: '5', label: 'تکامل رشد (اتیسم)' },
  { value: '6', label: 'اعصاب و روان' },
];

const DISABILITY_SEVERITY: SanjeshDecodeEntry[] = [
  { value: '0', label: 'نامشخص' },
  { value: '1', label: 'خفیف' },
  { value: '2', label: 'متوسط' },
  { value: '3', label: 'شدید' },
  { value: '4', label: 'خیلی شدید' },
];

const LANGUAGE: SanjeshDecodeEntry[] = [
  { value: '1', label: 'انگلیسی' },
  { value: '2', label: 'آلمانی' },
  { value: '3', label: 'فرانسه' },
  { value: '4', label: 'روسی' },
  { value: '5', label: 'ایتالیایی' },
  { value: 'انگليسي', label: 'انگلیسی' },
  { value: 'آلماني', label: 'آلمانی' },
  { value: 'فرانسه', label: 'فرانسه' },
  { value: 'روسي', label: 'روسی' },
  { value: 'ايتاليايي', label: 'ایتالیایی' },
];

const DEGREE: SanjeshDecodeEntry[] = [
  { value: '1', label: 'کاردانی' },
  { value: '2', label: 'کارشناسی' },
  { value: '3', label: 'کارشناسی ارشد' },
  { value: '4', label: 'دکترای عمومی' },
  { value: '5', label: 'دکترای پیوسته' },
];

const YES_NO: SanjeshDecodeEntry[] = [
  { value: '0', label: 'خیر' },
  { value: '1', label: 'بله' },
];

const GPA_MISMATCH: SanjeshDecodeEntry[] = [
  { value: '0', label: 'ندارد' },
  { value: '1', label: 'دارد' },
];

const QUOTA_FINAL_SARASARI: SanjeshDecodeEntry[] = [
  { value: '1', label: 'منطقه ۱' },
  { value: '2', label: 'منطقه ۲' },
  { value: '3', label: 'منطقه ۳' },
  { value: '4', label: 'خانواده شهدا' },
  { value: '5', label: 'ایثارگران ۲۵ درصد ظرفیت' },
  { value: '6', label: 'رزمندگان' },
  { value: '7', label: 'ایثارگران ۵ درصد ظرفیت' },
];

const QUOTA_ADMIT_SARASARI: SanjeshDecodeEntry[] = [
  { value: '0', label: 'آزاد' },
  { value: '1', label: 'منطقه ۱' },
  { value: '2', label: 'منطقه ۲' },
  { value: '3', label: 'منطقه ۳' },
  { value: '4', label: 'خانواده شهدا' },
  { value: '5', label: 'ایثارگران ۲۵ درصد ظرفیت' },
  { value: '6', label: 'رزمندگان' },
  { value: '7', label: 'کارمندی' },
  { value: '8', label: 'دیپلمه‌های کشاورزی' },
  { value: '9', label: 'ایثارگران ۵ درصد ظرفیت' },
];

const QUOTA_REG_SARASARI: SanjeshDecodeEntry[] = [
  { value: '1', label: 'مناطق' },
  { value: '2', label: 'خانواده شهدا' },
  { value: '3', label: 'جانبازان ۲۵ درصد و بالاتر' },
  { value: '4', label: 'فرزند جانباز ۲۵ درصد و بالاتر' },
  { value: '5', label: 'همسر جانباز ۲۵ درصد و بالاتر' },
  { value: '6', label: 'آزادگان' },
  { value: '7', label: 'فرزند آزاده' },
  { value: '8', label: 'همسر آزاده' },
  { value: '9', label: 'فرزند شهید و مفقودالاثر' },
  { value: '10', label: 'همسر شهید و مفقودالاثر' },
  { value: '11', label: 'رزمنده داوطلب بسیجی' },
  { value: '12', label: 'رزمنده وزارت جهاد کشاورزی' },
  { value: '13', label: 'رزمنده ستاد کل نیروهای مسلح' },
  { value: '14', label: 'جانبازان کمتر از ۲۵ درصد' },
  { value: '15', label: 'فرزند جانبازان کمتر از ۲۵ درصد' },
  { value: '16', label: 'همسر جانبازان کمتر از ۲۵ درصد' },
  { value: '17', label: 'فرزند رزمنده داوطلب بسیجی' },
  { value: '18', label: 'فرزند رزمنده وزارت جهاد کشاورزی' },
  { value: '19', label: 'فرزند رزمنده ستاد کل نیروهای مسلح' },
  { value: '20', label: 'همسر رزمنده داوطلب بسیجی' },
  { value: '21', label: 'همسر رزمنده وزارت جهاد کشاورزی' },
  { value: '22', label: 'همسر رزمنده ستاد کل نیروهای مسلح' },
];

const COURSE_SARASARI: SanjeshDecodeEntry[] = [
  { value: '1', label: 'روزانه' },
  { value: '2', label: 'نوبت دوم' },
  { value: '3', label: 'پیام نور' },
  { value: '4', label: 'نیمه حضوری' },
  { value: '5', label: 'محروم' },
  { value: '6', label: 'فرهنگیان/آزاد' },
  { value: '7', label: 'غیرانتفاعی' },
  { value: '8', label: 'فرهنگیان/شاغل' },
  { value: '9', label: 'پردیس خودگردان' },
  { value: '10', label: 'مجازی دولتی' },
  { value: '11', label: 'مجازی غیرانتفاعی' },
  { value: '12', label: 'شهریه‌پرداز' },
  { value: '13', label: 'مشترک با خارج' },
  { value: '14', label: 'دانشگاه آزاد' },
  { value: '15', label: 'خودگردان دانشگاه آزاد' },
  { value: '16', label: 'روزانه غیردولتی' },
];

const EMPLOYMENT_STATUS: SanjeshDecodeEntry[] = [
  { value: '0', label: 'هیچ‌کدام' },
  { value: '1', label: 'دانشجوی انصرافی روزانه' },
  { value: '2', label: 'دانشجوی انصرافی غیرروزانه' },
  { value: '3', label: 'دانشجوی روزانه' },
  { value: '4', label: 'دانشجوی غیرروزانه' },
  { value: '5', label: 'دانشجوی اخراجی' },
];

const VETERAN_TYPE_K2K: SanjeshDecodeEntry[] = [
  { value: '1', label: 'آزاد' },
  { value: '2', label: '—' },
  { value: '3', label: 'جانبازان ۲۵ درصد و بالاتر' },
  { value: '4', label: 'فرزند جانباز ۲۵ درصد و بالاتر' },
  { value: '5', label: 'همسر جانباز ۲۵ درصد و بالاتر' },
  { value: '6', label: 'آزادگان' },
  { value: '7', label: 'فرزند آزاده' },
  { value: '8', label: 'همسر آزاده' },
  { value: '9', label: 'فرزند شهید و مفقودالاثر' },
  { value: '10', label: 'همسر شهید و مفقودالاثر' },
  { value: '11', label: 'رزمنده متقاضی بسیجی' },
  { value: '12', label: 'رزمنده وزارت جهاد کشاورزی' },
  { value: '13', label: 'رزمنده ستاد کل نیروهای مسلح' },
  { value: '14', label: 'جانبازان کمتر از ۲۵ درصد' },
  { value: '15', label: 'فرزند جانبازان کمتر از ۲۵ درصد' },
  { value: '16', label: 'همسر جانبازان کمتر از ۲۵ درصد' },
  { value: '17', label: 'فرزند رزمنده متقاضی بسیجی' },
  { value: '18', label: 'فرزند رزمنده وزارت جهاد کشاورزی' },
  { value: '19', label: 'فرزند رزمنده ستاد کل نیروهای مسلح' },
  { value: '20', label: 'همسر رزمنده متقاضی بسیجی' },
  { value: '21', label: 'همسر رزمنده وزارت جهاد کشاورزی' },
  { value: '22', label: 'همسر رزمنده ستاد کل نیروهای مسلح' },
];

const DISABILITY_K2K: SanjeshDecodeEntry[] = [
  { value: '0', label: 'بدون معلولیت' },
  { value: '11', label: 'بینایی - خفیف' },
  { value: '12', label: 'بینایی - متوسط' },
  { value: '13', label: 'بینایی - شدید' },
  { value: '14', label: 'بینایی - خیلی شدید' },
  { value: '21', label: 'شنوایی - خفیف' },
  { value: '22', label: 'شنوایی - متوسط' },
  { value: '23', label: 'شنوایی - شدید' },
  { value: '24', label: 'شنوایی - خیلی شدید' },
  { value: '31', label: 'جسمی و حرکتی - خفیف' },
  { value: '32', label: 'جسمی و حرکتی - متوسط' },
  { value: '33', label: 'جسمی و حرکتی - شدید' },
  { value: '34', label: 'جسمی و حرکتی - خیلی شدید' },
  { value: '41', label: 'آسیب گفتار و زبان' },
  { value: '51', label: 'تکامل رشد (اتیسم)' },
  { value: '61', label: 'اعصاب و روان' },
];

const DEFECT_CODE: SanjeshDecodeEntry[] = [
  { value: '0', label: 'بدون نقص' },
  { value: '1', label: 'فاقد عکس' },
  { value: '2', label: 'مطابق دستورالعمل ثبت‌نامی اقدام گردد' },
  { value: '4', label: 'مطابق دستورالعمل ثبت‌نامی اقدام گردد' },
  { value: '5', label: 'مطابق دستورالعمل ثبت‌نامی اقدام گردد' },
  { value: '6', label: 'مطابق دستورالعمل ثبت‌نامی اقدام گردد' },
  { value: '15', label: 'دو حالت ۵ و ۱ را شامل می‌شود' },
];

const MILITARY_STATUS: SanjeshDecodeEntry[] = [
  { value: '0', label: 'مشمول / معاف‌نشده' },
  { value: '1', label: 'معافیت دائم' },
  { value: '2', label: 'معافیت پزشکی' },
  { value: '3', label: 'معافیت تحصیلی' },
  { value: '4', label: 'پایان خدمت' },
  { value: '5', label: 'در حال خدمت' },
  { value: '6', label: 'مشمول' },
  { value: '7', label: 'معافیت کفالت' },
  { value: '8', label: 'معافیت موارد خاص' },
  { value: '11', label: 'سایر' },
];

/* ------------------------------------------------------------------ */
/* سازندهٔ ستون                                                       */
/* ------------------------------------------------------------------ */

type ColTuple = [sanjeshTitle: string, charCount: number, targetField: SanjeshTargetField];

function buildColumns(tuples: ColTuple[]): SanjeshColumn[] {
  return tuples.map(([sanjeshTitle, charCount, targetField], i) => ({
    colIndex: i + 1,
    sanjeshTitle,
    charCount,
    targetField,
  }));
}

const FA_DIGITS = ['۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹', '۱۰', '۱۱', '۱۲', '۱۳', '۱۴', '۱۵', '۱۶', '۱۷', '۱۸', '۱۹', '۲۰', '۲۱', '۲۲', '۲۳'];

/** ستون‌های نمرهٔ خام — از ۱ تا n */
function rawScoreColumns(n: number, charCount = 6): ColTuple[] {
  return Array.from({ length: n }, (_, i) => [
    `نمره خام درس ${FA_DIGITS[i] ?? String(i + 1)}`,
    charCount,
    `rawScore${i + 1}` as SanjeshTargetField,
  ]);
}

/* ------------------------------------------------------------------ */
/* ۱. کاردانی فنی و حرفه‌ای ۱۴۰۵ — ۵۷ ستون                            */
/* ------------------------------------------------------------------ */

const FANI_1405: SanjeshTemplate = {
  key: 'FANI_1405',
  title: 'کاردانی ویژه دانشگاه ملی مهارت و غیردولتی-غیرانتفاعی ۱۴۰۵',
  examKind: 'FANI',
  examYear: 1405,
  columnCount: 57,
  pdfRowCount: 54,
  expandedRows: [{ pdfRow: 22, title: 'نمرات خام دروس (۴ درس)', columns: 4, charCount: 6 }],
  verifiedWithRealFile: true,
  columns: buildColumns([
    ['شماره داوطلب', 6, 'applicantNo'],
    ['شماره پرونده', 6, 'fileNo'],
    ['نام خانوادگی', 30, 'lastName'],
    ['نام', 30, 'firstName'],
    ['نام پدر', 30, 'fatherName'],
    ['جنس', 1, 'gender'],
    ['شماره شناسنامه', 10, 'idNumber'],
    ['تاریخ تولد (روز و ماه و سال)', 6, 'birthDate'],
    ['کد ملی', 10, 'nationalCode'],
    ['کد رشته تحصیلی', 2, 'majorCode'],
    ['عنوان رشته تحصیلی', 50, 'majorTitle'],
    ['کد رشته امتحانی', 2, 'fieldCode'],
    ['عنوان رشته امتحانی', 50, 'fieldTitle'],
    ['کد سهمیه نهایی', 2, 'quotaFinalCode'],
    ['عنوان سهمیه نهایی', 50, 'quotaFinalTitle'],
    ['کد سهمیه قبولی', 1, 'quotaAdmitCode'],
    ['عنوان سهمیه قبولی', 15, 'quotaAdmitTitle'],
    ['کد رشته محل قبولی', 4, 'fieldPlaceCode'],
    ['عنوان رشته محل قبولی', 70, 'fieldPlaceTitle'],
    ['کد دانشگاه قبولی', 4, 'universityCode'],
    ['عنوان دانشگاه قبولی', 70, 'universityTitle'],
    ...rawScoreColumns(4),
    ['نمره قبولی (نمره کل)', 6, 'totalScore'],
    ['کد دین', 1, 'religionCode'],
    ['کد معلولیت', 1, 'disabilityCode'],
    ['کد اتباع خارجی', 1, 'foreignerCode'],
    ['کد پیگیری اتباع خارجی', 16, 'foreignerRef'],
    ['کد استان اخذ دیپلم', 2, 'provinceDiplomaCode'],
    ['عنوان استان اخذ دیپلم', 20, 'provinceDiplomaTitle'],
    ['کد دیپلم', 5, 'diplomaCode'],
    ['کد استان اقامت', 2, 'provinceResidenceCode'],
    ['عنوان استان اقامت', 20, 'provinceResidenceTitle'],
    ['کد زبان خارجی', 1, 'languageCode'],
    ['عنوان زبان خارجی', 10, 'languageTitle'],
    ['تلفن ثابت', 11, 'phone'],
    ['تلفن همراه', 11, 'mobile'],
    ['کد پستی', 10, 'postalCode'],
    ['رایانامه (آدرس پست الکترونیکی)', 50, 'email'],
    ['کد استان محل سکونت', 2, 'provinceCurrentCode'],
    ['عنوان استان محل سکونت', 35, 'provinceCurrentTitle'],
    ['کد شهر محل سکونت', 4, 'cityCurrentCode'],
    ['عنوان شهر محل سکونت', 35, 'cityCurrentTitle'],
    ['آدرس', 200, 'address'],
    ['کد نقص', 3, 'defectCode'],
    ['معدل', 4, 'diplomaGpa'],
    ['وضعیت آزمون', 1, 'examStatus'],
    ['چپ دست می‌باشد', 1, 'leftHanded'],
    ['کد شهر محل تولد', 4, 'cityBirthCode'],
    ['عنوان شهر محل تولد', 50, 'cityBirthTitle'],
    ['کد تعهد ۲', 1, 'commitmentCode'],
    ['کد دوره', 1, 'courseCode'],
    ['عنوان دوره', 10, 'courseTitle'],
    ['نیمسال قبولی', 10, 'semesterCode'],
    ['نیاز به بررسی مغایرت معدل', 1, 'gpaMismatch'],
  ]),
  decodeTables: {
    gender: GENDER,
    religionCode: RELIGION,
    foreignerCode: FOREIGNER,
    disabilityCode: DISABILITY,
    defectCode: DEFECT_CODE,
    examStatus: [
      { value: '0', label: 'پذیرفته‌شده بدون آزمون (با سوابق تحصیلی)' },
      { value: '1', label: 'پذیرفته‌شده با آزمون' },
    ],
    leftHanded: YES_NO,
    commitmentCode: [
      { value: '0', label: 'ندارد' },
      { value: '1', label: 'دارد' },
    ],
    gpaMismatch: GPA_MISMATCH,
  },
};

/* ------------------------------------------------------------------ */
/* ۲. کارشناسی ارشد ۱۴۰۵ — ۷۴ ستون                                    */
/* ------------------------------------------------------------------ */

const ARSHAD_1405: SanjeshTemplate = {
  key: 'ARSHAD_1405',
  title: 'کارشناسی ارشد ۱۴۰۵',
  examKind: 'ARSHAD',
  examYear: 1405,
  columnCount: 74,
  pdfRowCount: 54,
  expandedRows: [{ pdfRow: 39, title: 'نمره خام دروس (۲۱ درس)', columns: 21, charCount: 6 }],
  verifiedWithRealFile: true,
  columns: buildColumns([
    ['شماره پرونده', 7, 'fileNo'],
    ['شماره داوطلبی', 7, 'applicantNo'],
    ['نام خانوادگی', 30, 'lastName'],
    ['نام', 30, 'firstName'],
    ['نام پدر', 15, 'fatherName'],
    ['جنسیت', 3, 'gender'],
    ['تاریخ تولد', 8, 'birthDate'],
    ['شماره شناسنامه', 10, 'idNumber'],
    ['کد ملی', 10, 'nationalCode'],
    ['زبان', 10, 'languageTitle'],
    ['عنوان اتباع خارجی', 20, 'foreignerTitle'],
    ['معدل فوق دیپلم', 4, 'associateGpa'],
    ['معدل لیسانس', 4, 'bachelorGpa'],
    ['کد سهمیه ثبت‌نامی', 1, 'quotaRegCode'],
    ['عنوان سهمیه ثبت‌نامی', 20, 'quotaRegTitle'],
    ['کد سهمیه قبولی', 1, 'quotaAdmitCode'],
    ['عنوان سهمیه قبولی', 20, 'quotaAdmitTitle'],
    ['کد رشته امتحانی قبولی', 4, 'fieldCode'],
    ['عنوان رشته امتحانی قبولی', 70, 'fieldTitle'],
    ['کد رشته محل قبولی', 5, 'fieldPlaceCode'],
    ['کد دانشگاه قبولی', 4, 'universityCode'],
    ['عنوان دانشگاه قبولی', 85, 'universityTitle'],
    ['کد گرایش قبولی', 2, 'orientationCode'],
    ['عنوان گرایش قبولی', 80, 'orientationTitle'],
    ['نمره کل قبولی', 6, 'totalScore'],
    ['اولویت قبولی', 3, 'priority'],
    ['رتبه کل در رشته امتحانی', 5, 'totalRank'],
    ['رتبه در گرایش قبولی', 5, 'orientationRank'],
    ['کد رشته تحصیلی', 4, 'majorCode'],
    ['عنوان رشته تحصیلی', 70, 'majorTitle'],
    ['کد دانشگاه اخذ مدرک', 4, 'degreeUniversityCode'],
    ['عنوان دانشگاه اخذ مدرک', 70, 'degreeUniversityTitle'],
    ['سال و ماه و روز اخذ مدرک', 8, 'degreeDate'],
    ['کد تعهد', 1, 'commitmentCode'],
    ['کد نظام وظیفه', 2, 'militaryStatusCode'],
    ['ارگان رزمندگی', 31, 'veteranOrgTitle'],
    ['مدت جبهه رزمندگی', 3, 'veteranMonths'],
    ['معلولیت', 20, 'disabilityTitle'],
    ...rawScoreColumns(21),
    ['تلفن ثابت', 11, 'phone'],
    ['تلفن همراه', 11, 'mobile'],
    ['کد پستی', 10, 'postalCode'],
    ['کد استان اقامت (سکونت)', 2, 'provinceResidenceCode'],
    ['عنوان استان اقامت (سکونت)', 35, 'provinceResidenceTitle'],
    ['کد شهر اقامت (سکونت)', 4, 'cityResidenceCode'],
    ['عنوان شهر اقامت (سکونت)', 35, 'cityResidenceTitle'],
    ['آدرس', 200, 'address'],
    ['کد پیگیری اتباع خارجی', 13, 'foreignerRef'],
    ['پست الکترونیکی', 50, 'email'],
    ['کد دوره', 2, 'courseCode'],
    ['عنوان دوره', 30, 'courseTitle'],
    ['کد شهر محل تولد', 4, 'cityBirthCode'],
    ['عنوان شهر محل تولد', 35, 'cityBirthTitle'],
    ['رتبه کشوری در گرایش قبولی', 6, 'nationalRank'],
  ]),
  decodeTables: {
    gender: GENDER,
    languageTitle: LANGUAGE,
    disabilityTitle: DISABILITY,
    commitmentCode: YES_NO,
    quotaRegCode: QUOTA_REG_SARASARI,
    quotaAdmitCode: QUOTA_ADMIT_SARASARI,
    courseCode: COURSE_SARASARI,
    militaryStatusCode: MILITARY_STATUS,
  },
};

/* ------------------------------------------------------------------ */
/* ۳. کاردانی به کارشناسی ناپیوسته ۱۴۰۵ — ۶۹ ستون                     */
/* ------------------------------------------------------------------ */

const K2K_1405: SanjeshTemplate = {
  key: 'K2K_1405',
  title: 'کاردانی به کارشناسی ناپیوسته ۱۴۰۵',
  examKind: 'K2K',
  examYear: 1405,
  columnCount: 69,
  pdfRowCount: 57,
  expandedRows: [{ pdfRow: 35, title: 'نمره خام (۱۳ فیلد ۶ تایی)', columns: 13, charCount: 6 }],
  // ✅ با فایل واقعی «7025 (2).txt» تأیید شد (۱۴۰۵/۱۱/۰۱): ۴۷ ردیف × ۶۹ ستون،
  // صفر تخلف طول، ۴۷/۴۷ کد ملی معتبر، هر ۶۹ ستون نگاشت شد (extras=0).
  // ستون‌های ۳۴، ۵۶ و ۵۸ در همهٔ ردیف‌های نمونه خالی بودند (اختیاری).
  verifiedWithRealFile: true,
  columns: buildColumns([
    ['شماره پرونده', 6, 'fileNo'],
    ['شماره داوطلب', 7, 'applicantNo'],
    ['نام خانوادگی', 30, 'lastName'],
    ['نام', 30, 'firstName'],
    ['نام پدر', 20, 'fatherName'],
    ['جنس', 3, 'gender'],
    ['تاریخ تولد (روز، ماه، سال)', 8, 'birthDate'],
    ['شماره شناسنامه', 10, 'idNumber'],
    ['کد ملی', 10, 'nationalCode'],
    ['عنوان دین', 15, 'religionTitle'],
    ['عنوان زبان امتحانی', 15, 'languageTitle'],
    ['کد استان بومی', 2, 'nativeProvinceCode'],
    ['کد سهمیه نهایی', 1, 'quotaFinalCode'],
    ['عنوان سهمیه نهایی', 15, 'quotaFinalTitle'],
    ['بومی', 1, 'nativeFlag'],
    ['کد سهمیه قبولی', 1, 'quotaAdmitCode'],
    ['عنوان سهمیه قبولی', 20, 'quotaAdmitTitle'],
    ['کد رشته امتحانی', 3, 'fieldCode'],
    ['عنوان رشته امتحانی', 60, 'fieldTitle'],
    ['کد رشته محل قبولی', 4, 'fieldPlaceCode'],
    ['عنوان رشته محل قبولی', 120, 'fieldPlaceTitle'],
    ['کد دانشگاه قبولی', 4, 'universityCode'],
    ['عنوان دانشگاه قبولی', 80, 'universityTitle'],
    ['نمره کل قبولی', 5, 'totalScore'],
    ['اولویت قبولی', 2, 'priority'],
    ['کد رشته فارغ‌التحصیلی', 4, 'graduatedMajorCode'],
    ['عنوان رشته فارغ‌التحصیلی', 60, 'graduatedMajorTitle'],
    ['کد محل فارغ‌التحصیلی', 4, 'graduatedPlaceCode'],
    ['عنوان محل فارغ‌التحصیلی', 80, 'graduatedPlaceTitle'],
    ['کد نوع ایثارگری', 2, 'veteranTypeCode'],
    ['مدت جبهه', 3, 'veteranMonths'],
    ['کد معلولیت', 2, 'disabilityCode'],
    ['کد اتباع خارجی', 1, 'foreignerCode'],
    ['کد پیگیری اتباع خارجی', 13, 'foreignerRef'],
    ...rawScoreColumns(13),
    ['شماره تلفن', 11, 'phone'],
    ['یارانامه (پست الکترونیکی)', 50, 'email'],
    ['کد پستی', 10, 'postalCode'],
    ['عنوان استان محل سکونت', 50, 'provinceCurrentTitle'],
    ['عنوان شهر محل سکونت', 50, 'cityCurrentTitle'],
    ['آدرس محل سکونت', 200, 'address'],
    ['شماره موبایل', 11, 'mobile'],
    ['کد استان اقامت', 2, 'provinceResidenceCode'],
    ['عنوان استان اقامت', 40, 'provinceResidenceTitle'],
    ['کد شهر اقامت', 4, 'cityResidenceCode'],
    ['عنوان شهر اقامت', 40, 'cityResidenceTitle'],
    ['کد نقص', 2, 'defectCode'],
    ['کد وضعیت', 1, 'examStatus'],
    ['معدل', 4, 'diplomaGpa'],
    ['چپ دست', 1, 'leftHanded'],
    ['کد شهر محل تولد', 4, 'cityBirthCode'],
    ['عنوان شهر محل تولد', 50, 'cityBirthTitle'],
    ['وضعیت قبولی', 2, 'admitStatus'],
    ['کد دوره', 1, 'courseCode'],
    ['عنوان دوره', 20, 'courseTitle'],
    ['کد نیمسال قبولی', 1, 'semesterCode'],
    ['نیاز به بررسی مغایرت معدل', 1, 'gpaMismatch'],
  ]),
  decodeTables: {
    gender: GENDER,
    veteranTypeCode: VETERAN_TYPE_K2K,
    disabilityCode: DISABILITY_K2K,
    foreignerCode: FOREIGNER,
    defectCode: DEFECT_CODE,
    examStatus: [
      { value: '1', label: 'پذیرش با آزمون' },
      { value: '2', label: 'پذیرش صرفاً با سوابق تحصیلی' },
    ],
    leftHanded: YES_NO,
    gpaMismatch: GPA_MISMATCH,
    semesterCode: [
      { value: '1', label: 'نیمسال اول' },
      { value: '2', label: 'نیمسال دوم' },
    ],
  },
};

/* ------------------------------------------------------------------ */
/* ۴. سراسری ۱۴۰۴ (معرفی‌شدگان تکمیل ظرفیت) — ۸۵ ستون                 */
/* ------------------------------------------------------------------ */

const SARASARI_1404: SanjeshTemplate = {
  key: 'SARASARI_1404',
  title: 'سراسری ۱۴۰۴ — معرفی‌شدگان تکمیل ظرفیت',
  examKind: 'SARASARI',
  examYear: 1404,
  columnCount: 85,
  pdfRowCount: 77,
  expandedRows: [{ pdfRow: 49, title: 'نمرات دروس (۹ فیلد)', columns: 9, charCount: 6 }],
  verifiedWithRealFile: true,
  columns: buildColumns([
    ['شناسه یکتا', 13, 'uniqueId'],
    ['شماره داوطلبی', 7, 'applicantNo'],
    ['نام خانوادگی', 30, 'lastName'],
    ['نام', 30, 'firstName'],
    ['نام پدر', 20, 'fatherName'],
    ['جنس', 1, 'gender'],
    ['تاریخ تولد (روز، ماه، سال)', 8, 'birthDate'],
    ['شماره شناسنامه', 10, 'idNumber'],
    ['کد ملی', 10, 'nationalCode'],
    ['کد وضعیت نظام وظیفه', 2, 'militaryStatusCode'],
    ['کد بخش تولد', 4, 'districtBirthCode'],
    ['کد شهر تولد', 2, 'cityBirthCode'],
    ['کد استان تولد', 2, 'provinceBirthCode'],
    ['کد بخش دیپلم یا پیش‌دانشگاهی', 4, 'districtDiplomaCode'],
    ['کد شهر دیپلم یا پیش‌دانشگاهی', 2, 'cityDiplomaCode'],
    ['کد استان دیپلم یا پیش‌دانشگاهی', 2, 'provinceDiplomaCode'],
    ['کد بخش سال قبل از دیپلم', 4, 'districtPrev1Code'],
    ['کد شهرستان سال قبل از دیپلم', 2, 'cityPrev1Code'],
    ['کد استان سال قبل از دیپلم', 2, 'provincePrev1Code'],
    ['کد بخش دو سال قبل از دیپلم', 4, 'districtPrev2Code'],
    ['کد شهرستان دو سال قبل از دیپلم', 2, 'cityPrev2Code'],
    ['کد استان دو سال قبل از دیپلم', 2, 'provincePrev2Code'],
    ['کد بخش اقامت', 4, 'districtResidenceCode'],
    ['کد شهر اقامت', 2, 'cityResidenceCode'],
    ['کد استان اقامت', 2, 'provinceResidenceCode'],
    ['کد استان بومی', 2, 'nativeProvinceCode'],
    ['کد سهمیه نهایی', 1, 'quotaFinalCode'],
    ['کد سهمیه ثبت‌نامی', 2, 'quotaRegCode'],
    ['کد سهمیه قبولی', 1, 'quotaAdmitCode'],
    ['کد معلولیت', 1, 'disabilityCode'],
    ['کد شدت معلولیت', 1, 'disabilitySeverityCode'],
    ['کد عنوان دیپلم', 2, 'diplomaTypeCode'],
    ['کد عنوان پیش‌دانشگاهی', 2, 'preUniversityTypeCode'],
    ['بهیار', 1, 'behyar'],
    ['آموزگار', 1, 'teacher'],
    ['گروه قبولی', 1, 'fieldGroup'],
    ['کد رشته قبولی', 5, 'majorCode'],
    ['دیکد رشته قبولی', 100, 'majorTitle'],
    ['گرایش قبولی', 60, 'orientationTitle'],
    ['کد دانشگاه قبولی', 4, 'universityCode'],
    ['دی کد دانشگاه قبولی', 60, 'universityTitle'],
    ['کد مقطع قبولی', 1, 'degreeCode'],
    ['کد دوره قبولی', 2, 'courseCode'],
    ['کد نظام آموزشی', 1, 'educationSystemCode'],
    ['کد اتباع خارجی و ملیت', 1, 'foreignerCode'],
    ['کد فراگیر اتباع', 16, 'foreignerRef'],
    ['سال اخذ دیپلم', 16, 'diplomaYear'],
    ['سال اخذ پیش‌دانشگاهی', 4, 'preUniversityYear'],
    ...rawScoreColumns(9),
    ['زبان خارجی', 1, 'languageCode'],
    ['نمره قبولی', 6, 'totalScore'],
    ['تلفن ثابت', 11, 'phone'],
    ['تلفن همراه', 11, 'mobile'],
    ['کد پستی', 10, 'postalCode'],
    ['عنوان استان محل سکونت', 50, 'provinceCurrentTitle'],
    ['عنوان شهر محل سکونت', 50, 'cityCurrentTitle'],
    ['آدرس محل سکونت', 200, 'address'],
    ['پست الکترونیکی', 50, 'email'],
    ['کد وضعیت اشتغال به تحصیل', 1, 'employmentStatusCode'],
    ['فارغ‌التحصیل مقطع کاردانی', 1, 'graduatedAssociate'],
    ['فارغ‌التحصیل مقطع کارشناسی', 1, 'graduatedBachelor'],
    ['فارغ‌التحصیل مقطع کارشناسی ارشد و بالاتر', 1, 'graduatedMaster'],
    ['معدل کتبی دیپلم', 4, 'diplomaGpa'],
    ['پذیرش بدون آزمون می‌باشد', 1, 'acceptedWithoutExam'],
    ['کد تعهد وزارت بهداشت', 1, 'healthCommitmentCode'],
    ['چپ دست می‌باشد', 1, 'leftHanded'],
    ['کد نقص', 1, 'defectCode'],
    ['رتبه در سهمیه نهایی', 6, 'quotaRank'],
    ['رتبه کشوری', 6, 'nationalRank'],
    ['دانشجوی ممتاز', 1, 'topStudent'],
    ['حداقل نمره سهمیه آزاد یا منطقه یک', 1, 'hasQuotaThreshold'],
    ['ردیف رشته قبولی', 3, 'previousFieldRow'],
    ['کد پیگیری سوابق تحصیلی', 26, 'academicRecordRef'],
    ['دریافت فرم انصراف', 1, 'cancelFormReceived'],
    ['نیاز به بررسی مغایرت معدل', 1, 'gpaMismatch'],
    ['گروه رشته محل قبولی قبلی', 1, 'previousFieldGroup'],
    ['کد رشته محل قبولی قبلی', 5, 'previousFieldCode'],
  ]),
  decodeTables: {
    gender: GENDER,
    foreignerCode: FOREIGNER,
    disabilityCode: DISABILITY,
    disabilitySeverityCode: DISABILITY_SEVERITY,
    languageCode: LANGUAGE,
    degreeCode: DEGREE,
    quotaFinalCode: QUOTA_FINAL_SARASARI,
    quotaRegCode: QUOTA_REG_SARASARI,
    quotaAdmitCode: QUOTA_ADMIT_SARASARI,
    courseCode: COURSE_SARASARI,
    employmentStatusCode: EMPLOYMENT_STATUS,
    defectCode: DEFECT_CODE,
    militaryStatusCode: MILITARY_STATUS,
    leftHanded: YES_NO,
    acceptedWithoutExam: YES_NO,
    healthCommitmentCode: YES_NO,
    cancelFormReceived: YES_NO,
    graduatedAssociate: YES_NO,
    graduatedBachelor: YES_NO,
    graduatedMaster: YES_NO,
    topStudent: YES_NO,
    gpaMismatch: GPA_MISMATCH,
  },
};

/* ------------------------------------------------------------------ */
/* رجیستری                                                            */
/* ------------------------------------------------------------------ */

export const SANJESH_TEMPLATES: SanjeshTemplate[] = [FANI_1405, ARSHAD_1405, K2K_1405, SARASARI_1404];

export const SANJESH_TEMPLATE_MAP: Record<string, SanjeshTemplate> = Object.fromEntries(
  SANJESH_TEMPLATES.map((t) => [t.key, t]),
);

export function getSanjeshTemplate(key: string | null | undefined): SanjeshTemplate | null {
  if (!key) return null;
  return SANJESH_TEMPLATE_MAP[key] ?? null;
}

/** تشخیص خودکار قالب از تعداد ستون فایل — فقط وقتی یکتا باشد. */
export function detectTemplateByColumnCount(colCount: number): SanjeshTemplate | null {
  const matches = SANJESH_TEMPLATES.filter((t) => t.columnCount === colCount);
  return matches.length === 1 ? matches[0] : null;
}

/**
 * نگاشت مقدار خام به عنوان فارسی.
 * هم کد و هم عنوان را می‌پذیرد (فایل‌های واقعی هر دو حالت را دارند:
 * کاردانی `جنس='2'` و ارشد `جنسیت='مرد'`).
 */
export function decodeSanjeshValue(
  template: SanjeshTemplate,
  field: string,
  raw: string | null | undefined,
): SanjeshDecodeEntry | null {
  if (raw == null) return null;
  const value = raw.trim();
  if (!value) return null;
  const table = template.decodeTables[field];
  if (!table) return null;
  return table.find((e) => e.value === value) ?? table.find((e) => e.label === value) ?? null;
}

/** فیلدهایی که مقدارشان در `dataJson` ذخیره می‌شود (بدون ستون‌های نادیده‌گرفته‌شده). */
export function targetFieldsOf(template: SanjeshTemplate): SanjeshTargetField[] {
  return template.columns.map((c) => c.targetField);
}
