# Ora

A voice agent for your desktop. You talk, it thinks (LangGraph agent with tools, on the model provider of your choice), and it talks back. **Speech in and speech out both run on your own GPU**, so your audio never leaves the computer. Only the text of your requests goes to the model provider you pick.

```
 mic ──► Silero VAD ──► Whisper (WebGPU) ──► LangGraph agent ──► sentence splitter ──► Supertonic 3 (WebGPU) ──► speakers
        (turn detection)   on-device STT      provider + tools      starts speaking          on-device TTS
                                               (Electron main)        after sentence 1
```

## Run it

Requirements: Windows 10/11, Node 20+, a GPU with WebGPU (any recent Intel/AMD/NVIDIA), an API key for one model provider (see below), or a local model server.

```bash
npm install
npm run dev
```

First launch walks you through three steps: download the Supertonic voice files (about 380 MB, once), choose a provider and paste its key, and let the speech engines warm up (Whisper downloads about 80 MB the first time). After that it starts in seconds.

Build a production bundle with `npm run build` and run it with `npm start`.

**If `npm run dev` shows no window:** Ora only allows one copy at a time, so a leftover copy (or its dev server) from an earlier run makes the new one quit immediately. Run `npm run stop` to end any leftovers, then `npm run dev` again.

> `node_modules` here is a junction to `C:\Users\vivek\.vox-build\node_modules` so OneDrive does not sync hundreds of megabytes of packages. If you clone this elsewhere you can ignore that.

## Where Supertonic comes from

Supertonic is not an npm package, so you won't find it in `node_modules`. It is two things:

- **The code** (`src/renderer/src/engine/supertonic.ts`): the inference pipeline (duration predictor, text encoder, denoising steps, vocoder), ported from the reference web demo published with the model (MIT-licensed sample code). It runs on ONNX Runtime Web, whose runtime files come from the `onnxruntime-web` package.
- **The model weights** (about 380 MB, not shipped in the app): downloaded once from [`Supertone/supertonic-3`](https://huggingface.co/Supertone/supertonic-3) on Hugging Face by `src/main/models.ts` on first launch, into `%APPDATA%\Ora\models\supertonic-3`. The first-run screen has a Download button, and Settings > Advanced can re-download missing files. The weights are under the OpenRAIL-M licence.

`node test/fresh-install.mjs` tests exactly this: empty models folder, download, load, speak.

## Where your data lives

`%APPDATA%\Ora` holds the voice files, settings, chats, memories and your encrypted API keys (`secrets-v2.bin`; a key saved by an older version is picked up automatically). If you used the app under its old name (Vox), that folder is moved to `Ora` automatically on the first launch, so nothing is lost and the voice files aren't downloaded again. The files folder used by the file tools keeps whatever path you had in Settings > Tools.

## Using it

| Action | How |
|---|---|
| Talk hands-free | Click the orb (or `Ctrl+Shift+Space`, works from any app). It listens, detects when you stop, replies. |
| Push to talk | Settings > Listening > Push to talk, then hold `Space` or the orb. |
| Interrupt | Just talk over it, click Stop, or press `Esc`. |
| Type instead | Use the text box. Everything else works the same. |
| Approve an action | Sensitive tools show an Allow / Deny card, and Ora reads the request out. |
| Hear a reply again | Hover a message and click the speaker icon. |

Other shortcuts: `Ctrl+N` new chat, `Ctrl+B` sidebar, `Ctrl+,` settings.

## Model providers

Pick one in Settings > Model. Each provider keeps its own encrypted key, and Ora remembers the last model you used with each one.

| Provider | What you need | Notes |
|---|---|---|
| **OpenRouter** (default) | key from openrouter.ai/keys | One key, hundreds of models, live prices, fastest-provider routing. |
| **OpenAI** | key from platform.openai.com | GPT models directly. For GPT-5 and o-series set Reasoning to Minimal or Low so replies start quickly. |
| **Anthropic** | key from console.anthropic.com | Claude directly. |
| **Google** | key from aistudio.google.com/apikey | Gemini directly. "Off" reasoning makes Gemini 2.5 Flash answer at once. |
| **Custom** | the server's address | Any OpenAI-compatible server: Ollama (`http://localhost:11434/v1`), LM Studio (`http://localhost:1234/v1`), vLLM. No key needed, and with a local model the whole app can run offline. |

Each provider's model list is fetched live from its API, filtered to chat models, and you can also type any model ID by hand.

**Which model for voice:** two things matter, how fast the first word arrives and how reliably it calls tools. Defaults are `anthropic/claude-haiku-4.5` on OpenRouter, `gpt-4.1-mini` on OpenAI (fast, no thinking pause), `claude-haiku-4-5-20251001` on Anthropic and `gemini-2.5-flash` on Google. Smarter models (Claude Sonnet, GPT-5, Gemini Pro) work too but pause longer before speaking.

Things Ora handles for you, because providers disagree: GPT-5 and o-series models reject a custom temperature and use `max_completion_tokens`; Claude only accepts temperature 0 to 1; Gemini rejects several JSON-schema features in tool definitions and wants the first message from the user; Claude and Gemini reject two turns in a row from the same speaker. These are covered by tests against a mock of each API.

**Not verified:** the model IDs in the "Recommended" lists for OpenAI, Anthropic and Google, and everything above against the real provider APIs. I had no keys, so the tests use a mock that speaks each provider's streaming format and rejects what the real providers reject. Once you add a key, the lists are filtered to what your account can actually use.

## Tools

Built with LangChain / LangGraph. Toggle each in Settings > Tools.

| Tool | Source | Asks first |
|---|---|---|
| Web search | LangChain community `DuckDuckGoSearch` | |
| Wikipedia | LangChain community `WikipediaQueryRun` | |
| Calculator | LangChain community `Calculator` | |
| Weather (3-day forecast) | custom, Open-Meteo (no key) | |
| Date and time (any timezone) | custom | |
| Read web pages | custom (blocks local and private addresses) | |
| Timers (spoken alert) | custom | |
| Long-term memory | custom, stored on this device | |
| System info, copy to clipboard | custom | |
| Read clipboard | custom | yes |
| Open link in browser | custom | yes |
| List / read files | custom, limited to your Ora folder | |
| Write files | custom, limited to your Ora folder | yes |
| Run shell commands | custom, **off by default** | yes |

"Ask before acting" can be set to sensitive only (default), every tool, or never.

## Settings worth knowing

- **Model**: provider (OpenRouter, OpenAI, Anthropic, Google, Custom), API keys, model, creativity, max reply length, and where they apply: OpenRouter routing (fastest / cheapest) and reasoning effort.
- **Voice**: 10 Supertonic voices with previews, 31 languages, speed, quality (denoising steps), volume, output device, streaming chunk sizes.
- **Listening**: hands-free vs push-to-talk, sensitivity, how long a pause ends your turn, interrupt-by-speaking, Whisper model (tiny / base / small / large-turbo), microphone, global hotkey, start listening on launch.
- **Assistant**: name, your name, system prompt (with placeholders), how many turns of history to keep, max tool steps, long-term memory viewer.
- **Appearance**: light / dark / system, five accent colours, live captions, latency readout under every reply, expanded tool details, always on top.
- **Advanced**: voice file location and re-download, reset GPU cache, reset settings.

Speech model speed on an Intel integrated GPU, per short phrase: Tiny about 1s, **Base about 2s (default)**, Small about 6s.

## How it works

- **Main process** (`src/main`): the LangGraph ReAct agent (`agent/index.ts`), the tools (`agent/tools.ts`), settings (API key encrypted with the OS keychain), conversations and memory on disk, model downloads, and a `ora://` protocol that serves the app and the model files.
- **Renderer** (`src/renderer`): the UI, plus two Web Workers running ONNX Runtime Web on WebGPU. `engine/supertonic.ts` is the Supertonic 3 pipeline; `voice/stt.worker.ts` runs Whisper through Transformers.js. `voice/controller.ts` is the state machine that ties listening, thinking, speaking, interruption and approvals together.
- **Latency**: the reply is split into sentences as tokens stream in, and each sentence is synthesized and queued for gapless playback, so speech starts after the first sentence rather than the whole answer.

## Testing

Everything below drives the real built app in Electron with Playwright and a throwaway profile (in your temp folder, never your real settings):

```bash
npm run typecheck
npm run test:agent     # streaming, tools, approval allow/deny, interruption, full voice turn
npm run test:mic       # fake microphone -> VAD -> Whisper -> agent -> speech (hands-free, no-interrupt, push-to-talk)
node test/providers.mjs  # OpenRouter, OpenAI, Anthropic, Google and a custom server, against a mock of each API
npm run test:layout    # a very long chat must scroll inside the chat area at small, normal and maximized sizes
npm run screenshots    # dark + light theme screenshots
node test/stt-bench.mjs  # compare Whisper models on your GPU
node test/migrate.mjs    # the one-time Vox -> Ora data move (uses a fake AppData, never your real one)
```

The agent tests use a mock LLM server (`test/mock-llm.mjs`) that speaks OpenAI, Anthropic and Gemini formats, so no API key or spend is needed.

## Troubleshooting

- **Voice or hearing says "CPU"**, is very slow, or the app says the GPU was reset: Settings > Advanced > **Reset GPU cache**. A GPU reset can leave a corrupted shader cache behind, which makes WebGPU fail until it is cleared.
- **It talks to itself on speakers**: turn off "Interrupt by speaking", or use headphones.
- **Nothing happens when you speak**: raise Sensitivity in Settings > Listening and check the microphone selection.

## Credits

Voice: [Supertonic 3](https://huggingface.co/Supertone/supertonic-3) by Supertone (model under OpenRAIL-M; check its terms before distributing). Hearing: [Whisper](https://github.com/openai/whisper) via [Transformers.js](https://github.com/huggingface/transformers.js), and [Silero VAD](https://github.com/snakers4/silero-vad) via [vad-web](https://github.com/ricky0123/vad). Brain: [LangGraph](https://github.com/langchain-ai/langgraphjs) and [LangChain](https://github.com/langchain-ai/langchainjs) with OpenRouter, OpenAI, Anthropic, Google or your own server.
