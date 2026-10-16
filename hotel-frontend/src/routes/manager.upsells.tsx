import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { CheckCircle2, Percent, Send, TrendingUp } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Badge, Card, ChannelMark, Empty, Eyebrow, SectionTitle, Sparkline, StatCard, statusTone } from "@/components/ui";
import { channelLabel, store, useApp } from "@/lib/store";
import { api } from "@/lib/api";
import { upsellTrend, weekdays } from "@/lib/data";
import type { Upsell } from "@/lib/types";
import { cn, money } from "@/lib/utils";

export const Route = createFileRoute("/manager/upsells")({
  component: ManagerUpsells,
});

const tabs: (Upsell["status"] | "All")[] = ["All", "Accepted", "Sent", "Declined", "Expired"];

function ManagerUpsells() {
  const upsells = useApp((s) => s.upsells);
  const [tab, setTab] = useState<Upsell["status"] | "All">("All");

  useEffect(() => {
    api.getUpsells().then((data) => {
      if (Array.isArray(data)) {
        store.setState((s) => ({ ...s, upsells: data }));
      }
    });
  }, []);
  const list = tab === "All" ? upsells : upsells.filter((u) => u.status === tab);

  const accepted = upsells.filter((u) => u.status === "Accepted");
  const revenue = accepted.reduce((sum, u) => sum + u.value, 0);
  const sent = upsells.length;
  const conversion = sent ? Math.round((accepted.length / sent) * 100) : 0;

  const byOffer = Object.entries(
    accepted.reduce<Record<string, number>>((acc, u) => {
      const key = u.offer.split("(")[0].trim();
      acc[key] = (acc[key] ?? 0) + u.value;
      return acc;
    }, {}),
  )
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  return (
    <AppShell title="What the AI sold without being asked">
      <div className="space-y-5">
        <div>
          <Eyebrow>Upsells</Eyebrow>
          <h1 className="mt-1.5 font-display text-[26px] leading-tight font-medium text-ink">Offers the AI made in conversation</h1>
          <p className="mt-1.5 max-w-2xl text-[13.5px] text-ink-3">
            Only offers from your own priced catalogue, made when the guest gave the AI a reason to make them.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Total upsell revenue" value={money(revenue)} hint="accepted, today" icon={TrendingUp} tone="good" delay={0} />
          <StatCard label="Offers sent" value={sent} hint="across WhatsApp and email" icon={Send} tone="pine" delay={40} />
          <StatCard label="Offers accepted" value={accepted.length} hint="guest said yes" icon={CheckCircle2} tone="good" delay={80} />
          <StatCard label="Conversion rate" value={`${conversion}%`} hint="of everything offered" icon={Percent} tone="ai" delay={120} />
        </div>

        <div className="grid gap-4 lg:grid-cols-[1fr_320px] lg:items-start">
          <div className="space-y-3">
            <div className="flex gap-1.5">
              {tabs.map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors",
                    t === tab ? "border-pine-600 bg-pine-600 text-white" : "border-line bg-surface text-ink-3 hover:border-ink-4 hover:text-ink",
                  )}
                >
                  {t}
                  <span className="tnum ml-1.5 font-mono text-[10.5px] opacity-70">
                    {t === "All" ? upsells.length : upsells.filter((u) => u.status === t).length}
                  </span>
                </button>
              ))}
            </div>

            <Card pad={false}>
              <div className="hidden grid-cols-[1.1fr_1.7fr_0.6fr_0.7fr_0.7fr_0.8fr] gap-3 border-b border-line bg-paper/60 px-4 py-2.5 text-[10.5px] font-semibold tracking-[0.1em] text-ink-4 uppercase sm:grid">
                <span>Guest</span>
                <span>Offer</span>
                <span className="text-right">Value</span>
                <span>Channel</span>
                <span>Status</span>
                <span className="text-right">Date</span>
              </div>
              {list.length === 0 ? (
                <div className="p-4">
                  <Empty title="Nothing here yet" hint="Offers appear the moment the AI makes one." />
                </div>
              ) : (
                <ul>
                  {list.map((u) => (
                    <li
                      key={u.id}
                      className="grid grid-cols-1 gap-1.5 border-b border-line-soft px-4 py-3 last:border-b-0 sm:grid-cols-[1.1fr_1.7fr_0.6fr_0.7fr_0.7fr_0.8fr] sm:items-center sm:gap-3"
                    >
                      <span className="text-[13px] font-medium text-ink">
                        {u.guest}
                        {u.room && <span className="tnum ml-1.5 font-mono text-[11px] text-ink-4">{u.room}</span>}
                      </span>
                      <span className="text-[12.5px] text-ink-2">{u.offer}</span>
                      <span className="tnum font-mono text-[12.5px] text-ink sm:text-right">{u.value ? money(u.value) : "—"}</span>
                      <span className="flex items-center gap-1.5 text-[11.5px] text-ink-3">
                        <ChannelMark channel={u.channel} />
                        {channelLabel(u.channel)}
                      </span>
                      <span>
                        <Badge tone={statusTone(u.status)} dot>
                          {u.status}
                        </Badge>
                      </span>
                      <span className="tnum font-mono text-[11px] text-ink-4 sm:text-right">{u.date}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <div className="space-y-4">
            <Card>
              <SectionTitle title="This week" hint="Accepted upsell revenue" />
              <Sparkline values={revenue > 0 ? upsellTrend : [0, 0, 0, 0, 0, 0, 0]} tone="good" width={260} height={54} />
              <p className="tnum mt-1 flex justify-between font-mono text-[10px] text-ink-4">
                {weekdays.map((d) => (
                  <span key={d}>{d}</span>
                ))}
              </p>
              <p className="mt-3 border-t border-line-soft pt-3 text-[12.5px] text-ink-3">
                {money(revenue)} accepted today ({upsells.length} total offers in database).
              </p>
            </Card>

            <Card>
              <SectionTitle title="Best performing offers" />
              {byOffer.length === 0 ? (
                <p className="py-2 text-[12.5px] text-ink-4">No accepted offers yet.</p>
              ) : (
                <ul className="space-y-2.5">
                  {byOffer.map(([offer, value]) => (
                    <li key={offer}>
                      <p className="flex items-baseline justify-between gap-2 text-[12.5px] text-ink-2">
                        <span className="min-w-0 truncate">{offer}</span>
                        <span className="tnum shrink-0 font-mono text-[12px] font-medium text-good">{money(value)}</span>
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card>
              <Eyebrow>How it works</Eyebrow>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-3">
                The AI only offers what is in your upsell catalogue, at your prices, and only when the guest has given it a
                reason — a late train, a long flight, an anniversary. Nothing is charged until a colleague confirms it in the
                PMS.
              </p>
            </Card>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
