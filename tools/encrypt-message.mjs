import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import { randomBytes, pbkdf2Sync, createCipheriv } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const plainPath = process.argv[2] || 'private/message.plain.txt';
const outputPath = process.argv[3] || 'home/odin/locked/message.txt';
const iterations = Number(process.env.ODIN_PBKDF2_ITERATIONS || 310000);

if (!existsSync(plainPath)) {
  console.error(`Plaintext file not found: ${plainPath}`);
  console.error('Usage: node tools/encrypt-message.mjs <plaintext-file> <output-file>');
  process.exit(1);
}

const rl = createInterface({ input, output });
const password = await rl.question('Password: ');
const confirm = await rl.question('Confirm password: ');
rl.close();

if (!password) {
  console.error('Password cannot be empty.');
  process.exit(1);
}

if (password !== confirm) {
  console.error('Password confirmation does not match.');
  process.exit(1);
}

const plaintext = readFileSync(plainPath);
const salt = randomBytes(16);
const iv = randomBytes(12);
const key = pbkdf2Sync(password, salt, iterations, 32, 'sha256');
const cipher = createCipheriv('aes-256-gcm', key, iv);
const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
const tag = cipher.getAuthTag();

const payload = {
  v: 1,
  alg: 'AES-256-GCM',
  kdf: 'PBKDF2-SHA256',
  iterations,
  salt: salt.toString('base64'),
  iv: iv.toString('base64'),
  tag: tag.toString('base64'),
  data: encrypted.toString('base64')
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
console.log(`Encrypted file written to ${outputPath}`);
