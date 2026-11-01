import * as React from 'react';

import { cn } from '@/lib/utils';

// ═══ Skeleton — design-system base (shadcn/ui style, Afagh tokens) ═══

function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="skeleton" className={cn('bg-muted animate-pulse rounded-md', className)} {...props} />;
}

export { Skeleton };
