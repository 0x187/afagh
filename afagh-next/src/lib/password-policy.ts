export const PASSWORD_MAX_LENGTH = 128;
export const PASSWORD_MIN_LENGTH_STUDENT = 10;
export const PASSWORD_MIN_LENGTH_STAFF = 12;

const COMMON_PASSWORDS = new Set([
  '1234567890', '0123456789', '9876543210', '1234567891', '12345678901', '123456789012',
  '1111111111', '0000000000', '2222222222', '1212121212', '1122334455', '1234512345',
  'password', 'password1', 'password12', 'password123', 'passw0rd', 'p@ssword', 'p@ssw0rd',
  'qwertyuiop', 'qwerty1234', 'qwerty123456', 'asdfghjkl', 'abcdefghij', 'abc123456789',
  'iloveyou', 'letmein123', 'welcome123', 'changeme', 'changeme1', 'administrator',
  'afagh1234', 'afagh12345', 'afagh123456', 'afagh@1234', 'afagh@123456', 'afaghafagh',
  'sanjesh1404', 'sanjesh1405', 'tehran1234', 'iran123456', 'iran1234567',
]);

function isSequentialOrRepeated(s: string): boolean {
  if (/^(.)\1+$/.test(s)) return true;
  if (!/^\d+$/.test(s)) return false;
  const digits = s.split('').map(Number);
  const step = digits[1] - digits[0];
  if (step !== 1 && step !== -1) return false;
  return digits.every((d, i) => i === 0 || d - digits[i - 1] === step);
}

export function checkNewPassword(
  rawPassword: string,
  opts: { minLength: number; identifiers?: Array<string | null | undefined> },
): string | null {
  const pw = rawPassword.trim();
  if (pw.length < opts.minLength) return `رمز جدید باید حداقل ${opts.minLength.toLocaleString('fa-IR')} کاراکتر باشد.`;
  if (pw.length > PASSWORD_MAX_LENGTH) return `رمز جدید باید حداکثر ${PASSWORD_MAX_LENGTH.toLocaleString('fa-IR')} کاراکتر باشد.`;
  const lower = pw.toLowerCase();
  if (COMMON_PASSWORDS.has(lower) || isSequentialOrRepeated(pw))
    return 'این رمز خیلی رایج یا قابل حدس است؛ رمز دیگری انتخاب کنید.';
  for (const id of opts.identifiers ?? []) {
    const idv = String(id ?? '').trim().toLowerCase();
    if (idv && lower.includes(idv)) return 'رمز نباید شامل کد ملی یا شناسهٔ کاربری شما باشد.';
  }
  return null;
}
