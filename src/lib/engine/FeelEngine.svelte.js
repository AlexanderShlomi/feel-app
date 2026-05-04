// @ts-nocheck
import { tick } from 'svelte';
import { goto } from '$app/navigation';
import {
	saveStateToStorage,
	loadStateFromStorage,
	clearStorage,
	fileToBase64,
	base64ToBlobUrl,
	clearDataUrlBlobUrlCache
} from '$lib/utils/storage.js';
import { setItem, getItem } from '$lib/utils/idb.js';
import { computeMagnetPresentation } from '$lib/engine/magnetPresentation.js';

export const FEEL_ENGINE_KEY = Symbol('feel-engine');

export const EXTRA_MAGNET_PRICE = 10;
export const BASE_MAGNET_SIZE = 150;
export const SCALE_MIN = 1.35;
export const SCALE_MAX = 2.16;
export const SCALE_DEFAULT = 1.44;
export const SPLIT_MAGNET_SIZE = BASE_MAGNET_SIZE * 1.15;
export const MULTI_MARGIN_PERCENT = 0.1;
export const SPLIT_MARGIN_PERCENT = 0.015;
export const MIN_GRID_BASE = 3;

export const PRODUCT_TYPES = {
	MAGNETS_PACK: 'magnets_pack',
	MOSAIC: 'mosaic',
	GIFT: 'gift'
};

export const PACKAGES = [
	{ count: 9, price: 119, name: 'FEEL Moments' },
	{ count: 12, price: 139, name: 'FEEL Story' },
	{ count: 15, price: 159, name: 'FEEL Collection', recommended: true },
	{ count: 24, price: 239, name: 'FEEL Gallery' },
	{ count: 30, price: 289, name: 'FEEL Life' }
];

const CART_DB_KEY = 'feel_cart_db_v1';
const HISTORY_MAX = 20;

/** @type {import('./FeelEngine.svelte.js').FeelEngine | null} */
let engineInstance = null;

export function getFeelEngine() {
	if (!engineInstance) {
		throw new Error('FeelEngine: not initialized');
	}
	return engineInstance;
}

export function tryGetFeelEngine() {
	return engineInstance;
}

function checkIsMobile() {
	return typeof window !== 'undefined' ? window.innerWidth <= 768 : false;
}

function isMobileViewportNow() {
	try {
		return typeof window !== 'undefined' && window.innerWidth <= 768;
	} catch {
		return false;
	}
}

export class FeelEngine {
	// --- Core state (single source of truth) ---
	magnets = $state([]);
	editorSettings = $state({
		currentProductType: PRODUCT_TYPES.MAGNETS_PACK,
		currentDisplayScale: SCALE_DEFAULT,
		isSurfaceDark: false,
		currentEffect: 'original',
		surfaceMinHeight: '100%',
		splitImageSrc: null,
		splitImageRatio: 1,
		gridBaseSize: 3,
		splitTransform: { zoom: 1, x: 0, y: 0, xPct: 0, yPct: 0 },
		splitImageCache: {},
		giftImage: null
	});
	cart = $state([]);
	editingItemId = $state(null);
	lastWorkspaceLayoutRefreshSignal = $state(0);
	interactionDepth = $state(0);
	uploaderScrollActive = $state(false);
	isGlobalLoading = $state(false);
	isSyncing = $state(false);
	isMobile = $state(false);
	/** Per-magnet render metrics for pixel-perfect CSS (frame + natural size) */
	magnetMetrics = $state({});

	undoStack = $state(/** @type {string[][]} */ ([]));
	redoStack = $state(/** @type {string[][]} */ ([]));

	_historySuspended = false;

	/** @type {Array<{ id: string, rawUrl: string, nextUrl: string }>} */
	queuedNormalizeSwaps = [];
	flushQueuedNormalizeSwapsTimer = /** @type {ReturnType<typeof setTimeout> | null} */ (null);
	UPLOADER_IDLE_FLUSH_MS = 420;

	saveTimeout = /** @type {ReturnType<typeof setTimeout> | null} */ (null);
	saveInFlight = false;
	saveQueued = false;
	lastSaveAt = 0;

	_cartPersistChain = Promise.resolve();

	constructor() {
		if (typeof window !== 'undefined') {
			this.isMobile = checkIsMobile();
			window.addEventListener('resize', () => {
				this.isMobile = checkIsMobile();
			});
			localStorage.removeItem('feel_cart');
			localStorage.removeItem('feel_cart_v2');
			localStorage.removeItem('feel_cart_v3');
			getItem(CART_DB_KEY).then((savedCart) => {
				if (savedCart && Array.isArray(savedCart)) {
					this.cart = savedCart;
				}
			});
		}
	}

	// --- Presentation (derived in engine) ---
	getMagnetPresentation(magnet) {
		const m = this.magnetMetrics[magnet.id];
		return computeMagnetPresentation(magnet, m, this.lastWorkspaceLayoutRefreshSignal);
	}

	reportMagnetMetrics(id, metrics) {
		this.magnetMetrics = {
			...this.magnetMetrics,
			[id]: { ...(this.magnetMetrics[id] || {}), ...metrics }
		};
	}

	clearMagnetMetrics(id) {
		if (!this.magnetMetrics[id]) return;
		const next = { ...this.magnetMetrics };
		delete next[id];
		this.magnetMetrics = next;
	}

	// --- Undo / redo ---
	_snapshotMagnets() {
		return JSON.stringify(this.magnets);
	}
	_applyMagnetsSnapshot(json) {
		this.magnets = JSON.parse(json);
	}
	pushHistorySnapshot() {
		if (this._historySuspended) return;
		const snap = this._snapshotMagnets();
		const last = this.undoStack[this.undoStack.length - 1];
		if (last === snap) return;
		const nextUndo = [...this.undoStack, snap];
		if (nextUndo.length > HISTORY_MAX) nextUndo.shift();
		this.undoStack = nextUndo;
		this.redoStack = [];
	}
	undo() {
		if (this.undoStack.length < 2) return;
		const current = this._snapshotMagnets();
		const prev = this.undoStack[this.undoStack.length - 2];
		this.redoStack = [...this.redoStack, current];
		this.undoStack = this.undoStack.slice(0, -1);
		this._historySuspended = true;
		this._applyMagnetsSnapshot(prev);
		this._historySuspended = false;
	}
	redo() {
		if (this.redoStack.length === 0) return;
		const next = this.redoStack[this.redoStack.length - 1];
		this.redoStack = this.redoStack.slice(0, -1);
		this.pushHistorySnapshot();
		this._historySuspended = true;
		this._applyMagnetsSnapshot(next);
		this._historySuspended = false;
	}

	// --- Interaction / scroll ---
	get isUserInteracting() {
		return this.interactionDepth > 0;
	}
	beginUserInteraction() {
		this.interactionDepth = this.interactionDepth + 1;
	}
	endUserInteraction() {
		this.interactionDepth = Math.max(0, this.interactionDepth - 1);
	}

	setUploaderScrollActive(active) {
		if (!isMobileViewportNow()) return;
		this.uploaderScrollActive = !!active;
		if (!active) this.scheduleFlushQueuedNormalizeSwaps(this.UPLOADER_IDLE_FLUSH_MS);
	}

	scheduleFlushQueuedNormalizeSwaps(delayMs = 260) {
		if (this.flushQueuedNormalizeSwapsTimer) clearTimeout(this.flushQueuedNormalizeSwapsTimer);
		this.flushQueuedNormalizeSwapsTimer = setTimeout(() => {
			this.flushQueuedNormalizeSwapsTimer = null;
			this.flushQueuedNormalizeSwaps();
		}, Math.max(0, delayMs));
	}

	enqueueNormalizeSwap(id, rawUrl, nextUrl) {
		const MAX_QUEUE = 48;
		this.queuedNormalizeSwaps.push({ id, rawUrl, nextUrl });
		if (this.queuedNormalizeSwaps.length > MAX_QUEUE) {
			const evicted = this.queuedNormalizeSwaps.splice(0, this.queuedNormalizeSwaps.length - MAX_QUEUE);
			for (const s of evicted) {
				try {
					if (typeof s.nextUrl === 'string' && s.nextUrl.startsWith('blob:')) URL.revokeObjectURL(s.nextUrl);
				} catch {}
			}
		}
	}

	flushQueuedNormalizeSwaps() {
		if (!this.queuedNormalizeSwaps.length) return;
		if (this.uploaderScrollActive) {
			this.scheduleFlushQueuedNormalizeSwaps(this.UPLOADER_IDLE_FLUSH_MS);
			return;
		}
		const batch = this.queuedNormalizeSwaps;
		this.queuedNormalizeSwaps = [];
		for (const s of batch) {
			let used = false;
			try {
				this.magnets = this.magnets.map((m) => {
					if (m.id !== s.id) return m;
					if (m.originalSrc !== s.rawUrl) return m;
					used = true;
					return { ...m, originalSrc: s.nextUrl, src: s.nextUrl };
				});
			} catch {
				used = false;
			}
			if (used) {
				setTimeout(() => {
					try {
						if (typeof s.rawUrl === 'string' && s.rawUrl.startsWith('blob:')) URL.revokeObjectURL(s.rawUrl);
					} catch {}
				}, 400);
			} else {
				try {
					if (typeof s.nextUrl === 'string' && s.nextUrl.startsWith('blob:')) URL.revokeObjectURL(s.nextUrl);
				} catch {}
				try {
					if (typeof s.rawUrl === 'string' && s.rawUrl.startsWith('blob:')) URL.revokeObjectURL(s.rawUrl);
				} catch {}
			}
		}
	}

	async waitForUploaderScrollIdle(idleMs = this.UPLOADER_IDLE_FLUSH_MS, timeoutMs = 3000) {
		if (typeof window === 'undefined') return true;
		if (!isMobileViewportNow()) return true;
		if (!this.uploaderScrollActive) return true;
		return new Promise((resolve) => {
			let idleTimer = null;
			let timeoutTimer = null;
			let done = false;
			const check = () => {
				if (this.uploaderScrollActive) {
					if (idleTimer) {
						clearTimeout(idleTimer);
						idleTimer = null;
					}
					return;
				}
				if (idleTimer) clearTimeout(idleTimer);
				idleTimer = setTimeout(() => {
					if (done) return;
					done = true;
					cleanup();
					resolve(true);
				}, idleMs);
			};
			const interval = setInterval(() => check(), 50);
			function cleanup() {
				clearInterval(interval);
				if (idleTimer) clearTimeout(idleTimer);
				if (timeoutTimer) clearTimeout(timeoutTimer);
			}
			timeoutTimer = setTimeout(() => {
				if (done) return;
				done = true;
				cleanup();
				resolve(false);
			}, Math.max(250, timeoutMs));
		});
	}

	bumpWorkspaceLayoutRefreshSignal() {
		this.lastWorkspaceLayoutRefreshSignal = Date.now();
	}

	// --- Mutators: magnets ---
	setMagnets(next) {
		this.magnets = typeof next === 'function' ? next(this.magnets) : next;
	}
	updateMagnetProcessedSrc(id, eff, src) {
		this.pushHistorySnapshot();
		this.magnets = this.magnets.map((m) => {
			if (m.id !== id) return m;
			const MAX_EFFECT_BLOBS_PER_MAGNET = 2;
			const processed = { ...(m.processed || {}) };
			const order = Array.isArray(m.processedOrder) ? [...m.processedOrder] : [];
			const nextOrder = order.filter((k) => k !== eff);
			nextOrder.push(eff);
			const prev = processed?.[eff];
			if (prev && prev !== src && typeof prev === 'string' && prev.startsWith('blob:')) {
				try {
					URL.revokeObjectURL(prev);
				} catch {}
			}
			processed[eff] = src;
			const blobKeys = nextOrder.filter((k) => typeof processed[k] === 'string' && processed[k].startsWith('blob:'));
			while (blobKeys.length > MAX_EFFECT_BLOBS_PER_MAGNET) {
				const evictEff = blobKeys.shift();
				const evictVal = processed[evictEff];
				if (typeof evictVal === 'string' && evictVal.startsWith('blob:')) {
					try {
						URL.revokeObjectURL(evictVal);
					} catch {}
				}
				delete processed[evictEff];
				const idx = nextOrder.indexOf(evictEff);
				if (idx >= 0) nextOrder.splice(idx, 1);
			}
			return { ...m, processed, processedOrder: nextOrder };
		});
	}
	applyTransform(id, tr) {
		const nextTransform = { ...tr };
		this.pushHistorySnapshot();
		this.magnets = this.magnets.map((m) => (m.id === id ? { ...m, transform: nextTransform } : { ...m }));
	}
	updateMagnetTransform(id, tr) {
		this.applyTransform(id, tr);
	}
	updateMagnetActiveEffect(id, eff) {
		this.pushHistorySnapshot();
		this.magnets = this.magnets.map((m) => (m.id === id ? { ...m, activeEffectId: eff } : m));
	}

	async addUploadedMagnets(files) {
		const list = Array.from(files || []);
		if (!list.length) return;
		this.pushHistorySnapshot();
		const pending = list.map((f) => {
			const id = crypto.randomUUID();
			const url = URL.createObjectURL(f);
			return {
				id,
				magnet: {
					id,
					transform: { zoom: 1 },
					position: { x: 0, y: 0 },
					size: this.getFullMagnetSize(),
					originalSrc: url,
					src: url,
					activeEffectId: 'original',
					isSplitPart: false,
					hidden: false,
					processed: {}
				}
			};
		});
		this.magnets = [...this.magnets, ...pending.map((p) => p.magnet)];
	}

	setEditorSettings(next) {
		this.editorSettings = typeof next === 'function' ? next(this.editorSettings) : next;
	}

	setCart(next) {
		this.cart = typeof next === 'function' ? next(this.cart) : next;
	}

	setEditingItemId(id) {
		this.editingItemId = id;
	}

	setGlobalLoading(v) {
		this.isGlobalLoading = v;
	}

	setSyncing(v) {
		this.isSyncing = v;
	}

	setInteractionDepth(n) {
		this.interactionDepth = n;
	}

	getFullMagnetSize() {
		return BASE_MAGNET_SIZE * (this.editorSettings.currentDisplayScale || SCALE_DEFAULT);
	}
	getMargin() {
		return this.getFullMagnetSize() * MULTI_MARGIN_PERCENT;
	}

	calculatePrice(type, count) {
		if (type === PRODUCT_TYPES.MAGNETS_PACK) {
			if (count < 9) return 0;
			const reversed = [...PACKAGES].reverse();
			const base = reversed.find((p) => count >= p.count) || PACKAGES[0];
			return base.price + (count - base.count) * EXTRA_MAGNET_PRICE;
		} else if (type === PRODUCT_TYPES.MOSAIC) {
			return PACKAGES[0].price + Math.max(0, count - 9) * EXTRA_MAGNET_PRICE;
		}
		return 0;
	}

	scheduleIdle(fn, timeoutMs = 2000) {
		if (typeof window === 'undefined') return;
		const ric = window.requestIdleCallback;
		if (typeof ric === 'function') {
			ric(() => fn(), { timeout: timeoutMs });
		} else {
			setTimeout(fn, Math.min(250, timeoutMs));
		}
	}

	getAutosaveDelayMs() {
		try {
			return typeof window !== 'undefined' && window.innerWidth <= 768 ? 8000 : 2000;
		} catch {
			return 2000;
		}
	}

	async runAutosaveOnce() {
		if (this.saveInFlight) {
			this.saveQueued = true;
			return;
		}
		if (this.isUserInteracting) {
			this.saveQueued = true;
			return;
		}
		const now = Date.now();
		if (now - this.lastSaveAt < 1200) {
			this.saveQueued = true;
			return;
		}
		this.saveInFlight = true;
		this.saveQueued = false;
		try {
			const currentMagnets = this.magnets;
			if (currentMagnets.length > 0 || this.editorSettings.splitImageSrc) {
				await saveStateToStorage(currentMagnets, this.editorSettings, this.editingItemId);
				this.lastSaveAt = Date.now();
			}
		} finally {
			this.saveInFlight = false;
			if (this.saveQueued) {
				this.scheduleIdle(() => this.runAutosaveOnce(), 2500);
			}
		}
	}

	triggerAutoSave() {
		if (typeof window === 'undefined') return;
		if (this.saveTimeout) clearTimeout(this.saveTimeout);
		const delay = this.getAutosaveDelayMs();
		this.saveTimeout = setTimeout(() => {
			this.scheduleIdle(() => this.runAutosaveOnce(), 2500);
		}, delay);
	}

	async persistCartToIDB() {
		await setItem(CART_DB_KEY, this.cart);
	}

	/** Atomic handshake: persist cart + tick */
	async ackPersistCart() {
		await this.persistCartToIDB();
		await tick();
	}

	async resetSystem(targetType = PRODUCT_TYPES.MAGNETS_PACK) {
		try {
			this.uploaderScrollActive = false;
		} catch {}
		try {
			if (this.flushQueuedNormalizeSwapsTimer) clearTimeout(this.flushQueuedNormalizeSwapsTimer);
			this.flushQueuedNormalizeSwapsTimer = null;
		} catch {}
		try {
			if (Array.isArray(this.queuedNormalizeSwaps) && this.queuedNormalizeSwaps.length) {
				for (const s of this.queuedNormalizeSwaps) {
					try {
						if (typeof s?.nextUrl === 'string' && s.nextUrl.startsWith('blob:')) URL.revokeObjectURL(s.nextUrl);
					} catch {}
					try {
						if (typeof s?.rawUrl === 'string' && s.rawUrl.startsWith('blob:')) URL.revokeObjectURL(s.rawUrl);
					} catch {}
				}
			}
			this.queuedNormalizeSwaps = [];
		} catch {}
		try {
			this.interactionDepth = 0;
		} catch {}
		try {
			sessionStorage.removeItem('feel_uploader_scroll_v1');
		} catch {}

		const currentList = this.magnets;
		if (currentList.length > 0)
			currentList.forEach((m) => {
				if (m.originalSrc?.startsWith('blob:')) URL.revokeObjectURL(m.originalSrc);
				if (m.src?.startsWith('blob:')) URL.revokeObjectURL(m.src);
				if (m.processed) {
					Object.values(m.processed).forEach((v) => {
						if (typeof v === 'string' && v.startsWith('blob:')) URL.revokeObjectURL(v);
					});
				}
			});
		this.magnets = [];
		this.editingItemId = null;
		const s = this.editorSettings;
		if (s.splitImageSrc?.startsWith('blob:')) URL.revokeObjectURL(s.splitImageSrc);
		if (s.giftImage?.startsWith('blob:')) URL.revokeObjectURL(s.giftImage);
		if (s.splitImageCache) {
			Object.values(s.splitImageCache).forEach((v) => {
				if (typeof v === 'string' && v.startsWith('blob:')) URL.revokeObjectURL(v);
			});
		}
		this.editorSettings = {
			currentProductType: targetType,
			currentDisplayScale: SCALE_DEFAULT,
			surfaceMinHeight: '100%',
			isSurfaceDark: false,
			splitImageSrc: null,
			splitImageRatio: 1,
			gridBaseSize: 3,
			currentEffect: 'original',
			splitTransform: { zoom: 1, x: 0, y: 0, xPct: 0, yPct: 0 },
			splitImageCache: {},
			giftImage: null
		};
		this.magnetMetrics = {};
		this.undoStack = [];
		this.redoStack = [];
		try {
			clearDataUrlBlobUrlCache();
		} catch {}
		await clearStorage();
	}

	async initApp() {
		if (typeof window === 'undefined') return;
		if (window.location.pathname.includes('/uploader')) {
			const state = await loadStateFromStorage();
			if (state) {
				this.magnets = state.magnets;
				this.editorSettings = state.settings;
				if (state.editingItemId) this.editingItemId = state.editingItemId;
			}
		}
	}

	/**
	 * Save workspace to cart — handshake: cart + workspace clear + tick.
	 * Does NOT navigate; caller must goto('/select') after await.
	 */
	async saveWorkspaceToCart() {
		const currentMagnets = this.magnets;
		const settings = this.editorSettings;
		const editId = this.editingItemId;
		const type = settings.currentProductType;
		const count = currentMagnets.filter((m) => !m.hidden).length;

		if (type !== PRODUCT_TYPES.GIFT && !editId && type === PRODUCT_TYPES.MAGNETS_PACK && count < 9) {
			return false;
		}

		this.setGlobalLoading(true);
		this.setSyncing(true);
		try {
			const serializeImg = async (src) => {
				if (src && src.startsWith('blob:')) {
					try {
						const blob = await fetch(src).then((r) => r.blob());
						return await fileToBase64(blob);
					} catch (e) {
						return src;
					}
				}
				return src;
			};

			const serializeMagnets = async (list) => {
				return Promise.all(
					list.map(async (m) => {
						if (type === PRODUCT_TYPES.MOSAIC) return { ...m, originalSrc: null, src: null, processed: {} };
						let safeSrc = m.originalSrc || m.src;
						if (safeSrc && safeSrc.startsWith('blob:')) {
							try {
								const blob = await fetch(safeSrc).then((r) => r.blob());
								safeSrc = await fileToBase64(blob);
							} catch (e) {}
						}
						return { ...m, originalSrc: safeSrc, src: safeSrc, processed: {} };
					})
				);
			};

			if (type !== PRODUCT_TYPES.GIFT) {
				const price = this.calculatePrice(type, count);
				const magnetsForCart = await serializeMagnets(currentMagnets);
				const settingsForCart = JSON.parse(JSON.stringify(settings));
				if (settingsForCart.splitImageSrc) {
					settingsForCart.splitImageSrc = await serializeImg(settings.splitImageSrc);
				}
				const mainItem = {
					id: editId || crypto.randomUUID(),
					type: type,
					timestamp: Date.now(),
					count: count,
					price: price,
					data: { magnets: magnetsForCart, settings: settingsForCart },
					previewImage:
						type === PRODUCT_TYPES.MOSAIC ? settingsForCart.splitImageSrc : magnetsForCart[0]?.src,
					title: type === PRODUCT_TYPES.MOSAIC ? 'פסיפס זכרונות' : 'מגנטים בודדים',
					subtitle:
						type === PRODUCT_TYPES.MOSAIC
							? `${settings.gridBaseSize}x${Math.round(count / settings.gridBaseSize)} חלקים`
							: `${count} תמונות`
				};
				if (editId) {
					this.cart = this.cart.map((i) => (i.id === editId ? mainItem : i));
				} else {
					this.cart = [...this.cart, mainItem];
				}
			}

			if (settings.giftImage) {
				const safeGiftImage = await serializeImg(settings.giftImage);
				const isEditingGift = type === PRODUCT_TYPES.GIFT && editId;
				const giftId = isEditingGift ? editId : crypto.randomUUID();
				const giftItem = {
					id: giftId,
					type: PRODUCT_TYPES.GIFT,
					timestamp: Date.now(),
					count: 1,
					price: 0,
					previewImage: safeGiftImage,
					title: 'מתנה: תמונה מעוצבת',
					subtitle: 'מגנט בגודל 5x5 מתנה',
					data: {
						settings: { ...settings, giftImage: safeGiftImage, currentProductType: PRODUCT_TYPES.GIFT }
					}
				};
				let cleanItems = this.cart.filter((i) => i.type !== PRODUCT_TYPES.GIFT || i.id === giftId);
				const existingIndex = cleanItems.findIndex((i) => i.id === giftId);
				if (existingIndex >= 0) {
					cleanItems[existingIndex] = giftItem;
					this.cart = cleanItems;
				} else {
					this.cart = [...cleanItems, giftItem];
				}
			}

			await this.persistCartToIDB();
			await this.resetSystem(PRODUCT_TYPES.MAGNETS_PACK);
			await tick();
			return true;
		} catch (e) {
			console.error('Save error:', e);
			return false;
		} finally {
			this.setSyncing(false);
			this.setGlobalLoading(false);
		}
	}

	async editCartItem(itemId) {
		const cartItems = this.cart;
		const item = cartItems.find((i) => i.id === itemId);
		if (!item) return;

		this.setGlobalLoading(true);
		this.setSyncing(true);
		try {
			const hydrateMagnetsPack = async (list) => {
				return Promise.all(
					list.map(async (m) => {
						let validSrc = m.originalSrc;
						if (validSrc && validSrc.startsWith('data:')) validSrc = await base64ToBlobUrl(validSrc);
						return { ...m, originalSrc: validSrc, src: validSrc, processed: {} };
					})
				);
			};

			if (item.type === PRODUCT_TYPES.GIFT) {
				await this.resetSystem(PRODUCT_TYPES.GIFT);
				let giftImg = item.data.settings.giftImage;
				if (giftImg && giftImg.startsWith('data:')) giftImg = await base64ToBlobUrl(giftImg);
				this.editorSettings = {
					...this.editorSettings,
					giftImage: giftImg,
					currentProductType: PRODUCT_TYPES.GIFT
				};
			} else {
				const hydratedSettings = JSON.parse(JSON.stringify(item.data.settings));
				if (hydratedSettings.splitImageSrc?.startsWith('data:')) {
					hydratedSettings.splitImageSrc = await base64ToBlobUrl(hydratedSettings.splitImageSrc);
				}
				const existingGiftInCart = cartItems.find((i) => i.type === PRODUCT_TYPES.GIFT);
				if (existingGiftInCart) {
					let gImg = existingGiftInCart.data.settings.giftImage;
					if (gImg?.startsWith('data:')) gImg = await base64ToBlobUrl(gImg);
					hydratedSettings.giftImage = gImg;
				}
				this.editorSettings = hydratedSettings;
				let recoveredMagnets;
				if (item.type === PRODUCT_TYPES.MOSAIC) {
					recoveredMagnets = item.data.magnets.map((m) => ({
						...m,
						src: hydratedSettings.splitImageSrc,
						originalSrc: hydratedSettings.splitImageSrc,
						processed: {}
					}));
				} else {
					recoveredMagnets = await hydrateMagnetsPack(item.data.magnets);
				}
				this.magnets = recoveredMagnets;
			}
			this.editingItemId = itemId;
			await saveStateToStorage(this.magnets, this.editorSettings, itemId);
			await tick();
			await goto('/uploader');
		} catch (e) {
			console.error('Error editing item', e);
		} finally {
			this.setSyncing(false);
			this.setGlobalLoading(false);
		}
	}

	async removeCartItem(itemId) {
		this.cart = this.cart.filter((i) => i.id !== itemId);
		if (this.editingItemId === itemId) {
			this.editingItemId = null;
			await this.resetSystem(PRODUCT_TYPES.MAGNETS_PACK);
		}
	}
}

/**
 * @returns {FeelEngine}
 */
export function createFeelEngine() {
	const e = new FeelEngine();
	engineInstance = e;
	return e;
}
