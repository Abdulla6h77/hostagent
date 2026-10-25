"use client";

import { useId, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowDown, ArrowRight, Check, ChefHat, Clapperboard, Disc3, LoaderCircle, Plus, Sparkles, Users, X } from "lucide-react";
import type { Domain, DomainPlan, Guest, PlanResponse } from "@/types";
import { PlanRequestSchema, type PlanRequest } from "@/lib/validation";

const SAMPLE: Guest[] = [
  { name: "Aisha", seeds: ["jazz", "ramen", "Studio Ghibli", "vintage denim"] },
  { name: "Ben", seeds: ["techno", "tacos", "Marvel", "streetwear"] },
  { name: "Chloe", seeds: ["bossa nova", "mezze", "A24 films", "minimalism"] },
  { name: "Dev", seeds: ["classic rock", "BBQ", "Tarantino", "leather jacket"] },
];
const ICONS = { music: Disc3, food: ChefHat, film: Clapperboard, vibe: Sparkles };
const NUMBERS: Record<Domain, string> = { music: "01", food: "02", film: "03", vibe: "04" };
const LABELS = { qloo: "LIVE", sample: "SAMPLE", baseline: "BASELINE" };
interface DraftGuest extends Guest { id: number }
function GuestCard({ guest, index, onChange, onRemove, canRemove }: {
  guest: DraftGuest; index: number; onChange: (guest: DraftGuest) => void; onRemove: () => void; canRemove: boolean;
}) {
  const id = useId();
  const [seed, setSeed] = useState("");
  const [error, setError] = useState("");
  function addSeed() {
    const value = seed.trim();
    if (!value) return;
    if (value.length > 100 || guest.seeds.length >= 5) { setError("Use up to 5 tastes, each under 100 characters."); return; }
    if (guest.seeds.some((s) => s.toLowerCase() === value.toLowerCase())) { setError("That taste is already on the list."); return; }
    onChange({ ...guest, seeds: [...guest.seeds, value] }); setSeed(""); setError("");
  }
  return <article className="guest-card">
    <div className="guest-heading"><span className="guest-number">GUEST {String(index + 1).padStart(2, "0")}</span>
      <button className="icon-button" type="button" disabled={!canRemove} onClick={onRemove} aria-label={`Remove guest ${index + 1}`}><X size={16} /></button>
    </div>
    <label className="sr-only" htmlFor={`${id}-name`}>Guest {index + 1} name</label>
    <input id={`${id}-name`} className="name-input" value={guest.name} maxLength={50} placeholder="Guest name" required
      onChange={(e) => onChange({ ...guest, name: e.target.value })} autoComplete="off" />
    <label className="seed-label" htmlFor={`${id}-taste`}>Their tastes <span>{guest.seeds.length}/5</span></label>
    <div className="chips" aria-label={`Tastes for ${guest.name || `guest ${index + 1}`}`}>
      {guest.seeds.map((taste) => <span className="chip" key={taste}>{taste}<button type="button" aria-label={`Remove ${taste} from guest ${index + 1}`}
        onClick={() => onChange({ ...guest, seeds: guest.seeds.filter((s) => s !== taste) })}><X size={12} /></button></span>)}
    </div>
    <div className="seed-entry"><input id={`${id}-taste`} value={seed} maxLength={100} disabled={guest.seeds.length >= 5}
      placeholder={guest.seeds.length >= 5 ? "All 5 tastes added" : "Artist, dish, film, style…"} aria-describedby={`${id}-hint ${id}-error`}
      onChange={(e) => setSeed(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addSeed(); } }} />
      <button type="button" className="icon-button" onClick={addSeed} disabled={!seed.trim() || guest.seeds.length >= 5} aria-label={`Add taste for guest ${index + 1}`}><Plus size={17} /></button>
    </div>
    <p className="hint" id={`${id}-hint`}>3–5 tastes · Enter or + to add</p>
    <p className="field-error" id={`${id}-error`} role={error ? "alert" : undefined}>{error}</p>
  </article>;
}
function SourceBadge({ source }: { source: DomainPlan["source"] }) {
  return <span className={`badge badge-${source}`}><span className="status-dot" />{LABELS[source]}</span>;
}
function DomainCard({ plan, baseline, reduceMotion }: { plan: DomainPlan; baseline?: DomainPlan; reduceMotion: boolean }) {
  const Icon = ICONS[plan.domain];
  return <motion.article className={`domain-card domain-${plan.domain}`} initial={reduceMotion ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
    <div className="domain-heading"><span className="domain-icon"><Icon size={21} /></span><h3>{plan.headline}</h3><SourceBadge source={plan.source} /></div>
    {plan.reason && <p className="domain-reason">{plan.reason}</p>}
    <div className={baseline ? "comparison-grid" : ""}>
      <div>{baseline && <p className="column-label">YOUR GROUP · {LABELS[plan.source]}</p>}
        {plan.picks.map((pick, index) => <div key={`${pick.entityId ?? pick.title}-${index}`} className={`pick ${index === 0 ? "top-pick" : ""}`}>
          <div className="pick-topline"><span>{index === 0 ? "THE FIRST PICK" : `ALTERNATIVE ${index}`}</span>
            {pick.support && <span className="support-count">{pick.support.checked === 0 ? "Support not checked" : `${pick.support.count}/${pick.support.total} ${pick.support.kind === "synthetic-keyword" ? "keyword matches" : "guest result sets"}`}</span>}
          </div>
          <h4>{pick.title}</h4><p className="subtitle">{pick.subtitle}</p><p className="why">{pick.why}</p>
          {pick.bridgingGuests.length > 0 && <div className="guest-badges">{pick.bridgingGuests.map((name) => <span key={name}><Check size={11} />{name}</span>)}</div>}
        </div>)}
      </div>
      {baseline && <aside className="baseline-column"><p className="column-label">WITHOUT QLOO · BASELINE</p><SourceBadge source="baseline" />
        {baseline.picks.map((pick, index) => <div className="pick" key={pick.title}><div className="pick-topline"><span>{index === 0 ? "GENERIC FIRST PICK" : `ALTERNATIVE ${index}`}</span></div><h4>{pick.title}</h4><p className="subtitle">{pick.subtitle}</p><p className="why">{pick.why}</p></div>)}
      </aside>}
    </div>
  </motion.article>;
}
async function requestPlan(input: PlanRequest): Promise<PlanResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 55_000);
  try {
    const response = await fetch("/api/plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input), signal: controller.signal });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "We couldn't finish this plan. Please try again.");
    return body as PlanResponse;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error("Planning took too long. Try again, or choose the instant baseline.");
    throw error;
  } finally { clearTimeout(timer); }
}
export default function Home() {
  const [guests, setGuests] = useState<DraftGuest[]>([{ id: 1, name: "", seeds: [] }, { id: 2, name: "", seeds: [] }]);
  const nextId = useRef(3);
  const [occasion, setOccasion] = useState(""); const [city, setCity] = useState("");
  const [plan, setPlan] = useState<PlanResponse>(); const [baseline, setBaseline] = useState<PlanResponse>();
  const [snapshot, setSnapshot] = useState<PlanRequest>(); const [compare, setCompare] = useState(false);
  const [busy, setBusy] = useState(false); const [comparing, setComparing] = useState(false); const [error, setError] = useState("");
  const reduced = useReducedMotion() ?? false;
  const resultsRef = useRef<HTMLElement>(null);
  const input = { guests: guests.map(({ name, seeds }) => ({ name, seeds })), occasion, city, useQloo: true };
  const stale = snapshot && JSON.stringify(input) !== JSON.stringify(snapshot);
  const requestCount = plan?.qlooCalls.reduce((sum, c) => sum + c.count, 0) ?? 0;
  const cacheHits = plan?.qlooCalls.reduce((sum, c) => sum + c.cacheHits, 0) ?? 0;
  async function generate(useQloo: boolean) {
    const parsed = PlanRequestSchema.safeParse({ ...input, useQloo });
    if (!parsed.success) { setError(parsed.error.issues.map((issue) => issue.message).filter((s, i, a) => a.indexOf(s) === i).join(" ")); return; }
    setBusy(true); setError(""); setCompare(false); setBaseline(undefined);
    try {
      const response = await requestPlan(parsed.data); setPlan(response); setSnapshot({ ...parsed.data, useQloo: true });
      setTimeout(() => { resultsRef.current?.scrollIntoView({ behavior: reduced ? "instant" : "smooth", block: "start" }); resultsRef.current?.focus({ preventScroll: true }); }, 50);
    } catch (e) { setError(e instanceof Error ? e.message : "Connection failed. Please try again."); }
    finally { setBusy(false); }
  }
  async function toggleCompare() {
    if (compare) { setCompare(false); return; }
    if (baseline) { setCompare(true); return; }
    if (!snapshot) return;
    setComparing(true); setError("");
    try { setBaseline(await requestPlan({ ...snapshot, useQloo: false })); setCompare(true); }
    catch (e) { setError(e instanceof Error ? e.message : "Comparison failed. Please retry."); }
    finally { setComparing(false); }
  }
  return <>
    <a className="skip-link" href="#planner">Skip to guest planner</a>
    <header className="site-header"><a href="#" className="brand" aria-label="Host Agent home"><span className="brand-mark"><Sparkles size={21} /></span>host<span className="brand-light">agent</span><span className="brand-period">.</span></a>
      <div className="header-note"><span className="tiny-dot" /> A LITTLE LESS COMPROMISE</div><a className="header-link" href="#planner">Set the table <ArrowDown size={14} /></a>
    </header>
    <main>
      <section className="hero"><div className="hero-copy"><p className="eyebrow"><span className="tiny-line" /> GOOD COMPANY. BETTER PLANS.</p>
        <h1>Different tastes.<br /><span>One great night.</span></h1>
        <p className="hero-description">The jazz lover. The techno friend. The one who only watches indie films. Bring everyone’s tastes to the table — and find a little common ground.</p>
        <div className="hero-tags"><span><Users size={14} />2–4 guests</span><span><Sparkles size={14} />4 ways to connect</span><span className="qloo-tag">Powered by Qloo Taste AI</span></div>
      </div>
      <div className="hero-art" aria-hidden="true"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="table-center"><span>YOUR</span><strong>common<br />ground.</strong><span>STARTS HERE</span></div><div className="floating-note note-music"><Disc3 size={20} /><span>A little jazz</span></div><div className="floating-note note-food"><ChefHat size={20} /><span>Something to share</span></div><div className="floating-note note-film"><Clapperboard size={20} /><span>A new favorite</span></div><div className="floating-note note-vibe"><Sparkles size={20} /><span>Just your vibe</span></div></div>
      </section>
      <section id="planner" className="planner-section"><div className="section-intro"><div><p className="eyebrow">01 / THE GUEST LIST</p><h2>Who’s coming over?</h2><p>Add a few things each person loves. We’ll take it from there.</p></div>
        <button type="button" className="button-secondary" disabled={busy || comparing} onClick={() => { setGuests(SAMPLE.map((g) => ({ ...g, seeds: [...g.seeds], id: nextId.current++ }))); setError(""); }}><Users size={16} />Use sample group</button>
      </div>
      <form onSubmit={(e) => { e.preventDefault(); void generate(true); }}>
        <fieldset disabled={busy || comparing} className="planner-fieldset"><legend className="sr-only">Party guests and context</legend>
          <div className="guest-grid">{guests.map((guest, index) => <GuestCard key={guest.id} guest={guest} index={index} canRemove={guests.length > 2}
            onRemove={() => setGuests(guests.filter((g) => g.id !== guest.id))} onChange={(updated) => setGuests(guests.map((g) => g.id === updated.id ? updated : g))} />)}</div>
          <div className="add-row"><button className="text-button" type="button" disabled={guests.length >= 4} onClick={() => setGuests([...guests, { id: nextId.current++, name: "", seeds: [] }])}><Plus size={16} />Add a guest</button><span>{guests.length} of 4 seats filled</span></div>
          <div className="context-row"><div><label htmlFor="occasion">The occasion <span>optional</span></label><input id="occasion" value={occasion} maxLength={100} placeholder="Friday dinner, birthday, just because…" onChange={(e) => setOccasion(e.target.value)} /></div>
            <div><label htmlFor="city">Your city <span>optional</span></label><input id="city" value={city} maxLength={100} placeholder="Where’s everyone meeting?" onChange={(e) => setCity(e.target.value)} /><p className="hint">Context only. Venue locations aren’t verified.</p></div></div>
          <div className="plan-action"><div><span className="small-star">✦</span><p>A playlist, a menu, a film, a feeling.<br /><span>SAMPLE works offline. Live Qloo requires server approval.</span></p></div><div className="action-buttons"><button className="text-button baseline-action" type="button" onClick={() => void generate(false)}>Try generic baseline</button><button className="button-primary" type="submit">{busy ? <><LoaderCircle className="spin" size={18} />Finding common ground…</> : <>Plan the party<ArrowRight size={18} /></>}</button></div></div>
        </fieldset>
      </form>
      {error && <p className="error-banner" role="alert">{error}</p>}
      <div className="sr-only" role="status" aria-live="polite">{busy ? "Generating your party plan." : plan ? `Plan ready. ${LABELS[plan.mode]} mode.` : "Ready for your guest list."}</div>
      </section>
      {busy && <section className="loading-section" aria-label="Generating plan" aria-busy="true"><p className="eyebrow">FINDING YOUR COMMON GROUND</p><div className="skeleton-grid">{[1, 2, 3, 4].map((i) => <div key={i} className="skeleton skeleton-card" />)}</div></section>}
      {plan && !busy && <section ref={resultsRef} tabIndex={-1} id="results" className="results-section" aria-labelledby="results-title">
        <div className="section-intro"><div><p className="eyebrow">02 / YOUR COMMON GROUND</p><h2 id="results-title">A night to make your own.</h2><p>{snapshot?.occasion ? `For ${snapshot.occasion} · ` : ""}{snapshot?.guests.map((g) => g.name).join(", ")}</p></div><div className="result-meta"><SourceBadge source={plan.mode} /><span className="call-chip">{requestCount} Qloo HTTP attempts · {cacheHits} cache hits</span></div></div>
        <div className="transparency"><p>{plan.mode === "sample" ? "SAMPLE includes synthetic ideas. Individual domains may retain real Qloo results; their source labels show which." : plan.mode === "baseline" ? "BASELINE is a fixed generic plan. No taste personalization or Qloo requests." : "LIVE picks come from Qloo. Support counts show retrieval overlap, not affinity probabilities."} No affinity percentages are inferred.</p>
          {plan.warnings.length > 0 && <details><summary>Planning notes ({plan.warnings.length})</summary><ul>{plan.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>{plan.unresolvedSeeds.map((item) => <p key={item.guest}>Unresolved for {item.guest}: {item.seeds.join(", ")}</p>)}</details>}
        </div>
        {stale && <p className="stale-note" role="status">Your guest list has changed. This plan and its comparison use the previous guest list. Plan again to update.</p>}
        {plan.mode !== "baseline" && <div className="compare-bar"><div><strong>What changes without Qloo?</strong><p>Compare this exact guest list with a fixed generic plan.{plan.mode === "sample" ? " This is a SAMPLE comparison, not proof of Qloo performance." : ""}</p></div><button type="button" role="switch" aria-checked={compare} aria-controls="domain-results" className={`compare-switch ${compare ? "on" : ""}`} disabled={comparing} onClick={() => void toggleCompare()}><span className="switch-track"><span /></span>{comparing ? "Loading comparison…" : "Compare: without Qloo"}</button></div>}
        <div id="domain-results" className="domain-list">{plan.domains.map((domain) => <div key={domain.domain} className="domain-row"><span className="domain-number" aria-hidden="true">{NUMBERS[domain.domain]}</span><DomainCard plan={domain} baseline={compare ? baseline?.domains.find((d) => d.domain === domain.domain) : undefined} reduceMotion={reduced} /></div>)}</div>
        <p className="results-footnote">A starting point, not a booking. Check venues, availability, dietary needs, and content preferences with your guests.</p>
      </section>}
    </main>
    <footer><a className="brand footer-brand" href="#">host<span className="brand-light">agent</span><span className="brand-period">.</span></a><p>Built for GitLab Transcend × Qloo Agentic Hackathon</p><span>GOOD TASTE IS BETTER SHARED.</span></footer>
  </>;
}
