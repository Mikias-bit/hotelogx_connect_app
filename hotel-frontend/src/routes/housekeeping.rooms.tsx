import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Crown, MessageCircle } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { WhatsAppOps } from "@/components/WhatsAppOps";
import { Badge, Button, Card, Empty, Eyebrow, statusTone } from "@/components/ui";
import { setRoomStatus, useApp, selectors } from "@/lib/store";
import type { RoomStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/housekeeping/rooms")({
  component: HousekeepingRooms,
});

const statusFilters: (RoomStatus | "All")[] = [
  "All",
  "Dirty",
  "Cleaning",
  "Clean",
  "Inspected",
  "DND",
  "Guest Inside",
  "Maintenance",
  "Blocked",
];

const nextStatuses: RoomStatus[] = ["Cleaning", "Clean", "Inspected", "DND", "Guest Inside", "Maintenance"];

function HousekeepingRooms() {
  const rooms = useApp((s) => s.rooms);
  const teamCleaners = useApp(selectors.housekeepingTeam);
  const [status, setStatus] = useState<RoomStatus | "All">("All");
  const [cleaner, setCleaner] = useState<string>("All");
  const [floor, setFloor] = useState<number | "All">("All");
  const [panel, setPanel] = useState(false);

  const list = useMemo(
    () =>
      rooms.filter(
        (r) =>
          (status === "All" || r.status === status) &&
          (cleaner === "All" || r.cleaner === cleaner) &&
          (floor === "All" || r.floor === floor),
      ),
    [rooms, status, cleaner, floor],
  );

  const availableCleaners = useMemo(() => {
    const list = Array.from(new Set(rooms.map((r) => r.cleaner).filter((c): c is string => Boolean(c))));
    const combined = Array.from(new Set([...list, ...teamCleaners])).filter(Boolean);
    return combined;
  }, [rooms, teamCleaners]);

  const floors = Array.from(new Set(rooms.map((r) => r.floor))).sort();

  return (
    <AppShell title="Rooms — updated from WhatsApp" wide>
      <div className="space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <Eyebrow>Rooms</Eyebrow>
            <h1 className="mt-1.5 font-display text-[26px] leading-tight font-medium text-ink">
              {rooms.filter((r) => r.status === "Clean" || r.status === "Inspected").length} released, {rooms.filter((r) => r.status === "Dirty").length} still to clean
            </h1>
            <p className="mt-1.5 max-w-2xl text-[13.5px] text-ink-3">
              Every line here can be changed from a phone. Releasing a room tells reception and the guest automatically.
            </p>
          </div>
          <Button variant="outline" icon={MessageCircle} onClick={() => setPanel((v) => !v)}>
            {panel ? "Hide WhatsApp view" : "Show WhatsApp view"}
          </Button>
        </div>

        <div className="space-y-2">
          <div className="flex gap-1.5 overflow-x-auto pb-0.5">
            {statusFilters.map((s) => (
              <button
                key={s}
                onClick={() => setStatus(s)}
                className={cn(
                  "shrink-0 rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors",
                  s === status ? "border-pine-600 bg-pine-600 text-white" : "border-line bg-surface text-ink-3 hover:border-ink-4 hover:text-ink",
                )}
              >
                {s}
                <span className="tnum ml-1.5 font-mono text-[10.5px] opacity-70">
                  {s === "All" ? rooms.length : rooms.filter((r) => r.status === s).length}
                </span>
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {["All", ...availableCleaners].map((c) => (
              <button
                key={c}
                onClick={() => setCleaner(c)}
                className={cn(
                  "rounded-full px-2.5 py-1 text-[12px] font-medium transition-colors",
                  c === cleaner ? "bg-paper-2 text-ink" : "text-ink-4 hover:text-ink",
                )}
              >
                {c === "All" ? "All attendants" : c.split(" ")[0]}
              </button>
            ))}
            <span className="mx-1 h-5 w-px self-center bg-line" />
            {(["All", ...floors] as (number | "All")[]).map((f) => (
              <button
                key={String(f)}
                onClick={() => setFloor(f)}
                className={cn(
                  "rounded-full px-2.5 py-1 text-[12px] font-medium transition-colors",
                  f === floor ? "bg-paper-2 text-ink" : "text-ink-4 hover:text-ink",
                )}
              >
                {f === "All" ? "All floors" : `Floor ${f}`}
              </button>
            ))}
          </div>
        </div>

        <div className={cn("grid gap-4", panel && "lg:grid-cols-[1fr_380px] lg:items-start")}>
          <Card pad={false} className="overflow-hidden">
            <div className="hidden grid-cols-[0.6fr_0.9fr_1.1fr_1.2fr_0.7fr_0.7fr_1fr_0.7fr] gap-3 border-b border-line bg-paper/60 px-4 py-2.5 text-[10.5px] font-semibold tracking-[0.1em] text-ink-4 uppercase xl:grid">
              <span>Room</span>
              <span>Status</span>
              <span>Cleaning type</span>
              <span>Guest status</span>
              <span>Arrival</span>
              <span>Priority</span>
              <span>Attendant</span>
              <span className="text-right">Updated</span>
            </div>
            {list.length === 0 ? (
              <div className="p-4">
                <Empty title="No rooms match" hint="Change the filters above." />
              </div>
            ) : (
              <ul>
                {list.map((r) => (
                  <li key={r.number} className="border-b border-line-soft px-4 py-3 last:border-b-0 hover:bg-paper">
                    <div className="grid grid-cols-1 gap-2 xl:grid-cols-[0.6fr_0.9fr_1.1fr_1.2fr_0.7fr_0.7fr_1fr_0.7fr] xl:items-center xl:gap-3">
                      <span className="flex items-center gap-2">
                        <span className="tnum font-mono text-[14px] font-medium text-ink">{r.number}</span>
                        {r.vip && <Crown className="size-3 text-pine-600" />}
                      </span>
                      <span>
                        <Badge tone={statusTone(r.status)} dot>
                          {r.status}
                        </Badge>
                      </span>
                      <span className="text-[12.5px] text-ink-2">{r.cleaningType}</span>
                      <span className="text-[12.5px] text-ink-3">{r.guestStatus}</span>
                      <span className="tnum font-mono text-[12px] text-ink-2">{r.arrivalTime ?? "—"}</span>
                      <span>
                        <Badge tone={r.priority === "Urgent" ? "urgent" : r.priority === "High" ? "attend" : "mute"}>{r.priority}</Badge>
                      </span>
                      <span className="text-[12.5px] text-ink-3">{r.cleaner ?? "Unassigned"}</span>
                      <span className="tnum font-mono text-[11px] text-ink-4 xl:text-right">{r.updatedAt}</span>
                    </div>
                    {r.note && <p className="mt-1.5 text-[11.5px] text-attend">{r.note}</p>}
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {nextStatuses
                        .filter((s) => s !== r.status)
                        .map((s) => (
                          <button
                            key={s}
                            onClick={() => setRoomStatus(r.number, s)}
                            className="rounded-full border border-line bg-surface px-2 py-0.5 text-[11px] text-ink-3 transition-colors hover:border-pine-400 hover:text-pine-700"
                          >
                            {s}
                          </button>
                        ))}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {panel && (
            <Card className="lg:sticky lg:top-20 lg:h-[calc(100dvh-8rem)]">
              <WhatsAppOps department="Housekeeping" />
            </Card>
          )}
        </div>
      </div>
    </AppShell>
  );
}
