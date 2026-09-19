// A local stand-in for the LLM providers, so the agent can be tested without API keys or spend.
// It speaks the streaming formats of OpenAI-compatible APIs, Anthropic Messages and Google Gemini,
// and serves each provider's model list and key check. Requests that a real provider would reject
// (bad tool schemas, bad message order, missing headers) get a 400 so integration bugs show up here.
import http from 'node:http'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)) }

// ---------------- the scripted "brain", independent of protocol ----------------

function decide({ userText, toolResultFor }) {
  const text = (userText ?? '').toLowerCase()
  if (toolResultFor) {
    if (toolResultFor === 'get_weather' || text.includes('weather')) return { kind: 'text', text: 'It looks warm and mostly clear in Mumbai right now. You will not need an umbrella today.' }
    return { kind: 'text', text: 'Done. I saved your note.' }
  }
  if (text.includes('weather')) return { kind: 'tool', lead: 'Let me check that for you.', name: 'get_weather', args: { location: 'Mumbai' } }
  if (text.includes('note')) return { kind: 'tool', lead: '', name: 'write_file', args: { path: 'hello.txt', content: 'hi from ora' } }
  if (text.includes('story')) return { kind: 'text', slow: 90, text: 'Once upon a time there was a small robot who loved to sing. Every morning it climbed the hill behind the village. It sang to the sun until the whole valley woke up. The villagers loved the songs. One day the robot forgot the words. It hummed instead and everyone joined in.' }
  return { kind: 'text', text: 'Sure thing. Here is a short reply for you.' }
}

const pieces = (text) => text.match(/\S+\s*/g) ?? []

// ---------------- OpenAI-compatible (OpenAI, OpenRouter, Ollama...) ----------------

const oaChunk = (delta, finish = null) => `data: ${JSON.stringify({ id: 'mock-1', object: 'chat.completion.chunk', created: 1, model: 'mock', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`

async function openai(res, body) {
  const msgs = body.messages ?? []
  const last = msgs[msgs.length - 1]
  const firstUser = [...msgs].reverse().find((m) => m.role === 'user')
  const userText = typeof firstUser?.content === 'string' ? firstUser.content : JSON.stringify(firstUser?.content)
  const plan = decide({ userText, toolResultFor: last?.role === 'tool' ? last.name : undefined })
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
  res.write(oaChunk({ role: 'assistant', content: '' }))
  if (plan.kind === 'text') {
    for (const p of pieces(plan.text)) { res.write(oaChunk({ content: p })); await sleep(plan.slow ?? 25) }
    res.write(oaChunk({}, 'stop'))
  } else {
    if (plan.lead) res.write(oaChunk({ content: plan.lead }))
    const args = JSON.stringify(plan.args)
    res.write(oaChunk({ tool_calls: [{ index: 0, id: `call_${plan.name}`, type: 'function', function: { name: plan.name, arguments: '' } }] }))
    for (let i = 0; i < args.length; i += 8) { res.write(oaChunk({ tool_calls: [{ index: 0, function: { arguments: args.slice(i, i + 8) } }] })); await sleep(5) }
    res.write(oaChunk({}, 'tool_calls'))
  }
  res.write('data: [DONE]\n\n')
  res.end()
}

// ---------------- Anthropic Messages ----------------

const anEvent = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`

function anthropicProblems(body) {
  const problems = []
  if (!body.max_tokens) problems.push('max_tokens is required')
  if (!Array.isArray(body.messages) || body.messages[0]?.role !== 'user') problems.push('the first message must be from the user')
  let prev = null
  for (const m of body.messages ?? []) { if (m.role === prev) problems.push('messages must alternate between user and assistant'); prev = m.role }
  if (typeof body.temperature === 'number' && (body.temperature < 0 || body.temperature > 1)) problems.push('temperature must be between 0 and 1')
  for (const t of body.tools ?? []) if (!t.input_schema || t.input_schema.type !== 'object') problems.push(`tool ${t.name} needs an object input_schema`)
  return problems
}

async function anthropic(res, body) {
  const msgs = body.messages ?? []
  const lastMsg = msgs[msgs.length - 1]
  const blocks = Array.isArray(lastMsg?.content) ? lastMsg.content : [{ type: 'text', text: lastMsg?.content }]
  const result = blocks.find((b) => b.type === 'tool_result')
  const userMsg = [...msgs].reverse().find((m) => m.role === 'user' && (typeof m.content === 'string' || m.content.some((b) => b.type === 'text')))
  const userText = typeof userMsg?.content === 'string' ? userMsg.content : userMsg?.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n')
  const plan = decide({ userText, toolResultFor: result ? 'get_weather' : undefined })
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
  res.write(anEvent('message_start', { message: { id: 'msg_1', type: 'message', role: 'assistant', model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } }))
  let index = 0
  const text = plan.kind === 'text' ? plan.text : plan.lead
  if (text) {
    res.write(anEvent('content_block_start', { index, content_block: { type: 'text', text: '' } }))
    for (const p of pieces(text)) { res.write(anEvent('content_block_delta', { index, delta: { type: 'text_delta', text: p } })); await sleep(plan.slow ?? 25) }
    res.write(anEvent('content_block_stop', { index })); index++
  }
  if (plan.kind === 'tool') {
    res.write(anEvent('content_block_start', { index, content_block: { type: 'tool_use', id: 'toolu_1', name: plan.name, input: {} } }))
    const args = JSON.stringify(plan.args)
    for (let i = 0; i < args.length; i += 8) { res.write(anEvent('content_block_delta', { index, delta: { type: 'input_json_delta', partial_json: args.slice(i, i + 8) } })); await sleep(5) }
    res.write(anEvent('content_block_stop', { index }))
  }
  res.write(anEvent('message_delta', { delta: { stop_reason: plan.kind === 'tool' ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 20 } }))
  res.write(anEvent('message_stop', {}))
  res.end()
}

// ---------------- Google Gemini ----------------

// Gemini accepts only a subset of JSON Schema. These are the things it actually rejects.
function geminiSchemaProblems(node, path = '') {
  const problems = []
  if (!node || typeof node !== 'object') return problems
  for (const bad of ['$schema', 'additionalProperties', '$ref', 'const', 'exclusiveMinimum', 'exclusiveMaximum']) if (bad in node) problems.push(`${path}: unsupported field "${bad}"`)
  if (node.format && !['enum', 'date-time'].includes(node.format)) problems.push(`${path}: format "${node.format}" is not supported for strings (only enum and date-time)`)
  if (node.type === 'object' && node.properties && Object.keys(node.properties).length === 0) problems.push(`${path}: properties should be non-empty for OBJECT type`)
  for (const [k, v] of Object.entries(node.properties ?? {})) problems.push(...geminiSchemaProblems(v, `${path}.${k}`))
  if (node.items) problems.push(...geminiSchemaProblems(node.items, `${path}[]`))
  return problems
}

function googleProblems(body) {
  const problems = []
  if (body.contents?.[0]?.role !== 'user') problems.push('the first content must have role "user"')
  let prev = null
  for (const c of body.contents ?? []) { if (c.role === prev && c.role !== 'function') problems.push('contents must alternate between user and model'); prev = c.role }
  for (const t of body.tools ?? []) for (const f of t.functionDeclarations ?? []) problems.push(...geminiSchemaProblems(f.parameters, f.name))
  return problems
}

const gChunk = (parts, finish) => `data: ${JSON.stringify({ candidates: [{ content: { role: 'model', parts }, ...(finish ? { finishReason: finish } : {}), index: 0 }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 } })}\r\n\r\n`

async function google(res, body) {
  const contents = body.contents ?? []
  const lastParts = contents[contents.length - 1]?.parts ?? []
  const toolResponse = lastParts.find((p) => p.functionResponse)
  const userContent = [...contents].reverse().find((c) => c.role === 'user' && c.parts?.some((p) => p.text))
  const userText = userContent?.parts.filter((p) => p.text).map((p) => p.text).join('\n')
  const plan = decide({ userText, toolResultFor: toolResponse ? toolResponse.functionResponse.name : undefined })
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
  if (plan.kind === 'text') {
    for (const p of pieces(plan.text)) { res.write(gChunk([{ text: p }])); await sleep(plan.slow ?? 25) }
    res.write(gChunk([{ text: '' }], 'STOP'))
  } else {
    if (plan.lead) res.write(gChunk([{ text: plan.lead }]))
    res.write(gChunk([{ functionCall: { name: plan.name, args: plan.args } }], 'STOP'))
  }
  res.end()
}

// ---------------- model lists and key checks ----------------

const OPENAI_STYLE_MODELS = [
  { id: 'gpt-5.4-mini' }, { id: 'gpt-4.1-mini' }, { id: 'gpt-4o-mini' }, { id: 'o4-mini' },
  { id: 'text-embedding-3-small' }, { id: 'whisper-1' }, { id: 'gpt-image-1' }, { id: 'gpt-4o-realtime-preview' }, { id: 'omni-moderation-latest' }
]
const OPENROUTER_MODELS = [
  { id: 'anthropic/claude-haiku-4.5', name: 'Claude Haiku 4.5', context_length: 200000, pricing: { prompt: '0.000001', completion: '0.000005' }, supported_parameters: ['tools'], architecture: { output_modalities: ['text'] } },
  { id: 'qwen/qwen3.8-27b:free', name: 'Qwen 27B', context_length: 262144, pricing: { prompt: '0', completion: '0' }, supported_parameters: ['tools'], architecture: { output_modalities: ['text'] } },
  { id: 'some/image-model', name: 'Image model', context_length: 8000, pricing: { prompt: '0.000001', completion: '0.000001' }, supported_parameters: [], architecture: { output_modalities: ['text', 'image'] } }
]
const isBad = (key) => !key || /bad/i.test(key)

function handleGet(req, res, url) {
  const key = req.headers['x-api-key'] ?? req.headers['x-goog-api-key'] ?? (req.headers.authorization ?? '').replace(/^Bearer\s*/i, '')
  if (url.pathname === '/v1beta/models') {
    if (isBad(key)) return json(res, 400, { error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT' } })
    return json(res, 200, { models: [
      { name: 'models/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', inputTokenLimit: 1048576, supportedGenerationMethods: ['generateContent', 'countTokens'] },
      { name: 'models/gemini-2.5-flash-lite', displayName: 'Gemini 2.5 Flash-Lite', inputTokenLimit: 1048576, supportedGenerationMethods: ['generateContent'] },
      { name: 'models/text-embedding-004', displayName: 'Text Embedding 004', supportedGenerationMethods: ['embedContent'] },
      { name: 'models/gemini-2.5-flash-preview-tts', displayName: 'Gemini TTS', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemma-3-27b-it', displayName: 'Gemma 3', supportedGenerationMethods: ['generateContent'] }
    ] })
  }
  if (url.pathname === '/v1/models') {
    if (req.headers['x-api-key'] !== undefined) {
      if (isBad(key) || !req.headers['anthropic-version']) return json(res, 401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } })
      return json(res, 200, { data: [{ id: 'claude-sonnet-5', display_name: 'Claude Sonnet 5', type: 'model' }, { id: 'claude-haiku-4-5-20251001', display_name: 'Claude Haiku 4.5', type: 'model' }], has_more: false })
    }
    if (req.headers.authorization !== undefined && isBad(key)) return json(res, 401, { error: { message: 'Incorrect API key provided' } })
    if (req.headers.authorization === undefined) return json(res, 200, { data: [...OPENROUTER_MODELS, ...OPENAI_STYLE_MODELS] }) // OpenRouter (public) and keyless custom servers
    return json(res, 200, { data: OPENAI_STYLE_MODELS })
  }
  if (url.pathname === '/v1/key') {
    if (isBad(key)) return json(res, 401, { error: { message: 'No auth credentials found' } })
    return json(res, 200, { data: { label: 'mock-key', usage: 1.25, limit: null } })
  }
  res.writeHead(404).end()
}

export function startMockLlm() {
  const requests = [] // OpenAI-protocol request bodies (used by the older tests)
  const log = [] // every request: { protocol, path, headers, body }
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://mock')
    if (req.method === 'GET') return handleGet(req, res, url)
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', async () => {
      const body = JSON.parse(raw || '{}')
      const headers = req.headers
      const reject = (protocol, problems) => { log.push({ protocol, path: url.pathname, headers, body, rejected: problems }); json(res, 400, { error: { code: 400, type: 'invalid_request_error', message: problems.join('; ') } }) }
      try {
        if (url.pathname.endsWith('/chat/completions')) {
          const key = (headers.authorization ?? '').replace(/^Bearer\s*/i, '')
          if (headers.authorization !== undefined && isBad(key)) return json(res, 401, { error: { message: 'Incorrect API key provided' } })
          requests.push(body); log.push({ protocol: 'openai', path: url.pathname, headers, body })
          return await openai(res, body)
        }
        if (url.pathname === '/v1/messages') {
          const problems = anthropicProblems(body)
          if (!headers['x-api-key'] || isBad(headers['x-api-key'])) return json(res, 401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } })
          if (!headers['anthropic-version']) problems.push('anthropic-version header is required')
          if (problems.length) return reject('anthropic', problems)
          log.push({ protocol: 'anthropic', path: url.pathname, headers, body })
          return await anthropic(res, body)
        }
        if (/^\/v1beta\/models\/[^/]+:streamGenerateContent$/.test(url.pathname)) {
          const key = headers['x-goog-api-key'] ?? url.searchParams.get('key')
          if (isBad(key)) return json(res, 400, { error: { code: 400, message: 'API key not valid. Please pass a valid API key.' } })
          const problems = googleProblems(body)
          if (problems.length) return reject('google', problems)
          log.push({ protocol: 'google', path: url.pathname, headers, body })
          return await google(res, body)
        }
        res.writeHead(404).end()
      } catch (err) {
        if (!res.headersSent) json(res, 500, { error: { message: String(err) } })
      }
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ port: server.address().port, requests, log, close: () => server.close() }))
  })
}
