'use server';

import {
  listVirtualClassroomsAdminAction as listAdminVirtualClassrooms,
  syncVirtualClassStatusAction as syncVirtualClassStatus,
  syncBbbRecordingsAction as syncBbbRecordings,
} from '@/app/professor/virtual-classes/actions';

export async function listVirtualClassroomsAdminAction(termId?: number | null) {
  return listAdminVirtualClassrooms(termId);
}

export async function syncVirtualClassStatusAction(classroomId?: number | null) {
  return syncVirtualClassStatus(classroomId);
}

export async function syncBbbRecordingsAction(classroomId?: number | null) {
  return syncBbbRecordings(classroomId);
}
