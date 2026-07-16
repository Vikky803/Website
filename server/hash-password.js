#!/usr/bin/env node
/**
 * Generates a salted PBKDF2 hash for a new dashboard access code.
 *
 * Usage:
 *   node hash-password.js "yourNewPassword"
 *
 * Copy the printed value into .env as SEAT_1_HASH / SEAT_2_HASH / SEAT_3_HASH.
 */
const crypto = require('crypto');

const password = process.argv[2];

if (!password) {
  console.error('Usage: node hash-password.js "yourPassword"');
  process.exit(1);
}

const salt = crypto.randomBytes(16).toString('hex');
const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');

console.log('\nAdd this to your .env file:\n');
console.log(`${salt}:${hash}`);
console.log('');
