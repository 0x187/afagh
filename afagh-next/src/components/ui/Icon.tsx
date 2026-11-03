import React from 'react';

/**
 * آیکون‌های پوسته — جانشین اموجی‌ها.
 *
 * چرا: در کدبیس ۷۳ آیکونِ ماژول از نوع اموجی بود (`🎓`, `🗓️`, `🛡️`, …). اموجی
 * در ویندوز/اندروید/iOS شکل و اندازهٔ متفاوت دارد، با متن فارسی هم‌تراز
 * نمی‌شود، رنگ برند نمی‌گیرد و در چاپ/ screen reader نویز تولید می‌کند.
 *
 * این کامپوننت یک نقشهٔ «اموجی → شکل» دارد؛ هر اموجیِ ناشناخته به‌صورت متن
 * باقی می‌ماند (fallback ایمن)، پس مهاجرت تدریجی است و هیچ آیکونی گم نمی‌شود.
 */

const EMOJI_TO_NAME: Record<string, string> = {
  '⏰': 'clock', '⏱️': 'clock',
  '⚖️': 'scale',
  '⚙️': 'settings', '🛠️': 'settings',
  '✅': 'check',
  '🎓': 'cap',
  '🏆': 'trophy',
  '🏛️': 'bank',
  '🏠': 'home',
  '🏧': 'cash', '💰': 'cash', '💳': 'cash',
  '🏷️': 'tag',
  '👤': 'user',
  '💼': 'briefcase',
  '📄': 'file', '📑': 'file', '🗂️': 'file', '🗄️': 'file', '📕': 'file',
  '📊': 'chart',
  '📋': 'clipboard', '📝': 'clipboard',
  '📚': 'book', '📖': 'book',
  '📡': 'signal',
  '📣': 'megaphone',
  '📤': 'upload',
  '📥': 'download',
  '📨': 'mail',
  '🔀': 'shuffle',
  '🔁': 'refresh', '🔄': 'refresh',
  '🔍': 'search',
  '🔐': 'lock', '🛡️': 'lock', '🪖': 'lock',
  '🔑': 'key',
  '🔗': 'link',
  '🔬': 'flask',
  '🖨️': 'printer',
  '🖼️': 'image',
  '🗓️': 'calendar',
  '🗺️': 'map',
  '🚦': 'traffic',
  '🧩': 'puzzle',
  '🧮': 'calculator',
  '🪪': 'idcard',
  '🧭': 'compass',
  '☰': 'menu',
  '✕': 'close', '×': 'close',
};

function Shape({ name }: { name: string }) {
  switch (name) {
    case 'home':
      return <path d="M4 10.6 12 4l8 6.6V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z" />;
    case 'clock':
      return (
        <>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 7.5V12l3 1.8" />
        </>
      );
    case 'settings':
      return (
        <>
          <circle cx="12" cy="12" r="3" />
          <path d="M12 3.5v2M12 18.5v2M4.9 7.8l1.7 1M17.4 15.2l1.7 1M4.9 16.2l1.7-1M17.4 8.8l1.7-1" />
        </>
      );
    case 'check':
      return <path d="M4.5 12.5 9.5 17.5 19.5 7" />;
    case 'cap':
      return (
        <>
          <path d="M3 9.5 12 5l9 4.5-9 4.5z" />
          <path d="M7 11.6V16c0 1.4 2.2 2.6 5 2.6s5-1.2 5-2.6v-4.4" />
        </>
      );
    case 'trophy':
      return (
        <>
          <path d="M8 4h8v5a4 4 0 0 1-8 0z" />
          <path d="M8 5.5H5.5V7a3 3 0 0 0 3 3M16 5.5h2.5V7a3 3 0 0 1-3 3M12 13v4M9 20h6" />
        </>
      );
    case 'bank':
      return (
        <>
          <path d="M3.5 9.5 12 4l8.5 5.5z" />
          <path d="M6 10v7M10 10v7M14 10v7M18 10v7M4 20h16" />
        </>
      );
    case 'cash':
      return (
        <>
          <rect x="3" y="6.5" width="18" height="11" rx="2" />
          <circle cx="12" cy="12" r="2.5" />
        </>
      );
    case 'tag':
      return (
        <>
          <path d="M4 4h7l9 9-7 7-9-9z" />
          <circle cx="8" cy="8" r="1.2" />
        </>
      );
    case 'user':
      return (
        <>
          <circle cx="12" cy="8" r="3.5" />
          <path d="M5 20c0-3.3 3.1-5.5 7-5.5s7 2.2 7 5.5" />
        </>
      );
    case 'briefcase':
      return (
        <>
          <rect x="3" y="8" width="18" height="11" rx="2" />
          <path d="M9 8V6.5A1.5 1.5 0 0 1 10.5 5h3A1.5 1.5 0 0 1 15 6.5V8M3 13h18" />
        </>
      );
    case 'file':
      return (
        <>
          <path d="M6 3h7l5 5v13H6z" />
          <path d="M13 3v5h5M9 13h6M9 17h6" />
        </>
      );
    case 'chart':
      return <path d="M4 20V4M4 20h16M8 17v-5M12 17V8M16 17v-7" />;
    case 'clipboard':
      return (
        <>
          <rect x="5" y="4.5" width="14" height="16" rx="2" />
          <path d="M9 4.5V3h6v1.5M9 10h6M9 14h6M9 18h3" />
        </>
      );
    case 'book':
      return (
        <>
          <path d="M5 4.5h6a2 2 0 0 1 2 2V20a2 2 0 0 0-2-2H5z" />
          <path d="M19 4.5h-6a2 2 0 0 0-2 2V20a2 2 0 0 1 2-2h6z" />
        </>
      );
    case 'signal':
      return (
        <>
          <circle cx="12" cy="12" r="2" />
          <path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 16.2a6 6 0 0 0 0-8.4M4.9 4.9a10 10 0 0 0 0 14.2M19.1 19.1a10 10 0 0 0 0-14.2" />
        </>
      );
    case 'megaphone':
      return (
        <>
          <path d="M4 10v4l10 5V5z" />
          <path d="M14 8.5a3.5 3.5 0 0 1 0 7M6 14v4" />
        </>
      );
    case 'upload':
      return <path d="M12 19V5M7 10l5-5 5 5M4 20h16" />;
    case 'download':
      return <path d="M12 4v14M7 13l5 5 5-5M4 20h16" />;
    case 'mail':
      return (
        <>
          <rect x="3" y="6" width="18" height="12" rx="2" />
          <path d="m4 8 8 5.5L20 8" />
        </>
      );
    case 'shuffle':
      return <path d="M4 7h4l8 10h4M4 17h4l8-10h4M17 4l3 3-3 3M17 14l3 3-3 3" />;
    case 'refresh':
      return (
        <>
          <path d="M20 12a8 8 0 1 1-2.4-5.7" />
          <path d="M20 4.5V10h-5.2" />
        </>
      );
    case 'search':
      return (
        <>
          <circle cx="11" cy="11" r="6" />
          <path d="m16 16 4 4" />
        </>
      );
    case 'lock':
      return (
        <>
          <rect x="5" y="10.5" width="14" height="9.5" rx="2" />
          <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
        </>
      );
    case 'key':
      return (
        <>
          <circle cx="8" cy="8" r="3.5" />
          <path d="m10.6 10.6 8.4 8.4M15 15l2-2M17.5 17.5l2-2" />
        </>
      );
    case 'link':
      return (
        <>
          <path d="M10 13.5a4 4 0 0 0 5.7 0l2.8-2.8a4 4 0 0 0-5.7-5.7L11.5 6" />
          <path d="M14 10.5a4 4 0 0 0-5.7 0l-2.8 2.8a4 4 0 0 0 5.7 5.7l1.3-1.3" />
        </>
      );
    case 'flask':
      return <path d="M9 4h6M10.5 4v5.5L6 19a1.5 1.5 0 0 0 1.3 2h9.4A1.5 1.5 0 0 0 18 19l-4.5-9.5V4M7.8 14.5h8.4" />;
    case 'printer':
      return (
        <>
          <path d="M7 8V4h10v4M7 17H5a1 1 0 0 1-1-1v-6h16v6a1 1 0 0 1-1 1h-2" />
          <rect x="7" y="14" width="10" height="6" rx="1" />
        </>
      );
    case 'image':
      return (
        <>
          <rect x="3.5" y="5" width="17" height="14" rx="2" />
          <circle cx="9" cy="10" r="1.6" />
          <path d="m5 17 4.5-4.5 3 3L16 12l3.5 3.5" />
        </>
      );
    case 'calendar':
      return (
        <>
          <rect x="3.5" y="5.5" width="17" height="15" rx="2" />
          <path d="M8 3.5v4M16 3.5v4M3.5 10.5h17M8 14h3M8 17.5h3M14 14h2.5" />
        </>
      );
    case 'map':
      return <path d="m3.5 6.5 5-2 7 3 5-2v13l-5 2-7-3-5 2zM8.5 4.5v13M15.5 7.5v13" />;
    case 'traffic':
      return (
        <>
          <rect x="8" y="3" width="8" height="18" rx="3.5" />
          <circle cx="12" cy="8" r="1.4" />
          <circle cx="12" cy="12.5" r="1.4" />
          <circle cx="12" cy="17" r="1.4" />
        </>
      );
    case 'puzzle':
      return <path d="M10 4a2 2 0 1 1 4 0v1.5h3.5A1.5 1.5 0 0 1 19 7v3h1a2 2 0 1 1 0 4h-1v3.5a1.5 1.5 0 0 1-1.5 1.5H14v-1a2 2 0 1 0-4 0v1H6.5A1.5 1.5 0 0 1 5 17.5V14H4a2 2 0 1 1 0-4h1V7a1.5 1.5 0 0 1 1.5-1.5H10z" />;
    case 'calculator':
      return (
        <>
          <rect x="5" y="3.5" width="14" height="17" rx="2" />
          <path d="M8.5 7.5h7M8.5 12h1.5M13.5 12H15M8.5 16h1.5M13.5 16H15" />
        </>
      );
    case 'idcard':
      return (
        <>
          <rect x="3" y="5.5" width="18" height="13" rx="2" />
          <circle cx="8.5" cy="11" r="1.8" />
          <path d="M6 15.5c.5-1.3 1.4-2 2.5-2s2 .7 2.5 2M14 10.5h4M14 14h4" />
        </>
      );
    case 'compass':
      return (
        <>
          <circle cx="12" cy="12" r="8.5" />
          <path d="m9 15 2-4 4-2-2 4z" />
        </>
      );
    case 'menu':
      return <path d="M4 7h16M4 12h16M4 17h16" />;
    case 'close':
      return <path d="M6 6l12 12M18 6L6 18" />;
    case 'scale':
      return <path d="M12 4v16M6 20h12M4 9h5l-2.5 4.5A2.5 2.5 0 0 0 11.5 13L9 9M15 9h5l-2.5 4.5A2.5 2.5 0 0 0 22.5 13L20 9" />;
    default:
      return null;
  }
}

export default function Icon({
  emoji,
  className = 'h-4 w-4',
  title,
}: {
  /** اموجیِ قبلی (کلید نقشه) یا نامِ مستقیم آیکون */
  emoji: string;
  className?: string;
  title?: string;
}) {
  const name = EMOJI_TO_NAME[emoji] ?? emoji;
  const known = name !== emoji || Object.values(EMOJI_TO_NAME).includes(emoji);

  if (!known) {
    // آیکون ناشناخته: همان اموجی، اما با اندازه/هم‌ترازیِ ثابت
    return (
      <span aria-hidden className="inline-flex w-4 justify-center leading-none">
        {emoji}
      </span>
    );
  }

  return (
    <svg
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      aria-label={title}
      viewBox="0 0 24 24"
      className={`${className} shrink-0`}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <Shape name={name} />
    </svg>
  );
}
