import { Index } from "@upstash/vector";

// Initialize the index
// Note: You will need to create a Vector index in the Upstash console
// and set UPSTASH_VECTOR_REST_URL and UPSTASH_VECTOR_REST_TOKEN in your .env
const index = new Index({
  url: process.env.UPSTASH_VECTOR_REST_URL || "",
  token: process.env.UPSTASH_VECTOR_REST_TOKEN || "",
});

export type MessageMetadata = {
  content: string;
  authorId: string;
  channelId: string;
  timestamp: string;
  platform: 'discord' | 'slack';
};

/**
 * Stores a piece of context (e.g., a message) in the Upstash Vector DB.
 * 
 * PRO TIP: When creating the index in the Upstash Console, select an 
 * "Embedding Model" (like bge-m3 or bge-base-en-v1.5). This allows Upstash
 * to automatically generate the vector embeddings from the raw text!
 */
export async function storeContextInVectorDB(id: string, textContent: string, metadata: MessageMetadata) {
  if (!process.env.UPSTASH_VECTOR_REST_URL) {
    console.warn("UPSTASH_VECTOR_REST_URL is not set. Skipping vector storage.");
    return;
  }

  await index.upsert({
    id,
    data: textContent, // Upstash automatically vectorizes this text!
    metadata: metadata
  });
  
  console.log(`[Vector DB] Successfully stored vector for item: ${id}`);
}

/**
 * Searches the Vector DB for content similar to the user's query.
 * Returns the matching vectors along with their attached metadata (real data).
 */
export async function fetchSimilarContext(queryText: string, topK: number = 3) {
  if (!process.env.UPSTASH_VECTOR_REST_URL) {
    console.warn("UPSTASH_VECTOR_REST_URL is not set. Returning empty context.");
    return [];
  }

  const results = await index.query<MessageMetadata>({
    data: queryText, // Upstash automatically vectorizes the query to search
    topK,
    includeMetadata: true,
  });
  
  return results.map(result => ({
    id: result.id,
    score: result.score,
    metadata: result.metadata, // This contains the original real data!
  }));
}
