import type { ReportVisibility, SavedReportConfig } from '../catalog';

/** ردیفِ گزارشِ ذخیره‌شده از دید کاربر (شامل اینکه خودِ صاحبش هست یا نه) */
export type SavedReportRow = {
  id: number;
  name: string;
  description: string | null;
  sourceKey: string;
  sourceTitle: string;
  sourceIcon: string;
  visibility: ReportVisibility;
  allowedRoles: string[];
  ownerUserId: number;
  ownerName: string;
  isOwner: boolean;
  createdAt: string;
  updatedAt: string;
  config: SavedReportConfig;
};

/** گزینه‌های پویای فیلترها */
export type CatalogOptions = {
  terms: { value: string; label: string }[];
  financialTerms: { value: string; label: string }[];
  depositTypes: { value: string; label: string }[];
  ledgerTypes: { value: string; label: string }[];
  paymentStatuses: { value: string; label: string }[];
  faculties: { value: string; label: string }[];
  majors: { value: string; label: string }[];
};
