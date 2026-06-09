import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import { Download, FileArchive, Loader2, SlidersHorizontal, Upload } from 'lucide-react'
import { GlbPreview } from '../components/optimizer/GlbPreview'

type TextureFormat = 'keep' | 'jpeg' | 'png' | 'webp' | 'avif'
type ResizeValue = 'none' | '4096' | '2048' | '1536' | '1024' | '768' | '512' | '256'

type OptimizerSettings = {
  textureFormat: TextureFormat
  resize: ResizeValue
  textureQuality: number
  textureEffort: number
  lossless: boolean
  nearLossless: boolean
  smoothResize: boolean
  dedup: boolean
  gpuInstance: boolean
  prune: boolean
  flatten: boolean
  join: boolean
  resample: boolean
  weld: boolean
  weldTolerance: number
  weldToleranceNormal: number
  simplify: boolean
  simplifyRatio: number
  simplifyError: number
  simplifyLockBorder: boolean
  reorder: boolean
  quantize: boolean
  quantizePosition: number
  quantizeNormal: number
  quantizeTexcoord: number
  meshopt: boolean
  meshoptLevel: 'medium' | 'high'
  sparse: boolean
  sparseRatio: number
}

type OptimizerResult = {
  inputBytes: number
  outputBytes: number
  reductionPercent: number
  durationMs: number
  warnings?: string[]
}

const DEFAULT_SETTINGS: OptimizerSettings = {
  textureFormat: 'webp',
  resize: '1024',
  textureQuality: 92,
  textureEffort: 80,
  lossless: false,
  nearLossless: false,
  smoothResize: true,
  dedup: true,
  gpuInstance: false,
  prune: true,
  flatten: true,
  join: true,
  resample: true,
  weld: true,
  weldTolerance: 0.001,
  weldToleranceNormal: 0.25,
  simplify: false,
  simplifyRatio: 0.75,
  simplifyError: 0.0001,
  simplifyLockBorder: false,
  reorder: false,
  quantize: false,
  quantizePosition: 14,
  quantizeNormal: 12,
  quantizeTexcoord: 12,
  meshopt: false,
  meshoptLevel: 'high',
  sparse: true,
  sparseRatio: 0.333333,
}

const PRESETS: Array<{
  id: string
  label: string
  note: string
  settings: OptimizerSettings
}> = [
  {
    id: 'smooth-texture',
    label: 'Smooth Texture',
    note: 'Higher quality WebP with soft resizing. Good first pass for dark texture patches.',
    settings: {
      ...DEFAULT_SETTINGS,
      resize: '2048',
      textureQuality: 96,
      textureEffort: 90,
      nearLossless: true,
      quantize: false,
      meshopt: false,
      simplify: false,
    },
  },
  {
    id: 'site-default',
    label: 'Site Default',
    note: 'Close to the original script, with explicit quality controls.',
    settings: DEFAULT_SETTINGS,
  },
  {
    id: 'small-web',
    label: 'Small Web',
    note: 'Aggressive texture and geometry reduction for size checks.',
    settings: {
      ...DEFAULT_SETTINGS,
      resize: '1024',
      textureQuality: 84,
      textureEffort: 80,
      simplify: true,
      simplifyRatio: 0.68,
      quantize: true,
      meshopt: true,
      reorder: true,
    },
  },
  {
    id: 'geometry-only',
    label: 'Geometry Only',
    note: 'Keeps textures original while testing mesh simplification and compression.',
    settings: {
      ...DEFAULT_SETTINGS,
      textureFormat: 'keep',
      resize: 'none',
      simplify: true,
      simplifyRatio: 0.72,
      quantize: true,
      meshopt: true,
      reorder: true,
    },
  },
]

function formatBytes(bytes: number) {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 2)} ${units[index]}`
}

function getOutputName(file?: File) {
  const baseName = file?.name.replace(/\.glb$/i, '') || 'model'
  return `${baseName}-optimized.glb`
}

function SectionHeader({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-4 border-b border-line pb-3">
      <div>
        <h2 className="font-mono text-[13px] uppercase tracking-[0.18em] text-ink">{title}</h2>
        <p className="mt-1 text-[14px] leading-6 text-muted-foreground">{detail}</p>
      </div>
    </div>
  )
}

function ToggleRow({
  label,
  detail,
  checked,
  onChange,
}: {
  label: string
  detail: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="grid cursor-pointer grid-cols-[1fr_auto] gap-3 border-b border-line2 py-3">
      <span>
        <span className="block text-[15px] leading-5 text-ink">{label}</span>
        <span className="block text-[13px] leading-5 text-muted-foreground">{detail}</span>
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-1 size-4 accent-green"
      />
    </label>
  )
}

function RangeControl({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  suffix?: string
  onChange: (value: number) => void
}) {
  return (
    <label className="block py-2">
      <span className="mb-2 flex items-center justify-between gap-3 font-mono text-[12px] uppercase tracking-[0.12em] text-muted-foreground">
        <span>{label}</span>
        <span className="text-ink">{value}{suffix}</span>
      </span>
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-1.5 w-full accent-green"
      />
    </label>
  )
}

export function GlbOptimizerPage() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)
  const [file, setFile] = useState<File>()
  const [originalUrl, setOriginalUrl] = useState<string>()
  const [outputUrl, setOutputUrl] = useState<string>()
  const [result, setResult] = useState<OptimizerResult>()
  const [error, setError] = useState<string>()
  const [isOptimizing, setIsOptimizing] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(true)
  const [wireframe, setWireframe] = useState(false)
  const [exposure, setExposure] = useState(1.08)

  const activePreset = useMemo(() => {
    return PRESETS.find((preset) => JSON.stringify(preset.settings) === JSON.stringify(settings))?.id
  }, [settings])

  useEffect(() => {
    return () => {
      if (originalUrl) URL.revokeObjectURL(originalUrl)
    }
  }, [originalUrl])

  useEffect(() => {
    return () => {
      if (outputUrl) URL.revokeObjectURL(outputUrl)
    }
  }, [outputUrl])

  const updateSettings = (partial: Partial<OptimizerSettings>) => {
    setSettings((current) => ({ ...current, ...partial }))
  }

  const acceptFile = (nextFile?: File) => {
    if (!nextFile) return
    if (!nextFile.name.toLowerCase().endsWith('.glb')) {
      setError('Please upload a binary .glb file.')
      return
    }

    setError(undefined)
    setResult(undefined)
    setFile(nextFile)
    setOriginalUrl((current) => {
      if (current) URL.revokeObjectURL(current)
      return URL.createObjectURL(nextFile)
    })
    setOutputUrl((current) => {
      if (current) URL.revokeObjectURL(current)
      return undefined
    })
  }

  const handleDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault()
    acceptFile(event.dataTransfer.files.item(0) ?? undefined)
  }

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    acceptFile(event.target.files?.item(0) ?? undefined)
  }

  const optimize = async () => {
    if (!file) {
      setError('Upload a GLB before running the optimizer.')
      return
    }

    setIsOptimizing(true)
    setError(undefined)
    setResult(undefined)

    try {
      const response = await fetch(`/api/glb-optimize?settings=${encodeURIComponent(JSON.stringify(settings))}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'model/gltf-binary',
          'X-File-Name': file.name,
        },
        body: file,
      })

      if (!response.ok) {
        const payload = await response.json().catch(() => undefined)
        throw new Error(payload?.error ?? 'Optimizer request failed.')
      }

      const blob = await response.blob()
      const resultHeader = response.headers.get('X-GLB-Optimizer-Result')
      if (resultHeader) {
        setResult(JSON.parse(decodeURIComponent(resultHeader)))
      } else {
        setResult({
          inputBytes: file.size,
          outputBytes: blob.size,
          reductionPercent: Number(((1 - blob.size / file.size) * 100).toFixed(2)),
          durationMs: 0,
        })
      }

      setOutputUrl((current) => {
        if (current) URL.revokeObjectURL(current)
        return URL.createObjectURL(blob)
      })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Optimizer failed.')
    } finally {
      setIsOptimizing(false)
    }
  }

  return (
    <main className="min-h-screen bg-bg text-ink">
      <div className="border-b border-line bg-[linear-gradient(180deg,#0d100e_0%,#08090a_100%)]">
        <div className="mx-auto flex max-w-[1440px] items-center gap-4 px-6 py-4 max-sm:px-4">
          <a href="/" className="font-mono text-[13px] text-muted-foreground hover:text-ink">
            <span className="text-green">glb</span>-optimizer <span className="text-faint">~/workbench</span>
          </a>
          <div className="ml-auto hidden font-mono text-[12px] uppercase tracking-[0.16em] text-muted-foreground sm:block">
            local node optimizer
          </div>
        </div>
      </div>

      <section className="mx-auto grid max-w-[1440px] gap-6 px-6 py-6 max-sm:px-4 xl:grid-cols-[420px_1fr]">
        <aside className="space-y-6 xl:sticky xl:top-5 xl:max-h-[calc(100vh-40px)] xl:overflow-y-auto xl:pr-2">
          <div>
            <p className="font-mono text-[12px] uppercase tracking-[0.18em] text-green">asset lab</p>
            <h1 className="mt-2 max-w-[10ch] text-[46px] font-semibold leading-[0.96] tracking-[-0.02em] max-sm:text-[34px]">
              GLB Optimizer
            </h1>
            <p className="mt-4 text-[16px] leading-7 text-muted-foreground">
              Upload any binary GLB, tune compression settings, compare the output, then download the version that keeps the texture smooth enough.
            </p>
          </div>

          <label
            onDragOver={(event) => event.preventDefault()}
            onDrop={handleDrop}
            className="block cursor-pointer border border-dashed border-green-dim bg-[#0b100d] p-5 transition-colors hover:border-green"
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".glb,model/gltf-binary"
              onChange={handleFileChange}
              className="hidden"
            />
            <div className="flex items-center gap-4">
              <span className="grid size-11 place-items-center border border-line bg-bg2 text-green">
                <Upload className="size-5" />
              </span>
              <span>
                <span className="block text-[15px] text-ink">{file ? file.name : 'Upload or drop a .glb'}</span>
                <span className="font-mono text-[12px] uppercase tracking-[0.12em] text-muted-foreground">
                  {file ? formatBytes(file.size) : 'raw binary body, max 250 MB'}
                </span>
              </span>
            </div>
          </label>

          <div className="border border-line bg-bg2/55 p-4">
            <SectionHeader
              title="Presets"
              detail="Start with texture quality first, then reduce geometry once the surface looks right."
            />
            <div className="grid gap-2">
              {PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => setSettings(preset.settings)}
                  className={`border p-3 text-left transition-colors ${
                    activePreset === preset.id
                      ? 'border-green bg-green/10'
                      : 'border-line2 bg-bg hover:border-line'
                  }`}
                >
                  <span className="block font-mono text-[12px] uppercase tracking-[0.16em] text-ink">{preset.label}</span>
                  <span className="mt-1 block text-[13px] leading-5 text-muted-foreground">{preset.note}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="border border-line bg-bg2/55 p-4">
            <SectionHeader title="Texture" detail="These are the settings most likely to fix blotchy or dark texture areas." />
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-2 block font-mono text-[12px] uppercase tracking-[0.12em] text-muted-foreground">format</span>
                <select
                  value={settings.textureFormat}
                  onChange={(event) => updateSettings({ textureFormat: event.target.value as TextureFormat })}
                  className="w-full border border-line bg-bg px-3 py-2 text-[14px] text-ink outline-none focus:border-green"
                >
                  <option value="keep">Keep original</option>
                  <option value="webp">WebP</option>
                  <option value="jpeg">JPEG</option>
                  <option value="png">PNG</option>
                  <option value="avif">AVIF</option>
                </select>
              </label>
              <label className="block">
                <span className="mb-2 block font-mono text-[12px] uppercase tracking-[0.12em] text-muted-foreground">max size</span>
                <select
                  value={settings.resize}
                  onChange={(event) => updateSettings({ resize: event.target.value as ResizeValue })}
                  className="w-full border border-line bg-bg px-3 py-2 text-[14px] text-ink outline-none focus:border-green"
                >
                  <option value="none">No resize</option>
                  <option value="4096">4096 px</option>
                  <option value="2048">2048 px</option>
                  <option value="1536">1536 px</option>
                  <option value="1024">1024 px</option>
                  <option value="768">768 px</option>
                  <option value="512">512 px</option>
                  <option value="256">256 px</option>
                </select>
              </label>
            </div>
            <RangeControl label="quality" value={settings.textureQuality} min={1} max={100} step={1} suffix="%" onChange={(textureQuality) => updateSettings({ textureQuality })} />
            <RangeControl label="encoder effort" value={settings.textureEffort} min={0} max={100} step={5} suffix="%" onChange={(textureEffort) => updateSettings({ textureEffort })} />
            <ToggleRow label="Smooth resize" detail="Uses Lanczos2, which is softer and can reduce harsh texture artifacts." checked={settings.smoothResize} onChange={(smoothResize) => updateSettings({ smoothResize })} />
            <ToggleRow label="Lossless texture mode" detail="Largest output, useful when testing whether compression causes the dark areas." checked={settings.lossless} onChange={(lossless) => updateSettings({ lossless })} />
            <ToggleRow label="Near-lossless WebP" detail="WebP-only mode that usually keeps flatter color regions cleaner." checked={settings.nearLossless} onChange={(nearLossless) => updateSettings({ nearLossless })} />
          </div>

          <div className="border border-line bg-bg2/55 p-4">
            <button
              type="button"
              onClick={() => setAdvancedOpen((open) => !open)}
              className="mb-4 flex w-full items-center justify-between gap-3 border-b border-line pb-3 text-left"
            >
              <span>
                <span className="block font-mono text-[13px] uppercase tracking-[0.18em] text-ink">Geometry</span>
                <span className="mt-1 block text-[14px] leading-6 text-muted-foreground">Mesh, animation, quantization, and sparse accessor transforms.</span>
              </span>
              <SlidersHorizontal className="size-4 text-green" />
            </button>

            {advancedOpen && (
              <div>
                <ToggleRow label="Deduplicate" detail="Merge duplicate meshes, accessors, textures, and materials." checked={settings.dedup} onChange={(dedup) => updateSettings({ dedup })} />
                <ToggleRow label="Prune" detail="Remove unused data from the file." checked={settings.prune} onChange={(prune) => updateSettings({ prune })} />
                <ToggleRow label="Flatten scene" detail="Bake node transforms to reduce hierarchy complexity." checked={settings.flatten} onChange={(flatten) => updateSettings({ flatten })} />
                <ToggleRow label="Join meshes" detail="Merge compatible primitives into fewer meshes." checked={settings.join} onChange={(join) => updateSettings({ join })} />
                <ToggleRow label="Resample animation" detail="Losslessly resample redundant animation keys." checked={settings.resample} onChange={(resample) => updateSettings({ resample })} />
                <ToggleRow label="Weld vertices" detail="Merge exact duplicate vertices before simplification." checked={settings.weld} onChange={(weld) => updateSettings({ weld })} />
                <ToggleRow label="Simplify mesh" detail="Reduce triangle count. Lower ratio means smaller and less detailed." checked={settings.simplify} onChange={(simplify) => updateSettings({ simplify })} />
                {settings.simplify && (
                  <div className="border-b border-line2 py-2">
                    <RangeControl label="simplify ratio" value={settings.simplifyRatio} min={0.05} max={1} step={0.01} onChange={(simplifyRatio) => updateSettings({ simplifyRatio })} />
                    <RangeControl label="simplify error" value={settings.simplifyError} min={0} max={0.005} step={0.0001} onChange={(simplifyError) => updateSettings({ simplifyError })} />
                    <ToggleRow label="Lock borders" detail="Preserve open mesh borders while simplifying." checked={settings.simplifyLockBorder} onChange={(simplifyLockBorder) => updateSettings({ simplifyLockBorder })} />
                  </div>
                )}
                <ToggleRow label="Reorder" detail="Optimize vertex and index order for size." checked={settings.reorder} onChange={(reorder) => updateSettings({ reorder })} />
                <ToggleRow label="Quantize" detail="Lower attribute precision to shrink geometry." checked={settings.quantize} onChange={(quantize) => updateSettings({ quantize })} />
                {(settings.quantize || settings.meshopt) && (
                  <div className="border-b border-line2 py-2">
                    <RangeControl label="position bits" value={settings.quantizePosition} min={8} max={16} step={1} onChange={(quantizePosition) => updateSettings({ quantizePosition })} />
                    <RangeControl label="normal bits" value={settings.quantizeNormal} min={8} max={16} step={1} onChange={(quantizeNormal) => updateSettings({ quantizeNormal })} />
                    <RangeControl label="texcoord bits" value={settings.quantizeTexcoord} min={8} max={16} step={1} onChange={(quantizeTexcoord) => updateSettings({ quantizeTexcoord })} />
                  </div>
                )}
                <ToggleRow label="Meshopt compression" detail="Adds EXT_meshopt_compression for smaller geometry payloads." checked={settings.meshopt} onChange={(meshopt) => updateSettings({ meshopt })} />
                {settings.meshopt && (
                  <label className="block border-b border-line2 py-3">
                    <span className="mb-2 block font-mono text-[12px] uppercase tracking-[0.12em] text-muted-foreground">meshopt level</span>
                    <select
                      value={settings.meshoptLevel}
                      onChange={(event) => updateSettings({ meshoptLevel: event.target.value as 'medium' | 'high' })}
                      className="w-full border border-line bg-bg px-3 py-2 text-[14px] text-ink outline-none focus:border-green"
                    >
                      <option value="high">High</option>
                      <option value="medium">Medium</option>
                    </select>
                  </label>
                )}
                <ToggleRow label="Sparse accessors" detail="Store mostly-zero accessors sparsely." checked={settings.sparse} onChange={(sparse) => updateSettings({ sparse })} />
                {settings.sparse && (
                  <RangeControl label="sparse ratio" value={settings.sparseRatio} min={0.05} max={1} step={0.01} onChange={(sparseRatio) => updateSettings({ sparseRatio })} />
                )}
                <ToggleRow label="GPU instancing" detail="Experimental: instance repeated meshes when useful." checked={settings.gpuInstance} onChange={(gpuInstance) => updateSettings({ gpuInstance })} />
              </div>
            )}
          </div>
        </aside>

        <section className="space-y-6">
          <div className="grid gap-3 border border-line bg-bg2/45 p-4 md:grid-cols-[1fr_auto_auto] md:items-center">
            <div className="flex items-center gap-3">
              <FileArchive className="size-5 text-green" />
              <div>
                <p className="text-[15px] text-ink">{file ? file.name : 'No GLB selected'}</p>
                <p className="font-mono text-[12px] uppercase tracking-[0.12em] text-muted-foreground">
                  {result
                    ? `${formatBytes(result.inputBytes)} to ${formatBytes(result.outputBytes)} (${result.reductionPercent}% saved)`
                    : file
                      ? `${formatBytes(file.size)} input ready`
                      : 'upload a model to start'}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={optimize}
              disabled={!file || isOptimizing}
              className="inline-flex h-11 items-center justify-center bg-green px-5 font-mono text-[12px] uppercase tracking-[0.14em] text-bg transition-colors hover:bg-green/90 disabled:pointer-events-none disabled:opacity-45"
            >
              {isOptimizing ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
              {isOptimizing ? 'Optimizing' : 'Run optimizer'}
            </button>
            {outputUrl && (
              <a
                href={outputUrl}
                download={getOutputName(file)}
                className="inline-flex h-11 items-center justify-center border border-line bg-bg px-5 font-mono text-[12px] uppercase tracking-[0.14em] text-ink transition-colors hover:bg-bg2"
              >
                <Download className="mr-2 size-4" />
                Download
              </a>
            )}
          </div>

          {error && (
            <div className="border border-destructive/60 bg-destructive/10 px-4 py-3 text-[14px] leading-6 text-ink">
              {error}
            </div>
          )}

          {result?.warnings?.length ? (
            <div className="border border-green-dim bg-green/10 px-4 py-3 text-[14px] leading-6 text-ink">
              {result.warnings.join(' ')}
            </div>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-2">
            <GlbPreview src={originalUrl} label="Original" exposure={exposure} wireframe={wireframe} />
            <GlbPreview src={outputUrl} label="Optimized" exposure={exposure} wireframe={wireframe} />
          </div>

          <div className="grid gap-4 border border-line bg-bg2/45 p-4 md:grid-cols-[1fr_1fr_1fr]">
            <RangeControl label="preview exposure" value={exposure} min={0.5} max={1.8} step={0.02} onChange={setExposure} />
            <ToggleRow label="Wireframe preview" detail="Inspect simplification and topology changes." checked={wireframe} onChange={setWireframe} />
            <div className="border-b border-line2 py-3 md:border-b-0">
              <p className="font-mono text-[12px] uppercase tracking-[0.12em] text-muted-foreground">last run</p>
              <p className="mt-1 text-[15px] text-ink">
                {result ? `${(result.durationMs / 1000).toFixed(1)}s` : 'not run yet'}
              </p>
              <p className="mt-1 text-[13px] leading-5 text-muted-foreground">
                The preview lighting is intentionally bright so texture artifacts are easier to spot.
              </p>
            </div>
          </div>
        </section>
      </section>
    </main>
  )
}
