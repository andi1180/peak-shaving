'use client'

import * as React from 'react'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import {
  AXIS_HOURS,
  BANDS,
  BAR_W,
  CAP_Y,
  FINAL_FRAME_T,
  GRID_FRACTIONS,
  HERO_SHOW_SAVING_FIGURE,
  LOAD,
  LOOP_DURATION,
  SLOT,
  START_DELAY_MS,
  VIEW_H,
  VIEW_W,
  X0,
  X1,
  YB,
  YT,
  frameAt,
  yOf,
  type PeakTagKind,
} from '@/lib/hero-animation'

/*
 * Hero-Animation der Startseite (Leadgen-Umbau Schritt 2) nach dem freigegebenen Prototyp
 * `docs/prototypes/hero-animation-prototyp.html`. Die Zeitlogik ist rein (`lib/hero-animation.ts`),
 * hier wird nur gezeichnet. Erstes Bild ist das Schlussbild — so ist die Karte auch ohne JS und bei
 * reduzierter Bewegung vollständig.
 *
 * Abweichung vom Prototyp: `role="img"` + Beschreibung sitzen am Diagramm-SVG statt an der ganzen
 * Karte — Kinder eines `role="img"` sind für Screenreader unsichtbar, der Pause-Knopf wäre sonst
 * nicht erreichbar.
 */

const LABEL = 'text-[11px] font-semibold uppercase tracking-[0.08em] text-text-faint'

const TAG_TEXT: Record<PeakTagKind, 'tagPeak' | 'tagTakeover' | 'tagStorage'> = {
  peak: 'tagPeak',
  takeover: 'tagTakeover',
  storage: 'tagStorage',
}

const CAPTIONS = [
  'caption0',
  'caption1',
  'caption2',
  'caption3',
  'caption4',
  'caption5',
  'caption6',
] as const

function Arrow({ up, on }: { up: boolean; on: boolean }) {
  return (
    <div
      className={cn(
        'absolute inset-0 grid w-[68px] place-items-center opacity-0 transition-opacity duration-300 motion-reduce:transition-none',
        on && 'opacity-100',
      )}
    >
      <svg viewBox="0 0 18 18" fill="none" className="h-[18px] w-[18px]">
        <path
          d={up ? 'M9 15V5M5 9l4-4 4 4' : 'M9 3v10M5 9l4 4 4-4'}
          stroke="var(--color-on-accent)"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  )
}

export function HeroAnimation() {
  const t = useTranslations('Home.HeroAnimation')
  const [time, setTime] = React.useState(FINAL_FRAME_T)
  const [animated, setAnimated] = React.useState(false)
  const [playing, setPlaying] = React.useState(true)
  const playingRef = React.useRef(true)
  const chartRef = React.useRef<SVGSVGElement>(null)

  React.useEffect(() => {
    // prefers-reduced-motion: Schlussbild bleibt stehen, kein Pause-Knopf, keine Bewegung.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    setAnimated(true)

    let visible = true
    let raf = 0
    let last: number | null = null
    let loopTime = 0
    const frame = (now: number) => {
      if (last === null) last = now
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      if (playingRef.current && visible && !document.hidden) {
        loopTime = (loopTime + dt) % LOOP_DURATION
        setTime(loopTime)
      }
      raf = requestAnimationFrame(frame)
    }
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => (visible = e.isIntersecting)),
      { threshold: 0.2 },
    )
    if (chartRef.current) io.observe(chartRef.current)
    const timer = window.setTimeout(() => {
      raf = requestAnimationFrame(frame)
    }, START_DELAY_MS)
    return () => {
      window.clearTimeout(timer)
      cancelAnimationFrame(raf)
      io.disconnect()
    }
  }, [])

  const toggle = () => {
    playingRef.current = !playingRef.current
    setPlaying(playingRef.current)
  }

  const f = frameAt(time)
  const { battery } = f
  const batteryLabel =
    battery.mode === 'in'
      ? t('batteryIn')
      : battery.mode === 'out'
        ? t('batteryOut')
        : battery.dayOver
          ? t('batteryReady')
          : t('batteryWait')
  const saving = Math.round(f.savingPercent)

  let tag: React.ReactNode = null
  if (f.tag) {
    const text = t(TAG_TEXT[f.tag.kind])
    const cx = X0 + f.tag.hour * SLOT + SLOT / 2
    const w = text.length * 6.6 + 18
    const y = yOf(LOAD[f.tag.hour]!) - 34
    tag = (
      <g opacity={f.tag.opacity.toFixed(3)}>
        <rect
          x={(cx - w / 2).toFixed(1)}
          y={y.toFixed(1)}
          width={w.toFixed(1)}
          height="24"
          rx="6"
          fill="var(--color-surface)"
          stroke="var(--color-border)"
        />
        <text
          x={cx.toFixed(1)}
          y={(y + 16).toFixed(1)}
          fontSize="12"
          fontWeight="600"
          textAnchor="middle"
          fill={f.tag.kind === 'peak' ? 'var(--color-negative)' : 'var(--color-accent)'}
        >
          {text}
        </text>
      </g>
    )
  }

  return (
    <figure className="m-0 grid min-w-0 gap-[14px] rounded-[16px] border border-line bg-surface px-[22px] pb-4 pt-5 shadow-[0_1px_2px_rgba(23,23,23,0.04),0_18px_40px_-24px_rgba(23,23,23,0.22)] max-[560px]:px-[14px] max-[560px]:pb-[14px] max-[560px]:pt-4">
      <div className="flex items-center justify-between gap-4" aria-hidden="true">
        <div className="grid gap-[2px]">
          <span className={LABEL}>{t('timeLabel')}</span>
          <span className="text-[26px] font-bold leading-[1.1] tracking-[-0.01em] text-ink tabular-nums max-[560px]:text-[22px]">
            {f.clock}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <div className="grid gap-[2px] text-right">
            <span className={LABEL}>{t('batteryName')}</span>
            <span
              className={cn(
                'text-[14px] font-semibold text-text-muted transition-colors duration-300 motion-reduce:transition-none',
                battery.mode !== 'wait' && 'text-accent',
              )}
            >
              {batteryLabel}
            </span>
          </div>
          <div className="relative h-9 w-[74px] flex-none">
            <div className="absolute left-0 top-0 h-9 w-[68px] rounded-[9px] border-[2.5px] border-ink p-[3px]">
              <div
                className="h-full rounded-[5px] bg-accent"
                style={{ width: `${(battery.level * 100).toFixed(1)}%` }}
              />
            </div>
            <div className="absolute right-0 top-[11px] h-[14px] w-[5px] rounded-r-[3px] bg-ink" />
            <Arrow up={false} on={battery.mode === 'in'} />
            <Arrow up on={battery.mode === 'out'} />
          </div>
        </div>
      </div>

      <svg
        ref={chartRef}
        className="block h-auto w-full overflow-visible"
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        role="img"
        aria-label={t('ariaLabel')}
      >
        <g>
          {BANDS.map(([a, b]) => (
            <React.Fragment key={a}>
              <rect
                x={X0 + a * SLOT}
                width={(b - a) * SLOT}
                y={YT - 4}
                height={YB - YT + 4}
                fill="var(--color-accent-subtle)"
              />
              <text
                x={X0 + ((a + b) / 2) * SLOT}
                y={YT + 12}
                textAnchor="middle"
                fontSize="11"
                fontWeight="600"
                fill="var(--color-accent)"
              >
                {t('bandLabel')}
              </text>
            </React.Fragment>
          ))}
        </g>
        <g>
          {GRID_FRACTIONS.map((g) => {
            const y = YB - g * (YB - YT)
            return (
              <line
                key={g}
                x1={X0}
                x2={X1}
                y1={y}
                y2={y}
                stroke="var(--color-border)"
                strokeWidth="1"
              />
            )
          })}
          <line x1={X0} x2={X1} y1={YB} y2={YB} stroke="var(--color-text-faint)" strokeWidth="1" />
        </g>
        <g>
          {f.bars.map((bar, h) => {
            const x = (X0 + h * SLOT + (SLOT - BAR_W) / 2).toFixed(1)
            const w = BAR_W.toFixed(1)
            const span = YB - YT
            return (
              <React.Fragment key={h}>
                <rect
                  x={x}
                  width={w}
                  rx="2.5"
                  fill="var(--color-border-strong)"
                  y={yOf(bar.grid).toFixed(1)}
                  height={(YB - yOf(bar.grid)).toFixed(1)}
                />
                <rect
                  x={x}
                  width={w}
                  rx="2.5"
                  fill="var(--color-negative)"
                  y={yOf(bar.grid + bar.top).toFixed(1)}
                  height={(bar.top * span).toFixed(1)}
                />
                <rect
                  x={x}
                  width={w}
                  rx="2.5"
                  fill="var(--color-accent)"
                  y={yOf(bar.grid + bar.storage).toFixed(1)}
                  height={(bar.storage * span).toFixed(1)}
                />
              </React.Fragment>
            )
          })}
        </g>
        <line
          x1={X0}
          x2={X1}
          y1={CAP_Y}
          y2={CAP_Y}
          stroke="var(--color-navy)"
          strokeWidth="1.5"
          strokeDasharray="6 5"
        />
        <text
          x={X1}
          y={CAP_Y - 7}
          textAnchor="end"
          fontSize="12"
          fontWeight="600"
          fill="var(--color-navy)"
        >
          {t('capLabel')}
        </text>
        {tag}
        <line
          x1={f.playheadX.toFixed(1)}
          x2={f.playheadX.toFixed(1)}
          y1={YT}
          y2={YB}
          stroke="var(--color-ink)"
          strokeOpacity="0.25"
          strokeWidth="1"
          opacity={f.playheadVisible ? 1 : 0}
        />
        <g fontSize="11" fill="var(--color-text-faint)" textAnchor="middle">
          {AXIS_HOURS.map((h) => (
            <text key={h} x={X0 + h * SLOT} y={YB + 22}>
              {`${String(h).padStart(2, '0')}:00`}
            </text>
          ))}
        </g>
      </svg>

      <div
        className="flex flex-wrap gap-x-[18px] gap-y-[6px] text-[12.5px] text-text-muted"
        aria-hidden="true"
      >
        <LegendItem swatch="bg-line-strong">{t('legendGrid')}</LegendItem>
        <LegendItem swatch="bg-negative">{t('legendPeak')}</LegendItem>
        <LegendItem swatch="bg-accent">{t('legendStorage')}</LegendItem>
        <LegendItem swatch="border border-accent-border bg-accent-subtle">
          {t('legendBand')}
        </LegendItem>
      </div>

      <div className="relative min-h-[3em]" aria-hidden="true">
        {CAPTIONS.map((key, i) => (
          <p
            key={key}
            className={cn(
              'absolute inset-x-0 top-0 m-0 text-balance text-[17px] font-semibold leading-[1.45] text-ink',
              'translate-y-[6px] opacity-0 transition-[opacity,transform] duration-[500ms,600ms] ease-[ease,cubic-bezier(.2,.7,.2,1)] motion-reduce:transition-none',
              'max-[560px]:text-[15.5px]',
              i === f.captionIndex && 'translate-y-0 opacity-100',
              i === CAPTIONS.length - 1 && 'text-[19px] text-navy max-[560px]:text-[17px]',
            )}
          >
            {t(key)}
          </p>
        ))}
      </div>

      <div className="grid gap-2 border-t border-line pt-3" aria-hidden="true">
        <p className={cn(LABEL, 'm-0')}>{t('costsTitle')}</p>
        <CostRow label={t('costToday')} fillClass="bg-text-faint" width="100%">
          {HERO_SHOW_SAVING_FIGURE && (
            <span className="whitespace-nowrap text-right text-[13px] font-semibold text-text-muted tabular-nums">
              {t('costTodayValue')}
            </span>
          )}
        </CostRow>
        <CostRow
          label={t('costWithStorage')}
          fillClass="bg-accent"
          width={`${(100 - f.savingPercent).toFixed(2)}%`}
        >
          {HERO_SHOW_SAVING_FIGURE && (
            <span className="grid justify-items-end whitespace-nowrap text-right font-semibold leading-[1.05] text-text-muted tabular-nums">
              <span
                className={cn(
                  'h-0 -translate-y-[14px] overflow-visible text-[11px] font-semibold text-text-muted opacity-0 transition-opacity duration-[400ms] motion-reduce:transition-none',
                  f.savingPrefixVisible && 'opacity-100',
                )}
              >
                {t('savingPrefix')}
              </span>
              <span className="text-[20px] font-bold text-accent tabular-nums">
                {saving > 0 ? t('savingValue', { value: saving }) : t('savingZero')}
              </span>
            </span>
          )}
        </CostRow>
      </div>

      <figcaption className="flex items-center justify-between gap-3 text-[11.5px] text-text-faint">
        <span>{t('footnote')}</span>
        <button
          type="button"
          hidden={!animated}
          aria-pressed={!playing}
          onClick={toggle}
          className="cursor-pointer appearance-none rounded-full border border-line bg-surface px-[11px] py-[6px] text-[12px] font-medium leading-none text-text-muted hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-navy"
        >
          {playing ? t('pause') : t('play')}
        </button>
      </figcaption>
    </figure>
  )
}

function LegendItem({ swatch, children }: { swatch: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-[7px]">
      <i className={cn('inline-block h-[11px] w-[11px] rounded-[3px]', swatch)} />
      {children}
    </span>
  )
}

function CostRow({
  label,
  fillClass,
  width,
  children,
}: {
  label: string
  fillClass: string
  width: string
  children: React.ReactNode
}) {
  return (
    <div className="grid grid-cols-[6.8em_minmax(0,1fr)_4.6em] items-center gap-3 text-[13px] text-text-muted max-[560px]:grid-cols-[6.2em_minmax(0,1fr)_4.4em] max-[560px]:text-[12.5px]">
      <span>{label}</span>
      <div className="h-[10px] overflow-hidden rounded-[5px] bg-surface-alt">
        <div className={cn('h-full rounded-[5px]', fillClass)} style={{ width }} />
      </div>
      {children}
    </div>
  )
}
