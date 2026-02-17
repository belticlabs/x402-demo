#!/usr/bin/env node
/**
 * Export KYA signing keys as base64 for Vercel env vars.
 * Run from web/: node scripts/vercel-export-keys.mjs
 *
 * Outputs values to paste into Vercel → Project → Settings → Environment Variables.
 * Use KYA_SIGNING_PRIVATE_PEM and KYA_SIGNING_PUBLIC_PEM.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const webRoot = join(__dirname, '..');
const belticInWeb = join(webRoot, '.beltic');
const belticInParent = join(webRoot, '..', '.beltic');
const belticDir = existsSync(belticInWeb) ? belticInWeb : belticInParent;

const PRIVATE_SUFFIXES = ['-private.pem', '.private.pem'];
const PUBLIC_SUFFIXES = ['-public.pem', '.public.pem'];

function findKeyPair() {
  if (!existsSync(belticDir)) return null;
  const files = readdirSync(belticDir);
  for (const file of files) {
    const suffix = PRIVATE_SUFFIXES.find((s) => file.endsWith(s));
    if (!suffix) continue;
    const stem = file.slice(0, -suffix.length);
    const pubName = PUBLIC_SUFFIXES.map((s) => stem + s).find((n) => files.includes(n));
    if (pubName) {
      return {
        private: join(belticDir, file),
        public: join(belticDir, pubName),
      };
    }
  }
  return null;
}

const pair = findKeyPair();
if (!pair) {
  console.error('No key pair found. Run: pnpm bootstrap:wizard-local');
  process.exit(1);
}

const privatePem = readFileSync(pair.private, 'utf8').trim();
const publicPem = readFileSync(pair.public, 'utf8').trim();

const privateB64 = Buffer.from(privatePem, 'utf8').toString('base64');
const publicB64 = Buffer.from(publicPem, 'utf8').toString('base64');

console.log('# Paste these into Vercel Environment Variables:\n');
console.log('KYA_SIGNING_PRIVATE_PEM=base64:' + privateB64);
console.log('');
console.log('KYA_SIGNING_PUBLIC_PEM=base64:' + publicB64);
