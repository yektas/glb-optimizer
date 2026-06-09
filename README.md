# GLB Optimizer

Standalone local workbench for tuning GLB optimization settings and comparing the output.

## Run

```bash
npm install
npm run dev
```

The app runs at `http://127.0.0.1:3100/` by default.

## Build

```bash
npm run build
npm run preview
```

The optimizer endpoint is provided by the local Vite server at `/api/glb-optimize`, so the production preview still needs the Vite preview server or an equivalent Node host for that endpoint.
