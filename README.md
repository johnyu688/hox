# Club Activity Map

A lightweight single-page app for showcasing where your club has been active. Add events by location, attach photos, and explore everything on an interactive map.

## What it does

- Places club activities on an interactive map using Leaflet and OpenStreetMap
- Lets you search for locations before dropping a new activity pin
- Lets you add descriptions, dates, categories, and photos for each location
- Saves entries in the browser so the map stays populated between visits
- Exports and imports JSON so you can back up your map or move it to another device

## Run it

Open [index.html](/Users/jy/Desktop/codex/index.html) directly in a browser, or serve the folder locally:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Notes

- Uploaded photos are resized in the browser before being saved, but browser storage still has limits. Export your JSON regularly.
- The map and tiles load from public CDNs, so you need an internet connection when viewing the site.
- Location search uses OpenStreetMap's Nominatim service in the browser.
- You can click the map to fill in coordinates instead of typing latitude and longitude manually.
