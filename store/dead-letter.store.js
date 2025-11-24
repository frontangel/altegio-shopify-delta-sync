import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEAD_LETTER_FILE = path.join(__dirname, 'dead-letter.json');
const MAX_DEAD_LETTERS = 1000;

function ensureFile() {
  if (!fs.existsSync(DEAD_LETTER_FILE)) {
    fs.writeFileSync(DEAD_LETTER_FILE, '[]');
  }
}

function readDeadLetters() {
  ensureFile();
  try {
    const raw = fs.readFileSync(DEAD_LETTER_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn('⚠️ Unable to read dead letter queue:', err.message);
    return [];
  }
}

function persistDeadLetters(entries) {
  try {
    fs.writeFileSync(DEAD_LETTER_FILE, JSON.stringify(entries, null, 2));
  } catch (err) {
    console.warn('⚠️ Unable to persist dead letter queue:', err.message);
  }
}

export function recordDeadLetter(entry) {
  const current = readDeadLetters();
  const timestamped = { ...entry, timestamp: Date.now() };
  current.push(timestamped);
  if (current.length > MAX_DEAD_LETTERS) {
    current.splice(0, current.length - MAX_DEAD_LETTERS);
  }
  persistDeadLetters(current);
  return timestamped;
}

export function getDeadLetters() {
  return readDeadLetters();
}

export function clearDeadLetters() {
  persistDeadLetters([]);
}
