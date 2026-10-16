import OpenAI from 'openai'

if (!process.env.NVIDIA_API_KEY) {
  throw new Error('NVIDIA_API_KEY is not set in .env')
}

export const nvidiaClient = new OpenAI({
  apiKey: process.env.NVIDIA_API_KEY,
  baseURL: 'https://integrate.api.nvidia.com/v1',
})

export const LLM_MODEL = 'meta/llama-3.1-70b-instruct'

export const EMBEDDING_MODEL = 'nvidia/nv-embedqa-e5-v5'

export async function generateEmbedding(
  text: string,
  inputType: 'query' | 'passage' = 'passage'
): Promise<number[]> {
  const response = await nvidiaClient.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text,
    encoding_format: 'float',
    // @ts-ignore — NVIDIA NIM requires this extra param
    input_type: inputType,
  })
  return response.data[0].embedding
}

export async function analyseWithLLM(
  systemPrompt: string,
  userPrompt: string
): Promise<string> {
  const response = await nvidiaClient.chat.completions.create({
    model: LLM_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.2,
    max_tokens: 1024,
    response_format: { type: 'json_object' },
  })
  return response.choices[0].message.content ?? '{}'
}
