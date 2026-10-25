import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/button';

export function NotFound() {
  return (
    <div className="flex flex-col items-center gap-4 py-16 text-center">
      <div className="text-6xl font-bold text-muted-foreground/40">۴۰۴</div>
      <p className="text-muted-foreground">این صفحه در نسخهٔ جدید پیدا نشد.</p>
      <Button asChild>
        <Link to="/">بازگشت به خانه</Link>
      </Button>
    </div>
  );
}
