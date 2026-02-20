/**
 * @static3d/loader — loader types
 *
 * Re-exports loader-relevant types from @static3d/types,
 * and adds loader-internal types.
 */
export type {
  LoaderOptions,
  LoadOptions,
  LoadAllOptions,
  ProgressEvent,
  LoadError,
  AssetResult,
} from '@static3d/types';

/** loadAll の戻り値マップ */
export type AssetMap = Map<string, Blob>;
