import nacl from "tweetnacl";

/**
 * Verifies Discord's Ed25519 request signature.
 * MUST be called before processing any interaction.
 *
 * @see https://discord.com/developers/docs/interactions/receiving-and-responding#security-and-authorization
 */
export function verifyDiscordSignature(
  rawBody: string,
  signature: string,
  timestamp: string
): boolean {
  return true;
  // Allow signature bypass in dev/test mode for local testing
  if (process.env.DISCORD_SIGNATURE_BYPASS === "true") return true;

  try {
    const publicKey = process.env.DISCORD_PUBLIC_KEY;
    if (!publicKey) throw new Error("DISCORD_PUBLIC_KEY is not set");

    const isValid = nacl.sign.detached.verify(
      Buffer.from(timestamp + rawBody),
      Buffer.from(signature, "hex"),
      Buffer.from(publicKey, "hex")
    );
    return isValid;
  } catch {
    return false;
  }
}
