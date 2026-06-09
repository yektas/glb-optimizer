import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'

type GlbPreviewProps = {
  src?: string
  label: string
  exposure: number
  wireframe: boolean
}

function disposeMaterial(material: THREE.Material) {
  Object.values(material).forEach((value) => {
    if (value instanceof THREE.Texture) value.dispose()
  })
  material.dispose()
}

function disposeObject(root?: THREE.Object3D) {
  if (!root) return

  root.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.geometry.dispose()
      const materials = Array.isArray(object.material) ? object.material : [object.material]
      materials.forEach(disposeMaterial)
    }
  })
}

export function GlbPreview({ src, label, exposure, wireframe }: GlbPreviewProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const exposureRef = useRef(exposure)
  const wireframeRef = useRef(wireframe)
  const [state, setState] = useState<'empty' | 'loading' | 'ready' | 'error'>(src ? 'loading' : 'empty')

  useEffect(() => {
    exposureRef.current = exposure
  }, [exposure])

  useEffect(() => {
    wireframeRef.current = wireframe
  }, [wireframe])

  useEffect(() => {
    const root = rootRef.current
    if (!root || !src) {
      setState('empty')
      return
    }

    setState('loading')

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    })
    renderer.setClearColor(0x000000, 0)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = exposureRef.current
    root.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 1000)
    camera.position.set(0, 0.4, 4.8)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.autoRotate = true
    controls.autoRotateSpeed = 0.55
    controls.enablePan = false

    const modelGroup = new THREE.Group()
    scene.add(modelGroup)

    const grid = new THREE.GridHelper(4.8, 16, 0x24402f, 0x142018)
    grid.position.y = -1.35
    grid.material.opacity = 0.45
    grid.material.transparent = true
    scene.add(grid)

    scene.add(new THREE.HemisphereLight(0xf3fff4, 0x101915, 2.2))

    const keyLight = new THREE.DirectionalLight(0xffffff, 3)
    keyLight.position.set(3.5, 5, 5)
    scene.add(keyLight)

    const fillLight = new THREE.DirectionalLight(0x9af6bc, 1.2)
    fillLight.position.set(-4, 2, 3)
    scene.add(fillLight)

    const backLight = new THREE.DirectionalLight(0xffffff, 1.4)
    backLight.position.set(0, 3, -5)
    scene.add(backLight)

    let modelRoot: THREE.Object3D | undefined
    const dracoLoader = new DRACOLoader()
    let disposed = false
    let frame = 0

    const resize = () => {
      const rect = root.getBoundingClientRect()
      renderer.setSize(rect.width, rect.height, false)
      camera.aspect = rect.width / Math.max(rect.height, 1)
      camera.updateProjectionMatrix()
      renderer.render(scene, camera)
    }

    const observer = new ResizeObserver(resize)
    observer.observe(root)
    resize()

    const loader = new GLTFLoader()
    dracoLoader.setDecoderPath('/draco/')
    loader.setDRACOLoader(dracoLoader)
    loader.setMeshoptDecoder(MeshoptDecoder)
    loader.load(
      src,
      (gltf) => {
        if (disposed) {
          disposeObject(gltf.scene)
          return
        }

        modelRoot = gltf.scene
        const box = new THREE.Box3().setFromObject(modelRoot)
        const center = box.getCenter(new THREE.Vector3())
        const size = box.getSize(new THREE.Vector3())
        const largestSide = Math.max(size.x, size.y, size.z)
        const scale = largestSide > 0 ? 2.65 / largestSide : 1

        modelRoot.position.copy(center).multiplyScalar(-scale)
        modelRoot.scale.setScalar(scale)
        modelRoot.traverse((object) => {
          if (object instanceof THREE.Mesh) {
            const materials = Array.isArray(object.material) ? object.material : [object.material]
            materials.forEach((material) => {
              material.wireframe = wireframeRef.current
              material.needsUpdate = true
            })
          }
        })

        modelGroup.add(modelRoot)
        controls.target.set(0, 0, 0)
        controls.update()
        setState('ready')
      },
      undefined,
      () => {
        setState('error')
      },
    )

    const animate = () => {
      renderer.toneMappingExposure = exposureRef.current
      modelRoot?.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          const materials = Array.isArray(object.material) ? object.material : [object.material]
          materials.forEach((material) => {
            if (material.wireframe !== wireframeRef.current) {
              material.wireframe = wireframeRef.current
              material.needsUpdate = true
            }
          })
        }
      })
      controls.update()
      renderer.render(scene, camera)
      frame = requestAnimationFrame(animate)
    }
    frame = requestAnimationFrame(animate)

    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      observer.disconnect()
      controls.dispose()
      disposeObject(modelRoot)
      dracoLoader?.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [src])

  return (
    <div className="relative min-h-[360px] overflow-hidden border border-line bg-[#050706]">
      <div ref={rootRef} className="absolute inset-0" aria-label={`${label} GLB preview`} />
      <div className="pointer-events-none absolute left-3 top-3 border border-line bg-bg/80 px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground backdrop-blur">
        {label}
      </div>
      {state !== 'ready' && (
        <div className="absolute inset-0 grid place-items-center bg-bg/70 px-8 text-center">
          <div>
            <p className="font-mono text-[12px] uppercase tracking-[0.18em] text-green">
              {state === 'loading' ? 'loading model' : state === 'error' ? 'preview failed' : 'drop a glb'}
            </p>
            <p className="mt-2 max-w-[28ch] text-[14px] leading-6 text-muted-foreground">
              {state === 'error'
                ? 'The optimizer can still run, but this preview could not decode the file.'
                : 'Upload a GLB to inspect it here.'}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
