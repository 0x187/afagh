import { Route, Routes } from 'react-router-dom';

import { AppShell } from '@/components/shell/AppShell';
import { PwaRegister } from '@/components/shell/PwaRegister';
import { ChangePassword } from '@/routes/ChangePassword';
import { LoginPage } from '@/routes/login/LoginPage';
import { Home } from '@/routes/Home';
import { StudentSchedulePage } from '@/routes/student/SchedulePage';
import { NotFound } from '@/routes/NotFound';

export function App() {
  return (
    <>
      <PwaRegister />
      <Routes>
        {/* مسیرهای عمومی (بدون شل/سربرگ) */}
        <Route path="login" element={<LoginPage />} />
        <Route path="change-password" element={<ChangePassword />} />

        {/* شل محافظت‌شده — گارد نشست داخل AppShell است */}
        <Route element={<AppShell />}>
          <Route index element={<Home />} />
          <Route path="student/schedule" element={<StudentSchedulePage />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </>
  );
}
