const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:5000';

export type Role = 'farmer' | 'agronomist';

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
};

export type AgronomistRef = { _id: string; name: string; mobile: string };

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

export type Visit = {
  _id: string;
  agronomist: string | AgronomistRef | null;
  farmer: string | { _id: string; name: string; mobile: string } | null;
  farmerName: string;
  farmPhotoUrl: string;
  farmerPhotoUrl: string;
  location: { latitude: number | null; longitude: number | null };
  notes: string;
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

export type Crop = {
  _id: string;
  user: string;
  name: string;
  variety: string;
  dop: string | null; // Date of Planting (ISO string)
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
  listAgronomistFarmers: (agronomistId: string, search?: string) =>
    request<Farmer[]>(
      `/api/users/agronomists/${agronomistId}/farmers${
        search?.trim() ? `?search=${encodeURIComponent(search.trim())}` : ''
      }`
    ),

  // Agronomist onboards/links a farmer (and optionally a crop) to themselves.
  onboardFarmer: (
    agronomistId: string,
    body: { name: string; mobile: string; crop?: string; variety?: string; dop?: string | null }
  ) =>
    request<{ farmer: Farmer; crop: Crop | null; alreadyExisted: boolean }>(
      `/api/users/agronomists/${agronomistId}/farmers`,
      { method: 'POST', body: JSON.stringify(body) }
    ),

  // ----- Field agent: aggregators / attendance / meetings -----
  // `search` filters by name/company/mobile on the server.
  listAggregators: (agronomistId: string, search?: string) =>
    request<Aggregator[]>(
      `/api/aggregators?agronomist=${agronomistId}${
        search?.trim() ? `&search=${encodeURIComponent(search.trim())}` : ''
      }`
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

  // Record a visit with a farm photo + a photo with the farmer + GPS location.
  createVisit: async (body: {
    agronomistId: string;
    farmerId: string;
    farmerName?: string;
    latitude?: number | null;
    longitude?: number | null;
    notes?: string;
    farmPhoto?: { uri: string; name: string; type: string };
    farmerPhoto?: { uri: string; name: string; type: string };
  }): Promise<Visit> => {
    const form = new FormData();
    form.append('agronomistId', body.agronomistId);
    form.append('farmerId', body.farmerId);
    if (body.farmerName) form.append('farmerName', body.farmerName);
    if (body.latitude != null) form.append('latitude', String(body.latitude));
    if (body.longitude != null) form.append('longitude', String(body.longitude));
    if (body.notes) form.append('notes', body.notes);
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
      dop?: string | null;
      area?: number | null;
      quantity?: number | null;
      unit?: string;
      notes?: string;
    }
  ) => request<Crop>(`/api/users/${userId}/crops`, { method: 'POST', body: JSON.stringify(body) }),

  // Fill in details left blank at onboarding — usually the planting date the
  // Package of Practices schedule is counted from.
  updateCrop: (
    cropId: string,
    body: { variety?: string; dop?: string | null; area?: number | null }
  ) => request<Crop>(`/api/crops/${cropId}`, { method: 'PATCH', body: JSON.stringify(body) }),

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
