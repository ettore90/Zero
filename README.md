# Application - Development Documentation

This README is a generic, portable base for the application. Update placeholders and examples to match the environment where it is deployed.

## 🎯 Purpose

This application supports development workflows, local tooling access, and a browser-based interface for project tasks.

## 🚀 Quick Start

### 1. Access the application
Open the configured application URL in your browser.

Examples:
- `http://localhost:<PORT>/`
- `http://<HOST>/<BASE_PATH>/`

### 2. First-Time Setup
1. Open **Settings**
2. Configure the models, providers, or integrations available in your environment
3. Select a default option if needed
4. Return to the main interface and start your session

### 3. Example Requests
```text
Read the package.json and summarize this project
Run tests and show any failures
Refactor this function to improve readability
Find files related to authentication
```

---

## 🔧 Configuration

### Deployment
After configuration or code changes, rebuild or restart the application using the process appropriate for your environment.

If using containers, keep service names, ports, paths, and volumes configurable rather than hardcoded.

### Environment Variables
Keep runtime values explicit and aligned with the actual deployment.

Example:
```yaml
app:
  environment:
    - PORT=<PORT>
    - BASE_PATH=<BASE_PATH>
    - STORAGE_PATH=<STORAGE_PATH>
    - DB_FILE_NAME=<DB_FILE_NAME>
    - VITE_DEV_SERVER_TARGET=<DEV_SERVER_TARGET>
```

Guidance:
- `PORT` and `BASE_PATH` define the HTTP binding and mounted path.
- `STORAGE_PATH` defines the runtime storage directory.
- `DB_FILE_NAME` should contain only the database filename.
- If a full database path is needed, prefer a dedicated path variable such as `DB_FILE_PATH`.
- Avoid placing a full path in `DB_FILE_NAME`.

Use only the variables that are actually supported by the application in this repository.


## ✅ Validation

Current official backend smoke commands:

- `npm run validate:api`
- `npm run validate`

The current backend smoke covers:
- local auth/session flow for user `ettore`
- model availability via `GET /api/state/ettore`
- SSE chat response for `gpt-5.4-LAB` and `gpt-5.4-mini-qa`
- terminal tool smoke for `run_terminal_command` via `/api/chat`

Use `validate:api` as the canonical backend smoke entrypoint for zero/green targets, overriding the base URL by environment when needed.

---

## 📚 Notes

- Prefer documenting only behaviors and configuration that are verified for this application.
- Do not assume features from another app, environment, or deployment also apply here.
- When details are uncertain, use neutral wording and placeholders.

---

## 🤝 Contributing

When updating this README:
- Keep it aligned with the current application
- Remove inherited references specific to another instance or environment
- Prefer neutral wording when implementation details are not verified
- Replace placeholders with real values only when they are confirmed for the target deployment
