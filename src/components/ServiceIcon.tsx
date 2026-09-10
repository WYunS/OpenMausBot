import { useState } from "react";

export interface ServiceIconCard {
  logo: string | null;
  domain: string | null;
  label: string;
}

export function ServiceIcon({ card, retryKey = 0 }: { card: ServiceIconCard; retryKey?: number }) {
  // Failure belongs to an attempt, not the app. New metadata and explicit
  // refresh both retry the real upstream image, without substitute artwork.
  return <ServiceIconAttempt key={JSON.stringify([card.logo, card.domain, retryKey])} card={card} />;
}

function ServiceIconAttempt({ card }: { card: ServiceIconCard }) {
  const [stage, setStage] = useState(card.logo ? 0 : card.domain ? 1 : 2);
  if (stage === 0 && card.logo) return <img
    src={card.logo} alt="" loading="lazy" className="size-11 rounded-xl object-contain"
    onError={() => setStage(1)}
  />;
  if (stage === 1 && card.domain) return <img
    src={`https://www.google.com/s2/favicons?domain=${card.domain}&sz=64`}
    alt="" loading="lazy" className="size-11 rounded-xl object-contain" onError={() => setStage(2)}
  />;
  return <div className="flex size-11 items-center justify-center rounded-xl bg-raised text-[15px] font-semibold text-ink-secondary">
    {card.label.slice(0, 1).toUpperCase()}
  </div>;
}
