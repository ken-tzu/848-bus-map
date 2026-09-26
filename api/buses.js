// Serverless proxy for OnniBus's live bus feed.
//
// The browser calls this endpoint (same origin as the map page, so no
// CORS question), and this function does the actual call to OnniBus's
// booking-api server-side. That also keeps the bearer token out of the
// page source.
//
// Set ONNIBUS_TOKEN in your Vercel project's environment variables
// (Project Settings -> Environment Variables). The hardcoded fallback
// below is only there so `vercel dev` works out of the box locally -
// replace/remove it once you've confirmed the env var is wired up.
//
// NOTE: this token was captured from the public map page and appears
// identical across different sessions, suggesting it may be a static
// value baked into OnniBus's own frontend rather than a real per-user
// secret - but that isn't confirmed, so treat it as something that
// might need refreshing if it ever stops working (see README).

const ONNIBUS_TOKEN =
  process.env.ONNIBUS_TOKEN || "08bd779d-dab6-3c85-ae46-32eff5254d98";

const UPSTREAM_URL =
  "https://booking-api.onnibus.com/triptracking/1.0.0/api/trips/bus-coordinates/online";

module.exports = async (req, res) => {
  try {
    const upstream = await fetch(UPSTREAM_URL, {
      headers: {
        accept: "*/*",
        authorization: `Bearer ${ONNIBUS_TOKEN}`,
      },
    });

    if (!upstream.ok) {
      res
        .status(upstream.status)
        .json({ error: `Upstream returned ${upstream.status}` });
      return;
    }

    const data = await upstream.json();

    // Let Vercel's edge cache absorb repeat page loads for a few seconds
    // instead of hitting the upstream API on every single visitor.
    res.setHeader("Cache-Control", "s-maxage=10, stale-while-revalidate=20");
    res.status(200).json(data);
  } catch (err) {
    res
      .status(502)
      .json({ error: "Failed to reach upstream", detail: String(err) });
  }
};
