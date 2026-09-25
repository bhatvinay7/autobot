const APP_ID = "1552639963328155739";
const TOKEN = "REMOVED_TOKEN";

const commands = [
  {
    name: "ask",
    description: "Ask the AI a question",
    options: [{ name: "prompt", description: "Your question", type: 3, required: true }]
  },
  {
    name: "generate",
    description: "Generate a summary or content",
    options: [{ name: "topic", description: "What to generate", type: 3, required: true }]
  },
  {
    name: "status",
    description: "Check the current status of the bot or system"
  },
  {
    name: "task",
    description: "Assign a task for the AI to track",
    options: [{ name: "description", description: "Task description", type: 3, required: true }]
  }
];

const GUILD_ID = "1552717504911114321";

async function register() {
  const res = await fetch(`https://discord.com/api/v10/applications/${APP_ID}/guilds/${GUILD_ID}/commands`, {
    method: "PUT",
    headers: {
      "Authorization": `Bot ${TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(commands)
  });

  if (res.ok) {
    console.log("Successfully registered slash commands!");
    const data = await res.json();
    console.log(data.map(c => c.name));
  } else {
    console.error("Failed to register commands:", await res.text());
  }
}

register();
