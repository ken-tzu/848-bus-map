# OB78 bus map

A small map that shows OnniBus's OB78 (and OB79) coaches between Helsinki
and Porvoo, with a custom heading-indicator icon and speed. Successor to
the old [848 bus map](https://github.com/) project, rebuilt after
Koiviston Auto's old public API
(`https://www.koivistonauto.fi/wp-json/ka/v1/busses`) was replaced by
OnniBus's new tracking backend.

## How it works

The new backend (`booking-api.onnibus.com`) requires a bearer token and
appears to be scoped to same-site requests, so calling it directly from
a browser on another domain is unlikely to work reliably (untested -
CORS behavior wasn't confirmed either way, this design just assumes the
safer case). Instead:

1. `script.js` (running in the browser) calls `/api/buses` - same origin
   as the page itself, so no CORS question either way.
2. `api/buses.js` is a small Vercel serverless function that calls
   `https://booking-api.onnibus.com/triptracking/1.0.0/api/trips/bus-coordinates/online`
   server-side with the bearer token, and returns the JSON as-is.

This also keeps the token out of the page source, unlike the Google Maps
key in `config.js` (which is meant to be public and restricted by HTTP
referrer instead).

### About the bearer token

The token currently lives as a fallback constant in `api/buses.js`, but
should be set as the `ONNIBUS_TOKEN` environment variable in your Vercel
project settings instead. It was captured from OnniBus's own public map
page and was identical across two different requests - possibly a
static value baked into their frontend rather than a real per-session
secret, but that's not confirmed. If bus data stops showing up, this
token having expired or been rotated is the first thing to check
(open OnniBus's map page, re-capture the token from DevTools, per
the negotiate/listen network calls).

This calls an undocumented endpoint, which could change or be
restricted without warning.

### Recovering an expired/invalid token

If `/api/buses` starts returning 401s, capture a fresh token from
OnniBus's own map page:

1. Open https://www.onnibus.com/bussit-kartalla, open DevTools -> Network,
   filter to Fetch/XHR, tick "Preserve log", and reload.
2. Find the POST request to
   `.../triptracking/1.0.0/api/trips/bus-coordinates/online/listen/negotiate?negotiateVersion=1`.
   It carries the token in its `authorization: Bearer <token>` request
   header (not the response).
3. Copy that token into the `ONNIBUS_TOKEN` env var on Vercel (or the
   fallback constant in `api/buses.js` for local testing).

The `/api/trips/bus-coordinates/online` GET endpoint this project
actually calls needs the same bearer token in its own `authorization`
header - it's a separate request from the negotiate call above, but uses
the same token value.

## Usage

- Replace the Google Maps API key in `config.js` with your own key.
- Set the `ONNIBUS_TOKEN` environment variable in Vercel (or edit the
  fallback in `api/buses.js` for local testing with `vercel dev`).
- Edit `ROUTE_INFO` in `script.js` to add/remove which routes are shown
  by default vs. only under "show all".

## Known approximations

The old Koiviston Auto API gave heading, per-position timestamps, and an
explicit "stopped" flag directly. The new API only gives a lat/lng
snapshot, so this version derives:

- **Heading** - computed from the bearing between two consecutive polls
  (so a bus's icon won't rotate correctly until its second update).
- **Speed** - computed from distance moved between polls, using the
  browser's own clock rather than a server-supplied timestamp.
- **Stopped** - approximated as "derived speed under 2 km/h", rather
  than a real stopped/moving flag from the API.

## License
[MIT](https://choosealicense.com/licenses/mit/)
