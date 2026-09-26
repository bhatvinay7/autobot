import { Index } from "@upstash/vector";
import { PrismaClient } from "@repo/db";

// Load environment variables (useful if running directly via tsx/bun)
import "dotenv/config";

const index = new Index({
  url: process.env.UPSTASH_VECTOR_REST_URL!,
  token: process.env.UPSTASH_VECTOR_REST_TOKEN!,
});

const prisma = new PrismaClient();

const fertilizers = [
  { name: "Urea 46-0-0", price: 25.50, description: "High nitrogen fertilizer", mainUsage: "Promotes leafy green growth", mainFunctionality: "Provides quick release nitrogen", imageUrl: "https://loremflickr.com/600/400/fertilizer,nitrogen?random=1" },
  { name: "DAP 18-46-0", price: 30.00, description: "Diammonium Phosphate", mainUsage: "Excellent for root development", mainFunctionality: "High phosphorus content", imageUrl: "https://loremflickr.com/600/400/fertilizer,phosphorus?random=2" },
  { name: "MOP 0-0-60", price: 28.75, description: "Muriate of Potash", mainUsage: "Improves disease resistance", mainFunctionality: "Source of potassium", imageUrl: "https://loremflickr.com/600/400/fertilizer,potash?random=3" },
  { name: "Ammonium Nitrate", price: 35.00, description: "Nitrogen source", mainUsage: "Pastures and hay fields", mainFunctionality: "Fast-acting nitrogen", imageUrl: "https://loremflickr.com/600/400/fertilizer,farm?random=4" },
  { name: "Superphosphate", price: 22.00, description: "Calcium Superphosphate", mainUsage: "Stimulates root growth", mainFunctionality: "Readily available phosphorus", imageUrl: "https://loremflickr.com/600/400/fertilizer,crop?random=5" },
  { name: "Triple Superphosphate", price: 38.50, description: "Concentrated phosphorus", mainUsage: "Fruit and seed development", mainFunctionality: "High-grade phosphorus", imageUrl: "https://loremflickr.com/600/400/fertilizer,seed?random=6" },
  { name: "Calcium Nitrate", price: 26.80, description: "Calcium and Nitrogen", mainUsage: "Prevents blossom end rot", mainFunctionality: "Provides calcium", imageUrl: "https://loremflickr.com/600/400/fertilizer,calcium?random=7" },
  { name: "Potassium Nitrate", price: 42.00, description: "Saltpeter", mainUsage: "Fruiting crops like tomatoes", mainFunctionality: "Potassium and nitrogen", imageUrl: "https://loremflickr.com/600/400/fertilizer,tomato?random=8" },
  { name: "Ammonium Sulfate", price: 24.50, description: "Nitrogen and Sulfur", mainUsage: "Lowers soil pH", mainFunctionality: "Provides sulfur for acidic soils", imageUrl: "https://loremflickr.com/600/400/fertilizer,soil?random=9" },
  { name: "NPK 10-10-10", price: 18.00, description: "Balanced general fertilizer", mainUsage: "All-purpose garden use", mainFunctionality: "Balanced nutrients", imageUrl: "https://loremflickr.com/600/400/fertilizer,garden?random=10" },
  { name: "NPK 20-20-20", price: 32.00, description: "High concentration balanced", mainUsage: "Water-soluble feeding", mainFunctionality: "Rapid balanced growth", imageUrl: "https://loremflickr.com/600/400/fertilizer,greenhouse?random=11" },
  { name: "Bone Meal", price: 15.50, description: "Organic phosphorus", mainUsage: "Bulbs and roots", mainFunctionality: "Slow release phosphorus", imageUrl: "https://loremflickr.com/600/400/fertilizer,organic?random=12" },
  { name: "Blood Meal", price: 21.00, description: "Organic nitrogen", mainUsage: "Heavy feeders (corn, brassicas)", mainFunctionality: "Fast organic nitrogen", imageUrl: "https://loremflickr.com/600/400/fertilizer,corn?random=13" },
  { name: "Kelp Meal", price: 29.00, description: "Seaweed extract", mainUsage: "Micronutrient supplement", mainFunctionality: "Provides trace minerals", imageUrl: "https://loremflickr.com/600/400/fertilizer,seaweed?random=14" },
  { name: "Epsom Salt", price: 12.00, description: "Magnesium Sulfate", mainUsage: "Roses and peppers", mainFunctionality: "Magnesium and sulfur", imageUrl: "https://loremflickr.com/600/400/fertilizer,rose?random=15" },
  { name: "Azomite", price: 20.00, description: "Volcanic ash", mainUsage: "Remineralizing soil", mainFunctionality: "Trace minerals and elements", imageUrl: "https://loremflickr.com/600/400/fertilizer,mineral?random=16" },
  { name: "Greensand", price: 24.00, description: "Glauconite", mainUsage: "Loosens clay soils", mainFunctionality: "Slow release potassium", imageUrl: "https://loremflickr.com/600/400/fertilizer,clay?random=17" },
  { name: "Fish Emulsion", price: 19.50, description: "Liquid organic", mainUsage: "Seedlings and transplants", mainFunctionality: "Gentle nitrogen boost", imageUrl: "https://loremflickr.com/600/400/fertilizer,seedling?random=18" },
  { name: "Compost Tea", price: 10.00, description: "Liquid compost extract", mainUsage: "Foliar feeding", mainFunctionality: "Soil microbiology boost", imageUrl: "https://loremflickr.com/600/400/fertilizer,compost?random=19" },
  { name: "Milorganite", price: 16.00, description: "Biosolid fertilizer", mainUsage: "Lawns and turf", mainFunctionality: "Slow release nitrogen with iron", imageUrl: "https://loremflickr.com/600/400/fertilizer,lawn?random=20" },
];

async function seed() {
  console.log("Starting seeding process...");
  
  for (let i = 0; i < fertilizers.length; i++) {
    const f = fertilizers[i]!;
    
    // 1. Save to Database
    const dbRecord = await prisma.fertilizer.create({
      data: {
        name: f.name,
        price: f.price,
        description: f.description,
        mainUsage: f.mainUsage,
        mainFunctionality: f.mainFunctionality,
        imageUrl: f.imageUrl,
      }
    });

    console.log(`Saved ${f.name} to Postgres DB (ID: ${dbRecord.id})`);

    // 2. Save to Upstash Vector DB
    // The "data" field is what gets vectorized by Upstash automatically if you configured an embedding model.
    // The metadata contains the real data so you don't even need to query Postgres again if you don't want to.
    const textToEmbed = `${f.name}. ${f.description}. Used for: ${f.mainUsage}. Functionality: ${f.mainFunctionality}.`;
    
    await index.upsert({
      id: dbRecord.id, // Keep IDs synced between Postgres and Upstash!
      data: textToEmbed,
      metadata: {
        name: f.name,
        price: f.price,
        description: f.description,
        mainUsage: f.mainUsage,
        mainFunctionality: f.mainFunctionality,
        imageUrl: f.imageUrl,
        dbId: dbRecord.id
      }
    });

    console.log(`Saved ${f.name} to Upstash Vector DB`);
  }

  console.log("Seeding complete! 20 fertilizers added.");
}

seed()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
