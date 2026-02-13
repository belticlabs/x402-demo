#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const REQUIRED_ENV = [
  'OPENROUTER_API_KEY',
  'AGENT_PRIVATE_KEY',
  'RECIPIENT_WALLET_ADDRESS',
];

const PRIVATE_SUFFIXES = ['-private.pem', '.private.pem'];
const PUBLIC_SUFFIXES = ['-public.pem', '.public.pem'];

function parseEnv(envPath) {
  if (!existsSync(envPath)) return {};
  const out = {};
  const content = readFileSync(envPath, 'utf-8');

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index < 1) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
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

function extractStem(file, suffixes) {
  for (const suffix of suffixes) {
    if (file.endsWith(suffix)) {
      return file.slice(0, -suffix.length);
    }
  }
  return null;
}

function findKeyPair(belticDir) {
  if (!existsSync(belticDir)) return null;
  const files = readdirSync(belticDir);

  for (const file of files) {
    const stem = extractStem(file, PRIVATE_SUFFIXES);
    if (!stem) continue;
    const publicMatch = PUBLIC_SUFFIXES
      .map((suffix) => `${stem}${suffix}`)
      .find((candidate) => files.includes(candidate));

    if (publicMatch) {
      return {
        privateKey: join(belticDir, file),
        publicKey: join(belticDir, publicMatch),
      };
    }
  }

  return null;
}

function findCredential(cwd, belticDir) {
  const candidates = [
    join(cwd, '.beltic', 'agent-credential.jwt'),
    join(cwd, '.beltic', 'credential.jwt'),
    join(belticDir, 'agent-credential.jwt'),
    join(cwd, 'agent-credential.jwt'),
  ];

  return candidates.find((path) => existsSync(path)) || null;
}

function findBelticDir(cwd) {
  const candidates = [
    join(cwd, '.beltic'),
    join(cwd, '..', '.beltic'),
    join(cwd, '..', '..', '.beltic'),
  ];
  return candidates.find((path) => existsSync(path)) || join(cwd, '.beltic');
}

function main() {
  const cwd = process.cwd();
  const envPath = join(cwd, '.env');
  const envValues = { ...parseEnv(envPath), ...process.env };
  const issues = [];

  if (!existsSync(envPath)) {
    issues.push('Missing .env file. Run: cp .env.example .env');
  }

  for (const key of REQUIRED_ENV) {
    if (!envValues[key]) {
      issues.push(`Missing required env var: ${key}`);
    }
  }

  const agentPk = envValues.AGENT_PRIVATE_KEY || '';
  if (agentPk && !/^0x[a-fA-F0-9]{64}$/.test(agentPk)) {
    issues.push('AGENT_PRIVATE_KEY must be 0x-prefixed 64-byte hex');
  }

  const recipient = envValues.RECIPIENT_WALLET_ADDRESS || '';
  if (recipient && !/^0x[a-fA-F0-9]{40}$/.test(recipient)) {
    issues.push('RECIPIENT_WALLET_ADDRESS must be a 0x-prefixed EVM address');
  }

  const belticDir = findBelticDir(cwd);
  const keyPair = findKeyPair(belticDir);
  if (!keyPair) {
    issues.push(`No signing key pair found in ${belticDir}. Run: pnpm bootstrap:wizard-local`);
  }

  const credentialPath = findCredential(cwd, belticDir);
  if (!credentialPath) {
    issues.push('No agent credential JWT found. Run: pnpm bootstrap:wizard-local');
  }

  if (issues.length > 0) {
    console.error('Setup check failed:\n');
    for (const issue of issues) {
      console.error(`- ${issue}`);
    }
    process.exit(1);
  }

  console.log('Setup check passed.');
  if (keyPair) {
    console.log(`- Key pair: ${keyPair.privateKey} + ${keyPair.publicKey}`);
  }
  if (credentialPath) {
    console.log(`- Credential: ${credentialPath}`);
  }
}

main();
