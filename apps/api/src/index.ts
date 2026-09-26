import "dotenv/config";
import express, { Request, Response } from "express";
import cors from "cors";
import bcrypt from "bcryptjs";
import Redis from "ioredis";
import { prisma } from "@repo/db";
import { getStreamDepth, getDlqDepth } from "@repo/redis";
import { createSessionToken, COOKIE_NAME, TOKEN_MAX_AGE_SECONDS } from "./auth";

const app = express();
const clientUrl = process.env.CLIENT_URL || "http://localhost:3000";
app.use(cors({ origin: clientUrl, credentials: true }));
app.use(express.json());

const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";

// ============================
// Monitor Health Route
// ============================
app.get("/api/health", async (req: Request, res: Response) => {
  const checks: Record<string, { status: "ok" | "error"; detail?: string | number }> = {};

  try {
    const [interactions, botReplies, mirrors, dlq] = await Promise.all([
      getStreamDepth("interactions"),
      getStreamDepth("bot-replies"),
      getStreamDepth("mirrors"),
      getDlqDepth(),
    ]);
    checks.redis = { status: "ok" };
    checks.stream_interactions = { status: "ok", detail: interactions };
    checks.stream_bot_replies = { status: "ok", detail: botReplies };
    checks.stream_mirrors = { status: "ok", detail: mirrors };
    checks.stream_dlq = { status: dlq > 0 ? "error" : "ok", detail: dlq };
  } catch (err) {
    checks.redis = { status: "error", detail: err instanceof Error ? err.message : "unknown" };
  }

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = { status: "ok" };
  } catch (err) {
    checks.database = { status: "error", detail: err instanceof Error ? err.message : "unknown" };
  }

  const healthy = Object.values(checks).every((c) => c.status === "ok");

  res.status(healthy ? 200 : 503).json({
    status: healthy ? "ok" : "degraded",
    timestamp: new Date().toISOString(),
    checks,
  });
});

// ============================
// Dashboard Auth Routes
// ============================
app.post("/api/signup", async (req: Request, res: Response) => {
  const { email, password } = req.body;
  if (!email || !password) {
    res.status(400).json({ success: false, error: "Email and password are required" });
    return;
  }
  if (password.length < 8) {
    res.status(400).json({ success: false, error: "Password must be at least 8 characters" });
    return;
  }

  const existing = await prisma.adminUser.findUnique({ where: { email } });
  if (existing) {
    res.status(409).json({ success: false, error: "An account with this email already exists" });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.adminUser.create({ data: { email, passwordHash } });

  const token = await createSessionToken(user.id, user.email);
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: TOKEN_MAX_AGE_SECONDS * 1000,
    path: "/",
  });

  res.status(201).json({
    success: true,
    data: { token, expiresAt: new Date(Date.now() + TOKEN_MAX_AGE_SECONDS * 1000).toISOString() },
  });
});

app.post("/api/auth", async (req: Request, res: Response) => {
  const { email, password } = req.body;
  if (!email || !password) {
    res.status(400).json({ success: false, error: "Email and password are required" });
    return;
  }

  const user = await prisma.adminUser.findUnique({ where: { email } });
  if (!user) {
    res.status(401).json({ success: false, error: "Invalid credentials" });
    return;
  }

  const passwordValid = await bcrypt.compare(password, user.passwordHash);
  if (!passwordValid) {
    res.status(401).json({ success: false, error: "Invalid credentials" });
    return;
  }

  const token = await createSessionToken(user.id, user.email);
  
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: TOKEN_MAX_AGE_SECONDS * 1000,
    path: "/",
  });

  res.json({
    success: true,
    data: { token, expiresAt: new Date(Date.now() + TOKEN_MAX_AGE_SECONDS * 1000).toISOString() },
  });
});

app.delete("/api/auth", (req: Request, res: Response) => {
  res.clearCookie(COOKIE_NAME);
  res.json({ success: true, data: null });
});

// ============================
// Dashboard Config Routes
// ============================
app.get("/api/config", async (req: Request, res: Response) => {
  const guildId = req.query.guildId as string;
  if (!guildId) {
    res.status(400).json({ success: false, error: "guildId is required" });
    return;
  }

  const configs = await prisma.commandConfig.findMany({
    where: { guildId },
    orderBy: { commandName: "asc" },
  });

  res.json({ success: true, data: configs });
});

app.put("/api/config", async (req: Request, res: Response) => {
  const { guildId, commandName, ...rest } = req.body;
  if (!guildId || !commandName) {
    res.status(400).json({ success: false, error: "guildId and commandName are required" });
    return;
  }

  const config = await prisma.commandConfig.upsert({
    where: { guildId_commandName: { guildId, commandName } },
    update: rest,
    create: { guildId, commandName, ...rest },
  });

  res.json({ success: true, data: config });
});

// ============================
// Dashboard Interactions Route
// ============================
app.get("/api/interactions", async (req: Request, res: Response) => {
  const page = Math.max(1, Number(req.query.page ?? 1));
  const limit = Math.min(50, Math.max(1, Number(req.query.limit ?? 20)));
  const guildId = req.query.guildId as string | undefined;
  const commandName = req.query.commandName as string | undefined;
  const status = req.query.status as string | undefined;

  const where = {
    ...(guildId && { guildId }),
    ...(commandName && { commandName }),
    ...(status && { status: status as "PENDING" | "PROCESSED" | "FAILED" | "DEDUPLICATED" }),
  };

  const [interactions, total] = await Promise.all([
    prisma.interaction.findMany({
      where,
      include: { actions: true },
      orderBy: { receivedAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.interaction.count({ where }),
  ]);

  interactions.reverse(); // Return in ascending order (newest at the bottom)

  res.json({
    success: true,
    data: { interactions, total, page, limit, pages: Math.ceil(total / limit) },
  });
});

// ============================
// Fertilizers CRUD Routes
// ============================
app.get("/api/fertilizers", async (req: Request, res: Response) => {
  try {
    const fertilizers = await prisma.fertilizer.findMany({
      orderBy: { createdAt: "desc" },
    });
    res.json({ success: true, data: fertilizers });
  } catch (error) {
    res.status(500).json({ success: false, error: "Failed to fetch fertilizers" });
  }
});

app.post("/api/fertilizers", async (req: Request, res: Response) => {
  try {
    const { name, price, description, mainUsage, mainFunctionality, imageUrl } = req.body;
    const fertilizer = await prisma.fertilizer.create({
      data: {
        name,
        price: Number(price),
        description,
        mainUsage,
        mainFunctionality,
        imageUrl,
      },
    });
    res.json({ success: true, data: fertilizer });
  } catch (error) {
    res.status(500).json({ success: false, error: "Failed to create fertilizer" });
  }
});

app.put("/api/fertilizers/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, price, description, mainUsage, mainFunctionality, imageUrl } = req.body;
    const fertilizer = await prisma.fertilizer.update({
      where: { id },
      data: {
        name,
        price: Number(price),
        description,
        mainUsage,
        mainFunctionality,
        imageUrl,
      },
    });
    res.json({ success: true, data: fertilizer });
  } catch (error) {
    res.status(500).json({ success: false, error: "Failed to update fertilizer" });
  }
});

app.delete("/api/fertilizers/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await prisma.fertilizer.delete({ where: { id } });
    res.json({ success: true, data: { id } });
  } catch (error) {
    res.status(500).json({ success: false, error: "Failed to delete fertilizer" });
  }
});

// ============================
// Dashboard Logs SSE Route
// ============================
app.get("/api/logs/stream", async (req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders(); // flush headers to establish SSE connection

  const redisClient = new Redis(redisUrl);
  const redisSub = new Redis(redisUrl);

  try {
    const latestRaw = await redisClient.lrange("dashboard:logs:latest", 0, 19);
    const latest = latestRaw.map(r => JSON.parse(r)).reverse();
    res.write(`data: ${JSON.stringify({ type: "INITIAL", logs: latest })}\n\n`);
  } catch (err) {
    console.error("[sse] Failed to fetch initial logs", err);
  }

  redisSub.subscribe("dashboard:logs:pubsub", (err) => {
    if (err) console.error("[sse] Subscribe error:", err);
  });

  redisSub.on("message", (channel, message) => {
    if (channel === "dashboard:logs:pubsub") {
      try {
        const parsed = JSON.parse(message);
        res.write(`data: ${JSON.stringify({ type: "NEW_EVENT", log: parsed })}\n\n`);
      } catch (e) {
        console.error("[sse] JSON parse error on pubsub message", e);
      }
    }
  });

  req.on("close", () => {
    redisSub.quit();
    redisClient.quit();
  });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`> API Server running on port ${PORT}`);
});
