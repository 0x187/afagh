'use client';

import { useEffect, useState } from 'react';
import { toEnDigits } from '@/lib/persian-search';

/**
 * ورودی مبلغ — جانشین `type="number"` برای مبالغ ریالی/تومانی.
 *
 * چرا: در کدبیس ۱۸۴ `type="number"` داشتیم. در RTL فلش‌های اسپینر سمت
 * اشتباه می‌افتند، اسکرول ماوس ناخواسته مقدار را عوض می‌کند و مبالغ
 * هفت‌رقمی بدون جداکننده تایپ می‌شوند (خطای ثبت یک‌صفر کمتر/بیشتر).
 *
 * این کامپوننت:
 *  • فقط رقم می‌پذیرد (اعداد فارسی/عربی هم تبدیل می‌شوند)
 *  • هزارگان را با «٬» جدا می‌کند و `dir="ltr"` نگه می‌دارد
 *  • `inputMode="numeric"` برای کیبورد عددی موبایل
 *  • مقدار را به‌صورت `number | null` به `onChange` می‌دهد
 */
export default function CurrencyInput({
  value,
  onChange,
  id,
  name,
  placeholder,
  disabled,
  className,
  invalid,
  describedBy,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  id?: string;
  name?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  invalid?: boolean;
  describedBy?: string;
}) {
  const fmt = (n: number | null) => (n == null ? '' : n.toLocaleString('en-US').replace(/,/g, '٬'));
  const [text, setText] = useState(() => fmt(value));

  // همگام‌سازی با مقدار بیرونی (مثلاً بارگذاری از سرور یا ریست فرم)
  useEffect(() => {
    setText(prev => {
      const prevNum = Number(toEnDigits(prev).replace(/[^\d]/g, '')) || 0;
      if (value == null ? prev === '' : prevNum === value) return prev;
      return fmt(value);
    });
  }, [value]);

  return (
    <input
      id={id}
      name={name}
      type="text"
      dir="ltr"
      inputMode="numeric"
      autoComplete="off"
      disabled={disabled}
      placeholder={placeholder}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      value={text}
      onChange={e => {
        const digits = toEnDigits(e.target.value).replace(/[^\d]/g, '').slice(0, 15);
        const n = digits ? Number(digits) : null;
        setText(fmt(n));
        onChange(n);
      }}
      className={className ?? 'input text-left font-mono'}
    />
  );
}
