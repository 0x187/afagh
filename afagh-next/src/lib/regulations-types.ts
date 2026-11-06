// ════════════════════════════════════════════════════════════════════════════
// تایپ‌ها و الگوهای پیش‌فرض آیین‌نامه‌های آموزشی (Pure Types & Presets)
// ════════════════════════════════════════════════════════════════════════════

export interface LevelOverride {
  min_units?: number;
  max_consecutive_probations?: number;
  max_total_probations?: number;
  max_study_semesters?: number;
}

export interface RegulationConfig {
  /** تفاوت‌های مقطعی که در نمرات یکسان‌اند (فقط نیمسال/سنوات): SHORT=کاردانی و ناپیوسته، LONG=پیوسته */
  levels?: { SHORT?: LevelOverride; LONG?: LevelOverride };
  regular_term_rules: {
    min_units: number;
    max_units: number;
    probation_max_units: number;
    honors_min_gpa: number;
    honors_max_units: number;
  };
  summer_term_rules: {
    default_max_units: number;
    graduating_max_units: number;
  };
  graduating_term_rules: {
    can_take_with_probation: boolean;
    max_units: number;
    auto_corequisite_allowed: boolean;
  };
  probation_and_tenure: {
    probation_gpa_threshold: number; // مرز مشروطی (۱۲ برای لیسانس، ۱۴ برای ارشد)
    max_consecutive_probations: number; // حداکثر مشروطی متوالی (۳)
    max_total_probations: number; // حداکثر مشروطی متناوب (مادهٔ ۱۶: ۲ ناپیوسته / ۳ پیوسته)
    max_study_semesters: number; // سقف سنوات عادی (۸ لیسانس، ۴ ارشد)
  };
  grading_and_gpa: {
    /** EXCLUDE_ALWAYS = دادنامهٔ هیئت عمومی دیوان عدالت اداری + بخشنامهٔ ۲/۲۱/۲۸۳۴۲۸ */
    failed_course_gpa_policy: 'EXCLUDE_ALWAYS' | 'EXCLUDE_IF_PASSED' | 'EXCLUDE_IF_PASSED_1391' | 'KEEP_ALWAYS';
    default_passing_grade: number; // کف قبولی عادی (۱۰ لیسانس، ۱۲ ارشد، ۱۴ دکتری)
    retakeMinGrade?: number;       // حد نصاب قبولی مجدد (پیش‌فرض = default_passing_grade)
    regulationLabel?: string;      // برچسب نمایشی: "آیین‌نامه ۱۳۹۳"
    /** کد سفارشی سما برای مردودیِ حذف‌شده (خالی = خودکار ۹۳۱/-۹۱/۹۴۱/۹۵۱) */
    failed_sama_status_code?: string;
    /**
     * درسِ تکرارشده‌ای که قبلاً هم قبول شده (اخذ مجدد برای ارتقای معدل):
     * وقتی true باشد، فقط بالاترین نمرهٔ همان کد درس در معدل کل شمرده می‌شود
     * (واحد آن درس یک‌بار حساب می‌شود، نه به تعداد دفعات اخذ).
     * پیش‌فرض false/نامشخص = رفتار فعلی بدون تغییر (هر تلاش جداگانه در معدل می‌آید)،
     * چون این رفتار همه‌جا یکسان اعمال نمی‌شود و باید توسط ادمین آگاهانه فعال شود.
     */
    dedupeRepeatedCourses?: boolean;
  };
  quota_overrides?: {
    [quotaName: string]: {
      summer_term_rules?: {
        default_max_units?: number;
      };
      probation_max_units?: number;
      extra_allowed_semesters?: number;
    };
  };
}

export const DEFAULT_BACHELOR_REGULATION_1403: RegulationConfig = {
  regular_term_rules: {
    min_units: 12,
    max_units: 20,
    probation_max_units: 14,
    honors_min_gpa: 17.0,
    honors_max_units: 24,
  },
  summer_term_rules: {
    default_max_units: 6,
    graduating_max_units: 8,
  },
  graduating_term_rules: {
    can_take_with_probation: true,
    max_units: 24,
    auto_corequisite_allowed: true,
  },
  probation_and_tenure: {
    probation_gpa_threshold: 12.0,
    max_consecutive_probations: 3,
    max_total_probations: 3,
    max_study_semesters: 8,
  },
    grading_and_gpa: {
      failed_course_gpa_policy: 'EXCLUDE_IF_PASSED', // آیین‌نامه مصوب ۱۳۹۷ به بعد
      default_passing_grade: 10.0,
      regulationLabel: 'آیین‌نامه ۱۴۰۲',
    },
  quota_overrides: {
    SHAHED_ISARGAR: {
      summer_term_rules: {
        default_max_units: 8,
      },
      probation_max_units: 14,
      extra_allowed_semesters: 2,
    },
    ELITE: {
      summer_term_rules: {
        default_max_units: 8,
      },
    },
  },
};

export const DEFAULT_BACHELOR_REGULATION_1390: RegulationConfig = {
  regular_term_rules: {
    min_units: 12,
    max_units: 20,
    probation_max_units: 14,
    honors_min_gpa: 17.0,
    honors_max_units: 24,
  },
  summer_term_rules: {
    default_max_units: 6,
    graduating_max_units: 8,
  },
  graduating_term_rules: {
    can_take_with_probation: false,
    max_units: 20,
    auto_corequisite_allowed: false,
  },
  probation_and_tenure: {
    probation_gpa_threshold: 12.0,
    max_consecutive_probations: 3,
    max_total_probations: 3,
    max_study_semesters: 10,
  },
    grading_and_gpa: {
      failed_course_gpa_policy: 'KEEP_ALWAYS', // آیین‌نامه سال ۱۳۹۰: نمره ردی همیشه در معدل کل باقی می‌ماند
      default_passing_grade: 10.0,
      regulationLabel: 'آیین‌نامه ماقبل ۱۳۹۱',
    },
  quota_overrides: {
    SHAHED_ISARGAR: {
      summer_term_rules: {
        default_max_units: 8,
      },
    },
  },
};

/**
 * ════════════════════════════════════════════════════════════════════
 *  پریست‌های اجرایی آیین‌نامه‌های واقعی وزارت (قابل اجرا توسط موتور)
 *
 *  - REG_1402: «موارد مهم آیین‌نامه آموزشی ۱۴۰۲ و به بعد» (کاردانی/کارشناسی
 *    پیوسته و ناپیوسته): قبولی ۱۰، مشروطی زیر ۱۲، کاردانی/ناپیوسته ۲ مشروطی
 *    و کارشناسی پیوسته ۳ نیمسال تا محرومیت، ۱۲ تا ۲۰ واحد (تابستان ۶)،
 *    معدل ۱۷+ → ۲۴ واحد، ترم آخر ۲۴ واحد، سنوات ۴/۸ (+۱/+۲ تمدید)، معدل کل ۱۲.
 *  - REG_1393: آیین‌نامه مصوب ۹۳/۷/۲۸ (کدهای سما ۹۳/۹۴/۹۱۴/۹۱۵): ۱۲ تا ۲۰ واحد،
 *    مشروطی ۲/۳، سنوات ۴/۸ نیمسال، حذف نمره مردودی با قبولی بعدی.
 *  - REG_1391: آیین‌نامه دوره‌های کاردانی/کارشناسی (نامه ۱۳۸۷۱۵ مورخ ۹۱/۷/۲۲):
 *    حداقل ۱۴ واحد، مشروطی ۲/۳، سنوات ۵/۱۰ نیمسال، جبرانی در معدل حساب می‌شود،
 *    حذف نمره قبلی با گذراندن با ۱۴+.
 *
 *  تفکیک کاردانی/ناپیوسته (۲ مشروطی) و پیوسته (۳ مشروطی) در سازنده‌ها.
 * ════════════════════════════════════════════════════════════════════
 */

/**
 * گروه مقطع برای تفاوت‌های نیمسال/سنوات (نمرات در همه یکسان است):
 * SHORT = کاردانی (پیوسته/ناپیوسته) و کارشناسی ناپیوسته (سما: 1/5/9/10، سید AD)
 * LONG = کارشناسی پیوسته (سما: 2 و بقیه، سید BS) — MS/PHD گروه خودشان را دارند.
 */
export type LevelGroup = 'SHORT' | 'LONG' | 'MS' | 'PHD';

export function maghtaGroup(maghtaOrCode: string | number | null | undefined): LevelGroup {
  // پیشوند منبع را بردار: کدهای مقطع با SAMA- و HAMAVA- می‌آیند و پیش‌تر فقط
  // SAMA- حذف می‌شد ⇒ «HAMAVA-5» (کارشناسی ناپیوسته) و «HAMAVA-1» (کاردانی)
  // به‌اشتباه گروه LONG (سقف مشروطی ۳) می‌گرفتند در حالی که سقفشان ۲ است.
  const m = String(maghtaOrCode ?? '').trim().replace(/^[A-Za-z]+-/, '').toUpperCase();
  if (m === '3' || m === 'MS') return 'MS';
  if (['4', '6', '7', '8'].includes(m) || m === 'PHD') return 'PHD';
  if (['1', '5', '9', '10'].includes(m) || m === 'AD') return 'SHORT';
  return 'LONG';
}

/** true = کاردانی (پیوسته/ناپیوسته) یا کارشناسی ناپیوسته (سقف مشروطی ۲) */
export function isNonContinuous(maghta: string | number): boolean {
  return maghtaGroup(maghta) === 'SHORT';
}

/**
 * اعمال تفاوت‌های مقطعی روی پیکربندی تجمیعی (فقط نیمسال/سنوات؛ نمرات مشترک‌اند).
 * خروجی: کپی جدید با probation_and_tenure و min_units به‌روزشده.
 */
export function applyLevelConfig(config: RegulationConfig, group: LevelGroup): RegulationConfig {
  const ov = group === 'SHORT' ? config.levels?.SHORT : group === 'LONG' ? config.levels?.LONG : undefined;
  if (!ov) return config;
  return {
    ...config,
    regular_term_rules: { ...config.regular_term_rules, ...(ov.min_units != null ? { min_units: ov.min_units } : {}) },
    probation_and_tenure: {
      ...config.probation_and_tenure,
      ...(ov.max_consecutive_probations != null ? { max_consecutive_probations: ov.max_consecutive_probations } : {}),
      ...(ov.max_total_probations != null ? { max_total_probations: ov.max_total_probations } : {}),
      ...(ov.max_study_semesters != null ? { max_study_semesters: ov.max_study_semesters } : {}),
    },
  };
}

function reg1402(): RegulationConfig {
  return {
    levels: {
      SHORT: { max_consecutive_probations: 2, max_total_probations: 2, max_study_semesters: 4 },
      LONG: { max_consecutive_probations: 3, max_total_probations: 3, max_study_semesters: 8 },
    },
    regular_term_rules: { min_units: 12, max_units: 20, probation_max_units: 14, honors_min_gpa: 17.0, honors_max_units: 24 },
    summer_term_rules: { default_max_units: 6, graduating_max_units: 8 },
    graduating_term_rules: { can_take_with_probation: true, max_units: 24, auto_corequisite_allowed: true },
    probation_and_tenure: {
      probation_gpa_threshold: 12.0,
      max_consecutive_probations: 3,
      max_total_probations: 3,
      max_study_semesters: 8,
    },
    grading_and_gpa: { failed_course_gpa_policy: 'EXCLUDE_ALWAYS', default_passing_grade: 10.0, retakeMinGrade: 10, regulationLabel: 'آیین‌نامه ۱۴۰۲' },
  };
}

function reg1393(): RegulationConfig {
  return {
    levels: {
      SHORT: { max_consecutive_probations: 2, max_total_probations: 2, max_study_semesters: 4 },
      LONG: { max_consecutive_probations: 3, max_total_probations: 3, max_study_semesters: 8 },
    },
    regular_term_rules: { min_units: 12, max_units: 20, probation_max_units: 14, honors_min_gpa: 17.0, honors_max_units: 24 },
    summer_term_rules: { default_max_units: 6, graduating_max_units: 8 },
    graduating_term_rules: { can_take_with_probation: true, max_units: 24, auto_corequisite_allowed: true },
    probation_and_tenure: {
      probation_gpa_threshold: 12.0,
      max_consecutive_probations: 3,
      max_total_probations: 3,
      max_study_semesters: 8,
    },
    grading_and_gpa: { failed_course_gpa_policy: 'EXCLUDE_IF_PASSED', default_passing_grade: 10.0, retakeMinGrade: 10, regulationLabel: 'آیین‌نامه ۱۳۹۳' },
  };
}

function reg1391(): RegulationConfig {
  return {
    levels: {
      SHORT: { min_units: 14, max_consecutive_probations: 2, max_total_probations: 2, max_study_semesters: 5 },
      LONG: { min_units: 14, max_consecutive_probations: 3, max_total_probations: 3, max_study_semesters: 10 },
    },
    regular_term_rules: { min_units: 14, max_units: 20, probation_max_units: 14, honors_min_gpa: 17.0, honors_max_units: 24 },
    summer_term_rules: { default_max_units: 6, graduating_max_units: 8 },
    graduating_term_rules: { can_take_with_probation: true, max_units: 24, auto_corequisite_allowed: true },
    probation_and_tenure: {
      probation_gpa_threshold: 12.0,
      max_consecutive_probations: 3,
      max_total_probations: 3,
      max_study_semesters: 10,
    },
    // تبصره ۱۳۹۱: با گذراندن با ۱۴+ نمره قبلی حذف می‌شود؛ حذف از نیمسال + کل
    grading_and_gpa: { failed_course_gpa_policy: 'EXCLUDE_IF_PASSED_1391', default_passing_grade: 10.0, retakeMinGrade: 14, regulationLabel: 'آیین‌نامه ۱۳۹۱' },
  };
}

/**
 * آیین‌نامه دوره‌های تحصیلی مصوب ۳۰/۱۰/۱۳۹۶ (جلسه ۸۸۹) — ورودی ۹۷-۹۸ به بعد.
 * - ارشد: مدت ۴ نیمسال (+۲ تمدید)، ۲۸ تا ۳۲ واحد (۴-۶ پایان‌نامه)، حداقل ۸ واحد
 *   در نیمسال، قبولی درس ۱۲، معدل نیمسال ۱۴، مشروطی زیر ۱۴ (سقف ۲)، تغییر
 *   رشته/انتقال ممنوع، پایان‌نامه کیفی و خارج از معدل، فارغ‌التحصیلی با معدل
 *   کل ۱۴ + دفاع موفق.
 * - دکتری تخصصی: ۶ تا ۸ نیمسال تمام‌وقت، ۳۶ واحد، قبولی ۱۴، معدل کل ۱۶
 *   (شرط ورود به جامع)، رساله کیفی خارج از معدل، تغییر رشته/انتقال ممنوع.
 */
/** ماقبل ۱۳۹۱: بدون حذف نمره مردودی (KEEP_ALWAYS) — اعداد احتیاطی مشابه ۱۳۹۱ */
function regPre1391(): RegulationConfig {
  return {
    regular_term_rules: { min_units: 12, max_units: 20, probation_max_units: 14, honors_min_gpa: 17.0, honors_max_units: 24 },
    summer_term_rules: { default_max_units: 6, graduating_max_units: 8 },
    graduating_term_rules: { can_take_with_probation: true, max_units: 24, auto_corequisite_allowed: true },
    probation_and_tenure: {
      probation_gpa_threshold: 12.0,
      max_consecutive_probations: 3,
      max_total_probations: 3,
      max_study_semesters: 10,
    },
    grading_and_gpa: { failed_course_gpa_policy: 'KEEP_ALWAYS', default_passing_grade: 10.0, regulationLabel: 'آیین‌نامه ماقبل ۱۳۹۱' },
  };
}

function reg1394MasterFor(): RegulationConfig {
  return {
    regular_term_rules: { min_units: 8, max_units: 14, probation_max_units: 10, honors_min_gpa: 17.0, honors_max_units: 16 },
    summer_term_rules: { default_max_units: 4, graduating_max_units: 6 },
    graduating_term_rules: { can_take_with_probation: true, max_units: 14, auto_corequisite_allowed: true },
    probation_and_tenure: {
      probation_gpa_threshold: 14.0,
      max_consecutive_probations: 2,
      max_total_probations: 2,
      max_study_semesters: 4,
    },
    grading_and_gpa: { failed_course_gpa_policy: 'EXCLUDE_IF_PASSED', default_passing_grade: 12.0, retakeMinGrade: 12, regulationLabel: 'آیین‌نامه ۱۳۹۴ ارشد' },
  };
}

function reg1394PhdFor(): RegulationConfig {
  return {
    regular_term_rules: { min_units: 6, max_units: 12, probation_max_units: 8, honors_min_gpa: 17.0, honors_max_units: 12 },
    summer_term_rules: { default_max_units: 4, graduating_max_units: 4 },
    graduating_term_rules: { can_take_with_probation: false, max_units: 12, auto_corequisite_allowed: false },
    probation_and_tenure: {
      probation_gpa_threshold: 16.0,
      max_consecutive_probations: 2,
      max_total_probations: 2,
      max_study_semesters: 8,
    },
    grading_and_gpa: { failed_course_gpa_policy: 'EXCLUDE_IF_PASSED', default_passing_grade: 14.0, retakeMinGrade: 14, regulationLabel: 'آیین‌نامه ۱۳۹۴ دکتری' },
  };
}

/** پریست قانونی آییننامهٔ ۱۴۰۲ برای کارشناسی ارشد (مادهٔ ۳۷: معدل ۱۴، کف قبولی ۱۲) */
function reg1402MasterFor(): RegulationConfig {
  return {
    ...reg1394MasterFor(),
    grading_and_gpa: {
      failed_course_gpa_policy: 'EXCLUDE_ALWAYS',
      default_passing_grade: 12.0,
      retakeMinGrade: 12,
      regulationLabel: 'آییننامه ۱۴۰۲ — کارشناسی ارشد',
    },
  };
}

/** پریست قانونی آییننامهٔ ۱۴۰۲ برای دکتری تخصصی (مادهٔ ۴۹: معدل ۱۶، کف قبولی ۱۴) */
function reg1402PhdFor(): RegulationConfig {
  return {
    ...reg1394PhdFor(),
    grading_and_gpa: {
      failed_course_gpa_policy: 'EXCLUDE_ALWAYS',
      default_passing_grade: 14.0,
      retakeMinGrade: 14,
      regulationLabel: 'آییننامه ۱۴۰۲ — دکتری تخصصی',
    },
  };
}

export const REGULATION_PRESETS = {
  reg1402, reg1393, reg1391, regPre1391,
  reg1394MasterFor, reg1394PhdFor,
  reg1402MasterFor, reg1402PhdFor,
  isNonContinuous, maghtaGroup, applyLevelConfig,
};

export const DEFAULT_MASTER_REGULATION_1403: RegulationConfig = {
  regular_term_rules: {
    min_units: 8,
    max_units: 14,
    probation_max_units: 10,
    honors_min_gpa: 17.0,
    honors_max_units: 16,
  },
  summer_term_rules: {
    default_max_units: 4,
    graduating_max_units: 6,
  },
  graduating_term_rules: {
    can_take_with_probation: true,
    max_units: 14,
    auto_corequisite_allowed: true,
  },
  probation_and_tenure: {
    probation_gpa_threshold: 14.0, // مرز مشروطی ارشد
    max_consecutive_probations: 2,
    max_total_probations: 2,
    max_study_semesters: 4, // ۴ نیمسال عادی
  },
  grading_and_gpa: {
    failed_course_gpa_policy: 'EXCLUDE_IF_PASSED',
    default_passing_grade: 12.0, // کف قبولی ارشد
    retakeMinGrade: 12,
    regulationLabel: 'آیین‌نامه ۱۳۹۴ ارشد',
  },
};
