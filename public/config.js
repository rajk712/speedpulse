// Site settings. Edit these before deploying; no rebuild needed.
window.SITE_CONFIG = {
  siteName: "SpeedPulse",

  // Google AdSense publisher ID, e.g. "ca-pub-1234567890123456".
  // Leave empty until AdSense approves the site; ad slots stay hidden while empty.
  adsenseClient: "",
  adSlots: {
    top: "",     // slot ID for the banner above the gauge
    result: "",  // slot ID shown under the results
  },

  // Affiliate offer shown after a test. Set enabled: false to hide it.
  // Use your own tracking link from the affiliate program (VPN, ISP, router, etc.).
  offer: {
    enabled: false,
    // Shown only when download speed is below this (Mbps). Use 0 to always show.
    showBelowMbps: 50,
    title: "Slower than you're paying for?",
    text: "Compare faster broadband plans available at your address.",
    cta: "Check plans",
    url: "https://example.com/your-affiliate-link",
  },
};
