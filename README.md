# Local Laya Decisions

## Browser Playground

```powershell
npm.cmd run playground
```

Open the URL printed in the terminal, normally http://127.0.0.1:3000.
If that port is occupied, the server tries ports 3001 through 3009.
The server loads the model once and keeps it in memory until stopped with Ctrl+C.

The playground includes editable state and question JSON, ten showcase cases,
new question controls, probability charts, raw JSON, and copy/download actions.
It works on desktop and mobile-sized browser windows. Assets and icons are
served locally; no external frontend service is required.

Showcase cases cover refunds, account security, technical support, sales
qualification, product feedback, inbox spam triage, delivery issues, return
eligibility, agent tool selection, and meeting follow-ups. Each case has three
editable questions, with a mix of choices, scores, and yes/no decisions.

These are interactive examples, not an accuracy benchmark or reliable policy
engine. During verification, the model mislabeled the mixed review as positive,
the suspicious email as business correspondence, and the missing delivery as
received. Results are live model predictions, not curated or hardcoded answers.
Review probabilities and validate against your own labeled data before relying
on decisions, especially for security or policy enforcement.

The server binds only to `127.0.0.1`, rejects cross-origin browser requests,
limits request bodies to 64 KB, and permits one inference at a time.
`GET /api/health` reports readiness; `POST /api/decide` accepts the same
`state` and `questions` structure as `request.json` and returns the model result
with `duration_ms`. This is a local playground, not an authenticated production API.

Run backend checks with `npm.cmd test`. The original CLI commands below are unchanged.

Run Laya locally on Windows using Node.js and ONNX Runtime. No hosted inference
API, API key, Python, Docker, or CUDA installation is required. Inference runs
on your CPU, not your NVIDIA GPU.

## Run

From this workspace in PowerShell:

```powershell
npm.cmd start
```

This evaluates `request.json` and prints typed answers with probabilities.
Edit that file to try your own state and questions, or pass another file:

```powershell
npm.cmd run decide -- .\my-request.json
```

Supported question types:

- `choice`: pick a label and return the probability of each option.
- `score`: return an expected level over an ordered list of criteria.
- `noul`: return the probability that a statement is true.

Use `answer_confidence` for confidence in the reported answer. The separate
`confidence` field on choice/score answers measures something different.

Decision JSON goes to stdout; loading messages and timings go to stderr.
The process exits after each request and releases the model.

## Installation And Cache

Dependencies and model weights have already been installed in this workspace.
For a fresh installation, use Node.js 20 or newer, then:

```powershell
npm.cmd ci
npm.cmd run download
npm.cmd start
```

The first download is about 1.7 GB. Weights are stored in `.cache/laya/` within
this workspace and reused by subsequent runs. Allow several GB of free RAM
for inference. Both the cache and `node_modules/` are excluded from Git.

Downloads and cache freshness checks access Hugging Face. Ticket contents are
processed locally by the ONNX runtime. This runner does not configure a fully
air-gapped mode. The runtime is pinned in `package-lock.json`; model downloads
follow the upstream default revision rather than a pinned model commit.

## Verified Setup

- Windows, Node.js 22.14.0, `@receptron/laya` 0.2.0, CPU execution.
- Sample ticket routed to `billing` with probability `0.8467`.
- Refund requested probability: `0.8948`.
- First decision: about 1.66 seconds, excluding model download and load.

These are observed results, not latency or accuracy guarantees. Each CLI run
loads the model again; a persistent application should load it once and reuse
the instance. GPU acceleration is not configured by this project.

## Sources

- [Laya model by Convai Innovations](https://huggingface.co/convaiinnovations/laya)
- [Node.js runtime and API documentation](https://github.com/receptron/laya)
- [ONNX model bundle](https://huggingface.co/receptron/laya-onnx)

The Node.js wrapper is MIT licensed; the upstream Laya weights are published
under Apache 2.0. The published ONNX files used here are at the repository root;
the runtime README's example `multilingual` subfolder returned HTTP 404 during
setup. This project makes no claim that this bundle supports 100+ languages.