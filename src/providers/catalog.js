/**
 * Connection presets. Presets are intentionally data-only: users can override
 * URLs, headers, and model IDs because provider contracts evolve independently.
 */
export const PROVIDER_PRESETS = Object.freeze([
  { id: 'openrouter', label: 'OpenRouter', adapter: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', catalog: 'openai', accountConnector: 'openrouter-oauth', category: 'gateway', notes: 'Unified model catalog, provider routing, BYOK and OAuth account connection.' },
  { id: 'openai', label: 'OpenAI', adapter: 'openai-compatible', baseUrl: 'https://api.openai.com/v1', catalog: 'openai', category: 'first-party' },
  { id: 'anthropic', label: 'Anthropic', adapter: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', catalog: 'anthropic', category: 'first-party' },
  { id: 'google-ai-studio', label: 'Google AI Studio (Gemini)', adapter: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', catalog: 'gemini', category: 'first-party' },
  { id: 'deepseek', label: 'DeepSeek', adapter: 'openai-compatible', baseUrl: 'https://api.deepseek.com', catalog: 'openai', category: 'first-party', defaultModel: 'deepseek-v4-flash' },
  { id: 'xai', label: 'xAI', adapter: 'openai-compatible', baseUrl: 'https://api.x.ai/v1', catalog: 'openai', category: 'first-party' },
  { id: 'mistral', label: 'Mistral AI', adapter: 'openai-compatible', baseUrl: 'https://api.mistral.ai/v1', catalog: 'openai', category: 'first-party' },
  { id: 'cohere', label: 'Cohere', adapter: 'openai-compatible', baseUrl: 'https://api.cohere.com/compatibility/v1', catalog: 'openai', category: 'first-party' },
  { id: 'moonshot', label: 'Moonshot AI / Kimi', adapter: 'openai-compatible', baseUrl: 'https://api.moonshot.ai/v1', catalog: 'openai', category: 'first-party' },
  { id: 'zhipu', label: 'Zhipu BigModel', adapter: 'openai-compatible', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', catalog: 'openai', category: 'first-party' },
  { id: 'minimax', label: 'MiniMax', adapter: 'openai-compatible', baseUrl: 'https://api.minimax.io/v1', catalog: 'openai', category: 'first-party' },
  { id: 'dashscope', label: 'Alibaba DashScope Compatible', adapter: 'openai-compatible', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', catalog: 'openai', category: 'first-party' },
  { id: 'siliconflow', label: 'SiliconFlow', adapter: 'openai-compatible', baseUrl: 'https://api.siliconflow.cn/v1', catalog: 'openai', category: 'gateway' },
  { id: 'groq', label: 'Groq', adapter: 'openai-compatible', baseUrl: 'https://api.groq.com/openai/v1', catalog: 'openai', category: 'inference' },
  { id: 'together', label: 'Together AI', adapter: 'openai-compatible', baseUrl: 'https://api.together.xyz/v1', catalog: 'openai', category: 'inference' },
  { id: 'fireworks', label: 'Fireworks AI', adapter: 'openai-compatible', baseUrl: 'https://api.fireworks.ai/inference/v1', catalog: 'openai', category: 'inference' },
  { id: 'cerebras', label: 'Cerebras Inference', adapter: 'openai-compatible', baseUrl: 'https://api.cerebras.ai/v1', catalog: 'openai', category: 'inference' },
  { id: 'sambanova', label: 'SambaNova Cloud', adapter: 'openai-compatible', baseUrl: 'https://api.sambanova.ai/v1', catalog: 'openai', category: 'inference' },
  { id: 'nvidia-nim', label: 'NVIDIA NIM', adapter: 'openai-compatible', baseUrl: 'https://integrate.api.nvidia.com/v1', catalog: 'openai', category: 'inference' },
  { id: 'perplexity', label: 'Perplexity', adapter: 'openai-compatible', baseUrl: 'https://api.perplexity.ai', catalog: 'openai', category: 'inference' },
  { id: 'nebius', label: 'Nebius AI Studio', adapter: 'openai-compatible', baseUrl: 'https://api.studio.nebius.ai/v1', catalog: 'openai', category: 'inference' },
  { id: 'novita', label: 'Novita AI', adapter: 'openai-compatible', baseUrl: 'https://api.novita.ai/openai', catalog: 'openai', category: 'inference' },
  { id: 'hyperbolic', label: 'Hyperbolic', adapter: 'openai-compatible', baseUrl: 'https://api.hyperbolic.xyz/v1', catalog: 'openai', category: 'inference' },
  { id: 'github-models', label: 'GitHub Models', adapter: 'openai-compatible', baseUrl: 'https://models.github.ai/inference', catalog: 'openai', category: 'gateway' },
  { id: 'huggingface', label: 'Hugging Face Inference Providers', adapter: 'openai-compatible', baseUrl: 'https://router.huggingface.co/v1', catalog: 'openai', category: 'gateway' },
  { id: 'vercel-ai-gateway', label: 'Vercel AI Gateway', adapter: 'openai-compatible', baseUrl: 'https://ai-gateway.vercel.sh/v1', catalog: 'openai', category: 'gateway' },
  { id: 'aimlapi', label: 'AI/ML API', adapter: 'openai-compatible', baseUrl: 'https://api.aimlapi.com/v1', catalog: 'openai', category: 'gateway' },
  { id: 'cloudflare', label: 'Cloudflare Workers AI', adapter: 'openai-compatible', baseUrl: 'https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1', catalog: 'openai', category: 'cloud', notes: 'Replace {account_id} before saving.' },
  { id: 'azure-openai', label: 'Azure OpenAI', adapter: 'azure-openai', baseUrl: 'https://{resource}.openai.azure.com/openai/deployments/{deployment}', catalog: 'manual', category: 'cloud', notes: 'Replace resource/deployment and configure api-version.' },
  { id: 'ollama', label: 'Ollama', adapter: 'openai-compatible', baseUrl: 'http://127.0.0.1:11434/v1', catalog: 'openai', category: 'local', noKey: true },
  { id: 'lm-studio', label: 'LM Studio', adapter: 'openai-compatible', baseUrl: 'http://127.0.0.1:1234/v1', catalog: 'openai', category: 'local', noKey: true },
  { id: 'vllm', label: 'vLLM', adapter: 'openai-compatible', baseUrl: 'http://127.0.0.1:8000/v1', catalog: 'openai', category: 'local', noKey: true },
  { id: 'llamacpp', label: 'llama.cpp server', adapter: 'openai-compatible', baseUrl: 'http://127.0.0.1:8080/v1', catalog: 'openai', category: 'local', noKey: true },
  { id: 'localai', label: 'LocalAI', adapter: 'openai-compatible', baseUrl: 'http://127.0.0.1:8080/v1', catalog: 'openai', category: 'local', noKey: true },
  { id: 'custom', label: 'Custom OpenAI-compatible', adapter: 'openai-compatible', baseUrl: '', catalog: 'openai', category: 'custom' },
])

const BY_ID = new Map(PROVIDER_PRESETS.map(preset => [preset.id, preset]))
export function providerPreset(id) { return BY_ID.get(id) ?? null }
