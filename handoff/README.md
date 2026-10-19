# Gemini -> Codex UI handoff

Unzip this package **into the existing Baseguard-SmartOps-Codex-Prototype project root**. Files are staged under `handoff/` rather than replacing live code.

Launch Codex from the project root. Prompt: **Read and implement `handoff/CODEX_INTEGRATION_TASK.md`. Use `handoff/gemini-ui` as the exact Gemini UI baseline. Preserve the current business logic and connect real callbacks.**

Files were mechanically extracted from the user's Gemini-generated text into separate TS/TSX files. They are **not pre-validated against the latest Windows repo**, and may need TypeScript/React Native corrections and typed prop adapters. The original raw response is preserved in `GEMINI_ORIGINAL_OUTPUT.txt`.

Neither this ZIP nor extraction modifies the current working application. Review diffs before merging.
