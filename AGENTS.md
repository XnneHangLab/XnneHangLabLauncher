# AGENTS.md

XnneHangLabLauncher is a Tauri 2 desktop launcher for the XnneHangLab ecosystem. It provides environment provisioning, model management, and service control. Frontend is React + TypeScript, backend is Rust (Tauri 2), Python runtime managed via `uv`.

## Project Structure

```
launcher/
├── src/                          # React frontend (TypeScript)
│   ├── main.tsx                  #   Entry point → App → AppShell
│   ├── components/               #   UI components (sidebar, topbar, home, models, settings)
│   ├── pages/                    #   Page components:
│   │   ├── HomePage              #     Dashboard (FolderGrid, HeroBanner, NoticePanel)
│   │   ├── ModelsPage            #     Model download & management
│   │   ├── ModelAIPage           #     AI model configuration
│   │   ├── ConsolePage           #     Runtime output & logs
│   │   ├── SettingsPage          #     General settings
│   │   ├── ServiceConfigPage     #     ASR/TTS/Agent service config
│   │   ├── SpeechPage            #     Speech settings (TTS/ASR provider selection)
│   │   ├── ToolsPage             #     Plugin management & configuration
│   │   ├── ProfilesPage          #     Character profile management
│   │   └── TroubleshootingPage   #     Diagnostics
│   ├── services/
│   │   ├── runtime/              #   Tauri IPC bridge (runtime inspection, downloads, process mgmt)
│   │   ├── config/               #   Lab config persistence (reads/writes lab.toml)
│   │   ├── desktop/              #   Window controls
│   │   ├── theme/                #   Theme management
│   │   └── launcher/             #   Console logging
│   └── live2d/                   #   Live2D preview (Cubism SDK integration)
├── src-tauri/                    # Rust backend (Tauri 2)
│   └── src/
│       ├── lib.rs                #   Tauri entry point, command registration
│       └── ...                   #   Commands, process management, state
└── package.json                  # Vite 5 + React 18 + TypeScript
```

## Architecture

```
React UI  ←Tauri invoke→  Rust backend  ←subprocess→  Python (uv runtime)
  Pages                     Commands                    Lab server / model downloads
```

- React pages call Rust commands via Tauri `invoke()` in `services/runtime/`
- Rust spawns Python subprocesses for runtime operations (server start, model download, env probing)
- No external state management — React hooks + service layer pattern
- Config persistence: reads/writes the parent project's `config/lab.toml` and `profiles/*.toml`

## Key Features

- **Runtime management**: probe Python/CUDA/torch, start/stop lab server
- **Model downloads**: serial queue for model artifacts (GSV, Qwen ASR/TTS, embeddings)
- **Service config**: UI for ASR/TTS/Agent provider selection, writes back to lab.toml
- **Plugin management**: plugin enable/toggle, conflict resolution, dependency resolution UI
- **Console**: runtime event streaming + log export
- **Live2D preview**: embedded Live2D renderer for character preview

## Dev Commands

```bash
npm install             # Install dependencies
npm run tauri dev       # Start dev environment (Vite + Tauri)
npm run build           # Build frontend
npx tsc --noEmit        # TypeScript type check
cargo check             # Rust compile check (in src-tauri/)
cargo test              # Rust tests
```

## Conventions

- Same gitmoji commit convention as parent project (`:sparkles: feat:`, `:bug: fix:`, etc.)
- UI text in Chinese, code/comments in English
- Main branch: `dev`; create feature branches from it
