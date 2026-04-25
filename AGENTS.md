# Repository Guidelines

Welcome to the ha-pi-agent repository. This guide helps you contribute effectively to this Home Assistant add-on for the Pi coding agent.

## Project Structure

- **`src/`**: Core server-side TypeScript code, including WebSocket handlers, agent and login managers
- **`frontend/`**: Web UI components and assets
- **`tests/`**: Integration and unit tests
- **`bundled-skills/`**: Pre-installed skills for Home Assistant integration
- **`public/`**: Static assets served to the browser
- **`translations/`**: UI localization files

## Build, Test, and Development

### Core Commands

```bash
pnpm install              # Install dependencies
pnpm build               # Build server and frontend
pnpm test                # Run all tests
pnpm test:watch          # Run tests in watch mode
pnpm dev                 # Build and run locally with debug logging
pnpm typecheck           # Run TypeScript type checking
```

### Development Workflow

Use `pnpm watch:server` and `pnpm watch:frontend` for hot-reload development. The dev server requires provider configuration via CLI flags:

```bash
pnpm dev --provider anthropic --model claude-sonnet-4-5-20250929
```

## Coding Style

- **Language**: TypeScript for all source code
- **Indentation**: 2 spaces
- **Format**: Semi-colons required, single quotes preferred
- **Linting**: TypeScript strict mode enforced via `tsconfig.json`
- **Format**: No dedicated Prettier config; follow existing code style

## Testing

- **Framework**: Vitest for unit and integration tests
- **Coverage**: Tests are required for new features; aim for comprehensive coverage
- **Naming**: Tests use `.test.ts` suffix (e.g., `server.test.ts`)
- **Run**: `pnpm test` for CI; `pnpm test:watch` for development

## Commit and Pull Request Guidelines

### Commit Messages

Follow conventional commits format: `<type>(scope): description`

- `feat:` New functionality
- `fix:` Bug fixes
- `docs:` Documentation updates
- `chore:` Maintenance tasks (build, deps, tools)
- `Release vX.Y.Z`: Version releases

Common scopes: `frontend`, `server`, `config`, `tests`, `skills`

Examples:

```
feat(frontend): add delete button to session history
fix(server): correct login timeout handling
chore(deps): update vitest to v4.1.5
```

Examples without scope:

```bash
feat: add WebSocket session persistence
fix: correct login timeout handling
chore: update dependencies
```

### Pull Requests

- Reference related issues in the PR description
- Keep PRs focused on a single feature or fix
- Provide brief descriptions of changes and testing performed
- Ensure all tests pass before requesting review

## Security and Configuration

- Configuration is managed via `config.yaml` and `build.yaml`
- API keys and credentials should be set via environment variables
- Do not commit secrets or sensitive data
