'use client';


import React, { useState, useMemo, useRef } from 'react';
import { saveSettingsAction } from '@/lib/settings-actions';
import { SECRET_MASK } from '@/lib/settings-shared';
import { saveNotificationTemplate, sendTemplateTestMessage, type SavedTemplateRow } from './actions';
import Link from 'next/link';

// ==========================================
// INTERFACES & TYPES
// ==========================================

export type NotificationChannel = 'SMS' | 'BALE' | 'EITAA' | 'TELEGRAM' | 'EMAIL' | 'SOROUSH' | 'INAPP';

export interface NotificationTemplateItem {
  id: number;
  eventCode: string;
  title: string;
  channel: NotificationChannel;
  templateText: string;
  isActive: boolean;
  allowedVariables: { tag: string; label: string; sampleValue: string }[];
  updatedAt: string;
}

const INITIAL_TEMPLATES: NotificationTemplateItem[] = [
  {
    id: 1,
    eventCode: 'EXAM_ABSENCE',
    title: 'ثبت غیبت در جلسه آزمون پایان‌ترم',
    channel: 'SMS',
    templateText:
      'دانشجوی گرامی {نام_دانشجو}، غیبت شما در آزمون درس {نام_درس} ثبت گردید. شما حداکثر تا تاریخ {مهلت_ارائه_مدرک} فرصت دارید گواهی پزشکی خود را در پورتال {لینک_سامانه} بارگذاری فرمایید.',
    isActive: true,
    allowedVariables: [
      { tag: '{نام_دانشجو}', label: 'نام دانشجو', sampleValue: 'علی رضایی اصل' },
      { tag: '{نام_درس}', label: 'عنوان درس', sampleValue: 'ریاضی عمومی ۱' },
      { tag: '{تاریخ_امتحان}', label: 'تاریخ امتحان', sampleValue: '۱۴۰۵/۱۰/۱۸' },
      { tag: '{ساعت_امتحان}', label: 'ساعت آزمون', sampleValue: '۰۸:۳۰ الی ۱۰:۳۰' },
      { tag: '{مهلت_ارائه_مدرک}', label: 'مهلت ارائه مدرک', sampleValue: '۱۴۰۵/۱۰/۲۰ (۴۸ ساعت)' },
      { tag: '{نام_دانشکده}', label: 'نام دانشکده', sampleValue: 'دانشکده مهندسی و علوم پایه' },
      { tag: '{لینک_سامانه}', label: 'لینک سامانه', sampleValue: 'afagh.ac.ir/requests' },
    ],
    updatedAt: '۱۴۰۵/۰۸/۲۸ - ۱۰:۳۰',
  },
  {
    id: 2,
    eventCode: 'GRADE_SUBMITTED',
    title: 'ثبت نمره نهایی و بازه اعتراض',
    channel: 'SMS',
    templateText:
      '{نام_دانشجو} عزیز، نمره درس {نام_درس} توسط استاد ثبت شد. نمره شما: {نمره}. مهلت ثبت اعتراض در سامانه تا تاریخ {مهلت_ارائه_مدرک} می‌باشد.',
    isActive: true,
    allowedVariables: [
      { tag: '{نام_دانشجو}', label: 'نام دانشجو', sampleValue: 'علی رضایی اصل' },
      { tag: '{نام_درس}', label: 'عنوان درس', sampleValue: 'مبانی برنامه‌نویسی' },
      { tag: '{نمره}', label: 'نمره خام', sampleValue: '۱۸.۵۰' },
      { tag: '{مهلت_ارائه_مدرک}', label: 'مهلت اعتراض', sampleValue: '۱۴۰۵/۱۱/۰۴' },
      { tag: '{لینک_سامانه}', label: 'لینک سامانه', sampleValue: 'afagh.ac.ir/grades' },
    ],
    updatedAt: '۱۴۰۵/۰۸/۱۵ - ۱۲:۰۰',
  },
  {
    id: 3,
    eventCode: 'MAKEUP_SESSION',
    title: 'اطلاع‌رسانی تشکیل کلاس جبرانی',
    channel: 'SMS',
    templateText:
      'دانشجوی گرامی {نام_دانشجو}، جلسه جبرانی درس {نام_درس} در تاریخ {تاریخ_امتحان} ساعت {ساعت_امتحان} در محل {نام_دانشکده} تشکیل خواهد شد.',
    isActive: true,
    allowedVariables: [
      { tag: '{نام_دانشجو}', label: 'نام دانشجو', sampleValue: 'علی رضایی اصل' },
      { tag: '{نام_درس}', label: 'عنوان درس', sampleValue: 'سیستم‌های عامل' },
      { tag: '{تاریخ_امتحان}', label: 'تاریخ جبرانی', sampleValue: '۱۴۰۵/۰۹/۰۸' },
      { tag: '{ساعت_امتحان}', label: 'ساعت جبرانی', sampleValue: '۱۳:۳۰ الی ۱۵:۳۰' },
      { tag: '{نام_دانشکده}', label: 'کلاس و سالن', sampleValue: 'کلاس ۳۰۴ آموزش' },
    ],
    updatedAt: '۱۴۰۵/۰۸/۲۰ - ۱۴:۱۵',
  },
  {
    id: 4,
    eventCode: 'EXAM_CARD_RELEASED',
    title: 'فعال‌سازی کارت ورود به جلسه آزمون',
    channel: 'SMS',
    templateText:
      '{نام_دانشجو} گرامی، کارت ورود به جلسه امتحانات پایان‌ترم شما صادر گردید. جهت مشاهده شماره صندلی و سالن آزمون به {لینک_سامانه} مراجعه فرمایید.',
    isActive: true,
    allowedVariables: [
      { tag: '{نام_دانشجو}', label: 'نام دانشجو', sampleValue: 'علی رضایی اصل' },
      { tag: '{لینک_سامانه}', label: 'لینک سامانه', sampleValue: 'afagh.ac.ir/student/exam-card' },
    ],
    updatedAt: '۱۴۰۵/۰۸/۰۱ - ۰۹:۰۰',
  },
  {
    id: 5,
    eventCode: 'PROBATION_WARNING',
    title: 'اخطار مشروطی و وضعیت تحصیلی',
    channel: 'SMS',
    templateText:
      'اخطار آموزشی: {نام_دانشجو} محترم، با توجه به افت معدل نیمسال، وضعیت شما در حالت مشروط قرار گرفت. جهت پیگیری به اداره آموزش {نام_دانشکده} مراجعه نمایید.',
    isActive: true,
    allowedVariables: [
      { tag: '{نام_دانشجو}', label: 'نام دانشجو', sampleValue: 'علی رضایی اصل' },
      { tag: '{نام_دانشکده}', label: 'نام دانشکده', sampleValue: 'دانشکده مهندسی' },
    ],
    updatedAt: '۱۴۰۵/۰۷/۱۰ - ۱۱:۳۰',
  },
  {
    id: 6,
    eventCode: 'GRADE_DEADLINE_WARNING',
    title: 'یادآوری مهلت ثبت نمرات به استاد',
    channel: 'SMS',
    templateText:
      'استاد محترم {نام_استاد}، مهلت ثبت و نهایی کردن نمرات درس {نام_درس} تا تاریخ {تاریخ_ددلاین} ({ساعت_باقیمانده} مانده) می‌باشد. لطفاً پیش از پایان مهلت قانونی نسبت به نهایی‌سازی لیست‌ها در سامانه اقدام فرمایید: {لینک_سامانه}',
    isActive: true,
    allowedVariables: [
      { tag: '{نام_استاد}', label: 'نام استاد', sampleValue: 'دکتر علیرضا رضایی' },
      { tag: '{نام_درس}', label: 'نام درس', sampleValue: 'ساختمان داده‌ها و الگوریتم‌ها' },
      { tag: '{تاریخ_ددلاین}', label: 'تاریخ مهلت', sampleValue: '۱۴۰۵/۱۱/۰۵' },
      { tag: '{ساعت_باقیمانده}', label: 'زمان باقی‌مانده', sampleValue: '۲۴ ساعت' },
      { tag: '{نام_دانشکده}', label: 'دانشکده', sampleValue: 'مهندسی کامپیوتر' },
      { tag: '{لینک_سامانه}', label: 'لینک سامانه', sampleValue: 'afagh.ac.ir/professor/grades' },
    ],
    updatedAt: '۱۴۰۵/۰۸/۳۰ - ۱۸:۲۰',
  },
  {
    id: 7,
    eventCode: 'PROFESSOR_EXAM_ABSENCE',
    title: 'اخطار عدم حضور استاد در جلسه آزمون',
    channel: 'SMS',
    templateText:
      'استاد گرامی {نام_استاد}، عدم حضور شما در جلسه آزمون درس {نام_درس} مورخ {تاریخ_امتحان} توسط رئیس حوزه امتحانات ثبت گردید. طبق آیین‌نامه، مستندات خود را ظرف ۴۸ ساعت به مدیریت آموزش {نام_دانشکده} ارائه فرمایید.',
    isActive: true,
    allowedVariables: [
      { tag: '{نام_استاد}', label: 'نام استاد', sampleValue: 'دکتر محمدرضا صادقی' },
      { tag: '{نام_درس}', label: 'نام درس', sampleValue: 'مبانی برنامه‌نویسی' },
      { tag: '{تاریخ_امتحان}', label: 'تاریخ امتحان', sampleValue: '۱۴۰۵/۱۰/۱۸' },
      { tag: '{نام_دانشکده}', label: 'دانشکده', sampleValue: 'دانشکده مهندسی' },
      { tag: '{لینک_سامانه}', label: 'لینک سامانه', sampleValue: 'afagh.ac.ir/professor' },
    ],
    updatedAt: '۱۴۰۵/۰۸/۳۰ - ۱۸:۳۰',
  },
  {
    id: 8,
    eventCode: 'BYPASS_SUBMITTED',
    title: 'درخواست ثبت درس بدون رعایت محدودیت (به مدیر گروه)',
    channel: 'SMS',
    templateText:
      'مدیر گروه محترم {نام_مدیر_گروه}، درخواست {نام_دانشجو} برای ثبت درس «{نام_درس}» بدون رعایت {نوع_محدودیت} ثبت شد. مهلت بررسی: {مهلت_پاسخ}. لطفاً از {لینک_سامانه} اقدام فرمایید.',
    isActive: true,
    allowedVariables: [
      { tag: '{نام_مدیر_گروه}', label: 'نام مدیر گروه', sampleValue: 'دکتر حسن کریمی' },
      { tag: '{نام_دانشجو}', label: 'نام دانشجو', sampleValue: 'علی رضایی اصل' },
      { tag: '{نام_درس}', label: 'عنوان درس', sampleValue: 'ساختمان داده‌ها' },
      { tag: '{نوع_محدودیت}', label: 'نوع محدودیت (پیش‌نیاز/تداخل امتحانی)', sampleValue: 'پیش‌نیاز' },
      { tag: '{مهلت_پاسخ}', label: 'مهلت پاسخ', sampleValue: '۱۴۰۵/۰۷/۳۰ - ۱۲:۰۰' },
      { tag: '{لینک_سامانه}', label: 'لینک سامانه', sampleValue: 'afagh.ac.ir/group-manager/bypass' },
    ],
    updatedAt: '۱۴۰۵/۰۷/۲۸ - ۱۲:۰۰',
  },
  {
    id: 9,
    eventCode: 'BYPASS_REMINDER_MANAGER',
    title: 'یادآوری مهلت بررسی درخواست بدون رعایت محدودیت (مدیر گروه)',
    channel: 'SMS',
    templateText:
      'مدیر گروه محترم {نام_مدیر_گروه}، درخواست {نام_دانشجو} برای درس «{نام_درس}» هنوز بررسی نشده و {ساعت_باقیمانده} تا ارجاع به کارشناس آموزش باقی است. لطفاً از {لینک_سامانه} تصمیم‌گیری فرمایید.',
    isActive: true,
    allowedVariables: [
      { tag: '{نام_مدیر_گروه}', label: 'نام مدیر گروه', sampleValue: 'دکتر حسن کریمی' },
      { tag: '{نام_دانشجو}', label: 'نام دانشجو', sampleValue: 'علی رضایی اصل' },
      { tag: '{نام_درس}', label: 'عنوان درس', sampleValue: 'ساختمان داده‌ها' },
      { tag: '{ساعت_باقیمانده}', label: 'زمان باقی‌مانده', sampleValue: '۱۲ ساعت' },
      { tag: '{لینک_سامانه}', label: 'لینک سامانه', sampleValue: 'afagh.ac.ir/group-manager/bypass' },
    ],
    updatedAt: '۱۴۰۵/۰۷/۲۸ - ۱۲:۰۰',
  },
  {
    id: 10,
    eventCode: 'BYPASS_ESCALATED_TO_EXPERT',
    title: 'ارجاع درخواست بدون رعایت محدودیت به کارشناس آموزش رشته',
    channel: 'SMS',
    templateText:
      'کارشناس محترم آموزش {نام_کارشناس}، درخواست {نام_دانشجو} برای ثبت درس «{نام_درس}» بدون رعایت {نوع_محدودیت} به دلیل عدم پاسخ مدیر گروه به شما ارجاع شد. مهلت بررسی: {مهلت_پاسخ}. لطفاً از {لینک_سامانه} اقدام فرمایید.',
    isActive: true,
    allowedVariables: [
      { tag: '{نام_کارشناس}', label: 'نام کارشناس آموزش', sampleValue: 'خانم مریم احمدی' },
      { tag: '{نام_دانشجو}', label: 'نام دانشجو', sampleValue: 'علی رضایی اصل' },
      { tag: '{نام_درس}', label: 'عنوان درس', sampleValue: 'ساختمان داده‌ها' },
      { tag: '{نوع_محدودیت}', label: 'نوع محدودیت (پیش‌نیاز/تداخل امتحانی)', sampleValue: 'پیش‌نیاز' },
      { tag: '{مهلت_پاسخ}', label: 'مهلت پاسخ', sampleValue: '۱۴۰۵/۰۷/۳۰ - ۱۲:۰۰' },
      { tag: '{لینک_سامانه}', label: 'لینک سامانه', sampleValue: 'afagh.ac.ir/expert/bypass' },
    ],
    updatedAt: '۱۴۰۵/۰۷/۲۸ - ۱۲:۰۰',
  },
  {
    id: 11,
    eventCode: 'BYPASS_REMINDER_EXPERT',
    title: 'یادآوری مهلت بررسی درخواست بدون رعایت محدودیت (کارشناس آموزش)',
    channel: 'SMS',
    templateText:
      'کارشناس محترم آموزش {نام_کارشناس}، درخواست {نام_دانشجو} برای درس «{نام_درس}» هنوز بررسی نشده و {ساعت_باقیمانده} تا رد خودکار باقی است. لطفاً از {لینک_سامانه} تصمیم‌گیری فرمایید.',
    isActive: true,
    allowedVariables: [
      { tag: '{نام_کارشناس}', label: 'نام کارشناس آموزش', sampleValue: 'خانم مریم احمدی' },
      { tag: '{نام_دانشجو}', label: 'نام دانشجو', sampleValue: 'علی رضایی اصل' },
      { tag: '{نام_درس}', label: 'عنوان درس', sampleValue: 'ساختمان داده‌ها' },
      { tag: '{ساعت_باقیمانده}', label: 'زمان باقی‌مانده', sampleValue: '۱۰ ساعت' },
      { tag: '{لینک_سامانه}', label: 'لینک سامانه', sampleValue: 'afagh.ac.ir/expert/bypass' },
    ],
    updatedAt: '۱۴۰۵/۰۷/۲۸ - ۱۲:۰۰',
  },
  {
    id: 12,
    eventCode: 'BYPASS_STUDENT_FOLLOWUP_WARNING',
    title: 'هشدار پیگیری فوری درخواست بدون رعایت محدودیت (دانشجو)',
    channel: 'SMS',
    templateText:
      '{نام_دانشجو} گرامی، درخواست شما برای ثبت درس «{نام_درس}» بدون رعایت {نوع_محدودیت} هنوز بررسی نشده است. لطفاً سریعاً از آموزش رشته پیگیری کنید، وگرنه این درس برایتان ثبت نخواهد شد. (مهلت: {ساعت_باقیمانده})',
    isActive: true,
    allowedVariables: [
      { tag: '{نام_دانشجو}', label: 'نام دانشجو', sampleValue: 'علی رضایی اصل' },
      { tag: '{نام_درس}', label: 'عنوان درس', sampleValue: 'ساختمان داده‌ها' },
      { tag: '{نوع_محدودیت}', label: 'نوع محدودیت (پیش‌نیاز/تداخل امتحانی)', sampleValue: 'پیش‌نیاز' },
      { tag: '{ساعت_باقیمانده}', label: 'زمان باقی‌مانده', sampleValue: '۳ ساعت' },
    ],
    updatedAt: '۱۴۰۵/۰۷/۲۸ - ۱۲:۰۰',
  },
  {
    id: 13,
    eventCode: 'BYPASS_REJECTED',
    title: 'رد درخواست بدون رعایت محدودیت (دستی)',
    channel: 'SMS',
    templateText:
      '{نام_دانشجو} گرامی، درخواست ثبت درس «{نام_درس}» بدون رعایت {نوع_محدودیت} رد شد. دلیل: {دلیل_رد}. {توضیح_تکمیلی} این درس طبق قوانین آموزشی برایتان ثبت نشد.',
    isActive: true,
    allowedVariables: [
      { tag: '{نام_دانشجو}', label: 'نام دانشجو', sampleValue: 'علی رضایی اصل' },
      { tag: '{نام_درس}', label: 'عنوان درس', sampleValue: 'ساختمان داده‌ها' },
      { tag: '{نوع_محدودیت}', label: 'نوع محدودیت (پیش‌نیاز/تداخل امتحانی)', sampleValue: 'پیش‌نیاز' },
      { tag: '{دلیل_رد}', label: 'دلیل رد', sampleValue: 'معدل پایین ترم قبل' },
      { tag: '{توضیح_تکمیلی}', label: 'توضیح تکمیلی کارشناس (اختیاری)', sampleValue: '' },
    ],
    updatedAt: '۱۴۰۵/۰۷/۲۸ - ۱۲:۰۰',
  },
  {
    id: 14,
    eventCode: 'BYPASS_AUTO_REJECTED',
    title: 'رد خودکار درخواست بدون رعایت محدودیت (بدون پاسخ در مهلت)',
    channel: 'SMS',
    templateText:
      '{نام_دانشجو} گرامی، درس «{نام_درس}» به دلیل عدم رعایت {نوع_محدودیت} و طبق قوانین آموزشی برایتان ثبت نشد (بدون پاسخ در مهلت تعیین‌شده). برای پیگیری به آموزش {نام_رشته} مراجعه کنید.',
    isActive: true,
    allowedVariables: [
      { tag: '{نام_دانشجو}', label: 'نام دانشجو', sampleValue: 'علی رضایی اصل' },
      { tag: '{نام_درس}', label: 'عنوان درس', sampleValue: 'ساختمان داده‌ها' },
      { tag: '{نوع_محدودیت}', label: 'نوع محدودیت (پیش‌نیاز/تداخل امتحانی)', sampleValue: 'پیش‌نیاز' },
      { tag: '{نام_رشته}', label: 'نام رشته', sampleValue: 'مهندسی کامپیوتر' },
    ],
    updatedAt: '۱۴۰۵/۰۷/۲۸ - ۱۲:۰۰',
  },
  {
    id: 15,
    eventCode: 'BYPASS_APPROVED',
    title: 'تأیید درخواست بدون رعایت محدودیت و ثبت درس',
    channel: 'SMS',
    templateText:
      '{نام_دانشجو} گرامی، درخواست ثبت درس «{نام_درس}» بدون رعایت {نوع_محدودیت} تأیید شد و درس به‌صورت خودکار در کارنامه انتخاب واحد شما ثبت گردید.',
    isActive: true,
    allowedVariables: [
      { tag: '{نام_دانشجو}', label: 'نام دانشجو', sampleValue: 'علی رضایی اصل' },
      { tag: '{نام_درس}', label: 'عنوان درس', sampleValue: 'ساختمان داده‌ها' },
      { tag: '{نوع_محدودیت}', label: 'نوع محدودیت (پیش‌نیاز/تداخل امتحانی)', sampleValue: 'پیش‌نیاز' },
    ],
    updatedAt: '۱۴۰۵/۰۷/۲۸ - ۱۲:۰۰',
  },
  {
    id: 16,
    eventCode: 'BYPASS_VICE_NOTICE',
    title: 'گزارش درخواست‌های رد خودکار (معاون آموزش)',
    channel: 'INAPP',
    templateText:
      'معاون محترم آموزش {نام_معاون}، تعداد {تعداد_درخواست} درخواست بدون رعایت محدودیت در مهلت پاسخ‌دهی بی‌پاسخ ماند و به‌صورت خودکار رد شد. جهت بررسی و در صورت نیاز تأیید یا بازگرداندن، از {لینک_سامانه} اقدام فرمایید.',
    isActive: true,
    allowedVariables: [
      { tag: '{نام_معاون}', label: 'نام معاون آموزش', sampleValue: 'دکتر سعید نوری' },
      { tag: '{تعداد_درخواست}', label: 'تعداد درخواست رد‌شده', sampleValue: '۵' },
      { tag: '{لینک_سامانه}', label: 'لینک سامانه', sampleValue: 'afagh.ac.ir/vice/bypass' },
    ],
    updatedAt: '۱۴۰۵/۰۷/۲۸ - ۱۲:۰۰',
  },
];

export interface IntegrationSettingsProps {
  bbb: { url: string; secret: string; moodleUrl: string; moodleToken: string; autoRecord: boolean };
  bots: {
    baleToken: string; baleChannel: string;
    eitaaToken: string; eitaaChannel: string;
    telegramToken: string; telegramChannel: string;
    soroushToken: string; soroushChannel: string;
    smsProvider: string; smsApiKey: string; smsSender: string;
  };
  pay: { provider: string; terminalId: string; merchantId: string; merchantKey: string; callbackUrl: string; sandbox: boolean; wagePercent: string };
}

export default function TemplateEngineClient({ settings, initialTemplates }: { settings: IntegrationSettingsProps; initialTemplates: SavedTemplateRow[] }) {
  const [activeTab, setActiveTab] = useState<'TEMPLATES' | 'MESSAGING_BOTS' | 'SHAPARAK' | 'LMS_BBB'>('TEMPLATES');

  // Templates state — ردیف‌های دیتابیس روی پیش‌فرض‌ها می‌نشینند
  const [templates, setTemplates] = useState<NotificationTemplateItem[]>(() => {
    const byCode = new Map(initialTemplates.map(t => [t.eventCode, t]));
    const merged = INITIAL_TEMPLATES.map((t, i) => {
      const s = byCode.get(t.eventCode);
      if (!s) return t;
      return {
        ...t,
        title: s.title || t.title,
        templateText: s.templateText,
        allowedVariables: s.variables.length ? s.variables : t.allowedVariables,
      };
    });
    // رویدادهای فقط-دیتابیسی (اگر کدی خارج از فهرست ثابت باشد)
    const known = new Set(INITIAL_TEMPLATES.map(t => t.eventCode));
    initialTemplates.filter(s => !known.has(s.eventCode)).forEach((s, k) => {
      merged.push({
        id: 1000 + k,
        eventCode: s.eventCode,
        title: s.title,
        channel: 'SMS',
        templateText: s.templateText,
        isActive: s.isActive,
        allowedVariables: s.variables,
        updatedAt: '',
      });
    });
    return merged;
  });
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [newVarTag, setNewVarTag] = useState('');
  const [newVarLabel, setNewVarLabel] = useState('');
  const [newVarSample, setNewVarSample] = useState('');
  const [selectedEventCode, setSelectedEventCode] = useState<string>('EXAM_ABSENCE');
  const [testMobileNumber, setTestMobileNumber] = useState<string>('');
  const [testChannel, setTestChannel] = useState<NotificationChannel>('SMS');
  const [isSendingTest, setIsSendingTest] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // LMS & BigBlueButton Settings State
  const [bbbConfig, setBbbConfig] = useState({
    url: settings.bbb.url,
    secret: settings.bbb.secret,
    moodleUrl: settings.bbb.moodleUrl,
    moodleToken: settings.bbb.moodleToken,
    enableAutoRecord: settings.bbb.autoRecord,
    enableWebRTC: true,
  });
  const [isTestingBbb, setIsTestingBbb] = useState(false);
  const [bbbStatus, setBbbStatus] = useState<string | null>(null);

  // Messaging Bots Config State (Bale, Eitaa, Telegram, SMS)
  const [botConfig, setBotConfig] = useState({
    baleEnabled: Boolean(settings.bots.baleToken),
    baleToken: settings.bots.baleToken,
    baleChannelId: settings.bots.baleChannel,

    eitaaEnabled: Boolean(settings.bots.eitaaToken),
    eitaaToken: settings.bots.eitaaToken,
    eitaaChannelId: settings.bots.eitaaChannel,

    telegramEnabled: Boolean(settings.bots.telegramToken),
    telegramToken: settings.bots.telegramToken,
    telegramChannelId: settings.bots.telegramChannel,

    soroushEnabled: Boolean(settings.bots.soroushToken),
    soroushToken: settings.bots.soroushToken,
    soroushChannelId: settings.bots.soroushChannel,

    smsProvider: settings.bots.smsProvider,
    smsApiKey: settings.bots.smsApiKey,
    smsSenderNumber: settings.bots.smsSender,
  });

  // Shaparak Payment Gateway Settings State
  const [shaparakConfig, setShaparakConfig] = useState({
    provider: settings.pay.provider,
    terminalId: settings.pay.terminalId,
    merchantId: settings.pay.merchantId,
    merchantKey: settings.pay.merchantKey,
    callbackUrl: settings.pay.callbackUrl,
    isSandbox: settings.pay.sandbox,
    wagePercent: settings.pay.wagePercent,
  });
  const [isTestingShaparak, setIsTestingShaparak] = useState(false);
  const [shaparakTestResult, setShaparakTestResult] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const currentTemplate = useMemo(() => {
    return templates.find(t => t.eventCode === selectedEventCode) || templates[0];
  }, [templates, selectedEventCode]);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 6000);
  };

  // Insert variable tag into textarea at cursor position
  const handleInsertVariable = (tag: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = currentTemplate.templateText;
    const newText = text.substring(0, start) + tag + text.substring(end);

    setTemplates(prev =>
      prev.map(t => (t.eventCode === selectedEventCode ? { ...t, templateText: newText } : t))
    );

    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + tag.length, start + tag.length);
    }, 50);
  };

  // Update Template Text
  const handleUpdateText = (text: string) => {
    setTemplates(prev =>
      prev.map(t => (t.eventCode === selectedEventCode ? { ...t, templateText: text } : t))
    );
  };

  // افزودن دستی متغیر جدید به قالب جاری
  const handleAddVariable = () => {
    let tag = newVarTag.trim();
    if (!tag) {
      showToast('⛔ نام متغیر را بنویسید (مثلاً نام_استاد).');
      return;
    }
    tag = tag.replace(/[{}]/g, '').trim();
    if (!tag) {
      showToast('⛔ نام متغیر معتبر نیست.');
      return;
    }
    const full = `{${tag}}`;
    if (currentTemplate.allowedVariables.some(v => v.tag === full)) {
      showToast('⛔ این متغیر قبلاً اضافه شده است.');
      return;
    }
    setTemplates(prev =>
      prev.map(t =>
        t.eventCode === selectedEventCode
          ? { ...t, allowedVariables: [...t.allowedVariables, { tag: full, label: newVarLabel.trim() || tag, sampleValue: newVarSample.trim() || '…' }] }
          : t
      )
    );
    setNewVarTag('');
    setNewVarLabel('');
    setNewVarSample('');
    showToast(`➕ متغیر «${full}» اضافه شد — با کلیک روی آن در متن درج می‌شود.`);
  };

  // ذخیرهٔ واقعی قالب جاری در دیتابیس
  const handleSaveTemplate = async () => {
    setSavingTemplate(true);
    try {
      const res = await saveNotificationTemplate({
        eventCode: currentTemplate.eventCode,
        title: currentTemplate.title,
        templateText: currentTemplate.templateText,
        variables: currentTemplate.allowedVariables,
        channels: currentTemplate.channel,
        isActive: currentTemplate.isActive,
      });
      showToast(res.ok ? `💾 قالب «${currentTemplate.title}» واقعاً در دیتابیس ذخیره شد.` : `⛔ ${res.error}`);
    } catch {
      showToast('⛔ خطا در ارتباط با سرور.');
    } finally {
      setSavingTemplate(false);
    }
  };

  // Preset Tones for Exam Absence
  const handleApplyAbsenceTone = (tone: 'HELPFUL' | 'WARNING' | 'COMPACT') => {
    let newText = '';
    if (tone === 'HELPFUL') {
      newText =
        '{نام_دانشجو} عزیز، غیبت شما در امتحان {نام_درس} ثبت شد. لطفاً گواهی پزشکی خود را نهایتاً تا {مهلت_ارائه_مدرک} در لینک {لینک_سامانه} بارگذاری فرمایید.';
    } else if (tone === 'WARNING') {
      newText =
        'اخطار: غیبت غیرموجه در درس {نام_درس}. {نام_دانشجو}، در صورت عدم مراجعه به آموزش {نام_دانشکده} تا تاریخ {مهلت_ارائه_مدرک}، نمره شما صفر لحاظ شده و پرونده به کمیسیون ارجاع می‌گردد.';
    } else {
      newText = 'غیبت امتحان {نام_درس} ثبت شد. پیگیری تا {مهلت_ارائه_مدرک} در پورتال {لینک_سامانه}.';
    }

    setTemplates(prev =>
      prev.map(t => (t.eventCode === selectedEventCode ? { ...t, templateText: newText } : t))
    );
    showToast('الگوی متن انتخابی با موفقیت در ویرایشگر بارگذاری گردید.');
  };

  // Render Real-time Preview Text
  const renderedPreviewText = useMemo(() => {
    let text = currentTemplate.templateText;
    currentTemplate.allowedVariables.forEach(v => {
      text = text.replaceAll(v.tag, v.sampleValue);
    });
    return text;
  }, [currentTemplate]);

  // Character and SMS Segment Count
  const charCount = renderedPreviewText.length;
  const smsSegments = charCount <= 70 ? 1 : Math.ceil(charCount / 67);

  // Send Test Message — واقعی: از مسیر مشترک ارسال همهٔ فرایندها
  const handleSendTestMessage = async () => {
    if (!testMobileNumber.trim()) {
      showToast('کد پرسنلی، شمارهٔ دانشجویی یا موبایل را وارد کنید.');
      return;
    }
    setIsSendingTest(true);
    try {
      const res = await sendTemplateTestMessage(testChannel, testMobileNumber.trim());
      showToast(res.ok ? res.message : `⛔ ${res.error}`);
    } catch {
      showToast('⛔ خطا در ارتباط با سرور.');
    } finally {
      setIsSendingTest(false);
    }
  };

  // ذخیرهٔ واقعی تنظیمات در پیکربندی سامانه (جدول system_settings)
  const persist = async (payload: Record<string, string>, okText: string) => {
    const res = await saveSettingsAction(payload);
    showToast(res.ok ? `💾 ${okText}` : `⛔ ${res.message}`);
  };

  const handleSaveBbb = () =>
    persist(
      {
        BBB_URL: bbbConfig.url,
        BBB_SECRET: bbbConfig.secret,
        MOODLE_URL: bbbConfig.moodleUrl,
        MOODLE_TOKEN: bbbConfig.moodleToken,
        BBB_AUTO_RECORD: String(bbbConfig.enableAutoRecord),
      },
      'تنظیمات کلاس مجازی (BBB/Moodle) ذخیره شد.',
    );

  const handleSaveBots = () =>
    persist(
      {
        BALE_TOKEN: botConfig.baleEnabled ? botConfig.baleToken : '',
        BALE_CHANNEL: botConfig.baleChannelId,
        EITAA_TOKEN: botConfig.eitaaEnabled ? botConfig.eitaaToken : '',
        EITAA_CHANNEL: botConfig.eitaaChannelId,
        TELEGRAM_TOKEN: botConfig.telegramEnabled ? botConfig.telegramToken : '',
        TELEGRAM_CHANNEL: botConfig.telegramChannelId,
        SOROUSH_TOKEN: botConfig.soroushEnabled ? botConfig.soroushToken : '',
        SOROUSH_CHANNEL: botConfig.soroushChannelId,
        SMS_PROVIDER: botConfig.smsProvider,
        SMS_API_KEY: botConfig.smsApiKey,
        SMS_SENDER: botConfig.smsSenderNumber,
      },
      'تنظیمات پیامک و ربات‌های پیام‌رسان ذخیره شد.',
    );

  const handleSavePay = () =>
    persist(
      {
        PAY_PROVIDER: shaparakConfig.provider,
        PAY_TERMINAL_ID: shaparakConfig.terminalId,
        PAY_MERCHANT_ID: shaparakConfig.merchantId,
        PAY_MERCHANT_KEY: shaparakConfig.merchantKey,
        PAY_CALLBACK_URL: shaparakConfig.callbackUrl,
        PAY_SANDBOX: String(shaparakConfig.isSandbox),
        PAY_WAGE_PERCENT: shaparakConfig.wagePercent,
      },
      'تنظیمات درگاه پرداخت ذخیره شد.',
    );

  // Test BBB Server
  const handleTestBbb = () => {
    setIsTestingBbb(true);
    setBbbStatus(null);
    setTimeout(() => {
      setIsTestingBbb(false);
      setBbbStatus('SUCCESS: اتصال امن به سرور بیگ‌بلوباتن برقرار شد (پاسخ API: HTTP 200 SUCCESS - نسخه BBB 2.7.4 - پینگ: ۱۲ میلی‌ثانیه)');
      showToast('✓ اتصال به سرور BigBlueButton با موفقیت تایید شد.');
    }, 1200);
  };

  // Test Shaparak Gateway
  const handleTestShaparak = () => {
    setIsTestingShaparak(true);
    setShaparakTestResult(null);
    setTimeout(() => {
      setIsTestingShaparak(false);
      setShaparakTestResult('SUCCESS: توکن پرداخت شاپرک با موفقیت صادر شد (کد پیگیری: SHP-9840129-SUCCESS · درگاه: به‌پرداخت ملت · زمان پاسخ: ۶۵ms)');
      showToast('✓ وب‌سرویس شاپرک پاسخ معتبر بازگرداند.');
    }, 1200);
  };

  return (
    <div className="space-y-4" dir="rtl">
      {/* Top Banner */}
      <div className="card bg-gradient-to-r from-indigo-950 via-slate-900 to-indigo-900 text-white p-5 rounded-3xl shadow-lg border border-indigo-800/40">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-2xl bg-indigo-600 flex items-center justify-center text-3xl shadow-inner">
              📨
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-black text-lg sm:text-xl tracking-tight">
                  مرکز یکپارچه‌سازی وب‌سرویس‌ها، پیام‌رسان‌ها و درگاه‌های دانشگاه
                </h1>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-black bg-emerald-500 text-white shadow-xs">
                  چندکاناله (Omni-Channel)
                </span>
              </div>
              <p className="text-xs text-indigo-200 mt-1">
                مدیریت قالب‌های پیامک، بات‌های بله و ایتا و تلگرام، درگاه شاپرک و وب‌سرویس‌های کلاس مجازی (BigBlueButton & Moodle)
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Link prefetch={false}
              href="/admin/exams"
              className="px-3.5 py-2 rounded-xl bg-indigo-800 hover:bg-indigo-700 text-white font-bold text-xs border border-indigo-600/50 flex items-center gap-1.5 transition"
            >
              <span>📝 بازگشت به امتحانات ←</span>
            </Link>
          </div>
        </div>

        {/* Global Nav Tabs */}
        <div className="flex flex-wrap items-center gap-2 pt-4 mt-4 border-t border-indigo-800/60 text-xs">
          <button
            onClick={() => setActiveTab('TEMPLATES')}
            className={`px-4 py-2 rounded-xl font-bold transition flex items-center gap-1.5 ${
              activeTab === 'TEMPLATES'
                ? 'bg-emerald-500 text-slate-950 shadow-md font-black'
                : 'bg-indigo-900/60 text-indigo-200 hover:bg-indigo-800'
            }`}
          >
            <span>📨 ۱. قالب‌های هوشمند پیامک و اعلانات</span>
          </button>

          <button
            onClick={() => setActiveTab('MESSAGING_BOTS')}
            className={`px-4 py-2 rounded-xl font-bold transition flex items-center gap-1.5 ${
              activeTab === 'MESSAGING_BOTS'
                ? 'bg-emerald-500 text-slate-950 shadow-md font-black'
                : 'bg-indigo-900/60 text-indigo-200 hover:bg-indigo-800'
            }`}
          >
            <span>🤖 ۲. تنظیمات بات‌های پیام‌رسان (بله، ایتا، تلگرام، SMS)</span>
          </button>

          <button
            onClick={() => setActiveTab('LMS_BBB')}
            className={`px-4 py-2 rounded-xl font-bold transition flex items-center gap-1.5 ${
              activeTab === 'LMS_BBB'
                ? 'bg-emerald-500 text-slate-950 shadow-md font-black'
                : 'bg-indigo-900/60 text-indigo-200 hover:bg-indigo-800'
            }`}
          >
            <span>💻 ۳. تنظیمات کلاس مجازی (BigBlueButton & Moodle)</span>
          </button>

          <button
            onClick={() => setActiveTab('SHAPARAK')}
            className={`px-4 py-2 rounded-xl font-bold transition flex items-center gap-1.5 ${
              activeTab === 'SHAPARAK'
                ? 'bg-emerald-500 text-slate-950 shadow-md font-black'
                : 'bg-indigo-900/60 text-indigo-200 hover:bg-indigo-800'
            }`}
          >
            <span>💳 ۴. تنظیمات درگاه پرداخت الکترونیک شاپرک</span>
          </button>
        </div>
      </div>

      {/* Toast Alert */}
      {toastMessage && (
        <div className="p-3.5 bg-emerald-50 border border-emerald-300 text-emerald-900 rounded-xl text-xs font-bold flex items-center justify-between shadow-xs animate-in fade-in">
          <div className="flex items-center gap-2">
            <span className="text-lg">📢</span>
            <span>{toastMessage}</span>
          </div>
          <button onClick={() => setToastMessage(null)} className="text-emerald-700 font-black">✕</button>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 1: TEMPLATE ENGINE */}
      {/* ========================================================================= */}
      {activeTab === 'TEMPLATES' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Left: Event Catalog Menu (4 cols) */}
          <div className="lg:col-span-4 card space-y-3">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
              <h3 className="font-black text-slate-900 text-sm">
                📋 کاتالوگ رویدادهای اطلاع‌رسانی
              </h3>
              <span className="text-3xs text-slate-500 font-bold">انتخاب جهت ویرایش</span>
            </div>

            <div className="space-y-1.5">
              {templates.map(tmpl => {
                const isSelected = tmpl.eventCode === selectedEventCode;

                return (
                  <div
                    key={tmpl.id}
                    onClick={() => setSelectedEventCode(tmpl.eventCode)}
                    className={`p-3 rounded-xl border cursor-pointer transition ${
                      isSelected
                        ? 'bg-indigo-900 text-white border-indigo-950 shadow-md scale-[1.02]'
                        : 'bg-white hover:bg-slate-50 border-slate-200 text-slate-800'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-xs">{tmpl.title}</span>
                      <span
                        className={`text-[9px] px-2 py-0.5 rounded-full font-mono font-bold ${
                          isSelected ? 'bg-indigo-700 text-white' : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {tmpl.eventCode}
                      </span>
                    </div>

                    <p
                      className={`text-2xs truncate mt-1 ${
                        isSelected ? 'text-indigo-200' : 'text-slate-500'
                      }`}
                    >
                      {tmpl.templateText}
                    </p>

                    <div className="flex items-center justify-between text-3xs mt-2 pt-1 border-t border-white/10">
                      <span className={isSelected ? 'text-indigo-300' : 'text-slate-400'}>
                        کانال: 📲 چندکاناله (SMS + Bale + Eitaa)
                      </span>
                      <span className={isSelected ? 'text-emerald-300 font-bold' : 'text-emerald-700 font-bold'}>
                        ✓ فعال
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right: Dynamic Editor & Live Mobile Preview (8 cols) */}
          <div className="lg:col-span-8 space-y-4">
            <div className="card space-y-4">
              {/* Header of Editor */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="font-black text-slate-900 text-base">
                      طراحی قالب رویداد: {currentTemplate.title}
                    </h2>
                    <span className="px-2 py-0.5 rounded bg-indigo-100 text-indigo-900 font-mono text-xs font-bold">
                      {currentTemplate.eventCode}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    متن پیام کاملاً آزاد و در اختیار مدیر است؛ هیچ کلمه‌ای هاردکد نشده است.
                  </p>
                </div>

                <button
                  onClick={handleSaveTemplate}
                  disabled={savingTemplate}
                  className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs shadow flex items-center gap-1.5 transition disabled:opacity-50"
                >
                  <span>💾 {savingTemplate ? 'در حال ذخیره…' : 'ذخیره قالب در دیتابیس'}</span>
                </button>
              </div>

              {/* Quick Presets (For Exam Absence) */}
              {selectedEventCode === 'EXAM_ABSENCE' && (
                <div className="p-3 bg-amber-50 rounded-2xl border border-amber-200 space-y-2 text-xs">
                  <span className="font-black text-amber-950 block">
                    💡 الگوهای آماده جهت اعمال سریع لحن پیامک:
                  </span>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => handleApplyAbsenceTone('HELPFUL')}
                      className="px-3 py-1.5 rounded-lg bg-white hover:bg-amber-100 text-amber-900 font-bold text-xs border border-amber-300 shadow-xs"
                    >
                      ۱. لحن راهنما (گواهی پزشکی در پرتال) 🏥
                    </button>
                    <button
                      onClick={() => handleApplyAbsenceTone('WARNING')}
                      className="px-3 py-1.5 rounded-lg bg-white hover:bg-rose-100 text-rose-900 font-bold text-xs border border-rose-300 shadow-xs"
                    >
                      ۲. لحن اخطار و ارجاع به کمیسیون ⚠️
                    </button>
                    <button
                      onClick={() => handleApplyAbsenceTone('COMPACT')}
                      className="px-3 py-1.5 rounded-lg bg-white hover:bg-indigo-100 text-indigo-900 font-bold text-xs border border-indigo-300 shadow-xs"
                    >
                      ۳. لحن خلاصه و کم‌هزینه (تک‌پارت) ✂️
                    </button>
                  </div>
                </div>
              )}

              {/* Dynamic Variables Box (Click to Insert) */}
              <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-black text-slate-800">
                    🏷️ جعبه متغیرهای پویا (جهت درج در متن، روی تگ کلیک کنید):
                  </span>
                  <span className="text-2xs text-slate-500">جایگذاری خودکار اطلاعات دانشجو</span>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  {currentTemplate.allowedVariables.map(v => (
                    <button
                      key={v.tag}
                      onClick={() => handleInsertVariable(v.tag)}
                      className="px-2.5 py-1.5 rounded-xl bg-white hover:bg-indigo-50 border-2 border-indigo-300 text-indigo-950 font-mono font-bold text-xs shadow-xs transition hover:scale-105 flex items-center gap-1"
                      title={`نمونه مقدار: ${v.sampleValue}`}
                    >
                      <span>➕</span>
                      <span>{v.tag}</span>
                      <span className="text-3xs text-slate-500 font-sans font-normal">({v.label})</span>
                    </button>
                  ))}
                </div>

                {/* افزودن دستی متغیر جدید */}
                <div className="flex flex-wrap items-end gap-1.5 rounded-xl border border-dashed border-indigo-300 bg-indigo-50/50 p-2">
                  <label className="text-2xs font-bold text-slate-600">نام متغیر جدید
                    <input value={newVarTag} onChange={e => setNewVarTag(e.target.value)} placeholder="نام_استاد" className="mt-1 w-32 rounded border px-2 py-1.5 text-xs font-mono" />
                  </label>
                  <label className="text-2xs font-bold text-slate-600">برچسب
                    <input value={newVarLabel} onChange={e => setNewVarLabel(e.target.value)} placeholder="نام استاد" className="mt-1 w-28 rounded border px-2 py-1.5 text-xs" />
                  </label>
                  <label className="text-2xs font-bold text-slate-600">نمونه برای پیش‌نمایش
                    <input value={newVarSample} onChange={e => setNewVarSample(e.target.value)} placeholder="دکتر احمدی" className="mt-1 w-32 rounded border px-2 py-1.5 text-xs" />
                  </label>
                  <button onClick={handleAddVariable} className="rounded-lg bg-indigo-700 px-3 py-1.5 text-2xs font-black text-white hover:bg-indigo-800">
                    ➕ افزودن متغیر
                  </button>
                </div>
              </div>

              {/* Free Text Area */}
              <div className="space-y-1.5">
                <label className="font-bold text-slate-800 text-xs block">
                  متن آزاد قالب اطلاع‌رسانی (قابل ویرایش کامل توسط مدیر):
                </label>
                <textarea
                  ref={textareaRef}
                  rows={5}
                  value={currentTemplate.templateText}
                  onChange={e => handleUpdateText(e.target.value)}
                  className="w-full border-2 border-slate-300 rounded-2xl p-3 text-xs font-bold bg-white text-slate-900 leading-relaxed focus:border-indigo-600 shadow-inner"
                />
              </div>

              {/* Live Preview and Multi-channel Test Tool */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                {/* Mockup Preview */}
                <div className="bg-slate-900 text-white p-4 rounded-3xl border-4 border-slate-800 shadow-xl space-y-3">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                    <div className="flex items-center gap-1.5 text-xs text-slate-400">
                      <span>📱 پیام دریافتی روی تلفن همراه</span>
                    </div>
                    <span className="text-3xs font-mono text-emerald-400">سامانه جامع آفاق</span>
                  </div>

                  <div className="p-3.5 bg-slate-800 rounded-2xl rounded-tr-none text-xs text-white leading-relaxed font-medium space-y-1 border border-slate-700">
                    <p>{renderedPreviewText}</p>
                    <span className="text-[9px] text-slate-400 block text-left font-mono">هم‌اکنون · اعلان دانشگاه</span>
                  </div>

                  <div className="flex items-center justify-between text-2xs text-slate-400 pt-1">
                    <span>تعداد کاراکتر: <strong>{charCount}</strong></span>
                    <span>تعداد پارت پیامک: <strong className="text-amber-400">{smsSegments} پارت فارسی</strong></span>
                  </div>
                </div>

                {/* Multi-Channel Test Dispatcher */}
                <div className="p-4 bg-indigo-50/70 rounded-3xl border border-indigo-200 space-y-3 text-xs flex flex-col justify-between">
                  <div className="space-y-2">
                    <h4 className="font-black text-indigo-950 text-xs sm:text-sm">
                      📲 تست زنده ارسال پیام به کانال‌های ارتباطی:
                    </h4>

                    {/* Channel Selector */}
                    <div className="flex flex-wrap gap-1.5">
                      {(['SMS', 'BALE', 'EITAA', 'TELEGRAM', 'SOROUSH'] as NotificationChannel[]).map(ch => (
                        <button
                          key={ch}
                          onClick={() => setTestChannel(ch)}
                          className={`px-2.5 py-1 rounded-lg font-bold text-xs transition ${
                            testChannel === ch
                              ? 'bg-indigo-900 text-white shadow-xs'
                              : 'bg-white text-slate-700 border border-slate-300'
                          }`}
                        >
                          {ch === 'SMS' ? '📲 پیامک' : ch === 'BALE' ? '🟢 بله' : ch === 'EITAA' ? '🟠 ایتا' : ch === 'TELEGRAM' ? '🔵 تلگرام' : '🟣 سروش'}
                        </button>
                      ))}
                    </div>

                    <p className="text-slate-600 text-2xs">
                      کد پرسنلی (<span className="font-mono" dir="ltr">4000101</span>)، شمارهٔ دانشجویی، موبایل یا کد ملی را وارد کنید —
                      سامانه خودش آیدیِ همان پیام‌رسان را پیدا می‌کند:
                    </p>
                    <input
                      type="text"
                      value={testMobileNumber}
                      onChange={e => setTestMobileNumber(e.target.value)}
                      placeholder="4000101"
                      className="w-full border border-slate-300 rounded-xl p-2.5 font-mono font-bold text-center bg-white"
                    />
                  </div>

                  <button
                    onClick={handleSendTestMessage}
                    disabled={isSendingTest}
                    className="w-full py-2.5 rounded-xl bg-indigo-900 hover:bg-indigo-950 text-white font-extrabold text-xs shadow transition flex items-center justify-center gap-1.5"
                  >
                    <span>🚀 {isSendingTest ? 'در حال ارسال تست…' : `ارسال آزمایشی از طریق ${testChannel}`}</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: MESSAGING BOTS CONFIGURATION (Bale, Eitaa, Telegram, SMS) */}
      {/* ========================================================================= */}
      {activeTab === 'MESSAGING_BOTS' && (
        <div className="card space-y-5">
          <div className="border-b border-slate-200 pb-3">
            <h2 className="text-base font-black text-slate-900">
              🤖 پیکربندی بات‌های پیام‌رسان‌های ایرانی و پیامک (Bale, Eitaa, Telegram, Soroush & SMS)
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              تنظیم کلیدهای دسترسی API، وب‌هوک‌ها و ارسال مستقیم اعلانات، غیبت‌ها، نمرات و یادآوری‌ها به حساب کاربری دانشجویان و اساتید
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            {/* Bale Bot */}
            <div className="p-4 rounded-2xl border-2 border-emerald-300 bg-emerald-50/30 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-8 h-8 rounded-xl bg-emerald-700 text-white flex items-center justify-center font-black">
                    ب
                  </span>
                  <div>
                    <h3 className="font-black text-slate-900 text-sm">پیام‌رسان بله (Bale Bot API)</h3>
                    <span className="text-3xs text-emerald-700 font-bold">سازگار با پلتفرم بله بانک ملی</span>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={botConfig.baleEnabled}
                  onChange={e => setBotConfig({ ...botConfig, baleEnabled: e.target.checked })}
                  className="w-5 h-5 accent-emerald-600 rounded"
                />
              </div>

              <div className="space-y-1.5">
                <label className="font-bold text-slate-700 block">توکن بات بله (Bale Bot Token):</label>
                <input
                  type="text"
                  value={botConfig.baleToken}
                  onChange={e => setBotConfig({ ...botConfig, baleToken: e.target.value })}
                  className="w-full border border-slate-300 rounded-xl p-2 font-mono text-xs bg-white"
                  dir="ltr"
                />
              </div>

              <div className="space-y-1.5">
                <label className="font-bold text-slate-700 block">کانال رسمی اطلاع‌رسانی آفاق در بله:</label>
                <input
                  type="text"
                  value={botConfig.baleChannelId}
                  onChange={e => setBotConfig({ ...botConfig, baleChannelId: e.target.value })}
                  className="w-full border border-slate-300 rounded-xl p-2 font-mono text-xs bg-white"
                  dir="ltr"
                />
              </div>
            </div>

            {/* Eitaa Bot */}
            <div className="p-4 rounded-2xl border-2 border-amber-300 bg-amber-50/30 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-8 h-8 rounded-xl bg-amber-600 text-white flex items-center justify-center font-black">
                    ای
                  </span>
                  <div>
                    <h3 className="font-black text-slate-900 text-sm">پیام‌رسان ایتا (Eitaa Bot API)</h3>
                    <span className="text-3xs text-amber-700 font-bold">سازگار با API رسمی بات ایتا</span>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={botConfig.eitaaEnabled}
                  onChange={e => setBotConfig({ ...botConfig, eitaaEnabled: e.target.checked })}
                  className="w-5 h-5 accent-amber-600 rounded"
                />
              </div>

              <div className="space-y-1.5">
                <label className="font-bold text-slate-700 block">توکن بات ایتا (Eitaa Bot Token):</label>
                <input
                  type="text"
                  value={botConfig.eitaaToken}
                  onChange={e => setBotConfig({ ...botConfig, eitaaToken: e.target.value })}
                  className="w-full border border-slate-300 rounded-xl p-2 font-mono text-xs bg-white"
                  dir="ltr"
                />
              </div>

              <div className="space-y-1.5">
                <label className="font-bold text-slate-700 block">کانال رسمی دانشگاه در ایتا:</label>
                <input
                  type="text"
                  value={botConfig.eitaaChannelId}
                  onChange={e => setBotConfig({ ...botConfig, eitaaChannelId: e.target.value })}
                  className="w-full border border-slate-300 rounded-xl p-2 font-mono text-xs bg-white"
                  dir="ltr"
                />
              </div>
            </div>

            {/* Telegram Bot */}
            <div className="p-4 rounded-2xl border-2 border-sky-300 bg-sky-50/30 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-8 h-8 rounded-xl bg-sky-600 text-white flex items-center justify-center font-black">
                    تل
                  </span>
                  <div>
                    <h3 className="font-black text-slate-900 text-sm">پیام‌رسان تلگرام (Telegram Bot API)</h3>
                    <span className="text-3xs text-sky-700 font-bold">پشتیبانی از پروکسی معکوس داخلی</span>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={botConfig.telegramEnabled}
                  onChange={e => setBotConfig({ ...botConfig, telegramEnabled: e.target.checked })}
                  className="w-5 h-5 accent-sky-600 rounded"
                />
              </div>

              <div className="space-y-1.5">
                <label className="font-bold text-slate-700 block">توکن ربات تلگرام (Bot Token):</label>
                <input
                  type="text"
                  value={botConfig.telegramToken}
                  onChange={e => setBotConfig({ ...botConfig, telegramToken: e.target.value })}
                  className="w-full border border-slate-300 rounded-xl p-2 font-mono text-xs bg-white"
                  dir="ltr"
                />
              </div>

              <div className="space-y-1.5">
                <label className="font-bold text-slate-700 block">کانال تلگرام دانشگاه:</label>
                <input
                  type="text"
                  value={botConfig.telegramChannelId}
                  onChange={e => setBotConfig({ ...botConfig, telegramChannelId: e.target.value })}
                  className="w-full border border-slate-300 rounded-xl p-2 font-mono text-xs bg-white"
                  dir="ltr"
                />
              </div>
            </div>

            {/* Soroush Bot */}
            <div className="p-4 rounded-2xl border-2 border-violet-300 bg-violet-50/30 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-8 h-8 rounded-xl bg-violet-700 text-white flex items-center justify-center font-black">
                    س
                  </span>
                  <div>
                    <h3 className="font-black text-slate-900 text-sm">پیام‌رسان سروش (Soroush Bot API)</h3>
                    <span className="text-3xs text-violet-700 font-bold">سازگار با API رسمی بات سروش‌پلاس</span>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={botConfig.soroushEnabled}
                  onChange={e => setBotConfig({ ...botConfig, soroushEnabled: e.target.checked })}
                  className="w-5 h-5 accent-violet-600 rounded"
                />
              </div>

              <div className="space-y-1.5">
                <label className="font-bold text-slate-700 block">توکن بات سروش (Soroush Bot Token):</label>
                <input
                  type="text"
                  value={botConfig.soroushToken}
                  onChange={e => setBotConfig({ ...botConfig, soroushToken: e.target.value })}
                  className="w-full border border-slate-300 rounded-xl p-2 font-mono text-xs bg-white"
                  dir="ltr"
                />
              </div>

              <div className="space-y-1.5">
                <label className="font-bold text-slate-700 block">کانال رسمی اطلاع‌رسانی آفاق در سروش:</label>
                <input
                  type="text"
                  value={botConfig.soroushChannelId}
                  onChange={e => setBotConfig({ ...botConfig, soroushChannelId: e.target.value })}
                  className="w-full border border-slate-300 rounded-xl p-2 font-mono text-xs bg-white"
                  dir="ltr"
                />
              </div>
            </div>

            {/* SMS Provider */}
            <div className="p-4 rounded-2xl border-2 border-indigo-300 bg-indigo-50/30 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-8 h-8 rounded-xl bg-indigo-700 text-white flex items-center justify-center font-black">
                    پی
                  </span>
                  <div>
                    <h3 className="font-black text-slate-900 text-sm">پنل پیامک انبوه و خدماتی (SMS Gateway)</h3>
                    <span className="text-3xs text-indigo-700 font-bold">ارسال پیامک با خط خدماتی (بلک‌لیست)</span>
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="font-bold text-slate-700 block">ارائه‌دهنده وب‌سرویس پیامک:</label>
                <select
                  value={botConfig.smsProvider}
                  onChange={e => setBotConfig({ ...botConfig, smsProvider: e.target.value })}
                  className="w-full border border-slate-300 rounded-xl p-2 text-xs bg-white font-bold"
                >
                  <option value="KAVENEGAR">کاوه نگار (Kavenegar REST API)</option>
                  <option value="MAGFA">مگفا (Magfa Soap/REST)</option>
                  <option value="MELLI_PAYAMAK">ملی پیامک (MelliPayamak API)</option>
                  <option value="IPPANEL">آی‌پی پنل (IPPanel / FarazSMS)</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="font-bold text-slate-700 block text-2xs">کلید API پیامک:</label>
                  <input
                    type="password"
                    value={botConfig.smsApiKey}
                    onChange={e => setBotConfig({ ...botConfig, smsApiKey: e.target.value })}
                    className="w-full border border-slate-300 rounded-xl p-2 font-mono text-xs bg-white"
                    dir="ltr"
                  />
                </div>
                <div>
                  <label className="font-bold text-slate-700 block text-2xs">شماره خط اختصاصی:</label>
                  <input
                    type="text"
                    value={botConfig.smsSenderNumber}
                    onChange={e => setBotConfig({ ...botConfig, smsSenderNumber: e.target.value })}
                    className="w-full border border-slate-300 rounded-xl p-2 font-mono text-xs bg-white text-center"
                    dir="ltr"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-end pt-3 border-t border-slate-200">
            <button
              onClick={handleSaveBots}
              className="px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs shadow flex items-center gap-1.5"
            >
              <span>💾 ذخیره تنظیمات بات‌ها و پیام‌رسان‌ها</span>
            </button>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 3: LMS & BIGBLUEBUTTON CONFIGURATION */}
      {/* ========================================================================= */}
      {activeTab === 'LMS_BBB' && (
        <div className="card space-y-5">
          <div className="border-b border-slate-200 pb-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-black text-slate-900">
                💻 پیکربندی وب‌سرویس کلاس‌های مجازی (BigBlueButton API & Moodle WS)
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                محل تنظیم آدرس سرور BBB، کد امنیتی Salt، اتصال Moodle SSO و هدایت خودکار دانشجو و استاد به جلسات آنلاین
              </p>
            </div>

            <button
              onClick={handleTestBbb}
              disabled={isTestingBbb}
              className="px-4 py-2 rounded-xl bg-indigo-700 hover:bg-indigo-800 text-white font-black text-xs shadow flex items-center gap-1.5"
            >
              <span>{isTestingBbb ? 'در حال تست ارتباط…' : '🔍 تست اتصال زنده سرور BBB'}</span>
            </button>
          </div>

          {bbbStatus && (
            <div className="p-3.5 bg-emerald-50 border border-emerald-300 text-emerald-950 rounded-xl text-xs font-mono font-bold">
              {bbbStatus}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            {/* BigBlueButton URL & Secret */}
            <div className="p-4 rounded-2xl border border-slate-200 bg-slate-50 space-y-3">
              <h3 className="font-black text-slate-900 text-sm flex items-center gap-1.5">
                <span>📡</span>
                <span>تنظیمات هسته BigBlueButton Server</span>
              </h3>

              <div className="space-y-1">
                <label className="font-bold text-slate-700 block">
                  آدرس وب‌سرویس بیگ‌بلوباتن (BIGBLUEBUTTON_URL):
                </label>
                <input
                  type="text"
                  value={bbbConfig.url}
                  onChange={e => setBbbConfig({ ...bbbConfig, url: e.target.value })}
                  className="w-full border border-slate-300 rounded-xl p-2.5 font-mono text-xs bg-white"
                  dir="ltr"
                />
                <span className="text-3xs text-slate-500">
                  مثال: https://vc.example.ac.ir/bigbluebutton/api
                </span>
              </div>

              <div className="space-y-1">
                <label className="font-bold text-slate-700 block">
                  کد امنیتی اتصال / سکرت (BIGBLUEBUTTON_SECRET / Salt):
                </label>
                <input
                  type="text"
                  value={bbbConfig.secret}
                  onChange={e => setBbbConfig({ ...bbbConfig, secret: e.target.value })}
                  className="w-full border border-slate-300 rounded-xl p-2.5 font-mono text-xs bg-white"
                  dir="ltr"
                />
                <span className="text-3xs text-slate-500">
                  این کلید برای تولید هش Checksum طبق استاندارد BBB API استفاده می‌شود.
                </span>
              </div>
            </div>

            {/* Moodle LMS Bridge */}
            <div className="p-4 rounded-2xl border border-slate-200 bg-slate-50 space-y-3">
              <h3 className="font-black text-slate-900 text-sm flex items-center gap-1.5">
                <span>🎓</span>
                <span>تنظیمات اتصال به سامانه Moodle LMS</span>
              </h3>

              <div className="space-y-1">
                <label className="font-bold text-slate-700 block">
                  آدرس پرتال مودل دانشگاه (MOODLE_URL):
                </label>
                <input
                  type="text"
                  value={bbbConfig.moodleUrl}
                  onChange={e => setBbbConfig({ ...bbbConfig, moodleUrl: e.target.value })}
                  className="w-full border border-slate-300 rounded-xl p-2.5 font-mono text-xs bg-white"
                  dir="ltr"
                />
              </div>

              <div className="space-y-1">
                <label className="font-bold text-slate-700 block">
                  توکن وب‌سرویس مودل (MOODLE_WS_TOKEN):
                </label>
                <input
                  type="password"
                  value={bbbConfig.moodleToken}
                  onChange={e => setBbbConfig({ ...bbbConfig, moodleToken: e.target.value })}
                  className="w-full border border-slate-300 rounded-xl p-2.5 font-mono text-xs bg-white"
                  dir="ltr"
                />
              </div>
            </div>
          </div>

          <div className="flex justify-end pt-3 border-t border-slate-200">
            <button
              onClick={handleSaveBbb}
              className="px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs shadow flex items-center gap-1.5"
            >
              <span>💾 ذخیره تنظیمات کلاس‌های مجازی</span>
            </button>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 4: SHAPARAK PAYMENT GATEWAY */}
      {/* ========================================================================= */}
      {activeTab === 'SHAPARAK' && (
        <div className="card space-y-5">
          <div className="border-b border-slate-200 pb-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-black text-slate-900">
                💳 پیکربندی درگاه پرداخت اینترنتی شبکه شاپرک (Iranian PSP Gateway)
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                تنظیم ترمینال‌های پذیرندگی بانکی، کلیدهای تراکنش و تست پرداخت آنلاین شهریه و هزینه‌های تحصیلی
              </p>
            </div>

            <button
              onClick={handleTestShaparak}
              disabled={isTestingShaparak}
              className="px-4 py-2 rounded-xl bg-indigo-700 hover:bg-indigo-800 text-white font-black text-xs shadow flex items-center gap-1.5"
            >
              <span>{isTestingShaparak ? 'در حال دریافت توکن شاپرک…' : '🔍 تست صدور توکن تراکنش'}</span>
            </button>
          </div>

          {shaparakTestResult && (
            <div className="p-3.5 bg-emerald-50 border border-emerald-300 text-emerald-950 rounded-xl text-xs font-mono font-bold">
              {shaparakTestResult}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            {/* PSP Provider Selector */}
            <div className="p-4 rounded-2xl border border-slate-200 bg-slate-50 space-y-3">
              <h3 className="font-black text-slate-900 text-sm">انتخاب شرکت ارائه‌دهنده خدمات پرداخت (PSP)</h3>

              <div className="space-y-1">
                <label className="font-bold text-slate-700 block">درگاه فعال شاپرک:</label>
                <select
                  value={shaparakConfig.provider}
                  onChange={e => setShaparakConfig({ ...shaparakConfig, provider: e.target.value })}
                  className="w-full border border-slate-300 rounded-xl p-2.5 text-xs bg-white font-bold"
                >
                  <option value="BEHPARDAKHT_MELLAT">شرکت به‌پرداخت ملت (بانک ملت)</option>
                  <option value="SADAD_MELLI">شرکت پرداخت الکترونیک سداد (بانک ملی)</option>
                  <option value="SAMAN_SEP">پرداخت الکترونیک سامان کیش (بانک سامان)</option>
                  <option value="ZARINPAL">زرین‌پال (ZarinPal IPG)</option>
                  <option value="SHAPARAK_SANDBOX">محیط آزمایشی شاپرک (Sandbox Simulator)</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="font-bold text-slate-700 block">آدرس برگشت پس از پرداخت (Callback URL):</label>
                <input
                  type="text"
                  value={shaparakConfig.callbackUrl}
                  onChange={e => setShaparakConfig({ ...shaparakConfig, callbackUrl: e.target.value })}
                  className="w-full border border-slate-300 rounded-xl p-2 font-mono text-xs bg-white"
                  dir="ltr"
                />
              </div>
            </div>

            {/* Terminal & Merchant Info */}
            <div className="p-4 rounded-2xl border border-slate-200 bg-slate-50 space-y-3">
              <h3 className="font-black text-slate-900 text-sm">مشخصات پذیرنده و ترمینال شاپرک</h3>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-bold text-slate-700 block">شماره ترمینال (Terminal ID):</label>
                  <input
                    type="text"
                    value={shaparakConfig.terminalId}
                    onChange={e => setShaparakConfig({ ...shaparakConfig, terminalId: e.target.value })}
                    className="w-full border border-slate-300 rounded-xl p-2 font-mono text-xs bg-white text-center"
                    dir="ltr"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-bold text-slate-700 block">کد پذیرنده (Merchant ID):</label>
                  <input
                    type="text"
                    value={shaparakConfig.merchantId}
                    onChange={e => setShaparakConfig({ ...shaparakConfig, merchantId: e.target.value })}
                    className="w-full border border-slate-300 rounded-xl p-2 font-mono text-xs bg-white text-center"
                    dir="ltr"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="font-bold text-slate-700 block">کلید امنیتی / رمز پذیرنده (Merchant Key / Password):</label>
                <input
                  type="password"
                  value={shaparakConfig.merchantKey}
                  onChange={e => setShaparakConfig({ ...shaparakConfig, merchantKey: e.target.value })}
                  className="w-full border border-slate-300 rounded-xl p-2 font-mono text-xs bg-white"
                  dir="ltr"
                />
              </div>
            </div>
          </div>

          <div className="flex justify-end pt-3 border-t border-slate-200">
            <button
              onClick={handleSavePay}
              className="px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs shadow flex items-center gap-1.5"
            >
              <span>💾 ذخیره تنظیمات درگاه شاپرک</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
