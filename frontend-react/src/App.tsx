import { Route, Routes } from 'react-router-dom';

import { AppShell } from '@/components/shell/AppShell';
import { PwaRegister } from '@/components/shell/PwaRegister';
import { Home } from '@/routes/Home';
import { NotFound } from '@/routes/NotFound';

export function App() {
  return (
    <>
      <PwaRegister />
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Home />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </>
  );
}
