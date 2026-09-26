// Serverless proxy for OnniBus's live bus feed.
//
// The browser calls this endpoint (same origin as the map page, so no
// CORS question), and this function does the actual call to OnniBus's
// booking-api server-side. That also keeps the bearer token out of the
// page source.
//
// Set ONNIBUS_TOKEN in your Vercel project env vars, or in a local
// `.env` file for `vercel dev` (see README). There is no hardcoded
// fallback - the function refuses to call upstream without it.
//
// The token was captured from OnniBus's public map page. It has stayed
// valid across sessions and for months, so it is likely a static value
// baked into their frontend rather than a per-user secret - but that
// isn't guaranteed. If bus data stops showing up with 401s, refresh it
// (see README).

const UPSTREAM_URL =
  "https://booking-api.onnibus.com/triptracking/1.0.0/api/trips/bus-coordinates/online";

module.exports = async (req, res) => {
  const token = process.env.ONNIBUS_TOKEN;

  if (!token) {
    res.status(500).json({
      error: "missing_token",
      message:
        "ONNIBUS_TOKEN is not set. Add it in Vercel env vars or a local .env file.",
    });
    return;
  }

  try {
    const upstream = await fetch(UPSTREAM_URL, {
      headers: {
        accept: "*/*",
        authorization: `Bearer ${token}`,
      },
    });

    if (!upstream.ok) {
      const kind =
        upstream.status === 401 || upstream.status === 403
          ? "upstream_unauthorized"
          : "upstream_error";
      const message =
        kind === "upstream_unauthorized"
          ? `OnniBus rejected the token (HTTP ${upstream.status}). Re-capture ONNIBUS_TOKEN from their map page - see README.`
          : `OnniBus upstream returned HTTP ${upstream.status}.`;

      res.status(upstream.status).json({
        error: kind,
        message,
        upstreamStatus: upstream.status,
      });
      return;
    }

    const data = await upstream.json();

    // fetchedAt is when this proxy actually received the snapshot. The
    // edge cache replays the same value, so the browser can tell a
    // repeated cached body apart from a bus that has not moved.
    const fetchedAt = new Date().toISOString();

    // Let Vercel's edge cache absorb repeat page loads for a few seconds
    // instead of hitting the upstream API on every single visitor.
    res.setHeader("Cache-Control", "s-maxage=10, stale-while-revalidate=20");
    res.status(200).json({ fetchedAt, buses: data });
  } catch (err) {
    res.status(502).json({
      error: "upstream_unreachable",
      message: "Failed to reach OnniBus upstream.",
      detail: String(err),
    });
  }
};
