const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:5000';

export type Role = 'farmer' | 'aggregator';

export type User = {
  _id: string;
  role: Role;
  name: string;
  mobile: string;
  location: { latitude: number | null; longitude: number | null };
};

export type Crop = {
  _id: string;
  user: string;
  name: string;
  variety: string;
  quantity: number | null;
  unit: string;
  notes: string;
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

  listCrops: (userId: string) => request<Crop[]>(`/api/users/${userId}/crops`),

  addCrop: (
    userId: string,
    body: { name: string; variety?: string; quantity?: number | null; unit?: string; notes?: string }
  ) => request<Crop>(`/api/users/${userId}/crops`, { method: 'POST', body: JSON.stringify(body) }),
};
