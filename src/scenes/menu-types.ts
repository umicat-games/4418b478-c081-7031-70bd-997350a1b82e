// Shared model types for the unified menu (MenuScene) — GameScene owns the model +
// publishes it via the registry; MenuScene renders it. (Formerly declared in the now-
// deleted MailboxScene/OrderBookScene.)

/** A Mail-tab list row (icon + sender + read state). */
export interface MailListEntry { id: string; sender: string; title: string; iconFrame: number; read: boolean; }

/** A Shop-tab catalog entry (an orderable item with its buy price). */
export interface OrderCatalogEntry { id: string; label: string; iconKey: string; iconFrame: string | number; price: number; ordered?: number; }
