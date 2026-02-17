#!/usr/bin/env node
/**
 * Output base64-encoded PEM keys for Vercel env vars.
 * Run: pnpm vercel:export-keys
 * Paste each output into KYA_SIGNING_PRIVATE_PEM and KYA_SIGNING_PUBLIC_PEM.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const belticDir = path.resolve(__dirname, '..', '..', '.beltic');

if (!fs.existsSync(belticDir)) {
  console.error('No .beltic directory found. Run: pnpm bootstrap:wizard-local');
  process.exit(1);
}

const files = fs.readdirSync(belticDir);
const privFile = files.find((f) => f.endsWith('-private.pem'));
const pubFile = files.find((f) => f.endsWith('-public.pem'));

if (!privFile || !pubFile) {
  console.error('Expected *-private.pem and *-public.pem in .beltic/');
  process.exit(1);
}

const privPem = fs.readFileSync(path.join(belticDir, privFile), 'utf8');
const pubPem = fs.readFileSync(path.join(belticDir, pubFile), 'utf8');

console.log('Copy these into Vercel Environment Variables:\n');
console.log('KYA_SIGNING_PRIVATE_PEM=');
console.log(Buffer.from(privPem, 'utf8').toString('base64'));
console.log('\nKYA_SIGNING_PUBLIC_PEM=');
console.log(Buffer.from(pubPem, 'utf8').toString('base64'));
