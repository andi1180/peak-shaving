import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** shadcn/ui-Standardhelfer: bedingte Klassen + Tailwind-Merge (letzte Klasse gewinnt). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
