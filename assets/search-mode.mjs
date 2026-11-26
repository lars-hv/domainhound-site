// One field takes a name or an idea. Any dot means a name or domain. Otherwise one to
// three words, at most 30 characters, made of letters, digits and name hyphens is a
// name. Everything else, including sentence punctuation, is an idea.
const nameWord = /^[\p{L}\p{N}\p{M}][\p{L}\p{N}\p{M}-]*$/u;
const asciiLabel = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

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

// Leave registry support and Unicode conversion to the API.
export function validDomainForm(value) {
  const [first, ...suffix] = value.normalize('NFC').toLowerCase().replace(/\.$/, '').split('.');
  const name = first.trim();
  const ending = suffix.join('.');
  return value.length <= 253 && name.length > 0 && name.length <= 63 &&
    !/[\s/\\:@?#%]/u.test(name) && (!/^[\x00-\x7f]+$/.test(name) || asciiLabel.test(name)) &&
    (asciiLabel.test(ending) || ending === 'co.uk');
}
