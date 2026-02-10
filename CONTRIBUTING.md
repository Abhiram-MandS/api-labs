# Contributing to HTTP Interceptor

Thanks for your interest in contributing! This guide covers everything you need to get started.

## Getting Started

1. **Fork** the repository and clone your fork locally.
2. Install dependencies for both the UI and proxy server:

   ```bash
   npm install
   cd proxy-server && npm install && cd ..
   ```

3. Create a feature branch from `main`:

   ```bash
   git checkout -b feat/my-feature
   ```

4. Start the development servers:

   ```bash
   # Terminal 1 — Next.js UI
   npm run dev

   # Terminal 2 — Proxy server
   cd proxy-server && node server.js
   ```

## Development Workflow

### Branch Naming

Use a consistent prefix so the intent is clear at a glance:

| Prefix | Purpose |
|--------|---------|
| `feat/` | New feature |
| `fix/` | Bug fix |
| `docs/` | Documentation only |
| `refactor/` | Code restructuring (no behaviour change) |
| `chore/` | Tooling, CI, dependency updates |

### Commit Messages

Follow the [Conventional Commits](https://www.conventionalcommits.org/) format:

```
<type>(<scope>): <short description>

[optional body]
```

Examples:

```
feat(proxy): add request replay endpoint
fix(ui): correct WebSocket reconnection logic
docs(readme): add Python proxy configuration example
```

### Code Style

- **TypeScript** for all UI code (`app/` directory). Avoid `any` where possible.
- **JavaScript (ES modules)** for the proxy server (`proxy-server/`).
- Run the linter before committing:

  ```bash
  npm run lint
  ```

- Use [Tailwind CSS](https://tailwindcss.com/) utility classes for styling — avoid custom CSS unless strictly necessary.

## Project Layout

| Directory | Description |
|-----------|-------------|
| `app/` | Next.js 16 App Router pages and components |
| `proxy-server/` | Node.js HTTP/HTTPS proxy and WebSocket server |
| `public/` | Static assets served by Next.js |

When adding new modules to the proxy server, place middleware in `proxy-server/middleware/` and shared helpers in `proxy-server/utils/`.

## Pull Requests

1. Keep PRs focused — one logical change per PR.
2. Fill in the PR template (if available) with a summary, motivation, and testing steps.
3. Make sure the build passes:

   ```bash
   npm run build
   ```

4. Add or update documentation if your change affects user-facing behaviour.
5. Request a review from at least one maintainer.

## Reporting Issues

When opening an issue, include:

- Steps to reproduce
- Expected vs. actual behaviour
- Node.js version (`node -v`)
- OS and browser (if relevant)
- Proxy server logs and browser console output (if applicable)

## Testing

Currently there is no automated test suite. If you add tests, place them alongside the code they cover and document how to run them in your PR description.

Manual verification checklist before submitting:

- [ ] UI starts without errors (`npm run dev`)
- [ ] Proxy server starts without errors (`cd proxy-server && node server.js`)
- [ ] Browser-side interception logs requests correctly
- [ ] Proxy-side interception forwards and logs requests
- [ ] Mock rules work as expected
- [ ] No lint errors (`npm run lint`)

## Security

If you discover a security vulnerability, **do not** open a public issue. Instead, contact the maintainers privately so the issue can be triaged responsibly.

## License

By contributing, you agree that your contributions will be licensed under the project's [MIT License](LICENSE).
