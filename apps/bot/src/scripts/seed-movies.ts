import { redis } from "@repo/redis";

const MOCK_MOVIE_CONTEXT = `
If the user asks for movies or movie links, you can reference the following data:
- "Dune: Part Two" - https://example.com/movies/dune-part-two
- "Spider-Man: Beyond the Spider-Verse" - https://example.com/movies/spiderman-beyond
- "Oppenheimer" - https://example.com/movies/oppenheimer
- "Avatar 3" - https://example.com/movies/avatar-3
- "Deadpool & Wolverine" - https://example.com/movies/deadpool-wolverine
`;

async function seed() {
  // Store the mock data in Redis with a 24-hour TTL (86400 seconds)
  const ttlSeconds = 86400;
  
  console.log("Saving mock movie context to Redis...");
  await redis.set("mock_movies_context", MOCK_MOVIE_CONTEXT, "EX", ttlSeconds);
  console.log(`Successfully saved with a TTL of ${ttlSeconds} seconds!`);
  
  process.exit(0);
}

seed().catch(err => {
  console.error("Failed to seed:", err);
  process.exit(1);
});
