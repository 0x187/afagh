import PageSkeleton from '@/components/PageSkeleton';

/**
 * حالت بارگذاریِ شاخهٔ /professor — پیش از این هیچ loading.tsxای در پروژه نبود
 * و ناوبریِ سمتی سرور بی‌واکنش می‌ماند.
 */
export default function Loading() {
  return <PageSkeleton />;
}
