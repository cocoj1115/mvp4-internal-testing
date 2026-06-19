"use client";

import { useEffect, useState } from "react";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { StimulusAsset as StimulusAssetType } from "@/lib/aig/types";

const MONO_BAR_FILLS = ["#9ca3af", "#d1d5db", "#6b7280"];
const MONO_LINE_STROKES = ["#111827", "#4b5563", "#6b7280"];

function VisualFrame({
  children,
  maxWidth = 600,
}: {
  children: React.ReactNode;
  maxWidth?: number;
}) {
  return (
    <div
      style={{
        maxWidth,
        margin: "0 auto",
      }}
    >
      {children}
    </div>
  );
}

function AssetTitle({ text }: { text: string }) {
  return (
    <div
      style={{
        fontSize: 17,
        fontWeight: 800,
        color: "#111827",
        textAlign: "center",
        marginBottom: 12,
        lineHeight: 1.2,
      }}
    >
      {text}
    </div>
  );
}

function KeyBox({
  type,
  labels,
}: {
  type: "line_graph" | "bar_chart";
  labels: string[];
}) {
  return (
    <div
      style={{
        border: "2px solid #111827",
        background: "#ffffff",
        width: 150,
        flexShrink: 0,
        alignSelf: "center",
      }}
    >
      <div
        style={{
          borderBottom: "2px solid #111827",
          padding: "6px 12px",
          textAlign: "center",
          fontSize: 12,
          fontWeight: 800,
          color: "#111827",
          lineHeight: 1.2,
        }}
      >
        Key
      </div>
      <div style={{ padding: "10px 12px", display: "grid", gap: 8 }}>
        {labels.map((label, i) => (
          <div
            key={label}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              color: "#111827",
              fontSize: 12,
              lineHeight: 1.2,
            }}
          >
            {type === "line_graph" ? (
              <svg width="34" height="14" viewBox="0 0 34 14" aria-hidden="true">
                <line
                  x1="2"
                  y1="7"
                  x2="32"
                  y2="7"
                  stroke={MONO_LINE_STROKES[i % MONO_LINE_STROKES.length]}
                  strokeWidth="2.5"
                />
                <circle
                  cx="17"
                  cy="7"
                  r="3.2"
                  fill={MONO_LINE_STROKES[i % MONO_LINE_STROKES.length]}
                />
              </svg>
            ) : (
              <svg width="34" height="14" viewBox="0 0 34 14" aria-hidden="true">
                <rect
                  x="5"
                  y="2"
                  width="24"
                  height="10"
                  fill={MONO_BAR_FILLS[i % MONO_BAR_FILLS.length]}
                  stroke="#111827"
                  strokeWidth="1.5"
                />
              </svg>
            )}
            <span>{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function parseTableMarkdown(md: string): { headers: string[]; rows: string[][] } {
  const lines = md.trim().split("\n").filter((l) => l.trim());
  const headers = lines[0]
    ?.split("|")
    .map((h) => h.trim())
    .filter(Boolean) ?? [];
  const rows = lines
    .slice(2)
    .map((l) =>
      l
        .split("|")
        .map((c) => c.trim())
        .filter(Boolean)
    )
    .filter((r) => r.length > 0);
  return { headers, rows };
}

function TableAsset({ title, markdown }: { title: string; markdown: string }) {
  const { headers, rows } = parseTableMarkdown(markdown);
  return (
    <div>
      <AssetTitle text={title} />
      <div style={{ overflowX: "auto" }}>
        <table
          style={{
            borderCollapse: "collapse",
            width: "100%",
            fontSize: 13,
            border: "2px solid #111827",
          }}
        >
          <thead>
            <tr>
              {headers.map((h, i) => (
                <th
                  key={i}
                  style={{
                    border: "1px solid #111827",
                    padding: "6px 12px",
                    background: "#ffffff",
                    fontWeight: 700,
                    textAlign: "center",
                    color: "#111827",
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri} style={{ background: "#fff" }}>
                {row.map((cell, ci) => (
                  <td
                    key={ci}
                    style={{
                      border: "1px solid #111827",
                      padding: "6px 12px",
                      color: "#111827",
                      textAlign: "center",
                    }}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ChartAsset({
  title,
  asset,
  type,
}: {
  title: string;
  asset: NonNullable<StimulusAssetType["chart_data"]>;
  type: "line_graph" | "bar_chart";
}) {
  const data = asset.series[0]?.points.map(([x], i) => {
    const point: Record<string, number | string> = { x: String(x) };
    for (const s of asset.series) {
      point[s.name] = s.points[i]?.[1] ?? 0;
    }
    return point;
  }) ?? [];
  const hasKey = asset.series.length > 1;

  return (
    <div>
      <VisualFrame maxWidth={hasKey ? 820 : 600}>
        <AssetTitle text={title} />
        <div style={{ overflowX: "auto", paddingRight: hasKey ? 12 : 0 }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: hasKey ? "minmax(420px, 1fr) 150px" : "minmax(0, 1fr)",
              gap: 16,
              alignItems: "end",
              minWidth: hasKey ? 598 : 0,
            }}
          >
            <div style={{ minWidth: 0 }}>
              <ResponsiveContainer width="100%" height={260}>
                {type === "bar_chart" ? (
                  <BarChart data={data} margin={{ top: 8, right: 40, left: 44, bottom: 42 }}>
                    <CartesianGrid stroke="#9ca3af" vertical={false} />
                    <XAxis
                      dataKey="x"
                      axisLine={{ stroke: "#111827", strokeWidth: 2 }}
                      tickLine={false}
                      tick={{ fontSize: 11, fill: "#111827" }}
                      interval={0}
                      label={{ value: asset.x_label, position: "insideBottom", offset: -24, fontSize: 11, fill: "#111827" }}
                    />
                    <YAxis
                      axisLine={{ stroke: "#111827", strokeWidth: 2 }}
                      tickLine={false}
                      tick={{ fontSize: 11, fill: "#111827" }}
                      width={54}
                      label={{ value: asset.y_label, angle: -90, position: "insideLeft", offset: -20, fontSize: 11, fill: "#111827" }}
                    />
                    <Tooltip contentStyle={{ border: "1px solid #111827", borderRadius: 0 }} />
                    {asset.series.map((s, i) => (
                      <Bar
                        key={s.name}
                        dataKey={s.name}
                        fill={MONO_BAR_FILLS[i % MONO_BAR_FILLS.length]}
                        stroke="#111827"
                        strokeWidth={1.5}
                      />
                    ))}
                  </BarChart>
                ) : (
                  <LineChart data={data} margin={{ top: 8, right: 40, left: 44, bottom: 42 }}>
                    <CartesianGrid stroke="#9ca3af" vertical />
                    <XAxis
                      dataKey="x"
                      axisLine={{ stroke: "#111827", strokeWidth: 2 }}
                      tickLine={false}
                      tick={{ fontSize: 11, fill: "#111827" }}
                      interval={0}
                      label={{ value: asset.x_label, position: "insideBottom", offset: -24, fontSize: 11, fill: "#111827" }}
                    />
                    <YAxis
                      axisLine={{ stroke: "#111827", strokeWidth: 2 }}
                      tickLine={false}
                      tick={{ fontSize: 11, fill: "#111827" }}
                      width={54}
                      label={{ value: asset.y_label, angle: -90, position: "insideLeft", offset: -20, fontSize: 11, fill: "#111827" }}
                    />
                    <Tooltip contentStyle={{ border: "1px solid #111827", borderRadius: 0 }} />
                    {asset.series.map((s, i) => (
                      <Line
                        key={s.name}
                        type="monotone"
                        dataKey={s.name}
                        stroke={MONO_LINE_STROKES[i % MONO_LINE_STROKES.length]}
                        strokeWidth={2.5}
                        dot={{ r: 3, fill: MONO_LINE_STROKES[i % MONO_LINE_STROKES.length], strokeWidth: 0 }}
                      />
                    ))}
                  </LineChart>
                )}
              </ResponsiveContainer>
            </div>
            {hasKey && <KeyBox type={type} labels={asset.series.map((s) => s.name)} />}
          </div>
        </div>
      </VisualFrame>
    </div>
  );
}

function sanitizeSVG(svg: string): string {
  const sanitized = svg
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/\bon\w+\s*=\s*"[^"]*"/gi, "")
    .replace(/\bon\w+\s*=\s*'[^']*'/gi, "")
    .replace(/\bon\w+\s*=[^\s/>]*/gi, "");

  return sanitized.replace(
    /<svg\b([^>]*)>/i,
    (_match, attrs: string) => {
      let nextAttrs = attrs;
      if (!/\bviewBox=/i.test(nextAttrs)) {
        const width = /width=['"]?(\d+(?:\.\d+)?)['"]?/i.exec(nextAttrs)?.[1] ?? "540";
        const height = /height=['"]?(\d+(?:\.\d+)?)['"]?/i.exec(nextAttrs)?.[1] ?? "320";
        nextAttrs += ` viewBox="0 0 ${width} ${height}"`;
      }
      if (!/\bpreserveAspectRatio=/i.test(nextAttrs)) {
        nextAttrs += ' preserveAspectRatio="xMidYMid meet"';
      }
      if (!/\brole=/i.test(nextAttrs)) {
        nextAttrs += ' role="img"';
      }
      if (!/\baria-label=/i.test(nextAttrs)) {
        nextAttrs += ' aria-label="Generated biology diagram"';
      }
      return `<svg${nextAttrs}>`;
    }
  );
}

function DiagramAsset({ title, spec }: { title: string; spec: string }) {
  const isSVG = spec.trimStart().toLowerCase().startsWith("<svg");
  return (
    <div>
      <VisualFrame>
        <AssetTitle text={title} />
        {isSVG ? (
          <div
            // SVG comes from our own LLM pipeline; script tags are stripped by sanitizeSVG.
            // eslint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{ __html: sanitizeSVG(spec) }}
            style={{ maxWidth: "100%", overflowX: "auto", lineHeight: 0 }}
          />
        ) : (
          <div
            style={{
              background: "#f8fafc",
              border: "1px solid #e2e8f0",
              borderRadius: 6,
              padding: 14,
              fontSize: 13,
              color: "#374151",
              whiteSpace: "pre-wrap",
              fontFamily: "monospace",
            }}
          >
            {spec}
          </div>
        )}
      </VisualFrame>
    </div>
  );
}

function ScenarioAsset({ title, text }: { title: string; text: string }) {
  return (
    <div>
      <AssetTitle text={title} />
      <div
        style={{
          background: "#fff",
          border: "2px solid #111827",
          borderRadius: 0,
          padding: 14,
          fontSize: 13,
          color: "#111827",
          lineHeight: 1.6,
          whiteSpace: "pre-wrap",
        }}
      >
        {text}
      </div>
    </div>
  );
}

function IllustrationAsset({
  title,
  prompt,
  imageB64,
  imageError,
}: {
  title: string;
  prompt: string;
  imageB64?: string;
  imageError?: string;
}) {
  const [b64, setB64] = useState<string | null>(imageB64 ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(imageError ?? null);

  useEffect(() => {
    setB64(imageB64 ?? null);
    setError(imageError ?? null);
  }, [imageB64, imageError, prompt]);

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/aig/illustration", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const data = await res.json() as { b64?: string; error?: string };
      if (!res.ok || data.error) {
        setError(data.error ?? "Unknown error");
      } else if (data.b64) {
        setB64(data.b64);
      }
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <VisualFrame>
        <AssetTitle text={title} />
      </VisualFrame>
      {b64 ? (
        <VisualFrame>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`data:image/png;base64,${b64}`}
            alt={title}
            style={{ width: "100%", maxWidth: 680, borderRadius: 6, border: "1px solid #e2e8f0", display: "block", margin: "0 auto" }}
          />
        </VisualFrame>
      ) : (
        <VisualFrame>
          <div
            style={{
              background: "#f8fafc",
              border: "1px dashed #d1d5db",
              borderRadius: 6,
              padding: 16,
              textAlign: "center",
              color: "#111827",
            }}
          >
            <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 10 }}>
              <strong>Illustration prompt:</strong> {prompt}
            </div>
            {error && (
              <div style={{ fontSize: 12, color: "#b91c1c", marginBottom: 8 }}>{error}</div>
            )}
            <button
              onClick={generate}
              disabled={loading}
              style={{
                padding: "7px 18px",
                background: loading ? "#a5b4fc" : "#4f46e5",
                color: "#fff",
                border: "none",
                borderRadius: 6,
                fontWeight: 600,
                fontSize: 13,
                cursor: loading ? "not-allowed" : "pointer",
              }}
            >
              {loading ? "Generating..." : "Generate illustration"}
            </button>
          </div>
        </VisualFrame>
      )}
      <VisualFrame>
        <div
          style={{
            background: "#f8fafc",
            border: "1px solid #e2e8f0",
            borderRadius: 6,
            padding: 10,
            marginTop: 10,
            color: "#334155",
            fontSize: 12,
            lineHeight: 1.5,
            whiteSpace: "pre-wrap",
          }}
        >
          <strong>Image generation prompt:</strong> {prompt}
        </div>
      </VisualFrame>
    </div>
  );
}

export function StimulusAsset({ asset }: { asset: StimulusAssetType }) {
  if (asset.type === "none") {
    return null;
  }

  return (
    <div
      style={{
        background: "#f8fafc",
        border: "1px solid #e2e8f0",
        borderRadius: 8,
        padding: 14,
        marginBottom: 4,
        color: "#111827",
        colorScheme: "light",
      }}
    >
      {asset.type === "table" && asset.table_markdown && (
        <TableAsset title={asset.title} markdown={asset.table_markdown} />
      )}
      {(asset.type === "line_graph" || asset.type === "bar_chart") && asset.chart_data && (
        <ChartAsset title={asset.title} asset={asset.chart_data} type={asset.type} />
      )}
      {asset.type === "diagram" && asset.diagram_spec && (
        <DiagramAsset title={asset.title} spec={asset.diagram_spec} />
      )}
      {asset.type === "scenario" && asset.scenario_text && (
        <ScenarioAsset title={asset.title} text={asset.scenario_text} />
      )}
      {asset.type === "illustration" && asset.illustration_prompt && (
        <IllustrationAsset
          title={asset.title}
          prompt={asset.illustration_prompt}
          imageB64={asset.image_b64}
          imageError={asset.image_generation_error}
        />
      )}
    </div>
  );
}
