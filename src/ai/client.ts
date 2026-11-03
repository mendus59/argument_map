// Calls the Claude API straight from the admin's browser with the admin's own key.
// Loaded only when the admin runs an analysis, so readers never download the SDK.
import Anthropic from '@anthropic-ai/sdk'
import { MAX_OUTPUT_TOKENS, MODEL, RESULT_SCHEMA, SYSTEM_PROMPT } from './analysis'

function client(apiKey: string) {
  // Browser use is safe here because the only key is the admin's own, entered on their device.
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true })
}

export async function countInputTokens(apiKey: string, userPrompt: string): Promise<number> {
  const res = await client(apiKey).messages.countTokens({
    model: MODEL,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  })
  return res.input_tokens
}

export interface RunOutcome {
  /** Parsed JSON, or null when the run was declined or cut off. */
  json: unknown
  model: string
  inputTokens: number
  outputTokens: number
  stopReason: string | null
}

/** Runs the analysis, streaming so a long run doesn't time out. onProgress gets characters written so far. */
export async function runAnalysis(
  apiKey: string,
  userPrompt: string,
  onProgress: (chars: number) => void,
  signal: AbortSignal,
): Promise<RunOutcome> {
  const stream = client(apiKey).beta.messages.stream(
    {
      model: MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      betas: ['server-side-fallback-2026-07-01'],
      // If a safety check declines the request, the API retries it on a suitable model.
      fallbacks: 'default',
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high', format: { type: 'json_schema', schema: RESULT_SCHEMA } },
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    },
    { signal },
  )
  let chars = 0
  stream.on('text', (t) => {
    chars += t.length
    onProgress(chars)
  })
  const msg = await stream.finalMessage()
  const u = msg.usage
  const inputTokens = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0)
  let json: unknown = null
  if (msg.stop_reason === 'end_turn') {
    const text = msg.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
    try {
      json = JSON.parse(text)
    } catch {
      json = null
    }
  }
  return { json, model: msg.model, inputTokens, outputTokens: u.output_tokens ?? 0, stopReason: msg.stop_reason }
}

/** A short, plain explanation of a failed call. */
export function describeError(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return 'The API key was rejected. Check it in AI settings.'
  if (e instanceof Anthropic.PermissionDeniedError) return 'This API key isn’t allowed to use this model.'
  if (e instanceof Anthropic.RateLimitError) return 'Rate limited by the API. Wait a minute and try again.'
  if (e instanceof Anthropic.BadRequestError) return `The request was refused: ${e.message}`
  if (e instanceof Anthropic.APIUserAbortError) return 'Stopped.'
  if (e instanceof Anthropic.APIConnectionError) return 'Couldn’t reach the Claude API. Check your connection.'
  if (e instanceof Anthropic.APIError) return `The Claude API returned an error (${e.status ?? 'unknown'}). Try again.`
  return 'Something went wrong. Try again.'
}
