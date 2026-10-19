import { describe, expect, it, vi } from 'vitest'

import {
  checkSelection,
  runMultiDirectUpload,
  type MultiUploadItem,
  type MultiUploadLimits,
  type MultiUploadPorts,
} from './multi-direct-upload'

const LIMITS: MultiUploadLimits = {
  accept: ['application/pdf'],
  maxFiles: 5,
  maxBytesPerFile: 1000,
}

function pdf(name: string, size = 100): File {
  return new File([new Uint8Array(size)], name, { type: 'application/pdf' })
}

function ports(overrides: Partial<MultiUploadPorts> = {}): MultiUploadPorts {
  return {
    request: vi.fn(async (file: File) => ({
      ok: true as const,
      documentId: `id-${file.name}`,
      uploadUrl: `https://storage.test/${file.name}`,
    })),
    register: vi.fn(async () => ({ ok: true as const })),
    discard: vi.fn(async () => undefined),
    fetch: vi.fn(async () => new Response(null, { status: 200 })) as unknown as typeof fetch,
    ...overrides,
  }
}

describe('runMultiDirectUpload', () => {
  it('führt jede Datei von „wartet" über „lädt" nach „abgelegt"', async () => {
    const seen: MultiUploadItem['status'][][] = []
    const done = await runMultiDirectUpload(
      [pdf('a.pdf'), pdf('b.pdf')],
      LIMITS,
      ports(),
      (items) => seen.push(items.map((item) => item.status)),
    )

    expect(seen[0]).toEqual(['waiting', 'waiting'])
    expect(seen.some((s) => s.includes('uploading'))).toBe(true)
    expect(done.map((item) => [item.status, item.documentId])).toEqual([
      ['stored', 'id-a.pdf'],
      ['stored', 'id-b.pdf'],
    ])
  })

  it('lehnt falschen Typ und zu grosse Datei vorab ab, ohne sie anzufordern', async () => {
    const p = ports()
    const foto = new File([new Uint8Array(10)], 'foto.png', { type: 'image/png' })

    const done = await runMultiDirectUpload(
      [foto, pdf('gross.pdf', 1001), pdf('ok.pdf')],
      LIMITS,
      p,
      () => {},
    )

    expect(done.map((item) => item.status)).toEqual(['failed', 'failed', 'stored'])
    expect(done[0]!.error).toContain('Dateityp')
    expect(done[1]!.error).toContain('Zu gross')
    expect(p.request).toHaveBeenCalledTimes(1)
  })

  it('lädt höchstens drei Dateien gleichzeitig hoch', async () => {
    let active = 0
    let peak = 0
    const p = ports({
      fetch: vi.fn(async () => {
        active++
        peak = Math.max(peak, active)
        await new Promise((resolve) => setTimeout(resolve, 5))
        active--
        return new Response(null, { status: 200 })
      }) as unknown as typeof fetch,
    })
    const files = Array.from({ length: 5 }, (_, i) => pdf(`r${i}.pdf`))

    const done = await runMultiDirectUpload(files, LIMITS, p, () => {})

    expect(peak).toBe(3)
    expect(done.every((item) => item.status === 'stored')).toBe(true)
  })

  it('räumt nach gescheiterter Übertragung ab und meldet die Datei als fehlgeschlagen', async () => {
    const p = ports({
      fetch: vi.fn(async () => new Response(null, { status: 500 })) as unknown as typeof fetch,
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const [item] = await runMultiDirectUpload([pdf('a.pdf')], LIMITS, p, () => {})

    expect(item!.status).toBe('failed')
    expect(p.discard).toHaveBeenCalledWith('id-a.pdf')
    expect(p.register).not.toHaveBeenCalled()
  })
})

describe('checkSelection', () => {
  it('weist eine leere oder zu grosse Auswahl als Ganzes ab', () => {
    expect(checkSelection([], LIMITS)).toContain('mindestens eine')
    expect(
      checkSelection(
        Array.from({ length: 6 }, (_, i) => pdf(`${i}.pdf`)),
        LIMITS,
      ),
    ).toContain('Höchstens 5')
    expect(checkSelection([pdf('a.pdf')], LIMITS)).toBeNull()
  })
})
