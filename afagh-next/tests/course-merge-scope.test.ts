// محافظت از رفتار تب‌های «ادغام دروس»:
// تب پیش‌فرض فقط ادغام دستی (source=manual) را نشان می‌دهد،
// و تب دوم بقیه (خودکار/جدا/تکی) را. این تست سطحِ منبع را بررسی می‌کند.
import { readFileSync } from 'node:fs';
import { ok } from 'node:assert';
import { resolve } from 'node:path';

const ROUTE = readFileSync(
  resolve(process.cwd(), 'src/app/api/admin/offering-merge/route.ts'),
  'utf8',
);

const CLIENT = readFileSync(
  resolve(process.cwd(), 'src/app/admin/course-merge/CourseMergeClient.tsx'),
  'utf8',
);

// 1) API پارامتر scope را می‌خواند
ok(/searchParams\.get\('scope'\)/.test(ROUTE), 'مسیرِ offering-merge پارامتر scope را می‌خواند');

// 2) scope=manual فقط گروه‌های source=manual را برمی‌گرداند
ok(
  /effectiveScope\s*===\s*'manual'[\s\S]*?annotated\.filter\(g\s*=>\s*g\.source\s*===\s*'manual'\)/.test(ROUTE) ||
    /scope=manual[\s\S]*?source\s*===\s*'manual'/.test(ROUTE),
  'scope=manual فقط گروه‌های ادغام دستی را فیلتر می‌کند',
);

// 3) پاسخ شمارنده‌های manualCount / otherCount را دارد
ok(/manualCount/.test(ROUTE) && /otherCount/.test(ROUTE), 'پاسخ شامل شمارندهٔ manualCount و otherCount است');

// 4) کلاینت همیشه با scope= دعوا می‌کند و تب پیش‌فرض manual است
ok(
  /offering-merge\?termId=\$\{tid\}&scope=\$\{scope\}/.test(CLIENT),
  'کلاینت همیشه پارامتر scope را به API می‌فرستد',
);
ok(/useState<'manual' \| 'other'>\(['"]manual['"]\)/.test(CLIENT), 'تب پیش‌فرض کلاینت «ادغام دستی» است');
ok(/switchTab/.test(CLIENT), 'کلاینت تابع تعویض تب دارد');

console.log('course-merge-scope: PASS');
