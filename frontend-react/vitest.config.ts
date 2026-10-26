import { defineConfig } from 'vitest/config';
import path from 'node:path';

// تست‌های فاز ۱ خالص‌اند (توابع محض/نرمالایزر/مسیریابی) — محیط node کافی است.
// تست‌های DOM در فازهای بعد با jsdom اضافه می‌شود.
export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
