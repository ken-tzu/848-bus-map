// Serves the Google Maps JavaScript API key to the page.
//
// The key has to reach the browser, because Maps runs there. Keeping it
// in an env var just means it is not committed in the repo. Restrict the
// key by HTTP referrer in Google Cloud; this endpoint does not make it
// secret.
//
// Set GOOGLE_MAPS_API_KEY in Vercel project env vars, or in a local
// `.env` / `.env.local` file for `vercel dev`.

module.exports = async (req, res) => {
  const mapsApiKey = process.env.GOOGLE_MAPS_API_KEY;

  if (!mapsApiKey) {
    res.status(500).json({
      error: "missing_maps_key",
      message:
        "GOOGLE_MAPS_API_KEY is not set. Add it in Vercel env vars or a local .env file.",
    });
    return;
  }

  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({ mapsApiKey });
};
