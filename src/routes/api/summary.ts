import { createFileRoute } from "@tanstack/react-router";

interface RegionIn {
  x: number;
  y: number;
  w: number;
  h: number;
  area: number;
  position: string;
}

interface Body {
  width: number;
  height: number;
  percentChanged: number;
  regionCount: number;
  regions: RegionIn[];
  imageA?: string; // data URL
  imageB?: string; // data URL
  overlay?: string; // data URL
}

function fallback(b: Body) {
  if (b.regionCount === 0) {
    return "No significant differences were detected between the two CAD drawings. The designs appear to match within the configured detection threshold.";
  }
  const top = b.regions.slice(0, 5).map((r, i) => `#${i + 1} in the ${r.position} region (~${r.area}px)`);
  return `The comparison identified ${b.regionCount} changed region${b.regionCount === 1 ? "" : "s"} between the two CAD drawings, covering approximately ${b.percentChanged.toFixed(2)}% of the drawing area. Notable changes: ${top.join(", ")}.`;
}

export const Route = createFileRoute("/api/summary")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json()) as Body;
        const key = process.env.LOVABLE_API_KEY;
        if (!key) {
          return Response.json({ summary: fallback(body), source: "fallback" });
        }

        const regionText = body.regions
          .slice(0, 12)
          .map(
            (r, i) =>
              `#${i + 1}: position=${r.position}, bbox=(${r.x},${r.y},${r.w}x${r.h}), area=${r.area}px`,
          )
          .join("\n");

        const userContent: Array<Record<string, unknown>> = [
          {
            type: "text",
            text: `You are analyzing two Computer-Aided Design (CAD) drawings for engineering change detection.

Reference (Image A) and revised (Image B) are attached, along with an overlay highlighting detected changed regions in red with cyan bounding boxes.

Detected statistics:
- Drawing area analyzed: ${body.width}x${body.height} px
- Percentage of drawing changed: ${body.percentChanged.toFixed(2)}%
- Number of changed regions: ${body.regionCount}

Region details:
${regionText || "(none)"}

Write ONE concise paragraph (4-7 sentences) describing the engineering changes between the two CAD drawings. Focus on:
- Overall comparison result.
- What CAD elements appear to have been added, removed, or modified (walls, dimensions, holes, components, annotations, hatching, symbols, etc.).
- Approximate locations using the region positions provided.
- Severity/extent of the modifications.

Use precise engineering language. Do not use bullet points or headings.`,
          },
        ];
        if (body.imageA) userContent.push({ type: "image_url", image_url: { url: body.imageA } });
        if (body.imageB) userContent.push({ type: "image_url", image_url: { url: body.imageB } });
        if (body.overlay) userContent.push({ type: "image_url", image_url: { url: body.overlay } });

        try {
          const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${key}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "google/gemini-3-flash-preview",
              messages: [
                {
                  role: "system",
                  content:
                    "You are a senior mechanical/architectural CAD reviewer summarizing revisions between two engineering drawings.",
                },
                { role: "user", content: userContent },
              ],
            }),
          });
          if (!res.ok) {
            const text = await res.text();
            return Response.json(
              { summary: fallback(body), source: "fallback", error: text },
              { status: res.status === 402 || res.status === 429 ? res.status : 200 },
            );
          }
          const data = (await res.json()) as {
            choices?: Array<{ message?: { content?: string } }>;
          };
          const summary = data.choices?.[0]?.message?.content?.trim() || fallback(body);
          return Response.json({ summary, source: "ai" });
        } catch (err) {
          return Response.json({
            summary: fallback(body),
            source: "fallback",
            error: (err as Error).message,
          });
        }
      },
    },
  },
});