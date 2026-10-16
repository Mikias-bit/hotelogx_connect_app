import { useState, useRef } from "react";
import { BookOpen, FileText, Plus, Trash2, Upload, Loader2 } from "lucide-react";
import { addKnowledgeDoc, uploadKnowledgeDoc, removeKnowledgeDoc, useApp } from "@/lib/store";
import type { KnowledgeDoc } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge, Button, Card, Eyebrow, Empty, SectionTitle, statusTone } from "./ui";

const categories: KnowledgeDoc["category"][] = ["Hotel Policies", "Hotel Information", "Local Recommendations", "Upsells"];

/** The documents most hotels already have — offered so the first upload is not a blank page. */
const suggestions: { name: string; category: KnowledgeDoc["category"] }[] = [
  { name: "Hotel Policy — Check-in & Check-out.pdf", category: "Hotel Policies" },
  { name: "Hotel Policy — Breakfast.pdf", category: "Hotel Policies" },
  { name: "Cancellation & Deposit Terms.docx", category: "Hotel Policies" },
  { name: "Hotel Information — Wi-Fi, Parking, Facilities.pdf", category: "Hotel Information" },
  { name: "Room Categories & Descriptions.pdf", category: "Hotel Information" },
  { name: "Local Recommendations — Restaurants & Bars.pdf", category: "Local Recommendations" },
  { name: "Upsell Catalogue & Prices.csv", category: "Upsells" },
];

export function OnboardingKnowledgeStep() {
  const knowledge = useApp((s) => s.knowledge);
  const [name, setName] = useState("Hotel Policy — Pets.pdf");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [category, setCategory] = useState<KnowledgeDoc["category"]>("Hotel Policies");
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const ready = knowledge.filter((k) => k.aiReady || k.status === "Indexed").length;
  const remaining = suggestions.filter((s) => !knowledge.some((k) => k.name === s.name));

  const handleFile = async (file: File) => {
    if (!file) return;
    setIsUploading(true);
    try {
      await uploadKnowledgeDoc(file, category);
      setSelectedFile(null);
      setName("");
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    } finally {
      setIsUploading(false);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      setSelectedFile(file);
      setName(file.name);
    }
  };

  const handleAdd = () => {
    if (selectedFile) {
      handleFile(selectedFile);
    } else if (name.trim()) {
      addKnowledgeDoc(name.trim(), category);
      setName("");
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_300px] lg:items-start">
      <Card>
        <SectionTitle
          title="What should the AI answer from?"
          hint="Upload what you already send guests — policies, facilities, recommendations, prices"
        />

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          className={cn(
            "rounded-[10px] border border-dashed p-4 text-center transition-colors",
            isDragging ? "border-pine-400 bg-pine-50/20" : "border-line bg-paper/50"
          )}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.docx,.txt,.csv,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/csv"
            className="hidden"
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) {
                const file = e.target.files[0];
                setSelectedFile(file);
                setName(file.name);
              }
            }}
          />

          <div
            className="cursor-pointer"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className={cn("mx-auto size-5 transition-colors", isDragging ? "text-pine-600" : "text-ink-4")} />
            <p className="mt-2 text-[13px] font-medium text-ink-2">Drop files here</p>
            <p className="mt-0.5 text-[11.5px] text-ink-4">PDF, DOCX, TXT or CSV · indexed in about a minute</p>
          </div>

          <div className="mt-4 grid grid-cols-[1fr_1fr] gap-3 text-left">
            <label className="block">
              <span className="text-[11.5px] font-medium text-ink-3">File name</span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Hotel Policy — Pets.pdf"
                className="mt-1 w-full rounded-[9px] border border-line bg-surface px-2.5 py-2 text-[12.5px] text-ink outline-none focus:border-pine-400"
              />
            </label>

            <label className="block">
              <span className="text-[11.5px] font-medium text-ink-3">Category</span>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as KnowledgeDoc["category"])}
                className="mt-1 w-full rounded-[9px] border border-line bg-surface px-2.5 py-2 text-[12.5px] text-ink outline-none focus:border-pine-400"
              >
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="mt-3 flex justify-start">
            <Button
              variant="outline"
              size="sm"
              icon={isUploading ? Loader2 : Plus}
              disabled={isUploading || (!selectedFile && !name.trim())}
              onClick={handleAdd}
            >
              {isUploading ? "Uploading..." : "Add"}
            </Button>
          </div>
        </div>

        {remaining.length > 0 && (
          <div className="mt-4">
            <Eyebrow>Most hotels start with these</Eyebrow>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {remaining.map((s) => (
                <button
                  key={s.name}
                  onClick={() => addKnowledgeDoc(s.name, s.category)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-[11.5px] text-ink-3 transition-colors hover:border-pine-400 hover:text-ink"
                >
                  <Plus className="size-3" />
                  {s.name.replace(/\.(pdf|docx|csv|txt)$/i, "")}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mt-4 border-t border-line-soft pt-3.5">
          <Eyebrow>Uploaded</Eyebrow>
          {knowledge.length === 0 ? (
            <div className="mt-2">
              <Empty title="Nothing uploaded yet" hint="The AI will escalate anything it cannot answer." icon={BookOpen} />
            </div>
          ) : (
            <ul className="mt-2">
              {knowledge.map((k) => (
                <li key={k.id} className="flex flex-wrap items-center gap-2.5 border-b border-line-soft py-2 last:border-b-0">
                  <FileText className="size-3.5 shrink-0 text-ink-4" />
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-2">{k.name}</span>
                  <Badge tone="mute">{k.category}</Badge>
                  <Badge tone={statusTone(k.status)} dot>
                    {k.status}
                  </Badge>
                  <Button size="sm" variant="ghost" icon={Trash2} onClick={() => removeKnowledgeDoc(k.id)} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      <div className="space-y-4">
        <Card>
          <Eyebrow>Ready for the AI</Eyebrow>
          <p className={cn("tnum mt-1.5 font-display text-[24px] leading-none font-medium", ready ? "text-ink" : "text-ink-4")}>
            {ready}
            <span className="ml-1 font-sans text-[12px] font-normal text-ink-4">of {knowledge.length} indexed</span>
          </p>
          <p className="mt-2.5 text-[12px] leading-relaxed text-ink-3">
            Every reply shows which document it came from, so you can see where an answer originated — and fix the document
            rather than the AI.
          </p>
        </Card>
        <Card>
          <Eyebrow>You can start with nothing</Eyebrow>
          <p className="mt-1.5 text-[12px] leading-relaxed text-ink-3">
            With an empty knowledge base the AI still routes requests, opens tickets and reads your PMS. It just escalates
            every question it cannot ground in a document.
          </p>
        </Card>
      </div>
    </div>
  );
}
