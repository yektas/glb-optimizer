import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  DEFAULT_GLB_OPTIMIZER_OPTIONS,
  optimizeGlbBuffer,
  sanitizeOptimizerOptions,
} from './server/glbOptimizer'

const MAX_UPLOAD_BYTES = 250 * 1024 * 1024

function readBody(req: IncomingMessage) {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0

    req.on('data', (chunk: Buffer) => {
      size += chunk.byteLength
      if (size > MAX_UPLOAD_BYTES) {
        reject(new Error('GLB upload is larger than the 250 MB local limit.'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function sendJson(res: ServerResponse, status: number, payload: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(payload))
}

async function handleOptimizerRequest(req: IncomingMessage, res: ServerResponse) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    res.end()
    return
  }

  if (req.method === 'GET') {
    sendJson(res, 200, { defaults: DEFAULT_GLB_OPTIMIZER_OPTIONS })
    return
  }

  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Use POST with a GLB file body.' })
    return
  }

  try {
    const url = new URL(req.url ?? '', 'http://localhost')
    const settings = sanitizeOptimizerOptions(JSON.parse(url.searchParams.get('settings') ?? '{}'))
    const inputBuffer = await readBody(req)

    if (inputBuffer.byteLength === 0) {
      sendJson(res, 400, { error: 'Upload a non-empty .glb file.' })
      return
    }

    const { buffer, result } = await optimizeGlbBuffer(inputBuffer, settings)
    res.statusCode = 200
    res.setHeader('Content-Type', 'model/gltf-binary')
    res.setHeader('Content-Length', buffer.byteLength)
    res.setHeader('Content-Disposition', 'attachment; filename="optimized.glb"')
    res.setHeader('X-GLB-Optimizer-Result', encodeURIComponent(JSON.stringify(result)))
    res.end(buffer)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Optimizer failed.'
    sendJson(res, 500, { error: message })
  }
}

function glbOptimizerPlugin(): Plugin {
  return {
    name: 'standalone-glb-optimizer',
    configureServer(server) {
      server.middlewares.use('/api/glb-optimize', (req, res) => {
        void handleOptimizerRequest(req, res)
      })
    },
    configurePreviewServer(server) {
      server.middlewares.use('/api/glb-optimize', (req, res) => {
        void handleOptimizerRequest(req, res)
      })
    },
  }
}

export default defineConfig({
  server: {
    port: 3100,
  },
  preview: {
    port: 3100,
  },
  plugins: [
    react(),
    tailwindcss(),
    glbOptimizerPlugin(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
