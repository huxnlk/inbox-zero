import { env } from "@/env";

// Deployment policy for reading mail content into AI analysis.
// Checked before any provider read or model call.
export function isMailContentAiAllowed(emailAccountId: string): boolean {
  const setting = env.MAIL_CONTENT_AI_ALLOWED_ACCOUNTS?.trim();
  if (setting === undefined) return true;
  if (setting === "" || setting.toLowerCase() === "none") return false;
  return setting
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
    .includes(emailAccountId);
}
