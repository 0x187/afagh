import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Fragment, useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { faDigits } from '@/lib/fa';
import { createRole, deleteRole, getPermissionsWorkspace, saveRolePermissions, type PermissionRow, type PermissionsWorkspace } from '@/lib/admin-modules6-api';

// ═══ ماتریس پویا و مدیریت سطوح دسترسی (RBAC) — port of admin/permissions ═══

export function PermissionsPage() {
  const qc = useQueryClient();
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Dirty roles: roleId → next permission code set (only roles with changes).
  const [dirty, setDirty] = useState<Record<number, string[]>>({});
  const [newCode, setNewCode] = useState('');
  const [newTitle, setNewTitle] = useState('');

  const q = useQuery({ queryKey: ['admin-permissions'], queryFn: getPermissionsWorkspace });
  const ws: PermissionsWorkspace | null = q.data?.data ?? null;

  const permsByCategory = useMemo(() => {
    const map = new Map<string, PermissionRow[]>();
    for (const p of ws?.permissions ?? []) {
      const list = map.get(p.category) ?? [];
      list.push(p);
      map.set(p.category, list);
    }
    return map;
  }, [ws]);

  const currentCodes = (role: { id: number; permissions: string[] }): string[] => dirty[role.id] ?? role.permissions;

  const toggle = (role: { id: number; permissions: string[] }, code: string) => {
    const cur = currentCodes(role);
    const next = cur.includes(code) ? cur.filter((c) => c !== code) : [...cur, code];
    setDirty((d) => {
      const clone = { ...d };
      const base = role.permissions;
      // A role leaves the dirty set when it matches its stored state again.
      if (base.length === next.length && base.every((c) => next.includes(c))) delete clone[role.id];
      else clone[role.id] = next;
      return clone;
    });
  };

  const saveDirty = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const ids = Object.keys(dirty).map(Number);
      for (const id of ids) {
        const r = await saveRolePermissions(id, dirty[id]);
        if (!r.ok) {
          setMsg(r.error ?? 'ذخیرهٔ دسترسی‌ها ناموفق بود.');
          return;
        }
      }
      setDirty({});
      setMsg(ids.length ? '✅ تغییرات دسترسی ذخیره شد.' : 'تغییری برای ذخیره نیست.');
      void qc.invalidateQueries({ queryKey: ['admin-permissions'] });
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const addRole = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await createRole(newCode.trim(), newTitle.trim());
      if (!r.ok) {
        setMsg(r.error ?? 'ایجاد نقش ناموفق بود.');
        return;
      }
      setNewCode('');
      setNewTitle('');
      setMsg('✅ نقش جدید ساخته شد.');
      void qc.invalidateQueries({ queryKey: ['admin-permissions'] });
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const removeRole = async (role: { id: number; code: string }) => {
    if (!window.confirm(`نقش «${role.code}» حذف شود؟`)) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await deleteRole(role.id);
      setMsg(r.ok ? '✅ نقش حذف شد.' : `⛔ ${r.error ?? ''}`);
      void qc.invalidateQueries({ queryKey: ['admin-permissions'] });
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (q.isLoading) return <Skeleton className="h-96 w-full" />;
  if (q.isError || !ws) {
    return <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">بارگذاری ماتریس دسترسی‌ها ناموفق بود. (فقط مدیر ارشد سامانه)</CardContent></Card>;
  }

  const dirtyCount = Object.keys(dirty).length;

  return (
    <div className="space-y-4">
      <Card className="border-0 bg-gradient-to-l from-slate-900 to-indigo-900 text-white">
        <CardContent className="p-5">
          <h1 className="text-base font-black">🛡️ ماتریس دسترسی‌ها (RBAC)</h1>
          <p className="mt-1 text-xs text-indigo-100">
            مجوزهای هر نقش روی جدول‌های واقعی roles/permissions/role_permissions می‌نشیند و هر تغییر در زنجیرهٔ ممیزی ثبت می‌شود.
          </p>
        </CardContent>
      </Card>

      {msg ? <Card><CardContent className="px-4 py-2.5 text-xs font-bold text-foreground">{msg}</CardContent></Card> : null}

      <Card>
        <CardContent className="overflow-x-auto">
          <table className="w-full border-collapse text-right text-[11px]">
            <thead>
              <tr>
                <th className="sticky right-0 z-10 bg-card p-2 font-black">مجوز</th>
                {ws.roles.map((r) => (
                  <th key={r.id} className="min-w-24 p-2 text-center">
                    <div className="font-black">{r.title}</div>
                    <div className="font-mono text-[9px] text-muted-foreground" dir="ltr">{r.code}</div>
                    <div className="text-[9px] text-muted-foreground">{faDigits(r.userCount)} کاربر {r.isSystem ? '· سیستمی' : ''}</div>
                    {!r.isSystem && r.userCount === 0 ? (
                      <button type="button" onClick={() => void removeRole(r)} className="text-[9px] font-bold text-red-600">حذف نقش</button>
                    ) : null}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...permsByCategory.entries()].map(([cat, perms]) => (
                <Fragment key={`cat-${cat}`}>
                  <tr className="bg-muted/40">
                    <td colSpan={ws.roles.length + 1} className="p-1.5 pr-3 text-[10px] font-black text-muted-foreground">{cat}</td>
                  </tr>
                  {perms.map((p) => (
                    <tr key={p.id} className="border-t border-border/50">
                      <td className="sticky right-0 z-10 bg-card p-2">
                        <div className="font-bold">{p.title}</div>
                        <div className="font-mono text-[9px] text-muted-foreground" dir="ltr">{p.code}</div>
                      </td>
                      {ws.roles.map((r) => (
                        <td key={r.id} className="p-2 text-center">
                          <input
                            type="checkbox"
                            className="size-4"
                            checked={currentCodes(r).includes(p.code)}
                            onChange={() => toggle(r, p.code)}
                            aria-label={`${p.title} — ${r.title}`}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={busy || dirtyCount === 0} onClick={() => void saveDirty()}>
          تأیید تغییر دسترسی {dirtyCount > 0 ? `(${faDigits(dirtyCount)} نقش)` : ''}
        </Button>
        {dirtyCount > 0 ? (
          <Button variant="ghost" disabled={busy} onClick={() => setDirty({})}>بازگردانی تغییرات</Button>
        ) : null}
      </div>

      <Card>
        <CardContent className="space-y-2">
          <h2 className="flex items-center gap-2 text-sm font-black">نقش سازمانی جدید <Badge variant="outline">غیرسیستمی</Badge></h2>
          <div className="flex flex-wrap items-center gap-2">
            <Input placeholder="کد نقش (مثل REGISTRATION_STAFF)" value={newCode} onChange={(e) => setNewCode(e.target.value)} className="w-64" dir="ltr" />
            <Input placeholder="عنوان نقش" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} className="w-64" />
            <Button size="sm" disabled={busy || !newCode.trim() || !newTitle.trim()} onClick={() => void addRole()}>ایجاد نقش</Button>
          </div>
          <p className="text-[10px] text-muted-foreground">کد نقش باید ۳ تا ۳۲ نویسهٔ لاتین بزرگ، رقم یا زیرخط باشد و با حرف شروع شود.</p>
        </CardContent>
      </Card>
    </div>
  );
}
