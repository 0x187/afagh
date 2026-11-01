import { desc, eq, isNull, or } from 'drizzle-orm';
import { db } from '@/db';
import {
  admissions_staging,
  api_audit_logs,
  degree_level_configs,
  majors,
  sanjesh_mappings,
  student_id_formulas,
} from '@/db/schema';
import { requireRole } from '@/lib/auth';
import { ensureDefaultSanjeshMappings } from '@/lib/admissions-engine';
import { ensureDefaultIntegrations } from '@/lib/api-integrations';
import { getCurrentUniversity } from '@/lib/university-scope';
import AdmissionsClient from './AdmissionsClient';

export const dynamic = 'force-dynamic';

export default async function AdminAdmissionsPage() {
  await requireRole(['ADMIN', 'EDU_EXPERT']);
  // دو تضمینِ پیش‌فرض روی جدول‌های متفاوت‌اند و به هم وابسته نیستند — موازی می‌روند.
  await Promise.all([ensureDefaultSanjeshMappings(), ensureDefaultIntegrations()]);

  const currentUniversity = await getCurrentUniversity();
  const currentUniversityId = currentUniversity?.id ?? null;
  const scopeOf = (c: any) => (currentUniversityId ? or(eq(c, currentUniversityId), isNull(c)) : undefined);

  // پنج خواندنِ مستقل (بدون وابستگی بین‌شان) — یک رفت‌وبرگشتِ موازی به‌جای پنج تای پشتِ‌سرهم.
  const [allMajors, allLevels, allMappings, allFormulas, rawStaging] = await Promise.all([
    db.select().from(majors).where(scopeOf(majors.universityId)).orderBy(majors.id),
    db.select().from(degree_level_configs).where(scopeOf(degree_level_configs.universityId)).orderBy(degree_level_configs.id),
    db.select().from(sanjesh_mappings).where(scopeOf(sanjesh_mappings.universityId)),
    db.select().from(student_id_formulas).where(scopeOf(student_id_formulas.universityId)),
    db
      .select()
      .from(admissions_staging)
      .where(scopeOf(admissions_staging.universityId))
      .orderBy(desc(admissions_staging.id))
      .limit(50),
  ]);

  let rawApiLogs: any[] = [];
  try {
    rawApiLogs = await db
      .select()
      .from(api_audit_logs)
      .orderBy(desc(api_audit_logs.id))
      .limit(20);
  } catch (_) {
    rawApiLogs = [];
  }

  const stagingFormatted = rawStaging.map(s => {
    let parsedData: any = {};
    try {
      if (s.rawSanjeshData) parsedData = JSON.parse(s.rawSanjeshData);
    } catch (_) {}

    const major = allMajors.find(m => m.id === s.mappedMajorId);

    return {
      id: s.id,
      fileId: s.fileId,
      nationalCode: s.nationalCode,
      fullName: s.fullName,
      mappedMajorId: s.mappedMajorId,
      mappedMajorName: major?.name || null,
      status: s.status,
      quotaType: s.quotaType,
      studentId: s.studentId,
      mobile: s.mobile,
      rawSanjeshData: parsedData,
    };
  });

  const mappingsFormatted = allMappings.map(m => {
    const major = allMajors.find(maj => maj.id === m.internalMajorId);
    return {
      id: m.id,
      sanjeshCode: m.sanjeshCode,
      internalMajorId: m.internalMajorId,
      majorName: major?.name,
      sanjeshQuota: m.sanjeshQuota,
    };
  });

  const formulasFormatted = allFormulas.map(f => {
    const level = allLevels.find(l => l.id === f.degreeLevelId);
    return {
      degreeLevelId: f.degreeLevelId,
      degreeTitle: level?.title || 'کارشناسی',
      formula: f.formula,
      currentSequence: f.currentSequence,
    };
  });

  const apiLogsFormatted = rawApiLogs.map(l => ({
    id: l.id,
    serviceName: l.serviceName,
    requestUrl: l.requestUrl,
    responseStatus: l.responseStatus,
    durationMs: l.durationMs,
    isSuccess: l.isSuccess,
    executedAt: l.executedAt ? l.executedAt.toISOString() : null,
  }));

  return (
    <AdmissionsClient
      stagingList={stagingFormatted}
      mappings={mappingsFormatted}
      majors={allMajors.map(m => ({
        id: m.id,
        name: m.name,
        majorCode: m.majorCode,
        degreeLevelId: m.degreeLevelId,
      }))}
      degreeLevels={allLevels.map(l => ({
        id: l.id,
        title: l.title,
        code: l.code,
      }))}
      formulas={formulasFormatted}
      apiLogs={apiLogsFormatted}
    />
  );
}
