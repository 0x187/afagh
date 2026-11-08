// Central registry of the admin dashboard modules — the single source of truth.
// Port of afagh-next/src/lib/admin-modules.tsx (module list, groups and roles are
// kept 1:1 with the reference app so the menu, dashboard grid and category pages
// can never show a module the destination page would reject).
//
// Role notes align with homeFor and the page guards:
//   ADMIN, EDU_EXPERT, ARCHIVE_EXPERT, FINANCE_EXPERT, FINANCE,
//   MILITARY_OFFICER, VAULT_MANAGER, DEP_HEAD, VICE_EDU
//   plus GRADUATION_EXPERT, PROFESSOR, DEP_HEAD for the defense desk.

export type ModuleGroupKey =
  | 'edu' | 'fin' | 'plan' | 'exam' | 'research' | 'reports' | 'archive' | 'settings';

/** Dashboard category cards — display order. */
export const MODULE_GROUPS: { key: ModuleGroupKey; title: string; emoji: string; desc: string }[] = [
  {
    "key": "edu",
    "title": "آموزش",
    "emoji": "🎓",
    "desc": "دانشجویان، پذیرش، کاتالوگ، دروس و آیین‌نامه"
  },
  {
    "key": "fin",
    "title": "مالی",
    "emoji": "💰",
    "desc": "حقوق، شهریه، دفتر مالی و صندوق"
  },
  {
    "key": "plan",
    "title": "برنامه‌ریزی درسی",
    "emoji": "🗓️",
    "desc": "کارتابل مدیر گروه و فرآیندها"
  },
  {
    "key": "exam",
    "title": "امتحانات",
    "emoji": "📝",
    "desc": "برنامه‌ریزی و مدیریت امتحانات"
  },
  {
    "key": "research",
    "title": "پژوهش و فارغ‌التحصیلی",
    "emoji": "🔬",
    "desc": "دفاع، فارغ‌التحصیلی و مدارک"
  },
  {
    "key": "reports",
    "title": "گزارش‌ها",
    "emoji": "📑",
    "desc": "مرکز گزارش‌ها و هوش تجاری"
  },
  {
    "key": "archive",
    "title": "سامانه بایگانی و درخواستها",
    "emoji": "🗄️",
    "desc": "اسناد، ثمین و موارد خاص"
  },
  {
    "key": "settings",
    "title": "تنظیمات",
    "emoji": "⚙️",
    "desc": "دسترسی‌ها، دانشگاه‌ها، انتقال داده و پیکربندی"
  }
];

export interface AdminModule {
  href: string;
  title: string;
  desc: string;
  group?: ModuleGroupKey | null;
  /** Roles that see and may open this module. */
  roles: string[];
  /** Permission codes that (on their own) also grant access. */
  permissions: string[];
  /** Card gradient on the dashboard. */
  accent: string;
  /** Card icon background. */
  iconBg: string;
  /** Icon glyph. */
  emoji: string;
  /** Show in the horizontal top nav? */
  inNav: boolean;
  /** Show as a dashboard grid card? */
  inGrid: boolean;
}

export const ADMIN_MODULES: AdminModule[] = [
  {
    "href": "/admin",
    "title": "کارتابل گردش کار و جبرانی",
    "desc": "رسیدگی به درخواست‌های دانشجویی و شورای آموزشی",
    "group": null,
    "roles": [
      "ADMIN",
      "EDU_EXPERT"
    ],
    "permissions": [],
    "accent": "from-purple-950 to-indigo-950 border-purple-700/50",
    "iconBg": "bg-purple-700/80 border-purple-500/50",
    "emoji": "📋",
    "inNav": true,
    "inGrid": false
  },
  {
    "href": "/admin/students",
    "title": "پرونده جامع دانشجویان و پرسنل",
    "desc": "پرونده، مدارک، KYC و سوابق",
    "group": "edu",
    "roles": [
      "ADMIN",
      "EDU_EXPERT",
      "ARCHIVE_EXPERT",
      "MILITARY_OFFICER"
    ],
    "permissions": [
      "students:view_dossier"
    ],
    "accent": "from-slate-900 to-slate-950 border-slate-600/50",
    "iconBg": "bg-slate-700/80 border-slate-500/50",
    "emoji": "🎓",
    "inNav": true,
    "inGrid": true
  },
  {
    "href": "/admin/admissions",
    "title": "پذیرش سنجش و فرمول‌ساز",
    "desc": "ثبت‌نام، سنجش و فرمول‌های پذیرش",
    "group": "edu",
    "roles": [
      "ADMIN",
      "EDU_EXPERT"
    ],
    "permissions": [],
    "accent": "from-sky-950 to-indigo-950 border-sky-700/50",
    "iconBg": "bg-sky-700/80 border-sky-500/50",
    "emoji": "📥",
    "inNav": false,
    "inGrid": false
  },
  {
    "href": "/admin/sanjesh",
    "title": "تبدیل اطلاعات سازمان سنجش",
    "desc": "فایل‌ها، تطبیق فیلدها، براورد، تطبیق و صف پذیرش",
    "group": "edu",
    "roles": [
      "ADMIN",
      "EDU_EXPERT"
    ],
    "permissions": [],
    "accent": "from-teal-950 to-cyan-950 border-teal-700/50",
    "iconBg": "bg-teal-700/80 border-teal-500/50",
    "emoji": "🗂️",
    "inNav": true,
    "inGrid": true
  },
  {
    "href": "/admin/codes",
    "title": "مرکز کدها",
    "desc": "تعریف و بازبینی کد دانشکده، گروه، رشته، مقطع و درس",
    "group": "settings",
    "roles": [
      "ADMIN",
      "VICE_EDU",
      "EDU_EXPERT"
    ],
    "permissions": [],
    "accent": "from-amber-950 to-slate-950 border-amber-700/50",
    "iconBg": "bg-amber-700/80 border-amber-500/50",
    "emoji": "🔑",
    "inNav": true,
    "inGrid": false
  },
  {
    "href": "/admin/departments",
    "title": "گروه‌های آموزشی و مدیران گروه",
    "desc": "تعریف گروه، انتخاب مدیر گروه و اعضا",
    "group": "edu",
    "roles": [
      "ADMIN",
      "VICE_EDU"
    ],
    "permissions": [],
    "accent": "from-cyan-950 to-slate-950 border-cyan-700/50",
    "iconBg": "bg-cyan-700/80 border-cyan-500/50",
    "emoji": "🏛️",
    "inNav": true,
    "inGrid": true
  },
  {
    "href": "/admin/curriculum",
    "title": "کاتالوگ و سرفصل رشته‌ها",
    "desc": "طرح‌های آموزشی و سرفصل دروس",
    "group": "edu",
    "roles": [
      "ADMIN",
      "EDU_EXPERT"
    ],
    "permissions": [],
    "accent": "from-emerald-950 to-teal-950 border-emerald-700/50",
    "iconBg": "bg-emerald-700/80 border-emerald-500/50",
    "emoji": "📚",
    "inNav": true,
    "inGrid": true
  },
  {
    "href": "/admin/virtual-classes",
    "title": "کلاس‌های آنلاین (BBB)",
    "desc": "گزارش برگزاری، در حال برگزاری، دانشجو و ضبط‌ها",
    "group": "reports",
    "roles": [
      "ADMIN",
      "EDU_EXPERT"
    ],
    "permissions": [],
    "accent": "from-indigo-950 to-purple-950 border-indigo-700/50",
    "iconBg": "bg-indigo-700/80 border-indigo-500/50",
    "emoji": "📡",
    "inNav": true,
    "inGrid": true
  },
  {
    "href": "/admin/grade-status-codes",
    "title": "مدیریت دروس و کدهای وضعیت نمره",
    "desc": "تعریف، ویرایش و کدگذاری وضعیت نمره دروس بانک و چارت",
    "group": "settings",
    "roles": [
      "ADMIN",
      "EDU_EXPERT",
      "VICE_EDU"
    ],
    "permissions": [],
    "accent": "from-amber-950 to-orange-950 border-amber-700/50",
    "iconBg": "bg-amber-700/80 border-amber-500/50",
    "emoji": "🏷️",
    "inNav": true,
    "inGrid": false
  },
  {
    "href": "/admin/equivalence-clusters",
    "title": "خوشه‌های دروس هم‌ارز",
    "desc": "تعریف خوشه و افزودن/حذف دروس هم‌محتوا",
    "group": "settings",
    "roles": [
      "ADMIN",
      "EDU_EXPERT",
      "VICE_EDU"
    ],
    "permissions": [],
    "accent": "from-teal-950 to-cyan-950 border-teal-700/50",
    "iconBg": "bg-teal-700/80 border-teal-500/50",
    "emoji": "🧩",
    "inNav": true,
    "inGrid": false
  },
  {
    "href": "/admin/compliance-policy",
    "title": "سیاست‌های انطباق آیین‌نامه",
    "desc": "سیاست‌های انطباق آیین‌نامه — هنوز پورت نشده",
    "group": "edu",
    "roles": ["ADMIN", "EDU_EXPERT"],
    "permissions": [],
    "accent": "from-slate-900 to-slate-800 border-slate-600/50",
    "iconBg": "bg-slate-700/80 border-slate-500/50",
    "emoji": "🧾",
    "inNav": true,
    "inGrid": true
  },
  {
    "href": "/admin/regulations",
    "title": "مرکز مدیریت آیین‌نامه‌ها",
    "desc": "تدوین و نسخه‌بندی آیین‌نامه‌های آموزشی",
    "group": "edu",
    "roles": [
      "ADMIN",
      "EDU_EXPERT"
    ],
    "permissions": [],
    "accent": "from-stone-900 to-amber-950 border-stone-600/50",
    "iconBg": "bg-stone-700/80 border-stone-500/50",
    "emoji": "⚖️",
    "inNav": true,
    "inGrid": true
  },
  {
    "href": "/admin/discipline",
    "title": "کمیته انضباطی",
    "desc": "پرونده‌سازی تخلفات، تصمیم کمیته و اسناد مرتبط",
    "group": "edu",
    "roles": [
      "ADMIN",
      "EDU_EXPERT",
      "VICE_EDU"
    ],
    "permissions": [],
    "accent": "from-rose-950 to-red-950 border-rose-700/50",
    "iconBg": "bg-rose-700/80 border-rose-500/50",
    "emoji": "🛡️",
    "inNav": true,
    "inGrid": true
  },
  {
    "href": "/admin/council",
    "title": "شورای آموزشی",
    "desc": "جلسات شورا، صورت‌جلسه و مصوبات با پیگیری اجرا",
    "group": "edu",
    "roles": [
      "ADMIN",
      "EDU_EXPERT",
      "VICE_EDU"
    ],
    "permissions": [],
    "accent": "from-violet-950 to-indigo-950 border-violet-700/50",
    "iconBg": "bg-violet-700/80 border-violet-500/50",
    "emoji": "🏛️",
    "inNav": true,
    "inGrid": true
  },
  {
    "href": "/admin/warnings",
    "title": "هشدارهای زمان‌بندی‌شده",
    "desc": "هشدار شهریه، غیبت، مدارک و امتحان به دانشجویان",
    "group": "edu",
    "roles": [
      "ADMIN",
      "EDU_EXPERT",
      "VICE_EDU"
    ],
    "permissions": [],
    "accent": "from-amber-950 to-yellow-950 border-amber-700/50",
    "iconBg": "bg-amber-700/80 border-amber-500/50",
    "emoji": "⏰",
    "inNav": true,
    "inGrid": true
  },
  {
    "href": "/admin/enrollment-approvals",
    "title": "تأییدیه انتخاب واحد انگلیسی",
    "desc": "درخواست ثبت‌نام درس انگلیسی و تأیید/رد کارشناس",
    "group": "edu",
    "roles": [
      "ADMIN",
      "EDU_EXPERT",
      "VICE_EDU"
    ],
    "permissions": [],
    "accent": "from-teal-950 to-emerald-950 border-teal-700/50",
    "iconBg": "bg-teal-700/80 border-teal-500/50",
    "emoji": "✅",
    "inNav": true,
    "inGrid": true
  },
  {
    "href": "/admin/bypass",
    "title": "درخواست‌های بدون پیش‌نیاز / تداخل امتحانی",
    "desc": "تصمیم کارشناس آموزش رشته و معاون آموزش + گزارش رد خودکار",
    "group": "edu",
    "roles": [
      "ADMIN",
      "EDU_EXPERT",
      "VICE_EDU"
    ],
    "permissions": [],
    "accent": "from-indigo-950 to-violet-950 border-indigo-700/50",
    "iconBg": "bg-indigo-700/80 border-indigo-500/50",
    "emoji": "🔀",
    "inNav": true,
    "inGrid": true
  },
  {
    "href": "/admin/dorm",
    "title": "کارت سکونت خوابگاه",
    "desc": "ثبت سکونت دوره‌ای و صدور کارت سکونت قابل چاپ",
    "group": "edu",
    "roles": [
      "ADMIN",
      "EDU_EXPERT",
      "VICE_EDU"
    ],
    "permissions": [],
    "accent": "from-orange-950 to-amber-950 border-orange-700/50",
    "iconBg": "bg-orange-700/80 border-orange-500/50",
    "emoji": "🏠",
    "inNav": true,
    "inGrid": true
  },
  {
    "href": "/admin/enrollment-confirmation",
    "title": "تأییدیه انتخاب واحد",
    "desc": "صدور برگه چاپی با QR استعلام برای هر دانشجو",
    "group": "edu",
    "roles": [
      "ADMIN",
      "EDU_EXPERT",
      "VICE_EDU"
    ],
    "permissions": [],
    "accent": "from-lime-950 to-emerald-950 border-lime-700/50",
    "iconBg": "bg-lime-700/80 border-lime-500/50",
    "emoji": "🖨️",
    "inNav": true,
    "inGrid": true
  },
  {
    "href": "/admin/course-merge",
    "title": "ادغام دروس",
    "desc": "ادغام دستی کلاس‌ها، جدا کردن و بازگشت به خودکار",
    "group": "edu",
    "roles": [
      "ADMIN",
      "EDU_EXPERT",
      "VICE_EDU"
    ],
    "permissions": [],
    "accent": "from-cyan-950 to-sky-950 border-cyan-700/50",
    "iconBg": "bg-cyan-700/80 border-cyan-500/50",
    "emoji": "🔗",
    "inNav": true,
    "inGrid": true
  },
  {
    "href": "/admin/regulation-check",
    "title": "بررسی کدهای وضعیت نمره",
    "desc": "تشخیص و اصلاح خودکار کدهای وضعیت نمره سما بر اساس آیین‌نامه",
    "group": "settings",
    "roles": [
      "ADMIN"
    ],
    "permissions": [],
    "accent": "from-red-950 to-rose-950 border-red-700/50",
    "iconBg": "bg-red-700/80 border-red-500/50",
    "emoji": "🔍",
    "inNav": true,
    "inGrid": false
  },
  {
    "href": "/admin/scheduling?tab=DEPT_ROOMS",
    "title": "مدیریت سهمیهٔ سالن‌ها",
    "desc": "تخصیص/لغو/واگذاری سالن‌ها به دپارتمان‌ها",
    "group": "plan",
    "roles": [
      "ADMIN",
      "EDU_EXPERT"
    ],
    "permissions": [],
    "accent": "from-emerald-900 to-teal-950 border-emerald-700/50",
    "iconBg": "bg-emerald-800/80 border-emerald-500/50",
    "emoji": "🏛️",
    "inNav": true,
    "inGrid": true
  },
  {
    "href": "/admin/scheduling",
    "title": "برنامه‌ریزی درسی مدیر گروه",
    "desc": "ماتریس حضور، سناریوها و تقویم جلسات",
    "group": "plan",
    "roles": [
      "ADMIN",
      "EDU_EXPERT"
    ],
    "permissions": [],
    "accent": "from-slate-900 to-indigo-900 border-slate-700/50",
    "iconBg": "bg-slate-800 border-slate-600/50",
    "emoji": "🗓️",
    "inNav": true,
    "inGrid": true
  },
  {
    "href": "/admin/curriculum",
    "title": "تعریف کاتالوگ رشته",
    "desc": "کاتالوگ، دروس، ترم‌بندی، پیش‌نیاز و سهم واحد هر نوع درس",
    "group": "plan",
    "roles": [
      "ADMIN",
      "EDU_EXPERT"
    ],
    "permissions": [],
    "accent": "from-emerald-950 to-teal-950 border-emerald-700/50",
    "iconBg": "bg-emerald-700/80 border-emerald-500/50",
    "emoji": "📚",
    "inNav": false,
    "inGrid": true
  },
  {
    "href": "/admin/exams",
    "title": "مدیریت و برنامه‌ریزی امتحانات",
    "desc": "موتور ضدتقلب، سالن‌ها و غیبت‌ها",
    "group": "plan",
    "roles": [
      "ADMIN",
      "EDU_EXPERT",
      "VAULT_MANAGER"
    ],
    "permissions": [],
    "accent": "from-indigo-900 to-indigo-950 border-indigo-700/50",
    "iconBg": "bg-indigo-700/80 border-indigo-500/50",
    "emoji": "📝",
    "inNav": true,
    "inGrid": true
  },
  {
    "href": "/admin/evaluations",
    "title": "پنجرهٔ ارزشیابی اساتید",
    "desc": "بازهٔ باز/بستهٔ ارزشیابی پیش از امتحانات",
    "group": "plan",
    "roles": [
      "ADMIN"
    ],
    "permissions": [],
    "accent": "from-indigo-900 to-indigo-950 border-indigo-700/50",
    "iconBg": "bg-indigo-700/80 border-indigo-500/50",
    "emoji": "🗓️",
    "inNav": true,
    "inGrid": true
  },
  {
    "href": "/admin/schedule-conflicts",
    "title": "تداخل‌های واقعی برنامه",
    "desc": "گزارش و رفع تداخل استاد/سالن (کلاس ادغامی تفکیک شده)",
    "group": "plan",
    "roles": [
      "ADMIN",
      "EDU_EXPERT",
      "VICE_EDU"
    ],
    "permissions": [],
    "accent": "from-rose-900 to-indigo-950 border-rose-700/50",
    "iconBg": "bg-rose-700/80 border-rose-500/50",
    "emoji": "🚦",
    "inNav": true,
    "inGrid": true
  },
  {
    "href": "/admin/templates",
    "title": "قالب‌های پیامک و ارتباطات",
    "desc": "طراحی متون آزاد، تگ‌های پویا و تست",
    "group": "settings",
    "roles": [
      "ADMIN",
      "EDU_EXPERT"
    ],
    "permissions": [],
    "accent": "from-teal-950 to-indigo-950 border-teal-700/50",
    "iconBg": "bg-teal-800/80 border-teal-500/50",
    "emoji": "📨",
    "inNav": true,
    "inGrid": true
  },
  {
    "href": "/admin/broadcast",
    "title": "ارسال پیام همگانی",
    "desc": "پیام به دانشجویان/اساتید رشته، گروه، دانشکده یا ورودی",
    "group": "settings",
    "roles": [
      "ADMIN",
      "EDU_EXPERT"
    ],
    "permissions": [],
    "accent": "from-teal-950 to-indigo-950 border-teal-700/50",
    "iconBg": "bg-teal-800/80 border-teal-500/50",
    "emoji": "📣",
    "inNav": true,
    "inGrid": true
  },
  {
    "href": "/admin/manual-enroll",
    "title": "ثبت‌نام به‌جای دانشجو",
    "desc": "تکی/دسته‌جمعی با کاتالوگ و پیش‌نیاز — ردیابی کی و چرا",
    "group": "edu",
    "roles": [
      "ADMIN",
      "EDU_EXPERT"
    ],
    "permissions": [
      "edu:manage_enrollment"
    ],
    "accent": "from-indigo-950 to-slate-950 border-indigo-700/50",
    "iconBg": "bg-indigo-800/80 border-indigo-500/50",
    "emoji": "📝",
    "inNav": true,
    "inGrid": true
  },
  {
    "href": "/admin/group-transfer",
    "title": "انتقال بین گروه‌ها",
    "desc": "انتقال دانشجو بین گروه‌های یک درس با چک سخت‌گیری‌ها",
    "group": "edu",
    "roles": [
      "ADMIN",
      "EDU_EXPERT"
    ],
    "permissions": [
      "edu:manage_enrollment"
    ],
    "accent": "from-cyan-950 to-slate-950 border-cyan-700/50",
    "iconBg": "bg-cyan-800/80 border-cyan-500/50",
    "emoji": "🔀",
    "inNav": true,
    "inGrid": true
  },
  {
    "href": "/admin/offering-editor",
    "title": "تعریف درس در ترم",
    "desc": "ظرفیت، زمان کلاس، سالن و امتحان — با گارد تداخل",
    "group": "plan",
    "roles": [
      "ADMIN",
      "EDU_EXPERT"
    ],
    "permissions": [
      "scheduling:manage_chart"
    ],
    "accent": "from-violet-950 to-slate-950 border-violet-700/50",
    "iconBg": "bg-violet-800/80 border-violet-500/50",
    "emoji": "🛠️",
    "inNav": true,
    "inGrid": true
  },
  {
    "href": "/admin/expert-scopes",
    "title": "دامنهٔ دسترسی کارشناسان",
    "desc": "تخصیص دانشگاه/دانشکده/گروه/رشته به کارشناس آموزش",
    "group": "settings",
    "roles": [
      "ADMIN"
    ],
    "permissions": [],
    "accent": "from-zinc-900 to-slate-950 border-zinc-600/50",
    "iconBg": "bg-zinc-800/80 border-zinc-500/50",
    "emoji": "🔐",
    "inNav": true,
    "inGrid": true
  },
  {
    "href": "/admin/edu-expert-assign",
    "title": "تخصیص کارشناس به کلاس‌ها",
    "desc": "کارشناس آموزشِ مسئولِ هر کلاس — تک‌تک یا گروهی برای یک ترم",
    "group": "settings",
    "roles": [
      "ADMIN",
      "EDU_EXPERT"
    ],
    "permissions": [],
    "accent": "from-indigo-900 to-violet-950 border-indigo-600/50",
    "iconBg": "bg-indigo-800/80 border-indigo-500/50",
    "emoji": "👤",
    "inNav": true,
    "inGrid": true
  },
  {
    "href": "/admin/code-hub",
    "title": "کدها و وضعیت نمره",
    "desc": "مرکز کدها + کدهای وضعیت نمره + بررسی خودکار سما — یکجا",
    "group": "settings",
    "roles": [
      "ADMIN",
      "EDU_EXPERT",
      "VICE_EDU"
    ],
    "permissions": [],
    "accent": "from-amber-900 to-orange-950 border-amber-600/50",
    "iconBg": "bg-amber-800/80 border-amber-500/50",
    "emoji": "🧩",
    "inNav": true,
    "inGrid": true
  },
  {
    "href": "/admin/weekly-board",
    "title": "سردر برنامهٔ هفتگی",
    "desc": "برنامهٔ هفتگی کلاس‌ها — قابل چاپ برای نصب روی سردر",
    "group": "plan",
    "roles": [
      "ADMIN",
      "EDU_EXPERT"
    ],
    "permissions": [
      "scheduling:manage_chart"
    ],
    "accent": "from-teal-950 to-slate-950 border-teal-700/50",
    "iconBg": "bg-teal-800/80 border-teal-500/50",
    "emoji": "🗓️",
    "inNav": true,
    "inGrid": true
  },
  {
    "href": "/admin/attendance-control",
    "title": "کنترل حضور و غیاب کلاس‌ها",
    "desc": "ثبتِ تشکیلِ کلاس‌های امروز در اتاق‌های تحت مسئولیت — به‌نامِ استاد هر درس",
    "group": "edu",
    "roles": [
      "ADMIN",
      "EDU_EXPERT",
      "ATTENDANCE_CONTROLLER"
    ],
    "permissions": [],
    "accent": "from-indigo-950 to-slate-950 border-indigo-700/50",
    "iconBg": "bg-indigo-800/80 border-indigo-500/50",
    "emoji": "⏱️",
    "inNav": true,
    "inGrid": true
  },
  {
    "href": "/admin/archive",
    "title": "بایگانی الکترونیک مدارک",
    "desc": "اسناد، تأیید و بازیابی مدارک",
    "group": "archive",
    "roles": [
      "ADMIN",
      "ARCHIVE_EXPERT"
    ],
    "permissions": [],
    "accent": "from-zinc-900 to-slate-950 border-zinc-600/50",
    "iconBg": "bg-zinc-700/80 border-zinc-500/50",
    "emoji": "🗄️",
    "inNav": true,
    "inGrid": true
  },
  {
    "href": "/admin/payroll",
    "title": "حقوق و دستمزد",
    "desc": "حکم کارگزینی، فیش و تسویه مالی",
    "group": "fin",
    "roles": [
      "ADMIN",
      "EDU_EXPERT",
      "FINANCE_EXPERT",
      "FINANCE"
    ],
    "permissions": [
      "finance:view_ledger"
    ],
    "accent": "from-cyan-950 to-sky-950 border-cyan-700/50",
    "iconBg": "bg-cyan-700/80 border-cyan-500/50",
    "emoji": "💼",
    "inNav": true,
    "inGrid": true
  },
  {
    "href": "/admin/payroll/coverage",
    "title": "پوشش فرمول‌ها",
    "desc": "کدام درس‌ها فرمول دارند، کدام ندارند و چرا",
    "group": "fin",
    "roles": [
      "ADMIN",
      "EDU_EXPERT",
      "VICE_EDU",
      "FINANCE_EXPERT",
      "FINANCE"
    ],
    "permissions": [],
    "accent": "from-teal-950 to-emerald-950 border-teal-700/50",
    "iconBg": "bg-teal-700/80 border-teal-500/50",
    "emoji": "🗺️",
    "inNav": true,
    "inGrid": true
  },
  {
    "href": "/admin/student-finance",
    "title": "امور مالی دانشجویان",
    "desc": "شهریه، دفتر مالی و بدهی دانشجویان",
    "group": "fin",
    "roles": [
      "ADMIN",
      "FINANCE_EXPERT",
      "FINANCE"
    ],
    "permissions": [
      "finance:view_ledger"
    ],
    "accent": "from-emerald-900 to-teal-950 border-emerald-600/50",
    "iconBg": "bg-emerald-700/80 border-emerald-500/50",
    "emoji": "💳",
    "inNav": true,
    "inGrid": true
  },
  {
    "href": "/admin/finance",
    "title": "کارتابل کارشناس مالی",
    "desc": "فهرست کامل دانشجویان، کارنامهٔ مالی، تخفیف، بنیاد، چک و وام",
    "group": "fin",
    "roles": [
      "ADMIN",
      "FINANCE_EXPERT",
      "FINANCE"
    ],
    "permissions": [
      "finance:view_ledger"
    ],
    "accent": "from-teal-900 to-emerald-950 border-teal-600/50",
    "iconBg": "bg-teal-700/80 border-teal-500/50",
    "emoji": "🗂️",
    "inNav": true,
    "inGrid": true
  },
  {
    "href": "/admin/tuition",
    "title": "موتور شهریه",
    "desc": "قواعد شهریهٔ ثابت و متغیر بر اساس نوع ترم و نوع درس",
    "group": "fin",
    "roles": [
      "ADMIN",
      "FINANCE_EXPERT",
      "FINANCE"
    ],
    "permissions": [
      "finance:view_ledger"
    ],
    "accent": "from-cyan-900 to-sky-950 border-cyan-600/50",
    "iconBg": "bg-cyan-700/80 border-cyan-500/50",
    "emoji": "🧮",
    "inNav": true,
    "inGrid": true
  },
  {
    "href": "/admin/course-finance",
    "title": "نوع درس مالی دروس",
    "desc": "تعیین «نوع درس مالی» سما برای هر درس — کلید محاسبهٔ شهریهٔ متغیر",
    "group": "fin",
    "roles": [
      "ADMIN",
      "EDU_EXPERT",
      "FINANCE_EXPERT",
      "FINANCE"
    ],
    "permissions": [
      "finance:view_ledger"
    ],
    "accent": "from-violet-900 to-purple-950 border-violet-600/50",
    "iconBg": "bg-violet-700/80 border-violet-500/50",
    "emoji": "🏷️",
    "inNav": true,
    "inGrid": true
  },
  {
    "href": "/admin/finance/pos",
    "title": "ترمینال‌های POS (پرداخت حضوری)",
    "desc": "ثبت پرداخت کارت‌خوان فیزیکی، ویدی، گزارش روزانه صندوق",
    "group": "fin",
    "roles": [
      "ADMIN",
      "FINANCE_EXPERT",
      "FINANCE",
      "CASHIER"
    ],
    "permissions": [
      "finance:view_ledger"
    ],
    "accent": "from-orange-900 to-amber-950 border-orange-600/50",
    "iconBg": "bg-orange-700/80 border-orange-500/50",
    "emoji": "🏧",
    "inNav": true,
    "inGrid": true
  },
  {
    "href": "/admin/student-cards",
    "title": "کارت دانشجویی",
    "desc": "صدور، چاپ و استعلام کارت",
    "group": "edu",
    "roles": [
      "ADMIN",
      "EDU_EXPERT"
    ],
    "permissions": [],
    "accent": "from-fuchsia-950 to-purple-950 border-fuchsia-700/50",
    "iconBg": "bg-fuchsia-700/80 border-fuchsia-500/50",
    "emoji": "🪪",
    "inNav": true,
    "inGrid": true
  },
  {
    "href": "/admin/short-courses",
    "title": "آموزش‌های آزاد و گواهینامه‌ها",
    "desc": "دوره‌های آزاد و صدور گواهینامه",
    "group": "edu",
    "roles": [
      "ADMIN",
      "EDU_EXPERT"
    ],
    "permissions": [],
    "accent": "from-amber-950 to-yellow-950 border-amber-700/50",
    "iconBg": "bg-amber-700/80 border-amber-500/50",
    "emoji": "🏆",
    "inNav": true,
    "inGrid": true
  },
  {
    "href": "/admin/grade-objections",
    "title": "بررسی اعتراض به نمره",
    "desc": "کارتابل اعتراض‌های دانشجویان به نمرات قطعی و ثبت نتیجهٔ کارشناس",
    "group": "edu",
    "roles": [
      "ADMIN",
      "EDU_EXPERT",
      "VICE_EDU"
    ],
    "permissions": [],
    "accent": "from-rose-950 to-red-950 border-rose-700/50",
    "iconBg": "bg-rose-700/80 border-rose-500/50",
    "emoji": "📝",
    "inNav": true,
    "inGrid": true
  },
  {
    "href": "/admin/workflows",
    "title": "فرآیندها، SLA و کارتابل (BPM)",
    "desc": "موتور فرآیندها و پایش گلوگاه‌ها",
    "group": "archive",
    "roles": [
      "ADMIN",
      "EDU_EXPERT",
      "FINANCE_EXPERT",
      "FINANCE"
    ],
    "permissions": [],
    "accent": "from-purple-950 to-indigo-950 border-purple-700/50",
    "iconBg": "bg-purple-700/80 border-purple-500/50",
    "emoji": "🔀",
    "inNav": true,
    "inGrid": true
  },
  {
    "href": "/admin/reports",
    "title": "مرکز گزارش‌های آموزشی",
    "desc": "فعال ترم، خلاصه وضعیت، مشروطی، برترها + خروجی Excel",
    "group": "reports",
    "roles": [
      "ADMIN",
      "EDU_EXPERT",
      "ARCHIVE_EXPERT",
      "MILITARY_OFFICER"
    ],
    "permissions": [
      "reports:edu"
    ],
    "accent": "from-blue-950 to-indigo-950 border-blue-700/50",
    "iconBg": "bg-blue-700/80 border-blue-500/50",
    "emoji": "📑",
    "inNav": true,
    "inGrid": true
  },
  {
    "href": "/admin/reports/builder",
    "title": "گزارش‌ساز",
    "desc": "خودت ستون‌ها و شرط‌ها را بچین، نام بگذار و ذخیره کن",
    "group": "reports",
    "roles": [
      "ADMIN",
      "EDU_EXPERT",
      "FINANCE_EXPERT",
      "FINANCE"
    ],
    "permissions": [],
    "accent": "from-indigo-950 to-violet-950 border-indigo-700/50",
    "iconBg": "bg-indigo-700/80 border-indigo-500/50",
    "emoji": "🛠️",
    "inNav": true,
    "inGrid": true
  },
  {
    "href": "/admin/reports/saved",
    "title": "گزارش‌های ذخیره‌شده",
    "desc": "اجرا و خروجیِ گزارش‌هایی که در گزارش‌ساز ساخته شده‌اند",
    "group": "reports",
    "roles": [
      "ADMIN",
      "EDU_EXPERT",
      "ARCHIVE_EXPERT",
      "MILITARY_OFFICER",
      "FINANCE_EXPERT",
      "FINANCE",
      "CASHIER"
    ],
    "permissions": [],
    "accent": "from-teal-950 to-emerald-950 border-teal-700/50",
    "iconBg": "bg-teal-700/80 border-teal-500/50",
    "emoji": "📂",
    "inNav": true,
    "inGrid": true
  },
  {
    "href": "/admin/finance/reports",
    "title": "گزارش‌های مالی",
    "desc": "شهریه، صورت‌حساب، کارتابل مالی، حق‌التدریس و BI مالی",
    "group": "fin",
    "roles": [
      "ADMIN",
      "FINANCE_EXPERT",
      "FINANCE",
      "CASHIER"
    ],
    "permissions": [
      "reports:finance"
    ],
    "accent": "from-emerald-900 to-teal-950 border-emerald-600/50",
    "iconBg": "bg-emerald-700/80 border-emerald-500/50",
    "emoji": "📊",
    "inNav": true,
    "inGrid": true
  },
  {
    "href": "/admin/finance/reports/student-statement",
    "title": "صورت حساب مالی دانشجویان (۹ مشخصه)",
    "desc": "شهریه ثابت/متغیر، تخفیف، موضوعی، بنیاد، پرداخت آنلاین/POS، وام، مانده",
    "group": "fin",
    "roles": [
      "ADMIN",
      "FINANCE_EXPERT",
      "FINANCE",
      "CASHIER"
    ],
    "permissions": [],
    "accent": "from-emerald-900 to-teal-950 border-emerald-600/50",
    "iconBg": "bg-emerald-700/80 border-emerald-500/50",
    "emoji": "📄",
    "inNav": true,
    "inGrid": true
  },
  {
    "href": "/admin/bi",
    "title": "ارزشیابی اساتید و کارکنان",
    "desc": "داشبوردها و تحلیل ارزشیابی",
    "group": "reports",
    "roles": [
      "ADMIN"
    ],
    "permissions": [],
    "accent": "from-blue-950 to-indigo-950 border-blue-700/50",
    "iconBg": "bg-blue-700/80 border-blue-500/50",
    "emoji": "📊",
    "inNav": true,
    "inGrid": true
  },
  {
    "href": "/admin/permissions",
    "title": "ماتریس دسترسی‌ها (RBAC)",
    "desc": "نقش‌ها، مجوزها و کاربران",
    "group": "settings",
    "roles": [
      "ADMIN"
    ],
    "permissions": [],
    "accent": "from-rose-950 to-red-950 border-rose-700/50",
    "iconBg": "bg-rose-700/80 border-rose-500/50",
    "emoji": "🛡️",
    "inNav": true,
    "inGrid": true
  },
  {
    "href": "/admin/graduation",
    "title": "فارغ‌التحصیلی و مدارک",
    "desc": "تسویه‌حساب و صدور مدارک پایانی",
    "group": "research",
    "roles": [
      "ADMIN"
    ],
    "permissions": [
      "graduation:review_dossier"
    ],
    "accent": "from-indigo-950 to-violet-950 border-indigo-700/50",
    "iconBg": "bg-indigo-700/80 border-indigo-500/50",
    "emoji": "🎓",
    "inNav": true,
    "inGrid": true
  },
  {
    "href": "/admin/defense-scheduling",
    "title": "برنامه‌ریزی و ثبت نتیجهٔ دفاع پایان‌نامه",
    "desc": "تأیید پروپوزال، تعیین وقت دفاع و ثبت نتیجه با هیأت داوران",
    "group": "research",
    "roles": [
      "ADMIN",
      "EDU_EXPERT",
      "GRADUATION_EXPERT",
      "DEP_HEAD",
      "PROFESSOR"
    ],
    "permissions": [],
    "accent": "from-teal-950 to-cyan-950 border-teal-700/50",
    "iconBg": "bg-teal-700/80 border-teal-500/50",
    "emoji": "🛡️",
    "inNav": true,
    "inGrid": true
  },
  {
    "href": "/admin/universities",
    "title": "مدیریت دانشگاه‌ها (چندمستأجری)",
    "desc": "آفاق + منحل‌شده‌ها — کد و اتصال ثمین",
    "group": "settings",
    "roles": [
      "ADMIN"
    ],
    "permissions": [],
    "accent": "from-indigo-900 to-slate-950 border-indigo-700/50",
    "iconBg": "bg-indigo-700/80 border-indigo-500/50",
    "emoji": "🏛️",
    "inNav": true,
    "inGrid": true
  },
  {
    "href": "/admin/migration",
    "title": "انتقال داده از سیستم قدیمی",
    "desc": "نگاشت کد، شهریه و نمرات (ETL)",
    "group": "settings",
    "roles": [
      "ADMIN"
    ],
    "permissions": [],
    "accent": "from-amber-900 to-orange-950 border-amber-700/50",
    "iconBg": "bg-amber-700/80 border-amber-500/50",
    "emoji": "🔄",
    "inNav": true,
    "inGrid": true
  },
  {
    "href": "/admin/sama-sync",
    "title": "همگام‌سازی هفتگی سما",
    "desc": "افزودن ثبت‌نام‌ها و نمره‌های تازه از فایل سما — بدون حذف یا بازنویسی",
    "group": "settings",
    "roles": [
      "ADMIN"
    ],
    "permissions": [],
    "accent": "from-teal-900 to-emerald-950 border-teal-700/50",
    "iconBg": "bg-teal-700/80 border-teal-500/50",
    "emoji": "🔁",
    "inNav": true,
    "inGrid": true
  },
  {
    "href": "/admin/samin",
    "title": "هاب ثمین — سازمان امور دانشجویان",
    "desc": "ارسال per-دانشگاه + رهگیری trace",
    "group": "settings",
    "roles": [
      "ADMIN"
    ],
    "permissions": [],
    "accent": "from-sky-900 to-cyan-950 border-sky-700/50",
    "iconBg": "bg-sky-700/80 border-sky-500/50",
    "emoji": "📡",
    "inNav": true,
    "inGrid": true
  },
  {
    "href": "/admin/login-showcase",
    "title": "ویترین صفحه ورود",
    "desc": "اطلاعیه‌ها، اسلایدها و ارم دانشگاه‌ها",
    "group": "settings",
    "roles": [
      "ADMIN"
    ],
    "permissions": [],
    "accent": "from-emerald-900 to-teal-950 border-emerald-700/50",
    "iconBg": "bg-emerald-700/80 border-emerald-500/50",
    "emoji": "🖼️",
    "inNav": true,
    "inGrid": true
  },
  {
    "href": "/admin/saham",
    "title": "گزارش سالانهٔ سهام",
    "desc": "خروجی اکسل سامانهٔ آماری (IRPHE)",
    "group": "settings",
    "roles": [
      "ADMIN"
    ],
    "permissions": [],
    "accent": "from-teal-900 to-emerald-950 border-teal-700/50",
    "iconBg": "bg-teal-700/80 border-teal-500/50",
    "emoji": "📤",
    "inNav": true,
    "inGrid": true
  },
  {
    "href": "/admin/lesson-plans",
    "title": "طرح درس اساتید",
    "desc": "الزام تکمیل و پایش پیشرفت طرح‌های درس",
    "group": "settings",
    "roles": [
      "ADMIN"
    ],
    "permissions": [],
    "accent": "from-violet-900 to-purple-950 border-violet-700/50",
    "iconBg": "bg-violet-700/80 border-violet-500/50",
    "emoji": "📋",
    "inNav": true,
    "inGrid": true
  },
  {
    "href": "/admin/settings",
    "title": "پیکربندی سامانه",
    "desc": "تنظیمات سراسری، پارامترها و داده‌های پایه (کلاس‌ها و…)",
    "group": "settings",
    "roles": [
      "ADMIN"
    ],
    "permissions": [],
    "accent": "from-slate-800 to-slate-950 border-slate-600/50",
    "iconBg": "bg-slate-700/80 border-slate-500/50",
    "emoji": "⚙️",
    "inNav": true,
    "inGrid": true
  }
];

/**
 * Modules whose destination page is not migrated to the React app yet.
// They stay in the registry (data parity) but are hidden from menus until the
// port lands, so no tile leads to a dead page.
 */
export const PORT_PENDING: ReadonlySet<string> = new Set([
  '/admin/compliance-policy',
]);

export function canSeeModule(
  roles: string[],
  m: AdminModule,
  permissions?: ReadonlySet<string> | string[],
): boolean {
  if (roles.includes('ADMIN')) return true;
  if (m.roles.some(r => roles.includes(r))) return true;
  if (m.permissions.length > 0 && permissions) {
    const set = permissions instanceof Set ? permissions : new Set(permissions);
    if (m.permissions.some(p => set.has(p))) return true;
  }
  return false;
}

/** Modules visible in the horizontal nav for this user. */
export function navModules(roles: string[], permissions?: ReadonlySet<string> | string[]): AdminModule[] {
  return ADMIN_MODULES.filter(m => m.inNav && !PORT_PENDING.has(m.href) && canSeeModule(roles, m, permissions));
}

/** Modules rendered as dashboard cards for this user. */
export function gridModules(roles: string[], permissions?: ReadonlySet<string> | string[]): AdminModule[] {
  return ADMIN_MODULES.filter(m => m.inGrid && !PORT_PENDING.has(m.href) && canSeeModule(roles, m, permissions));
}

/** Dashboard cards grouped by category (empty categories dropped). */
export function groupedModules(
  roles: string[],
  permissions?: ReadonlySet<string> | string[],
): { key: ModuleGroupKey; title: string; emoji: string; desc: string; modules: AdminModule[] }[] {
  return MODULE_GROUPS.map(g => ({
    key: g.key, title: g.title, emoji: g.emoji, desc: g.desc,
    modules: ADMIN_MODULES.filter(m => m.inGrid && !PORT_PENDING.has(m.href) && m.group === g.key && canSeeModule(roles, m, permissions)),
  })).filter(g => g.modules.length > 0);
}
