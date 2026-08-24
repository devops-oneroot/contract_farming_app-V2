const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:5000';

export type Role = 'farmer' | 'agronomist' | 'senior_agronomist';

/**
 * A senior agronomist does everything an agronomist does, and additionally
 * answers disease reports. Anywhere asking "is this an agronomist?" must use
 * this rather than comparing to 'agronomist'.
 */
export const isAgronomist = (role?: Role) =>
  role === 'agronomist' || role === 'senior_agronomist';
export const isSenior = (role?: Role) => role === 'senior_agronomist';

export type Farmer = {
  _id: string;
  name: string;
  mobile: string;
  location: { latitude: number | null; longitude: number | null };
  createdAt: string;
  /** Corners in this farmer's saved farm boundary; 0 when they have none yet. */
  geofenceCount?: number;
  /** Crops this farmer has; 0 when none have been added yet. */
  cropCount?: number;
  /**
   * Where this farm is: centre of the drawn boundary, else the registered
   * location. Null when neither exists. Used for distance sorting and the map.
   */
  farmPoint?: { latitude: number; longitude: number } | null;
  /**
   * The agronomist who registered this farmer in the field. Null when an admin
   * added them from the dashboard — i.e. the farmer was assigned, not onboarded.
   *
   * An id from the agronomist-scoped endpoint, but the whole-roster one
   * populates it. Read it through `onboarderId` / `onboarderName` rather than
   * comparing it directly, or the comparison silently fails on one of them.
   */
  onboardedBy?: string | AgronomistRef | null;
  /**
   * The day the admin dashboard wants this farmer visited, set when they were
   * added or handed over there. Null when no date was given — the visit is
   * still expected, just not by a particular day.
   */
  visitDate?: string | null;
  /**
   * How this farmer reached us, asked when an agronomist registered them. Null
   * on farmers added from the dashboard and on anyone registered before this
   * was collected. A random visit to them is stamped with it.
   */
  referredBy?: VisitSource | null;
  /** Village/taluk/district/state of the farm. */
  farmAddress?: FarmAddress;
  /** True when the address above was typed in by hand rather than geocoded. */
  farmAddressManual?: boolean;
  /** Photo of the farmer, taken at onboarding. Empty when none was captured. */
  photoUrl?: string;
  /** When this farmer is next due a visit. Null when nothing is owed. */
  nextFollowUpAt?: string | null;
  /** Why that follow-up was scheduled. */
  followUpNote?: string;
  /** Set when the agronomist decided this farmer needed no visit. */
  skippedAt?: string | null;
  skipReason?: string;
};

/**
 * Where the farm is. Normally reverse-geocoded from the drawn boundary, but an
 * agronomist can type it in when the geocoder gets a rural village wrong — see
 * `farmAddressManual`.
 */
export type FarmAddress = {
  village: string;
  taluk: string;
  district: string;
  state: string;
  geocodedAt?: string | null;
};

/** A farmer sitting in the trash — hidden from every list, but not deleted. */
export type TrashedFarmer = {
  _id: string;
  name: string;
  mobile: string;
  createdAt: string;
  /** When they were moved to the trash. */
  deletedAt: string;
  /** Crops that come back with them on restore. */
  cropCount: number;
  daysInTrash: number;
  /** Advisory only — nothing is deleted when this reaches zero. */
  daysLeft: number;
};

export type AgronomistRef = { _id: string; name: string; mobile: string };

/** The id of whoever registered a farmer, whichever shape the endpoint sent. */
export const onboarderId = (f: { onboardedBy?: string | AgronomistRef | null }) =>
  typeof f.onboardedBy === 'string' ? f.onboardedBy : (f.onboardedBy?._id ?? null);

/** Their name, when the endpoint populated it. Empty otherwise. */
export const onboarderName = (f: { onboardedBy?: string | AgronomistRef | null }) =>
  typeof f.onboardedBy === 'string' ? '' : (f.onboardedBy?.name ?? '');

/** One result from a place search: a real, geocoded location to pick from. */
export type PlaceHit = {
  /** The full name, so the right one is recognisable by its surroundings. */
  label: string;
  latitude: number;
  longitude: number;
  village: string;
  taluk: string;
  district: string;
  state: string;
};

/**
 * Someone else at the FPO. Only the name is required — an agronomist meeting
 * four people will not always come away with four phone numbers.
 */
export type FpoMember = {
  name: string;
  mobile: string;
  designation: string;
};

/**
 * An FPO an agronomist has onboarded: a named representative, their role, and
 * the scale of what they handle.
 *
 * Distinct from `Fbo` below, which despite its older name is also an FPO — but
 * only as a lookup tag a farmer is filed under. Both read "FPO" on screen; the
 * `Fbo` identifier survives because `/api/fbos` and its collection are already
 * live and renaming them needs a migration.
 */
export type Fpo = {
  _id: string;
  name: string;
  mobile: string;
  role: string;
  photoUrl: string;
  /** Other people at the same FPO. Empty when only one contact was taken. */
  members: FpoMember[];
  crops: string[];
  /** As stated by them on the day — a claim, not a count we can verify. */
  farmerCount: number;
  location: { latitude: number | null; longitude: number | null };
  /** Whether the pin is where the agent stood, or a place they searched for. */
  locationSource?: 'gps' | 'search' | '';
  /** Reverse-geocoded from `location`, never typed. Blank if it could not be read. */
  address: FarmAddress;
  /**
   * The agronomist who onboarded this FPO.
   *
   * Populated by the list endpoint, an id elsewhere — read it through
   * `fpoOwnerName` rather than comparing it directly, or the comparison
   * silently fails on one of them.
   */
  agronomist: string | AgronomistRef | null;
  createdAt: string;
};

/** Who onboarded an FPO, when the endpoint populated it. Empty otherwise. */
export const fpoOwnerName = (f: { agronomist: string | AgronomistRef | null }) =>
  typeof f.agronomist === 'string' || !f.agronomist ? '' : (f.agronomist.name ?? '');

/** Their id, whichever shape came back. */
export const fpoOwnerId = (f: { agronomist: string | AgronomistRef | null }) =>
  typeof f.agronomist === 'string' ? f.agronomist : (f.agronomist?._id ?? null);

/**
 * One page of FPOs. `total` and `totals` describe everything the filter
 * matches, not just `items`, so a count does not have to be recomputed — or
 * worse, grow — as more pages arrive.
 */
export type FpoPage = {
  items: Fpo[];
  total: number;
  totals: { farmers: number };
  page: number;
  limit: number;
  hasMore: boolean;
};

/**
 * The FPO a farmer belongs to — shown as "FPO" everywhere in the app.
 *
 * The type, the endpoint and the collection are still named `fbo` from when
 * this was called a Farmer Business Organisation. Renaming them would mean a
 * data migration and would collide with `/api/fpos`, which the onboarding
 * feature above already owns.
 */
export type Fbo = {
  _id: string;
  name: string;
  village?: string;
  district?: string;
};

/**
 * A window to narrow a list by registration date. Sent as full ISO instants,
 * so the caller's local day boundaries are the ones the server applies.
 */
export type DateRange = { from: Date; to: Date };

/**
 * How an agent's day is going right now.
 *
 * `no_field` is a day accounted for, not a missing one — the agent said why
 * they stayed in — so it is deliberately not folded into `not_started`.
 */
export type TeamStatus = 'working' | 'paused' | 'ended' | 'no_field' | 'not_started';

/** One agronomist's day, as a senior sees it on the team screen. */
export type TeamMember = {
  _id: string;
  name: string;
  mobile: string;
  role: Role;
  photoUrl: string;
  onboarded: number;
  visits: number;
  lastVisitAt: string | null;
  sales: number;
  salesValue: number;
  distanceKm: number;
  startedAt: string | null;
  endedAt: string | null;
  status: TeamStatus;
  /** Why they stayed in. Only set when `status` is 'no_field'. */
  noFieldReason: string;
  /** Their last GPS fix of the day. Null when they never tracked. */
  lastSeen: { latitude: number; longitude: number; at: string } | null;
  reportFiled: boolean;
  reportAt: string | null;
  /**
   * The places they worked in today, named — normally taken from the addresses
   * of the farms they visited, onboarded or sold to.
   */
  areas: string[];
  /**
   * True when `areas` came from their last GPS fix instead, because none of the
   * farms they dealt with had an address on file. Worth saying on screen: it is
   * where the phone was, not a farm recorded as being there.
   */
  areasFromGps?: boolean;
};

export type TeamDay = {
  date: string;
  team: TeamMember[];
  totals: {
    people: number;
    /** Out in the field right now — the number a senior looks for first. */
    active: number;
    onboarded: number;
    visits: number;
    sales: number;
    salesValue: number;
    distanceKm: number;
    reportsFiled: number;
    /** Every place the team worked in today, each named once. */
    areas: string[];
  };
};

/**
 * Force a paged response into the envelope shape, whatever came back.
 *
 * A backend that predates paging ignores `page`/`limit` and returns a bare
 * array. Reading `.items` off that gives `undefined`, which does NOT throw at
 * the call site — it throws later, mid-render, when something does
 * `list.length`. A red screen in a field, caused by a deploy going out in the
 * wrong order.
 *
 * Normalising here means the worst case is one unpaged page of results, which
 * is exactly what that older server was going to send anyway.
 */
function asPage<T>(res: unknown, extra: Record<string, unknown> = {}) {
  if (Array.isArray(res)) {
    return { items: res as T[], total: res.length, page: 1, limit: res.length, hasMore: false, ...extra };
  }
  const e = (res ?? {}) as Record<string, unknown>;
  return {
    ...extra,
    ...e,
    items: Array.isArray(e.items) ? (e.items as T[]) : [],
    total: typeof e.total === 'number' ? e.total : 0,
    hasMore: e.hasMore === true,
  };
}

const rangeParams = (r?: DateRange) =>
  r ? { from: r.from.toISOString(), to: r.to.toISOString() } : {};

/** Build a query string from the params that actually have a value. */
function qs(params: Record<string, string | undefined>) {
  const pairs = Object.entries(params)
    .filter(([, v]) => v != null && String(v).trim() !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v).trim())}`);
  return pairs.length ? `?${pairs.join('&')}` : '';
}

export type StaffRole = 'field_guy' | 'agronomist' | 'junior_agronomist' | 'senior_agronomist';

export type Aggregator = {
  _id: string;
  name: string;
  mobile: string;
  company: string;
  location: { latitude: number | null; longitude: number | null };
  notes: string;
  agronomist: string | null;
  createdAt: string;
};

export type Attendance = {
  _id: string;
  user: string;
  role: StaffRole;
  startAt: string;
  endAt: string | null;
};

export type Meeting = {
  _id: string;
  agronomist: string;
  aggregator: string | null;
  aggregatorName: string;
  title: string;
  scheduledAt: string | null;
  notes: string;
  status: 'scheduled' | 'done' | 'cancelled';
  createdAt: string;
};

export type CallLog = {
  _id: string;
  agronomist: string;
  agronomistMobile?: string;
  farmer: string | null;
  farmerName: string;
  farmerMobile: string;
  provider?: string;
  callUUID?: string;
  status?: string;
  duration?: number;
  recordingUrl?: string;
  calledAt: string;
  createdAt: string;
};

/**
 * A product the agronomist sold to a farmer on the farm, with before/after
 * photos of the crop. Names and prices are snapshots taken at sale time.
 */
export type ProductSaleItem = {
  product: string;
  name: string;
  unit: string;
  imageUrl: string;
  qty: number;
  unitPrice: number;
  /** As entered: a rupee amount or a percentage, per `discountType`. */
  discount?: number;
  discountType?: 'rs' | 'pct';
  /** The rupees that actually came off this line. */
  discountAmount?: number;
  lineTotal: number;
  /** Taken at handover. */
  beforePhotoUrl: string;
  /** Taken on the follow-up visit a week later; empty until then. */
  afterPhotoUrl: string;
  afterPhotoAt: string | null;
};

/**
 * Who a sale went to, whichever kind of buyer it was.
 *
 * A sale belongs to a farmer OR an FPO, and every screen that shows one has to
 * make the same choice about which name, number and destination to use. Doing
 * it here means a new screen cannot get it wrong, and an FPO sale can never
 * again be rendered as a farmer with a blank name.
 */
export type SaleBuyer = {
  kind: 'farmer' | 'fpo';
  /** Null only on a record whose buyer was deleted. */
  id: string | null;
  name: string;
  mobile: string;
};

export function saleBuyer(s: {
  farmer?: string | null;
  farmerName?: string;
  farmerMobile?: string;
  fpo?: string | null;
  fpoName?: string;
  fpoMobile?: string;
}): SaleBuyer {
  // The FPO fields decide it: a farmer sale never has them, and a sale saved
  // before FPOs could buy has neither, so it falls through to the farmer.
  if (s.fpo || s.fpoName) {
    return { kind: 'fpo', id: s.fpo ?? null, name: s.fpoName || 'FPO', mobile: s.fpoMobile || '' };
  }
  return {
    kind: 'farmer',
    id: s.farmer ?? null,
    name: s.farmerName || 'Farmer',
    mobile: s.farmerMobile || '',
  };
}

export type ProductSale = {
  /** Set instead of `farmer` when an FPO bought. Snapshots, like the farmer's. */
  fpo?: string | null;
  fpoName?: string;
  fpoMobile?: string;
  /** A discount on the whole basket, as entered, and what it came to. */
  discount?: number;
  discountType?: 'rs' | 'pct';
  discountAmount?: number;
  _id: string;
  agronomist: string | AgronomistRef | null;
  agronomistName: string;
  farmer: string;
  farmerName: string;
  farmerMobile: string;
  crop: string | null;
  cropName: string;
  items: ProductSaleItem[];
  total: number;
  location: { latitude: number | null; longitude: number | null };
  notes: string;
  soldAt: string;
  /** When the follow-up after-photos become collectable. */
  afterDueAt: string | null;
  createdAt: string;
};

/**
 * One page of sales. `total` and `totals` describe everything the filter
 * matches, not just `items`, so a summary does not have to be recomputed —
 * or worse, grow — as more pages arrive.
 */
export type ProductSalePage = {
  items: ProductSale[];
  total: number;
  totals: { value: number; products: number };
  page: number;
  limit: number;
  hasMore: boolean;
};

/** One farmer as they appear on a day's report. */
export type DayReportRow = {
  id: string;
  name: string;
  mobile: string;
  /** The farmer's whole recorded holding, not the area worked that day. */
  acres: number;
  crops: number;
  cropNames: string[];
  at: string | null;
  place?: string;
  notes?: string;
  source?: string;
  cropName?: string;
  total?: number;
  products?: string[];
  /** Set on a sale to an FPO, so the day's report can say which kind of buyer. */
  toFpo?: boolean;
};

/** What the agent wrote about the day, in their own words. */
export type DayWritten = {
  dailyReport: string;
  dailyExpenses: string;
  expectedExpensesTomorrow: string;
  planOfActionTomorrow: string;
  at: string;
};

/** A day's work in full: the counts, and the records behind them. */
export type DayReport = {
  agent: { name: string; mobile: string; role: string } | null;
  date: string;
  /** Null until the agent has submitted their report for that day. */
  report: DayWritten | null;
  stats: DayStats;
  onboarded: DayReportRow[];
  /**
   * Farmers met today who were NOT registered today — deduplicated, so
   * visiting someone and selling to them is one person met, not two.
   */
  metExisting: DayReportRow[];
  visits: DayReportRow[];
  sales: DayReportRow[];
};

/** What happened on one day, enough to mark it on a calendar. */
export type AgendaDay = {
  followUps: number;
  onboarded: number;
  visits: number;
  sales: number;
  salesTotal: number;
};

/** A farmer the agent promised to come back to. */
export type FollowUp = {
  id: string;
  name: string;
  mobile: string;
  dueAt: string;
  note: string;
  place: string;
  lastVisitedAt: string | null;
};

/**
 * A month of the calendar. `days` is keyed by local YYYY-MM-DD, so a day means
 * the day where the agent is standing rather than in UTC.
 */
export type Agenda = {
  from: string;
  to: string;
  days: Record<string, AgendaDay>;
  followUps: FollowUp[];
};

/** A senior agronomist's answer to a disease report. */
export type DiseaseReply = {
  senior: string;
  seniorName: string;
  advice: string;
  at: string;
};

/** A crop that looked diseased, sent up for advice. */
export type DiseaseReport = {
  _id: string;
  reporter: string | { _id: string; name: string; mobile: string; role: Role };
  reporterName: string;
  farmer: string | null;
  farmerName: string;
  farmerMobile: string;
  crop: string | null;
  cropName: string;
  /** Null when sent to whoever is free rather than one named senior. */
  sentTo: string | null;
  sentToName: string;
  photos: string[];
  note: string;
  location: { latitude: number | null; longitude: number | null };
  status: 'open' | 'answered';
  replies: DiseaseReply[];
  answeredAt: string | null;
  createdAt: string;
};

/** One GPS fix along a tracked route. */
export type TrackPoint = {
  latitude: number;
  longitude: number;
  at: string; // ISO
  accuracy?: number | null;
};

/**
 * A stretch the agent stepped out of the day. `resumedAt` is null while the
 * pause is still running, which is what makes "paused right now" one check.
 */
export type TrackingPause = {
  pausedAt: string;
  resumedAt: string | null;
  reason: string;
  photoUrl?: string;
};

/** A tracked work session: START to END, with the route walked in between. */
export type TrackingSession = {
  _id: string;
  user: string | { _id: string; name: string; mobile: string; role: string };
  userName: string;
  role: string;
  /** 'no_field' is a declared day in, with a reason instead of a route. */
  kind: 'tracked' | 'no_field';
  reason: string;
  startAt: string;
  endAt: string | null;
  startPhotoUrl: string;
  endPhotoUrl: string;
  /** Stretches the agent paused out of the day, with their reasons. */
  pauses?: TrackingPause[];
  /** Omitted by the list endpoints — only the single-session fetch carries it. */
  points?: TrackPoint[];
  distanceKm: number;
  createdAt: string;
};

/** A day's work, measured from what was recorded rather than typed by hand. */
export type DayStats = {
  distanceKm: number;
  trackedMinutes: number;
  sessions: number;
  newFarmers: number;
  oldFarmers: number;
  visits: number;
  sales: number;
  salesTotal: number;
};

/**
 * What prompted a visit the agronomist made off their own bat, rather than off
 * the day's list. Mirrors the enum on the Visit schema.
 */
export type VisitSource = 'field_sources' | 'fpo' | 'farmer_called' | 'random' | 'other';

/** How each source reads on screen, in the order the picker offers them. */
export const VISIT_SOURCES: { key: VisitSource; label: string }[] = [
  { key: 'field_sources', label: 'Field sources' },
  { key: 'fpo', label: 'FPO' },
  { key: 'farmer_called', label: 'Farmer called' },
  { key: 'random', label: 'Random' },
  { key: 'other', label: 'Other' },
];

export const visitSourceLabel = (s?: VisitSource | null) =>
  VISIT_SOURCES.find((v) => v.key === s)?.label ?? '';

export type Visit = {
  _id: string;
  agronomist: string | AgronomistRef | null;
  farmer: string | { _id: string; name: string; mobile: string } | null;
  farmerName: string;
  farmPhotoUrl: string;
  farmerPhotoUrl: string;
  location: { latitude: number | null; longitude: number | null };
  notes: string;
  /**
   * Why the agent said they would come back, as written at THIS visit.
   *
   * The farmer record only holds the current reason — the next visit
   * overwrites it — so this copy is what makes an old visit able to say why it
   * was scheduled. Empty when no follow-up was set.
   */
  followUpNote?: string;
  /** The date promised at this visit. Null when none was set. */
  nextFollowUpAt?: string | null;
  /**
   * Set only on a random visit — one the agronomist decided on themselves —
   * and it says what prompted it. Null on a visit made against the day's list,
   * so this doubles as the "was this random?" flag.
   */
  source?: VisitSource | null;
  visitedAt: string;
  createdAt: string;
};

export type DailyReport = {
  _id: string;
  user: string;
  userName: string;
  role: string;
  dailyReport: string;
  dailyExpenses: string;
  expectedExpensesTomorrow: string;
  planOfActionTomorrow: string;
  date: string;
  createdAt: string;
};

export type GeoPoint = { latitude: number; longitude: number };

export type User = {
  _id: string;
  role: Role;
  name: string;
  mobile: string;
  location: { latitude: number | null; longitude: number | null };
  geofence?: GeoPoint[]; // farm boundary polygon drawn by the farmer
  agronomist?: AgronomistRef | null; // for farmers: the managing agronomist (populated)
  /**
   * For farmers: the agronomist who registered them in the field. Only that
   * agronomist may edit or trash them, so the screen needs it to decide whether
   * to offer those actions at all.
   */
  onboardedBy?: string | null;
  farmAddress?: FarmAddress;
  farmAddressManual?: boolean;
  /**
   * Photo of the farmer. Set at onboarding or added later from the edit screen;
   * empty when none has been taken. `getUser` returns the whole document, so
   * this always arrives even though the leaner list endpoints select for it.
   */
  photoUrl?: string;
};

export type CropProgress = {
  stepIndex: number;
  done: boolean;
  imageUrl: string;
  completedAt: string;
};

export type CropProductProgress = {
  productId: string;
  imageUrl: string;
  completedAt: string;
};

export type VerifyStatus = 'done' | 'not_done';

export type VerifyKind = 'operation' | 'product';

export type CropVerification = {
  day: number; // POP step start day
  dayEnd: number | null;
  kind: VerifyKind;
  operation: string;
  status: VerifyStatus;
  imageUrl: string;
  note: string;
  agronomist: string | null;
  verifiedAt: string;
};

/**
 * How a crop is grown with us. Only `contract` crops follow a Package of
 * Practices; a `regular` crop is registered and tracked but has no schedule,
 * and therefore no planting date to count one from.
 */
export type FarmingType = 'contract' | 'regular';

/** Crops saved before this field existed have no value — treat those as contract. */
export const isContract = (c: { farmingType?: FarmingType }) => c.farmingType !== 'regular';

export type Crop = {
  _id: string;
  user: string;
  name: string;
  variety: string;
  farmingType?: FarmingType;
  dop: string | null; // Date of Planting (ISO string) — contract crops only
  area: number | null; // area in acres (optional)
  quantity: number | null;
  unit: string;
  notes: string;
  progress: CropProgress[];
  productProgress: CropProductProgress[];
  verifications: CropVerification[];
  createdAt: string;
};

export type CatalogCrop = {
  _id: string;
  name: string;
  imageUrl: string;
  varieties: string[];
  createdAt: string;
};

export type PopStep = {
  day: [number, number];
  category: string;
  operation: string;
  details: string;
  products?: string[]; // product IDs to use on this step/day
};

export type PackageOfPractices = {
  crop: string;
  durationDays: number;
  steps: PopStep[];
};

export type Product = {
  _id: string;
  name: string;
  description: string;
  price: number;
  unit: string;
  imageUrl: string;
  crops: string[];
  dayStart: number | null;
  dayEnd: number | null;
  createdAt: string;
};

export type OrderItem = {
  product: string;
  name: string;
  price: number;
  unit: string;
  imageUrl: string;
  qty: number;
};

export type OrderStatus = 'pending' | 'confirmed' | 'delivered' | 'cancelled';

export type Order = {
  _id: string;
  user: string;
  farmerName: string;
  farmerMobile: string;
  items: OrderItem[];
  total: number;
  status: OrderStatus;
  createdAt: string;
};

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as any)?.message || `Request failed (${res.status})`);
  }
  return data as T;
}

export const api = {
  onboard: (body: {
    role: Role;
    name: string;
    mobile: string;
    location: { latitude: number | null; longitude: number | null };
  }) => request<User>('/api/users/onboard', { method: 'POST', body: JSON.stringify(body) }),

  login: (mobile: string) =>
    request<User>('/api/users/login', { method: 'POST', body: JSON.stringify({ mobile }) }),

  listFarmers: () => request<Farmer[]>('/api/users/farmers'),

  /**
   * Every farmer in the system, not only the ones assigned to one agronomist.
   *
   * `onboardedBy` narrows it back to a single agent when asked. The list is
   * searched and date-windowed on the server, so the device never holds the
   * whole roster just to filter it.
   */
  /**
   * Every agronomist, with how many farmers each registered.
   *
   * The counts come from the same tally the dashboard uses, so the picker and
   * the list it filters can never disagree.
   */
  listAgronomistsWithCounts: () =>
    request<{ _id: string; name: string; mobile: string; onboardedCount?: number }[]>(
      '/api/users/agronomists'
    ),

  listAllFarmers: (params: { search?: string; range?: DateRange; onboardedBy?: string } = {}) =>
    request<Farmer[]>(
      `/api/users/farmers${qs({
        search: params.search,
        onboardedBy: params.onboardedBy,
        ...rangeParams(params.range),
      })}`
    ),

  /**
   * The same list, a page at a time. Search, date window and scope are all
   * applied on the server, so page 2 of a search is the next 10 matches rather
   * than the next 10 rows filtered down to whatever happens to match.
   */
  listAllFarmersPage: (params: {
    search?: string;
    range?: DateRange;
    onboardedBy?: string;
    page?: number;
    limit?: number;
  }) =>
    request<unknown>(
      `/api/users/farmers${qs({
        search: params.search,
        onboardedBy: params.onboardedBy,
        ...rangeParams(params.range),
        page: String(params.page ?? 1),
        limit: String(params.limit ?? 20),
      })}`
    ).then((r) => asPage<Farmer>(r)),

  /** Aggregators, a page at a time, filtered on the server for the same reason. */
  listAggregatorsPage: (params: {
    agronomistId?: string;
    search?: string;
    range?: DateRange;
    page?: number;
    limit?: number;
  }) =>
    request<unknown>(
      `/api/aggregators${qs({
        agronomist: params.agronomistId,
        search: params.search,
        ...rangeParams(params.range),
        page: String(params.page ?? 1),
        limit: String(params.limit ?? 20),
      })}`
    ).then((r) => asPage<Aggregator>(r)),

  // A single user with their agronomist populated (used to show the farmer's agronomist).
  getUser: (id: string) => request<User>(`/api/users/${id}`),

  // Save the device push token (FCM) for notifications.
  savePushToken: (id: string, token: string) =>
    request<{ ok: boolean }>(`/api/users/${id}/push-token`, {
      method: 'PATCH',
      body: JSON.stringify({ token }),
    }),

  // Edit profile: name / location / geofence polygon.
  updateProfile: (
    id: string,
    body: { name?: string; location?: { latitude: number | null; longitude: number | null }; geofence?: GeoPoint[] }
  ) => request<User>(`/api/users/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  // Farmers mapped to a specific agronomist. `search` filters by name/mobile on the
  // server, so the device never holds the whole roster just to filter it.
  /**
   * `onlyMine` switches the question from "who is assigned to me?" to "who did
   * I register?" — the set the home screen's "Onboarded" tile counts, including
   * farmers since handed to a colleague.
   */
  listAgronomistFarmers: (
    agronomistId: string,
    search?: string,
    range?: DateRange,
    onlyMine?: boolean
  ) =>
    request<Farmer[]>(
      `/api/users/agronomists/${agronomistId}/farmers${qs({
        search,
        ...rangeParams(range),
        ...(onlyMine ? { onboardedBy: 'me' } : {}),
      })}`
    ),

  /**
   * Edit a farmer you onboarded — name, mobile, location, farm address.
   * Send only the fields being changed; anything omitted is left alone.
   *
   * Changing `mobile` changes the number that farmer signs in with, so the
   * screen warns before saving it.
   */
  updateFarmerByAgronomist: (
    agronomistId: string,
    farmerId: string,
    body: {
      name?: string;
      mobile?: string;
      location?: { latitude: number | null; longitude: number | null };
      farmAddress?: { village?: string; taluk?: string; district?: string; state?: string };
    }
  ) =>
    request<Farmer & { farmAddress?: FarmAddress; farmAddressManual?: boolean }>(
      `/api/users/agronomists/${agronomistId}/farmers/${farmerId}`,
      { method: 'PATCH', body: JSON.stringify(body) }
    ),

  // Farmers this agronomist onboarded and then removed. They are hidden
  // everywhere else, but nothing of theirs was deleted.
  listTrashedFarmers: (agronomistId: string) =>
    request<TrashedFarmer[]>(`/api/users/agronomists/${agronomistId}/farmers/trash`),

  /**
   * Move ONE farmer to the trash. The server only allows this for a farmer this
   * agronomist onboarded themselves, and refuses anything else — there is no
   * bulk equivalent, by design.
   */
  trashFarmer: (agronomistId: string, farmerId: string) =>
    request<{ _id: string; name: string; mobile: string; deletedAt: string; restoreWithinDays: number }>(
      `/api/users/agronomists/${agronomistId}/farmers/${farmerId}/trash`,
      { method: 'POST' }
    ),

  /**
   * PERMANENTLY delete one farmer from the trash. Cannot be undone.
   *
   * The server only accepts this for a farmer already in the trash that this
   * agronomist onboarded, and `confirmName` must match their name exactly.
   * Their crops go too; visits, calls, sales and disease reports are kept.
   */
  deleteFarmerForever: (agronomistId: string, farmerId: string, confirmName: string) =>
    request<{ _id: string; name: string; cropsDeleted: number; keptRecords: string[] }>(
      `/api/users/agronomists/${agronomistId}/farmers/${farmerId}`,
      { method: 'DELETE', body: JSON.stringify({ confirmName }) }
    ),

  /**
   * Take one farmer off today's list without visiting them, with a reason.
   * An optional `nextFollowUpAt` puts them back on the list that day.
   */
  skipFarmerVisit: (
    agronomistId: string,
    farmerId: string,
    body: { reason: string; nextFollowUpAt?: string | null }
  ) =>
    request<{ _id: string; name: string; skippedAt: string; nextFollowUpAt: string | null }>(
      `/api/users/agronomists/${agronomistId}/farmers/${farmerId}/skip`,
      { method: 'POST', body: JSON.stringify(body) }
    ),

  /** Bring one farmer back out of the trash, with their crops and history. */
  restoreFarmer: (agronomistId: string, farmerId: string) =>
    request<{ _id: string; name: string; mobile: string }>(
      `/api/users/agronomists/${agronomistId}/farmers/${farmerId}/restore`,
      { method: 'POST' }
    ),

  // Agronomist onboards/links a farmer (and optionally a crop) to themselves.
  onboardFarmer: (
    agronomistId: string,
    body: {
      name: string;
      mobile: string;
      /** How this farmer reached us. Optional, and only set on a new record. */
      referredBy?: VisitSource | null;
      /** Legacy lookup-tag link. Kept for older callers; nothing sets it now. */
      fboId?: string | null;
      /**
       * The FPO this farmer belongs to, chosen from the ones agronomists have
       * actually onboarded. This is what the onboarding screen sets.
       */
      fpoId?: string | null;
      /** One entry per crop — a farmer usually grows several, each on its own area. */
      crops?: {
        name: string;
        variety?: string;
        farmingType?: FarmingType;
        area?: number | null;
        dop?: string | null;
      }[];
    }
  ) =>
    request<{ farmer: Farmer; crops: Crop[]; crop: Crop | null; alreadyExisted: boolean }>(
      `/api/users/agronomists/${agronomistId}/farmers`,
      { method: 'POST', body: JSON.stringify(body) }
    ),

  // ----- Field agent: aggregators / attendance / meetings -----
  // `search` filters by name/company/mobile on the server.
  /**
   * Aggregators. Omitting `agronomistId` returns everyone's, which is what the
   * People tab wants — an aggregator is a buyer the whole team deals with, not
   * one agent's private contact.
   */
  listAggregators: (agronomistId?: string, search?: string, range?: DateRange) =>
    request<Aggregator[]>(
      `/api/aggregators${qs({ agronomist: agronomistId, search, ...rangeParams(range) })}`
    ),
  createAggregator: (
    agronomistId: string,
    body: { name: string; mobile: string; company?: string; notes?: string; location?: GeoPoint | { latitude: number | null; longitude: number | null } }
  ) => request<Aggregator>('/api/aggregators', { method: 'POST', body: JSON.stringify({ ...body, agronomistId }) }),

  currentAttendance: (userId: string) => request<Attendance | null>(`/api/attendance/current?user=${userId}`),
  startAttendance: (userId: string, role: StaffRole) =>
    request<Attendance>('/api/attendance/start', { method: 'POST', body: JSON.stringify({ userId, role }) }),
  endAttendance: (userId: string) =>
    request<Attendance | { ok: boolean }>('/api/attendance/end', { method: 'POST', body: JSON.stringify({ userId }) }),

  listCallLogs: (agronomistId: string) => request<CallLog[]>(`/api/call-logs?agronomist=${agronomistId}`),
  logCall: (body: { agronomistId: string; farmerId?: string | null; farmerName?: string; farmerMobile: string }) =>
    request<CallLog>('/api/call-logs', { method: 'POST', body: JSON.stringify(body) }),

  // Place a real (recorded) call via Plivo: rings the agronomist, then connects the farmer.
  clickToCall: (body: {
    agronomistId?: string;
    agronomistMobile: string;
    farmerId?: string | null;
    farmerName?: string;
    farmerMobile: string;
  }) => request<{ ok: boolean; callLogId: string }>('/api/plivo/click-to-call', { method: 'POST', body: JSON.stringify(body) }),

  createDailyReport: (body: {
    userId: string;
    userName?: string;
    role?: string;
    dailyReport?: string;
    dailyExpenses?: string;
    expectedExpensesTomorrow?: string;
    planOfActionTomorrow?: string;
  }) => request<DailyReport>('/api/daily-reports', { method: 'POST', body: JSON.stringify(body) }),
  listDailyReports: (userId: string) => request<DailyReport[]>(`/api/daily-reports?user=${userId}`),

  // ----- Farm visits -----
  // List an agronomist's visits, optionally only those on/after `since` (ISO).
  listVisits: (agronomistId: string, since?: string) =>
    request<Visit[]>(`/api/visits?agronomist=${agronomistId}${since ? `&since=${encodeURIComponent(since)}` : ''}`),

  // ----- Crop disease reports -----
  // Photographed in the field and sent to every senior agronomist for advice.
  createDiseaseReport: async (body: {
    reporterId: string;
    farmerId?: string | null;
    cropId?: string | null;
    /** Used when there is no Crop record to take the name from. */
    cropName?: string;
    /** Omit to send to whoever is free — every senior sees it. */
    sentToId?: string | null;
    note?: string;
    latitude?: number | null;
    longitude?: number | null;
    photos: { uri: string; name: string; type: string }[];
  }): Promise<DiseaseReport> => {
    const form = new FormData();
    form.append('reporterId', body.reporterId);
    if (body.farmerId) form.append('farmerId', body.farmerId);
    if (body.cropId) form.append('cropId', body.cropId);
    if (body.cropName) form.append('cropName', body.cropName);
    if (body.sentToId) form.append('sentToId', body.sentToId);
    if (body.note) form.append('note', body.note);
    if (body.latitude != null) form.append('latitude', String(body.latitude));
    if (body.longitude != null) form.append('longitude', String(body.longitude));
    body.photos.forEach((p) => form.append('photos', p as any));
    const res = await fetch(`${BASE_URL}/api/disease-reports`, { method: 'POST', body: form });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data as any)?.message || 'Could not send the report');
    return data as DiseaseReport;
  },

  /**
   * `reporterId` for an agent's own. `seniorId` for a senior's inbox — what was
   * addressed to them plus anything sent to whoever is free.
   */
  listDiseaseReports: (params?: {
    reporterId?: string;
    seniorId?: string;
    farmerId?: string;
    status?: 'open' | 'answered';
  }) => {
    const q = new URLSearchParams();
    if (params?.reporterId) q.set('reporter', params.reporterId);
    if (params?.seniorId) q.set('senior', params.seniorId);
    if (params?.farmerId) q.set('farmer', params.farmerId);
    if (params?.status) q.set('status', params.status);
    const qs = q.toString();
    return request<DiseaseReport[]>(`/api/disease-reports${qs ? `?${qs}` : ''}`);
  },

  /** Senior agronomists a report can be addressed to. */
  listSeniorAgronomists: () =>
    request<{ _id: string; name: string; mobile: string }[]>('/api/disease-reports/seniors'),

  getDiseaseReport: (id: string) => request<DiseaseReport>(`/api/disease-reports/${id}`),

  /** A senior answers; the reporting agent is notified. */
  replyToDiseaseReport: (id: string, seniorId: string, advice: string) =>
    request<DiseaseReport>(`/api/disease-reports/${id}/reply`, {
      method: 'POST',
      body: JSON.stringify({ seniorId, advice }),
    }),

  // ----- Day tracking -----
  // Start carries a photo of where the day began, so it is multipart.
  startTracking: async (
    userId: string,
    role?: string,
    photo?: { uri: string; name: string; type: string }
  ): Promise<TrackingSession> => {
    const form = new FormData();
    form.append('userId', userId);
    if (role) form.append('role', role);
    if (photo) form.append('photo', photo as any);
    const res = await fetch(`${BASE_URL}/api/tracking/start`, { method: 'POST', body: form });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data as any)?.message || 'Could not start tracking');
    return data as TrackingSession;
  },

  /** A day with no field work — a reason and a photo showing why. */
  noFieldDay: async (
    userId: string,
    reason: string,
    role?: string,
    photo?: { uri: string; name: string; type: string }
  ): Promise<TrackingSession> => {
    const form = new FormData();
    form.append('userId', userId);
    form.append('reason', reason);
    if (role) form.append('role', role);
    if (photo) form.append('photo', photo as any);
    const res = await fetch(`${BASE_URL}/api/tracking/no-field`, { method: 'POST', body: form });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data as any)?.message || 'Could not save');
    return data as TrackingSession;
  },

  // Returns the running total rather than echoing the route back to the phone.
  addTrackPoints: (sessionId: string, points: TrackPoint[]) =>
    request<{ _id: string; distanceKm: number; pointCount: number; added: number }>(
      `/api/tracking/${sessionId}/points`,
      { method: 'POST', body: JSON.stringify({ points }) }
    ),

  // Stop carries the end photo alongside any points still buffered, so the
  // points travel as a JSON string in the multipart body.
  stopTracking: async (
    sessionId: string,
    points?: TrackPoint[],
    photo?: { uri: string; name: string; type: string }
  ): Promise<TrackingSession> => {
    const form = new FormData();
    form.append('points', JSON.stringify(points ?? []));
    if (photo) form.append('photo', photo as any);
    const res = await fetch(`${BASE_URL}/api/tracking/${sessionId}/stop`, {
      method: 'POST',
      body: form,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data as any)?.message || 'Could not stop tracking');
    return data as TrackingSession;
  },

  /** The session still running for this user, if any — null when none is. */
  /**
   * Step out of the working day, with a reason. The session stays open — the
   * server stops counting distance until it is resumed.
   */
  pauseTracking: async (
    sessionId: string,
    reason: string,
    photo: { uri: string; name: string; type: string }
  ): Promise<{ _id: string; paused: true; pauses: TrackingPause[]; distanceKm: number }> => {
    // Multipart, so the photo rides along with the reason in one request —
    // a pause that saved without its photo would be the gap it exists to close.
    const form = new FormData();
    form.append('reason', reason);
    form.append('photo', photo as any);
    const res = await fetch(`${BASE_URL}/api/tracking/${sessionId}/pause`, {
      method: 'POST',
      body: form,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data as any)?.message || 'Could not pause');
    return data as any;
  },

  resumeTracking: (sessionId: string) =>
    request<{ _id: string; paused: false; pauses: TrackingPause[]; distanceKm: number }>(
      `/api/tracking/${sessionId}/resume`,
      { method: 'POST' }
    ),

  currentTracking: (userId: string) =>
    request<TrackingSession | null>(`/api/tracking/current?user=${encodeURIComponent(userId)}`),

  listTracking: (userId: string, from?: string, to?: string) => {
    const q = new URLSearchParams({ user: userId });
    if (from) q.set('from', from);
    if (to) q.set('to', to);
    return request<TrackingSession[]>(`/api/tracking?${q.toString()}`);
  },

  /** Today's measured numbers for one agent. `date` is yyyy-mm-dd. */
  /**
   * The same day with the records themselves — which farmers, their numbers
   * and how much land — rather than only a tally of them.
   */
  /**
   * A month of follow-ups owed and work already done, in one request.
   * The detail behind any single day is `getDayReport`.
   */
  getAgenda: (userId: string, from: Date, to: Date) =>
    request<Agenda>(
      `/api/agenda?user=${encodeURIComponent(userId)}&from=${from.toISOString()}&to=${to.toISOString()}`
    ),

  /**
   * Every agronomist's day at once — senior agronomists only.
   *
   * The server checks the requester's role against the database, so this is a
   * closed endpoint rather than a hidden screen. A non-senior gets 403.
   */
  getTeamDay: (requesterId: string, date?: string) => {
    const q = new URLSearchParams({ requester: requesterId });
    if (date) q.set('date', date);
    return request<TeamDay>(`/api/team-day?${q.toString()}`);
  },

  getDayReport: (userId: string, date?: string) => {
    const q = new URLSearchParams({ user: userId });
    if (date) q.set('date', date);
    return request<DayReport>(`/api/day-report?${q.toString()}`);
  },

  /**
   * Where the day's PDF lives. Opened in the phone's browser rather than built
   * on the device: making a PDF in the app needs a native module, and adding
   * one would mean a new build for every agent instead of an update they get
   * without noticing.
   */
  dayReportPdfUrl: (userId: string, date?: string) => {
    const q = new URLSearchParams({ user: userId });
    if (date) q.set('date', date);
    return `${BASE_URL}/api/day-report.pdf?${q.toString()}`;
  },

  getDayStats: (userId: string, date?: string) => {
    const q = new URLSearchParams({ user: userId });
    if (date) q.set('date', date);
    return request<DayStats>(`/api/day-stats?${q.toString()}`);
  },

  /** Attach the conversation recorded while this farmer was onboarded. */
  /**
   * Attach a photo of the farmer. Posted AFTER the farmer exists, so a slow or
   * failed upload can never cost the registration.
   */
  saveFarmerPhoto: async (farmerId: string, photo: { uri: string; name: string; type: string }) => {
    const form = new FormData();
    form.append('photo', photo as any);
    const res = await fetch(`${BASE_URL}/api/users/${farmerId}/photo`, {
      method: 'POST',
      body: form,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data as any)?.message || 'Could not upload the photo');
    return data as { ok: true; photoUrl: string };
  },

  saveOnboardingAudio: async (
    farmerId: string,
    audio: { uri: string; name: string; type: string },
    seconds?: number
  ) => {
    const form = new FormData();
    form.append('audio', audio as any);
    if (seconds) form.append('seconds', String(seconds));
    const res = await fetch(`${BASE_URL}/api/users/${farmerId}/onboarding-audio`, {
      method: 'POST',
      body: form,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data as any)?.message || 'Could not upload the recording');
    return data as { ok: boolean; onboardingAudioUrl: string };
  },

  // Every visit made to one farmer, newest first — their visit history.
  listFarmerVisits: (farmerId: string) =>
    request<Visit[]>(`/api/visits?farmer=${encodeURIComponent(farmerId)}`),

  /**
   * Set, change or clear the return date on a visit already logged.
   *
   * `nextFollowUpAt: null` removes it. When this is the farmer's most recent
   * visit the server also updates the farmer, so the date reaches Follow up and
   * the calendar; on an older visit it only corrects that visit's own record.
   */
  setVisitFollowUp: (
    visitId: string,
    body: { nextFollowUpAt: string | null; followUpNote?: string }
  ) =>
    request<Visit>(`/api/visits/${encodeURIComponent(visitId)}/follow-up`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),

  // Products sold on the farm. Filter by farmer (their history) or agronomist
  // (own sales). `pendingAfter` returns only sales whose follow-up after-photos
  // are due but not yet taken.
  listProductSales: (params: {
    farmerId?: string;
    /** Sales to one FPO. */
    fpoId?: string;
    agronomistId?: string;
    since?: string;
    pendingAfter?: boolean;
  }) => {
    const q = new URLSearchParams();
    if (params.farmerId) q.set('farmer', params.farmerId);
    if (params.fpoId) q.set('fpo', params.fpoId);
    if (params.agronomistId) q.set('agronomist', params.agronomistId);
    if (params.since) q.set('since', params.since);
    if (params.pendingAfter) q.set('pendingAfter', '1');
    return request<ProductSale[]>(`/api/product-sales?${q.toString()}`);
  },

  /**
   * The same list, a page at a time, with the search done on the server.
   *
   * Kept separate from `listProductSales` rather than folded into it: sending
   * `page`/`limit` changes the response from an array to an envelope, and the
   * screens that want everything at once should not have to unwrap it.
   *
   * `totals` covers the whole filtered set, not the page, so a summary bar can
   * show real figures without holding every row.
   */
  listProductSalesPage: (params: {
    farmerId?: string;
    agronomistId?: string;
    /** Farmer name or mobile only — product and crop have their own filters. */
    search?: string;
    /** Product id from the catalogue. */
    productId?: string;
    /** Crop NAME, not id: a Crop belongs to one farmer, the name spans them all. */
    crop?: string;
    /** Local-midnight instants, so the day boundaries are the caller's own. */
    range?: DateRange;
    pendingAfter?: boolean;
    page?: number;
    limit?: number;
  }) => {
    const q = new URLSearchParams();
    if (params.farmerId) q.set('farmer', params.farmerId);
    if (params.agronomistId) q.set('agronomist', params.agronomistId);
    if (params.range) {
      q.set('from', params.range.from.toISOString());
      q.set('to', params.range.to.toISOString());
    }
    if (params.search?.trim()) q.set('search', params.search.trim());
    if (params.productId) q.set('product', params.productId);
    if (params.crop) q.set('crop', params.crop);
    if (params.pendingAfter) q.set('pendingAfter', '1');
    q.set('page', String(params.page ?? 1));
    q.set('limit', String(params.limit ?? 20));
    return request<unknown>(`/api/product-sales?${q.toString()}`).then(
      (r) => asPage<ProductSale>(r, { totals: { value: 0, products: 0 } }) as ProductSalePage
    );
  },

  // Sell products to a farmer on the field, with before/after photos of the crop.
  // Names and line totals are resolved server-side from the catalog.
  /**
   * The bill for one sale, as a PDF: farmer, crop, every product with its
   * discount, and the GST ladder. Opened rather than fetched — the phone hands
   * the URL to its browser, which downloads and shares it.
   */
  saleInvoicePdfUrl: (saleId: string) =>
    `${BASE_URL}/api/product-sales/${encodeURIComponent(saleId)}/pdf`,

  createProductSale: async (body: {
    agronomistId: string;
    /** One buyer, not both: a farmer OR an FPO. */
    farmerId?: string;
    fpoId?: string;
    cropId?: string | null;
    /**
     * The crop this was for, by name. Only used for an FPO, which has crop
     * names but no Crop records to link to.
     */
    cropName?: string;
    /** Each product carries its own before-photo; the after comes a week later. */
    items: {
      productId: string;
      qty: number;
      unitPrice: number;
      /**
       * What the agronomist entered, not the rupees it works out to — the
       * server does that arithmetic, so a rounding difference here can never
       * change what a farmer was charged.
       */
      discount?: number;
      discountType?: 'rs' | 'pct';
      beforePhoto?: { uri: string; name: string; type: string };
    }[];
    /** A discount on the whole basket, on top of any per-product ones. */
    discount?: number;
    discountType?: 'rs' | 'pct';
    latitude?: number | null;
    longitude?: number | null;
    notes?: string;
  }): Promise<ProductSale> => {
    const form = new FormData();
    form.append('agronomistId', body.agronomistId);
    if (body.farmerId) form.append('farmerId', body.farmerId);
    if (body.fpoId) form.append('fpoId', body.fpoId);
    if (body.cropName) form.append('cropName', body.cropName);
    if (body.discount) form.append('discount', String(body.discount));
    if (body.discountType) form.append('discountType', body.discountType);
    if (body.cropId) form.append('cropId', body.cropId);
    // Multipart carries the photos, so the basket travels as a JSON string.
    form.append(
      'items',
      JSON.stringify(
        body.items.map(({ productId, qty, unitPrice, discount, discountType }) => ({
          productId,
          qty,
          unitPrice,
          discount,
          discountType,
        }))
      )
    );
    // Photos ride alongside, keyed by the line's position in that same array.
    body.items.forEach((it, i) => {
      if (it.beforePhoto) form.append(`before_${i}`, it.beforePhoto as any);
    });
    if (body.latitude != null) form.append('latitude', String(body.latitude));
    if (body.longitude != null) form.append('longitude', String(body.longitude));
    if (body.notes) form.append('notes', body.notes);
    const res = await fetch(`${BASE_URL}/api/product-sales`, { method: 'POST', body: form });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data as any)?.message || 'Could not save the sale');
    return data as ProductSale;
  },

  // The follow-up visit: attach after-photos to a sale already recorded.
  // `index` is the product's position in that sale's `items`.
  addAfterPhotos: async (
    saleId: string,
    photos: { index: number; photo: { uri: string; name: string; type: string } }[]
  ): Promise<ProductSale> => {
    const form = new FormData();
    photos.forEach(({ index, photo }) => form.append(`after_${index}`, photo as any));
    const res = await fetch(`${BASE_URL}/api/product-sales/${saleId}/after-photos`, {
      method: 'POST',
      body: form,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data as any)?.message || 'Could not save the photo');
    return data as ProductSale;
  },

  // Record a visit with a farm photo + a photo with the farmer + GPS location.
  createVisit: async (body: {
    agronomistId: string;
    /** Required for an ordinary visit; omitted on a random one logged by source alone. */
    farmerId?: string;
    farmerName?: string;
    latitude?: number | null;
    longitude?: number | null;
    notes?: string;
    /** Omit for an ordinary visit against the day's list. */
    source?: VisitSource | null;
    /** When to come back. Omitting it clears any follow-up this farmer had. */
    nextFollowUpAt?: string | null;
    followUpNote?: string;
    farmPhoto?: { uri: string; name: string; type: string };
    farmerPhoto?: { uri: string; name: string; type: string };
  }): Promise<Visit> => {
    const form = new FormData();
    form.append('agronomistId', body.agronomistId);
    if (body.farmerId) form.append('farmerId', body.farmerId);
    if (body.farmerName) form.append('farmerName', body.farmerName);
    if (body.latitude != null) form.append('latitude', String(body.latitude));
    if (body.longitude != null) form.append('longitude', String(body.longitude));
    if (body.notes) form.append('notes', body.notes);
    if (body.source) form.append('source', body.source);
    if (body.nextFollowUpAt) form.append('nextFollowUpAt', body.nextFollowUpAt);
    if (body.followUpNote) form.append('followUpNote', body.followUpNote);
    if (body.farmPhoto) form.append('farmPhoto', body.farmPhoto as any);
    if (body.farmerPhoto) form.append('farmerPhoto', body.farmerPhoto as any);
    const res = await fetch(`${BASE_URL}/api/visits`, { method: 'POST', body: form });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data as any)?.message || 'Could not save visit');
    return data as Visit;
  },

  listMeetings: (agronomistId: string) => request<Meeting[]>(`/api/meetings?agronomist=${agronomistId}`),
  createMeeting: (body: {
    agronomistId: string;
    aggregatorId?: string | null;
    aggregatorName?: string;
    title?: string;
    scheduledAt?: string | null;
    notes?: string;
  }) => request<Meeting>('/api/meetings', { method: 'POST', body: JSON.stringify(body) }),

  listCrops: (userId: string) => request<Crop[]>(`/api/users/${userId}/crops`),

  addCrop: (
    userId: string,
    body: {
      name: string;
      variety?: string;
      farmingType?: FarmingType;
      dop?: string | null;
      area?: number | null;
      quantity?: number | null;
      unit?: string;
      notes?: string;
    }
  ) => request<Crop>(`/api/users/${userId}/crops`, { method: 'POST', body: JSON.stringify(body) }),

  // Fill in details left blank at onboarding — usually the planting date the
  // Package of Practices schedule is counted from.
  /**
   * Edit a crop. Send only what changed.
   *
   * `name` is refused once the crop has recorded work against its schedule —
   * the server returns 409, because renaming would repoint every recorded step
   * at a different Package of Practices.
   */
  updateCrop: (
    cropId: string,
    body: {
      name?: string;
      variety?: string;
      farmingType?: FarmingType;
      dop?: string | null;
      /** Acres. */
      area?: number | null;
      quantity?: number | null;
      unit?: string;
      notes?: string;
    }
  ) => request<Crop>(`/api/crops/${cropId}`, { method: 'PATCH', body: JSON.stringify(body) }),

  /** FPOs matching what has been typed. Capped server-side at 20. */
  listFbos: (search?: string) => request<Fbo[]>(`/api/fbos${qs({ search })}`),

  /**
   * Add an FPO. If one with that name already exists the server returns it
   * rather than erroring, so two agents in the same village cannot end up with
   * two records for one organisation.
   */
  createFbo: (name: string, createdBy?: string) =>
    request<Fbo>('/api/fbos', {
      method: 'POST',
      body: JSON.stringify({ name, createdBy }),
    }),

  /**
   * What area a set of coordinates falls in, so the agent can see where the
   * phone thinks they are before they commit the record.
   *
   * `address` is null when the geocoder is unreachable — that is a normal
   * outcome in the field, not an error, and onboarding proceeds on coordinates.
   */
  resolveArea: (latitude: number, longitude: number) =>
    request<{ address: FarmAddress | null }>(`/api/fpos/area?lat=${latitude}&lng=${longitude}`),

  /**
   * Find a place by name, for when the agronomist is not standing where the
   * FPO is. They type to search, but what gets stored is the picked result's
   * coordinates — so the area name stays geocoded and still groups correctly.
   *
   * Empty list on any failure; the caller shows "nothing found" either way.
   */
  searchPlaces: (query: string) =>
    request<{ places: PlaceHit[] }>(`/api/fpos/area/search?q=${encodeURIComponent(query)}`),

  /**
   * The same list, a page at a time, with the filtering done on the server.
   *
   * Kept separate from `listFpos` rather than folded into it: sending
   * `page`/`limit` changes the response from an array to an envelope, and the
   * callers that want everything at once should not have to unwrap it.
   */
  listFposPage: (params: {
    agronomistId?: string;
    search?: string;
    role?: string;
    crop?: string;
    /**
     * Local-midnight instants, the same shape the People tab sends. A bare
     * `YYYY-MM-DD` would be read as UTC midnight — 05:30 in IST, so "today"
     * would drop every record made before dawn.
     */
    range?: DateRange;
    page?: number;
    limit?: number;
  }) =>
    request<FpoPage>(
      `/api/fpos${qs({
        agronomist: params.agronomistId,
        search: params.search,
        role: params.role,
        crop: params.crop,
        ...rangeParams(params.range),
        page: String(params.page ?? 1),
        limit: String(params.limit ?? 20),
      })}`
    ),

  /**
   * Is this number already on an FPO? Asked while the agent is still typing,
   * so a duplicate surfaces before the rest of the form is filled in.
   *
   * `excludeId` skips one record, so the edit form does not report a number as
   * taken by the very FPO being edited.
   */
  checkFpoMobile: (mobile: string, excludeId?: string) =>
    request<{ fpo: Pick<Fpo, '_id' | 'name' | 'role' | 'photoUrl' | 'address' | 'agronomist'> | null }>(
      `/api/fpos/check-mobile${qs({ mobile, exclude: excludeId })}`
    ),

  getFpo: (id: string) => request<Fpo>(`/api/fpos/${id}`),

  /**
   * Correct an FPO already on record. Only the fields passed are touched, so
   * fixing a misheard number cannot blank out the crops.
   *
   * Omitting `photo` leaves the existing one alone — it never clears it.
   */
  updateFpo: async (
    id: string,
    body: {
      name?: string;
      mobile?: string;
      role?: string;
      crops?: string[];
      members?: FpoMember[];
      farmerCount?: number;
      latitude?: number | null;
      longitude?: number | null;
      locationSource?: 'gps' | 'search' | null;
      photo?: { uri: string; name: string; type: string } | null;
    }
  ): Promise<Fpo> => {
    const form = new FormData();
    if (body.name !== undefined) form.append('name', body.name);
    if (body.mobile !== undefined) form.append('mobile', body.mobile);
    if (body.role !== undefined) form.append('role', body.role);
    if (body.crops !== undefined) form.append('crops', JSON.stringify(body.crops));
    if (body.members !== undefined) form.append('members', JSON.stringify(body.members));
    if (body.farmerCount !== undefined) form.append('farmerCount', String(body.farmerCount));
    // Coordinates travel together: the server re-reads the area from them, and
    // half a pair would leave the address describing the old place.
    if (body.latitude != null && body.longitude != null) {
      form.append('latitude', String(body.latitude));
      form.append('longitude', String(body.longitude));
      if (body.locationSource) form.append('locationSource', body.locationSource);
    }
    if (body.photo) form.append('photo', body.photo as any);

    const res = await fetch(`${BASE_URL}/api/fpos/${id}`, { method: 'PATCH', body: form });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data as any)?.message || 'Could not save this FPO');
    return data as Fpo;
  },

  /** FPOs onboarded in the field. `agronomistId` narrows it to an agent's own. */
  listFpos: (
    params: {
      agronomistId?: string;
      /** Names and numbers only — role and crop are their own filters. */
      search?: string;
      role?: string;
      crop?: string;
    } = {}
  ) =>
    request<Fpo[]>(
      `/api/fpos${qs({
        agronomist: params.agronomistId,
        search: params.search,
        role: params.role,
        crop: params.crop,
      })}`
    ),

  /**
   * Onboard an FPO representative. Multipart, so the photo goes up with the
   * details in one request — two round trips in the field means the second one
   * can fail and leave a record with no photo and no way to tell.
   *
   * Rejects a number that is already onboarded (409), which is what makes a
   * retried save recoverable rather than silently doubling the record.
   */
  createFpo: async (body: {
    agronomistId: string;
    name: string;
    mobile: string;
    role: string;
    crops: string[];
    /** Optional. Rows without a name are dropped by the server. */
    members?: FpoMember[];
    farmerCount: number;
    /** The area is derived from these on the server — it is never sent as text. */
    latitude?: number | null;
    longitude?: number | null;
    /** Where the pin came from — the agent's phone, or a place they searched. */
    locationSource?: 'gps' | 'search' | null;
    photo?: { uri: string; name: string; type: string } | null;
  }): Promise<Fpo> => {
    const form = new FormData();
    form.append('agronomistId', body.agronomistId);
    form.append('name', body.name);
    form.append('mobile', body.mobile);
    form.append('role', body.role);
    form.append('crops', JSON.stringify(body.crops));
    if (body.members?.length) form.append('members', JSON.stringify(body.members));
    form.append('farmerCount', String(body.farmerCount));
    if (body.latitude != null) form.append('latitude', String(body.latitude));
    if (body.longitude != null) form.append('longitude', String(body.longitude));
    if (body.locationSource) form.append('locationSource', body.locationSource);
    if (body.photo) form.append('photo', body.photo as any);

    const res = await fetch(`${BASE_URL}/api/fpos`, { method: 'POST', body: form });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data as any)?.message || 'Could not save this FPO');
    return data as Fpo;
  },

  // Master crop catalog (admin-defined) shown in the Add-Crop picker.
  listCropCatalog: () => request<CatalogCrop[]>('/api/crop-catalog'),

  getPractices: (crop: string) =>
    request<PackageOfPractices>(`/api/practices/${encodeURIComponent(crop)}`),

  // Optionally filter by crop — returns products mapped to that crop plus general ones.
  listProducts: (crop?: string) =>
    request<Product[]>(`/api/products${crop ? `?crop=${encodeURIComponent(crop)}` : ''}`),

  placeOrder: (userId: string, items: { productId: string; qty: number }[]) =>
    request<Order>('/api/orders', {
      method: 'POST',
      body: JSON.stringify({ userId, items }),
    }),

  listUserOrders: (userId: string) => request<Order[]>(`/api/orders/user/${userId}`),

  getCrop: (id: string) => request<Crop>(`/api/crops/${id}`),

  // Mark a POP step done, optionally uploading a photo (multipart -> Cloudinary on the server).
  completeTask: async (
    cropId: string,
    stepIndex: number,
    image?: { uri: string; name: string; type: string }
  ): Promise<Crop> => {
    const form = new FormData();
    if (image) {
      // React Native FormData file shape.
      form.append('image', { uri: image.uri, name: image.name, type: image.type } as any);
    }
    const res = await fetch(`${BASE_URL}/api/crops/${cropId}/tasks/${stepIndex}`, {
      method: 'POST',
      body: form,
      // NOTE: do NOT set Content-Type; fetch adds the multipart boundary automatically.
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data as any)?.message || 'Upload failed');
    return data as Crop;
  },

  // Agronomist verification: mark a POP day done/not-done, optional proof photo (gallery).
  verifyTask: async (
    cropId: string,
    body: {
      day: number;
      dayEnd?: number | null;
      kind?: VerifyKind;
      operation?: string;
      status: VerifyStatus;
      note?: string;
      agronomistId?: string;
    },
    image?: { uri: string; name: string; type: string }
  ): Promise<Crop> => {
    const form = new FormData();
    form.append('day', String(body.day));
    if (body.dayEnd != null) form.append('dayEnd', String(body.dayEnd));
    if (body.kind) form.append('kind', body.kind);
    if (body.operation) form.append('operation', body.operation);
    form.append('status', body.status);
    if (body.note) form.append('note', body.note);
    if (body.agronomistId) form.append('agronomistId', body.agronomistId);
    if (image) form.append('image', { uri: image.uri, name: image.name, type: image.type } as any);
    const res = await fetch(`${BASE_URL}/api/crops/${cropId}/verify`, { method: 'POST', body: form });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data as any)?.message || 'Verification failed');
    return data as Crop;
  },

  // Upload a photo showing a scheduled product was applied.
  completeProductTask: async (
    cropId: string,
    productId: string,
    image: { uri: string; name: string; type: string }
  ): Promise<Crop> => {
    const form = new FormData();
    form.append('image', { uri: image.uri, name: image.name, type: image.type } as any);
    const res = await fetch(`${BASE_URL}/api/crops/${cropId}/products/${productId}`, {
      method: 'POST',
      body: form,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data as any)?.message || 'Upload failed');
    return data as Crop;
  },
};
