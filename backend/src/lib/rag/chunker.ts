const CHUNK_SIZE = 400
const CHUNK_OVERLAP = 80

export interface TextChunk {
  text: string
  index: number
  wordCount: number
}

export function chunkText(text: string): TextChunk[] {
  const cleaned = text
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()

  const words = cleaned.split(/\s+/).filter(w => w.length > 0)

  if (words.length === 0) return []

  const chunks: TextChunk[] = []
  let startIndex = 0
  let chunkIndex = 0

  while (startIndex < words.length) {
    const endIndex = Math.min(startIndex + CHUNK_SIZE, words.length)
    const chunkWords = words.slice(startIndex, endIndex)
    const chunkText = chunkWords.join(' ')

    chunks.push({
      text: chunkText,
      index: chunkIndex,
      wordCount: chunkWords.length,
    })

    chunkIndex++
    startIndex += CHUNK_SIZE - CHUNK_OVERLAP

    if (words.length - startIndex <= CHUNK_OVERLAP) break
  }

  return chunks
}

export function extractTextFromString(raw: string): string {
  return raw
    .replace(/(\w)-\n(\w)/g, '$1$2')
    .replace(/\n(?=[a-z])/g, ' ')
    .replace(/\f/g, '\n\n')
    .trim()
}
