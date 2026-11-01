/**
 * HTTP API contract shared by apps/api and apps/mobile.
 * All money fields are integer pence (`...Pence`). All timestamps are ISO-8601 UTC strings.
 * See docs/API.md for the endpoint list and error codes.
 */
import type { Tier } from './packs.ts';

// ---------------------------------------------------------------------------
// Common
// ---------------------------------------------------------------------------

export type ErrorCode =
  | 'bad_request'
  | 'validation_failed'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'insufficient_funds'
  | 'pack_unavailable'
  | 'sold_out'
  | 'spend_limit_reached'
  | 'cooling_off'
  | 'underage'
  | 'email_taken'
  | 'invalid_credentials'
  | 'invalid_state'
  | 'rate_limited'
  | 'payments_unavailable'
  | 'internal';

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    /** Per-field messages for validation_failed. */
    fields?: Record<string, string>;
  };
}

export interface AppConfig {
  currency: 'GBP';
  /** Buyback offer as basis points of current market value (9000 = 90%). */
  buybackBps: number;
  maxOpenQuantity: number;
  shipping: {
    /** Flat fee charged per shipment. */
    flatFeePence: number;
    /** Shipments whose cards are worth at least this much ship free. null = never free. */
    freeOverPence: number | null;
    maxItemsPerShipment: number;
    countries: string[]; // ISO 3166-1 alpha-2, e.g. ["GB"]
  };
  topup: {
    minPence: number;
    maxPence: number;
    presetsPence: number[];
    /** Real card payments via Stripe Checkout are configured. */
    stripeEnabled: boolean;
    /** Development-only instant top-ups are enabled (never in production). */
    devTopupsEnabled: boolean;
  };
  withdrawals: {
    enabled: boolean;
    minPence: number;
  };
  minimumAge: number;
}

// ---------------------------------------------------------------------------
// Users & auth
// ---------------------------------------------------------------------------

export type Role = 'user' | 'admin';

export interface UserStats {
  packsOpened: number;
  /** Cards currently in the vault (status = vaulted). */
  cardsInVault: number;
  /** Current market value of vaulted cards. */
  vaultValuePence: number;
  /** Highest value at pull of any card ever pulled. 0 if none. */
  biggestPullPence: number;
  totalSpentPence: number;
}

export interface SpendLimits {
  /** Max pack spend in any rolling 24h. null = no limit. */
  dailySpendLimitPence: number | null;
  /** A higher limit waiting for its 24h cool-down; applied automatically at pendingEffectiveAt. */
  pendingDailySpendLimitPence: number | null;
  pendingEffectiveAt: string | null;
  /** Pack spend in the last 24h. */
  spentLast24hPence: number;
  /** Player chose a break; no top-ups or pack opening until then. */
  coolingOffUntil: string | null;
}

export interface Me {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  balancePence: number;
  createdAt: string;
  stats: UserStats;
  limits: SpendLimits;
}

export interface RegisterRequest {
  email: string;
  /** 8+ characters. */
  password: string;
  displayName: string;
  /** YYYY-MM-DD. Player must be at least AppConfig.minimumAge. */
  dateOfBirth: string;
  acceptTerms: true;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface AuthResponse {
  token: string;
  user: Me;
}

export interface UpdateMeRequest {
  displayName?: string;
}

export interface UpdateLimitsRequest {
  /** Set or clear the daily pack-spend limit. Lowering applies now; raising/clearing waits 24h. */
  dailySpendLimitPence?: number | null;
  /** Start a break of this many days (cannot be undone early). */
  coolOffDays?: 1 | 7 | 30;
}

// ---------------------------------------------------------------------------
// Cards & packs
// ---------------------------------------------------------------------------

export interface CardSummary {
  id: string; // pokemontcg.io id, e.g. "sv3pt5-199"
  name: string;
  setName: string;
  number: string;
  rarity: string;
  imageSmall: string;
  imageLarge: string;
  marketValuePence: number;
  tier: Tier;
}

export interface PackTheme {
  /** Gradient start/end colours for the pack art, hex like "#1d4ed8". */
  from: string;
  to: string;
  /** Accent colour for labels and glow. */
  accent: string;
}

export interface PackSummary {
  id: string; // slug, e.g. "starter"
  name: string;
  tagline: string;
  pricePence: number;
  minPullPence: number;
  maxPullPence: number;
  /** Chance a single pull is worth at least the pack price (0..1). */
  hitChance: number;
  cardCount: number;
  theme: PackTheme;
  /** Highest-value cards, for the pack art (max 3, value descending). */
  featuredCards: CardSummary[];
  /** True when any card in the odds table is out of stock; the pack cannot be opened. */
  soldOut: boolean;
}

export interface OddsRow {
  card: CardSummary;
  weight: number;
  /** weight / totalWeight (0..1). */
  chance: number;
}

export interface PackDetail extends PackSummary {
  revisionId: number;
  totalWeight: number;
  /** Sorted by card value descending. */
  odds: OddsRow[];
}

export interface OpenPackRequest {
  /** 1..AppConfig.maxOpenQuantity. Each pack holds one card. */
  quantity: number;
  /** Optional per-request client seed override is NOT supported; change it via /fairness/rotate. */
}

export interface Pull {
  openingId: string;
  inventoryItemId: string;
  card: CardSummary;
  /** Market value at the moment of the pull. */
  valuePence: number;
  /** What selling back right now would credit. */
  buybackPence: number;
  nonce: number;
  roll: number;
}

export interface OpenPackResponse {
  batchId: string;
  pack: { id: string; name: string; pricePence: number };
  quantity: number;
  totalCostPence: number;
  pulls: Pull[];
  balancePence: number;
  fairness: {
    serverSeedHash: string;
    clientSeed: string;
    revisionId: number;
  };
}

// ---------------------------------------------------------------------------
// Inventory (the vault)
// ---------------------------------------------------------------------------

export type InventoryStatus = 'vaulted' | 'shipping' | 'shipped' | 'sold';

export type InventorySort = 'value_desc' | 'value_asc' | 'newest' | 'oldest';

export interface InventoryItem {
  id: string;
  card: CardSummary;
  status: InventoryStatus;
  valueAtPullPence: number;
  /** Same as card.marketValuePence; repeated for convenience. */
  currentValuePence: number;
  /** Sell-back offer right now (only meaningful while vaulted). */
  buybackPence: number;
  acquiredAt: string;
  packId: string | null;
  shipmentId: string | null;
  soldForPence: number | null;
  soldAt: string | null;
}

export interface InventoryResponse {
  items: InventoryItem[];
  /** Total current market value of the returned items. */
  totalValuePence: number;
  /** Total buyback offer for the returned vaulted items. */
  totalBuybackPence: number;
}

export interface SellRequest {
  itemIds: string[];
}

export interface SellResponse {
  soldCount: number;
  creditedPence: number;
  balancePence: number;
  items: InventoryItem[];
}

// ---------------------------------------------------------------------------
// Wallet
// ---------------------------------------------------------------------------

export type TransactionType =
  | 'topup'
  | 'pack_purchase'
  | 'buyback'
  | 'shipping_fee'
  | 'shipping_refund'
  | 'withdrawal'
  | 'withdrawal_reversal'
  | 'adjustment';

export interface Transaction {
  id: string;
  type: TransactionType;
  /** Signed: credits positive, debits negative. */
  amountPence: number;
  balanceAfterPence: number;
  description: string;
  reference: string | null;
  createdAt: string;
}

export interface WalletResponse {
  balancePence: number;
  transactions: Transaction[];
  /** Pass as ?before= to load older transactions; null when there are none. */
  nextCursor: string | null;
}

export interface TopupRequest {
  amountPence: number;
}

export type TopupResponse =
  | { kind: 'checkout'; paymentId: string; checkoutUrl: string }
  | { kind: 'credited'; paymentId: string; balancePence: number };

export type WithdrawalStatus = 'pending' | 'paid' | 'rejected';

export interface Withdrawal {
  id: string;
  amountPence: number;
  status: WithdrawalStatus;
  /** Free text the player gave (e.g. PayPal email). Masked in lists after creation. */
  payoutDetails: string;
  adminNote: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WithdrawalRequest {
  amountPence: number;
  payoutDetails: string;
}

export interface WithdrawalResponse {
  withdrawal: Withdrawal;
  balancePence: number;
}

// ---------------------------------------------------------------------------
// Shipping
// ---------------------------------------------------------------------------

export interface Address {
  id: string;
  fullName: string;
  line1: string;
  line2: string | null;
  city: string;
  region: string | null;
  postcode: string;
  country: string; // ISO alpha-2
  phone: string | null;
  createdAt: string;
}

export type AddressInput = Omit<Address, 'id' | 'createdAt'>;

export type ShipmentStatus = 'requested' | 'processing' | 'shipped' | 'delivered' | 'cancelled';

export interface Shipment {
  id: string;
  status: ShipmentStatus;
  feePence: number;
  itemCount: number;
  totalValuePence: number;
  items: InventoryItem[];
  address: AddressInput;
  carrier: string | null;
  trackingNumber: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ShippingQuoteResponse {
  itemCount: number;
  totalValuePence: number;
  feePence: number;
}

export interface CreateShipmentRequest {
  itemIds: string[];
  addressId: string;
}

export interface CreateShipmentResponse {
  shipment: Shipment;
  balancePence: number;
}

export interface CancelShipmentResponse {
  shipment: Shipment;
  balancePence: number;
}

// ---------------------------------------------------------------------------
// Fairness & history
// ---------------------------------------------------------------------------

export interface RevealedSeed {
  serverSeed: string;
  serverSeedHash: string;
  clientSeed: string;
  /** Nonces used with this seed pair were 0 .. finalNonce - 1. */
  finalNonce: number;
  revealedAt: string;
}

export interface FairnessState {
  serverSeedHash: string;
  clientSeed: string;
  /** Next nonce to be used. */
  nonce: number;
  revealed: RevealedSeed[];
}

export interface RotateSeedRequest {
  /** New client seed; a random one is generated when omitted. */
  clientSeed?: string;
}

export interface RotateSeedResponse {
  revealed: RevealedSeed;
  current: FairnessState;
}

export interface Opening {
  id: string;
  batchId: string;
  pack: { id: string; name: string };
  pricePence: number;
  card: CardSummary;
  valuePence: number;
  inventoryItemId: string;
  revisionId: number;
  serverSeedHash: string;
  /** Present once the seed has been rotated (revealed). */
  serverSeed: string | null;
  clientSeed: string;
  nonce: number;
  roll: number;
  createdAt: string;
}

export interface OpeningsResponse {
  openings: Opening[];
  nextCursor: string | null;
}

export interface VerifyOpeningResponse {
  opening: Opening;
  /** The odds table used for this opening (immutable revision). */
  entries: { cardId: string; weight: number }[];
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

export interface AdminUpdateShipmentRequest {
  status: ShipmentStatus;
  carrier?: string | null;
  trackingNumber?: string | null;
}

export interface AdminUpdateWithdrawalRequest {
  status: 'paid' | 'rejected';
  adminNote?: string;
}

export interface AdminSetOddsRequest {
  entries: { cardId: string; weight: number }[];
}

export interface AdminPackReport {
  pack: PackDetail;
  evPence: number;
  rtp: number;
  maxRtp: number;
  opened: number;
  revenuePence: number;
  paidOutValuePence: number;
}

export interface PriceSyncReport {
  updated: number;
  unchanged: number;
  missing: string[];
  errors: string[];
  deactivatedPacks: string[];
  source: 'cardmarket' | 'tcgplayer';
  finishedAt: string;
}

// ---------------------------------------------------------------------------
// Seed data files (apps/api/seed/*.json)
// ---------------------------------------------------------------------------

export interface SeedCard {
  id: string;
  name: string;
  setId: string;
  setName: string;
  number: string;
  rarity: string;
  imageSmall: string;
  imageLarge: string;
  /** Placeholder value until `npm run prices:sync` runs. */
  marketValuePence: number;
  /** Physical copies on hand. null = not tracked. */
  stock: number | null;
}

export interface SeedPack {
  id: string;
  name: string;
  tagline: string;
  pricePence: number;
  sortOrder: number;
  theme: PackTheme;
  entries: { cardId: string; weight: number }[];
}
