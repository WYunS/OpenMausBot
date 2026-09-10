import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ServiceIcon } from "../../src/components/ServiceIcon";

function Fixture() {
  const [logo, setLogo] = useState("/__broken.svg");
  const [retryKey, setRetryKey] = useState(0);
  return <>
    <div data-testid="icon"><ServiceIcon card={{ label: "Gmail", logo, domain: null }} retryKey={retryKey} /></div>
    <button onClick={() => setLogo("/__working.svg")}>New official URL</button>
    <button onClick={() => setLogo("/__transient.svg")}>Transient URL</button>
    <button onClick={() => setRetryKey((key) => key + 1)}>Retry</button>
  </>;
}
const root = createRoot(document.getElementById("root")!);
if (new URLSearchParams(location.search).has("official")) {
  const { cards } = await (await fetch("/__official-catalog")).json();
  root.render(<main style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 18 }}>
    {cards.map((card: { slug: string; label: string; logo: string; domain: string | null }) => <div key={card.slug} data-official={card.slug}>
      <ServiceIcon card={card} />{card.label}
    </div>)}
  </main>);
} else root.render(<Fixture />);
