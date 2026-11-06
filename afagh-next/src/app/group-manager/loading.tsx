import PageSkeleton from '@/components/PageSkeleton';

/**
 * حالت بارگذاریِ شاخهٔ /group-manager — پیش از این هیچ loading.tsxای در پروژه نبود
 * و ناوبریِ سمتی سرور بی‌واکنش می‌ماند.
 */
export default function Loading() {
  return <PageSkeleton />;
}
