// Rotaciona os bits de um valor à direita
function rightRotate(value, amount) {
  return (value >>> amount) | (value << (32 - amount));
}

// Criptografa uma string usando a função hash SHA-256 puramente em JavaScript
export function hashPassword(ascii) {
  if (!ascii) return '';
  
  const mathPow = Math.pow;
  const maxWord = 0xffffffff;
  const lengthProperty = 'length';
  let i, j;

  let result = '';

  const words = [];
  const asciiLength = ascii[lengthProperty] * 8;
  
  let hash = [], k = [];
  let primeCounter = 0;

  const isPrime = (n) => {
    for (let factor = 2; factor * factor <= n; factor++) {
      if (n % factor === 0) return false;
    }
    return true;
  };

  let candidate = 2;
  while (primeCounter < 64) {
    if (isPrime(candidate)) {
      if (primeCounter < 8) {
        hash[primeCounter] = (mathPow(candidate, 1/2) * 0x100000000) | 0;
      }
      k[primeCounter] = (mathPow(candidate, 1/3) * 0x100000000) | 0;
      primeCounter++;
    }
    candidate++;
  }

  ascii += '\x80';
  while (ascii[lengthProperty] % 64 - 56) {
    ascii += '\x00';
  }
  for (i = 0; i < ascii[lengthProperty]; i++) {
    j = ascii.charCodeAt(i);
    if (j > 255) return null;
    words[i >> 2] |= j << (24 - (i % 4) * 8);
  }
  words[words[lengthProperty]] = ((asciiLength / 0x100000000) | 0);
  words[words[lengthProperty]] = (asciiLength | 0);

  for (j = 0; j < words[lengthProperty]; j += 16) {
    const w = words.slice(j, j + 16);
    const oldHash = hash.slice(0);

    hash = hash.slice(0);
    
    for (i = 0; i < 64; i++) {
      const wItem = w[i];
      const s0 = rightRotate(w[i - 15], 7) ^ rightRotate(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rightRotate(w[i - 2], 17) ^ rightRotate(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      const wVal = i >= 16 ? (w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0) : wItem;

      const a = hash[0], e = hash[4];
      const temp1 = (hash[7] + (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25)) + ((e & hash[5]) ^ (~e & hash[6])) + k[i] + wVal) | 0;
      const temp2 = ((rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22)) + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]))) | 0;

      hash = [(temp1 + temp2) | 0].concat(hash);
      hash[4] = (hash[4] + temp1) | 0;
      hash.length = 8;
    }
    
    for (i = 0; i < 8; i++) {
      hash[i] = (hash[i] + oldHash[i]) | 0;
    }
  }
  
  for (i = 0; i < 8; i++) {
    const val = hash[i];
    const hex = (val >>> 0).toString(16);
    result += ('00000000' + hex).slice(-8);
  }
  return result;
}
