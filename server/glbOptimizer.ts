import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { NodeIO, Logger, type Document, type Transform } from '@gltf-transform/core'
import { ALL_EXTENSIONS, EXTMeshGPUInstancing } from '@gltf-transform/extensions'
import {
  dedup,
  flatten,
  instance,
  join,
  meshopt,
  prune,
  quantize,
  reorder,
  resample,
  simplify,
  sparse,
  textureCompress,
  TextureResizeFilter,
  weld,
} from '@gltf-transform/functions'
import sharp from 'sharp'
import draco3d from 'draco3dgltf'
import {
  MeshoptDecoder,
  MeshoptEncoder,
  MeshoptSimplifier,
} from 'meshoptimizer'

type TextureFormat = 'keep' | 'jpeg' | 'png' | 'webp' | 'avif'
type ResizeValue = 'none' | '4096' | '2048' | '1536' | '1024' | '768' | '512' | '256'

export type GlbOptimizerOptions = {
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

export type GlbOptimizerResult = {
  inputBytes: number
  outputBytes: number
  reductionPercent: number
  durationMs: number
  warnings: string[]
  options: GlbOptimizerOptions
}

export const DEFAULT_GLB_OPTIMIZER_OPTIONS: GlbOptimizerOptions = {
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

const TEXTURE_FORMATS = new Set<TextureFormat>(['keep', 'jpeg', 'png', 'webp', 'avif'])
const RESIZE_VALUES = new Set<ResizeValue>(['none', '4096', '2048', '1536', '1024', '768', '512', '256'])

function bool(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback
}

function numberInRange(value: unknown, fallback: number, min: number, max: number) {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return fallback
  return Math.min(max, Math.max(min, numeric))
}

export function sanitizeOptimizerOptions(raw: unknown): GlbOptimizerOptions {
  const input = typeof raw === 'object' && raw ? raw as Partial<GlbOptimizerOptions> : {}
  const defaults = DEFAULT_GLB_OPTIMIZER_OPTIONS

  return {
    textureFormat: TEXTURE_FORMATS.has(input.textureFormat as TextureFormat) ? input.textureFormat as TextureFormat : defaults.textureFormat,
    resize: RESIZE_VALUES.has(input.resize as ResizeValue) ? input.resize as ResizeValue : defaults.resize,
    textureQuality: Math.round(numberInRange(input.textureQuality, defaults.textureQuality, 1, 100)),
    textureEffort: Math.round(numberInRange(input.textureEffort, defaults.textureEffort, 0, 100)),
    lossless: bool(input.lossless, defaults.lossless),
    nearLossless: bool(input.nearLossless, defaults.nearLossless),
    smoothResize: bool(input.smoothResize, defaults.smoothResize),
    dedup: bool(input.dedup, defaults.dedup),
    gpuInstance: bool(input.gpuInstance, defaults.gpuInstance),
    prune: bool(input.prune, defaults.prune),
    flatten: bool(input.flatten, defaults.flatten),
    join: bool(input.join, defaults.join),
    resample: bool(input.resample, defaults.resample),
    weld: bool(input.weld, defaults.weld),
    weldTolerance: numberInRange(input.weldTolerance, defaults.weldTolerance, 0, 0.1),
    weldToleranceNormal: numberInRange(input.weldToleranceNormal, defaults.weldToleranceNormal, 0, 1),
    simplify: bool(input.simplify, defaults.simplify),
    simplifyRatio: numberInRange(input.simplifyRatio, defaults.simplifyRatio, 0.05, 1),
    simplifyError: numberInRange(input.simplifyError, defaults.simplifyError, 0, 0.01),
    simplifyLockBorder: bool(input.simplifyLockBorder, defaults.simplifyLockBorder),
    reorder: bool(input.reorder, defaults.reorder),
    quantize: bool(input.quantize, defaults.quantize),
    quantizePosition: Math.round(numberInRange(input.quantizePosition, defaults.quantizePosition, 8, 16)),
    quantizeNormal: Math.round(numberInRange(input.quantizeNormal, defaults.quantizeNormal, 8, 16)),
    quantizeTexcoord: Math.round(numberInRange(input.quantizeTexcoord, defaults.quantizeTexcoord, 8, 16)),
    meshopt: bool(input.meshopt, defaults.meshopt),
    meshoptLevel: input.meshoptLevel === 'medium' || input.meshoptLevel === 'high' ? input.meshoptLevel : defaults.meshoptLevel,
    sparse: bool(input.sparse, defaults.sparse),
    sparseRatio: numberInRange(input.sparseRatio, defaults.sparseRatio, 0.05, 1),
  }
}

async function createIO() {
  await Promise.all([
    MeshoptEncoder.ready,
    MeshoptDecoder.ready,
    MeshoptSimplifier.ready,
  ])

  const [dracoDecoder, dracoEncoder] = await Promise.all([
    draco3d.createDecoderModule(),
    draco3d.createEncoderModule(),
  ])

  return new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({
      'draco3d.decoder': dracoDecoder,
      'draco3d.encoder': dracoEncoder,
      'meshopt.decoder': MeshoptDecoder,
      'meshopt.encoder': MeshoptEncoder,
    })
}

function buildTransforms(options: GlbOptimizerOptions, enableGpuInstancing: () => void): Transform[] {
  const transforms: Transform[] = []

  if (options.dedup) transforms.push(dedup())
  if (options.gpuInstance) {
    enableGpuInstancing()
    transforms.push(instance({ min: 2 }))
  }
  if (options.prune) transforms.push(prune())
  if (options.flatten) transforms.push(flatten())
  if (options.join) transforms.push(join({ keepMeshes: false, keepNamed: false }))
  if (options.resample) transforms.push(resample())
  if (options.weld) transforms.push(weld())
  if (options.simplify) {
    transforms.push(
      simplify({
        simplifier: MeshoptSimplifier,
        ratio: options.simplifyRatio,
        error: options.simplifyError,
        lockBorder: options.simplifyLockBorder,
      }),
    )
  }
  if (options.reorder) transforms.push(reorder({ encoder: MeshoptEncoder, target: 'size' }))
  if (options.quantize) {
    transforms.push(
      quantize({
        quantizePosition: options.quantizePosition,
        quantizeNormal: options.quantizeNormal,
        quantizeTexcoord: options.quantizeTexcoord,
      }),
    )
  }
  if (options.meshopt) {
    transforms.push(
      meshopt({
        encoder: MeshoptEncoder,
        level: options.meshoptLevel,
        quantizePosition: options.quantizePosition,
        quantizeNormal: options.quantizeNormal,
        quantizeTexcoord: options.quantizeTexcoord,
      }),
    )
  }
  if (options.sparse) transforms.push(sparse({ ratio: options.sparseRatio }))

  if (options.textureFormat !== 'keep' || options.resize !== 'none') {
    const textureOptions: Parameters<typeof textureCompress>[0] = {
      encoder: sharp,
      resizeFilter: options.smoothResize ? TextureResizeFilter.LANCZOS2 : TextureResizeFilter.LANCZOS3,
      quality: options.textureQuality,
      effort: options.textureEffort,
      lossless: options.lossless,
      nearLossless: options.nearLossless,
    }

    if (options.textureFormat !== 'keep') {
      textureOptions.targetFormat = options.textureFormat
    }

    if (options.resize !== 'none') {
      const size = Number(options.resize)
      textureOptions.resize = [size, size]
    }

    transforms.push(textureCompress(textureOptions))
  }

  return transforms
}

function ensureRenderableScene(doc: Document) {
  const root = doc.getRoot()
  if (root.listScenes().length > 0) return false

  const scene = doc.createScene('Recovered Scene')
  const rootNodes = root.listNodes().filter((node) => !node.getParentNode())

  if (rootNodes.length > 0) {
    rootNodes.forEach((node) => scene.addChild(node))
    return true
  }

  root.listMeshes().forEach((mesh, index) => {
    scene.addChild(doc.createNode(mesh.getName() || `mesh_${index + 1}`).setMesh(mesh))
  })

  return true
}

export async function optimizeGlbBuffer(inputBuffer: Buffer, rawOptions: unknown): Promise<{
  buffer: Buffer
  result: GlbOptimizerResult
}> {
  const options = sanitizeOptimizerOptions(rawOptions)
  const warnings: string[] = []
  const startedAt = performance.now()
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dev-website-glb-opt-'))
  const inputPath = path.join(tempDir, 'input.glb')
  const outputPath = path.join(tempDir, 'output.glb')

  try {
    await fs.writeFile(inputPath, inputBuffer)

    const io = await createIO()
    const doc = await io.read(inputPath)
    doc.setLogger(new Logger(Logger.Verbosity.WARN))
    doc.getRoot().getAsset().generator = 'dev-website GLB optimizer workbench'
    if (ensureRenderableScene(doc)) {
      warnings.push('Input GLB had no scene, so the optimizer created a recovered scene before pruning.')
    }

    const transforms = buildTransforms(options, () => {
      doc.createExtension(EXTMeshGPUInstancing).setRequired(true)
    })

    await doc.transform(...transforms)
    await io.write(outputPath, doc)

    const outputBuffer = await fs.readFile(outputPath)
    const reductionPercent = inputBuffer.length === 0
      ? 0
      : Number(((1 - outputBuffer.length / inputBuffer.length) * 100).toFixed(2))

    return {
      buffer: outputBuffer,
      result: {
        inputBytes: inputBuffer.length,
        outputBytes: outputBuffer.length,
        reductionPercent,
        durationMs: Math.round(performance.now() - startedAt),
        warnings,
        options,
      },
    }
  } finally {
    await fs.rm(tempDir, { force: true, recursive: true })
  }
}
