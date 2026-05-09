/**
 * Public API for the @passman/core package.
 * Importers should pull from this entry point, not from sub-modules.
 */
export {
  buildRegistration,
  decryptVaultLogin,
  deriveLoginAuthKey,
  encryptVaultLogin,
  unlock,
  type EncodedVaultItem,
  type RegistrationPayload,
  type VaultSession,
} from "./account.js";

export {
  decryptBytes,
  decryptString,
  encryptBytes,
  encryptString,
  generateSymmetricKey,
  importAesKey,
} from "./crypto.js";

export { deriveAuthKey, deriveMasterKey } from "./kdf.js";

export {
  constantTimeEqual,
  fromBase64,
  randomBytes,
  toBase64,
  utf8Decode,
  utf8Encode,
} from "./encoding.js";

export {
  BLOB_VERSION,
  DEFAULT_KDF_PARAMS,
  type EncryptedBlob,
  type KdfParams,
  type Protocol,
  type VaultItemType,
  type VaultLoginPlaintext,
} from "./types.js";
