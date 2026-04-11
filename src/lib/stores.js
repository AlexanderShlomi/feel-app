// src/lib/stores.js — Legacy store surface bridged to FeelEngine (Svelte 5 runes) via toStore.
// Prefer getContext(FEEL_ENGINE_KEY) / getFeelEngine() in new code.

import { toStore, derived, writable } from 'svelte/store';
import { getFeelEngine, tryGetFeelEngine } from '$lib/engine/FeelEngine.svelte.js';
import { getFilterStyle as getFilterStylePure, getCssFilter as getCssFilterPure } from '$lib/engine/magnetPresentation.js';

export {
	EXTRA_MAGNET_PRICE,
	BASE_MAGNET_SIZE,
	SCALE_MIN,
	SCALE_MAX,
	SCALE_DEFAULT,
	SPLIT_MAGNET_SIZE,
	MULTI_MARGIN_PERCENT,
	SPLIT_MARGIN_PERCENT,
	MIN_GRID_BASE,
	PRODUCT_TYPES,
	PACKAGES
} from '$lib/engine/FeelEngine.svelte.js';

/** @type {import('svelte/store').Writable<any>} */
export let magnets = writable([]);
/** @type {import('svelte/store').Writable<any>} */
export let editorSettings = writable({});
/** @type {import('svelte/store').Writable<any>} */
export let cart = writable([]);
/** @type {import('svelte/store').Writable<any>} */
export let editingItemId = writable(null);
/** @type {import('svelte/store').Writable<any>} */
export let lastWorkspaceLayoutRefreshSignal = writable(0);
/** @type {import('svelte/store').Writable<boolean>} */
export let isGlobalLoading = writable(false);
/** @type {import('svelte/store').Writable<boolean>} */
export let isSyncing = writable(false);
/** @type {import('svelte/store').Writable<boolean>} */
export let isMobile = writable(false);
/** @type {import('svelte/store').Writable<boolean>} */
export let uploaderScrollActive = writable(false);

/** @type {import('svelte/store').Readable<number>} */
export let interactionDepth = writable(0);

/** @param {import('./engine/FeelEngine.svelte.js').FeelEngine} engine */
export function bindEngine(engine) {
	magnets = toStore(
		() => engine.magnets,
		(v) => engine.setMagnets(v)
	);
	editorSettings = toStore(
		() => engine.editorSettings,
		(v) => engine.setEditorSettings(v)
	);
	cart = toStore(
		() => engine.cart,
		(v) => engine.setCart(v)
	);
	editingItemId = toStore(
		() => engine.editingItemId,
		(v) => engine.setEditingItemId(v)
	);
	lastWorkspaceLayoutRefreshSignal = toStore(
		() => engine.lastWorkspaceLayoutRefreshSignal,
		(v) => {
			engine.lastWorkspaceLayoutRefreshSignal = v;
		}
	);
	isGlobalLoading = toStore(
		() => engine.isGlobalLoading,
		(v) => engine.setGlobalLoading(v)
	);
	isSyncing = toStore(
		() => engine.isSyncing,
		(v) => engine.setSyncing(v)
	);
	isMobile = toStore(
		() => engine.isMobile,
		(v) => {
			engine.isMobile = v;
		}
	);
	uploaderScrollActive = toStore(
		() => engine.uploaderScrollActive,
		(v) => engine.setUploaderScrollActive(v)
	);
	interactionDepth = toStore(
		() => engine.interactionDepth,
		(v) => engine.setInteractionDepth(v)
	);
	isBlockingUi = derived([isGlobalLoading, isSyncing], ([g, s]) => !!(g || s));
	cartTotal = derived(cart, ($cart) => $cart.reduce((total, item) => total + item.price, 0));
	cartCount = derived(cart, ($cart) => $cart.length);
	isUserInteracting = derived(interactionDepth, (n) => n > 0);
}

/** @type {import('svelte/store').Readable<boolean>} */
export let isUserInteracting = derived(interactionDepth, (n) => n > 0);

/** @type {import('svelte/store').Readable<number>} */
export let cartTotal = derived(cart, ($cart) => $cart.reduce((total, item) => total + item.price, 0));
/** @type {import('svelte/store').Readable<number>} */
export let cartCount = derived(cart, ($cart) => $cart.length);

/** @type {import('svelte/store').Readable<boolean>} */
export let isBlockingUi = derived([isGlobalLoading, isSyncing], ([g, s]) => !!(g || s));

export function getFilterStyle(effectId) {
	return getFilterStylePure(effectId);
}

export function getCssFilter(effectId) {
	return getCssFilterPure(effectId);
}

export function beginUserInteraction() {
	getFeelEngine().beginUserInteraction();
}

export function endUserInteraction() {
	getFeelEngine().endUserInteraction();
}

export function setUploaderScrollActive(active) {
	getFeelEngine().setUploaderScrollActive(active);
}

export function waitForUploaderScrollIdle(idleMs, timeoutMs) {
	return getFeelEngine().waitForUploaderScrollIdle(idleMs, timeoutMs);
}

export function bumpWorkspaceLayoutRefreshSignal() {
	getFeelEngine().bumpWorkspaceLayoutRefreshSignal();
}

export async function initApp() {
	const e = tryGetFeelEngine();
	if (e) await e.initApp();
}

export function calculatePrice(type, count) {
	return getFeelEngine().calculatePrice(type, count);
}

export async function saveWorkspaceToCart() {
	return getFeelEngine().saveWorkspaceToCart();
}

export async function editCartItem(itemId) {
	return getFeelEngine().editCartItem(itemId);
}

export async function removeCartItem(itemId) {
	await getFeelEngine().removeCartItem(itemId);
}

export function resetSystem(targetType) {
	return getFeelEngine().resetSystem(targetType);
}

export function getFullMagnetSize() {
	return getFeelEngine().getFullMagnetSize();
}

export function getMargin() {
	return getFeelEngine().getMargin();
}

export async function addUploadedMagnets(files) {
	return getFeelEngine().addUploadedMagnets(files);
}

export function updateMagnetProcessedSrc(id, eff, src) {
	getFeelEngine().updateMagnetProcessedSrc(id, eff, src);
}

export function updateMagnetTransform(id, tr) {
	getFeelEngine().updateMagnetTransform(id, tr);
}

export function updateMagnetActiveEffect(id, eff) {
	getFeelEngine().updateMagnetActiveEffect(id, eff);
}

export function undoWorkspace() {
	getFeelEngine().undo();
}

export function redoWorkspace() {
	getFeelEngine().redo();
}
