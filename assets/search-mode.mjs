// One field takes a name or an idea. Any dot means a name or domain. Otherwise one to
// three words, at most 30 characters, made of letters, digits and name hyphens is a
// name. Everything else, including sentence punctuation, is an idea.
const nameWord = /^[\p{L}\p{N}\p{M}][\p{L}\p{N}\p{M}-]*$/u;

export function normalize(text) {
  return String(text ?? '').trim().replace(/\s+/g, ' ');
}

export function guessMode(text) {
  const value = normalize(text);
  if (!value) return null;
  if (value.includes('.')) return 'name';
  const words = value.split(' ');
  return words.length <= 3 && value.length <= 30 && words.every(word => nameWord.test(word)) ? 'name' : 'idea';
}
