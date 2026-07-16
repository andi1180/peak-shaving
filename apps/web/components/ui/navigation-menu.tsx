'use client'

import * as React from 'react'
import * as NavigationMenuPrimitive from '@radix-ui/react-navigation-menu'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

/*
 * shadcn/ui-NavigationMenu (Radix), an unsere Tokens gebunden.
 *
 * Warum hier eine Dependency gerechtfertigt ist: ein barrierefreies Mega-Menü
 * von Hand ist fehleranfällig (Roving-Tabindex, aria-expanded/-controls,
 * Escape, Fokus-Rückgabe, Pointer-vs-Tastatur). Radix liefert das geprüft —
 * genau die Klasse von Problem, für die shadcn/Radix im Pflichtenheft (§7.6)
 * vorgesehen ist.
 *
 * Bewegung: die Auf-/Zu-Animation ist dezent und wird von der globalen
 * `prefers-reduced-motion`-Regel (globals.css) automatisch stillgelegt.
 */

const NavigationMenu = React.forwardRef<
  React.ElementRef<typeof NavigationMenuPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof NavigationMenuPrimitive.Root>
>(({ className, children, ...props }, ref) => (
  <NavigationMenuPrimitive.Root
    ref={ref}
    className={cn('relative z-40 flex flex-1 items-center', className)}
    {...props}
  >
    {children}
    <NavigationMenuViewport />
  </NavigationMenuPrimitive.Root>
))
NavigationMenu.displayName = NavigationMenuPrimitive.Root.displayName

const NavigationMenuList = React.forwardRef<
  React.ElementRef<typeof NavigationMenuPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof NavigationMenuPrimitive.List>
>(({ className, ...props }, ref) => (
  <NavigationMenuPrimitive.List
    ref={ref}
    className={cn('flex list-none items-center gap-1', className)}
    {...props}
  />
))
NavigationMenuList.displayName = NavigationMenuPrimitive.List.displayName

const NavigationMenuItem = NavigationMenuPrimitive.Item

/** Gemeinsamer Stil für Trigger und direkte Links — damit die Zeile ruhig bleibt. */
const navItemStyle = cn(
  'inline-flex items-center gap-1 rounded-md px-3 py-2 text-small font-medium',
  'text-ink transition-colors hover:bg-surface-sunken',
  'outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
  'focus-visible:ring-offset-surface',
  'data-[state=open]:bg-surface-sunken',
)

const NavigationMenuTrigger = React.forwardRef<
  React.ElementRef<typeof NavigationMenuPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof NavigationMenuPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <NavigationMenuPrimitive.Trigger ref={ref} className={cn(navItemStyle, className)} {...props}>
    {children}
    <ChevronDown
      className="h-3.5 w-3.5 text-text-muted transition-transform duration-200 group-data-[state=open]:rotate-180"
      aria-hidden="true"
    />
  </NavigationMenuPrimitive.Trigger>
))
NavigationMenuTrigger.displayName = NavigationMenuPrimitive.Trigger.displayName

const NavigationMenuContent = React.forwardRef<
  React.ElementRef<typeof NavigationMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof NavigationMenuPrimitive.Content>
>(({ className, ...props }, ref) => (
  <NavigationMenuPrimitive.Content
    ref={ref}
    className={cn(
      'left-0 top-0 w-full data-[motion^=from-]:animate-in data-[motion^=to-]:animate-out',
      'data-[motion^=from-]:fade-in data-[motion^=to-]:fade-out',
      'md:absolute md:w-auto',
      className,
    )}
    {...props}
  />
))
NavigationMenuContent.displayName = NavigationMenuPrimitive.Content.displayName

const NavigationMenuLink = NavigationMenuPrimitive.Link

/** Die Fläche, in der der Inhalt erscheint. Dünner Rand, kein Schlagschatten. */
const NavigationMenuViewport = React.forwardRef<
  React.ElementRef<typeof NavigationMenuPrimitive.Viewport>,
  React.ComponentPropsWithoutRef<typeof NavigationMenuPrimitive.Viewport>
>(({ className, ...props }, ref) => (
  <div className="absolute left-0 top-full flex justify-start">
    <NavigationMenuPrimitive.Viewport
      ref={ref}
      className={cn(
        'relative mt-2 h-[var(--radix-navigation-menu-viewport-height)] w-full overflow-hidden',
        'rounded-lg border border-line bg-surface',
        'origin-top-center transition-[width,height] duration-200',
        'data-[state=open]:animate-in data-[state=closed]:animate-out',
        'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
        'md:w-[var(--radix-navigation-menu-viewport-width)]',
        className,
      )}
      {...props}
    />
  </div>
))
NavigationMenuViewport.displayName = NavigationMenuPrimitive.Viewport.displayName

export {
  NavigationMenu,
  NavigationMenuList,
  NavigationMenuItem,
  NavigationMenuTrigger,
  NavigationMenuContent,
  NavigationMenuLink,
  navItemStyle,
}
