const STORAGE_KEY = "club-activity-map:v1";
const DEFAULT_CENTER = [39.8283, -98.5795];
const DEFAULT_ZOOM = 4;

const CATEGORY_COLORS = {
  Service: "#27735e",
  Outreach: "#0f8b8d",
  Social: "#ef6c3b",
  Competition: "#c24f3d",
  Volunteer: "#d18f2b",
  Other: "#7c6652",
};

const state = {
  activities: [],
  markers: new Map(),
  activeId: null,
  selectedFiles: [],
  previewUrls: [],
  hasAutoFit: false,
};

const elements = {};

document.addEventListener("DOMContentLoaded", () => {
  cacheElements();
  initializeDateField();
  initializeMap();
  bindEvents();
  state.activities = loadActivities();
  renderPhotoPreview();
  renderActivities();
});

function cacheElements() {
  elements.form = document.querySelector("#activity-form");
  elements.title = document.querySelector("#activity-title");
  elements.category = document.querySelector("#activity-category");
  elements.date = document.querySelector("#activity-date");
  elements.location = document.querySelector("#activity-location");
  elements.latitude = document.querySelector("#activity-latitude");
  elements.longitude = document.querySelector("#activity-longitude");
  elements.description = document.querySelector("#activity-description");
  elements.imageUrls = document.querySelector("#activity-image-urls");
  elements.photoInput = document.querySelector("#activity-photos");
  elements.photoPreview = document.querySelector("#photo-preview");
  elements.activityList = document.querySelector("#activity-list");
  elements.emptyState = document.querySelector("#empty-state");
  elements.activityCount = document.querySelector("#activity-count");
  elements.statusBanner = document.querySelector("#status-banner");
  elements.statActivities = document.querySelector("#stat-activities");
  elements.statLocations = document.querySelector("#stat-locations");
  elements.statPhotos = document.querySelector("#stat-photos");
  elements.mapShell = document.querySelector(".map-shell");
  elements.mapHint = document.querySelector("#map-hint");
  elements.mapSearchForm = document.querySelector("#map-search-form");
  elements.mapSearchInput = document.querySelector("#map-search-input");
  elements.searchResults = document.querySelector("#search-results");
  elements.fullscreenButton = document.querySelector("#fullscreen-button");
  elements.importInput = document.querySelector("#import-input");
}

function initializeDateField() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  elements.date.value = local.toISOString().slice(0, 10);
}

function initializeMap() {
  state.map = L.map("map", { zoomControl: false, worldCopyJump: true }).setView(DEFAULT_CENTER, DEFAULT_ZOOM);
  L.control.zoom({ position: "bottomright" }).addTo(state.map);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(state.map);

  state.markerLayer = L.layerGroup().addTo(state.map);
  state.selectionMarker = L.circleMarker(DEFAULT_CENTER, {
    radius: 8,
    color: "#be4821",
    weight: 3,
    fillColor: "#ef6c3b",
    fillOpacity: 0.24,
    opacity: 0,
    fill: true,
  }).addTo(state.map);

  state.map.on("click", (event) => {
    setCoordinates(event.latlng.lat, event.latlng.lng);
    showStatus("Location selected. Finish the form to save this stop.", "success");
    elements.mapHint.textContent = "Location selected. Add your event details and save.";
  });
}

function bindEvents() {
  elements.form.addEventListener("submit", handleSubmit);
  elements.photoInput.addEventListener("change", handlePhotoSelection);
  elements.imageUrls.addEventListener("input", renderPhotoPreview);
  elements.mapSearchForm.addEventListener("submit", handleMapSearch);
  elements.importInput.addEventListener("change", handleImport);

  document.querySelector("#reset-form-button").addEventListener("click", resetForm);
  document.querySelector("#export-button").addEventListener("click", exportActivities);
  document.querySelector("#clear-button").addEventListener("click", clearAllActivities);
  elements.fullscreenButton.addEventListener("click", toggleFullscreen);
  document.querySelector("#focus-form-button").addEventListener("click", () => {
    elements.form.scrollIntoView({ behavior: "smooth", block: "start" });
    elements.title.focus();
  });
  document.querySelector("#load-demo-button").addEventListener("click", loadDemoActivities);
  document.addEventListener("fullscreenchange", handleFullscreenChange);
}

async function handleSubmit(event) {
  event.preventDefault();

  const latitude = Number.parseFloat(elements.latitude.value);
  const longitude = Number.parseFloat(elements.longitude.value);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    showStatus("Choose a valid location on the map or enter coordinates manually.", "error");
    return;
  }

  let uploadedImages = [];
  try {
    uploadedImages = await Promise.all(state.selectedFiles.map((file) => optimizeImage(file)));
  } catch (error) {
    showStatus("At least one selected photo could not be processed. Try a different image.", "error");
    return;
  }

  const externalImages = parseImageUrls(elements.imageUrls.value).map((src) => ({
    id: createId(),
    label: "Linked photo",
    src,
    source: "url",
  }));

  const images = [...externalImages, ...uploadedImages.filter(Boolean)];

  const activity = {
    id: createId(),
    title: elements.title.value.trim(),
    category: elements.category.value,
    date: elements.date.value,
    location: elements.location.value.trim(),
    description: elements.description.value.trim(),
    latitude,
    longitude,
    images,
    createdAt: new Date().toISOString(),
  };

  state.activities = [activity, ...state.activities].sort(sortActivitiesByDate);

  try {
    persistActivities();
  } catch (error) {
    state.activities = state.activities.filter((entry) => entry.id !== activity.id);
    showStatus(
      "Could not save this entry. Try fewer photos or smaller images, then export your data regularly.",
      "error",
    );
    return;
  }

  renderActivities();
  resetForm();
  focusActivity(activity.id);
  showStatus("Activity saved to the map.", "success");
}

function handlePhotoSelection(event) {
  state.selectedFiles = Array.from(event.target.files || []).filter((file) => file.type.startsWith("image/"));
  renderPhotoPreview();
}

async function handleImport(event) {
  const [file] = Array.from(event.target.files || []);
  if (!file) {
    return;
  }

  try {
    const text = await file.text();
    const payload = JSON.parse(text);
    const imported = Array.isArray(payload) ? payload.map(normalizeImportedActivity).filter(Boolean) : [];

    if (!imported.length) {
      showStatus("No valid activities were found in that JSON file.", "error");
      return;
    }

    state.activities = dedupeActivities([...imported, ...state.activities]).sort(sortActivitiesByDate);
    persistActivities();
    renderActivities();
    fitMapToActivities();
    showStatus(`Imported ${imported.length} activities.`, "success");
  } catch (error) {
    showStatus("Import failed. Make sure the file is valid JSON exported from this app.", "error");
  } finally {
    elements.importInput.value = "";
  }
}

async function handleMapSearch(event) {
  event.preventDefault();

  const query = elements.mapSearchInput.value.trim();
  if (query.length < 2) {
    showStatus("Enter at least two characters to search for a location.", "error");
    return;
  }

  elements.mapHint.textContent = `Searching for "${query}"...`;
  renderSearchResults([]);

  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=${encodeURIComponent(query)}`,
      {
        headers: {
          Accept: "application/json",
        },
      },
    );

    if (!response.ok) {
      throw new Error("Search request failed.");
    }

    const payload = await response.json();
    const results = Array.isArray(payload)
      ? payload
          .map((item) => ({
            label: String(item.display_name || "").trim(),
            shortLabel: String(item.name || item.display_name || "Selected location").split(",")[0].trim(),
            latitude: Number.parseFloat(item.lat),
            longitude: Number.parseFloat(item.lon),
          }))
          .filter((item) => item.label && Number.isFinite(item.latitude) && Number.isFinite(item.longitude))
      : [];

    if (!results.length) {
      elements.mapHint.textContent = `No locations found for "${query}".`;
      showStatus("No matching locations were found.", "error");
      return;
    }

    renderSearchResults(results);
    applySearchResult(results[0], false);
    elements.mapHint.textContent = `Showing results for "${query}". Choose one to use its coordinates.`;
  } catch (error) {
    elements.mapHint.textContent = "Search is unavailable right now. You can still click on the map manually.";
    showStatus("Location search failed. Check your connection and try again.", "error");
  }
}

function exportActivities() {
  if (!state.activities.length) {
    showStatus("There is nothing to export yet.", "error");
    return;
  }

  const blob = new Blob([JSON.stringify(state.activities, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `club-activity-map-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  showStatus("Exported your map data as JSON.", "success");
}

function clearAllActivities() {
  if (!state.activities.length) {
    showStatus("There are no activities to clear.", "error");
    return;
  }

  const confirmed = window.confirm("Clear every saved activity from this browser?");
  if (!confirmed) {
    return;
  }

  state.activities = [];
  state.activeId = null;
  persistActivities();
  renderActivities();
  state.map.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
  hideSelectionMarker();
  showStatus("All saved activities were removed from this browser.", "success");
}

function loadDemoActivities() {
  if (state.activities.length) {
    const confirmed = window.confirm("Demo highlights will be added to your current map. Continue?");
    if (!confirmed) {
      return;
    }
  }

  state.activities = dedupeActivities([...buildDemoActivities(), ...state.activities]).sort(sortActivitiesByDate);
  persistActivities();
  renderActivities();
  fitMapToActivities();
  showStatus("Demo highlights loaded. Replace them with your club's real events whenever you want.", "success");
}

function renderSearchResults(results) {
  elements.searchResults.innerHTML = "";
  elements.searchResults.hidden = results.length === 0;

  results.forEach((result) => {
    const button = document.createElement("button");
    button.className = "search-result";
    button.type = "button";
    button.addEventListener("click", () => applySearchResult(result, true));

    const title = document.createElement("strong");
    title.textContent = result.shortLabel || "Selected location";

    const description = document.createElement("span");
    description.textContent = result.label;

    button.append(title, description);
    elements.searchResults.append(button);
  });
}

function applySearchResult(result, shouldNotify) {
  if (!result) {
    return;
  }

  setCoordinates(result.latitude, result.longitude);
  if (shouldNotify || !elements.location.value.trim()) {
    elements.location.value = result.shortLabel || result.label;
  }
  state.map.flyTo([result.latitude, result.longitude], 13, { duration: 0.8 });

  if (shouldNotify) {
    elements.searchResults.hidden = true;
    showStatus("Search result selected. You can save it as a new activity now.", "success");
    elements.mapHint.textContent = "Search result selected. Edit the form and save your activity.";
  }
}

function resetForm() {
  elements.form.reset();
  initializeDateField();
  elements.category.value = "Other";
  state.selectedFiles = [];
  elements.photoInput.value = "";
  renderPhotoPreview();
  hideSelectionMarker();
  elements.mapHint.textContent = "Click on the map to place a new activity.";
}

function renderPhotoPreview() {
  state.previewUrls.forEach((url) => URL.revokeObjectURL(url));
  state.previewUrls = [];
  elements.photoPreview.innerHTML = "";

  const remoteCount = parseImageUrls(elements.imageUrls?.value || "").length;
  if (!state.selectedFiles.length && !remoteCount) {
    elements.photoPreview.classList.add("is-empty");
    const copy = document.createElement("p");
    copy.textContent = "No photos selected yet.";
    elements.photoPreview.append(copy);
    return;
  }

  elements.photoPreview.classList.remove("is-empty");

  if (remoteCount) {
    const linked = document.createElement("p");
    linked.textContent = `${remoteCount} linked image${remoteCount === 1 ? "" : "s"} will be attached.`;
    elements.photoPreview.append(linked);
  }

  if (state.selectedFiles.length) {
    const grid = document.createElement("div");
    grid.className = "photo-grid";

    state.selectedFiles.forEach((file) => {
      const item = document.createElement("div");
      item.className = "photo-chip";

      const image = document.createElement("img");
      const previewUrl = URL.createObjectURL(file);
      state.previewUrls.push(previewUrl);
      image.src = previewUrl;
      image.alt = file.name;

      const label = document.createElement("span");
      label.textContent = file.name;

      item.append(image, label);
      grid.append(item);
    });

    elements.photoPreview.append(grid);
  }
}

function renderActivities() {
  state.markerLayer.clearLayers();
  state.markers.clear();
  elements.activityList.innerHTML = "";

  const activities = [...state.activities].sort(sortActivitiesByDate);

  elements.emptyState.hidden = activities.length > 0;
  elements.activityCount.textContent = `${activities.length} ${activities.length === 1 ? "entry" : "entries"}`;
  elements.statActivities.textContent = String(activities.length);
  elements.statLocations.textContent = String(countUniqueLocations(activities));
  elements.statPhotos.textContent = String(activities.reduce((sum, activity) => sum + activity.images.length, 0));

  activities.forEach((activity) => {
    const marker = createMarker(activity);
    state.markers.set(activity.id, marker);
    marker.addTo(state.markerLayer);

    const card = createActivityCard(activity);
    elements.activityList.append(card);
  });

  if (activities.length && !state.hasAutoFit) {
    fitMapToActivities();
    state.hasAutoFit = true;
  }
}

function createMarker(activity) {
  const marker = L.marker([activity.latitude, activity.longitude], {
    icon: L.divIcon({
      className: "",
      html: `<span class="club-marker" style="background:${CATEGORY_COLORS[activity.category] || CATEGORY_COLORS.Other}"></span>`,
      iconSize: [24, 32],
      iconAnchor: [12, 26],
      popupAnchor: [0, -20],
    }),
  });

  marker.bindPopup(buildPopupNode(activity), { maxWidth: 280 });
  marker.on("click", () => {
    state.activeId = activity.id;
    refreshActiveCard();
  });

  return marker;
}

function buildPopupNode(activity) {
  const wrapper = document.createElement("article");
  wrapper.className = "popup-card";

  const title = document.createElement("h3");
  title.className = "popup-title";
  title.textContent = activity.title;

  const meta = document.createElement("div");
  meta.className = "popup-meta";
  meta.append(buildBadge(activity.category, CATEGORY_COLORS[activity.category] || CATEGORY_COLORS.Other));

  if (activity.date) {
    const date = document.createElement("span");
    date.className = "date-badge";
    date.textContent = formatDate(activity.date);
    meta.append(date);
  }

  if (activity.location) {
    const location = document.createElement("p");
    location.className = "map-selection";
    location.textContent = activity.location;
    wrapper.append(title, meta, location);
  } else {
    wrapper.append(title, meta);
  }

  if (activity.description) {
    const description = document.createElement("p");
    description.className = "popup-description";
    description.textContent = activity.description;
    wrapper.append(description);
  }

  if (activity.images.length) {
    const gallery = document.createElement("div");
    gallery.className = "popup-gallery";
    activity.images.slice(0, 4).forEach((image) => {
      const frame = document.createElement("figure");
      const img = document.createElement("img");
      img.src = image.src;
      img.alt = image.label || activity.title;
      frame.append(img);
      gallery.append(frame);
    });
    wrapper.append(gallery);
  }

  return wrapper;
}

function createActivityCard(activity) {
  const card = document.createElement("article");
  card.className = "activity-card";
  card.dataset.activityId = activity.id;
  if (state.activeId === activity.id) {
    card.classList.add("is-active");
  }

  card.addEventListener("click", () => focusActivity(activity.id));

  const imageWrap = document.createElement("div");
  imageWrap.className = "activity-image-wrap";

  if (activity.images.length) {
    const img = document.createElement("img");
    img.className = "activity-image";
    img.src = activity.images[0].src;
    img.alt = activity.images[0].label || activity.title;
    imageWrap.append(img);
  } else {
    const placeholder = document.createElement("div");
    placeholder.className = "activity-image-placeholder";
    placeholder.textContent = "Add photos here to make this stop feel alive.";
    imageWrap.append(placeholder);
  }

  const body = document.createElement("div");
  body.className = "activity-body";

  const meta = document.createElement("div");
  meta.className = "activity-meta";
  meta.append(buildBadge(activity.category, CATEGORY_COLORS[activity.category] || CATEGORY_COLORS.Other));

  if (activity.date) {
    const date = document.createElement("span");
    date.className = "date-badge";
    date.textContent = formatDate(activity.date);
    meta.append(date);
  }

  const title = document.createElement("h3");
  title.className = "activity-title";
  title.textContent = activity.title;

  const location = document.createElement("div");
  location.className = "activity-location";
  location.textContent = activity.location || `${activity.latitude.toFixed(3)}, ${activity.longitude.toFixed(3)}`;

  const description = document.createElement("p");
  description.className = "activity-description";
  description.textContent = activity.description || "No description added yet.";

  const actions = document.createElement("div");
  actions.className = "activity-actions";

  const showButton = document.createElement("button");
  showButton.className = "inline-button";
  showButton.type = "button";
  showButton.textContent = "Show on map";
  showButton.addEventListener("click", (event) => {
    event.stopPropagation();
    focusActivity(activity.id);
  });

  const deleteButton = document.createElement("button");
  deleteButton.className = "inline-button delete";
  deleteButton.type = "button";
  deleteButton.textContent = "Delete";
  deleteButton.addEventListener("click", (event) => {
    event.stopPropagation();
    deleteActivity(activity.id);
  });

  actions.append(showButton, deleteButton);
  body.append(meta, title, location, description, actions);
  card.append(imageWrap, body);
  return card;
}

function buildBadge(label, color) {
  const badge = document.createElement("span");
  badge.className = "category-badge";
  badge.textContent = label;
  badge.style.background = color;
  return badge;
}

function focusActivity(activityId) {
  const activity = state.activities.find((entry) => entry.id === activityId);
  const marker = state.markers.get(activityId);

  if (!activity || !marker) {
    return;
  }

  state.activeId = activityId;
  refreshActiveCard();
  state.map.flyTo([activity.latitude, activity.longitude], 12, { duration: 0.8 });
  marker.openPopup();

  const cards = Array.from(elements.activityList.children);
  const card = cards.find((node) => node.dataset.activityId === activity.id);
  card?.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function refreshActiveCard() {
  Array.from(elements.activityList.children).forEach((card) => {
    card.classList.toggle("is-active", card.dataset.activityId === state.activeId);
  });
}

function deleteActivity(activityId) {
  const activity = state.activities.find((entry) => entry.id === activityId);
  if (!activity) {
    return;
  }

  const confirmed = window.confirm(`Delete "${activity.title}" from the map?`);
  if (!confirmed) {
    return;
  }

  state.activities = state.activities.filter((entry) => entry.id !== activityId);
  if (state.activeId === activityId) {
    state.activeId = null;
  }
  persistActivities();
  renderActivities();
  if (state.activities.length) {
    fitMapToActivities();
  } else {
    state.map.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
  }
  showStatus(`Deleted "${activity.title}".`, "success");
}

function setCoordinates(latitude, longitude) {
  elements.latitude.value = latitude.toFixed(6);
  elements.longitude.value = longitude.toFixed(6);
  state.selectionMarker.setLatLng([latitude, longitude]);
  state.selectionMarker.setStyle({ opacity: 1, fillOpacity: 0.24 });
}

function hideSelectionMarker() {
  state.selectionMarker.setStyle({ opacity: 0, fillOpacity: 0 });
}

async function toggleFullscreen() {
  if (!document.fullscreenEnabled) {
    showStatus("Full screen mode is not supported in this browser.", "error");
    return;
  }

  try {
    if (document.fullscreenElement === elements.mapShell) {
      await document.exitFullscreen();
    } else {
      await elements.mapShell.requestFullscreen();
    }
  } catch (error) {
    showStatus("Could not toggle full screen mode.", "error");
  }
}

function handleFullscreenChange() {
  const isFullscreen = document.fullscreenElement === elements.mapShell;
  elements.fullscreenButton.textContent = isFullscreen ? "Exit full screen" : "Full screen";
  elements.fullscreenButton.setAttribute("aria-pressed", String(isFullscreen));

  window.setTimeout(() => {
    state.map.invalidateSize();
  }, 120);
}

function loadActivities() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(normalizeImportedActivity).filter(Boolean).sort(sortActivitiesByDate) : [];
  } catch (error) {
    return [];
  }
}

function persistActivities() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.activities));
}

function fitMapToActivities() {
  if (!state.activities.length) {
    return;
  }

  if (state.activities.length === 1) {
    const only = state.activities[0];
    state.map.setView([only.latitude, only.longitude], 11);
    return;
  }

  const bounds = L.latLngBounds(state.activities.map((activity) => [activity.latitude, activity.longitude]));
  state.map.fitBounds(bounds, { padding: [48, 48] });
}

function countUniqueLocations(activities) {
  const seen = new Set();
  activities.forEach((activity) => {
    const key = activity.location
      ? activity.location.trim().toLowerCase()
      : `${activity.latitude.toFixed(3)},${activity.longitude.toFixed(3)}`;
    seen.add(key);
  });
  return seen.size;
}

function parseImageUrls(input) {
  return input
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^https?:\/\//i.test(line));
}

function normalizeImportedActivity(raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const latitude = Number.parseFloat(raw.latitude);
  const longitude = Number.parseFloat(raw.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  if (!title) {
    return null;
  }

  const images = Array.isArray(raw.images)
    ? raw.images
        .map((image) => {
          if (!image || typeof image !== "object" || typeof image.src !== "string") {
            return null;
          }
          return {
            id: typeof image.id === "string" ? image.id : createId(),
            label: typeof image.label === "string" ? image.label : title,
            src: image.src,
            source: typeof image.source === "string" ? image.source : "url",
          };
        })
        .filter(Boolean)
    : [];

  return {
    id: typeof raw.id === "string" ? raw.id : createId(),
    title,
    category: CATEGORY_COLORS[raw.category] ? raw.category : "Other",
    date: typeof raw.date === "string" ? raw.date : "",
    location: typeof raw.location === "string" ? raw.location.trim() : "",
    description: typeof raw.description === "string" ? raw.description.trim() : "",
    latitude,
    longitude,
    images,
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : new Date().toISOString(),
  };
}

function dedupeActivities(activities) {
  const seen = new Set();
  return activities.filter((activity) => {
    const key = activity.id || `${activity.title}:${activity.date}:${activity.latitude}:${activity.longitude}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function sortActivitiesByDate(left, right) {
  const leftValue = left.date || left.createdAt || "";
  const rightValue = right.date || right.createdAt || "";
  return rightValue.localeCompare(leftValue);
}

function showStatus(message, tone) {
  elements.statusBanner.textContent = message;
  elements.statusBanner.className = `status-banner is-visible ${tone}`;
}

function formatDate(value) {
  if (!value) {
    return "Undated";
  }

  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function createId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `activity-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function optimizeImage(file) {
  const dataUrl = await readFileAsDataUrl(file);
  const image = await loadImage(dataUrl);
  const longestSide = Math.max(image.naturalWidth, image.naturalHeight);
  const scale = Math.min(1, 1600 / longestSide);

  if (scale === 1 && file.size < 450_000) {
    return {
      id: createId(),
      label: file.name,
      src: dataUrl,
      source: "upload",
    };
  }

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));

  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  return {
    id: createId(),
    label: file.name,
    src: canvas.toDataURL("image/jpeg", 0.82),
    source: "upload",
  };
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error("File reading failed."));
    reader.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Image loading failed."));
    image.src = src;
  });
}

function buildDemoActivities() {
  return [
    {
      id: createId(),
      title: "Community Park Cleanup",
      category: "Service",
      date: "2025-10-12",
      location: "Harbor View Park",
      description: "Club members collected litter, repainted benches, and wrapped the morning with a picnic signup table.",
      latitude: 37.7749,
      longitude: -122.4194,
      images: [buildDemoImage("Park Cleanup", "#27735e", "#f6efe6")],
      createdAt: new Date().toISOString(),
    },
    {
      id: createId(),
      title: "STEM Outreach Night",
      category: "Outreach",
      date: "2025-11-04",
      location: "Lincoln High School",
      description: "Ran hands-on demos with circuits and robotics, then shared club interest forms with students and families.",
      latitude: 34.0522,
      longitude: -118.2437,
      images: [buildDemoImage("STEM Night", "#0f8b8d", "#f6efe6")],
      createdAt: new Date().toISOString(),
    },
    {
      id: createId(),
      title: "Winter Member Mixer",
      category: "Social",
      date: "2025-12-08",
      location: "Student Union Terrace",
      description: "New members met project leads, checked out upcoming events, and added ideas for the spring semester.",
      latitude: 41.8781,
      longitude: -87.6298,
      images: [buildDemoImage("Member Mixer", "#ef6c3b", "#f6efe6")],
      createdAt: new Date().toISOString(),
    },
  ];
}

function buildDemoImage(label, foreground, background) {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600">
      <defs>
        <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stop-color="${background}" />
          <stop offset="100%" stop-color="#fff8ef" />
        </linearGradient>
      </defs>
      <rect width="800" height="600" fill="url(#g)" />
      <circle cx="660" cy="120" r="84" fill="${foreground}" opacity="0.2" />
      <circle cx="140" cy="470" r="110" fill="${foreground}" opacity="0.12" />
      <rect x="64" y="72" width="672" height="456" rx="36" fill="white" opacity="0.72" />
      <text x="96" y="180" fill="${foreground}" font-size="42" font-family="Space Grotesk, sans-serif" font-weight="700">
        ${label}
      </text>
      <text x="96" y="244" fill="#5f5248" font-size="24" font-family="DM Sans, sans-serif">
        Replace this demo card with a real club photo.
      </text>
      <text x="96" y="306" fill="#5f5248" font-size="24" font-family="DM Sans, sans-serif">
        Use export/import JSON to move your map between devices.
      </text>
    </svg>
  `.trim();

  return {
    id: createId(),
    label,
    src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
    source: "generated",
  };
}
