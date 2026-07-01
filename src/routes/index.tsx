import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Upload, Loader2, Ruler, ScanSearch, Sparkles, ImageIcon } from "lucide-react";
import { computeDiff, type DiffResult } from "@/lib/image-diff";
import { toast } from "sonner";

export const Route = createFileRoute("/")({
  component: Index,
});

function UploadSlot({
  label,
  file,
  onFile,
}: {
  label: string;
  file: File | null;
  onFile: (f: File | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const url = file ? URL.createObjectURL(file) : null;
  return (
    <Card
      className="group relative flex aspect-[4/3] cursor-pointer flex-col items-center justify-center overflow-hidden border-2 border-dashed border-border bg-card/40 transition hover:border-primary hover:bg-card"
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const f = e.dataTransfer.files?.[0];
        if (f) onFile(f);
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/jpg"
        className="hidden"
        onChange={(e) => onFile(e.target.files?.[0] ?? null)}
      />
      {url ? (
        <>
          <img src={url} alt={label} className="h-full w-full object-contain" />
          <div className="absolute left-2 top-2 rounded bg-background/80 px-2 py-1 font-mono text-xs uppercase tracking-widest text-primary">
            {label}
          </div>
        </>
      ) : (
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Upload className="h-8 w-8 text-primary" />
          <div className="text-center">
            <div className="font-mono text-xs uppercase tracking-widest text-primary">{label}</div>
            <div className="mt-1 text-sm">Drop a CAD image or click to browse</div>
            <div className="mt-1 text-xs opacity-70">PNG · JPG · JPEG</div>
          </div>
        </div>
      )}
    </Card>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card className="border-border bg-card p-4">
      <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 font-mono text-2xl text-primary">{value}</div>
    </Card>
  );
}

function Index() {
  const [fileA, setFileA] = useState<File | null>(null);
  const [fileB, setFileB] = useState<File | null>(null);
  const [threshold, setThreshold] = useState(35);
  const [result, setResult] = useState<DiffResult | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [summarizing, setSummarizing] = useState(false);

  const run = useCallback(async () => {
    if (!fileA || !fileB) {
      toast.error("Upload both CAD images first.");
      return;
    }
    setBusy(true);
    setSummary(null);
    setResult(null);
    try {
      const res = await computeDiff(fileA, fileB, { threshold });
      setResult(res);
      setSummarizing(true);
      try {
        const r = await fetch("/api/summary", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            width: res.stats.width,
            height: res.stats.height,
            percentChanged: res.stats.percentChanged,
            regionCount: res.stats.regionCount,
            regions: res.stats.regions.slice(0, 20),
            imageA: res.imageAUrl,
            imageB: res.imageBUrl,
            overlay: res.overlayUrl,
          }),
        });
        const data = (await r.json()) as { summary: string };
        setSummary(data.summary);
      } catch {
        setSummary(
          `Detected ${res.stats.regionCount} changed region(s) covering ${res.stats.percentChanged.toFixed(2)}% of the drawing.`,
        );
      } finally {
        setSummarizing(false);
      }
    } catch (e) {
      toast.error((e as Error).message || "Failed to process images");
    } finally {
      setBusy(false);
    }
  }, [fileA, fileB, threshold]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-card/40 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-md bg-primary text-primary-foreground">
              <Ruler className="h-5 w-5" />
            </div>
            <div>
              <h1 className="font-mono text-lg font-semibold tracking-tight">CAD IMAGE ANALYZER</h1>
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                AI CAD Drawing Diff Engine
              </p>
            </div>
          </div>
          <a
            href="https://ai.gateway.lovable.dev"
            className="hidden font-mono text-xs text-muted-foreground hover:text-primary sm:inline"
          >
            OWNER : ADITHYA S
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-10">
        <section className="mb-10 text-center">
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Detect revisions between two CAD drawings
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-sm text-muted-foreground sm:text-base">
            Upload a reference drawing and its revised version. CADiff aligns them, highlights
            every changed region, and generates an engineering revision summary.
          </p>
        </section>

        <section className="grid gap-6 md:grid-cols-2">
          <UploadSlot label="Image A · Reference" file={fileA} onFile={setFileA} />
          <UploadSlot label="Image B · Revised" file={fileB} onFile={setFileB} />
        </section>

        <section className="mt-6 grid gap-6 rounded-lg border border-border bg-card/40 p-6 md:grid-cols-[1fr_auto] md:items-end">
          <div>
            <Label className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Sensitivity · pixel intensity threshold ({threshold})
            </Label>
            <Slider
              value={[threshold]}
              min={5}
              max={120}
              step={1}
              onValueChange={(v) => setThreshold(v[0])}
              className="mt-3"
            />
            <p className="mt-2 text-xs text-muted-foreground">
              Lower = more sensitive (catches thin CAD line changes). Higher = ignores minor noise.
            </p>
          </div>
          <Button
            size="lg"
            onClick={run}
            disabled={busy || !fileA || !fileB}
            className="font-mono uppercase tracking-widest"
          >
            {busy ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Analyzing
              </>
            ) : (
              <>
                <ScanSearch className="mr-2 h-4 w-4" /> Detect Differences
              </>
            )}
          </Button>
        </section>

        {result && (
          <section className="mt-10 space-y-8">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <StatCard label="Changed Regions" value={String(result.stats.regionCount)} />
              <StatCard
                label="% Area Changed"
                value={`${result.stats.percentChanged.toFixed(2)}%`}
              />
              <StatCard
                label="Changed Pixels"
                value={result.stats.changedPixels.toLocaleString()}
              />
              <StatCard label="Resolution" value={`${result.stats.width}×${result.stats.height}`} />
            </div>

            <Tabs defaultValue="overlay" className="w-full">
              <TabsList className="grid w-full grid-cols-4 bg-card">
                <TabsTrigger value="overlay">Overlay</TabsTrigger>
                <TabsTrigger value="side">Side-by-side</TabsTrigger>
                <TabsTrigger value="mask">Diff Mask</TabsTrigger>
                <TabsTrigger value="regions">Regions</TabsTrigger>
              </TabsList>
              <TabsContent value="overlay">
                <Card className="overflow-hidden border-border bg-card p-2">
                  <img
                    src={result.overlayUrl}
                    alt="Overlay of changes on reference"
                    className="mx-auto max-h-[70vh] w-full object-contain"
                  />
                </Card>
              </TabsContent>
              <TabsContent value="side">
                <Card className="overflow-hidden border-border bg-card p-2">
                  <img
                    src={result.sideBySideUrl}
                    alt="A · B · Overlay"
                    className="mx-auto max-h-[70vh] w-full object-contain"
                  />
                  <div className="grid grid-cols-3 gap-2 pt-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                    <span className="text-center">Reference</span>
                    <span className="text-center">Revised</span>
                    <span className="text-center">Detected</span>
                  </div>
                </Card>
              </TabsContent>
              <TabsContent value="mask">
                <Card className="overflow-hidden border-border bg-card p-2">
                  <div
                    className="relative mx-auto max-h-[70vh] w-full"
                    style={{ aspectRatio: `${result.stats.width}/${result.stats.height}` }}
                  >
                    <img
                      src={result.imageAUrl}
                      alt="Reference"
                      className="absolute inset-0 h-full w-full object-contain opacity-40"
                    />
                    <img
                      src={result.diffMaskUrl}
                      alt="Difference mask"
                      className="absolute inset-0 h-full w-full object-contain"
                    />
                  </div>
                </Card>
              </TabsContent>
              <TabsContent value="regions">
                <Card className="border-border bg-card p-4">
                  {result.stats.regions.length === 0 ? (
                    <div className="py-8 text-center text-muted-foreground">
                      No regions above the noise threshold.
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full font-mono text-sm">
                        <thead>
                          <tr className="border-b border-border text-left text-[10px] uppercase tracking-widest text-muted-foreground">
                            <th className="py-2 pr-4">#</th>
                            <th className="py-2 pr-4">Position</th>
                            <th className="py-2 pr-4">X, Y</th>
                            <th className="py-2 pr-4">W × H</th>
                            <th className="py-2 pr-4">Area (px)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {result.stats.regions.map((r, i) => (
                            <tr key={i} className="border-b border-border/50">
                              <td className="py-2 pr-4 text-primary">#{i + 1}</td>
                              <td className="py-2 pr-4">{r.position}</td>
                              <td className="py-2 pr-4">
                                {r.x}, {r.y}
                              </td>
                              <td className="py-2 pr-4">
                                {r.w} × {r.h}
                              </td>
                              <td className="py-2 pr-4">{r.area.toLocaleString()}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Card>
              </TabsContent>
            </Tabs>

            <Card className="border-border bg-card p-6">
              <div className="mb-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-primary">
                <Sparkles className="h-3.5 w-3.5" /> AI Revision Summary
              </div>
              {summarizing ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Generating engineering summary…
                </div>
              ) : (
                <p className="leading-relaxed text-foreground">{summary}</p>
              )}
            </Card>
          </section>
        )}

        {!result && !busy && (
          <section className="mt-12 grid gap-4 sm:grid-cols-3">
            {[
              {
                icon: ImageIcon,
                title: "Any CAD raster",
                body: "Floor plans, mechanical drawings, schematics, PCB layouts — PNG or JPG.",
              },
              {
                icon: ScanSearch,
                title: "Localized detection",
                body: "Bounding boxes, difference mask, and coordinates for every changed region.",
              },
              {
                icon: Sparkles,
                title: "Engineering summary",
                body: "A natural-language revision note generated by a vision AI model.",
              },
            ].map(({ icon: Icon, title, body }) => (
              <Card key={title} className="border-border bg-card/40 p-5">
                <Icon className="h-5 w-5 text-primary" />
                <div className="mt-3 font-semibold">{title}</div>
                <p className="mt-1 text-sm text-muted-foreground">{body}</p>
              </Card>
            ))}
          </section>
        )}
      </main>

      <footer className="border-t border-border py-6 text-center font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        CADiff · AI-assisted engineering drawing comparison
      </footer>
    </div>
  );
}
