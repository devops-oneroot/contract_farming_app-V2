import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Image } from 'expo-image';
import * as Location from 'expo-location';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';

import { TappablePhoto } from '@/components/tappable-photo';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand, CardShadow, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { Farmer, Visit, api, onboarderId, visitSourceLabel } from '@/lib/api';
import { limitSearch } from '@/lib/mobile';
import { callFarmer } from '@/lib/call';
import { dueLabel } from '@/lib/dates';

const GREEN = Brand.primary;

/** "Mon, 15 Aug" — a follow-up is a day, so the weekday earns its place. */
const fmtFollowUp = (d: Date) =>
  d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

/**
 * Rows added each time the list reaches its end. The roster is fetched whole —
 * it has to be, because every row carries a distance only the device can work
 * out — so this paginates the RENDERING, not the fetch.
 */
const PAGE = 10;

const GREEN_SURFACE = Brand.surface;

// Straight-line distance (km) between two lat/lng points.
function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLon / 2) ** 2 * Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat));
  return 2 * R * Math.asin(Math.sqrt(s));
}

/**
 * When a farmer was registered — day and clock time. Empty when the date is
 * missing or unreadable, so the row simply drops the segment rather than
 * printing a dash.
 *
 * The year is dropped for the current one — it is the same on nearly every row,
 * and this shares a line with the phone number.
 */
function fmtAdded(iso?: string) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const sameYear = d.getFullYear() === new Date().getFullYear();
  const day = d.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
  // Comma rather than another dot: this line already separates its parts with
  // dots, and a third one would make the date and time read as two facts
  // instead of one moment.
  return `${day}, ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
}

function fmtDist(km: number | null) {
  if (km == null) return 'No location';
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(1)} km`;
}

type Row = Farmer & { distance: number | null; visited: boolean };

/**
 * The four views over the day's roster.
 *
 * `todo` is everyone still to see today, whoever put them on the list — work
 * handed down from the admin dashboard and farmers this agent registered
 * themselves, together. They used to be two tabs, Assigned and Yours, which
 * meant the same question ("who is left?") had two answers and an agent
 * finishing one tab could believe they were done. Each row carries a Yours or
 * Assigned tag instead, so where a farmer came from is still on the screen
 * without splitting the day in half to say it.
 *
 * `followup` is everyone with a promised date. `random` is a trip nobody
 * planned, so it offers every farmer — the visit it produces is stamped with
 * how that farmer reached us in the first place.
 */
const TABS = [
  { key: 'todo', label: 'To visit' },
  { key: 'followup', label: 'Follow up' },
  { key: 'random', label: 'Random' },
  { key: 'visited', label: 'Visited' },
] as const;

type Tab = (typeof TABS)[number]['key'];

const TAB_LABEL = Object.fromEntries(TABS.map((t) => [t.key, t.label])) as Record<Tab, string>;

/** What each tab says when it has nothing to show. */
const EMPTY_STATE: Record<Tab, { icon: keyof typeof Ionicons.glyphMap; text: string }> = {
  todo: {
    icon: 'clipboard-outline',
    text: 'Nobody left to visit today. Farmers with a promised date are under Follow up.',
  },
  followup: {
    icon: 'checkmark-done-circle-outline',
    text: 'No follow-ups yet. Set a date while marking a visit and the farmer moves here.',
  },
  random: {
    icon: 'search-outline',
    text: 'Search a farmer by name or number and add them to today’s round.',
  },
  visited: { icon: 'walk-outline', text: 'No visits logged today yet.' },
};

/** Shared empty list, so the memoised page slice doesn't churn every render. */
const NO_ROWS: Row[] = [];

// Map of every farmer around the agronomist. Green pins are still to visit,
// grey ones are already done today. Tapping a pin posts its id back to RN.
function farmersMapHtml(
  pins: { id: string; name: string; lat: number; lng: number; visited: boolean; dist: string }[],
  me: { lat: number; lng: number } | null
) {
  return `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"/>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
  html,body,#map{height:100%;margin:0;padding:0}
  .lbl{font-family:sans-serif;font-size:13px;font-weight:700}
  .go{display:inline-block;margin-top:6px;background:#2e9e5b;color:#fff;padding:6px 12px;
      border-radius:14px;font-family:sans-serif;font-size:12px;font-weight:700;text-decoration:none}
</style></head><body>
<div id="map"></div><script>
  var PINS = ${JSON.stringify(pins)};
  var ME = ${JSON.stringify(me)};
  var map = L.map('map',{zoomControl:false,attributionControl:false});
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:20}).addTo(map);

  var bounds = [];
  PINS.forEach(function(p){
    var colour = p.visited ? '#8a8f98' : '#2e9e5b';
    var m = L.circleMarker([p.lat,p.lng],
      {radius:10,color:'#fff',weight:3,fillColor:colour,fillOpacity:1}).addTo(map);
    var html = '<div class="lbl">'+p.name+'</div><div>'+p.dist+'</div>'
      + (p.visited ? '<div style="color:#8a8f98">Visited today</div>'
                   : '<a class="go" href="#" onclick="pick(\\''+p.id+'\\');return false;">Start visit</a>');
    m.bindPopup(html);
    bounds.push([p.lat,p.lng]);
  });

  // Called from React Native each time a new fix arrives. It moves the dot and
  // nothing else — refitting the view as the agronomist walks would wrench the
  // map out from under them every time they panned somewhere to look at it.
  var meDot = null;
  function showMe(lat,lng){
    if(meDot) map.removeLayer(meDot);
    meDot = L.circleMarker([lat,lng],{radius:7,color:'#fff',weight:3,fillColor:'#1e88e5',fillOpacity:1})
      .addTo(map).bindPopup('<div class="lbl">You are here</div>');
  }

  if (ME) {
    showMe(ME.lat, ME.lng);
    bounds.push([ME.lat,ME.lng]);
  }

  // Framing happens once, on load, off whatever was known at that moment.
  if (bounds.length > 1) map.fitBounds(L.latLngBounds(bounds).pad(0.2));
  else if (bounds.length === 1) map.setView(bounds[0], 15);
  else map.setView([12.97,77.59], 10);

  function pick(id){
    if(window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify({farmerId:id}));
  }
</script></body></html>`;
}

export default function FarmVisitsScreen() {
  const theme = useTheme();
  const scheme = useColorScheme();
  const router = useRouter();
  const { user } = useAuth();
  const screenBg = scheme === 'dark' ? theme.background : GREEN_SURFACE;

  const [farmers, setFarmers] = useState<Farmer[]>([]);
  const [visitsByFarmer, setVisitsByFarmer] = useState<Record<string, Visit>>({});
  const [me, setMe] = useState<{ lat: number; lng: number } | null>(null);
  const [tab, setTab] = useState<Tab>('todo');
  /**
   * The farmer whose "no visit needed" reason is being asked for, and the
   * answers so far. The reason is required — an unexplained disappearance from
   * the day's list is exactly what this is meant to prevent.
   */
  const [skipFor, setSkipFor] = useState<Row | null>(null);
  const [skipReason, setSkipReason] = useState('');
  const [skipDate, setSkipDate] = useState<Date | null>(null);
  const [skipPicker, setSkipPicker] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [selectedVisit, setSelectedVisit] = useState<Visit | null>(null);
  /**
   * The map's document, built once when it is opened rather than on every
   * render.
   *
   * It has to be frozen: the html embeds both the pins and the agronomist's
   * position, so with a live position watch a fresh string would arrive every
   * few seconds and React Native would treat each one as a new document —
   * tearing down and reloading the whole map, losing the zoom, the pan and any
   * open popup with it. New fixes are injected into the live page instead.
   */
  const [mapHtml, setMapHtml] = useState<string | null>(null);
  const mapRef = useRef<WebView>(null);
  const showMap = mapHtml !== null;
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  /** Farmer ids picked for today's random round, oldest first. */
  const [randomIds, setRandomIds] = useState<string[]>([]);

  const startOfToday = () => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  };

  /**
   * Where the day's random round is kept.
   *
   * Stored on the device rather than the server: nothing has happened yet — the
   * agronomist is deciding who to drop in on — and a list of intentions is not
   * something the rest of the business has any use for until the visits are
   * actually made, which is what a Visit record is.
   *
   * Keyed by day, so tomorrow starts empty without anything having to clear it,
   * and by user, so two agronomists sharing a handset do not inherit each
   * other's round.
   */
  const randomKey = user ? `randomRound:${user._id}:${startOfToday().slice(0, 10)}` : null;

  useEffect(() => {
    if (!randomKey) return;
    let stale = false;
    AsyncStorage.getItem(randomKey)
      .then((raw) => {
        if (stale || !raw) return;
        const saved = JSON.parse(raw);
        if (Array.isArray(saved)) setRandomIds(saved.filter((v) => typeof v === 'string'));
      })
      // A round that cannot be read back is an empty round, not a crash.
      .catch(() => {});
    return () => {
      stale = true;
    };
  }, [randomKey]);

  /**
   * Add or remove a farmer, saving as we go.
   *
   * The write is fire-and-forget: the list on screen is the state, and making
   * the agronomist wait on the disk to see a row appear would be the only thing
   * they noticed about it.
   */
  const toggleRandom = (id: string) =>
    setRandomIds((ids) => {
      const next = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
      if (randomKey) AsyncStorage.setItem(randomKey, JSON.stringify(next)).catch(() => {});
      return next;
    });

  /**
   * Follow the agronomist's position for as long as this screen is in front.
   *
   * A single fix on open was wrong for how this screen is actually used: the
   * agronomist is walking or riding between farms the whole time it is open,
   * so "nearest farmer" went stale the moment they set off and could easily be
   * naming somewhere they had already driven past.
   *
   * Two stages, because they want different things. The first fix is Balanced
   * — good enough to rank farmers, and it answers in a second or two rather
   * than the ten a High fix can take under a canopy. The watch that follows is
   * High, since from then on the number on screen is being compared against a
   * farm the agronomist may be standing almost on top of.
   *
   * Note this never blocks the list: rows are fetched in parallel and simply
   * fill in their distances as fixes arrive.
   */
  const watchPosition = useCallback(() => {
    let sub: Location.LocationSubscription | null = null;
    let stopped = false;

    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted' || stopped) return;

        const first = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        if (stopped) return;
        setMe({ lat: first.coords.latitude, lng: first.coords.longitude });

        sub = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.High,
            // Throttles on movement, not on the clock: standing still in a
            // field costs nothing, and 15 m is well inside the distance at
            // which the nearest farmer could actually change.
            distanceInterval: 15,
            timeInterval: 5000,
          },
          (pos) => setMe({ lat: pos.coords.latitude, lng: pos.coords.longitude })
        );
        // Focus can be lost while the watch was still being set up, in which
        // case the cleanup below has already run and would miss this one.
        if (stopped) {
          sub.remove();
          sub = null;
        }
      } catch {
        // Distances read "No location" if this never answers.
      }
    })();

    // Stops the moment the screen goes away — the GPS must not keep running
    // behind the capture screen, let alone once the agronomist has left.
    return () => {
      stopped = true;
      sub?.remove();
      sub = null;
    };
  }, []);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const [fs, visits] = await Promise.all([
        api.listAgronomistFarmers(user._id),
        api.listVisits(user._id, startOfToday()).catch(() => []),
      ]);
      setFarmers(fs);
      // Map farmer id -> their (most recent) visit today, for the visited view.
      const map: Record<string, Visit> = {};
      for (const v of visits) {
        const fid = typeof v.farmer === 'string' ? v.farmer : v.farmer?._id;
        if (fid && !map[fid]) map[fid] = v;
      }
      setVisitsByFarmer(map);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      load();
      // Returned so the watch is torn down when the screen loses focus.
      return watchPosition();
    }, [load, watchPosition])
  );

  // Walk the blue dot across the open map as fixes arrive, rather than handing
  // the WebView a new document and making it start over.
  useEffect(() => {
    if (!showMap || !me) return;
    mapRef.current?.injectJavaScript(`showMe(${me.lat},${me.lng});true;`);
  }, [showMap, me]);

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = farmers.map((f) => {
      // farmPoint is the boundary centre (or registered location) — `location`
      // alone is empty for virtually every farmer.
      const p = f.farmPoint;
      const distance =
        me && p ? distanceKm(me, { lat: p.latitude, lng: p.longitude }) : null;
      return { ...f, distance, visited: !!visitsByFarmer[f._id] };
    });
    /**
     * Newest first, so a farmer just added — from the dashboard or by the
     * agronomist — is at the top of the list instead of buried wherever they
     * happen to stand.
     *
     * The server already returns them in this order; sorting again keeps the
     * screen right if that ever changes, and distance still rides along on
     * every row and drives the "Nearest farmer" card.
     */
    out.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
    return out;
  }, [farmers, me, visitsByFarmer]);


  /**
   * Search runs on the device, not the server: the whole roster is already
   * here, so filtering it locally is instant, works with no signal, and keeps
   * the newest-first order intact.
   *
   * Digits are matched against the mobile with punctuation stripped, so "9448"
   * finds a number however it was typed in.
   */
  const matches = useCallback(
    (r: Row) => {
      const q = query.trim().toLowerCase();
      if (!q) return true;
      if (r.name?.toLowerCase().includes(q)) return true;
      const typed = q.replace(/\D/g, '');
      return !!typed && (r.mobile ?? '').replace(/\D/g, '').includes(typed);
    },
    [query]
  );

  const remaining = useMemo(() => rows.filter((r) => !r.visited && matches(r)), [rows, matches]);
  /**
   * Farmers the agronomist asked to come back to, whose day has arrived.
   *
   * The date is set while marking a visit and cleared by the next one, so this
   * list is what the agent themselves said was owed — not simply everyone not
   * yet seen today. Overdue farmers stay until they are visited, and sort
   * first, because a follow-up missed last week matters more than one due now.
   */
  /**
   * Every farmer with a follow-up date on them, whatever that date is.
   *
   * Built from `rows`, not `remaining`: a farmer visited today and given a date
   * for next week belongs here the moment the visit is saved. Waiting for the
   * date to arrive would leave them in no list at all in between, which reads
   * as the follow-up not having saved.
   *
   * Soonest first, so anything overdue sits at the top.
   */
  const followUps = useMemo(
    () =>
      rows
        .filter((r) => {
          if (!r.nextFollowUpAt || !matches(r)) return false;
          // Claimed by To visit once the office has asked for a day — a farmer
          // on two lists is a farmer visited twice.
          if (r.visitDate) return false;
          return !Number.isNaN(new Date(r.nextFollowUpAt).getTime());
        })
        .sort(
          (a, b) => new Date(a.nextFollowUpAt!).getTime() - new Date(b.nextFollowUpAt!).getTime()
        ),
    [rows, matches]
  );
  /**
   * Today's visits, the most recent at the top.
   *
   * Ordered by when the visit was made rather than when the farmer was
   * registered: the tab only ever holds today's work, so the one just finished
   * is what the agent is looking for, and inheriting the roster's newest-first
   * order buried it under farmers seen hours earlier who simply happened to
   * have joined later.
   */
  const visited = useMemo(
    () =>
      rows
        .filter((r) => r.visited && matches(r))
        .sort((a, b) => {
          const at = visitsByFarmer[a._id]?.visitedAt;
          const bt = visitsByFarmer[b._id]?.visitedAt;
          return (bt ? +new Date(bt) : 0) - (at ? +new Date(at) : 0);
        }),
    [rows, matches, visitsByFarmer]
  );
  /**
   * Everyone still to see today, from either source.
   *
   * Which source a farmer came from is read off `onboardedBy` per row rather
   * than deciding which list they land in: it holds whoever registered them on
   * the ground, so anything other than this agronomist means the dashboard
   * handed them over — null when an admin created them there (that endpoint
   * never sets the field), another agronomist's id when an admin reassigned
   * them. Matching on "not mine" rather than "null" is what catches that second
   * case, and it is the same rule the server uses for its tallies.
   */
  const todo = useMemo(
    () =>
      remaining.filter(
        /**
         * Everyone still to see, plus anyone the office has asked for.
         *
         * A follow-up date normally moves a farmer to Follow up, and showing
         * them in both would have the agent visit twice. But `visitDate` is the
         * dashboard asking for a visit, and it wins: it is assigned work, so it
         * belongs on the assigned list. Without this, a request made from the
         * office against a farmer who already had a follow-up landed in neither
         * place the office expected, and the agent never saw it.
         */
        (r) => !!r.visitDate || !r.nextFollowUpAt
      ),
    [remaining]
  );
  /**
   * The Random tab: a lookup, not a roster. It stays empty until something is
   * typed, because the agronomist already knows who they are standing in front
   * of — listing all sixty farmers first would only be something to scroll past.
   *
   * Every farmer is searchable, visited or not: a trip nobody planned can
   * perfectly well be to someone already seen today.
   *
   * Nearest first, alone among the tabs — with two farmers of the same name,
   * distance is what tells them apart.
   */
  const everyone = useMemo(() => {
    if (!query.trim()) return NO_ROWS;
    const found = rows.filter(matches);
    return [...found].sort((a, b) => {
      if (a.distance == null && b.distance == null) return a.name.localeCompare(b.name);
      if (a.distance == null) return 1;
      if (b.distance == null) return -1;
      return a.distance - b.distance;
    });
  }, [rows, matches, query]);
  /**
   * The day's totals, deliberately NOT narrowed by the search box: "Visited
   * today" is a fact about the day, and watching it drop to zero while typing a
   * name would be alarming and wrong.
   */
  const totals = useMemo(
    () => ({
      visited: rows.filter((r) => r.visited).length,
      remaining: rows.filter((r) => !r.visited).length,
    }),
    [rows]
  );
  /**
   * The farmers picked for a random visit today, in the order they were added.
   *
   * `randomIds` is the stored form and this resolves it against the roster, so
   * a farmer who has since been trashed simply drops out rather than leaving a
   * row with no name on it.
   */
  const randomList = useMemo(
    () => randomIds.map((id) => rows.find((r) => r._id === id)).filter(Boolean) as Row[],
    [randomIds, rows]
  );

  const counts: Record<Tab, number> = {
    todo: todo.length,
    followup: followUps.length,
    // What has been picked, not what the search happens to be showing — the
    // count is the size of the day's random round.
    random: randomIds.length,
    visited: visited.length,
  };
  const searching = !!query.trim();
  /**
   * What the list shows. Random is the odd one out: it is a list being built,
   * so typing turns it into the search it is built from and clearing the box
   * turns it back into what has been picked.
   */
  const list: Row[] =
    tab === 'todo'
      ? todo
      : tab === 'followup'
        ? followUps
        : tab === 'visited'
          ? visited
          : searching
            ? everyone
            : randomList;
  // The suggestion card follows the unfiltered roster: it is about the day, not
  // about whatever is currently typed in the box.
  const nearest = useMemo(() => {
    const todo = rows.filter((r) => !r.visited);
    const located = todo.filter((r) => r.distance != null);
    // Genuinely the closest, computed rather than read off the top of the list —
    // the list is ordered by recency now, so its first row means nothing here.
    // With no fix yet (or no farm points at all) fall back to the first one, so
    // the card — and the map button on it — stays reachable.
    return located.length
      ? located.reduce((best, r) => (r.distance! < best.distance! ? r : best))
      : todo[0];
  }, [rows]);

  /**
   * Which page of `list` is on screen.
   *
   * This used to be a window that only ever grew as the agent scrolled, so a
   * long scroll through a big roster ended up with every row mounted and the
   * screen getting heavier the further down it went. A page holds exactly PAGE
   * rows whichever page it is, so the last one costs the same as the first.
   */
  const [pageIndex, setPageIndex] = useState(0);
  // Switching tab, searching, or reloading starts again from page one.
  useEffect(() => setPageIndex(0), [tab, farmers.length, query]);

  const pageCount = Math.max(1, Math.ceil(list.length / PAGE));
  /**
   * Clamped on read rather than corrected in an effect: deleting the last
   * farmer on the final page shortens the list on the very same render, and an
   * effect would let one empty page paint before it caught up.
   */
  const current = Math.min(pageIndex, pageCount - 1);
  const start = current * PAGE;
  const page = useMemo(() => list.slice(start, start + PAGE), [list, start]);

  /**
   * Paging leaves the scroll position where the last page ended, which lands
   * the agent mid-list on a page they have not read. Every page starts at the
   * top.
   */
  const listRef = useRef<FlatList<Row>>(null);
  const goToPage = (n: number) => {
    setPageIndex(n);
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  };

  // Everyone we can actually place on the map.
  const pins = useMemo(
    () =>
      rows
        .filter((r) => r.farmPoint)
        .map((r) => ({
          id: r._id,
          name: r.name,
          lat: r.farmPoint!.latitude,
          lng: r.farmPoint!.longitude,
          visited: r.visited,
          dist: fmtDist(r.distance),
        })),
    [rows]
  );

  /**
   * One row. Extracted and memo-friendly so FlatList can recycle it instead of
   * rebuilding every card on each render.
   */
  /**
   * Record the reason and drop the row. Removed from local state immediately
   * rather than waiting for a refetch: the agent is working down a list, and a
   * row that lingers after being dealt with invites a second tap.
   */
  const confirmSkip = async () => {
    if (!user || !skipFor || !skipReason.trim() || skipping) return;
    setSkipping(true);
    try {
      await api.skipFarmerVisit(user._id, skipFor._id, {
        reason: skipReason.trim(),
        nextFollowUpAt: skipDate ? skipDate.toISOString() : null,
      });
      setFarmers((fs) => fs.filter((f) => f._id !== skipFor._id));
      setSkipFor(null);
      setSkipReason('');
      setSkipDate(null);
    } catch (e: any) {
      Alert.alert('Could not save', e?.message || 'Please try again.');
    } finally {
      setSkipping(false);
    }
  };

  const renderRow = useCallback(
    ({ item: f }: { item: Row }) => {
      const visit = visitsByFarmer[f._id];
      const thumb = visit?.farmPhotoUrl || visit?.farmerPhotoUrl;
      /**
       * Which date the row should count down to. On Follow up that is the date
       * the agent themselves set; everywhere else it is the day the dashboard
       * asked for the visit. `dueLabel` already words both the same way.
       */
      const due =
        tab === 'followup'
          ? dueLabel(f.nextFollowUpAt)
          : f.visited
            ? null
            : dueLabel(f.visitDate);
      /**
       * Random has two modes in one list. Typing turns it into a picker whose
       * rows add to the day's round; clearing the box turns it back into the
       * round itself, whose rows start the visit.
       */
      const picking = tab === 'random' && searching;
      const picked = randomIds.includes(f._id);
      return (
        <Pressable
          // On Random the row never opens today's photos: an already-visited
          // farmer is a perfectly good target for a second, unplanned trip.
          onPress={() =>
            picking
              ? toggleRandom(f._id)
              : f.visited && tab !== 'random'
                ? setSelectedVisit(visit)
                : startVisit(f)
          }
          style={({ pressed }) => [styles.row, pressed && { opacity: 0.85 }]}>
          {/* Who they are, across the full width of the card. */}
          <View style={styles.rowTop}>
          {f.visited && thumb ? (
            <TappablePhoto uri={thumb} style={styles.rowThumb} caption={f.name} />
          ) : (
            <View
              style={[
                styles.avatar,
                { backgroundColor: f.visited ? GREEN : 'rgba(46,158,91,0.12)' },
              ]}>
              {f.visited ? (
                <Ionicons name="checkmark" size={22} color="#fff" />
              ) : (
                <ThemedText style={{ color: GREEN, fontWeight: '800', fontSize: 18 }}>
                  {f.name?.charAt(0)?.toUpperCase() ?? '?'}
                </ThemedText>
              )}
            </View>
          )}
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={styles.nameRow}>
              <ThemedText type="smallBold" numberOfLines={1} style={styles.rowName}>
                {f.name}
              </ThemedText>
              {/*
                Whose farmer this is. `onboardedBy` holds whoever registered
                them on the ground, so anything other than this agent means the
                dashboard handed them over — null when an admin created them
                there, another id when they were reassigned. The same rule the
                Assigned tab uses, said on the row so it holds wherever the
                farmer appears.
              */}
              <View
                style={[
                  styles.ownTag,
                  {
                    backgroundColor:
                      onboarderId(f) === user?._id ? Brand.primarySurface : Brand.secondarySurface,
                  },
                ]}>
                <Ionicons
                  name={onboarderId(f) === user?._id ? 'person-add' : 'briefcase'}
                  size={9}
                  color={onboarderId(f) === user?._id ? GREEN : Brand.secondary}
                />
                <ThemedText
                  type="small"
                  style={[
                    styles.ownTagText,
                    { color: onboarderId(f) === user?._id ? GREEN : Brand.secondary },
                  ]}>
                  {onboarderId(f) === user?._id ? 'Yours' : 'Assigned'}
                </ThemedText>
              </View>
            </View>
            {/* Number and the day they were registered on one line. Joined
                rather than stacked so the row keeps its height, and built from
                whichever parts exist — a farmer with no number still shows
                their date instead of an empty line.

                `numberOfLines` matters as much as the width: a phone number
                broken across two lines mid-digit is unreadable and unusable. */}
            {f.mobile || fmtAdded(f.createdAt) ? (
              <ThemedText
                type="small"
                themeColor="textSecondary"
                numberOfLines={1}
                style={styles.rowMobile}>
                {[f.mobile, fmtAdded(f.createdAt)].filter(Boolean).join('  ·  ')}
              </ThemedText>
            ) : null}
            <ThemedText
              type="small"
              numberOfLines={1}
              themeColor={due?.overdue ? undefined : 'textSecondary'}
              style={[styles.rowMeta, due?.overdue && { color: Brand.danger, fontWeight: '700' }]}>
              {f.visited && tab !== 'followup'
                ? 'Visited · tap to view photos'
                : due
                  ? `${due.label} · ${fmtDist(f.distance)}`
                  : fmtDist(f.distance)}
            </ThemedText>
          </View>
          </View>

          {/* Actions on their own line, so nothing squeezes the text above. */}
          <View style={styles.rowActions}>
          {f.mobile ? (
            <Pressable
              onPress={() => callFarmer(user, { _id: f._id, name: f.name, mobile: f.mobile })}
              hitSlop={8}
              style={({ pressed }) => [styles.callBtn, pressed && { opacity: 0.85 }]}>
              <Ionicons name="call" size={16} color="#fff" />
            </Pressable>
          ) : null}
          {picking ? (
            // Its own Pressable as well as the whole row, so the button reads
            // as the thing to hit while the row stays a big target in the field.
            <Pressable
              onPress={() => toggleRandom(f._id)}
              hitSlop={8}
              style={({ pressed }) => [
                picked ? styles.addedBtn : styles.visitBtn,
                pressed && { opacity: 0.85 },
              ]}>
              <Ionicons
                name={picked ? 'checkmark' : 'add'}
                size={16}
                color={picked ? GREEN : '#fff'}
              />
              <ThemedText
                type="small"
                style={{ color: picked ? GREEN : '#fff', fontWeight: '700' }}>
                {picked ? 'Added' : 'Add'}
              </ThemedText>
            </Pressable>
          ) : tab === 'random' ? (
            <>
              {/* Taking a farmer back off the round — the only way to undo a
                  mistap, since nothing else on this tab removes one. */}
              <Pressable
                onPress={() => toggleRandom(f._id)}
                hitSlop={8}
                accessibilityLabel={`Remove ${f.name} from the round`}
                style={({ pressed }) => [styles.dropBtn, pressed && { opacity: 0.85 }]}>
                <Ionicons name="close" size={16} color={theme.textSecondary} />
              </Pressable>
              <View style={styles.visitBtn}>
                <Ionicons name="camera" size={16} color="#fff" />
                <ThemedText type="small" style={{ color: '#fff', fontWeight: '700' }}>
                  Visit
                </ThemedText>
              </View>
            </>
          ) : f.visited ? (
            <Ionicons name="images-outline" size={20} color={GREEN} />
          ) : (
            <View style={styles.visitBtn}>
              <Ionicons name="camera" size={16} color="#fff" />
              <ThemedText type="small" style={{ color: '#fff', fontWeight: '700' }}>
                Visit
              </ThemedText>
            </View>
          )}
          {/* "This one does not need a trip" — only on the two tabs that list
              work still owed. Asking why is the point: a farmer vanishing from
              the day with no explanation is what this replaces. */}
          {(tab === 'todo' || tab === 'followup') && !f.visited ? (
            <Pressable
              onPress={() => {
                setSkipReason('');
                setSkipDate(null);
                setSkipFor(f);
              }}
              hitSlop={8}
              accessibilityLabel={`${f.name} does not need a visit`}
              style={({ pressed }) => [styles.skipBtn, pressed && { opacity: 0.85 }]}>
              <Ionicons name="close" size={16} color={Brand.danger} />
            </Pressable>
          ) : null}
          </View>
        </Pressable>
      );
    },
    // `me` and `router` are here because the row closes over `startVisit`,
    // which stamps the visit with the agent's current position. Leaving them
    // out would freeze the row against the location as it was when the screen
    // opened — usually null, before the GPS had answered.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visitsByFarmer, user, me, router, tab, searching, randomIds, theme.textSecondary]
  );

  /**
   * Open the capture screen for a farmer.
   *
   * A visit started from the Random tab carries a source, which is what marks
   * it as one the agronomist chose to make. It is the farmer's own "referred
   * by" wherever that was recorded — the reason for dropping in is normally
   * however that farmer reached us — and plain 'random' when it was not, which
   * is every farmer registered before we started asking.
   */
  const startVisit = (f: Row) =>
    router.push({
      pathname: '/visit-farmer',
      params: {
        farmerId: f._id,
        farmerName: f.name,
        farmerMobile: f.mobile,
        lat: me?.lat != null ? String(me.lat) : '',
        lng: me?.lng != null ? String(me.lng) : '',
        ...(tab === 'random' ? { source: f.referredBy || 'random' } : {}),
      },
    } as never);

  return (
    <View style={[styles.container, { backgroundColor: screenBg }]}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <View style={styles.topBar}>
          <Pressable onPress={() => router.back()} hitSlop={10}>
            <Ionicons name="chevron-back" size={26} color={theme.text} />
          </Pressable>
          <ThemedText type="smallBold">Farm Visits</ThemedText>
          <View style={{ width: 26 }} />
        </View>

        {/* Find a farmer, or register one who is not on the list yet. */}
        <View style={styles.searchRow}>
          <View style={styles.searchBar}>
            <Ionicons name="search" size={16} color={theme.textSecondary} />
            <TextInput
              value={query}
              onChangeText={(v) => setQuery(limitSearch(v))}
              placeholder="Search by name or number"
              placeholderTextColor={theme.textSecondary}
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="search"
              style={[styles.searchInput, { color: theme.text }]}
            />
            {query.length > 0 ? (
              <Pressable onPress={() => setQuery('')} hitSlop={10}>
                <Ionicons name="close-circle" size={18} color={theme.textSecondary} />
              </Pressable>
            ) : null}
          </View>
          <Pressable
            onPress={() => router.push('/onboard-farmer' as never)}
            hitSlop={8}
            accessibilityLabel="Add a farmer"
            style={({ pressed }) => [styles.addBtn, pressed && { opacity: 0.85 }]}>
            <Ionicons name="person-add" size={18} color="#fff" />
          </Pressable>
        </View>

        {/*
          The day's tally and the two prompts below it belong to the tabs that
          are about today's work. Random is a lookup — one search box and its
          answer — so none of it appears there.
        */}
        {tab !== 'random' && (
        <View style={styles.summaryRow}>
          <View style={styles.summaryCard}>
            <ThemedText style={[styles.summaryNum, { color: GREEN }]}>{totals.visited}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">Visited today</ThemedText>
          </View>
          <View style={styles.summaryCard}>
            <ThemedText style={[styles.summaryNum, { color: '#f59e0b' }]}>{totals.remaining}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">Remaining</ThemedText>
          </View>
        </View>
        )}

        {/*
          Nearest suggestion — opens the map of every farmer around you. Only
          on the two tabs that are lists of farmers still to see; Random and
          Visited are both records of visits already made, where "go here next"
          is not the question being asked.
        */}
        {(tab === 'todo' || tab === 'followup') && nearest && (
          <Pressable
            onPress={() => setMapHtml(farmersMapHtml(pins, me))}
            style={({ pressed }) => [styles.nearestCard, pressed && { opacity: 0.9 }]}>
            <Ionicons name="navigate" size={22} color="#fff" />
            <View style={{ flex: 1 }}>
              <ThemedText style={styles.nearestLabel}>Nearest farmer</ThemedText>
              <ThemedText style={styles.nearestName} numberOfLines={1}>
                {nearest.name} · {fmtDist(nearest.distance)}
              </ThemedText>
            </View>
            <View style={styles.startPill}>
              <ThemedText style={styles.startPillText}>
                {pins.length > 0 ? 'View map' : 'Start visit'}
              </ThemedText>
            </View>
          </Pressable>
        )}


        {/*
          All five tabs are on screen at once. They stack the count UNDER the
          label rather than sitting beside it — "Follow up (11)" on one line
          needs more width than a fifth of a phone has, and the strip used to
          scroll sideways, which hid whichever tabs were off either edge.
        */}
        <View style={styles.segment}>
          {TABS.map(({ key, label }) => {
            const on = tab === key;
            const colour = on ? '#fff' : theme.textSecondary;
            return (
              <Pressable
                key={key}
                onPress={() => setTab(key)}
                style={[styles.segBtn, on && { backgroundColor: GREEN }]}>
                {/* Two lines allowed: at a fifth of a narrow screen — or on a
                    phone set to a large system font — "Follow up" truncates on
                    one. Wrapping keeps the word whole and grows every tab
                    equally, so the strip stays level. */}
                <ThemedText
                  numberOfLines={2}
                  style={[styles.segLabel, { color: colour }]}>
                  {label}
                </ThemedText>
                <ThemedText style={[styles.segCount, { color: colour }]}>{counts[key]}</ThemedText>
              </Pressable>
            );
          })}
        </View>

        {/*
          FlatList, not a ScrollView of every row: it mounts only what is on
          screen, and it is never handed more than one page of PAGE rows, so
          the cost of a screen is flat no matter how big the roster is.

          Deliberately no `getItemLayout`. Skipping measurement only pays off
          over a long list, and a page is PAGE rows — which React Native
          measures for nothing. What it costs is pinning every row to one fixed
          height, and it was understating the pitch anyway by ignoring the gap
          between cards. Self-measuring rows are what let a row carry a third
          line.
        */}
        <FlatList
          ref={listRef}
          data={loading ? [] : page}
          keyExtractor={(item) => item._id}
          renderItem={renderRow}
          initialNumToRender={PAGE}
          maxToRenderPerBatch={PAGE}
          windowSize={7}
          removeClippedSubviews
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}
          ListEmptyComponent={
            loading ? (
              <ActivityIndicator style={{ marginTop: Spacing.six }} color={GREEN} />
            ) : (
              <ThemedView type="backgroundElement" style={styles.empty}>
                <Ionicons
                  name={searching ? 'search-outline' : EMPTY_STATE[tab].icon}
                  size={40}
                  color={theme.textSecondary}
                />
                <ThemedText type="small" themeColor="textSecondary" style={{ textAlign: 'center' }}>
                  {searching
                    ? tab === 'random'
                      ? `No farmer matches “${query.trim()}”. Register them, then visit.`
                      : `No farmer in ${TAB_LABEL[tab]} matches “${query.trim()}”.`
                    : EMPTY_STATE[tab].text}
                </ThemedText>
                {/* The way on when the farmer being visited is not registered
                    yet. Offered only where the tab is a list of people still to
                    visit — never under Visited, which is a record of the past. */}
                {searching && tab !== 'visited' ? (
                  <Pressable
                    onPress={() => router.push('/onboard-farmer' as never)}
                    style={({ pressed }) => [styles.emptyAdd, pressed && { opacity: 0.85 }]}>
                    <Ionicons name="person-add" size={16} color="#fff" />
                    <ThemedText type="small" style={{ color: '#fff', fontWeight: '700' }}>
                      Add farmer
                    </ThemedText>
                  </Pressable>
                ) : null}
              </ThemedView>
            )
          }
        />

        {/*
          Pager, outside the FlatList so it stays put instead of scrolling away
          at the end of the rows. Hidden when everything fits on one page —
          there is nothing to page through, and the buttons would only be dead
          weight under a short list.
        */}
        {!loading && pageCount > 1 ? (
          <View style={styles.pager}>
            <Pressable
              onPress={() => goToPage(current - 1)}
              disabled={current === 0}
              hitSlop={8}
              accessibilityLabel="Previous page"
              style={({ pressed }) => [
                styles.pagerBtn,
                current === 0 && styles.pagerBtnOff,
                pressed && { opacity: 0.85 },
              ]}>
              <Ionicons name="chevron-back" size={18} color="#fff" />
            </Pressable>

            <View style={{ alignItems: 'center' }}>
              <ThemedText type="smallBold">
                Page {current + 1} of {pageCount}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={{ fontSize: 12 }}>
                {start + 1}–{start + page.length} of {list.length}
              </ThemedText>
            </View>

            <Pressable
              onPress={() => goToPage(current + 1)}
              disabled={current >= pageCount - 1}
              hitSlop={8}
              accessibilityLabel="Next page"
              style={({ pressed }) => [
                styles.pagerBtn,
                current >= pageCount - 1 && styles.pagerBtnOff,
                pressed && { opacity: 0.85 },
              ]}>
              <Ionicons name="chevron-forward" size={18} color="#fff" />
            </Pressable>
          </View>
        ) : null}
      </SafeAreaView>

      {/* All farmers around you. Tap a pin to start that visit. */}
      <Modal visible={showMap} animationType="slide" onRequestClose={() => setMapHtml(null)}>
        <View style={{ flex: 1, backgroundColor: theme.background }}>
          <SafeAreaView style={{ flex: 1 }} edges={['top']}>
            <View style={styles.topBar}>
              <Pressable onPress={() => setMapHtml(null)} hitSlop={10}>
                <Ionicons name="close" size={26} color={theme.text} />
              </Pressable>
              <ThemedText type="smallBold">Farmers near you ({pins.length})</ThemedText>
              <View style={{ width: 26 }} />
            </View>

            {pins.length === 0 ? (
              <ThemedView type="backgroundElement" style={[styles.empty, { margin: Spacing.four }]}>
                <Ionicons name="map-outline" size={40} color={theme.textSecondary} />
                <ThemedText type="small" themeColor="textSecondary" style={{ textAlign: 'center' }}>
                  None of your farmers have a farm boundary or location saved yet, so there is
                  nothing to show on the map.
                </ThemedText>
              </ThemedView>
            ) : mapHtml ? (
              // Guarded on the html, not on `showMap`: a Modal still evaluates
              // its children while closed, and a WebView handed a null document
              // is not something to find out about in the field.
              <WebView
                originWhitelist={['*']}
                ref={mapRef}
                source={{ html: mapHtml }}
                style={{ flex: 1 }}
                javaScriptEnabled
                onMessage={(e) => {
                  try {
                    const { farmerId } = JSON.parse(e.nativeEvent.data);
                    const f = rows.find((r) => r._id === farmerId);
                    if (f) {
                      setMapHtml(null);
                      startVisit(f);
                    }
                  } catch {
                    // ignore malformed messages
                  }
                }}
              />
            ) : null}

            <View style={styles.legend}>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: GREEN }]} />
                <ThemedText type="small" themeColor="textSecondary">To visit</ThemedText>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: '#8a8f98' }]} />
                <ThemedText type="small" themeColor="textSecondary">Visited today</ThemedText>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: '#1e88e5' }]} />
                <ThemedText type="small" themeColor="textSecondary">You</ThemedText>
              </View>
            </View>
          </SafeAreaView>
        </View>
      </Modal>


      {/*
        Why this farmer needs no visit. A reason is required; a date is not —
        "not today, try Friday" and "nothing owed here" are both real answers,
        and forcing a date on the second would put the farmer back on the list
        for no reason.
      */}
      <Modal
        visible={!!skipFor}
        transparent
        animationType="slide"
        onRequestClose={() => setSkipFor(null)}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Pressable style={styles.backdrop} onPress={() => !skipping && setSkipFor(null)}>
            <Pressable
              style={[styles.detailSheet, { backgroundColor: theme.background }]}
              onPress={() => {}}>
              <View style={styles.sheetHandle} />
              <ThemedText type="smallBold" style={{ fontSize: 16 }}>
                No visit needed for {skipFor?.name}?
              </ThemedText>
              <ThemedText
                type="small"
                themeColor="textSecondary"
                style={{ marginBottom: Spacing.three }}>
                They come off today&apos;s list. Nothing is deleted.
              </ThemedText>

              <ThemedText type="small" themeColor="textSecondary">
                Reason <ThemedText style={{ color: Brand.danger }}>*</ThemedText>
              </ThemedText>
              <TextInput
                value={skipReason}
                onChangeText={setSkipReason}
                placeholder="e.g. already met at the market, crop not sown yet"
                placeholderTextColor={theme.textSecondary}
                multiline
                style={[
                  styles.skipInput,
                  { color: theme.text, backgroundColor: theme.backgroundElement },
                ]}
              />

              <ThemedText
                type="small"
                themeColor="textSecondary"
                style={{ marginTop: Spacing.three }}>
                Next follow-up (optional)
              </ThemedText>
              <Pressable
                onPress={() => setSkipPicker(true)}
                style={[
                  styles.skipInput,
                  styles.skipDate,
                  { backgroundColor: theme.backgroundElement },
                ]}>
                <Ionicons
                  name="calendar-outline"
                  size={18}
                  color={skipDate ? GREEN : theme.textSecondary}
                />
                <ThemedText
                  style={{ flex: 1, color: skipDate ? theme.text : theme.textSecondary }}>
                  {skipDate ? fmtFollowUp(skipDate) : 'No date — leave them off the list'}
                </ThemedText>
                {skipDate ? (
                  <Pressable onPress={() => setSkipDate(null)} hitSlop={10}>
                    <Ionicons name="close-circle" size={18} color={theme.textSecondary} />
                  </Pressable>
                ) : null}
              </Pressable>
              {skipPicker && (
                <DateTimePicker
                  value={skipDate ?? new Date(Date.now() + 7 * 86400000)}
                  mode="date"
                  minimumDate={new Date()}
                  onChange={(event, selected) => {
                    if (Platform.OS !== 'ios') setSkipPicker(false);
                    if (event.type === 'set' && selected) setSkipDate(selected);
                  }}
                />
              )}
              {Platform.OS === 'ios' && skipPicker && (
                <Pressable onPress={() => setSkipPicker(false)} style={styles.skipDone}>
                  <ThemedText type="linkPrimary">Done</ThemedText>
                </Pressable>
              )}

              <View style={styles.skipActions}>
                <Pressable
                  onPress={() => setSkipFor(null)}
                  disabled={skipping}
                  style={({ pressed }) => [styles.skipCancel, pressed && { opacity: 0.7 }]}>
                  <ThemedText type="smallBold">Cancel</ThemedText>
                </Pressable>
                <Pressable
                  onPress={confirmSkip}
                  disabled={!skipReason.trim() || skipping}
                  style={({ pressed }) => [
                    styles.skipConfirm,
                    (!skipReason.trim() || skipping) && { opacity: 0.4 },
                    pressed && skipReason.trim() && { opacity: 0.85 },
                  ]}>
                  {skipping ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <ThemedText type="smallBold" style={{ color: '#fff' }}>
                      Save
                    </ThemedText>
                  )}
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>

      {/* Visit detail — the photos the agronomist captured */}
      <Modal
        visible={!!selectedVisit}
        transparent
        animationType="slide"
        onRequestClose={() => setSelectedVisit(null)}>
        <Pressable style={styles.backdrop} onPress={() => setSelectedVisit(null)}>
          <Pressable style={[styles.detailSheet, { backgroundColor: theme.background }]} onPress={() => {}}>
            <View style={styles.sheetHandle} />
            {selectedVisit && (
              <ScrollView showsVerticalScrollIndicator={false}>
                <ThemedText type="subtitle">{selectedVisit.farmerName || 'Farmer'}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary" style={{ marginBottom: Spacing.three }}>
                  Visited {new Date(selectedVisit.visitedAt).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </ThemedText>
                {/* Only a random visit carries a source, so this is also what
                    tells the two kinds of visit apart on the detail sheet. */}
                {selectedVisit.source ? (
                  <View style={[styles.sourceChip, { marginBottom: Spacing.three }]}>
                    <Ionicons name="shuffle" size={13} color={GREEN} />
                    <ThemedText type="small" style={styles.sourceChipText}>
                      Random visit · {visitSourceLabel(selectedVisit.source)}
                    </ThemedText>
                  </View>
                ) : null}

                {selectedVisit.farmPhotoUrl ? (
                  <>
                    <ThemedText type="small" themeColor="textSecondary" style={styles.detailLabel}>Farm photo</ThemedText>
                    <TappablePhoto
                      uri={selectedVisit.farmPhotoUrl}
                      group={[selectedVisit.farmPhotoUrl, selectedVisit.farmerPhotoUrl].filter(Boolean)}
                      index={0}
                      style={styles.detailPhoto}
                      caption="farm photo"
                    />
                  </>
                ) : null}
                {selectedVisit.farmerPhotoUrl ? (
                  <>
                    <ThemedText type="small" themeColor="textSecondary" style={styles.detailLabel}>Photo with farmer</ThemedText>
                    <TappablePhoto
                      uri={selectedVisit.farmerPhotoUrl}
                      group={[selectedVisit.farmPhotoUrl, selectedVisit.farmerPhotoUrl].filter(Boolean)}
                      index={selectedVisit.farmPhotoUrl ? 1 : 0}
                      style={styles.detailPhoto}
                      caption="photo with the farmer"
                    />
                  </>
                ) : null}
                {!selectedVisit.farmPhotoUrl && !selectedVisit.farmerPhotoUrl ? (
                  <ThemedText type="small" themeColor="textSecondary">No photos were captured for this visit.</ThemedText>
                ) : null}

                {selectedVisit.notes ? (
                  <>
                    <ThemedText type="small" themeColor="textSecondary" style={styles.detailLabel}>Notes</ThemedText>
                    <ThemedText type="small">{selectedVisit.notes}</ThemedText>
                  </>
                ) : null}

                {/* What was promised at THIS visit. The farmer record only
                    holds the current reason, so an older visit could not
                    otherwise say why it was scheduled. */}
                {selectedVisit.followUpNote ? (
                  <>
                    <ThemedText type="small" themeColor="textSecondary" style={styles.detailLabel}>
                      Why come back
                    </ThemedText>
                    <ThemedText type="small">{selectedVisit.followUpNote}</ThemedText>
                  </>
                ) : null}

                {selectedVisit.location?.latitude != null && selectedVisit.location?.longitude != null ? (
                  <Pressable
                    onPress={() =>
                      Linking.openURL(
                        `https://www.google.com/maps?q=${selectedVisit.location.latitude},${selectedVisit.location.longitude}`
                      ).catch(() => {})
                    }
                    style={styles.mapLink}>
                    <Ionicons name="location" size={16} color={GREEN} />
                    <ThemedText type="small" style={{ color: GREEN, fontWeight: '700' }}>View location on map</ThemedText>
                  </Pressable>
                ) : null}
              </ScrollView>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.two,
  },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    backgroundColor: '#fff',
    borderRadius: Radius.lg,
    ...CardShadow,
  },
  searchInput: { flex: 1, paddingVertical: Spacing.two + 2, fontSize: 15 },
  addBtn: {
    width: 44,
    height: 44,
    borderRadius: Radius.lg,
    backgroundColor: GREEN,
    alignItems: 'center',
    justifyContent: 'center',
    ...CardShadow,
  },
  emptyAdd: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: Spacing.two,
    backgroundColor: GREEN,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Radius.pill,
  },
  summaryRow: { flexDirection: 'row', gap: Spacing.three, paddingHorizontal: Spacing.four, paddingBottom: Spacing.two },
  summaryCard: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: Spacing.four,
    padding: Spacing.three,
    alignItems: 'center',
  },
  summaryNum: { fontSize: 26, fontWeight: '800' },
  nearestCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    backgroundColor: GREEN,
    marginHorizontal: Spacing.four,
    marginBottom: Spacing.two,
    padding: Spacing.three,
    borderRadius: Spacing.four,
  },
  sourceChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 5,
    paddingHorizontal: Spacing.two,
    paddingVertical: 4,
    borderRadius: Spacing.four,
    backgroundColor: Brand.surface,
  },
  sourceChipText: { color: GREEN, fontWeight: '700', fontSize: 12 },
  sourceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.three + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0,0,0,0.08)',
  },
  nearestLabel: { color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: '600' },
  nearestName: { color: '#fff', fontSize: 16, fontWeight: '800' },
  startPill: { backgroundColor: 'rgba(255,255,255,0.2)', paddingHorizontal: Spacing.three, paddingVertical: 6, borderRadius: Spacing.four },
  startPillText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  // Map legend.
  legend: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: Spacing.four,
    paddingVertical: Spacing.three,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  // "N farmers need details" button + the sheet it opens.
  segment: {
    flexDirection: 'row',
    gap: 6,
    marginHorizontal: Spacing.four,
    marginBottom: Spacing.two,
  },
  segBtn: {
    // Equal fifths, so every tab is visible without scrolling. Labels are
    // kept to one short word for the same reason.
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.two,
    paddingHorizontal: 2,
    borderRadius: Spacing.four,
    backgroundColor: 'rgba(0,0,0,0.05)',
  },
  // Explicit lineHeight: ThemedText's `small` pins it at 20, which would leave
  // a tall gap around an 11pt label.
  segLabel: { fontSize: 11, lineHeight: 14, fontWeight: '700', textAlign: 'center' },
  segCount: { fontSize: 15, lineHeight: 19, fontWeight: '800' },
  scroll: { paddingHorizontal: Spacing.four, paddingBottom: Spacing.six, gap: Spacing.two },
  pager: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.five,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.three,
  },
  pagerBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: GREEN,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Kept in place rather than hidden, so the pager doesn't jump about as the
  // agent reaches either end of the list.
  pagerBtnOff: { opacity: 0.3 },
  empty: { marginTop: Spacing.four, padding: Spacing.five, borderRadius: Spacing.three, alignItems: 'center', gap: Spacing.three },
  // The card is a column now: identity on top with the full width to itself,
  // actions underneath. Side-by-side, three buttons left the name truncated and
  // the phone number wrapped across two lines.
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  ownTag: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: Spacing.five,
  },
  ownTagText: { fontSize: 9, fontWeight: '800' },
  rowName: { fontSize: 15, flexShrink: 1 },
  rowActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginTop: Spacing.three,
  },
  rowMeta: { fontSize: 12 },
  row: {
    backgroundColor: '#fff',
    padding: Spacing.three,
    borderRadius: Spacing.four,
  },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  // Tighter than the default `small` leading, so a third line fits the card
  // without it growing much taller.
  rowMobile: { fontSize: 13, lineHeight: 17 },
  rowThumb: { width: 44, height: 44, borderRadius: Spacing.two },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  detailSheet: {
    borderTopLeftRadius: Spacing.five,
    borderTopRightRadius: Spacing.five,
    padding: Spacing.four,
    maxHeight: '85%',
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(0,0,0,0.15)',
    alignSelf: 'center',
    marginBottom: Spacing.three,
  },
  detailLabel: { marginTop: Spacing.three, marginBottom: Spacing.one, fontWeight: '700' },
  detailPhoto: { width: '100%', height: 220, borderRadius: Spacing.four },
  mapLink: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: Spacing.four, marginBottom: Spacing.two },
  skipBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: `${Brand.danger}55`,
    backgroundColor: Brand.dangerSurface,
  },
  skipInput: {
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 15,
    marginTop: Spacing.one,
  },
  skipDate: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  skipDone: { alignSelf: 'flex-end', padding: Spacing.two },
  skipActions: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.four },
  skipCancel: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.12)',
  },
  skipConfirm: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
    backgroundColor: GREEN,
  },
  callBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: GREEN,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Already on the round: outlined rather than filled, so a screen of results
  // shows at a glance which ones are in.
  addedBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1.5,
    borderColor: GREEN,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two - 1.5,
    borderRadius: Spacing.four,
  },
  dropBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.05)',
  },
  visitBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: GREEN,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 2,
    borderRadius: Spacing.four,
  },
});
