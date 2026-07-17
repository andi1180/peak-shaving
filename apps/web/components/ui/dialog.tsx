'use client'

import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { cn } from '@/lib/utils'

/*
 * Zentriertes Modal (Radix Dialog), shadcn-Muster, an unsere Tokens gebunden.
 * Schwester von `sheet.tsx` (dieselbe Radix-Primitive, seitliche Schublade statt
 * zentriertem Fenster) — beide teilen sich Fokus-Falle/Escape/Scroll-Lock aus
 * Radix, nur Platzierung und Ein-/Ausblendrichtung unterscheiden sich.
 *
 * KEIN eingebauter Schließen-Button: Dieses Primitiv ist bewusst „nackt". Ob
 * ein Dialog überhaupt schließbar ist, entscheidet der Aufrufer über
 * `onEscapeKeyDown`/`onPointerDownOutside` auf `DialogContent` — das
 * Kalkulator-Gate (Prompt 26) hält seins z. B. absichtlich offen, bis ein
 * gültiger Zugangscode eingegeben ist.
 */

const Dialog = DialogPrimitive.Root
const DialogTrigger = DialogPrimitive.Trigger
const DialogPortal = DialogPrimitive.Portal

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      // Abdunkeln über eine Tailwind-eigene Palette-Farbe: /alpha ist NUR dort
      // erlaubt, nicht auf unseren var()-Tokens (DESIGN.md) — gleiche Technik
      // wie sheet.tsx.
      'fixed inset-0 z-50 bg-black/40',
      'data-[state=open]:animate-in data-[state=open]:fade-in',
      'data-[state=closed]:animate-out data-[state=closed]:fade-out',
      className,
    )}
    {...props}
  />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        'fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2',
        'rounded-lg border border-line bg-surface p-6',
        'data-[state=open]:animate-in data-[state=open]:fade-in data-[state=open]:zoom-in-95',
        'data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=closed]:zoom-out-95',
        'duration-200',
        'outline-none',
        className,
      )}
      {...props}
    >
      {children}
    </DialogPrimitive.Content>
  </DialogPortal>
))
DialogContent.displayName = DialogPrimitive.Content.displayName

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title ref={ref} className={cn('text-h3 text-ink', className)} {...props} />
))
DialogTitle.displayName = DialogPrimitive.Title.displayName

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('mt-3 text-body text-text-muted', className)}
    {...props}
  />
))
DialogDescription.displayName = DialogPrimitive.Description.displayName

export {
  Dialog,
  DialogTrigger,
  DialogPortal,
  DialogOverlay,
  DialogContent,
  DialogTitle,
  DialogDescription,
}
