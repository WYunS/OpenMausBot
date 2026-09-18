// Disposable headless preview only; the production App never imports this.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ScreenFrame } from "../components/ScreenFrame";
import { QuestionCard } from "../components/QuestionCard";
import { StoreProvider, useStore, type Message } from "../state/store";
import { setLocale } from "../lib/i18n";
import { applySkin } from "../lib/skins";
import "../styles.css";

setLocale("en");
applySkin("midnight");
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jL1sAAAAASUVORK5CYII=";
function Fixture() {
  const { state } = useStore();
  const bot = state.bots[0];
  const [key, setKey] = useState(0);
  if (!bot) return <div>Loading fixture</div>;
  const message: Message = { id: "fixture-questions", role: "bot", kind: "options", at: Date.now(),
    card: { title: "Questions", subtitle: "Fixture", options: [], requestId: "fixture-questions",
      questionRequest: { version: 1, questions: [
        { id: "plan", question: "Choose the plan", detail: "Full plan detail must remain visible.", options: [{ label: "Allow", description: "A business option, not a permission grant" }] },
        { id: "tools", question: "Choose tools", multiSelect: true, options: [{ label: "A,B" }, { label: "C" }] },
      ] },
    },
  };
  return <main className="mx-auto max-w-3xl space-y-5 p-6">
    <h1>Selective upgrade fixture</h1>
    {state.error && <div role="alert">{state.error}</div>}
    <ScreenFrame png={png} />
    <QuestionCard key={key} threadId={bot.threadId} bot={bot} message={message} />
    <button onClick={() => setKey(value => value + 1)}>Reset question fixture</button>
  </main>;
}
const root = createRoot(document.getElementById("root")!);
root.render(<StoreProvider><Fixture /></StoreProvider>);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
