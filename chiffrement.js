// Chiffrement des données publiées, avec l'API Web Crypto du navigateur (HTTPS ou localhost obligatoire).
// Mot de passe -> clé : PBKDF2-SHA256, 600 000 itérations (recommandation OWASP), sel aléatoire de 16 octets.
// Données : JSON compressé en gzip, puis chiffré en AES-GCM 256 bits avec un vecteur d'initialisation aléatoire de 12 octets.
const Chiffrement = (() => {
  const FORMAT = 'carto-randonnees/chiffre', VERSION = 1, ITERATIONS = 600000;
  const te = new TextEncoder();

  function b64(bytes){
    let s = '';
    for(let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function unb64(s){
    const bin = atob(s), out = new Uint8Array(bin.length);
    for(let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  async function pipe(bytes, stream){
    return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
  }
  async function key(password, salt, iterations){
    const base = await crypto.subtle.importKey('raw', te.encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({name:'PBKDF2', hash:'SHA-256', salt, iterations}, base,
      {name:'AES-GCM', length:256}, false, ['encrypt', 'decrypt']);
  }

  async function encrypt(obj, password){
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const plain = await pipe(te.encode(JSON.stringify(obj)), new CompressionStream('gzip'));
    const ct = new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM', iv}, await key(password, salt, ITERATIONS), plain));
    return {
      format: FORMAT, version: VERSION,
      kdf: {name:'PBKDF2', hash:'SHA-256', iterations:ITERATIONS, salt:b64(salt)},
      cipher: {name:'AES-GCM', iv:b64(iv)},
      compression: 'gzip',
      data: b64(ct)
    };
  }

  // Erreur avec code 'BAD_PASSWORD' si le mot de passe est faux (AES-GCM refuse de déchiffrer)
  async function decrypt(env, password){
    if(env?.format !== FORMAT || env.version !== VERSION) throw new Error('Fichier de données dans un format inconnu.');
    const k = await key(password, unb64(env.kdf.salt), env.kdf.iterations);
    let plain;
    try{ plain = new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM', iv:unb64(env.cipher.iv)}, k, unb64(env.data))); }
    catch(e){ const err = new Error('Mot de passe incorrect.'); err.code = 'BAD_PASSWORD'; throw err; }
    return JSON.parse(new TextDecoder().decode(await pipe(plain, new DecompressionStream('gzip'))));
  }

  return {encrypt, decrypt};
})();
