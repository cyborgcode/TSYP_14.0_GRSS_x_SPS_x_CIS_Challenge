# tsyp

> One-line description of the project — fill this in.

## Requirements

- Node.js 22 (`.nvmrc` provided — `nvm use`)
- npm 10+

## Getting started

```bash
git clone https://github.com/cyborgcode/tsyp.git
cd tsyp
npm install
cp .env.example .env
npm run dev
```

The dev server runs on http://localhost:5173.

## Scripts

| Command                | Purpose                                              |
| ---------------------- | ---------------------------------------------------- |
| `npm run dev`          | Start the dev server with hot reload                 |
| `npm run build`        | Type-check and produce a production build in `dist/` |
| `npm run preview`      | Serve the production build locally                   |
| `npm run lint`         | Run ESLint                                           |
| `npm run format`       | Rewrite files with Prettier                          |
| `npm run format:check` | Verify formatting (runs in CI)                       |
| `npm run typecheck`    | Run the TypeScript compiler                          |
| `npm test`             | Run the test suite once                              |
| `npm run test:watch`   | Run tests in watch mode                              |

Run these before every push — CI runs the same chain:

```bash
npm run format:check && npm run lint && npm run typecheck && npm test && npm run build
```

## Repository layout

```
.github/workflows/   CI pipeline
docs/                project documentation and notes
src/                 application source
tests/               automated tests
```

## Stack

React 19 · TypeScript · Vite · Vitest + Testing Library · ESLint · Prettier

## Working agreement

See [CONTRIBUTING.md](CONTRIBUTING.md).
