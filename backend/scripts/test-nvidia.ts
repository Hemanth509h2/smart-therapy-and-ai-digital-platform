import 'dotenv/config'
import {
  nvidiaClient,
  generateEmbedding,
  analyseWithLLM,
  LLM_MODEL,
  EMBEDDING_MODEL,
} from '../src/lib/rag/nvidia-client'

async function testNvidia() {
  console.log('Testing NVIDIA NIM connection...\n')

  // ── TEST 1: API key validation ──────────────────
  console.log('Test 1: API key + model list')
  try {
    const models = await nvidiaClient.models.list()
    const modelIds = models.data.map(m => m.id)
    const hasLLM = modelIds.includes(LLM_MODEL)
    const hasEmbed = modelIds.includes(EMBEDDING_MODEL)
    console.log(`  \u2713 API key valid`)
    console.log(`  ${hasLLM ? '\u2713' : '\u2717'} LLM model available: ${LLM_MODEL}`)
    console.log(`  ${hasEmbed ? '\u2713' : '\u2717'} Embedding model available: ${EMBEDDING_MODEL}`)
  } catch (e) {
    console.error('  \u2717 API key invalid or network error:', e)
    process.exit(1)
  }

  // ── TEST 2: Embedding generation ───────────────
  console.log('\nTest 2: Generate embedding')
  try {
    const sampleText = 'The child shows difficulty maintaining focus during reading tasks and frequently loses their place in the text.'
    const embedding = await generateEmbedding(sampleText, 'passage')
    console.log(`  \u2713 Embedding generated`)
    console.log(`  \u2713 Dimensions: ${embedding.length} (expected 1024)`)
    console.log(`  \u2713 First 5 values: ${embedding.slice(0, 5).map(v => v.toFixed(4)).join(', ')}`)
    if (embedding.length !== 1024) {
      console.error('  \u2717 Wrong dimensions — expected 1024')
      process.exit(1)
    }
  } catch (e) {
    console.error('  \u2717 Embedding generation failed:', e)
    process.exit(1)
  }

  // ── TEST 3: LLM JSON output ─────────────────────
  console.log('\nTest 3: LLM analysis with JSON output')
  try {
    const systemPrompt = `You are a clinical support assistant for a therapist.
Analyse the session transcript and return ONLY a valid JSON object.
No explanation, no markdown, just the JSON.`

    const userPrompt = `
Session transcript (last 5 minutes):
"Client seems withdrawn today. They mentioned feeling overwhelmed by school 
 and said they haven't been sleeping well. When asked about the reading 
 exercises, they said 'I can't do it, I'm too stupid'. Therapist encouraged 
 them but the client remained disengaged."

Client profile:
- Name: Aryan, Age: 11, Condition: SLD (Dyslexia)
- Session number: 7

Return this exact JSON structure:
{
  "emotions": ["string"],
  "summary": "string (max 2 sentences)",
  "steps": ["string", "string"],
  "module": "string (one of: word-building, bubble-splash, whack-a-mole-math, pixel-art-coding, n-back-challenge, virtual-maze, simon-says, grounding-game, emotional-charades, box-popping, worry-box, drag-drop-sorting, social-story, virtual-shop)",
  "riskFlag": false
}`

    const raw = await analyseWithLLM(systemPrompt, userPrompt)
    const parsed = JSON.parse(raw)

    console.log(`  \u2713 LLM responded with valid JSON`)
    console.log(`  \u2713 Emotions: ${parsed.emotions?.join(', ')}`)
    console.log(`  \u2713 Summary: ${parsed.summary}`)
    console.log(`  \u2713 Steps: ${parsed.steps?.length} suggestions`)
    console.log(`  \u2713 Module: ${parsed.module}`)
    console.log(`  \u2713 Risk flag: ${parsed.riskFlag}`)

    const required = ['emotions', 'summary', 'steps', 'module', 'riskFlag']
    const missing = required.filter(k => !(k in parsed))
    if (missing.length > 0) {
      console.error(`  \u2717 Missing fields: ${missing.join(', ')}`)
      process.exit(1)
    }
    console.log(`  \u2713 All required fields present`)
  } catch (e) {
    console.error('  \u2717 LLM call failed or returned invalid JSON:', e)
    process.exit(1)
  }

  // ── TEST 4: Cosine similarity between embeddings ──
  console.log('\nTest 4: Embedding similarity (sanity check)')
  try {
    const textA = 'The child struggles with reading and letter recognition'
    const textB = 'Difficulty decoding words and phonics challenges observed'
    const textC = 'The client enjoys football and outdoor activities'

    const [embA, embB, embC] = await Promise.all([
      generateEmbedding(textA, 'passage'),
      generateEmbedding(textB, 'passage'),
      generateEmbedding(textC, 'passage'),
    ])

    const cosineSimilarity = (a: number[], b: number[]): number => {
      const dot = a.reduce((sum, val, i) => sum + val * b[i], 0)
      const magA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0))
      const magB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0))
      return dot / (magA * magB)
    }

    const simAB = cosineSimilarity(embA, embB)
    const simAC = cosineSimilarity(embA, embC)

    console.log(`  \u2713 Similar texts similarity (A\u2194B): ${simAB.toFixed(4)} (should be > 0.7)`)
    console.log(`  \u2713 Different texts similarity (A\u2194C): ${simAC.toFixed(4)} (should be < 0.5)`)

    if (simAB <= simAC) {
      console.error('  \u2717 Embedding similarity logic is wrong — similar texts scored lower than different texts')
      process.exit(1)
    }
    console.log(`  \u2713 Similarity ordering correct — embeddings are working`)
  } catch (e) {
    console.error('  \u2717 Similarity test failed:', e)
    process.exit(1)
  }

  console.log('\n\u2705 ALL TESTS PASSED — NVIDIA NIM is ready')
}

testNvidia().catch(e => {
  console.error('\u274c TEST FAILED:', e)
  process.exit(1)
})
