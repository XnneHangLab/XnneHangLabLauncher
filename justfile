# Dev

install:
  npm install

dev:
  npm run tauri dev

build:
  npm run build

# Code Quality

typecheck-ts:
  npx tsc --noEmit

fmt-rust:
  cd src-tauri && cargo fmt

lint-rust:
  cd src-tauri && cargo clippy -- -D warnings

# CI

ci-lint-rust:
  cd src-tauri && cargo clippy -- -D warnings

ci-fmt-check-rust:
  cd src-tauri && cargo fmt --check

ci-typecheck-ts:
  npx tsc --noEmit

ci-test:
  npm run test -- --run
