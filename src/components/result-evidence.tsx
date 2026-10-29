"use client";
import React from "react";
import type { PlanResponse } from "@/types";
import { SOURCE_LABELS, summarizeGroupEvidence, unresolvedGuidance } from "@/lib/recommendation-explanations";

export function GroupEvidenceSummary({ plan, guestNames }: { plan: PlanResponse; guestNames: string[] }) {
  const evidence = summarizeGroupEvidence(plan, guestNames);
  return <section className="evidence-summary" aria-labelledby="evidence-summary-title">
    <div><p className="eyebrow">WHO IS REPRESENTED?</p><h3 id="evidence-summary-title">{evidence.represented.length} of {evidence.total} guests have verified representation</h3>
      <p>Across at least one selected LIVE recommendation. This is retrieval evidence, not compatibility or unanimous agreement.</p></div>
    <div className="evidence-guests">{guestNames.map((guest) => <span key={guest} className={evidence.represented.includes(guest) ? "represented" : "unverified"}>{guest}<small>{evidence.represented.includes(guest) ? "Verified representation" : "Not yet verified"}</small></span>)}</div>
    {evidence.liveDomains === 0 ? <p className="evidence-note">{plan.mode === "baseline" ? "BASELINE is generic and has no guest-specific Qloo evidence." : "SAMPLE ideas do not establish verified Qloo guest representation."}</p>
      : <p className="evidence-note">{evidence.incomplete ? "Evidence is incomplete: some checks are unavailable or some domains are synthetic. " : "Individual checks are available for all selected LIVE picks. "}{evidence.unrepresented.length ? "Not everyone has verified representation in this selection. See each domain’s evidence for the limitation." : "Representation across the selection does not mean every guest supports every pick."}</p>}
    <details><summary>Coverage by domain</summary><ul>{plan.domains.map((domain) => <li key={domain.domain}><strong>{domain.headline}</strong> · {SOURCE_LABELS[domain.source]} — {domain.source === "qloo" && domain.coverage ? `${domain.coverage.representedGuests.length} of ${evidence.total} guests represented` : "No verified coverage reported"}
      {domain.source === "qloo" && domain.reason && <p>{domain.reason}</p>}</li>)}</ul></details>
  </section>;
}

export function UnresolvedTastes({ plan, onEditGuest, disabled = false }: { plan: PlanResponse; onEditGuest: (name: string) => void; disabled?: boolean }) {
  if (!plan.unresolvedSeeds.length) return null;
  return <section className="unresolved-panel" aria-labelledby="unresolved-title">
    <p className="eyebrow">A FEW TASTES NEED ANOTHER LOOK</p><h3 id="unresolved-title">Not resolved for Qloo</h3>
    <p>We couldn’t resolve these inputs in this run, so they were not used as Qloo taste signals. This can happen with broad descriptions, missing matches, or an unavailable service. SAMPLE ideas may still use simple keyword matches.</p>
    {plan.unresolvedSeeds.map(({ guest, seeds }) => <div className="unresolved-guest" key={guest}><div><strong>{guest}</strong><button className="text-button" type="button" disabled={disabled} onClick={() => onEditGuest(guest)}>Edit tastes for {guest}</button></div>
      <ul>{seeds.map((seed) => <li key={seed}><span className="unresolved-seed">{seed}</span><p>{unresolvedGuidance(seed)}</p></li>)}</ul></div>)}
    <p className="hint">Suggestions are examples, not verified matches. Replace a taste chip, then select Plan the party to try again. Your other details stay intact.</p>
  </section>;
}
