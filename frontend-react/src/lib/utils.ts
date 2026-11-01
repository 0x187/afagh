import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Conditional class merging + Tailwind conflict resolution — shadcn/ui standard */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
