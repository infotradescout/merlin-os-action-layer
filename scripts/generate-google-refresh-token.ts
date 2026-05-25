import { createInterface } from "node:readline";
import { google } from "googleapis";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { parse as parseUrl } from "node:url";
import { URLSearchParams } from "node:url";

type EnvBag = Record<string, string>;

const REQUIRED = {
  GOOGLE_CLIENT_ID: "GOOGLE_CLIENT_ID",
  GOOGLE_CLIENT_SECRET: "GOOGLE_CLIENT_SECRET",
  GOOGLE_REDIRECT_URI: "GOOGLE_REDIRECT_URI",
} as const;

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

function parseEnvFile(path = ".env"): EnvBag {
  if (!existsSync(path)) {
    return {};
  }
  const content = readFileSync(path, "utf8");
  const env: EnvBag = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const rawValue = trimmed.slice(eq + 1).trim();
    const value = rawValue.length > 1 && ((rawValue.startsWith('"') && rawValue.endsWith('"')) || (rawValue.startsWith("'") && rawValue.endsWith("'")))
      ? rawValue.slice(1, -1)
      : rawValue;
    env[key] = value;
  }
  return env;
}

function getEnvValue(key: string, envFromFile: EnvBag): string {
  return (process.env[key] ?? envFromFile[key] ?? "").trim();
}

function ask(question: string): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function printAuthUrl(authUrl: string) {
  console.log("\nOpen this URL in your browser and authorize the app:");
  console.log(authUrl);
  console.log("\nAfter authorization, paste the `code` value below.");
}

function parseCodeFromRedirectUri(redirectUri: string, input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";
  try {
    const parsed = new URL(trimmed);
    const code = parsed.searchParams.get("code");
    if (code) return code;
  } catch {
    // Ignore; treat input as raw code.
  }
  return trimmed;
}

async function waitForLocalCode(redirectUri: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let parsedPort = 0;
    try {
      parsedPort = Number.parseInt(new URL(redirectUri).port || "0", 10);
    } catch {
      parsedPort = 0;
    }
    if (!parsedPort) {
      return resolve("");
    }

    const server = createServer(async (req, res) => {
      if (!req.url) {
        res.statusCode = 400;
        res.end("Bad request");
        return;
      }
      const parsed = parseUrl(req.url, true);
      if (parsed.pathname !== "/") {
        res.statusCode = 404;
        res.end("Not found");
        return;
      }
      const code = Array.isArray(parsed.query.code)
        ? parsed.query.code[0]
        : parsed.query.code;
      if (typeof code === "string" && code.length > 0) {
        res.statusCode = 200;
        res.end("Authorization complete. You can close this window.");
        server.close();
        resolve(code);
      } else {
        const qs = new URLSearchParams({
          code: "",
          ...(parsed.query.error ? { error: String(parsed.query.error) } : {}),
        }).toString();
        res.statusCode = 400;
        res.end(`Missing code. callback params: ${qs}`);
      }
    });

    server.listen(parsedPort, "127.0.0.1", () => {
      console.log(`\nWaiting on callback at ${redirectUri}...`);
    });

    server.on("error", (err) => {
      reject(err);
    });
  });
}

async function main() {
  const fileEnv = parseEnvFile(".env");
  const missing: string[] = [];
  const clientId = getEnvValue(REQUIRED.GOOGLE_CLIENT_ID, fileEnv);
  const clientSecret = getEnvValue(REQUIRED.GOOGLE_CLIENT_SECRET, fileEnv);
  const redirectUri = getEnvValue(REQUIRED.GOOGLE_REDIRECT_URI, fileEnv);

  if (!clientId) missing.push(REQUIRED.GOOGLE_CLIENT_ID);
  if (!clientSecret) missing.push(REQUIRED.GOOGLE_CLIENT_SECRET);
  if (!redirectUri) missing.push(REQUIRED.GOOGLE_REDIRECT_URI);

  if (missing.length > 0) {
    console.error("Missing required env values:", missing.join(", "));
    process.exitCode = 1;
    return;
  }

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  const authUrl = oauth2.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [DRIVE_SCOPE],
  });

  printAuthUrl(authUrl);

  let code = "";
  if (redirectUri.includes("://localhost") || redirectUri.includes("://127.0.0.1")) {
    try {
      code = await waitForLocalCode(redirectUri);
    } catch (error) {
      console.warn("Local callback listener failed; please paste the returned code manually.");
    }
  }

  if (!code) {
    code = parseCodeFromRedirectUri(await ask("Enter authorization code: "), redirectUri);
  }
  if (!code) {
    console.error("No code supplied. Aborting.");
    process.exitCode = 1;
    return;
  }

  const { tokens } = await oauth2.getToken(code);
  const refreshToken = tokens.refresh_token;

  if (!refreshToken) {
    console.error("No refresh token received. Re-run with full authorization consent.");
    process.exitCode = 1;
    return;
  }

  console.log("\nGOOGLE_REFRESH_TOKEN=");
  console.log(refreshToken);
}

main().catch((error) => {
  console.error("Failed to generate refresh token:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
