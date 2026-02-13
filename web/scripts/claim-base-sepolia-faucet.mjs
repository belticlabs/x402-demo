#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { generateJwt } from "@coinbase/cdp-sdk/auth";
import { privateKeyToAccount } from "viem/accounts";

const API_HOST = "api.cdp.coinbase.com";
const API_PATH = "/platform/v2/evm/faucet";
const API_URL = `https://${API_HOST}${API_PATH}`;
const NETWORK = "base-sepolia";

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {};

  const content = readFileSync(filePath, "utf8");
  const out = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const firstEq = line.indexOf("=");
    if (firstEq < 1) continue;

    const key = line.slice(0, firstEq).trim();
    let value = line.slice(firstEq + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    out[key] = value;
  }

  return out;
}

function withEnvFile() {
  const envPath = resolve(process.cwd(), ".env");
  return { ...parseEnvFile(envPath), ...process.env };
}

function validatePrivateKey(value) {
  return /^0x[a-fA-F0-9]{64}$/.test(value || "");
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function claimOnce(token, address) {
  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      address,
      network: NETWORK,
      token: "eth",
    }),
  });

  let payload = null;
  const text = await response.text();
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text || null;
  }

  return { status: response.status, payload };
}

async function main() {
  const env = withEnvFile();
  const apiKeyId = env.CDP_API_KEY_ID;
  const apiKeySecret = env.CDP_API_KEY_SECRET;
  const rawPk = env.AGENT_PRIVATE_KEY;

  if (!apiKeyId || !apiKeySecret) {
    throw new Error("Missing CDP_API_KEY_ID or CDP_API_KEY_SECRET in environment.");
  }
  if (!validatePrivateKey(rawPk)) {
    throw new Error("AGENT_PRIVATE_KEY is missing or invalid (expected 0x + 64 hex chars).");
  }

  const address = privateKeyToAccount(rawPk).address;
  const delayMs = Number(env.FAUCET_DELAY_MS || 2500);
  const maxAttempts = Number(env.FAUCET_MAX_ATTEMPTS || 2000);
  const rateLimitSleepMs = Number(env.FAUCET_RATE_LIMIT_SLEEP_MS || 30000);
  const maxRateLimitRetries = Number(env.FAUCET_MAX_RATE_LIMIT_RETRIES || 30);
  const maxRuntimeMs = Number(env.FAUCET_MAX_RUNTIME_MS || 60 * 60 * 1000);

  console.log(`Target address: ${address}`);
  console.log(`Network: ${NETWORK}`);
  console.log(`Delay: ${delayMs}ms, Max attempts: ${maxAttempts}`);
  console.log(
    `Rate-limit sleep: ${rateLimitSleepMs}ms, Max 429 retries: ${maxRateLimitRetries}`
  );

  let successCount = 0;
  let attempt = 0;
  let doneReason = "unknown";
  let rateLimitRetries = 0;
  const startedAt = Date.now();

  while (attempt < maxAttempts && Date.now() - startedAt < maxRuntimeMs) {
    attempt += 1;

    const jwt = await generateJwt({
      apiKeyId,
      apiKeySecret,
      requestMethod: "POST",
      requestHost: API_HOST,
      requestPath: API_PATH,
      expiresIn: 120,
    });

    const { status, payload } = await claimOnce(jwt, address);

    if (status >= 200 && status < 300) {
      successCount += 1;
      console.log(
        `[${attempt}] claim ok (#${successCount}) ${JSON.stringify(payload)}`
      );
      await sleep(delayMs);
      continue;
    }

    if (status === 429) {
      const errorType =
        payload && typeof payload === "object" ? payload.errorType : undefined;

      if (errorType === "faucet_limit_exceeded") {
        doneReason = "hit faucet allocation limit for current window";
        console.log(`[${attempt}] stop: ${doneReason}`);
        console.log(`Response: ${JSON.stringify(payload)}`);
        break;
      }

      if (errorType === "rate_limit_exceeded") {
        rateLimitRetries += 1;
        if (rateLimitRetries > maxRateLimitRetries) {
          doneReason = `too many rate-limit retries (${maxRateLimitRetries})`;
          console.log(`[${attempt}] stop: ${doneReason}`);
          console.log(`Response: ${JSON.stringify(payload)}`);
          break;
        }

        const sleepMs = Math.min(
          rateLimitSleepMs * rateLimitRetries,
          5 * 60 * 1000
        );
        console.log(
          `[${attempt}] throttled (${rateLimitRetries}/${maxRateLimitRetries}), sleeping ${sleepMs}ms`
        );
        console.log(`Response: ${JSON.stringify(payload)}`);
        await sleep(sleepMs);
        continue;
      }

      doneReason = "stopped on unknown 429 response";
      console.log(`[${attempt}] stop: ${doneReason}`);
      console.log(`Response: ${JSON.stringify(payload)}`);
      break;
    }

    rateLimitRetries = 0;
    doneReason = `stopped on HTTP ${status}`;
    console.log(`[${attempt}] stop: ${doneReason}`);
    console.log(`Response: ${JSON.stringify(payload)}`);
    break;
  }

  if (attempt >= maxAttempts) {
    doneReason = `reached max attempts (${maxAttempts}) before explicit limit response`;
  }
  if (Date.now() - startedAt >= maxRuntimeMs && doneReason === "unknown") {
    doneReason = `reached max runtime (${maxRuntimeMs}ms)`;
  }

  console.log("---");
  console.log(`Attempts: ${attempt}`);
  console.log(`Successful claims: ${successCount}`);
  console.log(`Result: ${doneReason}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
