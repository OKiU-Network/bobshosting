/** Format MiB for display (1024-based GB labels). */
export function formatMebibytes(mb: number): string {
  if (!Number.isFinite(mb) || mb < 0) return '—'
  if (mb < 1024) return `${Math.round(mb)} MB`
  const gb = mb / 1024
  if (gb < 1024) return `${gb % 1 === 0 ? gb : gb.toFixed(1)} GB`
  return `${(gb / 1024).toFixed(1)} TB`
}

export function buildCpuPercentOptions(maxPercent: number): number[] {
  const cap = Math.max(10, Math.min(1000, Math.floor(maxPercent)))
  const candidates = [10, 25, 50, 75, 100, 150, 200, 250, 300, 400, 500, 600, 750, 1000]
  return candidates.filter(x => x <= cap)
}

/** Memory presets from 128 MiB up to maxMb (powers of two + common steps). */
export function buildMemoryMbOptions(maxMb: number): number[] {
  const cap = Math.max(128, Math.floor(maxMb))
  const out: number[] = []
  for (const m of [128, 256, 512]) {
    if (m <= cap) out.push(m)
  }
  let mb = 1024
  while (mb <= cap) {
    out.push(mb)
    mb *= 2
  }
  return [...new Set(out)].sort((a, b) => a - b)
}

/** Disk presets in MiB (min 1 GiB): powers of two + common 5/10/20/50/100 GB steps. */
export function buildDiskMbOptions(maxMb: number): number[] {
  const cap = Math.max(1024, Math.floor(maxMb))
  const out: number[] = []
  let mb = 1024
  while (mb <= cap) {
    out.push(mb)
    mb *= 2
  }
  for (const g of [5, 10, 20, 50, 100, 200, 500]) {
    const m = g * 1024
    if (m <= cap && m >= 1024) out.push(m)
  }
  return [...new Set(out)].sort((a, b) => a - b)
}

export function memoryOptionLabel(mb: number): string {
  if (mb < 1024) return `${mb} MB`
  const gb = mb / 1024
  return `${gb % 1 === 0 ? gb : gb.toFixed(1)} GB (${mb} MB)`
}

export function diskOptionLabel(mb: number): string {
  if (mb < 1024) return `${mb} MB`
  const gb = mb / 1024
  if (gb < 1024) return `${gb % 1 === 0 ? gb : gb.toFixed(1)} GB`
  return `${(gb / 1024).toFixed(1)} TB`
}

/** Largest option ≤ value, else smallest option */
export function pickNearestCapped(value: number, options: number[]): number {
  if (!options.length) return value
  if (options.includes(value)) return value
  const le = options.filter(o => o <= value)
  if (le.length) return le[le.length - 1]
  return options[0]
}
