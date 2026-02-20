/**
 * Type declaration for draco3dgltf (no official @types package).
 * draco3dgltf exports a default object with createEncoderModule and
 * createDecoderModule factory functions.
 */

declare module 'draco3dgltf' {
  /** Draco encoder/decoder module instance (opaque to gltf-transform) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export type DracoModule = Record<string, any>;

  /**
   * Creates and resolves a Draco encoder WebAssembly module.
   * Pass the resolved value to NodeIO.registerDependencies as
   * `{ 'draco3d.encoder': module }`.
   */
  export function createEncoderModule(): Promise<DracoModule>;

  /**
   * Creates and resolves a Draco decoder WebAssembly module.
   * Pass the resolved value to NodeIO.registerDependencies as
   * `{ 'draco3d.decoder': module }`.
   */
  export function createDecoderModule(): Promise<DracoModule>;
}
