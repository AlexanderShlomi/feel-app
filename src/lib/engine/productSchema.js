/**
 * Generic product envelope for future product types (single source for save/sync).
 * @typedef {'magnets_pack' | 'mosaic' | 'gift' | string} ProductTypeId
 */

/** @typedef {{ zoom?: number, xPct?: number, yPct?: number, x?: number, y?: number, bgWidth?: number, bgHeight?: number, bgPosX?: number, bgPosY?: number }} TransformData */

/**
 * @typedef {Object} MagnetLike
 * @property {string} id
 * @property {string} [src]
 * @property {string} [originalSrc]
 * @property {number} [size]
 * @property {TransformData | null} [transform]
 * @property {boolean} [isSplitPart]
 * @property {boolean} [hidden]
 * @property {string} [activeEffectId]
 * @property {Record<string, string>} [processed]
 */

/**
 * @typedef {Object} MagnetRenderMetrics
 * @property {number} [frameSize]
 * @property {number} [naturalW]
 * @property {number} [naturalH]
 */

/**
 * Workspace item: every sellable/configuration unit carries stable identity + type + transform payload.
 * @typedef {Object} ProductWorkspaceItem
 * @property {string} id
 * @property {ProductTypeId} type
 * @property {TransformData} transformData
 * @property {MagnetLike} [magnet] — optional typed payload for magnet rows
 */

export {};
