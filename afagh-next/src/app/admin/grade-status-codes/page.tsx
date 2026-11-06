import { requireRole } from '@/lib/auth';
import { db } from '@/db';
import {
  courses, departments, degree_level_configs, equivalence_clusters,
  curriculum_courses, curriculum_versions, majors,
} from '@/db/schema';
import { eq, asc, count, isNull, or } from 'drizzle-orm';
import { getCurrentUniversity } from '@/lib/university-scope';
import GradeCodesClient from './GradeCodesClient';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 100;

export default async function GradeStatusCodesPage() {
  await requireRole(['ADMIN', 'EDU_EXPERT', 'VICE_EDU']);

  const currentUniversity = await getCurrentUniversity();
  const currentUniversityId = currentUniversity?.id ?? null;
  const whereCond = currentUniversityId ? eq(courses.universityId, currentUniversityId) : undefined;
  const scopeOf = (c: any) => (currentUniversityId ? or(eq(c, currentUniversityId), isNull(c)) : undefined);

  const [{ total }] = await db.select({ total: count() }).from(courses).where(whereCond);

  const [bankCourses, departmentsList, degreeLevels, clusters, offeredCourses, majorsList] = await Promise.all([
    // بانک دروس
    db.select({
      id: courses.id,
      code: courses.code,
      title: courses.title,
      theoreticalUnits: courses.theoreticalUnits,
      practicalUnits: courses.practicalUnits,
      units: courses.units,
      courseType: courses.courseType,
      gradingType: courses.gradingType,
      affectsGpa: courses.affectsGpa,
      departmentId: courses.departmentId,
      departmentName: departments.name,
      degreeLevelId: courses.degreeLevelId,
      degreeLevelTitle: degree_level_configs.title,
      clusterId: courses.clusterId,
      clusterTitle: equivalence_clusters.clusterTitle,
      offeringScope: courses.offeringScope,
      locationType: courses.locationType,
      courseNature: courses.courseNature,
      englishName: courses.englishName,
      description: courses.description,
      weeklyTheoryHours: courses.weeklyTheoryHours,
      weeklyPracticalHours: courses.weeklyPracticalHours,
      isThesis: courses.isThesis,
      hasProject: courses.hasProject,
      internshipUnits: courses.internshipUnits,
      minPassedMark: courses.minPassedMark,
      defaultAcceptMarkState: courses.defaultAcceptMarkState,
      defaultRejectMarkState: courses.defaultRejectMarkState,
      courseIsActive: courses.courseIsActive,
      emergencyWithdrawal: courses.emergencyWithdrawal,
      coRequisites: courses.coRequisites,
      prereqText: courses.prereqText,
      facesHours: courses.facesHours,
      equivalentCourseCodes: courses.equivalentCourseCodes,
    })
      .from(courses)
      .leftJoin(departments, eq(courses.departmentId, departments.id))
      .leftJoin(degree_level_configs, eq(courses.degreeLevelId, degree_level_configs.id))
      .leftJoin(equivalence_clusters, eq(courses.clusterId, equivalence_clusters.id))
      .where(whereCond)
      .orderBy(asc(courses.code))
      .limit(PAGE_SIZE),
    // گروه‌ها
    db.select({ id: departments.id, name: departments.name }).from(departments)
      .where(scopeOf(departments.universityId)).orderBy(asc(departments.name)),
    // مقاطع
    db.select({ id: degree_level_configs.id, title: degree_level_configs.title }).from(degree_level_configs)
      .where(scopeOf(degree_level_configs.universityId)).orderBy(asc(degree_level_configs.id)),
    // خوشه‌ها
    db.select({ id: equivalence_clusters.id, clusterTitle: equivalence_clusters.clusterTitle }).from(equivalence_clusters)
      .where(scopeOf(equivalence_clusters.universityId)).orderBy(asc(equivalence_clusters.clusterTitle)),
    // دروس ارائه‌شده در نیمسال (سمت سرور)
    db.select({
      id: curriculum_courses.id,
      courseId: curriculum_courses.courseId,
      courseCode: courses.code,
      courseTitle: courses.title,
      units: curriculum_courses.units,
      roleType: curriculum_courses.roleType,
      recommendedSemester: curriculum_courses.recommendedSemester,
      minGrade: curriculum_courses.minGrade,
      passGradeStatusCode: curriculum_courses.passGradeStatusCode,
      failGradeStatusCode: curriculum_courses.failGradeStatusCode,
      isRequired: curriculum_courses.isRequired,
      isElective: curriculum_courses.isElective,
      versionId: curriculum_versions.id,
      versionCode: curriculum_versions.versionCode,
      versionTitle: curriculum_versions.title,
      status: curriculum_versions.status,
      majorId: majors.id,
      majorName: majors.name,
      degreeLevelId: degree_level_configs.id,
      degreeLevelTitle: degree_level_configs.title,
      entryYearFrom: curriculum_versions.entryYearFrom,
      entryYearTo: curriculum_versions.entryYearTo,
    })
      .from(curriculum_courses)
      .innerJoin(curriculum_versions, eq(curriculum_courses.curriculumVersionId, curriculum_versions.id))
      .innerJoin(courses, eq(curriculum_courses.courseId, courses.id))
      .innerJoin(majors, eq(curriculum_versions.majorId, majors.id))
      .leftJoin(degree_level_configs, eq(curriculum_versions.degreeLevelId, degree_level_configs.id))
      .where(whereCond)
      .orderBy(asc(majors.name), asc(curriculum_versions.versionCode), asc(curriculum_courses.recommendedSemester), asc(courses.code))
      .limit(PAGE_SIZE),
    // رشته‌ها
    db.select({ id: majors.id, name: majors.name }).from(majors)
      .where(scopeOf(majors.universityId)).orderBy(asc(majors.name)),
  ]);

  return (
    <GradeCodesClient
      initialBankCourses={bankCourses}
      initialTotal={total}
      initialDepartments={departmentsList}
      initialDegreeLevels={degreeLevels}
      initialClusters={clusters}
      initialOfferedCourses={offeredCourses}
      initialMajors={majorsList}
    />
  );
}
