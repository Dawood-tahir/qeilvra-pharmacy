"use client";
export default function GlobalError({ reset }: { reset: () => void }) {
  return <html lang="en"><body style={{ margin: 0, background: "#f5f8fd", color: "#0f172a", fontFamily: "system-ui" }}><main role="alert" style={{ maxWidth: 480, margin: "15vh auto", padding: 24 }}><p style={{ color: "#1768e5", fontWeight: 700 }}>Qeilvra</p><h1>Unable to open the pharmacy</h1><p>Check your connection and retry. Check transaction history before entering a payment again.</p><button onClick={reset} style={{ padding: "12px 24px", background: "#1768e5", color: "white", border: 0, borderRadius: 8 }}>Retry</button></main></body></html>;
}
