import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function loadEnvFromDotFile(path = '.env'): void {
  const envPath = resolve(process.cwd(), path);
  if (!existsSync(envPath)) {
    return;
  }

  const content = readFileSync(envPath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const equalsIndex = trimmed.indexOf('=');
    if (equalsIndex < 1) {
      continue;
    }

    const key = trimmed.slice(0, equalsIndex).trim();
    const rawValue = trimmed.slice(equalsIndex + 1);

    // Preserve explicitly exported shell vars; only fill gaps from .env.
    if (process.env[key] === undefined) {
      process.env[key] = stripQuotes(rawValue);
    }
  }
}
