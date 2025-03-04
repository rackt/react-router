const encoder = new TextEncoder();

export const sign = async (value: string, secret: string): Promise<string> => {
  let data = encoder.encode(value);
  let key = await createKey(secret, ["sign"]);
  let signature = await crypto.subtle.sign("HMAC", key, data);
  let hash = uint8ArrayToBase64(signature);

  return value + "." + hash;
};

export const unsign = async (
  cookie: string,
  secret: string
): Promise<string | false> => {
  let index = cookie.lastIndexOf(".");
  let value = cookie.slice(0, index);
  let hash = cookie.slice(index + 1);

  let data = encoder.encode(value);

  let key = await createKey(secret, ["verify"]);
  let signature = base64ToUint8Array(hash);
  let valid = await crypto.subtle.verify("HMAC", key, signature, data);

  return valid ? value : false;
};

// Originally taken from https://github.com/nadrama-com/simple-secure-webcrypto/blob/49bf711d8ad39e5be0d01d1407d19979bfde9269/src/index.ts#L49
export const encrypt = async (
  value: string,
  secret: string
): Promise<string> => {
  let data = encoder.encode(value);
  let key = await createKey(secret, ["encrypt"]);

  // generate a random 96 bit (12 byte) initilization vector
  // important: iv must never be reused with a given key.
  let iv = crypto.getRandomValues(new Uint8Array(12));
  // encrypt cookie to ciphertext
  let ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
    },
    key,
    data
  );

  // convert iv and ciphertext to base64-encoded strings
  let ivString = uint8ArrayToBase64(iv);
  let ciphertextString = uint8ArrayToBase64(ciphertext);
  return ivString + "." + ciphertextString;
};

export const decrypt = async (
  cookie: string,
  secret: string
): Promise<string | false> => {
  let index = cookie.lastIndexOf(".");
  let ivString = cookie.slice(0, index);
  let ciphertextString = cookie.slice(index + 1);

  let key = await createKey(secret, ["decrypt"]);

  // get iv and ciphertext
  let iv = base64ToUint8Array(ivString);
  if (iv.length !== 12) {
    throw new Error("Invalid IV length - must be 96 bits (12 bytes)");
  }
  let ciphertext = base64ToUint8Array(ciphertextString);
  if (ciphertext.length === 0) {
    throw new Error("Invalid ciphertext length - cannot be empty");
  }

  // decrypt ciphertext to plaintext
  let decrypted;
  try {
    decrypted = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: iv,
      },
      key,
      ciphertext
    );
  } catch (error) {
    if (error instanceof DOMException && error.name === "OperationError") {
      return false;
    }
  }

  let decoder = new TextDecoder();
  return decoder.decode(decrypted);
};

const createKey = async (
  secret: string,
  usages: CryptoKey["usages"]
): Promise<CryptoKey> => {
  if (usages.includes("encrypt") || usages.includes("decrypt")) {
    let key = encoder.encode(secret);
    if (key.length !== 32) {
      throw new Error(
        "Invalid secret key length - must be 256 bits (32 bytes)"
      );
    }

    return crypto.subtle.importKey(
      "raw",
      key,
      { name: "AES-GCM" },
      false,
      usages
    );
  } else {
    return crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      usages
    );
  }
};

function base64ToUint8Array(base64: string): Uint8Array {
  const byteString = atob(base64);

  let array = new Uint8Array(byteString.length);

  for (let i = 0; i < byteString.length; i++) {
    array[i] = byteString.charCodeAt(i);
  }

  return array;
}

function uint8ArrayToBase64(
  array: ArrayLike<number> | ArrayBufferLike
): string {
  return btoa(String.fromCharCode(...new Uint8Array(array))).replace(/=+$/, "");
}
