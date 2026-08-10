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
   */
  onboardedBy?: string | null;
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

/** A Farmer Business Organisation a farmer can belong to. */
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
  lineTotal: number;
  /** Taken at handover. */
  beforePhotoUrl: string;
  /** Taken on the follow-up visit a week later; empty until then. */
  afterPhotoUrl: string;
  afterPhotoAt: string | null;
};

export type ProductSale = {
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
      /** The Farmer Business Organisation this farmer belongs to, if any. */
      fboId?: string | null;
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
  listAggregators: (agronomistId: string, search?: string, range?: DateRange) =>
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

  // Products sold on the farm. Filter by farmer (their history) or agronomist
  // (own sales). `pendingAfter` returns only sales whose follow-up after-photos
  // are due but not yet taken.
  listProductSales: (params: {
    farmerId?: string;
    agronomistId?: string;
    since?: string;
    pendingAfter?: boolean;
  }) => {
    const q = new URLSearchParams();
    if (params.farmerId) q.set('farmer', params.farmerId);
    if (params.agronomistId) q.set('agronomist', params.agronomistId);
    if (params.since) q.set('since', params.since);
    if (params.pendingAfter) q.set('pendingAfter', '1');
    return request<ProductSale[]>(`/api/product-sales?${q.toString()}`);
  },

  // Sell products to a farmer on the field, with before/after photos of the crop.
  // Names and line totals are resolved server-side from the catalog.
  createProductSale: async (body: {
    agronomistId: string;
    farmerId: string;
    cropId?: string | null;
    /** Each product carries its own before-photo; the after comes a week later. */
    items: {
      productId: string;
      qty: number;
      unitPrice: number;
      beforePhoto?: { uri: string; name: string; type: string };
    }[];
    latitude?: number | null;
    longitude?: number | null;
    notes?: string;
  }): Promise<ProductSale> => {
    const form = new FormData();
    form.append('agronomistId', body.agronomistId);
    form.append('farmerId', body.farmerId);
    if (body.cropId) form.append('cropId', body.cropId);
    // Multipart carries the photos, so the basket travels as a JSON string.
    form.append(
      'items',
      JSON.stringify(body.items.map(({ productId, qty, unitPrice }) => ({ productId, qty, unitPrice })))
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

  /** FBOs matching what has been typed. Capped server-side at 20. */
  listFbos: (search?: string) => request<Fbo[]>(`/api/fbos${qs({ search })}`),

  /**
   * Add an FBO. If one with that name already exists the server returns it
   * rather than erroring, so two agents in the same village cannot end up with
   * two records for one organisation.
   */
  createFbo: (name: string, createdBy?: string) =>
    request<Fbo>('/api/fbos', {
      method: 'POST',
      body: JSON.stringify({ name, createdBy }),
    }),

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
